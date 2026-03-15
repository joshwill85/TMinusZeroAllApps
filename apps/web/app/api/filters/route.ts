import { NextResponse } from 'next/server';
import {
  createSupabaseAdminClient,
  createSupabaseServerClient
} from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { getViewerTier } from '@/lib/server/viewerTier';
import { parseLaunchRegion, US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import { buildStatusFilterOrClause, parseLaunchStatusFilter, resolveLaunchStatus } from '@/lib/server/launchStatus';
import { buildPublicStateFilterOrClause, inferUsStateCodeFromLocation, toUsStateCode } from '@/lib/server/usStates';
export const dynamic = 'force-dynamic';

type FilterRegion = 'us' | 'all' | 'non-us';

type FilterRpcName = 'get_launch_filter_options' | 'get_launch_filter_options_all' | 'get_launch_filter_options_non_us';
type FilterStatus = 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown';

type FilterOptionPayload = {
  providers: string[];
  locations: string[];
  states: string[];
  pads: string[];
  statuses: FilterStatus[];
};

type FilterRange = 'today' | '7d' | 'month' | 'year' | 'past' | 'all';
type FilterFacet = 'providers' | 'locations' | 'states' | 'pads' | 'statuses';
type CachedFilterPayload = {
  expiresAt: number;
  payload: FilterOptionPayload;
};

const FILTER_RPC_CACHE_TTL_MS = 5 * 60 * 1000;
const FILTER_FALLBACK_CACHE_TTL_MS = 60 * 1000;
const FILTER_RPC_TIMEOUT_COOLDOWN_MS = 90 * 1000;

const filterRpcCache = new Map<FilterRpcName, CachedFilterPayload>();
const filterFallbackCache = new Map<string, CachedFilterPayload>();
const filterRpcTimeoutUntil = new Map<FilterRpcName, number>();
type FilterRequestMode = 'public' | 'live';

type FilterFallbackCacheContext = {
  mode: FilterRequestMode;
  region: FilterRegion;
  from: string | null;
  to: string | null;
  location: string | null;
  state: string | null;
  pad: string | null;
  provider: string | null;
  status: FilterStatus | null;
  variant: 'legacy' | 'dynamic';
};

type FilterOptionQueryArgs = {
  mode: FilterRequestMode;
  region: FilterRegion;
  from: string | null;
  to: string | null;
  location: string | null;
  state: string | null;
  pad: string | null;
  provider: string | null;
  status: FilterStatus | null;
};

function isPostgrestTimeout(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const asError = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  const code = typeof asError.code === 'string' ? asError.code.toLowerCase() : '';
  const message = typeof asError.message === 'string' ? asError.message.toLowerCase() : '';
  const details = typeof asError.details === 'string' ? asError.details.toLowerCase() : '';
  const hint = typeof asError.hint === 'string' ? asError.hint.toLowerCase() : '';
  return (
    code === '57014' ||
    message.includes('statement timeout') ||
    details.includes('statement timeout') ||
    hint.includes('statement timeout')
  );
}

function parseFilterPayload(raw: unknown): FilterOptionPayload {
  const next = typeof raw === 'object' && raw ? (raw as Record<string, unknown>) : {};
  const normalize = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

  const providers = Array.isArray(next.providers) ? next.providers : [];
  const locations = Array.isArray(next.locations) ? next.locations : [];
  const states = Array.isArray(next.states) ? next.states : [];
  const pads = Array.isArray(next.pads) ? next.pads : [];
  const statuses = Array.isArray(next.statuses) ? next.statuses : [];
  return {
    providers: providers
      .map((value) => normalize(value))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
    locations: locations
      .map((value) => normalize(value))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
    states: states
      .map((value) => normalize(value))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
    pads: pads
      .map((value) => normalize(value))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
    statuses: statuses
      .map((value) => normalize(value))
      .map((value) => resolveLaunchStatus(value, null))
      .filter((value, index, array) => array.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b))
  };
}

function getFreshFilterRpcCache(fn: FilterRpcName) {
  const entry = filterRpcCache.get(fn);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.payload;
}

function normalizeCacheToken(value: string | null) {
  if (!value) return '-';
  return value.trim().toLowerCase();
}

