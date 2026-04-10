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
  const settings = await readSettingsMap(supabase, ['ll2_rate_limit_per_hour', 'snapi_rate_limit_per_hour']);
  const limit =
    provider === 'll2'
      ? readRateLimitValue(settings.ll2_rate_limit_per_hour, cfg.limit)
      : readRateLimitValue(settings.snapi_rate_limit_per_hour, cfg.limit);

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

function readRateLimitValue(value: unknown, fallback: number) {
  const v = value as unknown;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

async function readSettingsMap(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  keys: string[]
) {
  const normalizedKeys = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
  if (!normalizedKeys.length) return {} as Record<string, unknown>;

  const { data, error } = await supabase.from('system_settings').select('key, value').in('key', normalizedKeys);
  if (error || !Array.isArray(data)) return {} as Record<string, unknown>;

  const out: Record<string, unknown> = {};
  for (const row of data) {
    if (typeof row?.key !== 'string') continue;
    out[row.key] = row.value;
  }
  return out;
}
