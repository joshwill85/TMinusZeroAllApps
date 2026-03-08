import { cache } from 'react';
import {
  createSupabaseAdminClient,
  createSupabasePublicClient
} from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { mapPublicCacheRow } from '@/lib/server/transformers';
import type { Launch } from '@/lib/types/launch';
import type {
  BlueOriginChangeItem,
  BlueOriginFaqItem,
  BlueOriginFlightSnapshot,
  BlueOriginMissionSnapshot,
  BlueOriginProgramSnapshot
} from '@/lib/types/blueOrigin';
import {
  buildBlueOriginFlightSlug,
  extractBlueOriginFlightCode,
  getBlueOriginMissionKeyFromLaunch,
  isBlueOriginProgramLaunch,
  parseBlueOriginFlightSlug,
  type BlueOriginMissionKey
} from '@/lib/utils/blueOrigin';
import { buildLaunchHref } from '@/lib/utils/launchLinks';

const BLUE_ORIGIN_OR_FILTER = [
  'provider.ilike.%Blue Origin%',
  'name.ilike.%Blue Origin%',
  'mission_name.ilike.%Blue Origin%',
  'name.ilike.%New Shepard%',
  'mission_name.ilike.%New Shepard%',
  'name.ilike.%New Glenn%',
  'mission_name.ilike.%New Glenn%',
  'name.ilike.%Blue Moon%',
  'mission_name.ilike.%Blue Moon%',
  'name.ilike.%Blue Ring%',
  'mission_name.ilike.%Blue Ring%'
].join(',');

const BLUE_ORIGIN_UPCOMING_LIMIT = 400;
const BLUE_ORIGIN_RECENT_LIMIT = 800;
const BLUE_ORIGIN_FLIGHT_FALLBACK_LIMIT = 800;
const MAX_LIST_ITEMS = 400;
const MAX_CHANGES = 16;
const MAX_FLIGHTS = 240;
const LAST_UPDATED_MAX_FUTURE_MS = 5 * 60 * 1000;
const DEFAULT_BLUE_ORIGIN_LAUNCH_IMAGE =
  'https://images2.imgbox.com/00/00/default.png';
const withCache =
  typeof cache === 'function'
    ? cache
    : (<T extends (...args: any[]) => any>(fn: T): T => fn);

export const BLUE_ORIGIN_MISSIONS: readonly BlueOriginMissionKey[] = [
  'blue-origin-program',
  'new-shepard',
  'new-glenn',
  'blue-moon',
  'blue-ring',
  'be-4'
] as const;

const MISSION_LABELS: Record<BlueOriginMissionKey, string> = {
  'blue-origin-program': 'Blue Origin Program',
  'new-shepard': 'New Shepard',
  'new-glenn': 'New Glenn',
  'blue-moon': 'Blue Moon',
  'blue-ring': 'Blue Ring',
  'be-4': 'BE-4 Engines'
};

export type BlueOriginLaunchBuckets = {
  generatedAt: string;
  upcoming: Launch[];
  recent: Launch[];
};

export type BlueOriginFlightIndexEntry = {
  flightCode: string;
  flightSlug: string;
  missionKey: BlueOriginMissionKey;
  missionLabel: string;
  label: string;
  nextLaunch: Launch | null;
  upcomingCount: number;
  recentCount: number;
  lastUpdated: string | null;
};

