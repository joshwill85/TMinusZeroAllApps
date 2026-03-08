import { cache } from 'react';
import { isSupabaseConfigured } from '@/lib/server/env';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import {
  fetchArtemisProgramIntel,
  type ArtemisProgramProcurementAward
} from '@/lib/server/artemisProgramIntel';
import type {
  ArtemisAwardeeAward,
  ArtemisAwardeeIndexItem,
  ArtemisAwardeeMissionKey,
  ArtemisAwardeeMissionSummary,
  ArtemisAwardeeProfile,
  ArtemisSeoApprovalState
} from '@/lib/types/artemis';
import {
  buildArtemisAwardeeRecipientKey,
  buildArtemisAwardeeSlug,
  normalizeArtemisAwardeeName
} from '@/lib/utils/artemisAwardees';

type AwardeeEntityRow = {
  entity_key: string;
  name: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string;
};

type AwardeeEntityOverride = {
  recipientKey: string;
  recipientName: string | null;
  slug: string | null;
  aliases: string[];
  summary: string | null;
  approvalState: ArtemisSeoApprovalState;
  updatedAt: string | null;
};

type CuratedAwardeeSeed = {
  recipientName: string;
  slug: string;
  aliases: string[];
  summary: string;
};

type AwardeeGroupMutable = {
  recipientKey: string;
  names: Map<string, number>;
  awards: ArtemisAwardeeAward[];
  missionBreakdown: Map<ArtemisAwardeeMissionKey, { awardCount: number; obligatedAmount: number }>;
  sourceUrls: Set<string>;
  sourceTitles: Set<string>;
};

type AwardeeDataset = {
  generatedAt: string;
  profiles: ArtemisAwardeeProfile[];
  approvedProfiles: ArtemisAwardeeProfile[];
  bySlug: Map<string, ArtemisAwardeeProfile>;
  byRecipientKey: Map<string, ArtemisAwardeeProfile>;
};

export type FetchArtemisAwardeeIndexOptions = {
  query?: string | null;
  limit?: number;
  includeDraft?: boolean;
};

const ARTEMIS_AWARDEE_ENTITY_TYPE = 'seo_awardee';
const MAX_AWARDS_PER_PROFILE = 120;

const MISSION_LABELS: Record<ArtemisAwardeeMissionKey, string> = {
  program: 'Artemis Program',
  'artemis-i': 'Artemis I',
  'artemis-ii': 'Artemis II',
  'artemis-iii': 'Artemis III',
  'artemis-iv': 'Artemis IV',
  'artemis-v': 'Artemis V',
  'artemis-vi': 'Artemis VI',
  'artemis-vii': 'Artemis VII'
};

const CURATED_APPROVED_AWARDEES: CuratedAwardeeSeed[] = [
  {
    recipientName: 'Lockheed Martin',
    slug: 'lockheed-martin',
    aliases: ['Lockheed Martin Corporation'],
    summary: 'Primary contractor for Orion crew vehicle systems and related Artemis mission integration work.'
  },
  {
    recipientName: 'Boeing',
    slug: 'boeing',
    aliases: ['The Boeing Company'],
    summary: 'Major Artemis contractor supporting Space Launch System stage and program integration work.'
  },
  {
    recipientName: 'Northrop Grumman',
    slug: 'northrop-grumman',
    aliases: ['Northrop Grumman Systems Corporation'],
    summary: 'Supports Artemis propulsion and mission systems contracts across crewed lunar campaign milestones.'
  },
  {
    recipientName: 'SpaceX',
    slug: 'spacex',
    aliases: ['Space Exploration Technologies Corp.'],
    summary: 'Artemis commercial partner for lunar architecture and mission-adjacent procurement lines.'
  },
  {
    recipientName: 'Blue Origin',
    slug: 'blue-origin',
    aliases: ['Blue Origin LLC'],
    summary: 'Artemis procurement partner associated with lunar mission architecture and related systems contracts.'
  }
];

