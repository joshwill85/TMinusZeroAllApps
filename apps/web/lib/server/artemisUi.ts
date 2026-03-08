import { cache } from 'react';
import { fetchArtemisLaunchBuckets } from '@/lib/server/artemis';
import { getArtemisMissionProfileDefault } from '@/lib/server/artemisMissionProfiles';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import {
  buildArtemisTimelineIdentityKey,
  canonicalizeArtemisUrl
} from '@/lib/utils/artemisDedupe';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { getArtemisMissionKeyFromLaunch } from '@/lib/utils/artemis';
import type { Launch } from '@/lib/types/launch';
import type {
  ArtemisMissionHubKey,
  ArtemisAudienceMode,
  ArtemisDashboardView,
  ArtemisEventEvidence,
  ArtemisEvidenceSource,
  ArtemisMissionProgressCard,
  ArtemisSourceClass,
  ArtemisTimelineConfidence,
  ArtemisTimelineEvent,
  ArtemisTimelineFacet,
  ArtemisTimelineKpis,
  ArtemisTimelineMission,
  ArtemisTimelineMissionFilter,
  ArtemisTimelineQuery,
  ArtemisTimelineResponse,
  ArtemisTimelineSourceClassFilter,
  ArtemisTimelineSourceFilter,
  ArtemisTimelineSourceType,
  ArtemisTimelineSupersedeReason,
  ArtemisTimelineSupersedesLink
} from '@/lib/types/artemis';
import { ARTEMIS_MISSION_HUB_KEYS } from '@/lib/types/artemis';

export const ARTEMIS_TIMELINE_DEFAULT_LIMIT = 25;
export const ARTEMIS_TIMELINE_MAX_LIMIT = 100;
const LAST_UPDATED_MAX_FUTURE_MS = 5 * 60 * 1000;

const NASA_ARTEMIS_URL = 'https://www.nasa.gov/humans-in-space/artemis/';
const NASA_ARTEMIS_I_URL = 'https://www.nasa.gov/mission/artemis-i/';
const NASA_ARTEMIS_II_URL = 'https://www.nasa.gov/mission/artemis-ii/';
const NASA_ARTEMIS_III_URL = 'https://www.nasa.gov/mission/artemis-iii/';

const MISSION_LABELS: Record<ArtemisMissionHubKey, string> = Object.fromEntries(
  ARTEMIS_MISSION_HUB_KEYS.map((mission) => [mission, getArtemisMissionProfileDefault(mission).shortLabel])
) as Record<ArtemisMissionHubKey, string>;

const MISSION_SEQUENCE: ArtemisMissionHubKey[] = [...ARTEMIS_MISSION_HUB_KEYS];

const FALLBACK_PRIMARY_EVENT_BY_MISSION: Record<ArtemisMissionHubKey, string> = {
  'artemis-i': 'fallback:artemis-i-launch',
  'artemis-ii': 'fallback:artemis-ii-target-2026',
  'artemis-iii': 'fallback:artemis-iii-target',
  'artemis-iv': 'fallback:artemis-iv-target',
  'artemis-v': 'fallback:artemis-v-target',
  'artemis-vi': 'fallback:artemis-vi-target',
  'artemis-vii': 'fallback:artemis-vii-target'
};

type TimelineDataset = {
  generatedAt: string;
  events: ArtemisTimelineEvent[];
  evidenceById: Record<string, ArtemisEventEvidence>;
  missionProgress: ArtemisMissionProgressCard[];
};

type TimelineRecord = {
  dbId?: string;
  event: ArtemisTimelineEvent;
  evidence: ArtemisEventEvidence;
};

type ArtemisTimelineRow = {
  id: string;
  fingerprint: string | null;
  mission_key: string;
  title: string;
  summary: string | null;
  event_time: string | null;
  event_time_precision: string | null;
  announced_time: string;
  source_type: string;
  confidence: string;
  source_document_id: string | null;
  source_url: string | null;
  supersedes_event_id: string | null;
  is_superseded: boolean;
  tags: string[] | null;
  metadata: Record<string, unknown> | null;
  updated_at: string;
};

type ArtemisSourceDocumentRow = {
  id: string;
  url: string;
  title: string | null;
  source_type: string;
  published_at: string | null;
  fetched_at: string | null;
};

type FallbackDefinition = {
  id: string;
  mission: ArtemisTimelineMission;
  title: string;
  summary: string;
  date: string;
  kind: ArtemisTimelineEvent['kind'];
  status: ArtemisTimelineEvent['status'];
  sourceType: ArtemisTimelineSourceType;
  sourceLabel: string;
  sourceHref?: string;
  confidence: ArtemisTimelineConfidence;
  supersedes?: ArtemisTimelineSupersedesLink[];
  supersededBy?: ArtemisTimelineSupersedesLink | null;
  evidenceSources: ArtemisEvidenceSource[];
  payload: Record<string, unknown>;
};

