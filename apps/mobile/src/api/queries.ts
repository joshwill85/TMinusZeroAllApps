import type { QueryClient } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AlertRuleCreateV1,
  AlertRuleEnvelopeV1,
  AlertRulesV1,
  ArTelemetrySessionEventV1,
  ApiClient,
  BlueOriginMissionFilterRequest,
  BlueOriginMissionKeyV1,
  FilterPresetEnvelopeV1,
  FilterPresetCreateV1,
  FilterPresetsV1,
  FilterPresetUpdateV1,
  LaunchFeedRequest,
  LaunchFeedV1,
  LaunchFilterOptionsRequest,
  LaunchNotificationPreferenceEnvelopeV1,
  LaunchNotificationPreferenceUpdateV1,
  NotificationPreferencesV1,
  NotificationPreferencesUpdateV1,
  SmsVerificationCheckV1,
  SmsVerificationRequestV1,
  WatchlistCreateV1,
  WatchlistEnvelopeV1,
  WatchlistRuleCreateV1,
  WatchlistRuleEnvelopeV1,
  WatchlistUpdateV1,
  WatchlistsV1
} from '@tminuszero/api-client';
import {
  alertRulesQueryOptions,
  billingCatalogQueryOptions,
  billingSummaryQueryOptions,
  blueOriginContractsQueryOptions,
  blueOriginEnginesQueryOptions,
  blueOriginFlightsQueryOptions,
  blueOriginMissionOverviewQueryOptions,
  blueOriginOverviewQueryOptions,
  blueOriginTravelersQueryOptions,
  blueOriginVehiclesQueryOptions,
  filterPresetsQueryOptions,
  launchFeedQueryOptions,
  launchFilterOptionsQueryOptions,
  launchDetailQueryOptions,
  launchTrajectoryQueryOptions,
  launchNotificationPreferenceQueryOptions,
  normalizeSearchQuery,
  notificationPreferencesQueryOptions,
  profileQueryOptions,
  searchQueryOptions,
  sharedQueryStaleTimes,
  sharedQueryKeys,
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

async function invalidateLaunchNotificationPreferenceQueries(queryClient: QueryClient) {
  await queryClient.invalidateQueries({
    predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'launch-notification-preference'
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
  const { accessToken, isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    ...billingCatalogQueryOptions(() => client.getBillingCatalog(platform), { platform }),
    enabled: (options?.enabled ?? true) && isAuthHydrated && Boolean(accessToken),
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

export function useLaunchTrajectoryQuery(id: string | null, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...launchTrajectoryQueryOptions(id || 'missing', () => client.getLaunchTrajectory(String(id))),
    enabled: (options?.enabled ?? true) && Boolean(id)
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
    enabled: isAuthHydrated && Boolean(accessToken),
  });
}

export function useUpdateNotificationPreferencesMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: NotificationPreferencesUpdateV1) => client.updateNotificationPreferences(payload),
    onSuccess: async (payload) => {
      queryClient.setQueryData<NotificationPreferencesV1>(sharedQueryKeys.notificationPreferences, payload);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.notificationPreferences }),
        invalidateLaunchNotificationPreferenceQueries(queryClient)
      ]);
    }
  });
}

export function useLaunchNotificationPreferenceQuery(launchId: string | null, channel: 'sms' | 'push' = 'push') {
  const client = useMobileApiClient();
  const { accessToken, isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    ...launchNotificationPreferenceQueryOptions(launchId || 'missing', channel, () =>
      client.getLaunchNotificationPreference(String(launchId), channel)
    ),
    enabled: isAuthHydrated && Boolean(accessToken) && Boolean(launchId)
  });
}

export function useUpdateLaunchNotificationPreferenceMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ launchId, payload }: { launchId: string; payload: LaunchNotificationPreferenceUpdateV1 }) =>
      client.updateLaunchNotificationPreference(launchId, payload),
    onSuccess: async (payload, variables) => {
      const channel = payload.preference.channel ?? variables.payload.channel ?? 'push';
      queryClient.setQueryData<LaunchNotificationPreferenceEnvelopeV1>(
        sharedQueryKeys.launchNotificationPreference(variables.launchId, channel),
        payload
      );
      await queryClient.invalidateQueries({
        queryKey: sharedQueryKeys.launchNotificationPreference(variables.launchId, channel)
      });
    }
  });
}

export function useStartSmsVerificationMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: SmsVerificationRequestV1) => client.startSmsVerification(payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.notificationPreferences }),
        invalidateLaunchNotificationPreferenceQueries(queryClient)
      ]);
    }
  });
}

export function useCompleteSmsVerificationMutation() {
  const client = useMobileApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: SmsVerificationCheckV1) => client.completeSmsVerification(payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sharedQueryKeys.notificationPreferences }),
        invalidateLaunchNotificationPreferenceQueries(queryClient)
      ]);
    }
  });
}
