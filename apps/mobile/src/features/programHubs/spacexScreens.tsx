import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { SpaceXFlightsResponseV1, SpaceXMissionKeyV1, SpaceXMissionOverviewV1, SpaceXOverviewV1 } from '@tminuszero/api-client';
import {
  useSpaceXContractsQuery,
  useSpaceXEnginesQuery,
  useSpaceXFlightsQuery,
  useSpaceXMissionOverviewQuery,
  useSpaceXOverviewQuery,
  useSpaceXVehiclesQuery
} from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellMetric,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import {
  buildSpaceXContractHref,
  buildSpaceXEngineHref,
  buildSpaceXFlightHref,
  buildSpaceXMissionHref,
  buildSpaceXVehicleHref,
  spaceXMissionLabel
} from './spacexRoutes';

const SPACE_X_MISSIONS: Array<{
  key: Exclude<SpaceXMissionKeyV1, 'spacex-program'>;
  title: string;
  description: string;
}> = [
  {
    key: 'starship',
    title: 'Starship',
    description: 'Integrated flight-test cadence, launch updates, and mission-linked records.'
  },
  {
    key: 'falcon-9',
    title: 'Falcon 9',
    description: 'Reusable launch cadence, mission-linked payloads, and recovery context.'
  },
  {
    key: 'falcon-heavy',
    title: 'Falcon Heavy',
    description: 'Heavy-lift mission routing with payload and milestone context.'
  },
  {
    key: 'dragon',
    title: 'Dragon',
    description: 'Crew and cargo mission records with passenger-linked context.'
  }
];

type QueryState<T> = {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
};

export function normalizeSpaceXMissionParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');

  if (normalized === 'starship') return 'starship';
  if (normalized === 'falcon-9' || normalized === 'falcon9' || normalized === 'f9') return 'falcon-9';
  if (normalized === 'falcon-heavy' || normalized === 'falconheavy' || normalized === 'fh') return 'falcon-heavy';
  if (normalized === 'dragon' || normalized === 'crew-dragon' || normalized === 'cargo-dragon') return 'dragon';
  return null;
}

export function SpaceXHubScreen() {
  const router = useRouter();
  const overviewQuery = useSpaceXOverviewQuery();

  return (
    <AppScreen testID="spacex-hub-screen">
      <CustomerShellHero
        eyebrow="Program Hub"
        title="SpaceX"
        description="Native mission, flight, hardware, and contract entry points for the SpaceX program family."
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label="Native beta" tone="accent" />
          <CustomerShellBadge label="Rollout gated" tone="warning" />
        </View>
      </CustomerShellHero>

      {renderQueryState(overviewQuery, {
        emptyTitle: 'SpaceX unavailable',
        emptyDescription: 'No SpaceX overview payload is currently available.',
        render: (payload) => (
          <>
            <MetricsPanel
              title="Program status"
              metrics={[
                { label: 'Upcoming', value: String(payload.stats.upcomingLaunches) },
                { label: 'Flights', value: String(payload.stats.flights) },
                { label: 'Vehicles', value: String(payload.stats.vehicles) },
                { label: 'Contracts', value: String(payload.stats.contracts) }
              ]}
            />

            <CustomerShellPanel title="Native routes" description="These mirror the current SpaceX pathname family already shipped on the web.">
              <View style={{ gap: 10 }}>
                <ProgramRow title="Missions" body="Mission-specific native routes for Starship, Falcon 9, Falcon Heavy, and Dragon." onPress={() => router.push('/spacex/missions' as Href)} />
                <ProgramRow title="Flights" body="Flight index backed by the shared SpaceX launch-derived records." onPress={() => router.push('/spacex/flights' as Href)} />
                <ProgramRow title="Vehicles" body="Vehicle catalog for Starship, Falcon, and Dragon systems." onPress={() => router.push('/spacex/vehicles' as Href)} />
                <ProgramRow title="Engines" body="Engine catalog for Raptor, Merlin, Draco, and SuperDraco." onPress={() => router.push('/spacex/engines' as Href)} />
                <ProgramRow title="Contracts" body="Program contracts and mission-linked government award context." onPress={() => router.push('/spacex/contracts' as Href)} />
              </View>
            </CustomerShellPanel>

            <LaunchSummaryPanel title="Next launch" description="The next SpaceX launch routed through the shared launch-detail screen." launch={payload.snapshot.nextLaunch} />
            <FlightPreviewPanel flights={payload.flights} />
            <MissionCardsPanel />
          </>
        )
      })}
    </AppScreen>
  );
}

