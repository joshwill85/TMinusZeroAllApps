'use client';

import type { QueryClient } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountExportV1,
  AlertRuleCreateV1,
  AlertRuleEnvelopeV1,
  AlertRulesV1,
  BillingPlatformV1,
  CalendarFeedCreateV1,
  CalendarFeedEnvelopeV1,
  CalendarFeedsV1,
  CalendarFeedUpdateV1,
  EmbedWidgetCreateV1,
  EmbedWidgetEnvelopeV1,
  EmbedWidgetsV1,
  EmbedWidgetUpdateV1,
  EntitlementsV1,
  FilterPresetCreateV1,
  FilterPresetEnvelopeV1,
  FilterPresetUpdateV1,
  FilterPresetsV1,
  LaunchFeedRequest,
  LaunchFeedV1,
  LaunchNotificationPreferenceEnvelopeV1,
  LaunchNotificationPreferenceUpdateV1,
  MarketingEmailV1,
  NotificationPreferencesV1,
  NotificationPreferencesUpdateV1,
  PrivacyPreferencesV1,
  PrivacyPreferencesUpdateV1,
  ProfileUpdateV1,
  SearchResponseV1,
  ViewerSessionV1,
  RssFeedCreateV1,
  RssFeedEnvelopeV1,
  RssFeedsV1,
  RssFeedUpdateV1,
  WatchlistCreateV1,
  WatchlistEnvelopeV1,
  WatchlistRuleCreateV1,
  WatchlistRuleEnvelopeV1,
  WatchlistUpdateV1,
  WatchlistsV1
} from '@tminuszero/api-client';
import {
  accountExportQueryOptions,
  alertRulesQueryOptions,
  billingCatalogQueryOptions,
  billingSummaryQueryOptions,
  calendarFeedsQueryOptions,
  changedLaunchesQueryOptions,
  embedWidgetsQueryOptions,
  filterPresetsQueryOptions,
  launchFeedQueryOptions,
  launchNotificationPreferenceQueryOptions,
  marketingEmailQueryOptions,
  normalizeSearchQuery,
  notificationPreferencesQueryOptions,
  privacyPreferencesQueryOptions,
  profileQueryOptions,
  searchQueryOptions,
  sharedQueryKeys,
  sharedQueryStaleTimes,
  rssFeedsQueryOptions,
  viewerEntitlementsQueryOptions,
  viewerSessionQueryOptions,
  watchlistsQueryOptions
} from '@tminuszero/query';
import { browserApiClient } from '@/lib/api/client';
import {
  cancelBillingSubscription,
  openBillingPortal,
  resumeBillingSubscription,
  startBillingCheckout,
  startBillingSetupIntent,
  updateDefaultPaymentMethod
} from '@/lib/api/webBillingAdapters';
import {
  getSharedAccountExport,
  getSharedPrivacyPreferences,
  getSharedProfile,
  getLaunchDayEmailFilterOptions,
  getWebPushDeviceStatus,
  updateSharedPrivacyPreferences,
  updateSharedProfile,
  sendWebPushTest,
  subscribeWebPushDevice,
  unsubscribeWebPushDevice
} from '@/lib/api/webAccountAdapters';
import {
  getArEligibleLaunchIds,
  getFeedFilterOptions,
  getLegacyChangedLaunches,
  getLegacyLaunchFeed,
  getLiveLaunchFeedVersion
} from '@/lib/api/webLaunchFeedAdapters';

const viewerScopedQueryKeys = [
  sharedQueryKeys.viewerSession,
  sharedQueryKeys.entitlements,
  sharedQueryKeys.billingSummary,
  sharedQueryKeys.profile,
  sharedQueryKeys.privacyPreferences,
  sharedQueryKeys.marketingEmail,
  sharedQueryKeys.watchlists,
  sharedQueryKeys.filterPresets,
  sharedQueryKeys.alertRules,
  sharedQueryKeys.calendarFeeds,
  sharedQueryKeys.rssFeeds,
  sharedQueryKeys.embedWidgets,
  sharedQueryKeys.notificationPreferences
] as const;

const WEB_USE_LEGACY_FEED_ADAPTERS = process.env.NEXT_PUBLIC_LAUNCH_FEED_LEGACY_ADAPTERS === '1';

