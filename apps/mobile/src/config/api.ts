export function getApiBaseUrl() {
  const explicit = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }

  return 'http://localhost:3000';
}

export function getSupabaseUrl() {
  const explicit = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  return explicit ? explicit.replace(/\/+$/, '') : null;
}

export function getSupabaseAnonKey() {
  const explicit = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return explicit || null;
}
