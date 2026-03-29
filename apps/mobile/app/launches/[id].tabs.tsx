/**
 * Tab-based Launch Detail Screen (New Architecture)
 *
 * This is the new tab-based implementation of the launch details page.
 * It replaces the 16+ collapsible sections with 5 organized tabs.
 */

import { useState, useEffect, useRef } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, View, Text, RefreshControl } from 'react-native';
import { useSharedValue, useAnimatedScrollHandler } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LaunchTab } from '@tminuszero/launch-detail-ui';
import {
  computeTabVisibility,
  getVisibleTabs,
  shouldShowLiveBadge,
  getDefaultActiveTab,
  extractOverviewData,
  extractLiveData,
  extractMissionData,
  extractVehicleData,
  extractRelatedData,
} from '@tminuszero/launch-detail-ui';
import { useLaunchDetailQuery, useViewerEntitlementsQuery } from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import { ErrorStateCard, LoadingStateCard } from '@/src/components/SectionCard';
import { LaunchDetailHero } from '@/src/components/launch/LaunchDetailHero';
import { LaunchDetailTabs, LaunchDetailTabPanel } from '@/src/components/launch/LaunchDetailTabs';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { formatTimestamp } from '@/src/utils/format';
import { buildCountdownSnapshot } from '@tminuszero/domain';