export const webQueryKeys = sharedQueryKeys;
export const webOnlyQueryKeys = {
  launchDayEmailFilterOptions: ['launch-day-email-filter-options'] as const,
  webPushDeviceStatus: ['web-push-device-status'] as const,
  arEligibleLaunchIds: ['ar-eligible-launch-ids'] as const,
  feedFilterOptions: (request: {
    mode: 'public' | 'live';
    range: string;
    region: string;
    location?: string | null;
    state?: string | null;
    pad?: string | null;
    provider?: string | null;
    status?: string | null;
  }) =>
    [
      'feed-filter-options',
      request.mode,
      request.range,
      request.region,
      request.location ?? null,
      request.state ?? null,
      request.pad ?? null,
      request.provider ?? null,
      request.status ?? null
    ] as const,
  liveLaunchVersion: (request: {
    range: string;
    region: string;
    location?: string | null;
    state?: string | null;
    pad?: string | null;
    provider?: string | null;
    status?: string | null;
  }) =>
    [
      'live-launch-version',
      request.range,
      request.region,
      request.location ?? null,
      request.state ?? null,
      request.pad ?? null,
      request.provider ?? null,
      request.status ?? null
    ] as const
};

export const guestViewerSession: ViewerSessionV1 = {
  viewerId: null,
  email: null,
  role: 'guest',
  accessToken: null,
  expiresAt: null,
  authMode: 'guest'
};

export const guestViewerEntitlements: EntitlementsV1 = {
  tier: 'anon',
  status: 'guest',
  source: 'guest',
  isPaid: false,
  isAdmin: false,
  isAuthed: false,
  mode: 'public',
  refreshIntervalSeconds: 7200,
  capabilities: {
    canUseSavedItems: false,
    canUseLaunchFilters: false,
    canUseLaunchCalendar: false,
    canUseOneOffCalendar: false,
    canUseLiveFeed: false,
    canUseChangeLog: false,
    canUseInstantAlerts: false,
    canManageFilterPresets: false,
    canManageFollows: false,
    canUseBasicAlertRules: false,
    canUseAdvancedAlertRules: false,
    canUseBrowserLaunchAlerts: false,
    canUseRecurringCalendarFeeds: false,
    canUseRssFeeds: false,
    canUseEmbedWidgets: false,
    canUseArTrajectory: false,
    canUseEnhancedForecastInsights: false,
    canUseLaunchDayEmail: false
  },
  limits: {
    presetLimit: 0,
    filterPresetLimit: 0,
    watchlistLimit: 0,
    watchlistRuleLimit: 0
  },
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  stripePriceId: null,
  reconciled: true,
  reconcileThrottled: false
};

function mergePresetEnvelope(
  current: FilterPresetsV1 | undefined,
  incoming: FilterPresetEnvelopeV1
): FilterPresetsV1 {
  const nextPresets = (current?.presets ?? []).filter((preset) => preset.id !== incoming.preset.id);
  const normalized = incoming.preset.isDefault
    ? nextPresets.map((preset) => ({ ...preset, isDefault: false }))
    : nextPresets;

  return {
    presets: [incoming.preset, ...normalized]
  };
}

function mergeAlertRuleEnvelope(current: AlertRulesV1 | undefined, incoming: AlertRuleEnvelopeV1): AlertRulesV1 {
  const nextRules = (current?.rules ?? []).filter((rule) => rule.id !== incoming.rule.id);
  return {
    rules: sortByCreatedAtDesc([...nextRules, incoming.rule])
  };
}

function removeAlertRule(current: AlertRulesV1 | undefined, ruleId: string): AlertRulesV1 {
  return {
    rules: (current?.rules ?? []).filter((rule) => rule.id !== ruleId)
  };
}

