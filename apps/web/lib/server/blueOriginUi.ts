import { cache } from 'react';
import { fetchBlueOriginFlightIndex, fetchBlueOriginLaunchBuckets } from '@/lib/server/blueOrigin';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import {
  extractBlueOriginFlightCode,
  extractBlueOriginFlightCodeFromText,
  getBlueOriginMissionKeyFromLaunch,
  type BlueOriginMissionKey
} from '@/lib/utils/blueOrigin';
import type { Launch } from '@/lib/types/launch';
import type {
  BlueOriginAudienceMode,
  BlueOriginEventEvidence,
  BlueOriginEvidenceSource,
  BlueOriginMissionProgressCard,
  BlueOriginTimelineConfidence,
  BlueOriginTimelineEvent,
  BlueOriginTimelineFacet,
  BlueOriginTimelineKpis,
  BlueOriginTimelineMission,
  BlueOriginTimelineMissionFilter,
  BlueOriginTimelineQuery,
  BlueOriginTimelineResponse,
  BlueOriginTimelineSourceFilter,
  BlueOriginTimelineSourceType,
  BlueOriginTimelineSupersedesLink
} from '@/lib/types/blueOrigin';

export const BLUE_ORIGIN_TIMELINE_DEFAULT_LIMIT = 25;
export const BLUE_ORIGIN_TIMELINE_MAX_LIMIT = 100;
const LAST_UPDATED_MAX_FUTURE_MS = 5 * 60 * 1000;

const BLUE_ORIGIN_ROOT_URL = 'https://www.blueorigin.com';
const BLUE_ORIGIN_MISSIONS_URL = 'https://www.blueorigin.com/missions';
const BLUE_ORIGIN_NEWS_URL = 'https://www.blueorigin.com/news';

const BLUE_ORIGIN_MISSION_KEYS: BlueOriginMissionKey[] = [
  'blue-origin-program',
  'new-shepard',
  'new-glenn',
  'blue-moon',
  'blue-ring',
  'be-4'
];

const MISSION_LABELS: Record<BlueOriginMissionKey, string> = {
  'blue-origin-program': 'Program',
  'new-shepard': 'New Shepard',
  'new-glenn': 'New Glenn',
  'blue-moon': 'Blue Moon',
  'blue-ring': 'Blue Ring',
  'be-4': 'BE-4'
};

type TimelineDataset = {
  generatedAt: string;
  events: BlueOriginTimelineEvent[];
  evidenceById: Record<string, BlueOriginEventEvidence>;
  missionProgress: BlueOriginMissionProgressCard[];
};

type TimelineRecord = {
  event: BlueOriginTimelineEvent;
  evidence: BlueOriginEventEvidence;
};

type FallbackDefinition = {
  id: string;
  mission: BlueOriginTimelineMission;
  title: string;
  summary: string;
  date: string;
  kind: BlueOriginTimelineEvent['kind'];
  status: BlueOriginTimelineEvent['status'];
  sourceType: BlueOriginTimelineSourceType;
  sourceLabel: string;
  sourceHref?: string;
  confidence: BlueOriginTimelineConfidence;
  supersedes?: BlueOriginTimelineSupersedesLink[];
  supersededBy?: BlueOriginTimelineSupersedesLink | null;
  evidenceSources: BlueOriginEvidenceSource[];
  payload: Record<string, unknown>;
};

