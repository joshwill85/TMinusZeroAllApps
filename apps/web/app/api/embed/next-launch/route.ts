import { NextResponse } from 'next/server';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { mapLiveLaunchRow, mapPublicCacheRow } from '@/lib/server/transformers';
import { attachNextLaunchEvents } from '@/lib/server/ll2Events';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { getUserAccessEntitlementById } from '@/lib/server/entitlements';
import { parseLaunchRegion, US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import type { LaunchFilter } from '@/lib/types/launch';

export const dynamic = 'force-dynamic';

const TOKEN_CACHE_CONTROL = 'public, s-maxage=15, stale-while-revalidate=60';
const MAX_LOOKAHEAD_DAYS = 365;

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  const parsedToken = parseToken(token);
  if (!parsedToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (isSupabaseAdminConfigured()) {
    const admin = createSupabaseAdminClient();
    const widgetRes = await admin
      .from('embed_widgets')
      .select('id,user_id,widget_type,filters,preset_id,watchlist_id')
      .eq('token', parsedToken)
      .maybeSingle();

    if (widgetRes.error) {
      console.error('embed widget lookup error', widgetRes.error);
      return NextResponse.json({ error: 'failed_to_load' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }

    if (widgetRes.data) {
      const widget = widgetRes.data as any;
      const userId = String(widget.user_id || '').trim();

      const access = await getUserAccessEntitlementById({ userId, admin });
      if (access.loadError || !access.entitlement) {
        return NextResponse.json({ error: 'failed_to_load' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
      }
      if (!access.entitlement.isPaid) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
      }

      const filters = await resolveWidgetFilters(admin, {
        userId,
        rawFilters: widget.filters,
        presetId: widget.preset_id
      });

      const launchRow = widget.watchlist_id
        ? await loadNextLaunchForWatchlist(admin, {
            userId,
            watchlistId: String(widget.watchlist_id),
            filters,
            nowIso
          })
        : await loadNextLaunchForFilters(admin, { filters, nowIso });

      const headers = { 'Cache-Control': TOKEN_CACHE_CONTROL };
      if (!launchRow) return NextResponse.json({ launch: null }, { status: 200, headers });

      const launch = mapLiveLaunchRow(launchRow);
      const [launchWithEvents] = await attachNextLaunchEvents(admin, [launch], nowMs);
      return NextResponse.json({ launch: launchWithEvents }, { status: 200, headers });
    }
  }

  const supabase = createSupabaseServerClient();
  const ok = await validateEmbedToken(supabase, parsedToken);
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });

  let query = supabase.from('launches_public_cache').select('*');
  query = query.in('pad_country_code', US_PAD_COUNTRY_CODES);
  query = query.gte('net', nowIso);
  query = query.order('net', { ascending: true }).range(0, 0);

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error('embed next launch query error', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }

  const headers = { 'Cache-Control': TOKEN_CACHE_CONTROL };
  if (!data) return NextResponse.json({ launch: null }, { status: 200, headers });

  const launch = mapPublicCacheRow(data);
  const [launchWithEvents] = await attachNextLaunchEvents(supabase, [launch], nowMs);

  return NextResponse.json({ launch: launchWithEvents }, { status: 200, headers });
}

function parseToken(token: string | null) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) return null;
  return raw;
}

async function validateEmbedToken(supabase: ReturnType<typeof createSupabaseServerClient>, token: string) {
  if (!token) return false;

  const { data, error } = await supabase.rpc('validate_embed_token', { token_in: token });
  if (error) {
    console.error('embed token validation error', error);
    return false;
  }
  return data === true;
}

function safeFilterObject(value: unknown): LaunchFilter {
  if (!value || typeof value !== 'object') return {};
  return value as LaunchFilter;
}

async function resolveWidgetFilters(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  {
    userId,
    rawFilters,
    presetId
  }: {
    userId: string;
    rawFilters: unknown;
    presetId: string | null;
  }
) {
  let filters = safeFilterObject(rawFilters);
  if (!presetId) return filters;

  const { data, error } = await admin
    .from('launch_filter_presets')
    .select('filters')
    .eq('id', presetId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.warn('embed widget preset lookup warning', error.message);
    return filters;
  }
  if (data?.filters) {
    filters = safeFilterObject((data as any).filters);
  }
  return filters;
}

function resolveToIso(filters: LaunchFilter, now: Date) {
  const range = filters.range ?? 'year';
  const nowMs = now.getTime();

  const lookaheadDays =
    range === 'today'
      ? 1
      : range === 'month'
        ? 30
        : range === 'year'
          ? 365
          : range === '7d'
            ? 7
            : range === 'all'
              ? MAX_LOOKAHEAD_DAYS
              : 0;

  if (!lookaheadDays) return now.toISOString();
  return new Date(nowMs + Math.min(MAX_LOOKAHEAD_DAYS, lookaheadDays) * 24 * 60 * 60 * 1000).toISOString();
}

