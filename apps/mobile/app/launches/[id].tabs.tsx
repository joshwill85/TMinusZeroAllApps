/**
 * Tab-based Launch Detail Screen (New Architecture)
 *
 * This is the new tab-based implementation of the launch details page.
 * It replaces the 16+ collapsible sections with 5 organized tabs.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@tminuszero/api-client';
import { AppState, RefreshControl, ScrollView, View } from 'react-native';
import { useSharedValue, useAnimatedScrollHandler } from 'react-native-reanimated';
import {
  buildDetailVersionToken,
  canAutoRefreshActiveSurface,
  getNextAdaptiveLaunchRefreshMs,
  getRecommendedLaunchRefreshIntervalSeconds,
  getVisibleDetailUpdatedAt,
  hasVersionChanged,
  PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS,
  shouldPrimeVersionRefresh
} from '@tminuszero/domain';
import type { LaunchTab } from '@tminuszero/launch-detail-ui';
import {
  computeTabVisibility,
  extractOverviewData,
  extractLiveData,
  extractMissionData,
  extractVehicleData,
  extractRelatedData,
  getDefaultActiveTab,
  getLaunchHeroModel,
  getVisibleTabs,
  shouldShowLiveBadge
} from '@tminuszero/launch-detail-ui';
import { useApiClient } from '@/src/api/client';
import { fetchLaunchDetailVersion, useLaunchDetailQuery, useViewerEntitlementsQuery } from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import { ErrorStateCard, LoadingStateCard } from '@/src/components/SectionCard';
import { LaunchDetailHero } from '@/src/components/launch/LaunchDetailHero';
import { LaunchDetailTabs, LaunchDetailTabPanel } from '@/src/components/launch/LaunchDetailTabs';
import { LiveTab } from '@/src/components/launch/tabs/LiveTab';
import { MissionTab } from '@/src/components/launch/tabs/MissionTab';
import { OverviewTab } from '@/src/components/launch/tabs/OverviewTab';
import { RelatedTab } from '@/src/components/launch/tabs/RelatedTab';
import { VehicleTab } from '@/src/components/launch/tabs/VehicleTab';
import { LaunchShareIconButton } from '@/src/components/LaunchShareIconButton';
import { LiveLaunchCountdownClock } from '@/src/components/launch/LiveLaunchCountdown';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { useMobileToast } from '@/src/providers/MobileToastProvider';
import { shareLaunch } from '@/src/utils/launchShare';
import { formatTimestamp } from '@/src/utils/format';
import { formatRefreshTimeLabel } from '@/src/utils/launchRefresh';

function getLaunchId(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

export default function LaunchDetailTabsScreen() {
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const { theme } = useMobileBootstrap();
  const { client } = useApiClient();
  const { showToast } = useMobileToast();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const launchId = getLaunchId(params.id);
  const entitlementsQuery = useViewerEntitlementsQuery();

  // Data queries
  const launchDetailQuery = useLaunchDetailQuery(launchId);
  const detail = launchDetailQuery.data ?? null;
  const hero = detail ? getLaunchHeroModel(detail) : null;
  const detailVersionScope = entitlementsQuery.data?.mode === 'live' ? 'live' : 'public';
  const fallbackRefreshIntervalSeconds =
    detailVersionScope === 'live' ? PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS : (entitlementsQuery.data?.refreshIntervalSeconds ?? 7200);
  const [detailRefreshing, setDetailRefreshing] = useState(false);
  const [appStateStatus, setAppStateStatus] = useState(AppState.currentState);
  const [scheduledRefreshIntervalSeconds, setScheduledRefreshIntervalSeconds] = useState<number>(fallbackRefreshIntervalSeconds);
  const [cadenceAnchorNet, setCadenceAnchorNet] = useState<string | null>(null);
  const [pendingDetailRefresh, setPendingDetailRefresh] = useState<{ version: string; updatedAt: string | null } | null>(null);
  const lastSeenVersionRef = useRef<string | null>(null);
  const refreshIntervalSeconds = getRecommendedLaunchRefreshIntervalSeconds(
    scheduledRefreshIntervalSeconds,
    fallbackRefreshIntervalSeconds
  );

  // Tab state
  const tabVisibility = computeTabVisibility(detail);
  const visibleTabs = getVisibleTabs(tabVisibility);
  const defaultTab = getDefaultActiveTab(detail, tabVisibility);
  const [activeTab, setActiveTab] = useState<LaunchTab>(defaultTab);
  const showLiveBadge = shouldShowLiveBadge(detail);

  // Scroll tracking for hero parallax
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  // Update default tab when data loads
  useEffect(() => {
    const newDefault = getDefaultActiveTab(detail, tabVisibility);
    if (newDefault !== activeTab && visibleTabs.some((tab) => tab.id === newDefault)) {
      setActiveTab(newDefault);
    }
  }, [activeTab, detail, tabVisibility, visibleTabs]);

  useEffect(() => {
    lastSeenVersionRef.current = null;
    setPendingDetailRefresh(null);
  }, [launchId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppStateStatus(nextState);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    setScheduledRefreshIntervalSeconds(fallbackRefreshIntervalSeconds);
    setCadenceAnchorNet(null);
  }, [fallbackRefreshIntervalSeconds]);

  const applyResolvedDetailRefresh = useCallback(async (nextVersion: string | null) => {
    const detailResult = await launchDetailQuery.refetch();
    const refreshedUpdatedAt = getVisibleDetailUpdatedAt(detailResult.data?.launchData ?? detail?.launchData ?? null);
    lastSeenVersionRef.current = nextVersion ?? buildDetailVersionToken(launchId, detailVersionScope, refreshedUpdatedAt);
    setPendingDetailRefresh(null);
  }, [detail?.launchData, detailVersionScope, launchDetailQuery, launchId]);

  const refreshDetail = useCallback(async () => {
    if (!launchId || detailRefreshing) {
      return;
    }

    setDetailRefreshing(true);
    try {
      const payload = await fetchLaunchDetailVersion(queryClient, client, launchId, { scope: detailVersionScope });
      setScheduledRefreshIntervalSeconds(
        getRecommendedLaunchRefreshIntervalSeconds(payload.recommendedIntervalSeconds, fallbackRefreshIntervalSeconds)
      );
      setCadenceAnchorNet(typeof payload.cadenceAnchorNet === 'string' ? payload.cadenceAnchorNet : null);

      const nextVersion =
        typeof payload.version === 'string'
          ? payload.version
          : buildDetailVersionToken(launchId, detailVersionScope, payload.updatedAt ?? null);
      const visibleUpdatedAt = getVisibleDetailUpdatedAt(detail?.launchData ?? null);
      const shouldApply = pendingDetailRefresh
        ? true
        : lastSeenVersionRef.current
          ? hasVersionChanged(lastSeenVersionRef.current, nextVersion)
          : shouldPrimeVersionRefresh(payload.updatedAt, visibleUpdatedAt);

      if (!shouldApply) {
        lastSeenVersionRef.current = nextVersion;
        showToast({
          message:
            detailVersionScope === 'live'
              ? `Launch detail is up to date. Next live check around ${formatRefreshTimeLabel(
                  getNextAdaptiveLaunchRefreshMs({
                    nowMs: Date.now(),
                    intervalSeconds: getRecommendedLaunchRefreshIntervalSeconds(
                      payload.recommendedIntervalSeconds,
                      fallbackRefreshIntervalSeconds
                    ),
                    cadenceAnchorNet: typeof payload.cadenceAnchorNet === 'string' ? payload.cadenceAnchorNet : cadenceAnchorNet
                  })
                )}.`
              : `Launch detail is up to date. Next public refresh around ${formatRefreshTimeLabel(
                  getNextAdaptiveLaunchRefreshMs({
                    nowMs: Date.now(),
                    intervalSeconds: getRecommendedLaunchRefreshIntervalSeconds(
                      payload.recommendedIntervalSeconds,
                      fallbackRefreshIntervalSeconds
                    ),
                    cadenceAnchorNet: typeof payload.cadenceAnchorNet === 'string' ? payload.cadenceAnchorNet : cadenceAnchorNet
                  })
                )}.`
        });
        return;
      }

      await applyResolvedDetailRefresh(nextVersion);
      showToast({ message: 'Launch detail updated.', tone: 'success' });
    } catch (error) {
      const status = error instanceof ApiClientError ? error.status : null;
      if (status === 401 || status === 402) {
        setPendingDetailRefresh(null);
        showToast({ message: 'Live detail refresh requires Premium.' });
        return;
      }
      showToast({
        message: error instanceof Error ? error.message : 'Unable to refresh this launch detail.'
      });
    } finally {
      setDetailRefreshing(false);
    }
  }, [
    applyResolvedDetailRefresh,
    cadenceAnchorNet,
    client,
    detail?.launchData,
    detailRefreshing,
    detailVersionScope,
    fallbackRefreshIntervalSeconds,
    launchId,
    pendingDetailRefresh,
    queryClient,
    showToast
  ]);

  useEffect(() => {
    if (!canAutoRefreshActiveSurface({ isFocused, appStateStatus }) || !launchId || !detail || launchDetailQuery.isPending) {
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const runVersionCheck = async () => {
      if (cancelled || !launchId || detailRefreshing || launchDetailQuery.isPending) {
        return;
      }

      const payload = await fetchLaunchDetailVersion(queryClient, client, launchId, { scope: detailVersionScope });
      setScheduledRefreshIntervalSeconds(
        getRecommendedLaunchRefreshIntervalSeconds(payload.recommendedIntervalSeconds, fallbackRefreshIntervalSeconds)
      );
      setCadenceAnchorNet(typeof payload.cadenceAnchorNet === 'string' ? payload.cadenceAnchorNet : null);
      const nextVersion =
        typeof payload.version === 'string'
          ? payload.version
          : buildDetailVersionToken(launchId, detailVersionScope, payload.updatedAt ?? null);

      const visibleUpdatedAt = getVisibleDetailUpdatedAt(detail.launchData ?? null);
      if (!lastSeenVersionRef.current) {
        const shouldPrimePending = shouldPrimeVersionRefresh(payload.updatedAt, visibleUpdatedAt);
        if (shouldPrimePending) {
          lastSeenVersionRef.current = nextVersion;
          setPendingDetailRefresh({
            version: nextVersion,
            updatedAt: payload.updatedAt ?? null
          });
          return;
        }
        lastSeenVersionRef.current = nextVersion;
        setPendingDetailRefresh(null);
        return;
      }

      if (hasVersionChanged(lastSeenVersionRef.current, nextVersion)) {
        lastSeenVersionRef.current = nextVersion;
        setPendingDetailRefresh({
          version: nextVersion,
          updatedAt: payload.updatedAt ?? null
        });
      }
    };

    const schedule = () => {
      if (cancelled) {
        return;
      }
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      const nextRefreshAt = getNextAdaptiveLaunchRefreshMs({
        nowMs: Date.now(),
        intervalSeconds: refreshIntervalSeconds,
        cadenceAnchorNet
      });
      timeout = setTimeout(() => {
        void runVersionCheck().catch((error) => {
          console.error('mobile detail refresh check failed', error);
        });
        schedule();
      }, Math.max(0, nextRefreshAt - Date.now()));
    };

    void runVersionCheck().catch((error) => {
      console.error('mobile detail refresh check failed', error);
    });
    schedule();

    return () => {
      cancelled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [
    appStateStatus,
    cadenceAnchorNet,
    client,
    detail,
    detailRefreshing,
    detailVersionScope,
    fallbackRefreshIntervalSeconds,
    isFocused,
    launchDetailQuery.isPending,
    launchId,
    queryClient,
    refreshIntervalSeconds
  ]);

  // Loading state
  if (launchDetailQuery.isLoading || !detail) {
    return (
      <AppScreen>
        <Stack.Screen options={{ title: 'Loading...' }} />
        <LoadingStateCard title="Loading launch detail" body={`Fetching /api/v1/launches/${launchId || 'missing'}.`} />
      </AppScreen>
    );
  }

  // Error state
  if (launchDetailQuery.isError) {
    return (
      <AppScreen>
        <Stack.Screen options={{ title: 'Error' }} />
        <ErrorStateCard
          title="Launch detail unavailable"
          body={launchDetailQuery.error.message}
        />
      </AppScreen>
    );
  }

  // Extract data for each tab
  const overviewData = extractOverviewData(detail);
  const liveData = extractLiveData(detail);
  const missionData = extractMissionData(detail);
  const vehicleData = extractVehicleData(detail);
  const relatedData = extractRelatedData(detail);
  const launchData = detail.launchData ?? null;

  // Format NET time
  const netTime = hero?.net ? formatTimestamp(hero.net) : null;
  const handleShare = () => {
    if (!launchData) {
      return;
    }

    void shareLaunch({
      id: launchData.id,
      name: launchData.name,
      net: launchData.net,
      provider: launchData.provider,
      vehicle: launchData.vehicle || launchData.rocket?.fullName,
      statusText: launchData.statusText,
      status: launchData.status,
      padLabel: launchData.pad.shortCode || launchData.pad.name,
      padLocation: launchData.pad.locationName || launchData.pad.state
    });
  };

  return (
    <AppScreen>
      <Stack.Screen
        options={{
          title: hero?.launchName ?? 'Launch Details',
          headerShown: true,
        }}
      />

      <ScrollView
        style={{ flex: 1 }}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={detailRefreshing}
            onRefresh={() => {
              void refreshDetail();
            }}
            tintColor={theme.accent}
          />
        }
      >
        {/* Hero Section */}
        <LaunchDetailHero
          backgroundImage={hero?.backgroundImage ?? null}
          launchName={hero?.launchName ?? 'Unknown Launch'}
          provider={hero?.provider ?? null}
          vehicle={hero?.vehicle ?? null}
          status={hero?.status ?? null}
          statusTone={getStatusTone(hero?.status ?? null)}
          tier={hero?.tier ?? null}
          webcastLive={Boolean(hero?.webcastLive)}
          countdown={hero?.net ? <LiveLaunchCountdownClock net={hero.net} pastLabel="Launched" /> : null}
          netTime={netTime}
          location={hero?.location ?? null}
          scrollY={scrollY}
          actionButtons={
            <LaunchShareIconButton
              onPress={handleShare}
              size={44}
              borderColor="rgba(255, 255, 255, 0.16)"
              backgroundColor="rgba(7, 9, 19, 0.34)"
              pressedBackgroundColor="rgba(255, 255, 255, 0.12)"
            />
          }
        />

        {/* Tab Navigation */}
        <LaunchDetailTabs
          tabs={visibleTabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          showBadge={showLiveBadge}
        />

        {/* Tab Panels */}
        <View style={{ flex: 1, padding: 20 }}>
          {/* Overview Tab */}
          <LaunchDetailTabPanel isActive={activeTab === 'overview'}>
            <OverviewTab data={overviewData} theme={theme} />
          </LaunchDetailTabPanel>

          {/* Live Tab */}
          <LaunchDetailTabPanel isActive={activeTab === 'live'}>
            <LiveTab data={liveData} theme={theme} />
          </LaunchDetailTabPanel>

          {/* Mission Tab */}
          <LaunchDetailTabPanel isActive={activeTab === 'mission'}>
            <MissionTab data={missionData} theme={theme} />
          </LaunchDetailTabPanel>

          {/* Vehicle Tab */}
          <LaunchDetailTabPanel isActive={activeTab === 'vehicle'}>
            <VehicleTab data={vehicleData} theme={theme} />
          </LaunchDetailTabPanel>

          {/* Related Tab */}
          <LaunchDetailTabPanel isActive={activeTab === 'related'}>
            <RelatedTab data={relatedData} theme={theme} />
          </LaunchDetailTabPanel>
        </View>
      </ScrollView>
    </AppScreen>
  );
}

// Helper functions

function getStatusTone(status: string | null): 'default' | 'success' | 'warning' | 'danger' {
  if (!status) return 'default';
  const lower = status.toLowerCase();
  if (lower.includes('success')) return 'success';
  if (lower.includes('hold') || lower.includes('tbd')) return 'warning';
  if (lower.includes('fail') || lower.includes('scrub')) return 'danger';
  return 'default';
}