const buildAwardeeDataset = cache(async (): Promise<AwardeeDataset> => {
  const generatedAt = new Date().toISOString();
  const [programIntel, entityOverrides] = await Promise.all([
    fetchArtemisProgramIntel(),
    fetchAwardeeEntityOverrides()
  ]);

  const curatedByRecipientKey = new Map<string, CuratedAwardeeSeed>();
  for (const seed of CURATED_APPROVED_AWARDEES) {
    const recipientKey = buildArtemisAwardeeRecipientKey(seed.recipientName);
    if (!recipientKey) continue;
    curatedByRecipientKey.set(recipientKey, seed);
  }

  const groups = new Map<string, AwardeeGroupMutable>();
  for (const award of programIntel.procurementAwards) {
    addAwardToGroup(groups, award);
  }

  for (const [recipientKey, seed] of curatedByRecipientKey.entries()) {
    if (groups.has(recipientKey)) continue;
    const names = new Map<string, number>();
    names.set(seed.recipientName, 1);
    groups.set(recipientKey, {
      recipientKey,
      names,
      awards: [],
      missionBreakdown: new Map(),
      sourceUrls: new Set(),
      sourceTitles: new Set()
    });
  }

  const profiles: ArtemisAwardeeProfile[] = [];
  const usedSlugs = new Set<string>();

  for (const group of groups.values()) {
    const override = entityOverrides.get(group.recipientKey) || null;
    const curated = curatedByRecipientKey.get(group.recipientKey) || null;

    const recipientName =
      override?.recipientName ||
      curated?.recipientName ||
      pickPrimaryRecipientName(group.names) ||
      group.recipientKey;

    const aliases = dedupeStrings([
      ...group.names.keys(),
      ...(curated?.aliases || []),
      ...(override?.aliases || [])
    ]).filter((alias) => alias.toLowerCase() !== recipientName.toLowerCase());

    const rawSlug =
      normalizeArtemisAwardeeName(override?.slug || null).toLowerCase() ||
      curated?.slug ||
      buildArtemisAwardeeSlug(recipientName);
    const slug = ensureUniqueSlug(rawSlug, group.recipientKey, usedSlugs);

    const awards = group.awards
      .slice()
      .sort(compareAwardRows)
      .slice(0, MAX_AWARDS_PER_PROFILE);

    const awardCount = awards.length;
    const totalObligatedAmount = sumOptionalCurrency(awards.map((award) => award.obligatedAmount));
    const firstAwardedOn = resolveBoundaryAwardDate(awards, 'first');
    const lastAwardedOn = resolveBoundaryAwardDate(awards, 'last');

    const missionBreakdown = [...group.missionBreakdown.entries()]
      .map(([missionKey, stats]) => ({
        missionKey,
        label: MISSION_LABELS[missionKey],
        awardCount: stats.awardCount,
        obligatedAmount: Number.isFinite(stats.obligatedAmount) ? stats.obligatedAmount : null
      }))
      .sort((a, b) => b.awardCount - a.awardCount || (b.obligatedAmount || 0) - (a.obligatedAmount || 0));

    const summary =
      override?.summary ||
      curated?.summary ||
      buildDefaultAwardeeSummary({ recipientName, awardCount, totalObligatedAmount, missionBreakdown });

    const approvalState = override?.approvalState || (curated ? 'approved' : 'draft');

    profiles.push({
      recipientKey: group.recipientKey,
      recipientName,
      slug,
      aliases,
      seoApprovalState: approvalState,
      summary,
      awards,
      awardCount,
      totalObligatedAmount,
      firstAwardedOn,
      lastAwardedOn,
      missionBreakdown,
      sourceUrls: [...group.sourceUrls.values()].sort(),
      sourceTitles: [...group.sourceTitles.values()].sort(),
      lastUpdated: override?.updatedAt || programIntel.lastProcurementRefresh || null
    });
  }

  profiles.sort(compareAwardeeProfiles);

  const approvedProfiles = profiles.filter((profile) => profile.seoApprovalState === 'approved');
  const bySlug = new Map(profiles.map((profile) => [profile.slug.toLowerCase(), profile]));
  const byRecipientKey = new Map(profiles.map((profile) => [profile.recipientKey, profile]));

  return {
    generatedAt,
    profiles,
    approvedProfiles,
    bySlug,
    byRecipientKey
  };
});