const FALLBACK_TIMELINE_EVENTS: FallbackDefinition[] = [
  {
    id: 'fallback:artemis-i-launch',
    mission: 'artemis-i',
    title: 'Artemis I launch',
    summary: 'Orion launched on an uncrewed lunar mission to validate the SLS-Orion stack.',
    date: '2022-11-16T06:47:00Z',
    kind: 'launch',
    status: 'completed',
    sourceType: 'nasa-official',
    sourceLabel: 'NASA mission archive',
    sourceHref: NASA_ARTEMIS_I_URL,
    confidence: 'high',
    evidenceSources: [
      { label: 'NASA Artemis I mission page', href: NASA_ARTEMIS_I_URL, note: 'Historical launch milestone.' }
    ],
    payload: {
      category: 'fallback-milestone',
      mission: 'Artemis I',
      milestone: 'launch'
    }
  },
  {
    id: 'fallback:artemis-i-splashdown',
    mission: 'artemis-i',
    title: 'Artemis I splashdown',
    summary: 'Orion completed the Artemis I mission with Pacific Ocean splashdown.',
    date: '2022-12-11T17:40:00Z',
    kind: 'mission-milestone',
    status: 'completed',
    sourceType: 'nasa-official',
    sourceLabel: 'NASA mission archive',
    sourceHref: NASA_ARTEMIS_I_URL,
    confidence: 'high',
    evidenceSources: [
      { label: 'NASA Artemis I mission page', href: NASA_ARTEMIS_I_URL, note: 'Mission completion milestone.' }
    ],
    payload: {
      category: 'fallback-milestone',
      mission: 'Artemis I',
      milestone: 'splashdown'
    }
  },
  {
    id: 'fallback:artemis-ii-target-2025',
    mission: 'artemis-ii',
    title: 'Artemis II target window (legacy)',
    summary: 'Earlier public planning windows placed Artemis II in 2025 before subsequent schedule updates.',
    date: '2025-09-01T00:00:00Z',
    kind: 'update',
    status: 'superseded',
    sourceType: 'curated-fallback',
    sourceLabel: 'Program planning fallback',
    sourceHref: NASA_ARTEMIS_II_URL,
    confidence: 'low',
    supersededBy: { eventId: 'fallback:artemis-ii-target-2026', reason: 'rescheduled' },
    evidenceSources: [
      { label: 'NASA Artemis II mission page', href: NASA_ARTEMIS_II_URL, note: 'Used as stable fallback when cache is sparse.' }
    ],
    payload: {
      category: 'fallback-window',
      mission: 'Artemis II',
      window: 'legacy-2025'
    }
  },
  {
    id: 'fallback:artemis-ii-target-2026',
    mission: 'artemis-ii',
    title: 'Artemis II target window',
    summary: 'Fallback planning window used until launch-level cache updates provide a newer mission window.',
    date: '2026-04-01T00:00:00Z',
    kind: 'update',
    status: 'tentative',
    sourceType: 'curated-fallback',
    sourceLabel: 'Program planning fallback',
    sourceHref: NASA_ARTEMIS_II_URL,
    confidence: 'medium',
    supersedes: [{ eventId: 'fallback:artemis-ii-target-2025', reason: 'rescheduled' }],
    evidenceSources: [
      { label: 'NASA Artemis II mission page', href: NASA_ARTEMIS_II_URL, note: 'Fallback target until LL2 cache confirms date precision.' }
    ],
    payload: {
      category: 'fallback-window',
      mission: 'Artemis II',
      window: 'target-2026'
    }
  },
  {
    id: 'fallback:artemis-iii-target',
    mission: 'artemis-iii',
    title: 'Artemis III planning target',
    summary: 'Fallback Artemis III timeline placeholder for first crewed lunar landing mission planning.',
    date: '2027-09-01T00:00:00Z',
    kind: 'update',
    status: 'tentative',
    sourceType: 'curated-fallback',
    sourceLabel: 'Program planning fallback',
    sourceHref: NASA_ARTEMIS_III_URL,
    confidence: 'low',
    evidenceSources: [
      { label: 'NASA Artemis III mission page', href: NASA_ARTEMIS_III_URL, note: 'Planning-level reference.' }
    ],
    payload: {
      category: 'fallback-window',
      mission: 'Artemis III',
      window: 'planning-target'
    }
  },
  {
    id: 'fallback:artemis-iv-target',
    mission: 'artemis-iv',
    title: 'Artemis IV planning target',
    summary: 'Fallback Artemis IV timeline placeholder for sustained lunar campaign planning.',
    date: '2028-09-01T00:00:00Z',
    kind: 'update',
    status: 'tentative',
    sourceType: 'curated-fallback',
    sourceLabel: 'Program planning fallback',
    sourceHref: NASA_ARTEMIS_URL,
    confidence: 'low',
    evidenceSources: [
      { label: 'NASA Artemis campaign', href: NASA_ARTEMIS_URL, note: 'Program-level planning reference.' }
    ],
    payload: {
      category: 'fallback-window',
      mission: 'Artemis IV',
      window: 'planning-target'
    }
  },
  {
    id: 'fallback:artemis-v-target',
    mission: 'artemis-v',
    title: 'Artemis V planning target',
    summary: 'Fallback Artemis V timeline placeholder for sustained lunar campaign planning.',
    date: '2029-09-01T00:00:00Z',
    kind: 'update',
    status: 'tentative',
    sourceType: 'curated-fallback',
    sourceLabel: 'Program planning fallback',
    sourceHref: NASA_ARTEMIS_URL,
    confidence: 'low',
    evidenceSources: [
      { label: 'NASA Artemis campaign', href: NASA_ARTEMIS_URL, note: 'Program-level planning reference.' }
    ],
    payload: {
      category: 'fallback-window',
      mission: 'Artemis V',
      window: 'planning-target'
    }
  },
  {
    id: 'fallback:artemis-vi-target',
    mission: 'artemis-vi',
    title: 'Artemis VI planning target',
    summary: 'Fallback Artemis VI timeline placeholder for sustained lunar campaign planning.',
    date: '2030-09-01T00:00:00Z',
    kind: 'update',
    status: 'tentative',
    sourceType: 'curated-fallback',
    sourceLabel: 'Program planning fallback',
    sourceHref: NASA_ARTEMIS_URL,
    confidence: 'low',
    evidenceSources: [
      { label: 'NASA Artemis campaign', href: NASA_ARTEMIS_URL, note: 'Program-level planning reference.' }
    ],
    payload: {
      category: 'fallback-window',
      mission: 'Artemis VI',
      window: 'planning-target'
    }
  },
  {
    id: 'fallback:artemis-vii-target',
    mission: 'artemis-vii',
    title: 'Artemis VII planning target',
    summary: 'Fallback Artemis VII timeline placeholder for sustained lunar campaign planning.',
    date: '2031-09-01T00:00:00Z',
    kind: 'update',
    status: 'tentative',
    sourceType: 'curated-fallback',
    sourceLabel: 'Program planning fallback',
    sourceHref: NASA_ARTEMIS_URL,
    confidence: 'low',
    evidenceSources: [
      { label: 'NASA Artemis campaign', href: NASA_ARTEMIS_URL, note: 'Program-level planning reference.' }
    ],
    payload: {
      category: 'fallback-window',
      mission: 'Artemis VII',
      window: 'planning-target'
    }
  }
];