function parseSortDate(value: string | null | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sortByCreatedAtAsc<T extends { createdAt?: string | null }>(items: T[]) {
  return [...items].sort((left, right) => parseSortDate(left.createdAt, 0) - parseSortDate(right.createdAt, 0));
}

function sortByCreatedAtDesc<T extends { createdAt?: string | null }>(items: T[]) {
  return [...items].sort((left, right) => parseSortDate(right.createdAt, 0) - parseSortDate(left.createdAt, 0));
}

function mergeWatchlistEnvelope(
  current: WatchlistsV1 | undefined,
  incoming: WatchlistEnvelopeV1
): WatchlistsV1 {
  const nextWatchlists = (current?.watchlists ?? []).filter((watchlist) => watchlist.id !== incoming.watchlist.id);
  return {
    watchlists: sortByCreatedAtAsc([...nextWatchlists, incoming.watchlist])
  };
}

function mergeWatchlistRuleEnvelope(
  current: WatchlistsV1 | undefined,
  watchlistId: string,
  incoming: WatchlistRuleEnvelopeV1
): WatchlistsV1 | undefined {
  if (!current) return current;

  return {
    watchlists: current.watchlists.map((watchlist) => {
      if (watchlist.id !== watchlistId) return watchlist;

      const nextRules = [...watchlist.rules.filter((rule) => rule.id !== incoming.rule.id), incoming.rule];
      return {
        ...watchlist,
        rules: nextRules,
        ruleCount: nextRules.length
      };
    })
  };
}

function removeWatchlist(current: WatchlistsV1 | undefined, watchlistId: string): WatchlistsV1 {
  return {
    watchlists: (current?.watchlists ?? []).filter((watchlist) => watchlist.id !== watchlistId)
  };
}

function mergeCalendarFeedEnvelope(
  current: CalendarFeedsV1 | undefined,
  incoming: CalendarFeedEnvelopeV1
): CalendarFeedsV1 {
  const nextFeeds = (current?.feeds ?? []).filter((feed) => feed.id !== incoming.feed.id);
  return {
    feeds: sortByCreatedAtDesc([incoming.feed, ...nextFeeds])
  };
}

function removeCalendarFeed(current: CalendarFeedsV1 | undefined, feedId: string): CalendarFeedsV1 {
  return {
    feeds: (current?.feeds ?? []).filter((feed) => feed.id !== feedId)
  };
}

function mergeRssFeedEnvelope(current: RssFeedsV1 | undefined, incoming: RssFeedEnvelopeV1): RssFeedsV1 {
  const nextFeeds = (current?.feeds ?? []).filter((feed) => feed.id !== incoming.feed.id);
  return {
    feeds: sortByCreatedAtDesc([incoming.feed, ...nextFeeds])
  };
}

function removeRssFeed(current: RssFeedsV1 | undefined, feedId: string): RssFeedsV1 {
  return {
    feeds: (current?.feeds ?? []).filter((feed) => feed.id !== feedId)
  };
}

function mergeEmbedWidgetEnvelope(
  current: EmbedWidgetsV1 | undefined,
  incoming: EmbedWidgetEnvelopeV1
): EmbedWidgetsV1 {
  const nextWidgets = (current?.widgets ?? []).filter((widget) => widget.id !== incoming.widget.id);
  return {
    widgets: sortByCreatedAtDesc([incoming.widget, ...nextWidgets])
  };
}

function removeEmbedWidget(current: EmbedWidgetsV1 | undefined, widgetId: string): EmbedWidgetsV1 {
  return {
    widgets: (current?.widgets ?? []).filter((widget) => widget.id !== widgetId)
  };
}

function removeWatchlistRule(
  current: WatchlistsV1 | undefined,
  watchlistId: string,
  ruleId: string
): WatchlistsV1 | undefined {
  if (!current) return current;

  return {
    watchlists: current.watchlists.map((watchlist) => {
      if (watchlist.id !== watchlistId) return watchlist;

      const nextRules = watchlist.rules.filter((rule) => rule.id !== ruleId);
      return {
        ...watchlist,
        rules: nextRules,
        ruleCount: nextRules.length
      };
    })
  };
}

function normalizeLaunchFeedRequest(request: LaunchFeedRequest = {}): LaunchFeedRequest {
  return {
    scope: request.scope ?? 'public',
    watchlistId: request.watchlistId ?? null,
    limit: request.limit ?? undefined,
    offset: request.offset ?? undefined,
    range: request.range ?? undefined,
    from: request.from ?? null,
    to: request.to ?? null,
    location: request.location ?? null,
    state: request.state ?? null,
    pad: request.pad ?? null,
    region: request.region ?? undefined,
    provider: request.provider ?? null,
    sort: request.sort ?? undefined,
    status: request.status ?? null
  };
}

function getLaunchFeedFetcher(request: LaunchFeedRequest) {
  const normalized = normalizeLaunchFeedRequest(request);
  return WEB_USE_LEGACY_FEED_ADAPTERS ? getLegacyLaunchFeed(normalized) : browserApiClient.getLaunchFeed(normalized);
}

function getChangedLaunchesFetcher(request: { hours?: number; region?: 'us' | 'non-us' | 'all' } = {}) {
  return WEB_USE_LEGACY_FEED_ADAPTERS ? getLegacyChangedLaunches(request) : browserApiClient.getChangedLaunches(request);
}

export function getLaunchFeedPageQueryOptions(
  request: LaunchFeedRequest,
  options?: {
    enabled?: boolean;
    initialData?: LaunchFeedV1;
  }
) {
  const normalized = normalizeLaunchFeedRequest(request);

  return {
    ...launchFeedQueryOptions(() => getLaunchFeedFetcher(normalized), normalized),
    enabled: options?.enabled ?? true,
    ...(options?.initialData ? { initialData: options.initialData } : {})
  };
}

export function getChangedLaunchesQueryOptions(
  request: { hours?: number; region?: 'us' | 'non-us' | 'all' } = {},
  options?: { enabled?: boolean }
) {
  return {
    ...changedLaunchesQueryOptions(() => getChangedLaunchesFetcher(request), request),
    enabled: options?.enabled ?? true
  };
}

export function invalidateLaunchFeedQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: sharedQueryKeys.launchFeed });
  void queryClient.invalidateQueries({ queryKey: sharedQueryKeys.changedLaunches });
}

