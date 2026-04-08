import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@tminuszero/api-client';
import {
  AppState,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View
} from 'react-native';
import { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ArTrajectorySummaryV1, LaunchDetailV1, LaunchFaaAirspaceMapV1 } from '@tminuszero/contracts';
import {
  buildCountdownSnapshot,
  buildDetailVersionToken,
  canAutoRefreshActiveSurface,
  getNextAdaptiveLaunchRefreshMs,
  getRecommendedLaunchRefreshIntervalSeconds,
  getVisibleDetailUpdatedAt,
  hasVersionChanged,
  PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS,
  shouldPrimeVersionRefresh
} from '@tminuszero/domain';
import { normalizeNativeMobileCustomerHref, toProviderSlug } from '@tminuszero/navigation';
import {
  buildLaunchVideoEmbed,
  buildLaunchInventoryStatusMessage,
  shouldShowLaunchInventoryCounts,
  shouldShowLaunchInventorySection
} from '@tminuszero/launch-detail-ui';
import { useApiClient } from '@/src/api/client';
import {
  fetchLaunchDetailVersion,
  useDeleteMobilePushRuleMutation,
  useLaunchDetailQuery,
  useLaunchFaaAirspaceMapQuery,
  useMobilePushRulesQuery,
  useUpsertMobilePushLaunchPreferenceMutation,
  useViewerEntitlementsQuery,
  useViewerSessionQuery
} from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import { LaunchAlertsPanel } from '@/src/components/LaunchAlertsPanel';
import { LaunchCalendarSheet } from '@/src/components/LaunchCalendarSheet';
import { LaunchFollowSheet } from '@/src/components/LaunchFollowSheet';
import { LaunchShareIconButton } from '@/src/components/LaunchShareIconButton';
import { EmptyStateCard, ErrorStateCard, LoadingStateCard, SectionCard } from '@/src/components/SectionCard';
import { ForecastAdvisoriesDisclosure } from '@/src/components/launch/ForecastAdvisoriesDisclosure';
import { JepPanel } from '@/src/components/launch/JepPanel';
import { LaunchNewsCard } from '@/src/components/launch/LaunchNewsCard';
import { LaunchVideoInlineEmbed } from '@/src/components/launch/LaunchVideoInlineEmbed';
import { LaunchMediaLightboxCard } from '@/src/components/launch/LaunchMediaLightboxCard';
import { MissionTimelineCards } from '@/src/components/launch/MissionTimelineCards';
import { XPostInlineEmbed } from '@/src/components/launch/XPostInlineEmbed';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { useMobilePush } from '@/src/providers/MobilePushProvider';
import { useMobileToast } from '@/src/providers/MobileToastProvider';
import { type LaunchShareInput, shareLaunch } from '@/src/utils/launchShare';
import { formatTimestamp, formatSearchResultLabel } from '@/src/utils/format';
import { buildAppleMapsSatelliteUrl, buildPlatformPadMapUrl } from '@/src/utils/mapLinks';
import type { LaunchCalendarLaunch } from '@/src/calendar/launchCalendar';
import {
  buildLaunchSiteRuleValue,
  buildPadRuleValue,
  buildRocketRuleValue,
  buildStateRuleValue,
  buildWatchlistRuleErrorMessage,
  formatLaunchSiteRuleLabel,
  formatPadRuleLabel,
  formatRocketRuleLabel,
  formatStateRuleLabel,
  usePrimaryWatchlist
} from '@/src/watchlists/usePrimaryWatchlist';
import { ParallaxHero, StaticHero } from '@/src/components/launch/ParallaxHero';
import { InteractiveStatTiles, type StatTile } from '@/src/components/launch/InteractiveStatTiles';
import { LiveBadge } from '@/src/components/launch/LiveDataPulse';
import { LiveLaunchCountdownClock, LiveLaunchCountdownLabel } from '@/src/components/launch/LiveLaunchCountdown';
import { AnimationErrorBoundary } from '@/src/components/launch/AnimationErrorBoundary';
import { CollapsibleSection } from '@/src/components/launch/CollapsibleSection';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';
import { useSharedNow } from '@/src/hooks/useSharedNow';
import { TmzLaunchMapView, getTmzLaunchMapCapabilitiesAsync, type TmzLaunchMapCapabilities } from '@/modules/tmz-launch-map';
import { resolveNativeProgramHubOrCoreHref } from '@/src/features/programHubs/rollout';
import { openExternalCustomerUrl } from '@/src/features/customerRoutes/shared';
import { formatRefreshTimeLabel } from '@/src/utils/launchRefresh';