const buildTimelineDataset = cache(async (): Promise<TimelineDataset> => {
  const [buckets, databaseRecords] = await Promise.all([fetchArtemisLaunchBuckets(), fetchTimelineDatabaseRecords()]);
  const nowMs = Date.now();
  const dedupedLaunches = dedupeById([...buckets.upcoming, ...buckets.recent]);
  const launchRecords = dedupedLaunches.map((launch) => buildLaunchRecord({ launch, generatedAt: buckets.generatedAt, nowMs }));
  const fallbackRecords = FALLBACK_TIMELINE_EVENTS.map((definition) => buildFallbackRecord({ definition, generatedAt: buckets.generatedAt }));
  const allRecords = [...fallbackRecords, ...databaseRecords, ...launchRecords];

  // Promote db/launch-backed records over fallback placeholders when mission data is present.
  for (const mission of MISSION_SEQUENCE) {
    const fallbackId = FALLBACK_PRIMARY_EVENT_BY_MISSION[mission];
    const primaryRecord = pickPrimaryTimelineRecord({
      records: [...databaseRecords, ...launchRecords],
      mission,
      nowMs
    });
    if (!primaryRecord) continue;
    linkSupersession({
      records: allRecords,
      supersedingId: primaryRecord.event.id,
      supersededId: fallbackId,
      reason: 'refined'
    });
  }

  const events = allRecords.map((record) => normalizeEvent(record.event)).sort(compareEventsAscending);
  const evidenceById = Object.fromEntries(allRecords.map((record) => [record.event.id, record.evidence]));
  const missionProgress = buildMissionProgressCards(events, nowMs);

  return {
    generatedAt: buckets.generatedAt,
    events,
    evidenceById,
    missionProgress
  };
});

export async function fetchArtemisTimelineViewModel(query: ArtemisTimelineQuery): Promise<ArtemisTimelineResponse> {
  const dataset = await buildTimelineDataset();
  const effectiveMission = resolveEffectiveMissionFilter(query.mode, query.mission);
  const effectiveSourceClass = query.sourceClass || 'all';
  const cursorOffset = decodeCursor(query.cursor);
  const limit = clampInt(query.limit, ARTEMIS_TIMELINE_DEFAULT_LIMIT, 1, ARTEMIS_TIMELINE_MAX_LIMIT);

  const baseFiltered = dataset.events
    .filter((event) => (query.includeSuperseded ? true : event.status !== 'superseded'))
    .filter((event) => (query.from ? event.date >= query.from : true))
    .filter((event) => (query.to ? event.date <= query.to : true));

  const facets = buildTimelineFacets({
    events: baseFiltered,
    missionFilter: effectiveMission,
    sourceTypeFilter: query.sourceType,
    sourceClassFilter: effectiveSourceClass
  });

  const fullyFiltered = baseFiltered
    .filter((event) => (effectiveMission === 'all' ? true : event.mission === effectiveMission))
    .filter((event) => (query.sourceType === 'all' ? true : event.source.type === query.sourceType))
    .filter((event) => (effectiveSourceClass === 'all' ? true : event.source.sourceClass === effectiveSourceClass))
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
    sourceClass: effectiveSourceClass,
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

export async function fetchArtemisEventEvidence(eventId: string) {
  const dataset = await buildTimelineDataset();
  return dataset.evidenceById[eventId] || null;
}

export function parseArtemisDashboardView(value: string | null): ArtemisDashboardView | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'overview' || normalized === 'summary') return 'overview';
  if (normalized === 'timeline' || normalized === 'workbench') return 'timeline';
  if (normalized === 'intel' || normalized === 'intelligence' || normalized === 'news') return 'intel';
  if (normalized === 'budget' || normalized === 'funding' || normalized === 'finance') return 'budget';
  if (normalized === 'missions' || normalized === 'mission') return 'missions';
  return null;
}

