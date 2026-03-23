import type { ViewerMode } from './viewer';

export type LaunchRefreshTimestampLike = {
  cacheGeneratedAt?: string | null;
  lastUpdated?: string | null;
};

export function getVisibleFeedUpdatedAt<T extends LaunchRefreshTimestampLike>(
  launches: readonly T[],
  mode: ViewerMode
) {
  let latestMs = Number.NEGATIVE_INFINITY;
  let latestValue: string | null = null;

  for (const launch of launches) {
    const candidate = mode === 'live' ? launch.lastUpdated ?? null : launch.cacheGeneratedAt ?? null;
    if (!candidate) continue;
    const candidateMs = Date.parse(candidate);
    if (!Number.isFinite(candidateMs)) continue;
    if (candidateMs > latestMs) {
      latestMs = candidateMs;
      latestValue = candidate;
    }
  }

  return latestValue;
}

export function getVisibleDetailUpdatedAt(detail: LaunchRefreshTimestampLike | null) {
  return detail?.cacheGeneratedAt ?? detail?.lastUpdated ?? null;
}

export function shouldPrimeVersionRefresh(payloadUpdatedAt: string | null | undefined, visibleUpdatedAt: string | null | undefined) {
  if (!payloadUpdatedAt || !visibleUpdatedAt) {
    return false;
  }

  const payloadMs = Date.parse(payloadUpdatedAt);
  const visibleMs = Date.parse(visibleUpdatedAt);
  if (!Number.isFinite(payloadMs) || !Number.isFinite(visibleMs)) {
    return false;
  }

  return payloadMs > visibleMs;
}

export function hasVersionChanged(lastSeenVersion: string | null | undefined, nextVersion: string | null | undefined) {
  return Boolean(nextVersion) && nextVersion !== lastSeenVersion;
}

export function buildPendingFeedRefreshMessage({
  matchCount,
  visibleCount,
  canCompareCount
}: {
  matchCount: number;
  visibleCount: number;
  canCompareCount: boolean;
}) {
  if (canCompareCount) {
    const delta = matchCount - visibleCount;
    if (delta > 0) {
      return `${delta} new ${delta === 1 ? 'launch is' : 'launches are'} ready.`;
    }
  }

  return 'Launch schedule updated.';
}

export function canAutoRefreshActiveSurface({
  isFocused,
  appStateStatus,
  blocked = false
}: {
  isFocused: boolean;
  appStateStatus: string;
  blocked?: boolean;
}) {
  return isFocused && appStateStatus === 'active' && !blocked;
}

export function buildDetailVersionToken(launchId: string, scope: ViewerMode, updatedAt: string | null) {
  return `${launchId}|${scope}|${updatedAt ?? 'null'}`;
}
