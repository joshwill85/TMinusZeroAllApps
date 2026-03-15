function isDevelopmentRuntime() {
  if (typeof __DEV__ !== 'undefined') {
    return __DEV__;
  }

  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  return nodeEnv !== 'production';
}

function normalizeUrl(value: string | null | undefined) {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : null;
}

function assertSecureHttpsUrl(name: string, value: string | null) {
  if (!value) {
    throw new Error(`${name} is required for non-development mobile builds.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`${name} must use https in non-development mobile builds.`);
  }

  return parsed.toString().replace(/\/+$/, '');
}

export function getApiBaseUrl() {
  const explicit = normalizeUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
  if (explicit) {
    return isDevelopmentRuntime() ? explicit : assertSecureHttpsUrl('EXPO_PUBLIC_API_BASE_URL', explicit);
  }

  if (isDevelopmentRuntime()) {
    return 'http://localhost:3000';
  }

  throw new Error('EXPO_PUBLIC_API_BASE_URL is required for non-development mobile builds.');
}

export function getPublicSiteUrl() {
  const explicit = normalizeUrl(process.env.EXPO_PUBLIC_SITE_URL);
  if (explicit) {
    return isDevelopmentRuntime() ? explicit : assertSecureHttpsUrl('EXPO_PUBLIC_SITE_URL', explicit);
  }

  if (isDevelopmentRuntime()) {
    return getApiBaseUrl();
  }

  throw new Error('EXPO_PUBLIC_SITE_URL is required for non-development mobile builds.');
}

export function getSupabaseUrl() {
  const explicit = normalizeUrl(process.env.EXPO_PUBLIC_SUPABASE_URL);
  if (!explicit) {
    if (isDevelopmentRuntime()) {
      return null;
    }

    throw new Error('EXPO_PUBLIC_SUPABASE_URL is required for non-development mobile builds.');
  }

  return isDevelopmentRuntime() ? explicit : assertSecureHttpsUrl('EXPO_PUBLIC_SUPABASE_URL', explicit);
}

export function getSupabaseAnonKey() {
  const explicit = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return explicit || null;
}
