export type LaunchRefreshStateScope = 'feed_public' | 'feed_live' | 'detail_public' | 'detail_live';

export function isLaunchRefreshStateScope(value: string): value is LaunchRefreshStateScope {
  return value === 'feed_public' || value === 'feed_live' || value === 'detail_public' || value === 'detail_live';
}

export function buildLaunchRefreshStateKey(scope: LaunchRefreshStateScope, launchId?: string | null) {
  if (scope === 'feed_public') return 'feed:public';
  if (scope === 'feed_live') return 'feed:live';

  const normalizedLaunchId = String(launchId || '').trim();
  if (!normalizedLaunchId) {
    throw new Error(`launchId is required for ${scope}`);
  }

  return scope === 'detail_public' ? `detail:public:${normalizedLaunchId}` : `detail:live:${normalizedLaunchId}`;
}

export function buildLaunchRefreshChannelTopic(cacheKey: string) {
  return `launch-refresh:${cacheKey}`;
}
