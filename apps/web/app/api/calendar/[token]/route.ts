import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { buildIcsCalendar } from '@/lib/calendar/ics';
import { normalizeNetPrecision } from '@/lib/ingestion/ll2Utils';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { getUserAccessEntitlementById } from '@/lib/server/entitlements';
import { getSiteUrl, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { parseLaunchRegion, US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import type { Launch, LaunchFilter } from '@/lib/types/launch';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TOKEN_CACHE_CONTROL = 'public, s-maxage=15, stale-while-revalidate=60';
const FEED_CACHE_TTL_MS = 30_000;
const MAX_ITEMS = 1000;
const MAX_LOOKAHEAD_DAYS = 365;
const MAX_LOOKBACK_DAYS = 365;

export async function GET(request: Request, { params }: { params: { token: string } }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: 'supabase_service_role_missing' }, { status: 501, headers: { 'Cache-Control': 'no-store' } });
  }

  const token = parseTokenParam(params.token);
  if (!token) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  const admin = createSupabaseAdminClient();
  const { data: feed, error: feedError } = await admin
    .from('calendar_feeds')
    .select('id,user_id,name,filters,alarm_minutes_before,cached_ics,cached_ics_etag,cached_ics_generated_at')
    .eq('token', token)
    .maybeSingle();

  if (feedError) {
    console.error('calendar feed lookup error', feedError);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!feed) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  const userId = String((feed as any).user_id || '').trim();
  const access = await getUserAccessEntitlementById({ userId, admin });
  if (access.loadError || !access.entitlement) {
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!access.entitlement.isPaid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  const ifNoneMatch = request.headers.get('if-none-match');
  const cached = readCachedFeed({
    body: (feed as any).cached_ics,
    etag: (feed as any).cached_ics_etag,
    generatedAt: (feed as any).cached_ics_generated_at
  });

  const headers: Record<string, string> = {
    'Cache-Control': TOKEN_CACHE_CONTROL,
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `inline; filename="${buildFilename((feed as any).name)}"`
  };

  const nowMs = Date.now();
  if (cached && nowMs - cached.generatedAtMs < FEED_CACHE_TTL_MS) {
    headers.ETag = cached.etag;
    if (ifNoneMatch && ifNoneMatch === cached.etag) {
      return new NextResponse(null, { status: 304, headers });
    }
    return new NextResponse(cached.body, { status: 200, headers });
  }

  const filters = safeFilterObject((feed as any).filters);
  const { from, to } = resolveBoundedWindow(filters, new Date());

  let query = admin
    .from('launches')
    .select(
      'id,ll2_launch_uuid,name,provider,vehicle,pad_name,pad_short_code,pad_state,pad_timezone,pad_country_code,net,net_precision,window_end,status_name,status_abbrev,tier_auto,tier_override'
    )
    .eq('hidden', false);

  const region = parseLaunchRegion(filters.region ?? 'us');
  if (region === 'us') query = query.in('pad_country_code', US_PAD_COUNTRY_CODES);
  if (region === 'non-us') query = query.not('pad_country_code', 'in', `(${US_PAD_COUNTRY_CODES.join(',')})`);

  if (from) query = query.gte('net', from);
  if (to) query = query.lt('net', to);
  if (filters.state) query = query.eq('pad_state', filters.state);
  if (filters.provider) query = query.eq('provider', filters.provider);
  if (filters.status && filters.status !== 'all') query = query.eq('status_name', filters.status);

  query = query.order('net', { ascending: true }).range(0, MAX_ITEMS - 1);

  const { data, error } = await query;
  if (error) {
    console.error('calendar feed launches query error', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }

  const launches = (Array.isArray(data) ? data : []).flatMap((row) => toIcsLaunch(row));
  const ics = buildIcsCalendar(launches, {
    siteUrl: getSiteUrl(),
    alarmMinutesBefore: typeof (feed as any).alarm_minutes_before === 'number' ? (feed as any).alarm_minutes_before : null
  });

  const etag = `"${crypto.createHash('sha1').update(ics).digest('hex')}"`;
  headers.ETag = etag;

  try {
    const { error: cacheError } = await admin
      .from('calendar_feeds')
      .update({
        cached_ics: ics,
        cached_ics_etag: etag,
        cached_ics_generated_at: new Date(nowMs).toISOString()
      })
      .eq('id', (feed as any).id);
    if (cacheError) console.warn('calendar feed cache update warning', cacheError);
  } catch (err) {
    console.warn('calendar feed cache update failed', err);
  }

  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, { status: 304, headers });
  }

  return new NextResponse(ics, { status: 200, headers });
}

