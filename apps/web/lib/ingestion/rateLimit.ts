import { addHours, startOfHour } from 'date-fns';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';

type Provider = 'll2' | 'snapi';

const DEFAULTS: Record<Provider, { limit: number; windowSeconds: number }> = {
  ll2: { limit: 300, windowSeconds: 3600 },
  snapi: { limit: 60, windowSeconds: 3600 }
};

export async function tryConsumeProvider(provider: Provider) {
  const supabase = createSupabaseAdminClient();
  const now = new Date();
  const windowStart = startOfHour(now).toISOString();
  const cfg = DEFAULTS[provider];
  const limit =
    provider === 'll2'
      ? await readRateLimitOrDefault(supabase, 'll2_rate_limit_per_hour', cfg.limit)
      : await readRateLimitOrDefault(supabase, 'snapi_rate_limit_per_hour', cfg.limit);

  const { data, error } = await supabase.rpc('try_increment_api_rate', {
    provider_name: provider,
    window_start_in: windowStart,
    window_seconds_in: cfg.windowSeconds,
    limit_in: limit
  });

  if (error) {
    console.error('rateCounter try_increment_api_rate error', error);
    return { allowed: false, remaining: 0, windowEndsAt: addHours(new Date(windowStart), 1), limit };
  }

  return {
    allowed: Boolean(data),
    remaining: undefined,
    windowEndsAt: addHours(new Date(windowStart), 1),
    limit
  };
}

async function readRateLimitOrDefault(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  key: string,
  fallback: number
) {
  const { data, error } = await supabase.from('system_settings').select('value').eq('key', key).maybeSingle();
  if (error || data?.value == null) return fallback;

  const v = data.value as unknown;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}
