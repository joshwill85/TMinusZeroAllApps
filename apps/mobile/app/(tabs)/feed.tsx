import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSegments } from 'expo-router';
import type { Href } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { ApiClientError, type LaunchFeedRequest, type LaunchFeedV1 } from '@tminuszero/api-client';
import { AppState, FlatList, Image, InteractionManager, Pressable, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DEFAULT_LAUNCH_FILTERS,
  areLaunchFilterValuesEqual,
  buildPendingFeedRefreshMessage,
  canAutoRefreshActiveSurface,
  countActiveLaunchFilters,
  formatLaunchFilterLocationOptionLabel,
  formatLaunchFilterStatusLabel,
  getNextAlignedRefreshMs,
  getVisibleFeedUpdatedAt,
  normalizeLaunchFilterValue,
  shouldPrimeVersionRefresh,
  type LaunchFilterOptions,
  type LaunchFilterValue
} from '@tminuszero/domain';
import { buildLaunchHref, buildSearchHref } from '@tminuszero/navigation';
import {
  prefetchLaunchDetail,
  useCreateWatchlistMutation,
  useCreateWatchlistRuleMutation,
  useCreateFilterPresetMutation,
  useDeleteMobilePushRuleMutation,
  useDeleteWatchlistRuleMutation,
  fetchLaunchFeedVersion,
  useFilterPresetsQuery,
  useLaunchFeedQuery,
  useLaunchFilterOptionsQuery,
  useMobilePushRulesQuery,
  useUpsertMobilePushLaunchPreferenceMutation,
  useUpdateFilterPresetMutation,
  useViewerEntitlementsQuery,
  useViewerSessionQuery,
  useWatchlistsQuery
} from '@/src/api/queries';
import { EmptyStateCard, ErrorStateCard } from '@/src/components/SectionCard';
import { useApiClient } from '@/src/api/client';
import { LaunchAlertsPanel } from '@/src/components/LaunchAlertsPanel';
import { LaunchFollowSheet, type LaunchFollowSheetOption } from '@/src/components/LaunchFollowSheet';
import { LaunchFilterSheet } from '@/src/components/LaunchFilterSheet';
import { WebParityLaunchCard, WebParityLaunchCardSkeleton } from '@/src/components/WebParityLaunchCard';
import { MOBILE_DOCK_BOTTOM_OFFSET, MOBILE_DOCK_CONTENT_GAP, MOBILE_DOCK_HEIGHT, shouldShowCustomerDock } from '@/src/components/mobileShell';
import type { FeedLaunchCardData } from '@/src/feed/feedCardData';
import { toFeedLaunchCardData } from '@/src/feed/feedCardData';
import { readPublicFeedSnapshot, writePublicFeedSnapshot } from '@/src/feed/feedSnapshotStorage';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { useMobileToast } from '@/src/providers/MobileToastProvider';
import { useMobilePush } from '@/src/providers/MobilePushProvider';
import { getProgramHubEntryOrCoreHref } from '@/src/features/programHubs/rollout';
import {
  buildLaunchSiteRuleValue,
  buildPadRuleValue,
  buildRocketRuleValue,
  buildStateRuleValue,
  formatLaunchSiteRuleLabel,
  formatPadRuleLabel,
  formatRocketRuleLabel,
  formatStateRuleLabel,
  resolvePrimaryWatchlist
} from '@/src/watchlists/usePrimaryWatchlist';
import artemisProgramLogo from '../../assets/program-logos/artemis-nasa-official.png';
import spacexProgramLogo from '../../assets/program-logos/spacex-official.png';
import blueOriginProgramLogo from '../../assets/program-logos/blueorigin-official.png';

type PendingFeedRefresh = {
  version: string;
  matchCount: number;
  updatedAt: string | null;
};