export function SpaceXMissionsScreen() {
  const router = useRouter();

  return (
    <AppScreen testID="spacex-missions-screen">
      <CustomerShellHero
        eyebrow="SpaceX"
        title="Missions"
        description="Mission-specific routes for Starship, Falcon 9, Falcon Heavy, and Dragon."
      />

      <CustomerShellPanel title="Mission hubs" description="Each mission route reuses the shared SpaceX mission snapshot loaders and related indexes.">
        <View style={{ gap: 10 }}>
          {SPACE_X_MISSIONS.map((mission) => (
            <ProgramRow
              key={mission.key}
              title={mission.title}
              body={mission.description}
              onPress={() => router.push(buildSpaceXMissionHref(mission.key) as Href)}
            />
          ))}
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );
}

export function SpaceXMissionScreen({ mission }: { mission: Exclude<SpaceXMissionKeyV1, 'spacex-program'> }) {
  const missionQuery = useSpaceXMissionOverviewQuery(mission);

  return (
    <ProgramListScreen
      testID={`spacex-mission-${mission}`}
      eyebrow="SpaceX Mission"
      title={spaceXMissionLabel(mission)}
      description="Mission snapshot, launch history, passengers, payloads, and contract context."
      query={missionQuery}
      emptyTitle="Mission unavailable"
      emptyDescription="The requested SpaceX mission payload could not be loaded."
      render={(payload) => (
        <>
          <LaunchSummaryPanel title="Next launch" description="Shared mission snapshot routed to native launch detail when a launch exists." launch={payload.snapshot.nextLaunch} />

          <CustomerShellPanel title="Mission highlights" description={payload.description}>
            <View style={{ gap: 10 }}>
              {payload.snapshot.highlights.length ? (
                payload.snapshot.highlights.map((highlight) => <SimpleRow key={highlight} title={highlight} body="" />)
              ) : (
                <TextBlock value="No mission highlights are currently available." />
              )}
            </View>
          </CustomerShellPanel>

          <LaunchRowsPanel
            title="Upcoming launches"
            description={`${payload.snapshot.upcoming.length} upcoming launch record${payload.snapshot.upcoming.length === 1 ? '' : 's'} available.`}
            launches={payload.snapshot.upcoming}
          />
          <LaunchRowsPanel
            title="Recent launches"
            description={`${payload.snapshot.recent.length} recent launch record${payload.snapshot.recent.length === 1 ? '' : 's'} available.`}
            launches={payload.snapshot.recent}
          />

          <CustomerShellPanel title="Passengers" description={`${payload.passengers.length} passenger record${payload.passengers.length === 1 ? '' : 's'} available.`}>
            <View style={{ gap: 10 }}>
              {payload.passengers.length ? (
                payload.passengers.slice(0, 12).map((person) => (
                  <SimpleRow
                    key={person.id}
                    title={person.name}
                    body={[person.role || 'Crew', person.nationality, formatDate(person.launchDate)].filter(Boolean).join(' • ')}
                  />
                ))
              ) : (
                <TextBlock value="No passenger records are currently available." />
              )}
            </View>
          </CustomerShellPanel>

          <CustomerShellPanel title="Payloads" description={`${payload.payloads.length} payload record${payload.payloads.length === 1 ? '' : 's'} available.`}>
            <View style={{ gap: 10 }}>
              {payload.payloads.length ? (
                payload.payloads.slice(0, 12).map((payloadItem) => (
                  <SimpleRow
                    key={payloadItem.id}
                    title={payloadItem.name}
                    body={[payloadItem.payloadType, payloadItem.orbit, formatDate(payloadItem.launchDate)].filter(Boolean).join(' • ') || 'Mission payload'}
                  />
                ))
              ) : (
                <TextBlock value="No payload records are currently available." />
              )}
            </View>
          </CustomerShellPanel>

          <ContractsPanel contracts={payload.contracts} />
        </>
      )}
    />
  );
}

export function SpaceXFlightsScreen() {
  const flightsQuery = useSpaceXFlightsQuery({ mission: 'all' });
  return (
    <ProgramListScreen
      testID="spacex-flights-screen"
      eyebrow="SpaceX"
      title="Flights"
      description="Flight records backed by the shared SpaceX launch-derived index."
      query={flightsQuery}
      emptyTitle="No SpaceX flights"
      emptyDescription="No SpaceX flight records are currently available."
      render={(payload) => <FlightList flights={payload.items} />}
    />
  );
}

