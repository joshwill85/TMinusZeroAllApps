import { createBrowserClient } from '@supabase/ssr';
import { buildLaunchRefreshChannelTopic, buildLaunchRefreshStateKey, type LaunchRefreshStateScope } from '@tminuszero/domain';
import { CANONICAL_HOST, COOKIE_DOMAIN, DOMAIN_APEX } from '@/lib/brand';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
type BrowserClient = ReturnType<typeof createBrowserClient>;
const browserClientKey = '__tminus_supabase_browser_client__';

function isSupabaseBrowserConfigured() {
  const url = supabaseUrl?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return false;
  if (url.includes('your-supabase-url.supabase.co') || url.includes('<project-ref>')) return false;
  if (anonKey === 'SUPABASE_ANON_KEY' || anonKey === 'anon_placeholder' || anonKey === 'public_anon_key') return false;
  return true;
}

export function getBrowserClient() {
  if (typeof window === 'undefined') return null;
  if (!isSupabaseBrowserConfigured() || !supabaseUrl) return null;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) return null;
  const globalClient = globalThis as typeof globalThis & { [browserClientKey]?: BrowserClient };
  if (!globalClient[browserClientKey]) {
    const hostname = window.location.hostname;
    const isProdDomain = hostname === DOMAIN_APEX || hostname === CANONICAL_HOST;
    const cookieOptions = isProdDomain
      ? {
          domain: COOKIE_DOMAIN,
          sameSite: 'lax' as const,
          secure: window.location.protocol === 'https:',
          path: '/'
        }
      : undefined;
    globalClient[browserClientKey] = createBrowserClient(supabaseUrl, anonKey, {
      cookieOptions
    });
  }
  return globalClient[browserClientKey] ?? null;
}

export function getAnonClient() {
  return getBrowserClient();
}

export async function subscribeToBrowserLaunchRefreshSignal({
  scope,
  launchId,
  onSignal
}: {
  scope: LaunchRefreshStateScope;
  launchId?: string | null;
  onSignal: () => void | Promise<void>;
}) {
  const supabase = getBrowserClient();
  if (!supabase) {
    return null;
  }

  const {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return null;
  }

  await supabase.realtime.setAuth(session.access_token);

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
