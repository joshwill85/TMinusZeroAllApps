import { cache } from 'react';
import {
  buildArtemisContractHref,
  fetchArtemisContractStoryByAwardId,
  fetchArtemisContractStoryByPiid,
  resolveArtemisAwardIdFromContractSeed
} from '@/lib/server/artemisContracts';
import { isSupabaseConfigured } from '@/lib/server/env';
import { fetchProgramContractSourceEvidenceByStoryKey } from '@/lib/server/programContractSourceLinks';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import type {
  ContractStoryAction,
  ContractStoryDetail,
  ContractStoryMatchStrategy,
  ContractStoryNotice,
  ProgramContractStoryScope,
  ContractStorySpendingPoint,
  ContractStorySummary
} from '@/lib/types/contractsStory';
import { buildCanonicalContractHrefForStory } from '@/lib/utils/canonicalContracts';
import { normalizeSamPublicUrl, resolveSamPublicUrl } from '@/lib/utils/sam';
import { resolveUsaspendingAwardSourceUrl } from '@/lib/utils/usaspending';

type StoryLookupSeed = {
  awardId?: string | null;
  piid?: string | null;
  contractKey?: string | null;
  solicitationId?: string | null;
  noticeId?: string | null;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ContractStoryLookupSeed = StoryLookupSeed;

type ProgramContractStoryLinkRow = {
  story_key: string;
  program_scope: string;
  match_strategy: string;
  match_confidence: number | null;
  has_full_story: boolean | null;
  primary_usaspending_award_id: string | null;
  primary_piid: string | null;
  primary_contract_key: string | null;
  primary_solicitation_id: string | null;
  primary_notice_id: string | null;
  mission_key: string | null;
  recipient: string | null;
  title: string | null;
  awarded_on: string | null;
  obligated_amount: number | null;
  action_count: number | null;
  notice_count: number | null;
  spending_point_count: number | null;
  bidder_count: number | null;
  latest_action_date: string | null;
  latest_notice_date: string | null;
  latest_spending_fiscal_year: number | null;
  latest_spending_fiscal_month: number | null;
  match_evidence: Record<string, unknown> | null;
};

const STORY_QUERY_BATCH = 200;

const STORY_SELECT =
  'story_key,program_scope,match_strategy,match_confidence,has_full_story,primary_usaspending_award_id,primary_piid,primary_contract_key,primary_solicitation_id,primary_notice_id,mission_key,recipient,title,awarded_on,obligated_amount,action_count,notice_count,spending_point_count,bidder_count,latest_action_date,latest_notice_date,latest_spending_fiscal_year,latest_spending_fiscal_month,match_evidence';

const withCache =
  typeof cache === 'function'
    ? cache
    : <T extends (...args: any[]) => any>(fn: T): T => fn;

export const fetchContractStorySummaryForLedgerEntry = withCache(
  async (
    scope: ProgramContractStoryScope,
    seed: StoryLookupSeed
  ): Promise<ContractStorySummary | null> => {
    const seedWithFallback = normalizeStoryLookupSeed(seed);
    const rows = await fetchStoryRowsForSeeds(scope, [seedWithFallback]);
    if (rows.length < 1) return null;
    return resolveBestStoryMatch(seedWithFallback, rows);
  }
);

export async function fetchContractStorySummariesByAwards(
  scope: ProgramContractStoryScope,
  seeds: StoryLookupSeed[]
): Promise<Map<string, ContractStorySummary>> {
  const normalizedSeeds = seeds.map((seed) => normalizeStoryLookupSeed(seed));
  const rows = await fetchStoryRowsForSeeds(scope, normalizedSeeds);

  const out = new Map<string, ContractStorySummary>();
  if (rows.length < 1) return out;

  for (const seed of normalizedSeeds) {
    const key = buildStoryLookupMapKey(seed);
    if (!key) continue;
    const best = resolveBestStoryMatch(seed, rows);
    if (best) out.set(key, best);
  }

  return out;
}

export const fetchContractStoryDetailByStoryKey = withCache(
  async (storyKey: string): Promise<ContractStoryDetail | null> => {
    const normalizedStoryKey = normalizeText(storyKey);
    if (!normalizedStoryKey) return null;

    const canonical = await fetchStoryRowByStoryKey(normalizedStoryKey);
    const scope = canonical?.programScope || parseScopeFromStoryKey(normalizedStoryKey) || 'artemis';

    const summary = canonical ||
      ({
        storyKey: normalizedStoryKey,
        programScope: scope,
        matchStrategy: 'heuristic_multi_signal',
        matchConfidence: 0,
        hasFullStory: false,
        primaryUsaspendingAwardId: parseIdentifierFromStoryKey(normalizedStoryKey),
        primaryPiid: null,
        primaryContractKey: null,
        primarySolicitationId: null,
        primaryNoticeId: null,
        missionKey: null,
        recipient: null,
        title: null,
        awardedOn: null,
        obligatedAmount: null,
        actionCount: 0,
        noticeCount: 0,
        spendingPointCount: 0,
        bidderCount: 0,
        latestActionDate: null,
        latestNoticeDate: null,
        latestSpendingFiscalYear: null,
        latestSpendingFiscalMonth: null,
        matchEvidence: {}
      } satisfies ContractStorySummary);

    const awardId =
      normalizeText(summary.primaryUsaspendingAwardId) ||
      parseAwardIdFromStoryKey(normalizedStoryKey) ||
      null;

    const piid = normalizeText(summary.primaryPiid);
    const canonicalPath = buildCanonicalContractHrefForStory({
      scope,
      awardId,
      piid,
      contractKey: summary.primaryContractKey || parseIdentifierFromStoryKey(normalizedStoryKey)
    });
    const sourceEvidence = await fetchProgramContractSourceEvidenceByStoryKey(summary.storyKey, {
      includeUsaspending: {
        programScope: scope,
        awardId
      }
    });

    const story =
      (awardId ? await fetchArtemisContractStoryByAwardId(awardId) : null) ||
      (piid ? await fetchArtemisContractStoryByPiid(piid) : null) ||
      null;

    const usaspendingUrl = resolveUsaspendingAwardSourceUrl({
      awardId,
      sourceUrl: null,
      awardApiUrl: null,
      awardPageUrl: null
    });

    const samFallbackQuery =
      summary.primarySolicitationId ||
      summary.primaryNoticeId ||
      summary.primaryPiid ||
      summary.primaryContractKey ||
      summary.title ||
      awardId ||
      null;
    const samSearchUrl =
      resolvePreferredSamEvidenceUrl(sourceEvidence) ||
      resolveSamPublicUrl({
        fallbackQuery: samFallbackQuery
      });

    if (!story) {
      return {
        storyKey: summary.storyKey,
        summary,
        bidders: [],
        actions: [],
        notices: [],
        spending: [],
        sourceEvidence,
        links: {
          canonicalPath,
          artemisStoryHref: summary.primaryPiid
            ? buildArtemisContractHref(summary.primaryPiid)
            : null,
          usaspendingUrl,
          samSearchUrl
        }
      };
    }

    const actions: ContractStoryAction[] = story.actions.map((action) => ({
      id: action.id,
      actionKey: action.actionKey,
      modNumber: action.modNumber,
      actionDate: action.actionDate,
      obligationDelta: finiteNumberOrNull(action.obligationDelta),
      obligationCumulative: finiteNumberOrNull(action.obligationCumulative),
      solicitationId: action.solicitationId,
      samNoticeId: action.samNoticeId,
      source: action.source,
      updatedAt: action.updatedAt,
      metadata: action.metadata || {}
    }));

    const notices: ContractStoryNotice[] = story.notices.map((notice) => ({
      id: notice.id,
      noticeId: notice.noticeId,
      solicitationId: notice.solicitationId,
      title: notice.title,
      postedDate: notice.postedDate,
      responseDeadline: notice.responseDeadline,
      awardeeName: notice.awardeeName,
      awardAmount: finiteNumberOrNull(notice.awardAmount),
      noticeUrl: notice.noticeUrl,
      updatedAt: notice.updatedAt,
      metadata: notice.metadata || {}
    }));

    const spending: ContractStorySpendingPoint[] = story.spending.map((point) => ({
      id: point.id,
      fiscalYear: point.fiscalYear,
      fiscalMonth: point.fiscalMonth,
      obligations: finiteNumberOrNull(point.obligations),
      outlays: finiteNumberOrNull(point.outlays),
      source: point.source,
      updatedAt: point.updatedAt,
      metadata: point.metadata || {}
    }));

    const detailSummary: ContractStorySummary = {
      ...summary,
      hasFullStory: true,
      actionCount: actions.length,
      noticeCount: notices.length,
      spendingPointCount: spending.length,
      bidderCount: story.bidders.length,
      latestActionDate: latestDate(actions.map((row) => row.actionDate)),
      latestNoticeDate: latestDate(notices.map((row) => row.postedDate))
    };

    return {
      storyKey: summary.storyKey,
      summary: detailSummary,
      bidders: story.bidders,
      actions,
      notices,
      spending,
      sourceEvidence,
      links: {
        canonicalPath,
        artemisStoryHref: buildArtemisContractHref(story.piid),
        usaspendingUrl,
        samSearchUrl
      }
    };
  }
);

export function buildStoryLookupMapKey(seed: StoryLookupSeed) {
  return [
    normalizeText(seed.awardId) || '',
    normalizeText(seed.piid) || '',
    normalizeText(seed.contractKey) || '',
    normalizeText(seed.solicitationId) || '',
    normalizeText(seed.noticeId) || ''
  ].join('|');
}

async function fetchStoryRowByStoryKey(
  storyKey: string
): Promise<ContractStorySummary | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from('program_contract_story_links')
    .select(STORY_SELECT)
    .eq('story_key', storyKey)
    .maybeSingle();

  if (error) {
    if (isMissingStoryRelation(error.message)) return null;
    console.error('program contract story by key query error', error);
    return null;
  }

  const row = data as ProgramContractStoryLinkRow | null;
  return row ? mapStorySummary(row) : null;
}

