import { createClient } from '@supabase/supabase-js';
import { buildLaunchRefreshChannelTopic, buildLaunchRefreshStateKey, type LaunchRefreshStateScope } from '@tminuszero/domain';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/src/config/api';

let mobileRealtimeClient: ReturnType<typeof createClient> | null = null;

function getMobileRealtimeClient() {
  if (mobileRealtimeClient) {
    return mobileRealtimeClient;
  }

  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) {
    return null;
  }

  mobileRealtimeClient = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });

  return mobileRealtimeClient;
}

export async function subscribeToMobileLaunchRefreshSignal({
  accessToken,
  scope,
  launchId,
  onSignal
}: {
  accessToken: string | null;
  scope: LaunchRefreshStateScope;
  launchId?: string | null;
  onSignal: () => void | Promise<void>;
}) {
  if (!accessToken) {
    return null;
  }

  const supabase = getMobileRealtimeClient();
  if (!supabase) {
    return null;
  }

  await supabase.realtime.setAuth(accessToken);

  const topic = buildLaunchRefreshChannelTopic(buildLaunchRefreshStateKey(scope, launchId));
  const channel = supabase
    .channel(topic, { config: { private: true } })
    .on('broadcast', { event: 'INSERT' }, () => void onSignal())
    .on('broadcast', { event: 'UPDATE' }, () => void onSignal())
    .on('broadcast', { event: 'DELETE' }, () => void onSignal());

  channel.subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