export async function fetchArtemisAwardeeIndex(options: FetchArtemisAwardeeIndexOptions = {}): Promise<ArtemisAwardeeIndexItem[]> {
  const query = normalizeArtemisAwardeeName(options.query || null);
  const includeDraft = Boolean(options.includeDraft);
  const dataset = await buildAwardeeDataset();

  const rows = includeDraft ? dataset.profiles : dataset.approvedProfiles;
  const filtered = query ? rows.filter((profile) => matchesAwardeeQuery(profile, query)) : rows;
  const limit = clampInt(options.limit ?? 200, 1, Math.max(1, filtered.length));

  return filtered.slice(0, limit).map((profile) => ({
    recipientKey: profile.recipientKey,
    recipientName: profile.recipientName,
    slug: profile.slug,
    aliases: profile.aliases,
    seoApprovalState: profile.seoApprovalState,
    summary: profile.summary,
    awardCount: profile.awardCount,
    totalObligatedAmount: profile.totalObligatedAmount,
    firstAwardedOn: profile.firstAwardedOn,
    lastAwardedOn: profile.lastAwardedOn,
    missionBreakdown: profile.missionBreakdown
  }));
}

export async function fetchArtemisAwardeeBySlug(
  slug: string,
  options: { includeDraft?: boolean } = {}
): Promise<ArtemisAwardeeProfile | null> {
  const dataset = await buildAwardeeDataset();
  const profile = dataset.bySlug.get(normalizeArtemisAwardeeName(slug).toLowerCase()) || null;
  if (!profile) return null;
  if (!options.includeDraft && profile.seoApprovalState !== 'approved') return null;
  return profile;
}