export function parseArtemisAudienceMode(value: string | null): ArtemisAudienceMode | null {
  if (!value) return 'quick';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'quick' || normalized === 'summary' || normalized === 'overview') return 'quick';
  if (normalized === 'explorer' || normalized === 'explore' || normalized === 'mission') return 'explorer';
  if (normalized === 'technical' || normalized === 'detail' || normalized === 'deep') return 'technical';
  return null;
}

export function parseArtemisMissionFilter(value: string | null): ArtemisTimelineMissionFilter | null {
  if (!value) return 'all';
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '').replace(/_/g, '-');
  if (normalized === 'all') return 'all';
  if (normalized === 'artemis-i' || normalized === 'artemisi' || normalized === 'artemis1' || normalized === 'i' || normalized === '1') return 'artemis-i';
  if (normalized === 'artemis-ii' || normalized === 'artemisii' || normalized === 'artemis2' || normalized === 'ii' || normalized === '2') return 'artemis-ii';
  if (normalized === 'artemis-iii' || normalized === 'artemisiii' || normalized === 'artemis3' || normalized === 'iii' || normalized === '3') return 'artemis-iii';
  if (normalized === 'artemis-iv' || normalized === 'artemisiv' || normalized === 'artemis4' || normalized === 'iv' || normalized === '4') return 'artemis-iv';
  if (normalized === 'artemis-v' || normalized === 'artemisv' || normalized === 'artemis5' || normalized === 'v' || normalized === '5') return 'artemis-v';
  if (normalized === 'artemis-vi' || normalized === 'artemisvi' || normalized === 'artemis6' || normalized === 'vi' || normalized === '6') return 'artemis-vi';
  if (normalized === 'artemis-vii' || normalized === 'artemisvii' || normalized === 'artemis7' || normalized === 'vii' || normalized === '7') return 'artemis-vii';
  if (normalized === 'artemis-program' || normalized === 'program') return 'artemis-program';
  return null;
}

export function parseArtemisSourceFilter(value: string | null): ArtemisTimelineSourceFilter | null {
  if (!value) return 'all';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'all') return 'all';
  if (normalized === 'll2-cache' || normalized === 'll2' || normalized === 'launch-library-2') return 'll2-cache';
  if (normalized === 'nasa-official' || normalized === 'nasa') return 'nasa-official';
  if (normalized === 'curated-fallback' || normalized === 'fallback') return 'curated-fallback';
  return null;
}

export function parseArtemisSourceClassFilter(value: string | null): ArtemisTimelineSourceClassFilter | null {
  if (!value) return 'all';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'all') return 'all';
  if (normalized === 'nasa_primary' || normalized === 'nasa-primary' || normalized === 'nasa') return 'nasa_primary';
  if (normalized === 'oversight' || normalized === 'oig' || normalized === 'gao') return 'oversight';
  if (normalized === 'budget') return 'budget';
  if (normalized === 'procurement') return 'procurement';
  if (normalized === 'technical' || normalized === 'tech') return 'technical';
  if (normalized === 'media' || normalized === 'photo' || normalized === 'photos') return 'media';
  if (normalized === 'll2-cache' || normalized === 'll2') return 'll2-cache';
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
  if (value == null || value === '') return ARTEMIS_TIMELINE_DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return clampInt(parsed, ARTEMIS_TIMELINE_DEFAULT_LIMIT, 1, ARTEMIS_TIMELINE_MAX_LIMIT);
}

export function parseTimelineCursor(value: string | null) {
  if (!value) return null;
  if (!/^\d+$/.test(value)) return null;
  return value;
}

