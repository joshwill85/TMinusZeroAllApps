import type { QueryClient } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminAccessOverrideUpdateV1,
  AdminAccessOverrideV1,
  AlertRuleCreateV1,
  AlertRuleEnvelopeV1,
  AlertRulesV1,
  ArTelemetrySessionEventV1,
  ApiClient,
  ArtemisAwardeeIndexRequest,
  ArtemisContentRequest,
  ArtemisMissionKeyV1,
  BlueOriginMissionFilterRequest,
  BlueOriginMissionKeyV1,
  CalendarFeedCreateV1,
  CalendarFeedEnvelopeV1,
  CalendarFeedsV1,
  CalendarFeedUpdateV1,
  EmbedWidgetCreateV1,
  EmbedWidgetEnvelopeV1,
  EmbedWidgetsV1,
  EmbedWidgetUpdateV1,
  FilterPresetEnvelopeV1,
  FilterPresetCreateV1,
  FilterPresetsV1,
  FilterPresetUpdateV1,
  LaunchDetailVersionRequest,
  LaunchJepRequest,
  LaunchFeedRequest,
  LaunchFeedV1,
  LaunchFeedVersionRequest,
  LaunchFilterOptionsRequest,
  MobilePushGuestContextV1,
  MobilePushLaunchPreferenceEnvelopeV1,
  MobilePushRuleEnvelopeV1,
  MobilePushRulesEnvelopeV1,
  MobilePushRuleUpsertV1,
  MobilePushTestRequestV1,
  MarketingEmailUpdateV1,
  MarketingEmailV1,
  PrivacyPreferencesUpdateV1,
  PrivacyPreferencesV1,
  ProfileUpdateV1,
  ProfileV1,
  RssFeedCreateV1,
  RssFeedEnvelopeV1,
  RssFeedsV1,
  RssFeedUpdateV1,
  SpaceXMissionFilterRequest,
  SpaceXMissionKeyV1,
  WatchlistCreateV1,
  WatchlistEnvelopeV1,
  WatchlistRuleCreateV1,
  WatchlistRuleEnvelopeV1,
  WatchlistUpdateV1,
  WatchlistsV1
} from '@tminuszero/api-client';
import {
  adminAccessOverrideQueryOptions,
  alertRulesQueryOptions,
  billingCatalogQueryOptions,
  billingSummaryQueryOptions,
  calendarFeedsQueryOptions,
  blueOriginContractsQueryOptions,
  blueOriginEnginesQueryOptions,
  blueOriginFlightsQueryOptions,
  blueOriginMissionOverviewQueryOptions,
  blueOriginOverviewQueryOptions,
  blueOriginTravelersQueryOptions,
  blueOriginVehiclesQueryOptions,
  accountExportQueryOptions,
  artemisAwardeeDetailQueryOptions,
  artemisAwardeesQueryOptions,
  artemisContentQueryOptions,
  artemisContractDetailQueryOptions,
  artemisContractsQueryOptions,
  artemisMissionOverviewQueryOptions,
  artemisOverviewQueryOptions,
  embedWidgetsQueryOptions,
  filterPresetsQueryOptions,
  locationDetailQueryOptions,
  launchDetailVersionQueryOptions,
  launchJepQueryOptions,
  launchFeedQueryOptions,
  launchFeedVersionQueryOptions,
  launchFilterOptionsQueryOptions,
  launchDetailQueryOptions,
  launchFaaAirspaceMapQueryOptions,
  launchTrajectoryQueryOptions,
  marketingEmailQueryOptions,
  mobilePushLaunchPreferenceQueryOptions,
  mobilePushRulesQueryOptions,
  normalizeSearchQuery,
  notificationPreferencesQueryOptions,
  padDetailQueryOptions,
  privacyPreferencesQueryOptions,
  providerDetailQueryOptions,
  profileQueryOptions,
  rocketDetailQueryOptions,
  rssFeedsQueryOptions,
  searchQueryOptions,
  sharedQueryStaleTimes,
  sharedQueryKeys,
  spaceXContractsQueryOptions,
  spaceXEnginesQueryOptions,
  spaceXFlightsQueryOptions,
  spaceXMissionOverviewQueryOptions,
  spaceXOverviewQueryOptions,
  spaceXVehiclesQueryOptions,
  viewerEntitlementsQueryOptions,
  viewerSessionQueryOptions,
  watchlistsQueryOptions
} from '@tminuszero/query';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { useMobileApiClient } from '@/src/api/useMobileApiClient';
import { isMobileE2EEnabled } from '@/src/notifications/runtime';

export const mobileQueryKeys = sharedQueryKeys;
const DEFAULT_MOBILE_FEED_PAGE_SIZE = 8;
const E2E_MOBILE_FEED_PAGE_SIZE = 1;

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

