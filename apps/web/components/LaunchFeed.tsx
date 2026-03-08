'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Launch, LaunchFilter, LaunchFilterOptions } from '@/lib/types/launch';
import { LAUNCH_FEED_PAGE_SIZE } from '@/lib/constants/launchFeed';
import { NEXT_LAUNCH_RETENTION_MS } from '@/lib/constants/launchTimeline';
import { getBrowserClient } from '@/lib/api/supabase';
import { useDismissed } from '@/lib/hooks/useDismissed';
import { PRIVACY_COOKIES } from '@/lib/privacy/choices';
import { getNextAlignedRefreshMs, getTierRefreshSeconds, tierToMode, type ViewerTier } from '@/lib/tiers';
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
  if (value === 'anon' || value === 'free' || value === 'premium') return value;
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
  const [filterOptions, setFilterOptions] = useState<LaunchFilterOptions>({
    providers: [],
    locations: [],
    states: [],
    pads: [],
    statuses: []
  });
  const [filtersLoading, setFiltersLoading] = useState(true);
  const [filtersError, setFiltersError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [authStatus, setAuthStatus] = useState<'loading' | 'authed' | 'guest'>(() => initialAuthStatus ?? 'loading');
  const [viewerTier, setViewerTier] = useState<ViewerTier>(() => initialViewerTier ?? 'anon');
  const [arEligibleLaunchIds, setArEligibleLaunchIds] = useState<string[]>(() => initialArEligibleLaunchIds);
  const [isPaid, setIsPaid] = useState(() => {
    if (typeof initialIsPaid === 'boolean') return initialIsPaid;
    return initialViewerTier === 'premium';
  });
  const [presetList, setPresetList] = useState<Array<{ id: string; name: string; filters: LaunchFilter; is_default?: boolean }>>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [presetSaving, setPresetSaving] = useState(false);
  const [presetDefaulting, setPresetDefaulting] = useState(false);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [activePresetId, setActivePresetId] = useState<string>('');
  const [myLaunchesEnabled, setMyLaunchesEnabled] = useState(false);
  const [watchlistsLoading, setWatchlistsLoading] = useState(false);
  const [watchlistsError, setWatchlistsError] = useState<string | null>(null);
  const [myWatchlistId, setMyWatchlistId] = useState<string | null>(null);
  const [myLaunchRulesByLaunchId, setMyLaunchRulesByLaunchId] = useState<Record<string, string>>({});
  const [watchToggleBusy, setWatchToggleBusy] = useState<Record<string, boolean>>({});
  const [myProviderRulesByProvider, setMyProviderRulesByProvider] = useState<Record<string, string>>({});
  const [myPadRulesByValue, setMyPadRulesByValue] = useState<Record<string, string>>({});
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
  const [lastCheckedAtMs, setLastCheckedAtMs] = useState<number | null>(() => initialNowMsValue ?? null);
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => initialNowMsValue ?? Date.now());
  const [userTz, setUserTz] = useState('UTC');
  const [upsellOpen, setUpsellOpen] = useState(false);
  const [upsellFeatureLabel, setUpsellFeatureLabel] = useState<string | undefined>(undefined);
  const [blockThirdPartyEmbeds, setBlockThirdPartyEmbeds] = useState(() => Boolean(initialBlockThirdPartyEmbeds));
  const [infiniteScrollArmed, setInfiniteScrollArmed] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fetchSeqRef = useRef(0);
  const lastSeenLiveVersionRef = useRef<string | null>(null);
  const initialLaunchesRef = useRef(initialLaunches);
  const initialOffsetRef = useRef(initialOffset);
  const didInitialFetchRef = useRef(false);
  const didApplyInitialDefaultPresetRef = useRef(false);
  const lastRouterReplaceRef = useRef<{ url: string; at: number } | null>(null);

  const { dismissed: unlocksDismissed, dismiss: dismissUnlocks } = useDismissed(HOME_UPSELL_KEYS.onboardingDismissedAt, 14 * DAY_MS);

  const query = useMemo(() => (searchParams.get('q') || '').trim(), [searchParams]);
  const currentPage = useMemo(() => getPageFromSearchParams(searchParams), [searchParams]);
  const pageOffset = useMemo(() => (currentPage - 1) * PAGE_SIZE, [currentPage]);
  const isAuthed = authStatus === 'authed';
  const arEligibleLaunchIdSet = useMemo(() => new Set(arEligibleLaunchIds), [arEligibleLaunchIds]);
  const mode = useMemo(() => tierToMode(viewerTier), [viewerTier]);
  const refreshIntervalSeconds = getTierRefreshSeconds(viewerTier);
  const refreshIntervalMs = refreshIntervalSeconds * 1000;
  const recentChanges = useMemo(() => changed.slice(0, 6), [changed]);
  const activePreset = useMemo(
    () => presetList.find((preset) => preset.id === activePresetId) ?? null,
    [activePresetId, presetList]
  );
  const activePresetIsDefault = activePreset?.is_default === true;
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
  }, [viewerTier]);

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
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch('/api/public/launches/ar-eligible', { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) return;
        const launches = Array.isArray(json?.launches) ? json.launches : [];
        const ids = launches
          .map((entry: any) => (entry?.launchId ? String(entry.launchId) : null))
          .filter((id: any): id is string => typeof id === 'string' && id.trim().length > 0);
        setArEligibleLaunchIds(ids);
      } catch (err) {
        // ignore
      }
    };

    void load();
    const id = window.setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
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

  useEffect(() => {
    const supabase = getBrowserClient();
    if (!supabase) {
      setAuthStatus('guest');
      return;
    }

    let active = true;
    const updateStatus = async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      setAuthStatus(data.user ? 'authed' : 'guest');
    };
    updateStatus();

    const { data: subscriptionData } = supabase.auth.onAuthStateChange(() => {
      updateStatus();
    });

    return () => {
      active = false;
      subscriptionData.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (authStatus === 'guest') {
      setIsPaid(false);
      setViewerTier('anon');
      return;
    }
    setViewerTier((prev) => (prev === 'anon' ? 'free' : prev));
  }, [authStatus]);

  useEffect(() => {
    let cancelled = false;
    if (authStatus !== 'authed') {
      return () => {
        cancelled = true;
      };
    }

    const syncSubscriptionTier = async () => {
      try {
        const res = await fetch('/api/me/subscription', { cache: 'no-store' });
        const json = (await res.json().catch(() => ({}))) as {
          isAuthed?: unknown;
          isPaid?: unknown;
          tier?: unknown;
        };
        if (cancelled) return;

        if (res.status === 401 || json.isAuthed === false) {
          setAuthStatus('guest');
          setIsPaid(false);
          setViewerTier('anon');
          return;
        }

        if (!res.ok) return;

        const nextTier = normalizeViewerTier(json.tier);
        const nextIsPaid = Boolean(json.isPaid);
        setIsPaid(nextIsPaid);
        setViewerTier(nextTier ?? (nextIsPaid ? 'premium' : 'free'));
      } catch (err) {
        if (cancelled) return;
        console.error('subscription fetch error', err);
      }
    };

    void syncSubscriptionTier();
    return () => {
      cancelled = true;
    };
  }, [authStatus]);

  const resetPageToFirst = useCallback(() => {
    const qs = new URLSearchParams(searchParams.toString());
    qs.delete('page');
    const queryString = qs.toString();
    safeRouterReplace(queryString ? `/?${queryString}` : '/');
  }, [safeRouterReplace, searchParams]);

  useEffect(() => {
    let cancelled = false;
    if (!isAuthed || viewerTier === 'anon') {
      setPresetList([]);
      setActivePresetId('');
      setPresetsLoading(false);
      setPresetDefaulting(false);
      setPresetsError(null);
      didApplyInitialDefaultPresetRef.current = false;
      return () => {
        cancelled = true;
      };
    }

    setPresetsLoading(true);
    setPresetsError(null);
    fetch('/api/me/filter-presets', { cache: 'no-store' })
      .then(async (res) => ({ ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) }))
      .then(({ ok, status, body }) => {
        if (cancelled) return;
        if (!ok) {
          if (status === 402) {
            setPresetList([]);
            setActivePresetId('');
            didApplyInitialDefaultPresetRef.current = false;
            return;
          }
          setPresetsError(body?.error || 'failed_to_load');
          return;
        }
        const presets = (Array.isArray(body?.presets) ? body.presets : [])
          .map((preset: any) => {
            const id = String(preset?.id || '').trim();
            const name = String(preset?.name || '').trim() || 'Saved view';
            if (!id) return null;
            return {
              id,
              name,
              filters: normalizeLaunchFilter(preset?.filters),
              is_default: preset?.is_default === true
            };
          })
          .filter((preset: any): preset is { id: string; name: string; filters: LaunchFilter; is_default?: boolean } => Boolean(preset));
        setPresetList(presets);
        const defaultPreset = presets.find((preset: any) => preset?.is_default === true) ?? null;
        if (defaultPreset?.id) setActivePresetId(String(defaultPreset.id));
        if (!didApplyInitialDefaultPresetRef.current) {
          if (defaultPreset?.filters) {
            setFilters((prev) => (areLaunchFiltersEqual(prev, defaultPreset.filters) ? prev : defaultPreset.filters));
          }
          didApplyInitialDefaultPresetRef.current = true;
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('filter presets fetch error', err);
        setPresetsError('failed_to_load');
      })
      .finally(() => {
        if (cancelled) return;
        setPresetsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthed, viewerTier]);

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
    let cancelled = false;
    if (!isAuthed || viewerTier === 'anon') {
      setWatchlistsLoading(false);
      setWatchlistsError(null);
      setMyLaunchesEnabled(false);
      setMyWatchlistId(null);
      setMyLaunchRulesByLaunchId({});
      setMyProviderRulesByProvider({});
      setMyPadRulesByValue({});
      setFollowToggleBusy({});
      return () => {
        cancelled = true;
      };
    }

    const load = async () => {
      setWatchlistsLoading(true);
      setWatchlistsError(null);

      const res = await fetch('/api/me/watchlists', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));

      if (cancelled) return;

      if (!res.ok) {
        setWatchlistsError(json?.error || 'failed_to_load');
        setMyWatchlistId(null);
        setMyLaunchRulesByLaunchId({});
        setMyProviderRulesByProvider({});
        setMyPadRulesByValue({});
        setWatchlistsLoading(false);
        return;
      }

      const watchlists = Array.isArray(json?.watchlists) ? json.watchlists : [];
      const selected =
        watchlists.find((w: any) => String(w?.name || '').trim().toLowerCase() === 'my launches') ?? watchlists[0] ?? null;

      if (!selected) {
        const createRes = await fetch('/api/me/watchlists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          cache: 'no-store'
        });

        const createJson = await createRes.json().catch(() => ({}));
        if (cancelled) return;

        if (!createRes.ok) {
          setWatchlistsError(createJson?.error || 'failed_to_create');
          setMyWatchlistId(null);
          setMyLaunchRulesByLaunchId({});
          setMyProviderRulesByProvider({});
          setMyPadRulesByValue({});
          setWatchlistsLoading(false);
          return;
        }

        const created = createJson?.watchlist ?? null;
        const createdId = created?.id ? String(created.id) : null;
        setMyWatchlistId(createdId);
        setMyLaunchRulesByLaunchId({});
        setMyProviderRulesByProvider({});
        setMyPadRulesByValue({});
        setWatchlistsLoading(false);
        return;
      }

      const selectedId = selected?.id ? String(selected.id) : null;
      setMyWatchlistId(selectedId);
      setMyLaunchRulesByLaunchId(extractLaunchRuleMap(selected?.watchlist_rules));
      setMyProviderRulesByProvider(extractProviderRuleMap(selected?.watchlist_rules));
      setMyPadRulesByValue(extractPadRuleMap(selected?.watchlist_rules));
      setWatchlistsLoading(false);
    };

    load().catch((err) => {
      if (cancelled) return;
      console.error('watchlists fetch error', err);
      setWatchlistsError('failed_to_load');
      setMyWatchlistId(null);
      setMyLaunchRulesByLaunchId({});
      setMyProviderRulesByProvider({});
      setMyPadRulesByValue({});
      setWatchlistsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isAuthed, viewerTier]);

  useEffect(() => {
    let cancelled = false;
    if (!isAuthed) {
      setFiltersLoading(false);
      setFiltersError(null);
      setFilterOptions({ providers: [], locations: [], states: [], pads: [], statuses: [] });
      return () => {
        cancelled = true;
      };
    }

    setFiltersLoading(true);
    setFiltersError(null);
    const qs = new URLSearchParams();
    qs.set('mode', mode);
    qs.set('region', filters.region ?? 'us');
    qs.set('range', filters.range ?? 'year');
    if (filters.location) qs.set('location', filters.location);
    if (filters.state) qs.set('state', filters.state);
    if (filters.pad) qs.set('pad', filters.pad);
    if (filters.provider) qs.set('provider', filters.provider);
    if (filters.status && filters.status !== 'all') qs.set('status', filters.status);
    fetch(`/api/filters?${qs.toString()}`, { cache: 'no-store' })
      .then(async (res) => ({ ok: res.ok, body: await res.json().catch(() => ({})) }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) {
          setFiltersError(body?.error || 'filters_failed');
          return;
        }
        const providers = Array.isArray(body?.providers) ? body.providers : [];
        const locations = Array.isArray(body?.locations) ? body.locations : [];
        const states = Array.isArray(body?.states) ? body.states : [];
        const pads = Array.isArray(body?.pads) ? body.pads : [];
        const statuses = Array.isArray(body?.statuses) ? body.statuses : [];
        setFilterOptions({
          providers,
          locations,
          states,
          pads,
          statuses
        });
        setFilters((prev) => {
          let changed = false;
          const next: LaunchFilter = { ...prev };

          if (prev.location && !locations.includes(prev.location)) {
            next.location = undefined;
            changed = true;
          }
          if (prev.state && !states.includes(prev.state)) {
            next.state = undefined;
            changed = true;
          }
          if (prev.pad && !pads.includes(prev.pad)) {
            next.pad = undefined;
            changed = true;
          }
          if (prev.provider && !providers.includes(prev.provider)) {
            next.provider = undefined;
            changed = true;
          }
          if (prev.status && prev.status !== 'all' && !statuses.includes(prev.status)) {
            next.status = 'all';
            changed = true;
          }

          return changed ? next : prev;
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('filters fetch error', err);
        setFiltersError('filters_failed');
      })
      .finally(() => {
        if (cancelled) return;
        setFiltersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters.location, filters.pad, filters.provider, filters.range, filters.region, filters.state, filters.status, isAuthed, mode]);

  const fetchPage = useCallback(
    async ({ offset, replace, reason }: { offset: number; replace: boolean; reason: string }) => {
      fetchSeqRef.current += 1;
      const seq = fetchSeqRef.current;
      const snapshot = latestRef.current;
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

      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (replace) {
        setLoading(true);
        setLoadingMore(false);
      } else {
        setLoadingMore(true);
      }

      try {
        const filtersNow = snapshot.filters;
        const modeNow = snapshot.mode;
        const qs = new URLSearchParams();
        qs.set('range', filtersNow.range || '7d');
        qs.set('sort', filtersNow.sort || 'soonest');
        qs.set('region', filtersNow.region ?? 'us');
        qs.set('limit', String(PAGE_SIZE));
        qs.set('offset', String(offset));
        if (filtersNow.location) qs.set('location', filtersNow.location);
        if (filtersNow.state) qs.set('state', filtersNow.state);
        if (filtersNow.pad) qs.set('pad', filtersNow.pad);
        if (filtersNow.provider) qs.set('provider', filtersNow.provider);
        if (filtersNow.status && filtersNow.status !== 'all') qs.set('status', filtersNow.status);

        const watchlistId = snapshot.myLaunchesEnabled && snapshot.viewerTier !== 'anon' ? snapshot.myWatchlistId : null;
        const url = watchlistId
          ? `/api/me/watchlists/${encodeURIComponent(watchlistId)}/launches?${qs.toString()}`
          : `/api/${modeNow === 'public' ? 'public' : 'live'}/launches?${qs.toString()}`;
        debugLog('fetchPage_request', { reason, url });
        const res = await fetch(url, {
          signal: controller.signal
        });
        debugLog('fetchPage_response', { reason, status: res.status, ok: res.ok });
        if (res.status === 401) {
          setAuthStatus('guest');
          setIsPaid(false);
          setViewerTier('anon');
          setNotice({ tone: 'warning', message: 'Sign in to view the live feed. Falling back to the public cache.' });
          debugLog('fetchPage_fallback_401', { reason });
          return;
        }
        if (res.status === 402) {
          if (snapshot.viewerTier === 'premium') {
            console.warn('[LaunchFeed] entitlement_mismatch_402', { reason, url });
          }
          setIsPaid(false);
          setViewerTier(snapshot.isAuthed ? 'free' : 'anon');
          setNotice({ tone: 'warning', message: 'Live feed is a Premium feature. Showing the public cache.' });
          debugLog('fetchPage_fallback_402', { reason });
          return;
        }
        if (!res.ok) {
          const errorBody = await res.json().catch(() => null);
          const message =
            errorBody?.error === 'supabase_not_configured'
              ? 'Data source not configured. Add Supabase env vars in Vercel.'
              : errorBody?.error
                ? `Feed error: ${errorBody.error}`
                : `Feed error: ${res.status}`;
          setNotice({ tone: 'warning', message });
          throw new Error(message);
        }
        const json = await res.json();
        const rows = (json.launches || []) as Launch[];
        debugLog('fetchPage_success', { reason, rows: rows.length });
        setLastCheckedAtMs(Date.now());
        setLaunches((prev) => {
          if (replace) return rows;
          const existing = new Set(prev.map((l) => l.id));
          const merged = [...prev];
          rows.forEach((row) => {
            if (!existing.has(row.id)) merged.push(row);
          });
          return merged;
        });
        setNextOffset(offset + rows.length);
        const hasMoreValue = typeof json?.hasMore === 'boolean' ? json.hasMore : rows.length === PAGE_SIZE;
        setHasMore(hasMoreValue);
        if (modeNow === 'live' || watchlistId) setNotice(null);
      } catch (err) {
        if ((err as any)?.name !== 'AbortError') {
          console.error('feed fetch error', reason, err);
          debugLog('fetchPage_error', { reason, error: String((err as any)?.message || err) });
        }
      } finally {
        if (fetchSeqRef.current !== seq) return;
        setLoading(false);
        setLoadingMore(false);
        debugLog('fetchPage_done', { reason });
      }
    },
    [debug, debugLog, debugName]
  );

  useEffect(() => {
    const hasInitialPage =
      initialLaunchesRef.current.length > 0 && initialOffsetRef.current === pageOffset;

    if (!didInitialFetchRef.current && hasInitialPage) {
      didInitialFetchRef.current = true;
      return;
    }

    didInitialFetchRef.current = true;
    fetchPage({ offset: pageOffset, replace: true, reason: 'page_or_filters_change' });
    return () => abortRef.current?.abort();
  }, [fetchPage, filters, mode, myLaunchesEnabled, launchFeedWatchlistDependency, pageOffset]);

  const fetchRecentChanges = useCallback(async () => {
    if (viewerTier !== 'premium') {
      setChanged([]);
      return;
    }
    try {
      const qs = new URLSearchParams();
      qs.set('hours', '24');
      qs.set('region', filters.region ?? 'us');
      const res = await fetch(`/api/live/launches/changed?${qs.toString()}`, { cache: 'no-store' });
      if (res.status === 401) {
        setAuthStatus('guest');
        setIsPaid(false);
        setViewerTier('anon');
        setNotice({ tone: 'warning', message: 'Sign in to view live changes. Falling back to the public cache.' });
        return;
      }
      if (res.status === 402) {
        if (viewerTier === 'premium') {
          console.warn('[LaunchFeed] entitlement_mismatch_402', { source: 'recent_changes' });
        }
        setIsPaid(false);
        setViewerTier(isAuthed ? 'free' : 'anon');
        setNotice({ tone: 'warning', message: 'Live changes are a Premium feature. Showing the public cache.' });
        return;
      }
      if (!res.ok) {
        const errorBody = await res.json().catch(() => null);
        const message = errorBody?.error ? `Changes error: ${errorBody.error}` : `Changes error: ${res.status}`;
        setNotice({ tone: 'warning', message });
        return;
      }
      const json = await res.json().catch(() => ({}));
      setChanged(Array.isArray(json.results) ? json.results : []);
    } catch (err) {
      console.error('changed fetch error', err);
    }
  }, [filters.region, isAuthed, viewerTier]);

  useEffect(() => {
    fetchRecentChanges();
  }, [fetchRecentChanges]);

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
    if (viewerTier !== 'premium') {
      setNextRefreshAt(null);
      return;
    }
    if (!Number.isFinite(refreshIntervalMs) || refreshIntervalMs <= 0) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      const now = Date.now();
      const next = getNextAlignedRefreshMs(now, refreshIntervalMs);
      setNextRefreshAt(next);
      const delay = Math.max(0, next - now);
      debugLog('refresh_schedule', {
        viewerTier,
        refreshIntervalMs,
        now,
        next,
        delay,
        loading,
        loadingMore
      });
      timeout = setTimeout(async () => {
        if (cancelled) return;
        if (!loading && !loadingMore) {
          try {
            const versionFilters = latestRef.current.filters;
            const versionParams = new URLSearchParams();
            versionParams.set('range', versionFilters.range || '7d');
            versionParams.set('region', versionFilters.region ?? 'us');
            if (versionFilters.location) versionParams.set('location', versionFilters.location);
            if (versionFilters.state) versionParams.set('state', versionFilters.state);
            if (versionFilters.pad) versionParams.set('pad', versionFilters.pad);
            if (versionFilters.provider) versionParams.set('provider', versionFilters.provider);
            if (versionFilters.status && versionFilters.status !== 'all') {
              versionParams.set('status', versionFilters.status);
            }
            const versionUrl = `/api/live/launches/version?${versionParams.toString()}`;
            debugLog('refresh_tick_premium_check', { url: versionUrl });
            const res = await fetch(versionUrl, { cache: 'no-store' });
            if (res.status === 401 || res.status === 402) {
              debugLog('refresh_tick_premium_version_unauthorized', { status: res.status });
              await fetchPage({ offset: latestRef.current.pageOffset, replace: true, reason: 'scheduled_refresh_version_unauthorized' });
              await fetchRecentChanges();
            } else if (res.ok) {
              const json = await res.json().catch(() => ({}));
              debugLog('refresh_tick_premium_version_payload', json);
              const nextVersion = typeof json?.version === 'string' ? json.version : null;
              if (nextVersion) {
                if (!lastSeenLiveVersionRef.current) {
                  lastSeenLiveVersionRef.current = nextVersion;
                  debugLog('refresh_tick_premium_version_baseline', { version: nextVersion });
                } else if (nextVersion !== lastSeenLiveVersionRef.current) {
                  debugLog('refresh_tick_premium_version_changed', {
                    prev: lastSeenLiveVersionRef.current,
                    next: nextVersion
                  });
                  lastSeenLiveVersionRef.current = nextVersion;
                  await fetchPage({ offset: latestRef.current.pageOffset, replace: true, reason: 'scheduled_refresh_version_changed' });
                  await fetchRecentChanges();
                } else {
                  debugLog('refresh_tick_premium_version_unchanged', { version: nextVersion });
                }
              }
            }
          } catch (err) {
            console.error('live refresh check error', err);
          }
        } else {
          debugLog('refresh_tick_skipped_loading', { loading, loadingMore });
        }
        schedule();
      }, delay);
    };

    schedule();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [debugLog, fetchPage, fetchRecentChanges, loading, loadingMore, refreshIntervalMs, setNextRefreshAt, viewerTier]);

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
    Object.keys(myPadRulesByValue).length;
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
  const canUseSavedItems = isAuthed && viewerTier !== 'anon';

  const includeSeconds = viewerTier === 'premium';
  const lastCheckedLabel = lastCheckedAtMs ? formatRefreshTime(lastCheckedAtMs, includeSeconds) : null;
  const nextCheckLabel = nextRefreshAt ? formatRefreshTime(nextRefreshAt, includeSeconds) : null;
  const premiumFreshnessLine =
    viewerTier === 'premium'
      ? `Live checks every ${refreshIntervalSeconds}s${lastCheckedLabel ? ` • Last checked ${lastCheckedLabel}` : ''}${nextCheckLabel ? ` • Next check ${nextCheckLabel}` : ''}`
      : null;
  const nonPremiumPriceLine = 'Premium is $3.99/mo • cancel anytime';
  const homeSignInHref = '/auth/sign-in?return_to=%2F';
  const homeSignUpHref = '/auth/sign-up?return_to=%2F';
  const homeUpgradeHref = '/upgrade?return_to=%2F';
  const showModeStatusCard = authStatus !== 'loading' && !query && !unlocksDismissed;
  const showAlertsNudge = false;
  const modeStatusEyebrow = viewerTier === 'premium' ? 'Live mode' : viewerTier === 'free' ? 'Free account' : 'Free account';
  const modeStatusTitle =
    viewerTier === 'premium'
      ? 'Live updates are active.'
      : viewerTier === 'free'
        ? 'Your free account is set up for the basics.'
        : 'Save your view without turning the site into a signup wall.';
  const modeStatusBody =
    viewerTier === 'premium'
      ? premiumFreshnessLine || 'Premium keeps the feed on live checks with the fastest refresh cadence.'
      : viewerTier === 'free'
        ? `You can keep 1 saved view, 1 My Launches list, and up to 10 follow rules. Premium adds live updates, the change log, alerts, and recurring feeds.`
        : 'Create a free account to save one view, build a My Launches list, and sync your preferences across devices. Browsing stays open either way.';
  const modePrimaryHref = viewerTier === 'premium' ? '/account' : viewerTier === 'free' ? homeUpgradeHref : homeSignUpHref;
  const modePrimaryLabel = viewerTier === 'premium' ? 'Open account' : viewerTier === 'free' ? 'See Premium' : 'Create free account';

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
        fetchPage({ offset: nextOffset, replace: false, reason: 'infinite_scroll' });
      },
      { rootMargin: '300px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [debugLog, fetchPage, hasMore, infiniteScrollArmed, launches.length, loading, loadingMore, nextOffset, pageOffset, query]);

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
    if (!isAuthed || viewerTier === 'anon') return;
    if (presetSaving) return;

    const suggested = activePresetId
      ? presetList.find((preset) => preset.id === activePresetId)?.name || 'Preset'
      : `Preset ${new Date().toLocaleDateString()}`;
    const name = window.prompt('Preset name', suggested)?.trim();
    if (!name) return;

    setPresetSaving(true);
    try {
      const res = await fetch('/api/me/filter-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, filters }),
        cache: 'no-store'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const limit = typeof json?.limit === 'number' ? json.limit : null;
        const message =
          json?.error === 'limit_reached' && limit
            ? `Saved view limit reached (${limit}). Remove an older saved view in Account first.`
            : json?.error
              ? `Preset error: ${json.error}`
              : `Preset error: ${res.status}`;
        setNotice({ tone: 'warning', message });
        return;
      }

      const preset = json?.preset;
      if (preset?.id) {
        setPresetList((prev) => [preset, ...prev]);
        setActivePresetId(String(preset.id));
        setNotice({ tone: 'info', message: 'Preset saved.' });
      }
    } catch (err) {
      console.error('preset save error', err);
      setNotice({ tone: 'warning', message: 'Unable to save preset.' });
    } finally {
      setPresetSaving(false);
    }
  }, [activePresetId, filters, isAuthed, presetList, presetSaving, viewerTier]);

  const setActivePresetAsDefault = useCallback(async () => {
    if (!isAuthed || viewerTier === 'anon') return;
    const presetId = activePresetId ? String(activePresetId).trim() : '';
    if (!presetId) return;
    if (presetDefaulting) return;

    setPresetDefaulting(true);
    try {
      const res = await fetch(`/api/me/filter-presets/${encodeURIComponent(presetId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_default: true }),
        cache: 'no-store'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({
          tone: 'warning',
          message: json?.error ? `Preset error: ${json.error}` : `Preset error: ${res.status}`
        });
        return;
      }

      const savedId = json?.preset?.id ? String(json.preset.id) : presetId;
      setPresetList((prev) =>
        prev.map((preset) => ({
          ...preset,
          is_default: preset.id === savedId
        }))
      );
      setActivePresetId(savedId);
      setNotice({ tone: 'info', message: 'Default view updated.' });
    } catch (err) {
      console.error('preset default update error', err);
      setNotice({ tone: 'warning', message: 'Unable to set default view.' });
    } finally {
      setPresetDefaulting(false);
    }
  }, [activePresetId, isAuthed, presetDefaulting, viewerTier]);

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

  const toggleWatchLaunch = useCallback(
    async (launchId: string, options?: { skipToast?: boolean }) => {
      if (!isAuthed || viewerTier === 'anon') return;
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
          const url = `/api/me/watchlists/${encodeURIComponent(myWatchlistId)}/rules/${encodeURIComponent(existingRuleId)}`;
          debugLog('watch_toggle_request', { method: 'DELETE', url });
          const res = await fetch(url, {
            method: 'DELETE',
            cache: 'no-store'
          });
          debugLog('watch_toggle_response', { method: 'DELETE', url, status: res.status, ok: res.ok });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            setNotice({ tone: 'warning', message: json?.error ? `My Launches error: ${json.error}` : `My Launches error: ${res.status}` });
            return;
          }
          setMyLaunchRulesByLaunchId((prev) => {
            const next = { ...prev };
            delete next[launchId];
            return next;
          });
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
                const res = await fetch(`/api/me/watchlists/${encodeURIComponent(watchlistId)}/rules`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ rule_type: 'launch', rule_value: launchId }),
                  cache: 'no-store'
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                  const limit = typeof json?.limit === 'number' ? json.limit : null;
                  const message =
                    json?.error === 'limit_reached' && limit
                      ? `My Launches limit reached (${limit} rules).`
                      : json?.error
                        ? `My Launches error: ${json.error}`
                        : `My Launches error: ${res.status}`;
                  setNotice({ tone: 'warning', message });
                  return;
                }

                const nextRuleId = json?.rule?.id ? String(json.rule.id) : null;
                if (!nextRuleId) return;
                setMyLaunchRulesByLaunchId((prev) => ({ ...prev, [launchId]: nextRuleId }));
                if (latestRef.current.myLaunchesEnabled) {
                  void fetchPage({ offset: latestRef.current.pageOffset, replace: true, reason: 'watchlist_rule_undo_launch' });
                }
              }
            });
          }
          debugLog('watch_toggle_success', { launchId, action: 'removed' });
          return;
        }

        const url = `/api/me/watchlists/${encodeURIComponent(myWatchlistId)}/rules`;
        debugLog('watch_toggle_request', { method: 'POST', url });
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rule_type: 'launch', rule_value: launchId }),
          cache: 'no-store'
        });
        debugLog('watch_toggle_response', { method: 'POST', url, status: res.status, ok: res.ok });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const limit = typeof json?.limit === 'number' ? json.limit : null;
          const message =
            json?.error === 'limit_reached' && limit
              ? `My Launches limit reached (${limit} rules).`
              : json?.error
                ? `My Launches error: ${json.error}`
                : `My Launches error: ${res.status}`;
          setNotice({ tone: 'warning', message });
          return;
        }
        const ruleId = json?.rule?.id ? String(json.rule.id) : null;
        if (ruleId) {
          setMyLaunchRulesByLaunchId((prev) => ({ ...prev, [launchId]: ruleId }));
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
                const res = await fetch(
                  `/api/me/watchlists/${encodeURIComponent(watchlistId)}/rules/${encodeURIComponent(ruleId)}`,
                  { method: 'DELETE', cache: 'no-store' }
                );
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                  setNotice({
                    tone: 'warning',
                    message: json?.error ? `My Launches error: ${json.error}` : `My Launches error: ${res.status}`
                  });
                  return;
                }
                setMyLaunchRulesByLaunchId((prev) => {
                  const next = { ...prev };
                  delete next[launchId];
                  return next;
                });
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
        setNotice({ tone: 'warning', message: 'Unable to update My Launches.' });
        debugLog('watch_toggle_error', { launchId, error: String((err as any)?.message || err) });
      } finally {
        setWatchToggleBusy((prev) => ({ ...prev, [launchId]: false }));
      }
    },
    [debugLog, fetchPage, isAuthed, myLaunchRulesByLaunchId, myLaunchesEnabled, myWatchlistId, pushToast, viewerTier, watchToggleBusy]
  );

  const toggleFollowProvider = useCallback(
    async (provider: string, options?: { skipToast?: boolean }) => {
      const normalizedProvider = String(provider || '').trim();
      if (!normalizedProvider) return;
      if (!isAuthed || viewerTier === 'anon') return;
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
          const url = `/api/me/watchlists/${encodeURIComponent(myWatchlistId)}/rules/${encodeURIComponent(existingRuleId)}`;
          debugLog('provider_follow_request', { method: 'DELETE', url });
          const res = await fetch(url, { method: 'DELETE', cache: 'no-store' });
          debugLog('provider_follow_response', { method: 'DELETE', url, status: res.status, ok: res.ok });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            setNotice({ tone: 'warning', message: json?.error ? `Follow error: ${json.error}` : `Follow error: ${res.status}` });
            return;
          }
          setMyProviderRulesByProvider((prev) => {
            const next = { ...prev };
            delete next[normalizedProvider];
            return next;
          });
          debugLog('provider_follow_toggle_success', { provider: normalizedProvider, action: 'unfollowed' });
          if (!options?.skipToast) {
            pushToast({
              message: `Unfollowed ${normalizedProvider}.`,
              tone: 'info',
              onUndo: async () => {
                const watchlistId = latestRef.current.myWatchlistId;
                if (!watchlistId) return;
                const res = await fetch(`/api/me/watchlists/${encodeURIComponent(watchlistId)}/rules`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ rule_type: 'provider', rule_value: normalizedProvider }),
                  cache: 'no-store'
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                  const limit = typeof json?.limit === 'number' ? json.limit : null;
                  const msg =
                    json?.error === 'limit_reached' && limit
                      ? `My Launches limit reached (${limit} rules).`
                      : json?.error
                        ? `Follow error: ${json.error}`
                        : `Follow error: ${res.status}`;
                  setNotice({ tone: 'warning', message: msg });
                  return;
                }
                const nextRuleId = json?.rule?.id ? String(json.rule.id) : null;
                if (!nextRuleId) return;
                setMyProviderRulesByProvider((prev) => ({ ...prev, [normalizedProvider]: nextRuleId }));

                if (latestRef.current.myLaunchesEnabled) {
                  resetPageToFirst();
                  fetchPage({ offset: 0, replace: true, reason: 'watchlist_rule_undo_provider' });
                }
              }
            });
          }
        } else {
          const url = `/api/me/watchlists/${encodeURIComponent(myWatchlistId)}/rules`;
          debugLog('provider_follow_request', { method: 'POST', url });
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rule_type: 'provider', rule_value: normalizedProvider }),
            cache: 'no-store'
          });
          debugLog('provider_follow_response', { method: 'POST', url, status: res.status, ok: res.ok });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            const limit = typeof json?.limit === 'number' ? json.limit : null;
            const msg =
              json?.error === 'limit_reached' && limit
                ? `My Launches limit reached (${limit} rules).`
                : json?.error
                  ? `Follow error: ${json.error}`
                  : `Follow error: ${res.status}`;
            setNotice({ tone: 'warning', message: msg });
            return;
          }
          const ruleId = json?.rule?.id ? String(json.rule.id) : null;
          if (ruleId) {
            setMyProviderRulesByProvider((prev) => ({ ...prev, [normalizedProvider]: ruleId }));
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
                  const res = await fetch(
                    `/api/me/watchlists/${encodeURIComponent(watchlistId)}/rules/${encodeURIComponent(ruleId)}`,
                    { method: 'DELETE', cache: 'no-store' }
                  );
                  const json = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    setNotice({
                      tone: 'warning',
                      message: json?.error ? `Follow error: ${json.error}` : `Follow error: ${res.status}`
                    });
                    return;
                  }
                  setMyProviderRulesByProvider((prev) => {
                    const next = { ...prev };
                    delete next[normalizedProvider];
                    return next;
                  });

                  if (latestRef.current.myLaunchesEnabled) {
                    resetPageToFirst();
                    fetchPage({ offset: 0, replace: true, reason: 'watchlist_rule_undo_provider' });
                  }
                }
              });
            }
          }
        }

        if (myLaunchesEnabled) {
          resetPageToFirst();
          fetchPage({ offset: 0, replace: true, reason: 'watchlist_rule_change_provider' });
        }
      } catch (err) {
        console.error('provider follow toggle error', err);
        setNotice({ tone: 'warning', message: 'Unable to update provider follow.' });
        debugLog('provider_follow_toggle_error', { provider: normalizedProvider, error: String((err as any)?.message || err) });
      } finally {
        setFollowToggleBusy((prev) => ({ ...prev, [busyKey]: false }));
      }
    },
    [
      debugLog,
      fetchPage,
      followToggleBusy,
      isAuthed,
      myLaunchesEnabled,
      myProviderRulesByProvider,
      myWatchlistId,
      pushToast,
      resetPageToFirst,
      viewerTier
    ]
  );

  const toggleFollowPad = useCallback(
    async (padRuleValue: string, options?: { skipToast?: boolean }) => {
      const normalized = String(padRuleValue || '').trim();
      if (!normalized) return;
      if (!isAuthed || viewerTier === 'anon') return;
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
          const url = `/api/me/watchlists/${encodeURIComponent(myWatchlistId)}/rules/${encodeURIComponent(existingRuleId)}`;
          debugLog('pad_follow_request', { method: 'DELETE', url });
          const res = await fetch(url, { method: 'DELETE', cache: 'no-store' });
          debugLog('pad_follow_response', { method: 'DELETE', url, status: res.status, ok: res.ok });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            setNotice({ tone: 'warning', message: json?.error ? `Follow error: ${json.error}` : `Follow error: ${res.status}` });
            return;
          }
          setMyPadRulesByValue((prev) => {
            const next = { ...prev };
            delete next[normalized];
            return next;
          });
          debugLog('pad_follow_toggle_success', { padRuleValue: normalized, action: 'unfollowed' });
          if (!options?.skipToast) {
            pushToast({
              message: `Unfollowed ${formatPadRuleLabel(normalized)}.`,
              tone: 'info',
              onUndo: async () => {
                const watchlistId = latestRef.current.myWatchlistId;
                if (!watchlistId) return;
                const res = await fetch(`/api/me/watchlists/${encodeURIComponent(watchlistId)}/rules`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ rule_type: 'pad', rule_value: normalized }),
                  cache: 'no-store'
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                  const limit = typeof json?.limit === 'number' ? json.limit : null;
                  const msg =
                    json?.error === 'limit_reached' && limit
                      ? `My Launches limit reached (${limit} rules).`
                      : json?.error
                        ? `Follow error: ${json.error}`
                        : `Follow error: ${res.status}`;
                  setNotice({ tone: 'warning', message: msg });
                  return;
                }
                const nextRuleId = json?.rule?.id ? String(json.rule.id) : null;
                if (!nextRuleId) return;
                setMyPadRulesByValue((prev) => ({ ...prev, [normalized]: nextRuleId }));

                if (latestRef.current.myLaunchesEnabled) {
                  resetPageToFirst();
                  fetchPage({ offset: 0, replace: true, reason: 'watchlist_rule_undo_pad' });
                }
              }
            });
          }
        } else {
          const url = `/api/me/watchlists/${encodeURIComponent(myWatchlistId)}/rules`;
          debugLog('pad_follow_request', { method: 'POST', url });
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rule_type: 'pad', rule_value: normalized }),
            cache: 'no-store'
          });
          debugLog('pad_follow_response', { method: 'POST', url, status: res.status, ok: res.ok });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            const limit = typeof json?.limit === 'number' ? json.limit : null;
            const msg =
              json?.error === 'limit_reached' && limit
                ? `My Launches limit reached (${limit} rules).`
                : json?.error
                  ? `Follow error: ${json.error}`
                  : `Follow error: ${res.status}`;
            setNotice({ tone: 'warning', message: msg });
            return;
          }
          const ruleId = json?.rule?.id ? String(json.rule.id) : null;
          if (ruleId) {
            setMyPadRulesByValue((prev) => ({ ...prev, [normalized]: ruleId }));
            debugLog('pad_follow_toggle_success', { padRuleValue: normalized, action: 'followed', ruleId: `${ruleId.slice(0, 8)}…` });
            if (!options?.skipToast) {
              pushToast({
                message: `Following ${formatPadRuleLabel(normalized)}.`,
                tone: 'success',
                onUndo: async () => {
                  const watchlistId = latestRef.current.myWatchlistId;
                  if (!watchlistId) return;
                  const res = await fetch(
                    `/api/me/watchlists/${encodeURIComponent(watchlistId)}/rules/${encodeURIComponent(ruleId)}`,
                    { method: 'DELETE', cache: 'no-store' }
                  );
                  const json = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    setNotice({
                      tone: 'warning',
                      message: json?.error ? `Follow error: ${json.error}` : `Follow error: ${res.status}`
                    });
                    return;
                  }
                  setMyPadRulesByValue((prev) => {
                    const next = { ...prev };
                    delete next[normalized];
                    return next;
                  });

                  if (latestRef.current.myLaunchesEnabled) {
                    resetPageToFirst();
                    fetchPage({ offset: 0, replace: true, reason: 'watchlist_rule_undo_pad' });
                  }
                }
              });
            }
          }
        }

        if (myLaunchesEnabled) {
          resetPageToFirst();
          fetchPage({ offset: 0, replace: true, reason: 'watchlist_rule_change_pad' });
        }
      } catch (err) {
        console.error('pad follow toggle error', err);
        setNotice({ tone: 'warning', message: 'Unable to update pad follow.' });
        debugLog('pad_follow_toggle_error', { padRuleValue: normalized, error: String((err as any)?.message || err) });
      } finally {
        setFollowToggleBusy((prev) => ({ ...prev, [busyKey]: false }));
      }
    },
    [
      debugLog,
      fetchPage,
      followToggleBusy,
      isAuthed,
      myLaunchesEnabled,
      myPadRulesByValue,
      myWatchlistId,
      pushToast,
      resetPageToFirst,
      viewerTier
    ]
  );

  const renderLaunchCard = useCallback(
    (launch: Launch, { isNext }: { isNext: boolean }) => {
      const providerKey = String(launch.provider || '').trim();
      const padRuleValue = buildPadRuleValue(launch);
      return (
        <LaunchCard
          launch={launch}
          isNext={isNext}
          showAlertsNudge={showAlertsNudge && isNext}
          isAuthed={isAuthed}
          isPaid={isPaid}
          isArEligible={arEligibleLaunchIdSet.has(launch.id)}
          onOpenUpsell={openUpsell}
          blockThirdPartyEmbeds={blockThirdPartyEmbeds}
          initialNowMs={initialNowMs}
          isWatched={Boolean(myLaunchRulesByLaunchId[launch.id])}
          watchDisabled={
            Boolean(watchToggleBusy[launch.id]) ||
            viewerTier === 'anon' ||
            !myWatchlistId ||
            watchlistsLoading ||
            Boolean(watchlistsError)
          }
          onToggleWatch={canUseSavedItems ? toggleWatchLaunch : undefined}
          isProviderFollowed={providerKey ? Boolean(myProviderRulesByProvider[providerKey]) : false}
          providerFollowDisabled={
            !providerKey ||
            viewerTier === 'anon' ||
            !myWatchlistId ||
            watchlistsLoading ||
            Boolean(watchlistsError) ||
            Boolean(followToggleBusy[`provider:${providerKey}`])
          }
          onToggleFollowProvider={canUseSavedItems ? toggleFollowProvider : undefined}
          padFollowValue={padRuleValue}
          isPadFollowed={padRuleValue ? Boolean(myPadRulesByValue[padRuleValue]) : false}
          padFollowDisabled={
            !padRuleValue ||
            viewerTier === 'anon' ||
            !myWatchlistId ||
            watchlistsLoading ||
            Boolean(watchlistsError) ||
            Boolean(followToggleBusy[`pad:${padRuleValue}`])
          }
          onToggleFollowPad={canUseSavedItems ? toggleFollowPad : undefined}
        />
      );
    },
    [
      arEligibleLaunchIdSet,
      blockThirdPartyEmbeds,
      canUseSavedItems,
      followToggleBusy,
      initialNowMs,
      isAuthed,
      isPaid,
      myLaunchRulesByLaunchId,
      myPadRulesByValue,
      myProviderRulesByProvider,
      myWatchlistId,
      openUpsell,
      showAlertsNudge,
      toggleFollowPad,
      toggleFollowProvider,
      toggleWatchLaunch,
      viewerTier,
      watchToggleBusy,
      watchlistsError,
      watchlistsLoading
    ]
  );

  return (
    <section className="space-y-4">
      <h2 className="sr-only">Launches</h2>
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
              {viewerTier === 'free' && <div className="mt-2 text-xs text-text3">{nonPremiumPriceLine}</div>}
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
                <button
                  type="button"
                  className={clsx(
                    'rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] transition',
                    !myLaunchesEnabled ? 'bg-primary text-black' : 'text-text2 hover:bg-[rgba(255,255,255,0.06)] hover:text-text1'
                  )}
                  onClick={() => toggleMyLaunches(false)}
                  aria-pressed={!myLaunchesEnabled}
                >
                  For You
                </button>
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
              <button
                type="button"
                className="rounded-lg border border-stroke bg-surface-0 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-text2 transition hover:border-primary hover:text-text1"
                onClick={() => setFiltersOpen((open) => !open)}
                aria-expanded={filtersOpen}
                aria-controls={filtersPanelId}
              >
                {filtersOpen ? 'Hide filters' : 'Show filters'}
              </button>
              {hasActiveFilters ? (
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
                  : 'For You shows all launches. Create a free account to use Following.'}
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
              {canUseSavedItems ? (
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
                fetchPage({ offset: nextOffset, replace: false, reason: 'load_more_click' });
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

function extractLaunchRuleMap(rules: unknown) {
  const rows = Array.isArray(rules) ? rules : [];
  const map: Record<string, string> = {};

  for (const row of rows) {
    const type = String((row as any)?.rule_type || '').trim().toLowerCase();
    if (type !== 'launch') continue;
    const launchId = String((row as any)?.rule_value || '').trim().toLowerCase();
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
    const type = String((row as any)?.rule_type || '').trim().toLowerCase();
    if (type !== 'provider') continue;
    const provider = String((row as any)?.rule_value || '').trim();
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
    const type = String((row as any)?.rule_type || '').trim().toLowerCase();
    if (type !== 'pad') continue;
    const value = String((row as any)?.rule_value || '').trim();
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
