import { cache } from 'react';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { mapPublicCacheRow } from '@/lib/server/transformers';
import { resolveStarshipFaq } from '@/lib/content/faq/resolvers';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import {
  buildStarshipFlightSlug,
  extractStarshipFlightNumber,
  isStarshipProgramLaunch,
  parseStarshipFlightSlug
} from '@/lib/utils/starship';
import type { Launch } from '@/lib/types/launch';
import type {
  StarshipChangeItem,
  StarshipFaqItem,
  StarshipFlightIndexEntry,
  StarshipFlightSnapshot,
  StarshipProgramSnapshot
} from '@/lib/types/starship';

const STARSHIP_OR_FILTER = [
  'name.ilike.%Starship%',
  'mission_name.ilike.%Starship%',
  'rocket_full_name.ilike.%Starship%',
  'vehicle.ilike.%Starship%',
  'name.ilike.%Super Heavy%',
  'mission_name.ilike.%Super Heavy%',
  'rocket_full_name.ilike.%Super Heavy%',
  'vehicle.ilike.%Super Heavy%'
].join(',');

const STARSHIP_UPCOMING_LIMIT = 160;
const STARSHIP_RECENT_LIMIT = 160;
const MAX_LIST_ITEMS = 40;
const MAX_CHANGES = 16;
const MAX_FLIGHTS = 32;
const LAST_UPDATED_MAX_FUTURE_MS = 5 * 60 * 1000;

export type StarshipLaunchBuckets = {
  generatedAt: string;
  upcoming: Launch[];
  recent: Launch[];
};

export const fetchStarshipLaunchBuckets = cache(async (): Promise<StarshipLaunchBuckets> => {
  const generatedAt = new Date().toISOString();
  if (!isSupabaseConfigured()) {
    return { generatedAt, upcoming: [], recent: [] };
  }

  const supabase = createSupabasePublicClient();
  const nowIso = new Date().toISOString();

  const [upcomingRes, recentRes] = await Promise.all([
    supabase
      .from('launches_public_cache')
      .select('*')
      .or(STARSHIP_OR_FILTER)
      .gte('net', nowIso)
      .order('net', { ascending: true })
      .limit(STARSHIP_UPCOMING_LIMIT),
    supabase
      .from('launches_public_cache')
      .select('*')
      .or(STARSHIP_OR_FILTER)
      .lt('net', nowIso)
      .order('net', { ascending: false })
      .limit(STARSHIP_RECENT_LIMIT)
  ]);

  if (upcomingRes.error || recentRes.error) {
    console.error('starship snapshot query error', {
      upcoming: upcomingRes.error,
      recent: recentRes.error
    });
    return { generatedAt, upcoming: [], recent: [] };
  }

  const upcoming = dedupeLaunches((upcomingRes.data || []).map(mapPublicCacheRow).filter(isStarshipProgramLaunch)).slice(0, MAX_LIST_ITEMS);
  const recent = dedupeLaunches((recentRes.data || []).map(mapPublicCacheRow).filter(isStarshipProgramLaunch)).slice(0, MAX_LIST_ITEMS);

  return { generatedAt, upcoming, recent };
});

export function buildStarshipFaq(scope: 'program' | 'flight', flightNumber?: number): StarshipFaqItem[] {
  return resolveStarshipFaq(scope, flightNumber) as StarshipFaqItem[];
}

export const fetchStarshipProgramSnapshot = cache(async (): Promise<StarshipProgramSnapshot> => {
  const buckets = await fetchStarshipLaunchBuckets();
  const combined = [...buckets.upcoming, ...buckets.recent];

  return {
    generatedAt: buckets.generatedAt,
    lastUpdated: resolveLastUpdated(combined, buckets.generatedAt),
    nextLaunch: buckets.upcoming[0] || null,
    upcoming: buckets.upcoming,
    recent: buckets.recent,
    faq: buildStarshipFaq('program')
  };
});