function mergeWatchlistEnvelope(current: WatchlistsV1 | undefined, incoming: WatchlistEnvelopeV1): WatchlistsV1 {
  const currentWatchlists = current?.watchlists ?? [];
  const existingIndex = currentWatchlists.findIndex((watchlist) => watchlist.id === incoming.watchlist.id);

  if (existingIndex === -1) {
    return {
      watchlists: [incoming.watchlist, ...currentWatchlists]
    };
  }

  const nextWatchlists = [...currentWatchlists];
  nextWatchlists[existingIndex] = incoming.watchlist;
  return {
    watchlists: nextWatchlists
  };
}

function removePreset(current: FilterPresetsV1 | undefined, presetId: string): FilterPresetsV1 {
  return {
    presets: (current?.presets ?? []).filter((preset) => preset.id !== presetId)
  };
}

function removeWatchlist(current: WatchlistsV1 | undefined, watchlistId: string): WatchlistsV1 {
  return {
    watchlists: (current?.watchlists ?? []).filter((watchlist) => watchlist.id !== watchlistId)
  };
}

function mergeWatchlistRuleEnvelope(
  current: WatchlistsV1 | undefined,
  watchlistId: string,
  incoming: WatchlistRuleEnvelopeV1
): WatchlistsV1 | undefined {
  if (!current) {
    return current;
  }

  return {
    watchlists: current.watchlists.map((watchlist) => {
      if (watchlist.id !== watchlistId) {
        return watchlist;
      }

      const existingIndex = watchlist.rules.findIndex((rule) => rule.id === incoming.rule.id);
      if (existingIndex === -1) {
        const nextRules = [incoming.rule, ...watchlist.rules];
        return {
          ...watchlist,
          rules: nextRules,
          ruleCount: nextRules.length
        };
      }

      const nextRules = [...watchlist.rules];
      nextRules[existingIndex] = incoming.rule;
      return {
        ...watchlist,
        rules: nextRules,
        ruleCount: nextRules.length
      };
    })
  };
}

function removeWatchlistRule(current: WatchlistsV1 | undefined, watchlistId: string, ruleId: string): WatchlistsV1 | undefined {
  if (!current) {
    return current;
  }

  return {
    watchlists: current.watchlists.map((watchlist) => {
      if (watchlist.id !== watchlistId) {
        return watchlist;
      }

      const nextRules = watchlist.rules.filter((rule) => rule.id !== ruleId);
      return {
        ...watchlist,
        rules: nextRules,
        ruleCount: nextRules.length
      };
    })
  };
}

function mergeAlertRuleEnvelope(current: AlertRulesV1 | undefined, incoming: AlertRuleEnvelopeV1): AlertRulesV1 {
  const nextRules = (current?.rules ?? []).filter((rule) => rule.id !== incoming.rule.id);
  return {
    rules: [incoming.rule, ...nextRules]
  };
}

function mergeCalendarFeedEnvelope(
  current: CalendarFeedsV1 | undefined,
  incoming: CalendarFeedEnvelopeV1
): CalendarFeedsV1 {
  const nextFeeds = (current?.feeds ?? []).filter((feed) => feed.id !== incoming.feed.id);
  return {
    feeds: [incoming.feed, ...nextFeeds]
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
    feeds: [incoming.feed, ...nextFeeds]
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
    widgets: [incoming.widget, ...nextWidgets]
  };
}

function removeEmbedWidget(current: EmbedWidgetsV1 | undefined, widgetId: string): EmbedWidgetsV1 {
  return {
    widgets: (current?.widgets ?? []).filter((widget) => widget.id !== widgetId)
  };
}

function mergeMobilePushRuleEnvelope(
  current: MobilePushRulesEnvelopeV1 | undefined,
  incoming: MobilePushRuleEnvelopeV1
): MobilePushRulesEnvelopeV1 {
  const nextRules = (current?.rules ?? []).filter((rule) => rule.id !== incoming.rule.id);
  return {
    access: incoming.access,
    device: incoming.device,
    rules: [incoming.rule, ...nextRules]
  };
}

async function invalidateMobilePushLaunchPreferenceQueries(queryClient: QueryClient) {
  await queryClient.invalidateQueries({
    predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'mobile-push-launch-preference'
  });
}

export function prefetchLaunchDetail(queryClient: QueryClient, client: Pick<ApiClient, 'getLaunchDetail'>, launchId: string) {
  return queryClient.prefetchQuery(launchDetailQueryOptions(launchId, () => client.getLaunchDetail(launchId)));
}

function getMobileFeedPageSize() {
  return isMobileE2EEnabled() ? E2E_MOBILE_FEED_PAGE_SIZE : DEFAULT_MOBILE_FEED_PAGE_SIZE;
}

export function useViewerSessionQuery() {
  const client = useMobileApiClient();
  const { isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    ...viewerSessionQueryOptions(() => client.getViewerSession()),
    enabled: isAuthHydrated,
  });
}

export function useViewerEntitlementsQuery() {
  const client = useMobileApiClient();
  const { isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    ...viewerEntitlementsQueryOptions(() => client.getViewerEntitlements()),
    enabled: isAuthHydrated,
  });
}

