import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { getViewerTier } from '@/lib/server/viewerTier';
import { mapLiveLaunchRow } from '@/lib/server/transformers';
import { attachNextLaunchEvents } from '@/lib/server/ll2Events';
import { parseLaunchRegion, US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import { buildStatusFilterOrClause, parseLaunchStatusFilter } from '@/lib/server/launchStatus';
import { NEXT_LAUNCH_RETENTION_MS } from '@/lib/constants/launchTimeline';
import { isLaunchWithinMilestoneWindow } from '@/lib/utils/launchMilestones';

export const dynamic = 'force-dynamic';

const watchlistIdSchema = z.string().uuid();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const parsedId = watchlistIdSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'invalid_watchlist_id' }, { status: 400 });

  const viewer = await getViewerTier();
  if (!viewer.isAuthed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!viewer.capabilities.canUseSavedItems) return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  if (!viewer.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

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
  const sort = (searchParams.get('sort') || 'soonest') as 'soonest' | 'latest' | 'changed';
  const region = parseLaunchRegion(searchParams.get('region'));

  const now = new Date();
  const parsedFrom = parseDateParam(fromParam);
  const parsedTo = parseDateParam(toParam);
  const { from, to } = resolveDateWindow({ range, parsedFrom, parsedTo, now });

  const limit = clampInt(limitParam, 100, 1, 500);
  const offset = clampInt(offsetParam, 0, 0, 100_000);
  const needed = Math.min(1000, offset + limit);

  const supabase = createSupabaseServerClient();
  const { data: watchlist, error: watchlistError } = await supabase
    .from('watchlists')
    .select('id')
    .eq('id', parsedId.data)
    .eq('user_id', viewer.userId)
    .maybeSingle();

  if (watchlistError) {
    console.error('watchlist lookup error', watchlistError);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
  if (!watchlist) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data: rules, error: rulesError } = await supabase
    .from('watchlist_rules')
    .select('rule_type, rule_value')
    .eq('watchlist_id', parsedId.data);

  if (rulesError) {
    console.error('watchlist rules fetch error', rulesError);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  const parsedRules = parseRules(rules ?? []);
  if (!parsedRules.hasAny) {
    return NextResponse.json(
      { tier: viewer.tier, intervalSeconds: viewer.refreshIntervalSeconds, hasMore: false, launches: [] },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  const buildQuery = () => {
    let query = supabase.from('launches').select('*').eq('hidden', false);
    if (region === 'us') query = query.in('pad_country_code', US_PAD_COUNTRY_CODES);
    if (region === 'non-us') query = query.not('pad_country_code', 'in', `(${US_PAD_COUNTRY_CODES.join(',')})`);
    if (from) query = query.gte('net', from);
    if (to) query = query.lt('net', to);
    if (location) query = query.eq('pad_location_name', location);
    if (state) query = query.eq('pad_state', state);
    if (pad) query = query.eq('pad_name', pad);
    if (provider) query = query.eq('provider', provider);
    if (status) {
      const statusClause = buildStatusFilterOrClause(status);
      if (statusClause) query = query.or(statusClause);
    }

    query =
      sort === 'changed'
        ? query.order('last_updated_source', { ascending: false })
        : sort === 'latest'
          ? query.order('net', { ascending: false })
          : query.order('net', { ascending: true });

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

  const results = await Promise.all(queries.map((q) => q));
  const anyErrors = results.map((r) => (r as any).error).filter(Boolean);
  if (anyErrors.length) {
    console.error('watchlist launches query error', anyErrors[0]);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  const rows = results.flatMap((r) => ((r as any).data || []) as any[]);
  const deduped = new Map<string, any>();
  rows.forEach((row) => {
    const id = String(row?.id || '');
    if (!id) return;
    if (!deduped.has(id)) deduped.set(id, row);
  });

  const mergedLaunches = Array.from(deduped.values()).map(mapLiveLaunchRow);
  mergedLaunches.sort((a, b) => compareLaunches(a, b, sort));

  const shouldFilterByMilestones = range !== 'past' && range !== 'all' && !parsedFrom && !parsedTo;
  const nowMs = now.getTime();
  const launchesInWindow = shouldFilterByMilestones
    ? mergedLaunches.filter((launch) =>
        isLaunchWithinMilestoneWindow(launch, nowMs, NEXT_LAUNCH_RETENTION_MS, {
          // Keep feed retention pinned to T+120 for "next launch" behavior.
          ignoreTimeline: true
        })
      )
    : mergedLaunches;

  const slice = launchesInWindow.slice(offset, offset + limit);
  const hasMore = launchesInWindow.length > offset + limit || rows.length >= needed;
  const launchesWithEvents = await attachNextLaunchEvents(supabase, slice);

  return NextResponse.json(
    {
      freshness: 'live-db',
      tier: viewer.tier,
      intervalSeconds: viewer.refreshIntervalSeconds,
      hasMore,
      launches: launchesWithEvents
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
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
    launchIds: uniqueStrings(launchIds),
    providers: uniqueStrings(providers),
    padLl2Ids: uniqueNumbers(padLl2Ids),
    padCodes: uniqueStrings(padCodes),
    tiers: uniqueStrings(tiers) as Array<'major' | 'notable' | 'routine'>
  };
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).slice(0, 200);
}

function uniqueNumbers(values: number[]) {
  return Array.from(new Set(values.filter((n) => Number.isFinite(n)))).slice(0, 200);
}

function compareLaunches(a: any, b: any, sort: 'soonest' | 'latest' | 'changed') {
  if (sort === 'changed') {
    const aMs = a.lastUpdated ? Date.parse(a.lastUpdated) : 0;
    const bMs = b.lastUpdated ? Date.parse(b.lastUpdated) : 0;
    return bMs - aMs;
  }
  const aMs = Date.parse(a.net || '');
  const bMs = Date.parse(b.net || '');
  if (sort === 'latest') return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
  return (Number.isFinite(aMs) ? aMs : Number.POSITIVE_INFINITY) - (Number.isFinite(bMs) ? bMs : Number.POSITIVE_INFINITY);
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

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
