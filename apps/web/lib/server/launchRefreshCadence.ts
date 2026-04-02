import {
  PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS,
  PREMIUM_LAUNCH_HOT_REFRESH_SECONDS,
  PREMIUM_LAUNCH_HOT_WINDOW_LAG_MS,
  isLaunchRefreshHotWindow,
  type LaunchRefreshCadenceReason
} from '@tminuszero/domain';
import {
  createSupabaseAccessTokenClient,
  createSupabasePublicClient,
  createSupabaseServerClient
} from '@/lib/server/supabaseServer';

type LaunchRefreshReadClient =
  | ReturnType<typeof createSupabaseServerClient>
  | ReturnType<typeof createSupabasePublicClient>
  | ReturnType<typeof createSupabaseAccessTokenClient>;

export type LaunchRefreshCadenceHint = {
  recommendedIntervalSeconds: number;
  cadenceReason: LaunchRefreshCadenceReason;
  cadenceAnchorNet: string | null;
};

export async function resolveLaunchRefreshCadenceHint({
  client,
  scope,
  nowMs = Date.now()
}: {
  client: LaunchRefreshReadClient;
  scope: 'public' | 'live';
  nowMs?: number;
}): Promise<LaunchRefreshCadenceHint> {
  const lowerBoundIso = new Date(nowMs - PREMIUM_LAUNCH_HOT_WINDOW_LAG_MS).toISOString();

  const query =
    scope === 'live'
      ? client.from('launches').select('net').eq('hidden', false).gte('net', lowerBoundIso)
      : client.from('launches_public_cache').select('net').gte('net', lowerBoundIso);

  const { data, error } = await query.order('net', { ascending: true }).limit(1).maybeSingle();
  if (error) {
    console.warn('launch refresh cadence query warning', { scope, error });
    return {
      recommendedIntervalSeconds: PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS,
      cadenceReason: 'default',
      cadenceAnchorNet: null
    };
  }

  const cadenceAnchorNet = typeof data?.net === 'string' ? data.net : null;
  const isHot = isLaunchRefreshHotWindow(cadenceAnchorNet, nowMs);

  return {
    recommendedIntervalSeconds: isHot ? PREMIUM_LAUNCH_HOT_REFRESH_SECONDS : PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS,
    cadenceReason: isHot ? 'site_hot_window' : 'default',
    cadenceAnchorNet
  };
}
