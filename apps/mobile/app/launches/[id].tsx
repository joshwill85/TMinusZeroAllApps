import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { AppState, Image, Linking, Platform, Pressable, RefreshControl, ScrollView, Share as NativeShare, Text, View, type LayoutChangeEvent } from 'react-native';
import { runOnJS, useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ArTrajectorySummaryV1, LaunchDetailV1 } from '@tminuszero/contracts';
import {
  buildCountdownSnapshot,
  canAutoRefreshActiveSurface,
  getNextAlignedRefreshMs,
  getVisibleDetailUpdatedAt,
  hasVersionChanged,
  shouldPrimeVersionRefresh
} from '@tminuszero/domain';
import { normalizeNativeMobileCustomerHref, toProviderSlug } from '@tminuszero/navigation';
import { useApiClient } from '@/src/api/client';
import { fetchLaunchDetailVersion, useLaunchDetailQuery, useViewerEntitlementsQuery } from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import { LaunchAlertsPanel } from '@/src/components/LaunchAlertsPanel';
import { LaunchCalendarSheet } from '@/src/components/LaunchCalendarSheet';
import { EmptyStateCard, ErrorStateCard, LoadingStateCard, SectionCard } from '@/src/components/SectionCard';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { useMobilePush } from '@/src/providers/MobilePushProvider';
import { useMobileToast } from '@/src/providers/MobileToastProvider';
import { formatTimestamp, formatSearchResultLabel } from '@/src/utils/format';
import type { LaunchCalendarLaunch } from '@/src/calendar/launchCalendar';
import { buildWatchlistRuleErrorMessage, buildPadRuleValue, formatPadRuleLabel, usePrimaryWatchlist } from '@/src/watchlists/usePrimaryWatchlist';
import { ParallaxHero, StaticHero } from '@/src/components/launch/ParallaxHero';
import { InteractiveStatTiles, type StatTile } from '@/src/components/launch/InteractiveStatTiles';
import { LiveBadge } from '@/src/components/launch/LiveDataPulse';
import { AnimationErrorBoundary } from '@/src/components/launch/AnimationErrorBoundary';
import { CollapsibleSection } from '@/src/components/launch/CollapsibleSection';
import { SectionNav, StickyNavPills, type NavSection } from '@/src/components/launch/StickyNavPills';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';

type LegacyLaunchSummary = LaunchDetailV1['launch'];
type RichLaunchSummary = NonNullable<LaunchDetailV1['launchData']>;
type LaunchSummary = LegacyLaunchSummary | RichLaunchSummary;
type LaunchExternalContentItem = LaunchDetailV1['enrichment']['externalContent'][number];
type LaunchExternalContentResource = LaunchExternalContentItem['resources'][number];
type WatchLinkView = { url: string; label: string; meta: string; imageUrl: string | null; host?: string | null; kind?: string | null };
type ExternalLinkView = { url: string; label: string; meta: string; host?: string | null; kind?: string | null };

