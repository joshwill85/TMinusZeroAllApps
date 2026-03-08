import { cache } from 'react';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { isArtemisIILaunch, isArtemisProgramLaunch } from '@/lib/utils/artemis';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { mapPublicCacheRow } from '@/lib/server/transformers';
import { resolveArtemisFaq } from '@/lib/content/faq/resolvers';
import type { Launch } from '@/lib/types/launch';
import type { ArtemisChangeItem, ArtemisFaqItem, ArtemisMissionSnapshot, ArtemisProgramSnapshot } from '@/lib/types/artemis';

const ARTEMIS_OR_FILTER = 'name.ilike.%Artemis%,mission_name.ilike.%Artemis%';
const ARTEMIS_UPCOMING_LIMIT = 120;
const ARTEMIS_RECENT_LIMIT = 120;
const MAX_LIST_ITEMS = 32;
const MAX_CHANGES = 8;
const LAST_UPDATED_MAX_FUTURE_MS = 5 * 60 * 1000;

export type ArtemisLaunchBuckets = {
  generatedAt: string;
  upcoming: Launch[];
  recent: Launch[];
};

export const fetchArtemisLaunchBuckets = cache(async (): Promise<ArtemisLaunchBuckets> => {
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
      .or(ARTEMIS_OR_FILTER)
      .gte('net', nowIso)
      .order('net', { ascending: true })
      .limit(ARTEMIS_UPCOMING_LIMIT),
    supabase
      .from('launches_public_cache')
      .select('*')
      .or(ARTEMIS_OR_FILTER)
      .lt('net', nowIso)
      .order('net', { ascending: false })
      .limit(ARTEMIS_RECENT_LIMIT)
  ]);

  if (upcomingRes.error || recentRes.error) {
    console.error('artemis snapshot query error', { upcoming: upcomingRes.error, recent: recentRes.error });
    return { generatedAt, upcoming: [], recent: [] };
  }

  const upcoming = dedupeLaunches((upcomingRes.data || []).map(mapPublicCacheRow).filter(isArtemisProgramLaunch)).slice(0, MAX_LIST_ITEMS);
  const recent = dedupeLaunches((recentRes.data || []).map(mapPublicCacheRow).filter(isArtemisProgramLaunch)).slice(0, MAX_LIST_ITEMS);

  return { generatedAt, upcoming, recent };
});

export function buildArtemisFaq(scope: 'program' | 'mission') {
  return resolveArtemisFaq(scope) as ArtemisFaqItem[];
}

export const fetchArtemisProgramSnapshot = cache(async (): Promise<ArtemisProgramSnapshot> => {
  const buckets = await fetchArtemisLaunchBuckets();
  const combined = [...buckets.upcoming, ...buckets.recent];
  return {
    generatedAt: buckets.generatedAt,
    lastUpdated: resolveLastUpdated(combined, buckets.generatedAt),
    nextLaunch: buckets.upcoming[0] || null,
    upcoming: buckets.upcoming,
    recent: buckets.recent,
    faq: buildArtemisFaq('program')
  };
});

export const fetchArtemisIISnapshot = cache(async (): Promise<ArtemisMissionSnapshot> => {
  const buckets = await fetchArtemisLaunchBuckets();
  const upcoming = buckets.upcoming.filter((launch) => isArtemisIILaunch(launch)).slice(0, MAX_LIST_ITEMS);
  const recent = buckets.recent.filter((launch) => isArtemisIILaunch(launch)).slice(0, MAX_LIST_ITEMS);
  const combined = [...upcoming, ...recent];
  const nextLaunch = upcoming[0] || null;
  const fallbackTimestamp = buckets.generatedAt;

  return {
    generatedAt: buckets.generatedAt,
    lastUpdated: resolveLastUpdated(combined.length ? combined : [...buckets.upcoming, ...buckets.recent], fallbackTimestamp),
    missionName: 'Artemis II (Artemis 2)',
    nextLaunch,
    upcoming,
    recent,
    crewHighlights: buildCrewHighlights(nextLaunch),
    changes: buildArtemisChanges(combined),
    faq: buildArtemisFaq('mission')
  };
});

function buildCrewHighlights(launch: Launch | null) {
  if (!launch || !Array.isArray(launch.crew)) return [];
  return launch.crew
    .map((entry) => {
      const astronaut = entry?.astronaut?.trim();
      const role = entry?.role?.trim();
      if (!astronaut) return null;
      return role ? `${astronaut} (${role})` : astronaut;
    })
    .filter(Boolean)
    .slice(0, 6) as string[];
}

function buildArtemisChanges(launches: Launch[]) {
  const mapped = launches
    .map((launch): ArtemisChangeItem | null => {
      const date = toIsoOrNull(launch.cacheGeneratedAt) || toIsoOrNull(launch.lastUpdated) || toIsoOrNull(launch.net);
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
    .filter((entry): entry is ArtemisChangeItem => Boolean(entry));

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