function fallbackCacheKey(context: FilterFallbackCacheContext) {
  return [
    context.variant,
    context.mode,
    context.region,
    context.from || '-',
    context.to || '-',
    normalizeCacheToken(context.location),
    normalizeCacheToken(context.state),
    normalizeCacheToken(context.pad),
    normalizeCacheToken(context.provider),
    normalizeCacheToken(context.status)
  ].join('|');
}

function getFreshFilterFallbackCache(context: FilterFallbackCacheContext) {
  const entry = filterFallbackCache.get(fallbackCacheKey(context));
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.payload;
}

function setFilterRpcCache(fn: FilterRpcName, payload: FilterOptionPayload) {
  filterRpcCache.set(fn, {
    expiresAt: Date.now() + FILTER_RPC_CACHE_TTL_MS,
    payload
  });
}

function setFilterFallbackCache(context: FilterFallbackCacheContext, payload: FilterOptionPayload) {
  filterFallbackCache.set(fallbackCacheKey(context), {
    expiresAt: Date.now() + FILTER_FALLBACK_CACHE_TTL_MS,
    payload
  });
}

function markFilterRpcTimeout(fn: FilterRpcName) {
  filterRpcTimeoutUntil.set(fn, Date.now() + FILTER_RPC_TIMEOUT_COOLDOWN_MS);
}

function shouldSkipFilterRpc(fn: FilterRpcName) {
  const blockedUntil = filterRpcTimeoutUntil.get(fn);
  return blockedUntil != null && blockedUntil > Date.now();
}

function getFilterRpcName(region: FilterRegion): FilterRpcName {
  if (region === 'all') return 'get_launch_filter_options_all';
  if (region === 'non-us') return 'get_launch_filter_options_non_us';
  return 'get_launch_filter_options';
}

function makeFilterFallbackHeaders(canUseAdmin: boolean) {
  const cacheHeader = canUseAdmin ? 'private, max-age=120' : 'private, max-age=300';
  return { 'Cache-Control': cacheHeader };
}