export function useAdminAccessOverrideQuery(options?: { enabled?: boolean }) {
  const client = useMobileApiClient();
  const { isAuthHydrated } = useMobileBootstrap();
  const sessionQuery = useViewerSessionQuery();
  const isAdmin = sessionQuery.data?.role === 'admin';

  return useQuery({
    ...adminAccessOverrideQueryOptions(() => client.getAdminAccessOverride()),
    enabled: isAuthHydrated && (options?.enabled ?? true) && Boolean(sessionQuery.data?.viewerId) && isAdmin
  });
}

export function useBillingSummaryQuery() {
  const client = useMobileApiClient();
  const { accessToken, isAuthHydrated } = useMobileBootstrap();
  const sessionQuery = useViewerSessionQuery();
  const viewerId = sessionQuery.data?.viewerId ?? null;

  return useQuery({
    ...billingSummaryQueryOptions(() => client.getBillingSummary(), viewerId),
    enabled: isAuthHydrated && Boolean(accessToken) && Boolean(viewerId),
  });
}

export function useBillingCatalogQuery(platform: 'ios' | 'android', options?: { enabled?: boolean }) {
  const client = useMobileApiClient();
  const { isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    ...billingCatalogQueryOptions(() => client.getBillingCatalog(platform), { platform }),
    enabled: (options?.enabled ?? true) && isAuthHydrated,
  });
}

export function useBlueOriginOverviewQuery(options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...blueOriginOverviewQueryOptions(() => client.getBlueOriginOverview()),
    enabled: options?.enabled ?? true
  });
}

export function useBlueOriginMissionOverviewQuery(
  mission: Exclude<BlueOriginMissionKeyV1, 'blue-origin-program'> | null,
  options?: { enabled?: boolean }
) {
  const client = useMobileApiClient();

  return useQuery({
    ...blueOriginMissionOverviewQueryOptions(mission || 'missing', () => client.getBlueOriginMissionOverview(String(mission) as Exclude<BlueOriginMissionKeyV1, 'blue-origin-program'>)),
    enabled: (options?.enabled ?? true) && Boolean(mission)
  });
}

export function useBlueOriginFlightsQuery(request: BlueOriginMissionFilterRequest = {}, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...blueOriginFlightsQueryOptions(() => client.getBlueOriginFlights(request), request),
    enabled: options?.enabled ?? true
  });
}

export function useBlueOriginTravelersQuery(options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...blueOriginTravelersQueryOptions(() => client.getBlueOriginTravelers()),
    enabled: options?.enabled ?? true
  });
}

export function useBlueOriginVehiclesQuery(request: BlueOriginMissionFilterRequest = {}, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...blueOriginVehiclesQueryOptions(() => client.getBlueOriginVehicles(request), request),
    enabled: options?.enabled ?? true
  });
}

export function useBlueOriginEnginesQuery(request: BlueOriginMissionFilterRequest = {}, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...blueOriginEnginesQueryOptions(() => client.getBlueOriginEngines(request), request),
    enabled: options?.enabled ?? true
  });
}

export function useBlueOriginContractsQuery(request: BlueOriginMissionFilterRequest = {}, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...blueOriginContractsQueryOptions(() => client.getBlueOriginContracts(request), request),
    enabled: options?.enabled ?? true
  });
}

export function useSpaceXOverviewQuery(options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...spaceXOverviewQueryOptions(() => client.getSpaceXOverview()),
    enabled: options?.enabled ?? true
  });
}

export function useSpaceXMissionOverviewQuery(
  mission: Exclude<SpaceXMissionKeyV1, 'spacex-program'> | null,
  options?: { enabled?: boolean }
) {
  const client = useMobileApiClient();

  return useQuery({
    ...spaceXMissionOverviewQueryOptions(
      mission || 'missing',
      () => client.getSpaceXMissionOverview(String(mission) as Exclude<SpaceXMissionKeyV1, 'spacex-program'>)
    ),
    enabled: (options?.enabled ?? true) && Boolean(mission)
  });
}

export function useSpaceXFlightsQuery(request: SpaceXMissionFilterRequest = {}, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...spaceXFlightsQueryOptions(() => client.getSpaceXFlights(request), request),
    enabled: options?.enabled ?? true
  });
}

export function useSpaceXVehiclesQuery(request: SpaceXMissionFilterRequest = {}, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...spaceXVehiclesQueryOptions(() => client.getSpaceXVehicles(request), request),
    enabled: options?.enabled ?? true
  });
}

export function useSpaceXEnginesQuery(request: SpaceXMissionFilterRequest = {}, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...spaceXEnginesQueryOptions(() => client.getSpaceXEngines(request), request),
    enabled: options?.enabled ?? true
  });
}

export function useSpaceXContractsQuery(request: SpaceXMissionFilterRequest = {}, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...spaceXContractsQueryOptions(() => client.getSpaceXContracts(request), request),
    enabled: options?.enabled ?? true
  });
}

export function useArtemisOverviewQuery(options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...artemisOverviewQueryOptions(() => client.getArtemisOverview()),
    enabled: options?.enabled ?? true
  });
}