export default function FeedScreen() {
  const router = useRouter();
  const segments = useSegments();
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { accessToken, theme } = useMobileBootstrap();
  const { showToast } = useMobileToast();
  const { installationId, deviceSecret, isRegistered: isPushRegistered } = useMobilePush();
  const { baseUrl, client } = useApiClient();
  const viewerSessionQuery = useViewerSessionQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const watchlistsQuery = useWatchlistsQuery();
  const filterPresetsQuery = useFilterPresetsQuery();
  const createWatchlistMutation = useCreateWatchlistMutation();
  const createWatchlistRuleMutation = useCreateWatchlistRuleMutation();
  const deleteWatchlistRuleMutation = useDeleteWatchlistRuleMutation();
  const mobilePushContext = installationId ? { installationId, deviceSecret } : null;
  const mobilePushRulesQuery = useMobilePushRulesQuery(mobilePushContext, { enabled: Boolean(mobilePushContext?.installationId) });
  const upsertLaunchNotificationMutation = useUpsertMobilePushLaunchPreferenceMutation();
  const deleteMobilePushRuleMutation = useDeleteMobilePushRuleMutation();
  const createFilterPresetMutation = useCreateFilterPresetMutation();
  const updateFilterPresetMutation = useUpdateFilterPresetMutation();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<LaunchFilterValue>({ ...DEFAULT_LAUNCH_FILTERS });
  const [activePresetId, setActivePresetId] = useState('');
  const [feedMode, setFeedMode] = useState<'for-you' | 'following'>('for-you');
  const [followBusy, setFollowBusy] = useState<Record<string, boolean>>({});
  const [didAttemptEnsureWatchlist, setDidAttemptEnsureWatchlist] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning'; message: string } | null>(null);
  const [pendingRefresh, setPendingRefresh] = useState<PendingFeedRefresh | null>(null);
  const [refreshApplying, setRefreshApplying] = useState(false);
  const [appStateStatus, setAppStateStatus] = useState(AppState.currentState);
  const [followLaunch, setFollowLaunch] = useState<FeedLaunchCardData | null>(null);
  const [cachedLaunches, setCachedLaunches] = useState<FeedLaunchCardData[]>([]);
  const [snapshotHydrated, setSnapshotHydrated] = useState(false);
  const [deferredMediaReady, setDeferredMediaReady] = useState(false);
  const didApplyInitialDefaultPresetRef = useRef(false);
  const lastSeenVersionRef = useRef<string | null>(null);
  const canUseLaunchFilters = entitlementsQuery.data?.capabilities.canUseLaunchFilters ?? false;
  const canManageFilterPresets = entitlementsQuery.data?.capabilities.canManageFilterPresets ?? false;
  const canUseSavedItems = entitlementsQuery.data?.capabilities.canUseSavedItems ?? false;
  const canUseSingleLaunchFollow = entitlementsQuery.data?.capabilities.canUseSingleLaunchFollow ?? false;
  const canUseAllUsLaunchAlerts = entitlementsQuery.data?.capabilities.canUseAllUsLaunchAlerts ?? false;
  const watchlistRuleLimit = entitlementsQuery.data?.limits.watchlistRuleLimit ?? null;
  const singleLaunchFollowLimit = Math.max(1, entitlementsQuery.data?.limits.singleLaunchFollowLimit ?? 1);
  const refreshIntervalMs = (entitlementsQuery.data?.refreshIntervalSeconds ?? 7200) * 1000;
  const feedScope = entitlementsQuery.data?.mode === 'live' ? 'live' : 'public';
  const isAuthed = entitlementsQuery.data?.isAuthed ?? Boolean(accessToken);
  const watchlists = useMemo(() => watchlistsQuery.data?.watchlists ?? [], [watchlistsQuery.data?.watchlists]);
  const primaryWatchlist = useMemo(() => resolvePrimaryWatchlist(watchlists), [watchlists]);
  const primaryWatchlistId = primaryWatchlist?.id ?? null;
  const isFollowingFeed = feedMode === 'following' && Boolean(primaryWatchlistId) && canUseSavedItems;
  const watchlistsLoading = canUseSavedItems && (watchlistsQuery.isPending || createWatchlistMutation.isPending);
  const watchlistsError =
    canUseSavedItems && watchlistsQuery.isError
      ? watchlistsQuery.error instanceof Error
        ? watchlistsQuery.error.message
        : 'Unable to load My Launches.'
      : null;
  const watchlistRuleIdsByLaunchId = useMemo(
    () =>
      Object.fromEntries(
        (primaryWatchlist?.rules ?? [])
          .filter((rule) => rule.ruleType === 'launch' && rule.id)
          .map((rule) => [String(rule.ruleValue || '').trim(), rule.id])
      ),
    [primaryWatchlist?.rules]
  );
  const providerRuleIdsByValue = useMemo(
    () =>
      Object.fromEntries(
        (primaryWatchlist?.rules ?? [])
          .filter((rule) => rule.ruleType === 'provider' && rule.id)
          .map((rule) => [String(rule.ruleValue || '').trim().toLowerCase(), rule.id])
      ),
    [primaryWatchlist?.rules]
  );
  const padRuleIdsByValue = useMemo(
    () =>
      Object.fromEntries(
        (primaryWatchlist?.rules ?? [])
          .filter((rule) => rule.ruleType === 'pad' && rule.id)
          .map((rule) => [String(rule.ruleValue || '').trim().toLowerCase(), rule.id])
      ),
    [primaryWatchlist?.rules]
  );
  const rocketRuleIdsByValue = useMemo(
    () =>
      Object.fromEntries(
        (primaryWatchlist?.rules ?? [])
          .filter((rule) => rule.ruleType === 'rocket' && rule.id)
          .map((rule) => [String(rule.ruleValue || '').trim().toLowerCase(), rule.id])
      ),
    [primaryWatchlist?.rules]
  );
  const launchSiteRuleIdsByValue = useMemo(
    () =>
      Object.fromEntries(
        (primaryWatchlist?.rules ?? [])
          .filter((rule) => rule.ruleType === 'launch_site' && rule.id)
          .map((rule) => [String(rule.ruleValue || '').trim().toLowerCase(), rule.id])
      ),
    [primaryWatchlist?.rules]
  );
  const stateRuleIdsByValue = useMemo(
    () =>
      Object.fromEntries(
        (primaryWatchlist?.rules ?? [])
          .filter((rule) => rule.ruleType === 'state' && rule.id)
          .map((rule) => [String(rule.ruleValue || '').trim().toLowerCase(), rule.id])
      ),
    [primaryWatchlist?.rules]
  );
  const feedRequest = useMemo<LaunchFeedRequest>(
    () => ({
      scope: isFollowingFeed ? 'watchlist' : feedScope,
      watchlistId: isFollowingFeed ? primaryWatchlistId : null,
      range: filters.range ?? DEFAULT_LAUNCH_FILTERS.range,
      region: filters.region ?? DEFAULT_LAUNCH_FILTERS.region,
      location: filters.location ?? null,
      state: filters.state ?? null,
      pad: filters.pad ?? null,
      provider: filters.provider ?? null,
      sort: filters.sort ?? DEFAULT_LAUNCH_FILTERS.sort,
      status: filters.status && filters.status !== 'all' ? filters.status : null
    }),
    [
      feedScope,
      filters.location,
      filters.pad,
      filters.provider,
      filters.range,
      filters.region,
      filters.sort,
      filters.state,
      filters.status,
      isFollowingFeed,
      primaryWatchlistId
    ]
  );
  const filterOptionsQuery = useLaunchFilterOptionsQuery(
    {
      mode: feedScope,
      range: filters.range ?? DEFAULT_LAUNCH_FILTERS.range,
      region: filters.region ?? DEFAULT_LAUNCH_FILTERS.region,
      location: filters.location ?? null,
      state: filters.state ?? null,
      pad: filters.pad ?? null,
      provider: filters.provider ?? null,
      status: filters.status && filters.status !== 'all' ? filters.status : null
    },
    { enabled: canUseLaunchFilters && filtersOpen }
  );
  const filterOptions = useMemo<LaunchFilterOptions>(
    () =>
      filterOptionsQuery.data ?? {
        providers: [],
        locations: [],
        states: [],
        pads: [],
        statuses: []
      },
    [filterOptionsQuery.data]
  );
  const presetList = useMemo(
    () =>
      (!canManageFilterPresets ? [] : filterPresetsQuery.data?.presets ?? [])
        .map((preset) => {
          const id = String(preset.id || '').trim();
          if (!id) return null;
          return {
            id,
            name: String(preset.name || '').trim() || 'Saved view',
            filters: normalizeLaunchFilterValue(preset.filters),
            isDefault: preset.isDefault === true
          };
        })
        .filter((preset): preset is { id: string; name: string; filters: LaunchFilterValue; isDefault: boolean } => preset != null),
    [canManageFilterPresets, filterPresetsQuery.data]
  );
  const activeFilterCount = countActiveLaunchFilters(filters);
  const showsInternationalLaunches = (filters.region ?? DEFAULT_LAUNCH_FILTERS.region) !== 'us';
  const launchFeedQuery = useLaunchFeedQuery(feedRequest, {
    staleTimeMs: refreshIntervalMs
  });
  const launches = useMemo(() => launchFeedQuery.data?.pages.flatMap((page) => page.launches) ?? [], [launchFeedQuery.data?.pages]);
  const shouldHydratePublicSnapshot = feedRequest.scope === 'public';
  const feedSnapshotKey = useMemo(
    () =>
      JSON.stringify({
        scope: feedRequest.scope,
        range: feedRequest.range ?? DEFAULT_LAUNCH_FILTERS.range,
        region: feedRequest.region ?? DEFAULT_LAUNCH_FILTERS.region,
        location: feedRequest.location ?? null,
        state: feedRequest.state ?? null,
        pad: feedRequest.pad ?? null,
        provider: feedRequest.provider ?? null,
        sort: feedRequest.sort ?? DEFAULT_LAUNCH_FILTERS.sort,
        status: feedRequest.status ?? null
      }),
    [
      feedRequest.location,
      feedRequest.pad,
      feedRequest.provider,
      feedRequest.range,
      feedRequest.region,
      feedRequest.scope,
      feedRequest.sort,
      feedRequest.state,
      feedRequest.status
    ]
  );
  const hasResolvedLiveFeed = launchFeedQuery.isSuccess || launchFeedQuery.isError;
  const renderedLaunches = useMemo<FeedLaunchCardData[]>(
    () => (launches.length > 0 ? launches.map((launch) => toFeedLaunchCardData(launch)) : !hasResolvedLiveFeed && cachedLaunches.length > 0 ? cachedLaunches : []),
    [cachedLaunches, hasResolvedLiveFeed, launches]
  );
  const nextLaunch = renderedLaunches[0] ?? null;
  const activePreset = presetList.find((preset) => preset.id === activePresetId) ?? null;
  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    if ((filters.range ?? DEFAULT_LAUNCH_FILTERS.range) !== DEFAULT_LAUNCH_FILTERS.range) {
      labels.push(filters.range === '7d' ? 'Next 7 days' : filters.range === 'month' ? 'Next 30 days' : filters.range === 'today' ? 'Today' : filters.range === 'past' ? 'Past launches' : filters.range === 'all' ? 'All time' : 'Next 12 months');
    }
    if ((filters.region ?? DEFAULT_LAUNCH_FILTERS.region) !== DEFAULT_LAUNCH_FILTERS.region) {
      labels.push(filters.region === 'all' ? 'All locations' : filters.region === 'non-us' ? 'Non-US' : 'US only');
    }
    if ((filters.sort ?? DEFAULT_LAUNCH_FILTERS.sort) !== DEFAULT_LAUNCH_FILTERS.sort) {
      labels.push(filters.sort === 'latest' ? 'Newest first' : 'Recently updated');
    }
    if (filters.location) labels.push(formatLaunchFilterLocationOptionLabel(filters.location));
    if (filters.state) labels.push(filters.state);
    if (filters.provider) labels.push(filters.provider);
    if (filters.pad) labels.push(filters.pad);
    if (filters.status && filters.status !== 'all') labels.push(formatLaunchFilterStatusLabel(filters.status));
    return labels;
  }, [filters]);
  const latestFeedStateRef = useRef<{
    feedScope: 'public' | 'live';
    filters: LaunchFilterValue;
    launches: LaunchFeedV1['launches'];
    isFollowingFeed: boolean;
  }>({
    feedScope,
    filters,
    launches,
    isFollowingFeed
  });
  latestFeedStateRef.current = {
    feedScope,
    filters,
    launches,
    isFollowingFeed
  };
  const pendingRefreshMessage = useMemo(() => {
    if (!pendingRefresh) {
      return null;
    }
    return buildPendingFeedRefreshMessage({
      matchCount: pendingRefresh.matchCount,
      visibleCount: renderedLaunches.length,
      canCompareCount: !launchFeedQuery.hasNextPage
    });
  }, [launchFeedQuery.hasNextPage, pendingRefresh, renderedLaunches.length]);
  const canAutoRefreshFeed = canAutoRefreshActiveSurface({
    isFocused,
    appStateStatus,
    blocked: isFollowingFeed
  });
  const showDock = shouldShowCustomerDock(segments);
  const contentBottomPadding = showDock
    ? insets.bottom + MOBILE_DOCK_HEIGHT + MOBILE_DOCK_BOTTOM_OFFSET + MOBILE_DOCK_CONTENT_GAP
    : Math.max(insets.bottom + 24, 40);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppStateStatus(nextState);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    lastSeenVersionRef.current = null;
    setPendingRefresh(null);
  }, [feedMode, feedScope, filters, isFollowingFeed, primaryWatchlistId]);

  useEffect(() => {
    if (canUseLaunchFilters) return;
    didApplyInitialDefaultPresetRef.current = false;
    setActivePresetId('');
    setFilters((current) => (areLaunchFilterValuesEqual(current, DEFAULT_LAUNCH_FILTERS) ? current : { ...DEFAULT_LAUNCH_FILTERS }));
  }, [canUseLaunchFilters]);

  useEffect(() => {
    if (canManageFilterPresets) return;
    didApplyInitialDefaultPresetRef.current = false;
    setActivePresetId('');
  }, [canManageFilterPresets]);

  useEffect(() => {
    if (!canManageFilterPresets) return;
    const defaultPreset = presetList.find((preset) => preset.isDefault) ?? null;
    if (defaultPreset?.id) {
      setActivePresetId(defaultPreset.id);
    }
    if (!didApplyInitialDefaultPresetRef.current && defaultPreset) {
      setFilters((current) => (areLaunchFilterValuesEqual(current, defaultPreset.filters) ? current : defaultPreset.filters));
      didApplyInitialDefaultPresetRef.current = true;
    }
  }, [canManageFilterPresets, presetList]);

  useEffect(() => {
    if (!activePresetId) return;
    const preset = presetList.find((candidate) => candidate.id === activePresetId);
    if (!preset) {
      setActivePresetId('');
      return;
    }
    if (!areLaunchFilterValuesEqual(filters, preset.filters)) {
      setActivePresetId('');
    }
  }, [activePresetId, filters, presetList]);

  useEffect(() => {
    if (canUseSavedItems) {
      return;
    }
    setFeedMode('for-you');
  }, [canUseSavedItems]);

  useEffect(() => {
    if (!accessToken || !canUseSavedItems) {
      setDidAttemptEnsureWatchlist(false);
      return;
    }
    if (watchlists.length > 0) {
      setDidAttemptEnsureWatchlist(false);
    }
  }, [accessToken, canUseSavedItems, watchlists.length]);

  useEffect(() => {
    if (!accessToken || !canUseSavedItems) {
      return;
    }
    if (!watchlistsQuery.isSuccess || watchlists.length > 0 || didAttemptEnsureWatchlist || createWatchlistMutation.isPending) {
      return;
    }

    setDidAttemptEnsureWatchlist(true);
    void createWatchlistMutation.mutateAsync({}).catch((error) => {
      setNotice({
        tone: 'warning',
        message: buildWatchlistRuleErrorMessage(error, 'My Launches', watchlistRuleLimit)
      });
    });
  }, [
    accessToken,
    canUseSavedItems,
    createWatchlistMutation,
    didAttemptEnsureWatchlist,
    watchlistRuleLimit,
    watchlists.length,
    watchlistsQuery.isSuccess
  ]);

  useEffect(() => {
    if (!canUseLaunchFilters || !filterOptionsQuery.data) return;
    setFilters((current) => {
      const next: LaunchFilterValue = { ...current };
      let changed = false;

      if (current.location && !filterOptions.locations.includes(current.location)) {
        next.location = undefined;
        changed = true;
      }
      if (current.state && !filterOptions.states.includes(current.state)) {
        next.state = undefined;
        changed = true;
      }
      if (current.pad && !filterOptions.pads.includes(current.pad)) {
        next.pad = undefined;
        changed = true;
      }
      if (current.provider && !filterOptions.providers.includes(current.provider)) {
        next.provider = undefined;
        changed = true;
      }
      if (current.status && current.status !== 'all' && !filterOptions.statuses.includes(current.status)) {
        next.status = 'all';
        changed = true;
      }

      return changed ? next : current;
    });
  }, [canUseLaunchFilters, filterOptions, filterOptionsQuery.data]);

  useEffect(() => {
    let cancelled = false;

    if (!shouldHydratePublicSnapshot) {
      setCachedLaunches([]);
      setSnapshotHydrated(true);
      return () => {
        cancelled = true;
      };
    }

    setSnapshotHydrated(false);
    void readPublicFeedSnapshot(feedSnapshotKey)
      .then((snapshot) => {
        if (cancelled) {
          return;
        }
        setCachedLaunches(snapshot ?? []);
        setSnapshotHydrated(true);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setCachedLaunches([]);
        setSnapshotHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, [feedSnapshotKey, shouldHydratePublicSnapshot]);

  useEffect(() => {
    if (!shouldHydratePublicSnapshot || launches.length === 0) {
      return;
    }

    void writePublicFeedSnapshot(
      feedSnapshotKey,
      launches.map((launch) => toFeedLaunchCardData(launch))
    );
  }, [feedSnapshotKey, launches, shouldHydratePublicSnapshot]);

  useEffect(() => {
    setDeferredMediaReady(false);
    const task = InteractionManager.runAfterInteractions(() => {
      setDeferredMediaReady(true);
    });

    return () => {
      task.cancel();
    };
  }, [feedSnapshotKey]);

  useEffect(() => {
    if (!canAutoRefreshFeed || launchFeedQuery.isPending) {
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const runVersionCheck = async () => {
      if (cancelled) {
        return;
      }
      if (!canAutoRefreshFeed || refreshApplying || launchFeedQuery.isPending || launchFeedQuery.isFetchingNextPage) {
        return;
      }

      const snapshot = latestFeedStateRef.current;
      if (snapshot.isFollowingFeed) {
        return;
      }

      let payload: Awaited<ReturnType<typeof fetchLaunchFeedVersion>>;
      try {
        payload = await fetchLaunchFeedVersion(queryClient, client, {
          scope: snapshot.feedScope,
          range: snapshot.filters.range ?? DEFAULT_LAUNCH_FILTERS.range,
          region: snapshot.filters.region ?? DEFAULT_LAUNCH_FILTERS.region,
          location: snapshot.filters.location ?? null,
          state: snapshot.filters.state ?? null,
          pad: snapshot.filters.pad ?? null,
          provider: snapshot.filters.provider ?? null,
          status: snapshot.filters.status && snapshot.filters.status !== 'all' ? snapshot.filters.status : null
        });
      } catch (error) {
        const status = error instanceof ApiClientError ? error.status : null;
        if (status === 401 || status === 402) {
          setPendingRefresh(null);
          return;
        }
        throw error;
      }

      const nextVersion = payload.version;
      const visibleUpdatedAt = getVisibleFeedUpdatedAt(snapshot.launches, snapshot.feedScope);
      if (!lastSeenVersionRef.current) {
        lastSeenVersionRef.current = nextVersion;
        const shouldPrimePending = shouldPrimeVersionRefresh(payload.updatedAt, visibleUpdatedAt);
        if (shouldPrimePending) {
          setPendingRefresh({
            version: nextVersion,
            matchCount: payload.matchCount,
            updatedAt: payload.updatedAt
          });
        }
        return;
      }

      if (nextVersion !== lastSeenVersionRef.current) {
        lastSeenVersionRef.current = nextVersion;
        setPendingRefresh({
          version: nextVersion,
          matchCount: payload.matchCount,
          updatedAt: payload.updatedAt
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
      const nextRefreshAt = getNextAlignedRefreshMs(Date.now(), refreshIntervalMs);
      timeout = setTimeout(() => {
        void runVersionCheck().catch((error) => {
          console.error('mobile feed refresh check failed', error);
        });
        schedule();
      }, Math.max(0, nextRefreshAt - Date.now()));
    };

    void runVersionCheck().catch((error) => {
      console.error('mobile feed refresh check failed', error);
    });
    schedule();

    return () => {
      cancelled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [
    canAutoRefreshFeed,
    client,
    launchFeedQuery.isFetchingNextPage,
    launchFeedQuery.isPending,
    queryClient,
    refreshApplying,
    refreshIntervalMs
  ]);

  async function applyFeedRefresh() {
    setRefreshApplying(true);
    try {
      await launchFeedQuery.refetch();
      lastSeenVersionRef.current = pendingRefresh?.version ?? null;
      setPendingRefresh(null);
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: error instanceof Error ? error.message : 'Unable to refresh the launch feed.'
      });
    } finally {
      setRefreshApplying(false);
    }
  }

  async function handleSavePreset(name: string) {
    if (!canManageFilterPresets) return;

    try {
      const normalizedName = name.trim();
      if (!normalizedName) {
        return;
      }

      const payload = activePresetId
        ? await updateFilterPresetMutation.mutateAsync({
            presetId: activePresetId,
            payload: {
              name: normalizedName,
              filters
            }
          })
        : await createFilterPresetMutation.mutateAsync({
            name: normalizedName,
            filters,
            isDefault: false
          });
      if (payload.preset?.id) {
        setActivePresetId(String(payload.preset.id));
      }
      setNotice({ tone: 'info', message: activePresetId ? 'Saved view updated.' : 'Saved view created.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save this view.';
      setNotice({ tone: 'warning', message });
    }
  }

  async function handleSetDefaultPreset() {
    if (!canManageFilterPresets || !activePresetId) return;

    try {
      await updateFilterPresetMutation.mutateAsync({
        presetId: activePresetId,
        payload: {
          isDefault: true
        }
      });
      setNotice({ tone: 'info', message: 'Default view updated.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to set the default view.';
      setNotice({ tone: 'warning', message });
    }
  }

  function clearFiltersToDefault() {
    setActivePresetId('');
    setFilters({ ...DEFAULT_LAUNCH_FILTERS });
  }

  function openPremiumGate() {
    router.push('/profile');
  }

  function openLaunchAr(launchId: string) {
    router.push((`/launches/ar/${launchId}`) as Href);
  }

  function showFollowUndoToast({
    message,
    watchlistId,
    ruleId,
    busyKey,
    undoNotice
  }: {
    message: string;
    watchlistId: string;
    ruleId: string | null;
    busyKey: string;
    undoNotice: string;
  }) {
    if (!ruleId) {
      setNotice({ tone: 'info', message });
      return;
    }

    showToast({
      message,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: async () => {
        setFollowBusy((current) => ({ ...current, [busyKey]: true }));
        try {
          await deleteWatchlistRuleMutation.mutateAsync({
            watchlistId,
            ruleId
          });
          setNotice({ tone: 'info', message: undoNotice });
        } catch (error) {
          setNotice({
            tone: 'warning',
            message: buildWatchlistRuleErrorMessage(error, 'Follow', watchlistRuleLimit)
          });
        } finally {
          setFollowBusy((current) => ({ ...current, [busyKey]: false }));
        }
      }
    });
  }

  async function ensurePrimaryWatchlistId() {
    if (!canUseSavedItems || !accessToken) {
      return null;
    }
    if (primaryWatchlistId) {
      return primaryWatchlistId;
    }

    const payload = await createWatchlistMutation.mutateAsync({});
    return payload.watchlist.id ?? null;
  }

  async function toggleLaunchWatch(launchId: string) {
    const busyKey = `launch:${launchId.toLowerCase()}`;
    if (followBusy[busyKey]) {
      return;
    }

    setFollowBusy((current) => ({ ...current, [busyKey]: true }));
    try {
      const watchlistId = await ensurePrimaryWatchlistId();
      if (!watchlistId) {
        return;
      }

      const existingRuleId = watchlistRuleIdsByLaunchId[launchId] ?? null;
      if (existingRuleId) {
        await deleteWatchlistRuleMutation.mutateAsync({
          watchlistId,
          ruleId: existingRuleId
        });
        setNotice({ tone: 'info', message: 'Removed from My Launches.' });
        return;
      }

      const payload = await createWatchlistRuleMutation.mutateAsync({
        watchlistId,
        payload: {
          ruleType: 'launch',
          ruleValue: launchId
        }
      });
      showFollowUndoToast({
        message: 'Added to My Launches.',
        watchlistId,
        ruleId: payload.rule.id ?? null,
        busyKey,
        undoNotice: 'Removed from My Launches.'
      });
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: buildWatchlistRuleErrorMessage(error, 'My Launches', watchlistRuleLimit)
      });
    } finally {
      setFollowBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  async function toggleProviderFollow(provider: string) {
    const normalizedProvider = String(provider || '').trim();
    if (!normalizedProvider) {
      return;
    }

    const busyKey = `provider:${normalizedProvider.toLowerCase()}`;
    if (followBusy[busyKey]) {
      return;
    }

    setFollowBusy((current) => ({ ...current, [busyKey]: true }));
    try {
      const watchlistId = await ensurePrimaryWatchlistId();
      if (!watchlistId) {
        return;
      }

      const existingRuleId = providerRuleIdsByValue[normalizedProvider.toLowerCase()] ?? null;
      if (existingRuleId) {
        await deleteWatchlistRuleMutation.mutateAsync({
          watchlistId,
          ruleId: existingRuleId
        });
        setNotice({ tone: 'info', message: `Unfollowed ${normalizedProvider}.` });
        return;
      }

      const payload = await createWatchlistRuleMutation.mutateAsync({
        watchlistId,
        payload: {
          ruleType: 'provider',
          ruleValue: normalizedProvider
        }
      });
      showFollowUndoToast({
        message: `Following ${normalizedProvider}.`,
        watchlistId,
        ruleId: payload.rule.id ?? null,
        busyKey,
        undoNotice: `Unfollowed ${normalizedProvider}.`
      });
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: buildWatchlistRuleErrorMessage(error, 'Follow', watchlistRuleLimit)
      });
    } finally {
      setFollowBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  async function togglePadFollow(ruleValue: string) {
    const normalizedRuleValue = String(ruleValue || '').trim();
    if (!normalizedRuleValue) {
      return;
    }

    const busyKey = `pad:${normalizedRuleValue.toLowerCase()}`;
    if (followBusy[busyKey]) {
      return;
    }

    setFollowBusy((current) => ({ ...current, [busyKey]: true }));
    try {
      const watchlistId = await ensurePrimaryWatchlistId();
      if (!watchlistId) {
        return;
      }

      const existingRuleId = padRuleIdsByValue[normalizedRuleValue.toLowerCase()] ?? null;
      if (existingRuleId) {
        await deleteWatchlistRuleMutation.mutateAsync({
          watchlistId,
          ruleId: existingRuleId
        });
        setNotice({ tone: 'info', message: `Unfollowed ${formatPadRuleLabel(normalizedRuleValue)}.` });
        return;
      }

      const payload = await createWatchlistRuleMutation.mutateAsync({
        watchlistId,
        payload: {
          ruleType: 'pad',
          ruleValue: normalizedRuleValue
        }
      });
      showFollowUndoToast({
        message: `Following ${formatPadRuleLabel(normalizedRuleValue)}.`,
        watchlistId,
        ruleId: payload.rule.id ?? null,
        busyKey,
        undoNotice: `Unfollowed ${formatPadRuleLabel(normalizedRuleValue)}.`
      });
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: buildWatchlistRuleErrorMessage(error, 'Follow', watchlistRuleLimit)
      });
    } finally {
      setFollowBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  async function toggleScopedFollow(ruleType: 'rocket' | 'launch_site' | 'state', ruleValue: string, label: string) {
    const normalizedRuleValue = String(ruleValue || '').trim();
    if (!normalizedRuleValue) {
      return;
    }

    const busyKey = `${ruleType}:${normalizedRuleValue.toLowerCase()}`;
    if (followBusy[busyKey]) {
      return;
    }

    setFollowBusy((current) => ({ ...current, [busyKey]: true }));
    try {
      const watchlistId = await ensurePrimaryWatchlistId();
      if (!watchlistId) {
        return;
      }

      const existingRuleId =
        ruleType === 'rocket'
          ? rocketRuleIdsByValue[normalizedRuleValue.toLowerCase()] ?? null
          : ruleType === 'launch_site'
            ? launchSiteRuleIdsByValue[normalizedRuleValue.toLowerCase()] ?? null
            : stateRuleIdsByValue[normalizedRuleValue.toLowerCase()] ?? null;
      if (existingRuleId) {
        await deleteWatchlistRuleMutation.mutateAsync({
          watchlistId,
          ruleId: existingRuleId
        });
        setNotice({ tone: 'info', message: `Unfollowed ${label}.` });
        return;
      }

      const payload = await createWatchlistRuleMutation.mutateAsync({
        watchlistId,
        payload: {
          ruleType,
          ruleValue: normalizedRuleValue
        }
      });
      showFollowUndoToast({
        message: `Following ${label}.`,
        watchlistId,
        ruleId: payload.rule.id ?? null,
        busyKey,
        undoNotice: `Unfollowed ${label}.`
      });
    } catch (error) {
      setNotice({
        tone: 'warning',
        message: buildWatchlistRuleErrorMessage(error, 'Follow', watchlistRuleLimit)
      });
    } finally {
      setFollowBusy((current) => ({ ...current, [busyKey]: false }));
    }
  }

  const mobilePushRules = mobilePushRulesQuery.data?.rules ?? [];
  const basicActiveLaunchRule = !canUseSavedItems ? mobilePushRules.find((rule) => rule.scopeKind === 'launch') ?? null : null;
  const selectedLaunchNotificationRule =
    mobilePushRules.find((rule) => rule.scopeKind === 'launch' && rule.launchId === followLaunch?.id) ?? null;
  const selectedStateRuleValue = buildStateRuleValue(followLaunch?.pad.state);
  const selectedRocketRuleValue = buildRocketRuleValue({
    ll2RocketConfigId: followLaunch?.ll2RocketConfigId,
    rocketName: followLaunch?.rocket?.fullName,
    vehicle: followLaunch?.vehicle
  });
  const selectedLaunchSiteRuleValue = buildLaunchSiteRuleValue(followLaunch?.pad.locationName || followLaunch?.pad.name);
  const selectedPadRuleValue = followLaunch
    ? buildPadRuleValue({
        ll2PadId: followLaunch.ll2PadId,
        padShortCode: followLaunch.pad.shortCode
      })
    : null;
  const selectedBasicLaunchActive = Boolean(followLaunch && basicActiveLaunchRule?.launchId === followLaunch.id);
  const selectedBasicLaunchSlotOccupiedElsewhere = Boolean(followLaunch && basicActiveLaunchRule && !selectedBasicLaunchActive);
  const basicFollowCapacityLabel = canUseSavedItems ? undefined : `${basicActiveLaunchRule ? 1 : 0}/${singleLaunchFollowLimit}`;
  const followSheetOptions: LaunchFollowSheetOption[] = followLaunch
    ? canUseSavedItems
      ? [
          {
            key: 'launch',
            label: 'This launch',
            description: 'Keep this launch in Following.',
            icon: 'launch',
            active: Boolean(watchlistRuleIdsByLaunchId[followLaunch.id]),
            disabled: Boolean(followBusy[`launch:${followLaunch.id.toLowerCase()}`]) || watchlistsLoading || Boolean(watchlistsError),
            locked: false,
            onPress: () => {
              setFollowLaunch(null);
              void toggleLaunchWatch(followLaunch.id);
            }
          },
          {
            key: 'rocket',
            label: 'This rocket',
            description: `All launches for ${formatRocketRuleLabel(selectedRocketRuleValue || followLaunch.vehicle)}.`,
            icon: 'rocket',
            active: Boolean(selectedRocketRuleValue && rocketRuleIdsByValue[selectedRocketRuleValue.toLowerCase()]),
            disabled: !selectedRocketRuleValue,
            locked: false,
            onPress: () => {
              if (!selectedRocketRuleValue) return;
              setFollowLaunch(null);
              void toggleScopedFollow('rocket', selectedRocketRuleValue, formatRocketRuleLabel(selectedRocketRuleValue));
            }
          },
          {
            key: 'provider',
            label: 'This provider',
            description: `All launches from ${followLaunch.provider}.`,
            icon: 'provider',
            active: Boolean(providerRuleIdsByValue[String(followLaunch.provider || '').trim().toLowerCase()]),
            disabled: !String(followLaunch.provider || '').trim(),
            locked: false,
            onPress: () => {
              setFollowLaunch(null);
              void toggleProviderFollow(followLaunch.provider);
            }
          },
          {
            key: 'pad',
            label: 'This pad',
            description: `Launches from ${formatPadRuleLabel(selectedPadRuleValue || followLaunch.pad.shortCode || followLaunch.pad.name || 'this pad')}.`,
            icon: 'pad',
            active: Boolean(selectedPadRuleValue && padRuleIdsByValue[selectedPadRuleValue.toLowerCase()]),
            disabled: !selectedPadRuleValue,
            locked: false,
            onPress: () => {
              if (!selectedPadRuleValue) return;
              setFollowLaunch(null);
              void togglePadFollow(selectedPadRuleValue);
            }
          },
          {
            key: 'launch_site',
            label: 'This launch site',
            description: `Launches from ${formatLaunchSiteRuleLabel(selectedLaunchSiteRuleValue || followLaunch.pad.locationName || followLaunch.pad.name)}.`,
            icon: 'launch_site',
            active: Boolean(selectedLaunchSiteRuleValue && launchSiteRuleIdsByValue[selectedLaunchSiteRuleValue.toLowerCase()]),
            disabled: !selectedLaunchSiteRuleValue,
            locked: false,
            onPress: () => {
              if (!selectedLaunchSiteRuleValue) return;
              setFollowLaunch(null);
              void toggleScopedFollow('launch_site', selectedLaunchSiteRuleValue, formatLaunchSiteRuleLabel(selectedLaunchSiteRuleValue));
            }
          },
          {
            key: 'state',
            label: 'This state',
            description: selectedStateRuleValue ? `Launches in ${formatStateRuleLabel(selectedStateRuleValue)}.` : 'State follow unavailable.',
            icon: 'state',
            active: Boolean(selectedStateRuleValue && stateRuleIdsByValue[selectedStateRuleValue.toLowerCase()]),
            disabled: !selectedStateRuleValue,
            locked: false,
            onPress: () => {
              if (!selectedStateRuleValue) return;
              setFollowLaunch(null);
              void toggleScopedFollow('state', selectedStateRuleValue, formatStateRuleLabel(selectedStateRuleValue));
            }
          }
        ]
      : [
          {
            key: 'launch_notifications',
            label: 'This launch',
            description:
              !installationId || !deviceSecret || !isPushRegistered
                ? 'Enable push on this device in Preferences first.'
                : !canUseSingleLaunchFollow
                  ? 'Launch follow is unavailable on this account.'
                  : selectedBasicLaunchSlotOccupiedElsewhere
                    ? `Your free launch slot is in use by ${basicActiveLaunchRule?.label || 'another launch'}. Unfollow it or wait until it launches.`
                    : selectedBasicLaunchActive
                      ? 'This launch is using your free follow slot. Unfollow it to free up the slot.'
                      : 'Use your free slot for push reminders on this launch.',
            icon: 'launch',
            active: selectedBasicLaunchActive,
            disabled:
              upsertLaunchNotificationMutation.isPending ||
              deleteMobilePushRuleMutation.isPending ||
              !canUseSingleLaunchFollow ||
              selectedBasicLaunchSlotOccupiedElsewhere,
            locked: false,
            onPress: async () => {
              setFollowLaunch(null);
              if (!installationId || !deviceSecret || !isPushRegistered) {
                router.push('/preferences');
                return;
              }
              if (!canUseSingleLaunchFollow) {
                openPremiumGate();
                return;
              }
              if (!selectedBasicLaunchActive && selectedBasicLaunchSlotOccupiedElsewhere) {
                setNotice({
                  tone: 'warning',
                  message: basicActiveLaunchRule?.label
                    ? `Your free launch slot is in use by ${basicActiveLaunchRule.label}. Unfollow it or wait until it launches.`
                    : 'Your free launch slot is already in use.'
                });
                return;
              }
              try {
                if (selectedLaunchNotificationRule) {
                  await deleteMobilePushRuleMutation.mutateAsync({
                    ruleId: selectedLaunchNotificationRule.id,
                    context: { installationId, deviceSecret }
                  });
                  setNotice({ tone: 'info', message: 'Launch notifications turned off.' });
                  return;
                }
                await upsertLaunchNotificationMutation.mutateAsync({
                  launchId: followLaunch.id,
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
                setNotice({ tone: 'info', message: 'Launch notifications turned on.' });
              } catch (error) {
                if (error instanceof ApiClientError && error.code === 'limit_reached') {
                  setNotice({
                    tone: 'warning',
                    message: basicActiveLaunchRule?.label
                      ? `Your free launch slot is in use by ${basicActiveLaunchRule.label}. Unfollow it or wait until it launches.`
                      : 'Your free launch slot is already in use.'
                  });
                  return;
                }
                setNotice({ tone: 'warning', message: error instanceof Error ? error.message : 'Unable to update notifications.' });
              }
            }
          },
          {
            key: 'state_locked',
            label: 'This state',
            description: 'Premium adds state-wide launch alerts.',
            icon: 'state',
            active: false,
            disabled: false,
            locked: true,
            onPress: () => {
              setFollowLaunch(null);
              openPremiumGate();
            }
          },
          {
            key: 'provider_locked',
            label: 'This provider',
            description: 'Premium adds recurring provider follows.',
            icon: 'provider',
            active: false,
            disabled: false,
            locked: true,
            onPress: () => {
              setFollowLaunch(null);
              openPremiumGate();
            }
          },
          {
            key: 'rocket_locked',
            label: 'This rocket',
            description: 'Premium adds recurring rocket follows.',
            icon: 'rocket',
            active: false,
            disabled: false,
            locked: true,
            onPress: () => {
              setFollowLaunch(null);
              openPremiumGate();
            }
          },
          {
            key: 'pad_locked',
            label: 'This pad',
            description: 'Premium adds recurring pad follows.',
            icon: 'pad',
            active: false,
            disabled: false,
            locked: true,
            onPress: () => {
              setFollowLaunch(null);
              openPremiumGate();
            }
          },
          {
            key: 'launch_site_locked',
            label: 'This launch site',
            description: 'Premium adds recurring launch-site follows.',
            icon: 'launch_site',
            active: false,
            disabled: false,
            locked: true,
            onPress: () => {
              setFollowLaunch(null);
              openPremiumGate();
            }
          }
        ]
    : [];
  const showFeedSkeletons = !snapshotHydrated || (launchFeedQuery.isPending && cachedLaunches.length === 0);
  const showCachedFeedWarning = launchFeedQuery.isError && launches.length === 0 && cachedLaunches.length > 0;
  const listHeader = (
    <View style={{ gap: 16, paddingBottom: 16 }}>
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
          <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: theme.accent }} />
            <Text numberOfLines={1} style={{ color: theme.foreground, fontSize: 11, fontWeight: '700' }}>
              T-Minus Zero
            </Text>
          </View>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text
              numberOfLines={1}
              style={{ color: theme.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.8, textTransform: 'uppercase' }}
            >
              Comm Link
            </Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable
                testID="feed-filters-button"
                onPress={() => {
                  setFiltersOpen(true);
                }}
                hitSlop={8}
              >
                <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>
                  Filters{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  router.push('/search');
                }}
                hitSlop={8}
              >
                <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>Search</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Text
          style={{
            color: theme.muted,
            fontSize: 12,
            fontWeight: '700',
            letterSpacing: 1.2,
            textTransform: 'uppercase'
          }}
        >
          Launch schedule
        </Text>
        <Text style={{ color: theme.foreground, fontSize: 32, fontWeight: '800', lineHeight: 36 }}>
          {showsInternationalLaunches ? 'Rocket Launch Schedule & Countdown' : 'US Rocket Launch Schedule & Countdown'}
        </Text>
        <Text style={{ color: theme.muted, fontSize: 15, lineHeight: 23 }}>
          {showsInternationalLaunches
            ? 'Track launches matching your filters with NET windows, countdowns, and coverage links.'
            : 'Track upcoming US rocket launches with NET windows, countdowns, and coverage links.'}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        {PROGRAM_ITEMS.map((item) => (
          <Pressable
            key={item.label}
            testID={item.testID}
            onPress={() => {
              const nativeHref = getProgramHubEntryOrCoreHref(viewerSessionQuery.data, item.hub);
              router.push((nativeHref || buildSearchHref(item.query)) as Href);
            }}
            style={({ pressed }) => ({
              flex: 1,
              minWidth: 0,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 16,
              paddingHorizontal: 12,
              paddingVertical: 10,
              opacity: pressed ? 0.85 : 1
            })}
            accessibilityLabel={item.accessibilityLabel}
          >
            <Image source={item.logo} resizeMode="contain" style={item.logoStyle} />
          </Pressable>
        ))}
      </View>

      {notice ? (
        <View
          style={{
            borderRadius: 18,
            borderWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: theme.surface,
            paddingHorizontal: 16,
            paddingVertical: 12
          }}
        >
          <Text style={{ color: notice.tone === 'warning' ? theme.foreground : theme.accent, fontSize: 14, lineHeight: 20 }}>
            {notice.message}
          </Text>
        </View>
      ) : null}

      {showCachedFeedWarning ? (
        <View
          style={{
            borderRadius: 18,
            borderWidth: 1,
            borderColor: 'rgba(123, 204, 255, 0.28)',
            backgroundColor: 'rgba(14, 30, 56, 0.72)',
            paddingHorizontal: 16,
            paddingVertical: 12
          }}
        >
          <Text style={{ color: 'rgba(179, 225, 255, 0.95)', fontSize: 14, lineHeight: 20 }}>
            Showing saved launches while the latest feed refresh is unavailable.
          </Text>
        </View>
      ) : null}

      {pendingRefresh && pendingRefreshMessage ? (
        <View
          style={{
            gap: 10,
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
            Refresh ready
          </Text>
          <Text style={{ color: theme.foreground, fontSize: 18, fontWeight: '800', lineHeight: 24 }}>
            {pendingRefreshMessage}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>
            New feed data is available without interrupting the list you are reading.
          </Text>
          <Pressable
            onPress={() => {
              void applyFeedRefresh();
            }}
            style={({ pressed }) => ({
              alignSelf: 'flex-start',
              borderRadius: 999,
              backgroundColor: theme.accent,
              paddingHorizontal: 16,
              paddingVertical: 10,
              opacity: pressed || refreshApplying ? 0.85 : 1
            })}
            disabled={refreshApplying}
          >
            <Text style={{ color: theme.background, fontSize: 13, fontWeight: '800' }}>
              {refreshApplying ? 'Refreshing…' : 'Refresh'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View
        style={{
          gap: 10,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: theme.stroke,
          backgroundColor: theme.surface,
          padding: 16
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ModeButton
            label="For You"
            active={feedMode === 'for-you'}
            onPress={() => setFeedMode('for-you')}
          />
          <ModeButton
            label="Following"
            active={feedMode === 'following'}
            disabled={watchlistsLoading}
            onPress={() => {
              if (!canUseSavedItems) {
                openPremiumGate();
                return;
              }
              setFeedMode('following');
            }}
          />
        </View>
        <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>
          {canUseSavedItems
            ? feedMode === 'following'
              ? primaryWatchlist?.rules.length
                ? 'Showing launches from your follows and saved launch rules.'
                : 'Following is empty. Follow a launch, provider, or pad to populate this feed.'
              : 'For You shows launches matching your current filters.'
            : 'Following is a Premium feed driven by the launches, providers, and pads you follow.'}
        </Text>
        {watchlistsError ? <Text style={{ color: '#ff9087', fontSize: 12, lineHeight: 18 }}>{watchlistsError}</Text> : null}
      </View>

      {canUseLaunchFilters && activeFilterCount > 0 ? (
        <View
          style={{
            gap: 10,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: theme.surface,
            padding: 16
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700' }}>Active filters</Text>
              <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>
                {activePreset ? `${activePreset.name} · ` : ''}
                {activeFilterCount} active
              </Text>
            </View>
            <Pressable
              onPress={clearFiltersToDefault}
              hitSlop={8}
            >
              <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '700' }}>Reset</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {activeFilterLabels.map((label, index) => (
              <View
                key={`${label}:${index}`}
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: theme.background,
                  paddingHorizontal: 10,
                  paddingVertical: 7
                }}
              >
                <Text style={{ color: theme.foreground, fontSize: 12, fontWeight: '700' }}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <View testID="feed-screen" style={{ flex: 1, backgroundColor: theme.background }}>
      <FlatList
        data={renderedLaunches}
        keyExtractor={(launch) => launch.id}
        renderItem={({ item, index }) => {
          const providerKey = String(item.provider || '').trim().toLowerCase();
          const rocketRuleValue = buildRocketRuleValue({
            ll2RocketConfigId: item.ll2RocketConfigId,
            rocketName: item.rocket?.fullName,
            vehicle: item.vehicle
          });
          const padRuleValue = buildPadRuleValue({
            ll2PadId: item.ll2PadId,
            padShortCode: item.pad.shortCode
          });
          const launchSiteRuleValue = buildLaunchSiteRuleValue(item.pad.locationName || item.pad.name);
          const stateRuleValue = buildStateRuleValue(item.pad.state);
          const normalizedPadRuleValue = String(padRuleValue || '').trim().toLowerCase();
          const normalizedRocketRuleValue = String(rocketRuleValue || '').trim().toLowerCase();
          const normalizedLaunchSiteRuleValue = String(launchSiteRuleValue || '').trim().toLowerCase();
          const normalizedStateRuleValue = String(stateRuleValue || '').trim().toLowerCase();
          const launchNotificationActive = Boolean(basicActiveLaunchRule && basicActiveLaunchRule.launchId === item.id);
          const followCount = canUseSavedItems
            ? Number(Boolean(watchlistRuleIdsByLaunchId[item.id])) +
              Number(Boolean(normalizedRocketRuleValue && rocketRuleIdsByValue[normalizedRocketRuleValue])) +
              Number(Boolean(providerRuleIdsByValue[providerKey])) +
              Number(Boolean(normalizedPadRuleValue && padRuleIdsByValue[normalizedPadRuleValue])) +
              Number(Boolean(normalizedLaunchSiteRuleValue && launchSiteRuleIdsByValue[normalizedLaunchSiteRuleValue])) +
              Number(Boolean(normalizedStateRuleValue && stateRuleIdsByValue[normalizedStateRuleValue]))
            : Number(launchNotificationActive);
          const notificationsActive = launchNotificationActive;

          return (
            <WebParityLaunchCard
              launch={item}
              isNext={index === 0 || item.id === nextLaunch?.id}
              showDeferredMedia={deferredMediaReady}
              testID={index === 0 ? 'feed-launch-first' : index === 1 ? 'feed-launch-second' : `feed-launch-${item.id}`}
              onOpenDetails={() => {
                if (launches.length > 0) {
                  void prefetchLaunchDetail(queryClient, client, item.id);
                }
                router.push(buildLaunchHref(item.id) as Href);
              }}
              onOpenProvider={
                item.provider
                  ? () => {
                      router.push(buildSearchHref(item.provider) as Href);
                    }
                  : undefined
              }
              onOpenPad={() => {
                const padQuery = item.pad.locationName || item.pad.name || item.pad.shortCode;
                if (!padQuery) return;
                router.push(buildSearchHref(padQuery) as Href);
              }}
              onOpenAr={() => {
                openLaunchAr(item.id);
              }}
              followMenuLabel={followCount > 0 ? 'Following' : 'Follow'}
              followMenuCount={canUseSavedItems ? followCount : 0}
              followMenuCapacityLabel={canUseSavedItems ? undefined : basicFollowCapacityLabel}
              followMenuActive={followCount > 0}
              followMenuDisabled={false}
              notificationsActive={notificationsActive}
              onOpenFollowMenu={() => {
                setFollowLaunch(item);
              }}
            />
          );
        }}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        windowSize={5}
        removeClippedSubviews
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: contentBottomPadding
        }}
        ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          showFeedSkeletons ? (
            <View style={{ gap: 14 }}>
              <WebParityLaunchCardSkeleton testID="feed-launch-skeleton-1" />
              <WebParityLaunchCardSkeleton testID="feed-launch-skeleton-2" />
              <WebParityLaunchCardSkeleton testID="feed-launch-skeleton-3" />
            </View>
          ) : launchFeedQuery.isError ? (
            <ErrorStateCard title="Feed unavailable" body={launchFeedQuery.error.message} />
          ) : (
            <EmptyStateCard title="No upcoming launches right now" body={`We could not find any scheduled launches. Data source: ${baseUrl}.`} />
          )
        }
        ListFooterComponent={
          launches.length > 0 && launchFeedQuery.hasNextPage ? (
            <View style={{ paddingTop: 14 }}>
              <Pressable
                testID="feed-load-more"
                onPress={() => {
                  void launchFeedQuery.fetchNextPage();
                }}
                disabled={launchFeedQuery.isFetchingNextPage}
                style={({ pressed }) => ({
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: pressed ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
                  paddingHorizontal: 18,
                  paddingVertical: 14,
                  opacity: launchFeedQuery.isFetchingNextPage ? 0.7 : 1
                })}
              >
                <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>
                  {launchFeedQuery.isFetchingNextPage ? 'Loading…' : 'Load more launches'}
                </Text>
              </Pressable>
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshApplying}
            onRefresh={() => {
              void applyFeedRefresh();
            }}
            tintColor={theme.accent}
          />
        }
      />

      <LaunchFollowSheet
        launchName={followLaunch?.name ?? null}
        open={followLaunch != null}
        options={followSheetOptions}
        activeCount={followSheetOptions.filter((option) => option.active).length}
        capacityLabel={basicFollowCapacityLabel}
        notificationsActive={Boolean(selectedLaunchNotificationRule)}
        notificationsContent={
          followLaunch ? (
            <LaunchAlertsPanel
              launchId={followLaunch.id}
              installationId={installationId}
              deviceSecret={deviceSecret}
              isPremium={entitlementsQuery.data?.isPaid === true}
              isPushRegistered={isPushRegistered}
              onOpenUpgrade={() => {
                setFollowLaunch(null);
                openPremiumGate();
              }}
              onOpenPreferences={() => {
                setFollowLaunch(null);
                router.push('/preferences');
              }}
            />
          ) : null
        }
        message={
          canUseSavedItems
            ? 'Following keeps matching launches in your saved list and related notifications can be tuned from Preferences.'
            : canUseAllUsLaunchAlerts
              ? 'Free keeps one launch reminder slot on this device. Manage All U.S. launches from Preferences. Premium adds synced follows across broader scopes.'
              : 'Free keeps one launch reminder slot on this device. Premium adds synced follows across broader scopes.'
        }
        onClose={() => setFollowLaunch(null)}
      />

      <LaunchFilterSheet
        visible={filtersOpen}
        isAuthed={isAuthed}
        canUseLaunchFilters={canUseLaunchFilters}
        canManageFilterPresets={canManageFilterPresets}
        filters={filters}
        filterOptions={filterOptions}
        filterOptionsLoading={filterOptionsQuery.isPending}
        filterOptionsError={filterOptionsQuery.isError ? filterOptionsQuery.error.message : null}
        presets={presetList}
        activePresetId={activePresetId}
        presetSaving={createFilterPresetMutation.isPending || updateFilterPresetMutation.isPending}
        presetDefaulting={updateFilterPresetMutation.isPending}
        onClose={() => setFiltersOpen(false)}
        onChange={(next) => {
          setNotice(null);
          setFilters(next);
        }}
        onReset={() => {
          setNotice(null);
          clearFiltersToDefault();
        }}
        onApplyPreset={(presetId) => {
          const preset = presetList.find((candidate) => candidate.id === presetId);
          if (!preset) return;
          setNotice(null);
          setActivePresetId(presetId);
          setFilters(preset.filters);
        }}
        onSavePreset={handleSavePreset}
        onSetDefaultPreset={handleSetDefaultPreset}
        onOpenUpgrade={() => {
          setFiltersOpen(false);
          openPremiumGate();
        }}
      />
    </View>
  );
}

function ModeButton({
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
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? theme.accent : theme.stroke,
        backgroundColor: active ? theme.accent : theme.background,
        paddingHorizontal: 14,
        paddingVertical: 9,
        opacity: disabled ? 0.5 : pressed ? 0.86 : 1
      })}
    >
      <Text style={{ color: active ? theme.background : theme.foreground, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function buildWatchlistRuleErrorMessage(error: unknown, label: string, ruleLimit: number | null) {
  if (error instanceof ApiClientError) {
    if (error.code === 'limit_reached') {
      return ruleLimit ? `My Launches limit reached (${ruleLimit} rules).` : 'My Launches limit reached.';
    }
    if (error.code) {
      return `${label} error: ${error.code}`;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return `Unable to update ${label.toLowerCase()}.`;
}

const PROGRAM_ITEMS = [
  {
    hub: 'artemis',
    label: 'Artemis',
    accessibilityLabel: 'Artemis Program',
    query: 'artemis',
    testID: 'feed-program-artemis',
    logo: artemisProgramLogo,
    logoStyle: { width: 74, height: 38 }
  },
  {
    hub: 'spacex',
    label: 'SpaceX',
    accessibilityLabel: 'SpaceX Program',
    query: 'spacex',
    testID: 'feed-program-spacex',
    logo: spacexProgramLogo,
    logoStyle: { width: 106, height: 24 }
  },
  {
    hub: 'blueOrigin',
    label: 'Blue Origin',
    accessibilityLabel: 'Blue Origin Program',
    query: 'blue origin',
    testID: 'feed-program-blue-origin',
    logo: blueOriginProgramLogo,
    logoStyle: { width: 42, height: 42 }
  }
] as const;
