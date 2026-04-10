import { NextResponse } from 'next/server';
import { NEXT_LAUNCH_RETENTION_MS } from '@/lib/constants/launchTimeline';
import { isSupabaseConfigured } from '@/lib/server/env';
import { enforceLegacyPublicLaunchFeedRateLimit } from '@/lib/server/launchApiRateLimit';
import { logLaunchRefreshDiagnostic } from '@/lib/server/launchRefreshDiagnostics';
import {
  loadPublicLaunchPage,
  PublicLaunchFeedError,
  type PublicLaunchFeedSort
} from '@/lib/server/publicLaunchFeed';
import { parseLaunchStatusFilter } from '@/lib/server/launchStatus';
import { parseLaunchRegion } from '@/lib/server/us';

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
  const sort = (searchParams.get('sort') || 'soonest') as PublicLaunchFeedSort;
  const region = parseLaunchRegion(searchParams.get('region'));
  const freshness: 'public-cache-db' = 'public-cache-db';
  const intervalMinutes = 120;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const rateLimited = await enforceLegacyPublicLaunchFeedRateLimit(request);
  if (rateLimited) {
    return rateLimited;
  }

  const now = new Date();
  const parsedFrom = parseDateParam(fromParam);
  const parsedTo = parseDateParam(toParam);
  const { from, to } = resolveDateWindow({ range, parsedFrom, parsedTo, now });

  const limit = clampInt(limitParam, 100, 1, 1000);
  const offset = clampInt(offsetParam, 0, 0, 100_000);

  try {
    const result = await loadPublicLaunchPage(
      {
        from,
        to,
        location,
        state,
        pad,
        padId: null,
        provider,
        providerId: null,
        rocketId: null,
        status,
        sort,
        region,
        limit,
        offset
      },
      {
        nowMs: now.getTime(),
        filterMilestones: range !== 'past' && range !== 'all' && !parsedFrom && !parsedTo
      }
    );

    logLaunchRefreshDiagnostic('route_response', {
      route: 'api_public_launches_payload',
      scope: 'public',
      cacheControl: 'public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400',
      launchCount: result.launches.length,
      hasMore: result.hasMore
    });
    return NextResponse.json(
      {
        freshness,
        intervalMinutes,
        hasMore: result.hasMore,
        launches: result.launches
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400'
        }
      }
    );
  } catch (error) {
    if (error instanceof PublicLaunchFeedError) {
      return NextResponse.json({ error: 'public_cache_query_failed' }, { status: 500 });
    }
    console.error('public launches api error', error);
    return NextResponse.json({ error: 'public_cache_query_failed' }, { status: 500 });
  }
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
