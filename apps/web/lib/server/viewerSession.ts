import type { User } from '@supabase/supabase-js';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import {
  createSupabaseAccessTokenClient,
  createSupabaseAdminClient,
  createSupabaseServerClient,
  readBearerAccessToken
} from '@/lib/server/supabaseServer';

export type ViewerAuthMode = 'guest' | 'cookie' | 'bearer';
export type ViewerRole = 'guest' | 'member' | 'admin';

export type ResolvedViewerSession = {
  authMode: ViewerAuthMode;
  role: ViewerRole;
  user: User | null;
  userId: string | null;
  email: string | null;
  accessToken: string | null;
  expiresAt: string | null;
};

function guestSession(): ResolvedViewerSession {
  return {
    authMode: 'guest',
    role: 'guest',
    user: null,
    userId: null,
    email: null,
    accessToken: null,
    expiresAt: null
  };
}

function inferRole(user: User | null): ViewerRole {
  if (!user) return 'guest';

  const roleCandidates = [
    (user.app_metadata as Record<string, unknown> | undefined)?.role,
    (user.user_metadata as Record<string, unknown> | undefined)?.role
  ];

  return roleCandidates.some((value) => String(value || '').trim().toLowerCase() === 'admin') ? 'admin' : 'member';
}

function parseAccessTokenExpiry(accessToken: string | null) {
  if (!accessToken) return null;

  const payload = accessToken.split('.')[1];
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as { exp?: unknown };
    const expSeconds = typeof parsed.exp === 'number' ? parsed.exp : Number.NaN;
    if (!Number.isFinite(expSeconds)) return null;
    return new Date(expSeconds * 1000).toISOString();
  } catch {
    return null;
  }
}

async function loadViewerRole({
  user,
  accessToken
}: {
  user: User | null;
  accessToken: string | null;
}): Promise<ViewerRole> {
  const fallbackRole = inferRole(user);
  if (!user?.id || !isSupabaseConfigured()) {
    return fallbackRole;
  }

  try {
    const client = isSupabaseAdminConfigured()
      ? createSupabaseAdminClient()
      : accessToken
        ? createSupabaseAccessTokenClient(accessToken)
        : createSupabaseServerClient();
    const { data, error } = await client.from('profiles').select('role').eq('user_id', user.id).maybeSingle();
    if (error) {
      return fallbackRole;
    }
    return String(data?.role || '').trim().toLowerCase() === 'admin' ? 'admin' : fallbackRole;
  } catch {
    return fallbackRole;
  }
}

async function buildResolvedSession({
  authMode,
  user,
  accessToken
}: {
  authMode: ViewerAuthMode;
  user: User;
  accessToken: string | null;
}): Promise<ResolvedViewerSession> {
  return {
    authMode,
    role: await loadViewerRole({ user, accessToken }),
    user,
    userId: user.id,
    email: user.email ?? null,
    accessToken,
    expiresAt: parseAccessTokenExpiry(accessToken)
  };
}

export async function resolveViewerSession(request?: Request): Promise<ResolvedViewerSession> {
  if (!isSupabaseConfigured()) {
    return guestSession();
  }

  const bearerToken = readBearerAccessToken(request?.headers);
  if (bearerToken) {
    try {
      const supabase = createSupabaseAccessTokenClient(bearerToken);
      const {
        data: { user }
      } = await supabase.auth.getUser(bearerToken);

      if (user) {
        return buildResolvedSession({
          authMode: 'bearer',
          user,
          accessToken: bearerToken
        });
      }
    } catch (error) {
      console.warn('bearer viewer session resolution failed', error);
    }
  }

  try {
    const supabase = createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (user) {
      return buildResolvedSession({
        authMode: 'cookie',
        user,
        accessToken: null
      });
    }
  } catch (error) {
    console.warn('cookie viewer session resolution failed', error);
  }

  return guestSession();
}
