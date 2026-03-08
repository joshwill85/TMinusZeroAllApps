import type { Launch, LaunchFilter } from '@/lib/types/launch';
import { LAUNCH_FEED_PAGE_SIZE } from '@/lib/constants/launchFeed';
import { NEXT_LAUNCH_RETENTION_MS } from '@/lib/constants/launchTimeline';
import { attachNextLaunchEvents } from '@/lib/server/ll2Events';
import { isSupabaseConfigured } from '@/lib/server/env';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { mapLiveLaunchRow, mapPublicCacheRow } from '@/lib/server/transformers';
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

  const supabase = createSupabaseServerClient();
  const now = new Date(safeNowMs);
  const { from, to } = resolveDateWindow({ range: FEED_RANGE, now, mode });

  let query =
    mode === 'live' ? supabase.from('launches').select('*').eq('hidden', false) : supabase.from('launches_public_cache').select('*');
  if (FEED_REGION === 'us') query = query.in('pad_country_code', US_PAD_COUNTRY_CODES);
  if (FEED_REGION === 'non-us') query = query.not('pad_country_code', 'in', `(${US_PAD_COUNTRY_CODES.join(',')})`);
  if (from) query = query.gte('net', from);
  if (to) query = query.lt('net', to);

  query =
    FEED_SORT === 'changed'
      ? query.order(mode === 'live' ? 'last_updated_source' : 'cache_generated_at', { ascending: false })
      : FEED_SORT === 'latest'
        ? query.order('net', { ascending: false })
        : query.order('net', { ascending: true });
  query = query.range(offset, offset + LAUNCH_FEED_PAGE_SIZE - 1);

  const { data, error } = await query;
  if (error || !data) {
    console.error('home launch feed query error', error);
    return { launches: [], offset, hasMore: false };
  }

  const launches = data.map(mode === 'live' ? mapLiveLaunchRow : mapPublicCacheRow);
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
  now,
  mode
}: {
  range: NonNullable<LaunchFilter['range']>;
  now: Date;
  mode: 'public' | 'live';
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
