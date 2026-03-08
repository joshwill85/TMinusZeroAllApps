import { Text } from 'react-native';
import { useWatchlistsQuery } from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import { EmptyStateCard, ErrorStateCard, LoadingStateCard, SectionCard } from '@/src/components/SectionCard';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { SignInPrompt } from '@/src/components/SignInPrompt';
import { useMobileBootstrap } from '@/src/providers/AppProviders';

export default function SavedScreen() {
  const { accessToken, theme } = useMobileBootstrap();
  const watchlistsQuery = useWatchlistsQuery();

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow="Saved items"
        title="Watchlists"
        description="This is the first native shell for authenticated saved launch surfaces."
      />

      {!accessToken ? (
        <SignInPrompt body="Watchlists are account-backed, so this screen stays read-only until a bearer token is restored." />
      ) : watchlistsQuery.isPending ? (
        <LoadingStateCard title="Loading watchlists" body="Fetching /api/v1/me/watchlists." />
      ) : watchlistsQuery.isError ? (
        <ErrorStateCard title="Watchlists unavailable" body={watchlistsQuery.error.message} />
      ) : watchlistsQuery.data.watchlists.length === 0 ? (
        <EmptyStateCard title="No watchlists yet" body="Create or import watchlists once those write flows land." />
      ) : (
        <SectionCard
          title="Your watchlists"
          description={`${watchlistsQuery.data.watchlists.length} watchlist(s) available.`}
        >
          {watchlistsQuery.data.watchlists.map((watchlist) => (
            <SectionCard key={watchlist.id} title={watchlist.name} compact>
              <Text style={{ color: theme.muted, fontSize: 14 }}>
                {watchlist.ruleCount} rule{watchlist.ruleCount === 1 ? '' : 's'}
              </Text>
            </SectionCard>
          ))}
        </SectionCard>
      )}
    </AppScreen>
  );
}
