import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { ApiClientError } from '@tminuszero/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { sharedQueryKeys } from '@tminuszero/query';
import { useViewerEntitlementsQuery, useViewerSessionQuery } from '@/src/api/queries';
import { useMobileApiClient } from '@/src/api/useMobileApiClient';
import {
  readPushPermissionState,
  requestPushPermissionState,
  resolvePushRegistrationToken
} from '@/src/notifications/runtime';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import {
  readOrCreateInstallationId,
  readStoredPushSyncSnapshot,
  writeStoredPushSyncSnapshot
} from '@/src/notifications/storage';

type PermissionState = 'granted' | 'denied' | 'undetermined';

type MobilePushContextValue = {
  installationId: string | null;
  deviceSecret: string | null;
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
  throw new Error('Mobile push is only available on iOS and Android.');
}

function describePushError(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.code === 'payment_required') {
      return 'That alert configuration needs Premium on mobile.';
    }
    if (error.code === 'push_not_registered') {
      return 'Enable push on this device before saving alerts.';
    }
    if (error.code === 'invalid_guest_device') {
      return 'This device push session expired. Enable push again to refresh it.';
    }
    if (error.code === 'notifications_not_configured') {
      return 'Push sending is not configured on the shared backend yet.';
    }
  }

  return error instanceof Error ? error.message : 'Unable to update push alerts.';
}

