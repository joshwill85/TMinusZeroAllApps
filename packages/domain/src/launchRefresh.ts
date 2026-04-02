import { getNextAlignedRefreshMs, type ViewerMode } from './viewer';

export const PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS = 120;
export const PREMIUM_LAUNCH_HOT_REFRESH_SECONDS = 15;
export const PREMIUM_LAUNCH_HOT_WINDOW_LEAD_MS = 60 * 60 * 1000;
export const PREMIUM_LAUNCH_HOT_WINDOW_LAG_MS = 30 * 60 * 1000;

export type LaunchRefreshCadenceReason = 'default' | 'site_hot_window';

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

export function buildPendingFeedRefreshMessage() {
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

export function isLaunchRefreshHotWindow(anchorNet: string | null | undefined, nowMs = Date.now()) {
  const anchorMs = Date.parse(String(anchorNet || ''));
  if (!Number.isFinite(anchorMs) || !Number.isFinite(nowMs)) {
    return false;
  }

  return nowMs >= anchorMs - PREMIUM_LAUNCH_HOT_WINDOW_LEAD_MS && nowMs < anchorMs + PREMIUM_LAUNCH_HOT_WINDOW_LAG_MS;
}

export function getLaunchRefreshAnchorStartMs(anchorNet: string | null | undefined) {
  const anchorMs = Date.parse(String(anchorNet || ''));
  if (!Number.isFinite(anchorMs)) {
    return null;
  }

  return anchorMs - PREMIUM_LAUNCH_HOT_WINDOW_LEAD_MS;
}

export function getRecommendedLaunchRefreshIntervalSeconds(
  recommendedIntervalSeconds: number | null | undefined,
  fallbackSeconds: number
) {
  if (Number.isFinite(recommendedIntervalSeconds) && Number(recommendedIntervalSeconds) > 0) {
    return Math.max(1, Math.trunc(Number(recommendedIntervalSeconds)));
  }

  return Math.max(1, Math.trunc(fallbackSeconds));
}

export function getNextAdaptiveLaunchRefreshMs({
  nowMs,
  intervalSeconds,
  cadenceAnchorNet
}: {
  nowMs: number;
  intervalSeconds: number;
  cadenceAnchorNet?: string | null;
}) {
  const nextAligned = getNextAlignedRefreshMs(nowMs, intervalSeconds * 1000);
  const anchorStartMs = getLaunchRefreshAnchorStartMs(cadenceAnchorNet);
  if (
    intervalSeconds > PREMIUM_LAUNCH_HOT_REFRESH_SECONDS &&
    anchorStartMs != null &&
    Number.isFinite(anchorStartMs) &&
    anchorStartMs > nowMs
  ) {
    return Math.min(nextAligned, anchorStartMs);
  }

  return nextAligned;
}