export function useArtemisMissionOverviewQuery(mission: ArtemisMissionKeyV1 | null, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...artemisMissionOverviewQueryOptions(mission || 'missing', () => client.getArtemisMissionOverview(String(mission) as ArtemisMissionKeyV1)),
    enabled: (options?.enabled ?? true) && Boolean(mission)
  });
}

export function useArtemisContractsQuery(options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...artemisContractsQueryOptions(() => client.getArtemisContracts()),
    enabled: options?.enabled ?? true
  });
}

export function useArtemisContractDetailQuery(piid: string | null, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...artemisContractDetailQueryOptions(piid || 'missing', () => client.getArtemisContractDetail(String(piid))),
    enabled: (options?.enabled ?? true) && Boolean(piid)
  });
}

export function useArtemisAwardeesQuery(
  request: ArtemisAwardeeIndexRequest = {},
  options?: { enabled?: boolean }
) {
  const client = useMobileApiClient();

  return useQuery({
    ...artemisAwardeesQueryOptions(() => client.getArtemisAwardees(request), request),
    enabled: options?.enabled ?? true
  });
}

export function useArtemisAwardeeDetailQuery(slug: string | null, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...artemisAwardeeDetailQueryOptions(slug || 'missing', () => client.getArtemisAwardeeDetail(String(slug))),
    enabled: (options?.enabled ?? true) && Boolean(slug)
  });
}

export function useArtemisContentQuery(request: ArtemisContentRequest = {}, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...artemisContentQueryOptions(() => client.getArtemisContent(request), request),
    enabled: options?.enabled ?? true
  });
}

export function useLaunchFeedQuery(options: LaunchFeedRequest = {}, queryOptions?: { staleTimeMs?: number }) {
  const client = useMobileApiClient();
  const limit = getMobileFeedPageSize();
  const scope = options.scope ?? 'public';

  return useInfiniteQuery({
    queryKey: sharedQueryKeys.launchFeedVariant({
      ...options,
      scope,
      limit,
      offset: null
    }),
    queryFn: ({ pageParam }) =>
      client.getLaunchFeed({
        ...options,
        scope,
        limit,
        offset: typeof pageParam === 'number' ? pageParam : 0
      }),
    initialPageParam: 0,
    staleTime: queryOptions?.staleTimeMs ?? sharedQueryStaleTimes.launchFeed,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore || !lastPage.nextCursor) {
        return undefined;
      }

      const parsedCursor = Number(lastPage.nextCursor);
      if (!Number.isInteger(parsedCursor) || parsedCursor < 0) {
        return undefined;
      }

      return parsedCursor;
    }
  });
}

export function useLaunchFeedPageQuery(
  request: LaunchFeedRequest,
  options?: {
    enabled?: boolean;
    initialData?: LaunchFeedV1;
    staleTimeMs?: number;
  }
) {
  const client = useMobileApiClient();

  return useQuery({
    ...launchFeedQueryOptions(() => client.getLaunchFeed(request), request),
    enabled: options?.enabled ?? true,
    ...(typeof options?.staleTimeMs === 'number' ? { staleTime: options.staleTimeMs } : {}),
    ...(options?.initialData ? { initialData: options.initialData } : {})
  });
}

export function useLaunchFilterOptionsQuery(request: LaunchFilterOptionsRequest, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...launchFilterOptionsQueryOptions(() => client.getLaunchFilterOptions(request), request),
    enabled: options?.enabled ?? true
  });
}

export function useLaunchDetailQuery(id: string | null) {
  const client = useMobileApiClient();

  return useQuery({
    ...launchDetailQueryOptions(id || 'missing', () => client.getLaunchDetail(String(id))),
    enabled: Boolean(id),
  });
}

export function useLaunchJepQuery(id: string | null, request: LaunchJepRequest = {}, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...launchJepQueryOptions(id || 'missing', () => client.getLaunchJep(String(id), request), request),
    enabled: Boolean(id) && (options?.enabled ?? true)
  });
}

export function useLaunchFaaAirspaceMapQuery(id: string | null, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...launchFaaAirspaceMapQueryOptions(id || 'missing', () => client.getLaunchFaaAirspaceMap(String(id))),
    enabled: Boolean(id) && (options?.enabled ?? true)
  });
}

export function useLaunchTrajectoryQuery(id: string | null, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...launchTrajectoryQueryOptions(id || 'missing', () => client.getLaunchTrajectory(String(id))),
    enabled: (options?.enabled ?? true) && Boolean(id)
  });
}

export function useProviderDetailQuery(slug: string | null, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...providerDetailQueryOptions(slug || 'missing', () => client.getProviderDetail(String(slug))),
    enabled: Boolean(slug) && (options?.enabled ?? true)
  });
}

export function useRocketDetailQuery(id: string | null, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...rocketDetailQueryOptions(id || 'missing', () => client.getRocketDetail(String(id))),
    enabled: Boolean(id) && (options?.enabled ?? true)
  });
}

export function useLocationDetailQuery(id: string | null, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...locationDetailQueryOptions(id || 'missing', () => client.getLocationDetail(String(id))),
    enabled: Boolean(id) && (options?.enabled ?? true)
  });
}

