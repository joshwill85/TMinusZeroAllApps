import { NextResponse } from 'next/server';
import { buildIcsCalendar } from '@/lib/calendar/ics';
import { mapPublicCacheRow } from '@/lib/server/transformers';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { getSiteUrl, isSupabaseConfigured } from '@/lib/server/env';
import { getViewerTier } from '@/lib/server/viewerTier';
import { parseLaunchRegion, US_PAD_COUNTRY_CODES } from '@/lib/server/us';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  const viewer = await getViewerTier();
  const supabase = createSupabaseServerClient();

  if (viewer.isAuthed) {
    if (viewer.tier !== 'premium') {
      return NextResponse.json({ error: 'payment_required' }, { status: 402 });
    }
  } else {
    const ok = await validateCalendarToken(supabase, token);
    if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const range = (searchParams.get('range') || '7d') as 'today' | '7d' | 'month' | 'year' | 'past' | 'all';
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const limitParam = searchParams.get('limit');
  const region = parseLaunchRegion(searchParams.get('region'));
  const state = searchParams.get('state');
  const provider = searchParams.get('provider');
  const status = searchParams.get('status');

  const now = new Date();
  const parsedFrom = parseDateParam(fromParam);
  const parsedTo = parseDateParam(toParam);
  const { from, to } = resolveDateWindow({ range, parsedFrom, parsedTo, now });
  const limit = clampInt(limitParam, 1000, 1, 1000);

  let query = supabase.from('launches_public_cache').select('*');
  if (region === 'us') query = query.in('pad_country_code', US_PAD_COUNTRY_CODES);
  if (region === 'non-us') query = query.not('pad_country_code', 'in', `(${US_PAD_COUNTRY_CODES.join(',')})`);
  if (from) query = query.gte('net', from);
  if (to) query = query.lt('net', to);
  if (state) query = query.eq('pad_state_code', state);
  if (provider) query = query.eq('provider', provider);
  if (status) query = query.eq('status_name', status);

  query = query.order('net', { ascending: true }).range(0, limit - 1);

  const { data, error } = await query;
  if (error || !data) {
    console.error('bulk ics query error', error);
    return NextResponse.json({ error: 'public_cache_query_failed' }, { status: 500 });
  }

  const launches = data.map(mapPublicCacheRow);
  const ics = buildIcsCalendar(launches, { siteUrl: getSiteUrl() });
  const filename = 'tminuszero-launches.ics';
  const disposition = !viewer.isAuthed && token ? 'inline' : 'attachment';

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `${disposition}; filename="${filename}"`,
      'Cache-Control': 'private, max-age=300'
    }
  });
}

async function validateCalendarToken(supabase: ReturnType<typeof createSupabaseServerClient>, token: string | null) {
  if (!token) return false;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) return false;

  const { data, error } = await supabase.rpc('validate_calendar_token', { token_in: token });
  if (error) {
    console.error('calendar token validation error', error);
    return false;
  }
  return data === true;
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
  const from = now.toISOString();
  const to = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  return { from, to };
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