async function fetchStoryRowsForSeeds(
  scope: ProgramContractStoryScope,
  seeds: StoryLookupSeed[]
) {
  if (!isSupabaseConfigured()) return [] as ContractStorySummary[];

  const normalizedScope = normalizeScope(scope);
  if (!normalizedScope) return [] as ContractStorySummary[];

  const awardIds = uniqueNonEmptyStrings(seeds.map((seed) => seed.awardId));
  const piids = uniqueNonEmptyStrings(seeds.map((seed) => seed.piid));
  const contractKeys = uniqueNonEmptyStrings(seeds.map((seed) => seed.contractKey));
  const solicitationIds = uniqueNonEmptyStrings(
    seeds.map((seed) => seed.solicitationId)
  );
  const noticeIds = uniqueNonEmptyStrings(seeds.map((seed) => seed.noticeId));

  const supabase = createSupabasePublicClient();
  const rows = [] as ContractStorySummary[];
  const seen = new Set<string>();

  const queryByColumn = async (column: string, values: string[]) => {
    for (const chunk of chunkArray(values, STORY_QUERY_BATCH)) {
      const { data, error } = await supabase
        .from('program_contract_story_links')
        .select(STORY_SELECT)
        .eq('program_scope', normalizedScope)
        .in(column, chunk)
        .order('updated_at', { ascending: false, nullsFirst: false })
        .limit(Math.max(200, chunk.length * 4));

      if (error) {
        if (isMissingStoryRelation(error.message)) return;
        console.error('program contract story summary query error', {
          scope: normalizedScope,
          column,
          error
        });
        return;
      }

      for (const row of (data || []) as ProgramContractStoryLinkRow[]) {
        const summary = mapStorySummary(row);
        if (seen.has(summary.storyKey)) continue;
        seen.add(summary.storyKey);
        rows.push(summary);
      }
    }
  };

  await Promise.all([
    queryByColumn('primary_usaspending_award_id', awardIds),
    queryByColumn('primary_piid', piids),
    queryByColumn('primary_contract_key', contractKeys),
    queryByColumn('primary_solicitation_id', solicitationIds),
    queryByColumn('primary_notice_id', noticeIds)
  ]);

  return rows;
}