function buildFallbackRecord({ definition, generatedAt }: { definition: FallbackDefinition; generatedAt: string }): TimelineRecord {
  const event: ArtemisTimelineEvent = {
    id: definition.id,
    mission: definition.mission,
    title: definition.title,
    summary: definition.summary,
    date: definition.date,
    kind: definition.kind,
    status: definition.status,
    source: {
      type: definition.sourceType,
      sourceClass: definition.sourceType === 'nasa-official' ? 'nasa_primary' : 'curated-fallback',
      label: definition.sourceLabel,
      href: definition.sourceHref,
      lastVerifiedAt: generatedAt
    },
    confidence: definition.confidence,
    supersedes: definition.supersedes ? [...definition.supersedes] : [],
    supersededBy: definition.supersededBy ?? null,
    evidenceId: definition.id
  };

  const evidence: ArtemisEventEvidence = {
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
        href: definition.sourceHref || NASA_ARTEMIS_URL
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

  const event: ArtemisTimelineEvent = {
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
      sourceClass: 'll2-cache',
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

  const evidence: ArtemisEventEvidence = {
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

async function fetchTimelineDatabaseRecords(): Promise<TimelineRecord[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = createSupabasePublicClient();
  const { data: eventRows, error } = await supabase
    .from('artemis_timeline_events')
    .select(
      'id,fingerprint,mission_key,title,summary,event_time,event_time_precision,announced_time,source_type,confidence,source_document_id,source_url,supersedes_event_id,is_superseded,tags,metadata,updated_at'
    )
    .order('announced_time', { ascending: false })
    .limit(1000);

  if (error) {
    console.error('artemis timeline events query error', error);
    return [];
  }

  const rows = (eventRows || []) as ArtemisTimelineRow[];
  if (!rows.length) return [];

  const docIds = [...new Set(rows.map((row) => row.source_document_id).filter(Boolean) as string[])];
  const docsById = new Map<string, ArtemisSourceDocumentRow>();
  if (docIds.length > 0) {
    const { data: docRows, error: docError } = await supabase
      .from('artemis_source_documents')
      .select('id,url,title,source_type,published_at,fetched_at')
      .in('id', docIds)
      .limit(1000);
    if (docError) {
      console.error('artemis source documents query error', docError);
    } else {
      for (const row of (docRows || []) as ArtemisSourceDocumentRow[]) {
        docsById.set(row.id, row);
      }
    }
  }

  const { rows: canonicalRows, rowIdToCanonicalRowId } = dedupeTimelineRows(rows, docsById);

  const dbEventIdByCanonicalRowId = new Map<string, string>();
  const records: TimelineRecord[] = canonicalRows.map((row) => {
    const mission = mapTimelineMissionFromDb(row.mission_key);
    const sourceType = mapTimelineSourceTypeFromDb(row.source_type);
    const sourceClass = mapTimelineSourceClassFromDb(row.source_type);
    const confidence = mapTimelineConfidenceFromDb(row.confidence);
    const date =
      toIsoOrNull(row.event_time) ||
      toIsoOrNull(row.announced_time) ||
      toIsoOrNull(row.updated_at) ||
      new Date().toISOString();
    const doc = row.source_document_id ? docsById.get(row.source_document_id) : null;
    const sourceHref = normalizeUrlCandidate(row.source_url) || normalizeUrlCandidate(doc?.url);
    const sourceVerifiedAt =
      toIsoOrNull(row.updated_at) ||
      toIsoOrNull(row.announced_time) ||
      toIsoOrNull(doc?.published_at || undefined) ||
      toIsoOrNull(doc?.fetched_at || undefined) ||
      date;

    const eventId = `timeline:${row.id}`;
    dbEventIdByCanonicalRowId.set(row.id, eventId);
    const event: ArtemisTimelineEvent = {
      id: eventId,
      mission,
      title: normalizeTimelineTitle(row.title),
      summary: normalizeTimelineSummary(row.summary, row.source_type),
      date,
      kind: deriveTimelineKind(row),
      status: deriveTimelineStatus(row),
      source: {
        type: sourceType,
        sourceClass,
        label: buildTimelineSourceLabel(row.source_type),
        href: sourceHref || undefined,
        lastVerifiedAt: sourceVerifiedAt
      },
      confidence,
      supersedes: [],
      supersededBy: null,
      evidenceId: eventId
    };

    const sources: ArtemisEvidenceSource[] = [
      {
        label: buildTimelineSourceLabel(row.source_type),
        href: sourceHref || undefined,
        capturedAt: sourceVerifiedAt
      }
    ];

    if (doc?.url) {
      sources.push({
        label: doc.title?.trim() || 'Artemis source document',
        href: doc.url,
        note: `source_type=${doc.source_type}`,
        capturedAt: toIsoOrNull(doc.published_at || undefined) || toIsoOrNull(doc.fetched_at || undefined) || sourceVerifiedAt
      });
    }

    const evidence: ArtemisEventEvidence = {
      eventId,
      mission,
      title: event.title,
      summary: event.summary,
      sourceType,
      confidence,
      generatedAt: sourceVerifiedAt,
      sources,
      payload: {
        event: {
          id: row.id,
          mission_key: row.mission_key,
          source_type: row.source_type,
          confidence: row.confidence,
          event_time_precision: row.event_time_precision,
          tags: row.tags || [],
          metadata: row.metadata || {}
        },
        sourceDocument: doc
          ? {
              id: doc.id,
              title: doc.title,
              url: doc.url,
              sourceType: doc.source_type
            }
          : null
      }
    };

    return { dbId: row.id, event, evidence };
  });

  for (const row of rows) {
    if (!row.supersedes_event_id) continue;
    const currentCanonicalRowId = rowIdToCanonicalRowId.get(row.id);
    const supersededCanonicalRowId = rowIdToCanonicalRowId.get(row.supersedes_event_id);
    if (!currentCanonicalRowId || !supersededCanonicalRowId) continue;

    const currentId = dbEventIdByCanonicalRowId.get(currentCanonicalRowId);
    const supersededId = dbEventIdByCanonicalRowId.get(supersededCanonicalRowId);
    if (!currentId || !supersededId) continue;
    linkSupersession({
      records,
      supersedingId: currentId,
      supersededId,
      reason: 'replaced'
    });
  }

  return records;
}

function dedupeTimelineRows(rows: ArtemisTimelineRow[], docsById: Map<string, ArtemisSourceDocumentRow>) {
  const grouped = new Map<string, ArtemisTimelineRow[]>();

  for (const row of rows) {
    const sourceDocumentUrl = row.source_document_id ? docsById.get(row.source_document_id)?.url : null;
    const strictKey = buildArtemisTimelineIdentityKey({
      fingerprint: row.fingerprint,
      missionKey: row.mission_key,
      title: row.title,
      summary: row.summary,
      kind: deriveTimelineKind(row),
      sourceType: row.source_type,
      sourceUrl: row.source_url,
      sourceDocumentUrl,
      eventTime: row.event_time,
      announcedTime: row.announced_time
    });

    const key = `strict:${strictKey}`;
    const list = grouped.get(key) || [];
    list.push(row);
    grouped.set(key, list);
  }

  const canonicalRows: ArtemisTimelineRow[] = [];
  const rowIdToCanonicalRowId = new Map<string, string>();
  for (const group of grouped.values()) {
    const canonical = pickCanonicalTimelineRow(group);
    canonicalRows.push(canonical);
    for (const row of group) {
      rowIdToCanonicalRowId.set(row.id, canonical.id);
    }
  }

  return {
    rows: canonicalRows,
    rowIdToCanonicalRowId
  };
}

function pickCanonicalTimelineRow(rows: ArtemisTimelineRow[]) {
  return rows.slice().sort(compareTimelineRowsByPriority)[0] || rows[0];
}

function compareTimelineRowsByPriority(a: ArtemisTimelineRow, b: ArtemisTimelineRow) {
  const updatedDiff = parseTimelineDateMs(b.updated_at) - parseTimelineDateMs(a.updated_at);
  if (updatedDiff !== 0) return updatedDiff;

  const announcedDiff = parseTimelineDateMs(b.announced_time) - parseTimelineDateMs(a.announced_time);
  if (announcedDiff !== 0) return announcedDiff;

  const eventDiff = parseTimelineDateMs(b.event_time) - parseTimelineDateMs(a.event_time);
  if (eventDiff !== 0) return eventDiff;

  const sourceDiff = scoreTimelineSourceUrl(b.source_url) - scoreTimelineSourceUrl(a.source_url);
  if (sourceDiff !== 0) return sourceDiff;

  const summaryDiff = normalizeTimelineSummary(b.summary, b.source_type).length - normalizeTimelineSummary(a.summary, a.source_type).length;
  if (summaryDiff !== 0) return summaryDiff;

  return b.id.localeCompare(a.id);
}

function parseTimelineDateMs(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function scoreTimelineSourceUrl(value: string | null | undefined) {
  const canonical = canonicalizeArtemisUrl(value);
  if (!canonical) return 0;
  if (canonical.includes('nasa.gov')) return 3;
  if (canonical.includes('usaspending.gov')) return 2;
  return 1;
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
  const sources: ArtemisEvidenceSource[] = [
    {
      label: 'Launch Library 2 launch record',
      href: sourceHref,
      capturedAt: sourceCapturedAt
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

function inferMissionFromLaunch(launch: Launch): ArtemisTimelineMission {
  const missionKey = getArtemisMissionKeyFromLaunch(launch);
  if (missionKey) return missionKey;
  return 'artemis-program';
}

function deriveLaunchStatus(launch: Launch, nowMs: number): ArtemisTimelineEvent['status'] {
  const netMs = Date.parse(launch.net);
  if (launch.status === 'scrubbed') return 'superseded';
  if (!Number.isNaN(netMs) && netMs < nowMs) return 'completed';
  if (launch.status === 'hold' || launch.netPrecision === 'tbd' || launch.netPrecision === 'day' || launch.netPrecision === 'month') {
    return 'tentative';
  }
  return 'upcoming';
}

function deriveLaunchConfidence(launch: Launch): ArtemisTimelineConfidence {
  if (launch.netPrecision === 'tbd') return 'low';
  if (launch.netPrecision === 'day' || launch.netPrecision === 'month') return 'medium';
  if (launch.status === 'hold' || launch.status === 'scrubbed') return 'medium';
  return 'high';
}

function buildLaunchSummary(launch: Launch) {
  const status = launch.statusText?.trim() || launch.status || 'Unknown';
  return `${launch.provider} • ${launch.vehicle} • Status: ${status}`;
}

function pickPrimaryTimelineRecord({
  records,
  mission,
  nowMs
}: {
  records: TimelineRecord[];
  mission: ArtemisMissionHubKey;
  nowMs: number;
}) {
  const missionRecords = records.filter((record) => record.event.mission === mission);
  if (!missionRecords.length) return null;

  const upcoming = missionRecords
    .filter((record) => {
      const ms = Date.parse(record.event.date);
      return !Number.isNaN(ms) && ms >= nowMs;
    })
    .sort((a, b) => Date.parse(a.event.date) - Date.parse(b.event.date));
  if (upcoming.length) return upcoming[0];

  const latestCompleted = missionRecords
    .slice()
    .sort((a, b) => Date.parse(b.event.date) - Date.parse(a.event.date));
  return latestCompleted[0];
}

function linkSupersession({
  records,
  supersedingId,
  supersededId,
  reason
}: {
  records: TimelineRecord[];
  supersedingId: string;
  supersededId: string;
  reason: ArtemisTimelineSupersedeReason;
}) {
  if (supersedingId === supersededId) return;
  const superseding = records.find((record) => record.event.id === supersedingId);
  const superseded = records.find((record) => record.event.id === supersededId);
  if (!superseding || !superseded) return;

  if (!superseding.event.supersedes.some((entry) => entry.eventId === supersededId)) {
    superseding.event.supersedes.push({ eventId: supersededId, reason });
  }
  superseded.event.supersededBy = { eventId: supersedingId, reason };
  if (superseded.event.status !== 'completed') superseded.event.status = 'superseded';

  superseding.evidence.payload = {
    ...superseding.evidence.payload,
    supersedes: superseding.event.supersedes
  };
  superseded.evidence.payload = {
    ...superseded.evidence.payload,
    supersededBy: superseded.event.supersededBy
  };
}

function normalizeEvent(event: ArtemisTimelineEvent): ArtemisTimelineEvent {
  return {
    ...event,
    supersedes: event.supersedes || [],
    supersededBy: event.supersededBy ?? null
  };
}

function buildMissionProgressCards(events: ArtemisTimelineEvent[], nowMs: number) {
  return MISSION_SEQUENCE.map((mission) => {
    const missionProfile = getArtemisMissionProfileDefault(mission);
    const missionEvents = events
      .filter((event) => event.mission === mission && event.status !== 'superseded')
      .sort(compareEventsAscending);
    const completedCount = missionEvents.filter((event) => event.status === 'completed').length;
    const nextUpcoming = missionEvents.find((event) => {
      const ms = Date.parse(event.date);
      return !Number.isNaN(ms) && ms >= nowMs;
    });
    const latestKnown = nextUpcoming || missionEvents[missionEvents.length - 1] || null;

    const state =
      missionProfile.status === 'completed'
        ? 'completed'
        : missionProfile.status === 'in-preparation'
          ? 'in-preparation'
          : completedCount > 0
            ? 'in-preparation'
            : 'planned';

    return {
      mission,
      label: missionProfile.shortLabel,
      state,
      summary: latestKnown?.summary || `${missionProfile.shortLabel} milestone timeline is currently sourced from fallback planning data.`,
      targetDate: latestKnown?.date || missionProfile.targetDate || null,
      sourceType: latestKnown?.source.type || 'curated-fallback',
      confidence: latestKnown?.confidence || 'low',
      eventId: latestKnown?.id || null
    } satisfies ArtemisMissionProgressCard;
  });
}

function buildTimelineFacets({
  events,
  missionFilter,
  sourceTypeFilter,
  sourceClassFilter
}: {
  events: ArtemisTimelineEvent[];
  missionFilter: ArtemisTimelineMissionFilter;
  sourceTypeFilter: ArtemisTimelineSourceFilter;
  sourceClassFilter: ArtemisTimelineSourceClassFilter;
}): ArtemisTimelineFacet[] {
  const missionCounts = countBy(events, (event) => event.mission);
  const sourceTypeCounts = countBy(events, (event) => event.source.type);
  const sourceClassCounts = countBy(events, (event) => event.source.sourceClass || 'curated-fallback');

  const missionOptions = [
    { value: 'all', label: 'All missions', count: events.length, selected: missionFilter === 'all' },
    ...ARTEMIS_MISSION_HUB_KEYS.map((value) => ({
      value,
      label: MISSION_LABELS[value],
      count: missionCounts[value] || 0,
      selected: missionFilter === value
    })),
    {
      value: 'artemis-program' as const,
      label: 'Program-level',
      count: missionCounts['artemis-program'] || 0,
      selected: missionFilter === 'artemis-program'
    }
  ];

  const sourceTypeOptions = [
    { value: 'all', label: 'All sources', count: events.length, selected: sourceTypeFilter === 'all' },
    ...(['ll2-cache', 'nasa-official', 'curated-fallback'] as const).map((value) => ({
      value,
      label:
        value === 'll2-cache'
          ? 'Launch Library 2 cache'
          : value === 'nasa-official'
            ? 'NASA official'
            : 'Curated fallback',
      count: sourceTypeCounts[value] || 0,
      selected: sourceTypeFilter === value
    }))
  ];

  const sourceClassOptions = [
    { value: 'all', label: 'All source classes', count: events.length, selected: sourceClassFilter === 'all' },
    ...(
      [
        'nasa_primary',
        'oversight',
        'budget',
        'procurement',
        'technical',
        'media',
        'll2-cache',
        'curated-fallback'
      ] as const
    ).map((value) => ({
      value,
      label:
        value === 'nasa_primary'
          ? 'NASA primary'
          : value === 'll2-cache'
            ? 'LL2 cache'
            : value === 'curated-fallback'
              ? 'Curated fallback'
              : value[0].toUpperCase() + value.slice(1).replace(/_/g, ' '),
      count: sourceClassCounts[value] || 0,
      selected: sourceClassFilter === value
    }))
  ];

  return [
    {
      key: 'mission',
      label: 'Mission',
      options: missionOptions
    },
    {
      key: 'sourceType',
      label: 'Source',
      options: sourceTypeOptions
    },
    {
      key: 'sourceClass',
      label: 'Source class',
      options: sourceClassOptions
    }
  ];
}

function buildKpis(events: ArtemisTimelineEvent[]): ArtemisTimelineKpis {
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

function resolveEffectiveMissionFilter(mode: ArtemisAudienceMode, mission: ArtemisTimelineMissionFilter): ArtemisTimelineMissionFilter {
  if (mission !== 'all') return mission;
  if (mode === 'quick') return 'all';
  if (mode === 'technical') return 'all';
  return 'artemis-ii';
}

function resolveLastUpdated(events: ArtemisTimelineEvent[]) {
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

function compareEventsAscending(a: ArtemisTimelineEvent, b: ArtemisTimelineEvent) {
  const aMs = Date.parse(a.date);
  const bMs = Date.parse(b.date);
  const safeAMs = Number.isNaN(aMs) ? Number.MAX_SAFE_INTEGER : aMs;
  const safeBMs = Number.isNaN(bMs) ? Number.MAX_SAFE_INTEGER : bMs;
  if (safeAMs !== safeBMs) return safeAMs - safeBMs;
  return a.id.localeCompare(b.id);
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

function mapTimelineMissionFromDb(value: string | null | undefined): ArtemisTimelineMission {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'program' || normalized === 'artemis-program') return 'artemis-program';
  if (normalized === 'artemis-i') return 'artemis-i';
  if (normalized === 'artemis-ii') return 'artemis-ii';
  if (normalized === 'artemis-iii') return 'artemis-iii';
  if (normalized === 'artemis-iv') return 'artemis-iv';
  if (normalized === 'artemis-v') return 'artemis-v';
  if (normalized === 'artemis-vi') return 'artemis-vi';
  if (normalized === 'artemis-vii') return 'artemis-vii';
  return 'artemis-program';
}

function mapTimelineSourceTypeFromDb(value: string | null | undefined): ArtemisTimelineSourceType {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'nasa_primary' || normalized === 'nasa-official') return 'nasa-official';
  if (normalized === 'll2-cache') return 'll2-cache';
  return 'curated-fallback';
}

function mapTimelineSourceClassFromDb(value: string | null | undefined): ArtemisSourceClass {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'nasa_primary') return 'nasa_primary';
  if (normalized === 'oversight') return 'oversight';
  if (normalized === 'budget') return 'budget';
  if (normalized === 'procurement') return 'procurement';
  if (normalized === 'technical') return 'technical';
  if (normalized === 'media') return 'media';
  if (normalized === 'll2-cache') return 'll2-cache';
  return 'curated-fallback';
}

function mapTimelineConfidenceFromDb(value: string | null | undefined): ArtemisTimelineConfidence {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'primary') return 'high';
  if (normalized === 'oversight') return 'medium';
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low') return normalized;
  return 'low';
}

function buildTimelineSourceLabel(value: string | null | undefined) {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'nasa_primary') return 'NASA official';
  if (normalized === 'oversight') return 'Oversight';
  if (normalized === 'budget') return 'Budget';
  if (normalized === 'procurement') return 'Procurement';
  if (normalized === 'technical') return 'Technical';
  if (normalized === 'media') return 'Media';
  if (normalized === 'll2-cache') return 'Launch Library 2 cache';
  return 'Artemis timeline source';
}

function deriveTimelineStatus(row: ArtemisTimelineRow): ArtemisTimelineEvent['status'] {
  if (row.is_superseded) return 'superseded';
  const eventMs = Date.parse(row.event_time || '');
  if (!Number.isNaN(eventMs)) {
    if (eventMs < Date.now()) return 'completed';
    if ((row.event_time_precision || '').toLowerCase() === 'unknown') return 'tentative';
    return 'upcoming';
  }
  return 'tentative';
}

function deriveTimelineKind(row: ArtemisTimelineRow): ArtemisTimelineEvent['kind'] {
  const tags = Array.isArray(row.tags) ? row.tags.map((tag) => String(tag).toLowerCase()) : [];
  const title = (row.title || '').toLowerCase();
  if (tags.includes('launch-feed') || /\blaunch\b/.test(title)) return 'launch';
  if (/\bmilestone\b|\bsplashdown\b|\brollout\b|\bstack\b/.test(title)) return 'mission-milestone';
  return 'update';
}

function normalizeTimelineTitle(value: string | null | undefined) {
  const normalized = (value || '').trim();
  return normalized || 'Artemis timeline event';
}

function normalizeTimelineSummary(value: string | null | undefined, sourceType: string | null | undefined) {
  const normalized = (value || '').trim();
  if (normalized) return normalized;
  return `${buildTimelineSourceLabel(sourceType)} timeline update.`;
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
