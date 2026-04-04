import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

type HeaderReader = {
  get: (name: string) => string | null;
};

function requireEnv(name: string, value: string | undefined, placeholders: string[]) {
  const trimmed = value?.trim();
  if (!trimmed || placeholders.some((p) => trimmed === p || trimmed.includes(p))) {
    throw new Error(`Missing or invalid env: ${name}`);
  }
  return trimmed;
}

function getSupabaseUrl() {
  return requireEnv('NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)', process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, [
    'your-supabase-url.supabase.co'
  ]);
}

function getSupabaseAnonKey() {
  return requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, ['SUPABASE_ANON_KEY', 'anon_placeholder', 'public_anon_key']);
}

function getSupabaseServiceRoleKey() {
  return requireEnv('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY, ['SUPABASE_SERVICE_ROLE_KEY', 'service_role_placeholder', 'service_role_key']);
}

function getSupabaseSiteReadKey() {
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceRole && !['SUPABASE_SERVICE_ROLE_KEY', 'service_role_placeholder', 'service_role_key'].some((placeholder) => serviceRole === placeholder || serviceRole.includes(placeholder))) {
    return serviceRole;
  }

  return getSupabaseAnonKey();
}

export function createSupabaseServerClient() {
  const cookieStore = cookies();

  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set({ name, value, ...options });
          });
        } catch {
          // Server components may not allow setting cookies.
        }
      }
    }
  });
}

export function readBearerAccessToken(headers?: HeaderReader | null) {
  const raw = headers?.get('authorization') || headers?.get('Authorization') || '';
  if (!raw.toLowerCase().startsWith('bearer ')) return null;
  const accessToken = raw.slice(7).trim();
  return accessToken || null;
}

export function createSupabasePublicClient() {
  return createClient(getSupabaseUrl(), getSupabaseSiteReadKey(), {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

export function createSupabaseAuthClient() {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

export function createSupabaseAccessTokenClient(accessToken: string) {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  });
}

export function createSupabaseAdminClient() {
  return createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