const FALLBACK_TIMELINE_EVENTS: FallbackDefinition[] = [
  {
    id: 'fallback:ng-1-launch',
    mission: 'new-glenn',
    title: 'New Glenn NG-1 launch',
    summary: 'Blue Origin launched New Glenn on its first orbital mission from Cape Canaveral.',
    date: '2025-01-16T00:00:00Z',
    kind: 'launch',
    status: 'completed',
    sourceType: 'blue-origin-official',
    sourceLabel: 'Blue Origin mission page',
    sourceHref: 'https://www.blueorigin.com/missions/ng-1',
    confidence: 'high',
    evidenceSources: [
      {
        label: 'NG-1 mission page',
        href: 'https://www.blueorigin.com/missions/ng-1',
        note: 'Official Blue Origin mission summary.'
      }
    ],
    payload: { category: 'mission-milestone', mission: 'new-glenn', event: 'ng-1' }
  },
  {
    id: 'fallback:ng-2-launch',
    mission: 'new-glenn',
    title: 'New Glenn NG-2 launch',
    summary: 'Blue Origin completed its second New Glenn mission and expanded cadence toward follow-on flights.',
    date: '2025-11-13T00:00:00Z',
    kind: 'launch',
    status: 'completed',
    sourceType: 'blue-origin-official',
    sourceLabel: 'Blue Origin mission page',
    sourceHref: 'https://www.blueorigin.com/missions/ng-2',
    confidence: 'high',
    evidenceSources: [
      {
        label: 'NG-2 mission page',
        href: 'https://www.blueorigin.com/missions/ng-2',
        note: 'Official Blue Origin mission summary.'
      },
      {
        label: 'Launch Library 2 launch record',
        href: 'https://ll.thespacedevs.com/2.3.0/launches/9c950919-5d11-4a79-a4f1-be7387678c0a/',
        note: 'Independent launch feed timestamp corroboration.'
      }
    ],
    payload: { category: 'mission-milestone', mission: 'new-glenn', event: 'ng-2' }
  },
  {
    id: 'fallback:ns-31-launch',
    mission: 'new-shepard',
    title: 'New Shepard NS-31 mission',
    summary: 'New Shepard NS-31 flew a crewed suborbital mission with Blue Origin passenger operations continuity.',
    date: '2025-04-14T00:00:00Z',
    kind: 'launch',
    status: 'completed',
    sourceType: 'blue-origin-official',
    sourceLabel: 'Blue Origin mission page',
    sourceHref: 'https://www.blueorigin.com/missions/ns-31',
    confidence: 'high',
    evidenceSources: [
      {
        label: 'NS-31 mission page',
        href: 'https://www.blueorigin.com/missions/ns-31',
        note: 'Official Blue Origin mission summary.'
      },
      {
        label: 'Launch Library 2 launch record',
        href: 'https://ll.thespacedevs.com/2.3.0/launches/08433f85-5ba3-470d-95ed-167e615e9e9a/',
        note: 'Independent launch feed timestamp corroboration.'
      }
    ],
    payload: { category: 'mission-milestone', mission: 'new-shepard', event: 'ns-31' }
  },
  {
    id: 'fallback:blue-moon-hls-award',
    mission: 'blue-moon',
    title: 'NASA selects Blue Origin as second Artemis lunar lander provider',
    summary: 'NASA selected Blue Origin for a crewed lunar lander demonstration mission under Artemis.',
    date: '2023-05-19T00:00:00Z',
    kind: 'contract',
    status: 'completed',
    sourceType: 'government-record',
    sourceLabel: 'NASA press release',
    sourceHref: 'https://www.nasa.gov/news-release/nasa-selects-blue-origin-as-second-artemis-lunar-lander-provider/',
    confidence: 'high',
    evidenceSources: [
      {
        label: 'NASA award announcement',
        href: 'https://www.nasa.gov/news-release/nasa-selects-blue-origin-as-second-artemis-lunar-lander-provider/'
      }
    ],
    payload: { category: 'contract', mission: 'blue-moon', agency: 'NASA' }
  },
  {
    id: 'fallback:blue-moon-viper-award',
    mission: 'blue-moon',
    title: 'NASA selects Blue Origin to deliver VIPER rover to the Moon',
    summary: 'NASA selected Blue Origin to deliver the VIPER rover mission to the lunar south pole as part of Artemis logistics.',
    date: '2025-09-19T00:00:00Z',
    kind: 'contract',
    status: 'completed',
    sourceType: 'government-record',
    sourceLabel: 'NASA press release',
    sourceHref: 'https://www.nasa.gov/news-release/nasa-selects-blue-origin-to-deliver-viper-rover-to-moons-south-pole/',
    confidence: 'high',
    evidenceSources: [
      {
        label: 'NASA VIPER selection release',
        href: 'https://www.nasa.gov/news-release/nasa-selects-blue-origin-to-deliver-viper-rover-to-moons-south-pole/'
      }
    ],
    payload: { category: 'contract', mission: 'blue-moon', agency: 'NASA' }
  },
  {
    id: 'fallback:nssl-lane-1-award',
    mission: 'new-glenn',
    title: 'U.S. Space Force NSSL Lane 1 award includes Blue Origin',
    summary: 'Space Systems Command awarded National Security Space Launch Lane 1 contracts including Blue Origin.',
    date: '2024-06-13T00:00:00Z',
    kind: 'contract',
    status: 'completed',
    sourceType: 'government-record',
    sourceLabel: 'U.S. Space Force / SSC release',
    sourceHref:
      'https://www.ssc.spaceforce.mil/Portals/3/Documents/PRESS%20RELEASES/20240613%20SSC%20Awards%20Launch%20Service%20Contracts%20for%20NSSL%20Phase%203%20Lane%201.pdf',
    confidence: 'high',
    evidenceSources: [
      {
        label: 'USSF NSSL award release',
        href:
          'https://www.ssc.spaceforce.mil/Portals/3/Documents/PRESS%20RELEASES/20240613%20SSC%20Awards%20Launch%20Service%20Contracts%20for%20NSSL%20Phase%203%20Lane%201.pdf'
      },
      {
        label: 'U.S. Department of Defense contracts digest',
        href: 'https://www.defense.gov/News/Contracts/Contract/Article/3806586/',
        note: 'Independent government publication listing the Lane 1 awards.'
      }
    ],
    payload: { category: 'contract', mission: 'new-glenn', agency: 'USSF' }
  },
  {
    id: 'fallback:program-tracking-baseline',
    mission: 'blue-origin-program',
    title: 'Blue Origin program tracking baseline',
    summary: 'Program-level fallback event keeps timeline continuity when feed-derived events are sparse.',
    date: '2022-01-01T00:00:00Z',
    kind: 'program-milestone',
    status: 'completed',
    sourceType: 'curated-fallback',
    sourceLabel: 'Program baseline',
    sourceHref: BLUE_ORIGIN_MISSIONS_URL,
    confidence: 'low',
    evidenceSources: [
      {
        label: 'Blue Origin missions',
        href: BLUE_ORIGIN_MISSIONS_URL,
        note: 'Fallback baseline reference for program timeline continuity.'
      }
    ],
    payload: { category: 'fallback', mission: 'blue-origin-program' }
  }
];