function resolveBestStoryMatch(
  seed: StoryLookupSeed,
  summaries: ContractStorySummary[]
): ContractStorySummary | null {
  const normalized = normalizeStoryLookupSeed(seed);

  let best: { score: number; summary: ContractStorySummary } | null = null;

  for (const summary of summaries) {
    let score = 0;

    if (
      normalized.awardId &&
      summary.primaryUsaspendingAwardId &&
      normalized.awardId === normalizeText(summary.primaryUsaspendingAwardId)
    ) {
      score += 100;
    }

    if (
      normalized.piid &&
      summary.primaryPiid &&
      normalized.piid === normalizeText(summary.primaryPiid)
    ) {
      score += 80;
    }

    if (
      normalized.contractKey &&
      summary.primaryContractKey &&
      normalized.contractKey === normalizeText(summary.primaryContractKey)
    ) {
      score += 60;
    }

    if (
      normalized.solicitationId &&
      summary.primarySolicitationId &&
      normalized.solicitationId === normalizeText(summary.primarySolicitationId)
    ) {
      score += 50;
    }

    if (
      normalized.noticeId &&
      summary.primaryNoticeId &&
      normalized.noticeId === normalizeText(summary.primaryNoticeId)
    ) {
      score += 40;
    }

    if (score < 1) continue;

    score += Math.round(summary.matchConfidence * 10);

    if (!best || score > best.score) {
      best = { score, summary };
    }
  }

  return best?.summary || null;
}

