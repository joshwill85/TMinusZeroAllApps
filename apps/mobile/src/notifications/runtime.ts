import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

type PermissionState = 'granted' | 'denied' | 'undetermined';

type MobileE2EPushConfig = {
  enabled: boolean;
  token: string | null;
};

type MobileE2EConfig = {
  enabled: boolean;
  pushToken: string | null;
};

function getMobileE2EConfig(): MobileE2EConfig {
  const extra =
    Constants.expoConfig?.extra && typeof Constants.expoConfig.extra === 'object'
      ? (Constants.expoConfig.extra as Record<string, unknown>)
      : null;
  const enabled = extra?.mobileE2EPushEnabled === true;
  const pushToken =
    typeof extra?.mobileE2EPushToken === 'string' && extra.mobileE2EPushToken.trim()
      ? extra.mobileE2EPushToken.trim()
      : null;

  return {
    enabled: __DEV__ && !Device.isDevice && enabled,
    pushToken
  };
}

function getMobileE2EPushConfig(): MobileE2EPushConfig {
  const config = getMobileE2EConfig();
  return {
    enabled: config.enabled && Boolean(config.pushToken),
    token: config.pushToken
  };
}

export function getPermissionState(status: Notifications.PermissionStatus | undefined): PermissionState {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

export function isMobileE2EPushEnabled() {
  return getMobileE2EPushConfig().enabled;
}

export function isMobileE2EEnabled() {
  return getMobileE2EConfig().enabled;
}

export async function readPushPermissionState() {
  if (isMobileE2EPushEnabled()) {
    return 'granted' as PermissionState;
  }

  const permissions = await Notifications.getPermissionsAsync();
  return getPermissionState(permissions.status);
}

export async function requestPushPermissionState() {
  if (isMobileE2EPushEnabled()) {
    return 'granted' as PermissionState;
  }

  const permissions = await Notifications.requestPermissionsAsync();
  return getPermissionState(permissions.status);
}

export async function resolvePushRegistrationToken(projectId: string | null) {
  const e2eConfig = getMobileE2EPushConfig();
  if (e2eConfig.enabled && e2eConfig.token) {
    return e2eConfig.token;
  }

  if (!projectId) {
    throw new Error('Expo push project id is missing. Configure EAS project metadata before enabling push.');
  }

  if (!Device.isDevice) {
    throw new Error('Expo push registration requires a physical iOS or Android device.');
  }

  const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenResponse.data?.trim();
  if (!token) {
    throw new Error('Expo did not return a push token for this device.');
  }

  return token;
}