const buildTimelineDataset = cache(async (): Promise<TimelineDataset> => {
  const [buckets, flightIndex] = await Promise.all([fetchBlueOriginLaunchBuckets(), fetchBlueOriginFlightIndex()]);
  const nowMs = Date.now();
  const dedupedLaunches = dedupeLaunchRows([...buckets.upcoming, ...buckets.recent]);
  const launchRecords = dedupedLaunches.map((launch) => buildLaunchRecord({ launch, generatedAt: buckets.generatedAt, nowMs }));
  const launchFlightCodes = new Set(dedupedLaunches.map((launch) => extractBlueOriginFlightCode(launch)).filter((value): value is string => Boolean(value)));
  const launchSemanticKeys = new Set(dedupedLaunches.map(buildLaunchSemanticKey));
  const fallbackRecords = FALLBACK_TIMELINE_EVENTS
    .map((definition) => buildFallbackRecord({ definition, generatedAt: buckets.generatedAt }))
    .filter((record) => !isDuplicateFallbackLaunchRecord(record, launchFlightCodes, launchSemanticKeys));
  const allRecords = dedupeTimelineRecords([...fallbackRecords, ...launchRecords]);

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

export async function fetchBlueOriginTimelineViewModel(query: BlueOriginTimelineQuery): Promise<BlueOriginTimelineResponse> {
  const dataset = await buildTimelineDataset();
  const effectiveMission = resolveEffectiveMissionFilter(query.mode, query.mission, dataset.events);
  const cursorOffset = decodeCursor(query.cursor);
  const limit = clampInt(query.limit, BLUE_ORIGIN_TIMELINE_DEFAULT_LIMIT, 1, BLUE_ORIGIN_TIMELINE_MAX_LIMIT);

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

export async function fetchBlueOriginEventEvidence(eventId: string) {
  const dataset = await buildTimelineDataset();
  return dataset.evidenceById[eventId] || null;
}

export function parseBlueOriginAudienceMode(value: string | null): BlueOriginAudienceMode | null {
  if (!value) return 'quick';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'quick' || normalized === 'summary' || normalized === 'overview') return 'quick';
  if (normalized === 'explorer' || normalized === 'explore' || normalized === 'mission') return 'explorer';
  if (normalized === 'technical' || normalized === 'detail' || normalized === 'deep') return 'technical';
  return null;
}

export function parseBlueOriginMissionFilter(value: string | null): BlueOriginTimelineMissionFilter | null {
  if (!value) return 'all';
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '').replace(/_/g, '-');
  if (normalized === 'all') return 'all';
  if (
    normalized === 'program' ||
    normalized === 'blue-origin' ||
    normalized === 'blue-origin-program' ||
    normalized === 'blueoriginprogram'
  ) {
    return 'blue-origin-program';
  }
  if (normalized === 'new-shepard' || normalized === 'newshepard' || normalized === 'shepard') return 'new-shepard';
  if (normalized === 'new-glenn' || normalized === 'newglenn' || normalized === 'glenn') return 'new-glenn';
  if (normalized === 'blue-moon' || normalized === 'bluemoon') return 'blue-moon';
  if (normalized === 'blue-ring' || normalized === 'bluering') return 'blue-ring';
  if (normalized === 'be-4' || normalized === 'be4') return 'be-4';
  return null;
}

export function parseBlueOriginSourceFilter(value: string | null): BlueOriginTimelineSourceFilter | null {
  if (!value) return 'all';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'all') return 'all';
  if (normalized === 'll2-cache' || normalized === 'll2' || normalized === 'launch-library-2') return 'll2-cache';
  if (normalized === 'blue-origin-official' || normalized === 'official') return 'blue-origin-official';
  if (normalized === 'government-record' || normalized === 'government') return 'government-record';
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
  if (value == null || value === '') return BLUE_ORIGIN_TIMELINE_DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return clampInt(parsed, BLUE_ORIGIN_TIMELINE_DEFAULT_LIMIT, 1, BLUE_ORIGIN_TIMELINE_MAX_LIMIT);
}

