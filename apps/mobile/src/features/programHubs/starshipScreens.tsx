import type { ReactNode } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { StarshipFlightOverviewV1, StarshipOverviewV1 } from '@tminuszero/api-client';
import { useStarshipFlightOverviewQuery, useStarshipOverviewQuery } from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import { LaunchShareIconButton } from '@/src/components/LaunchShareIconButton';
import { CustomerShellHero, CustomerShellMetric, CustomerShellPanel } from '@/src/components/CustomerShell';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { shareLaunch } from '@/src/utils/launchShare';
import { buildStarshipFlightHref } from './spacexRoutes';

type QueryState<T> = {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
};

export function StarshipHubScreen() {
  const router = useRouter();
  const overviewQuery = useStarshipOverviewQuery();

  return (
    <AppScreen testID="starship-hub-screen">
      <CustomerShellHero
        eyebrow="Program Workbench"
        title="Starship"
        description="Dedicated Starship workbench with per-flight routing, launch snapshots, and timeline evidence."
      />
      {renderQueryState(overviewQuery, {
        emptyTitle: 'Starship unavailable',
        emptyDescription: 'No Starship overview payload is currently available.',
        render: (payload) => (
          <>
            <MetricsPanel
              title="Program status"
              metrics={[
                { label: 'Upcoming', value: String(payload.stats.upcomingLaunches) },
                { label: 'Flights', value: String(payload.stats.flightsTracked) },
                { label: 'Timeline', value: String(payload.stats.timelineEvents) }
              ]}
            />

            <LaunchSummaryPanel
              title="Next launch"
              description="The next Starship-linked launch routed through the shared native launch detail screen."
              launch={payload.snapshot.nextLaunch}
            />

            <CustomerShellPanel title="Tracked flights" description={`${payload.flights.length} Starship flight route${payload.flights.length === 1 ? '' : 's'} available.`}>
              <View style={{ gap: 10 }}>
                {payload.flights.length ? (
                  payload.flights.map((flight) => (
                    <SimpleRow
                      key={flight.flightSlug}
                      title={flight.label}
                      body={[
                        flight.nextLaunch?.name || null,
                        flight.nextLaunch?.net ? formatDate(flight.nextLaunch.net) : null,
                        `${flight.upcomingCount} upcoming`,
                        `${flight.recentCount} recent`
                      ]
                        .filter(Boolean)
                        .join(' • ') || 'Tracked Starship flight'}
                      meta="Open flight route"
                      onPress={() => router.push(buildStarshipFlightHref(flight.flightSlug) as Href)}
                    />
                  ))
                ) : (
                  <TextBlock value="No Starship flight routes are currently available." />
                )}
              </View>
            </CustomerShellPanel>

            <TimelinePanel title="Timeline preview" description={`${payload.timeline.length} Starship timeline event${payload.timeline.length === 1 ? '' : 's'} in preview.`} items={payload.timeline} />
            <FaqPanel items={payload.snapshot.faq} />
          </>
        )
      })}
    </AppScreen>
  );
}

export function StarshipFlightScreen({ slug }: { slug: string }) {
  const router = useRouter();
  const flightQuery = useStarshipFlightOverviewQuery(slug);

  return (
    <AppScreen testID={`starship-flight-${slug}`}>
      <CustomerShellHero eyebrow="Starship Flight" title="Starship Flight" description="Flight-specific Starship route with schedule, change, and evidence context." />
      {renderQueryState(flightQuery, {
        emptyTitle: 'Flight unavailable',
        emptyDescription: 'The requested Starship flight payload could not be loaded.',
        render: (payload) => (
          <>
            <MetricsPanel
              title="Flight status"
              metrics={[
                { label: 'Flight', value: `#${payload.snapshot.flightNumber}` },
                { label: 'Upcoming', value: String(payload.snapshot.upcoming.length) },
                { label: 'Recent', value: String(payload.snapshot.recent.length) }
              ]}
            />

            <LaunchSummaryPanel
              title="Next launch"
              description="The next launch currently linked to this Starship flight."
              launch={payload.snapshot.nextLaunch}
            />

            <CustomerShellPanel title="Flight highlights" description={`${payload.snapshot.crewHighlights.length} highlight${payload.snapshot.crewHighlights.length === 1 ? '' : 's'} available.`}>
              <View style={{ gap: 10 }}>
                {payload.snapshot.crewHighlights.length ? (
                  payload.snapshot.crewHighlights.map((highlight) => <SimpleRow key={highlight} title={highlight} body="" />)
                ) : (
                  <TextBlock value="No flight highlights are currently available." />
                )}
              </View>
            </CustomerShellPanel>

            <LaunchRowsPanel title="Upcoming launches" launches={payload.snapshot.upcoming} />
            <LaunchRowsPanel title="Recent launches" launches={payload.snapshot.recent} />

            <CustomerShellPanel title="Change log" description={`${payload.snapshot.changes.length} tracked change${payload.snapshot.changes.length === 1 ? '' : 's'} available.`}>
              <View style={{ gap: 10 }}>
                {payload.snapshot.changes.length ? (
                  payload.snapshot.changes.map((change) => (
                    <SimpleRow
                      key={`${change.date}:${change.title}`}
                      title={change.title}
                      body={[formatDate(change.date), change.summary].filter(Boolean).join(' • ')}
                      meta={change.href ? 'Open context' : null}
                      onPress={
                        change.href
                          ? () => {
                              if (change.href?.startsWith('/')) {
                                router.push(change.href as Href);
                                return;
                              }
                              void Linking.openURL(change.href || '');
                            }
                          : undefined
                      }
                    />
                  ))
                ) : (
                  <TextBlock value="No change-log items are currently available." />
                )}
              </View>
            </CustomerShellPanel>

            <TimelinePanel title="Timeline evidence" description={`${payload.timeline.length} event${payload.timeline.length === 1 ? '' : 's'} in this flight timeline.`} items={payload.timeline} />
            <FaqPanel items={payload.snapshot.faq} />
          </>
        )
      })}
    </AppScreen>
  );
}

