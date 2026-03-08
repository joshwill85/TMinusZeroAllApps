import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { Text } from 'react-native';
import { buildLaunchHref, buildMobileRoute } from '@tminuszero/navigation';
import { useLaunchFeedQuery, useViewerEntitlementsQuery } from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import { EmptyStateCard, ErrorStateCard, LoadingStateCard, SectionCard } from '@/src/components/SectionCard';
import { LaunchListItem } from '@/src/components/LaunchListItem';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { useApiClient } from '@/src/api/client';
import { formatTimestamp } from '@/src/utils/format';

export default function FeedScreen() {
  const router = useRouter();
  const { baseUrl } = useApiClient();
  const launchFeedQuery = useLaunchFeedQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow="Phase 4 shell"
        title="Launch feed"
        description="Shared /api/v1 launches are wired into the native shell with React Query."
      />

      <SectionCard title="Connection" description="Local runtime config for the shared Next.js BFF.">
        <Text style={{ color: '#9ab3c5', fontSize: 14, lineHeight: 20 }}>{baseUrl}</Text>
      </SectionCard>

      {entitlementsQuery.isPending ? (
        <LoadingStateCard title="Viewer access" body="Checking the shared entitlement contract." />
      ) : entitlementsQuery.isError ? (
        <ErrorStateCard
          title="Viewer access unavailable"
          body={entitlementsQuery.error.message}
        />
      ) : (
        <SectionCard title="Viewer access" description="Same lightweight contract used by web and mobile.">
          <Text style={{ color: '#f2f7fb', fontSize: 16, fontWeight: '700' }}>
            {entitlementsQuery.data.tier.toUpperCase()} · {entitlementsQuery.data.status.replace('_', ' ')}
          </Text>
          <Text style={{ color: '#9ab3c5', fontSize: 14, marginTop: 6 }}>
            Source: {entitlementsQuery.data.source}
          </Text>
        </SectionCard>
      )}

      {launchFeedQuery.isPending ? (
        <LoadingStateCard title="Upcoming launches" body="Fetching the shared launch feed." />
      ) : launchFeedQuery.isError ? (
        <ErrorStateCard title="Feed unavailable" body={launchFeedQuery.error.message} />
      ) : launchFeedQuery.data.launches.length === 0 ? (
        <EmptyStateCard title="No launches yet" body="The feed returned an empty result set." />
      ) : (
        <SectionCard
          title="Upcoming launches"
          description={
            launchFeedQuery.data.nextCursor
              ? 'The first page is loaded and a next cursor is available.'
              : 'The current shared contract returned a single page.'
          }
        >
          {launchFeedQuery.data.launches.map((launch) => (
            <LaunchListItem
              key={launch.id}
              title={launch.name}
              subtitle={[launch.provider, launch.status].filter(Boolean).join(' · ') || 'Launch update pending'}
              meta={formatTimestamp(launch.net)}
              onPress={() => {
                router.push(buildLaunchHref(launch.id) as Href);
              }}
            />
          ))}
        </SectionCard>
      )}

      <SectionCard title="More routes" description="The shell now exposes real screens beyond the feed.">
        <LaunchListItem
          title="Search"
          subtitle="Query /api/v1/search"
          meta="Open"
          onPress={() => {
            router.push(buildMobileRoute('search') as Href);
          }}
        />
        <LaunchListItem
          title="Profile"
          subtitle="Session, entitlements, and account data"
          meta="Open"
          onPress={() => {
            router.push(buildMobileRoute('profile') as Href);
          }}
        />
      </SectionCard>
    </AppScreen>
  );
}