export function SpaceXVehiclesScreen() {
  const router = useRouter();
  const vehiclesQuery = useSpaceXVehiclesQuery({ mission: 'all' });
  return (
    <ProgramListScreen
      testID="spacex-vehicles-screen"
      eyebrow="SpaceX"
      title="Vehicles"
      description="Vehicle catalog backed by the shared SpaceX entity index."
      query={vehiclesQuery}
      emptyTitle="No SpaceX vehicles"
      emptyDescription="No SpaceX vehicle records are currently available."
      render={(payload) => (
        <CustomerShellPanel title="Vehicle catalog" description={`${payload.items.length} vehicle record${payload.items.length === 1 ? '' : 's'} available.`}>
          <View style={{ gap: 10 }}>
            {payload.items.map((vehicle) => (
              <SimpleRow
                key={vehicle.id}
                title={vehicle.displayName}
                body={[vehicle.vehicleClass, vehicle.status, vehicle.firstFlight ? formatDate(vehicle.firstFlight) : null].filter(Boolean).join(' • ') || 'Vehicle profile'}
                meta="Open vehicle profile"
                onPress={() => router.push(buildSpaceXVehicleHref(vehicle.vehicleSlug) as Href)}
              />
            ))}
          </View>
        </CustomerShellPanel>
      )}
    />
  );
}

export function SpaceXEnginesScreen() {
  const router = useRouter();
  const enginesQuery = useSpaceXEnginesQuery({ mission: 'all' });
  return (
    <ProgramListScreen
      testID="spacex-engines-screen"
      eyebrow="SpaceX"
      title="Engines"
      description="Engine catalog backed by the shared SpaceX entity index."
      query={enginesQuery}
      emptyTitle="No SpaceX engines"
      emptyDescription="No SpaceX engine records are currently available."
      render={(payload) => (
        <CustomerShellPanel title="Engine catalog" description={`${payload.items.length} engine record${payload.items.length === 1 ? '' : 's'} available.`}>
          <View style={{ gap: 10 }}>
            {payload.items.map((engine) => (
              <SimpleRow
                key={engine.id}
                title={engine.displayName}
                body={[engine.cycle, engine.propellants, engine.status].filter(Boolean).join(' • ') || 'Engine profile'}
                meta="Open engine profile"
                onPress={() => router.push(buildSpaceXEngineHref(engine.engineSlug) as Href)}
              />
            ))}
          </View>
        </CustomerShellPanel>
      )}
    />
  );
}

export function SpaceXContractsScreen() {
  const router = useRouter();
  const contractsQuery = useSpaceXContractsQuery({ mission: 'all' });
  return (
    <ProgramListScreen
      testID="spacex-contracts-screen"
      eyebrow="SpaceX"
      title="Contracts"
      description="Contract records backed by the shared SpaceX program contract index."
      query={contractsQuery}
      emptyTitle="No SpaceX contracts"
      emptyDescription="No SpaceX contract records are currently available."
      render={(payload) => (
        <CustomerShellPanel title="Contract ledger" description={`${payload.items.length} contract record${payload.items.length === 1 ? '' : 's'} available.`}>
          <View style={{ gap: 10 }}>
            {payload.items.map((contract) => (
              <SimpleRow
                key={contract.id}
                title={contract.title}
                body={[contract.agency || contract.customer || 'Public record', contract.awardedOn ? formatDate(contract.awardedOn) : null, contract.status].filter(Boolean).join(' • ') || 'Contract record'}
                meta="Open contract detail"
                onPress={() => router.push(buildSpaceXContractHref(contract.contractKey) as Href)}
              />
            ))}
          </View>
        </CustomerShellPanel>
      )}
    />
  );
}

