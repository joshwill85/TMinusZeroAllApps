import { useMemo } from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { LaunchFeedRequest } from '@tminuszero/api-client';
import type { LaunchFeedItemV1 } from '@tminuszero/contracts';
import { buildLaunchHref, buildSearchHref } from '@tminuszero/navigation';
import { useLaunchFeedPageQuery } from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import { LaunchListItem } from '@/src/components/LaunchListItem';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { formatTimestamp } from '@/src/utils/format';

type EntityTimelineFilters = Pick<LaunchFeedRequest, 'provider' | 'providerId' | 'location' | 'pad' | 'padId' | 'rocketId'>;

type EntityLaunchTimelineScreenProps = {
  testID: string;
  eyebrow: string;
  title: string;
  description: string;
  searchQuery: string;
  canonicalWebPath: string;
  timelineFilters: EntityTimelineFilters;
  resolutionNote?: string | null;
  isResolvingFilters?: boolean;
};

const ENTITY_PAGE_SIZE = 24;

export function EntityLaunchTimelineScreen({
  testID,
  eyebrow,
  title,
  description,
  searchQuery,
  canonicalWebPath: _canonicalWebPath,
  timelineFilters,
  resolutionNote = null,
  isResolvingFilters = false
}: EntityLaunchTimelineScreenProps) {
  const router = useRouter();
  void _canonicalWebPath;
  const nowIso = useMemo(() => new Date().toISOString(), []);
  const canQueryLaunches = hasTimelineFilters(timelineFilters);

  const upcomingQuery = useLaunchFeedPageQuery(
    {
      scope: 'public',
      range: 'all',
      from: nowIso,
      to: null,
      sort: 'soonest',
      limit: ENTITY_PAGE_SIZE,
      offset: 0,
      ...timelineFilters
    },
    { enabled: canQueryLaunches }
  );
  const historyQuery = useLaunchFeedPageQuery(
    {
      scope: 'public',
      range: 'all',
      from: null,
      to: nowIso,
      sort: 'latest',
      limit: ENTITY_PAGE_SIZE,
      offset: 0,
      ...timelineFilters
    },
    { enabled: canQueryLaunches }
  );

  const upcomingLaunches = upcomingQuery.data?.launches ?? [];
  const historyLaunches = historyQuery.data?.launches ?? [];

  return (
    <AppScreen testID={testID}>
      <CustomerShellHero eyebrow={eyebrow} title={title} description={description}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label="Native timeline" tone="accent" />
          <CustomerShellBadge label="P0.3" tone="success" />
          {canQueryLaunches && !upcomingQuery.isPending && !historyQuery.isPending ? (
            <CustomerShellBadge
              label={`${upcomingLaunches.length + historyLaunches.length} loaded`}
              tone={upcomingLaunches.length + historyLaunches.length > 0 ? 'success' : 'warning'}
            />
          ) : null}
        </View>
      </CustomerShellHero>

      <CustomerShellPanel
        title="Actions"
        description="Open native launch rows below or search in-app for broader browsing."
      >
        <CustomerShellActionButton
          label="Search launches in app"
          onPress={() => {
            router.push(buildSearchHref(searchQuery) as Href);
          }}
        />
      </CustomerShellPanel>

      {resolutionNote ? (
        <CustomerShellPanel title="Entity resolution" description={resolutionNote} />
      ) : null}

      {isResolvingFilters ? (
        <CustomerShellPanel
          title="Resolving entity filters"
          description="Matching this route to launch metadata before loading upcoming and historical launches."
        />
      ) : !canQueryLaunches ? (
        <CustomerShellPanel
          title="No launch filter available"
          description="This route could not resolve enough entity metadata for an in-app schedule query yet. Use search for the closest native path."
        />
      ) : (
        <>
          <TimelineSection
            title="Upcoming launches"
            description="Upcoming launches tied to this entity."
            launches={upcomingLaunches}
            isPending={upcomingQuery.isPending}
            isError={upcomingQuery.isError}
            errorMessage={upcomingQuery.error instanceof Error ? upcomingQuery.error.message : null}
            onOpenLaunch={(launchId) => {
              router.push(buildLaunchHref(launchId) as Href);
            }}
          />
          <TimelineSection
            title="Launch history"
            description="Recent launch history tied to this entity."
            launches={historyLaunches}
            isPending={historyQuery.isPending}
            isError={historyQuery.isError}
            errorMessage={historyQuery.error instanceof Error ? historyQuery.error.message : null}
            onOpenLaunch={(launchId) => {
              router.push(buildLaunchHref(launchId) as Href);
            }}
          />
        </>
      )}
    </AppScreen>
  );
}

function TimelineSection({
  title,
  description,
  launches,
  isPending,
  isError,
  errorMessage,
  onOpenLaunch
}: {
  title: string;
  description: string;
  launches: LaunchFeedItemV1[];
  isPending: boolean;
  isError: boolean;
  errorMessage: string | null;
  onOpenLaunch: (launchId: string) => void;
}) {
  if (isPending) {
    return <CustomerShellPanel title={title} description="Loading launches..." />;
  }

  if (isError) {
    return <CustomerShellPanel title={title} description={errorMessage || 'Unable to load launches for this entity.'} />;
  }

  if (launches.length === 0) {
    return <CustomerShellPanel title={title} description="No launches found for this section yet." />;
  }

  return (
    <CustomerShellPanel title={title} description={description}>
      <View style={{ gap: 10 }}>
        {launches.map((launch) => (
          <LaunchListItem
            key={launch.id}
            title={launch.name}
            subtitle={buildLaunchSubtitle(launch)}
            meta={`${formatTimestamp(launch.net)} • ${launch.pad?.name || 'Pad TBD'}`}
            onPress={() => {
              onOpenLaunch(launch.id);
            }}
          />
        ))}
      </View>
    </CustomerShellPanel>
  );
}

function buildLaunchSubtitle(launch: LaunchFeedItemV1) {
  const provider = String(launch.provider || 'Unknown provider').trim();
  const vehicle = String(launch.rocket?.fullName || launch.vehicle || 'Vehicle TBD').trim();
  const location = String(launch.pad?.locationName || launch.pad?.state || '').trim();
  return [provider, vehicle, location].filter(Boolean).join(' • ');
}

function hasTimelineFilters(filters: EntityTimelineFilters) {
  return Boolean(
    String(filters.provider || '').trim() ||
      String(filters.location || '').trim() ||
      String(filters.pad || '').trim() ||
      (typeof filters.providerId === 'number' && Number.isFinite(filters.providerId) && filters.providerId > 0) ||
      (typeof filters.padId === 'number' && Number.isFinite(filters.padId) && filters.padId > 0) ||
      (typeof filters.rocketId === 'number' && Number.isFinite(filters.rocketId) && filters.rocketId > 0)
  );
}
