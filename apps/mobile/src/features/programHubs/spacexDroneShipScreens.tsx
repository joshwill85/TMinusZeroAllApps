import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { SpaceXDroneShipDetailV1, SpaceXDroneShipListResponseV1 } from '@tminuszero/api-client';
import { useSpaceXDroneShipDetailQuery, useSpaceXDroneShipsQuery } from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellHero, CustomerShellMetric, CustomerShellPanel } from '@/src/components/CustomerShell';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { buildSpaceXDroneShipHref } from './spacexRoutes';

type QueryState<T> = {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
};

export function SpaceXDroneShipsScreen() {
  const router = useRouter();
  const query = useSpaceXDroneShipsQuery();

  return (
    <AppScreen testID="spacex-drone-ships-screen">
      <CustomerShellHero
        eyebrow="SpaceX Recovery"
        title="Drone Ships"
        description="Native recovery-fleet routes for Of Course I Still Love You, A Shortfall of Gravitas, and Just Read the Instructions."
      />
      {renderQueryState(query, {
        emptyTitle: 'Recovery fleet unavailable',
        emptyDescription: 'No SpaceX drone-ship payload is currently available.',
        render: (payload) => (
          <>
            <MetricsPanel
              title="Coverage"
              metrics={[
                { label: 'Ships', value: String(payload.items.length) },
                { label: 'Assignments', value: String(payload.coverage.knownLandingAssignments) },
                { label: 'Coverage', value: `${Math.round(payload.coverage.coveragePercent)}%` }
              ]}
            />

            <CustomerShellPanel title="Recovery fleet" description={`${payload.items.length} recovery asset${payload.items.length === 1 ? '' : 's'} available.`}>
              <View style={{ gap: 10 }}>
                {payload.items.map((ship) => (
                  <SimpleRow
                    key={ship.slug}
                    title={ship.name}
                    body={[
                      ship.abbrev,
                      ship.status,
                      ship.homePort,
                      `${ship.kpis.assignmentsKnown} known assignments`
                    ]
                      .filter(Boolean)
                      .join(' • ') || ship.description || 'Recovery asset'}
                    meta="Open ship detail"
                    onPress={() => router.push(buildSpaceXDroneShipHref(ship.slug) as Href)}
                  />
                ))}
              </View>
            </CustomerShellPanel>

            <AssignmentsPanel title="Upcoming assignments" items={payload.upcomingAssignments} />
          </>
        )
      })}
    </AppScreen>
  );
}

export function SpaceXDroneShipDetailScreen({ slug }: { slug: string }) {
  const query = useSpaceXDroneShipDetailQuery(slug);

  return (
    <AppScreen testID={`spacex-drone-ship-${slug}`}>
      <CustomerShellHero eyebrow="Recovery Asset" title="Drone ship detail" description="Recovery history, linked launches, and mission mix for a specific SpaceX drone ship." />
      {renderQueryState(query, {
        emptyTitle: 'Recovery asset unavailable',
        emptyDescription: 'The requested SpaceX drone-ship detail payload could not be loaded.',
        render: (payload) => (
          <>
            <MetricsPanel
              title="Ship KPIs"
              metrics={[
                { label: 'Assignments', value: String(payload.ship.kpis.assignmentsKnown) },
                { label: 'Boosters', value: String(payload.ship.kpis.distinctBoostersRecovered) },
                { label: 'Sites', value: String(payload.ship.kpis.distinctLaunchSitesServed) }
              ]}
            />

            <CustomerShellPanel title="Profile summary" description="Identity, ownership, and port context for this recovery asset.">
              <View style={{ gap: 10 }}>
                <SimpleRow
                  title={payload.ship.name}
                  body={[
                    payload.ship.abbrev,
                    payload.ship.status,
                    payload.ship.homePort,
                    payload.ship.ownerName
                  ]
                    .filter(Boolean)
                    .join(' • ') || payload.ship.description || 'Recovery asset'}
                />
              </View>
            </CustomerShellPanel>

            <AssignmentsPanel title="Upcoming assignments" items={payload.upcomingAssignments} />
            <AssignmentsPanel title="Recent assignments" items={payload.recentAssignments.slice(0, 12)} />

            <CustomerShellPanel title="Mission mix" description={`${payload.missionMix.length} mission family${payload.missionMix.length === 1 ? '' : 'ies'} represented.`}>
              <View style={{ gap: 10 }}>
                {payload.missionMix.length ? (
                  payload.missionMix.map((item) => (
                    <SimpleRow key={`${item.missionKey}:${item.count}`} title={item.missionLabel} body={`${item.count} tracked recover${item.count === 1 ? 'y' : 'ies'}`} />
                  ))
                ) : (
                  <TextBlock value="No mission mix data is currently available." />
                )}
              </View>
            </CustomerShellPanel>

            <CustomerShellPanel title="Recovered boosters" description={`${payload.boosters.length} booster record${payload.boosters.length === 1 ? '' : 's'} available.`}>
              <View style={{ gap: 10 }}>
                {payload.boosters.length ? (
                  payload.boosters.map((booster) => (
                    <SimpleRow
                      key={`${booster.ll2LauncherId}:${booster.serialNumber || 'booster'}`}
                      title={booster.serialNumber || `Booster ${booster.ll2LauncherId}`}
                      body={`${booster.missions} recovery-linked mission${booster.missions === 1 ? '' : 's'}`}
                    />
                  ))
                ) : (
                  <TextBlock value="No booster recovery records are currently available." />
                )}
              </View>
            </CustomerShellPanel>
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
    return <CustomerShellPanel title="Loading" description="Fetching the latest recovery-fleet payload." />;
  }

  if (query.isError) {
    return <CustomerShellPanel title="Unavailable" description={query.error?.message || 'Unable to load the recovery-fleet payload.'} />;
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
    <CustomerShellPanel title={title} description="Snapshot metrics from the shared SpaceX recovery loaders.">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {metrics.map((metric) => (
          <CustomerShellMetric key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </View>
    </CustomerShellPanel>
  );
}

function AssignmentsPanel({
  title,
  items
}: {
  title: string;
  items: SpaceXDroneShipListResponseV1['upcomingAssignments'] | SpaceXDroneShipDetailV1['recentAssignments'];
}) {
  const router = useRouter();

  return (
    <CustomerShellPanel title={title} description={`${items.length} assignment${items.length === 1 ? '' : 's'} available.`}>
      <View style={{ gap: 10 }}>
        {items.length ? (
          items.map((item) => (
            <SimpleRow
              key={`${item.launchId}:${item.shipSlug}:${item.landingResult}`}
              title={item.launchName}
              body={[
                item.missionLabel,
                item.launchNet ? formatDate(item.launchNet) : null,
                item.padShortCode || item.padName,
                item.landingResult.replace('_', ' ')
              ]
                .filter(Boolean)
                .join(' • ') || 'Recovery assignment'}
              meta="Open launch detail"
              onPress={() => router.push(item.launchHref as Href)}
            />
          ))
        ) : (
          <TextBlock value="No linked recovery assignments are currently available." />
        )}
      </View>
    </CustomerShellPanel>
  );
}

function SimpleRow({
  title,
  body,
  meta,
  onPress
}: {
  title: string;
  body: string;
  meta?: string | null;
  onPress?: (() => void) | undefined;
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
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{title}</Text>
        {body ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{body}</Text> : null}
        {meta ? <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>{meta}</Text> : null}
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
