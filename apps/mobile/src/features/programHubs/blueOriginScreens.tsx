import type { ReactNode } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type {
  BlueOriginContractsResponseV1,
  BlueOriginFlightsResponseV1,
  BlueOriginMissionKeyV1,
  BlueOriginMissionOverviewV1,
  BlueOriginOverviewV1
} from '@tminuszero/api-client';
import { buildLaunchHref } from '@tminuszero/navigation';
import {
  useBlueOriginContractsQuery,
  useBlueOriginEnginesQuery,
  useBlueOriginFlightsQuery,
  useBlueOriginMissionOverviewQuery,
  useBlueOriginOverviewQuery,
  useBlueOriginTravelersQuery,
  useBlueOriginVehiclesQuery
} from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellMetric,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

const BLUE_ORIGIN_MISSIONS: Array<{
  key: Exclude<BlueOriginMissionKeyV1, 'blue-origin-program'>;
  title: string;
  description: string;
}> = [
  {
    key: 'new-shepard',
    title: 'New Shepard',
    description: 'Crewed suborbital flights, manifest history, and launch cadence.'
  },
  {
    key: 'new-glenn',
    title: 'New Glenn',
    description: 'Orbital launcher schedule, mission tracking, and procurement context.'
  },
  {
    key: 'blue-moon',
    title: 'Blue Moon',
    description: 'Lunar lander milestones, Artemis-linked records, and mission evidence.'
  },
  {
    key: 'blue-ring',
    title: 'Blue Ring',
    description: 'In-space logistics milestones and supporting program signals.'
  },
  {
    key: 'be-4',
    title: 'BE-4',
    description: 'Engine program deployment context and launch-system integration.'
  }
];

export function normalizeBlueOriginMissionParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');

  return BLUE_ORIGIN_MISSIONS.find((mission) => mission.key === normalized)?.key ?? null;
}

type QueryState<T> = {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
};

export function BlueOriginHubScreen() {
  const router = useRouter();
  const overviewQuery = useBlueOriginOverviewQuery();

  return (
    <AppScreen testID="blue-origin-hub-screen">
      <CustomerShellHero
        eyebrow="Program Hub"
        title="Blue Origin"
        description="Native mission, flight, traveler, hardware, contract, and content entry points for the Blue Origin hub."
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label="Native beta" tone="accent" />
          <CustomerShellBadge label="Rollout gated" tone="warning" />
        </View>
      </CustomerShellHero>

      {renderQueryState(overviewQuery, {
        emptyTitle: 'Blue Origin unavailable',
        emptyDescription: 'No Blue Origin overview payload is currently available.',
        render: (payload) => (
          <>
            <CustomerShellPanel title="Program status" description="Snapshot metrics from the shared Blue Origin loaders.">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                <CustomerShellMetric label="Upcoming" value={String(payload.stats.upcomingLaunches)} />
                <CustomerShellMetric label="Flights" value={String(payload.stats.flights)} />
                <CustomerShellMetric label="Travelers" value={String(payload.stats.travelers)} />
                <CustomerShellMetric label="Contracts" value={String(payload.stats.contracts)} />
              </View>
            </CustomerShellPanel>

            <CustomerShellPanel title="Native routes" description="These mirror the current web pathname family and stay behind rollout flags.">
              <View style={{ gap: 10 }}>
                <ProgramRow title="Flights" body="Mission flight records and direct handoff into native launch detail." onPress={() => router.push('/blue-origin/flights' as Href)} />
                <ProgramRow title="Travelers" body="Crew and passenger directory sourced from the Blue Origin traveler index." onPress={() => router.push('/blue-origin/travelers' as Href)} />
                <ProgramRow title="Vehicles" body="Vehicle catalog for New Shepard, New Glenn, Blue Moon, and Blue Ring." onPress={() => router.push('/blue-origin/vehicles' as Href)} />
                <ProgramRow title="Engines" body="BE-3 and BE-4 engine catalog with mission linkage." onPress={() => router.push('/blue-origin/engines' as Href)} />
                <ProgramRow title="Contracts" body="Program and mission contracts, awards, and public-record summaries." onPress={() => router.push('/blue-origin/contracts' as Href)} />
                <ProgramRow title="Missions" body="Mission-specific hubs for New Shepard, New Glenn, Blue Moon, Blue Ring, and BE-4." onPress={() => router.push('/blue-origin/missions' as Href)} />
              </View>
            </CustomerShellPanel>

            <LaunchSummaryPanel
              title="Next launch"
              description="The next Blue Origin launch routed through the shared launch-detail screen."
              launch={payload.snapshot.nextLaunch}
            />

            <FlightPreviewPanel flights={payload.flights.slice(0, 8)} />
            <TravelerPreviewPanel travelers={payload.travelers.slice(0, 8)} />
            <ContractPreviewPanel contracts={payload.contracts.slice(0, 6)} />
            <MissionCardsPanel />
          </>
        )
      })}
    </AppScreen>
  );
}

