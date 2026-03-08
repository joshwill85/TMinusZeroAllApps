import { cache } from 'react';
import { fetchStarshipFlightIndex, fetchStarshipLaunchBuckets } from '@/lib/server/starship';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { buildStarshipFlightSlug, extractStarshipFlightNumber } from '@/lib/utils/starship';
import type { Launch } from '@/lib/types/launch';
import type {
  StarshipAudienceMode,
  StarshipEventEvidence,
  StarshipEvidenceSource,
  StarshipFlightIndexEntry,
  StarshipMissionProgressCard,
  StarshipTimelineConfidence,
  StarshipTimelineEvent,
  StarshipTimelineFacet,
  StarshipTimelineKpis,
  StarshipTimelineMission,
  StarshipTimelineMissionFilter,
  StarshipTimelineQuery,
  StarshipTimelineResponse,
  StarshipTimelineSourceFilter,
  StarshipTimelineSourceType,
  StarshipTimelineSupersedeReason,
  StarshipTimelineSupersedesLink
} from '@/lib/types/starship';

export const STARSHIP_TIMELINE_DEFAULT_LIMIT = 25;
export const STARSHIP_TIMELINE_MAX_LIMIT = 100;
const LAST_UPDATED_MAX_FUTURE_MS = 5 * 60 * 1000;

const SPACEX_STARSHIP_URL = 'https://www.spacex.com/vehicles/starship/';

type TimelineDataset = {
  generatedAt: string;
  events: StarshipTimelineEvent[];
  evidenceById: Record<string, StarshipEventEvidence>;
  missionProgress: StarshipMissionProgressCard[];
};

type TimelineRecord = {
  event: StarshipTimelineEvent;
  evidence: StarshipEventEvidence;
};

type FallbackDefinition = {
  id: string;
  mission: StarshipTimelineMission;
  title: string;
  summary: string;
  date: string;
  kind: StarshipTimelineEvent['kind'];
  status: StarshipTimelineEvent['status'];
  sourceType: StarshipTimelineSourceType;
  sourceLabel: string;
  sourceHref?: string;
  confidence: StarshipTimelineConfidence;
  supersedes?: StarshipTimelineSupersedesLink[];
  supersededBy?: StarshipTimelineSupersedesLink | null;
  evidenceSources: StarshipEvidenceSource[];
  payload: Record<string, unknown>;
};

const FALLBACK_TIMELINE_EVENTS: FallbackDefinition[] = [
  {
    id: 'fallback:starship-program',
    mission: 'starship-program',
    title: 'Starship program tracking baseline',
    summary: 'Program-level fallback event used when launch-feed timelines are sparse.',
    date: '2023-04-20T00:00:00Z',
    kind: 'program-milestone',
    status: 'completed',
    sourceType: 'curated-fallback',
    sourceLabel: 'Program fallback baseline',
    sourceHref: SPACEX_STARSHIP_URL,
    confidence: 'low',
    evidenceSources: [
      {
        label: 'SpaceX Starship overview',
        href: SPACEX_STARSHIP_URL,
        note: 'Fallback program reference when feed events are unavailable.'
      }
    ],
    payload: {
      category: 'fallback-milestone',
      mission: 'Starship Program',
      milestone: 'tracking-baseline'
    }
  }
];

const buildTimelineDataset = cache(async (): Promise<TimelineDataset> => {
  const [buckets, flightIndex] = await Promise.all([fetchStarshipLaunchBuckets(), fetchStarshipFlightIndex()]);
  const nowMs = Date.now();
  const dedupedLaunches = dedupeById([...buckets.upcoming, ...buckets.recent]);
  const launchRecords = dedupedLaunches.map((launch) => buildLaunchRecord({ launch, generatedAt: buckets.generatedAt, nowMs }));
  const fallbackRecords = FALLBACK_TIMELINE_EVENTS.map((definition) => buildFallbackRecord({ definition, generatedAt: buckets.generatedAt }));
  const allRecords = [...fallbackRecords, ...launchRecords];

  const events = allRecords.map((record) => normalizeEvent(record.event)).sort(compareEventsAscending);
  const evidenceById = Object.fromEntries(allRecords.map((record) => [record.event.id, record.evidence]));
  const missionProgress = buildMissionProgressCards({ events, flightIndex });

  return {
    generatedAt: buckets.generatedAt,
    events,
    evidenceById,
    missionProgress
  };
});