function normalizeStoryLookupSeed(seed: StoryLookupSeed): StoryLookupSeed {
  const metadata = toRecord(seed.metadata);
  const normalizedContractKey = normalizeText(seed.contractKey);
  const normalizedSourceUrl = normalizeText(seed.sourceUrl);
  const awardFromSeed = normalizeText(seed.awardId);
  const awardFromResolver = resolveArtemisAwardIdFromContractSeed({
    contractKey: seed.contractKey || '',
    sourceUrl: seed.sourceUrl,
    metadata
  });

  return {
    awardId: awardFromSeed || normalizeText(awardFromResolver),
    piid:
      normalizeText(seed.piid) ||
      normalizeText(readString(metadata, 'piid')) ||
      normalizeText(readString(metadata, 'awardId')) ||
      null,
    contractKey:
      normalizedContractKey ||
      normalizeText(readString(metadata, 'contractKey')) ||
      null,
    solicitationId:
      normalizeText(seed.solicitationId) ||
      normalizeText(readString(metadata, 'solicitationId')) ||
      normalizeText(readString(metadata, 'solicitation_id')) ||
      null,
    noticeId:
      normalizeText(seed.noticeId) ||
      normalizeText(readString(metadata, 'noticeId')) ||
      normalizeText(readString(metadata, 'notice_id')) ||
      null,
    sourceUrl: normalizedSourceUrl,
    metadata
  };
}

function mapStorySummary(row: ProgramContractStoryLinkRow): ContractStorySummary {
  return {
    storyKey: row.story_key,
    programScope: normalizeScope(row.program_scope) || 'artemis',
    matchStrategy: normalizeMatchStrategy(row.match_strategy),
    matchConfidence: clampMatchConfidence(row.match_confidence),
    hasFullStory: Boolean(row.has_full_story),
    primaryUsaspendingAwardId: row.primary_usaspending_award_id,
    primaryPiid: row.primary_piid,
    primaryContractKey: row.primary_contract_key,
    primarySolicitationId: row.primary_solicitation_id,
    primaryNoticeId: row.primary_notice_id,
    missionKey: row.mission_key,
    recipient: row.recipient,
    title: row.title,
    awardedOn: row.awarded_on,
    obligatedAmount: finiteNumberOrNull(row.obligated_amount),
    actionCount: clampNonNegativeInt(row.action_count),
    noticeCount: clampNonNegativeInt(row.notice_count),
    spendingPointCount: clampNonNegativeInt(row.spending_point_count),
    bidderCount: clampNonNegativeInt(row.bidder_count),
    latestActionDate: row.latest_action_date,
    latestNoticeDate: row.latest_notice_date,
    latestSpendingFiscalYear: finiteIntOrNull(row.latest_spending_fiscal_year),
    latestSpendingFiscalMonth: finiteIntOrNull(row.latest_spending_fiscal_month),
    matchEvidence: toRecord(row.match_evidence)
  };
}