export function BlueOriginFlightsScreen() {
  const flightsQuery = useBlueOriginFlightsQuery({ mission: 'all' });

  return (
    <ProgramListScreen
      testID="blue-origin-flights-screen"
      eyebrow="Blue Origin"
      title="Flights"
      description="Flight records backed by the shared Blue Origin flights index. Flights with a linked launch land in the native launch-detail screen."
      query={flightsQuery}
      emptyTitle="No Blue Origin flights"
      emptyDescription="No flight records are currently available."
      render={(payload) => <FlightList flights={payload.items} />}
    />
  );
}

export function BlueOriginTravelersScreen() {
  const travelersQuery = useBlueOriginTravelersQuery();

  return (
    <ProgramListScreen
      testID="blue-origin-travelers-screen"
      eyebrow="Blue Origin"
      title="Travelers"
      description="Crew and passenger records from the Blue Origin traveler directory."
      query={travelersQuery}
      emptyTitle="No Blue Origin travelers"
      emptyDescription="No traveler records are currently available."
      render={(payload) => (
        <CustomerShellPanel title="Traveler directory" description={`${payload.items.length} traveler profiles available.`}>
          <View style={{ gap: 10 }}>
            {payload.items.map((traveler) => (
              <SimpleRow
                key={traveler.travelerSlug}
                title={traveler.name}
                body={[traveler.roles[0] || 'Crew', traveler.latestFlightCode?.toUpperCase() || null, traveler.latestLaunchDate ? formatDate(traveler.latestLaunchDate) : null].filter(Boolean).join(' • ')}
                meta={`${traveler.flightCount} flight${traveler.flightCount === 1 ? '' : 's'}`}
              />
            ))}
          </View>
        </CustomerShellPanel>
      )}
    />
  );
}

export function BlueOriginVehiclesScreen() {
  const vehiclesQuery = useBlueOriginVehiclesQuery({ mission: 'all' });

  return (
    <ProgramListScreen
      testID="blue-origin-vehicles-screen"
      eyebrow="Blue Origin"
      title="Vehicles"
      description="Vehicle catalog backed by the shared Blue Origin entity index."
      query={vehiclesQuery}
      emptyTitle="No Blue Origin vehicles"
      emptyDescription="No vehicle records are currently available."
      render={(payload) => (
        <CustomerShellPanel title="Vehicle catalog" description={`${payload.items.length} vehicle records available.`}>
          <View style={{ gap: 10 }}>
            {payload.items.map((vehicle) => (
              <SimpleRow
                key={vehicle.id}
                title={vehicle.displayName}
                body={[vehicle.vehicleClass, vehicle.status, vehicle.firstFlight ? formatDate(vehicle.firstFlight) : null].filter(Boolean).join(' • ') || 'Program vehicle'}
                meta={vehicle.officialUrl || null}
                onPress={vehicle.officialUrl ? () => void Linking.openURL(vehicle.officialUrl || '') : undefined}
              />
            ))}
          </View>
        </CustomerShellPanel>
      )}
    />
  );
}

export function BlueOriginEnginesScreen() {
  const enginesQuery = useBlueOriginEnginesQuery({ mission: 'all' });

  return (
    <ProgramListScreen
      testID="blue-origin-engines-screen"
      eyebrow="Blue Origin"
      title="Engines"
      description="Engine catalog backed by the shared Blue Origin entity index."
      query={enginesQuery}
      emptyTitle="No Blue Origin engines"
      emptyDescription="No engine records are currently available."
      render={(payload) => (
        <CustomerShellPanel title="Engine catalog" description={`${payload.items.length} engine records available.`}>
          <View style={{ gap: 10 }}>
            {payload.items.map((engine) => (
              <SimpleRow
                key={engine.id}
                title={engine.displayName}
                body={[engine.cycle, engine.propellants, engine.status].filter(Boolean).join(' • ') || 'Program engine'}
                meta={engine.officialUrl || null}
                onPress={engine.officialUrl ? () => void Linking.openURL(engine.officialUrl || '') : undefined}
              />
            ))}
          </View>
        </CustomerShellPanel>
      )}
    />
  );
}

