'use client';

import { ApiClientError } from '@tminuszero/api-client';
import {
  getNextAdaptiveLaunchRefreshMs,
  getRecommendedLaunchRefreshIntervalSeconds,
  getTierRefreshSeconds,
  PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS,
  getVisibleFeedUpdatedAt,
  shouldPrimeVersionRefresh,
  tierToMode,
  type ViewerTier
} from '@tminuszero/domain';
import { buildAuthHref, buildUpgradeHref } from '@tminuszero/navigation';
import clsx from 'clsx';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { sharedQueryKeys } from '@tminuszero/query';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  applyGuestViewerState,
  useCreateFilterPresetMutation,
  useCreateWatchlistMutation,
  useCreateWatchlistRuleMutation,
  useDeleteWatchlistRuleMutation,
  useArEligibleLaunchIdsQuery,
  useBasicFollowsQuery,
  useFeedFilterOptionsQuery,
  useFilterPresetsQuery,
  useViewerSessionQuery,
  useUpdateFilterPresetMutation,
  useViewerEntitlementsQuery,
  useWatchlistsQuery,
  fetchLaunchFeedVersion,
  getChangedLaunchesQueryOptions,
  getLaunchFeedPageQueryOptions,
  invalidateLaunchFeedQueries,
  invalidateViewerScopedQueries
} from '@/lib/api/queries';
import { Launch, LaunchFilter, LaunchFilterOptions } from '@/lib/types/launch';
import { LAUNCH_FEED_PAGE_SIZE } from '@/lib/constants/launchFeed';
import { NEXT_LAUNCH_RETENTION_MS } from '@/lib/constants/launchTimeline';
import { useDismissed } from '@/lib/hooks/useDismissed';
import { PRIVACY_COOKIES } from '@/lib/privacy/choices';
import { formatDateOnly, formatNetLabel, isDateOnlyNet } from '@/lib/time';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { isArtemisLaunch } from '@/lib/utils/launchArtemis';
import { getArtemisVariantLabel } from '@/lib/utils/artemis';
import { isStarshipLaunch } from '@/lib/utils/launchStarship';
import { getStarshipVariantLabel } from '@/lib/utils/starship';
import { LaunchCard } from './LaunchCard';
import { SkeletonLaunchCard } from './SkeletonLaunchCard';
import { BulkCalendarExport } from './BulkCalendarExport';
import { EmbedNextLaunchCard } from './EmbedNextLaunchCard';
import { PremiumUpsellModal } from './PremiumUpsellModal';
import { PremiumGateButton } from './PremiumGateButton';
import { RssFeeds } from './RssFeeds';
import { useToast } from './ToastProvider';

const PAGE_SIZE = LAUNCH_FEED_PAGE_SIZE;

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LAUNCH_FILTERS: LaunchFilter = { range: 'year', sort: 'soonest', region: 'us' };
const FILTER_SECTION_CLASS = 'rounded-xl border border-stroke bg-surface-0/50 p-3';
const FILTER_GROUP_LABEL_CLASS = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-text3';
const FILTER_SELECT_CLASS = 'w-full rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1';
const HOME_UPSELL_KEYS = {
  onboardingDismissedAt: 'tminus.upsell.home_onboarding.dismissed_at'
} as const;
const OPEN_LAUNCH_SEARCH_EVENT = 'tmz:open-launch-search';

type LaunchFeedProps = {
  initialLaunches?: Launch[];
  initialOffset?: number;
  initialHasMore?: boolean;
  initialNowMs?: number;
  initialArEligibleLaunchIds?: string[];
  initialViewerTier?: ViewerTier;
  initialIsPaid?: boolean;
  initialAuthStatus?: 'loading' | 'authed' | 'guest';
  initialBlockThirdPartyEmbeds?: boolean;
};

type SearchParamsLike = { get: (key: string) => string | null };

type ProgramTicker = {
  key: 'artemis' | 'starship';
  href: string;
  text: string;
  label: string;
  netMs: number;
};

type PendingFeedRefresh = {
  version: string;
  matchCount: number;
  updatedAt: string | null;
  summaries: string[];
};

function readCookieValue(name: string) {
  if (typeof document === 'undefined') return null;
  const raw = document.cookie || '';
  const parts = raw.split(';');
  for (const part of parts) {
    const [key, ...rest] = part.split('=');
    if (!key) continue;
    if (key.trim() !== name) continue;
    return rest.join('=').trim();
  }
  return null;
}

function getPageFromSearchParams(searchParams: SearchParamsLike) {
  const raw = searchParams.get('page');
  if (!raw) return 1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(10_000, Math.max(1, Math.trunc(parsed)));
}

function normalizeViewerTier(value: unknown): ViewerTier | null {
  if (value === 'anon' || value === 'premium') return value;
  return null;
}

function isLaunchFeedDebugEnabled(searchParams: SearchParamsLike) {
  const token = String(searchParams.get('debug') || '').trim().toLowerCase();
  const enabledByParam = token === '1' || token === 'true' || token === 'launchfeed' || token === 'feed' || token === 'refresh';
  const enabledByEnv = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEBUG_LAUNCH_FEED === '1';
  const enabledByStorage =
    typeof window !== 'undefined' &&
    (window.localStorage.getItem('debug_launch_feed') === '1' || window.localStorage.getItem('tminus.debug_launch_feed') === '1');
  return enabledByEnv || enabledByParam || enabledByStorage;
}

function isHistoryReplaceRateLimitError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { name?: unknown; message?: unknown };
  const name = typeof maybeError.name === 'string' ? maybeError.name : '';
  const message = typeof maybeError.message === 'string' ? maybeError.message : '';
  return name === 'SecurityError' && message.includes('replaceState');
}

function useWhyDidYouUpdate(name: string, values: Record<string, unknown>, enabled: boolean) {
  const renderRef = useRef(0);
  const prevRef = useRef<Record<string, unknown>>(values);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (startedAtRef.current == null) {
      startedAtRef.current = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
    }
  }, []);

  useEffect(() => {
    renderRef.current += 1;

    const prev = prevRef.current;
    prevRef.current = values;

    if (!enabled) return;

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const keys = new Set([...Object.keys(prev), ...Object.keys(values)]);
    keys.forEach((key) => {
      if (!Object.is(prev[key], values[key])) {
        changes[key] = { from: prev[key], to: values[key] };
      }
    });

    const changeKeys = Object.keys(changes);
    if (!changeKeys.length) return;

    const startedAt = startedAtRef.current ?? 0;
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
    const elapsedMs = startedAt ? Math.round(now - startedAt) : null;

    console.groupCollapsed(
      `[${name}] render #${renderRef.current}${elapsedMs != null ? ` (+${elapsedMs}ms)` : ''} • ${changeKeys.length} change${
        changeKeys.length === 1 ? '' : 's'
      }`
    );
    console.table(
      Object.fromEntries(
        changeKeys.map((key) => [
          key,
          {
            from: changes[key]?.from,
            to: changes[key]?.to
          }
        ])
      )
    );
    console.groupEnd();
  });

  useEffect(() => {
    if (!enabled) return;
    console.log(`[${name}] mounted`);
    return () => console.log(`[${name}] unmounted`);
  }, [enabled, name]);
}

