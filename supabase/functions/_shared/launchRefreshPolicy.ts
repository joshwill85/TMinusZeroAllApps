import { createSupabaseAdminClient } from './supabase.ts';

// Keep these values aligned with packages/domain/src/launchRefresh.ts.
export const PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS = 120;
export const PREMIUM_LAUNCH_HOT_REFRESH_SECONDS = 15;
export const PREMIUM_LAUNCH_HOT_WINDOW_LEAD_MS = 60 * 60 * 1000;
export const PREMIUM_LAUNCH_HOT_WINDOW_LAG_MS = 30 * 60 * 1000;

export type LaunchRefreshCadenceReason = 'default' | 'site_hot_window';

export function isLaunchRefreshHotWindow(anchorNet: string | null | undefined, nowMs = Date.now()) {
  const anchorMs = Date.parse(String(anchorNet || ''));
  if (!Number.isFinite(anchorMs) || !Number.isFinite(nowMs)) {
    return false;
  }

  return nowMs >= anchorMs - PREMIUM_LAUNCH_HOT_WINDOW_LEAD_MS && nowMs < anchorMs + PREMIUM_LAUNCH_HOT_WINDOW_LAG_MS;
}

export async function resolveLaunchRefreshCadence(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  nowMs = Date.now()
) {
  const lowerBoundIso = new Date(nowMs - PREMIUM_LAUNCH_HOT_WINDOW_LAG_MS).toISOString();
  const { data, error } = await supabase
    .from('launches')
    .select('net')
    .eq('hidden', false)
    .gte('net', lowerBoundIso)
    .order('net', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('launch refresh cadence query warning', { error });
    return {
      recommendedIntervalSeconds: PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS,
      cadenceReason: 'default' as LaunchRefreshCadenceReason,
      cadenceAnchorNet: null,
      isHotWindow: false
    };
  }

  const cadenceAnchorNet = typeof data?.net === 'string' ? data.net : null;
  const isHotWindow = isLaunchRefreshHotWindow(cadenceAnchorNet, nowMs);

  return {
    recommendedIntervalSeconds: isHotWindow ? PREMIUM_LAUNCH_HOT_REFRESH_SECONDS : PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS,
    cadenceReason: isHotWindow ? ('site_hot_window' as LaunchRefreshCadenceReason) : ('default' as LaunchRefreshCadenceReason),
    cadenceAnchorNet,
    isHotWindow
  };
}

export function getLl2IncrementalHeartbeatThresholdMinutes(intervalSeconds: number) {
  return intervalSeconds <= PREMIUM_LAUNCH_HOT_REFRESH_SECONDS ? 2 : 5;
}