async function fetchFilterFallback(
  supabase: ReturnType<typeof createSupabaseServerClient> | ReturnType<typeof createSupabaseAdminClient>,
  args: FilterOptionQueryArgs
): Promise<FilterOptionPayload | null> {
  const tableName = args.mode === 'live' ? 'launches' : 'launches_public_cache';
  const stateSelect = args.mode === 'live' ? 'pad_state' : 'pad_state_code, pad_state, pad_location_name';
  const stateColumn = args.mode === 'live' ? 'pad_state' : 'pad_state_code';

  const [providersResult, locationsResult, statesResult, padsResult, statusesResult] = await Promise.all([
    applyFilterConstraints(
      supabase.from(tableName).select('provider').eq('hidden', false),
      args,
      'providers',
      stateColumn
    ),
    applyFilterConstraints(
      supabase.from(tableName).select('pad_location_name').eq('hidden', false),
      args,
      'locations',
      stateColumn
    ),
    applyFilterConstraints(
      supabase.from(tableName).select(stateSelect).eq('hidden', false),
      args,
      'states',
      stateColumn
    ),
    applyFilterConstraints(
      supabase.from(tableName).select('pad_name').eq('hidden', false),
      args,
      'pads',
      stateColumn
    ),
    applyFilterConstraints(
      supabase.from(tableName).select('status_name, status_abbrev').eq('hidden', false),
      args,
      'statuses',
      stateColumn
    )
  ]);

  if (providersResult.error || locationsResult.error || statesResult.error || padsResult.error || statusesResult.error) {
    console.error('filters options query error', {
      providers: providersResult.error,
      locations: locationsResult.error,
      states: statesResult.error,
      pads: padsResult.error,
      statuses: statusesResult.error
    });
    return null;
  }

  const providers = new Set<string>();
  const locations = new Set<string>();
  const states = new Set<string>();
  const pads = new Set<string>();
  const statuses = new Set<FilterStatus>();

  for (const row of providersResult.data || []) {
    const provider = normalizeOptionValue((row as { provider?: unknown }).provider);
    if (provider) providers.add(provider);
  }

  for (const row of statesResult.data || []) {
    const state = extractStateValue(row, args.mode);
    if (state) states.add(state);
  }

  for (const row of locationsResult.data || []) {
    const location = normalizeLocationOptionValue((row as { pad_location_name?: unknown }).pad_location_name);
    if (location) locations.add(location);
  }

  for (const row of padsResult.data || []) {
    const pad = normalizePadOptionValue((row as { pad_name?: unknown }).pad_name);
    if (pad) pads.add(pad);
  }

  for (const row of statusesResult.data || []) {
    const entry = row as { status_name?: unknown; status_abbrev?: unknown };
    const status = resolveLaunchStatus(entry.status_name, entry.status_abbrev);
    if (status) statuses.add(status);
  }

  return {
    providers: Array.from(providers).sort((a, b) => a.localeCompare(b)),
    locations: Array.from(locations).sort((a, b) => a.localeCompare(b)),
    states: Array.from(states).sort((a, b) => a.localeCompare(b)),
    pads: Array.from(pads).sort((a, b) => a.localeCompare(b)),
    statuses: Array.from(statuses).sort((a, b) => a.localeCompare(b))
  };
}

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const modeParam = searchParams.get('mode');
    let mode = modeParam === 'live' ? 'live' : 'public';
    const region = parseLaunchRegion(searchParams.get('region')) as FilterRegion;
    const provider = parseOptionalValue(searchParams.get('provider'));
    const location = parseOptionalValue(searchParams.get('location'));
    const state = parseOptionalValue(searchParams.get('state'));
    const pad = parseOptionalValue(searchParams.get('pad'));
    const rawStatus = parseOptionalValue(searchParams.get('status'));
    const status = rawStatus === 'all' ? null : parseLaunchStatusFilter(rawStatus);
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const parsedRange = parseFilterRange(searchParams.get('range'));
    const hasDateInputs = parsedRange != null || Boolean(fromParam) || Boolean(toParam);
    const hasFacetInputs = Boolean(provider || location || state || pad || status || rawStatus);
    const shouldUseDynamicOptions = hasDateInputs || hasFacetInputs;

    const now = new Date();
    const parsedFrom = parseDateParam(fromParam);
    const parsedTo = parseDateParam(toParam);
    const dateWindow = hasDateInputs
      ? resolveDateWindow({ range: parsedRange || '7d', parsedFrom, parsedTo, now })
      : { from: null, to: null };

    const supabase = createSupabaseServerClient();
    const canUseAdmin = isSupabaseAdminConfigured();

    if (mode === 'live') {
      const viewer = await getViewerTier({ request, reconcileStripe: false });
      if (viewer.tier !== 'premium') {
        mode = 'public';
      }
    }

    const filterMode: FilterRequestMode = mode === 'live' && canUseAdmin ? 'live' : 'public';
    const fallbackClient = filterMode === 'live' && canUseAdmin ? createSupabaseAdminClient() : supabase;
    const filterArgs: FilterOptionQueryArgs = {
      mode: filterMode,
      region,
      from: dateWindow.from,
      to: dateWindow.to,
      location,
      state,
      pad,
      provider,
      status
    };
    const fallbackCacheContext: FilterFallbackCacheContext = {
      mode: filterMode,
      region,
      from: filterArgs.from,
      to: filterArgs.to,
      location: filterArgs.location,
      state: filterArgs.state,
      pad: filterArgs.pad,
      provider: filterArgs.provider,
      status: filterArgs.status,
      variant: shouldUseDynamicOptions ? 'dynamic' : 'legacy'
    };

    const cachedFallback = getFreshFilterFallbackCache(fallbackCacheContext);
    if (cachedFallback) {
      return NextResponse.json(cachedFallback, {
        headers: makeFilterFallbackHeaders(canUseAdmin)
      });
    }

    if (shouldUseDynamicOptions) {
      const dynamicPayload = await fetchFilterFallback(fallbackClient, filterArgs);
      if (!dynamicPayload) {
        return NextResponse.json({ error: 'filters_failed' }, { status: 500 });
      }
      setFilterFallbackCache(fallbackCacheContext, dynamicPayload);
      return NextResponse.json(dynamicPayload, {
        headers: makeFilterFallbackHeaders(canUseAdmin)
      });
    }

    if (filterMode === 'live') {
      const client = createSupabaseAdminClient();
      const fn = getFilterRpcName(region);
      const freshRpcPayload = getFreshFilterRpcCache(fn);
      if (freshRpcPayload) {
        setFilterFallbackCache(fallbackCacheContext, freshRpcPayload);
        return NextResponse.json(freshRpcPayload, {
          headers: makeFilterFallbackHeaders(canUseAdmin)
        });
      }

      if (!shouldSkipFilterRpc(fn)) {
        const { data, error } = await client.rpc(fn);
        if (!error) {
          const rpcPayload = parseFilterPayload(data);
          const fallbackPayload =
            rpcPayload.states.length === 0 ? await fetchFilterFallback(fallbackClient, filterArgs) : null;
          const payload =
            fallbackPayload && fallbackPayload.states.length > rpcPayload.states.length ? fallbackPayload : rpcPayload;

          setFilterRpcCache(fn, payload);
          setFilterFallbackCache(fallbackCacheContext, payload);
          return NextResponse.json(payload, {
            headers: makeFilterFallbackHeaders(canUseAdmin)
          });
        }

        console.error('filters rpc error', error);
        if (isPostgrestTimeout(error)) {
          markFilterRpcTimeout(fn);
        }
      }
    }

    const fallback = await fetchFilterFallback(fallbackClient, filterArgs);
    if (!fallback) {
      return NextResponse.json({ error: 'filters_failed' }, { status: 500 });
    }

    setFilterFallbackCache(fallbackCacheContext, fallback);
    return NextResponse.json(
      fallback,
      { headers: makeFilterFallbackHeaders(canUseAdmin) }
    );
  } catch (err) {
    console.error('filters fetch error', err);
    return NextResponse.json({ error: 'filters_failed' }, { status: 500 });
  }
}

