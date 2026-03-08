import { cache } from 'react';
import {
  buildArtemisContractHref,
  fetchArtemisContracts,
  fetchArtemisContractStoryByPiid,
  parseArtemisContractAwardId,
  resolveArtemisAwardIdFromContractSeed,
  type ArtemisContractStory,
  type ArtemisContractSummary
} from '@/lib/server/artemisContracts';
import { getArtemisMissionProfileDefault } from '@/lib/server/artemisMissionProfiles';
import {
  buildBlueOriginContractSlug,
  fetchBlueOriginContractDetailBySlug,
  fetchBlueOriginContracts
} from '@/lib/server/blueOriginContracts';
import { getBlueOriginMissionLabel } from '@/lib/server/blueOriginEntities';
import {
  buildStoryLookupMapKey,
  fetchContractStoryDetailByStoryKey,
  fetchContractStorySummariesByAwards,
  type ContractStoryLookupSeed
} from '@/lib/server/programContractStories';
import {
  buildSpaceXContractSlug,
  fetchSpaceXContractDetailBySlug,
  fetchSpaceXContracts
} from '@/lib/server/spacexProgram';
import type { ArtemisMissionHubKey } from '@/lib/types/artemis';
import { ARTEMIS_MISSION_HUB_KEYS } from '@/lib/types/artemis';
import type { BlueOriginContractDetail } from '@/lib/types/blueOrigin';
import type {
  ContractStoryDetail,
  ContractStorySummary
} from '@/lib/types/contractsStory';
import type { SpaceXContractDetail } from '@/lib/types/spacexProgram';
import { getSpaceXMissionLabel } from '@/lib/utils/spacexProgram';

export type CanonicalContractScope = 'spacex' | 'blue-origin' | 'artemis';

export type CanonicalContractStoryPreview = {
  storyKey: string;
  programScope: CanonicalContractScope;
  matchConfidence: number;
  hasFullStory: boolean;
  actionCount: number;
  noticeCount: number;
  spendingPointCount: number;
  bidderCount: number;
  primaryPiid: string | null;
  primaryUsaspendingAwardId: string | null;
};

export type CanonicalContractSummary = {
  uid: string;
  scope: CanonicalContractScope;
  title: string;
  description: string | null;
  contractKey: string;
  piid: string | null;
  usaspendingAwardId: string | null;
  missionKey: string | null;
  missionLabel: string;
  agency: string | null;
  customer: string | null;
  recipient: string | null;
  amount: number | null;
  awardedOn: string | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  status: string | null;
  updatedAt: string | null;
  canonicalPath: string;
  programPath: string;
  keywords: string[];
  story: CanonicalContractStoryPreview | null;
};

export type CanonicalContractSourcePayload =
  | { scope: 'spacex'; detail: SpaceXContractDetail }
  | { scope: 'blue-origin'; detail: BlueOriginContractDetail }
  | { scope: 'artemis'; story: ArtemisContractStory };

export type CanonicalContractDetail = {
  generatedAt: string;
  contract: CanonicalContractSummary;
  sourcePayload: CanonicalContractSourcePayload;
  storyDetail: ContractStoryDetail | null;
  actionsCount: number;
  noticesCount: number;
  spendingCount: number;
  biddersCount: number;
};

const ARTEMIS_CONTRACT_LIMIT = 1200;
const STORY_ACTION_LIMIT = 1400;
const STORY_NOTICE_LIMIT = 1000;
const STORY_SPENDING_LIMIT = 1400;
const CANONICAL_CONTRACT_SNAPSHOT_TTL_MS = 90_000;

type CanonicalContractsSnapshot = {
  builtAtMs: number;
  items: CanonicalContractSummary[];
  byUid: Map<string, CanonicalContractSummary>;
};

let canonicalContractsSnapshot: CanonicalContractsSnapshot | null = null;
let canonicalContractsSnapshotPromise: Promise<CanonicalContractsSnapshot> | null = null;

const withCache =
  typeof cache === 'function'
    ? cache
    : <T extends (...args: any[]) => any>(fn: T): T => fn;

