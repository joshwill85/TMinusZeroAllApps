import { unstable_cache } from 'next/cache';
import type { Launch, LaunchFilter } from '@/lib/types/launch';
import { LAUNCH_FEED_PAGE_SIZE } from '@/lib/constants/launchFeed';
import { NEXT_LAUNCH_RETENTION_MS } from '@/lib/constants/launchTimeline';
import { attachNextLaunchEvents } from '@/lib/server/ll2Events';
import { isSupabaseConfigured } from '@/lib/server/env';
import { loadPublicLaunchPage } from '@/lib/server/publicLaunchFeed';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { mapLiveLaunchRow } from '@/lib/server/transformers';
import { US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import { isLaunchWithinMilestoneWindow } from '@/lib/utils/launchMilestones';

type HomeLaunchFeedResult = {
  launches: Launch[];
  offset: number;
  hasMore: boolean;
};

const FEED_RANGE: NonNullable<LaunchFilter['range']> = 'year';
const FEED_SORT: LaunchFilter['sort'] = 'soonest';
const FEED_REGION: LaunchFilter['region'] = 'us';
const HOME_FEED_CACHE_REVALIDATE_SECONDS = 600;
const HOME_FEED_CACHE_BUCKET_MS = HOME_FEED_CACHE_REVALIDATE_SECONDS * 1000;

const fetchCachedPublicHomeLaunchFeed = unstable_cache(
  async (page: number, bucketNowMs: number): Promise<HomeLaunchFeedResult> => {
    const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
    const offset = (safePage - 1) * LAUNCH_FEED_PAGE_SIZE;
    const { from, to } = resolveDateWindow({
      range: FEED_RANGE,
      now: new Date(bucketNowMs)
    });
    const result = await loadPublicLaunchPage(
      {
        from,
        to,
        location: null,
        state: null,
        pad: null,
        padId: null,
        provider: null,
        providerId: null,
        rocketId: null,
        status: null,
        sort: FEED_SORT,
        region: FEED_REGION,
        limit: LAUNCH_FEED_PAGE_SIZE,
        offset
      },
      {
        nowMs: bucketNowMs
      }
    );

    return {
      launches: result.launches,
      offset,
      hasMore: result.hasMore
    };
  },
  ['home-launch-feed-v2'],
  { revalidate: HOME_FEED_CACHE_REVALIDATE_SECONDS }
);

export async function fetchHomeLaunchFeed({
  page,
  nowMs,
  mode = 'public'
}: {
  page: number;
  nowMs: number;
  mode?: 'public' | 'live';
}): Promise<HomeLaunchFeedResult> {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
  const offset = (safePage - 1) * LAUNCH_FEED_PAGE_SIZE;
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();

  if (!isSupabaseConfigured()) {
    return { launches: [], offset, hasMore: false };
  }

  if (mode === 'public') {
    const bucketNowMs = Math.floor(safeNowMs / HOME_FEED_CACHE_BUCKET_MS) * HOME_FEED_CACHE_BUCKET_MS;
    try {
      return await fetchCachedPublicHomeLaunchFeed(safePage, bucketNowMs);
    } catch (error) {
      console.error('home launch feed query error', error);
      return { launches: [], offset, hasMore: false };
    }
  }

  const supabase = createSupabaseServerClient();
  const { from, to } = resolveDateWindow({ range: FEED_RANGE, now: new Date(safeNowMs) });

  let query = supabase.from('launches').select('*').eq('hidden', false);
  if (FEED_REGION === 'us') query = query.in('pad_country_code', US_PAD_COUNTRY_CODES);
  if (FEED_REGION === 'non-us') query = query.not('pad_country_code', 'in', `(${US_PAD_COUNTRY_CODES.join(',')})`);
  if (from) query = query.gte('net', from);
  if (to) query = query.lt('net', to);

  query =
    FEED_SORT === 'changed'
      ? query.order('last_updated_source', { ascending: false })
      : FEED_SORT === 'latest'
        ? query.order('net', { ascending: false })
        : query.order('net', { ascending: true });
  query = query.range(offset, offset + LAUNCH_FEED_PAGE_SIZE - 1);

  const { data, error } = await query;
  if (error || !data) {
    console.error('home launch feed query error', error);
    return { launches: [], offset, hasMore: false };
  }

  const launches = data.map(mapLiveLaunchRow);
  const launchesWithEvents = await attachNextLaunchEvents(supabase, launches, safeNowMs);
  const launchesInWindow = launchesWithEvents.filter((launch) =>
    isLaunchWithinMilestoneWindow(launch, safeNowMs, NEXT_LAUNCH_RETENTION_MS, {
      // Keep homepage retention pinned to T+120 for "next launch" behavior.
      ignoreTimeline: true
    })
  );

  return {
    launches: launchesInWindow,
    offset,
    hasMore: launches.length === LAUNCH_FEED_PAGE_SIZE
  };
}

function resolveDateWindow({
  range,
  now
}: {
  range: NonNullable<LaunchFilter['range']>;
  now: Date;
}) {
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
