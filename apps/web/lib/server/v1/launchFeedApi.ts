import { changedLaunchesSchemaV1, launchFeedSchemaV1 } from '@tminuszero/contracts';
import type { Launch } from '@/lib/types/launch';
import { NEXT_LAUNCH_RETENTION_MS } from '@/lib/constants/launchTimeline';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { attachNextLaunchEvents } from '@/lib/server/ll2Events';
import { buildStatusFilterOrClause, parseLaunchStatusFilter } from '@/lib/server/launchStatus';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { mapLiveLaunchRow, mapPublicCacheRow } from '@/lib/server/transformers';
import { parseLaunchRegion, US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import { buildPublicStateFilterOrClause } from '@/lib/server/usStates';
import { getViewerTier, type ViewerTierInfo } from '@/lib/server/viewerTier';
import { isLaunchWithinMilestoneWindow } from '@/lib/utils/launchMilestones';

const DEFAULT_PUBLIC_FRESHNESS = 'public-cache-db';
const DEFAULT_PUBLIC_INTERVAL_MINUTES = 15;
const BOOSTER_QUERY_CHUNK_SIZE = 200;
const STATUS_FIELDS = new Set(['status_abbrev', 'status_name', 'status_id']);
const TIMING_FIELDS = new Set(['net', 'net_precision', 'window_start', 'window_end']);
const OPERATIONS_FIELDS = new Set(['probability', 'hold_reason', 'fail_reason']);
const DETAILS_FIELDS = new Set(['programs', 'crew', 'payloads', 'timeline']);
const CHANGELOG_FIELDS = new Set([...STATUS_FIELDS, ...TIMING_FIELDS, ...OPERATIONS_FIELDS, ...DETAILS_FIELDS]);

type LaunchFeedScope = 'public' | 'live' | 'watchlist';
type LaunchFeedSort = 'soonest' | 'latest' | 'changed';
type LaunchRange = 'today' | '7d' | 'month' | 'year' | 'past' | 'all';
type LaunchStatusFilter = 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown' | null;
type FeedRegion = ReturnType<typeof parseLaunchRegion>;
type LaunchQueryClient = ReturnType<typeof createSupabaseServerClient> | ReturnType<typeof createSupabaseAdminClient>;

type FeedRequest = {
  scope: LaunchFeedScope;
  watchlistId: string | null;
  range: LaunchRange;
  from: string | null;
  to: string | null;
  location: string | null;
  state: string | null;
  pad: string | null;
  provider: string | null;
  status: LaunchStatusFilter;
  sort: LaunchFeedSort;
  region: FeedRegion;
  limit: number;
  offset: number;
};

type PublicLaunchQueryResult = {
  data: any[] | null;
  error: { message?: string | null; code?: string | null } | null;
  client: LaunchQueryClient;
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

export class LaunchFeedApiRouteError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.name = 'LaunchFeedApiRouteError';
    this.status = status;
    this.code = code;
  }
}

export async function loadVersionedLaunchFeedPayload(request: Request) {
  const feedRequest = parseFeedRequest(request);

  if (!isSupabaseConfigured()) {
    if (feedRequest.scope === 'public') {
      return launchFeedSchemaV1.parse({
        launches: [],
        nextCursor: null,
        hasMore: false,
        freshness: DEFAULT_PUBLIC_FRESHNESS,
        intervalMinutes: DEFAULT_PUBLIC_INTERVAL_MINUTES,
        intervalSeconds: null,
        tier: null,
        scope: 'public'
      });
    }

    throw new LaunchFeedApiRouteError(503, 'supabase_not_configured');
  }

  if (feedRequest.scope === 'public') {
    return loadPublicFeed(feedRequest);
  }

  const viewer = await getViewerTier({ request, reconcileStripe: false });
  if (feedRequest.scope === 'live') {
    return loadLiveFeed(feedRequest, viewer);
  }

  return loadWatchlistFeed(feedRequest, viewer);
}