function getLaunchId(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

export default function LaunchDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { theme } = useMobileBootstrap();
  const { showToast } = useMobileToast();
  const { installationId, deviceSecret, isRegistered } = useMobilePush();
  const { client } = useApiClient();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const launchId = getLaunchId(params.id);
  const launchDetailQuery = useLaunchDetailQuery(launchId);
  const entitlementsQuery = useViewerEntitlementsQuery();
  const detail = launchDetailQuery.data ?? null;
  const legacyLaunch = detail?.launch ?? null;
  const launch = detail?.launchData ?? null;
  const arTrajectory = detail?.arTrajectory ?? null;
  const canUseArTrajectory = entitlementsQuery.data?.capabilities.canUseArTrajectory ?? false;
  const canUseSavedItems = entitlementsQuery.data?.capabilities.canUseSavedItems ?? false;
  const isPremium = entitlementsQuery.data?.isPaid === true || entitlementsQuery.data?.isAdmin === true;
  const isAuthed = entitlementsQuery.data?.isAuthed ?? false;
  const refreshIntervalMs = (entitlementsQuery.data?.refreshIntervalSeconds ?? 7200) * 1000;
  const detailVersionScope = entitlementsQuery.data?.mode === 'live' ? 'live' : 'public';
  const [calendarLaunch, setCalendarLaunch] = useState<LaunchCalendarLaunch | null>(null);
  const [savedStatus, setSavedStatus] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [sectionOffsets, setSectionOffsets] = useState<Record<string, number>>({});
  const [activeSection, setActiveSection] = useState<string | null>('mission-control');
  const [detailRefreshing, setDetailRefreshing] = useState(false);
  const [appStateStatus, setAppStateStatus] = useState(AppState.currentState);
  const watchlistState = usePrimaryWatchlist({
    enabled: isAuthed && canUseSavedItems,
    ruleLimit: entitlementsQuery.data?.limits.watchlistRuleLimit ?? null
  });
  const title = launch?.name ?? legacyLaunch?.name ?? 'Launch detail';
  const shouldReduceMotion = useReducedMotion();
  const scrollRef = useRef<ScrollView | null>(null);
  const activeSectionRef = useRef<string | null>('mission-control');
  const sectionNavItemsRef = useRef<NavSection[]>([]);
  const lastSeenVersionRef = useRef<string | null>(null);
  const refetchLaunchDetail = launchDetailQuery.refetch;

  const handleMissionControlScroll = (offsetY: number) => {
    const sections = sectionNavItemsRef.current;
    if (sections.length === 0) {
      return;
    }

    let nextActive = sections[0]?.id ?? null;
    const scrollProbe = offsetY + 180;

    for (const section of sections) {
      if (section.offsetY < 0) {
        continue;
      }
      if (scrollProbe >= section.offsetY) {
        nextActive = section.id;
      } else {
        break;
      }
    }

    if (nextActive && activeSectionRef.current !== nextActive) {
      activeSectionRef.current = nextActive;
      setActiveSection(nextActive);
    }
  };

  const handleSectionPress = (sectionId: string, offsetY: number) => {
    if (offsetY < 0) {
      return;
    }
    const targetY = Math.max(offsetY - 124, 0);
    activeSectionRef.current = sectionId;
    setActiveSection(sectionId);
    scrollRef.current?.scrollTo({ y: targetY, animated: true });
  };

  const registerSectionOffset = (sectionId: string, event: LayoutChangeEvent) => {
    const nextOffset = Math.max(0, Math.round(event.nativeEvent.layout.y));
    setSectionOffsets((current) => {
      if (current[sectionId] === nextOffset) {
        return current;
      }
      return {
        ...current,
        [sectionId]: nextOffset
      };
    });
  };

  // Mission Control scroll tracking
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
      runOnJS(handleMissionControlScroll)(event.contentOffset.y);
    },
  });

  let content: JSX.Element;
  let overlayNavigation: JSX.Element | null = null;

  useEffect(() => {
    setSavedStatus(null);
    setSectionOffsets({});
    setActiveSection('mission-control');
    activeSectionRef.current = 'mission-control';
    sectionNavItemsRef.current = [];
    lastSeenVersionRef.current = null;
  }, [launchId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppStateStatus(nextState);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const refreshDetail = useCallback(async (versionOverride: string | null = null) => {
    setDetailRefreshing(true);
    try {
      await refetchLaunchDetail();
      lastSeenVersionRef.current = versionOverride;
    } finally {
      setDetailRefreshing(false);
    }
  }, [refetchLaunchDetail]);

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
      const nextVersion = payload.version;
      const visibleUpdatedAt = getVisibleDetailUpdatedAt(detail.launchData ?? null);

      if (!lastSeenVersionRef.current) {
        lastSeenVersionRef.current = nextVersion;
        const shouldPrimeRefresh = shouldPrimeVersionRefresh(payload.updatedAt, visibleUpdatedAt);
        if (shouldPrimeRefresh) {
          await refreshDetail(nextVersion);
        }
        return;
      }

      if (hasVersionChanged(lastSeenVersionRef.current, nextVersion)) {
        await refreshDetail(nextVersion);
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
      const nextRefreshAt = getNextAlignedRefreshMs(Date.now(), refreshIntervalMs);
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
    client,
    detailVersionScope,
    detail,
    detailRefreshing,
    isFocused,
    launchDetailQuery.isPending,
    launchId,
    queryClient,
    refreshDetail,
    refreshIntervalMs
  ]);

  if (!launchId) {
    sectionNavItemsRef.current = [];
    content = <EmptyStateCard title="Missing launch id" body="A launch detail route was opened without an id parameter." />;
  } else if (launchDetailQuery.isPending) {
    sectionNavItemsRef.current = [];
    content = <LoadingStateCard title="Loading launch detail" body={`Fetching /api/v1/launches/${launchId}.`} />;
  } else if (launchDetailQuery.isError) {
    sectionNavItemsRef.current = [];
    content = <ErrorStateCard title="Launch detail unavailable" body={launchDetailQuery.error.message} />;
  } else if (!detail) {
    sectionNavItemsRef.current = [];
    content = <EmptyStateCard title="Launch detail unavailable" body="No launch detail was returned for this route." />;
  } else if (!launch) {
    sectionNavItemsRef.current = [];
    content = legacyLaunch ? (
      <LegacyLaunchDetail
        legacyLaunch={legacyLaunch}
        launchId={launchId}
        arTrajectory={arTrajectory}
        canUseArTrajectory={canUseArTrajectory}
      />
    ) : (
      <EmptyStateCard title="Launch detail unavailable" body="The legacy launch payload was missing for this route." />
    );
  } else {
    const launchRecord = launch;
    const weatherModule = detail.weather ?? null;
    const resourcesModule = detail.resources ?? null;
    const socialModule = detail.social ?? null;
    const blueOriginModule = detail.blueOrigin ?? null;
    const relatedEvents = detail.relatedEvents ?? [];
    const relatedNews = detail.relatedNews ?? [];
    const payloadManifest = detail.payloadManifest ?? [];
    const objectInventory = detail.objectInventory ?? null;
    const launchUpdates = detail.launchUpdates ?? [];
    const missionStats = detail.missionStats ?? null;
    const weatherConcerns =
      weatherModule?.concerns && weatherModule.concerns.length > 0
        ? weatherModule.concerns
        : launch.weatherConcerns || [];
    const watchLinks: WatchLinkView[] =
      resourcesModule?.watchLinks?.map((item) => ({
        url: item.url,
        label: item.label,
        meta: item.meta || item.host || 'Live/Replay',
        imageUrl: item.imageUrl || null,
        host: item.host ?? null,
        kind: item.kind ?? null
      })) ?? buildWatchLinks(launch);
    const externalLinks: ExternalLinkView[] =
      resourcesModule?.externalLinks?.map((item) => ({
        url: item.url,
        label: item.label,
        meta: item.meta || 'External link',
        host: item.host ?? null,
        kind: item.kind ?? null
      })) ?? buildExternalLinks(launch);
    const watchUrl = watchLinks[0]?.url ?? getPrimaryWatchUrl(launch);
    const resourceUrl = resourcesModule?.missionResources?.[0]?.url ?? externalLinks[0]?.url ?? getPrimaryResourceUrl(launch);
    const primaryWatchLink = watchLinks[0] ?? null;
    const heroTitle = launch.mission?.name || title;
    const heroMeta = [launch.provider, launch.rocket?.fullName || launch.vehicle, launch.pad.shortCode || launch.pad.name]
      .filter(Boolean)
      .join(' • ');
    const rocketPhotoUrl = launch.rocket?.imageUrl || launch.providerImageUrl || launch.image.full || launch.image.thumbnail || null;
    const hasPrograms = Array.isArray(launch.programs) && launch.programs.length > 0;
    const hasCrew = Array.isArray(launch.crew) && launch.crew.length > 0;
    const padRuleValue = buildPadRuleValue({
      ll2PadId: launchRecord.ll2PadId,
      padShortCode: launchRecord.pad.shortCode
    });
    const launchBusyKey = `launch:${launchRecord.id.toLowerCase()}`;
    const providerBusyKey = `provider:${String(launchRecord.provider || '').trim().toLowerCase()}`;
    const padBusyKey = `pad:${String(padRuleValue || '').trim().toLowerCase()}`;
    const launchInfoProviderHref = buildLaunchProviderEntityHref(launch.provider);
    const launchInfoRocketLabel = launch.rocketName || launch.rocket?.fullName || launch.vehicle || 'TBD';
    const launchInfoRocketHref = buildLaunchRocketEntityHref({
      label: launchInfoRocketLabel,
      ll2RocketConfigId: launch.ll2RocketConfigId
    });
    const launchInfoLocationLabel = launch.padLocation || launch.pad.locationName || launch.pad.state || 'TBD';
    const launchInfoLocationHref = buildLaunchLocationEntityHref({
      locationLabel: launchInfoLocationLabel,
      padLabel: launch.padName || launch.pad.name,
      ll2PadId: launch.ll2PadId
    });
    const launchInfoPadHref = buildLaunchPadEntityHref({
      ll2PadId: launch.ll2PadId,
      fallbackLocationHref: launchInfoLocationHref
    });
    const openTarget = (target: string) => {
      if (!target) return;
      if (/^https?:\/\//i.test(target)) {
        void Linking.openURL(target);
        return;
      }
      if (target.startsWith('/launches/')) {
        router.push(target as Href);
        return;
      }
      const nativeCustomerHref = normalizeNativeMobileCustomerHref(target);
      if (nativeCustomerHref) {
        router.push(nativeCustomerHref as Href);
        return;
      }
      setSavedStatus({
        tone: 'error',
        text: 'That linked surface has not shipped natively on mobile yet.'
      });
    };

    const openPremiumGate = () => {
      router.push('/profile');
    };

    const showFollowToast = ({
      message,
      undo
    }: {
      message: string;
      undo: () => Promise<void>;
    }) => {
      showToast({
        message,
        tone: 'success',
        actionLabel: 'Undo',
        onAction: async () => {
          try {
            await undo();
          } catch (error) {
            setSavedStatus({
              tone: 'error',
              text: error instanceof Error ? error.message : 'Unable to undo that follow.'
            });
          }
        }
      });
    };

    const handleToggleSavedLaunch = async () => {
      if (!canUseSavedItems) {
        openPremiumGate();
        return;
      }
      try {
        const result = await watchlistState.toggleLaunch(launchRecord.id);
        if (result) {
          if (result.action === 'added') {
            showFollowToast({
              message: result.notice.message,
              undo: async () => {
                await watchlistState.toggleLaunch(launchRecord.id);
                setSavedStatus({ tone: 'success', text: 'Removed from My Launches.' });
              }
            });
          } else {
            setSavedStatus({ tone: 'success', text: result.notice.message });
          }
        }
      } catch (error) {
        setSavedStatus({
          tone: 'error',
          text: buildWatchlistRuleErrorMessage(error, 'My Launches', entitlementsQuery.data?.limits.watchlistRuleLimit ?? null)
        });
      }
    };

    const handleToggleProviderFollow = async () => {
      if (!canUseSavedItems) {
        openPremiumGate();
        return;
      }
      try {
        const result = await watchlistState.toggleProvider(launchRecord.provider);
        if (result) {
          if (result.action === 'added') {
            showFollowToast({
              message: result.notice.message,
              undo: async () => {
                await watchlistState.toggleProvider(launchRecord.provider);
                setSavedStatus({ tone: 'success', text: `Unfollowed ${launchRecord.provider}.` });
              }
            });
          } else {
            setSavedStatus({ tone: 'success', text: result.notice.message });
          }
        }
      } catch (error) {
        setSavedStatus({
          tone: 'error',
          text: buildWatchlistRuleErrorMessage(error, 'Follow', entitlementsQuery.data?.limits.watchlistRuleLimit ?? null)
        });
      }
    };

    const handleTogglePadFollow = async () => {
      if (!padRuleValue) {
        return;
      }
      if (!canUseSavedItems) {
        openPremiumGate();
        return;
      }

      try {
        const result = await watchlistState.togglePad(padRuleValue);
        if (result) {
          if (result.action === 'added') {
            showFollowToast({
              message: result.notice.message,
              undo: async () => {
                await watchlistState.togglePad(padRuleValue);
                setSavedStatus({ tone: 'success', text: `Unfollowed ${formatPadRuleLabel(padRuleValue)}.` });
              }
            });
          } else {
            setSavedStatus({ tone: 'success', text: result.notice.message });
          }
        }
      } catch (error) {
        setSavedStatus({
          tone: 'error',
          text: buildWatchlistRuleErrorMessage(error, 'Follow', entitlementsQuery.data?.limits.watchlistRuleLimit ?? null)
        });
      }
    };

    const statTiles: StatTile[] = [
      {
        id: 'countdown',
        label: buildCountdownLabel(launch.net),
        value: buildCountdownDisplay(launch.net),
        description: `NET: ${formatTimestamp(launch.net)}`,
        tone: 'primary'
      },
      ...(weatherModule?.summary
        ? [
            {
              id: 'weather',
              label: 'Weather conditions',
              value: weatherModule.summary.split('.')[0] || 'Favorable',
              description: weatherConcerns.length > 0 ? `Concerns: ${weatherConcerns.join(', ')}` : 'No weather concerns',
              tone: weatherConcerns.length > 0 ? 'warning' : 'success'
            } satisfies StatTile
          ]
        : []),
      {
        id: 'provider',
        label: 'Launch provider',
        value: launch.provider,
        description: launch.providerCountryCode ? `Based in ${launch.providerCountryCode}` : 'Space launch provider',
        tone: 'default'
      },
      {
        id: 'vehicle',
        label: 'Launch vehicle',
        value: launch.vehicle || launch.rocket?.fullName || 'TBD',
        description: launch.pad?.name ? `From ${launch.pad.name}` : 'Launch vehicle',
        tone: 'default'
      }
    ];
    const hasLiveCoverage = Boolean(primaryWatchLink);
    const hasSocialUpdates = Boolean(socialModule?.matchedPost || socialModule?.providerFeeds?.length);
    const hasRocketProfile = Boolean(launch.rocket?.fullName || launch.vehicle || rocketPhotoUrl);
    const hasForecastOutlook = Boolean(weatherModule?.cards?.length);
    const hasLaunchAdvisories = detail.enrichment.faaAdvisories.length > 0;
    const hasStagesAndRecovery = detail.enrichment.firstStages.length > 0 || detail.enrichment.recovery.length > 0;
    const hasOfficialMedia = Boolean(
      resourcesModule?.missionResources?.length ||
      resourcesModule?.missionTimeline?.length ||
      launch.launchVidUrls?.length ||
      launch.launchInfoUrls?.length ||
      detail.enrichment.externalContent.length
    );
    const hasPayloadMissionContext = Boolean(launch.payloads?.length || launch.mission?.agencies?.length || launchUpdates.length);
    const hasPayloadManifestInventory = Boolean(
      payloadManifest.length > 0 ||
      objectInventory?.payloadObjects?.length ||
      objectInventory?.nonPayloadObjects?.length ||
      objectInventory?.summaryBadges?.length
    );
    const hasBlueOriginMissionDetails = Boolean(
      blueOriginModule &&
        (
          blueOriginModule.resourceLinks.length ||
          blueOriginModule.travelerProfiles.length ||
          blueOriginModule.missionGraphics.length ||
          blueOriginModule.facts.length ||
          blueOriginModule.payloadNotes.length
        )
    );
    const hasMissionStats = Boolean(missionStats?.cards?.length || missionStats?.boosterCards?.length || missionStats?.bonusInsights?.length);
    const hasRelatedCoverage = relatedEvents.length === 0 && relatedNews.length === 0 && detail.related.length > 0;
    const getSectionOffset = (sectionId: string, fallback = -1) => sectionOffsets[sectionId] ?? fallback;
    const navSections: NavSection[] = [
      { id: 'mission-control', label: 'Mission Control', offsetY: getSectionOffset('mission-control', 0) },
      ...(hasLiveCoverage ? [{ id: 'live-coverage', label: 'Coverage', offsetY: getSectionOffset('live-coverage') }] : []),
      ...(hasSocialUpdates ? [{ id: 'social-updates', label: 'Social', offsetY: getSectionOffset('social-updates') }] : []),
      ...(hasRocketProfile ? [{ id: 'rocket-profile', label: 'Rocket', offsetY: getSectionOffset('rocket-profile') }] : []),
      { id: 'launch-info', label: 'Info', offsetY: getSectionOffset('launch-info') },
      ...(hasForecastOutlook ? [{ id: 'forecast-outlook', label: 'Weather', offsetY: getSectionOffset('forecast-outlook') }] : []),
      ...(hasLaunchAdvisories ? [{ id: 'launch-advisories', label: 'Advisories', offsetY: getSectionOffset('launch-advisories') }] : []),
      ...(hasStagesAndRecovery ? [{ id: 'stages-recovery', label: 'Stages', offsetY: getSectionOffset('stages-recovery') }] : []),
      ...(hasOfficialMedia ? [{ id: 'official-media', label: 'Media', offsetY: getSectionOffset('official-media') }] : []),
      ...(hasPayloadMissionContext ? [{ id: 'payload-updates', label: 'Payloads', offsetY: getSectionOffset('payload-updates') }] : []),
      ...(hasPayloadManifestInventory ? [{ id: 'payload-inventory', label: 'Inventory', offsetY: getSectionOffset('payload-inventory') }] : []),
      ...(relatedEvents.length > 0 ? [{ id: 'related-events', label: 'Events', offsetY: getSectionOffset('related-events') }] : []),
      ...(relatedNews.length > 0 ? [{ id: 'launch-news', label: 'News', offsetY: getSectionOffset('launch-news') }] : []),
      ...(hasBlueOriginMissionDetails ? [{ id: 'blue-origin', label: 'Blue Origin', offsetY: getSectionOffset('blue-origin') }] : []),
      ...(hasMissionStats ? [{ id: 'mission-stats', label: 'Stats', offsetY: getSectionOffset('mission-stats') }] : []),
      ...(hasRelatedCoverage ? [{ id: 'related-coverage', label: 'Related', offsetY: getSectionOffset('related-coverage') }] : [])
    ];

    sectionNavItemsRef.current = navSections;

    overlayNavigation =
      !shouldReduceMotion && navSections.length > 1 ? (
        <AnimationErrorBoundary fallback={null}>
          <StickyNavPills
            sections={navSections}
            scrollY={scrollY}
            activeSection={activeSection}
            onSectionPress={handleSectionPress}
            offsetTop={Math.max(insets.top + 52, 88)}
          />
        </AnimationErrorBoundary>
      ) : null;

    content = (
      <>
        <View
          style={{
            marginTop: Math.max(insets.top - 10, 8),
            overflow: 'hidden',
            borderRadius: 999,
            borderWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: 'rgba(7, 9, 19, 0.72)',
            paddingHorizontal: 16,
            paddingVertical: 11
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1, alignItems: 'flex-start' }}>
                <Pressable onPress={() => router.back()} hitSlop={8}>
                  <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>Back to feed</Text>
                </Pressable>
              </View>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text
                numberOfLines={1}
                style={{ color: theme.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.8, textTransform: 'uppercase' }}
              >
                Launch detail
              </Text>
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Pressable
                onPress={() => {
                  void NativeShare.share({
                    message: buildShareMessage(launch)
                  });
                }}
                hitSlop={8}
              >
                <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>Share</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <AnimationErrorBoundary
          fallback={
            <StaticHero
              backgroundImage={launch.image.full || launch.image.thumbnail || rocketPhotoUrl}
              title={heroTitle}
              subtitle={heroMeta || formatTimestamp(launch.net)}
              status={launch.statusText || 'Status pending'}
              statusTone={getStatusTone(launch.status)}
            >
              <View style={{ gap: 12 }}>
                {launch.providerLogoUrl ? (
                  <Image source={{ uri: launch.providerLogoUrl }} resizeMode="contain" style={{ width: 150, height: 38 }} />
                ) : (
                  <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' }}>
                    {launch.provider}
                  </Text>
                )}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <DetailChip label={launch.tier.toUpperCase()} />
                  {launch.providerCountryCode ? <DetailChip label={launch.providerCountryCode} /> : null}
                  {launch.webcastLive ? <DetailChip label="LIVE" tone="accent" /> : null}
                  {launch.hashtag ? <DetailChip label={launch.hashtag.startsWith('#') ? launch.hashtag : `#${launch.hashtag}`} /> : null}
                </View>
                {launch.missionSummary ? <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 22 }}>{launch.missionSummary}</Text> : null}
              </View>
            </StaticHero>
          }
        >
          <ParallaxHero
            backgroundImage={launch.image.full || launch.image.thumbnail || rocketPhotoUrl}
            title={heroTitle}
            subtitle={heroMeta || formatTimestamp(launch.net)}
            scrollY={scrollY}
            status={launch.statusText || 'Status pending'}
            statusTone={getStatusTone(launch.status)}
          >
            <View style={{ gap: 12 }}>
              {launch.providerLogoUrl ? (
                <Image source={{ uri: launch.providerLogoUrl }} resizeMode="contain" style={{ width: 150, height: 38 }} />
              ) : (
                <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' }}>
                  {launch.provider}
                </Text>
              )}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <DetailChip label={launch.tier.toUpperCase()} />
                {launch.providerCountryCode ? <DetailChip label={launch.providerCountryCode} /> : null}
                {launch.webcastLive ? <LiveBadge label="LIVE" /> : null}
                {launch.hashtag ? <DetailChip label={launch.hashtag.startsWith('#') ? launch.hashtag : `#${launch.hashtag}`} /> : null}
              </View>
              {launch.missionSummary ? <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 22 }}>{launch.missionSummary}</Text> : null}
              {launch.holdReason ? <Text style={{ color: '#ffd36e', fontSize: 13, lineHeight: 20 }}>Hold reason: {launch.holdReason}</Text> : null}
              {launch.failReason ? <Text style={{ color: '#ff9aab', fontSize: 13, lineHeight: 20 }}>Failure context: {launch.failReason}</Text> : null}
            </View>
          </ParallaxHero>
        </AnimationErrorBoundary>

        {navSections.length > 1 ? (
          <View
            style={{
              borderRadius: 20,
              borderWidth: 1,
              borderColor: theme.stroke,
              backgroundColor: 'rgba(11, 16, 35, 0.84)',
              paddingHorizontal: 16,
              paddingVertical: 14,
              gap: 10
            }}
          >
            <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' }}>
              Jump to section
            </Text>
            <SectionNav
              sections={navSections.map((section) => ({ id: section.id, label: section.label }))}
              activeSection={activeSection}
              onSectionPress={(sectionId) => {
                const selectedSection = navSections.find((section) => section.id === sectionId);
                if (selectedSection) {
                  handleSectionPress(sectionId, selectedSection.offsetY);
                }
              }}
            />
          </View>
        ) : null}

        <DetailModuleSection
          id="mission-control"
          title="Mission control dashboard"
          description="Countdown, launch actions, alerts, and live launch signals."
          onLayout={registerSectionOffset}
        >
          <View style={{ gap: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' }}>
                  Liftoff
                </Text>
                <Text style={{ color: theme.foreground, fontSize: 18, fontWeight: '700', lineHeight: 22 }}>{formatTimestamp(launch.net)}</Text>
                <Text style={{ color: theme.muted, fontSize: 13 }}>
                  {launch.netPrecision === 'day' || launch.netPrecision === 'tbd' ? 'Date-only NET window' : 'Precise launch window'}
                </Text>
              </View>
              <View
                style={{
                  minWidth: 132,
                  maxWidth: '48%',
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: 'rgba(255, 255, 255, 0.06)',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  paddingHorizontal: 12,
                  paddingVertical: 10
                }}
              >
                <Text
                  style={{
                    color: theme.foreground,
                    fontSize: 27,
                    fontWeight: '300',
                    lineHeight: 30,
                    textAlign: 'right',
                    letterSpacing: 0.4,
                    fontVariant: ['tabular-nums']
                  }}
                >
                  {buildCountdownDisplay(launch.net)}
                </Text>
                <Text
                  style={{
                    marginTop: 4,
                    color: theme.accent,
                    fontSize: 11,
                    fontWeight: '700',
                    letterSpacing: 1.1,
                    textAlign: 'right',
                    textTransform: 'uppercase'
                  }}
                >
                  {buildCountdownLabel(launch.net)}
                </Text>
              </View>
            </View>

            {weatherModule?.summary || weatherConcerns.length ? (
              <View
                style={{
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  padding: 14,
                  gap: 8
                }}
              >
                <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>Weather</Text>
                {weatherModule?.summary ? <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>{weatherModule.summary}</Text> : null}
                {weatherConcerns.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {weatherConcerns.map((concern) => (
                      <DetailChip key={concern} label={concern} />
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {watchUrl ? (
                <ActionButton
                  label="Watch live"
                  onPress={() => {
                    void Linking.openURL(watchUrl);
                  }}
                />
              ) : null}
              {resourceUrl ? (
                <ActionButton
                  label="Mission resources"
                  onPress={() => {
                    void Linking.openURL(resourceUrl);
                  }}
                  variant="secondary"
                />
              ) : null}
              <ActionButton
                label="Add to calendar"
                onPress={() => {
                  setCalendarLaunch({
                    id: launch.id,
                    name: launch.name,
                    provider: launch.provider,
                    vehicle: launch.vehicle,
                    net: launch.net,
                    netPrecision: launch.netPrecision,
                    windowEnd: launch.windowEnd ?? null,
                    pad: {
                      name: launch.pad.name,
                      state: launch.pad.state
                    }
                  });
                }}
                variant="secondary"
              />
              <ActionButton
                label="Share launch"
                onPress={() => {
                  void NativeShare.share({
                    message: buildShareMessage(launch)
                  });
                }}
                variant="secondary"
              />
            </View>

            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <DetailFollowChip
                  label={watchlistState.isLaunchTracked(launch.id) ? 'Following launch' : 'Follow launch'}
                  active={watchlistState.isLaunchTracked(launch.id)}
                  disabled={watchlistState.isLoading || Boolean(watchlistState.busyKeys[launchBusyKey])}
                  onPress={() => {
                    void handleToggleSavedLaunch();
                  }}
                />
                <DetailFollowChip
                  label={watchlistState.isProviderTracked(launch.provider) ? 'Following provider' : 'Follow provider'}
                  active={watchlistState.isProviderTracked(launch.provider)}
                  disabled={
                    watchlistState.isLoading ||
                    !String(launch.provider || '').trim() ||
                    Boolean(watchlistState.busyKeys[providerBusyKey])
                  }
                  onPress={() => {
                    void handleToggleProviderFollow();
                  }}
                />
                {padRuleValue ? (
                  <DetailFollowChip
                    label={
                      watchlistState.isPadTracked(padRuleValue)
                        ? `Following ${formatPadRuleLabel(padRuleValue)}`
                        : `Follow ${formatPadRuleLabel(padRuleValue)}`
                    }
                    active={watchlistState.isPadTracked(padRuleValue)}
                    disabled={watchlistState.isLoading || Boolean(watchlistState.busyKeys[padBusyKey])}
                    onPress={() => {
                      void handleTogglePadFollow();
                    }}
                  />
                ) : null}
              </View>
              {!canUseSavedItems ? (
                <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>
                  Following, My Launches, and the Following feed are Premium on mobile.
                </Text>
              ) : savedStatus ? (
                <Text style={{ color: savedStatus.tone === 'error' ? '#ff9087' : theme.accent, fontSize: 13, lineHeight: 19 }}>
                  {savedStatus.text}
                </Text>
              ) : watchlistState.errorMessage ? (
                <Text style={{ color: '#ff9087', fontSize: 13, lineHeight: 19 }}>{watchlistState.errorMessage}</Text>
              ) : null}
            </View>

            <LaunchAlertsPanel
              launchId={launch.id}
              installationId={installationId}
              deviceSecret={deviceSecret}
              isPremium={isPremium}
              isPushRegistered={isRegistered}
              onOpenUpgrade={() => {
                router.push('/profile');
              }}
              onOpenPreferences={() => {
                router.push('/preferences');
              }}
            />

            <AnimationErrorBoundary fallback={<FactGrid items={statTiles.map((tile) => [tile.label, tile.value] as [string, string])} />}>
              <InteractiveStatTiles tiles={statTiles} />
            </AnimationErrorBoundary>

            {arTrajectory && shouldShowArTrajectoryCard(arTrajectory, canUseArTrajectory) ? (
              <ArTrajectoryCard launchId={launch.id} arTrajectory={arTrajectory} canUseArTrajectory={canUseArTrajectory} />
            ) : null}
          </View>
        </DetailModuleSection>

        {primaryWatchLink ? (
          <DetailModuleSection
            id="live-coverage"
            title="Live coverage"
            description="Stream links and outbound coverage surfaced from the launch payload."
            onLayout={registerSectionOffset}
          >
            <View style={{ gap: 12 }}>
              <Pressable
                onPress={() => {
                  void Linking.openURL(primaryWatchLink.url);
                }}
                style={({ pressed }) => ({
                  overflow: 'hidden',
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  opacity: pressed ? 0.92 : 1
                })}
              >
                {primaryWatchLink.imageUrl ? (
                  <Image
                    source={{ uri: primaryWatchLink.imageUrl }}
                    resizeMode="cover"
                    style={{
                      height: 188,
                      width: '100%'
                    }}
                  />
                ) : (
                  <View
                    style={{
                      height: 188,
                      width: '100%',
                      backgroundColor: 'rgba(34, 211, 238, 0.08)'
                    }}
                  />
                )}
                <View
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    padding: 16,
                    backgroundColor: 'rgba(7, 9, 19, 0.72)',
                    gap: 4
                  }}
                >
                  <Text style={{ color: theme.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }}>
                    {primaryWatchLink.meta}
                  </Text>
                  <Text style={{ color: theme.foreground, fontSize: 17, fontWeight: '700', lineHeight: 22 }}>{primaryWatchLink.label}</Text>
                  <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>Open stream</Text>
                </View>
              </Pressable>

              {watchLinks.length > 1 ? (
                <View style={{ gap: 10 }}>
                  <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>
                    More watch links
                  </Text>
                  {watchLinks.slice(1).map((item) => (
                    <LinkRow
                      key={item.url}
                      title={item.label}
                      subtitle={item.meta}
                      onPress={() => {
                        void Linking.openURL(item.url);
                      }}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          </DetailModuleSection>
        ) : null}

        {socialModule?.matchedPost || socialModule?.providerFeeds?.length ? (
          <DetailModuleSection
            id="social-updates"
            title="Social & updates"
            description="Provider post matches and program feeds tied to this launch."
            onLayout={registerSectionOffset}
          >
            <View style={{ gap: 10 }}>
              {socialModule.matchedPost ? (
                <LinkRow
                  title={socialModule.matchedPost.title}
                  subtitle={[socialModule.matchedPost.subtitle, socialModule.matchedPost.description].filter(Boolean).join(' • ')}
                  onPress={() => {
                    openTarget(socialModule.matchedPost?.url || '');
                  }}
                />
              ) : null}
              {socialModule.providerFeeds.map((feed) => (
                <LinkRow
                  key={feed.id}
                  title={feed.title}
                  subtitle={[feed.subtitle, feed.description].filter(Boolean).join(' • ')}
                  onPress={() => {
                    openTarget(feed.url);
                  }}
                />
              ))}
            </View>
          </DetailModuleSection>
        ) : null}

        {(launch.rocket?.fullName || launch.vehicle || rocketPhotoUrl) ? (
          <DetailModuleSection
            id="rocket-profile"
            title="Rocket profile"
            description={launch.rocket?.fullName || launch.vehicle}
            onLayout={registerSectionOffset}
          >
            {rocketPhotoUrl ? (
              <Image
                source={{ uri: rocketPhotoUrl }}
                resizeMode="cover"
                style={{
                  height: 188,
                  width: '100%',
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: theme.stroke
                }}
              />
            ) : null}
            <FactGrid
              items={[
                ['Variant', launch.rocket?.variant || 'TBD'],
                ['Reusable', launch.rocket?.reusable == null ? 'TBD' : launch.rocket.reusable ? 'Yes' : 'No'],
                ['Length', launch.rocket?.lengthM == null ? 'TBD' : `${launch.rocket.lengthM} m`],
                ['Diameter', launch.rocket?.diameterM == null ? 'TBD' : `${launch.rocket.diameterM} m`],
                ['Maiden flight', formatTimestamp(launch.rocket?.maidenFlight)],
                ['Manufacturer', launch.rocket?.manufacturer || 'TBD']
              ]}
            />
            {launch.rocket?.description ? <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>{launch.rocket.description}</Text> : null}
          </DetailModuleSection>
        ) : null}

        <DetailModuleSection
          id="launch-info"
          title="Launch info"
          description="Provider, vehicle, pad, window, and mission facts aligned with the web detail layout."
          onLayout={registerSectionOffset}
        >
          <FactGrid
            onOpenHref={(href) => {
              openTarget(href);
            }}
            items={[
              { label: 'Provider', value: launch.provider, href: launchInfoProviderHref },
              { label: 'Vehicle', value: launch.vehicle, href: launchInfoRocketHref },
              { label: 'Rocket', value: launchInfoRocketLabel, href: launchInfoRocketHref },
              { label: 'Pad', value: launch.padName || launch.pad.name, href: launchInfoPadHref },
              { label: 'Location', value: launchInfoLocationLabel, href: launchInfoLocationHref },
              ['NET', formatTimestamp(launch.net)],
              ['Window start', formatTimestamp(launch.windowStart)],
              ['Window end', formatTimestamp(launch.windowEnd)],
              ['Orbit', launch.mission?.orbit || launch.payloads?.find((payload) => payload?.orbit)?.orbit || 'TBD'],
              ['Mission type', launch.mission?.type || 'TBD'],
              ['Booster', launch.firstStageBooster || 'TBD'],
              ['Hashtag', launch.hashtag || 'None']
            ]}
          />
          {launch.missionSummary ? (
            <SectionCard title={launch.mission?.name || 'Mission'} compact>
              <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>{launch.missionSummary}</Text>
            </SectionCard>
          ) : null}
          {externalLinks.length > 0 ? (
            <SectionCard title="Links & sources" compact>
              <View style={{ gap: 10 }}>
                {externalLinks.map((item) => (
                  <LinkRow
                    key={item.url}
                    title={item.label}
                    subtitle={item.meta}
                    onPress={() => {
                      openTarget(item.url);
                    }}
                  />
                ))}
              </View>
            </SectionCard>
          ) : null}
          {(launch.providerDescription || launch.providerType || launch.providerCountryCode) ? (
            <SectionCard title="Service provider" compact>
              <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>{launch.provider}</Text>
              {launch.providerType || launch.providerCountryCode ? (
                <Text style={{ color: theme.muted, fontSize: 12 }}>
                  {[launch.providerType, launch.providerCountryCode].filter(Boolean).join(' • ')}
                </Text>
              ) : null}
              {launch.providerDescription ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>{launch.providerDescription}</Text> : null}
            </SectionCard>
          ) : null}
          {hasPrograms ? (
            <SectionCard title="Programs" compact>
              <View style={{ gap: 8 }}>
                {launch.programs?.map((program, index) => {
                  const titleValue = buildUnknownEntityTitle(program, 'Program');
                  const subtitleValue = buildUnknownEntitySubtitle(program, ['type']);
                  const descriptionValue = buildUnknownEntityDescription(program);

                  return (
                    <View
                      key={`${titleValue}:${index}`}
                      style={{
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: theme.stroke,
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        padding: 12,
                        gap: 4
                      }}
                    >
                      <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>{titleValue}</Text>
                      {subtitleValue ? <Text style={{ color: theme.muted, fontSize: 12 }}>{subtitleValue}</Text> : null}
                      {descriptionValue ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{descriptionValue}</Text> : null}
                    </View>
                  );
                })}
              </View>
            </SectionCard>
          ) : null}
          {hasCrew ? (
            <SectionCard title="Crew" compact>
              <View style={{ gap: 8 }}>
                {launch.crew?.map((member, index) => {
                  const titleValue = buildUnknownEntityTitle(member, 'Crew');
                  const subtitleValue = buildUnknownEntitySubtitle(member, ['role', 'agency', 'nationality']);

                  return (
                    <View
                      key={`${titleValue}:${index}`}
                      style={{
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: theme.stroke,
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        padding: 12,
                        gap: 4
                      }}
                    >
                      <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>{titleValue}</Text>
                      {subtitleValue ? <Text style={{ color: theme.muted, fontSize: 12 }}>{subtitleValue}</Text> : null}
                    </View>
                  );
                })}
              </View>
            </SectionCard>
          ) : null}
        </DetailModuleSection>

        {weatherModule?.cards?.length ? (
          <DetailModuleSection
            id="forecast-outlook"
            title="Forecast outlook"
            description="Structured weather sources matched to this launch."
            onLayout={registerSectionOffset}
          >
            <View style={{ gap: 12 }}>
              {weatherModule.cards.map((card) => (
                <View
                  key={card.id}
                  style={{
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: theme.stroke,
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    padding: 14,
                    gap: 8
                  }}
                >
                  <View style={{ gap: 4 }}>
                    <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{card.title}</Text>
                    {card.subtitle ? <Text style={{ color: theme.muted, fontSize: 13 }}>{card.subtitle}</Text> : null}
                  </View>
                  {card.headline ? <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>{card.headline}</Text> : null}
                  {(card.issuedAt || card.validStart || card.validEnd) ? (
                    <Text style={{ color: theme.muted, fontSize: 12 }}>
                      {[card.issuedAt ? `Issued ${formatTimestamp(card.issuedAt)}` : null, card.validStart ? `Valid ${formatTimestamp(card.validStart)}` : null, card.validEnd ? `to ${formatTimestamp(card.validEnd)}` : null]
                        .filter(Boolean)
                        .join(' • ')}
                    </Text>
                  ) : null}
                  {card.badges.length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {card.badges.map((badge) => (
                        <DetailChip key={`${card.id}:${badge}`} label={badge} />
                      ))}
                    </View>
                  ) : null}
                  {card.metrics.length ? (
                    <FactGrid items={card.metrics.map((metric) => [metric.label, metric.value] as [string, string])} />
                  ) : null}
                  {card.detail ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>{card.detail}</Text> : null}
                  {card.actionUrl && card.actionLabel ? (
                    <ActionButton
                      label={card.actionLabel}
                      onPress={() => {
                        openTarget(card.actionUrl || '');
                      }}
                      variant="secondary"
                    />
                  ) : null}
                </View>
              ))}
            </View>
          </DetailModuleSection>
        ) : null}

        {detail.enrichment.faaAdvisories.length > 0 ? (
          <DetailModuleSection
            id="launch-advisories"
            title="Launch advisories"
            description={`Temporary flight restrictions and NOTAM matches tied to this launch. ${detail.enrichment.faaAdvisories.length} match${detail.enrichment.faaAdvisories.length === 1 ? '' : 'es'} found.`}
            onLayout={registerSectionOffset}
          >
            <View style={{ gap: 12 }}>
              {detail.enrichment.faaAdvisories.map((advisory) => (
                <View
                  key={advisory.matchId}
                  style={{
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: theme.stroke,
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    padding: 14,
                    gap: 6
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <View style={{ flex: 1, gap: 6 }}>
                      <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{advisory.title}</Text>
                      <Text style={{ color: theme.muted, fontSize: 13 }}>
                        {[advisory.state, advisory.facility, advisory.type].filter(Boolean).join(' • ')}
                      </Text>
                    </View>
                    <DetailChip label={advisory.isActiveNow ? 'Active now' : advisory.status} tone={advisory.isActiveNow ? 'accent' : 'default'} />
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <DetailChip label={advisory.matchStatus} />
                    <DetailChip label={`confidence ${advisory.matchConfidence != null ? `${Math.round(advisory.matchConfidence)}%` : 'n/a'}`} />
                    {advisory.notamId ? <DetailChip label={advisory.notamId} /> : null}
                  </View>
                  <Text style={{ color: theme.muted, fontSize: 13 }}>
                    {formatTimestamp(advisory.validStart)} to {formatTimestamp(advisory.validEnd)}
                  </Text>
                  <Text style={{ color: theme.muted, fontSize: 13 }}>
                    {advisory.shapeCount} shape{advisory.shapeCount === 1 ? '' : 's'}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    {advisory.sourceGraphicUrl || advisory.sourceUrl ? (
                      <Pressable
                        onPress={() => {
                          void Linking.openURL(advisory.sourceGraphicUrl || advisory.sourceUrl || '');
                        }}
                      >
                        <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>
                          {advisory.sourceGraphicUrl ? 'Open FAA graphic page' : 'View FAA source'}
                        </Text>
                      </Pressable>
                    ) : null}
                    {advisory.sourceRawUrl && advisory.sourceRawUrl !== advisory.sourceGraphicUrl && advisory.sourceRawUrl !== advisory.sourceUrl ? (
                      <Pressable
                        onPress={() => {
                          void Linking.openURL(advisory.sourceRawUrl || '');
                        }}
                      >
                        <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '700' }}>View raw NOTAM text</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
            <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 19 }}>
              Advisory data is informational. Confirm operational constraints with official FAA publications.
            </Text>
          </DetailModuleSection>
        ) : null}

        {(detail.enrichment.firstStages.length > 0 || detail.enrichment.recovery.length > 0) ? (
          <DetailModuleSection
            id="stages-recovery"
            title="Stages & recovery"
            description="Launch-stage and landing context surfaced from LL2 when it exists."
            onLayout={registerSectionOffset}
          >
            {detail.enrichment.firstStages.length > 0 ? (
              <View style={{ gap: 10 }}>
                {detail.enrichment.firstStages.map((stage) => (
                  <View
                    key={stage.id}
                    style={{
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: theme.stroke,
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      padding: 14,
                      gap: 6
                    }}
                    >
                      <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{stage.title}</Text>
                      <Text style={{ color: theme.muted, fontSize: 13 }}>
                        {[stage.serialNumber, stage.status, stage.source.toUpperCase()].filter(Boolean).join(' • ')}
                      </Text>
                      <Text style={{ color: theme.muted, fontSize: 13 }}>
                        {[stage.totalMissions != null ? `Tracked flights: ${stage.totalMissions}` : null, stage.lastMissionNet ? `Last mission: ${formatTimestamp(stage.lastMissionNet)}` : null]
                          .filter(Boolean)
                          .join(' • ')}
                      </Text>
                      {stage.description ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>{stage.description}</Text> : null}
                    </View>
                  ))}
              </View>
            ) : null}
            {detail.enrichment.recovery.length > 0 ? (
              <View style={{ gap: 10, marginTop: detail.enrichment.firstStages.length > 0 ? 12 : 0 }}>
                {detail.enrichment.recovery.map((entry) => (
                  <View
                    key={entry.id}
                    style={{
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: theme.stroke,
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      padding: 14,
                      gap: 6
                    }}
                    >
                      <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{entry.title || 'Recovery detail'}</Text>
                      <Text style={{ color: theme.muted, fontSize: 13 }}>
                        {[entry.role.toUpperCase(), entry.landingLocationName, entry.landingTypeName].filter(Boolean).join(' • ')}
                      </Text>
                      <Text style={{ color: theme.muted, fontSize: 13 }}>
                        {[entry.downrangeDistanceKm != null ? `${Math.round(entry.downrangeDistanceKm)} km downrange` : null, entry.returnSite].filter(Boolean).join(' • ')}
                      </Text>
                      {entry.description ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>{entry.description}</Text> : null}
                      {entry.returnDateTime ? <Text style={{ color: theme.muted, fontSize: 13 }}>Return: {formatTimestamp(entry.returnDateTime)}</Text> : null}
                    </View>
                ))}
              </View>
            ) : null}
          </DetailModuleSection>
        ) : null}

        {(resourcesModule?.missionResources?.length || resourcesModule?.missionTimeline?.length || launch.launchVidUrls?.length || launch.launchInfoUrls?.length || detail.enrichment.externalContent.length) ? (
          <DetailModuleSection
            id="official-media"
            title="Official media & timelines"
            description="Matched mission resources, SpaceX media assets, and mission timelines for this launch."
            onLayout={registerSectionOffset}
          >
            <View style={{ gap: 10 }}>
              {resourcesModule?.missionResources?.filter((resource) => !isSpaceXWebsiteUrl(resource.url))?.map((resource) => (
                <LinkRow
                  key={`resource:${resource.id}`}
                  title={resource.title}
                  subtitle={resource.subtitle || 'Mission resource'}
                  onPress={() => {
                    openTarget(resource.url);
                  }}
                />
              ))}
              {launch.launchVidUrls?.map((item) => (
                <LinkRow key={`video:${item.url}`} title={item.title || item.url} subtitle={item.publisher || 'Watch link'} onPress={() => void Linking.openURL(item.url)} />
              ))}
              {launch.launchInfoUrls?.filter((item) => !isSpaceXWebsiteUrl(item.url))?.map((item) => (
                <LinkRow key={`info:${item.url}`} title={item.title || item.url} subtitle={item.source || 'Launch resource'} onPress={() => void Linking.openURL(item.url)} />
              ))}
              {detail.enrichment.externalContent.map((item) => (
                <View key={item.id} style={{ gap: 8 }}>
                  <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{item.title || item.contentType}</Text>
                  {item.resources.map((resource) => (
                    <ExternalContentResourceCard key={resource.id} resource={resource} />
                  ))}
                </View>
              ))}
              {resourcesModule?.missionTimeline?.length ? (
                <SectionCard title="Mission timeline" compact>
                  {resourcesModule.missionTimeline.map((event) => (
                    <Text key={event.id} style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
                      {[event.time, event.label, event.description].filter(Boolean).join(' • ')}
                    </Text>
                  ))}
                </SectionCard>
              ) : launch.timeline?.length ? (
                <SectionCard title="Mission timeline" compact>
                  {launch.timeline.map((event, index) => (
                    <Text key={`${event.relative_time || 'timeline'}:${index}`} style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
                      {[event.relative_time, typeof event.type === 'object' ? String((event.type as { name?: string }).name || '') : String(event.type || '')]
                        .filter(Boolean)
                        .join(' • ')}
                    </Text>
                  ))}
                </SectionCard>
              ) : null}
            </View>
          </DetailModuleSection>
        ) : null}

        {(launch.payloads?.length || launch.mission?.agencies?.length || launchUpdates.length) ? (
          <DetailModuleSection
            id="payload-updates"
            title="Payloads, agencies, and updates"
            description="Mission-side context carried through the shared launch payload."
            onLayout={registerSectionOffset}
          >
            {launch.payloads?.length ? (
              <SectionCard title="Payloads" compact>
                {launch.payloads.map((payload, index) => (
                  <Text key={`${payload.name || 'payload'}:${index}`} style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
                    {[payload.name, payload.type, payload.orbit, payload.agency].filter(Boolean).join(' • ')}
                  </Text>
                ))}
              </SectionCard>
            ) : null}
            {launch.mission?.agencies?.length ? (
              <SectionCard title="Mission agencies" compact>
                {launch.mission.agencies.map((agency, index) => (
                  <Text key={`${agency.name || 'agency'}:${index}`} style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
                    {[agency.name, agency.type, agency.country_code].filter(Boolean).join(' • ')}
                  </Text>
                ))}
              </SectionCard>
            ) : null}
            {launchUpdates.length ? (
              <SectionCard title="Recent updates" compact>
                {launchUpdates.map((update, index) => (
                  <Text key={`${update.id || 'update'}:${index}`} style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
                    {[update.detectedAt ? formatTimestamp(update.detectedAt) : null, update.title].filter(Boolean).join(' • ')}
                  </Text>
                ))}
              </SectionCard>
            ) : null}
          </DetailModuleSection>
        ) : null}

        {(payloadManifest.length > 0 || objectInventory?.payloadObjects?.length || objectInventory?.nonPayloadObjects?.length || objectInventory?.summaryBadges?.length) ? (
          <DetailModuleSection
            id="payload-inventory"
            title="Payload manifest & inventory"
            description="Manifested payloads and tracked launch objects linked to this mission."
            onLayout={registerSectionOffset}
          >
            {payloadManifest.length ? (
              <SectionCard title="Manifest" compact>
                <View style={{ gap: 10 }}>
                  {payloadManifest.map((item) => (
                    <View
                      key={item.id}
                      style={{
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: theme.stroke,
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        padding: 14,
                        gap: 6
                      }}
                    >
                      <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{item.title}</Text>
                      {item.subtitle ? <Text style={{ color: theme.muted, fontSize: 13 }}>{item.subtitle}</Text> : null}
                      {item.description ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>{item.description}</Text> : null}
                      <Text style={{ color: theme.muted, fontSize: 13 }}>
                        {[item.destination, item.deploymentStatus, item.operator || item.manufacturer].filter(Boolean).join(' • ')}
                      </Text>
                      {item.landingSummary ? <Text style={{ color: theme.muted, fontSize: 13 }}>{item.landingSummary}</Text> : null}
                      {item.dockingSummary ? <Text style={{ color: theme.muted, fontSize: 13 }}>{item.dockingSummary}</Text> : null}
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                        {item.infoUrl ? (
                          <Pressable
                      onPress={() => {
                        openTarget(item.infoUrl || '');
                      }}
                          >
                            <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>Mission info</Text>
                          </Pressable>
                        ) : null}
                        {item.wikiUrl ? (
                          <Pressable
                      onPress={() => {
                        openTarget(item.wikiUrl || '');
                      }}
                          >
                            <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '700' }}>Reference</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
              </SectionCard>
            ) : null}
            {objectInventory?.summaryBadges?.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {objectInventory.summaryBadges.map((badge) => (
                  <DetailChip key={badge} label={badge} />
                ))}
              </View>
            ) : null}
            {objectInventory?.payloadObjects?.length ? (
              <SectionCard title="Tracked payload objects" compact>
                <View style={{ gap: 8 }}>
                  {objectInventory.payloadObjects.map((item) => (
                    <View
                      key={item.id}
                      style={{
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: theme.stroke,
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        padding: 12,
                        gap: 4
                      }}
                    >
                      <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>{item.title}</Text>
                      {item.subtitle ? <Text style={{ color: theme.muted, fontSize: 12 }}>{item.subtitle}</Text> : null}
                      {item.lines.map((line) => (
                        <Text key={`${item.id}:${line}`} style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
                          {line}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              </SectionCard>
            ) : null}
            {objectInventory?.nonPayloadObjects?.length ? (
              <SectionCard title="Other tracked objects" compact>
                <View style={{ gap: 8 }}>
                  {objectInventory.nonPayloadObjects.map((item) => (
                    <View
                      key={item.id}
                      style={{
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: theme.stroke,
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        padding: 12,
                        gap: 4
                      }}
                    >
                      <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>{item.title}</Text>
                      {item.subtitle ? <Text style={{ color: theme.muted, fontSize: 12 }}>{item.subtitle}</Text> : null}
                      {item.lines.map((line) => (
                        <Text key={`${item.id}:${line}`} style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
                          {line}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              </SectionCard>
            ) : null}
          </DetailModuleSection>
        ) : null}

        {relatedEvents.length > 0 ? (
          <DetailModuleSection
            id="related-events"
            title="Related events"
            description="Mission-adjacent events linked to this launch."
            onLayout={registerSectionOffset}
          >
            <View style={{ gap: 10 }}>
              {relatedEvents.map((item) => (
                <Pressable
                  key={`event:${item.id}`}
                  onPress={() => {
                    if (item.url) openTarget(item.url);
                  }}
                  disabled={!item.url}
                  style={({ pressed }) => ({
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: theme.stroke,
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    padding: 14,
                    gap: 6,
                    opacity: item.url && pressed ? 0.88 : 1
                  })}
                >
                  <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{item.name}</Text>
                  <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
                    {[item.typeName, item.locationName, item.date ? formatTimestamp(item.date) : null].filter(Boolean).join(' • ')}
                  </Text>
                  {item.description ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>{item.description}</Text> : null}
                </Pressable>
              ))}
            </View>
          </DetailModuleSection>
        ) : null}

        {relatedNews.length > 0 ? (
          <DetailModuleSection
            id="launch-news"
            title="Launch news"
            description="Related news coverage surfaced from linked launch joins."
            onLayout={registerSectionOffset}
          >
            <View style={{ gap: 10 }}>
              {relatedNews.map((item) => (
                <Pressable
                  key={`news:${item.id}`}
                  onPress={() => {
                    openTarget(item.url);
                  }}
                  style={({ pressed }) => ({
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: theme.stroke,
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    padding: 14,
                    gap: 6,
                    opacity: pressed ? 0.88 : 1
                  })}
                >
                  <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{item.title}</Text>
                  <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
                    {[item.newsSite, item.publishedAt ? formatTimestamp(item.publishedAt) : null, item.itemType].filter(Boolean).join(' • ')}
                  </Text>
                  {item.summary ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>{item.summary}</Text> : null}
                </Pressable>
              ))}
            </View>
          </DetailModuleSection>
        ) : null}

        {blueOriginModule && (
          blueOriginModule.resourceLinks.length ||
          blueOriginModule.travelerProfiles.length ||
          blueOriginModule.missionGraphics.length ||
          blueOriginModule.facts.length ||
          blueOriginModule.payloadNotes.length
        ) ? (
          <DetailModuleSection
            id="blue-origin"
            title="Blue Origin mission details"
            description="Provider-specific traveler, media, and mission context for Blue Origin launches."
            onLayout={registerSectionOffset}
          >
            {blueOriginModule.resourceLinks.length ? (
              <SectionCard title="Resources" compact>
                <View style={{ gap: 10 }}>
                  {blueOriginModule.resourceLinks.map((item) => (
                    <LinkRow
                      key={`blue-origin-link:${item.url}`}
                      title={item.label}
                      subtitle={item.meta || item.host || 'Blue Origin resource'}
                      onPress={() => {
                        openTarget(item.url);
                      }}
                    />
                  ))}
                </View>
              </SectionCard>
            ) : null}
            {blueOriginModule.travelerProfiles.length ? (
              <SectionCard title="Traveler profiles" compact>
                <View style={{ gap: 10 }}>
                  {blueOriginModule.travelerProfiles.map((traveler) => (
                    <View
                      key={`blue-origin-traveler:${traveler.travelerSlug}`}
                      style={{
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: theme.stroke,
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        padding: 14,
                        gap: 8
                      }}
                    >
                      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                        {traveler.imageUrl ? (
                          <Image
                            source={{ uri: traveler.imageUrl }}
                            resizeMode="cover"
                            style={{
                              width: 72,
                              height: 72,
                              borderRadius: 14,
                              backgroundColor: 'rgba(255,255,255,0.04)'
                            }}
                          />
                        ) : null}
                        <View style={{ flex: 1, gap: 4 }}>
                          <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{traveler.name}</Text>
                          <Text style={{ color: theme.muted, fontSize: 12 }}>
                            {[traveler.role, traveler.nationality].filter(Boolean).join(' • ') || 'Crew'}
                          </Text>
                          {traveler.bio ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>{traveler.bio}</Text> : null}
                        </View>
                      </View>
                      {traveler.profileUrl ? (
                        <Pressable
                          onPress={() => {
                            openTarget(traveler.profileUrl || '');
                          }}
                        >
                          <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>Open profile</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                </View>
              </SectionCard>
            ) : null}
            {blueOriginModule.missionGraphics.length ? (
              <SectionCard title="Mission graphics" compact>
                <View style={{ gap: 10 }}>
                  {blueOriginModule.missionGraphics.map((graphic) => (
                    <Pressable
                      key={`blue-origin-graphic:${graphic.url}`}
                      onPress={() => {
                        openTarget(graphic.url);
                      }}
                      style={{
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: theme.stroke,
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        padding: 14,
                        gap: 8
                      }}
                    >
                      {graphic.imageUrl ? (
                        <Image
                          source={{ uri: graphic.imageUrl }}
                          resizeMode="cover"
                          style={{
                            width: '100%',
                            height: 180,
                            borderRadius: 14,
                            backgroundColor: 'rgba(255,255,255,0.04)'
                          }}
                        />
                      ) : null}
                      <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{graphic.label}</Text>
                      {graphic.meta ? <Text style={{ color: theme.muted, fontSize: 12 }}>{graphic.meta}</Text> : null}
                    </Pressable>
                  ))}
                </View>
              </SectionCard>
            ) : null}
            {blueOriginModule.facts.length ? (
              <SectionCard title="Mission facts" compact>
                <FactGrid items={blueOriginModule.facts.map((fact) => [fact.label, fact.value] as [string, string])} />
              </SectionCard>
            ) : null}
            {blueOriginModule.payloadNotes.length ? (
              <SectionCard title="Payload notes" compact>
                <View style={{ gap: 10 }}>
                  {blueOriginModule.payloadNotes.map((note) => (
                    <View
                      key={`blue-origin-payload-note:${note.name}`}
                      style={{
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: theme.stroke,
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        padding: 14,
                        gap: 8
                      }}
                    >
                      <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{note.name}</Text>
                      <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>{note.description}</Text>
                      {note.sourceUrl ? (
                        <Pressable
                          onPress={() => {
                            openTarget(note.sourceUrl || '');
                          }}
                        >
                          <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>View source</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                </View>
              </SectionCard>
            ) : null}
          </DetailModuleSection>
        ) : null}

        {missionStats?.cards?.length || missionStats?.boosterCards?.length || missionStats?.bonusInsights?.length ? (
          <DetailModuleSection
            id="mission-stats"
            title="Mission stats"
            description="Provider, rocket, pad, and booster history tied to this launch."
            onLayout={registerSectionOffset}
          >
            {missionStats?.cards?.length ? (
              <View style={{ gap: 10 }}>
                {missionStats.cards.map((card) => (
                  <View
                    key={card.id}
                    style={{
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: theme.stroke,
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      padding: 14,
                      gap: 6
                    }}
                  >
                    <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{card.eyebrow}</Text>
                    <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700' }}>{card.title}</Text>
                    <Text style={{ color: theme.muted, fontSize: 13 }}>
                      {`${card.allTimeLabel}: ${card.allTime == null ? 'TBD' : String(card.allTime)} • ${card.yearLabel}: ${card.year == null ? 'TBD' : String(card.year)}`}
                    </Text>
                    <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>{card.story}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {missionStats?.bonusInsights?.length ? (
              <SectionCard title="Bonus insights" compact>
                <View style={{ gap: 8 }}>
                  {missionStats.bonusInsights.map((insight) => (
                    <View
                      key={insight.label}
                      style={{
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: theme.stroke,
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        padding: 12,
                        gap: 4
                      }}
                    >
                      <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{insight.label}</Text>
                      <Text style={{ color: theme.foreground, fontSize: 18, fontWeight: '700' }}>{insight.value}</Text>
                      {insight.detail ? <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>{insight.detail}</Text> : null}
                    </View>
                  ))}
                </View>
              </SectionCard>
            ) : null}
            {missionStats?.boosterCards?.length ? (
              <SectionCard title="Booster story" compact>
                <View style={{ gap: 10 }}>
                  {missionStats.boosterCards.map((card) => (
                    <View
                      key={card.id}
                      style={{
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: theme.stroke,
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        padding: 14,
                        gap: 6
                      }}
                    >
                      <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{card.title}</Text>
                      {card.subtitle ? <Text style={{ color: theme.muted, fontSize: 13 }}>{card.subtitle}</Text> : null}
                      <Text style={{ color: theme.muted, fontSize: 13 }}>
                        {`${card.allTimeLabel}: ${card.allTime == null ? 'TBD' : String(card.allTime)} • ${card.yearLabel}: ${card.year == null ? 'TBD' : String(card.year)}`}
                      </Text>
                      {card.detailLines.map((line) => (
                        <Text key={`${card.id}:${line}`} style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
                          {line}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              </SectionCard>
            ) : null}
          </DetailModuleSection>
        ) : null}

        {relatedEvents.length === 0 && relatedNews.length === 0 && detail.related.length > 0 ? (
          <DetailModuleSection
            id="related-coverage"
            title="Related coverage"
            description={`${detail.related.length} linked result${detail.related.length === 1 ? '' : 's'} surfaced for this launch.`}
            onLayout={registerSectionOffset}
          >
            <View style={{ gap: 10 }}>
              {detail.related.map((item) => (
                <Pressable
                  key={`${item.type}:${item.id}`}
                  onPress={() => {
                    openTarget(item.href);
                  }}
                  style={{
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: theme.stroke,
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    padding: 14,
                    gap: 6
                  }}
                >
                  <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{item.title}</Text>
                  <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>{item.subtitle ?? formatSearchResultLabel(item.type)}</Text>
                </Pressable>
              ))}
            </View>
          </DetailModuleSection>
        ) : null}
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false
        }}
      />
      <AppScreen
        testID="launch-detail-screen"
        animatedScroll={!shouldReduceMotion}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        scrollRef={scrollRef}
        refreshControl={
          <RefreshControl
            refreshing={detailRefreshing}
            onRefresh={() => {
              void refreshDetail(null);
            }}
            tintColor={theme.accent}
          />
        }
      >
        {content}
      </AppScreen>
      {overlayNavigation}
      <LaunchCalendarSheet launch={calendarLaunch} open={calendarLaunch != null} onClose={() => setCalendarLaunch(null)} />
    </>
  );
}

function ActionButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}) {
  const { theme } = useMobileBootstrap();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: variant === 'primary' ? 'rgba(34, 211, 238, 0.2)' : theme.stroke,
        backgroundColor: variant === 'primary' ? 'rgba(34, 211, 238, 0.1)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 16,
        paddingVertical: 12,
        opacity: disabled ? 0.45 : pressed ? 0.86 : 1
      })}
    >
      <Text style={{ color: variant === 'primary' ? theme.accent : theme.foreground, fontSize: 14, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function DetailFollowChip({
  label,
  active,
  disabled = false,
  onPress
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? theme.accent : theme.stroke,
        backgroundColor: active ? 'rgba(34, 211, 238, 0.12)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 12,
        paddingVertical: 8,
        opacity: disabled ? 0.45 : pressed ? 0.86 : 1
      })}
    >
      <Text style={{ color: active ? theme.accent : theme.foreground, fontSize: 11, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function DetailChip({ label, tone = 'default' }: { label: string; tone?: 'default' | 'accent' | 'success' }) {
  const { theme } = useMobileBootstrap();
  const colors =
    tone === 'accent'
      ? { borderColor: 'rgba(34, 211, 238, 0.2)', backgroundColor: 'rgba(34, 211, 238, 0.1)', textColor: theme.accent }
      : tone === 'success'
        ? { borderColor: 'rgba(52, 211, 153, 0.2)', backgroundColor: 'rgba(52, 211, 153, 0.1)', textColor: '#7ff0bc' }
        : { borderColor: theme.stroke, backgroundColor: 'rgba(255, 255, 255, 0.03)', textColor: theme.muted };

  return (
    <View
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.borderColor,
        backgroundColor: colors.backgroundColor,
        paddingHorizontal: 10,
        paddingVertical: 6
      }}
    >
      <Text style={{ color: colors.textColor, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

function DetailModuleSection({
  id,
  title,
  description,
  children,
  onLayout,
  defaultExpanded = true
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
  onLayout?: (sectionId: string, event: LayoutChangeEvent) => void;
  defaultExpanded?: boolean;
}) {
  return (
    <View
      onLayout={(event) => {
        onLayout?.(id, event);
      }}
    >
      <CollapsibleSection id={id} title={title} description={description} defaultExpanded={defaultExpanded}>
        {children}
      </CollapsibleSection>
    </View>
  );
}

type FactGridItem = [string, string] | { label: string; value: string; href?: string | null };

function normalizeFactGridItem(item: FactGridItem) {
  if (Array.isArray(item)) {
    return { label: item[0], value: item[1], href: null };
  }
  return {
    label: item.label,
    value: item.value,
    href: item.href || null
  };
}

function FactGrid({
  items,
  onOpenHref
}: {
  items: FactGridItem[];
  onOpenHref?: (href: string) => void;
}) {
  const { theme } = useMobileBootstrap();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {items.map((rawItem) => {
        const item = normalizeFactGridItem(rawItem);
        const isInteractive = Boolean(item.href && onOpenHref);
        const key = `${item.label}:${item.value}`;
        const cardStyle = {
          width: '47%' as const,
          minWidth: 140,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme.stroke,
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          padding: 12,
          gap: 4
        };

        if (isInteractive && item.href) {
          return (
            <Pressable
              key={key}
              onPress={() => {
                onOpenHref?.(item.href as string);
              }}
              style={({ pressed }) => ({
                ...cardStyle,
                backgroundColor: pressed ? 'rgba(255, 255, 255, 0.08)' : cardStyle.backgroundColor
              })}
            >
              <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{item.label}</Text>
              <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700', lineHeight: 20 }}>{item.value}</Text>
              <Text style={{ color: theme.accent, fontSize: 11, fontWeight: '700' }}>Open</Text>
            </Pressable>
          );
        }

        return (
          <View key={key} style={cardStyle}>
            <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{item.label}</Text>
            <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700', lineHeight: 20 }}>{item.value}</Text>
          </View>
        );
      })}
    </View>
  );
}

function LegacyLaunchDetail({
  legacyLaunch,
  launchId,
  arTrajectory,
  canUseArTrajectory
}: {
  legacyLaunch: LegacyLaunchSummary;
  launchId: string;
  arTrajectory: ArTrajectorySummaryV1 | null;
  canUseArTrajectory: boolean;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <>
      <View
        style={{
          overflow: 'hidden',
          borderRadius: 24,
          borderWidth: 1,
          borderColor: 'rgba(234, 240, 255, 0.12)',
          backgroundColor: 'rgba(11, 16, 35, 0.84)',
          padding: 20,
          gap: 14
        }}
      >
        {legacyLaunch.imageUrl ? (
          <Image
            source={{ uri: legacyLaunch.imageUrl }}
            resizeMode="cover"
            style={{
              position: 'absolute',
              right: -40,
              top: -24,
              bottom: -24,
              width: '72%',
              opacity: 0.2
            }}
          />
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <DetailChip label={(legacyLaunch.status || 'Status pending').toUpperCase()} tone="accent" />
          {legacyLaunch.provider ? <DetailChip label={legacyLaunch.provider.toUpperCase()} /> : null}
        </View>
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.foreground, fontSize: 30, fontWeight: '800', lineHeight: 35 }}>{legacyLaunch.name}</Text>
          {legacyLaunch.mission ? <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>{legacyLaunch.mission}</Text> : null}
        </View>
        <FactGrid
          items={[
            ['Provider', legacyLaunch.provider || 'TBD'],
            ['NET', formatTimestamp(legacyLaunch.net)],
            ['Pad', legacyLaunch.padName || 'TBD'],
            ['Location', legacyLaunch.padLocation || 'TBD'],
            ['Window start', formatTimestamp(legacyLaunch.windowStart)],
            ['Window end', formatTimestamp(legacyLaunch.windowEnd)],
            ['Rocket', legacyLaunch.rocketName || 'TBD'],
            ['Status detail', legacyLaunch.launchStatusDescription || legacyLaunch.status || 'TBD']
          ]}
        />
        {legacyLaunch.weatherSummary ? (
          <View
            style={{
              borderRadius: 16,
              borderWidth: 1,
              borderColor: theme.stroke,
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              padding: 14
            }}
          >
            <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>Weather</Text>
            <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21, marginTop: 6 }}>{legacyLaunch.weatherSummary}</Text>
          </View>
        ) : null}
      </View>

      {arTrajectory && shouldShowArTrajectoryCard(arTrajectory, canUseArTrajectory) ? (
        <ArTrajectoryCard launchId={launchId} arTrajectory={arTrajectory} canUseArTrajectory={canUseArTrajectory} />
      ) : null}

      <SectionCard
        title="Parity fallback"
        description="This route only returned the legacy thin detail payload. The richer web-parity detail sections need the additive launchData payload."
      >
        <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
          The shared API change is additive, so older cached responses can still render while the richer mobile detail payload rolls through.
        </Text>
      </SectionCard>
    </>
  );
}

function ArTrajectoryCard({
  launchId,
  arTrajectory,
  canUseArTrajectory
}: {
  launchId: string;
  arTrajectory: ArTrajectorySummaryV1;
  canUseArTrajectory: boolean;
}) {
  const router = useRouter();
  const { theme } = useMobileBootstrap();
  const isIos = Platform.OS === 'ios';
  const isAndroid = Platform.OS === 'android';
  const isUnavailable = arTrajectory.availabilityReason === 'not_eligible';
  const isPending = arTrajectory.availabilityReason === 'trajectory_missing' || !arTrajectory.hasTrajectory;
  const qualityLabel = formatArQualityLabel(arTrajectory.qualityState);
  const confidenceLabel = formatArConfidenceLabel(arTrajectory.confidenceBadge);
  const generatedAtLabel = arTrajectory.generatedAt ? formatTimestamp(arTrajectory.generatedAt) : null;

  let actionLabel = 'Open AR trajectory';
  let actionVariant: 'primary' | 'secondary' = 'primary';
  let disabled = false;
  let onPress = () => {
    if (isIos || isAndroid) {
      router.push((`/launches/ar/${launchId}`) as Href);
    }
  };

  if (!isIos && !isAndroid) {
    actionLabel = 'AR unavailable';
    actionVariant = 'secondary';
    disabled = true;
    onPress = () => undefined;
  } else if (!canUseArTrajectory) {
    actionLabel = 'Upgrade for AR';
    actionVariant = 'secondary';
    onPress = () => {
      router.push('/profile');
    };
  } else if (isUnavailable) {
    actionLabel = 'AR unavailable';
    actionVariant = 'secondary';
    disabled = true;
    onPress = () => undefined;
  } else if (isPending) {
    actionLabel = 'Trajectory pending';
    actionVariant = 'secondary';
    disabled = true;
    onPress = () => undefined;
  }

  return (
    <SectionCard
      title="AR trajectory"
      description={buildArTrajectoryDescription(arTrajectory, canUseArTrajectory, isIos, isAndroid)}
      body={generatedAtLabel ? `Latest trajectory package generated ${generatedAtLabel}.` : undefined}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <DetailChip label="Premium" tone={canUseArTrajectory ? 'accent' : 'default'} />
        <DetailChip label={isIos ? 'iPhone native' : isAndroid ? 'Android native' : 'AR unavailable'} />
        {qualityLabel ? <DetailChip label={qualityLabel} tone={arTrajectory.qualityState === 'precision' ? 'success' : 'default'} /> : null}
        {confidenceLabel ? <DetailChip label={confidenceLabel} /> : null}
        {arTrajectory.publishPolicy?.enforcePadOnly ? <DetailChip label="Guide only" /> : null}
      </View>
      <View
        style={{
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme.stroke,
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          padding: 14,
          gap: 8
        }}
      >
        <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>
          {isIos ? 'Native iPhone AR runtime' : isAndroid ? 'Native Android AR runtime' : 'AR runtime'}
        </Text>
        <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
          {isIos
            ? 'Uses ARKit world tracking, premium trajectory calibration, and session-quality safeguards instead of the Safari camera stack.'
            : isAndroid
              ? 'Uses Android native camera controls for smooth pinch zoom and falls back to web AR only when native capabilities are unavailable.'
              : 'AR trajectory is available on supported iPhone and Android devices.'}
        </Text>
      </View>
      <ActionButton label={actionLabel} onPress={onPress} variant={actionVariant} disabled={disabled} />
    </SectionCard>
  );
}

function LinkRow({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
  const { theme } = useMobileBootstrap();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: pressed ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
        padding: 14
      })}
    >
      <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{title}</Text>
      <Text style={{ color: theme.muted, fontSize: 13, marginTop: 6 }}>{subtitle}</Text>
    </Pressable>
  );
}

function ExternalContentResourceCard({ resource }: { resource: LaunchExternalContentResource }) {
  const { theme } = useMobileBootstrap();
  const previewUrl = normalizeExternalContentPreviewUrl(resource);
  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        overflow: 'hidden'
      }}
    >
      {previewUrl ? (
        <Image
          source={{ uri: previewUrl }}
          resizeMode="cover"
          style={{
            width: '100%',
            height: 180,
            backgroundColor: 'rgba(255,255,255,0.04)'
          }}
        />
      ) : null}
      <View style={{ padding: 14, gap: 6 }}>
        <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{resource.label}</Text>
        <Text style={{ color: theme.muted, fontSize: 13 }}>
          {[formatExternalContentKindLabel(resource.kind), formatUrlHost(resource.url)].filter(Boolean).join(' • ') || 'SpaceX content'}
        </Text>
      </View>
    </View>
  );
}

function shouldShowArTrajectoryCard(arTrajectory: ArTrajectorySummaryV1, canUseArTrajectory: boolean) {
  return canUseArTrajectory || arTrajectory.availabilityReason !== 'not_eligible';
}

function buildArTrajectoryDescription(arTrajectory: ArTrajectorySummaryV1, canUseArTrajectory: boolean, isIos: boolean, isAndroid: boolean) {
  if (!isIos && !isAndroid) {
    return 'AR trajectory is available on supported iPhone and Android devices.';
  }

  if (!canUseArTrajectory) {
    return arTrajectory.hasTrajectory
      ? 'Premium unlocks the AR trajectory experience for this launch.'
      : 'Premium unlocks AR trajectory when an eligible launch package is ready.';
  }

  if (arTrajectory.availabilityReason === 'not_eligible') {
    return 'This launch is outside the current AR-eligible program window, so AR trajectory stays locked out.';
  }

  if (arTrajectory.availabilityReason === 'trajectory_missing') {
    return 'This launch is AR-eligible, but the premium trajectory package has not been published yet.';
  }

  if (isAndroid) {
    return 'Android opens native AR trajectory first, with automatic fallback to web AR if native capabilities are unavailable.';
  }

  if (arTrajectory.qualityState === 'precision') {
    return 'Precision-grade native AR is ready with full trajectory guidance and milestone overlays.';
  }

  if (arTrajectory.qualityState === 'safe_corridor') {
    return 'Safe-corridor native AR is ready with guided trajectory bounds and milestone overlays.';
  }

  return 'Guide-only native AR is ready. Precision lock-on stays disabled until directional confidence improves.';
}

function formatArQualityLabel(qualityState: ArTrajectorySummaryV1['qualityState']) {
  if (qualityState === 'precision') return 'Precision';
  if (qualityState === 'safe_corridor') return 'Safe corridor';
  if (qualityState === 'pad_only') return 'Pad guide';
  return null;
}

function formatArConfidenceLabel(confidenceBadge: ArTrajectorySummaryV1['confidenceBadge']) {
  if (!confidenceBadge) return null;
  return `Confidence ${confidenceBadge}`;
}

function buildWatchLinks(launch: RichLaunchSummary): WatchLinkView[] {
  const items: WatchLinkView[] = [];
  const seen = new Set<string>();
  const fallbackImage = normalizeUrlString(launch.image.full) || normalizeUrlString(launch.image.thumbnail) || null;

  const addItem = (url: string | null | undefined, label: string | null | undefined, meta: string | null | undefined, imageUrl?: string | null) => {
    const normalizedUrl = normalizeUrlString(url);
    if (!normalizedUrl || seen.has(normalizedUrl)) {
      return;
    }

    seen.add(normalizedUrl);
    items.push({
      url: normalizedUrl,
      label: normalizeTextValue(label) || 'Watch coverage',
      meta: normalizeTextValue(meta) || formatUrlHost(normalizedUrl) || 'Live/Replay',
      imageUrl: normalizeUrlString(imageUrl) || fallbackImage
    });
  };

  addItem(launch.videoUrl, 'Watch coverage', 'Live/Replay', fallbackImage);
  launch.launchVidUrls?.forEach((item) => {
    addItem(
      item.url,
      item.title || item.publisher || 'Watch coverage',
      [normalizeTextValue(item.publisher), formatUrlHost(item.url)].filter(Boolean).join(' • '),
      item.feature_image || fallbackImage
    );
  });

  return items;
}

function buildExternalLinks(launch: RichLaunchSummary): ExternalLinkView[] {
  const items: ExternalLinkView[] = [];
  const seen = new Set<string>();

  const addItem = (url: string | null | undefined, label: string | null | undefined, meta: string | null | undefined) => {
    const normalizedUrl = normalizeUrlString(url);
    if (!normalizedUrl || seen.has(normalizedUrl)) {
      return;
    }

    seen.add(normalizedUrl);
    items.push({
      url: normalizedUrl,
      label: normalizeTextValue(label) || formatUrlHost(normalizedUrl) || 'Source',
      meta: normalizeTextValue(meta) || 'External link'
    });
  };

  launch.launchInfoUrls?.forEach((item) => {
    addItem(item.url, item.title || 'Launch resource', [normalizeTextValue(item.source), readTypedLabel(item.type)].filter(Boolean).join(' • '));
  });
  launch.mission?.infoUrls?.forEach((item) => {
    addItem(item.url, item.title || 'Mission info', [normalizeTextValue(item.source), readTypedLabel(item.type)].filter(Boolean).join(' • '));
  });
  addItem(launch.rocket?.infoUrl, 'Vehicle info', 'Rocket');
  addItem(launch.rocket?.wikiUrl, 'Vehicle wiki', 'Rocket');
  addItem(launch.flightclubUrl, 'Flight Club', 'Trajectory');

  return items;
}

function buildUnknownEntityTitle(value: unknown, fallback: string) {
  return (
    readUnknownEntityText(value, ['name']) ||
    readUnknownEntityText(value, ['astronaut']) ||
    readUnknownEntityText(value, ['title']) ||
    readUnknownEntityText(value, ['label']) ||
    fallback
  );
}

function buildUnknownEntitySubtitle(value: unknown, keys: string[]) {
  const values = keys.map((key) => readUnknownEntityText(value, [key])).filter(Boolean);
  return values.length > 0 ? values.join(' • ') : null;
}

function buildUnknownEntityDescription(value: unknown) {
  return readUnknownEntityText(value, ['description']) || readUnknownEntityText(value, ['summary']) || readUnknownEntityText(value, ['bio']);
}

function readUnknownEntityText(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function readTypedLabel(value: unknown) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = (value as { name?: unknown }).name;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

function normalizeUrlString(value: string | null | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeTextValue(value: string | null | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isSpaceXWebsiteUrl(value: string | null | undefined) {
  const normalized = normalizeUrlString(value);
  if (!normalized) {
    return false;
  }

  try {
    const host = new URL(normalized).hostname.replace(/^www\./, '').toLowerCase();
    return host === 'spacex.com' || host.endsWith('.spacex.com');
  } catch {
    return false;
  }
}

function formatUrlHost(value: string | null | undefined) {
  const normalized = normalizeUrlString(value);
  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function normalizeExternalContentPreviewUrl(resource: LaunchExternalContentResource) {
  const preferred = normalizeUrlString(resource.previewUrl || null);
  if (preferred) {
    return preferred;
  }
  if (resource.kind === 'image' || resource.kind === 'infographic') {
    return normalizeUrlString(resource.url);
  }
  return null;
}

function formatExternalContentKindLabel(kind: LaunchExternalContentResource['kind']) {
  switch (kind) {
    case 'infographic':
      return 'Infographic';
    case 'image':
      return 'Image';
    case 'video':
      return 'Video';
    case 'webcast':
      return 'Webcast';
    case 'timeline':
      return 'Timeline';
    case 'document':
      return 'Document';
    case 'page':
      return 'Page';
    default:
      return 'Resource';
  }
}

function isRichLaunchSummary(launch: LaunchSummary): launch is RichLaunchSummary {
  return 'pad' in launch;
}

function getPrimaryWatchUrl(launch: LaunchSummary) {
  if (!isRichLaunchSummary(launch)) {
    return null;
  }
  return launch.videoUrl || launch.launchVidUrls?.[0]?.url || null;
}

function getPrimaryResourceUrl(launch: LaunchSummary) {
  if (!isRichLaunchSummary(launch)) {
    return null;
  }
  const firstNonSpaceXInfoUrl = launch.launchInfoUrls?.find((item) => !isSpaceXWebsiteUrl(item?.url || null))?.url || null;
  return firstNonSpaceXInfoUrl || launch.launchVidUrls?.[0]?.url || null;
}

function buildShareMessage(launch: LaunchSummary) {
  return [launch.name, getPrimaryWatchUrl(launch) || getPrimaryResourceUrl(launch) || formatTimestamp(launch.net)].filter(Boolean).join('\n');
}

function getStatusTone(status: string): 'default' | 'success' | 'warning' | 'danger' {
  if (status === 'go') return 'success';
  if (status === 'hold') return 'warning';
  if (status === 'scrubbed') return 'danger';
  return 'default';
}

function isUnknownEntityLabel(value: string | null | undefined) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return !normalized || normalized === 'unknown' || normalized === 'tbd' || normalized === 'none' || normalized === 'n/a' || normalized === 'na';
}

function slugifyRouteSegment(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 64);
}

function buildSlugIdSegment(label: string | null | undefined, id: string) {
  const slug = slugifyRouteSegment(label);
  return slug ? `${slug}-${id}` : id;
}

function buildLaunchProviderEntityHref(provider: string | null | undefined) {
  if (isUnknownEntityLabel(provider)) return null;
  const slug = toProviderSlug(provider);
  if (!slug) return null;
  return `/launch-providers/${encodeURIComponent(slug)}`;
}

function buildLaunchRocketEntityHref({
  label,
  ll2RocketConfigId
}: {
  label: string | null | undefined;
  ll2RocketConfigId: number | null | undefined;
}) {
  if (ll2RocketConfigId != null && Number.isFinite(ll2RocketConfigId)) {
    const canonicalId = String(ll2RocketConfigId);
    const slugId = buildSlugIdSegment(label, canonicalId);
    return `/rockets/${encodeURIComponent(slugId)}`;
  }
  const slug = slugifyRouteSegment(label);
  if (!slug) return null;
  return `/rockets/${encodeURIComponent(slug)}`;
}

function buildLaunchLocationEntityHref({
  locationLabel,
  padLabel,
  ll2PadId
}: {
  locationLabel: string | null | undefined;
  padLabel: string | null | undefined;
  ll2PadId: number | null | undefined;
}) {
  const preferredLabel = !isUnknownEntityLabel(locationLabel) ? String(locationLabel || '').trim() : '';
  const fallbackLabel = !isUnknownEntityLabel(padLabel) ? String(padLabel || '').trim() : '';
  const label = preferredLabel || fallbackLabel || 'location';

  if (ll2PadId != null && Number.isFinite(ll2PadId)) {
    const canonicalId = String(ll2PadId);
    const slugId = buildSlugIdSegment(label, canonicalId);
    return `/locations/${encodeURIComponent(slugId)}`;
  }

  const slug = slugifyRouteSegment(label);
  if (!slug) return null;
  return `/locations/${encodeURIComponent(slug)}`;
}

function buildLaunchPadEntityHref({
  ll2PadId,
  fallbackLocationHref
}: {
  ll2PadId: number | null | undefined;
  fallbackLocationHref: string | null;
}) {
  if (ll2PadId != null && Number.isFinite(ll2PadId)) {
    return `/catalog/pads/${encodeURIComponent(String(ll2PadId))}`;
  }
  return fallbackLocationHref;
}

function buildCountdownLabel(net: string | null | undefined) {
  const snapshot = buildCountdownSnapshot(net ?? null);
  if (!snapshot) return 'NET TBD';

  const totalMinutes = Math.round(Math.abs(snapshot.totalMs) / 60_000);
  if (totalMinutes >= 24 * 60) {
    const days = Math.round(totalMinutes / (24 * 60));
    return snapshot.isPast ? `${days}d since liftoff` : `${days}d to launch`;
  }
  if (totalMinutes >= 60) {
    const hours = Math.round(totalMinutes / 60);
    return snapshot.isPast ? `${hours}h since liftoff` : `${hours}h to launch`;
  }
  return snapshot.isPast ? `${totalMinutes}m since liftoff` : `${totalMinutes}m to launch`;
}

function buildCountdownDisplay(net: string | null | undefined) {
  const snapshot = buildCountdownSnapshot(net ?? null);
  if (!snapshot) return 'NET TBD';

  const prefix = snapshot.isPast ? 'T+' : 'T-';
  const totalSeconds = Math.max(0, Math.floor(Math.abs(snapshot.totalMs) / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${prefix}${padNumber(days)}D ${padNumber(hours)}H`;
  }
  if (hours > 0) {
    return `${prefix}${padNumber(hours)}:${padNumber(minutes)}:${padNumber(seconds)}`;
  }
  return `${prefix}${padNumber(minutes)}:${padNumber(seconds)}`;
}

function padNumber(value: number) {
  return String(Math.max(0, value)).padStart(2, '0');
}
