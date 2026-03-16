import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';

export type MobileHubRolloutState = {
  nativeEnabled: boolean;
  externalDeepLinksEnabled: boolean;
};

export type MobileHubRollout = {
  blueOrigin: MobileHubRolloutState;
  spacex: MobileHubRolloutState;
  artemis: MobileHubRolloutState;
};

const DEFAULT_STATE: MobileHubRolloutState = {
  nativeEnabled: false,
  externalDeepLinksEnabled: false
};

const DEFAULT_ROLLOUT: MobileHubRollout = {
  blueOrigin: DEFAULT_STATE,
  spacex: DEFAULT_STATE,
  artemis: DEFAULT_STATE
};
const MOBILE_HUB_ROLLOUT_CACHE_TTL_MS = 60_000;

let rolloutCache: {
  value: MobileHubRollout;
  expiresAt: number;
} | null = null;

const MOBILE_HUB_SETTING_KEYS = {
  blueOrigin: {
    nativeEnabled: 'mobile_hub_blue_origin_native_enabled',
    externalDeepLinksEnabled: 'mobile_hub_blue_origin_external_deep_links_enabled'
  },
  spacex: {
    nativeEnabled: 'mobile_hub_spacex_native_enabled',
    externalDeepLinksEnabled: 'mobile_hub_spacex_external_deep_links_enabled'
  },
  artemis: {
    nativeEnabled: 'mobile_hub_artemis_native_enabled',
    externalDeepLinksEnabled: 'mobile_hub_artemis_external_deep_links_enabled'
  }
} as const;

function parseBooleanSetting(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  }
  return fallback;
}

export async function loadMobileHubRollout(): Promise<MobileHubRollout> {
  const now = Date.now();
  if (rolloutCache && rolloutCache.expiresAt > now) {
    return rolloutCache.value;
  }

  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    return DEFAULT_ROLLOUT;
  }

  const admin = createSupabaseAdminClient();
  const keys = [
    MOBILE_HUB_SETTING_KEYS.blueOrigin.nativeEnabled,
    MOBILE_HUB_SETTING_KEYS.blueOrigin.externalDeepLinksEnabled,
    MOBILE_HUB_SETTING_KEYS.spacex.nativeEnabled,
    MOBILE_HUB_SETTING_KEYS.spacex.externalDeepLinksEnabled,
    MOBILE_HUB_SETTING_KEYS.artemis.nativeEnabled,
    MOBILE_HUB_SETTING_KEYS.artemis.externalDeepLinksEnabled
  ];

  try {
    const { data, error } = await admin.from('system_settings').select('key, value').in('key', keys);
    if (error) {
      console.error('mobile hub rollout settings query error', error);
      return DEFAULT_ROLLOUT;
    }

    const map = new Map<string, unknown>();
    for (const row of data || []) {
      map.set(String((row as { key?: unknown }).key || ''), (row as { value?: unknown }).value);
    }

    const rollout = {
      blueOrigin: {
        nativeEnabled: parseBooleanSetting(map.get(MOBILE_HUB_SETTING_KEYS.blueOrigin.nativeEnabled)),
        externalDeepLinksEnabled: parseBooleanSetting(map.get(MOBILE_HUB_SETTING_KEYS.blueOrigin.externalDeepLinksEnabled))
      },
      spacex: {
        nativeEnabled: parseBooleanSetting(map.get(MOBILE_HUB_SETTING_KEYS.spacex.nativeEnabled)),
        externalDeepLinksEnabled: parseBooleanSetting(map.get(MOBILE_HUB_SETTING_KEYS.spacex.externalDeepLinksEnabled))
      },
      artemis: {
        nativeEnabled: parseBooleanSetting(map.get(MOBILE_HUB_SETTING_KEYS.artemis.nativeEnabled)),
        externalDeepLinksEnabled: parseBooleanSetting(map.get(MOBILE_HUB_SETTING_KEYS.artemis.externalDeepLinksEnabled))
      }
    };
    rolloutCache = {
      value: rollout,
      expiresAt: now + MOBILE_HUB_ROLLOUT_CACHE_TTL_MS
    };
    return rollout;
  } catch (error) {
    console.error('mobile hub rollout settings load failed', error);
    return DEFAULT_ROLLOUT;
  }
}