export function BlueOriginContractsScreen() {
  const contractsQuery = useBlueOriginContractsQuery({ mission: 'all' });

  return (
    <ProgramListScreen
      testID="blue-origin-contracts-screen"
      eyebrow="Blue Origin"
      title="Contracts"
      description="Contract records backed by the shared Blue Origin contracts index."
      query={contractsQuery}
      emptyTitle="No Blue Origin contracts"
      emptyDescription="No contract records are currently available."
      render={(payload) => (
        <CustomerShellPanel title="Contract ledger" description={`${payload.items.length} contract records available.`}>
          <View style={{ gap: 10 }}>
            {payload.items.map((contract) => (
              <SimpleRow
                key={contract.id}
                title={contract.title}
                body={[contract.agency || contract.customer || 'Public record', contract.awardedOn ? formatDate(contract.awardedOn) : null, contract.status].filter(Boolean).join(' • ')}
                meta={contract.sourceLabel || null}
                onPress={contract.sourceUrl ? () => void Linking.openURL(contract.sourceUrl || '') : undefined}
              />
            ))}
          </View>
        </CustomerShellPanel>
      )}
    />
  );
}

export function BlueOriginMissionsScreen() {
  const router = useRouter();

  return (
    <AppScreen testID="blue-origin-missions-screen">
      <CustomerShellHero
        eyebrow="Blue Origin"
        title="Missions"
        description="Mission-specific routes for New Shepard, New Glenn, Blue Moon, Blue Ring, and BE-4."
      />

      <CustomerShellPanel title="Mission hubs" description="Each mission route reuses the shared mission snapshot loaders and related program indexes.">
        <View style={{ gap: 10 }}>
          {BLUE_ORIGIN_MISSIONS.map((mission) => (
            <ProgramRow
              key={mission.key}
              title={mission.title}
              body={mission.description}
              onPress={() => router.push(`/blue-origin/missions/${mission.key}` as Href)}
            />
          ))}
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );
}

