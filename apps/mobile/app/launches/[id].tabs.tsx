/**
 * Tab-based Launch Detail Screen (New Architecture)
 *
 * This is the new tab-based implementation of the launch details page.
 * It replaces the 16+ collapsible sections with 5 organized tabs.
 */

import { useEffect, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSharedValue, useAnimatedScrollHandler } from 'react-native-reanimated';
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
import { useLaunchDetailQuery } from '@/src/api/queries';
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
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { shareLaunch } from '@/src/utils/launchShare';
import { formatTimestamp } from '@/src/utils/format';
import { buildCountdownSnapshot, formatLaunchCountdownClock } from '@tminuszero/domain';

function getLaunchId(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

export default function LaunchDetailTabsScreen() {
  const { theme } = useMobileBootstrap();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const launchId = getLaunchId(params.id);

  // Data queries
  const launchDetailQuery = useLaunchDetailQuery(launchId);

  const detail = launchDetailQuery.data ?? null;
  const hero = detail ? getLaunchHeroModel(detail) : null;

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

  // Format countdown
  const countdown = buildCountdownSnapshot(hero?.net ?? null);
  const countdownText = countdown
    ? countdown.isPast
      ? 'Launched'
      : formatCountdown(countdown.totalMs)
    : null;

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
            refreshing={launchDetailQuery.isRefetching}
            onRefresh={() => launchDetailQuery.refetch()}
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
          countdown={countdownText}
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

function formatCountdown(totalMs: number): string {
  return formatLaunchCountdownClock(totalMs);
}
