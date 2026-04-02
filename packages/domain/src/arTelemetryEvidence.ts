export const AR_TELEMETRY_RELEASE_PROFILES = [
  'android_chrome_flagship',
  'android_chrome_mid_tier',
  'ios_safari_current',
  'desktop_chrome_sanity',
  'ios_native_pro',
  'ios_native_non_pro',
  'ios_native_prev_gen',
  'android_native_pixel',
  'android_native_samsung',
  'android_native_mid_tier'
] as const;

export type ArTelemetryReleaseProfile = (typeof AR_TELEMETRY_RELEASE_PROFILES)[number];

export type InferWebArReleaseProfileInput = {
  clientEnv?: string | null;
  clientProfile?: string | null;
  deviceMemoryGb?: number | null;
  overrideProfile?: string | null;
};

export type InferMobileArReleaseProfileInput = {
  runtimeFamily?: string | null;
  brand?: string | null;
  manufacturer?: string | null;
  modelName?: string | null;
  deviceYearClass?: number | null;
  totalMemoryBytes?: number | null;
  overrideProfile?: string | null;
};

export type NativeArTelemetryUsableStateInput = {
  runtimeFamily?: string | null;
  sessionRunning?: boolean | null;
  status?: string | null;
  trackingState?: string | null;
  locationFixState?: string | null;
  alignmentReady?: boolean | null;
};

function lower(value: string | null | undefined) {
  return (value || '').trim().toLowerCase();
}

export function normalizeArTelemetryReleaseProfile(value: string | null | undefined): ArTelemetryReleaseProfile | null {
  if (!value) return null;
  const normalized = value.trim();
  return AR_TELEMETRY_RELEASE_PROFILES.includes(normalized as ArTelemetryReleaseProfile)
    ? (normalized as ArTelemetryReleaseProfile)
    : null;
}

export function inferWebArReleaseProfile(input: InferWebArReleaseProfileInput): ArTelemetryReleaseProfile | null {
  const override = normalizeArTelemetryReleaseProfile(input.overrideProfile);
  if (override) return override;

  const clientEnv = lower(input.clientEnv);
  const clientProfile = lower(input.clientProfile);
  const deviceMemoryGb =
    typeof input.deviceMemoryGb === 'number' && Number.isFinite(input.deviceMemoryGb) && input.deviceMemoryGb > 0
      ? input.deviceMemoryGb
      : null;

  if (clientEnv === 'desktop_chrome' && clientProfile === 'desktop_debug') {
    return 'desktop_chrome_sanity';
  }

  if (clientEnv === 'ios_safari' && clientProfile === 'ios_webkit') {
    return 'ios_safari_current';
  }

  if (clientEnv === 'android_chrome' && clientProfile === 'android_chrome') {
    if (deviceMemoryGb != null && deviceMemoryGb >= 6) return 'android_chrome_flagship';
    if (deviceMemoryGb != null) return 'android_chrome_mid_tier';
  }

  return null;
}

export function inferMobileArReleaseProfile(input: InferMobileArReleaseProfileInput): ArTelemetryReleaseProfile | null {
  const override = normalizeArTelemetryReleaseProfile(input.overrideProfile);
  if (override) return override;

  const runtimeFamily = lower(input.runtimeFamily);
  const brand = lower(input.brand);
  const manufacturer = lower(input.manufacturer);
  const modelName = lower(input.modelName);
  const deviceYearClass =
    typeof input.deviceYearClass === 'number' && Number.isFinite(input.deviceYearClass) ? input.deviceYearClass : null;
  const totalMemoryBytes =
    typeof input.totalMemoryBytes === 'number' && Number.isFinite(input.totalMemoryBytes) ? input.totalMemoryBytes : null;

  if (runtimeFamily === 'ios_native') {
    if (!modelName.includes('iphone')) return null;
    if (modelName.includes('pro')) return 'ios_native_pro';
    if (deviceYearClass != null && deviceYearClass >= 2024) return 'ios_native_non_pro';
    if (deviceYearClass != null && deviceYearClass >= 2022) return 'ios_native_prev_gen';
    return null;
  }

  if (runtimeFamily === 'android_native') {
    if (brand.includes('google') || manufacturer.includes('google') || modelName.includes('pixel')) {
      return 'android_native_pixel';
    }
    if (brand.includes('samsung') || manufacturer.includes('samsung') || modelName.includes('galaxy')) {
      return 'android_native_samsung';
    }
    if (totalMemoryBytes != null && totalMemoryBytes <= 8 * 1024 * 1024 * 1024) {
      return 'android_native_mid_tier';
    }
    if (deviceYearClass != null && deviceYearClass <= 2023) {
      return 'android_native_mid_tier';
    }
    if (modelName) return 'android_native_mid_tier';
  }

  return null;
}

export function isNativeArTelemetryUsable(input: NativeArTelemetryUsableStateInput) {
  const runtimeFamily = lower(input.runtimeFamily);
  const sessionRunning = input.sessionRunning === true;
  const status = lower(input.status);
  const trackingState = lower(input.trackingState);
  const locationFixState = lower(input.locationFixState);
  const alignmentReady = input.alignmentReady === true;

  if (runtimeFamily === 'ios_native') {
    return sessionRunning && status === 'running' && trackingState === 'normal' && locationFixState === 'ready' && alignmentReady;
  }

  if (runtimeFamily === 'android_native') {
    return sessionRunning && status === 'running' && trackingState === 'normal';
  }

  return false;
}

export function deriveArTelemetryTimeToUsableMs(startedAtIso: string | null | undefined, usableAtMs: number | null | undefined) {
  if (!startedAtIso || typeof usableAtMs !== 'number' || !Number.isFinite(usableAtMs)) return undefined;
  const startedAtMs = Date.parse(startedAtIso);
  if (!Number.isFinite(startedAtMs)) return undefined;
  return Math.max(0, Math.round(usableAtMs - startedAtMs));
}