export function MobilePushProvider({ children }: MobilePushProviderProps) {
  const queryClient = useQueryClient();
  const { isAuthHydrated } = useMobileBootstrap();
  const client = useMobileApiClient();
  const viewerSessionQuery = useViewerSessionQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [deviceSecret, setDeviceSecret] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<PermissionState>('undetermined');
  const [isRegistered, setIsRegistered] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastTestQueuedAt, setLastTestQueuedAt] = useState<string | null>(null);
  const lastSyncedOwnerKeyRef = useRef<string | null>(null);
  const lastSyncedTokenRef = useRef<string | null>(null);
  const deviceSecretRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function hydrateInstallation() {
      const [nextInstallationId, lastSync] = await Promise.all([
        readOrCreateInstallationId(),
        readStoredPushSyncSnapshot()
      ]);

      if (!isMounted) return;
      setInstallationId(nextInstallationId);
      setDeviceSecret(lastSync.deviceSecret);
      deviceSecretRef.current = lastSync.deviceSecret;
      lastSyncedOwnerKeyRef.current = lastSync.ownerKey;
      lastSyncedTokenRef.current = lastSync.token;
      setIsRegistered(Boolean(lastSync.ownerKey && lastSync.token));
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
      if (!installationId || !isAuthHydrated) {
        return;
      }

      const permission = await refreshPermissionStatus();
      if (permission !== 'granted') {
        if (lastSyncedOwnerKeyRef.current || deviceSecretRef.current) {
          await client
            .removeMobilePushDevice({
              platform: getPlatform(),
              installationId,
              deviceSecret: deviceSecretRef.current
            })
            .catch(() => {});
        }

        await writeStoredPushSyncSnapshot({
          ownerKey: null,
          token: null,
          deviceSecret: deviceSecretRef.current
        });
        lastSyncedOwnerKeyRef.current = null;
        lastSyncedTokenRef.current = null;
        setIsRegistered(false);
        return;
      }

      const token = await resolvePushRegistrationToken(getExpoProjectId());
      const isPremium = entitlementsQuery.data?.isPaid === true || entitlementsQuery.data?.isAdmin === true;
      const ownerKey = isPremium ? `user:${viewerSessionQuery.data?.viewerId ?? 'authed'}` : `guest:${installationId}`;
      if (!force && lastSyncedOwnerKeyRef.current === ownerKey && lastSyncedTokenRef.current === token) {
        setIsRegistered(true);
        return;
      }

      const payload = await client.registerMobilePushDevice({
        platform: getPlatform(),
        installationId,
        deviceSecret: deviceSecretRef.current,
        token,
        appVersion: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null,
        deviceName: Device.deviceName ?? null,
        pushProvider: 'expo'
      });

      const nextDeviceSecret = payload.deviceSecret ?? deviceSecretRef.current;
      deviceSecretRef.current = nextDeviceSecret;
      setDeviceSecret(nextDeviceSecret);

      await writeStoredPushSyncSnapshot({
        ownerKey,
        token,
        deviceSecret: nextDeviceSecret ?? null
      });

      lastSyncedOwnerKeyRef.current = ownerKey;
      lastSyncedTokenRef.current = token;
      setIsRegistered(payload.active === true);
      setLastError(null);
      queryClient.setQueryData(sharedQueryKeys.pushDevice(installationId), payload);
      await queryClient.invalidateQueries({ queryKey: sharedQueryKeys.mobilePushRules(installationId) });
    },
    [
      client,
      entitlementsQuery.data?.isAdmin,
      entitlementsQuery.data?.isPaid,
      installationId,
      isAuthHydrated,
      queryClient,
      refreshPermissionStatus,
      viewerSessionQuery.data?.viewerId
    ]
  );

  const enablePush = useCallback(async () => {
    setIsSyncing(true);
    setLastError(null);
    try {
      const nextStatus = await requestPushPermissionState();
      setPermissionStatus(nextStatus);
      if (nextStatus !== 'granted') {
        throw new Error('Notification permission was not granted.');
      }

      await syncCurrentDevice(true);
    } catch (error) {
      const message = describePushError(error);
      setLastError(message);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [syncCurrentDevice]);

  const unregisterCurrentDevice = useCallback(async () => {
    if (!installationId) {
      return;
    }

    setIsSyncing(true);
    try {
      await client.removeMobilePushDevice({
        platform: getPlatform(),
        installationId,
        deviceSecret: deviceSecretRef.current
      });
      await writeStoredPushSyncSnapshot({
        ownerKey: null,
        token: null,
        deviceSecret: deviceSecretRef.current
      });
      lastSyncedOwnerKeyRef.current = null;
      lastSyncedTokenRef.current = null;
      setIsRegistered(false);
      setLastError(null);
      queryClient.removeQueries({
        queryKey: sharedQueryKeys.pushDevice(installationId)
      });
      await queryClient.invalidateQueries({ queryKey: sharedQueryKeys.mobilePushRules(installationId) });
    } catch (error) {
      const message = describePushError(error);
      setLastError(message);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [client, installationId, queryClient]);

  const disablePushAlerts = useCallback(async () => {
    try {
      await unregisterCurrentDevice();
    } catch (error) {
      const message = describePushError(error);
      setLastError(message);
      throw error;
    }
  }, [unregisterCurrentDevice]);

  const sendTestPush = useCallback(async () => {
    if (!installationId) {
      return;
    }

    setIsSyncing(true);
    setLastError(null);
    try {
      const payload = await client.sendMobilePushTest({
        installationId,
        deviceSecret: deviceSecretRef.current
      });
      setLastTestQueuedAt(payload.queuedAt);
    } catch (error) {
      const message = describePushError(error);
      setLastError(message);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [client, installationId]);

  useEffect(() => {
    void refreshPermissionStatus();
  }, [refreshPermissionStatus]);

  useEffect(() => {
    if (!installationId || !isAuthHydrated) {
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
  }, [entitlementsQuery.data?.isAdmin, entitlementsQuery.data?.isPaid, installationId, isAuthHydrated, syncCurrentDevice]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void refreshPermissionStatus();
      if (!installationId) return;
      void syncCurrentDevice(false).catch(() => {});
    });

    return () => {
      subscription.remove();
    };
  }, [installationId, refreshPermissionStatus, syncCurrentDevice]);

  const value = useMemo<MobilePushContextValue>(
    () => ({
      installationId,
      deviceSecret,
      permissionStatus,
      isPushEnabled: permissionStatus === 'granted' && isRegistered,
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
      deviceSecret,
      disablePushAlerts,
      enablePush,
      installationId,
      isRegistered,
      isSyncing,
      lastError,
      lastTestQueuedAt,
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