export function usePadDetailQuery(id: string | null, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...padDetailQueryOptions(id || 'missing', () => client.getPadDetail(String(id))),
    enabled: Boolean(id) && (options?.enabled ?? true)
  });
}

export function useSearchQuery(query: string) {
  const client = useMobileApiClient();
  const normalized = normalizeSearchQuery(query);

  return useQuery({
    ...searchQueryOptions(normalized, () => client.search(normalized)),
    enabled: normalized.length >= 2,
  });
}

export function useProfileQuery() {
  const client = useMobileApiClient();
  const { accessToken, isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    ...profileQueryOptions(() => client.getProfile()),
    enabled: isAuthHydrated && Boolean(accessToken),
  });
}

export function usePrivacyPreferencesQuery(options?: { enabled?: boolean }) {
  const client = useMobileApiClient();
  const { accessToken, isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    ...privacyPreferencesQueryOptions(() => client.getPrivacyPreferences()),
    enabled: isAuthHydrated && Boolean(accessToken) && (options?.enabled ?? true)
  });
}

export function useAccountExportQuery(options?: { enabled?: boolean }) {
  const client = useMobileApiClient();
  const { accessToken, isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    ...accountExportQueryOptions(() => client.getAccountExport()),
    enabled: isAuthHydrated && Boolean(accessToken) && (options?.enabled ?? true)
  });
}

export function useMarketingEmailQuery(options?: { enabled?: boolean }) {
  const client = useMobileApiClient();
  const { accessToken, isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    ...marketingEmailQueryOptions(() => client.getMarketingEmail()),
    enabled: isAuthHydrated && Boolean(accessToken) && (options?.enabled ?? true)
  });
}

export function useCalendarFeedsQuery(options?: { enabled?: boolean }) {
  const client = useMobileApiClient();
  const { accessToken, isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    ...calendarFeedsQueryOptions(() => client.getCalendarFeeds()),
    enabled: isAuthHydrated && Boolean(accessToken) && (options?.enabled ?? true)
  });
}

export function useRssFeedsQuery(options?: { enabled?: boolean }) {
  const client = useMobileApiClient();
  const { accessToken, isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    ...rssFeedsQueryOptions(() => client.getRssFeeds()),
    enabled: isAuthHydrated && Boolean(accessToken) && (options?.enabled ?? true)
  });
}

export function useEmbedWidgetsQuery(options?: { enabled?: boolean }) {
  const client = useMobileApiClient();
  const { accessToken, isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    ...embedWidgetsQueryOptions(() => client.getEmbedWidgets()),
    enabled: isAuthHydrated && Boolean(accessToken) && (options?.enabled ?? true)
  });
}

export function useWatchlistsQuery() {
  const client = useMobileApiClient();
  const { accessToken, isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    ...watchlistsQueryOptions(() => client.getWatchlists()),
    enabled: isAuthHydrated && Boolean(accessToken),
  });
}

export function useFilterPresetsQuery() {
  const client = useMobileApiClient();
  const { accessToken, isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    ...filterPresetsQueryOptions(() => client.getFilterPresets()),
    enabled: isAuthHydrated && Boolean(accessToken),
  });
}

export function useAlertRulesQuery() {
  const client = useMobileApiClient();
  const { accessToken, isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    ...alertRulesQueryOptions(() => client.getAlertRules()),
    enabled: isAuthHydrated && Boolean(accessToken),
  });
}

export function useCreateFilterPresetMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: FilterPresetCreateV1) => client.createFilterPreset(payload),
    onSuccess: async (payload) => {
      queryClient.setQueryData<FilterPresetsV1>(sharedQueryKeys.filterPresets, (current) => mergePresetEnvelope(current, payload));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.filterPresets }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.alertRules })
      ]);
    }
  });
}

export function useUpdateFilterPresetMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ presetId, payload }: { presetId: string; payload: FilterPresetUpdateV1 }) =>
      client.updateFilterPreset(presetId, payload),
    onSuccess: async (payload) => {
      queryClient.setQueryData<FilterPresetsV1>(sharedQueryKeys.filterPresets, (current) => mergePresetEnvelope(current, payload));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.filterPresets }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.alertRules })
      ]);
    }
  });
}

export function useDeleteFilterPresetMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (presetId: string) => client.deleteFilterPreset(presetId),
    onSuccess: async (_payload, presetId) => {
      queryClient.setQueryData<FilterPresetsV1>(sharedQueryKeys.filterPresets, (current) => removePreset(current, presetId));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.filterPresets }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.alertRules })
      ]);
    }
  });
}

export function useCreateWatchlistMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: WatchlistCreateV1) => client.createWatchlist(payload),
    onSuccess: async (payload) => {
      queryClient.setQueryData<WatchlistsV1>(sharedQueryKeys.watchlists, (current) => mergeWatchlistEnvelope(current, payload));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.watchlists }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.launchFeed })
      ]);
    }
  });
}