export async function loadVersionedChangedLaunchesPayload(request: Request) {
  const viewer = await getViewerTier({ request, reconcileStripe: false });
  if (!viewer.isAuthed) {
    throw new LaunchFeedApiRouteError(401, 'unauthorized');
  }
  if (!viewer.isAdmin && viewer.tier !== 'premium') {
    throw new LaunchFeedApiRouteError(402, 'payment_required');
  }
  if (!isSupabaseAdminConfigured()) {
    throw new LaunchFeedApiRouteError(503, 'supabase_admin_not_configured');
  }

  const { searchParams } = new URL(request.url);
  const hours = clampNumber(Number(searchParams.get('hours') || 24), 1, 168);
  const region = parseLaunchRegion(searchParams.get('region'));
  const supabase = createSupabaseAdminClient();
  const sinceIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from('launch_updates')
    .select('id, detected_at, changed_fields, old_values, new_values, launch_id, launches!inner(name, hidden, pad_timezone)')
    .gte('detected_at', sinceIso)
    .eq('launches.hidden', false);
  if (region === 'us') query = query.in('launches.pad_country_code', US_PAD_COUNTRY_CODES);
  if (region === 'non-us') query = query.not('launches.pad_country_code', 'in', `(${US_PAD_COUNTRY_CODES.join(',')})`);

  const { data, error } = await query.order('detected_at', { ascending: false }).limit(25);
  if (error) {
    console.error('changed launches fetch error', error);
    throw new LaunchFeedApiRouteError(500, 'failed_to_load');
  }

  const grouped = new Map<
    string,
    {
      launchId: string;
      name: string;
      summary: string;
      lastUpdated?: string;
      lastUpdatedLabel?: string;
      padTimezone: string | null;
      entries: Array<{
        updateId: string;
        changeSummary?: string;
        updatedFields: string[];
        detectedAt?: string;
        detectedLabel?: string;
        details?: string[];
      }>;
    }
  >();

  (data || []).forEach((row: any) => {
    const launchId = String(row.launch_id || '');
    if (!launchId) return;
    const filteredFields = filterChangelogFields(row.changed_fields ?? []);
    if (filteredFields.length === 0) return;
    const padTimezone = row.launches?.pad_timezone || null;

    const update = {
      updateId: String(row.id ?? `${launchId}:${row.detected_at ?? ''}`),
      updatedFields: filteredFields,
      changeSummary: summarizeChangedFields(filteredFields),
      detectedAt: row.detected_at ?? undefined,
      detectedLabel: formatLocalTimeLabel(row.detected_at, padTimezone) || undefined,
      details: buildChangeDetails({
        fields: filteredFields,
        oldValues: row.old_values ?? null,
        newValues: row.new_values ?? null,
        timezone: padTimezone
      })
    };

    const existing = grouped.get(launchId);
    if (existing) {
      existing.entries.push(update);
      if (!existing.lastUpdated || (update.detectedAt && update.detectedAt > existing.lastUpdated)) {
        existing.lastUpdated = update.detectedAt;
      }
      return;
    }

    grouped.set(launchId, {
      launchId,
      name: row.launches?.name ?? 'Launch',
      summary: '',
      lastUpdated: update.detectedAt,
      lastUpdatedLabel: update.detectedLabel,
      padTimezone,
      entries: [update]
    });
  });

  const results = Array.from(grouped.values())
    .map((group) => {
      const entries = group.entries.sort((left, right) => {
        const leftTime = left.detectedAt ? Date.parse(left.detectedAt) : 0;
        const rightTime = right.detectedAt ? Date.parse(right.detectedAt) : 0;
        return rightTime - leftTime;
      });
      const combinedFields = entries.flatMap((entry) => entry.updatedFields || []);
      return {
        launchId: group.launchId,
        name: group.name,
        summary: summarizeChangedFields(combinedFields),
        lastUpdated: group.lastUpdated,
        lastUpdatedLabel:
          entries[0]?.detectedLabel ||
          (group.lastUpdated ? formatLocalTimeLabel(group.lastUpdated, group.padTimezone) || undefined : undefined),
        entries
      };
    })
    .sort((left, right) => {
      const leftTime = left.lastUpdated ? Date.parse(left.lastUpdated) : 0;
      const rightTime = right.lastUpdated ? Date.parse(right.lastUpdated) : 0;
      return rightTime - leftTime;
    });

  return changedLaunchesSchemaV1.parse({
    hours,
    tier: viewer.tier,
    intervalSeconds: viewer.refreshIntervalSeconds,
    results
  });
}

