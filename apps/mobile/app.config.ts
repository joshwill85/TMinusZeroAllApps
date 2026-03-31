import type { ExpoConfig } from 'expo/config';
import appJson from './app.json';

const baseConfig = appJson.expo as ExpoConfig;
const baseExtra = (baseConfig.extra ?? {}) as ExpoConfig['extra'] & {
  eas?: { projectId?: string };
};
const DEFAULT_ASSOCIATED_DOMAIN_HOSTS = ['www.tminuszero.app', 'tminuszero.app'];

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );
}

function parseCsvList(value: string | undefined) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeUrl(value: string | undefined) {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : null;
}

function assertSecureReleaseUrl(name: string, value: string | null) {
  if (!value) {
    throw new Error(`${name} is required for preview and production mobile builds.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`${name} must use https for preview and production mobile builds.`);
  }

  return parsed.toString().replace(/\/+$/, '');
}

function assertRequiredReleaseValue(name: string, value: string | null) {
  if (!value) {
    throw new Error(`${name} is required for preview and production mobile builds.`);
  }
  return value;
}

function normalizeEnv(value: string | undefined) {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function getAssociatedDomainHosts() {
  const explicit = parseCsvList(process.env.MOBILE_APP_LINK_HOSTS);
  return explicit.length ? explicit : DEFAULT_ASSOCIATED_DOMAIN_HOSTS;
}

function hasAppleAppLinkConfiguration() {
  if (normalizeEnv(process.env.APPLE_APP_LINK_APP_IDS)) {
    return true;
  }

  return Boolean(normalizeEnv(process.env.APPLE_DEVELOPER_TEAM_ID));
}

function getBuildPlatform() {
  const platform = normalizeEnv(process.env.EAS_BUILD_PLATFORM)?.toLowerCase();
  if (platform === 'ios' || platform === 'android') {
    return platform;
  }

  return null;
}

function getBuildProfile() {
  const profile = process.env.EAS_BUILD_PROFILE?.trim().toLowerCase();
  if (profile === 'development' || profile === 'preview' || profile === 'production') {
    return profile;
  }
  return null;
}

function isReleaseProfile(profile: string | null) {
  return profile === 'preview' || profile === 'production';
}

export default (): ExpoConfig => {
  const buildProfile = getBuildProfile();
  const buildPlatform = getBuildPlatform();
  const associatedDomainHosts = uniqueStrings(getAssociatedDomainHosts());
  if (isReleaseProfile(buildProfile)) {
    assertSecureReleaseUrl('EXPO_PUBLIC_API_BASE_URL', normalizeUrl(process.env.EXPO_PUBLIC_API_BASE_URL));
    assertSecureReleaseUrl('EXPO_PUBLIC_SITE_URL', normalizeUrl(process.env.EXPO_PUBLIC_SITE_URL));
    assertSecureReleaseUrl('EXPO_PUBLIC_SUPABASE_URL', normalizeUrl(process.env.EXPO_PUBLIC_SUPABASE_URL));
    assertRequiredReleaseValue('EXPO_PUBLIC_SUPABASE_ANON_KEY', normalizeEnv(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY));
    assertRequiredReleaseValue(
      'EXPO_PUBLIC_EAS_PROJECT_ID or EAS_PROJECT_ID',
      normalizeEnv(process.env.EXPO_PUBLIC_EAS_PROJECT_ID) || normalizeEnv(process.env.EAS_PROJECT_ID) || normalizeEnv(baseExtra.eas?.projectId)
    );
    if (buildPlatform !== 'android' && !hasAppleAppLinkConfiguration()) {
      throw new Error('APPLE_APP_LINK_APP_IDS or APPLE_DEVELOPER_TEAM_ID is required for preview and production mobile builds.');
    }
  }

  return {
    ...baseConfig,
    ios: {
      ...baseConfig.ios,
      associatedDomains: uniqueStrings([
        ...(baseConfig.ios?.associatedDomains ?? []),
        ...associatedDomainHosts.map((host) => `applinks:${host}`)
      ])
    },
    android: {
      ...baseConfig.android,
      intentFilters: [
        ...(baseConfig.android?.intentFilters ?? []),
        {
          action: 'VIEW',
          autoVerify: true,
          category: ['BROWSABLE', 'DEFAULT'],
          data: associatedDomainHosts.map((host) => ({
            scheme: 'https',
            host,
            pathPrefix: '/auth/'
          }))
        }
      ]
    },
    extra: {
      ...baseExtra,
      buildProfile,
      mobileE2EPushEnabled: process.env.EXPO_PUBLIC_MOBILE_E2E_PUSH === '1',
      mobileE2EPushToken: process.env.EXPO_PUBLIC_MOBILE_E2E_PUSH_TOKEN || '',
      eas: {
        ...(baseExtra.eas ?? {}),
        projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID || process.env.EAS_PROJECT_ID || baseExtra.eas?.projectId || ''
      }
    }
  };
};