export async function fetchStarshipTimelineViewModel(query: StarshipTimelineQuery): Promise<StarshipTimelineResponse> {
  const dataset = await buildTimelineDataset();
  const effectiveMission = resolveEffectiveMissionFilter(query.mode, query.mission, dataset.events);
  const cursorOffset = decodeCursor(query.cursor);
  const limit = clampInt(query.limit, STARSHIP_TIMELINE_DEFAULT_LIMIT, 1, STARSHIP_TIMELINE_MAX_LIMIT);

  const baseFiltered = dataset.events
    .filter((event) => (query.includeSuperseded ? true : event.status !== 'superseded'))
    .filter((event) => (query.from ? event.date >= query.from : true))
    .filter((event) => (query.to ? event.date <= query.to : true));

  const facets = buildTimelineFacets({
    events: baseFiltered,
    missionFilter: effectiveMission,
    sourceTypeFilter: query.sourceType
  });

  const fullyFiltered = baseFiltered
    .filter((event) => (effectiveMission === 'all' ? true : event.mission === effectiveMission))
    .filter((event) => (query.sourceType === 'all' ? true : event.source.type === query.sourceType))
    .sort(compareEventsAscending);

  const pagedEvents = fullyFiltered.slice(cursorOffset, cursorOffset + limit);
  const nextCursor = cursorOffset + pagedEvents.length < fullyFiltered.length ? encodeCursor(cursorOffset + pagedEvents.length) : null;
  const kpis = buildKpis(fullyFiltered);
  const missionProgress =
    effectiveMission === 'all'
      ? dataset.missionProgress
      : dataset.missionProgress.filter((card) => card.mission === effectiveMission);

  return {
    generatedAt: dataset.generatedAt,
    mode: query.mode,
    mission: effectiveMission,
    sourceType: query.sourceType,
    includeSuperseded: query.includeSuperseded,
    from: query.from,
    to: query.to,
    events: pagedEvents,
    facets,
    kpis,
    missionProgress,
    nextCursor
  };
}

export async function fetchStarshipEventEvidence(eventId: string) {
  const dataset = await buildTimelineDataset();
  return dataset.evidenceById[eventId] || null;
}

export function parseStarshipAudienceMode(value: string | null): StarshipAudienceMode | null {
  if (!value) return 'quick';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'quick' || normalized === 'summary' || normalized === 'overview') return 'quick';
  if (normalized === 'explorer' || normalized === 'explore' || normalized === 'flight') return 'explorer';
  if (normalized === 'technical' || normalized === 'detail' || normalized === 'deep') return 'technical';
  return null;
}

export function parseStarshipMissionFilter(value: string | null): StarshipTimelineMissionFilter | null {
  if (!value) return 'all';
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '').replace(/_/g, '-');
  if (normalized === 'all') return 'all';
  if (normalized === 'starship' || normalized === 'starship-program' || normalized === 'program') return 'starship-program';

  const directFlight = normalized.match(/^flight-(\d{1,3})$/);
  if (directFlight?.[1]) {
    return buildStarshipFlightSlug(Number(directFlight[1]));
  }

  const ift = normalized.match(/^ift-?(\d{1,3})$/);
  if (ift?.[1]) {
    return buildStarshipFlightSlug(Number(ift[1]));
  }

  const numberOnly = normalized.match(/^(\d{1,3})$/);
  if (numberOnly?.[1]) {
    return buildStarshipFlightSlug(Number(numberOnly[1]));
  }

  return null;
}

export function parseStarshipSourceFilter(value: string | null): StarshipTimelineSourceFilter | null {
  if (!value) return 'all';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'all') return 'all';
  if (normalized === 'll2-cache' || normalized === 'll2' || normalized === 'launch-library-2') return 'll2-cache';
  if (normalized === 'spacex-official' || normalized === 'spacex') return 'spacex-official';
  if (normalized === 'curated-fallback' || normalized === 'fallback') return 'curated-fallback';
  return null;
}

