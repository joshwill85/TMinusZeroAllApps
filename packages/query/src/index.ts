import { QueryClient, queryOptions } from '@tanstack/react-query';

export type SearchQueryKeyOptions = {
  limit?: number | null;
  types?: readonly string[] | null;
};

export type LaunchFeedQueryKeyOptions = {
  scope?: 'public' | 'live' | 'watchlist' | null;
  watchlistId?: string | null;
  limit?: number | null;
  offset?: number | null;
  range?: 'today' | '7d' | 'month' | 'year' | 'past' | 'all' | null;
  from?: string | null;
  to?: string | null;
  location?: string | null;
  state?: string | null;
  pad?: string | null;
  region?: 'us' | 'non-us' | 'all' | null;
  provider?: string | null;
  sort?: 'soonest' | 'latest' | 'changed' | null;
  status?: 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown' | null;
};

export type LaunchFilterOptionsQueryKeyOptions = {
  mode?: 'public' | 'live' | null;
  range?: 'today' | '7d' | 'month' | 'year' | 'past' | 'all' | null;
  from?: string | null;
  to?: string | null;
  location?: string | null;
  state?: string | null;
  pad?: string | null;
  region?: 'us' | 'non-us' | 'all' | null;
  provider?: string | null;
  status?: 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown' | null;
};

export type ChangedLaunchesQueryKeyOptions = {
  hours?: number | null;
  region?: 'us' | 'non-us' | 'all' | null;
};

export type BillingCatalogQueryKeyOptions = {
  platform: 'web' | 'ios' | 'android';
};

function normalizeSearchTypes(types: readonly string[] | null | undefined) {
  return [...new Set((types ?? []).map((value) => String(value).trim()).filter(Boolean))].sort();
}

function normalizeToken(value: string | null | undefined) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeLaunchFeedQueryOptions(options: LaunchFeedQueryKeyOptions = {}) {
  return {
    scope: options.scope ?? 'public',
    watchlistId: normalizeToken(options.watchlistId),
    limit: options.limit ?? null,
    offset: options.offset ?? null,
    range: options.range ?? null,
    from: normalizeToken(options.from),
    to: normalizeToken(options.to),
    location: normalizeToken(options.location),
    state: normalizeToken(options.state),
    pad: normalizeToken(options.pad),
    region: options.region ?? null,
    provider: normalizeToken(options.provider),
    sort: options.sort ?? null,
    status: options.status ?? null
  };
}

function normalizeLaunchFilterOptionsQueryOptions(options: LaunchFilterOptionsQueryKeyOptions = {}) {
  return {
    mode: options.mode ?? 'public',
    range: options.range ?? null,
    from: normalizeToken(options.from),
    to: normalizeToken(options.to),
    location: normalizeToken(options.location),
    state: normalizeToken(options.state),
    pad: normalizeToken(options.pad),
    region: options.region ?? null,
    provider: normalizeToken(options.provider),
    status: options.status ?? null
  };
}

function normalizeChangedLaunchesQueryOptions(options: ChangedLaunchesQueryKeyOptions = {}) {
  return {
    hours: options.hours ?? 24,
    region: options.region ?? null
  };
}

export const sharedQueryKeys = {
  viewerSession: ['viewer-session'] as const,
  entitlements: ['viewer-entitlements'] as const,
  launchFeed: ['launch-feed'] as const,
  launchFeedVariant: (options: LaunchFeedQueryKeyOptions = {}) => {
    const normalized = normalizeLaunchFeedQueryOptions(options);
    return [
      'launch-feed',
      normalized.scope,
      normalized.watchlistId,
      normalized.limit,
      normalized.offset,
      normalized.range,
      normalized.from,
      normalized.to,
      normalized.location,
      normalized.state,
      normalized.pad,
      normalized.region,
      normalized.provider,
      normalized.sort,
      normalized.status
    ] as const;
  },
  launchFilterOptions: ['launch-filter-options'] as const,
  launchFilterOptionsVariant: (options: LaunchFilterOptionsQueryKeyOptions = {}) => {
    const normalized = normalizeLaunchFilterOptionsQueryOptions(options);
    return [
      'launch-filter-options',
      normalized.mode,
      normalized.range,
      normalized.from,
      normalized.to,
      normalized.location,
      normalized.state,
      normalized.pad,
      normalized.region,
      normalized.provider,
      normalized.status
    ] as const;
  },
  changedLaunches: ['launches-changed'] as const,
  changedLaunchesVariant: (options: ChangedLaunchesQueryKeyOptions = {}) => {
    const normalized = normalizeChangedLaunchesQueryOptions(options);
    return ['launches-changed', normalized.hours, normalized.region] as const;
  },
  launchDetail: (id: string) => ['launch-detail', id] as const,
  launchTrajectory: (id: string) => ['launch-trajectory', id] as const,
  search: (query: string, options: SearchQueryKeyOptions = {}) =>
    ['search', normalizeSearchQuery(query), options.limit ?? null, normalizeSearchTypes(options.types).join(',')] as const,
  profile: ['profile'] as const,
  privacyPreferences: ['privacy-preferences'] as const,
  accountExport: ['account-export'] as const,
  billingSummary: ['billing-summary'] as const,
  billingSummaryVariant: (viewerId: string | null | undefined) => ['billing-summary', normalizeToken(viewerId)] as const,
  billingCatalog: (options: BillingCatalogQueryKeyOptions) => ['billing-catalog', options.platform] as const,
  marketingEmail: ['marketing-email'] as const,
  watchlists: ['watchlists'] as const,
  filterPresets: ['filter-presets'] as const,
  alertRules: ['alert-rules'] as const,
  calendarFeeds: ['calendar-feeds'] as const,
  rssFeeds: ['rss-feeds'] as const,
  embedWidgets: ['embed-widgets'] as const,
  notificationPreferences: ['notification-preferences'] as const,
  launchNotificationPreference: (launchId: string, channel: 'sms' | 'push' = 'push') =>
    ['launch-notification-preference', launchId, channel] as const,
  pushDevice: (installationId: string) => ['push-device', installationId] as const
};