function parseScopeFromStoryKey(storyKey: string): ProgramContractStoryScope | null {
  const prefix = normalizeText(storyKey.split('|')[0] || null);
  return normalizeScope(prefix);
}

function parseIdentifierFromStoryKey(storyKey: string) {
  const parts = storyKey.split('|');
  if (parts.length < 2) return null;
  return normalizeText(parts.slice(1).join('|'));
}

function parseAwardIdFromStoryKey(storyKey: string) {
  const token = parseIdentifierFromStoryKey(storyKey);
  if (!token) return null;
  if (token.startsWith('usaspending-')) return normalizeText(token.slice('usaspending-'.length));
  return token;
}

function normalizeScope(value: string | null | undefined): ProgramContractStoryScope | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (normalized === 'artemis') return 'artemis';
  if (normalized === 'spacex' || normalized === 'space-x') return 'spacex';
  if (normalized === 'blue-origin' || normalized === 'blueorigin' || normalized === 'blue_origin') return 'blue-origin';
  return null;
}

function normalizeMatchStrategy(value: string | null | undefined): ContractStoryMatchStrategy {
  const normalized = normalizeText(value);
  if (normalized === 'exact_award_id') return 'exact_award_id';
  if (normalized === 'exact_piid') return 'exact_piid';
  if (normalized === 'exact_solicitation') return 'exact_solicitation';
  return 'heuristic_multi_signal';
}

function clampMatchConfidence(value: unknown) {
  const numeric = finiteNumberOrNull(value);
  if (numeric == null) return 0;
  return Math.min(1, Math.max(0, numeric));
}

function latestDate(values: Array<string | null>) {
  let best: string | null = null;
  let bestMs = 0;
  for (const value of values) {
    const parsed = Date.parse(value || '');
    if (!Number.isFinite(parsed)) continue;
    if (!best || parsed > bestMs) {
      best = value;
      bestMs = parsed;
    }
  }
  return best;
}

function resolvePreferredSamEvidenceUrl(
  sourceEvidence: ContractStoryDetail['sourceEvidence']
) {
  for (const group of sourceEvidence) {
    if (group.sourceType !== 'sam-contract-award' && group.sourceType !== 'sam-opportunity') {
      continue;
    }

    for (const item of group.items) {
      const sourceUrl = normalizeSamPublicUrl(item.sourceUrl);
      if (!sourceUrl || isGenericSamSearchUrl(sourceUrl)) continue;
      return sourceUrl;
    }
  }

  return null;
}

function isGenericSamSearchUrl(value: string) {
  try {
    const parsed = new URL(value);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    return normalizedPath === '/search' || normalizedPath.startsWith('/search/');
  } catch {
    return false;
  }
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>) {
  const set = new Set<string>();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) set.add(normalized);
  }
  return [...set.values()];
}

function normalizeText(value: string | null | undefined) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {} as Record<string, unknown>;
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clampNonNegativeInt(value: unknown) {
  const numeric = finiteIntOrNull(value);
  if (numeric == null) return 0;
  return Math.max(0, numeric);
}

function finiteIntOrNull(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

function finiteNumberOrNull(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function isMissingStoryRelation(message: string | undefined) {
  const normalized = (message || '').toLowerCase();
  return normalized.includes('program_contract_story_links') && normalized.includes('does not exist');
}