export const fetchStarshipFlightSnapshot = cache(async (flightNumber: number): Promise<StarshipFlightSnapshot> => {
  const normalizedFlightNumber = Math.max(1, Math.trunc(flightNumber));
  const buckets = await fetchStarshipLaunchBuckets();
  const upcoming = buckets.upcoming.filter((launch) => extractStarshipFlightNumber(launch) === normalizedFlightNumber).slice(0, MAX_LIST_ITEMS);
  const recent = buckets.recent.filter((launch) => extractStarshipFlightNumber(launch) === normalizedFlightNumber).slice(0, MAX_LIST_ITEMS);
  const combined = dedupeLaunches([...upcoming, ...recent]);
  const nextLaunch = upcoming[0] || null;
  const fallbackTimestamp = buckets.generatedAt;

  return {
    generatedAt: buckets.generatedAt,
    lastUpdated: resolveLastUpdated(combined.length ? combined : [...buckets.upcoming, ...buckets.recent], fallbackTimestamp),
    missionName: `Starship Flight ${normalizedFlightNumber}`,
    flightNumber: normalizedFlightNumber,
    flightSlug: buildStarshipFlightSlug(normalizedFlightNumber),
    nextLaunch,
    upcoming,
    recent,
    crewHighlights: buildFlightHighlights(nextLaunch),
    changes: buildStarshipChanges(combined),
    faq: buildStarshipFaq('flight', normalizedFlightNumber)
  };
});

export const fetchStarshipFlightSnapshotBySlug = cache(async (flightSlug: string) => {
  const flightNumber = parseStarshipFlightSlug(flightSlug);
  if (flightNumber == null) return null;
  return fetchStarshipFlightSnapshot(flightNumber);
});

export const fetchStarshipFlightIndex = cache(async (): Promise<StarshipFlightIndexEntry[]> => {
  const buckets = await fetchStarshipLaunchBuckets();
  const byFlight = new Map<
    number,
    {
      upcoming: Launch[];
      recent: Launch[];
      nextLaunch: Launch | null;
      lastUpdated: string | null;
    }
  >();

  for (const launch of buckets.upcoming) {
    const flightNumber = extractStarshipFlightNumber(launch);
    if (flightNumber == null) continue;
    const existing =
      byFlight.get(flightNumber) ||
      {
        upcoming: [],
        recent: [],
        nextLaunch: null,
        lastUpdated: null
      };

    existing.upcoming.push(launch);
    if (!existing.nextLaunch) {
      existing.nextLaunch = launch;
    }
    existing.lastUpdated = maxIso(existing.lastUpdated, resolveLaunchIso(launch));
    byFlight.set(flightNumber, existing);
  }

  for (const launch of buckets.recent) {
    const flightNumber = extractStarshipFlightNumber(launch);
    if (flightNumber == null) continue;
    const existing =
      byFlight.get(flightNumber) ||
      {
        upcoming: [],
        recent: [],
        nextLaunch: null,
        lastUpdated: null
      };

    existing.recent.push(launch);
    existing.lastUpdated = maxIso(existing.lastUpdated, resolveLaunchIso(launch));
    byFlight.set(flightNumber, existing);
  }

  return [...byFlight.entries()]
    .sort(([a], [b]) => b - a)
    .slice(0, MAX_FLIGHTS)
    .map(([flightNumber, value]) => ({
      flightNumber,
      flightSlug: buildStarshipFlightSlug(flightNumber),
      label: `Starship Flight ${flightNumber}`,
      nextLaunch: value.nextLaunch,
      upcomingCount: value.upcoming.length,
      recentCount: value.recent.length,
      lastUpdated: value.lastUpdated
    }));
});

function buildFlightHighlights(launch: Launch | null) {
  if (!launch) return [];

  const highlights: string[] = [];
  for (const payload of launch.payloads || []) {
    if (payload?.name?.trim()) highlights.push(payload.name.trim());
    if (highlights.length >= 6) return highlights;
  }

  const missionType = launch.mission?.type?.trim();
  if (missionType) highlights.push(`Mission type: ${missionType}`);
  const statusText = launch.statusText?.trim() || launch.status;
  if (statusText) highlights.push(`Status: ${statusText}`);
  if (launch.pad?.shortCode?.trim()) highlights.push(`Pad: ${launch.pad.shortCode.trim()}`);

  return highlights.slice(0, 6);
}

function buildStarshipChanges(launches: Launch[]) {
  const mapped = launches
    .map((launch): StarshipChangeItem | null => {
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
    .filter((entry): entry is StarshipChangeItem => Boolean(entry));

  mapped.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return mapped.slice(0, MAX_CHANGES);
}

function dedupeLaunches(launches: Launch[]) {
  const seen = new Set<string>();
  const deduped: Launch[] = [];
  for (const launch of launches) {
    if (seen.has(launch.id)) continue;
    seen.add(launch.id);
    deduped.push(launch);
  }
  return deduped;
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