export function parseTimelineCursor(value: string | null) {
  if (!value) return null;
  if (!/^\d+$/.test(value)) return null;
  return value;
}

function buildFallbackRecord({ definition, generatedAt }: { definition: FallbackDefinition; generatedAt: string }): TimelineRecord {
  const event: BlueOriginTimelineEvent = {
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

  const evidence: BlueOriginEventEvidence = {
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
        href: definition.sourceHref || BLUE_ORIGIN_ROOT_URL
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

  const event: BlueOriginTimelineEvent = {
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

  const evidence: BlueOriginEventEvidence = {
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
        confidence,
        flightCode: extractBlueOriginFlightCode(launch)
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
  const sources: BlueOriginEvidenceSource[] = [
    {
      label: 'Launch Library 2 launch record',
      href: sourceHref,
      capturedAt: sourceCapturedAt
    },
    {
      label: 'Blue Origin missions',
      href: BLUE_ORIGIN_MISSIONS_URL,
      note: 'Official mission index source.'
    },
    {
      label: 'Blue Origin news',
      href: BLUE_ORIGIN_NEWS_URL,
      note: 'Official newsroom source.'
    }
  ];

  for (const info of launch.launchInfoUrls || []) {
    const href = normalizeUrlCandidate(info?.url);
    if (!href) continue;
    sources.push({
      label: info?.title?.trim() || 'Launch information link',
      href,
      note: info?.source?.trim() || undefined
    });
    if (sources.length >= 8) break;
  }

  for (const video of launch.launchVidUrls || []) {
    if (sources.length >= 8) break;
    const href = normalizeUrlCandidate(video?.url);
    if (!href) continue;
    sources.push({
      label: video?.title?.trim() || 'Launch video link',
      href,
      note: video?.publisher?.trim() || video?.source?.trim() || undefined
    });
  }

  return dedupeSourcesByHref(sources);
}

function dedupeSourcesByHref(sources: BlueOriginEvidenceSource[]) {
  const deduped: BlueOriginEvidenceSource[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const key = (source.href || source.label).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(source);
  }
  return deduped;
}

function normalizeUrlCandidate(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function inferMissionFromLaunch(launch: Launch): BlueOriginTimelineMission {
  return getBlueOriginMissionKeyFromLaunch(launch) || 'blue-origin-program';
}

function deriveLaunchStatus(launch: Launch, nowMs: number): BlueOriginTimelineEvent['status'] {
  const netMs = Date.parse(launch.net);
  if (launch.status === 'scrubbed') return 'superseded';
  if (!Number.isNaN(netMs) && netMs < nowMs) return 'completed';
  if (launch.status === 'hold' || launch.netPrecision === 'tbd' || launch.netPrecision === 'day' || launch.netPrecision === 'month') {
    return 'tentative';
  }
  return 'upcoming';
}

function deriveLaunchConfidence(launch: Launch): BlueOriginTimelineConfidence {
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
  events: BlueOriginTimelineEvent[];
  flightIndex: Awaited<ReturnType<typeof fetchBlueOriginFlightIndex>>;
}) {
  const latestByMission = new Map<BlueOriginTimelineMission, BlueOriginTimelineEvent>();

  for (const event of [...events].sort(compareEventsDescending)) {
    if (!latestByMission.has(event.mission)) {
      latestByMission.set(event.mission, event);
    }
  }

  return BLUE_ORIGIN_MISSION_KEYS.map((mission): BlueOriginMissionProgressCard => {
    const event = latestByMission.get(mission) || null;
    const flightCount = flightIndex.filter((entry) => entry.missionKey === mission).length;

    return {
      mission,
      label: MISSION_LABELS[mission],
      state: deriveMissionState(event),
      summary: event?.summary || `No high-confidence timeline event available yet. Flights tracked: ${flightCount}.`,
      targetDate: event?.date || null,
      sourceType: event?.source.type || 'curated-fallback',
      confidence: event?.confidence || 'low',
      eventId: event?.id || null
    };
  });
}

function deriveMissionState(event: BlueOriginTimelineEvent | null): BlueOriginMissionProgressCard['state'] {
  if (!event) return 'planned';
  if (event.status === 'completed') return 'completed';
  if (event.status === 'upcoming' || event.status === 'tentative') return 'in-preparation';
  return 'planned';
}

function resolveEffectiveMissionFilter(
  mode: BlueOriginAudienceMode,
  mission: BlueOriginTimelineMissionFilter,
  events: BlueOriginTimelineEvent[]
): BlueOriginTimelineMissionFilter {
  if (mission !== 'all') return mission;
  if (mode === 'quick') return 'all';

  const newest = [...events].sort(compareEventsDescending)[0];
  return newest?.mission || 'blue-origin-program';
}

function buildTimelineFacets({
  events,
  missionFilter,
  sourceTypeFilter
}: {
  events: BlueOriginTimelineEvent[];
  missionFilter: BlueOriginTimelineMissionFilter;
  sourceTypeFilter: BlueOriginTimelineSourceFilter;
}): BlueOriginTimelineFacet[] {
  const missionCounts = countBy(events, (event) => event.mission);
  const sourceCounts = countBy(events, (event) => event.source.type);

  const missionOptions = BLUE_ORIGIN_MISSION_KEYS.map((mission) => ({
    value: mission,
    label: MISSION_LABELS[mission],
    count: missionCounts.get(mission) || 0,
    selected: missionFilter === mission
  }));

  const sourceTypes: BlueOriginTimelineSourceType[] = ['ll2-cache', 'blue-origin-official', 'government-record', 'curated-fallback'];

  const sourceOptions = sourceTypes.map((sourceType) => ({
    value: sourceType,
    label: sourceType,
    count: sourceCounts.get(sourceType) || 0,
    selected: sourceTypeFilter === sourceType
  }));

  return [
    {
      key: 'mission',
      label: 'Mission',
      options: [
        {
          value: 'all',
          label: 'All missions',
          count: events.length,
          selected: missionFilter === 'all'
        },
        ...missionOptions
      ]
    },
    {
      key: 'sourceType',
      label: 'Source type',
      options: [
        {
          value: 'all',
          label: 'All sources',
          count: events.length,
          selected: sourceTypeFilter === 'all'
        },
        ...sourceOptions
      ]
    }
  ];
}

function buildKpis(events: BlueOriginTimelineEvent[]): BlueOriginTimelineKpis {
  const lastUpdated = resolveTimelineLastUpdated(events);

  return {
    totalEvents: events.length,
    completedEvents: events.filter((event) => event.status === 'completed').length,
    upcomingEvents: events.filter((event) => event.status === 'upcoming').length,
    tentativeEvents: events.filter((event) => event.status === 'tentative').length,
    supersededEvents: events.filter((event) => event.status === 'superseded').length,
    highConfidenceEvents: events.filter((event) => event.confidence === 'high').length,
    lastUpdated
  };
}

function resolveTimelineLastUpdated(events: BlueOriginTimelineEvent[]) {
  const maxAllowedMs = Date.now() + LAST_UPDATED_MAX_FUTURE_MS;
  const candidates = events
    .flatMap((event) => [event.date, event.source.lastVerifiedAt || null])
    .map((value) => toIsoOrNull(value))
    .filter((value): value is string => {
      if (!value) return false;
      const parsedMs = Date.parse(value);
      return Number.isFinite(parsedMs) && parsedMs <= maxAllowedMs;
    });

  if (!candidates.length) return null;
  return candidates.reduce((latest, current) => (Date.parse(current) > Date.parse(latest) ? current : latest));
}

function normalizeEvent(event: BlueOriginTimelineEvent): BlueOriginTimelineEvent {
  return {
    ...event,
    supersedes: [...event.supersedes],
    supersededBy: event.supersededBy ? { ...event.supersededBy } : null
  };
}

function compareEventsAscending(a: BlueOriginTimelineEvent, b: BlueOriginTimelineEvent) {
  const left = Date.parse(a.date);
  const right = Date.parse(b.date);
  if (left === right) return a.id.localeCompare(b.id);
  return left - right;
}

function compareEventsDescending(a: BlueOriginTimelineEvent, b: BlueOriginTimelineEvent) {
  return compareEventsAscending(b, a);
}

function countBy<T>(values: T[], selector: (value: T) => string) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = selector(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function dedupeLaunchRows(launches: Launch[]) {
  const byKey = new Map<string, Launch>();

  for (const launch of launches) {
    const key = toLaunchIdentityKey(launch);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, launch);
      continue;
    }

    if (compareLaunchRows(launch, existing) > 0) {
      byKey.set(key, launch);
    }
  }

  return [...byKey.values()];
}

function toLaunchIdentityKey(launch: Launch) {
  const flightCode = extractBlueOriginFlightCode(launch);
  if (flightCode) return `flight:${flightCode}`;

  const ll2Id = (launch.ll2Id || '').trim().toLowerCase();
  if (ll2Id) return `ll2:${ll2Id}`;

  const launchId = (launch.id || '').trim().toLowerCase();
  if (launchId) return `id:${launchId}`;

  const normalizedName = (launch.name || '').trim().toLowerCase();
  const normalizedNet = normalizeDateKey(launch.net) || (launch.net || '').trim().toLowerCase();
  return `name:${normalizedName}:${normalizedNet}`;
}

function compareLaunchRows(candidate: Launch, current: Launch) {
  const candidateFreshness = resolveLaunchFreshnessMs(candidate);
  const currentFreshness = resolveLaunchFreshnessMs(current);
  if (candidateFreshness !== currentFreshness) {
    return candidateFreshness - currentFreshness;
  }

  const candidateRichness = resolveLaunchRichness(candidate);
  const currentRichness = resolveLaunchRichness(current);
  if (candidateRichness !== currentRichness) {
    return candidateRichness - currentRichness;
  }

  return 0;
}

function resolveLaunchFreshnessMs(launch: Launch) {
  const candidates = [launch.cacheGeneratedAt, launch.lastUpdated, launch.net];
  let maxMs = 0;
  for (const candidate of candidates) {
    const parsed = Date.parse(candidate || '');
    if (Number.isFinite(parsed)) {
      maxMs = Math.max(maxMs, parsed);
    }
  }
  return maxMs;
}

function resolveLaunchRichness(launch: Launch) {
  let score = 0;
  if ((launch.id || '').trim()) score += 2;
  if ((launch.ll2Id || '').trim()) score += 6;
  if ((launch.provider || '').trim()) score += 1;
  if ((launch.vehicle || '').trim()) score += 1;
  if ((launch.statusText || '').trim()) score += 2;
  score += Math.min(launch.crew?.length || 0, 4);
  score += Math.min(launch.payloads?.length || 0, 4);
  return score;
}

function normalizeDateKey(value: string | null | undefined) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function isDuplicateFallbackLaunchRecord(record: TimelineRecord, launchFlightCodes: Set<string>, launchSemanticKeys: Set<string>) {
  if (record.event.kind !== 'launch') return false;

  const fallbackFlightCode = extractBlueOriginFlightCodeFromText(`${record.event.title} ${record.event.summary}`);
  if (fallbackFlightCode && launchFlightCodes.has(fallbackFlightCode)) return true;

  const semanticKey = buildTimelineEventSemanticKey(record.event);
  if (semanticKey && launchSemanticKeys.has(semanticKey)) return true;
  return false;
}

function buildLaunchSemanticKey(launch: Launch) {
  const flightCode = extractBlueOriginFlightCode(launch);
  if (flightCode) return `flight:${flightCode}`;
  const normalizedDate = normalizeDateKey(launch.net) || (launch.net || '').trim().toLowerCase();
  return `launch:${normalizeTextKey(launch.name)}:${normalizedDate}`;
}

function buildTimelineEventSemanticKey(event: BlueOriginTimelineEvent) {
  const flightCode = extractBlueOriginFlightCodeFromText(`${event.title} ${event.summary}`);
  if (flightCode) return `flight:${flightCode}`;
  const normalizedDate = normalizeDateKey(event.date) || (event.date || '').trim().toLowerCase();
  return `launch:${normalizeTextKey(event.title)}:${normalizedDate}`;
}

function dedupeTimelineRecords(records: TimelineRecord[]) {
  const byKey = new Map<string, TimelineRecord>();

  for (const record of records) {
    const key = toTimelineRecordKey(record.event);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, record);
      continue;
    }

    if (compareTimelineRecordPreference(record, existing) > 0) {
      byKey.set(key, record);
    }
  }

  return [...byKey.values()];
}

function toTimelineRecordKey(event: BlueOriginTimelineEvent) {
  const flightCode = extractBlueOriginFlightCodeFromText(`${event.title} ${event.summary}`);
  if (event.kind === 'launch' && flightCode) return `launch:${flightCode}`;

  const normalizedDate = normalizeDateKey(event.date) || (event.date || '').trim().toLowerCase();
  return `event:${event.kind}:${normalizeTextKey(event.title)}:${normalizedDate}`;
}

function compareTimelineRecordPreference(candidate: TimelineRecord, current: TimelineRecord) {
  const candidateSource = sourcePriority(candidate.event.source.type);
  const currentSource = sourcePriority(current.event.source.type);
  if (candidateSource !== currentSource) return candidateSource - currentSource;

  const candidateConfidence = confidencePriority(candidate.event.confidence);
  const currentConfidence = confidencePriority(current.event.confidence);
  if (candidateConfidence !== currentConfidence) return candidateConfidence - currentConfidence;

  const candidateVerified = Date.parse(candidate.event.source.lastVerifiedAt || candidate.event.date || '');
  const currentVerified = Date.parse(current.event.source.lastVerifiedAt || current.event.date || '');
  if (Number.isFinite(candidateVerified) && Number.isFinite(currentVerified) && candidateVerified !== currentVerified) {
    return candidateVerified - currentVerified;
  }

  return 0;
}

function sourcePriority(value: BlueOriginTimelineSourceType) {
  if (value === 'll2-cache') return 4;
  if (value === 'blue-origin-official') return 3;
  if (value === 'government-record') return 2;
  return 1;
}

function confidencePriority(value: BlueOriginTimelineConfidence) {
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  return 1;
}

function normalizeTextKey(value: string | null | undefined) {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function encodeCursor(offset: number) {
  return String(Math.max(0, Math.trunc(offset)));
}

function decodeCursor(cursor: string | null) {
  if (!cursor) return 0;
  const parsed = Number(cursor);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

function clampInt(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  const clamped = Math.min(max, Math.max(min, Math.trunc(value)));
  return clamped;
}

function toIsoOrNull(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