export const sharedQueryStaleTimes = {
  viewerSession: 60_000,
  entitlements: 60_000,
  launchFeed: 30_000,
  launchFilterOptions: 300_000,
  changedLaunches: 15_000,
  launchDetail: 30_000,
  launchTrajectory: 30_000,
  search: 15_000,
  profile: 60_000,
  privacyPreferences: 30_000,
  accountExport: 0,
  billingSummary: 30_000,
  billingCatalog: 300_000,
  marketingEmail: 60_000,
  watchlists: 60_000,
  filterPresets: 60_000,
  alertRules: 60_000,
  calendarFeeds: 60_000,
  rssFeeds: 60_000,
  embedWidgets: 60_000,
  notificationPreferences: 30_000,
  launchNotificationPreference: 30_000,
  pushDevice: 60_000
} as const;

type QueryLoader<T> = () => Promise<T>;

export function normalizeSearchQuery(query: string) {
  return query.trim();
}

export function viewerSessionQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.viewerSession,
    queryFn,
    staleTime: sharedQueryStaleTimes.viewerSession
  });
}

export function viewerEntitlementsQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.entitlements,
    queryFn,
    staleTime: sharedQueryStaleTimes.entitlements
  });
}

export function launchFeedQueryOptions<T>(queryFn: QueryLoader<T>, options: LaunchFeedQueryKeyOptions = {}) {
  return queryOptions({
    queryKey: sharedQueryKeys.launchFeedVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.launchFeed
  });
}

export function launchFilterOptionsQueryOptions<T>(
  queryFn: QueryLoader<T>,
  options: LaunchFilterOptionsQueryKeyOptions = {}
) {
  return queryOptions({
    queryKey: sharedQueryKeys.launchFilterOptionsVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.launchFilterOptions
  });
}

export function changedLaunchesQueryOptions<T>(queryFn: QueryLoader<T>, options: ChangedLaunchesQueryKeyOptions = {}) {
  return queryOptions({
    queryKey: sharedQueryKeys.changedLaunchesVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.changedLaunches
  });
}

export function launchDetailQueryOptions<T>(launchId: string, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.launchDetail(launchId),
    queryFn,
    staleTime: sharedQueryStaleTimes.launchDetail
  });
}

export function launchTrajectoryQueryOptions<T>(launchId: string, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.launchTrajectory(launchId),
    queryFn,
    staleTime: sharedQueryStaleTimes.launchTrajectory
  });
}

export function searchQueryOptions<T>(query: string, queryFn: QueryLoader<T>, options: SearchQueryKeyOptions = {}) {
  const normalized = normalizeSearchQuery(query);

  return queryOptions({
    queryKey: sharedQueryKeys.search(normalized, options),
    queryFn,
    staleTime: sharedQueryStaleTimes.search
  });
}

export function profileQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.profile,
    queryFn,
    staleTime: sharedQueryStaleTimes.profile
  });
}

export function privacyPreferencesQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.privacyPreferences,
    queryFn,
    staleTime: sharedQueryStaleTimes.privacyPreferences
  });
}

export function accountExportQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.accountExport,
    queryFn,
    staleTime: sharedQueryStaleTimes.accountExport
  });
}

export function billingSummaryQueryOptions<T>(queryFn: QueryLoader<T>, viewerId?: string | null) {
  return queryOptions({
    queryKey: sharedQueryKeys.billingSummaryVariant(viewerId),
    queryFn,
    staleTime: sharedQueryStaleTimes.billingSummary
  });
}

export function billingCatalogQueryOptions<T>(queryFn: QueryLoader<T>, options: BillingCatalogQueryKeyOptions) {
  return queryOptions({
    queryKey: sharedQueryKeys.billingCatalog(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.billingCatalog
  });
}

export function marketingEmailQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.marketingEmail,
    queryFn,
    staleTime: sharedQueryStaleTimes.marketingEmail
  });
}

export function watchlistsQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.watchlists,
    queryFn,
    staleTime: sharedQueryStaleTimes.watchlists
  });
}

export function filterPresetsQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.filterPresets,
    queryFn,
    staleTime: sharedQueryStaleTimes.filterPresets
  });
}

export function alertRulesQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.alertRules,
    queryFn,
    staleTime: sharedQueryStaleTimes.alertRules
  });
}

export function calendarFeedsQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.calendarFeeds,
    queryFn,
    staleTime: sharedQueryStaleTimes.calendarFeeds
  });
}

export function rssFeedsQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.rssFeeds,
    queryFn,
    staleTime: sharedQueryStaleTimes.rssFeeds
  });
}

export function embedWidgetsQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.embedWidgets,
    queryFn,
    staleTime: sharedQueryStaleTimes.embedWidgets
  });
}

export function notificationPreferencesQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.notificationPreferences,
    queryFn,
    staleTime: sharedQueryStaleTimes.notificationPreferences
  });
}

export function launchNotificationPreferenceQueryOptions<T>(
  launchId: string,
  channel: 'sms' | 'push',
  queryFn: QueryLoader<T>
) {
  return queryOptions({
    queryKey: sharedQueryKeys.launchNotificationPreference(launchId, channel),
    queryFn,
    staleTime: sharedQueryStaleTimes.launchNotificationPreference
  });
}

export function createSharedQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnReconnect: true,
        refetchOnWindowFocus: false
      }
    }
  });
}