async function loadPublicFeed(feedRequest: FeedRequest) {
  const queryResult = await executePublicLaunchQuery(createSupabaseServerClient(), feedRequest);
  const { data, error, client } = queryResult;
  if (error || !data) {
    console.error('public cache query error', error);
    throw new LaunchFeedApiRouteError(500, 'failed_to_load');
  }

  const launches = data.map(mapPublicCacheRow);
  const launchesWithBoosters = await attachFirstStageBoosterLabels(client, launches);
  const launchesWithEvents = await attachNextLaunchEvents(client, launchesWithBoosters);
  const shouldFilterByMilestones = feedRequest.range !== 'past' && feedRequest.range !== 'all';
  const nowMs = Date.now();
  const launchesInWindow = shouldFilterByMilestones
    ? launchesWithEvents.filter((launch) =>
        isLaunchWithinMilestoneWindow(launch, nowMs, NEXT_LAUNCH_RETENTION_MS, {
          ignoreTimeline: true
        })
      )
    : launchesWithEvents;

  return launchFeedSchemaV1.parse({
    launches: launchesInWindow,
    nextCursor: data.length === feedRequest.limit ? String(feedRequest.offset + launchesInWindow.length) : null,
    hasMore: data.length === feedRequest.limit,
    freshness: DEFAULT_PUBLIC_FRESHNESS,
    intervalMinutes: DEFAULT_PUBLIC_INTERVAL_MINUTES,
    intervalSeconds: null,
    tier: null,
    scope: 'public'
  });
}

async function loadLiveFeed(feedRequest: FeedRequest, viewer: ViewerTierInfo) {
  if (!viewer.isAuthed) {
    throw new LaunchFeedApiRouteError(401, 'unauthorized');
  }
  if (!viewer.isAdmin && viewer.tier !== 'premium') {
    throw new LaunchFeedApiRouteError(402, 'payment_required');
  }

  const supabase = createSupabaseServerClient();
  let query = supabase.from('launches').select('*').eq('hidden', false);
  query = applyStandardLaunchFilters(query, feedRequest);
  query = applySort(query, 'live', feedRequest.sort);
  query = query.range(feedRequest.offset, feedRequest.offset + feedRequest.limit - 1);

  const { data, error } = await query;
  if (error) {
    console.error('live launches query error', error);
    throw new LaunchFeedApiRouteError(500, 'failed_to_load');
  }

  const launches = ((data || []) as any[]).map(mapLiveLaunchRow);
  const launchesWithEvents = await attachNextLaunchEvents(supabase, launches);
  const shouldFilterByMilestones = feedRequest.range !== 'past' && feedRequest.range !== 'all';
  const nowMs = Date.now();
  const launchesInWindow = shouldFilterByMilestones
    ? launchesWithEvents.filter((launch) =>
        isLaunchWithinMilestoneWindow(launch, nowMs, NEXT_LAUNCH_RETENTION_MS, {
          ignoreTimeline: true
        })
      )
    : launchesWithEvents;

  return launchFeedSchemaV1.parse({
    launches: launchesInWindow,
    nextCursor: launches.length === feedRequest.limit ? String(feedRequest.offset + launchesInWindow.length) : null,
    hasMore: launches.length === feedRequest.limit,
    freshness: 'live-db',
    intervalMinutes: null,
    intervalSeconds: viewer.refreshIntervalSeconds,
    tier: viewer.tier,
    scope: 'live'
  });
}