type BlueOriginFlightBucketRow = {
  id: string;
  flight_code: string;
  mission_key: string | null;
  launch_id: string | null;
  ll2_launch_uuid: string | null;
  launch_name: string | null;
  launch_date: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

export const fetchBlueOriginLaunchBuckets = withCache(async (): Promise<BlueOriginLaunchBuckets> => {
  const generatedAt = new Date().toISOString();
  if (!isSupabaseConfigured()) {
    return { generatedAt, upcoming: [], recent: [] };
  }

  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  let rowsByBucket = await queryBlueOriginLaunchBucketRows(
    createSupabasePublicClient(),
    nowIso
  );
  if (shouldRetryBlueOriginBucketQuery(rowsByBucket) && isSupabaseAdminConfigured()) {
    const adminRows = await queryBlueOriginLaunchBucketRows(
      createSupabaseAdminClient(),
      nowIso
    );
    if (!adminRows.upcoming.error && !adminRows.recent.error && !adminRows.nullNet.error) {
      rowsByBucket = adminRows;
    }
  }

  if (rowsByBucket.upcoming.error || rowsByBucket.recent.error || rowsByBucket.nullNet.error) {
    console.error('blue origin snapshot query error', {
      upcoming: rowsByBucket.upcoming.error,
      recent: rowsByBucket.recent.error,
      recentNullNet: rowsByBucket.nullNet.error
    });
  }

  const upcoming = dedupeLaunches(
    (rowsByBucket.upcoming.data || []).map((row) => mapPublicCacheRow(row)).filter(isBlueOriginProgramLaunch)
  ).slice(0, MAX_LIST_ITEMS);
  const recent = dedupeLaunches(
    [...(rowsByBucket.recent.data || []), ...(rowsByBucket.nullNet.data || [])]
      .map((row) => mapPublicCacheRow(row))
      .filter(isBlueOriginProgramLaunch)
  ).slice(0, MAX_LIST_ITEMS);

  if (!recent.length && !rowsByBucket.recent.error) {
    const fallback = await fetchBlueOriginLaunchBucketsFromFlights(nowMs, generatedAt);
    if (fallback) {
      const mergedUpcoming = dedupeLaunches([...upcoming, ...fallback.upcoming]).slice(0, MAX_LIST_ITEMS);
      const mergedRecent = dedupeLaunches([...recent, ...fallback.recent]).slice(0, MAX_LIST_ITEMS);
      return { generatedAt, upcoming: mergedUpcoming, recent: mergedRecent };
    }
  }

  if ((upcoming.length || recent.length) && !rowsByBucket.upcoming.error && !rowsByBucket.recent.error) {
    return { generatedAt, upcoming, recent };
  }

  if (!upcoming.length && !recent.length) {
    const fallback = await fetchBlueOriginLaunchBucketsFromFlights(nowMs, generatedAt);
    if (fallback) return fallback;
  }

  return { generatedAt, upcoming, recent };
});

async function queryBlueOriginLaunchBucketRows(
  client: ReturnType<typeof createSupabasePublicClient> | ReturnType<typeof createSupabaseAdminClient>,
  nowIso: string
) {
  const [upcoming, recent, nullNet] = await Promise.all([
    client
      .from('launches_public_cache')
      .select('*')
      .or(BLUE_ORIGIN_OR_FILTER)
      .gte('net', nowIso)
      .order('net', { ascending: true })
      .limit(BLUE_ORIGIN_UPCOMING_LIMIT),
    client
      .from('launches_public_cache')
      .select('*')
      .or(BLUE_ORIGIN_OR_FILTER)
      .lt('net', nowIso)
      .order('net', { ascending: false })
      .limit(BLUE_ORIGIN_RECENT_LIMIT),
    client
      .from('launches_public_cache')
      .select('*')
      .or(BLUE_ORIGIN_OR_FILTER)
      .is('net', null)
      .limit(BLUE_ORIGIN_RECENT_LIMIT)
  ]);
  return { upcoming, recent, nullNet };
}

function shouldRetryBlueOriginBucketQuery(result: Awaited<ReturnType<typeof queryBlueOriginLaunchBucketRows>>) {
  if (result.upcoming.error || result.recent.error || result.nullNet.error) return true;
  const rowCount =
    (result.upcoming.data?.length || 0) +
    (result.recent.data?.length || 0) +
    (result.nullNet.data?.length || 0);
  return rowCount === 0;
}

export const fetchBlueOriginProgramSnapshot = withCache(async (): Promise<BlueOriginProgramSnapshot> => {
  const buckets = await fetchBlueOriginLaunchBuckets();
  const combined = [...buckets.upcoming, ...buckets.recent];

  return {
    generatedAt: buckets.generatedAt,
    lastUpdated: resolveLastUpdated(combined, buckets.generatedAt),
    nextLaunch: buckets.upcoming[0] || null,
    upcoming: buckets.upcoming,
    recent: buckets.recent,
    faq: buildBlueOriginFaq('program')
  };
});

export const fetchBlueOriginMissionSnapshot = withCache(
  async (missionKey: BlueOriginMissionKey): Promise<BlueOriginMissionSnapshot> => {
  const buckets = await fetchBlueOriginLaunchBuckets();
  const relevant = (launch: Launch) => {
    if (missionKey === 'blue-origin-program') return true;
    return getBlueOriginMissionKeyFromLaunch(launch) === missionKey;
  };

  const upcoming = buckets.upcoming.filter(relevant).slice(0, MAX_LIST_ITEMS);
  const recent = buckets.recent.filter(relevant).slice(0, MAX_LIST_ITEMS);
  const combined = dedupeLaunches([...upcoming, ...recent]);
  const nextLaunch = upcoming[0] || null;

  return {
    generatedAt: buckets.generatedAt,
    lastUpdated: resolveLastUpdated(combined.length ? combined : [...buckets.upcoming, ...buckets.recent], buckets.generatedAt),
    missionKey,
    missionName: MISSION_LABELS[missionKey],
    nextLaunch,
    upcoming,
    recent,
    highlights: buildMissionHighlights(combined, missionKey),
    changes: buildBlueOriginChanges(combined),
    faq: buildBlueOriginFaq('mission', { missionKey })
  };
  }
);

export const fetchBlueOriginFlightIndex = withCache(async (): Promise<BlueOriginFlightIndexEntry[]> => {
  const buckets = await fetchBlueOriginLaunchBuckets();
  const byFlight = new Map<
    string,
    {
      missionKey: BlueOriginMissionKey;
      upcoming: Launch[];
      recent: Launch[];
      nextLaunch: Launch | null;
      lastUpdated: string | null;
    }
  >();

  for (const launch of buckets.upcoming) {
    const flightCode = extractBlueOriginFlightCode(launch);
    if (!flightCode) continue;

    const existing =
      byFlight.get(flightCode) ||
      ({
        missionKey: getBlueOriginMissionKeyFromLaunch(launch) || 'blue-origin-program',
        upcoming: [],
        recent: [],
        nextLaunch: null,
        lastUpdated: null
      } as const);

    const mutable = {
      missionKey: existing.missionKey,
      upcoming: [...existing.upcoming, launch],
      recent: existing.recent,
      nextLaunch: existing.nextLaunch || launch,
      lastUpdated: maxIso(existing.lastUpdated, resolveLaunchIso(launch))
    };

    byFlight.set(flightCode, mutable);
  }

  for (const launch of buckets.recent) {
    const flightCode = extractBlueOriginFlightCode(launch);
    if (!flightCode) continue;

    const existing =
      byFlight.get(flightCode) ||
      ({
        missionKey: getBlueOriginMissionKeyFromLaunch(launch) || 'blue-origin-program',
        upcoming: [],
        recent: [],
        nextLaunch: null,
        lastUpdated: null
      } as const);

    const mutable = {
      missionKey: existing.missionKey,
      upcoming: existing.upcoming,
      recent: [...existing.recent, launch],
      nextLaunch: existing.nextLaunch,
      lastUpdated: maxIso(existing.lastUpdated, resolveLaunchIso(launch))
    };

    byFlight.set(flightCode, mutable);
  }

  return [...byFlight.entries()]
    .sort(([a], [b]) => compareFlightCodes(a, b))
    .slice(0, MAX_FLIGHTS)
    .map(([flightCode, value]) => {
      const flightSlug = buildBlueOriginFlightSlug(flightCode);
      const missionLabel = MISSION_LABELS[value.missionKey] || 'Blue Origin';
      return {
        flightCode,
        flightSlug,
        missionKey: value.missionKey,
        missionLabel,
        label: `${flightCode.toUpperCase()} • ${missionLabel}`,
        nextLaunch: value.nextLaunch,
        upcomingCount: value.upcoming.length,
        recentCount: value.recent.length,
        lastUpdated: value.lastUpdated
      };
    });
});

export const fetchBlueOriginFlightSnapshotBySlug = withCache(
  async (flightSlug: string): Promise<BlueOriginFlightSnapshot | null> => {
  const parsed = parseBlueOriginFlightSlug(flightSlug);
  if (!parsed) return null;

  const buckets = await fetchBlueOriginLaunchBuckets();
  const combined = dedupeLaunches([...buckets.upcoming, ...buckets.recent]);
  const matches = combined.filter((launch) => extractBlueOriginFlightCode(launch) === parsed);
  if (!matches.length) return null;

  const sorted = [...matches].sort((a, b) => Date.parse(b.net) - Date.parse(a.net));
  const launch = sorted[0] || null;
  const missionKey = (launch ? getBlueOriginMissionKeyFromLaunch(launch) : null) || (parsed.startsWith('ns-') ? 'new-shepard' : 'new-glenn');
  const missionName = MISSION_LABELS[missionKey];

  const recent = sorted.slice(0, MAX_LIST_ITEMS);
  const nextLaunch = recent.find((entry) => Date.parse(entry.net) >= Date.now()) || null;
  const displayLaunch = nextLaunch || recent[0] || null;

  return {
    generatedAt: buckets.generatedAt,
    lastUpdated: resolveLastUpdated(recent, buckets.generatedAt),
    missionKey,
    missionName,
    flightCode: parsed,
    flightSlug: buildBlueOriginFlightSlug(parsed),
    nextLaunch,
    launch: displayLaunch,
    recent,
    highlights: buildMissionHighlights(recent, missionKey),
    faq: buildBlueOriginFaq('flight', { flightCode: parsed, missionKey })
  };
  }
);

export function buildBlueOriginFaq(
  scope: 'program' | 'mission' | 'flight',
  context: { missionKey?: BlueOriginMissionKey; flightCode?: string } = {}
): BlueOriginFaqItem[] {
  if (scope === 'program') {
    return [
      {
        question: 'What does the Blue Origin Program page track?',
        answer:
          'It tracks Blue Origin mission timelines, launch schedule signals, notable flight history, passenger and payload records, media evidence, and public contracting milestones.'
      },
      {
        question: 'How often is Blue Origin data refreshed?',
        answer:
          'Blue Origin ingest jobs run weekly in a chained sequence, with a 90-minute gap between each job, beginning Monday at 00:00 UTC.'
      },
      {
        question: 'Which systems are covered?',
        answer:
          'Coverage includes New Shepard, New Glenn, Blue Moon, Blue Ring, and BE-4, with New Shepard receiving the deepest flight, passenger, and payload detail.'
      }
    ];
  }

  if (scope === 'flight') {
    const flightLabel = context.flightCode ? context.flightCode.toUpperCase() : 'this flight';
    return [
      {
        question: `What is ${flightLabel}?`,
        answer: `${flightLabel} is a Blue Origin mission record with timeline context, launch status tracking, and evidence links collected from official and government-backed sources where available.`
      },
      {
        question: `Does ${flightLabel} include passengers and payloads?`,
        answer:
          'When these fields are present in the launch data feed or official material, this route surfaces them in structured sections and keeps historical records tied to the mission code.'
      }
    ];
  }

  const missionName = MISSION_LABELS[context.missionKey || 'blue-origin-program'];
  return [
    {
      question: `What does the ${missionName} page include?`,
      answer:
        `${missionName} coverage includes schedule visibility, recent and upcoming launches, timeline changes, and linked evidence for public updates.`
    },
    {
      question: 'How should I interpret NET launch timing?',
      answer:
        'NET means No Earlier Than. Dates and times can move due to readiness, weather, or range constraints, so this page tracks revisions and superseded schedule signals.'
    },
    {
      question: 'Are historical missions retained?',
      answer:
        'Yes. The page maintains notable historical entries so mission progression and schedule shifts can be viewed in context.'
    }
  ];
}

export function getBlueOriginMissionLabel(missionKey: BlueOriginMissionKey) {
  return MISSION_LABELS[missionKey];
}

function buildMissionHighlights(launches: Launch[], missionKey: BlueOriginMissionKey) {
  const highlights: string[] = [];

  for (const launch of launches) {
    const flightCode = extractBlueOriginFlightCode(launch);
    if (flightCode && !highlights.includes(flightCode.toUpperCase())) {
      highlights.push(`Flight: ${flightCode.toUpperCase()}`);
    }

    for (const crew of launch.crew || []) {
      const astronaut = crew?.astronaut?.trim();
      if (!astronaut) continue;
      const role = crew?.role?.trim();
      const value = role ? `${astronaut} (${role})` : astronaut;
      if (!highlights.includes(value)) highlights.push(value);
      if (highlights.length >= 10) return highlights;
    }

    for (const payload of launch.payloads || []) {
      const payloadName = payload?.name?.trim();
      if (!payloadName) continue;
      const value = `Payload: ${payloadName}`;
      if (!highlights.includes(value)) highlights.push(value);
      if (highlights.length >= 10) return highlights;
    }

    if (highlights.length >= 10) return highlights;
  }

  if (!highlights.length) {
    if (missionKey === 'new-shepard') {
      highlights.push('Suborbital crew and research mission tracking');
    }
    if (missionKey === 'new-glenn') {
      highlights.push('Orbital launch campaign readiness and mission cadence tracking');
    }
    if (missionKey === 'blue-moon') {
      highlights.push('Lunar systems mission planning milestones');
    }
    if (missionKey === 'blue-ring') {
      highlights.push('In-space logistics and mission utility vehicle development milestones');
    }
    if (missionKey === 'be-4') {
      highlights.push('Engine program milestones and deployment context');
    }
  }

  return highlights.slice(0, 10);
}

function buildBlueOriginChanges(launches: Launch[]) {
  const mapped = launches
    .map((launch): BlueOriginChangeItem | null => {
      const date = resolveLaunchIso(launch);
      if (!date) return null;
      const status = launch.statusText?.trim() || launch.status || 'Status pending';
      const when = formatDateLabel(launch.net);
      return {
        title: launch.name,
        summary: `Status: ${status}. NET: ${when}.`,
        date,
        href: buildLaunchHref(launch)
      };
    })
    .filter((entry): entry is BlueOriginChangeItem => Boolean(entry));

  mapped.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return mapped.slice(0, MAX_CHANGES);
}

function dedupeLaunches(launches: Launch[]) {
  const dedupedByKey = new Map<string, Launch>();
  for (const launch of launches) {
    const key = toLaunchDedupeKey(launch);
    const existing = dedupedByKey.get(key);
    if (!existing) {
      dedupedByKey.set(key, launch);
      continue;
    }

    if (compareLaunchPreference(launch, existing) > 0) {
      dedupedByKey.set(key, launch);
    }
  }
  return [...dedupedByKey.values()];
}

function toLaunchDedupeKey(launch: Launch) {
  const flightCode = extractBlueOriginFlightCode(launch);
  if (flightCode) return `flight:${flightCode}`;

  const ll2Id = (launch.ll2Id || '').trim().toLowerCase();
  if (ll2Id) return `ll2:${ll2Id}`;

  const launchId = (launch.id || '').trim().toLowerCase();
  if (launchId) return `id:${launchId}`;

  const name = (launch.name || '').trim().toLowerCase();
  const net = normalizeDateKey(launch.net) || launch.net;
  return `name:${name}:${net}`;
}

function normalizeDateKey(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function compareLaunchPreference(candidate: Launch, current: Launch) {
  const candidateFreshness = resolvePreferenceMs(candidate);
  const currentFreshness = resolvePreferenceMs(current);
  if (candidateFreshness !== currentFreshness) {
    return candidateFreshness - currentFreshness;
  }

  const candidateRichness = resolveLaunchRichness(candidate);
  const currentRichness = resolveLaunchRichness(current);
  if (candidateRichness !== currentRichness) {
    return candidateRichness - currentRichness;
  }

  const candidateNet = Date.parse(candidate.net || '');
  const currentNet = Date.parse(current.net || '');
  if (Number.isFinite(candidateNet) && Number.isFinite(currentNet) && candidateNet !== currentNet) {
    return candidateNet - currentNet;
  }

  return 0;
}

function resolvePreferenceMs(launch: Launch) {
  const cacheGeneratedAtMs = Date.parse(launch.cacheGeneratedAt || '');
  const lastUpdatedMs = Date.parse(launch.lastUpdated || '');
  const cacheValue = Number.isFinite(cacheGeneratedAtMs) ? cacheGeneratedAtMs : 0;
  const updatedValue = Number.isFinite(lastUpdatedMs) ? lastUpdatedMs : 0;
  return Math.max(cacheValue, updatedValue);
}

function resolveLaunchRichness(launch: Launch) {
  let score = 0;
  if ((launch.ll2Id || '').trim()) score += 6;
  if ((launch.id || '').trim()) score += 2;
  if ((launch.statusText || '').trim()) score += 2;
  if ((launch.status || '').trim()) score += 1;
  if ((launch.pad?.name || '').trim()) score += 1;
  if ((launch.provider || '').trim()) score += 1;
  if ((launch.vehicle || '').trim()) score += 1;
  score += Math.min(launch.crew?.length || 0, 4);
  score += Math.min(launch.payloads?.length || 0, 4);
  return score;
}

function resolveLastUpdated(launches: Launch[], fallbackIso: string) {
  const maxAllowedMs = Date.now() + LAST_UPDATED_MAX_FUTURE_MS;
  const candidates = launches
    .flatMap((launch) => [launch.cacheGeneratedAt, launch.lastUpdated, launch.net])
    .map((value) => toIsoOrNull(value))
    .filter((value): value is string => {
      if (!value) return false;
      const parsedMs = Date.parse(value);
      return Number.isFinite(parsedMs) && parsedMs <= maxAllowedMs;
    });

  if (!candidates.length) {
    const fallback = toIsoOrNull(fallbackIso);
    if (!fallback) return null;
    const parsedFallbackMs = Date.parse(fallback);
    return Number.isFinite(parsedFallbackMs) && parsedFallbackMs <= maxAllowedMs ? fallback : null;
  }

  return candidates.reduce((latest, current) => (Date.parse(current) > Date.parse(latest) ? current : latest));
}

function resolveLaunchIso(launch: Launch) {
  const candidates = [launch.cacheGeneratedAt, launch.lastUpdated, launch.net];
  for (const candidate of candidates) {
    const iso = toIsoOrNull(candidate);
    if (iso) return iso;
  }
  return null;
}

function maxIso(first: string | null, second: string | null) {
  if (!first) return second;
  if (!second) return first;
  return Date.parse(second) > Date.parse(first) ? second : first;
}

function toIsoOrNull(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}

function compareFlightCodes(a: string, b: string) {
  const parse = (value: string) => {
    const match = value.match(/^(ns|ng)-(\d{1,3})$/);
    if (!match?.[1] || !match?.[2]) return { family: value, number: 0 };
    return { family: match[1], number: Number(match[2]) };
  };

  const left = parse(a);
  const right = parse(b);
  if (left.family !== right.family) return left.family.localeCompare(right.family);
  return right.number - left.number;
}

async function fetchBlueOriginLaunchBucketsFromFlights(
  nowMs: number,
  generatedAt: string
): Promise<BlueOriginLaunchBuckets | null> {
  if (!isSupabaseConfigured()) return null;

  let queryResult = await queryBlueOriginFlightFallbackRows(createSupabasePublicClient());
  if ((queryResult.error || !queryResult.data?.length) && isSupabaseAdminConfigured()) {
    const adminResult = await queryBlueOriginFlightFallbackRows(createSupabaseAdminClient());
    if (!adminResult.error && Array.isArray(adminResult.data)) {
      queryResult = adminResult;
    }
  }
  const { data, error } = queryResult;

  if (error) {
    console.error('blue origin flight fallback query error', error);
    return null;
  }

  const fallbackLaunches = ((data || []) as BlueOriginFlightBucketRow[]).map((row) =>
    mapBlueOriginFlightRowToLaunch(row, generatedAt)
  );

  const upcoming = dedupeLaunches(
    fallbackLaunches.filter((launch) => {
      const netMs = Date.parse(launch.net);
      return Number.isFinite(netMs) && netMs >= nowMs;
    })
  ).slice(0, MAX_LIST_ITEMS);

  const recent = dedupeLaunches(
    fallbackLaunches.filter((launch) => {
      const netMs = Date.parse(launch.net);
      return Number.isFinite(netMs) && netMs < nowMs;
    })
  ).slice(0, MAX_LIST_ITEMS);

  if (!upcoming.length && !recent.length) return null;

  return { generatedAt, upcoming, recent };
}

async function queryBlueOriginFlightFallbackRows(
  client: ReturnType<typeof createSupabasePublicClient> | ReturnType<typeof createSupabaseAdminClient>
) {
  return await client
    .from('blue_origin_flights')
    .select('id,flight_code,mission_key,launch_id,ll2_launch_uuid,launch_name,launch_date,status,metadata,updated_at')
    .order('launch_date', { ascending: false, nullsFirst: false })
    .order('flight_code', { ascending: true })
    .limit(BLUE_ORIGIN_FLIGHT_FALLBACK_LIMIT);
}

function mapBlueOriginFlightRowToLaunch(row: BlueOriginFlightBucketRow, generatedAt: string): Launch {
  const missionKey = normalizeMissionKey(row.mission_key);
  const missionLabel = MISSION_LABELS[missionKey] || 'Blue Origin';
  const missionName = missionLabel;
  const flightCode = row.flight_code.trim();
  const normalizedName = flightCode ? `${flightCode.toUpperCase()} • ${missionName}` : missionName;
  const metadata = isObjectMetadata(row.metadata) ? row.metadata : {};
  const statusText = normalizeBlueOriginFlightText(String(metadata.statusAbbrev || ''));
  const statusName = normalizeBlueOriginFlightText(String(metadata.statusName || ''));
  const status =
    mapBlueOriginFlightStatus(statusText || statusName || row.status);
  const sourceStatusText = statusText || statusName || row.status || 'Unknown';
  const provider = normalizeBlueOriginFlightText(String(metadata.provider || 'Blue Origin')) || 'Blue Origin';
  const sourceNet = normalizeBlueOriginFlightDate(row.launch_date || row.updated_at);
  const launchName = normalizeBlueOriginFlightText(row.launch_name || '') || normalizedName;
  const launchId = row.launch_id || row.ll2_launch_uuid || row.id;
  const rocketName =
    missionKey === 'new-shepard'
      ? 'New Shepard'
      : missionKey === 'new-glenn'
        ? 'New Glenn'
        : missionKey === 'blue-moon'
          ? 'Blue Moon'
          : missionKey === 'blue-ring'
            ? 'Blue Ring'
            : missionKey === 'be-4'
              ? 'BE-4 Program'
              : missionLabel;

  return {
    id: launchId,
    ll2Id: row.ll2_launch_uuid || launchId,
    name: launchName,
    provider,
    vehicle: rocketName,
    launchDesignator: flightCode || undefined,
    mission: {
      name: missionName
    },
    pad: {
      name: 'Blue Origin Launch Site',
      shortCode: 'BO',
      state: 'NA',
      timezone: 'America/New_York'
    },
    net: sourceNet,
    netPrecision: 'day',
    status,
    statusText: sourceStatusText,
    tier: 'routine',
    rocket: {
      fullName: rocketName
    },
    image: {
      thumbnail: DEFAULT_BLUE_ORIGIN_LAUNCH_IMAGE
    },
    cacheGeneratedAt: row.updated_at || generatedAt,
    lastUpdated: row.updated_at || generatedAt
  };
}

function normalizeMissionKey(value: string | null | undefined): BlueOriginMissionKey {
  const normalized = String(value || 'blue-origin-program')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');

  if (BLUE_ORIGIN_MISSIONS.includes(normalized as BlueOriginMissionKey)) {
    return normalized as BlueOriginMissionKey;
  }

  return 'blue-origin-program';
}

function mapBlueOriginFlightStatus(
  statusText: string | null | undefined
): Launch['status'] {
  const normalized = normalizeBlueOriginFlightText(statusText)?.toLowerCase() || '';

  if (
    /\bsuccess\b/.test(normalized) ||
    /\bgo\b/.test(normalized) ||
    /\blive\b/.test(normalized) ||
    /\bnominal\b/.test(normalized)
  ) {
    return 'go';
  }

  if (
    /\bscrub\b/.test(normalized) ||
    /\bcancel/.test(normalized) ||
    /\babort/.test(normalized) ||
    /\bfailed?\b/.test(normalized)
  ) {
    return 'scrubbed';
  }

  if (
    /\bhold\b/.test(normalized) ||
    /\bdelay\b/.test(normalized) ||
    /\bpostpon/.test(normalized) ||
    /\bweather/.test(normalized)
  ) {
    return 'hold';
  }

  if (/\btbd\b/.test(normalized) || /\bunknown\b/.test(normalized)) {
    return 'tbd';
  }

  return 'unknown';
}

function normalizeBlueOriginFlightText(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function normalizeBlueOriginFlightDate(value: string | null | undefined) {
  const normalized = normalizeBlueOriginFlightText(value);
  if (!normalized) return new Date().toISOString();
  return normalized;
}

function isObjectMetadata(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