export function useUpdateWatchlistMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ watchlistId, payload }: { watchlistId: string; payload: WatchlistUpdateV1 }) =>
      client.updateWatchlist(watchlistId, payload),
    onSuccess: async (payload) => {
      queryClient.setQueryData<WatchlistsV1>(sharedQueryKeys.watchlists, (current) => mergeWatchlistEnvelope(current, payload));
      await queryClient.invalidateQueries({ queryKey: sharedQueryKeys.watchlists });
    }
  });
}

export function useDeleteWatchlistMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (watchlistId: string) => client.deleteWatchlist(watchlistId),
    onSuccess: async (_payload, watchlistId) => {
      queryClient.setQueryData<WatchlistsV1>(sharedQueryKeys.watchlists, (current) => removeWatchlist(current, watchlistId));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.watchlists }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.launchFeed })
      ]);
    }
  });
}

export function useCreateWatchlistRuleMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ watchlistId, payload }: { watchlistId: string; payload: WatchlistRuleCreateV1 }) =>
      client.createWatchlistRule(watchlistId, payload),
    onSuccess: async (payload, variables) => {
      queryClient.setQueryData<WatchlistsV1>(sharedQueryKeys.watchlists, (current) =>
        mergeWatchlistRuleEnvelope(current, variables.watchlistId, payload)
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.watchlists }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.launchFeed })
      ]);
    }
  });
}

export function useDeleteWatchlistRuleMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ watchlistId, ruleId }: { watchlistId: string; ruleId: string }) => client.deleteWatchlistRule(watchlistId, ruleId),
    onSuccess: async (_payload, variables) => {
      queryClient.setQueryData<WatchlistsV1>(sharedQueryKeys.watchlists, (current) =>
        removeWatchlistRule(current, variables.watchlistId, variables.ruleId)
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.watchlists }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.launchFeed })
      ]);
    }
  });
}

export function useCreateAlertRuleMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: AlertRuleCreateV1) => client.createAlertRule(payload),
    onSuccess: async (payload) => {
      queryClient.setQueryData<AlertRulesV1>(sharedQueryKeys.alertRules, (current) => mergeAlertRuleEnvelope(current, payload));
      await queryClient.invalidateQueries({ queryKey: sharedQueryKeys.alertRules });
    }
  });
}

export function useUpdatePrivacyPreferencesMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: PrivacyPreferencesUpdateV1) => client.updatePrivacyPreferences(payload),
    onSuccess: async (payload) => {
      queryClient.setQueryData<PrivacyPreferencesV1>(sharedQueryKeys.privacyPreferences, payload);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.privacyPreferences }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.accountExport })
      ]);
    }
  });
}

export function useUpdateProfileMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ProfileUpdateV1) => client.updateProfile(payload),
    onSuccess: async (payload) => {
      queryClient.setQueryData<ProfileV1>(sharedQueryKeys.profile, payload);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.profile }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.accountExport })
      ]);
    }
  });
}

export function useUpdateMarketingEmailMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: MarketingEmailUpdateV1 | boolean) =>
      client.updateMarketingEmail(typeof payload === 'boolean' ? { marketingEmailOptIn: payload } : payload),
    onSuccess: async (payload) => {
      queryClient.setQueryData<MarketingEmailV1>(sharedQueryKeys.marketingEmail, payload);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.marketingEmail }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.accountExport })
      ]);
    }
  });
}

export function useUpdateAdminAccessOverrideMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: AdminAccessOverrideUpdateV1) => client.updateAdminAccessOverride(payload),
    onSuccess: async (payload: AdminAccessOverrideV1) => {
      queryClient.setQueryData(sharedQueryKeys.adminAccessOverride, payload);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.adminAccessOverride }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.entitlements }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.basicFollows }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.watchlists }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.filterPresets }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.alertRules }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.calendarFeeds }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.rssFeeds }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.embedWidgets }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.notificationPreferences }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.launchFeed }),
        queryClient.invalidateQueries({ queryKey: ['launch-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['launch-feed-version'] }),
        queryClient.invalidateQueries({ queryKey: ['launch-detail-version'] })
      ]);
    }
  });
}

export function useDeleteAccountMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (confirm: string) => client.deleteAccount(confirm),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.viewerSession }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.entitlements }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.adminAccessOverride }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.profile }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.privacyPreferences }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.accountExport }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.marketingEmail }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.watchlists }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.filterPresets }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.alertRules }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.calendarFeeds }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.rssFeeds }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.embedWidgets }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.notificationPreferences })
      ]);
    }
  });
}

export function useCreateCalendarFeedMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CalendarFeedCreateV1) => client.createCalendarFeed(payload),
    onSuccess: async (payload) => {
      queryClient.setQueryData<CalendarFeedsV1>(sharedQueryKeys.calendarFeeds, (current) =>
        mergeCalendarFeedEnvelope(current, payload)
      );
      await queryClient.invalidateQueries({ queryKey: sharedQueryKeys.calendarFeeds });
    }
  });
}

export function useUpdateCalendarFeedMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ feedId, payload }: { feedId: string; payload: CalendarFeedUpdateV1 }) =>
      client.updateCalendarFeed(feedId, payload),
    onSuccess: async (payload) => {
      queryClient.setQueryData<CalendarFeedsV1>(sharedQueryKeys.calendarFeeds, (current) =>
        mergeCalendarFeedEnvelope(current, payload)
      );
      await queryClient.invalidateQueries({ queryKey: sharedQueryKeys.calendarFeeds });
    }
  });
}

export function useDeleteCalendarFeedMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (feedId: string) => client.deleteCalendarFeed(feedId),
    onSuccess: async (_payload, feedId) => {
      queryClient.setQueryData<CalendarFeedsV1>(sharedQueryKeys.calendarFeeds, (current) =>
        removeCalendarFeed(current, feedId)
      );
      await queryClient.invalidateQueries({ queryKey: sharedQueryKeys.calendarFeeds });
    }
  });
}

export function useRotateCalendarFeedMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (feedId: string) => client.rotateCalendarFeed(feedId),
    onSuccess: async (payload) => {
      queryClient.setQueryData<CalendarFeedsV1>(sharedQueryKeys.calendarFeeds, (current) =>
        mergeCalendarFeedEnvelope(current, payload)
      );
      await queryClient.invalidateQueries({ queryKey: sharedQueryKeys.calendarFeeds });
    }
  });
}

export function useCreateRssFeedMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: RssFeedCreateV1) => client.createRssFeed(payload),
    onSuccess: async (payload) => {
      queryClient.setQueryData<RssFeedsV1>(sharedQueryKeys.rssFeeds, (current) => mergeRssFeedEnvelope(current, payload));
      await queryClient.invalidateQueries({ queryKey: sharedQueryKeys.rssFeeds });
    }
  });
}

export function useUpdateRssFeedMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ feedId, payload }: { feedId: string; payload: RssFeedUpdateV1 }) =>
      client.updateRssFeed(feedId, payload),
    onSuccess: async (payload) => {
      queryClient.setQueryData<RssFeedsV1>(sharedQueryKeys.rssFeeds, (current) => mergeRssFeedEnvelope(current, payload));
      await queryClient.invalidateQueries({ queryKey: sharedQueryKeys.rssFeeds });
    }
  });
}

export function useDeleteRssFeedMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (feedId: string) => client.deleteRssFeed(feedId),
    onSuccess: async (_payload, feedId) => {
      queryClient.setQueryData<RssFeedsV1>(sharedQueryKeys.rssFeeds, (current) => removeRssFeed(current, feedId));
      await queryClient.invalidateQueries({ queryKey: sharedQueryKeys.rssFeeds });
    }
  });
}

export function useRotateRssFeedMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (feedId: string) => client.rotateRssFeed(feedId),
    onSuccess: async (payload) => {
      queryClient.setQueryData<RssFeedsV1>(sharedQueryKeys.rssFeeds, (current) => mergeRssFeedEnvelope(current, payload));
      await queryClient.invalidateQueries({ queryKey: sharedQueryKeys.rssFeeds });
    }
  });
}

export function useCreateEmbedWidgetMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: EmbedWidgetCreateV1) => client.createEmbedWidget(payload),
    onSuccess: async (payload) => {
      queryClient.setQueryData<EmbedWidgetsV1>(sharedQueryKeys.embedWidgets, (current) =>
        mergeEmbedWidgetEnvelope(current, payload)
      );
      await queryClient.invalidateQueries({ queryKey: sharedQueryKeys.embedWidgets });
    }
  });
}

export function useUpdateEmbedWidgetMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ widgetId, payload }: { widgetId: string; payload: EmbedWidgetUpdateV1 }) =>
      client.updateEmbedWidget(widgetId, payload),
    onSuccess: async (payload) => {
      queryClient.setQueryData<EmbedWidgetsV1>(sharedQueryKeys.embedWidgets, (current) =>
        mergeEmbedWidgetEnvelope(current, payload)
      );
      await queryClient.invalidateQueries({ queryKey: sharedQueryKeys.embedWidgets });
    }
  });
}

export function useDeleteEmbedWidgetMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (widgetId: string) => client.deleteEmbedWidget(widgetId),
    onSuccess: async (_payload, widgetId) => {
      queryClient.setQueryData<EmbedWidgetsV1>(sharedQueryKeys.embedWidgets, (current) =>
        removeEmbedWidget(current, widgetId)
      );
      await queryClient.invalidateQueries({ queryKey: sharedQueryKeys.embedWidgets });
    }
  });
}

export function useRotateEmbedWidgetMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (widgetId: string) => client.rotateEmbedWidget(widgetId),
    onSuccess: async (payload) => {
      queryClient.setQueryData<EmbedWidgetsV1>(sharedQueryKeys.embedWidgets, (current) =>
        mergeEmbedWidgetEnvelope(current, payload)
      );
      await queryClient.invalidateQueries({ queryKey: sharedQueryKeys.embedWidgets });
    }
  });
}

export function useDeleteAlertRuleMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ruleId: string) => client.deleteAlertRule(ruleId),
    onSuccess: async (_payload, ruleId) => {
      queryClient.setQueryData<AlertRulesV1>(sharedQueryKeys.alertRules, (current) => ({
        rules: (current?.rules ?? []).filter((rule) => rule.id !== ruleId)
      }));
      await queryClient.invalidateQueries({ queryKey: sharedQueryKeys.alertRules });
    }
  });
}