async function loadWatchlistFeed(feedRequest: FeedRequest, viewer: ViewerTierInfo) {
  if (!viewer.isAuthed || !viewer.userId) {
    throw new LaunchFeedApiRouteError(401, 'unauthorized');
  }
  if (!viewer.isAdmin && !viewer.capabilities.canUseSavedItems) {
    throw new LaunchFeedApiRouteError(402, 'payment_required');
  }
  if (!feedRequest.watchlistId || !isUuid(feedRequest.watchlistId)) {
    throw new LaunchFeedApiRouteError(400, 'invalid_watchlist_id');
  }

  const supabase = createSupabaseServerClient();
  const { data: watchlist, error: watchlistError } = await supabase
    .from('watchlists')
    .select('id')
    .eq('id', feedRequest.watchlistId)
    .eq('user_id', viewer.userId)
    .maybeSingle();

  if (watchlistError) {
    console.error('watchlist lookup error', watchlistError);
    throw new LaunchFeedApiRouteError(500, 'failed_to_load');
  }
  if (!watchlist) {
    throw new LaunchFeedApiRouteError(404, 'not_found');
  }

  const { data: rules, error: rulesError } = await supabase
    .from('watchlist_rules')
    .select('rule_type, rule_value')
    .eq('watchlist_id', feedRequest.watchlistId);
  if (rulesError) {
    console.error('watchlist rules fetch error', rulesError);
    throw new LaunchFeedApiRouteError(500, 'failed_to_load');
  }

  const parsedRules = parseRules(rules ?? []);
  if (!parsedRules.hasAny) {
    return launchFeedSchemaV1.parse({
      launches: [],
      nextCursor: null,
      hasMore: false,
      freshness: 'live-db',
      intervalMinutes: null,
      intervalSeconds: viewer.refreshIntervalSeconds,
      tier: viewer.tier,
      scope: 'watchlist'
    });
  }

  const needed = Math.min(1000, feedRequest.offset + feedRequest.limit);
  const buildQuery = () => {
    let query = supabase.from('launches').select('*').eq('hidden', false);
    query = applyStandardLaunchFilters(query, { ...feedRequest, offset: 0, limit: needed });
    query = applySort(query, 'watchlist', feedRequest.sort);
    return query.range(0, Math.max(0, needed - 1));
  };

  const queries: Array<ReturnType<typeof buildQuery>> = [];
  if (parsedRules.launchIds.length) queries.push(buildQuery().in('id', parsedRules.launchIds as any));
  if (parsedRules.providers.length) queries.push(buildQuery().in('provider', parsedRules.providers as any));
  if (parsedRules.padLl2Ids.length) queries.push(buildQuery().in('ll2_pad_id', parsedRules.padLl2Ids as any));
  if (parsedRules.padCodes.length) queries.push(buildQuery().in('pad_short_code', parsedRules.padCodes as any));
  if (parsedRules.tiers.length) {
    queries.push(buildQuery().in('tier_override', parsedRules.tiers as any));
    queries.push(buildQuery().is('tier_override', null).in('tier_auto', parsedRules.tiers as any));
  }

  const results = await Promise.all(queries.map((query) => query));
  const firstError = results.map((result) => (result as any).error).find(Boolean);
  if (firstError) {
    console.error('watchlist launches query error', firstError);
    throw new LaunchFeedApiRouteError(500, 'failed_to_load');
  }

  const rows = results.flatMap((result) => ((result as any).data || []) as any[]);
  const deduped = new Map<string, any>();
  rows.forEach((row) => {
    const id = String(row?.id || '');
    if (!id || deduped.has(id)) return;
    deduped.set(id, row);
  });

  const mergedLaunches = Array.from(deduped.values()).map(mapLiveLaunchRow);
  mergedLaunches.sort((left, right) => compareLaunches(left, right, feedRequest.sort));

  const shouldFilterByMilestones = feedRequest.range !== 'past' && feedRequest.range !== 'all';
  const nowMs = Date.now();
  const launchesInWindow = shouldFilterByMilestones
    ? mergedLaunches.filter((launch) =>
        isLaunchWithinMilestoneWindow(launch, nowMs, NEXT_LAUNCH_RETENTION_MS, {
          ignoreTimeline: true
        })
      )
    : mergedLaunches;

  const slice = launchesInWindow.slice(feedRequest.offset, feedRequest.offset + feedRequest.limit);
  const launchesWithEvents = await attachNextLaunchEvents(supabase, slice);
  const hasMore = launchesInWindow.length > feedRequest.offset + feedRequest.limit || rows.length >= needed;

  return launchFeedSchemaV1.parse({
    launches: launchesWithEvents,
    nextCursor: hasMore ? String(feedRequest.offset + launchesWithEvents.length) : null,
    hasMore,
    freshness: 'live-db',
    intervalMinutes: null,
    intervalSeconds: viewer.refreshIntervalSeconds,
    tier: viewer.tier,
    scope: 'watchlist'
  });
}