function getLaunchId(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

export default function LaunchDetailTabsScreen() {
  const { theme } = useMobileBootstrap();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const launchId = getLaunchId(params.id);

  // Data queries
  const launchDetailQuery = useLaunchDetailQuery(launchId);
  const entitlementsQuery = useViewerEntitlementsQuery();

  const detail = launchDetailQuery.data ?? null;
  const launch = detail?.launchData ?? detail?.launch;

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
    if (newDefault !== activeTab && visibleTabs.some(t => t.id === newDefault)) {
      setActiveTab(newDefault);
    }
  }, [detail, tabVisibility]);

  // Loading state
  if (launchDetailQuery.isLoading || !detail) {
    return (
      <AppScreen>
        <Stack.Screen options={{ title: 'Loading...' }} />
        <LoadingStateCard />
      </AppScreen>
    );
  }

  // Error state
  if (launchDetailQuery.isError) {
    return (
      <AppScreen>
        <Stack.Screen options={{ title: 'Error' }} />
        <ErrorStateCard
          message="Failed to load launch details"
          onRetry={() => launchDetailQuery.refetch()}
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

  // Format countdown
  const countdown = buildCountdownSnapshot(launch?.net ?? null);
  const countdownText = countdown
    ? countdown.isPast
      ? 'Launched'
      : formatCountdown(countdown.totalMs)
    : null;

  // Format NET time
  const netTime = launch?.net ? formatTimestamp(launch.net) : null;

  return (
    <AppScreen>
      <Stack.Screen
        options={{
          title: launch?.name ?? 'Launch Details',
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
          backgroundImage={launch?.image?.full ?? null}
          launchName={launch?.name ?? 'Unknown Launch'}
          provider={launch?.provider ?? null}
          vehicle={launch?.vehicle ?? null}
          status={launch?.status ?? null}
          statusTone={getStatusTone(launch?.status ?? null)}
          tier={launch?.tier ?? null}
          webcastLive={Boolean(launch?.webcastLive)}
          countdown={countdownText}
          netTime={netTime}
          location={launch?.pad?.location ?? null}
          scrollY={scrollY}
          actionButtons={
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
              {/* Placeholder action buttons */}
              <View
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderRadius: 12,
                  backgroundColor: theme.accent,
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#000' }}>
                  Follow
                </Text>
              </View>
              <View
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: theme.text }}>
                  📅
                </Text>
              </View>
            </View>
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
            <OverviewTabContent data={overviewData} theme={theme} />
          </LaunchDetailTabPanel>

          {/* Live Tab */}
          <LaunchDetailTabPanel isActive={activeTab === 'live'}>
            <LiveTabContent data={liveData} theme={theme} />
          </LaunchDetailTabPanel>

          {/* Mission Tab */}
          <LaunchDetailTabPanel isActive={activeTab === 'mission'}>
            <MissionTabContent data={missionData} theme={theme} />
          </LaunchDetailTabPanel>

          {/* Vehicle Tab */}
          <LaunchDetailTabPanel isActive={activeTab === 'vehicle'}>
            <VehicleTabContent data={vehicleData} theme={theme} />
          </LaunchDetailTabPanel>

          {/* Related Tab */}
          <LaunchDetailTabPanel isActive={activeTab === 'related'}>
            <RelatedTabContent data={relatedData} theme={theme} />
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
  const totalSec = Math.abs(Math.floor(totalMs / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const prefix = totalMs < 0 ? 'T+' : 'T-';

  if (days > 0) {
    return `${prefix} ${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${prefix} ${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${prefix} ${minutes}m ${seconds}s`;
  } else {
    return `${prefix} ${seconds}s`;
  }
}

// Tab Content Components

function OverviewTabContent({ data, theme }: { data: any; theme: any }) {
  return (
    <View style={{ gap: 20 }}>
      <Text style={{ fontSize: 20, fontWeight: '700', color: theme.text }}>
        Overview
      </Text>

      {/* Mission Brief */}
      {data.missionBrief.description && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>
            Mission
          </Text>
          <Text style={{ fontSize: 14, color: theme.muted, lineHeight: 20 }}>
            {data.missionBrief.description}
          </Text>
        </View>
      )}

      {/* Quick Stats */}
      {data.quickStats.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>
            Quick Facts
          </Text>
          <View style={{ gap: 8 }}>
            {data.quickStats.map((stat: any, idx: number) => (
              <View
                key={idx}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.stroke,
                }}
              >
                <Text style={{ fontSize: 14, color: theme.muted }}>
                  {stat.icon} {stat.label}
                </Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>
                  {stat.value}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Rocket Profile */}
      {data.rocketProfile.name && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>
            Vehicle
          </Text>
          <Text style={{ fontSize: 14, color: theme.muted }}>
            {data.rocketProfile.name}
          </Text>
          {data.rocketProfile.manufacturer && (
            <Text style={{ fontSize: 12, color: theme.muted }}>
              {data.rocketProfile.manufacturer}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

function LiveTabContent({ data, theme }: { data: any; theme: any }) {
  return (
    <View style={{ gap: 20 }}>
      <Text style={{ fontSize: 20, fontWeight: '700', color: theme.text }}>
        Live Coverage
      </Text>

      {/* Watch Links */}
      {data.watchLinks.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>
            Watch Live
          </Text>
          {data.watchLinks.map((link: any, idx: number) => (
            <View
              key={idx}
              style={{
                padding: 16,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: theme.stroke,
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>
                {link.title}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Launch Updates */}
      {data.launchUpdates.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>
            Recent Updates
          </Text>
          {data.launchUpdates.slice(0, 5).map((update: any, idx: number) => (
            <View
              key={idx}
              style={{
                padding: 12,
                borderLeftWidth: 3,
                borderLeftColor: theme.accent,
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
              }}
            >
              <Text style={{ fontSize: 12, color: theme.muted }}>
                {update.field}: {update.newValue ?? 'N/A'}
              </Text>
            </View>
          ))}
        </View>
      )}

      {data.watchLinks.length === 0 && data.launchUpdates.length === 0 && (
        <Text style={{ fontSize: 14, color: theme.muted, textAlign: 'center', paddingVertical: 40 }}>
          Live coverage typically begins 24 hours before launch
        </Text>
      )}
    </View>
  );
}

function MissionTabContent({ data, theme }: { data: any; theme: any }) {
  return (
    <View style={{ gap: 20 }}>
      <Text style={{ fontSize: 20, fontWeight: '700', color: theme.text }}>
        Mission Details
      </Text>

      {/* Payload Manifest */}
      {data.payloadManifest.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>
            Payloads ({data.payloadManifest.length})
          </Text>
          {data.payloadManifest.map((payload: any, idx: number) => (
            <View
              key={idx}
              style={{
                padding: 16,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: theme.stroke,
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>
                {payload.name ?? `Payload ${idx + 1}`}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Crew */}
      {data.crew.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>
            Crew ({data.crew.length})
          </Text>
          {data.crew.map((member: any, idx: number) => (
            <View
              key={idx}
              style={{
                padding: 16,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: theme.stroke,
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>
                {member.name}
              </Text>
              <Text style={{ fontSize: 12, color: theme.muted }}>
                {member.role}
              </Text>
            </View>
          ))}
        </View>
      )}

      {data.payloadManifest.length === 0 && data.crew.length === 0 && (
        <Text style={{ fontSize: 14, color: theme.muted, textAlign: 'center', paddingVertical: 40 }}>
          No mission details available
        </Text>
      )}
    </View>
  );
}

function VehicleTabContent({ data, theme }: { data: any; theme: any }) {
  return (
    <View style={{ gap: 20 }}>
      <Text style={{ fontSize: 20, fontWeight: '700', color: theme.text }}>
        Vehicle Details
      </Text>

      {/* Vehicle Config */}
      {data.vehicleConfig.family && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>
            Configuration
          </Text>
          <Text style={{ fontSize: 14, color: theme.muted }}>
            {data.vehicleConfig.family}
            {data.vehicleConfig.variant && ` - ${data.vehicleConfig.variant}`}
          </Text>
        </View>
      )}

      {/* Stages */}
      {data.stages.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>
            Stages ({data.stages.length})
          </Text>
          {data.stages.map((stage: any, idx: number) => (
            <View
              key={idx}
              style={{
                padding: 16,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: theme.stroke,
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>
                Stage {idx + 1}
              </Text>
            </View>
          ))}
        </View>
      )}

      {!data.vehicleConfig.family && data.stages.length === 0 && (
        <Text style={{ fontSize: 14, color: theme.muted, textAlign: 'center', paddingVertical: 40 }}>
          No vehicle details available
        </Text>
      )}
    </View>
  );
}

function RelatedTabContent({ data, theme }: { data: any; theme: any }) {
  return (
    <View style={{ gap: 20 }}>
      <Text style={{ fontSize: 20, fontWeight: '700', color: theme.text }}>
        Related Content
      </Text>

      {/* News */}
      {data.news.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>
            News ({data.news.length})
          </Text>
          {data.news.map((article: any, idx: number) => (
            <View
              key={idx}
              style={{
                padding: 16,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: theme.stroke,
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>
                {article.title}
              </Text>
              <Text style={{ fontSize: 12, color: theme.muted, marginTop: 4 }}>
                {article.source}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Events */}
      {data.events.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>
            Related Events ({data.events.length})
          </Text>
          {data.events.map((event: any, idx: number) => (
            <View
              key={idx}
              style={{
                padding: 16,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: theme.stroke,
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>
                {event.name ?? `Event ${idx + 1}`}
              </Text>
            </View>
          ))}
        </View>
      )}

      {data.news.length === 0 && data.events.length === 0 && (
        <Text style={{ fontSize: 14, color: theme.muted, textAlign: 'center', paddingVertical: 40 }}>
          No related content available
        </Text>
      )}
    </View>
  );
}