function parseTokenParam(value: string | null | undefined) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const token = raw.replace(/\.ics$/i, '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)) return null;
  return token;
}

function safeFilterObject(value: unknown): LaunchFilter {
  if (!value || typeof value !== 'object') return {};
  return value as LaunchFilter;
}

function resolveBoundedWindow(filters: LaunchFilter, now: Date) {
  const range = filters.range ?? '7d';
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

  const lookbackDays = range === 'past' || range === 'all' ? MAX_LOOKBACK_DAYS : 0;

  const from = lookbackDays ? new Date(nowMs - lookbackDays * 24 * 60 * 60 * 1000).toISOString() : now.toISOString();
  const to = lookaheadDays ? new Date(nowMs + Math.min(MAX_LOOKAHEAD_DAYS, lookaheadDays) * 24 * 60 * 60 * 1000).toISOString() : now.toISOString();

  return { from, to };
}

function toIcsLaunch(row: any): Launch[] {
  const net = row?.net ? new Date(row.net).toISOString() : null;
  if (!net) return [];

  const id = String(row?.id || '').trim();
  if (!id) return [];

  const ll2Id = row?.ll2_launch_uuid ? String(row.ll2_launch_uuid) : id;

  const tierRaw = String(row?.tier_override || row?.tier_auto || 'routine').toLowerCase();
  const tier = tierRaw === 'major' || tierRaw === 'notable' || tierRaw === 'routine' ? tierRaw : 'routine';

  const statusRaw = String(row?.status_name || 'unknown').toLowerCase();
  const status =
    statusRaw === 'go' || statusRaw === 'hold' || statusRaw === 'scrubbed' || statusRaw === 'tbd' || statusRaw === 'unknown'
      ? statusRaw
      : 'unknown';

  const padName = String(row?.pad_name || 'Pad') || 'Pad';
  const padShortCode = String(row?.pad_short_code || padName || 'Pad') || 'Pad';
  const padState = String(row?.pad_state || 'NA') || 'NA';
  const padTimezone = String(row?.pad_timezone || 'UTC') || 'UTC';

  return [
    {
      id,
      name: String(row?.name || '').trim() || 'Launch',
      ll2Id,
      provider: String(row?.provider || 'Unknown') || 'Unknown',
      vehicle: String(row?.vehicle || 'Unknown') || 'Unknown',
      pad: {
        name: padName,
        shortCode: padShortCode,
        state: padState,
        timezone: padTimezone
      },
      net,
      netPrecision: normalizeNetPrecision(row?.net_precision),
      windowEnd: row?.window_end ? new Date(row.window_end).toISOString() : undefined,
      image: { thumbnail: 'https://images2.imgbox.com/00/00/default.png' },
      tier: tier as Launch['tier'],
      status: status as Launch['status'],
      statusText: String(row?.status_abbrev || row?.status_name || 'Unknown')
    }
  ];
}

function buildFilename(value: unknown) {
  const raw = String(value || '').trim();
  const base = raw ? raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) : 'launches';
  const name = base || 'launches';
  return `tminuszero-${name}.ics`;
}

function readCachedFeed({
  body,
  etag,
  generatedAt
}: {
  body: unknown;
  etag: unknown;
  generatedAt: unknown;
}): { body: string; etag: string; generatedAtMs: number } | null {
  const cachedBody = typeof body === 'string' ? body : null;
  if (!cachedBody) return null;

  const cachedEtag = typeof etag === 'string' && etag.trim() ? etag.trim() : `"${crypto.createHash('sha1').update(cachedBody).digest('hex')}"`;

  const generatedAtIso = typeof generatedAt === 'string' ? generatedAt : generatedAt instanceof Date ? generatedAt.toISOString() : null;
  const generatedAtMs = generatedAtIso ? Date.parse(generatedAtIso) : Number.NaN;
  if (!Number.isFinite(generatedAtMs)) return null;

  return { body: cachedBody, etag: cachedEtag, generatedAtMs };
}