function parseFeedRequest(request: Request): FeedRequest {
  const { searchParams } = new URL(request.url);
  const scopeToken = String(searchParams.get('scope') || 'public').trim().toLowerCase();
  const scope: LaunchFeedScope =
    scopeToken === 'live' || scopeToken === 'watchlist'
      ? scopeToken
      : 'public';
  const rangeToken = String(searchParams.get('range') || '7d').trim().toLowerCase();
  const range: LaunchRange =
    rangeToken === 'today' ||
    rangeToken === 'month' ||
    rangeToken === 'year' ||
    rangeToken === 'past' ||
    rangeToken === 'all'
      ? rangeToken
      : '7d';
  const now = new Date();
  const parsedFrom = parseDateParam(searchParams.get('from'));
  const parsedTo = parseDateParam(searchParams.get('to'));
  const { from, to } = resolveDateWindow({ range, parsedFrom, parsedTo, now });

  const sortToken = String(searchParams.get('sort') || 'soonest').trim().toLowerCase();
  const sort: LaunchFeedSort =
    sortToken === 'latest' || sortToken === 'changed'
      ? sortToken
      : 'soonest';

  return {
    scope,
    watchlistId: normalizeText(searchParams.get('watchlistId')),
    range,
    from,
    to,
    location: normalizeText(searchParams.get('location')),
    state: normalizeText(searchParams.get('state')),
    pad: normalizeText(searchParams.get('pad')),
    provider: normalizeText(searchParams.get('provider')),
    status: parseLaunchStatusFilter(searchParams.get('status')),
    sort,
    region: parseLaunchRegion(searchParams.get('region')),
    limit: clampNumber(Number(searchParams.get('limit') || 20), 1, scope === 'watchlist' ? 500 : 1000),
    offset: clampNumber(Number(searchParams.get('offset') || 0), 0, 100_000)
  };
}

async function executePublicLaunchQuery(client: LaunchQueryClient, feedRequest: FeedRequest): Promise<PublicLaunchQueryResult> {
  let query = client.from('launches_public_cache').select('*');
  query = applyPublicLaunchFilters(query, feedRequest);
  query = applySort(query, 'public', feedRequest.sort);
  query = query.range(feedRequest.offset, feedRequest.offset + feedRequest.limit - 1);
  const { data, error } = await query;
  return {
    data: (data || null) as any[] | null,
    error: (error || null) as PublicLaunchQueryResult['error'],
    client
  };
}

function applyPublicLaunchFilters(query: any, feedRequest: FeedRequest) {
  let next = query;
  if (feedRequest.region === 'us') {
    next = next.in('pad_country_code', US_PAD_COUNTRY_CODES);
  }
  if (feedRequest.region === 'non-us') {
    next = next.not('pad_country_code', 'in', `(${US_PAD_COUNTRY_CODES.join(',')})`);
  }
  if (feedRequest.from) next = next.gte('net', feedRequest.from);
  if (feedRequest.to) next = next.lt('net', feedRequest.to);
  if (feedRequest.location) next = next.eq('pad_location_name', feedRequest.location);
  if (feedRequest.state) next = next.or(buildPublicStateFilterOrClause(feedRequest.state));
  if (feedRequest.pad) next = next.eq('pad_name', feedRequest.pad);
  if (feedRequest.provider) next = next.eq('provider', feedRequest.provider);
  if (feedRequest.status) {
    const statusClause = buildStatusFilterOrClause(feedRequest.status);
    if (statusClause) next = next.or(statusClause);
  }
  return next;
}

function applyStandardLaunchFilters(query: any, feedRequest: FeedRequest) {
  let next = query;
  if (feedRequest.region === 'us') next = next.in('pad_country_code', US_PAD_COUNTRY_CODES);
  if (feedRequest.region === 'non-us') next = next.not('pad_country_code', 'in', `(${US_PAD_COUNTRY_CODES.join(',')})`);
  if (feedRequest.from) next = next.gte('net', feedRequest.from);
  if (feedRequest.to) next = next.lt('net', feedRequest.to);
  if (feedRequest.location) next = next.eq('pad_location_name', feedRequest.location);
  if (feedRequest.state) next = next.eq('pad_state', feedRequest.state);
  if (feedRequest.pad) next = next.eq('pad_name', feedRequest.pad);
  if (feedRequest.provider) next = next.eq('provider', feedRequest.provider);
  if (feedRequest.status) {
    const statusClause = buildStatusFilterOrClause(feedRequest.status);
    if (statusClause) next = next.or(statusClause);
  }
  return next;
}