export function useArTelemetrySessionMutation() {
  const client = useMobileApiClient();

  return useMutation({
    mutationFn: (payload: ArTelemetrySessionEventV1) => client.postArTelemetrySession(payload)
  });
}

export function useNotificationPreferencesQuery() {
  const client = useMobileApiClient();
  const { accessToken, isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    ...notificationPreferencesQueryOptions(() => client.getNotificationPreferences()),
    enabled: isAuthHydrated && Boolean(accessToken)
  });
}

export function useMobilePushRulesQuery(context: MobilePushGuestContextV1 | null, options: { enabled?: boolean } = {}) {
  const client = useMobileApiClient();
  const { isAuthHydrated } = useMobileBootstrap();
  const installationId = context?.installationId ?? 'missing';

  return useQuery({
    ...mobilePushRulesQueryOptions(installationId, () => client.getMobilePushRules(context ?? { installationId })),
    enabled: isAuthHydrated && Boolean(context?.installationId) && (options.enabled ?? true)
  });
}

export function useUpsertMobilePushRuleMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: MobilePushRuleUpsertV1) => client.upsertMobilePushRule(payload),
    onSuccess: async (payload, variables) => {
      queryClient.setQueryData<MobilePushRulesEnvelopeV1>(
        sharedQueryKeys.mobilePushRules(variables.installationId),
        (current) => mergeMobilePushRuleEnvelope(current, payload)
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.mobilePushRules(variables.installationId) }),
        invalidateMobilePushLaunchPreferenceQueries(queryClient)
      ]);
    }
  });
}

export function useDeleteMobilePushRuleMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ruleId, context }: { ruleId: string; context: MobilePushGuestContextV1 }) =>
      client.deleteMobilePushRule(ruleId, context),
    onSuccess: async (_payload, variables) => {
      queryClient.setQueryData<MobilePushRulesEnvelopeV1>(
        sharedQueryKeys.mobilePushRules(variables.context.installationId),
        (current) =>
          current
            ? {
                ...current,
                rules: current.rules.filter((rule) => rule.id !== variables.ruleId)
              }
            : current
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.mobilePushRules(variables.context.installationId) }),
        invalidateMobilePushLaunchPreferenceQueries(queryClient)
      ]);
    }
  });
}

export function useMobilePushLaunchPreferenceQuery(
  launchId: string | null,
  context: MobilePushGuestContextV1 | null,
  options: { enabled?: boolean } = {}
) {
  const client = useMobileApiClient();
  const { isAuthHydrated } = useMobileBootstrap();
  const installationId = context?.installationId ?? 'missing';

  return useQuery({
    ...mobilePushLaunchPreferenceQueryOptions(launchId || 'missing', installationId, () =>
      client.getMobilePushLaunchPreference(String(launchId), context ?? { installationId })
    ),
    enabled: isAuthHydrated && Boolean(launchId) && Boolean(context?.installationId) && (options.enabled ?? true)
  });
}

export function useUpsertMobilePushLaunchPreferenceMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ launchId, payload }: { launchId: string; payload: MobilePushRuleUpsertV1 }) =>
      client.upsertMobilePushLaunchPreference(launchId, payload),
    onSuccess: async (payload, variables) => {
      queryClient.setQueryData<MobilePushLaunchPreferenceEnvelopeV1>(
        sharedQueryKeys.mobilePushLaunchPreference(variables.launchId, variables.payload.installationId),
        {
          access: payload.access,
          device: payload.device,
          rule: payload.rule
        }
      );
      queryClient.setQueryData<MobilePushRulesEnvelopeV1>(
        sharedQueryKeys.mobilePushRules(variables.payload.installationId),
        (current) => mergeMobilePushRuleEnvelope(current, payload)
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: sharedQueryKeys.mobilePushLaunchPreference(variables.launchId, variables.payload.installationId)
        }),
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.mobilePushRules(variables.payload.installationId) })
      ]);
    }
  });
}

export function useSendMobilePushTestMutation() {
  const client = useMobileApiClient();

  return useMutation({
    mutationFn: (payload: MobilePushTestRequestV1) => client.sendMobilePushTest(payload)
  });
}

export function fetchLaunchFeedVersion(
  queryClient: QueryClient,
  client: Pick<ApiClient, 'getLaunchFeedVersion'>,
  request: LaunchFeedVersionRequest = {}
) {
  return queryClient.fetchQuery(launchFeedVersionQueryOptions(() => client.getLaunchFeedVersion(request), request));
}

export function fetchLaunchDetailVersion(
  queryClient: QueryClient,
  client: Pick<ApiClient, 'getLaunchDetailVersion'>,
  launchId: string,
  request: LaunchDetailVersionRequest = {}
) {
  return queryClient.fetchQuery(
    launchDetailVersionQueryOptions(launchId, () => client.getLaunchDetailVersion(launchId, request), request)
  );
}
