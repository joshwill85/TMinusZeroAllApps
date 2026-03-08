import { NextResponse } from 'next/server';
import {
  createSupabaseAdminClient,
  createSupabaseServerClient
} from '@/lib/server/supabaseServer';
import { mapPublicCacheRow } from '@/lib/server/transformers';
import { attachNextLaunchEvents } from '@/lib/server/ll2Events';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { parseLaunchRegion, US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import { buildStatusFilterOrClause, parseLaunchStatusFilter } from '@/lib/server/launchStatus';
import { buildPublicStateFilterOrClause } from '@/lib/server/usStates';
import { NEXT_LAUNCH_RETENTION_MS } from '@/lib/constants/launchTimeline';
import { isLaunchWithinMilestoneWindow } from '@/lib/utils/launchMilestones';
import type { Launch } from '@/lib/types/launch';

export const dynamic = 'force-dynamic';

const BOOSTER_QUERY_CHUNK_SIZE = 200;

type LaunchBoosterJoinRow = {
  ll2_launcher_id?: number | null;
  launch_id?: string | null;
  ll2_launch_uuid?: string | null;
};

type LaunchBoosterRow = {
  ll2_launcher_id?: number | null;
  serial_number?: string | null;
};

type PublicLaunchSort = 'soonest' | 'latest' | 'changed';

type PublicLaunchQueryArgs = {
  from: string | null;
  to: string | null;
  location: string | null;
  state: string | null;
  pad: string | null;
  provider: string | null;
  status: 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown' | null;
  sort: PublicLaunchSort;
  region: ReturnType<typeof parseLaunchRegion>;
  limit: number;
  offset: number;
};

type LaunchQueryClient =
  | ReturnType<typeof createSupabaseServerClient>
  | ReturnType<typeof createSupabaseAdminClient>;

type PublicLaunchQueryResult = {
  data: any[] | null;
  error: { message?: string | null; code?: string | null } | null;
  client: LaunchQueryClient;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = (searchParams.get('range') || '7d') as 'today' | '7d' | 'month' | 'year' | 'past' | 'all';
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');
  const location = searchParams.get('location');
  const state = searchParams.get('state');
  const pad = searchParams.get('pad');
  const provider = searchParams.get('provider');
  const status = parseLaunchStatusFilter(searchParams.get('status'));
  const sort = (searchParams.get('sort') || 'soonest') as PublicLaunchSort;
  const region = parseLaunchRegion(searchParams.get('region'));
  const freshness: 'public-cache-db' = 'public-cache-db';
  const intervalMinutes = 15;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const now = new Date();
  const parsedFrom = parseDateParam(fromParam);
  const parsedTo = parseDateParam(toParam);
  const { from, to } = resolveDateWindow({ range, parsedFrom, parsedTo, now });

  const limit = clampInt(limitParam, 100, 1, 1000);
  const offset = clampInt(offsetParam, 0, 0, 100_000);
  const queryArgs: PublicLaunchQueryArgs = {
    from,
    to,
    location,
    state,
    pad,
    provider,
    status,
    sort,
    region,
    limit,
    offset
  };

  const primaryResult = await executePublicLaunchQuery(
    createSupabaseServerClient(),
    queryArgs
  );
  let activeResult = primaryResult;

  if (shouldRetryWithAdmin(primaryResult, queryArgs) && isSupabaseAdminConfigured()) {
    const adminResult = await executePublicLaunchQuery(createSupabaseAdminClient(), queryArgs);
    if (!adminResult.error && Array.isArray(adminResult.data)) {
      activeResult = adminResult;
    }
  }

  const { data, error, client: queryClient } = activeResult;
  if (error || !data) {
    console.error('public cache query error', error);
    return NextResponse.json({ error: 'public_cache_query_failed' }, { status: 500 });
  }

  const hasMore = data.length === limit;
  const launches = data.map(mapPublicCacheRow);
  const launchesWithBoosters = await attachFirstStageBoosterLabels(queryClient, launches);
  const launchesWithEvents = await attachNextLaunchEvents(queryClient, launchesWithBoosters);
  const shouldFilterByMilestones = range !== 'past' && range !== 'all' && !parsedFrom && !parsedTo;
  const nowMs = Date.now();
  const launchesInWindow = shouldFilterByMilestones
    ? launchesWithEvents.filter((launch) =>
        isLaunchWithinMilestoneWindow(launch, nowMs, NEXT_LAUNCH_RETENTION_MS, {
          // Keep feed retention pinned to T+120 for "next launch" behavior.
          ignoreTimeline: true
        })
      )
    : launchesWithEvents;

  return NextResponse.json(
    {
      freshness,
      intervalMinutes,
      hasMore,
      launches: launchesInWindow
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400'
      }
    }
  );
}

async function executePublicLaunchQuery(
  client: LaunchQueryClient,
  args: PublicLaunchQueryArgs
): Promise<PublicLaunchQueryResult> {
  let query = client.from('launches_public_cache').select('*');
  if (args.region === 'us') {
    query = query.in('pad_country_code', US_PAD_COUNTRY_CODES);
  }
  if (args.region === 'non-us') {
    query = query.not('pad_country_code', 'in', `(${US_PAD_COUNTRY_CODES.join(',')})`);
  }

  if (args.from) query = query.gte('net', args.from);
  if (args.to) query = query.lt('net', args.to);
  if (args.location) query = query.eq('pad_location_name', args.location);
  if (args.state) query = query.or(buildPublicStateFilterOrClause(args.state));
  if (args.pad) query = query.eq('pad_name', args.pad);
  if (args.provider) query = query.eq('provider', args.provider);
  if (args.status) {
    const statusClause = buildStatusFilterOrClause(args.status);
    if (statusClause) query = query.or(statusClause);
  }

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

async function attachFirstStageBoosterLabels(client: LaunchQueryClient, launches: Launch[]): Promise<Launch[]> {
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
    const serial = normalizeText(row.serial_number) || `Core ${launcherId}`;
    serialByLauncherId.set(launcherId, serial);
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

function shouldRetryWithAdmin(result: PublicLaunchQueryResult, args: PublicLaunchQueryArgs) {
  if (result.error) return true;
  if (!Array.isArray(result.data)) return true;

  const hasFilters = Boolean(args.location || args.state || args.pad || args.provider || args.status);
  if (hasFilters) return false;

  return args.offset === 0 && result.data.length === 0;
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

function chunkArray<T>(items: T[], size: number) {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function resolveDateWindow({
  range,
  parsedFrom,
  parsedTo,
  now
}: {
  range: 'today' | '7d' | 'month' | 'year' | 'past' | 'all';
  parsedFrom: string | null;
  parsedTo: string | null;
  now: Date;
}) {
  if (parsedFrom || parsedTo) {
    return { from: parsedFrom, to: parsedTo };
  }

  if (range === 'all') {
    return { from: null, to: null };
  }

  if (range === 'past') {
    return { from: new Date('1960-01-01T00:00:00Z').toISOString(), to: now.toISOString() };
  }

  const days =
    range === 'today'
      ? 1
      : range === 'month'
        ? 30
        : range === 'year'
          ? 365
          : 7;
  const from = new Date(now.getTime() - NEXT_LAUNCH_RETENTION_MS).toISOString();
  const to = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  return { from, to };
}

function parseDateParam(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