function applySort(query: any, scope: LaunchFeedScope, sort: LaunchFeedSort) {
  if (sort === 'changed') {
    return query.order(scope === 'public' ? 'cache_generated_at' : 'last_updated_source', { ascending: false });
  }
  if (sort === 'latest') {
    return query.order('net', { ascending: false });
  }
  return query.order('net', { ascending: true });
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

function parseRules(rows: Array<{ rule_type?: string | null; rule_value?: string | null }>) {
  const launchIds: string[] = [];
  const providers: string[] = [];
  const padLl2Ids: number[] = [];
  const padCodes: string[] = [];
  const tiers: Array<'major' | 'notable' | 'routine'> = [];

  for (const row of rows) {
    const type = String(row.rule_type || '').trim().toLowerCase();
    const value = String(row.rule_value || '').trim();
    if (!type || !value) continue;

    if (type === 'launch') {
      if (isUuid(value)) launchIds.push(value.toLowerCase());
      continue;
    }

    if (type === 'provider') {
      providers.push(value);
      continue;
    }

    if (type === 'pad') {
      const lower = value.toLowerCase();
      if (lower.startsWith('ll2:')) {
        const numeric = Number(value.slice(4).trim());
        if (Number.isFinite(numeric) && numeric > 0) padLl2Ids.push(Math.trunc(numeric));
        continue;
      }
      if (lower.startsWith('code:')) {
        const code = value.slice(5).trim();
        if (code) padCodes.push(code);
        continue;
      }
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) {
        padLl2Ids.push(Math.trunc(numeric));
      } else {
        padCodes.push(value);
      }
      continue;
    }

    if (type === 'tier') {
      const normalized = value.toLowerCase();
      if (normalized === 'major' || normalized === 'notable' || normalized === 'routine') {
        tiers.push(normalized);
      }
    }
  }

  return {
    hasAny: launchIds.length > 0 || providers.length > 0 || padLl2Ids.length > 0 || padCodes.length > 0 || tiers.length > 0,
    launchIds: uniqueStrings(launchIds),
    providers: uniqueStrings(providers),
    padLl2Ids: uniqueNumbers(padLl2Ids),
    padCodes: uniqueStrings(padCodes),
    tiers: uniqueStrings(tiers) as Array<'major' | 'notable' | 'routine'>
  };
}

function compareLaunches(left: Launch, right: Launch, sort: LaunchFeedSort) {
  if (sort === 'changed') {
    const leftMs = left.lastUpdated ? Date.parse(left.lastUpdated) : 0;
    const rightMs = right.lastUpdated ? Date.parse(right.lastUpdated) : 0;
    return rightMs - leftMs;
  }
  const leftMs = Date.parse(left.net || '');
  const rightMs = Date.parse(right.net || '');
  if (sort === 'latest') {
    return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
  }
  return (Number.isFinite(leftMs) ? leftMs : Number.POSITIVE_INFINITY) - (Number.isFinite(rightMs) ? rightMs : Number.POSITIVE_INFINITY);
}

