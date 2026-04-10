import { unstable_cache } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Launch } from '@/lib/types/launch';
import { NEXT_LAUNCH_RETENTION_MS } from '@/lib/constants/launchTimeline';
import { isSupabaseAdminConfigured } from '@/lib/server/env';
import { logLaunchRefreshDiagnostic } from '@/lib/server/launchRefreshDiagnostics';
import { attachNextLaunchEvents } from '@/lib/server/ll2Events';
import { buildStatusFilterOrClause } from '@/lib/server/launchStatus';
import { loadLaunchRefreshStateSeed } from '@/lib/server/launchRefreshState';
import { createSupabaseAdminClient, createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { mapPublicCacheRow } from '@/lib/server/transformers';
import { buildPublicStateFilterOrClause } from '@/lib/server/usStates';
import { US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import { isLaunchWithinMilestoneWindow } from '@/lib/utils/launchMilestones';

export type PublicLaunchFeedSort = 'soonest' | 'latest' | 'changed';
export type PublicLaunchFeedStatus = 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown' | null;
export type PublicLaunchFeedRegion = 'us' | 'non-us' | 'all';

export type PublicLaunchFeedArgs = {
  from: string | null;
  to: string | null;
  location: string | null;
  state: string | null;
  pad: string | null;
  padId: number | null;
  provider: string | null;
  providerId: number | null;
  rocketId: number | null;
  status: PublicLaunchFeedStatus;
  sort: PublicLaunchFeedSort;
  region: PublicLaunchFeedRegion;
  limit: number;
  offset: number;
};

type PublicLaunchQueryResult = {
  data: any[] | null;
  error: { message?: string | null; code?: string | null } | null;
  client: SupabaseClient;
};

type PublicLaunchPageResult = {
  launches: Launch[];
  rawLaunchCount: number;
  hasMore: boolean;
};

type PublicLaunchFeedVersionArgs = Omit<PublicLaunchFeedArgs, 'sort' | 'limit' | 'offset'>;

export type PublicLaunchFeedVersionSnapshot = {
  matchCount: number;
  updatedAt: string | null;
  version: string;
};

type LaunchBoosterJoinRow = {
  ll2_launcher_id?: number | null;
  launch_id?: string | null;
  ll2_launch_uuid?: string | null;
};

type LaunchBoosterRow = {
  ll2_launcher_id?: number | null;
  serial_number?: string | null;
};

const BOOSTER_QUERY_CHUNK_SIZE = 200;
const PUBLIC_LAUNCH_FEED_CACHE_REVALIDATE_SECONDS = 3600;
const PUBLIC_LAUNCH_FEED_TIME_BUCKET_MS = 60 * 1000;
const PUBLIC_LAUNCH_FEED_VERSION_CACHE_REVALIDATE_SECONDS = 3600;

export class PublicLaunchFeedError extends Error {
  readonly code: string;

  constructor(code = 'failed_to_load') {
    super(code);
    this.name = 'PublicLaunchFeedError';
    this.code = code;
  }
}

const loadCachedPublicLaunchPage = unstable_cache(
  async (
    args: PublicLaunchFeedArgs,
    cacheVersion: string,
    bucketNowMs: number,
    filterMilestones: boolean
  ): Promise<PublicLaunchPageResult> => {
    logLaunchRefreshDiagnostic('cache_fill', {
      layer: 'public_feed_payload',
      cacheVersion,
      bucketNowMs,
      sort: args.sort,
      region: args.region,
      status: args.status,
      provider: args.provider,
      state: args.state,
      limit: args.limit,
      offset: args.offset,
      filterMilestones
    });
    return loadPublicLaunchPageUncached(args, {
      nowMs: bucketNowMs,
      filterMilestones
    });
  },
  ['public-launch-feed-v2'],
  { revalidate: PUBLIC_LAUNCH_FEED_CACHE_REVALIDATE_SECONDS }
);

export async function loadPublicLaunchPage(
  args: PublicLaunchFeedArgs,
  options: { nowMs?: number; filterMilestones?: boolean } = {}
): Promise<PublicLaunchPageResult> {
  const versionSnapshot = await loadPublicLaunchFeedVersionSnapshot(args);
  const safeNowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const bucketNowMs = Math.floor(safeNowMs / PUBLIC_LAUNCH_FEED_TIME_BUCKET_MS) * PUBLIC_LAUNCH_FEED_TIME_BUCKET_MS;
  return loadCachedPublicLaunchPage(
    normalizePublicLaunchFeedArgs(args),
    versionSnapshot.version,
    bucketNowMs,
    options.filterMilestones !== false
  );
}

const loadCachedPublicLaunchFeedVersionSnapshot = unstable_cache(
  async (args: PublicLaunchFeedVersionArgs, refreshRevision: number) => {
    logLaunchRefreshDiagnostic('cache_fill', {
      layer: 'public_feed_version',
      refreshRevision,
      region: args.region,
      status: args.status,
      provider: args.provider,
      state: args.state
    });
    const client = createSupabasePublicClient();
    let countQuery = client.from('launches_public_cache').select('launch_id', { count: 'exact', head: true });
    countQuery = applyPublicLaunchVersionFilters(countQuery, args);

    const { count, error: countError } = await countQuery;
    if (countError) {
      console.error('public launches version count error', countError);
      throw new PublicLaunchFeedError();
    }

    let latestQuery = client.from('launches_public_cache').select('cache_generated_at').limit(1);
    latestQuery = applyPublicLaunchVersionFilters(latestQuery, args);

    const { data: latestRow, error: latestError } = await latestQuery
      .order('cache_generated_at', { ascending: false })
      .maybeSingle();
    if (latestError) {
      console.error('public launches version latest error', latestError);
      throw new PublicLaunchFeedError();
    }

    void refreshRevision;

    return {
      matchCount: count ?? 0,
      updatedAt: typeof latestRow?.cache_generated_at === 'string' ? latestRow.cache_generated_at : null
    };
  },
  ['public-launch-feed-version-v3'],
  { revalidate: PUBLIC_LAUNCH_FEED_VERSION_CACHE_REVALIDATE_SECONDS }
);

export async function loadPublicLaunchFeedVersionSnapshot(args: PublicLaunchFeedVersionArgs | PublicLaunchFeedArgs): Promise<PublicLaunchFeedVersionSnapshot> {
  const normalizedArgs = normalizePublicLaunchFeedVersionArgs(args);
  const refreshSeed = await loadLaunchRefreshStateSeed(createSupabasePublicClient(), 'feed_public');
  const snapshot = await loadCachedPublicLaunchFeedVersionSnapshot(normalizedArgs, refreshSeed.revision);
  const updatedAt = snapshot.updatedAt ?? refreshSeed.updatedAt ?? null;
  return {
    matchCount: snapshot.matchCount,
    updatedAt,
    version: buildPublicFeedVersionToken(snapshot.matchCount, updatedAt)
  };
}

async function loadPublicLaunchPageUncached(
  args: PublicLaunchFeedArgs,
  options: { nowMs?: number; filterMilestones?: boolean } = {}
): Promise<PublicLaunchPageResult> {
  const safeNowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const primaryResult = await executePublicLaunchQuery(createSupabasePublicClient(), args);
  let activeResult = primaryResult;

  if (shouldRetryWithAdmin(primaryResult, args) && isSupabaseAdminConfigured()) {
    const adminResult = await executePublicLaunchQuery(createSupabaseAdminClient(), args);
    if (!adminResult.error && Array.isArray(adminResult.data)) {
      activeResult = adminResult;
    }
  }

  const { data, error, client } = activeResult;
  if (error || !data) {
    console.error('public cache query error', error);
    throw new PublicLaunchFeedError();
  }

  const launches = data.map(mapPublicCacheRow);
  const launchesWithBoosters = await attachFirstStageBoosterLabels(client, launches);
  const launchesWithEvents = await attachNextLaunchEvents(client, launchesWithBoosters, safeNowMs);
  const launchesInWindow =
    options.filterMilestones === false
      ? launchesWithEvents
      : launchesWithEvents.filter((launch) =>
          isLaunchWithinMilestoneWindow(launch, safeNowMs, NEXT_LAUNCH_RETENTION_MS, {
            // Keep feed retention pinned to T+120 for "next launch" behavior.
            ignoreTimeline: true
          })
        );

  return {
    launches: launchesInWindow,
    rawLaunchCount: data.length,
    hasMore: data.length === args.limit
  };
}

function normalizePublicLaunchFeedArgs(args: PublicLaunchFeedArgs): PublicLaunchFeedArgs {
  return {
    from: normalizeText(args.from),
    to: normalizeText(args.to),
    location: normalizeText(args.location),
    state: normalizeText(args.state),
    pad: normalizeText(args.pad),
    padId: toBoundedInteger(args.padId, 1, Number.MAX_SAFE_INTEGER),
    provider: normalizeText(args.provider),
    providerId: toBoundedInteger(args.providerId, 1, Number.MAX_SAFE_INTEGER),
    rocketId: toBoundedInteger(args.rocketId, 1, Number.MAX_SAFE_INTEGER),
    status: args.status,
    sort: args.sort,
    region: args.region,
    limit: toBoundedInteger(args.limit, 1, 1000) ?? 20,
    offset: toBoundedInteger(args.offset, 0, 100_000) ?? 0
  };
}

function normalizePublicLaunchFeedVersionArgs(
  args: PublicLaunchFeedVersionArgs | PublicLaunchFeedArgs
): PublicLaunchFeedVersionArgs {
  return {
    from: normalizeText(args.from),
    to: normalizeText(args.to),
    location: normalizeText(args.location),
    state: normalizeText(args.state),
    pad: normalizeText(args.pad),
    padId: toBoundedInteger(args.padId, 1, Number.MAX_SAFE_INTEGER),
    provider: normalizeText(args.provider),
    providerId: toBoundedInteger(args.providerId, 1, Number.MAX_SAFE_INTEGER),
    rocketId: toBoundedInteger(args.rocketId, 1, Number.MAX_SAFE_INTEGER),
    status: args.status,
    region: args.region
  };
}

async function executePublicLaunchQuery(
  client: SupabaseClient,
  args: PublicLaunchFeedArgs
): Promise<PublicLaunchQueryResult> {
  let query = client.from('launches_public_cache').select('*');
  query = applyPublicLaunchVersionFilters(query, args);

  query =
    args.sort === 'changed'
      ? query.order('cache_generated_at', { ascending: false })
      : args.sort === 'latest'
        ? query.order('net', { ascending: false })
        : query.order('net', { ascending: true });
  query = query.range(args.offset, args.offset + args.limit - 1);

  const { data, error } = await query;
  return {
    data: (data || null) as any[] | null,
    error: (error || null) as PublicLaunchQueryResult['error'],
    client
  };
}

function applyPublicLaunchVersionFilters(query: any, args: PublicLaunchFeedVersionArgs | PublicLaunchFeedArgs) {
  let next = query;
  if (args.region === 'us') {
    next = next.in('pad_country_code', US_PAD_COUNTRY_CODES);
  }
  if (args.region === 'non-us') {
    next = next.not('pad_country_code', 'in', `(${US_PAD_COUNTRY_CODES.join(',')})`);
  }

  if (args.from) next = next.gte('net', args.from);
  if (args.to) next = next.lt('net', args.to);
  if (args.location) next = next.eq('pad_location_name', args.location);
  if (args.state) next = next.or(buildPublicStateFilterOrClause(args.state));
  if (args.pad) next = next.eq('pad_name', args.pad);
  if (args.padId != null) next = next.eq('ll2_pad_id', args.padId);
  if (args.provider) next = next.eq('provider', args.provider);
  if (args.providerId != null) next = next.eq('ll2_agency_id', args.providerId);
  if (args.rocketId != null) next = next.eq('ll2_rocket_config_id', args.rocketId);
  if (args.status) {
    const statusClause = buildStatusFilterOrClause(args.status);
    if (statusClause) next = next.or(statusClause);
  }

  return next;
}

function buildPublicFeedVersionToken(matchCount: number, updatedAt: string | null) {
  return `${matchCount}|${updatedAt ?? 'null'}`;
}

function shouldRetryWithAdmin(result: PublicLaunchQueryResult, args: PublicLaunchFeedArgs) {
  if (result.error) return true;
  if (!Array.isArray(result.data)) return true;

  const hasFilters = Boolean(
    args.location || args.state || args.pad || args.padId != null || args.provider || args.providerId != null || args.rocketId != null || args.status
  );
  if (hasFilters) return false;

  return args.offset === 0 && result.data.length === 0;
}

async function attachFirstStageBoosterLabels(client: SupabaseClient, launches: Launch[]): Promise<Launch[]> {
  if (!launches.length) return launches;

  const launchIds = uniqueStrings(launches.map((launch) => normalizeText(launch.id)));
  const ll2LaunchUuids = uniqueStrings(launches.map((launch) => normalizeText(launch.ll2Id)));
  if (!launchIds.length && !ll2LaunchUuids.length) return launches;

  const joinRows: LaunchBoosterJoinRow[] = [];
  for (const chunk of chunkArray(launchIds, BOOSTER_QUERY_CHUNK_SIZE)) {
    if (!chunk.length) continue;
    const { data, error } = await client
      .from('ll2_launcher_launches')
      .select('ll2_launcher_id, launch_id, ll2_launch_uuid')
      .in('launch_id', chunk);
    if (error) {
      console.warn('booster join query error (launch_id)', error);
      return launches;
    }
    (data || []).forEach((row) => joinRows.push(row as LaunchBoosterJoinRow));
  }

  for (const chunk of chunkArray(ll2LaunchUuids, BOOSTER_QUERY_CHUNK_SIZE)) {
    if (!chunk.length) continue;
    const { data, error } = await client
      .from('ll2_launcher_launches')
      .select('ll2_launcher_id, launch_id, ll2_launch_uuid')
      .in('ll2_launch_uuid', chunk);
    if (error) {
      console.warn('booster join query error (ll2_launch_uuid)', error);
      return launches;
    }
    (data || []).forEach((row) => joinRows.push(row as LaunchBoosterJoinRow));
  }

  if (!joinRows.length) return launches;

  const launcherIds = uniqueNumbers(joinRows.map((row) => toFiniteNumber(row.ll2_launcher_id)));
  if (!launcherIds.length) return launches;

  const launcherRows: LaunchBoosterRow[] = [];
  for (const chunk of chunkArray(launcherIds, BOOSTER_QUERY_CHUNK_SIZE)) {
    if (!chunk.length) continue;
    const { data, error } = await client.from('ll2_launchers').select('ll2_launcher_id, serial_number').in('ll2_launcher_id', chunk);
    if (error) {
      console.warn('booster launcher query error', error);
      return launches;
    }
    (data || []).forEach((row) => launcherRows.push(row as LaunchBoosterRow));
  }

  const serialByLauncherId = new Map<number, string>();
  for (const row of launcherRows) {
    const launcherId = toFiniteNumber(row.ll2_launcher_id);
    if (launcherId == null) continue;
    serialByLauncherId.set(launcherId, normalizeText(row.serial_number) || `Core ${launcherId}`);
  }

  const labelsByLaunchId = new Map<string, Set<string>>();
  const labelsByLl2LaunchUuid = new Map<string, Set<string>>();
  for (const row of joinRows) {
    const launcherId = toFiniteNumber(row.ll2_launcher_id);
    if (launcherId == null) continue;
    const serial = serialByLauncherId.get(launcherId) || `Core ${launcherId}`;
    const launchId = normalizeText(row.launch_id);
    if (launchId) addToLabelMap(labelsByLaunchId, launchId, serial);
    const ll2LaunchUuid = normalizeText(row.ll2_launch_uuid);
    if (ll2LaunchUuid) addToLabelMap(labelsByLl2LaunchUuid, ll2LaunchUuid, serial);
  }

  return launches.map((launch) => {
    const labels = new Set<string>();
    getExistingBoosterLabels(launch.firstStageBooster).forEach((label) => labels.add(label));
    const launchId = normalizeText(launch.id);
    if (launchId) {
      const byLaunchId = labelsByLaunchId.get(launchId);
      if (byLaunchId) byLaunchId.forEach((label) => labels.add(label));
    }
    const ll2LaunchUuid = normalizeText(launch.ll2Id);
    if (ll2LaunchUuid) {
      const byLl2LaunchUuid = labelsByLl2LaunchUuid.get(ll2LaunchUuid);
      if (byLl2LaunchUuid) byLl2LaunchUuid.forEach((label) => labels.add(label));
    }
    if (!labels.size) return launch;
    return {
      ...launch,
      firstStageBooster: Array.from(labels).sort((left, right) => left.localeCompare(right, undefined, { numeric: true })).join(', ')
    };
  });
}

function getExistingBoosterLabels(value: string | null | undefined) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function addToLabelMap(map: Map<string, Set<string>>, key: string, value: string) {
  const existing = map.get(key);
  if (existing) {
    existing.add(value);
    return;
  }
  map.set(key, new Set([value]));
}

function uniqueStrings(values: Array<string | null>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function uniqueNumbers(values: Array<number | null>) {
  return Array.from(new Set(values.filter((value): value is number => Number.isFinite(value))));
}

function normalizeText(value: string | null | undefined) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function toFiniteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function toBoundedInteger(value: unknown, min: number, max: number) {
  const numeric = toFiniteNumber(value);
  if (numeric == null) return null;
  const whole = Math.trunc(numeric);
  if (whole < min || whole > max) return null;
  return whole;
}

function chunkArray<T>(items: T[], size: number) {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