function renderQueryState<T>(
  query: QueryState<T>,
  options: {
    emptyTitle: string;
    emptyDescription: string;
    render: (payload: T) => ReactNode;
  }
) {
  if (query.isPending) {
    return <CustomerShellPanel title="Loading" description="Fetching the latest Starship payload." />;
  }

  if (query.isError) {
    return <CustomerShellPanel title="Unavailable" description={query.error?.message || 'Unable to load the Starship payload.'} />;
  }

  if (!query.data) {
    return <CustomerShellPanel title={options.emptyTitle} description={options.emptyDescription} />;
  }

  return options.render(query.data);
}

function MetricsPanel({
  title,
  metrics
}: {
  title: string;
  metrics: Array<{ label: string; value: string }>;
}) {
  return (
    <CustomerShellPanel title={title} description="Snapshot metrics from the shared Starship loaders.">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {metrics.map((metric) => (
          <CustomerShellMetric key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </View>
    </CustomerShellPanel>
  );
}

function LaunchSummaryPanel({
  title,
  description,
  launch
}: {
  title: string;
  description: string;
  launch: StarshipOverviewV1['snapshot']['nextLaunch'] | StarshipFlightOverviewV1['snapshot']['nextLaunch'];
}) {
  const router = useRouter();

  return (
    <CustomerShellPanel title={title} description={description}>
      {launch ? (
        <SimpleRow
          title={launch.name}
          body={[launch.vehicle, launch.padShortCode, formatDate(launch.net), launch.statusText].filter(Boolean).join(' • ')}
          meta="Open launch detail"
          trailing={
            <LaunchShareIconButton
              onPress={() => {
                void shareLaunch({
                  id: launch.id,
                  name: launch.name,
                  net: launch.net,
                  vehicle: launch.vehicle,
                  statusText: launch.statusText,
                  padLabel: launch.padShortCode
                });
              }}
              size={38}
            />
          }
          onPress={() => router.push(launch.href as Href)}
        />
      ) : (
        <TextBlock value="No linked Starship launch is currently available." />
      )}
    </CustomerShellPanel>
  );
}

function LaunchRowsPanel({
  title,
  launches
}: {
  title: string;
  launches: StarshipFlightOverviewV1['snapshot']['upcoming'] | StarshipFlightOverviewV1['snapshot']['recent'];
}) {
  const router = useRouter();

  return (
    <CustomerShellPanel title={title} description={`${launches.length} launch record${launches.length === 1 ? '' : 's'} available.`}>
      <View style={{ gap: 10 }}>
        {launches.length ? (
          launches.map((launch) => (
            <SimpleRow
              key={launch.id}
              title={launch.name}
              body={[launch.vehicle, launch.padShortCode, formatDate(launch.net), launch.statusText].filter(Boolean).join(' • ')}
              meta="Open launch detail"
              onPress={() => router.push(launch.href as Href)}
            />
          ))
        ) : (
          <TextBlock value="No launch records are currently available." />
        )}
      </View>
    </CustomerShellPanel>
  );
}

function TimelinePanel({
  title,
  description,
  items
}: {
  title: string;
  description: string;
  items: StarshipOverviewV1['timeline'] | StarshipFlightOverviewV1['timeline'];
}) {
  const router = useRouter();

  return (
    <CustomerShellPanel title={title} description={description}>
      <View style={{ gap: 10 }}>
        {items.length ? (
          items.map((item) => (
            <SimpleRow
              key={item.id}
              title={item.title}
              body={[item.missionLabel, formatDate(item.date), item.sourceLabel].filter(Boolean).join(' • ') || item.summary}
              meta={item.href ? (item.href.startsWith('/') ? 'Open' : 'Open source') : null}
              onPress={
                item.href
                  ? () => {
                      if (item.href?.startsWith('/')) {
                        router.push(item.href as Href);
                        return;
                      }
                      void Linking.openURL(item.href || '');
                    }
                  : undefined
              }
            />
          ))
        ) : (
          <TextBlock value="No Starship timeline events are currently available." />
        )}
      </View>
    </CustomerShellPanel>
  );
}

function FaqPanel({ items }: { items: Array<{ question: string; answer: string }> }) {
  return (
    <CustomerShellPanel title="FAQ" description={`${items.length} answer${items.length === 1 ? '' : 's'} available.`}>
      <View style={{ gap: 10 }}>
        {items.length ? (
          items.map((item) => <SimpleRow key={item.question} title={item.question} body={item.answer} />)
        ) : (
          <TextBlock value="No Starship FAQ entries are currently available." />
        )}
      </View>
    </CustomerShellPanel>
  );
}

function SimpleRow({
  title,
  body,
  meta,
  onPress,
  trailing
}: {
  title: string;
  body: string;
  meta?: string | null;
  onPress?: (() => void) | undefined;
  trailing?: ReactNode;
}) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        gap: 6,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: pressed && onPress ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 14,
        paddingVertical: 14,
        opacity: onPress ? 1 : 0.96
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{title}</Text>
          {body ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{body}</Text> : null}
          {meta ? <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>{meta}</Text> : null}
        </View>
        {trailing}
      </View>
    </Pressable>
  );
}

function TextBlock({ value }: { value: string }) {
  const { theme } = useMobileBootstrap();
  return <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>{value}</Text>;
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}
