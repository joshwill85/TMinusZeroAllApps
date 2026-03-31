import { ReactNode, useCallback, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createSharedQueryClient, sharedQueryKeys } from '@tminuszero/query';
import { useViewerEntitlementsQuery, useViewerSessionQuery } from '@/src/api/queries';
import { useAuthBootstrap } from '@/src/bootstrap/useAuthBootstrap';
import { useThemeBootstrap } from '@/src/bootstrap/useThemeBootstrap';
import { MobilePushProvider } from '@/src/providers/MobilePushProvider';
import { MobileBootstrapContext, useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { MobileToastProvider } from '@/src/providers/MobileToastProvider';

type AppProvidersProps = {
  children: ReactNode;
};

function BootstrapPrefetcher() {
  useMobileBootstrap();
  useViewerSessionQuery();
  useViewerEntitlementsQuery();
  return null;
}

function isAuthScopedQueryKey(queryKey: readonly unknown[]) {
  const [root, scope] = queryKey;
  if (typeof root !== 'string') {
    return false;
  }

  if (
    root === sharedQueryKeys.viewerSession[0] ||
    root === sharedQueryKeys.entitlements[0] ||
    root === sharedQueryKeys.profile[0] ||
    root === sharedQueryKeys.privacyPreferences[0] ||
    root === sharedQueryKeys.accountExport[0] ||
    root === sharedQueryKeys.billingSummary[0] ||
    root === 'billing-catalog' ||
    root === sharedQueryKeys.marketingEmail[0] ||
    root === sharedQueryKeys.watchlists[0] ||
    root === sharedQueryKeys.filterPresets[0] ||
    root === sharedQueryKeys.alertRules[0] ||
    root === sharedQueryKeys.calendarFeeds[0] ||
    root === sharedQueryKeys.rssFeeds[0] ||
    root === sharedQueryKeys.embedWidgets[0] ||
    root === sharedQueryKeys.notificationPreferences[0] ||
    root === 'push-device' ||
    root === 'mobile-push-rules' ||
    root === 'mobile-push-launch-preference'
  ) {
    return true;
  }

  return root === sharedQueryKeys.launchFeed[0] && scope === 'watchlist';
}

export function AppProviders({ children }: AppProvidersProps) {
  const [queryClient] = useState(() => createSharedQueryClient());
  const clearAuthedQueryState = useCallback(async () => {
    const predicate = (query: { queryKey: readonly unknown[] }) => isAuthScopedQueryKey(query.queryKey);

    await queryClient.cancelQueries({ predicate });
    await queryClient.resetQueries({ predicate });
  }, [queryClient]);
  const { accessToken, refreshToken, isHydrated, persistSession, clearSession, refreshSession } = useAuthBootstrap({
    onSessionBoundaryChange: clearAuthedQueryState
  });
  const { scheme, theme } = useThemeBootstrap();

  return (
    <QueryClientProvider client={queryClient}>
      <MobileBootstrapContext.Provider
        value={{
          accessToken,
          refreshToken,
          isAuthHydrated: isHydrated,
          isReady: isHydrated,
          scheme,
          theme,
          persistSession,
          clearSession,
          clearAuthedQueryState,
          refreshSession
        }}
      >
        <MobileToastProvider>
          <MobilePushProvider>
            <BootstrapPrefetcher />
            {children}
          </MobilePushProvider>
        </MobileToastProvider>
      </MobileBootstrapContext.Provider>
    </QueryClientProvider>
  );
}

export { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