function resolveDateWindow({
  range,
  parsedFrom,
  parsedTo,
  now
}: {
  range: LaunchRange;
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
  const days = range === 'today' ? 1 : range === 'month' ? 30 : range === 'year' ? 365 : 7;
  return {
    from: new Date(now.getTime() - NEXT_LAUNCH_RETENTION_MS).toISOString(),
    to: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
  };
}

function parseDateParam(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function filterChangelogFields(fields: unknown): string[] {
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((field): field is string => typeof field === 'string')
    .map((field) => field.trim())
    .filter((field) => CHANGELOG_FIELDS.has(field.toLowerCase()));
}

function summarizeChangedFields(fields: string[]) {
  const normalized = new Set(fields.map((field) => field.toLowerCase().trim()));
  const parts: string[] = [];
  if (Array.from(STATUS_FIELDS).some((field) => normalized.has(field))) parts.push('Status updated');
  if (Array.from(TIMING_FIELDS).some((field) => normalized.has(field))) parts.push('Timing updated');
  if (Array.from(OPERATIONS_FIELDS).some((field) => normalized.has(field))) parts.push('Operations updated');
  if (Array.from(DETAILS_FIELDS).some((field) => normalized.has(field))) parts.push('Details updated');
  return parts.length ? parts.join(' • ') : 'Updated';
}

function buildChangeDetails({
  fields,
  oldValues,
  newValues,
  timezone
}: {
  fields: string[];
  oldValues: Record<string, any> | null;
  newValues: Record<string, any> | null;
  timezone: string | null;
}) {
  const details: string[] = [];
  const normalized = new Set(fields.map((field) => field.toLowerCase()));
  const handled = new Set<string>();

  if (normalized.has('status_abbrev') || normalized.has('status_name') || normalized.has('status_id')) {
    details.push(`Status: ${formatSimple(pickStatus(oldValues))} -> ${formatSimple(pickStatus(newValues))}`);
    handled.add('status_abbrev');
    handled.add('status_name');
    handled.add('status_id');
  }

  if (normalized.has('net')) {
    details.push(`NET: ${formatDate(oldValues?.net, timezone)} -> ${formatDate(newValues?.net, timezone)}`);
    handled.add('net');
  }

  if (normalized.has('window_start')) {
    details.push(`Window start: ${formatDate(oldValues?.window_start, timezone)} -> ${formatDate(newValues?.window_start, timezone)}`);
    handled.add('window_start');
  }

  if (normalized.has('window_end')) {
    details.push(`Window end: ${formatDate(oldValues?.window_end, timezone)} -> ${formatDate(newValues?.window_end, timezone)}`);
    handled.add('window_end');
  }

  if (normalized.has('net_precision')) {
    details.push(`NET precision: ${formatSimple(oldValues?.net_precision)} -> ${formatSimple(newValues?.net_precision)}`);
    handled.add('net_precision');
  }

  if (normalized.has('video_url')) {
    details.push(`Watch link: ${formatUrl(oldValues?.video_url)} -> ${formatUrl(newValues?.video_url)}`);
    handled.add('video_url');
  }

  if (normalized.has('webcast_live')) {
    details.push(`Webcast live: ${formatBool(oldValues?.webcast_live)} -> ${formatBool(newValues?.webcast_live)}`);
    handled.add('webcast_live');
  }

  if (normalized.has('featured')) {
    details.push(`Featured: ${formatBool(oldValues?.featured)} -> ${formatBool(newValues?.featured)}`);
    handled.add('featured');
  }

  if (normalized.has('hidden')) {
    details.push(`Hidden: ${formatBool(oldValues?.hidden)} -> ${formatBool(newValues?.hidden)}`);
    handled.add('hidden');
  }

  if (normalized.has('tier_override')) {
    details.push(`Tier override: ${formatSimple(oldValues?.tier_override)} -> ${formatSimple(newValues?.tier_override)}`);
    handled.add('tier_override');
  }

  if (normalized.has('name')) {
    details.push(`Name: ${formatSimple(oldValues?.name)} -> ${formatSimple(newValues?.name)}`);
    handled.add('name');
  }

  fields.forEach((field) => {
    const key = field.toLowerCase();
    if (handled.has(key)) return;
    details.push(`${labelize(field)}: ${formatSimple(oldValues?.[field])} -> ${formatSimple(newValues?.[field])}`);
  });

  return details;
}

function pickStatus(values: Record<string, any> | null) {
  if (!values) return null;
  return values.status_abbrev || values.status_name || values.status_id || null;
}

function formatSimple(value: any) {
  if (value === null || value === undefined || value === '') return 'none';
  if (typeof value === 'string') return truncateString(value, 140);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'none';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    try {
      return truncateString(JSON.stringify(value), 140);
    } catch {
      return 'unavailable';
    }
  }
  return String(value);
}

function formatBool(value: any) {
  if (value === null || value === undefined) return 'none';
  return value ? 'yes' : 'no';
}

function formatDate(value: any, timezone: string | null) {
  if (!value) return 'none';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatSimple(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone || 'America/New_York',
    timeZoneName: 'short'
  }).format(date);
}

function formatLocalTimeLabel(value: any, timezone: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone || 'America/New_York',
    timeZoneName: 'short'
  }).format(date);
}

function formatUrl(value: any) {
  if (!value) return 'none';
  const raw = String(value).trim();
  if (!raw) return 'none';
  try {
    const url = new URL(raw);
    const host = url.host.replace(/^www\\./, '');
    const path = url.pathname.length > 24 ? `${url.pathname.slice(0, 24)}...` : url.pathname;
    return `${host}${path}`;
  } catch {
    return raw.length > 32 ? `${raw.slice(0, 32)}...` : raw;
  }
}

function labelize(value: string) {
  return value.replace(/_/g, ' ').replace(/\\b\\w/g, (character) => character.toUpperCase());
}

function truncateString(value: string, limit: number) {
  const trimmed = String(value || '').trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
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
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
