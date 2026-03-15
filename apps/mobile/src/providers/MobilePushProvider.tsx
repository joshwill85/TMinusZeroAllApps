import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { ApiClientError } from '@tminuszero/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { sharedQueryKeys } from '@tminuszero/query';
import {
  useNotificationPreferencesQuery,
  useUpdateNotificationPreferencesMutation,
  useViewerSessionQuery
} from '@/src/api/queries';
import { useMobileApiClient } from '@/src/api/useMobileApiClient';
import {
  readPushPermissionState,
  requestPushPermissionState,
  resolvePushRegistrationToken
} from '@/src/notifications/runtime';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import {
  clearStoredPushSyncSnapshot,
  readOrCreateInstallationId,
  readStoredPushSyncSnapshot,
  writeStoredPushSyncSnapshot
} from '@/src/notifications/storage';

type PermissionState = 'granted' | 'denied' | 'undetermined';

type MobilePushContextValue = {
  installationId: string | null;
  permissionStatus: PermissionState;
  isPushEnabled: boolean;
  isRegistered: boolean;
  isSyncing: boolean;
  lastError: string | null;
  lastTestQueuedAt: string | null;
  enablePush: () => Promise<void>;
  disablePushAlerts: () => Promise<void>;
  unregisterCurrentDevice: () => Promise<void>;
  sendTestPush: () => Promise<void>;
  refreshPermissionStatus: () => Promise<PermissionState>;
};

type MobilePushProviderProps = {
  children: ReactNode;
};

const MobilePushContext = createContext<MobilePushContextValue | null>(null);

function getExpoProjectId() {
  const fromEasConfig = Constants.easConfig?.projectId;
  if (fromEasConfig) return fromEasConfig;

  const fromExpoConfig = Constants.expoConfig?.extra && typeof Constants.expoConfig.extra === 'object'
    ? (Constants.expoConfig.extra.eas as { projectId?: string } | undefined)?.projectId
    : undefined;
  return typeof fromExpoConfig === 'string' && fromExpoConfig.trim() ? fromExpoConfig.trim() : null;
}

function getPlatform() {
  if (Platform.OS === 'ios') return 'ios' as const;
  if (Platform.OS === 'android') return 'android' as const;
  return 'web' as const;
}

function describePushError(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.code === 'subscription_required') {
      return 'This push action needs a Premium capability that is not available on the current plan.';
    }
    if (error.code === 'push_not_registered') {
      return 'This account does not have an active push destination yet.';
    }
    if (error.code === 'push_not_enabled') {
      return 'Enable push alerts for this account before sending a test notification.';
    }
    if (error.code === 'notifications_not_configured') {
      return 'Push sending is not configured on the shared backend yet.';
    }
  }

  return error instanceof Error ? error.message : 'Unable to update push alerts.';
}

