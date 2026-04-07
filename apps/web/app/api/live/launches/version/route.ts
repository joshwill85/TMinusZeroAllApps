import { NextResponse } from 'next/server';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { resolveLaunchRefreshCadenceHint } from '@/lib/server/launchRefreshCadence';
import { getViewerTier } from '@/lib/server/viewerTier';
import { parseLaunchRegion, US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import { buildStatusFilterOrClause, parseLaunchStatusFilter } from '@/lib/server/launchStatus';
import { NEXT_LAUNCH_RETENTION_MS } from '@/lib/constants/launchTimeline';

export const dynamic = 'force-dynamic';

const FEED_VERSION_FIELDS = [
  'name',
  'status_id',
  'status_name',
  'status_abbrev',
  'net',
  'net_precision',
  'window_start',
  'window_end',
  'provider',
  'provider_logo_url',
  'provider_image_url',
  'vehicle',
  'rocket_full_name',
  'rocket_manufacturer_logo_url',
  'rocket_manufacturer_image_url',
  'pad_name',
  'pad_short_code',
  'pad_state',
  'pad_location_name',
  'pad_timezone',
  'mission_name',
  'mission_type',
  'mission_orbit',
  'payloads',
  'image_url',
  'image_thumbnail_url',
  'image_credit',
  'image_license_name',
  'image_license_url',
  'image_single_use',
  'webcast_live',
  'video_url',
  'featured',
  'tier_override',
  'tier_auto',
  'timeline',
  'weather_icon_url'
] as const;

export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const range = (searchParams.get('range') || '7d') as 'today' | '7d' | 'month' | 'year' | 'past' | 'all';
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const location = searchParams.get('location');
  const state = searchParams.get('state');
  const pad = searchParams.get('pad');
  const provider = searchParams.get('provider');
  const status = parseLaunchStatusFilter(searchParams.get('status'));
  const region = parseLaunchRegion(searchParams.get('region'));
  const now = new Date();
  const parsedFrom = parseDateParam(fromParam);
  const parsedTo = parseDateParam(toParam);
  const { from, to } = resolveDateWindow({ range, parsedFrom, parsedTo, now });

  const supabase = createSupabaseServerClient();

  let countQuery = supabase.from('launches').select('id', { count: 'exact', head: true }).eq('hidden', false);
  countQuery = applyLaunchFilters(countQuery, {
    region,
    from,
    to,
    location,
    state,
    pad,
    provider,
    status
  });

  const { count: matchCount, error: countError } = await countQuery;
  if (countError) {
    console.error('launches version count error', countError);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  let latestUpdateId: number | null = null;
  if (isSupabaseAdminConfigured()) {
    const admin = createSupabaseAdminClient();
    let updatesQuery = admin
      .from('launch_updates')
      .select('id, launches!inner(hidden, net, pad_country_code, pad_location_name, pad_state, pad_name, provider, status_name)')
      .eq('launches.hidden', false)
      .overlaps('changed_fields', FEED_VERSION_FIELDS as unknown as string[]);
    updatesQuery = applyLaunchFilters(
      updatesQuery,
      { region, from, to, location, state, pad, provider, status },
      'launches'
    );

    const { data: latestUpdate, error: latestUpdateError } = await updatesQuery
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestUpdateError) {
      console.error('launch updates version fetch error', latestUpdateError);
      return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
    }

    latestUpdateId = typeof latestUpdate?.id === 'number' ? latestUpdate.id : null;
  }

  const version = isSupabaseAdminConfigured()
    ? `${matchCount ?? 0}|${latestUpdateId ?? 'null'}`
    : `${matchCount ?? 0}|null`;
  const cadenceHint = await resolveLaunchRefreshCadenceHint({ client: supabase, scope: 'live' });

  return NextResponse.json(
    {
      tier: viewer.tier,
      intervalSeconds: cadenceHint.recommendedIntervalSeconds,
      recommendedIntervalSeconds: cadenceHint.recommendedIntervalSeconds,
      cadenceReason: cadenceHint.cadenceReason,
      cadenceAnchorNet: cadenceHint.cadenceAnchorNet,
      matchCount: matchCount ?? 0,
      latestUpdateId,
      version
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

function parseDateParam(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function applyLaunchFilters(
  query: any,
  {
    region,
    from,
    to,
    location,
    state,
    pad,
    provider,
    status
  }: {
    region: ReturnType<typeof parseLaunchRegion>;
    from: string | null;
    to: string | null;
    location: string | null;
    state: string | null;
    pad: string | null;
    provider: string | null;
    status: 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown' | null;
  },
  prefix = ''
) {
  const col = (name: string) => (prefix ? `${prefix}.${name}` : name);
  let next = query;
  if (region === 'us') next = next.in(col('pad_country_code'), US_PAD_COUNTRY_CODES);
  if (region === 'non-us') next = next.not(col('pad_country_code'), 'in', `(${US_PAD_COUNTRY_CODES.join(',')})`);
  if (from) next = next.gte(col('net'), from);
  if (to) next = next.lt(col('net'), to);
  if (location) next = next.eq(col('pad_location_name'), location);
  if (state) next = next.eq(col('pad_state'), state);
  if (pad) next = next.eq(col('pad_name'), pad);
  if (provider) next = next.eq(col('provider'), provider);
  if (status) {
    const statusClause = buildStatusFilterOrClause(status, prefix);
    if (statusClause) next = next.or(statusClause);
  }
  return next;
}