function applyFilterConstraints(
  query: any,
  args: FilterOptionQueryArgs,
  facet: FilterFacet,
  stateColumn: 'pad_state' | 'pad_state_code'
) {
  let next = query;

  if (args.region === 'us') {
    next = next.in('pad_country_code', US_PAD_COUNTRY_CODES);
  } else if (args.region === 'non-us') {
    next = next.not('pad_country_code', 'in', `(${US_PAD_COUNTRY_CODES.join(',')})`);
  }

  if (args.from) next = next.gte('net', args.from);
  if (args.to) next = next.lt('net', args.to);
  if (facet !== 'locations' && args.location) next = next.eq('pad_location_name', args.location);

  if (facet !== 'states' && args.state) {
    if (args.mode === 'public') {
      next = next.or(buildPublicStateFilterOrClause(args.state));
    } else {
      next = next.eq(stateColumn, args.state);
    }
  }
  if (facet !== 'pads' && args.pad) next = next.eq('pad_name', args.pad);
  if (facet !== 'providers' && args.provider) next = next.eq('provider', args.provider);
  if (facet !== 'statuses' && args.status) next = next.or(buildStatusFilterOrClause(args.status));

  return next;
}

function normalizeOptionValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePadOptionValue(value: unknown) {
  const normalized = normalizeOptionValue(value);
  if (!normalized) return '';
  const lower = normalized.toLowerCase();
  if (lower === 'pad' || lower === 'unknown pad' || lower === 'unknown') return '';
  return normalized;
}

function normalizeLocationOptionValue(value: unknown) {
  const normalized = normalizeOptionValue(value);
  if (!normalized) return '';
  const lower = normalized.toLowerCase();
  if (lower === 'unknown location' || lower === 'unknown') return '';
  return normalized;
}

function extractStateValue(row: unknown, mode: FilterRequestMode) {
  const record = typeof row === 'object' && row ? (row as Record<string, unknown>) : {};
  if (mode === 'public') {
    const fromCode = toUsStateCode(record.pad_state_code);
    const fromStateField = toUsStateCode(record.pad_state);
    const fromLocation = inferUsStateCodeFromLocation(record.pad_location_name);
    return fromCode || fromStateField || fromLocation || '';
  }
  const primary = normalizeOptionValue(record.pad_state);
  const fallback = normalizeOptionValue(record.pad_state_code);
  return primary || fallback;
}

function parseOptionalValue(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parseFilterRange(value: string | null): FilterRange | null {
  if (
    value === 'today' ||
    value === '7d' ||
    value === 'month' ||
    value === 'year' ||
    value === 'past' ||
    value === 'all'
  ) {
    return value;
  }
  return null;
}

function parseDateParam(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function resolveDateWindow({
  range,
  parsedFrom,
  parsedTo,
  now
}: {
  range: FilterRange;
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
  const from = now.toISOString();
  const to = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  return { from, to };
}