export function invalidateViewerScopedQueries(queryClient: QueryClient) {
  for (const queryKey of viewerScopedQueryKeys) {
    void queryClient.invalidateQueries({ queryKey });
  }
  void queryClient.invalidateQueries({ queryKey: ['launch-notification-preference'] });
}

export function applyGuestViewerState(queryClient: QueryClient) {
  queryClient.setQueryData(sharedQueryKeys.viewerSession, guestViewerSession);
  queryClient.setQueryData(sharedQueryKeys.entitlements, guestViewerEntitlements);
  queryClient.removeQueries({ queryKey: sharedQueryKeys.profile });
  queryClient.removeQueries({ queryKey: sharedQueryKeys.privacyPreferences });
  queryClient.removeQueries({ queryKey: sharedQueryKeys.accountExport });
  queryClient.removeQueries({ queryKey: sharedQueryKeys.billingSummary });
  queryClient.removeQueries({ queryKey: sharedQueryKeys.marketingEmail });
  queryClient.removeQueries({ queryKey: sharedQueryKeys.watchlists });
  queryClient.removeQueries({ queryKey: sharedQueryKeys.filterPresets });
  queryClient.removeQueries({ queryKey: sharedQueryKeys.alertRules });
  queryClient.removeQueries({ queryKey: sharedQueryKeys.calendarFeeds });
  queryClient.removeQueries({ queryKey: sharedQueryKeys.rssFeeds });
  queryClient.removeQueries({ queryKey: sharedQueryKeys.embedWidgets });
  queryClient.removeQueries({ queryKey: sharedQueryKeys.notificationPreferences });
  queryClient.removeQueries({ queryKey: ['launch-notification-preference'] });
}

export function useViewerSessionQuery() {
  return useQuery(viewerSessionQueryOptions(() => browserApiClient.getViewerSession()));
}

export function useViewerEntitlementsQuery() {
  return useQuery(viewerEntitlementsQueryOptions(() => browserApiClient.getViewerEntitlements()));
}

export function useBillingSummaryQuery() {
  const viewerSessionQuery = useViewerSessionQuery();
  const viewerId = viewerSessionQuery.data?.viewerId ?? null;

  return useQuery({
    ...billingSummaryQueryOptions(() => browserApiClient.getBillingSummary(), viewerId),
    enabled: Boolean(viewerId)
  });
}

export function useBillingCatalogQuery(platform: BillingPlatformV1, options?: { enabled?: boolean }) {
  const viewerSessionQuery = useViewerSessionQuery();

  return useQuery({
    ...billingCatalogQueryOptions(() => browserApiClient.getBillingCatalog(platform), { platform }),
    enabled: (options?.enabled ?? true) && Boolean(viewerSessionQuery.data?.viewerId)
  });
}

export function useLaunchFeedPageQuery(
  request: LaunchFeedRequest,
  options?: {
    enabled?: boolean;
    initialData?: LaunchFeedV1;
  }
) {
  return useQuery(getLaunchFeedPageQueryOptions(request, options));
}

export function useChangedLaunchesQuery(
  request: { hours?: number; region?: 'us' | 'non-us' | 'all' } = {},
  options?: { enabled?: boolean }
) {
  return useQuery(getChangedLaunchesQueryOptions(request, options));
}

export function useProfileQuery() {
  const viewerSessionQuery = useViewerSessionQuery();

  return useQuery({
    ...profileQueryOptions(() => getSharedProfile()),
    enabled: Boolean(viewerSessionQuery.data?.viewerId)
  });
}

export function usePrivacyPreferencesQuery() {
  const viewerSessionQuery = useViewerSessionQuery();

  return useQuery({
    ...privacyPreferencesQueryOptions(() => getSharedPrivacyPreferences()),
    enabled: Boolean(viewerSessionQuery.data?.viewerId)
  });
}

export function useMarketingEmailQuery() {
  const viewerSessionQuery = useViewerSessionQuery();

  return useQuery({
    ...marketingEmailQueryOptions(() => browserApiClient.getMarketingEmail()),
    enabled: Boolean(viewerSessionQuery.data?.viewerId)
  });
}

