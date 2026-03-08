import { getSupabaseAnonKey, getSupabaseUrl } from '@/src/config/api';

type MobileAuthSession = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  userId: string | null;
  email: string | null;
};

type SupabaseAuthError = Error & {
  status?: number;
};

function getSupabaseAuthConfig() {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  if (!url || !anonKey) {
    throw new Error('Supabase auth is not configured for mobile. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }

  return { url, anonKey };
}

async function authRequest(pathname: string, init: RequestInit = {}) {
  const { url, anonKey } = getSupabaseAuthConfig();
  const headers = new Headers(init.headers ?? {});
  headers.set('apikey', anonKey);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${url}${pathname}`, {
    ...init,
    headers
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof json?.msg === 'string'
        ? json.msg
        : typeof json?.error_description === 'string'
          ? json.error_description
          : typeof json?.message === 'string'
            ? json.message
            : `Supabase auth request failed (${response.status})`;
    const error = new Error(message) as SupabaseAuthError;
    error.status = response.status;
    throw error;
  }

  return json;
}

function parseAuthSession(payload: unknown): MobileAuthSession {
  const data = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  const user = data?.user && typeof data.user === 'object' ? (data.user as Record<string, unknown>) : null;
  const accessToken = String(data?.access_token || '').trim();
  if (!accessToken) {
    throw new Error('Supabase auth response did not include an access token.');
  }

  return {
    accessToken,
    refreshToken: typeof data?.refresh_token === 'string' ? data.refresh_token : null,
    expiresIn: Number.isFinite(data?.expires_in) ? Number(data.expires_in) : null,
    userId: typeof user?.id === 'string' ? user.id : null,
    email: typeof user?.email === 'string' ? user.email : null
  };
}

export function isSupabaseMobileAuthConfigured() {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

export async function signInWithPassword(email: string, password: string) {
  const payload = await authRequest('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password
    })
  });

  return parseAuthSession(payload);
}

export async function verifyOtpTokenHash(tokenHash: string, type: string) {
  const payload = await authRequest('/auth/v1/verify', {
    method: 'POST',
    body: JSON.stringify({
      token_hash: tokenHash,
      type
    })
  });

  return parseAuthSession(payload);
}

export async function updatePassword(accessToken: string, password: string) {
  const payload = await authRequest('/auth/v1/user', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      password
    })
  });

  return {
    userId: typeof payload?.id === 'string' ? payload.id : null,
    email: typeof payload?.email === 'string' ? payload.email : null
  };
}

export async function signOut(accessToken: string | null) {
  if (!accessToken) return;

  try {
    await authRequest('/auth/v1/logout', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
  } catch {
    // Best effort. Local token removal is the source of truth for the mobile shell.
  }
}
