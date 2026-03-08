export const AR_CLIENT_PROFILE_VALUES = [
  'android_chrome',
  'android_samsung_internet',
  'ios_webkit',
  'android_fallback',
  'desktop_debug',
  'unknown'
] as const;

export type ArClientProfile = (typeof AR_CLIENT_PROFILE_VALUES)[number];

export type ArClientProfilePolicy = {
  profile: ArClientProfile;
  fallbackFirst: boolean;
  preferWebXr: boolean;
  motionPermissionPreflight: boolean;
  cameraBlockedHint: string;
  motionDeniedHint: string;
  profileSummary: string;
  webxrHint: string;
};

export const AR_CLIENT_PROFILE_RELEASE_TARGETS: ArClientProfile[] = [
  'android_chrome',
  'android_samsung_internet',
  'ios_webkit',
  'android_fallback'
];

export function detectArClientProfile(ua: string): ArClientProfile {
  const u = (ua || '').toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(u) || (u.includes('macintosh') && u.includes('mobile'));
  const isAndroid = /android/.test(u);

  if (isIos) return 'ios_webkit';

  if (isAndroid) {
    if (u.includes('samsungbrowser')) return 'android_samsung_internet';
    if (u.includes('chrome') || u.includes('chromium') || u.includes('edga')) return 'android_chrome';
    return 'android_fallback';
  }

  if (u.includes('windows') || u.includes('macintosh') || u.includes('linux')) return 'desktop_debug';
  return 'unknown';
}

const PROFILE_POLICY: Record<ArClientProfile, ArClientProfilePolicy> = {
  android_chrome: {
    profile: 'android_chrome',
    fallbackFirst: false,
    preferWebXr: true,
    motionPermissionPreflight: false,
    cameraBlockedHint: 'Chrome Android: lock icon -> Site settings -> Camera -> Allow, then tap Retry sensors.',
    motionDeniedHint: 'Chrome Android: Site settings -> Motion sensors -> Allow, then reload.',
    profileSummary: 'Android Chrome profile: use WebXR when immersive-ar is supported and healthy, otherwise stay on the sensor path.',
    webxrHint: 'Capability-driven WebXR path with immediate sensor fallback.'
  },
  android_samsung_internet: {
    profile: 'android_samsung_internet',
    fallbackFirst: true,
    preferWebXr: false,
    motionPermissionPreflight: false,
    cameraBlockedHint: 'Samsung Internet: Settings -> Sites and downloads -> Permissions -> Camera, then tap Retry sensors.',
    motionDeniedHint: 'Samsung Internet: Settings -> Sites and downloads -> Motion sensors -> Allow, then reload.',
    profileSummary: 'Samsung Internet profile: sensor-first until WebXR is proven on that browser/device build.',
    webxrHint: 'Sensor path is primary on this profile unless telemetry promotes WebXR.'
  },
  ios_webkit: {
    profile: 'ios_webkit',
    fallbackFirst: true,
    preferWebXr: false,
    motionPermissionPreflight: true,
    cameraBlockedHint: 'iOS: Safari -> aA -> Website Settings -> Camera -> Allow, then tap Retry sensors.',
    motionDeniedHint: 'iOS: Settings -> Safari -> Motion & Orientation Access -> On, then reload.',
    profileSummary: 'iOS profile: fallback-first guidance mode (camera + sensors), WebXR immersive AR typically unavailable.',
    webxrHint: 'Fallback-first profile; sensor path is the primary experience.'
  },
  android_fallback: {
    profile: 'android_fallback',
    fallbackFirst: true,
    preferWebXr: false,
    motionPermissionPreflight: false,
    cameraBlockedHint: 'Allow camera access for this site, then tap Retry sensors.',
    motionDeniedHint: 'Enable motion/orientation sensors in your browser or site settings, then reload.',
    profileSummary: 'Fallback profile active for this browser/device combination.',
    webxrHint: 'Sensor path is primary on this profile.'
  },
  desktop_debug: {
    profile: 'desktop_debug',
    fallbackFirst: true,
    preferWebXr: false,
    motionPermissionPreflight: false,
    cameraBlockedHint: 'Desktop browsers are debug-only for AR. Allow camera access, then tap Retry sensors.',
    motionDeniedHint: 'Enable sensors if supported, otherwise use Sky Compass.',
    profileSummary: 'Desktop debug profile: no immersive AR guarantees.',
    webxrHint: 'Debug path only on desktop.'
  },
  unknown: {
    profile: 'unknown',
    fallbackFirst: true,
    preferWebXr: false,
    motionPermissionPreflight: false,
    cameraBlockedHint: 'Allow camera access for this site, then tap Retry sensors.',
    motionDeniedHint: 'Enable motion/orientation sensors in your browser or site settings, then reload.',
    profileSummary: 'Fallback profile active for this browser/device combination.',
    webxrHint: 'Sensor path is primary until runtime capabilities are clearer.'
  }
};

export function getArClientProfilePolicy(profile: ArClientProfile): ArClientProfilePolicy {
  return PROFILE_POLICY[profile] ?? PROFILE_POLICY.unknown;
}