export function useWatchlistsQuery() {
  const viewerSessionQuery = useViewerSessionQuery();

  return useQuery({
    ...watchlistsQueryOptions(() => browserApiClient.getWatchlists()),
    enabled: Boolean(viewerSessionQuery.data?.viewerId)
  });
}

export function useFilterPresetsQuery() {
  const viewerSessionQuery = useViewerSessionQuery();

  return useQuery({
    ...filterPresetsQueryOptions(() => browserApiClient.getFilterPresets()),
    enabled: Boolean(viewerSessionQuery.data?.viewerId)
  });
}

export function useAlertRulesQuery() {
  const viewerSessionQuery = useViewerSessionQuery();

  return useQuery({
    ...alertRulesQueryOptions(() => browserApiClient.getAlertRules()),
    enabled: Boolean(viewerSessionQuery.data?.viewerId)
  });
}

export function useCalendarFeedsQuery(options?: { enabled?: boolean }) {
  const viewerSessionQuery = useViewerSessionQuery();

  return useQuery({
    ...calendarFeedsQueryOptions(() => browserApiClient.getCalendarFeeds()),
    enabled: Boolean(viewerSessionQuery.data?.viewerId) && (options?.enabled ?? true)
  });
}

export function useRssFeedsQuery(options?: { enabled?: boolean }) {
  const viewerSessionQuery = useViewerSessionQuery();

  return useQuery({
    ...rssFeedsQueryOptions(() => browserApiClient.getRssFeeds()),
    enabled: Boolean(viewerSessionQuery.data?.viewerId) && (options?.enabled ?? true)
  });
}

export function useEmbedWidgetsQuery(options?: { enabled?: boolean }) {
  const viewerSessionQuery = useViewerSessionQuery();

  return useQuery({
    ...embedWidgetsQueryOptions(() => browserApiClient.getEmbedWidgets()),
    enabled: Boolean(viewerSessionQuery.data?.viewerId) && (options?.enabled ?? true)
  });
}

export function useNotificationPreferencesQuery() {
  const viewerSessionQuery = useViewerSessionQuery();

  return useQuery({
    ...notificationPreferencesQueryOptions(() => browserApiClient.getNotificationPreferences()),
    enabled: Boolean(viewerSessionQuery.data?.viewerId)
  });
}

export function useLaunchDayEmailFilterOptionsQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: webOnlyQueryKeys.launchDayEmailFilterOptions,
    queryFn: getLaunchDayEmailFilterOptions,
    staleTime: 5 * 60_000,
    enabled: options?.enabled ?? true
  });
}

export function useWebPushDeviceStatusQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: webOnlyQueryKeys.webPushDeviceStatus,
    queryFn: getWebPushDeviceStatus,
    staleTime: 15_000,
    enabled: options?.enabled ?? true
  });
}

export function useArEligibleLaunchIdsQuery(options?: { enabled?: boolean; initialData?: string[] }) {
  return useQuery({
    queryKey: webOnlyQueryKeys.arEligibleLaunchIds,
    queryFn: getArEligibleLaunchIds,
    staleTime: 5 * 60_000,
    enabled: options?.enabled ?? true,
    ...(options?.initialData ? { initialData: options.initialData } : {})
  });
}

export function useFeedFilterOptionsQuery(
  request: {
    mode: 'public' | 'live';
    range: 'today' | '7d' | 'month' | 'year' | 'past' | 'all';
    region: 'us' | 'non-us' | 'all';
    location?: string | null;
    state?: string | null;
    pad?: string | null;
    provider?: string | null;
    status?: 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown' | null;
  },
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: webOnlyQueryKeys.feedFilterOptions(request),
    queryFn: () => getFeedFilterOptions(request),
    staleTime: 5 * 60_000,
    enabled: options?.enabled ?? true
  });
}

export async function fetchLiveLaunchVersion(
  queryClient: QueryClient,
  request: {
    range: 'today' | '7d' | 'month' | 'year' | 'past' | 'all';
    region: 'us' | 'non-us' | 'all';
    location?: string | null;
    state?: string | null;
    pad?: string | null;
    provider?: string | null;
    status?: 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown' | null;
  }
) {
  return queryClient.fetchQuery({
    queryKey: webOnlyQueryKeys.liveLaunchVersion(request),
    queryFn: () => getLiveLaunchFeedVersion(request),
    staleTime: 0
  });
}

export async function fetchAccountExport(queryClient: QueryClient) {
  const payload = await queryClient.fetchQuery(accountExportQueryOptions(() => getSharedAccountExport()));
  queryClient.removeQueries({ queryKey: sharedQueryKeys.accountExport });
  return payload as AccountExportV1;
}