type LegacyLaunchSummary = LaunchDetailV1['launch'];
type RichLaunchSummary = NonNullable<LaunchDetailV1['launchData']>;
type LaunchSummary = LegacyLaunchSummary | RichLaunchSummary;
type LaunchExternalContentItem = LaunchDetailV1['enrichment']['externalContent'][number];
type LaunchExternalContentResource = LaunchExternalContentItem['resources'][number];
type LaunchFaaAirspaceAdvisoryView = NonNullable<LaunchDetailV1['enrichment']>['faaAdvisories'][number];
type WatchLinkView = { url: string; label: string; meta: string; imageUrl: string | null; host?: string | null; kind?: string | null };
type ExternalLinkView = { url: string; label: string; meta: string; host?: string | null; kind?: string | null };
type RefreshNotice = {
  tone: 'info' | 'warning';
  message: string;
  kind?: 'anon_refresh';
  actionLabel?: string;
  onAction?: () => void;
};

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

  const handleBackToFeed = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/feed' as Href);
  }, [router]);
  const openPremiumGate = useCallback(() => {
    router.push('/account/membership' as Href);
  }, [router]);
  const { installationId, deviceSecret, isRegistered } = useMobilePush();
  const { client } = useApiClient();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const launchId = getLaunchId(params.id);
  const launchDetailQuery = useLaunchDetailQuery(launchId);
  const launchFaaAirspaceMapQuery = useLaunchFaaAirspaceMapQuery(launchId, {
    enabled: Boolean(launchId)
  });
  const entitlementsQuery = useViewerEntitlementsQuery();
  const viewerSessionQuery = useViewerSessionQuery();
  const detail = launchDetailQuery.data ?? null;
  const legacyLaunch = detail?.launch ?? null;
  const launch = detail?.launchData ?? null;
  const arTrajectory = detail?.arTrajectory ?? null;
  const canUseArTrajectory = entitlementsQuery.data?.capabilities.canUseArTrajectory ?? false;
  const canUseSavedItems = entitlementsQuery.data?.capabilities.canUseSavedItems ?? false;
  const canUseSingleLaunchFollow = entitlementsQuery.data?.capabilities.canUseSingleLaunchFollow ?? false;
  const canUseAllUsLaunchAlerts = entitlementsQuery.data?.capabilities.canUseAllUsLaunchAlerts ?? false;
  const isPremium = entitlementsQuery.data?.tier === 'premium';
  const isAuthed = entitlementsQuery.data?.isAuthed ?? false;
  const singleLaunchFollowLimit = Math.max(1, entitlementsQuery.data?.limits.singleLaunchFollowLimit ?? 1);
  const detailVersionScope = entitlementsQuery.data?.mode === 'live' ? 'live' : 'public';
  const fallbackRefreshIntervalSeconds =
    detailVersionScope === 'live' ? PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS : (entitlementsQuery.data?.refreshIntervalSeconds ?? 7200);
  const mobilePushContext = installationId ? { installationId, deviceSecret } : null;
  const mobilePushRulesQuery = useMobilePushRulesQuery(mobilePushContext, { enabled: Boolean(mobilePushContext?.installationId) });
  const upsertLaunchNotificationMutation = useUpsertMobilePushLaunchPreferenceMutation();
  const deleteMobilePushRuleMutation = useDeleteMobilePushRuleMutation();
  const [calendarLaunch, setCalendarLaunch] = useState<LaunchCalendarLaunch | null>(null);
  const [followSheetOpen, setFollowSheetOpen] = useState(false);
  const [savedStatus, setSavedStatus] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [detailRefreshing, setDetailRefreshing] = useState(false);
  const [appStateStatus, setAppStateStatus] = useState(AppState.currentState);
  const [launchMapCapabilities, setLaunchMapCapabilities] = useState<TmzLaunchMapCapabilities | null>(null);
  const [faaMapModalOpen, setFaaMapModalOpen] = useState(false);
  const [expandedFaaRawTextIds, setExpandedFaaRawTextIds] = useState<Record<string, boolean>>({});
  const [refreshNotice, setRefreshNotice] = useState<RefreshNotice | null>(null);
  const watchlistState = usePrimaryWatchlist({
    enabled: isAuthed && canUseSavedItems,
    ruleLimit: entitlementsQuery.data?.limits.watchlistRuleLimit ?? null
  });
  const title = launch?.name ?? legacyLaunch?.name ?? 'Launch detail';
  const shouldReduceMotion = useReducedMotion();
  const scrollRef = useRef<ScrollView | null>(null);
  const lastSeenVersionRef = useRef<string | null>(null);
  const refetchLaunchDetail = launchDetailQuery.refetch;
  const refetchLaunchFaaAirspaceMap = launchFaaAirspaceMapQuery.refetch;
  const [scheduledRefreshIntervalSeconds, setScheduledRefreshIntervalSeconds] = useState<number>(fallbackRefreshIntervalSeconds);
  const [cadenceAnchorNet, setCadenceAnchorNet] = useState<string | null>(null);
  const [pendingDetailRefresh, setPendingDetailRefresh] = useState<{ version: string; updatedAt: string | null } | null>(null);
  const refreshIntervalSeconds = getRecommendedLaunchRefreshIntervalSeconds(
    scheduledRefreshIntervalSeconds,
    fallbackRefreshIntervalSeconds
  );

  useEffect(() => {
    setExpandedFaaRawTextIds({});
  }, [launchId]);

  const toggleFaaRawText = useCallback((matchId: string) => {
    setExpandedFaaRawTextIds((current) => ({
      ...current,
      [matchId]: !current[matchId]
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;

    void getTmzLaunchMapCapabilitiesAsync()
      .then((capabilities) => {
        if (!cancelled) {
          setLaunchMapCapabilities(capabilities);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLaunchMapCapabilities({
            isAvailable: false,
            provider: 'none',
            reason: 'Native launch maps are unavailable on this device.'
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    }
  });

  let content: JSX.Element;
  let followSheetNode: ReactNode = null;
  let floatingTopBarNode: JSX.Element | null = null;

  useEffect(() => {
    setSavedStatus(null);
    lastSeenVersionRef.current = null;
    setPendingDetailRefresh(null);
    setRefreshNotice(null);
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

  useEffect(() => {
    if (detailVersionScope === 'live' && refreshNotice?.kind === 'anon_refresh') {
      setRefreshNotice(null);
    }
  }, [detailVersionScope, refreshNotice]);

  const applyResolvedDetailRefresh = useCallback(async (nextVersion: string | null) => {
    const [detailResult] = await Promise.all([refetchLaunchDetail(), refetchLaunchFaaAirspaceMap()]);
    const refreshedUpdatedAt = getVisibleDetailUpdatedAt(detailResult.data?.launchData ?? detail?.launchData ?? null);
    lastSeenVersionRef.current = nextVersion ?? buildDetailVersionToken(launchId, detailVersionScope, refreshedUpdatedAt);
    setPendingDetailRefresh(null);
    setRefreshNotice((current) => (current?.kind === 'anon_refresh' ? null : current));
  }, [detail?.launchData, detailVersionScope, launchId, refetchLaunchDetail, refetchLaunchFaaAirspaceMap]);

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
    detailVersionScope,
    detailRefreshing,
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
        typeof payload?.version === 'string'
          ? payload.version
          : buildDetailVersionToken(launchId, detailVersionScope, payload?.updatedAt ?? null);

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
    client,
    detailVersionScope,
    detail,
    detailRefreshing,
    applyResolvedDetailRefresh,
    cadenceAnchorNet,
    fallbackRefreshIntervalSeconds,
    isFocused,
    launchDetailQuery.isPending,
    launchId,
    queryClient,
    refreshIntervalSeconds
  ]);

  if (!launchId) {
    content = <EmptyStateCard title="Missing launch id" body="A launch detail route was opened without an id parameter." />;
  } else if (launchDetailQuery.isPending) {
    content = <LoadingStateCard title="Loading launch detail" body={`Fetching /api/v1/launches/${launchId}.`} />;
  } else if (launchDetailQuery.isError) {
    content = <ErrorStateCard title="Launch detail unavailable" body={launchDetailQuery.error.message} />;
  } else if (!detail) {
    content = <EmptyStateCard title="Launch detail unavailable" body="No launch detail was returned for this route." />;
  } else if (!launch) {
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
    const inventoryStatus = objectInventory?.status ?? null;
    const inventoryTotalObjectCount = (objectInventory?.payloadObjects?.length ?? 0) + (objectInventory?.nonPayloadObjects?.length ?? 0);
    const inventoryCatalogState =
      inventoryStatus?.catalogState ?? (inventoryTotalObjectCount > 0 ? 'catalog_available' : null);
    const inventoryStatusMessage = buildLaunchInventoryStatusMessage({
      launchDesignator: objectInventory?.launchDesignator ?? launchRecord.launchDesignator ?? null,
      catalogState: inventoryCatalogState,
      totalObjectCount: inventoryTotalObjectCount
    });
    const showInventoryCounts = shouldShowLaunchInventoryCounts({
      catalogState: inventoryCatalogState,
      totalObjectCount: inventoryTotalObjectCount
    });
    const shouldShowInventorySection = shouldShowLaunchInventorySection({
      launchNet: launchRecord.net ?? null,
      launchDesignator: objectInventory?.launchDesignator ?? launchRecord.launchDesignator ?? null,
      catalogState: inventoryCatalogState,
      totalObjectCount: inventoryTotalObjectCount,
      hasSummaryBadges: (objectInventory?.summaryBadges?.length ?? 0) > 0
    });
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
    const externalLinks = normalizePlatformExternalLinks(
      resourcesModule?.externalLinks?.map((item) => ({
        url: item.url,
        label: item.label,
        meta: item.meta || 'External link',
        host: item.host ?? null,
        kind: item.kind ?? null
      })) ?? buildExternalLinks(launch),
      launch,
      Platform.OS
    );
    const watchUrl = watchLinks[0]?.url ?? getPrimaryWatchUrl(launch);
    const primaryWatchLink = watchLinks[0] ?? null;
    const primaryWatchEmbed = primaryWatchLink ? buildLaunchVideoEmbed(primaryWatchLink.url) : null;
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
    const rocketRuleValue = buildRocketRuleValue({
      ll2RocketConfigId: launch.ll2RocketConfigId,
      rocketName: launch.rocket?.fullName || launch.rocketName,
      vehicle: launch.vehicle
    });
    const launchSiteRuleValue = buildLaunchSiteRuleValue(launch.padLocation || launch.pad.locationName || launch.pad.name);
    const stateRuleValue = buildStateRuleValue(launch.pad.state);
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
    const platformPadMapHref = buildPlatformPadMapUrl(
      {
        latitude: launch.pad.latitude,
        longitude: launch.pad.longitude,
        label: launch.pad.shortCode || launch.pad.name || launch.name || 'Launch pad'
      },
      Platform.OS
    );
    const launchInfoPadCatalogHref = buildLaunchPadEntityHref({
      ll2PadId: launch.ll2PadId,
      fallbackLocationHref: launchInfoLocationHref
    });
    const launchInfoPadHref = Platform.OS === 'ios' ? platformPadMapHref || launchInfoPadCatalogHref : launchInfoPadCatalogHref;
    const handleShareLaunch = () => {
      void shareLaunch(buildLaunchShareInput(launch));
    };
    const handleOpenCalendar = () => {
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
    };
    const handleOpenArTrajectory = () => {
      if (!arTrajectory) {
        return;
      }
      if (!canUseArTrajectory) {
        router.push('/profile');
        return;
      }
      if (arTrajectory.availabilityReason === 'not_eligible') {
        setSavedStatus({
          tone: 'error',
          text: 'AR trajectory is unavailable for this launch.'
        });
        return;
      }
      if (arTrajectory.availabilityReason === 'trajectory_missing' || !arTrajectory.hasTrajectory) {
        setSavedStatus({
          tone: 'error',
          text: 'AR trajectory is not ready for this launch yet.'
        });
        return;
      }
      router.push((`/launches/ar/${launch.id}`) as Href);
    };
    const canShowTopBarArButton = Boolean(arTrajectory);
    const topBarArActive = Boolean(
      arTrajectory &&
        canUseArTrajectory &&
        arTrajectory.hasTrajectory &&
        arTrajectory.availabilityReason !== 'not_eligible' &&
        arTrajectory.availabilityReason !== 'trajectory_missing'
    );
    const topBarArDisabled = Boolean(
      arTrajectory &&
        canUseArTrajectory &&
        (arTrajectory.availabilityReason === 'not_eligible' || arTrajectory.availabilityReason === 'trajectory_missing' || !arTrajectory.hasTrajectory)
    );
    const floatingTopBarTop = Math.max(insets.top + 8, 14);
    const floatingTopBarSpacerHeight = 52;
    const launchFaaAirspaceMap = launchFaaAirspaceMapQuery.data ?? null;
    const nativeLaunchMapsSupported = launchMapCapabilities?.isAvailable === true;
    const faaMapPayload = launchFaaAirspaceMap;
    const padMapPayload = buildPadSatelliteMapPayload(launch);
    const showNativePadMapPreview = nativeLaunchMapsSupported && Boolean(platformPadMapHref);
    const showNativeFaaMapPreview = nativeLaunchMapsSupported && Boolean(launchFaaAirspaceMap?.hasRenderableGeometry);
    const openTarget = (target: string) => {
      if (!target) return;
      if (/^https?:\/\//i.test(target)) {
        void openExternalCustomerUrl(target);
        return;
      }
      if (target.startsWith('/launches/')) {
        router.push(target as Href);
        return;
      }
      const nativeCustomerHref =
        resolveNativeProgramHubOrCoreHref(viewerSessionQuery.data, target) || normalizeNativeMobileCustomerHref(target);
      if (nativeCustomerHref) {
        router.push(nativeCustomerHref as Href);
        return;
      }
      setSavedStatus({
        tone: 'error',
        text: 'That linked surface has not shipped natively on mobile yet.'
      });
    };

    const closeFollowSheet = () => {
      setFollowSheetOpen(false);
    };

    const mobilePushRules = mobilePushRulesQuery.data?.rules ?? [];
    const basicActiveLaunchRule = !canUseSavedItems ? mobilePushRules.find((rule) => rule.scopeKind === 'launch') ?? null : null;
    const currentBasicLaunchActive = basicActiveLaunchRule?.launchId === launchRecord.id;
    const basicLaunchSlotOccupiedElsewhere = Boolean(basicActiveLaunchRule && !currentBasicLaunchActive);
    const basicFollowCapacityLabel = canUseSavedItems || !isAuthed ? undefined : `${basicActiveLaunchRule ? 1 : 0}/${singleLaunchFollowLimit}`;
    const launchNotificationRule = mobilePushRules.find((rule) => rule.scopeKind === 'launch' && rule.launchId === launchRecord.id) ?? null;

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

    const handleToggleBasicLaunchNotification = async () => {
      if (!canUseSingleLaunchFollow) {
        openPremiumGate();
        return;
      }
      if (!installationId || !deviceSecret || !isRegistered) {
        router.push('/preferences');
        return;
      }
      if (!currentBasicLaunchActive && basicLaunchSlotOccupiedElsewhere) {
        setSavedStatus({
          tone: 'error',
          text: basicActiveLaunchRule?.label
            ? `Your public launch slot is in use by ${basicActiveLaunchRule.label}. Unfollow it or wait until it launches.`
            : 'Your public launch slot is already in use.'
        });
        return;
      }

      try {
        if (launchNotificationRule) {
          await deleteMobilePushRuleMutation.mutateAsync({
            ruleId: launchNotificationRule.id,
            context: {
              installationId,
              deviceSecret
            }
          });
          setSavedStatus({ tone: 'success', text: 'Launch notifications turned off.' });
          return;
        }

        await upsertLaunchNotificationMutation.mutateAsync({
          launchId: launchRecord.id,
          payload: {
            installationId,
            deviceSecret,
            scopeKind: 'launch',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            prelaunchOffsetsMinutes: [10, 60],
            dailyDigestLocalTime: null,
            statusChangeTypes: [],
            notifyNetChanges: false
          }
        });
        setSavedStatus({ tone: 'success', text: 'Launch notifications turned on.' });
      } catch (error) {
        if (error instanceof ApiClientError && error.code === 'limit_reached') {
          setSavedStatus({
            tone: 'error',
            text: basicActiveLaunchRule?.label
              ? `Your public launch slot is in use by ${basicActiveLaunchRule.label}. Unfollow it or wait until it launches.`
              : 'Your public launch slot is already in use.'
          });
          return;
        }
        setSavedStatus({
          tone: 'error',
          text: error instanceof Error ? error.message : 'Unable to update launch notifications.'
        });
      }
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

    const handleTogglePremiumFollow = async (
      kind: 'rocket' | 'launch_site' | 'state',
      ruleValue: string | null,
      label: string
    ) => {
      const normalizedRuleValue = String(ruleValue || '').trim();
      if (!normalizedRuleValue) {
        return;
      }
      if (!canUseSavedItems) {
        openPremiumGate();
        return;
      }

      try {
        const result = await watchlistState.toggleRule({
          kind,
          ruleValue: normalizedRuleValue,
          label
        });
        if (result) {
          if (result.action === 'added') {
            showFollowToast({
              message: result.notice.message,
              undo: async () => {
                await watchlistState.toggleRule({
                  kind,
                  ruleValue: normalizedRuleValue,
                  label
                });
                setSavedStatus({ tone: 'success', text: `Unfollowed ${label}.` });
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

    const followOptions = canUseSavedItems
      ? [
          {
            key: 'launch',
            label: 'This launch',
            description: 'Keep this exact launch in Following.',
            active: watchlistState.isLaunchTracked(launchRecord.id),
            disabled: watchlistState.isLoading || Boolean(watchlistState.busyKeys[launchBusyKey]),
            locked: false,
            onPress: () => {
              closeFollowSheet();
              void handleToggleSavedLaunch();
            }
          },
          {
            key: 'rocket',
            label: 'This rocket',
            description: `All launches for ${formatRocketRuleLabel(rocketRuleValue || launchInfoRocketLabel)}.`,
            active: watchlistState.isRocketTracked(rocketRuleValue),
            disabled: !rocketRuleValue,
            locked: false,
            onPress: () => {
              closeFollowSheet();
              void handleTogglePremiumFollow('rocket', rocketRuleValue, formatRocketRuleLabel(rocketRuleValue || launchInfoRocketLabel));
            }
          },
          {
            key: 'provider',
            label: 'This provider',
            description: `All launches from ${launchRecord.provider}.`,
            active: watchlistState.isProviderTracked(launch.provider),
            disabled:
              watchlistState.isLoading ||
              !String(launch.provider || '').trim() ||
              Boolean(watchlistState.busyKeys[providerBusyKey]),
            locked: false,
            onPress: () => {
              closeFollowSheet();
              void handleToggleProviderFollow();
            }
          },
          {
            key: 'pad',
            label: 'This pad',
            description: `Launches from ${formatPadRuleLabel(padRuleValue || launch.pad.shortCode || launch.pad.name || 'this pad')}.`,
            active: watchlistState.isPadTracked(padRuleValue),
            disabled: !padRuleValue || watchlistState.isLoading || Boolean(watchlistState.busyKeys[padBusyKey]),
            locked: false,
            onPress: () => {
              closeFollowSheet();
              void handleTogglePadFollow();
            }
          },
          {
            key: 'launch_site',
            label: 'This launch site',
            description: `Launches from ${formatLaunchSiteRuleLabel(launchSiteRuleValue || launchInfoLocationLabel)}.`,
            active: watchlistState.isLaunchSiteTracked(launchSiteRuleValue),
            disabled: !launchSiteRuleValue,
            locked: false,
            onPress: () => {
              closeFollowSheet();
              void handleTogglePremiumFollow('launch_site', launchSiteRuleValue, formatLaunchSiteRuleLabel(launchSiteRuleValue || launchInfoLocationLabel));
            }
          },
          {
            key: 'state',
            label: 'This state',
            description: `Launches in ${formatStateRuleLabel(stateRuleValue || launch.pad.state)}.`,
            active: watchlistState.isStateTracked(stateRuleValue),
            disabled: !stateRuleValue,
            locked: false,
            onPress: () => {
              closeFollowSheet();
              void handleTogglePremiumFollow('state', stateRuleValue, formatStateRuleLabel(stateRuleValue || launch.pad.state));
            }
          }
        ]
      : isAuthed
        ? [
          {
            key: 'launch_notifications',
            label: 'This launch',
            description:
              !installationId || !deviceSecret || !isRegistered
                ? 'Enable push on this device in Preferences first.'
                : !canUseSingleLaunchFollow
                  ? 'Launch follow is unavailable on this account.'
                  : basicLaunchSlotOccupiedElsewhere
                    ? `Your public launch slot is in use by ${basicActiveLaunchRule?.label || 'another launch'}. Unfollow it or wait until it launches.`
                    : currentBasicLaunchActive
                      ? 'This launch is using your public launch slot. Unfollow it to free up the slot.'
                      : 'Use your public launch slot for push reminders on this launch.',
            active: currentBasicLaunchActive,
            disabled:
              upsertLaunchNotificationMutation.isPending ||
              deleteMobilePushRuleMutation.isPending ||
              !canUseSingleLaunchFollow ||
              basicLaunchSlotOccupiedElsewhere,
            locked: false,
            onPress: () => {
              closeFollowSheet();
              void handleToggleBasicLaunchNotification();
            }
          },
          {
            key: 'state_locked',
            label: 'This state',
            description: 'Premium adds state-wide launch alerts.',
            active: false,
            disabled: false,
            locked: true,
            onPress: () => {
              closeFollowSheet();
              openPremiumGate();
            }
          },
          {
            key: 'provider_locked',
            label: 'This provider',
            description: 'Premium adds recurring provider follows.',
            active: false,
            disabled: false,
            locked: true,
            onPress: () => {
              closeFollowSheet();
              openPremiumGate();
            }
          },
          {
            key: 'rocket_locked',
            label: 'This rocket',
            description: 'Premium adds recurring rocket follows.',
            active: false,
            disabled: false,
            locked: true,
            onPress: () => {
              closeFollowSheet();
              openPremiumGate();
            }
          },
          {
            key: 'pad_locked',
            label: 'This pad',
            description: 'Premium adds recurring pad follows.',
            active: false,
            disabled: false,
            locked: true,
            onPress: () => {
              closeFollowSheet();
              openPremiumGate();
            }
          },
          {
            key: 'launch_site_locked',
            label: 'This launch site',
            description: 'Premium adds recurring launch-site follows.',
            active: false,
            disabled: false,
            locked: true,
            onPress: () => {
              closeFollowSheet();
              openPremiumGate();
            }
          }
        ]
        : [
            {
              key: 'launch_locked',
              label: 'This launch',
              description: title ? `Premium unlocks launch reminders and follow tracking for ${title}.` : 'Premium unlocks launch reminders and follow tracking for this launch.',
              active: false,
              disabled: false,
              locked: true,
              onPress: () => {
                closeFollowSheet();
                openPremiumGate();
              }
            },
            {
              key: 'state_locked',
              label: 'This state',
              description: 'Premium adds state-wide launch alerts.',
              active: false,
              disabled: false,
              locked: true,
              onPress: () => {
                closeFollowSheet();
                openPremiumGate();
              }
            },
            {
              key: 'provider_locked',
              label: 'This provider',
              description: 'Premium adds recurring provider follows.',
              active: false,
              disabled: false,
              locked: true,
              onPress: () => {
                closeFollowSheet();
                openPremiumGate();
              }
            },
            {
              key: 'rocket_locked',
              label: 'This rocket',
              description: 'Premium adds recurring rocket follows.',
              active: false,
              disabled: false,
              locked: true,
              onPress: () => {
                closeFollowSheet();
                openPremiumGate();
              }
            },
            {
              key: 'pad_locked',
              label: 'This pad',
              description: 'Premium adds recurring pad follows.',
              active: false,
              disabled: false,
              locked: true,
              onPress: () => {
                closeFollowSheet();
                openPremiumGate();
              }
            },
            {
              key: 'launch_site_locked',
              label: 'This launch site',
              description: 'Premium adds recurring launch-site follows.',
              active: false,
              disabled: false,
              locked: true,
              onPress: () => {
                closeFollowSheet();
                openPremiumGate();
              }
            }
          ];
    const activeFollowCount = followOptions.filter((option) => option.active).length;
    const followButtonLabel = activeFollowCount > 0 ? 'Following' : 'Follow';

    followSheetNode = (
      <LaunchFollowSheet
        launchName={title}
        open={followSheetOpen}
        options={followOptions}
        activeCount={activeFollowCount}
        capacityLabel={basicFollowCapacityLabel}
        notificationsActive={Boolean(launchNotificationRule)}
        notificationsContent={
          <LaunchAlertsPanel
            launchId={launch.id}
            installationId={installationId}
            deviceSecret={deviceSecret}
            isPremium={isPremium}
            isPushRegistered={isRegistered}
            onOpenUpgrade={() => {
              closeFollowSheet();
              openPremiumGate();
            }}
            onOpenPreferences={() => {
              closeFollowSheet();
              router.push('/preferences');
            }}
          />
        }
        message={
          canUseSavedItems
            ? 'Following keeps matching launches in your saved list, and launch alerts live in the Notifications tab for this launch.'
            : isAuthed && canUseAllUsLaunchAlerts
              ? 'Public access keeps one launch reminder slot on this device. Manage this launch in the Notifications tab and All U.S. launches from Preferences. Premium adds synced follows across broader scopes.'
              : isAuthed
                ? 'Public access keeps one launch reminder slot on this device. Manage launch alerts from the Notifications tab here. Premium adds synced follows across broader scopes.'
                : 'Premium unlocks launch reminders, followed-launch tracking, and broader follow scopes from this sheet.'
        }
        onClose={() => setFollowSheetOpen(false)}
      />
    );

    const statTiles: StatTile[] = [
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
        tone: 'default',
        onPress: launchInfoProviderHref
          ? () => {
              openTarget(launchInfoProviderHref);
            }
          : undefined
      },
      {
        id: 'vehicle',
        label: 'Launch vehicle',
        value: launch.vehicle || launch.rocket?.fullName || 'TBD',
        description: launch.pad?.name ? `From ${launch.pad.name}` : 'Launch vehicle',
        tone: 'default',
        onPress: launchInfoRocketHref
          ? () => {
              openTarget(launchInfoRocketHref);
            }
          : undefined
      }
    ];
    const statTileFallbackItems: FactGridItem[] = [
      ...(weatherModule?.summary
        ? [['Weather conditions', weatherModule.summary.split('.')[0] || 'Favorable'] satisfies FactGridItem]
        : []),
      ['Launch provider', launch.provider],
      ['Launch vehicle', launch.vehicle || launch.rocket?.fullName || 'TBD']
    ];
    const resourceMissionTimeline = resourcesModule?.missionTimeline ?? [];
    const hasResourceMissionTimeline = resourceMissionTimeline.length > 0;
    const officialMediaDescription = hasResourceMissionTimeline
      ? 'Matched mission resources, SpaceX media assets, and mission timeline entries for this launch.'
      : 'Matched mission resources and SpaceX media assets for this launch.';
    const vehicleTimeline = detail.vehicleTimeline ?? [];
    const advisoryCount = detail.enrichment.faaAdvisories.length;
    const hasForecastOutlook = Boolean(weatherModule?.cards?.length || advisoryCount > 0);
    const forecastOutlookDescription = weatherModule?.cards?.length
      ? advisoryCount > 0
        ? 'Structured weather sources and matched FAA advisories for this launch.'
        : 'Structured weather sources matched to this launch.'
      : `Launch-day FAA advisories matched to this launch. ${advisoryCount} match${advisoryCount === 1 ? '' : 'es'} found.`;

    floatingTopBarNode = (
      <LaunchDetailFloatingBar
        top={floatingTopBarTop}
        net={launch.net}
        onBack={handleBackToFeed}
        onShare={handleShareLaunch}
        onOpenCalendar={handleOpenCalendar}
        onOpenArTrajectory={canShowTopBarArButton ? handleOpenArTrajectory : undefined}
        showArButton={canShowTopBarArButton}
        arButtonActive={topBarArActive}
        arButtonDisabled={topBarArDisabled}
      />
    );

    content = (
      <>
        <View style={{ height: floatingTopBarSpacerHeight }} />

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

        {refreshNotice ? (
          <View
            style={{
              marginTop: 14,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: theme.stroke,
              backgroundColor: theme.surface,
              paddingHorizontal: 16,
              paddingVertical: 12
            }}
          >
            <Text style={{ color: refreshNotice.tone === 'warning' ? theme.foreground : theme.accent, fontSize: 14, lineHeight: 20 }}>
              {refreshNotice.message}
            </Text>
            {refreshNotice.actionLabel && refreshNotice.onAction ? (
              <Pressable onPress={refreshNotice.onAction} hitSlop={8} style={{ marginTop: 8, alignSelf: 'flex-start' }}>
                <Text style={{ color: theme.foreground, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' }}>
                  {refreshNotice.actionLabel}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {pendingDetailRefresh ? (
          <View
            style={{
              marginTop: 14,
              gap: 6,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: 'rgba(123, 204, 255, 0.38)',
              backgroundColor: 'rgba(14, 30, 56, 0.94)',
              paddingHorizontal: 16,
              paddingVertical: 14
            }}
          >
            <Text
              style={{
                color: 'rgba(179, 225, 255, 0.95)',
                fontSize: 11,
                fontWeight: '800',
                letterSpacing: 1.1,
                textTransform: 'uppercase'
              }}
            >
              Update ready
            </Text>
            <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '800', lineHeight: 22 }}>
              Pull down and release to refresh this launch detail.
            </Text>
          </View>
        ) : null}

        {arTrajectory && shouldShowArTrajectoryCard(arTrajectory, canUseArTrajectory) ? (
          <ArTrajectoryCard launchId={launch.id} arTrajectory={arTrajectory} canUseArTrajectory={canUseArTrajectory} />
        ) : null}

        <DetailModuleSection
          id="mission-control"
          title="Mission control dashboard"
          description="Countdown, launch actions, alerts, and live launch signals."
        >
          <View style={{ gap: 16 }}>
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
                    void openExternalCustomerUrl(watchUrl);
                  }}
                />
              ) : null}
            </View>

            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <DetailFollowChip
                  label={followButtonLabel}
                  active={activeFollowCount > 0}
                  detail={basicFollowCapacityLabel}
                  disabled={false}
                  onPress={() => {
                    setFollowSheetOpen(true);
                  }}
                />
              </View>
              {!canUseSavedItems ? (
                <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>
                  {canUseAllUsLaunchAlerts
                    ? 'Without Premium, you can use one launch reminder slot on this device, manage this launch from the Notifications tab, and manage All U.S. launches from Preferences. Premium adds saved follows and broader follow scopes.'
                    : 'Without Premium, you can use one launch reminder slot on this device and manage launch alerts from the Notifications tab here. Premium adds saved follows and broader follow scopes.'}
                </Text>
              ) : savedStatus ? (
                <Text style={{ color: savedStatus.tone === 'error' ? '#ff9087' : theme.accent, fontSize: 13, lineHeight: 19 }}>
                  {savedStatus.text}
                </Text>
              ) : watchlistState.errorMessage ? (
                <Text style={{ color: '#ff9087', fontSize: 13, lineHeight: 19 }}>{watchlistState.errorMessage}</Text>
              ) : null}
            </View>

            <AnimationErrorBoundary fallback={<FactGrid items={statTileFallbackItems} />}>
              <InteractiveStatTiles tiles={statTiles} />
            </AnimationErrorBoundary>
          </View>
        </DetailModuleSection>

        {primaryWatchLink ? (
          <DetailModuleSection
            id="live-coverage"
            title="Live coverage"
            description="Stream links and outbound coverage surfaced from the launch payload."
          >
            <View style={{ gap: 12 }}>
              {primaryWatchEmbed ? (
                <View style={{ gap: 12 }}>
                  <View style={{ gap: 4 }}>
                    <Text style={{ color: theme.foreground, fontSize: 17, fontWeight: '700', lineHeight: 22 }}>{primaryWatchLink.label}</Text>
                    {primaryWatchLink.meta ? (
                      <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '600', lineHeight: 18 }}>{primaryWatchLink.meta}</Text>
                    ) : null}
                  </View>
                  <LaunchVideoInlineEmbed
                    src={primaryWatchEmbed.src}
                    providerLabel={primaryWatchLink.host || primaryWatchEmbed.provider}
                  />
                  <Pressable
                    onPress={() => {
                      void openExternalCustomerUrl(primaryWatchLink.url);
                    }}
                    style={({ pressed }) => ({
                      alignSelf: 'flex-start',
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: theme.stroke,
                      backgroundColor: 'rgba(255, 255, 255, 0.04)',
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      opacity: pressed ? 0.9 : 1
                    })}
                  >
                    <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>Open stream</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => {
                    void openExternalCustomerUrl(primaryWatchLink.url);
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
              )}

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
                        void openExternalCustomerUrl(item.url);
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
          >
            <View style={{ gap: 10 }}>
              {socialModule.matchedPost ? (
                <View
                  style={{
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: 'rgba(34, 211, 238, 0.28)',
                    backgroundColor: 'rgba(34, 211, 238, 0.08)',
                    padding: 14,
                    gap: 8
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                        <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{socialModule.matchedPost.title}</Text>
                        <DetailChip label="Matched on X" tone="accent" />
                      </View>
                      {socialModule.matchedPost.subtitle ? (
                        <Text style={{ color: theme.muted, fontSize: 13 }}>{socialModule.matchedPost.subtitle}</Text>
                      ) : null}
                    </View>
                    <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>Matched</Text>
                  </View>
                  {socialModule.matchedPost.description ? (
                    <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>{socialModule.matchedPost.description}</Text>
                  ) : null}
                  {socialModule.matchedPost.matchedAt ? (
                    <Text style={{ color: theme.muted, fontSize: 12 }}>
                      Matched {formatTimestamp(socialModule.matchedPost.matchedAt)}
                    </Text>
                  ) : null}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
                    <Pressable
                      onPress={() => {
                        openTarget(socialModule.matchedPost?.url || '');
                      }}
                      style={({ pressed }) => ({
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: theme.stroke,
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        opacity: pressed ? 0.88 : 1
                      })}
                    >
                      <Text style={{ color: theme.foreground, fontSize: 12, fontWeight: '700' }}>Open on X</Text>
                    </Pressable>
                  </View>
                  {socialModule.matchedPost.postId ? (
                    <XPostInlineEmbed postId={socialModule.matchedPost.postId} />
                  ) : (
                    <View
                      style={{
                        marginTop: 4,
                        borderRadius: 16,
                        borderWidth: 1,
                        borderStyle: 'dashed',
                        borderColor: theme.stroke,
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        padding: 14
                      }}
                    >
                      <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
                        A matched source URL is available, but no X status ID could be extracted for inline embed rendering.
                      </Text>
                    </View>
                  )}
                </View>
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
          {platformPadMapHref ? (
            <SectionCard title="Pad satellite view" compact>
              <View style={{ gap: 10 }}>
                <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
                  {Platform.OS === 'ios'
                    ? 'Native Apple satellite preview centered on the launch pad. Tap the preview to open Apple Maps.'
                    : 'Native Google satellite preview centered on the launch pad. Tap the preview to open Google Maps.'}
                </Text>
                {showNativePadMapPreview ? (
                  <Pressable
                    onPress={() => {
                      void Linking.openURL(platformPadMapHref);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Open launch pad map"
                    style={{ gap: 8 }}
                  >
                    <NativeLaunchMapPreview
                      payload={padMapPayload}
                      renderMode="pad"
                      theme={theme}
                      height={196}
                      interactive={false}
                    />
                    <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>
                      {Platform.OS === 'ios' ? 'Open in Apple Maps' : 'Open in Google Maps'}
                    </Text>
                  </Pressable>
                ) : (
                  <LinkRow
                    title={Platform.OS === 'ios' ? 'Open in Apple Maps' : 'Open in Google Maps'}
                    subtitle={launchMapCapabilities?.reason || 'Native map preview is unavailable right now.'}
                    onPress={() => {
                      void Linking.openURL(platformPadMapHref);
                    }}
                  />
                )}
              </View>
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

        {hasForecastOutlook ? (
          <DetailModuleSection
            id="forecast-outlook"
            title="Forecast outlook"
            description={forecastOutlookDescription}
            collapsible={false}
          >
            <View style={{ gap: 12 }}>
              {weatherModule?.cards?.map((card) => (
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

              {advisoryCount > 0 ? (
                <View style={{ marginTop: weatherModule?.cards?.length ? 4 : 0 }}>
                  <ForecastAdvisoriesDisclosure count={advisoryCount} theme={theme}>
                    {launchFaaAirspaceMapQuery.isPending ? (
                      <SectionCard title="Launch zone map" compact>
                        <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>Loading launch-day FAA geometry…</Text>
                      </SectionCard>
                    ) : launchFaaAirspaceMap?.advisoryCount ? (
                      <SectionCard title="Launch zone map" compact>
                        <View style={{ gap: 10 }}>
                          <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
                            Native satellite view with launch-day FAA polygons and the launch pad in the same frame.
                          </Text>
                          {showNativeFaaMapPreview && faaMapPayload ? (
                            <Pressable
                              onPress={() => {
                                setFaaMapModalOpen(true);
                              }}
                              accessibilityRole="button"
                              accessibilityLabel="Open launch zone map"
                              style={{ gap: 8 }}
                            >
                              <NativeLaunchMapPreview
                                payload={faaMapPayload}
                                renderMode="faa"
                                theme={theme}
                                height={224}
                                interactive={false}
                              />
                              <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>Open full-screen map</Text>
                            </Pressable>
                          ) : (
                            platformPadMapHref ? (
                              <LinkRow
                                title={Platform.OS === 'ios' ? 'Open in Apple Maps' : 'Open in Google Maps'}
                                subtitle={launchMapCapabilities?.reason || 'Native launch map rendering is unavailable right now.'}
                                onPress={() => {
                                  void Linking.openURL(platformPadMapHref);
                                }}
                              />
                            ) : (
                              <View
                                style={{
                                  borderRadius: 14,
                                  borderWidth: 1,
                                  borderColor: theme.stroke,
                                  padding: 12
                                }}
                              >
                                <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '600' }}>Map unavailable</Text>
                                <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
                                  {launchMapCapabilities?.reason || 'Native launch map rendering is unavailable right now.'}
                                </Text>
                              </View>
                            )
                          )}
                        </View>
                      </SectionCard>
                    ) : null}

                    {detail.enrichment.faaAdvisories.map((advisory) => {
                      return (
                        <FaaNoticeCard
                          key={advisory.matchId}
                          advisory={advisory}
                          expandedRawText={Boolean(expandedFaaRawTextIds[advisory.matchId])}
                          onToggleRawText={() => {
                            toggleFaaRawText(advisory.matchId);
                          }}
                        />
                      );
                    })}

                    <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 19 }}>
                      Advisory data is informational. Confirm operational constraints with official FAA publications.
                    </Text>
                  </ForecastAdvisoriesDisclosure>
                </View>
              ) : null}
            </View>
          </DetailModuleSection>
        ) : null}

        <DetailModuleSection
          id="jep-visibility"
          title="JEP visibility score"
          description="Jellyfish effect scoring based on geometry, sun angle, and the current forecast."
        >
          <JepPanel launchId={launch.id} hasJepScore={detail.enrichment.hasJepScore} theme={theme} />
        </DetailModuleSection>

        {(detail.enrichment.firstStages.length > 0 || detail.enrichment.recovery.length > 0) ? (
          <DetailModuleSection
            id="stages-recovery"
            title="Stages & recovery"
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
                        {[stage.serialNumber, normalizeLaunchDetailText(stage.status), stage.source.toUpperCase()].filter(Boolean).join(' • ')}
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
                      <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{buildLegacyRecoveryTitle(entry)}</Text>
                      <Text style={{ color: theme.muted, fontSize: 13 }}>
                        {[formatLegacyRecoveryRole(entry.role), normalizeLaunchDetailText(entry.landingLocationName), normalizeLaunchDetailText(entry.landingTypeName)]
                          .filter(Boolean)
                          .join(' • ')}
                      </Text>
                      <Text style={{ color: theme.muted, fontSize: 13 }}>
                        {[entry.downrangeDistanceKm != null ? `${Math.round(entry.downrangeDistanceKm)} km downrange` : null, normalizeLaunchDetailText(entry.returnSite)]
                          .filter(Boolean)
                          .join(' • ')}
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
            description={officialMediaDescription}
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
                <LinkRow key={`video:${item.url}`} title={item.title || item.url} subtitle={item.publisher || 'Watch link'} onPress={() => void openExternalCustomerUrl(item.url)} />
              ))}
              {launch.launchInfoUrls?.filter((item) => !isSpaceXWebsiteUrl(item.url))?.map((item) => (
                <LinkRow key={`info:${item.url}`} title={item.title || item.url} subtitle={item.source || 'Launch resource'} onPress={() => void openExternalCustomerUrl(item.url)} />
              ))}
              {detail.enrichment.externalContent.map((item) => (
                <View key={item.id} style={{ gap: 8 }}>
                  <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{item.title || item.contentType}</Text>
                  {item.resources.map((resource) => (
                    <ExternalContentResourceCard key={resource.id} resource={resource} />
                  ))}
                </View>
              ))}
              {hasResourceMissionTimeline ? (
                <SectionCard title="Mission timeline" compact>
                  <MissionTimelineCards items={resourceMissionTimeline} theme={theme} />
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

        {(payloadManifest.length > 0 || shouldShowInventorySection) ? (
          <DetailModuleSection
            id="payload-inventory"
            title="Payload manifest & inventory"
            description="Manifested payloads and tracked launch objects linked to this mission."
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
            {inventoryStatusMessage ? (
              <View style={{ gap: 4 }}>
                <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 18 }}>{inventoryStatusMessage}</Text>
                {inventoryStatus?.lastCheckedAt ? (
                  <Text style={{ color: theme.muted, fontSize: 12 }}>Last checked: {inventoryStatus.lastCheckedAt}</Text>
                ) : null}
                {inventoryStatus?.lastNonEmptyAt ? (
                  <Text style={{ color: theme.muted, fontSize: 12 }}>Last non-empty: {inventoryStatus.lastNonEmptyAt}</Text>
                ) : null}
                {inventoryStatus?.lastError ? (
                  <Text style={{ color: '#f87171', fontSize: 12 }}>Error: {inventoryStatus.lastError}</Text>
                ) : null}
              </View>
            ) : null}
            {showInventoryCounts && objectInventory?.summaryBadges?.length ? (
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
          >
            <View style={{ gap: 12 }}>
              {relatedNews.map((item) => (
                <LaunchNewsCard
                  key={`news:${item.id}`}
                  article={{
                    title: item.title,
                    summary: item.summary,
                    url: item.url,
                    source: item.newsSite,
                    imageUrl: item.imageUrl,
                    publishedAt: item.publishedAt,
                    itemType: item.itemType,
                    authors: item.authors,
                    featured: item.featured
                  }}
                  theme={theme}
                  onPress={() => {
                    openTarget(item.url);
                  }}
                />
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
          >
            {missionStats?.cards?.length ? (
              <View style={{ gap: 10 }}>
                {missionStats.cards.map((card, index) => (
                  <MissionStoryCard key={card.id} card={card} accentIndex={index} />
                ))}
              </View>
            ) : null}
            {missionStats?.bonusInsights?.length ? (
              <SectionCard title="Bonus insights" compact>
                <View style={{ gap: 8 }}>
                  {missionStats.bonusInsights.map((insight) => (
                    <MissionInsightCard key={insight.label} insight={insight} />
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
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <MissionStatPill label={card.allTimeLabel} value={card.allTime == null ? 'TBD' : String(card.allTime)} />
                        <MissionStatPill label={card.yearLabel} value={card.year == null ? 'TBD' : String(card.year)} />
                      </View>
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

        {vehicleTimeline.length > 0 ? (
          <DetailModuleSection
            id="vehicle-timeline"
            title="Chrono-Helix vehicle timeline"
            description="Recent and upcoming flights for the same launch vehicle."
          >
            <View style={{ gap: 12 }}>
              {vehicleTimeline.map((item, index) => (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    if (!item.launchId || item.isCurrent) return;
                    router.push((`/launches/${item.launchId}`) as Href);
                  }}
                  disabled={!item.launchId || item.isCurrent}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    gap: 12,
                    opacity: pressed && !item.isCurrent ? 0.9 : 1
                  })}
                >
                  <View style={{ alignItems: 'center', width: 18 }}>
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        marginTop: 5,
                        backgroundColor: item.status === 'success' ? '#7ff0bc' : item.status === 'upcoming' ? theme.accent : '#ff9aab'
                      }}
                    />
                    {index < vehicleTimeline.length - 1 ? (
                      <View
                        style={{
                          width: 2,
                          flex: 1,
                          marginTop: 6,
                          backgroundColor: 'rgba(255, 255, 255, 0.08)'
                        }}
                      />
                    ) : null}
                  </View>
                  <View
                    style={{
                      flex: 1,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: item.isCurrent ? 'rgba(34, 211, 238, 0.28)' : theme.stroke,
                      backgroundColor: item.isCurrent ? 'rgba(34, 211, 238, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                      padding: 14,
                      gap: 6
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700', flex: 1 }}>{item.missionName}</Text>
                      <DetailChip label={item.isCurrent ? 'Current' : item.statusLabel || item.status} tone={item.isCurrent ? 'accent' : 'default'} />
                    </View>
                    <Text style={{ color: theme.muted, fontSize: 13 }}>
                      {[item.date ? formatTimestamp(item.date) : null, item.vehicleName].filter(Boolean).join(' • ')}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </DetailModuleSection>
        ) : null}

        {relatedEvents.length === 0 && relatedNews.length === 0 && detail.related.length > 0 ? (
          <DetailModuleSection
            id="related-coverage"
            title="Related coverage"
            description={`${detail.related.length} linked result${detail.related.length === 1 ? '' : 's'} surfaced for this launch.`}
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
        {faaMapPayload ? (
          <LaunchMapModal
            open={faaMapModalOpen}
            onClose={() => setFaaMapModalOpen(false)}
            payload={faaMapPayload}
            renderMode="faa"
            title="Launch zone map"
            description="Launch-day FAA polygons and launch pad context."
            externalMapHref={platformPadMapHref}
            externalMapLabel={Platform.OS === 'ios' ? 'Open in Apple Maps' : 'Open in Google Maps'}
            theme={theme}
          />
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
              void refreshDetail();
            }}
            tintColor={theme.accent}
          />
        }
      >
        {content}
      </AppScreen>
      {floatingTopBarNode}
      {followSheetNode}
      <LaunchCalendarSheet launch={calendarLaunch} open={calendarLaunch != null} onClose={() => setCalendarLaunch(null)} />
    </>
  );
}

function NativeLaunchMapPreview({
  payload,
  renderMode,
  theme,
  height,
  interactive
}: {
  payload: LaunchFaaAirspaceMapV1;
  renderMode: 'pad' | 'faa';
  theme: { stroke: string; foreground: string; muted: string };
  height: number;
  interactive: boolean;
}) {
  const mapViewProps = buildNativeLaunchMapViewProps(payload);

  return (
    <View
      style={{
        height,
        overflow: 'hidden',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.03)'
      }}
    >
      <TmzLaunchMapView
        style={{ flex: 1 }}
        advisoriesJson={mapViewProps.advisoriesJson}
        boundsJson={mapViewProps.boundsJson}
        padJson={mapViewProps.padJson}
        interactive={interactive}
        renderMode={renderMode}
      />
    </View>
  );
}

function LaunchMapModal({
  open,
  onClose,
  payload,
  renderMode,
  title,
  description,
  externalMapHref,
  externalMapLabel,
  theme
}: {
  open: boolean;
  onClose: () => void;
  payload: LaunchFaaAirspaceMapV1;
  renderMode: 'pad' | 'faa';
  title: string;
  description: string;
  externalMapHref: string | null;
  externalMapLabel: string;
  theme: { stroke: string; foreground: string; muted: string; accent: string };
}) {
  const mapViewProps = buildNativeLaunchMapViewProps(payload);

  return (
    <Modal visible={open} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(5, 6, 10, 0.92)', padding: 16, justifyContent: 'center' }}>
        <View
          style={{
            maxHeight: '88%',
            borderRadius: 24,
            borderWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: '#070913',
            overflow: 'hidden'
          }}
        >
          <View
            style={{
              paddingHorizontal: 16,
              paddingTop: 16,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderBottomColor: theme.stroke,
              gap: 10
            }}
          >
            <Text style={{ color: theme.foreground, fontSize: 18, fontWeight: '700' }}>{title}</Text>
            <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>{description}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {externalMapHref ? (
                <Pressable
                  onPress={() => {
                    void Linking.openURL(externalMapHref);
                  }}
                  style={{
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: theme.accent,
                    paddingHorizontal: 14,
                    paddingVertical: 8
                  }}
                >
                  <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>{externalMapLabel}</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={onClose}
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  paddingHorizontal: 14,
                  paddingVertical: 8
                }}
              >
                <Text style={{ color: theme.foreground, fontSize: 12, fontWeight: '700' }}>Close</Text>
              </Pressable>
            </View>
          </View>
          <View style={{ height: 440 }}>
            <TmzLaunchMapView
              style={{ flex: 1 }}
              advisoriesJson={mapViewProps.advisoriesJson}
              boundsJson={mapViewProps.boundsJson}
              padJson={mapViewProps.padJson}
              interactive
              renderMode={renderMode}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function buildNativeLaunchMapViewProps(payload: LaunchFaaAirspaceMapV1) {
  return {
    advisoriesJson: JSON.stringify(payload.advisories ?? []),
    boundsJson: payload.bounds ? JSON.stringify(payload.bounds) : null,
    padJson: JSON.stringify(payload.pad)
  };
}

function buildPadSatelliteMapPayload(launch: RichLaunchSummary): LaunchFaaAirspaceMapV1 {
  const latitude = typeof launch.pad.latitude === 'number' && Number.isFinite(launch.pad.latitude) ? launch.pad.latitude : null;
  const longitude = typeof launch.pad.longitude === 'number' && Number.isFinite(launch.pad.longitude) ? launch.pad.longitude : null;

  return {
    launchId: launch.id,
    generatedAt: launch.net || '1970-01-01T00:00:00.000Z',
    advisoryCount: 0,
    hasRenderableGeometry: false,
    pad: {
      latitude,
      longitude,
      label: launch.pad.shortCode || launch.pad.name || launch.name || 'Launch pad',
      shortCode: launch.pad.shortCode || null,
      locationName: launch.pad.locationName || launch.pad.name || null
    },
    bounds: null,
    advisories: []
  };
}

function formatFaaAdvisoryWindow(validStart: string | null, validEnd: string | null) {
  if (isDateOnlyUtcWindow(validStart, validEnd)) {
    return formatFaaDateOnlyWindow(validStart, validEnd);
  }

  const start = validStart ? formatTimestamp(validStart) : null;
  const end = validEnd ? formatTimestamp(validEnd) : null;
  if (start && end) return `${start} to ${end}`;
  if (start) return `Starts ${start}`;
  if (end) return `Ends ${end}`;
  return null;
}

function formatFaaDateOnlyWindow(validStart: string | null, validEnd: string | null) {
  if (!validStart) return null;

  const startLabel = formatUtcDateOnly(validStart);
  if (!validEnd) return startLabel;

  const endMs = Date.parse(validEnd);
  if (!Number.isFinite(endMs)) return startLabel;

  const lastDayLabel = formatUtcDateOnly(new Date(endMs - 1).toISOString());
  return startLabel === lastDayLabel ? startLabel : `${startLabel} to ${lastDayLabel}`;
}

function formatUtcDateOnly(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  }).format(new Date(value));
}

function isDateOnlyUtcWindow(validStart: string | null, validEnd: string | null) {
  if (!validStart || !validEnd) return false;
  const start = new Date(validStart);
  const end = new Date(validEnd);
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return false;

  const dayMs = 24 * 60 * 60 * 1000;
  return (
    start.getUTCHours() === 0 &&
    start.getUTCMinutes() === 0 &&
    start.getUTCSeconds() === 0 &&
    start.getUTCMilliseconds() === 0 &&
    end.getUTCHours() === 0 &&
    end.getUTCMinutes() === 0 &&
    end.getUTCSeconds() === 0 &&
    end.getUTCMilliseconds() === 0 &&
    (endMs - startMs) % dayMs === 0
  );
}

function LaunchDetailFloatingBar({
  top,
  net,
  onBack,
  onShare,
  onOpenCalendar,
  onOpenArTrajectory,
  showArButton,
  arButtonActive,
  arButtonDisabled
}: {
  top: number;
  net: string | null;
  onBack: () => void;
  onShare: () => void;
  onOpenCalendar: () => void;
  onOpenArTrajectory?: () => void;
  showArButton: boolean;
  arButtonActive: boolean;
  arButtonDisabled: boolean;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top,
        left: 20,
        right: 20,
        zIndex: 30
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: theme.stroke,
          backgroundColor: 'rgba(7, 9, 19, 0.86)',
          paddingLeft: 10,
          paddingRight: 10,
          paddingVertical: 8
        }}
      >
        <LaunchToolbarIconButton accessibilityLabel="Back" onPress={onBack} testID="launch-detail-back-button">
          <BackArrowGlyph color={theme.foreground} />
        </LaunchToolbarIconButton>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 1 }}>
          <Text style={{ color: theme.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' }}>
            <LiveLaunchCountdownPrefix net={net} /> countdown
          </Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            style={{
              color: theme.foreground,
              fontSize: 15,
              fontWeight: '800',
              lineHeight: 18,
              fontVariant: ['tabular-nums']
            }}
          >
            <LiveLaunchCountdownClock net={net} />
          </Text>
          <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 10, fontWeight: '700' }}>
            <LiveLaunchCountdownLabel net={net} />
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {showArButton ? (
            <LaunchToolbarIconButton
              accessibilityLabel={arButtonActive ? 'Open AR trajectory' : 'AR trajectory'}
              onPress={() => {
                onOpenArTrajectory?.();
              }}
              active={arButtonActive}
              disabled={arButtonDisabled}
            >
              <ArToolbarGlyph color={arButtonActive ? theme.accent : theme.foreground} />
            </LaunchToolbarIconButton>
          ) : null}
          <LaunchToolbarIconButton accessibilityLabel="Add to calendar" onPress={onOpenCalendar}>
            <CalendarPlusGlyph color={theme.foreground} />
          </LaunchToolbarIconButton>
          <LaunchShareIconButton
            onPress={onShare}
            size={38}
            iconColor={theme.foreground}
            borderColor={theme.stroke}
            backgroundColor="rgba(255, 255, 255, 0.03)"
            pressedBackgroundColor="rgba(255, 255, 255, 0.08)"
          />
        </View>
      </View>
    </View>
  );
}

function LaunchToolbarIconButton({
  accessibilityLabel,
  onPress,
  children,
  active = false,
  disabled = false,
  testID
}: {
  accessibilityLabel: string;
  onPress: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 38,
        height: 38,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? `${theme.accent}66` : theme.stroke,
        backgroundColor: active ? 'rgba(34, 211, 238, 0.12)' : 'rgba(255, 255, 255, 0.03)',
        opacity: disabled ? 0.42 : pressed ? 0.86 : 1
      })}
    >
      {children}
    </Pressable>
  );
}

function LiveLaunchCountdownPrefix({ net }: { net: string | null }) {
  const nowMs = useSharedNow();
  const snapshot = buildCountdownSnapshot(net ?? null, nowMs);

  if (!snapshot) {
    return 'NET';
  }

  return snapshot.isPast ? 'T+' : 'T-';
}

function BackArrowGlyph({ color }: { color: string }) {
  return (
    <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 7,
          height: 7,
          borderLeftWidth: 1.8,
          borderBottomWidth: 1.8,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
          marginLeft: 3
        }}
      />
    </View>
  );
}

function CalendarPlusGlyph({ color }: { color: string }) {
  return (
    <View style={{ width: 18, height: 18 }}>
      <View
        style={{
          position: 'absolute',
          top: 2,
          left: 2,
          right: 2,
          bottom: 2,
          borderWidth: 1.6,
          borderColor: color,
          borderRadius: 4
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 2,
          left: 2,
          right: 2,
          height: 4,
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
          backgroundColor: color
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 0.5,
          left: 5,
          width: 1.8,
          height: 4,
          borderRadius: 999,
          backgroundColor: color
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 0.5,
          right: 5,
          width: 1.8,
          height: 4,
          borderRadius: 999,
          backgroundColor: color
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: -1,
          top: -1,
          width: 8,
          height: 8,
          borderRadius: 999,
          backgroundColor: 'rgba(34, 211, 238, 0.18)',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <View style={{ position: 'absolute', width: 4.5, height: 1.4, borderRadius: 999, backgroundColor: color }} />
        <View style={{ position: 'absolute', width: 1.4, height: 4.5, borderRadius: 999, backgroundColor: color }} />
      </View>
    </View>
  );
}

function ArToolbarGlyph({ color }: { color: string }) {
  return (
    <View style={{ minWidth: 18, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color, fontSize: 15, lineHeight: 16, fontWeight: '900', letterSpacing: 0.7 }}>AR</Text>
    </View>
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
  detail,
  disabled = false,
  onPress
}: {
  label: string;
  active: boolean;
  detail?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
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
      {detail ? (
        <View
          style={{
            borderRadius: 999,
            backgroundColor: active ? 'rgba(34, 211, 238, 0.18)' : 'rgba(255, 255, 255, 0.08)',
            paddingHorizontal: 7,
            paddingVertical: 3
          }}
        >
          <Text style={{ color: active ? theme.accent : theme.foreground, fontSize: 10, fontWeight: '800' }}>{detail}</Text>
        </View>
      ) : null}
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
  defaultExpanded = true,
  collapsible = true
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
  defaultExpanded?: boolean;
  collapsible?: boolean;
}) {
  const { theme } = useMobileBootstrap();

  if (!collapsible) {
    return (
      <View
        style={{
          borderRadius: 24,
          borderWidth: 1,
          borderColor: theme.stroke,
          backgroundColor: 'rgba(11, 16, 35, 0.84)',
          overflow: 'hidden',
        }}
      >
        <View style={{ padding: 20 }}>
          <Text
            style={{
              fontSize: 20,
              fontWeight: '700',
              color: theme.foreground,
            }}
          >
            {title}
          </Text>
          {description ? (
            <Text
              style={{
                marginTop: 6,
                fontSize: 13,
                color: theme.muted,
              }}
            >
              {description}
            </Text>
          ) : null}
        </View>
        <View style={{ padding: 20, paddingTop: 0 }}>
          {children}
        </View>
      </View>
    );
  }

  return (
    <View>
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

function FaaNoticeCard({
  advisory,
  expandedRawText,
  onToggleRawText
}: {
  advisory: LaunchFaaAirspaceAdvisoryView;
  expandedRawText: boolean;
  onToggleRawText: () => void;
}) {
  const { theme } = useMobileBootstrap();
  const advisoryWindowLabel = formatFaaAdvisoryWindow(advisory.validStart, advisory.validEnd);
  const rawTextAvailable = Boolean(advisory.rawText);
  const noticeSummary = buildFaaNoticeSummary(advisory, advisoryWindowLabel);
  const noticePreview = buildFaaNoticePreview(advisory.rawText);
  const factItems: FactGridItem[] = [
    { label: 'Notice', value: advisory.notamId || 'FAA notice' },
    { label: 'Window', value: advisoryWindowLabel || 'Official schedule pending' },
    { label: 'Facility', value: [advisory.facility, advisory.state].filter(Boolean).join(', ') || 'FAA' },
    { label: 'Coverage', value: formatFaaCoverageLabel(advisory.shapeCount, advisory.hasShape) },
    { label: 'Launch overlap', value: formatFaaOverlapLabel(advisory.matchStatus, advisory.matchConfidence) }
  ];

  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        padding: 14,
        gap: 12
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{advisory.title}</Text>
          <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>{noticeSummary}</Text>
        </View>
        <DetailChip label={advisory.isActiveNow ? 'Active now' : formatFaaStatusLabel(advisory.status)} tone={advisory.isActiveNow ? 'accent' : 'default'} />
      </View>

      <FactGrid items={factItems} />

      {noticePreview ? (
        <View
          style={{
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            padding: 12,
            gap: 6
          }}
        >
          <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>
            Restriction summary
          </Text>
          <Text style={{ color: theme.foreground, fontSize: 13, lineHeight: 20 }}>{noticePreview}</Text>
        </View>
      ) : null}

      {rawTextAvailable ? (
        <View
          style={{
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            padding: 12,
            gap: 8
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: theme.foreground, fontSize: 13, fontWeight: '700' }}>Official notice text</Text>
              <Text style={{ color: theme.muted, fontSize: 12 }}>
                {advisory.rawTextFetchedAt ? `Saved ${formatTimestamp(advisory.rawTextFetchedAt)}` : 'Saved FAA detail cache'}
              </Text>
            </View>
            <Pressable onPress={onToggleRawText}>
              <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>
                {expandedRawText ? 'Hide text' : 'View text'}
              </Text>
            </Pressable>
          </View>
          {expandedRawText ? (
            <Text
              selectable
              style={{
                color: theme.foreground,
                fontSize: 12,
                lineHeight: 18,
                fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace'
              }}
            >
              {advisory.rawText}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {advisory.sourceGraphicUrl || advisory.sourceUrl ? (
          <Pressable
            onPress={() => {
              void openExternalCustomerUrl(advisory.sourceGraphicUrl || advisory.sourceUrl || '');
            }}
          >
            <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>
              {advisory.sourceGraphicUrl ? 'Open FAA graphic page' : 'View FAA source'}
            </Text>
          </Pressable>
        ) : null}
        {!rawTextAvailable && advisory.sourceRawUrl && advisory.sourceRawUrl !== advisory.sourceGraphicUrl && advisory.sourceRawUrl !== advisory.sourceUrl ? (
          <Pressable
            onPress={() => {
              void openExternalCustomerUrl(advisory.sourceRawUrl || '');
            }}
          >
            <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '700' }}>View official notice text</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function buildFaaNoticeSummary(advisory: LaunchFaaAirspaceAdvisoryView, advisoryWindowLabel: string | null) {
  const facilityLabel = [advisory.facility, advisory.state].filter(Boolean).join(', ') || 'the FAA';
  const overlapLabel = formatFaaOverlapSummary(advisory.matchStatus, advisory.matchConfidence);
  const windowLabel = advisoryWindowLabel ? ` Window: ${advisoryWindowLabel}.` : '';
  return `${facilityLabel} has a ${advisory.title.toLowerCase()} notice tied to this launch. ${overlapLabel}.${windowLabel}`;
}

function buildFaaNoticePreview(rawText: string | null | undefined) {
  const normalized = normalizeFaaNoticeText(rawText);
  if (!normalized) return null;

  const withoutHeader = normalized
    .replace(/^!FDC\s+\S+\s+[A-Z]{2,4}\s+[A-Z]{2}\.\.?/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!withoutHeader) return null;

  if (withoutHeader.length <= 220) {
    return withoutHeader;
  }

  return `${withoutHeader.slice(0, 217).trimEnd()}...`;
}

function MissionStoryCard({
  card,
  accentIndex
}: {
  card: NonNullable<LaunchDetailV1['missionStats']>['cards'][number];
  accentIndex: number;
}) {
  const { theme } = useMobileBootstrap();
  const accentPalette = [
    { border: 'rgba(34, 211, 238, 0.24)', background: 'rgba(34, 211, 238, 0.08)' },
    { border: 'rgba(52, 211, 153, 0.24)', background: 'rgba(52, 211, 153, 0.08)' },
    { border: 'rgba(251, 146, 60, 0.24)', background: 'rgba(251, 146, 60, 0.08)' }
  ];
  const accent = accentPalette[accentIndex % accentPalette.length];

  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: accent.border,
        backgroundColor: accent.background,
        padding: 14,
        gap: 8
      }}
    >
      <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{card.eyebrow}</Text>
      <Text style={{ color: theme.foreground, fontSize: 17, fontWeight: '800' }}>{card.title}</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <MissionStatPill label={card.allTimeLabel} value={card.allTime == null ? 'TBD' : String(card.allTime)} />
        <MissionStatPill label={card.yearLabel} value={card.year == null ? 'TBD' : String(card.year)} />
      </View>
      <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>{card.story}</Text>
    </View>
  );
}

function MissionInsightCard({
  insight
}: {
  insight: NonNullable<LaunchDetailV1['missionStats']>['bonusInsights'][number];
}) {
  const { theme } = useMobileBootstrap();

  return (
    <View
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
  );
}

function MissionStatPill({ label, value }: { label: string; value: string }) {
  const { theme } = useMobileBootstrap();

  return (
    <View
      style={{
        flex: 1,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        padding: 12,
        gap: 4
      }}
    >
      <Text style={{ color: theme.muted, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '800' }}>{value}</Text>
    </View>
  );
}

function normalizeFaaNoticeText(value: string | null | undefined) {
  const normalized = String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
  return normalized.length ? normalized : null;
}

function formatFaaCoverageLabel(shapeCount: number, hasShape: boolean) {
  if (shapeCount > 0) {
    return `${shapeCount} mapped area${shapeCount === 1 ? '' : 's'}`;
  }
  return hasShape ? 'Restricted area' : 'Notice only';
}

function formatFaaOverlapLabel(matchStatus: LaunchFaaAirspaceAdvisoryView['matchStatus'], matchConfidence: number | null) {
  switch (matchStatus) {
    case 'matched':
      return typeof matchConfidence === 'number' && matchConfidence >= 90 ? 'Confirmed' : 'Likely';
    case 'ambiguous':
      return 'Possible';
    case 'manual':
      return 'Manual review';
    default:
      return 'Unknown';
  }
}

function formatFaaOverlapSummary(matchStatus: LaunchFaaAirspaceAdvisoryView['matchStatus'], matchConfidence: number | null) {
  switch (matchStatus) {
    case 'matched':
      return typeof matchConfidence === 'number' && matchConfidence >= 90
        ? 'This looks like a confirmed overlap with the launch window'
        : 'This looks like a likely overlap with the launch window';
    case 'ambiguous':
      return 'This may overlap the launch window';
    case 'manual':
      return 'This was attached by manual review';
    default:
      return 'This notice is linked to the launch';
  }
}

function formatFaaStatusLabel(status: LaunchFaaAirspaceAdvisoryView['status']) {
  switch (status) {
    case 'active':
      return 'Active';
    case 'expired':
      return 'Expired';
    case 'manual':
      return 'Manual';
    default:
      return status;
  }
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
  const handleShare = () => {
    void shareLaunch(buildLaunchShareInput(legacyLaunch));
  };

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
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <DetailChip label={(legacyLaunch.status || 'Status pending').toUpperCase()} tone="accent" />
            {legacyLaunch.provider ? <DetailChip label={legacyLaunch.provider.toUpperCase()} /> : null}
          </View>
          <LaunchShareIconButton
            onPress={handleShare}
            size={38}
            iconColor={theme.accent}
            borderColor={theme.stroke}
            backgroundColor="rgba(255, 255, 255, 0.03)"
            pressedBackgroundColor="rgba(255, 255, 255, 0.08)"
          />
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
  const generatedAtLabel = arTrajectory.generatedAt ? formatTimestamp(arTrajectory.generatedAt) : null;

  let actionLabel = 'Open AR trajectory';
  let disabled = false;
  let onPress = () => {
    if (isIos || isAndroid) {
      router.push((`/launches/ar/${launchId}`) as Href);
    }
  };

  if (!isIos && !isAndroid) {
    actionLabel = 'AR unavailable';
    disabled = true;
    onPress = () => undefined;
  } else if (!canUseArTrajectory) {
    actionLabel = 'Upgrade for AR';
    onPress = () => {
      router.push('/profile');
    };
  } else if (isUnavailable) {
    actionLabel = 'AR unavailable';
    disabled = true;
    onPress = () => undefined;
  } else if (isPending) {
    actionLabel = 'Trajectory pending';
    disabled = true;
    onPress = () => undefined;
  }

  const cardContent = (
    <SectionCard
      title="AR trajectory"
      description={buildArTrajectoryDescription(arTrajectory, canUseArTrajectory, isIos, isAndroid)}
      body={generatedAtLabel ? `Latest trajectory package generated ${generatedAtLabel}.` : undefined}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12
        }}
      >
        <Text
          style={{
            flex: 1,
            color: disabled ? theme.muted : canUseArTrajectory ? theme.accent : theme.foreground,
            fontSize: 14,
            fontWeight: '700'
          }}
        >
          {actionLabel}
        </Text>
        {!disabled ? (
          <Text style={{ color: canUseArTrajectory ? theme.accent : theme.foreground, fontSize: 18, fontWeight: '700' }}>
            →
          </Text>
        ) : null}
      </View>
    </SectionCard>
  );

  if (disabled) {
    return <View style={{ opacity: 0.68 }}>{cardContent}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={actionLabel}
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.9 : 1
      })}
    >
      {cardContent}
    </Pressable>
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

  if (previewUrl) {
    return (
      <LaunchMediaLightboxCard
        imageUrl={previewUrl}
        title={resource.label}
        sourceUrl={resource.url}
        accessibilityLabel={`Open ${resource.label}`}
      />
    );
  }

  return (
    <Pressable
      onPress={() => {
        void openExternalCustomerUrl(resource.url);
      }}
      style={({ pressed }) => ({
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        overflow: 'hidden',
        opacity: pressed ? 0.9 : 1
      })}
    >
      <View style={{ padding: 14, gap: 6 }}>
        <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{resource.label}</Text>
        <Text style={{ color: theme.muted, fontSize: 13 }}>
          {[formatExternalContentKindLabel(resource.kind), formatUrlHost(resource.url)].filter(Boolean).join(' • ') || 'SpaceX content'}
        </Text>
      </View>
    </Pressable>
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

function normalizePlatformExternalLinks(externalLinks: ExternalLinkView[], launch: RichLaunchSummary, platformOs: string): ExternalLinkView[] {
  if (platformOs !== 'ios') {
    return externalLinks;
  }

  const appleMapsUrl = buildAppleMapsSatelliteUrl({
    latitude: launch.pad.latitude,
    longitude: launch.pad.longitude,
    label: launch.pad.shortCode || launch.pad.name || launch.name || 'Launch pad'
  });
  if (!appleMapsUrl) {
    return externalLinks;
  }

  return externalLinks.map((item) => {
    if (!isLaunchPadMapLink(item)) {
      return item;
    }
    return {
      ...item,
      url: appleMapsUrl,
      host: formatUrlHost(appleMapsUrl)
    };
  });
}

function isLaunchPadMapLink(item: ExternalLinkView) {
  if (normalizeTextValue(item.kind)?.toLowerCase() === 'map') {
    return true;
  }

  const normalizedUrl = normalizeUrlString(item.url);
  if (!normalizedUrl) {
    return false;
  }

  try {
    const url = new URL(normalizedUrl);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    return (host === 'google.com' || host.endsWith('.google.com')) && url.pathname.toLowerCase().startsWith('/maps/');
  } catch {
    return false;
  }
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

function buildLaunchShareInput(launch: LaunchSummary): LaunchShareInput {
  if (isRichLaunchSummary(launch)) {
    return {
      id: launch.id,
      name: launch.name,
      net: launch.net,
      provider: launch.provider,
      vehicle: launch.vehicle || launch.rocket?.fullName,
      statusText: launch.statusText,
      status: launch.status,
      padLabel: launch.pad.shortCode || launch.pad.name,
      padLocation: launch.pad.locationName || launch.pad.state
    };
  }

  return {
    id: launch.id,
    name: launch.name,
    net: launch.net,
    provider: launch.provider,
    vehicle: launch.rocketName,
    statusText: launch.launchStatusDescription,
    status: launch.status,
    padLabel: launch.padName,
    padLocation: launch.padLocation
  };
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

function normalizeLaunchDetailText(value: string | null | undefined) {
  return isUnknownEntityLabel(value) ? null : String(value || '').trim() || null;
}

function formatLegacyRecoveryRole(role: string | null | undefined) {
  if (role === 'booster') return 'Booster';
  if (role === 'spacecraft') return 'Spacecraft';
  return null;
}

function buildLegacyRecoveryTitle(entry: {
  title?: string | null;
  landingLocationName?: string | null;
  returnSite?: string | null;
}) {
  return (
    normalizeLaunchDetailText(entry.title) ||
    normalizeLaunchDetailText(entry.landingLocationName) ||
    normalizeLaunchDetailText(entry.returnSite) ||
    'Recovery detail'
  );
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