export async function fetchRelatedArtemisAwardees(
  recipientKey: string,
  options: { limit?: number; includeDraft?: boolean } = {}
): Promise<ArtemisAwardeeIndexItem[]> {
  const dataset = await buildAwardeeDataset();
  const baseProfile = dataset.byRecipientKey.get(recipientKey);
  if (!baseProfile) return [];

  const includeDraft = Boolean(options.includeDraft);
  const limit = clampInt(options.limit ?? 6, 1, 20);
  const candidateProfiles = (includeDraft ? dataset.profiles : dataset.approvedProfiles).filter(
    (profile) => profile.recipientKey !== recipientKey
  );

  const scored = candidateProfiles
    .map((profile) => ({ profile, score: scoreRelatedProfile(baseProfile, profile) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || compareAwardeeProfiles(a.profile, b.profile));

  return scored.slice(0, limit).map((entry) => ({
    recipientKey: entry.profile.recipientKey,
    recipientName: entry.profile.recipientName,
    slug: entry.profile.slug,
    aliases: entry.profile.aliases,
    seoApprovalState: entry.profile.seoApprovalState,
    summary: entry.profile.summary,
    awardCount: entry.profile.awardCount,
    totalObligatedAmount: entry.profile.totalObligatedAmount,
    firstAwardedOn: entry.profile.firstAwardedOn,
    lastAwardedOn: entry.profile.lastAwardedOn,
    missionBreakdown: entry.profile.missionBreakdown
  }));
}

export async function listArtemisAwardeeEditorialSlugs(): Promise<string[]> {
  const dataset = await buildAwardeeDataset();
  return dataset.approvedProfiles.map((profile) => profile.slug);
}

function addAwardToGroup(groups: Map<string, AwardeeGroupMutable>, award: ArtemisProgramProcurementAward) {
  const recipientName = normalizeArtemisAwardeeName(award.recipient);
  const recipientKey = buildArtemisAwardeeRecipientKey(recipientName);
  if (!recipientKey) return;

  const existing = groups.get(recipientKey);
  const group: AwardeeGroupMutable =
    existing || {
      recipientKey,
      names: new Map<string, number>(),
      awards: [],
      missionBreakdown: new Map(),
      sourceUrls: new Set(),
      sourceTitles: new Set()
    };

  const safeRecipientName = recipientName || 'Unknown recipient';
  group.names.set(safeRecipientName, (group.names.get(safeRecipientName) || 0) + 1);

  const missionKey = coerceAwardeeMissionKey(award.missionKey);
  const awardKey = buildAwardIdentityKey(award, missionKey, safeRecipientName);
  const alreadyExists = group.awards.some((row) => buildAwardIdentityKey(row, row.missionKey, row.recipient) === awardKey);
  if (!alreadyExists) {
    group.awards.push({
      awardId: award.awardId,
      title: award.title,
      recipient: safeRecipientName,
      obligatedAmount: toFiniteNumber(award.obligatedAmount),
      awardedOn: normalizeIsoDate(award.awardedOn),
      missionKey,
      contractKey: award.contractKey,
      solicitationId: award.solicitationId,
      detail: award.detail,
      sourceUrl: award.sourceUrl,
      sourceTitle: award.sourceTitle
    });
  }

  const missionStats = group.missionBreakdown.get(missionKey) || { awardCount: 0, obligatedAmount: 0 };
  missionStats.awardCount += 1;
  missionStats.obligatedAmount += toFiniteNumber(award.obligatedAmount) || 0;
  group.missionBreakdown.set(missionKey, missionStats);

  const sourceUrl = normalizeArtemisAwardeeName(award.sourceUrl);
  if (sourceUrl) group.sourceUrls.add(sourceUrl);

  const sourceTitle = normalizeArtemisAwardeeName(award.sourceTitle);
  if (sourceTitle) group.sourceTitles.add(sourceTitle);

  groups.set(recipientKey, group);
}

async function fetchAwardeeEntityOverrides(): Promise<Map<string, AwardeeEntityOverride>> {
  if (!isSupabaseConfigured()) return new Map();

  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from('artemis_entities')
    .select('entity_key,name,description,metadata,updated_at')
    .eq('entity_type', ARTEMIS_AWARDEE_ENTITY_TYPE)
    .limit(2000);

  if (error) {
    console.error('artemis awardee seo entity query error', error);
    return new Map();
  }

  const rows = (data || []) as AwardeeEntityRow[];
  const overrides = new Map<string, AwardeeEntityOverride>();

  for (const row of rows) {
    const metadata = isRecord(row.metadata) ? row.metadata : {};
    const recipientName = readString(metadata.recipientName) || readString(metadata.recipient) || readString(row.name);
    const derivedRecipientKey = buildArtemisAwardeeRecipientKey(recipientName);
    const metadataRecipientKey = buildArtemisAwardeeRecipientKey(readString(metadata.recipientKey));
    const entityKeyRecipient = row.entity_key.startsWith('awardee:') ? row.entity_key.slice('awardee:'.length) : row.entity_key;
    const entityRecipientKey = buildArtemisAwardeeRecipientKey(entityKeyRecipient);
    const recipientKey = metadataRecipientKey || derivedRecipientKey || entityRecipientKey;
    if (!recipientKey) continue;

    const slug =
      normalizeArtemisAwardeeName(readString(metadata.slug)).toLowerCase() ||
      normalizeArtemisAwardeeName(row.entity_key.startsWith('awardee:') ? row.entity_key.slice('awardee:'.length) : '').toLowerCase() ||
      null;

    const nextOverride: AwardeeEntityOverride = {
      recipientKey,
      recipientName,
      slug,
      aliases: readStringArray(metadata.aliases),
      summary: readString(metadata.summary) || readString(row.description),
      approvalState: readApprovalState(metadata.seoApprovalState) || readApprovalState(metadata.approvalState) || 'draft',
      updatedAt: normalizeIsoDate(readString(row.updated_at))
    };

    const existing = overrides.get(recipientKey);
    if (!existing) {
      overrides.set(recipientKey, nextOverride);
      continue;
    }

    const existingMs = Date.parse(existing.updatedAt || '');
    const nextMs = Date.parse(nextOverride.updatedAt || '');
    const keepNext = Number.isFinite(nextMs) && (!Number.isFinite(existingMs) || nextMs >= existingMs);
    if (keepNext) {
      overrides.set(recipientKey, nextOverride);
    }
  }

  return overrides;
}

function buildAwardIdentityKey(
  award: Pick<ArtemisAwardeeAward, 'awardId' | 'title' | 'awardedOn' | 'obligatedAmount'>,
  missionKey: ArtemisAwardeeMissionKey,
  recipient: string
) {
  return [
    normalizeArtemisAwardeeName(award.awardId).toLowerCase() || 'na',
    normalizeArtemisAwardeeName(award.title).toLowerCase() || 'na',
    normalizeArtemisAwardeeName(award.awardedOn).toLowerCase() || 'na',
    normalizeArtemisAwardeeName(String(award.obligatedAmount ?? '')).toLowerCase() || 'na',
    normalizeArtemisAwardeeName((award as { contractKey?: string | null }).contractKey || '').toLowerCase() || 'na',
    normalizeArtemisAwardeeName((award as { solicitationId?: string | null }).solicitationId || '').toLowerCase() || 'na',
    missionKey,
    buildArtemisAwardeeRecipientKey(recipient)
  ].join('|');
}

function compareAwardRows(a: ArtemisAwardeeAward, b: ArtemisAwardeeAward) {
  const amountDiff = (b.obligatedAmount || 0) - (a.obligatedAmount || 0);
  if (amountDiff !== 0) return amountDiff;

  const dateDiff = parseDateMs(b.awardedOn) - parseDateMs(a.awardedOn);
  if (dateDiff !== 0) return dateDiff;

  return normalizeArtemisAwardeeName(a.title).localeCompare(normalizeArtemisAwardeeName(b.title));
}

function compareAwardeeProfiles(a: ArtemisAwardeeProfile, b: ArtemisAwardeeProfile) {
  const amountDiff = (b.totalObligatedAmount || 0) - (a.totalObligatedAmount || 0);
  if (amountDiff !== 0) return amountDiff;

  const countDiff = b.awardCount - a.awardCount;
  if (countDiff !== 0) return countDiff;

  return a.recipientName.localeCompare(b.recipientName);
}

function resolveBoundaryAwardDate(awards: ArtemisAwardeeAward[], direction: 'first' | 'last') {
  const sortedDates = awards
    .map((award) => normalizeIsoDate(award.awardedOn))
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => a.localeCompare(b));

  if (!sortedDates.length) return null;
  return direction === 'first' ? sortedDates[0] : sortedDates[sortedDates.length - 1];
}

function buildDefaultAwardeeSummary({
  recipientName,
  awardCount,
  totalObligatedAmount,
  missionBreakdown
}: {
  recipientName: string;
  awardCount: number;
  totalObligatedAmount: number | null;
  missionBreakdown: ArtemisAwardeeMissionSummary[];
}) {
  if (awardCount <= 0) {
    return `${recipientName} appears in Artemis procurement tracking and is held for editorial verification before broader indexing.`;
  }

  const leadingMission = missionBreakdown[0]?.label || 'Artemis Program';
  const amountText =
    totalObligatedAmount != null
      ? `about ${new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          notation: 'compact',
          maximumFractionDigits: 1
        }).format(totalObligatedAmount)}`
      : 'tracked obligations';

  return `${recipientName} has ${awardCount} tracked Artemis procurement award${awardCount === 1 ? '' : 's'} totaling ${amountText}, with strongest activity tied to ${leadingMission}.`;
}

function ensureUniqueSlug(rawSlug: string, recipientKey: string, used: Set<string>) {
  const normalized = normalizeArtemisAwardeeName(rawSlug).toLowerCase();
  const base = normalized || buildArtemisAwardeeSlug(recipientKey);
  let candidate = base;
  let attempt = 1;

  while (used.has(candidate)) {
    const suffix = buildArtemisAwardeeSlug(recipientKey).slice(0, 16) || String(attempt);
    candidate = `${base}-${suffix}-${attempt}`;
    attempt += 1;
  }

  used.add(candidate);
  return candidate;
}

function scoreRelatedProfile(base: ArtemisAwardeeProfile, candidate: ArtemisAwardeeProfile) {
  const baseMissions = new Set(base.missionBreakdown.map((entry) => entry.missionKey));
  const candidateMissions = new Set(candidate.missionBreakdown.map((entry) => entry.missionKey));

  let overlap = 0;
  for (const mission of candidateMissions) {
    if (baseMissions.has(mission)) overlap += 1;
  }

  const lexicalBoost = hasTokenOverlap(base.recipientName, candidate.recipientName) ? 1 : 0;
  const amountBoost = candidate.totalObligatedAmount && candidate.totalObligatedAmount > 0 ? 0.5 : 0;

  return overlap * 3 + lexicalBoost + amountBoost;
}

function hasTokenOverlap(left: string, right: string) {
  const leftTokens = new Set(tokenizeText(left));
  const rightTokens = tokenizeText(right);
  return rightTokens.some((token) => leftTokens.has(token));
}

function tokenizeText(value: string) {
  return normalizeArtemisAwardeeName(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 3);
}

function matchesAwardeeQuery(profile: ArtemisAwardeeProfile, query: string) {
  const needle = query.toLowerCase();
  const haystack = [
    profile.recipientName,
    profile.summary,
    profile.slug,
    ...profile.aliases,
    ...profile.missionBreakdown.map((entry) => entry.label),
    ...profile.awards.slice(0, 50).map((award) => award.title || '')
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(needle);
}

function pickPrimaryRecipientName(names: Map<string, number>) {
  let bestName = '';
  let bestCount = -1;

  for (const [name, count] of names.entries()) {
    if (count > bestCount) {
      bestName = name;
      bestCount = count;
      continue;
    }

    if (count === bestCount && name.length > bestName.length) {
      bestName = name;
    }
  }

  return bestName || null;
}

function sumOptionalCurrency(values: Array<number | null>) {
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!finite.length) return null;
  return finite.reduce((sum, value) => sum + value, 0);
}

function readApprovalState(value: unknown): ArtemisSeoApprovalState | null {
  const normalized = readString(value)?.toLowerCase();
  if (normalized === 'approved') return 'approved';
  if (normalized === 'rejected') return 'rejected';
  if (normalized === 'draft') return 'draft';
  return null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeArtemisAwardeeName(value);
  return normalized || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeArtemisAwardeeName(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function normalizeIsoDate(value: string | null | undefined) {
  const normalized = normalizeArtemisAwardeeName(value);
  if (!normalized) return null;
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function parseDateMs(value: string | null | undefined) {
  const normalized = normalizeArtemisAwardeeName(value);
  if (!normalized) return 0;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toFiniteNumber(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function coerceAwardeeMissionKey(value: string | null | undefined): ArtemisAwardeeMissionKey {
  const normalized = normalizeArtemisAwardeeName(value).toLowerCase();
  if (normalized === 'artemis-i') return 'artemis-i';
  if (normalized === 'artemis-ii') return 'artemis-ii';
  if (normalized === 'artemis-iii') return 'artemis-iii';
  if (normalized === 'artemis-iv') return 'artemis-iv';
  if (normalized === 'artemis-v') return 'artemis-v';
  if (normalized === 'artemis-vi') return 'artemis-vi';
  if (normalized === 'artemis-vii') return 'artemis-vii';
  return 'program';
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