export function useSiteSearchQuery(query: string, options?: { limit?: number; types?: string[] }) {
  const normalized = normalizeSearchQuery(query);
  const limit = options?.limit ?? 8;
  const types = options?.types;

  return useQuery({
    ...searchQueryOptions(normalized, () => browserApiClient.search(normalized, { limit, types }), { limit, types }),
    enabled: normalized.length >= 2
  });
}

export function useInfiniteSiteSearchQuery(query: string, options?: { limit?: number; types?: string[] }) {
  const normalized = normalizeSearchQuery(query);
  const limit = options?.limit ?? 20;
  const types = options?.types;

  return useInfiniteQuery({
    queryKey: sharedQueryKeys.search(normalized, { limit, types }),
    queryFn: ({ pageParam }) =>
      browserApiClient.search(normalized, {
        limit,
        offset: typeof pageParam === 'number' ? pageParam : 0,
        types
      }),
    enabled: normalized.length >= 2,
    initialPageParam: 0,
    staleTime: sharedQueryStaleTimes.search,
    getNextPageParam: (lastPage: SearchResponseV1) =>
      lastPage.hasMore ? lastPage.offset + lastPage.results.length : undefined
  });
}

export function useLaunchNotificationPreferenceQuery(
  launchId: string | null,
  channel: 'sms' | 'push',
  options?: { enabled?: boolean }
) {
  const viewerSessionQuery = useViewerSessionQuery();

  return useQuery({
    ...launchNotificationPreferenceQueryOptions(launchId || 'missing', channel, () =>
      browserApiClient.getLaunchNotificationPreference(String(launchId), channel)
    ),
    enabled: (options?.enabled ?? true) && Boolean(viewerSessionQuery.data?.viewerId) && Boolean(launchId)
  });
}

export function useCreateWatchlistMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: WatchlistCreateV1) => browserApiClient.createWatchlist(payload),
    onSuccess: (payload) => {
      queryClient.setQueryData<WatchlistsV1>(sharedQueryKeys.watchlists, (current) => mergeWatchlistEnvelope(current, payload));
    }
  });
}

export function useUpdateWatchlistMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ watchlistId, payload }: { watchlistId: string; payload: WatchlistUpdateV1 }) =>
      browserApiClient.updateWatchlist(watchlistId, payload),
    onSuccess: (payload) => {
      queryClient.setQueryData<WatchlistsV1>(sharedQueryKeys.watchlists, (current) => mergeWatchlistEnvelope(current, payload));
    }
  });
}

export function useDeleteWatchlistMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (watchlistId: string) => browserApiClient.deleteWatchlist(watchlistId),
    onSuccess: (_payload, watchlistId) => {
      queryClient.setQueryData<WatchlistsV1>(sharedQueryKeys.watchlists, (current) => removeWatchlist(current, watchlistId));
    }
  });
}

export function useCreateWatchlistRuleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ watchlistId, payload }: { watchlistId: string; payload: WatchlistRuleCreateV1 }) =>
      browserApiClient.createWatchlistRule(watchlistId, payload),
    onSuccess: (payload, variables) => {
      queryClient.setQueryData<WatchlistsV1>(sharedQueryKeys.watchlists, (current) =>
        mergeWatchlistRuleEnvelope(current, variables.watchlistId, payload)
      );
    }
  });
}

export function useDeleteWatchlistRuleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ watchlistId, ruleId }: { watchlistId: string; ruleId: string }) =>
      browserApiClient.deleteWatchlistRule(watchlistId, ruleId),
    onSuccess: (_payload, variables) => {
      queryClient.setQueryData<WatchlistsV1>(sharedQueryKeys.watchlists, (current) =>
        removeWatchlistRule(current, variables.watchlistId, variables.ruleId)
      );
    }
  });
}

export function useCreateFilterPresetMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: FilterPresetCreateV1) => browserApiClient.createFilterPreset(payload),
    onSuccess: (payload) => {
      queryClient.setQueryData<FilterPresetsV1>(sharedQueryKeys.filterPresets, (current) => mergePresetEnvelope(current, payload));
    }
  });
}

export function useUpdateFilterPresetMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ presetId, payload }: { presetId: string; payload: FilterPresetUpdateV1 }) =>
      browserApiClient.updateFilterPreset(presetId, payload),
    onSuccess: (payload) => {
      queryClient.setQueryData<FilterPresetsV1>(sharedQueryKeys.filterPresets, (current) => mergePresetEnvelope(current, payload));
    }
  });
}