function buildLaunchSelect() {
  return [
    'id',
    'll2_launch_uuid',
    'name',
    'slug',
    'provider',
    'vehicle',
    'pad_name',
    'pad_short_code',
    'pad_state',
    'pad_timezone',
    'pad_country_code',
    'pad_location_name',
    'll2_pad_id',
    'net',
    'net_precision',
    'window_start',
    'window_end',
    'status_name',
    'status_abbrev',
    'tier_auto',
    'tier_override',
    'featured',
    'webcast_live',
    'video_url',
    'image_thumbnail_url',
    'image_url',
    'image_credit',
    'image_license_name',
    'image_license_url',
    'image_single_use',
    'last_updated_source',
    'social_primary_post_id',
    'social_primary_post_url',
    'social_primary_post_platform',
    'social_primary_post_handle',
    'social_primary_post_matched_at',
    'social_primary_post_for_date',
    'spacex_x_post_id',
    'spacex_x_post_url',
    'spacex_x_post_captured_at',
    'spacex_x_post_for_date'
  ].join(',');
}

function applyLaunchFilters(query: any, filters: LaunchFilter, nowIso: string) {
  let q = query.eq('hidden', false);

  const region = parseLaunchRegion(filters.region ?? 'us');
  if (region === 'us') q = q.in('pad_country_code', US_PAD_COUNTRY_CODES);
  if (region === 'non-us') q = q.not('pad_country_code', 'in', `(${US_PAD_COUNTRY_CODES.join(',')})`);

  q = q.gte('net', nowIso);
  const to = resolveToIso(filters, new Date(nowIso));
  if (to) q = q.lt('net', to);

  if (filters.state) q = q.eq('pad_state', filters.state);
  if (filters.provider) q = q.eq('provider', filters.provider);
  if (filters.status && filters.status !== 'all') q = q.eq('status_name', filters.status);

  return q;
}

async function loadNextLaunchForFilters(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  { filters, nowIso }: { filters: LaunchFilter; nowIso: string }
) {
  let query = admin.from('launches').select(buildLaunchSelect());
  query = applyLaunchFilters(query, filters, nowIso);
  query = query.order('net', { ascending: true }).range(0, 0);
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error('embed widget next launch query error', error);
    return null;
  }
  return data;
}

async function loadNextLaunchForWatchlist(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  {
    userId,
    watchlistId,
    filters,
    nowIso
  }: {
    userId: string;
    watchlistId: string;
    filters: LaunchFilter;
    nowIso: string;
  }
) {
  const { data: watchlist, error: watchlistError } = await admin
    .from('watchlists')
    .select('id')
    .eq('id', watchlistId)
    .eq('user_id', userId)
    .maybeSingle();

  if (watchlistError) {
    console.error('embed widget watchlist lookup error', watchlistError);
    return null;
  }
  if (!watchlist) return null;

  const { data: rules, error: rulesError } = await admin
    .from('watchlist_rules')
    .select('rule_type, rule_value')
    .eq('watchlist_id', watchlistId)
    .limit(500);

  if (rulesError) {
    console.error('embed widget watchlist rules fetch error', rulesError);
    return null;
  }

  const parsedRules = parseWatchlistRules(rules ?? []);
  if (!parsedRules.hasAny) return null;

  const buildQuery = () => {
    let query = admin.from('launches').select(buildLaunchSelect());
    query = applyLaunchFilters(query, filters, nowIso);
    return query.order('net', { ascending: true }).range(0, 0);
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

  const results = await Promise.all(queries.map((q) => q.maybeSingle()));
  const anyErrors = results.map((r) => (r as any).error).filter(Boolean);
  if (anyErrors.length) {
    console.error('embed widget watchlist launches query error', anyErrors[0]);
    return null;
  }

  const candidates = results.map((r) => (r as any).data).filter(Boolean) as any[];
  if (!candidates.length) return null;
  candidates.sort((a, b) => Date.parse(String(a.net || '')) - Date.parse(String(b.net || '')));
  return candidates[0] ?? null;
}

function parseWatchlistRules(rows: Array<{ rule_type?: string | null; rule_value?: string | null }>) {
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
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        launchIds.push(value.toLowerCase());
      }
      continue;
    }

    if (type === 'provider') {
      providers.push(value);
      continue;
    }

    if (type === 'pad') {
      const lower = value.toLowerCase();
      if (lower.startsWith('ll2:')) {
        const rest = value.slice(4).trim();
        const n = Number(rest);
        if (Number.isFinite(n) && n > 0) padLl2Ids.push(Math.trunc(n));
        continue;
      }
      if (lower.startsWith('code:')) {
        const rest = value.slice(5).trim();
        if (rest) padCodes.push(rest);
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
    hasAny:
      launchIds.length > 0 ||
      providers.length > 0 ||
      padLl2Ids.length > 0 ||
      padCodes.length > 0 ||
      tiers.length > 0,
    launchIds: Array.from(new Set(launchIds)).slice(0, 200),
    providers: Array.from(new Set(providers)).slice(0, 200),
    padLl2Ids: Array.from(new Set(padLl2Ids)).slice(0, 200),
    padCodes: Array.from(new Set(padCodes)).slice(0, 200),
    tiers: Array.from(new Set(tiers)).slice(0, 3)
  };
}
