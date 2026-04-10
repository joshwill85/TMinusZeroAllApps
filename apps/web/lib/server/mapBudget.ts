import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';

export const GOOGLE_MAPS_MONTHLY_FREE_BASELINE = 10_000;
export const GOOGLE_MAPS_MONTHLY_TARGET = 1_000;
export const GOOGLE_MAPS_DAILY_TARGET = 32;
export const GOOGLE_MAPS_POLICY_TTL_MS = 5 * 60 * 1000;

export type GoogleMapsBudgetFamily = 'google_static_maps' | 'google_android_maps';

export type GoogleMapsBudgetSnapshot = {
  enabled: boolean;
  reason: string | null;
  checkedAt: string;
  expiresAt: string;
  dailyLimit: number;
  monthlyLimit: number;
};

const DAY_WINDOW_SECONDS = 24 * 60 * 60;

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcMonth(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function monthWindowSeconds(date = new Date()) {
  const start = startOfUtcMonth(date);
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return Math.max(1, Math.round((next.getTime() - start.getTime()) / 1000));
}

function mapBudgetProviderBase(family: GoogleMapsBudgetFamily) {
  return `tmz:${family}`;
}

async function readWindowCount(provider: string, windowStartIso: string) {
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    return 0;
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('api_rate_counters')
    .select('count')
    .eq('provider', provider)
    .eq('window_start', windowStartIso)
    .maybeSingle();

  if (error) {
    console.error('map budget counter lookup failed', { provider, error });
    return 0;
  }

  return typeof data?.count === 'number' && Number.isFinite(data.count) ? data.count : 0;
}

export async function readGoogleMapsBudgetSnapshot(family: GoogleMapsBudgetFamily): Promise<GoogleMapsBudgetSnapshot> {
  const checkedAt = new Date();
  const expiresAt = new Date(checkedAt.getTime() + GOOGLE_MAPS_POLICY_TTL_MS);

  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    return {
      enabled: false,
      reason: 'Server-side map budget controls are unavailable right now.',
      checkedAt: checkedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      dailyLimit: GOOGLE_MAPS_DAILY_TARGET,
      monthlyLimit: GOOGLE_MAPS_MONTHLY_TARGET
    };
  }

  const providerBase = mapBudgetProviderBase(family);
  const dayWindowStartIso = startOfUtcDay(checkedAt).toISOString();
  const monthWindowStartIso = startOfUtcMonth(checkedAt).toISOString();
  const [dayCount, monthCount] = await Promise.all([
    readWindowCount(`${providerBase}:day`, dayWindowStartIso),
    readWindowCount(`${providerBase}:month`, monthWindowStartIso)
  ]);

  const dailyRemaining = GOOGLE_MAPS_DAILY_TARGET - dayCount;
  const monthlyRemaining = GOOGLE_MAPS_MONTHLY_TARGET - monthCount;
  const enabled = dailyRemaining > 0 && monthlyRemaining > 0;
  const reason = enabled
    ? null
    : dailyRemaining <= 0
      ? 'Daily Google Maps budget exhausted.'
      : 'Monthly Google Maps budget exhausted.';

  return {
    enabled,
    reason,
    checkedAt: checkedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    dailyLimit: GOOGLE_MAPS_DAILY_TARGET,
    monthlyLimit: GOOGLE_MAPS_MONTHLY_TARGET
  };
}

export async function consumeGoogleMapsBudget(family: GoogleMapsBudgetFamily) {
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    return false;
  }

  const now = new Date();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('try_increment_map_budget', {
    provider_base: mapBudgetProviderBase(family),
    day_window_start_in: startOfUtcDay(now).toISOString(),
    day_window_seconds_in: DAY_WINDOW_SECONDS,
    day_limit_in: GOOGLE_MAPS_DAILY_TARGET,
    month_window_start_in: startOfUtcMonth(now).toISOString(),
    month_window_seconds_in: monthWindowSeconds(now),
    month_limit_in: GOOGLE_MAPS_MONTHLY_TARGET
  });

  if (error) {
    console.error('map budget increment failed', { family, error });
    return false;
  }

  return data === true;
}