export function parseBooleanParam(value: string | null, fallback: boolean): boolean | null {
  if (value == null || value === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  return null;
}

export function parseIsoDateParam(value: string | null): string | null | 'invalid' {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'invalid';
  return date.toISOString();
}

export function parseTimelineLimit(value: string | null) {
  if (value == null || value === '') return STARSHIP_TIMELINE_DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return clampInt(parsed, STARSHIP_TIMELINE_DEFAULT_LIMIT, 1, STARSHIP_TIMELINE_MAX_LIMIT);
}

export function parseTimelineCursor(value: string | null) {
  if (!value) return null;
  if (!/^\d+$/.test(value)) return null;
  return value;
}

function buildFallbackRecord({ definition, generatedAt }: { definition: FallbackDefinition; generatedAt: string }): TimelineRecord {
  const event: StarshipTimelineEvent = {
    id: definition.id,
    mission: definition.mission,
    title: definition.title,
    summary: definition.summary,
    date: definition.date,
    kind: definition.kind,
    status: definition.status,
    source: {
      type: definition.sourceType,
      label: definition.sourceLabel,
      href: definition.sourceHref,
      lastVerifiedAt: generatedAt
    },
    confidence: definition.confidence,
    supersedes: definition.supersedes ? [...definition.supersedes] : [],
    supersededBy: definition.supersededBy ?? null,
    evidenceId: definition.id
  };

  const evidence: StarshipEventEvidence = {
    eventId: definition.id,
    mission: definition.mission,
    title: definition.title,
    summary: definition.summary,
    sourceType: definition.sourceType,
    confidence: definition.confidence,
    generatedAt,
    sources: definition.evidenceSources,
    payload: {
      ...definition.payload,
      source: {
        label: definition.sourceLabel,
        href: definition.sourceHref || SPACEX_STARSHIP_URL
      }
    }
  };

  return { event, evidence };
}

function buildLaunchRecord({ launch, generatedAt, nowMs }: { launch: Launch; generatedAt: string; nowMs: number }): TimelineRecord {
  const mission = inferMissionFromLaunch(launch);
  const sourceHref = launch.ll2Id ? `https://ll.thespacedevs.com/2.3.0/launch/${encodeURIComponent(launch.ll2Id)}/` : undefined;
  const status = deriveLaunchStatus(launch, nowMs);
  const confidence = deriveLaunchConfidence(launch);
  const summary = buildLaunchSummary(launch);
  const eventId = `launch:${launch.id}`;
  const sourceCapturedAt = toIsoOrNull(launch.cacheGeneratedAt) || toIsoOrNull(launch.lastUpdated) || generatedAt;
  const launchHref = buildLaunchHref(launch);
  const sources = buildLaunchEvidenceSources({ launch, sourceHref, sourceCapturedAt });

  const event: StarshipTimelineEvent = {
    id: eventId,
    mission,
    title: launch.name,
    summary,
    date: launch.net,
    endDate: launch.windowEnd || null,
    kind: 'launch',
    status,
    source: {
      type: 'll2-cache',
      label: 'Launch Library 2 cache',
      href: sourceHref,
      lastVerifiedAt: sourceCapturedAt
    },
    confidence,
    supersedes: [],
    supersededBy: null,
    evidenceId: eventId,
    launch
  };

  const evidence: StarshipEventEvidence = {
    eventId,
    mission,
    title: launch.name,
    summary,
    sourceType: 'll2-cache',
    confidence,
    generatedAt,
    sources,
    payload: {
      launch,
      launchHref,
      derived: {
        mission,
        status,
        confidence
      }
    }
  };

  return { event, evidence };
}

function buildLaunchEvidenceSources({
  launch,
  sourceHref,
  sourceCapturedAt
}: {
  launch: Launch;
  sourceHref?: string;
  sourceCapturedAt: string;
}) {
  const sources: StarshipEvidenceSource[] = [
    {
      label: 'Launch Library 2 launch record',
      href: sourceHref,
      capturedAt: sourceCapturedAt
    }
  ];

  if (launch.spacexXPostUrl) {
    sources.push({
      label: 'SpaceX mission post',
      href: launch.spacexXPostUrl,
      capturedAt: launch.spacexXPostCapturedAt || null
    });
  }

  for (const info of launch.launchInfoUrls || []) {
    const href = normalizeUrlCandidate(info?.url);
    if (!href) continue;
    sources.push({
      label: info?.title?.trim() || 'Launch information link',
      href,
      note: info?.source?.trim() || undefined
    });
    if (sources.length >= 6) break;
  }

  if (sources.length < 6) {
    for (const video of launch.launchVidUrls || []) {
      const href = normalizeUrlCandidate(video?.url);
      if (!href) continue;
      sources.push({
        label: video?.title?.trim() || 'Launch video link',
        href,
        note: video?.publisher?.trim() || video?.source?.trim() || undefined
      });
      if (sources.length >= 6) break;
    }
  }

  return sources;
}

function normalizeUrlCandidate(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function inferMissionFromLaunch(launch: Launch): StarshipTimelineMission {
  const flightNumber = extractStarshipFlightNumber(launch);
  if (flightNumber != null) {
    return buildStarshipFlightSlug(flightNumber);
  }
  return 'starship-program';
}

function deriveLaunchStatus(launch: Launch, nowMs: number): StarshipTimelineEvent['status'] {
  const netMs = Date.parse(launch.net);
  if (launch.status === 'scrubbed') return 'superseded';
  if (!Number.isNaN(netMs) && netMs < nowMs) return 'completed';
  if (launch.status === 'hold' || launch.netPrecision === 'tbd' || launch.netPrecision === 'day' || launch.netPrecision === 'month') {
    return 'tentative';
  }
  return 'upcoming';
}

function deriveLaunchConfidence(launch: Launch): StarshipTimelineConfidence {
  if (launch.netPrecision === 'tbd') return 'low';
  if (launch.netPrecision === 'day' || launch.netPrecision === 'month') return 'medium';
  if (launch.status === 'hold' || launch.status === 'scrubbed') return 'medium';
  return 'high';
}

function buildLaunchSummary(launch: Launch) {
  const status = launch.statusText?.trim() || launch.status || 'Unknown';
  return `${launch.provider} • ${launch.vehicle} • Status: ${status}`;
}

function buildMissionProgressCards({
  events,
  flightIndex
}: {
  events: StarshipTimelineEvent[];
  flightIndex: StarshipFlightIndexEntry[];
}) {
  const eventByMission = new Map<string, StarshipTimelineEvent[]>();
  for (const event of events) {
    const list = eventByMission.get(event.mission) || [];
    list.push(event);
    eventByMission.set(event.mission, list);
  }

  return flightIndex.slice(0, 8).map((entry) => {
    const missionEvents = [...(eventByMission.get(entry.flightSlug) || [])].sort(compareEventsAscending);
    const latestKnown = missionEvents[missionEvents.length - 1] || null;
    const nextUpcoming = missionEvents.find((event) => event.status === 'upcoming');

    const state: StarshipMissionProgressCard['state'] =
      entry.upcomingCount > 0 ? 'in-preparation' : entry.recentCount > 0 ? 'completed' : 'planned';

    return {
      mission: entry.flightSlug,
      label: entry.label,
      state,
      summary:
        nextUpcoming?.summary ||
        latestKnown?.summary ||
        `${entry.upcomingCount} upcoming and ${entry.recentCount} recent launch records tracked for ${entry.label}.`,
      targetDate: entry.nextLaunch?.net || latestKnown?.date || null,
      sourceType: latestKnown?.source.type || 'll2-cache',
      confidence: latestKnown?.confidence || deriveProgressConfidence(entry.nextLaunch),
      eventId: nextUpcoming?.id || latestKnown?.id || null
    } satisfies StarshipMissionProgressCard;
  });
}

function deriveProgressConfidence(launch: Launch | null): StarshipTimelineConfidence {
  if (!launch) return 'low';
  return deriveLaunchConfidence(launch);
}

function buildTimelineFacets({
  events,
  missionFilter,
  sourceTypeFilter
}: {
  events: StarshipTimelineEvent[];
  missionFilter: StarshipTimelineMissionFilter;
  sourceTypeFilter: StarshipTimelineSourceFilter;
}): StarshipTimelineFacet[] {
  const missionCounts = countBy(events, (event) => event.mission);
  const sourceTypeCounts = countBy(events, (event) => event.source.type);

  const missionKeys = Object.keys(missionCounts)
    .sort(compareMissionKey)
    .filter((key): key is StarshipTimelineMission => key === 'starship-program' || /^flight-\d+$/.test(key));

  const missionOptions = [
    { value: 'all', label: 'All flights', count: events.length, selected: missionFilter === 'all' },
    ...missionKeys.map((value) => ({
      value,
      label: value === 'starship-program' ? 'Program-level' : `Starship ${value.replace('-', ' ')}`,
      count: missionCounts[value] || 0,
      selected: missionFilter === value
    }))
  ];

  const sourceTypeOptions = [
    { value: 'all', label: 'All sources', count: events.length, selected: sourceTypeFilter === 'all' },
    ...(['ll2-cache', 'spacex-official', 'curated-fallback'] as const).map((value) => ({
      value,
      label:
        value === 'll2-cache'
          ? 'Launch Library 2 cache'
          : value === 'spacex-official'
            ? 'SpaceX official'
            : 'Curated fallback',
      count: sourceTypeCounts[value] || 0,
      selected: sourceTypeFilter === value
    }))
  ];

  return [
    {
      key: 'mission',
      label: 'Flight',
      options: missionOptions
    },
    {
      key: 'sourceType',
      label: 'Source',
      options: sourceTypeOptions
    }
  ];
}

function buildKpis(events: StarshipTimelineEvent[]): StarshipTimelineKpis {
  const completedEvents = events.filter((event) => event.status === 'completed').length;
  const upcomingEvents = events.filter((event) => event.status === 'upcoming').length;
  const tentativeEvents = events.filter((event) => event.status === 'tentative').length;
  const supersededEvents = events.filter((event) => event.status === 'superseded').length;
  const highConfidenceEvents = events.filter((event) => event.confidence === 'high').length;
  const lastUpdated = resolveLastUpdated(events);

  return {
    totalEvents: events.length,
    completedEvents,
    upcomingEvents,
    tentativeEvents,
    supersededEvents,
    highConfidenceEvents,
    lastUpdated
  };
}

function resolveEffectiveMissionFilter(
  mode: StarshipAudienceMode,
  mission: StarshipTimelineMissionFilter,
  events: StarshipTimelineEvent[]
): StarshipTimelineMissionFilter {
  if (mission !== 'all') return mission;
  if (mode === 'quick') return 'all';

  const flightEvents = events
    .filter((event) => /^flight-\d+$/.test(event.mission))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  return flightEvents[0]?.mission || 'starship-program';
}

function resolveLastUpdated(events: StarshipTimelineEvent[]) {
  const maxAllowedMs = Date.now() + LAST_UPDATED_MAX_FUTURE_MS;
  const candidates = events
    .map((event) => event.source.lastVerifiedAt || event.date)
    .map((value) => toIsoOrNull(value))
    .filter((value): value is string => {
      if (!value) return false;
      const parsedMs = Date.parse(value);
      return Number.isFinite(parsedMs) && parsedMs <= maxAllowedMs;
    });
  if (!candidates.length) return null;
  return candidates.reduce((latest, current) => (Date.parse(current) > Date.parse(latest) ? current : latest));
}

function compareEventsAscending(a: StarshipTimelineEvent, b: StarshipTimelineEvent) {
  const aMs = Date.parse(a.date);
  const bMs = Date.parse(b.date);
  const safeAMs = Number.isNaN(aMs) ? Number.MAX_SAFE_INTEGER : aMs;
  const safeBMs = Number.isNaN(bMs) ? Number.MAX_SAFE_INTEGER : bMs;
  if (safeAMs !== safeBMs) return safeAMs - safeBMs;
  return a.id.localeCompare(b.id);
}

function compareMissionKey(a: string, b: string) {
  if (a === 'starship-program') return 1;
  if (b === 'starship-program') return -1;

  const aMatch = a.match(/^flight-(\d+)$/);
  const bMatch = b.match(/^flight-(\d+)$/);
  if (aMatch?.[1] && bMatch?.[1]) {
    return Number(bMatch[1]) - Number(aMatch[1]);
  }
  return a.localeCompare(b);
}

function countBy<T, K extends string>(items: T[], resolver: (value: T) => K) {
  const out = {} as Record<K, number>;
  for (const item of items) {
    const key = resolver(item);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function dedupeById(launches: Launch[]) {
  const seen = new Set<string>();
  const deduped: Launch[] = [];
  for (const launch of launches) {
    if (seen.has(launch.id)) continue;
    seen.add(launch.id);
    deduped.push(launch);
  }
  return deduped;
}

function normalizeEvent(event: StarshipTimelineEvent): StarshipTimelineEvent {
  return {
    ...event,
    supersedes: event.supersedes || [],
    supersededBy: event.supersededBy ?? null
  };
}

function toIsoOrNull(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function clampInt(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  const truncated = Math.trunc(value);
  return Math.max(min, Math.min(max, truncated));
}

function decodeCursor(cursor: string | null) {
  if (!cursor) return 0;
  const parsed = Number(cursor);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function encodeCursor(value: number) {
  return String(Math.max(0, Math.trunc(value)));
}