export function useDeleteFilterPresetMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (presetId: string) => browserApiClient.deleteFilterPreset(presetId),
    onSuccess: (_payload, presetId) => {
      queryClient.setQueryData<FilterPresetsV1>(sharedQueryKeys.filterPresets, (current) => ({
        presets: (current?.presets ?? []).filter((preset) => preset.id !== presetId)
      }));
    }
  });
}

export function useCreateAlertRuleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: AlertRuleCreateV1) => browserApiClient.createAlertRule(payload),
    onSuccess: (payload) => {
      queryClient.setQueryData<AlertRulesV1>(sharedQueryKeys.alertRules, (current) => mergeAlertRuleEnvelope(current, payload));
    }
  });
}

export function useDeleteAlertRuleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ruleId: string) => browserApiClient.deleteAlertRule(ruleId),
    onSuccess: (_payload, ruleId) => {
      queryClient.setQueryData<AlertRulesV1>(sharedQueryKeys.alertRules, (current) => removeAlertRule(current, ruleId));
    }
  });
}

export function useCreateCalendarFeedMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CalendarFeedCreateV1) => browserApiClient.createCalendarFeed(payload),
    onSuccess: (payload) => {
      queryClient.setQueryData<CalendarFeedsV1>(sharedQueryKeys.calendarFeeds, (current) => mergeCalendarFeedEnvelope(current, payload));
    }
  });
}

export function useUpdateCalendarFeedMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ feedId, payload }: { feedId: string; payload: CalendarFeedUpdateV1 }) =>
      browserApiClient.updateCalendarFeed(feedId, payload),
    onSuccess: (payload) => {
      queryClient.setQueryData<CalendarFeedsV1>(sharedQueryKeys.calendarFeeds, (current) => mergeCalendarFeedEnvelope(current, payload));
    }
  });
}

export function useDeleteCalendarFeedMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (feedId: string) => browserApiClient.deleteCalendarFeed(feedId),
    onSuccess: (_payload, feedId) => {
      queryClient.setQueryData<CalendarFeedsV1>(sharedQueryKeys.calendarFeeds, (current) => removeCalendarFeed(current, feedId));
    }
  });
}

export function useRotateCalendarFeedMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (feedId: string) => browserApiClient.rotateCalendarFeed(feedId),
    onSuccess: (payload) => {
      queryClient.setQueryData<CalendarFeedsV1>(sharedQueryKeys.calendarFeeds, (current) => mergeCalendarFeedEnvelope(current, payload));
    }
  });
}

export function useCreateRssFeedMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: RssFeedCreateV1) => browserApiClient.createRssFeed(payload),
    onSuccess: (payload) => {
      queryClient.setQueryData<RssFeedsV1>(sharedQueryKeys.rssFeeds, (current) => mergeRssFeedEnvelope(current, payload));
    }
  });
}

export function useUpdateRssFeedMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ feedId, payload }: { feedId: string; payload: RssFeedUpdateV1 }) =>
      browserApiClient.updateRssFeed(feedId, payload),
    onSuccess: (payload) => {
      queryClient.setQueryData<RssFeedsV1>(sharedQueryKeys.rssFeeds, (current) => mergeRssFeedEnvelope(current, payload));
    }
  });
}

export function useDeleteRssFeedMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (feedId: string) => browserApiClient.deleteRssFeed(feedId),
    onSuccess: (_payload, feedId) => {
      queryClient.setQueryData<RssFeedsV1>(sharedQueryKeys.rssFeeds, (current) => removeRssFeed(current, feedId));
    }
  });
}

export function useRotateRssFeedMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (feedId: string) => browserApiClient.rotateRssFeed(feedId),
    onSuccess: (payload) => {
      queryClient.setQueryData<RssFeedsV1>(sharedQueryKeys.rssFeeds, (current) => mergeRssFeedEnvelope(current, payload));
    }
  });
}

export function useCreateEmbedWidgetMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: EmbedWidgetCreateV1) => browserApiClient.createEmbedWidget(payload),
    onSuccess: (payload) => {
      queryClient.setQueryData<EmbedWidgetsV1>(sharedQueryKeys.embedWidgets, (current) => mergeEmbedWidgetEnvelope(current, payload));
    }
  });
}

export function useUpdateEmbedWidgetMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ widgetId, payload }: { widgetId: string; payload: EmbedWidgetUpdateV1 }) =>
      browserApiClient.updateEmbedWidget(widgetId, payload),
    onSuccess: (payload) => {
      queryClient.setQueryData<EmbedWidgetsV1>(sharedQueryKeys.embedWidgets, (current) => mergeEmbedWidgetEnvelope(current, payload));
    }
  });
}

export function useDeleteEmbedWidgetMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (widgetId: string) => browserApiClient.deleteEmbedWidget(widgetId),
    onSuccess: (_payload, widgetId) => {
      queryClient.setQueryData<EmbedWidgetsV1>(sharedQueryKeys.embedWidgets, (current) => removeEmbedWidget(current, widgetId));
    }
  });
}

export function useRotateEmbedWidgetMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (widgetId: string) => browserApiClient.rotateEmbedWidget(widgetId),
    onSuccess: (payload) => {
      queryClient.setQueryData<EmbedWidgetsV1>(sharedQueryKeys.embedWidgets, (current) => mergeEmbedWidgetEnvelope(current, payload));
    }
  });
}

export function useUpdateLaunchNotificationPreferenceMutation(launchId: string, channel: 'sms' | 'push') {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: LaunchNotificationPreferenceUpdateV1) =>
      browserApiClient.updateLaunchNotificationPreference(launchId, payload),
    onSuccess: (payload: LaunchNotificationPreferenceEnvelopeV1) => {
      queryClient.setQueryData(sharedQueryKeys.launchNotificationPreference(launchId, channel), payload);
    }
  });
}

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ProfileUpdateV1) => updateSharedProfile(payload),
    onSuccess: (payload) => {
      queryClient.setQueryData(sharedQueryKeys.profile, payload);
    }
  });
}

export function useUpdatePrivacyPreferencesMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: PrivacyPreferencesUpdateV1) => updateSharedPrivacyPreferences(payload),
    onSuccess: (payload: PrivacyPreferencesV1) => {
      queryClient.setQueryData(sharedQueryKeys.privacyPreferences, payload);
    }
  });
}

export function useUpdateNotificationPreferencesMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: NotificationPreferencesUpdateV1) => browserApiClient.updateNotificationPreferences(payload),
    onSuccess: (payload) => {
      queryClient.setQueryData<NotificationPreferencesV1>(sharedQueryKeys.notificationPreferences, payload);
      void queryClient.invalidateQueries({ queryKey: ['launch-notification-preference'] });
    }
  });
}

export function useUpdateMarketingEmailMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (marketingEmailOptIn: boolean) => browserApiClient.updateMarketingEmail({ marketingEmailOptIn }),
    onSuccess: (payload: MarketingEmailV1) => {
      queryClient.setQueryData(sharedQueryKeys.marketingEmail, payload);
    }
  });
}

export function useDeleteAccountMutation() {
  return useMutation({
    mutationFn: (confirm: string) => browserApiClient.deleteAccount(confirm)
  });
}

export function useStartBillingCheckoutMutation() {
  return useMutation({
    mutationFn: (returnTo: string) => startBillingCheckout(returnTo)
  });
}

export function useOpenBillingPortalMutation() {
  return useMutation({
    mutationFn: () => openBillingPortal()
  });
}

export function useStartBillingSetupIntentMutation() {
  return useMutation({
    mutationFn: () => startBillingSetupIntent()
  });
}

export function useUpdateDefaultPaymentMethodMutation() {
  return useMutation({
    mutationFn: (paymentMethod: string) => updateDefaultPaymentMethod(paymentMethod)
  });
}

export function useCancelBillingSubscriptionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => cancelBillingSubscription(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sharedQueryKeys.billingSummary });
      void queryClient.invalidateQueries({ queryKey: sharedQueryKeys.entitlements });
    }
  });
}

export function useResumeBillingSubscriptionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => resumeBillingSubscription(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sharedQueryKeys.billingSummary });
      void queryClient.invalidateQueries({ queryKey: sharedQueryKeys.entitlements });
    }
  });
}

export function useStartSmsVerificationMutation() {
  return useMutation({
    mutationFn: ({ phone, smsConsent }: { phone: string; smsConsent: boolean }) =>
      browserApiClient.startSmsVerification({ phone, smsConsent })
  });
}

export function useCompleteSmsVerificationMutation() {
  return useMutation({
    mutationFn: ({ phone, code }: { phone: string; code: string }) => browserApiClient.completeSmsVerification({ phone, code })
  });
}

export function useSubscribeWebPushDeviceMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: subscribeWebPushDevice,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: webOnlyQueryKeys.webPushDeviceStatus });
    }
  });
}

export function useUnsubscribeWebPushDeviceMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: unsubscribeWebPushDevice,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: webOnlyQueryKeys.webPushDeviceStatus });
    }
  });
}

export function useSendWebPushTestMutation() {
  return useMutation({
    mutationFn: () => sendWebPushTest()
  });
}