export function BlueOriginMissionScreen({
  mission
}: {
  mission: Exclude<BlueOriginMissionKeyV1, 'blue-origin-program'>;
}) {
  const missionQuery = useBlueOriginMissionOverviewQuery(mission);

  return (
    <ProgramListScreen
      testID={`blue-origin-mission-${mission}`}
      eyebrow="Blue Origin Mission"
      title={missionLabel(mission)}
      description="Mission snapshot, passengers, payloads, contracts, and recent content."
      query={missionQuery}
      emptyTitle="Mission unavailable"
      emptyDescription="The Blue Origin mission payload could not be loaded."
      render={(payload) => (
        <>
          <LaunchSummaryPanel
            title="Next launch"
            description="Shared mission snapshot routed to native launch detail when a launch exists."
            launch={payload.snapshot.nextLaunch}
          />

          <CustomerShellPanel title="Mission highlights" description={payload.description}>
            <View style={{ gap: 10 }}>
              {payload.snapshot.highlights.length ? (
                payload.snapshot.highlights.map((highlight) => <SimpleRow key={highlight} title={highlight} body="" />)
              ) : (
                <TextBlock value="No mission highlights are currently available." />
              )}
            </View>
          </CustomerShellPanel>

          <CustomerShellPanel title="Timeline changes" description="Recent mission deltas and tracked public updates.">
            <View style={{ gap: 10 }}>
              {payload.snapshot.changes.length ? (
                payload.snapshot.changes.map((change) => (
                  <SimpleRow
                    key={`${change.date}:${change.title}`}
                    title={change.title}
                    body={`${formatDate(change.date)} • ${change.summary}`}
                    onPress={change.href ? () => void Linking.openURL(change.href || '') : undefined}
                  />
                ))
              ) : (
                <TextBlock value="No tracked mission changes are currently available." />
              )}
            </View>
          </CustomerShellPanel>

          <CustomerShellPanel title="Passengers" description={`${payload.passengers.length} passenger record${payload.passengers.length === 1 ? '' : 's'} available.`}>
            <View style={{ gap: 10 }}>
              {payload.passengers.slice(0, 12).map((person) => (
                <SimpleRow
                  key={person.id}
                  title={person.name}
                  body={[person.role || 'Crew', person.flightCode?.toUpperCase() || null, person.launchDate ? formatDate(person.launchDate) : null].filter(Boolean).join(' • ')}
                />
              ))}
            </View>
          </CustomerShellPanel>

          <CustomerShellPanel title="Payloads" description={`${payload.payloads.length} payload record${payload.payloads.length === 1 ? '' : 's'} available.`}>
            <View style={{ gap: 10 }}>
              {payload.payloads.slice(0, 12).map((payloadItem) => (
                <SimpleRow
                  key={payloadItem.id}
                  title={payloadItem.name}
                  body={[payloadItem.payloadType, payloadItem.orbit, payloadItem.flightCode?.toUpperCase() || null].filter(Boolean).join(' • ') || 'Mission payload'}
                />
              ))}
            </View>
          </CustomerShellPanel>

          <ContractPreviewPanel contracts={payload.contracts.slice(0, 8)} />
        </>
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
    render: (payload: T) => React.ReactNode;
  }
) {
  if (query.isPending) {
    return <CustomerShellPanel title="Loading" description="Fetching the latest Blue Origin payload." />;
  }

  if (query.isError) {
    return <CustomerShellPanel title="Unavailable" description={query.error?.message || 'Unable to load the Blue Origin payload.'} />;
  }

  if (!query.data) {
    return <CustomerShellPanel title={options.emptyTitle} description={options.emptyDescription} />;
  }

  return options.render(query.data);
}

function MissionCardsPanel() {
  const router = useRouter();

  return (
    <CustomerShellPanel title="Mission hubs" description="Mission-specific native routes are available for the current Blue Origin families.">
      <View style={{ gap: 10 }}>
        {BLUE_ORIGIN_MISSIONS.map((mission) => (
          <ProgramRow
            key={mission.key}
            title={mission.title}
            body={mission.description}
            onPress={() => router.push(`/blue-origin/missions/${mission.key}` as Href)}
          />
        ))}
      </View>
    </CustomerShellPanel>
  );
}

function FlightPreviewPanel({ flights }: { flights: BlueOriginOverviewV1['flights'] }) {
  return (
    <CustomerShellPanel title="Flights" description={`${flights.length} recent or upcoming flight records in preview.`}>
      <FlightList flights={flights} />
    </CustomerShellPanel>
  );
}

function FlightList({
  flights
}: {
  flights: BlueOriginOverviewV1['flights'] | BlueOriginFlightsResponseV1['items'];
}) {
  const router = useRouter();

  return (
    <View style={{ gap: 10 }}>
      {flights.map((flight) => {
        const launchId = typeof flight.launchId === 'string' ? flight.launchId : null;

        return (
          <SimpleRow
            key={flight.id}
            title={`${flight.flightCode.toUpperCase()} • ${flight.missionLabel}`}
            body={[flight.launchName, flight.launchDate ? formatDate(flight.launchDate) : null, flight.status].filter(Boolean).join(' • ') || 'Flight record'}
            meta={launchId ? 'Open launch detail' : null}
            onPress={
              launchId
                ? () => {
                    router.push(buildLaunchHref(launchId) as Href);
                  }
                : undefined
            }
          />
        );
      })}
    </View>
  );
}

function TravelerPreviewPanel({ travelers }: { travelers: BlueOriginOverviewV1['travelers'] }) {
  return (
    <CustomerShellPanel title="Travelers" description={`${travelers.length} traveler profiles in preview.`}>
      <View style={{ gap: 10 }}>
        {travelers.map((traveler) => (
          <SimpleRow
            key={traveler.travelerSlug}
            title={traveler.name}
            body={[traveler.roles[0] || 'Crew', traveler.latestFlightCode?.toUpperCase() || null, traveler.latestLaunchDate ? formatDate(traveler.latestLaunchDate) : null].filter(Boolean).join(' • ')}
            meta={`${traveler.flightCount} flight${traveler.flightCount === 1 ? '' : 's'}`}
          />
        ))}
      </View>
    </CustomerShellPanel>
  );
}

function ContractPreviewPanel({
  contracts
}: {
  contracts: BlueOriginOverviewV1['contracts'] | BlueOriginMissionOverviewV1['contracts'] | BlueOriginContractsResponseV1['items'];
}) {
  return (
    <CustomerShellPanel title="Contracts" description={`${contracts.length} public contract records in view.`}>
      <View style={{ gap: 10 }}>
        {contracts.map((contract) => (
          <SimpleRow
            key={contract.id}
            title={contract.title}
            body={[contract.agency || contract.customer || 'Public record', contract.awardedOn ? formatDate(contract.awardedOn) : null, contract.status].filter(Boolean).join(' • ')}
            meta={contract.sourceLabel || null}
            onPress={contract.sourceUrl ? () => void Linking.openURL(contract.sourceUrl || '') : undefined}
          />
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
  launch: BlueOriginOverviewV1['snapshot']['nextLaunch'] | BlueOriginMissionOverviewV1['snapshot']['nextLaunch'];
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
        <TextBlock value="No linked Blue Origin launch is currently available." />
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

function missionLabel(mission: Exclude<BlueOriginMissionKeyV1, 'blue-origin-program'>) {
  return BLUE_ORIGIN_MISSIONS.find((entry) => entry.key === mission)?.title || mission;
}