function ProgramListScreen<T>({
  testID,
  eyebrow,
  title,
  description,
  query,
  emptyTitle,
  emptyDescription,
  render
}: {
  testID: string;
  eyebrow: string;
  title: string;
  description: string;
  query: QueryState<T>;
  emptyTitle: string;
  emptyDescription: string;
  render: (payload: T) => ReactNode;
}) {
  return (
    <AppScreen testID={testID}>
      <CustomerShellHero eyebrow={eyebrow} title={title} description={description} />
      {renderQueryState(query, {
        emptyTitle,
        emptyDescription,
        render
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
    return <CustomerShellPanel title="Loading" description="Fetching the latest SpaceX payload." />;
  }

  if (query.isError) {
    return <CustomerShellPanel title="Unavailable" description={query.error?.message || 'Unable to load the SpaceX payload.'} />;
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
    <CustomerShellPanel title={title} description="Snapshot metrics from the shared SpaceX loaders.">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {metrics.map((metric) => (
          <CustomerShellMetric key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </View>
    </CustomerShellPanel>
  );
}

function MissionCardsPanel() {
  const router = useRouter();

  return (
    <CustomerShellPanel title="Mission hubs" description="Mission-specific native routes are available for the current SpaceX families.">
      <View style={{ gap: 10 }}>
        {SPACE_X_MISSIONS.map((mission) => (
          <ProgramRow
            key={mission.key}
            title={mission.title}
            body={mission.description}
            onPress={() => router.push(buildSpaceXMissionHref(mission.key) as Href)}
          />
        ))}
      </View>
    </CustomerShellPanel>
  );
}

function FlightPreviewPanel({ flights }: { flights: SpaceXOverviewV1['flights'] }) {
  return (
    <CustomerShellPanel title="Flights" description={`${flights.length} flight record${flights.length === 1 ? '' : 's'} in preview.`}>
      <FlightList flights={flights} />
    </CustomerShellPanel>
  );
}

function FlightList({
  flights
}: {
  flights: SpaceXOverviewV1['flights'] | SpaceXFlightsResponseV1['items'];
}) {
  const router = useRouter();

  return (
    <View style={{ gap: 10 }}>
      {flights.map((flight) => (
        <SimpleRow
          key={flight.id}
          title={flight.launch.name}
          body={[flight.missionLabel, flight.launch.net ? formatDate(flight.launch.net) : null, flight.droneShipName || flight.droneShipAbbrev, flight.launch.statusText].filter(Boolean).join(' • ') || 'Flight record'}
          meta="Open flight route"
          onPress={() => router.push(buildSpaceXFlightHref(flight.flightSlug) as Href)}
        />
      ))}
    </View>
  );
}

function LaunchRowsPanel({
  title,
  description,
  launches
}: {
  title: string;
  description: string;
  launches: SpaceXMissionOverviewV1['snapshot']['upcoming'] | SpaceXMissionOverviewV1['snapshot']['recent'];
}) {
  const router = useRouter();
  return (
    <CustomerShellPanel title={title} description={description}>
      <View style={{ gap: 10 }}>
        {launches.length ? (
          launches.slice(0, 8).map((launch) => (
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

function ContractsPanel({ contracts }: { contracts: SpaceXMissionOverviewV1['contracts'] }) {
  const router = useRouter();
  return (
    <CustomerShellPanel title="Contracts" description={`${contracts.length} contract record${contracts.length === 1 ? '' : 's'} available.`}>
      <View style={{ gap: 10 }}>
        {contracts.length ? (
          contracts.map((contract) => (
            <SimpleRow
              key={contract.id}
              title={contract.title}
              body={[contract.agency || contract.customer || 'Public record', contract.awardedOn ? formatDate(contract.awardedOn) : null, contract.status].filter(Boolean).join(' • ') || 'Contract record'}
              meta="Open contract detail"
              onPress={() => router.push(buildSpaceXContractHref(contract.contractKey) as Href)}
            />
          ))
        ) : (
          <TextBlock value="No contract records are currently available." />
        )}
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
  launch: SpaceXOverviewV1['snapshot']['nextLaunch'] | SpaceXMissionOverviewV1['snapshot']['nextLaunch'];
}) {
  const router = useRouter();
  return (
    <CustomerShellPanel title={title} description={description}>
      {launch ? (
        <SimpleRow
          title={launch.name}
          body={[launch.vehicle, launch.padShortCode, formatDate(launch.net), launch.statusText].filter(Boolean).join(' • ')}
          meta="Open launch detail"
          onPress={() => router.push(launch.href as Href)}
        />
      ) : (
        <TextBlock value="No linked SpaceX launch is currently available." />
      )}
    </CustomerShellPanel>
  );
}

function ProgramRow({
  title,
  body,
  onPress
}: {
  title: string;
  body: string;
  onPress: () => void;
}) {
  return <SimpleRow title={title} body={body} meta="Open" onPress={onPress} />;
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
      <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{title}</Text>
      {body ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{body}</Text> : null}
      {meta ? <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>{meta}</Text> : null}
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