export function MobilePushProvider({ children }: MobilePushProviderProps) {
  const queryClient = useQueryClient();
  const { accessToken, isAuthHydrated } = useMobileBootstrap();
  const client = useMobileApiClient();
  const viewerSessionQuery = useViewerSessionQuery();
  const notificationPreferencesQuery = useNotificationPreferencesQuery();
  const updateNotificationPreferencesMutation = useUpdateNotificationPreferencesMutation();
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<PermissionState>('undetermined');
  const [isRegistered, setIsRegistered] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastTestQueuedAt, setLastTestQueuedAt] = useState<string | null>(null);
  const lastSyncedUserIdRef = useRef<string | null>(null);
  const lastSyncedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function hydrateInstallation() {
      const [nextInstallationId, lastSync] = await Promise.all([
        readOrCreateInstallationId(),
        readStoredPushSyncSnapshot()
      ]);

      if (!isMounted) return;
      setInstallationId(nextInstallationId);
      lastSyncedUserIdRef.current = lastSync.userId;
      lastSyncedTokenRef.current = lastSync.token;
      setIsRegistered(Boolean(lastSync.userId && lastSync.token));
    }

    void hydrateInstallation();
    return () => {
      isMounted = false;
    };
  }, []);

  const refreshPermissionStatus = useCallback(async () => {
    const nextStatus = await readPushPermissionState();
    setPermissionStatus(nextStatus);
    return nextStatus;
  }, []);

  const syncCurrentDevice = useCallback(
    async (force: boolean) => {
      if (!accessToken || !isAuthHydrated || !installationId) {
        return;
      }

      const pushEnabled = notificationPreferencesQuery.data?.pushEnabled === true;
      if (!pushEnabled) {
        return;
      }

      const permission = await refreshPermissionStatus();
      if (permission !== 'granted') {
        const viewerId = viewerSessionQuery.data?.viewerId ?? null;
        if (viewerId && lastSyncedUserIdRef.current === viewerId) {
          await client.removePushDevice({
            platform: getPlatform(),
            installationId
          }).catch(() => {});
        }
        await clearStoredPushSyncSnapshot();
        lastSyncedUserIdRef.current = null;
        lastSyncedTokenRef.current = null;
        setIsRegistered(false);
        return;
      }

      const token = await resolvePushRegistrationToken(getExpoProjectId());

      const viewerId = viewerSessionQuery.data?.viewerId ?? 'authed';
      if (!force && lastSyncedUserIdRef.current === viewerId && lastSyncedTokenRef.current === token) {
        setIsRegistered(true);
        return;
      }

      const payload = await client.registerPushDevice({
        platform: getPlatform(),
        installationId,
        token,
        appVersion: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null,
        deviceName: Device.deviceName ?? null,
        pushProvider: 'expo'
      });

      await writeStoredPushSyncSnapshot({
        userId: viewerId,
        token
      });

      lastSyncedUserIdRef.current = viewerId;
      lastSyncedTokenRef.current = token;
      setIsRegistered(payload.active !== false);
      setLastError(null);
      queryClient.setQueryData(sharedQueryKeys.pushDevice(installationId), payload);
    },
    [
      accessToken,
      client,
      installationId,
      isAuthHydrated,
      notificationPreferencesQuery.data?.pushEnabled,
      queryClient,
      refreshPermissionStatus,
      viewerSessionQuery.data?.viewerId
    ]
  );

  const enablePush = useCallback(async () => {
    if (!accessToken) {
      throw new Error('Sign in before enabling push alerts.');
    }

    setIsSyncing(true);
    setLastError(null);
    try {
      const nextStatus = await requestPushPermissionState();
      setPermissionStatus(nextStatus);
      if (nextStatus !== 'granted') {
        throw new Error('Notification permission was not granted.');
      }

      await updateNotificationPreferencesMutation.mutateAsync({
        pushEnabled: true
      });
      await syncCurrentDevice(true);
    } catch (error) {
      const message = describePushError(error);
      setLastError(message);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [accessToken, syncCurrentDevice, updateNotificationPreferencesMutation]);

  const unregisterCurrentDevice = useCallback(async () => {
    if (!accessToken || !installationId) {
      return;
    }

    setIsSyncing(true);
    try {
      await client.removePushDevice({
        platform: getPlatform(),
        installationId
      });
      await clearStoredPushSyncSnapshot();
      lastSyncedUserIdRef.current = null;
      lastSyncedTokenRef.current = null;
      setIsRegistered(false);
      setLastError(null);
      queryClient.removeQueries({
        queryKey: sharedQueryKeys.pushDevice(installationId)
      });
    } catch (error) {
      const message = describePushError(error);
      setLastError(message);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [accessToken, client, installationId, queryClient]);

  const disablePushAlerts = useCallback(async () => {
    if (!accessToken) {
      throw new Error('Sign in before changing push alert preferences.');
    }

    setIsSyncing(true);
    try {
      await unregisterCurrentDevice();
      await updateNotificationPreferencesMutation.mutateAsync({
        pushEnabled: false
      });
    } catch (error) {
      const message = describePushError(error);
      setLastError(message);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [accessToken, unregisterCurrentDevice, updateNotificationPreferencesMutation]);

  const sendTestPush = useCallback(async () => {
    setIsSyncing(true);
    setLastError(null);
    try {
      const payload = await client.sendPushTest();
      setLastTestQueuedAt(payload.queuedAt);
    } catch (error) {
      const message = describePushError(error);
      setLastError(message);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [client]);

  useEffect(() => {
    void refreshPermissionStatus();
  }, [refreshPermissionStatus]);

  useEffect(() => {
    if (!accessToken || !installationId || !isAuthHydrated) {
      return;
    }
    if (!notificationPreferencesQuery.isSuccess || notificationPreferencesQuery.data.pushEnabled !== true) {
      return;
    }

    setIsSyncing(true);
    void syncCurrentDevice(false)
      .catch((error) => {
        setLastError(describePushError(error));
      })
      .finally(() => {
        setIsSyncing(false);
      });
  }, [
    accessToken,
    installationId,
    isAuthHydrated,
    notificationPreferencesQuery.data?.pushEnabled,
    notificationPreferencesQuery.isSuccess,
    syncCurrentDevice
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void refreshPermissionStatus();
      if (!accessToken || !notificationPreferencesQuery.data?.pushEnabled) return;
      void syncCurrentDevice(false).catch(() => {});
    });

    return () => {
      subscription.remove();
    };
  }, [accessToken, notificationPreferencesQuery.data?.pushEnabled, refreshPermissionStatus, syncCurrentDevice]);

  const value = useMemo<MobilePushContextValue>(
    () => ({
      installationId,
      permissionStatus,
      isPushEnabled: notificationPreferencesQuery.data?.pushEnabled === true,
      isRegistered,
      isSyncing,
      lastError,
      lastTestQueuedAt,
      enablePush,
      disablePushAlerts,
      unregisterCurrentDevice,
      sendTestPush,
      refreshPermissionStatus
    }),
    [
      disablePushAlerts,
      enablePush,
      installationId,
      isRegistered,
      isSyncing,
      lastError,
      lastTestQueuedAt,
      notificationPreferencesQuery.data?.pushEnabled,
      permissionStatus,
      refreshPermissionStatus,
      sendTestPush,
      unregisterCurrentDevice
    ]
  );

  return <MobilePushContext.Provider value={value}>{children}</MobilePushContext.Provider>;
}

export function useMobilePush() {
  const context = useContext(MobilePushContext);
  if (!context) {
    throw new Error('useMobilePush must be used within MobilePushProvider.');
  }
  return context;
}