export function normalizeCanonicalContractUid(value: string | null | undefined) {
  if (!value) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }
  const trimmed = decoded.trim().toLowerCase();
  if (!/^(spacex|blue-origin|artemis)--[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function buildCanonicalContractUid(scope: CanonicalContractScope, identifier: string) {
  const normalizedIdentifier = normalizeIdentifier(identifier) || 'contract';
  const suffix = shortHash(`${scope}:${identifier}`);
  return `${scope}--${normalizedIdentifier}-${suffix}`;
}

export function buildCanonicalContractHref(uid: string) {
  return `/contracts/${uid}`;
}

export function buildCanonicalContractHrefForSeed(input: {
  scope: CanonicalContractScope;
  contractKey: string;
  piid?: string | null;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const identifier = resolveCanonicalIdentifier(input);
  return buildCanonicalContractHref(buildCanonicalContractUid(input.scope, identifier));
}

async function buildCanonicalContractsIndex(): Promise<CanonicalContractSummary[]> {
  const [spaceXContracts, blueOriginContracts, artemisRows] = await Promise.all([
    fetchSpaceXContracts('all'),
    fetchBlueOriginContracts('all'),
    fetchArtemisContracts({ limit: ARTEMIS_CONTRACT_LIMIT })
  ]);

  const artemisContracts = dedupeArtemisByPiid(artemisRows);

  const spaceXSeeds = spaceXContracts.items.map((item) =>
    buildSeed({
      contractKey: item.contractKey,
      sourceUrl: item.sourceUrl,
      metadata: item.metadata,
      fallbackAwardId: null,
      fallbackPiid: null
    })
  );
  const blueOriginSeeds = blueOriginContracts.items.map((item) =>
    buildSeed({
      contractKey: item.contractKey,
      sourceUrl: item.sourceUrl,
      metadata: item.metadata,
      fallbackAwardId: null,
      fallbackPiid: null
    })
  );
  const artemisSeeds = artemisContracts.map((item) =>
    buildSeed({
      contractKey: item.contractKey,
      sourceUrl: null,
      metadata: item.metadata,
      fallbackAwardId: parseArtemisContractAwardId(item.contractKey),
      fallbackPiid: item.piid
    })
  );

  const [spaceXStories, blueOriginStories, artemisStories] = await Promise.all([
    fetchContractStorySummariesByAwards('spacex', spaceXSeeds),
    fetchContractStorySummariesByAwards('blue-origin', blueOriginSeeds),
    fetchContractStorySummariesByAwards('artemis', artemisSeeds)
  ]);

  const mappedSpaceX = spaceXContracts.items.map((item, index) => {
    const seed = spaceXSeeds[index];
    const story = getStoryForSeed(spaceXStories, seed);
    const awardId = normalizeText(seed.awardId) || normalizeText(story?.primaryUsaspendingAwardId);
    const uid = buildCanonicalContractUid('spacex', awardId || item.contractKey);
    const canonicalPath = buildCanonicalContractHref(uid);
    const programPath = `/spacex/contracts/${buildSpaceXContractSlug(item.contractKey)}`;
    const missionLabel = getSpaceXMissionLabel(item.missionKey);

    return {
      uid,
      scope: 'spacex',
      title: item.title,
      description: item.description,
      contractKey: item.contractKey,
      piid: normalizeText(story?.primaryPiid),
      usaspendingAwardId: awardId,
      missionKey: item.missionKey,
      missionLabel,
      agency: item.agency,
      customer: item.customer,
      recipient: normalizeText(story?.recipient),
      amount: finiteNumberOrNull(item.amount),
      awardedOn: normalizeDate(item.awardedOn),
      sourceUrl: normalizeText(item.sourceUrl),
      sourceLabel: normalizeText(item.sourceLabel),
      status: normalizeText(item.status),
      updatedAt: normalizeDateTime(item.updatedAt),
      canonicalPath,
      programPath,
      keywords: buildKeywords([
        item.title,
        item.contractKey,
        item.missionKey,
        missionLabel,
        item.agency,
        item.customer,
        awardId,
        story?.primaryPiid,
        story?.primarySolicitationId,
        story?.primaryNoticeId
      ]),
      story: toStoryPreview(story)
    } satisfies CanonicalContractSummary;
  });

  const mappedBlueOrigin = blueOriginContracts.items.map((item, index) => {
    const seed = blueOriginSeeds[index];
    const story = getStoryForSeed(blueOriginStories, seed);
    const awardId = normalizeText(seed.awardId) || normalizeText(story?.primaryUsaspendingAwardId);
    const uid = buildCanonicalContractUid('blue-origin', awardId || item.contractKey);
    const canonicalPath = buildCanonicalContractHref(uid);
    const programPath = `/blue-origin/contracts/${buildBlueOriginContractSlug(item.contractKey)}`;
    const missionLabel = getBlueOriginMissionLabel(item.missionKey);

    return {
      uid,
      scope: 'blue-origin',
      title: item.title,
      description: item.description,
      contractKey: item.contractKey,
      piid: normalizeText(story?.primaryPiid),
      usaspendingAwardId: awardId,
      missionKey: item.missionKey,
      missionLabel,
      agency: item.agency,
      customer: item.customer,
      recipient: normalizeText(story?.recipient),
      amount: finiteNumberOrNull(item.amount),
      awardedOn: normalizeDate(item.awardedOn),
      sourceUrl: normalizeText(item.sourceUrl),
      sourceLabel: normalizeText(item.sourceLabel),
      status: normalizeText(item.status),
      updatedAt: normalizeDateTime(item.updatedAt),
      canonicalPath,
      programPath,
      keywords: buildKeywords([
        item.title,
        item.contractKey,
        item.missionKey,
        missionLabel,
        item.agency,
        item.customer,
        awardId,
        story?.primaryPiid,
        story?.primarySolicitationId,
        story?.primaryNoticeId
      ]),
      story: toStoryPreview(story)
    } satisfies CanonicalContractSummary;
  });

  const mappedArtemis = artemisContracts.map((item, index) => {
    const seed = artemisSeeds[index];
    const story = getStoryForSeed(artemisStories, seed);
    const awardId = normalizeText(seed.awardId) || normalizeText(story?.primaryUsaspendingAwardId);
    const uid = buildCanonicalContractUid('artemis', item.piid || awardId || item.contractKey);
    const canonicalPath = buildCanonicalContractHref(uid);
    const programPath = buildArtemisContractHref(item.piid);
    const missionLabel = resolveArtemisMissionLabel(item.missionKey);
    const storyAwardId = normalizeText(story?.primaryUsaspendingAwardId);
    const sourceUrl = storyAwardId
      ? `https://www.usaspending.gov/search/?hash=${encodeURIComponent(storyAwardId)}`
      : null;

    return {
      uid,
      scope: 'artemis',
      title: item.description?.trim() || `${item.contractKey} contract story`,
      description: item.description,
      contractKey: item.contractKey,
      piid: item.piid,
      usaspendingAwardId: awardId,
      missionKey: item.missionKey,
      missionLabel,
      agency: item.agencyCode,
      customer: null,
      recipient: item.awardeeName,
      amount: finiteNumberOrNull(story?.obligatedAmount),
      awardedOn: normalizeDate(item.baseAwardDate) || normalizeDate(story?.awardedOn),
      sourceUrl,
      sourceLabel: sourceUrl ? 'USASpending award record' : 'SAM.gov normalized records',
      status: item.contractType,
      updatedAt: normalizeDateTime(item.updatedAt),
      canonicalPath,
      programPath,
      keywords: buildKeywords([
        item.contractKey,
        item.piid,
        item.missionKey,
        missionLabel,
        item.awardeeName,
        item.awardeeUei,
        item.agencyCode,
        item.subtierCode,
        awardId,
        story?.primarySolicitationId,
        story?.primaryNoticeId
      ]),
      story: toStoryPreview(story)
    } satisfies CanonicalContractSummary;
  });

  return dedupeCanonicalContracts([...mappedSpaceX, ...mappedBlueOrigin, ...mappedArtemis]).sort(sortContracts);
}

async function fetchCanonicalContractsSnapshot(): Promise<CanonicalContractsSnapshot> {
  const nowMs = Date.now();
  if (
    canonicalContractsSnapshot &&
    nowMs - canonicalContractsSnapshot.builtAtMs < CANONICAL_CONTRACT_SNAPSHOT_TTL_MS
  ) {
    return canonicalContractsSnapshot;
  }

  if (!canonicalContractsSnapshotPromise) {
    canonicalContractsSnapshotPromise = (async () => {
      const items = await buildCanonicalContractsIndex();
      const byUid = new Map(items.map((item) => [item.uid, item]));
      const snapshot = { builtAtMs: Date.now(), items, byUid };
      canonicalContractsSnapshot = snapshot;
      return snapshot;
    })().finally(() => {
      canonicalContractsSnapshotPromise = null;
    });
  }

  return canonicalContractsSnapshotPromise as Promise<CanonicalContractsSnapshot>;
}

export const fetchCanonicalContractsIndex = withCache(async (): Promise<CanonicalContractSummary[]> => {
  const snapshot = await fetchCanonicalContractsSnapshot();
  return buildContractsIndexRows(snapshot.items).sort(sortContractsForIndex);
});

export const fetchCanonicalContractDetailByUid = withCache(async (uidInput: string): Promise<CanonicalContractDetail | null> => {
  const uid = normalizeCanonicalContractUid(uidInput);
  if (!uid) return null;

  const snapshot = await fetchCanonicalContractsSnapshot();
  const summary = snapshot.byUid.get(uid) || null;
  if (!summary) return null;

  if (summary.scope === 'spacex') {
    const slug = buildSpaceXContractSlug(summary.contractKey);
    const detail = await fetchSpaceXContractDetailBySlug(slug);
    if (!detail) return null;

    const refreshed = {
      ...summary,
      title: detail.contract.title,
      description: detail.contract.description,
      agency: detail.contract.agency,
      customer: detail.contract.customer,
      amount: finiteNumberOrNull(detail.contract.amount),
      awardedOn: normalizeDate(detail.contract.awardedOn),
      sourceUrl: normalizeText(detail.contract.sourceUrl),
      sourceLabel: normalizeText(detail.contract.sourceLabel),
      status: normalizeText(detail.contract.status),
      updatedAt: normalizeDateTime(detail.contract.updatedAt),
      story: detail.story
        ? {
            storyKey: summary.story?.storyKey || `spacex:${summary.contractKey}`,
            programScope: 'spacex',
            matchConfidence: summary.story?.matchConfidence || 1,
            hasFullStory: true,
            actionCount: detail.story.actions.length,
            noticeCount: detail.story.notices.length,
            spendingPointCount: detail.story.spending.length,
            bidderCount: detail.story.bidders.length,
            primaryPiid: detail.story.piid,
            primaryUsaspendingAwardId: summary.usaspendingAwardId
          }
        : summary.story
    } satisfies CanonicalContractSummary;
    const storyDetail = refreshed.story?.storyKey
      ? await fetchContractStoryDetailByStoryKey(refreshed.story.storyKey)
      : null;

    return {
      generatedAt: new Date().toISOString(),
      contract: refreshed,
      sourcePayload: { scope: 'spacex', detail },
      storyDetail,
      actionsCount: detail.actions.length,
      noticesCount: detail.notices?.length ?? detail.story?.notices.length ?? 0,
      spendingCount: detail.spending.length,
      biddersCount: detail.story?.bidders.length ?? 0
    };
  }

  if (summary.scope === 'blue-origin') {
    const slug = buildBlueOriginContractSlug(summary.contractKey);
    const detail = await fetchBlueOriginContractDetailBySlug(slug);
    if (!detail) return null;

    const refreshed = {
      ...summary,
      title: detail.contract.title,
      description: detail.contract.description,
      agency: detail.contract.agency,
      customer: detail.contract.customer,
      amount: finiteNumberOrNull(detail.contract.amount),
      awardedOn: normalizeDate(detail.contract.awardedOn),
      sourceUrl: normalizeText(detail.contract.sourceUrl),
      sourceLabel: normalizeText(detail.contract.sourceLabel),
      status: normalizeText(detail.contract.status),
      updatedAt: normalizeDateTime(detail.contract.updatedAt),
      story: detail.story
        ? {
            storyKey: summary.story?.storyKey || `blue-origin:${summary.contractKey}`,
            programScope: 'blue-origin',
            matchConfidence: summary.story?.matchConfidence || 1,
            hasFullStory: true,
            actionCount: detail.story.actions.length,
            noticeCount: detail.story.notices.length,
            spendingPointCount: detail.story.spending.length,
            bidderCount: detail.story.bidders.length,
            primaryPiid: detail.story.piid,
            primaryUsaspendingAwardId: summary.usaspendingAwardId
          }
        : summary.story
    } satisfies CanonicalContractSummary;
    const storyDetail = refreshed.story?.storyKey
      ? await fetchContractStoryDetailByStoryKey(refreshed.story.storyKey)
      : null;

    return {
      generatedAt: new Date().toISOString(),
      contract: refreshed,
      sourcePayload: { scope: 'blue-origin', detail },
      storyDetail,
      actionsCount: detail.actions.length,
      noticesCount: detail.notices.length,
      spendingCount: detail.spending.length,
      biddersCount: detail.story?.bidders.length ?? 0
    };
  }

  const piid = normalizeText(summary.piid);
  if (!piid) return null;

  const story = await fetchArtemisContractStoryByPiid(piid, {
    contractLimit: ARTEMIS_CONTRACT_LIMIT,
    actionLimit: STORY_ACTION_LIMIT,
    noticeLimit: STORY_NOTICE_LIMIT,
    spendingLimit: STORY_SPENDING_LIMIT
  });
  if (!story) return null;

  const primary = story.members[0];
  const awardId = parseArtemisContractAwardId(primary?.contractKey || summary.contractKey) || summary.usaspendingAwardId;

  const refreshed = {
    ...summary,
    title: primary?.description?.trim() || summary.title,
    description: primary?.description || summary.description,
    contractKey: primary?.contractKey || summary.contractKey,
    recipient: primary?.awardeeName || summary.recipient,
    agency: primary?.agencyCode || summary.agency,
    status: primary?.contractType || summary.status,
    awardedOn: normalizeDate(primary?.baseAwardDate) || summary.awardedOn,
    piid: story.piid,
    usaspendingAwardId: awardId,
    updatedAt: normalizeDateTime(primary?.updatedAt) || summary.updatedAt,
    story: {
      storyKey: summary.story?.storyKey || `artemis:${story.piid}`,
      programScope: 'artemis',
      matchConfidence: summary.story?.matchConfidence || 1,
      hasFullStory: true,
      actionCount: story.actions.length,
      noticeCount: story.notices.length,
      spendingPointCount: story.spending.length,
      bidderCount: story.bidders.length,
      primaryPiid: story.piid,
      primaryUsaspendingAwardId: awardId
    }
  } satisfies CanonicalContractSummary;
  const storyDetail = refreshed.story?.storyKey
    ? await fetchContractStoryDetailByStoryKey(refreshed.story.storyKey)
    : null;

  return {
    generatedAt: new Date().toISOString(),
    contract: refreshed,
    sourcePayload: { scope: 'artemis', story },
    storyDetail,
    actionsCount: story.actions.length,
    noticesCount: story.notices.length,
    spendingCount: story.spending.length,
    biddersCount: story.bidders.length
  };
});

export function buildCanonicalContractSearchText(contract: CanonicalContractSummary) {
  return [
    contract.title,
    contract.description,
    contract.contractKey,
    contract.piid,
    contract.usaspendingAwardId,
    contract.missionKey,
    contract.missionLabel,
    contract.agency,
    contract.customer,
    contract.recipient,
    contract.status,
    contract.sourceLabel,
    contract.keywords.join(' ')
  ]
    .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
    .filter((value) => value.length > 0)
    .join(' ');
}

function resolveCanonicalIdentifier(input: {
  scope: CanonicalContractScope;
  contractKey: string;
  piid?: string | null;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const seedAwardId = resolveArtemisAwardIdFromContractSeed({
    contractKey: input.contractKey,
    sourceUrl: input.sourceUrl,
    metadata: input.metadata
  });
  const awardId = normalizeText(seedAwardId);

  if (input.scope === 'artemis') {
    return normalizeText(input.piid) || awardId || normalizeText(input.contractKey) || 'contract';
  }

  return awardId || normalizeText(input.contractKey) || 'contract';
}

function buildSeed(options: {
  contractKey: string;
  sourceUrl: string | null;
  metadata: Record<string, unknown> | null;
  fallbackAwardId: string | null;
  fallbackPiid: string | null;
}): ContractStoryLookupSeed {
  const awardId =
    normalizeText(
      resolveArtemisAwardIdFromContractSeed({
        contractKey: options.contractKey,
        sourceUrl: options.sourceUrl,
        metadata: options.metadata
      })
    ) || normalizeText(options.fallbackAwardId);

  return {
    awardId,
    piid: normalizeText(options.fallbackPiid),
    contractKey: normalizeText(options.contractKey),
    sourceUrl: normalizeText(options.sourceUrl),
    metadata: options.metadata || {}
  };
}

function getStoryForSeed(
  map: Map<string, ContractStorySummary>,
  seed: ContractStoryLookupSeed
): ContractStorySummary | null {
  const key = buildStoryLookupMapKey(seed);
  if (!key) return null;
  return map.get(key) || null;
}

function toStoryPreview(story: ContractStorySummary | null): CanonicalContractStoryPreview | null {
  if (!story) return null;
  return {
    storyKey: story.storyKey,
    programScope: story.programScope,
    matchConfidence: finiteNumberOrNull(story.matchConfidence) || 0,
    hasFullStory: Boolean(story.hasFullStory),
    actionCount: clampCount(story.actionCount),
    noticeCount: clampCount(story.noticeCount),
    spendingPointCount: clampCount(story.spendingPointCount),
    bidderCount: clampCount(story.bidderCount),
    primaryPiid: normalizeText(story.primaryPiid),
    primaryUsaspendingAwardId: normalizeText(story.primaryUsaspendingAwardId)
  };
}

function dedupeArtemisByPiid(rows: ArtemisContractSummary[]) {
  const map = new Map<string, ArtemisContractSummary>();
  for (const row of rows) {
    const piid = normalizeText(row.piid);
    if (!piid) continue;
    const current = map.get(piid);
    if (!current) {
      map.set(piid, row);
      continue;
    }

    const currentDate = resolveSortDate(current.baseAwardDate, current.updatedAt);
    const nextDate = resolveSortDate(row.baseAwardDate, row.updatedAt);
    if (nextDate >= currentDate) {
      map.set(piid, row);
    }
  }

  return [...map.values()];
}

function dedupeCanonicalContracts(rows: CanonicalContractSummary[]) {
  const map = new Map<string, CanonicalContractSummary>();

  for (const row of rows) {
    const existing = map.get(row.uid);
    if (!existing) {
      map.set(row.uid, row);
      continue;
    }

    const existingDate = resolveSortDate(existing.awardedOn, existing.updatedAt);
    const nextDate = resolveSortDate(row.awardedOn, row.updatedAt);

    if (nextDate > existingDate) {
      map.set(row.uid, mergeContracts(existing, row));
      continue;
    }

    map.set(row.uid, mergeContracts(row, existing));
  }

  return [...map.values()];
}

function dedupeExactStoryContracts(rows: CanonicalContractSummary[]) {
  const map = new Map<string, CanonicalContractSummary>();

  for (const row of rows) {
    const storyKey = normalizeText(row.story?.storyKey);
    if (!storyKey) continue;

    const existing = map.get(storyKey);
    if (!existing) {
      map.set(storyKey, row);
      continue;
    }

    const existingDate = resolveSortDate(existing.awardedOn, existing.updatedAt);
    const nextDate = resolveSortDate(row.awardedOn, row.updatedAt);

    if (nextDate > existingDate) {
      map.set(storyKey, mergeContracts(row, existing));
      continue;
    }

    map.set(storyKey, mergeContracts(existing, row));
  }

  return [...map.values()];
}

function buildContractsIndexRows(rows: CanonicalContractSummary[]) {
  const exactRows = dedupeExactStoryContracts(
    rows.filter((row) => Boolean(normalizeText(row.story?.storyKey)))
  );
  const pendingRows = dedupeCanonicalContracts(
    rows.filter((row) => !normalizeText(row.story?.storyKey))
  );

  return [...exactRows, ...pendingRows];
}

function mergeContracts(primary: CanonicalContractSummary, secondary: CanonicalContractSummary): CanonicalContractSummary {
  const keywordSet = new Set<string>();
  for (const keyword of primary.keywords.concat(secondary.keywords)) {
    const normalized = normalizeText(keyword);
    if (normalized) keywordSet.add(normalized);
  }

  return {
    ...secondary,
    ...primary,
    keywords: [...keywordSet],
    story: primary.story || secondary.story,
    piid: primary.piid || secondary.piid,
    usaspendingAwardId: primary.usaspendingAwardId || secondary.usaspendingAwardId,
    sourceUrl: primary.sourceUrl || secondary.sourceUrl,
    sourceLabel: primary.sourceLabel || secondary.sourceLabel,
    amount: finiteNumberOrNull(primary.amount) ?? finiteNumberOrNull(secondary.amount)
  };
}

function sortContracts(a: CanonicalContractSummary, b: CanonicalContractSummary) {
  const aDate = resolveSortDate(a.awardedOn, a.updatedAt);
  const bDate = resolveSortDate(b.awardedOn, b.updatedAt);
  if (aDate !== bDate) return bDate - aDate;

  if (a.scope !== b.scope) return a.scope.localeCompare(b.scope);

  return a.title.localeCompare(b.title);
}

function sortContractsForIndex(a: CanonicalContractSummary, b: CanonicalContractSummary) {
  const leftExact = Boolean(normalizeText(a.story?.storyKey));
  const rightExact = Boolean(normalizeText(b.story?.storyKey));
  if (leftExact !== rightExact) return leftExact ? -1 : 1;
  return sortContracts(a, b);
}

function resolveArtemisMissionLabel(missionKey: string | null) {
  if (!missionKey) return 'Artemis Program';

  const normalized = normalizeText(missionKey);
  if (!normalized) return 'Artemis Program';

  const isArtemisMission = (value: string): value is ArtemisMissionHubKey => {
    return (ARTEMIS_MISSION_HUB_KEYS as readonly string[]).includes(value);
  };

  return isArtemisMission(normalized)
    ? getArtemisMissionProfileDefault(normalized).shortLabel
    : missionKey;
}

function resolveSortDate(primaryDate: string | null | undefined, fallbackDate: string | null | undefined) {
  const primaryMs = primaryDate ? Date.parse(primaryDate) : Number.NaN;
  if (Number.isFinite(primaryMs)) return primaryMs;

  const fallbackMs = fallbackDate ? Date.parse(fallbackDate) : Number.NaN;
  if (Number.isFinite(fallbackMs)) return fallbackMs;

  return 0;
}

function buildKeywords(values: Array<string | null | undefined>) {
  const out = new Set<string>();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    out.add(normalized);
  }
  return [...out.values()];
}

function shortHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function normalizeIdentifier(value: string) {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDate(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function normalizeDateTime(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function finiteNumberOrNull(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clampCount(value: unknown) {
  const numeric = finiteNumberOrNull(value);
  if (numeric == null) return 0;
  return Math.max(0, Math.trunc(numeric));
}