export function LaunchFeed({
  initialLaunches = [],
  initialOffset = 0,
  initialHasMore,
  initialNowMs,
  initialArEligibleLaunchIds = [],
  initialViewerTier,
  initialIsPaid,
  initialAuthStatus,
  initialBlockThirdPartyEmbeds = false
}: LaunchFeedProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const filtersPanelId = useId();
  const { pushToast } = useToast();
  const debug = isLaunchFeedDebugEnabled(searchParams);
  const debugSessionIdRef = useRef(Math.random().toString(36).slice(2));
  const debugName = useMemo(() => `LaunchFeed:${debugSessionIdRef.current}`, []);
  const initialPage = getPageFromSearchParams(searchParams);
  const initialPageOffset = (initialPage - 1) * PAGE_SIZE;
  const initialHasMoreValue = initialHasMore ?? initialLaunches.length === PAGE_SIZE;
  const initialNowMsValue =
    typeof initialNowMs === 'number' && Number.isFinite(initialNowMs) ? initialNowMs : undefined;
  const initialMatchesPage = initialLaunches.length > 0 && initialOffset === initialPageOffset;

  const [loading, setLoading] = useState(() => !initialMatchesPage);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filters, setFilters] = useState<LaunchFilter>({ ...DEFAULT_LAUNCH_FILTERS });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [presetSaving, setPresetSaving] = useState(false);
  const [presetDefaulting, setPresetDefaulting] = useState(false);
  const [activePresetId, setActivePresetId] = useState<string>('');
  const [myLaunchesEnabled, setMyLaunchesEnabled] = useState(false);
  const [watchToggleBusy, setWatchToggleBusy] = useState<Record<string, boolean>>({});
  const [followToggleBusy, setFollowToggleBusy] = useState<Record<string, boolean>>({});
  const [launches, setLaunches] = useState<Launch[]>(() => (initialMatchesPage ? initialLaunches : []));
  const [nextOffset, setNextOffset] = useState(() =>
    initialMatchesPage ? initialOffset + initialLaunches.length : initialPageOffset
  );
  const [hasMore, setHasMore] = useState(() => (initialMatchesPage ? initialHasMoreValue : true));
  const [changed, setChanged] = useState<
    Array<{
      launchId: string;
      name: string;
      summary: string;
      lastUpdated?: string;
      lastUpdatedLabel?: string;
      entries: Array<{
        updateId: string;
        changeSummary?: string;
        detectedAt?: string;
        detectedLabel?: string;
        details?: string[];
      }>;
    }>
  >([]);
  const [expandedUpdates, setExpandedUpdates] = useState<Record<string, boolean>>({});
  const [recentExpanded, setRecentExpanded] = useState(false);
  const [recentFlipIndex, setRecentFlipIndex] = useState(0);
  const [notice, setNotice] = useState<{ message: string; tone: 'info' | 'warning' } | null>(null);
  const [pendingRefresh, setPendingRefresh] = useState<PendingFeedRefresh | null>(null);
  const [refreshApplying, setRefreshApplying] = useState(false);
  const [lastCheckedAtMs, setLastCheckedAtMs] = useState<number | null>(() => initialNowMsValue ?? null);
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const [scheduledRefreshIntervalSeconds, setScheduledRefreshIntervalSeconds] = useState(() =>
    initialViewerTier === 'premium' ? PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS : getTierRefreshSeconds(initialViewerTier ?? 'anon')
  );
  const [cadenceAnchorNet, setCadenceAnchorNet] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => initialNowMsValue ?? Date.now());
  const [userTz, setUserTz] = useState('UTC');
  const [upsellOpen, setUpsellOpen] = useState(false);
  const [upsellFeatureLabel, setUpsellFeatureLabel] = useState<string | undefined>(undefined);
  const [blockThirdPartyEmbeds, setBlockThirdPartyEmbeds] = useState(() => Boolean(initialBlockThirdPartyEmbeds));
  const [modeOverride, setModeOverride] = useState<'public' | null>(null);
  const [infiniteScrollArmed, setInfiniteScrollArmed] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const fetchSeqRef = useRef(0);
  const lastSeenLiveVersionRef = useRef<string | null>(null);
  const initialLaunchesRef = useRef(initialLaunches);
  const initialOffsetRef = useRef(initialOffset);
  const didInitialFetchRef = useRef(false);
  const didApplyInitialDefaultPresetRef = useRef(false);
  const didRequestMyWatchlistRef = useRef(false);
  const lastRouterReplaceRef = useRef<{ url: string; at: number } | null>(null);
  const viewerSessionQuery = useViewerSessionQuery();
  const viewerEntitlementsQuery = useViewerEntitlementsQuery();
  const basicFollowsQuery = useBasicFollowsQuery();
  const filterPresetsQuery = useFilterPresetsQuery();
  const watchlistsQuery = useWatchlistsQuery();
  const createFilterPresetMutation = useCreateFilterPresetMutation();
  const updateFilterPresetMutation = useUpdateFilterPresetMutation();
  const createWatchlistMutation = useCreateWatchlistMutation();
  const createWatchlistRuleMutation = useCreateWatchlistRuleMutation();
  const deleteWatchlistRuleMutation = useDeleteWatchlistRuleMutation();

  const { dismissed: unlocksDismissed, dismiss: dismissUnlocks } = useDismissed(HOME_UPSELL_KEYS.onboardingDismissedAt, 14 * DAY_MS);

  const query = useMemo(() => (searchParams.get('q') || '').trim(), [searchParams]);
  const currentPage = useMemo(() => getPageFromSearchParams(searchParams), [searchParams]);
  const pageOffset = useMemo(() => (currentPage - 1) * PAGE_SIZE, [currentPage]);
  const authStatus: 'loading' | 'authed' | 'guest' =
    viewerSessionQuery.isPending && !viewerSessionQuery.data
      ? (initialAuthStatus ?? 'loading')
      : viewerSessionQuery.data?.viewerId
        ? 'authed'
        : 'guest';
  const baseViewerTier = normalizeViewerTier(viewerEntitlementsQuery.data?.tier) ?? initialViewerTier ?? 'anon';
  const viewerTier: ViewerTier =
    modeOverride === 'public' ? 'anon' : baseViewerTier;
  const openLaunchSearch = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event(OPEN_LAUNCH_SEARCH_EVENT));
  }, []);
  const isPaid =
    modeOverride == null
      ? (typeof viewerEntitlementsQuery.data?.isPaid === 'boolean'
          ? viewerEntitlementsQuery.data.isPaid
          : typeof initialIsPaid === 'boolean'
            ? initialIsPaid
            : initialViewerTier === 'premium')
      : false;
  const isAuthed = authStatus === 'authed';
  const viewerCapabilities = viewerEntitlementsQuery.data?.capabilities;
  const canUseSavedItems = isAuthed && Boolean(viewerCapabilities?.canUseSavedItems);
  const canManageFilterPresets = isAuthed && Boolean(viewerCapabilities?.canManageFilterPresets);
  const canUseBasicAlertRules = isAuthed && Boolean(viewerCapabilities?.canUseBasicAlertRules);
  const singleLaunchFollowLimit = Math.max(1, viewerEntitlementsQuery.data?.limits.singleLaunchFollowLimit ?? 1);
  const activeBasicLaunchFollow = basicFollowsQuery.data?.activeLaunchFollow ?? null;
  const basicFollowCapacityLabel = !canUseSavedItems
    ? `${activeBasicLaunchFollow ? 1 : 0}/${singleLaunchFollowLimit}`
    : undefined;
  const mode = useMemo(() => modeOverride ?? tierToMode(viewerTier), [modeOverride, viewerTier]);
  const arEligibleLaunchIdsQuery = useArEligibleLaunchIdsQuery({
    initialData: initialArEligibleLaunchIds
  });
  const arEligibleLaunchIdSet = useMemo(
    () => new Set(arEligibleLaunchIdsQuery.data ?? initialArEligibleLaunchIds),
    [arEligibleLaunchIdsQuery.data, initialArEligibleLaunchIds]
  );
  const filterOptionsQuery = useFeedFilterOptionsQuery(
    {
      mode: mode === 'live' ? 'live' : 'public',
      range: filters.range ?? 'year',
      region: filters.region ?? 'us',
      location: filters.location ?? null,
      state: filters.state ?? null,
      pad: filters.pad ?? null,
      provider: filters.provider ?? null,
      status: filters.status && filters.status !== 'all' ? filters.status : null
    },
    { enabled: isAuthed }
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
  const filtersLoading = isAuthed ? filterOptionsQuery.isPending : false;
  const filtersError =
    isAuthed && filterOptionsQuery.isError
      ? filterOptionsQuery.error instanceof Error
        ? filterOptionsQuery.error.message
        : 'filters_failed'
      : null;
  const presetList = useMemo<Array<{ id: string; name: string; filters: LaunchFilter; is_default: boolean }>>(() => {
    if (!canManageFilterPresets || !filterPresetsQuery.data) return [];
    return filterPresetsQuery.data.presets
      .map((preset) => {
        const id = String(preset.id || '').trim();
        const name = String(preset.name || '').trim() || 'Saved view';
        if (!id) return null;
        return {
          id,
          name,
          filters: normalizeLaunchFilter(preset.filters),
          is_default: preset.isDefault === true
        };
      })
      .filter((preset): preset is { id: string; name: string; filters: LaunchFilter; is_default: boolean } => preset !== null);
  }, [canManageFilterPresets, filterPresetsQuery.data]);
  const presetsLoading = canManageFilterPresets && filterPresetsQuery.isPending;
  const presetsError =
    canManageFilterPresets && filterPresetsQuery.isError
      ? filterPresetsQuery.error instanceof Error
        ? filterPresetsQuery.error.message
        : 'failed_to_load'
      : null;
  const activePreset = useMemo(
    () => presetList.find((preset) => preset.id === activePresetId) ?? null,
    [activePresetId, presetList]
  );
  const activePresetIsDefault = activePreset?.is_default === true;
  const selectedWatchlist = useMemo(() => {
    if (!canUseSavedItems || !watchlistsQuery.data) return null;
    return (
      watchlistsQuery.data.watchlists.find((watchlist) => String(watchlist.name || '').trim().toLowerCase() === 'my launches') ??
      watchlistsQuery.data.watchlists[0] ??
      null
    );
  }, [canUseSavedItems, watchlistsQuery.data]);
  const watchlistsLoading = canUseSavedItems && (watchlistsQuery.isPending || createWatchlistMutation.isPending);
  const watchlistsError =
    canUseSavedItems && watchlistsQuery.isError
      ? watchlistsQuery.error instanceof Error
        ? watchlistsQuery.error.message
        : 'failed_to_load'
      : null;
  const myWatchlistId = selectedWatchlist?.id ? String(selectedWatchlist.id) : null;
  const myLaunchRulesByLaunchId = useMemo(() => extractLaunchRuleMap(selectedWatchlist?.rules), [selectedWatchlist?.rules]);
  const myProviderRulesByProvider = useMemo(() => extractProviderRuleMap(selectedWatchlist?.rules), [selectedWatchlist?.rules]);
  const myPadRulesByValue = useMemo(() => extractPadRuleMap(selectedWatchlist?.rules), [selectedWatchlist?.rules]);
  const myRocketRulesByValue = useMemo(() => extractRuleMap(selectedWatchlist?.rules, 'rocket'), [selectedWatchlist?.rules]);
  const myLaunchSiteRulesByValue = useMemo(() => extractRuleMap(selectedWatchlist?.rules, 'launch_site'), [selectedWatchlist?.rules]);
  const myStateRulesByValue = useMemo(() => extractRuleMap(selectedWatchlist?.rules, 'state'), [selectedWatchlist?.rules]);
  const fallbackRefreshIntervalSeconds = viewerTier === 'premium' ? PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS : getTierRefreshSeconds(viewerTier);
  const refreshIntervalSeconds = getRecommendedLaunchRefreshIntervalSeconds(
    scheduledRefreshIntervalSeconds,
    fallbackRefreshIntervalSeconds
  );
  const refreshIntervalMs = refreshIntervalSeconds * 1000;
  const recentChanges = useMemo(() => changed.slice(0, 6), [changed]);
  useWhyDidYouUpdate(
    debugName,
    {
      authStatus,
      viewerTier,
      isPaid,
      mode,
      query,
      currentPage,
      pageOffset,
      refreshIntervalMs,
      nextRefreshAt,
      loading,
      loadingMore,
      hasMore,
      nextOffset,
      launchesLen: launches.length,
      changedLen: changed.length,
      pendingRefreshVersion: pendingRefresh?.version ?? null,
      pendingRefreshMatchCount: pendingRefresh?.matchCount ?? null,
      refreshApplying,
      recentChangesLen: recentChanges.length,
      recentExpanded,
      recentFlipIndex,
      filtersOpen,
      filterRange: filters.range,
      filterSort: filters.sort,
      filterRegion: filters.region,
      filterLocation: filters.location,
      filterState: filters.state,
      filterPad: filters.pad,
      filterProvider: filters.provider,
      filterStatus: filters.status,
      presetsLoading,
      presetSaving,
      presetsError,
      presetCount: presetList.length,
      activePresetId,
      myLaunchesEnabled,
      myWatchlistId,
      myLaunchRulesCount: Object.keys(myLaunchRulesByLaunchId).length,
      watchBusyCount: Object.values(watchToggleBusy).filter(Boolean).length,
      filtersLoading,
      filtersError
    },
    debug
  );

  const nextPageHref = useMemo(() => {
    const next = Math.floor(nextOffset / PAGE_SIZE) + 1;
    const qs = new URLSearchParams(searchParams.toString());
    qs.set('page', String(next));
    const queryString = qs.toString();
    return queryString ? `/?${queryString}` : '/';
  }, [nextOffset, searchParams]);

  const debugLog = useCallback(
    (event: string, details?: Record<string, unknown>) => {
      if (!debug) return;
      const ts = new Date().toISOString();
      if (details) console.log(`[${debugName}] ${event}`, { ts, ...details });
      else console.log(`[${debugName}] ${event}`, { ts });
    },
    [debug, debugName]
  );

  const openUpsell = useCallback((featureLabel?: string) => {
    setUpsellFeatureLabel(featureLabel);
    setUpsellOpen(true);
  }, []);

  const closeUpsell = useCallback(() => {
    setUpsellOpen(false);
    setUpsellFeatureLabel(undefined);
  }, []);

  const safeRouterReplace = useCallback(
    (targetUrl: string) => {
      if (typeof window !== 'undefined') {
        const currentUrl = `${window.location.pathname}${window.location.search}`;
        if (currentUrl === targetUrl) return;
      }

      const now = Date.now();
      const lastReplace = lastRouterReplaceRef.current;
      if (lastReplace && lastReplace.url === targetUrl && now - lastReplace.at < 1_000) return;
      lastRouterReplaceRef.current = { url: targetUrl, at: now };

      try {
        router.replace(targetUrl);
      } catch (error) {
        if (isHistoryReplaceRateLimitError(error)) return;
        throw error;
      }
    },
    [router]
  );

  const latestRef = useRef({
    viewerTier,
    isAuthed,
    loading,
    loadingMore,
    pageOffset,
    nextOffset,
    hasMore,
    query,
    mode,
    filters,
    myLaunchesEnabled,
    myWatchlistId
  });

  latestRef.current = {
    viewerTier,
    isAuthed,
    loading,
    loadingMore,
    pageOffset,
    nextOffset,
    hasMore,
    query,
    mode,
    filters,
    myLaunchesEnabled,
    myWatchlistId
  };

  useEffect(() => {
    setScheduledRefreshIntervalSeconds(
      viewerTier === 'premium' ? PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS : getTierRefreshSeconds(viewerTier)
    );
    setCadenceAnchorNet(null);
  }, [viewerTier]);

  useEffect(() => {
    if (!debug) return;
    debugLog('debug_enabled', {
      origin: typeof window !== 'undefined' ? window.location.origin : null,
      href: typeof window !== 'undefined' ? window.location.href : null,
      baseURI: typeof document !== 'undefined' ? document.baseURI : null,
      search: searchParams.toString(),
      hasInitialPage: initialMatchesPage,
      initialOffset,
      initialLaunches: initialLaunches.length,
      initialNowMs: initialNowMsValue ?? null
    });
  }, [debug, debugLog, initialLaunches.length, initialMatchesPage, initialNowMsValue, initialOffset, searchParams]);

  useEffect(() => {
    if (!debug) return;
    const onVisibility = () => debugLog('visibilitychange', { visibilityState: document.visibilityState });
    const onFocus = () => debugLog('window_focus');
    const onBlur = () => debugLog('window_blur');
    const onOnline = () => debugLog('window_online');
    const onOffline = () => debugLog('window_offline');
    const onPageShow = (event: PageTransitionEvent) => debugLog('pageshow', { persisted: event.persisted });
    const onPageHide = (event: PageTransitionEvent) => debugLog('pagehide', { persisted: event.persisted });

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('pagehide', onPageHide);

    debugLog('listeners_attached');
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
      debugLog('listeners_removed');
    };
  }, [debug, debugLog]);

  const filteredLaunches = useMemo(() => {
    if (!query) return launches;
    const q = query.toLowerCase();
    return launches.filter((launch) => {
      const haystack = [
        launch.name,
        launch.provider,
        launch.vehicle,
        launch.pad?.name,
        launch.pad?.locationName,
        launch.pad?.state,
        launch.mission?.name,
        launch.mission?.type,
        launch.mission?.orbit
      ]
        .filter(Boolean)
        .join(' • ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [launches, query]);

  const launchFeedWatchlistDependency = myLaunchesEnabled ? myWatchlistId : null;

  useEffect(() => {
    if (authStatus !== 'guest') return;
    setFilters((prev) => {
      const isDefault =
        prev.range === DEFAULT_LAUNCH_FILTERS.range &&
        prev.sort === DEFAULT_LAUNCH_FILTERS.sort &&
        prev.region === DEFAULT_LAUNCH_FILTERS.region &&
        !prev.location &&
        !prev.state &&
        !prev.pad &&
        !prev.provider &&
        !prev.status;
      if (isDefault) return prev;
      return { ...DEFAULT_LAUNCH_FILTERS };
    });
  }, [authStatus]);

  useEffect(() => {
    lastSeenLiveVersionRef.current = null;
    setPendingRefresh(null);
    setChanged([]);
  }, [filters, launchFeedWatchlistDependency, mode, viewerTier]);

  useEffect(() => {
    setModeOverride(null);
  }, [authStatus, baseViewerTier]);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) setUserTz(tz);
  }, []);

  useEffect(() => {
    const value = readCookieValue(PRIVACY_COOKIES.blockEmbeds);
    if (value === '1') setBlockThirdPartyEmbeds(true);
    if (value === '0') setBlockThirdPartyEmbeds(false);
  }, []);

  useEffect(() => {
    // Remove legacy premium view/theme storage and URLs.
    try {
      window.localStorage.removeItem('tminus.launch_feed_experience');
      window.localStorage.removeItem('tminus.launch_feed_experience.crash');
    } catch {
      // ignore
    }

    const qs = new URLSearchParams(searchParams.toString());
    if (!qs.has('view')) return;
    qs.delete('view');
    const queryString = qs.toString();
    safeRouterReplace(queryString ? `/?${queryString}` : '/');
  }, [safeRouterReplace, searchParams]);

  const resetPageToFirst = useCallback(() => {
    const qs = new URLSearchParams(searchParams.toString());
    qs.delete('page');
    const queryString = qs.toString();
    safeRouterReplace(queryString ? `/?${queryString}` : '/');
  }, [safeRouterReplace, searchParams]);

  useEffect(() => {
    if (!canManageFilterPresets) {
      setActivePresetId('');
      setPresetDefaulting(false);
      didApplyInitialDefaultPresetRef.current = false;
      return;
    }
    const defaultPreset = presetList.find((preset) => preset.is_default === true) ?? null;
    if (defaultPreset?.id) {
      setActivePresetId(defaultPreset.id);
    }
    if (!didApplyInitialDefaultPresetRef.current) {
      if (defaultPreset?.filters) {
        setFilters((prev) => (areLaunchFiltersEqual(prev, defaultPreset.filters) ? prev : defaultPreset.filters));
      }
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
    if (!areLaunchFiltersEqual(filters, preset.filters)) {
      setActivePresetId('');
    }
  }, [activePresetId, filters, presetList]);

  useEffect(() => {
    if (!canUseSavedItems) {
      setMyLaunchesEnabled(false);
      setFollowToggleBusy((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      didRequestMyWatchlistRef.current = false;
      return;
    }

    if (!selectedWatchlist) {
      if (!didRequestMyWatchlistRef.current && !createWatchlistMutation.isPending) {
        didRequestMyWatchlistRef.current = true;
        createWatchlistMutation.mutate(
          {},
          {
            onError: (error) => {
              setNotice({ tone: 'warning', message: error instanceof Error ? error.message : 'failed_to_create' });
            }
          }
        );
      }
      return;
    }

    didRequestMyWatchlistRef.current = false;
  }, [canUseSavedItems, createWatchlistMutation, selectedWatchlist]);

  useEffect(() => {
    if (!isAuthed) {
      return;
    }
    if (!filterOptionsQuery.data) return;

    setFilters((prev) => {
      let changed = false;
      const next: LaunchFilter = { ...prev };

      if (prev.location && !filterOptions.locations.includes(prev.location)) {
        next.location = undefined;
        changed = true;
      }
      if (prev.state && !filterOptions.states.includes(prev.state)) {
        next.state = undefined;
        changed = true;
      }
      if (prev.pad && !filterOptions.pads.includes(prev.pad)) {
        next.pad = undefined;
        changed = true;
      }
      if (prev.provider && !filterOptions.providers.includes(prev.provider)) {
        next.provider = undefined;
        changed = true;
      }
      if (prev.status && prev.status !== 'all' && !filterOptions.statuses.includes(prev.status)) {
        next.status = 'all';
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [filterOptions, filterOptionsQuery.data, isAuthed]);

  const fetchPage = useCallback(
    async ({ offset, replace, reason }: { offset: number; replace: boolean; reason: string }) => {
      fetchSeqRef.current += 1;
      const seq = fetchSeqRef.current;
      const snapshot = latestRef.current;
      const filtersNow = snapshot.filters;
      const modeNow = snapshot.mode;
      const watchlistId = snapshot.myLaunchesEnabled && snapshot.viewerTier !== 'anon' ? snapshot.myWatchlistId : null;
      debugLog('fetchPage_start', {
        reason,
        offset,
        replace,
        mode: snapshot.mode,
        viewerTier: snapshot.viewerTier,
        isAuthed: snapshot.isAuthed,
        loading: snapshot.loading,
        loadingMore: snapshot.loadingMore,
        pageOffset: snapshot.pageOffset,
        nextOffset: snapshot.nextOffset,
        hasMore: snapshot.hasMore,
        query: snapshot.query
      });
      if (debug && replace) {
        console.trace(`[${debugName}] fetchPage trace (${reason})`);
      }

      if (replace) {
        setLoading(true);
        setLoadingMore(false);
      } else {
        setLoadingMore(true);
      }

      try {
        const request = {
          scope: watchlistId ? ('watchlist' as const) : modeNow,
          watchlistId,
          range: filtersNow.range || '7d',
          sort: filtersNow.sort || 'soonest',
          region: filtersNow.region ?? 'us',
          limit: PAGE_SIZE,
          offset,
          location: filtersNow.location ?? null,
          state: filtersNow.state ?? null,
          pad: filtersNow.pad ?? null,
          provider: filtersNow.provider ?? null,
          status: filtersNow.status && filtersNow.status !== 'all' ? filtersNow.status : null
        };
        debugLog('fetchPage_request', { reason, request });
        const payload = await queryClient.fetchQuery(getLaunchFeedPageQueryOptions(request));
        const rows = payload.launches as Launch[];
        debugLog('fetchPage_response', { reason, scope: payload.scope ?? request.scope, rows: rows.length, hasMore: payload.hasMore });
        setLastCheckedAtMs(Date.now());
        setLaunches((prev) => {
          if (replace) return rows;
          const existing = new Set(prev.map((launch) => launch.id));
          const merged = [...prev];
          rows.forEach((row) => {
            if (!existing.has(row.id)) merged.push(row);
          });
          return merged;
        });
        setNextOffset(offset + rows.length);
        const hasMoreValue = typeof payload?.hasMore === 'boolean' ? payload.hasMore : rows.length === PAGE_SIZE;
        setHasMore(hasMoreValue);
        if (modeNow === 'live' || watchlistId) {
          setNotice(null);
          setModeOverride(null);
        }
      } catch (err) {
        const status = err instanceof ApiClientError ? err.status : typeof (err as any)?.status === 'number' ? (err as any).status : null;
        const code = err instanceof ApiClientError ? err.code : typeof (err as any)?.code === 'string' ? (err as any).code : null;
        if (status === 401) {
          applyGuestViewerState(queryClient);
          setMyLaunchesEnabled(false);
          setModeOverride('public');
          setNotice({
            tone: 'warning',
            message: watchlistId ? 'Sign in to keep using Following. Showing the public feed.' : 'Sign in to view the live feed. Showing the public cache.'
          });
          debugLog('fetchPage_fallback_401', { reason, code });
          return;
        }
        if (status === 402) {
          if (snapshot.viewerTier === 'premium') {
            console.warn('[LaunchFeed] entitlement_mismatch_402', { reason, code });
          }
          invalidateViewerScopedQueries(queryClient);
          setMyLaunchesEnabled(false);
          setModeOverride('public');
          setNotice({
            tone: 'warning',
            message: watchlistId ? 'Following is not available on this plan. Showing the public feed.' : 'Live feed is a Premium feature. Showing the public cache.'
          });
          debugLog('fetchPage_fallback_402', { reason, code });
          return;
        }

        const message =
          code === 'supabase_not_configured'
            ? 'Data source not configured. Add Supabase env vars in Vercel.'
            : code
              ? `Feed error: ${code}`
              : err instanceof Error && err.message
                ? err.message
                : 'Feed error: failed_to_load';
        setNotice({ tone: 'warning', message });
        console.error('feed fetch error', reason, err);
        debugLog('fetchPage_error', { reason, error: message });
      } finally {
        if (fetchSeqRef.current !== seq) return;
        setLoading(false);
        setLoadingMore(false);
        debugLog('fetchPage_done', { reason });
      }
    },
    [debug, debugLog, debugName, queryClient]
  );

  useEffect(() => {
    const hasInitialPage =
      initialLaunchesRef.current.length > 0 && initialOffsetRef.current === pageOffset;

    if (!didInitialFetchRef.current && hasInitialPage) {
      didInitialFetchRef.current = true;
      return;
    }

    didInitialFetchRef.current = true;
    void fetchPage({ offset: pageOffset, replace: true, reason: 'page_or_filters_change' });
  }, [fetchPage, filters, mode, myLaunchesEnabled, launchFeedWatchlistDependency, pageOffset]);

  const fetchRecentChanges = useCallback(async () => {
    if (viewerTier !== 'premium') {
      setChanged([]);
      return;
    }
    try {
      const payload = await queryClient.fetchQuery(
        getChangedLaunchesQueryOptions({
          hours: 24,
          region: filters.region ?? 'us'
        })
      );
      setChanged(Array.isArray(payload.results) ? payload.results : []);
    } catch (err) {
      const status = err instanceof ApiClientError ? err.status : typeof (err as any)?.status === 'number' ? (err as any).status : null;
      const code = err instanceof ApiClientError ? err.code : typeof (err as any)?.code === 'string' ? (err as any).code : null;
      if (status === 401) {
        applyGuestViewerState(queryClient);
        setModeOverride('public');
        setNotice({ tone: 'warning', message: 'Sign in to view live changes. Showing the public cache.' });
        setChanged([]);
        return;
      }
      if (status === 402) {
        if (viewerTier === 'premium') {
          console.warn('[LaunchFeed] entitlement_mismatch_402', { source: 'recent_changes', code });
        }
        invalidateViewerScopedQueries(queryClient);
        setModeOverride('public');
        setNotice({ tone: 'warning', message: 'Live changes are a Premium feature. Showing the public cache.' });
        setChanged([]);
        return;
      }
      console.error('changed fetch error', err);
      if (code) {
        setNotice({ tone: 'warning', message: `Changes error: ${code}` });
      }
    }
  }, [filters.region, queryClient, viewerTier]);

  useEffect(() => {
    setRecentFlipIndex(0);
  }, [recentChanges.length]);

  useEffect(() => {
    if (recentExpanded || recentChanges.length <= 1) return;
    const interval = setInterval(() => {
      setRecentFlipIndex((prev) => (prev + 1) % recentChanges.length);
    }, 4200);
    return () => clearInterval(interval);
  }, [recentChanges.length, recentExpanded]);

  useEffect(() => {
    if (launchFeedWatchlistDependency) {
      setNextRefreshAt(null);
      return;
    }
    if (!Number.isFinite(refreshIntervalMs) || refreshIntervalMs <= 0) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const canCheckForUpdates = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return false;
      }
      if (typeof navigator !== 'undefined' && 'onLine' in navigator && navigator.onLine === false) {
        return false;
      }
      return true;
    };

    const fetchPendingChangeSummaries = async () => {
      if (latestRef.current.viewerTier !== 'premium') {
        return [];
      }
      try {
        const payload = await queryClient.fetchQuery(
          getChangedLaunchesQueryOptions({
            hours: 24,
            region: latestRef.current.filters.region ?? 'us'
          })
        );
        const results = Array.isArray(payload.results) ? payload.results : [];
        setChanged(results);
        return results
          .slice(0, 2)
          .map((item) => String(item.summary || item.name || '').trim())
          .filter(Boolean);
      } catch (error) {
        console.error('pending refresh change summary error', error);
        return [];
      }
    };

    const evaluateVersionMismatch = async () => {
      if (!canCheckForUpdates()) {
        debugLog('refresh_paused_inactive');
        return;
      }
      if (loading || loadingMore || refreshApplying) {
        debugLog('refresh_tick_skipped_loading', { loading, loadingMore, refreshApplying });
        return;
      }

      const snapshot = latestRef.current;
      const versionFilters = snapshot.filters;
      const versionRequest = {
        scope: snapshot.mode,
        range: versionFilters.range || '7d',
        region: versionFilters.region ?? 'us',
        location: versionFilters.location ?? null,
        state: versionFilters.state ?? null,
        pad: versionFilters.pad ?? null,
        provider: versionFilters.provider ?? null,
        status: versionFilters.status && versionFilters.status !== 'all' ? versionFilters.status : null
      } as const;
      debugLog('refresh_tick_version_check', versionRequest);

      try {
        const payload = await fetchLaunchFeedVersion(queryClient, versionRequest);
        setLastCheckedAtMs(Date.now());
        setScheduledRefreshIntervalSeconds(
          getRecommendedLaunchRefreshIntervalSeconds(payload.recommendedIntervalSeconds, fallbackRefreshIntervalSeconds)
        );
        setCadenceAnchorNet(typeof payload.cadenceAnchorNet === 'string' ? payload.cadenceAnchorNet : null);
        const nextVersion = typeof payload?.version === 'string' ? payload.version : null;
        const visibleUpdatedAt = getVisibleFeedUpdatedAt(launches, snapshot.mode);
        if (!nextVersion) {
          return;
        }
        if (!lastSeenLiveVersionRef.current) {
          lastSeenLiveVersionRef.current = nextVersion;
          const shouldPrimePending = shouldPrimeVersionRefresh(payload.updatedAt, visibleUpdatedAt);
          if (shouldPrimePending) {
            const summaries = await fetchPendingChangeSummaries();
            setPendingRefresh({
              version: nextVersion,
              matchCount: payload.matchCount,
              updatedAt: payload.updatedAt,
              summaries
            });
          }
          return;
        }
        if (nextVersion === lastSeenLiveVersionRef.current) {
          return;
        }

        lastSeenLiveVersionRef.current = nextVersion;
        const summaries = await fetchPendingChangeSummaries();
        setPendingRefresh({
          version: nextVersion,
          matchCount: payload.matchCount,
          updatedAt: payload.updatedAt,
          summaries
        });
      } catch (err) {
        const status = err instanceof ApiClientError ? err.status : typeof (err as any)?.status === 'number' ? (err as any).status : null;
        if (status === 401 || status === 402) {
          debugLog('refresh_tick_version_unauthorized', { status });
          await fetchPage({ offset: latestRef.current.pageOffset, replace: true, reason: 'scheduled_refresh_version_unauthorized' });
          setPendingRefresh(null);
          return;
        }
        console.error('feed refresh check error', err);
      }
    };

    const schedule = () => {
      if (cancelled) return;
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (!canCheckForUpdates()) {
        setNextRefreshAt(null);
        return;
      }
      const now = Date.now();
      const next = getNextAdaptiveLaunchRefreshMs({
        nowMs: now,
        intervalSeconds: refreshIntervalSeconds,
        cadenceAnchorNet
      });
      setNextRefreshAt(next);
      const delay = Math.max(0, next - now);
      debugLog('refresh_schedule', {
        viewerTier,
        refreshIntervalSeconds,
        now,
        next,
        delay,
        loading,
        loadingMore,
        cadenceAnchorNet
      });
      timeout = setTimeout(async () => {
        if (cancelled) return;
        await evaluateVersionMismatch();
        schedule();
      }, delay);
    };

    const resumeChecks = () => {
      if (cancelled || !canCheckForUpdates()) return;
      void evaluateVersionMismatch();
      schedule();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setNextRefreshAt(null);
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        return;
      }
      resumeChecks();
    };

    const handleFocus = () => resumeChecks();
    const handleOnline = () => resumeChecks();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);
    schedule();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
    };
  }, [
    debugLog,
    fetchPage,
    launchFeedWatchlistDependency,
    launches,
    loading,
    loadingMore,
    queryClient,
    refreshApplying,
    fallbackRefreshIntervalSeconds,
    refreshIntervalSeconds,
    refreshIntervalMs,
    cadenceAnchorNet,
    viewerTier
  ]);

  const nextArtemis = useMemo(() => findNextProgramLaunch(launches, nowMs, isArtemisLaunch), [launches, nowMs]);
  const nextStarship = useMemo(() => findNextProgramLaunch(launches, nowMs, isStarshipLaunch), [launches, nowMs]);

  const nextArtemisHref = useMemo(() => {
    if (!nextArtemis) return null;
    const variant = getArtemisVariantLabel(nextArtemis);
    if (variant === 'artemis-ii') return '/artemis-ii';
    if (variant === 'artemis') return '/artemis';
    return buildLaunchHref(nextArtemis);
  }, [nextArtemis]);

  const nextStarshipHref = useMemo(() => {
    if (!nextStarship) return null;
    const variant = getStarshipVariantLabel(nextStarship);
    if (variant && variant !== 'starship') return `/starship/${variant}`;
    if (variant === 'starship') return '/starship';
    return buildLaunchHref(nextStarship);
  }, [nextStarship]);

  const artemisTicker = useMemo(() => {
    if (!nextArtemis) return null;
    const timeLabel = formatProgramTickerTime(nextArtemis, userTz);
    const statusLabel = nextArtemis.statusText?.trim() || formatStatusLabel(nextArtemis.status);
    return {
      text: `Next Artemis | ${nextArtemis.name} | ${timeLabel} | Status: ${statusLabel}`,
      label: `Next Artemis flight: ${nextArtemis.name}. ${timeLabel}. Status ${statusLabel}.`
    };
  }, [nextArtemis, userTz]);

  const starshipTicker = useMemo(() => {
    if (!nextStarship) return null;
    const timeLabel = formatProgramTickerTime(nextStarship, userTz);
    const statusLabel = nextStarship.statusText?.trim() || formatStatusLabel(nextStarship.status);
    return {
      text: `Next Starship | ${nextStarship.name} | ${timeLabel} | Status: ${statusLabel}`,
      label: `Next Starship flight: ${nextStarship.name}. ${timeLabel}. Status ${statusLabel}.`
    };
  }, [nextStarship, userTz]);

  const programTickers = useMemo(() => {
    const tickers: ProgramTicker[] = [];

    if (artemisTicker && nextArtemisHref) {
      const netMs = parseLaunchNetMs(nextArtemis);
      if (Number.isFinite(netMs)) {
        tickers.push({
          key: 'artemis',
          href: nextArtemisHref,
          text: artemisTicker.text,
          label: artemisTicker.label,
          netMs
        });
      }
    }

    if (starshipTicker && nextStarshipHref) {
      const netMs = parseLaunchNetMs(nextStarship);
      if (Number.isFinite(netMs)) {
        tickers.push({
          key: 'starship',
          href: nextStarshipHref,
          text: starshipTicker.text,
          label: starshipTicker.label,
          netMs
        });
      }
    }

    tickers.sort((a, b) => a.netMs - b.netMs);
    return tickers;
  }, [artemisTicker, nextArtemis, nextArtemisHref, nextStarship, nextStarshipHref, starshipTicker]);

  const combinedProgramTicker = useMemo(() => {
    if (!programTickers.length) return null;
    const primary = programTickers[0];
    if (!primary) return null;

    const text = programTickers.map((ticker) => ticker.text).join('   •   ');
    const label = programTickers.map((ticker) => ticker.label).join(' ');

    return {
      href: primary.href,
      text,
      label
    };
  }, [programTickers]);

  const nextLaunchId = useMemo(() => {
    return findNextLaunchId(launches, nowMs);
  }, [launches, nowMs]);

  const activeRecentChange =
    recentChanges.length > 0 ? recentChanges[recentFlipIndex % recentChanges.length] : null;
  const followRuleCount =
    Object.keys(myLaunchRulesByLaunchId).length +
    Object.keys(myProviderRulesByProvider).length +
    Object.keys(myPadRulesByValue).length +
    Object.keys(myRocketRulesByValue).length +
    Object.keys(myLaunchSiteRulesByValue).length +
    Object.keys(myStateRulesByValue).length;
  const hasAnyFollowRules = followRuleCount > 0;
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if ((filters.range ?? DEFAULT_LAUNCH_FILTERS.range) !== DEFAULT_LAUNCH_FILTERS.range) count += 1;
    if ((filters.region ?? DEFAULT_LAUNCH_FILTERS.region) !== DEFAULT_LAUNCH_FILTERS.region) count += 1;
    if ((filters.sort ?? DEFAULT_LAUNCH_FILTERS.sort) !== DEFAULT_LAUNCH_FILTERS.sort) count += 1;
    if (filters.location) count += 1;
    if (filters.state) count += 1;
    if (filters.provider) count += 1;
    if (filters.pad) count += 1;
    if (filters.status && filters.status !== 'all') count += 1;
    return count;
  }, [filters]);
  const hasActiveFilters = activeFilterCount > 0;

  const includeSeconds = viewerTier === 'premium' && refreshIntervalSeconds < 60;
  const lastCheckedLabel = lastCheckedAtMs ? formatRefreshTime(lastCheckedAtMs, includeSeconds) : null;
  const nextCheckLabel = nextRefreshAt ? formatRefreshTime(nextRefreshAt, includeSeconds) : null;
  const premiumCadenceLabel =
    refreshIntervalSeconds <= 15
      ? 'Live checks every 15 seconds during the active launch window'
      : 'Live checks every 2 minutes outside the active launch window';
  const premiumFreshnessLine =
    viewerTier === 'premium'
      ? `${premiumCadenceLabel}${lastCheckedLabel ? ` • Last checked ${lastCheckedLabel}` : ''}${nextCheckLabel ? ` • Next check ${nextCheckLabel}` : ''}`
      : null;
  const nonPremiumPriceLine = 'Premium is $3.99/mo • cancel anytime';
  const homeSignInHref = buildAuthHref('sign-in', { returnTo: '/' });
  const homeUpgradeHref = buildUpgradeHref({ returnTo: '/' });
  const showModeStatusCard = authStatus !== 'loading' && !query && !unlocksDismissed;
  const showAlertsNudge = false;
  const modeStatusEyebrow = viewerTier === 'premium' ? 'Live mode' : 'Public mode';
  const modeStatusTitle =
    viewerTier === 'premium'
      ? 'Live updates are active.'
      : 'Public browsing is active.';
  const modeStatusBody =
    viewerTier === 'premium'
      ? premiumFreshnessLine || 'Premium keeps the feed on the live cadence while launches are active.'
      : 'Browse launches, filters, and the launch calendar on the public cadence. Premium adds live data, saved items, browser alerts, recurring integrations, and the live change log.';
  const modePrimaryHref = viewerTier === 'premium' ? '/account' : homeUpgradeHref;
  const modePrimaryLabel = viewerTier === 'premium' ? 'Open account' : 'See Premium';

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (infiniteScrollArmed) return;
    const onScroll = () => {
      if (window.scrollY > 0) setInfiniteScrollArmed(true);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [infiniteScrollArmed]);

  useEffect(() => {
    if (!infiniteScrollArmed) return;
    if (!hasMore || loading || loadingMore || Boolean(query)) return;
    if (launches.length === 0) return;
    if (nextOffset <= pageOffset) return;
    const node = loadMoreRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        debugLog('infinite_scroll_trigger', { nextOffset });
        void fetchPage({ offset: nextOffset, replace: false, reason: 'infinite_scroll' });
      },
      { rootMargin: '300px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [debugLog, fetchPage, hasMore, infiniteScrollArmed, launches.length, loading, loadingMore, nextOffset, pageOffset, query]);

  const applyPendingRefresh = useCallback(async () => {
    if (!pendingRefresh || refreshApplying) {
      return;
    }

    setRefreshApplying(true);
    try {
      await fetchPage({ offset: latestRef.current.pageOffset, replace: true, reason: 'pending_refresh_apply' });
      if (latestRef.current.viewerTier === 'premium') {
        await fetchRecentChanges();
      }
      lastSeenLiveVersionRef.current = pendingRefresh.version;
      setPendingRefresh(null);
    } finally {
      setRefreshApplying(false);
    }
  }, [fetchPage, fetchRecentChanges, pendingRefresh, refreshApplying]);

  useEffect(() => {
    if (!pendingRefresh || refreshApplying || loading || loadingMore) {
      return;
    }
    void applyPendingRefresh();
  }, [applyPendingRefresh, loading, loadingMore, pendingRefresh, refreshApplying]);

  const applyPreset = useCallback(
    (presetId: string) => {
      if (!presetId) {
        setActivePresetId('');
        return;
      }

      const preset = presetList.find((candidate) => candidate.id === presetId);
      if (!preset) return;

      setActivePresetId(presetId);
      setFilters(preset.filters);
      resetPageToFirst();
    },
    [presetList, resetPageToFirst]
  );

  const savePreset = useCallback(async () => {
    if (!canManageFilterPresets) return;
    if (presetSaving) return;

    const suggested = activePresetId
      ? presetList.find((preset) => preset.id === activePresetId)?.name || 'Preset'
      : `Preset ${new Date().toLocaleDateString()}`;
    const name = window.prompt('Preset name', suggested)?.trim();
    if (!name) return;

    setPresetSaving(true);
    try {
      const payload = await createFilterPresetMutation.mutateAsync({
        name,
        filters,
        isDefault: false
      });
      if (payload.preset?.id) {
        setActivePresetId(String(payload.preset.id));
        setNotice({ tone: 'info', message: 'Preset saved.' });
      }
    } catch (error) {
      console.error('preset save error', error);
      if (error instanceof ApiClientError && error.code === 'limit_reached') {
        setNotice({ tone: 'warning', message: 'Saved view limit reached. Remove an older saved view in Account first.' });
        return;
      }
      setNotice({ tone: 'warning', message: 'Unable to save preset.' });
    } finally {
      setPresetSaving(false);
    }
  }, [activePresetId, canManageFilterPresets, createFilterPresetMutation, filters, presetList, presetSaving]);

  const setActivePresetAsDefault = useCallback(async () => {
    if (!canManageFilterPresets) return;
    const presetId = activePresetId ? String(activePresetId).trim() : '';
    if (!presetId) return;
    if (presetDefaulting) return;

    setPresetDefaulting(true);
    try {
      const payload = await updateFilterPresetMutation.mutateAsync({
        presetId,
        payload: { isDefault: true }
      });
      const savedId = payload.preset?.id ? String(payload.preset.id) : presetId;
      setActivePresetId(savedId);
      setNotice({ tone: 'info', message: 'Default view updated.' });
    } catch (error) {
      console.error('preset default update error', error);
      setNotice({ tone: 'warning', message: 'Unable to set default view.' });
    } finally {
      setPresetDefaulting(false);
    }
  }, [activePresetId, canManageFilterPresets, presetDefaulting, updateFilterPresetMutation]);

  const clearFiltersToDefault = useCallback(() => {
    setActivePresetId('');
    setFilters((prev) => {
      if (
        (prev.range ?? DEFAULT_LAUNCH_FILTERS.range) === DEFAULT_LAUNCH_FILTERS.range &&
        (prev.sort ?? DEFAULT_LAUNCH_FILTERS.sort) === DEFAULT_LAUNCH_FILTERS.sort &&
        (prev.region ?? DEFAULT_LAUNCH_FILTERS.region) === DEFAULT_LAUNCH_FILTERS.region &&
        !prev.location &&
        !prev.state &&
        !prev.pad &&
        !prev.provider &&
        (!prev.status || prev.status === 'all')
      ) {
        return prev;
      }
      return { ...DEFAULT_LAUNCH_FILTERS };
    });
    resetPageToFirst();
  }, [resetPageToFirst]);

  const toggleMyLaunches = useCallback(
    (nextEnabled: boolean) => {
      setMyLaunchesEnabled(nextEnabled);
      resetPageToFirst();
    },
    [resetPageToFirst]
  );

  const createWatchlistRule = useCallback(
    (
      watchlistId: string,
      ruleType: 'launch' | 'pad' | 'provider' | 'rocket' | 'launch_site' | 'state' | 'tier',
      ruleValue: string
    ) =>
      createWatchlistRuleMutation.mutateAsync({
        watchlistId,
        payload: {
          ruleType,
          ruleValue
        }
      }),
    [createWatchlistRuleMutation]
  );

  const deleteWatchlistRule = useCallback(
    (watchlistId: string, ruleId: string) =>
      deleteWatchlistRuleMutation.mutateAsync({
        watchlistId,
        ruleId
      }),
    [deleteWatchlistRuleMutation]
  );

  const toggleWatchLaunch = useCallback(
    async (launchId: string, options?: { skipToast?: boolean }) => {
      if (!canUseSavedItems) return;
      if (!myWatchlistId) {
        setNotice({ tone: 'warning', message: 'My Launches is still loading.' });
        return;
      }

      if (watchToggleBusy[launchId]) return;
      setWatchToggleBusy((prev) => ({ ...prev, [launchId]: true }));

      const existingRuleId = myLaunchRulesByLaunchId[launchId] || null;
      try {
        debugLog('watch_toggle_start', {
          launchId,
          isWatched: Boolean(existingRuleId),
          watchlistId: myWatchlistId ? `${myWatchlistId.slice(0, 8)}…` : null,
          myLaunchesEnabled
        });
        if (existingRuleId) {
          debugLog('watch_toggle_request', { method: 'DELETE', watchlistId: myWatchlistId, ruleId: existingRuleId });
          await deleteWatchlistRule(myWatchlistId, existingRuleId);
          debugLog('watch_toggle_response', { method: 'DELETE', watchlistId: myWatchlistId, ruleId: existingRuleId, ok: true });
          invalidateLaunchFeedQueries(queryClient);
          if (myLaunchesEnabled) {
            setLaunches((prev) => prev.filter((launch) => launch.id !== launchId));
          }
          if (!options?.skipToast) {
            pushToast({
              message: 'Removed from My Launches.',
              tone: 'info',
              onUndo: async () => {
                const watchlistId = latestRef.current.myWatchlistId;
                if (!watchlistId) return;
                try {
                  await createWatchlistRule(watchlistId, 'launch', launchId);
                  invalidateLaunchFeedQueries(queryClient);
                  if (latestRef.current.myLaunchesEnabled) {
                    void fetchPage({ offset: latestRef.current.pageOffset, replace: true, reason: 'watchlist_rule_undo_launch' });
                  }
                } catch (error) {
                  setNotice({ tone: 'warning', message: buildWatchlistRuleErrorMessage(error, 'My Launches') });
                  return;
                }
              }
            });
          }
          debugLog('watch_toggle_success', { launchId, action: 'removed' });
          return;
        }

        debugLog('watch_toggle_request', { method: 'POST', watchlistId: myWatchlistId, launchId });
        const payload = await createWatchlistRule(myWatchlistId, 'launch', launchId);
        debugLog('watch_toggle_response', { method: 'POST', watchlistId: myWatchlistId, launchId, ok: true });
        const ruleId = payload.rule?.id ? String(payload.rule.id) : null;
        if (ruleId) {
          invalidateLaunchFeedQueries(queryClient);
          if (myLaunchesEnabled) {
            void fetchPage({ offset: latestRef.current.pageOffset, replace: true, reason: 'watchlist_rule_change_launch' });
          }
          if (!options?.skipToast) {
            pushToast({
              message: 'Added to My Launches.',
              tone: 'success',
              onUndo: async () => {
                const watchlistId = latestRef.current.myWatchlistId;
                if (!watchlistId) return;
                try {
                  await deleteWatchlistRule(watchlistId, ruleId);
                } catch (error) {
                  setNotice({
                    tone: 'warning',
                    message: buildWatchlistRuleErrorMessage(error, 'My Launches')
                  });
                  return;
                }
                invalidateLaunchFeedQueries(queryClient);
                if (latestRef.current.myLaunchesEnabled) {
                  setLaunches((prev) => prev.filter((launch) => launch.id !== launchId));
                }
              }
            });
          }
          debugLog('watch_toggle_success', { launchId, action: 'added', ruleId: `${ruleId.slice(0, 8)}…` });
        }
      } catch (err) {
        console.error('watch toggle error', err);
        setNotice({ tone: 'warning', message: buildWatchlistRuleErrorMessage(err, 'My Launches') });
        debugLog('watch_toggle_error', { launchId, error: String((err as any)?.message || err) });
      } finally {
        setWatchToggleBusy((prev) => ({ ...prev, [launchId]: false }));
      }
    },
    [
      createWatchlistRule,
      debugLog,
      deleteWatchlistRule,
      fetchPage,
      canUseSavedItems,
      myLaunchRulesByLaunchId,
      myLaunchesEnabled,
      myWatchlistId,
      pushToast,
      queryClient,
      watchToggleBusy
    ]
  );

  const toggleFollowProvider = useCallback(
    async (provider: string, options?: { skipToast?: boolean }) => {
      const normalizedProvider = String(provider || '').trim();
      if (!normalizedProvider) return;
      if (!canUseSavedItems) return;
      if (!myWatchlistId) {
        setNotice({ tone: 'warning', message: 'My Launches is still loading.' });
        return;
      }

      const busyKey = `provider:${normalizedProvider}`;
      if (followToggleBusy[busyKey]) return;
      setFollowToggleBusy((prev) => ({ ...prev, [busyKey]: true }));

      const existingRuleId = myProviderRulesByProvider[normalizedProvider] || null;
      try {
        debugLog('provider_follow_toggle_start', {
          provider: normalizedProvider,
          isFollowing: Boolean(existingRuleId),
          watchlistId: myWatchlistId ? `${myWatchlistId.slice(0, 8)}…` : null,
          myLaunchesEnabled
        });
        if (existingRuleId) {
          debugLog('provider_follow_request', { method: 'DELETE', watchlistId: myWatchlistId, ruleId: existingRuleId });
          await deleteWatchlistRule(myWatchlistId, existingRuleId);
          debugLog('provider_follow_response', { method: 'DELETE', watchlistId: myWatchlistId, ruleId: existingRuleId, ok: true });
          invalidateLaunchFeedQueries(queryClient);
          debugLog('provider_follow_toggle_success', { provider: normalizedProvider, action: 'unfollowed' });
          if (!options?.skipToast) {
            pushToast({
              message: `Unfollowed ${normalizedProvider}.`,
              tone: 'info',
              onUndo: async () => {
                const watchlistId = latestRef.current.myWatchlistId;
                if (!watchlistId) return;
                try {
                  await createWatchlistRule(watchlistId, 'provider', normalizedProvider);
                  invalidateLaunchFeedQueries(queryClient);

                  if (latestRef.current.myLaunchesEnabled) {
                    resetPageToFirst();
                    void fetchPage({ offset: 0, replace: true, reason: 'watchlist_rule_undo_provider' });
                  }
                } catch (error) {
                  setNotice({ tone: 'warning', message: buildWatchlistRuleErrorMessage(error, 'Follow') });
                  return;
                }
              }
            });
          }
        } else {
          debugLog('provider_follow_request', { method: 'POST', watchlistId: myWatchlistId, provider: normalizedProvider });
          const payload = await createWatchlistRule(myWatchlistId, 'provider', normalizedProvider);
          debugLog('provider_follow_response', { method: 'POST', watchlistId: myWatchlistId, provider: normalizedProvider, ok: true });
          const ruleId = payload.rule?.id ? String(payload.rule.id) : null;
          if (ruleId) {
            invalidateLaunchFeedQueries(queryClient);
            debugLog('provider_follow_toggle_success', {
              provider: normalizedProvider,
              action: 'followed',
              ruleId: `${ruleId.slice(0, 8)}…`
            });
            if (!options?.skipToast) {
              pushToast({
              message: `Following ${normalizedProvider}.`,
              tone: 'success',
              onUndo: async () => {
                const watchlistId = latestRef.current.myWatchlistId;
                if (!watchlistId) return;
                  try {
                    await deleteWatchlistRule(watchlistId, ruleId);
                  } catch (error) {
                    setNotice({
                      tone: 'warning',
                      message: buildWatchlistRuleErrorMessage(error, 'Follow')
                    });
                    return;
                  }
                  invalidateLaunchFeedQueries(queryClient);

                  if (latestRef.current.myLaunchesEnabled) {
                    resetPageToFirst();
                    void fetchPage({ offset: 0, replace: true, reason: 'watchlist_rule_undo_provider' });
                  }
                }
              });
            }
          }
        }

        if (myLaunchesEnabled) {
          resetPageToFirst();
          void fetchPage({ offset: 0, replace: true, reason: 'watchlist_rule_change_provider' });
        }
      } catch (err) {
        console.error('provider follow toggle error', err);
        setNotice({ tone: 'warning', message: buildWatchlistRuleErrorMessage(err, 'Follow') });
        debugLog('provider_follow_toggle_error', { provider: normalizedProvider, error: String((err as any)?.message || err) });
      } finally {
        setFollowToggleBusy((prev) => ({ ...prev, [busyKey]: false }));
      }
    },
    [
      debugLog,
      fetchPage,
      followToggleBusy,
      canUseSavedItems,
      myLaunchesEnabled,
      myProviderRulesByProvider,
      myWatchlistId,
      pushToast,
      queryClient,
      resetPageToFirst,
      createWatchlistRule,
      deleteWatchlistRule
    ]
  );

  const toggleFollowPad = useCallback(
    async (padRuleValue: string, options?: { skipToast?: boolean }) => {
      const normalized = String(padRuleValue || '').trim();
      if (!normalized) return;
      if (!canUseSavedItems) return;
      if (!myWatchlistId) {
        setNotice({ tone: 'warning', message: 'My Launches is still loading.' });
        return;
      }

      const busyKey = `pad:${normalized}`;
      if (followToggleBusy[busyKey]) return;
      setFollowToggleBusy((prev) => ({ ...prev, [busyKey]: true }));

      const existingRuleId = myPadRulesByValue[normalized] || null;
      try {
        debugLog('pad_follow_toggle_start', {
          padRuleValue: normalized,
          isFollowing: Boolean(existingRuleId),
          watchlistId: myWatchlistId ? `${myWatchlistId.slice(0, 8)}…` : null,
          myLaunchesEnabled
        });
        if (existingRuleId) {
          debugLog('pad_follow_request', { method: 'DELETE', watchlistId: myWatchlistId, ruleId: existingRuleId });
          await deleteWatchlistRule(myWatchlistId, existingRuleId);
          debugLog('pad_follow_response', { method: 'DELETE', watchlistId: myWatchlistId, ruleId: existingRuleId, ok: true });
          invalidateLaunchFeedQueries(queryClient);
          debugLog('pad_follow_toggle_success', { padRuleValue: normalized, action: 'unfollowed' });
          if (!options?.skipToast) {
            pushToast({
              message: `Unfollowed ${formatPadRuleLabel(normalized)}.`,
              tone: 'info',
              onUndo: async () => {
                const watchlistId = latestRef.current.myWatchlistId;
                if (!watchlistId) return;
                try {
                  await createWatchlistRule(watchlistId, 'pad', normalized);
                  invalidateLaunchFeedQueries(queryClient);

                  if (latestRef.current.myLaunchesEnabled) {
                    resetPageToFirst();
                    void fetchPage({ offset: 0, replace: true, reason: 'watchlist_rule_undo_pad' });
                  }
                } catch (error) {
                  setNotice({ tone: 'warning', message: buildWatchlistRuleErrorMessage(error, 'Follow') });
                  return;
                }
              }
            });
          }
        } else {
          debugLog('pad_follow_request', { method: 'POST', watchlistId: myWatchlistId, padRuleValue: normalized });
          const payload = await createWatchlistRule(myWatchlistId, 'pad', normalized);
          debugLog('pad_follow_response', { method: 'POST', watchlistId: myWatchlistId, padRuleValue: normalized, ok: true });
          const ruleId = payload.rule?.id ? String(payload.rule.id) : null;
          if (ruleId) {
            invalidateLaunchFeedQueries(queryClient);
            debugLog('pad_follow_toggle_success', { padRuleValue: normalized, action: 'followed', ruleId: `${ruleId.slice(0, 8)}…` });
            if (!options?.skipToast) {
              pushToast({
                message: `Following ${formatPadRuleLabel(normalized)}.`,
                tone: 'success',
                onUndo: async () => {
                  const watchlistId = latestRef.current.myWatchlistId;
                  if (!watchlistId) return;
                  try {
                    await deleteWatchlistRule(watchlistId, ruleId);
                  } catch (error) {
                    setNotice({
                      tone: 'warning',
                      message: buildWatchlistRuleErrorMessage(error, 'Follow')
                    });
                    return;
                  }
                  invalidateLaunchFeedQueries(queryClient);

                  if (latestRef.current.myLaunchesEnabled) {
                    resetPageToFirst();
                    void fetchPage({ offset: 0, replace: true, reason: 'watchlist_rule_undo_pad' });
                  }
                }
              });
            }
          }
        }

        if (myLaunchesEnabled) {
          resetPageToFirst();
          void fetchPage({ offset: 0, replace: true, reason: 'watchlist_rule_change_pad' });
        }
      } catch (err) {
        console.error('pad follow toggle error', err);
        setNotice({ tone: 'warning', message: buildWatchlistRuleErrorMessage(err, 'Follow') });
        debugLog('pad_follow_toggle_error', { padRuleValue: normalized, error: String((err as any)?.message || err) });
      } finally {
        setFollowToggleBusy((prev) => ({ ...prev, [busyKey]: false }));
      }
    },
    [
      debugLog,
      fetchPage,
      followToggleBusy,
      canUseSavedItems,
      myLaunchesEnabled,
      myPadRulesByValue,
      myWatchlistId,
      pushToast,
      queryClient,
      resetPageToFirst,
      createWatchlistRule,
      deleteWatchlistRule
    ]
  );

  const toggleFollowRule = useCallback(
    async (ruleType: 'rocket' | 'launch_site' | 'state', ruleValue: string, label: string) => {
      const normalized = String(ruleValue || '').trim();
      if (!normalized) return;
      if (!canUseSavedItems) return;
      if (!myWatchlistId) {
        setNotice({ tone: 'warning', message: 'My Launches is still loading.' });
        return;
      }

      const busyKey = `${ruleType}:${normalized.toLowerCase()}`;
      if (followToggleBusy[busyKey]) return;
      setFollowToggleBusy((prev) => ({ ...prev, [busyKey]: true }));

      const ruleMap =
        ruleType === 'rocket'
          ? myRocketRulesByValue
          : ruleType === 'launch_site'
            ? myLaunchSiteRulesByValue
            : myStateRulesByValue;
      const existingRuleId = ruleMap[normalized.toLowerCase()] || null;

      try {
        if (existingRuleId) {
          await deleteWatchlistRule(myWatchlistId, existingRuleId);
          invalidateLaunchFeedQueries(queryClient);
          pushToast({ message: `Unfollowed ${label}.`, tone: 'info' });
          return;
        }

        const payload = await createWatchlistRule(myWatchlistId, ruleType, normalized);
        const ruleId = payload.rule?.id ? String(payload.rule.id) : null;
        if (ruleId) {
          invalidateLaunchFeedQueries(queryClient);
          pushToast({
            message: `Following ${label}.`,
            tone: 'success',
            onUndo: async () => {
              const watchlistId = latestRef.current.myWatchlistId;
              if (!watchlistId) return;
              try {
                await deleteWatchlistRule(watchlistId, ruleId);
              } catch (error) {
                setNotice({ tone: 'warning', message: buildWatchlistRuleErrorMessage(error, 'Follow') });
              }
            }
          });
        }
      } catch (err) {
        console.error('follow toggle error', err);
        setNotice({ tone: 'warning', message: buildWatchlistRuleErrorMessage(err, 'Follow') });
      } finally {
        setFollowToggleBusy((prev) => ({ ...prev, [busyKey]: false }));
      }
    },
    [
      canUseSavedItems,
      createWatchlistRule,
      deleteWatchlistRule,
      followToggleBusy,
      myLaunchSiteRulesByValue,
      myRocketRulesByValue,
      myStateRulesByValue,
      myWatchlistId,
      pushToast,
      queryClient
    ]
  );

  const toggleBasicLaunchFollow = useCallback(
    async (launch: Launch) => {
      void launch;
      setNotice({
        tone: 'info',
        message: 'Launch alerts are managed in the native iOS or Android app. Open Notifications for the current setup.'
      });
      router.push('/me/preferences');
    },
    [router]
  );

  const renderLaunchCard = useCallback(
    (launch: Launch, { isNext }: { isNext: boolean }) => {
      const providerKey = String(launch.provider || '').trim();
      const padRuleValue = buildPadRuleValue(launch);
      const rocketRuleValue = buildRocketRuleValue(launch);
      const launchSiteRuleValue = buildLaunchSiteRuleValue(launch);
      const stateRuleValue = buildStateRuleValue(launch);
      const currentBasicLaunchActive = activeBasicLaunchFollow?.launchId === launch.id.toLowerCase();
      const basicLaunchDescription = currentBasicLaunchActive
        ? 'This launch is already tracked on your account. Manage it in the native iOS or Android app.'
        : 'Manage launch push reminders for this launch in the native iOS or Android app.';
      const providerLockedDescription = providerKey
        ? `All launches from ${providerKey}. Premium unlocks recurring provider follows.`
        : 'Provider follow unavailable for this card.';
      const rocketLockedDescription = rocketRuleValue
        ? `All launches for ${formatRocketRuleLabel(rocketRuleValue)}. Premium unlocks recurring rocket follows.`
        : 'Rocket follow unavailable for this card.';
      const padLockedDescription = padRuleValue
        ? `Launches from ${formatPadRuleLabel(padRuleValue)}. Premium unlocks recurring pad follows.`
        : 'Pad follow unavailable for this card.';
      const launchSiteLockedDescription = launchSiteRuleValue
        ? `Launches from ${launchSiteRuleValue}. Premium unlocks recurring launch-site follows.`
        : 'Launch-site follow unavailable for this card.';
      const stateLockedDescription = stateRuleValue
        ? `Launches in ${stateRuleValue.toUpperCase()}. Premium unlocks state-wide follows.`
        : 'State follow unavailable for this card.';
      const basicFollowOptions = [
        {
          key: 'launch',
          label: 'This launch',
          description: basicLaunchDescription,
          active: currentBasicLaunchActive,
          disabled: false,
          locked: false,
          onPress: () => {
            void toggleBasicLaunchFollow(launch);
          }
        },
        {
          key: 'provider',
          label: 'This provider',
          description: providerLockedDescription,
          active: false,
          disabled: !providerKey,
          locked: Boolean(providerKey),
          onPress: () => openUpsell('Provider follows')
        },
        {
          key: 'rocket',
          label: 'This rocket',
          description: rocketLockedDescription,
          active: false,
          disabled: !rocketRuleValue,
          locked: Boolean(rocketRuleValue),
          onPress: () => openUpsell('Rocket follows')
        },
        {
          key: 'pad',
          label: 'This pad',
          description: padLockedDescription,
          active: false,
          disabled: !padRuleValue,
          locked: Boolean(padRuleValue),
          onPress: () => openUpsell('Pad follows')
        },
        {
          key: 'launch_site',
          label: 'This launch site',
          description: launchSiteLockedDescription,
          active: false,
          disabled: !launchSiteRuleValue,
          locked: Boolean(launchSiteRuleValue),
          onPress: () => openUpsell('Launch-site follows')
        },
        {
          key: 'state',
          label: 'This state',
          description: stateLockedDescription,
          active: false,
          disabled: !stateRuleValue,
          locked: Boolean(stateRuleValue),
          onPress: () => openUpsell('State follows')
        }
      ];
      const premiumFollowOptions = [
        {
          key: 'launch',
          label: 'This launch',
          description: 'Keep this exact launch in Following.',
          active: Boolean(myLaunchRulesByLaunchId[launch.id]),
          disabled: Boolean(watchToggleBusy[launch.id]) || !myWatchlistId || watchlistsLoading || Boolean(watchlistsError),
          locked: false,
          onPress: () => {
            void toggleWatchLaunch(launch.id);
          }
        },
        {
          key: 'provider',
          label: 'This provider',
          description: providerKey ? `All launches from ${providerKey}.` : 'Provider follow unavailable.',
          active: providerKey ? Boolean(myProviderRulesByProvider[providerKey]) : false,
          disabled: !providerKey,
          locked: false,
          onPress: () => {
            if (!providerKey) return;
            void toggleFollowProvider(providerKey);
          }
        },
        {
          key: 'rocket',
          label: 'This rocket',
          description: rocketRuleValue ? `All launches for ${formatRocketRuleLabel(rocketRuleValue)}.` : 'Rocket follow unavailable.',
          active: Boolean(rocketRuleValue && myRocketRulesByValue[rocketRuleValue]),
          disabled: !rocketRuleValue,
          locked: false,
          onPress: () => {
            if (!rocketRuleValue) return;
            void toggleFollowRule('rocket', rocketRuleValue, formatRocketRuleLabel(rocketRuleValue));
          }
        },
        {
          key: 'pad',
          label: 'This pad',
          description: padRuleValue ? `Launches from ${formatPadRuleLabel(padRuleValue)}.` : 'Pad follow unavailable.',
          active: padRuleValue ? Boolean(myPadRulesByValue[padRuleValue]) : false,
          disabled: !padRuleValue,
          locked: false,
          onPress: () => {
            if (!padRuleValue) return;
            void toggleFollowPad(padRuleValue);
          }
        },
        {
          key: 'launch_site',
          label: 'This launch site',
          description: launchSiteRuleValue ? `Launches from ${launchSiteRuleValue}.` : 'Launch-site follow unavailable.',
          active: launchSiteRuleValue ? Boolean(myLaunchSiteRulesByValue[launchSiteRuleValue]) : false,
          disabled: !launchSiteRuleValue,
          locked: false,
          onPress: () => {
            if (!launchSiteRuleValue) return;
            void toggleFollowRule('launch_site', launchSiteRuleValue, launchSiteRuleValue);
          }
        },
        {
          key: 'state',
          label: 'This state',
          description: stateRuleValue ? `Launches in ${stateRuleValue.toUpperCase()}.` : 'State follow unavailable.',
          active: stateRuleValue ? Boolean(myStateRulesByValue[stateRuleValue]) : false,
          disabled: !stateRuleValue,
          locked: false,
          onPress: () => {
            if (!stateRuleValue) return;
            void toggleFollowRule('state', stateRuleValue, stateRuleValue.toUpperCase());
          }
        }
      ];
      const followOptions = canUseSavedItems ? premiumFollowOptions : basicFollowOptions;
      const activeFollowCount = followOptions.filter((option) => option.active).length;
      return (
        <LaunchCard
          launch={launch}
          isNext={isNext}
          showAlertsNudge={showAlertsNudge && isNext}
          isAuthed={isAuthed}
          isPaid={isPaid}
          canUseBasicAlertRules={canUseBasicAlertRules}
          isArEligible={arEligibleLaunchIdSet.has(launch.id)}
          onOpenUpsell={openUpsell}
          blockThirdPartyEmbeds={blockThirdPartyEmbeds}
          initialNowMs={initialNowMs}
          followMenuLabel={activeFollowCount > 0 ? 'Following' : 'Follow'}
          followMenuCapacityLabel={canUseSavedItems ? undefined : basicFollowCapacityLabel}
          followMenuOptions={followOptions}
        />
      );
    },
    [
      activeBasicLaunchFollow,
      arEligibleLaunchIdSet,
      basicFollowCapacityLabel,
      blockThirdPartyEmbeds,
      canUseBasicAlertRules,
      canUseSavedItems,
      initialNowMs,
      isAuthed,
      isPaid,
      myLaunchRulesByLaunchId,
      myLaunchSiteRulesByValue,
      myPadRulesByValue,
      myProviderRulesByProvider,
      myRocketRulesByValue,
      myStateRulesByValue,
      myWatchlistId,
      openUpsell,
      showAlertsNudge,
      toggleBasicLaunchFollow,
      toggleFollowPad,
      toggleFollowProvider,
      toggleFollowRule,
      toggleWatchLaunch,
      watchToggleBusy,
      watchlistsError,
      watchlistsLoading
    ]
  );

  return (
    <section className="space-y-4">
      <h2 className="sr-only">Launches</h2>
      <div className="sticky top-12 z-30 -mx-1 md:hidden">
        <div className="px-1">
          <div className="rounded-2xl border border-stroke bg-[rgba(7,9,19,0.78)] p-2 shadow-glow backdrop-blur-xl">
            <div className="flex items-center gap-2">
              {isAuthed ? (
                <button
                  type="button"
                  className="inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-text1 transition hover:border-primary/50 hover:text-primary"
                  onClick={openLaunchSearch}
                >
                  <SearchIcon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{query ? `Search: ${query}` : 'Search'}</span>
                </button>
              ) : (
                <Link
                  href={homeSignInHref}
                  className="inline-flex min-w-0 flex-1 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-text1 transition hover:border-primary/50 hover:text-primary"
                >
                  <span className="truncate">Sign in</span>
                </Link>
              )}
              {isAuthed ? (
                <button
                  type="button"
                  className={clsx(
                    'inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] transition',
                    filtersOpen
                      ? 'border-primary/60 bg-primary/12 text-primary'
                      : 'border-white/10 bg-white/5 text-text1 hover:border-primary/50 hover:text-primary'
                  )}
                  onClick={() => setFiltersOpen((open) => !open)}
                  aria-expanded={filtersOpen}
                  aria-controls={filtersPanelId}
                >
                  <FilterIcon className="h-4 w-4" />
                  <span>Filters</span>
                  {hasActiveFilters ? (
                    <span className="rounded-full border border-current/30 px-1.5 py-0.5 text-[10px] leading-none">
                      {activeFilterCount}
                    </span>
                  ) : null}
                </button>
              ) : null}
              {query ? (
                <button
                  type="button"
                  className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-text2 transition hover:border-primary/50 hover:text-text1"
                  onClick={() => router.push('/#schedule')}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {combinedProgramTicker && (
        <Link
          href={combinedProgramTicker.href}
          className={clsx('program-ticker', 'program-ticker--artemis')}
          aria-label={combinedProgramTicker.label}
          title={combinedProgramTicker.text}
        >
          <div className="program-ticker__track">
            <span className="program-ticker__item">{combinedProgramTicker.text}</span>
            <span className="program-ticker__item" aria-hidden="true">
              {combinedProgramTicker.text}
            </span>
          </div>
        </Link>
      )}
      {query && (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-stroke bg-[rgba(234,240,255,0.04)] px-3 py-2 text-xs text-text2">
          <div className="min-w-0">
            <div className="truncate">
              <span className="text-text3">Search:</span> <span className="font-semibold text-text1">{query}</span>
            </div>
            <div className="mt-1 text-[11px] text-text3">
              Showing {filteredLaunches.length} of {launches.length} loaded launches.
            </div>
          </div>
          <button
            type="button"
            className="shrink-0 text-xs text-primary hover:text-primary/80"
            onClick={() => router.push('/#schedule')}
          >
            Clear
          </button>
        </div>
      )}

      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-stroke bg-[rgba(234,240,255,0.04)] p-3 text-sm">
          <span className={notice.tone === 'warning' ? 'text-warning' : 'text-text2'}>{notice.message}</span>
          <button className="text-xs text-text3 hover:text-text1" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      {showModeStatusCard && (
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-[0.1em] text-text3">{modeStatusEyebrow}</div>
              <div className="mt-1 text-sm font-semibold text-text1">{modeStatusTitle}</div>
              <div className="mt-1 max-w-2xl text-xs text-text3">{modeStatusBody}</div>
              {!isAuthed && (
                <div className="mt-2 text-xs text-text3">
                  Already have an account?{' '}
                  <Link href={homeSignInHref} className="text-primary hover:text-primary/80">
                    Sign in
                  </Link>
                </div>
              )}
              {viewerTier !== 'premium' && <div className="mt-2 text-xs text-text3">{nonPremiumPriceLine}</div>}
            </div>
            <div className="flex items-center gap-3">
              <Link href={modePrimaryHref} className="btn rounded-lg px-3 py-2 text-xs">
                {modePrimaryLabel}
              </Link>
              <button type="button" className="text-xs text-text3 hover:text-text1" onClick={dismissUnlocks}>
                Hide
              </button>
            </div>
          </div>
        </div>
      )}

      {isAuthed && (
        <div className="rounded-2xl border border-stroke bg-surface-1 p-3 text-sm text-text3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1 rounded-xl border border-stroke bg-surface-0 p-1">
                {!myLaunchesEnabled ? (
                  <div className="inline-flex items-center gap-1 rounded-lg bg-primary p-1 text-black">
                    <span className="px-2.5 py-1.5 text-xs font-semibold uppercase tracking-[0.08em]">For You</span>
                    <button
                      type="button"
                      className={clsx(
                        'inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition',
                        filtersOpen
                          ? 'border-black/20 bg-black/15 text-black'
                          : 'border-black/12 bg-black/5 text-black/80 hover:bg-black/10'
                      )}
                      onClick={() => setFiltersOpen((open) => !open)}
                      aria-expanded={filtersOpen}
                      aria-controls={filtersPanelId}
                    >
                      <FilterIcon className="h-3.5 w-3.5" />
                      <span>Filters</span>
                      {hasActiveFilters ? (
                        <span className="rounded-full border border-black/20 px-1.5 py-0.5 text-[9px] leading-none">
                          {activeFilterCount}
                        </span>
                      ) : null}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-text2 transition hover:bg-[rgba(255,255,255,0.06)] hover:text-text1"
                    onClick={() => toggleMyLaunches(false)}
                    aria-pressed={!myLaunchesEnabled}
                  >
                    For You
                  </button>
                )}
                {canUseSavedItems ? (
                  <button
                    type="button"
                    className={clsx(
                      'rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] transition',
                      myLaunchesEnabled ? 'bg-primary text-black' : 'text-text2 hover:bg-[rgba(255,255,255,0.06)] hover:text-text1',
                      (watchlistsLoading || Boolean(watchlistsError) || !myWatchlistId) && 'cursor-not-allowed opacity-60'
                    )}
                    onClick={() => toggleMyLaunches(true)}
                    disabled={watchlistsLoading || Boolean(watchlistsError) || !myWatchlistId}
                    aria-pressed={myLaunchesEnabled}
                  >
                    Following
                  </button>
                ) : (
                  <PremiumGateButton
                    isAuthed={isAuthed}
                    featureLabel="Following feed"
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-text2 transition hover:bg-[rgba(255,255,255,0.06)] hover:text-text1"
                    ariaLabel="Following feed (Premium)"
                  >
                    Following
                  </PremiumGateButton>
                )}
              </div>
              {myLaunchesEnabled ? (
                <button
                  type="button"
                  className="hidden rounded-lg border border-stroke bg-surface-0 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-text2 transition hover:border-primary hover:text-text1 md:inline-flex"
                  onClick={() => setFiltersOpen((open) => !open)}
                  aria-expanded={filtersOpen}
                  aria-controls={filtersPanelId}
                >
                  {filtersOpen ? 'Hide filters' : 'Show filters'}
                </button>
              ) : null}
              {hasActiveFilters && myLaunchesEnabled ? (
                <span className="rounded-full border border-stroke bg-surface-0 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
                  {activeFilterCount}
                </span>
              ) : null}
            </div>
              <div className="text-xs text-text3">
                {canUseSavedItems
                  ? myLaunchesEnabled
                    ? hasAnyFollowRules
                      ? 'Showing launches from what you follow.'
                      : 'Following is empty. Follow a launch, provider, or pad.'
                    : 'For You shows all launches matching your filters.'
                  : 'For You shows launches matching your filters. Following and saved items stay on Premium.'}
              </div>
          </div>
          {filtersOpen ? (
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-[0.12em] text-text3">Filters</span>
              {hasActiveFilters ? (
                <button type="button" className="text-xs text-text3 hover:text-text1" onClick={clearFiltersToDefault}>
                  Reset
                </button>
              ) : null}
            </div>
          ) : null}
          <div id={filtersPanelId} className={clsx('mt-3 space-y-3', !filtersOpen && 'hidden')}>
            <div className="grid gap-3 xl:grid-cols-3">
              <section className={FILTER_SECTION_CLASS}>
                <div className={FILTER_GROUP_LABEL_CLASS}>Time</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                  <select
                    aria-label="Date range"
                    className={FILTER_SELECT_CLASS}
                    value={filters.range ?? 'year'}
                    onChange={(e) => setFilters((f) => ({ ...f, range: e.target.value as LaunchFilter['range'] }))}
                  >
                    <option value="today">Today</option>
                    <option value="7d">Next 7 days</option>
                    <option value="month">Next 30 days</option>
                    <option value="year">Next 12 months</option>
                    <option value="past">Past launches</option>
                    <option value="all">All time</option>
                  </select>
                  <select
                    aria-label="Status"
                    className={FILTER_SELECT_CLASS}
                    value={filters.status ?? 'all'}
                    onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as Launch['status'] | 'all' }))}
                    disabled={filtersLoading || Boolean(filtersError)}
                  >
                    <option value="all">
                      {filtersLoading ? 'Loading statuses...' : filtersError ? 'Status unavailable' : 'All Status'}
                    </option>
                    {filterOptions.statuses.map((status) => (
                      <option key={status} value={status}>
                        {formatStatusLabel(status)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Sort"
                    className={FILTER_SELECT_CLASS}
                    value={filters.sort ?? 'soonest'}
                    onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as LaunchFilter['sort'] }))}
                  >
                    <option value="soonest">Soonest</option>
                    <option value="latest">Newest first</option>
                    <option value="changed">Recently updated</option>
                  </select>
                </div>
              </section>

              <section className={FILTER_SECTION_CLASS}>
                <div className={FILTER_GROUP_LABEL_CLASS}>Location</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                  <select
                    aria-label="Location scope"
                    className={FILTER_SELECT_CLASS}
                    value={filters.region ?? 'us'}
                    onChange={(e) => setFilters((f) => ({ ...f, region: e.target.value as LaunchFilter['region'] }))}
                  >
                    <option value="us">US only</option>
                    <option value="non-us">Non-US only</option>
                    <option value="all">All locations</option>
                  </select>
                  <select
                    aria-label="Launch site"
                    className={FILTER_SELECT_CLASS}
                    value={filters.location ?? ''}
                    onChange={(e) => setFilters((f) => ({ ...f, location: e.target.value || undefined }))}
                    disabled={filtersLoading || Boolean(filtersError)}
                  >
                    <option value="">
                      {filtersLoading ? 'Loading launch sites...' : filtersError ? 'Sites unavailable' : 'All Launch Sites'}
                    </option>
                    {filterOptions.locations.map((location) => (
                      <option key={location} value={location}>
                        {formatLocationOptionLabel(location)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="State"
                    className={FILTER_SELECT_CLASS}
                    value={filters.state ?? ''}
                    onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value || undefined }))}
                    disabled={filtersLoading || Boolean(filtersError)}
                  >
                    <option value="">
                      {filtersLoading ? 'Loading states...' : filtersError ? 'States unavailable' : 'All States'}
                    </option>
                    {filterOptions.states.map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </select>
                </div>
              </section>

              <section className={FILTER_SECTION_CLASS}>
                <div className={FILTER_GROUP_LABEL_CLASS}>Mission</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                  <select
                    aria-label="Provider"
                    className={FILTER_SELECT_CLASS}
                    value={filters.provider ?? ''}
                    onChange={(e) => setFilters((f) => ({ ...f, provider: e.target.value || undefined }))}
                    disabled={filtersLoading || Boolean(filtersError)}
                  >
                    <option value="">
                      {filtersLoading ? 'Loading providers...' : filtersError ? 'Providers unavailable' : 'All Providers'}
                    </option>
                    {filterOptions.providers.map((provider) => (
                      <option key={provider} value={provider}>
                        {provider}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Pad"
                    className={FILTER_SELECT_CLASS}
                    value={filters.pad ?? ''}
                    onChange={(e) => setFilters((f) => ({ ...f, pad: e.target.value || undefined }))}
                    disabled={filtersLoading || Boolean(filtersError)}
                  >
                    <option value="">
                      {filtersLoading ? 'Loading pads...' : filtersError ? 'Pads unavailable' : 'All Pads'}
                    </option>
                    {filterOptions.pads.map((pad) => (
                      <option key={pad} value={pad}>
                        {pad}
                      </option>
                    ))}
                  </select>
                </div>
              </section>
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
              {canManageFilterPresets ? (
                <section className={FILTER_SECTION_CLASS}>
                  <div className={FILTER_GROUP_LABEL_CLASS}>Custom Filters</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <select
                      aria-label="Presets"
                      className={FILTER_SELECT_CLASS}
                      value={activePresetId}
                      onChange={(e) => applyPreset(e.target.value)}
                      disabled={presetsLoading || Boolean(presetsError)}
                    >
                      <option value="">Custom filters</option>
                      {presetList.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}{preset.is_default ? ' (Default)' : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={clsx(
                        'btn-secondary h-10 w-full shrink-0 rounded-lg border border-stroke px-3 py-2 text-sm text-text2 hover:border-primary sm:w-auto',
                        presetSaving && 'opacity-70'
                      )}
                      onClick={savePreset}
                      disabled={presetSaving}
                    >
                      Save preset
                    </button>
                    <button
                      type="button"
                      className={clsx(
                        'btn-secondary h-10 w-full shrink-0 rounded-lg border border-stroke px-3 py-2 text-sm text-text2 hover:border-primary sm:w-auto',
                        (presetDefaulting || !activePresetId || activePresetIsDefault) && 'opacity-70'
                      )}
                      onClick={setActivePresetAsDefault}
                      disabled={presetDefaulting || !activePresetId || activePresetIsDefault}
                      title={
                        !activePresetId
                          ? 'Select a saved preset first.'
                          : activePresetIsDefault
                            ? 'Already the default view.'
                            : 'Set selected preset as your default view.'
                      }
                    >
                      {presetDefaulting ? 'Setting...' : activePresetIsDefault ? 'Default view' : 'Set default'}
                    </button>
                  </div>
                </section>
              ) : (
                <section className={FILTER_SECTION_CLASS}>
                  <div className={FILTER_GROUP_LABEL_CLASS}>Custom Filters</div>
                  <div className="mt-2">
                    <PremiumGateButton
                      isAuthed={isAuthed}
                      featureLabel="saved views"
                      className="btn-secondary h-10 w-full rounded-lg border border-stroke px-3 py-2 text-sm text-text2 hover:border-primary"
                      ariaLabel="Save view (Premium)"
                    >
                      Save view
                    </PremiumGateButton>
                  </div>
                </section>
              )}

              <section className={clsx(FILTER_SECTION_CLASS, 'xl:w-auto')}>
                <div className={FILTER_GROUP_LABEL_CLASS}>Integrations</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <BulkCalendarExport filters={filters} isAuthed={isAuthed} isPremium={viewerTier === 'premium'} />
                  <RssFeeds filters={filters} isAuthed={isAuthed} isPremium={viewerTier === 'premium'} />
                  <EmbedNextLaunchCard
                    isAuthed={isAuthed}
                    isPremium={viewerTier === 'premium'}
                    filters={filters}
                    activePresetId={activePresetId || null}
                    activePresetName={
                      activePresetId ? presetList.find((preset) => preset.id === activePresetId)?.name ?? null : null
                    }
                    myLaunchesEnabled={myLaunchesEnabled}
                    myWatchlistId={myWatchlistId}
                  />
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {viewerTier === 'premium' && recentChanges.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.08em] text-text3">Recently changed (24h)</div>
              <div className="text-base font-semibold text-text1">Scrubs, time shifts, status updates</div>
              {premiumFreshnessLine && <div className="mt-1 text-xs text-text3">{premiumFreshnessLine}</div>}
            </div>
            <div className="flex items-center gap-3 text-xs text-text3">
              {recentExpanded ? (
                <button type="button" className="hover:text-text1" onClick={() => setRecentExpanded(false)}>
                  Collapse
                </button>
              ) : (
                <button type="button" className="hover:text-text1" onClick={() => setRecentExpanded(true)}>
                  Expand
                </button>
              )}
            </div>
          </div>
          {recentExpanded ? (
            <ul className="space-y-2">
              {recentChanges.map((item) => {
                const isExpanded = !!expandedUpdates[item.launchId];
                const hasMultiple = item.entries.length > 1;
                return (
                  <li
                    key={item.launchId}
                    className="overflow-hidden rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)]"
                  >
                    <Link
                      href={buildLaunchHref({ id: item.launchId, name: item.name })}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 hover:bg-[rgba(255,255,255,0.04)]"
                    >
                      <div className="min-w-0">
                        <div className="text-text1">{item.name}</div>
                        <div className="text-xs text-text3">
                          {item.summary || item.lastUpdatedLabel || formatUpdateTime(item.lastUpdated) || 'Updated'}
                        </div>
                      </div>
                      <time dateTime={toIsoDateTime(item.lastUpdated)} className="shrink-0 text-xs text-text3">
                        {item.lastUpdatedLabel || formatUpdateTime(item.lastUpdated)}
                      </time>
                    </Link>
                    {hasMultiple ? (
                      <button
                        type="button"
                        className="w-full border-t border-stroke px-3 py-1.5 text-left text-xs text-text3 hover:bg-[rgba(255,255,255,0.04)] hover:text-text1"
                        aria-expanded={isExpanded}
                        aria-controls={`change-log-${item.launchId}`}
                        onClick={() => setExpandedUpdates((prev) => ({ ...prev, [item.launchId]: !prev[item.launchId] }))}
                      >
                        {isExpanded ? 'Hide updates' : `Show ${item.entries.length} updates`}
                      </button>
                    ) : null}
                    {hasMultiple && isExpanded && (
                      <ul id={`change-log-${item.launchId}`} className="space-y-1 border-t border-stroke px-3 py-2 text-xs">
                        {item.entries.map((entry) => (
                          <li key={entry.updateId}>
                          <Link
                            href={buildLaunchHref({ id: item.launchId, name: item.name })}
                            className="flex w-full items-center justify-between rounded-md border border-stroke bg-[rgba(255,255,255,0.03)] px-2 py-1 text-text2 hover:border-primary"
                          >
                            <span>{entry.changeSummary || 'Updated'}</span>
                            <time dateTime={toIsoDateTime(entry.detectedAt)} className="ml-2 shrink-0 text-text3">
                              {entry.detectedLabel || formatUpdateTime(entry.detectedAt)}
                            </time>
                          </Link>
                            {entry.details && entry.details.length > 0 && (
                              <div className="mt-1 rounded-md border border-stroke bg-[rgba(255,255,255,0.02)] px-2 py-1 text-[11px] text-text3">
                                {entry.details.map((detail, index) => (
                                  <div key={`${entry.updateId}-${index}`}>{detail}</div>
                                ))}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : activeRecentChange ? (
            <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2">
              <Link
                href={buildLaunchHref({ id: activeRecentChange.launchId, name: activeRecentChange.name })}
                className="block w-full"
                aria-live="polite"
              >
                <div
                  key={`${activeRecentChange.launchId}-${recentFlipIndex}`}
                  className="recent-change-flip flex w-full min-w-0 items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-text1">{activeRecentChange.name}</div>
                    <div className="truncate text-xs text-text3">
                      {activeRecentChange.summary || activeRecentChange.lastUpdatedLabel || formatUpdateTime(activeRecentChange.lastUpdated) || 'Updated'}
                    </div>
                  </div>
                  <time dateTime={toIsoDateTime(activeRecentChange.lastUpdated)} className="shrink-0 whitespace-nowrap text-xs text-text3">
                    {activeRecentChange.lastUpdatedLabel || formatUpdateTime(activeRecentChange.lastUpdated)}
                  </time>
                </div>
              </Link>
            </div>
          ) : null}
        </div>
      )}

      {loading && launches.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonLaunchCard key={i} />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredLaunches.length === 0 ? (
            <div className="rounded-2xl border border-stroke bg-[rgba(234,240,255,0.04)] p-4 text-sm text-text3">
              {myLaunchesEnabled
                ? hasAnyFollowRules
                  ? 'No matches in Following for this filter set.'
                  : 'Following is empty. Follow a launch, provider, or pad to build your feed.'
                : 'No matches in For You for this filter set.'}
            </div>
          ) : (
            <>
              {filteredLaunches.map((launch) => (
                <div key={launch.id} className="space-y-3">
                  {renderLaunchCard(launch, { isNext: launch.id === nextLaunchId })}
                </div>
              ))}
            </>
          )}
          {loadingMore && (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <SkeletonLaunchCard key={`more-${i}`} />
              ))}
            </div>
          )}
          {hasMore && !loading && !loadingMore && (
            <Link
              href={nextPageHref}
              className="btn w-full rounded-2xl px-4 py-3 text-sm"
              onClick={(event) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.altKey ||
                  event.ctrlKey ||
                  event.shiftKey
                ) {
                  return;
                }
                event.preventDefault();
                void fetchPage({ offset: nextOffset, replace: false, reason: 'load_more_click' });
              }}
            >
              Load More Launches
            </Link>
          )}
          <div ref={loadMoreRef} className="h-6" />
        </div>
      )}

      <PremiumUpsellModal open={upsellOpen} onClose={closeUpsell} isAuthed={isAuthed} featureLabel={upsellFeatureLabel} />

    </section>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 16 20 20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function FilterIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M4 7h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7 12h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10 17h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function extractLaunchRuleMap(rules: unknown) {
  const rows = Array.isArray(rules) ? rules : [];
  const map: Record<string, string> = {};

  for (const row of rows) {
    const type = String((row as any)?.rule_type || (row as any)?.ruleType || '').trim().toLowerCase();
    if (type !== 'launch') continue;
    const launchId = String((row as any)?.rule_value || (row as any)?.ruleValue || '').trim().toLowerCase();
    const ruleId = String((row as any)?.id || '').trim();
    if (!isUuid(launchId) || !ruleId) continue;
    map[launchId] = ruleId;
  }

  return map;
}

function extractProviderRuleMap(rules: unknown) {
  const rows = Array.isArray(rules) ? rules : [];
  const map: Record<string, string> = {};

  for (const row of rows) {
    const type = String((row as any)?.rule_type || (row as any)?.ruleType || '').trim().toLowerCase();
    if (type !== 'provider') continue;
    const provider = String((row as any)?.rule_value || (row as any)?.ruleValue || '').trim();
    const ruleId = String((row as any)?.id || '').trim();
    if (!provider || !ruleId) continue;
    map[provider] = ruleId;
  }

  return map;
}

function extractPadRuleMap(rules: unknown) {
  const rows = Array.isArray(rules) ? rules : [];
  const map: Record<string, string> = {};

  for (const row of rows) {
    const type = String((row as any)?.rule_type || (row as any)?.ruleType || '').trim().toLowerCase();
    if (type !== 'pad') continue;
    const value = String((row as any)?.rule_value || (row as any)?.ruleValue || '').trim();
    const ruleId = String((row as any)?.id || '').trim();
    if (!value || !ruleId) continue;
    map[value] = ruleId;
  }

  return map;
}

function extractRuleMap(rules: unknown, ruleType: string) {
  const rows = Array.isArray(rules) ? rules : [];
  const map: Record<string, string> = {};

  for (const row of rows) {
    const type = String((row as any)?.rule_type || (row as any)?.ruleType || '').trim().toLowerCase();
    if (type !== ruleType) continue;
    const value = String((row as any)?.rule_value || (row as any)?.ruleValue || '').trim().toLowerCase();
    const ruleId = String((row as any)?.id || '').trim();
    if (!value || !ruleId) continue;
    map[value] = ruleId;
  }

  return map;
}

function buildPadRuleValue(launch: Launch) {
  const ll2 = launch.ll2PadId;
  if (typeof ll2 === 'number' && Number.isFinite(ll2) && ll2 > 0) {
    return `ll2:${String(Math.trunc(ll2))}`;
  }
  const code = String(launch.pad?.shortCode || '').trim();
  if (!code || code === 'Pad') return null;
  return `code:${code}`;
}

function buildRocketRuleValue(launch: Launch) {
  if (typeof launch.ll2RocketConfigId === 'number' && Number.isFinite(launch.ll2RocketConfigId) && launch.ll2RocketConfigId > 0) {
    return `ll2:${String(Math.trunc(launch.ll2RocketConfigId))}`;
  }
  const label = String(launch.rocket?.fullName || launch.vehicle || '').trim();
  return label ? label.toLowerCase() : null;
}

function formatRocketRuleLabel(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return 'Rocket';
  return raw.toLowerCase().startsWith('ll2:') ? `Rocket ${raw.slice(4)}` : raw;
}

function buildLaunchSiteRuleValue(launch: Launch) {
  const value = String(launch.pad?.locationName || launch.pad?.name || '').trim();
  return value ? value.toLowerCase() : null;
}

function buildStateRuleValue(launch: Launch) {
  const value = String(launch.pad?.state || '').trim().toLowerCase();
  if (!value || value === 'na' || value === 'n/a' || value === 'unknown') return null;
  return value;
}

function formatPadRuleLabel(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return 'Pad';
  const lower = raw.toLowerCase();
  if (lower.startsWith('code:')) {
    const code = raw.slice(5).trim();
    return code ? `Pad ${code}` : 'Pad';
  }
  return 'Pad';
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function buildWatchlistRuleErrorMessage(error: unknown, label: string) {
  if (error instanceof ApiClientError) {
    if (error.code === 'limit_reached') {
      return 'My Launches limit reached. Remove an older follow rule first.';
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

function normalizeLaunchFilter(value: unknown): LaunchFilter {
  const source = typeof value === 'object' && value ? (value as Record<string, unknown>) : {};
  const next: LaunchFilter = {};

  const range = readAllowedValue(source.range, ['today', '7d', 'month', 'year', 'past', 'all'] as const);
  const region = readAllowedValue(source.region, ['us', 'non-us', 'all'] as const);
  const sort = readAllowedValue(source.sort, ['soonest', 'latest', 'changed'] as const);
  const status = readAllowedValue(source.status, ['go', 'hold', 'scrubbed', 'tbd', 'unknown', 'all'] as const);
  const location = typeof source.location === 'string' ? source.location.trim() : '';
  const state = typeof source.state === 'string' ? source.state.trim() : '';
  const pad = typeof source.pad === 'string' ? source.pad.trim() : '';
  const provider = typeof source.provider === 'string' ? source.provider.trim() : '';

  if (range) next.range = range;
  if (region) next.region = region;
  if (sort) next.sort = sort;
  if (status) next.status = status;
  if (location) next.location = location;
  if (state) next.state = state;
  if (pad) next.pad = pad;
  if (provider) next.provider = provider;
  return next;
}

function readAllowedValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== 'string') return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function areLaunchFiltersEqual(a: LaunchFilter, b: LaunchFilter) {
  return (
    (a.range ?? undefined) === (b.range ?? undefined) &&
    (a.region ?? undefined) === (b.region ?? undefined) &&
    (a.sort ?? undefined) === (b.sort ?? undefined) &&
    (a.status ?? undefined) === (b.status ?? undefined) &&
    (a.location ?? undefined) === (b.location ?? undefined) &&
    (a.state ?? undefined) === (b.state ?? undefined) &&
    (a.pad ?? undefined) === (b.pad ?? undefined) &&
    (a.provider ?? undefined) === (b.provider ?? undefined)
  );
}

function formatLocationOptionLabel(value: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return value;
  const idx = trimmed.indexOf(',');
  if (idx <= 0) return trimmed;
  return trimmed.slice(0, idx).trim();
}

function formatUpdateTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function toIsoDateTime(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function formatRefreshTime(value: number, includeSeconds: boolean) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined
  }).format(date);
}

function parseLaunchNetMs(launch: Launch | null) {
  if (!launch) return Number.NaN;
  const netMs = Date.parse(launch.net);
  return Number.isFinite(netMs) ? netMs : Number.NaN;
}

function findNextProgramLaunch(launches: Launch[], nowMs: number, predicate: (launch: Launch) => boolean) {
  return findActiveNextLaunch(launches, nowMs, NEXT_LAUNCH_RETENTION_MS, predicate);
}

function findNextLaunchId(launches: Launch[], nowMs: number) {
  return findActiveNextLaunch(launches, nowMs, NEXT_LAUNCH_RETENTION_MS)?.id ?? null;
}

function findActiveNextLaunch(
  launches: Launch[],
  nowMs: number,
  lookbackMs: number,
  predicate: (launch: Launch) => boolean = () => true
) {
  let recent: Launch | null = null;
  let recentMs = Number.NEGATIVE_INFINITY;
  let upcoming: Launch | null = null;
  let upcomingMs = Number.POSITIVE_INFINITY;

  for (const launch of launches) {
    if (!predicate(launch)) continue;
    const netMs = parseLaunchNetMs(launch);
    if (!Number.isFinite(netMs)) continue;

    if (netMs <= nowMs && netMs >= nowMs - lookbackMs) {
      if (netMs > recentMs) {
        recent = launch;
        recentMs = netMs;
      }
      continue;
    }

    if (netMs > nowMs && netMs < upcomingMs) {
      upcoming = launch;
      upcomingMs = netMs;
    }
  }

  return recent || upcoming;
}

function formatProgramTickerTime(launch: Launch, tz: string) {
  const isDateOnly = isDateOnlyNet(launch.net, launch.netPrecision, tz);
  if (isDateOnly) {
    return `NET ${formatDateOnly(launch.net, tz)}`;
  }
  return `${formatDateOnly(launch.net, tz)}, ${formatNetLabel(launch.net, tz)}`;
}

function formatStatusLabel(value: string) {
  if (value === 'tbd') return 'TBD';
  if (value === 'go') return 'Go';
  if (value === 'hold') return 'Hold';
  if (value === 'scrubbed') return 'Scrubbed';
  if (value === 'unknown') return 'Unknown';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4.5" y="9" width="11" height="8" rx="2" />
      <path d="M7 9V7a3 3 0 0 1 6 0v2" />
    </svg>
  );
}
