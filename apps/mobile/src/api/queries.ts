import { useQuery } from '@tanstack/react-query';
import { useMobileBootstrap } from '@/src/providers/AppProviders';
import { useMobileApiClient } from '@/src/api/useMobileApiClient';

export const mobileQueryKeys = {
  viewerSession: ['viewer-session'] as const,
  entitlements: ['viewer-entitlements'] as const,
  launchFeed: ['launch-feed'] as const,
  launchDetail: (id: string) => ['launch-detail', id] as const,
  search: (query: string) => ['search', query] as const,
  profile: ['profile'] as const,
  watchlists: ['watchlists'] as const,
  presets: ['filter-presets'] as const,
  preferences: ['notification-preferences'] as const
};

export function useViewerSessionQuery() {
  const client = useMobileApiClient();
  const { isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    queryKey: mobileQueryKeys.viewerSession,
    queryFn: () => client.getViewerSession(),
    enabled: isAuthHydrated
  });
}

export function useViewerEntitlementsQuery() {
  const client = useMobileApiClient();
  const { isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    queryKey: mobileQueryKeys.entitlements,
    queryFn: () => client.getViewerEntitlements(),
    enabled: isAuthHydrated
  });
}

export function useLaunchFeedQuery() {
  const client = useMobileApiClient();

  return useQuery({
    queryKey: mobileQueryKeys.launchFeed,
    queryFn: () => client.getLaunchFeed()
  });
}

export function useLaunchDetailQuery(id: string | null) {
  const client = useMobileApiClient();

  return useQuery({
    queryKey: mobileQueryKeys.launchDetail(id || 'missing'),
    queryFn: () => client.getLaunchDetail(String(id)),
    enabled: Boolean(id)
  });
}

export function useSearchQuery(query: string) {
  const client = useMobileApiClient();
  const normalized = query.trim();

  return useQuery({
    queryKey: mobileQueryKeys.search(normalized),
    queryFn: () => client.search(normalized),
    enabled: normalized.length >= 2
  });
}

export function useProfileQuery() {
  const client = useMobileApiClient();
  const { accessToken, isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    queryKey: mobileQueryKeys.profile,
    queryFn: () => client.getProfile(),
    enabled: isAuthHydrated && Boolean(accessToken)
  });
}

export function useWatchlistsQuery() {
  const client = useMobileApiClient();
  const { accessToken, isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    queryKey: mobileQueryKeys.watchlists,
    queryFn: () => client.getWatchlists(),
    enabled: isAuthHydrated && Boolean(accessToken)
  });
}

export function useFilterPresetsQuery() {
  const client = useMobileApiClient();
  const { accessToken, isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    queryKey: mobileQueryKeys.presets,
    queryFn: () => client.getFilterPresets(),
    enabled: isAuthHydrated && Boolean(accessToken)
  });
}

export function useNotificationPreferencesQuery() {
  const client = useMobileApiClient();
  const { accessToken, isAuthHydrated } = useMobileBootstrap();

  return useQuery({
    queryKey: mobileQueryKeys.preferences,
    queryFn: () => client.getNotificationPreferences(),
    enabled: isAuthHydrated && Boolean(accessToken)
  });
}
