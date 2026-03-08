import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { mapLiveLaunchRow } from '@/lib/server/transformers';
import { attachNextLaunchEvents } from '@/lib/server/ll2Events';
import { NEXT_LAUNCH_RETENTION_MS } from '@/lib/constants/launchTimeline';
import { isSupabaseConfigured } from '@/lib/server/env';
import { getViewerTier } from '@/lib/server/viewerTier';
import { Launch } from '@/lib/types/launch';
import { parseLaunchRegion, US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import { buildStatusFilterOrClause, parseLaunchStatusFilter } from '@/lib/server/launchStatus';
import { isLaunchWithinMilestoneWindow } from '@/lib/utils/launchMilestones';
export const dynamic = 'force-dynamic';

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
  const sort = (searchParams.get('sort') || 'soonest') as 'soonest' | 'latest' | 'changed';
  const region = parseLaunchRegion(searchParams.get('region'));
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const viewer = await getViewerTier();
  if (!viewer.isAuthed) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (viewer.tier !== 'premium') {
    return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  }

  const supabase = createSupabaseServerClient();

  const now = new Date();
  const parsedFrom = parseDateParam(fromParam);
  const parsedTo = parseDateParam(toParam);
  const { from, to } = resolveDateWindow({ range, parsedFrom, parsedTo, now });

  const limit = clampInt(limitParam, 100, 1, 1000);
  const offset = clampInt(offsetParam, 0, 0, 100_000);

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
  query = query.range(offset, offset + limit - 1);

  const { data, error } = await query;

  if (error) {
    console.error('live launches query error', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  const launches = ((data || []) as any[]).map(mapLiveLaunchRow).map(withLiveActivity);
  const launchesWithEvents = await attachNextLaunchEvents(supabase, launches);
  const shouldFilterByMilestones = range !== 'past' && range !== 'all' && !parsedFrom && !parsedTo;
  const nowMs = now.getTime();
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
      freshness: 'live-db',
      intervalSeconds: viewer.refreshIntervalSeconds,
      tier: viewer.tier,
      launches: launchesInWindow
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
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

function withLiveActivity(l: Launch) {
  return {
    ...l,
    live_activity: {
      rocket_name: l.vehicle,
      mission_name: l.name,
      t0_utc: l.net,
      t_minus_seconds: Math.max(0, Math.round((new Date(l.net).getTime() - Date.now()) / 1000)),
      status: l.status,
      pad: { code: l.pad.shortCode, timezone: l.pad.timezone },
      last_update_utc: l.lastUpdated || new Date().toISOString()
    }
  };
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
