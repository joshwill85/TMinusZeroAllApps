import { useEffect, type ReactNode } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import {
  useSpaceXContractsQuery,
  useSpaceXEnginesQuery,
  useSpaceXFlightsQuery,
  useSpaceXVehiclesQuery
} from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import {
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
  normalizeSpaceXContractParam,
  normalizeSpaceXEngineParam,
  normalizeSpaceXFlightParam,
  normalizeSpaceXVehicleParam,
  SPACE_X_VEHICLE_ENGINES,
  spaceXMissionLabel
} from './spacexRoutes';

type QueryState<T> = {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
};

export {
  normalizeSpaceXContractParam,
  normalizeSpaceXEngineParam,
  normalizeSpaceXFlightParam,
  normalizeSpaceXVehicleParam
};

export function SpaceXFlightRouteScreen({ slug }: { slug: string }) {
  const router = useRouter();
  const flightsQuery = useSpaceXFlightsQuery({ mission: 'all' });
  const flight = flightsQuery.data?.items.find((entry) => entry.flightSlug === slug) ?? null;
  const launchHref = flight?.launch.href ?? null;

  useEffect(() => {
    if (!launchHref) return;
    router.replace(launchHref as Href);
  }, [launchHref, router]);

  return (
    <AppScreen testID="spacex-flight-route-screen">
      <CustomerShellHero
        eyebrow="SpaceX Flight"
        title={flight?.launch.name || 'Flight route'}
        description="Native resolver for SpaceX flight slugs. Linked launches hand off into the shared launch-detail screen."
      />
      {renderQueryState(flightsQuery, {
        emptyTitle: 'Flight unavailable',
        emptyDescription: 'The requested SpaceX flight record is not available on mobile.',
        render: () => {
          if (!flight) {
            return <CustomerShellPanel title="Flight unavailable" description="The requested SpaceX flight record is not available on mobile." />;
          }

          if (launchHref) {
            return (
              <CustomerShellPanel
                title="Routing to launch detail"
                description={`${flight.launch.name} is linked to a launch. Mobile is handing off to the native launch-detail screen.`}
              />
            );
          }

          return (
            <>
              <MetricsPanel
                title="Flight record"
                metrics={[
                  { label: 'Mission', value: flight.missionLabel },
                  { label: 'Status', value: flight.launch.statusText || 'Pending' }
                ]}
              />
              <CustomerShellPanel title="Snapshot" description="This flight route does not currently have a linked native launch detail payload.">
                <View style={{ gap: 10 }}>
                  <DetailRow
                    title={flight.launch.name}
                    body={[
                      flight.launch.net ? formatDate(flight.launch.net) : null,
                      flight.droneShipName || flight.droneShipAbbrev,
                      flight.launch.statusText
                    ]
                      .filter(Boolean)
                      .join(' • ') || 'Flight record'}
                  />
                  <DetailRow
                    title={`${flight.missionLabel} mission hub`}
                    body="Open the native SpaceX mission route linked to this flight."
                    meta="Open mission hub"
                    onPress={() => router.push(buildSpaceXMissionHref(flight.missionKey) as Href)}
                  />
                </View>
              </CustomerShellPanel>
            </>
          );
        }
      })}
    </AppScreen>
  );
}

export function SpaceXVehicleDetailScreen({ slug }: { slug: string }) {
  const router = useRouter();
  const vehiclesQuery = useSpaceXVehiclesQuery({ mission: 'all' });
  const enginesQuery = useSpaceXEnginesQuery({ mission: 'all' });
  const flightsQuery = useSpaceXFlightsQuery({ mission: 'all' });
  const vehicle = vehiclesQuery.data?.items.find((entry) => entry.vehicleSlug === slug) ?? null;
  const relatedEngineSlugs = vehicle ? SPACE_X_VEHICLE_ENGINES[vehicle.vehicleSlug] || [] : [];
  const relatedEngines = (enginesQuery.data?.items ?? []).filter((entry) => relatedEngineSlugs.includes(entry.engineSlug));
  const relatedFlights = vehicle
    ? (flightsQuery.data?.items ?? []).filter((entry) => entry.missionKey === vehicle.missionKey).slice(0, 8)
    : [];

  return (
    <AppScreen testID="spacex-vehicle-detail-screen">
      <CustomerShellHero
        eyebrow="SpaceX Vehicle"
        title={vehicle?.displayName || 'Vehicle profile'}
        description="Native vehicle profile backed by the shared SpaceX entity index."
      />
      {renderQueryState(vehiclesQuery, {
        emptyTitle: 'Vehicle unavailable',
        emptyDescription: 'The requested SpaceX vehicle profile is not available on mobile.',
        render: () => {
          if (!vehicle) {
            return <CustomerShellPanel title="Vehicle unavailable" description="The requested SpaceX vehicle profile is not available on mobile." />;
          }

          return (
            <>
              <MetricsPanel
                title="Vehicle status"
                metrics={[
                  { label: 'Mission', value: spaceXMissionLabel(vehicle.missionKey) },
                  { label: 'Status', value: vehicle.status || 'Pending' },
                  { label: 'First flight', value: vehicle.firstFlight ? formatDate(vehicle.firstFlight) : 'TBD' }
                ]}
              />

              <CustomerShellPanel title="Profile summary" description="Mission route and official source links for this vehicle.">
                <View style={{ gap: 10 }}>
                  <DetailRow
                    title={vehicle.displayName}
                    body={vehicle.description || [vehicle.vehicleClass, vehicle.status].filter(Boolean).join(' • ') || 'Vehicle profile'}
                  />
                  <DetailRow
                    title={`${spaceXMissionLabel(vehicle.missionKey)} mission hub`}
                    body="Open the native SpaceX mission route for this vehicle family."
                    meta="Open mission hub"
                    onPress={() => router.push(buildSpaceXMissionHref(vehicle.missionKey) as Href)}
                  />
                  {vehicle.officialUrl ? (
                    <DetailRow
                      title="Official vehicle page"
                      body={vehicle.officialUrl}
                      meta="Open source"
                      onPress={() => void Linking.openURL(vehicle.officialUrl || '')}
                    />
                  ) : null}
                </View>
              </CustomerShellPanel>

              <CustomerShellPanel title="Linked engines" description={`${relatedEngines.length} linked engine record${relatedEngines.length === 1 ? '' : 's'} available.`}>
                <View style={{ gap: 10 }}>
                  {relatedEngines.length ? (
                    relatedEngines.map((engine) => (
                      <DetailRow
                        key={engine.id}
                        title={engine.displayName}
                        body={[engine.cycle, engine.propellants, engine.status].filter(Boolean).join(' • ') || 'Engine profile'}
                        meta="Open engine profile"
                        onPress={() => router.push(buildSpaceXEngineHref(engine.engineSlug) as Href)}
                      />
                    ))
                  ) : (
                    <TextBlock value="No linked engine records are currently available on mobile." />
                  )}
                </View>
              </CustomerShellPanel>

              <CustomerShellPanel title="Mission flights" description={`${relatedFlights.length} mission-linked flight record${relatedFlights.length === 1 ? '' : 's'} available.`}>
                <View style={{ gap: 10 }}>
                  {relatedFlights.length ? (
                    relatedFlights.map((flight) => (
                      <DetailRow
                        key={flight.id}
                        title={flight.launch.name}
                        body={[flight.launch.net ? formatDate(flight.launch.net) : null, flight.launch.statusText].filter(Boolean).join(' • ') || 'Flight record'}
                        meta="Open flight route"
                        onPress={() => router.push(buildSpaceXFlightHref(flight.flightSlug) as Href)}
                      />
                    ))
                  ) : (
                    <TextBlock value="No mission-linked flight records are currently available on mobile." />
                  )}
                </View>
              </CustomerShellPanel>
            </>
          );
        }
      })}
    </AppScreen>
  );
}

export function SpaceXEngineDetailScreen({ slug }: { slug: string }) {
  const router = useRouter();
  const enginesQuery = useSpaceXEnginesQuery({ mission: 'all' });
  const vehiclesQuery = useSpaceXVehiclesQuery({ mission: 'all' });
  const flightsQuery = useSpaceXFlightsQuery({ mission: 'all' });
  const contractsQuery = useSpaceXContractsQuery({ mission: 'all' });
  const engine = enginesQuery.data?.items.find((entry) => entry.engineSlug === slug) ?? null;
  const relatedVehicles = engine
    ? (vehiclesQuery.data?.items ?? []).filter((entry) => (SPACE_X_VEHICLE_ENGINES[entry.vehicleSlug] || []).includes(engine.engineSlug))
    : [];
  const relatedFlights = engine
    ? (flightsQuery.data?.items ?? []).filter((entry) => entry.missionKey === engine.missionKey).slice(0, 8)
    : [];
  const relatedContracts = engine
    ? (contractsQuery.data?.items ?? []).filter((entry) => entry.missionKey === engine.missionKey).slice(0, 8)
    : [];

  return (
    <AppScreen testID="spacex-engine-detail-screen">
      <CustomerShellHero
        eyebrow="SpaceX Engine"
        title={engine?.displayName || 'Engine profile'}
        description="Native engine profile backed by the shared SpaceX entity index."
      />
      {renderQueryState(enginesQuery, {
        emptyTitle: 'Engine unavailable',
        emptyDescription: 'The requested SpaceX engine profile is not available on mobile.',
        render: () => {
          if (!engine) {
            return <CustomerShellPanel title="Engine unavailable" description="The requested SpaceX engine profile is not available on mobile." />;
          }

          return (
            <>
              <MetricsPanel
                title="Engine status"
                metrics={[
                  { label: 'Mission', value: spaceXMissionLabel(engine.missionKey) },
                  { label: 'Cycle', value: engine.cycle || 'N/A' },
                  { label: 'Status', value: engine.status || 'Pending' }
                ]}
              />

              <CustomerShellPanel title="Profile summary" description="Mission route and official source links for this engine.">
                <View style={{ gap: 10 }}>
                  <DetailRow
                    title={engine.displayName}
                    body={engine.description || [engine.propellants, engine.status].filter(Boolean).join(' • ') || 'Engine profile'}
                  />
                  <DetailRow
                    title={`${spaceXMissionLabel(engine.missionKey)} mission hub`}
                    body="Open the native SpaceX mission route for this engine family."
                    meta="Open mission hub"
                    onPress={() => router.push(buildSpaceXMissionHref(engine.missionKey) as Href)}
                  />
                  {engine.officialUrl ? (
                    <DetailRow
                      title="Official engine page"
                      body={engine.officialUrl}
                      meta="Open source"
                      onPress={() => void Linking.openURL(engine.officialUrl || '')}
                    />
                  ) : null}
                </View>
              </CustomerShellPanel>

              <CustomerShellPanel title="Linked vehicles" description={`${relatedVehicles.length} linked vehicle record${relatedVehicles.length === 1 ? '' : 's'} available.`}>
                <View style={{ gap: 10 }}>
                  {relatedVehicles.length ? (
                    relatedVehicles.map((vehicle) => (
                      <DetailRow
                        key={vehicle.id}
                        title={vehicle.displayName}
                        body={[vehicle.vehicleClass, vehicle.status, vehicle.firstFlight ? formatDate(vehicle.firstFlight) : null].filter(Boolean).join(' • ') || 'Vehicle profile'}
                        meta="Open vehicle profile"
                        onPress={() => router.push(buildSpaceXVehicleHref(vehicle.vehicleSlug) as Href)}
                      />
                    ))
                  ) : (
                    <TextBlock value="No linked vehicle records are currently available on mobile." />
                  )}
                </View>
              </CustomerShellPanel>

              <CustomerShellPanel title="Related mission records" description="Flights and contracts sharing this engine mission family.">
                <View style={{ gap: 10 }}>
                  {relatedFlights.map((flight) => (
                    <DetailRow
                      key={flight.id}
                      title={flight.launch.name}
                      body={[flight.launch.net ? formatDate(flight.launch.net) : null, flight.launch.statusText].filter(Boolean).join(' • ') || 'Flight record'}
                      meta="Open flight route"
                      onPress={() => router.push(buildSpaceXFlightHref(flight.flightSlug) as Href)}
                    />
                  ))}
                  {relatedContracts.map((contract) => (
                    <DetailRow
                      key={contract.id}
                      title={contract.title}
                      body={[contract.agency || contract.customer || 'Public record', contract.awardedOn ? formatDate(contract.awardedOn) : null, contract.status].filter(Boolean).join(' • ') || 'Contract record'}
                      meta="Open contract detail"
                      onPress={() => router.push(buildSpaceXContractHref(contract.contractKey) as Href)}
                    />
                  ))}
                  {relatedFlights.length === 0 && relatedContracts.length === 0 ? (
                    <TextBlock value="No related mission records are currently available on mobile." />
                  ) : null}
                </View>
              </CustomerShellPanel>
            </>
          );
        }
      })}
    </AppScreen>
  );
}

export function SpaceXContractDetailScreen({ slug }: { slug: string }) {
  const router = useRouter();
  const contractsQuery = useSpaceXContractsQuery({ mission: 'all' });
  const flightsQuery = useSpaceXFlightsQuery({ mission: 'all' });
  const contract = contractsQuery.data?.items.find((entry) => normalizeSpaceXContractParam(entry.contractKey) === slug) ?? null;
  const relatedFlights = contract
    ? (flightsQuery.data?.items ?? []).filter((entry) => entry.missionKey === contract.missionKey).slice(0, 8)
    : [];

  return (
    <AppScreen testID="spacex-contract-detail-screen">
      <CustomerShellHero
        eyebrow="SpaceX Contract"
        title={contract?.title || 'Contract detail'}
        description="Native contract detail backed by the shared SpaceX contracts index."
      />
      {renderQueryState(contractsQuery, {
        emptyTitle: 'Contract unavailable',
        emptyDescription: 'The requested SpaceX contract record is not available on mobile.',
        render: () => {
          if (!contract) {
            return <CustomerShellPanel title="Contract unavailable" description="The requested SpaceX contract record is not available on mobile." />;
          }

          return (
            <>
              <MetricsPanel
                title="Award profile"
                metrics={[
                  { label: 'Mission', value: spaceXMissionLabel(contract.missionKey) },
                  { label: 'Status', value: contract.status || 'Pending' },
                  { label: 'Awarded', value: contract.awardedOn ? formatDate(contract.awardedOn) : 'TBD' }
                ]}
              />

              <CustomerShellPanel title="Contract summary" description="Public contract fields available in the shared mobile payload.">
                <View style={{ gap: 10 }}>
                  <DetailRow
                    title={contract.contractKey}
                    body={contract.description || [contract.agency || contract.customer || 'Public record', contract.status].filter(Boolean).join(' • ') || 'Contract record'}
                  />
                  <DetailRow
                    title={`${spaceXMissionLabel(contract.missionKey)} mission hub`}
                    body="Open the native SpaceX mission route linked to this contract."
                    meta="Open mission hub"
                    onPress={() => router.push(buildSpaceXMissionHref(contract.missionKey) as Href)}
                  />
                  {contract.sourceUrl ? (
                    <DetailRow
                      title={contract.sourceLabel || 'Source record'}
                      body={contract.sourceUrl}
                      meta="Open source"
                      onPress={() => void Linking.openURL(contract.sourceUrl || '')}
                    />
                  ) : null}
                  {typeof contract.amount === 'number' ? (
                    <DetailRow title="Amount" body={formatCurrency(contract.amount)} />
                  ) : null}
                </View>
              </CustomerShellPanel>

              <CustomerShellPanel title="Related flights" description={`${relatedFlights.length} mission-linked flight record${relatedFlights.length === 1 ? '' : 's'} available.`}>
                <View style={{ gap: 10 }}>
                  {relatedFlights.length ? (
                    relatedFlights.map((flight) => (
                      <DetailRow
                        key={flight.id}
                        title={flight.launch.name}
                        body={[flight.launch.net ? formatDate(flight.launch.net) : null, flight.launch.statusText].filter(Boolean).join(' • ') || 'Flight record'}
                        meta="Open flight route"
                        onPress={() => router.push(buildSpaceXFlightHref(flight.flightSlug) as Href)}
                      />
                    ))
                  ) : (
                    <TextBlock value="No mission-linked flight records are currently available on mobile." />
                  )}
                </View>
              </CustomerShellPanel>
            </>
          );
        }
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
    <CustomerShellPanel title={title} description="Snapshot fields available in the current native payload.">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {metrics.map((metric) => (
          <CustomerShellMetric key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </View>
    </CustomerShellPanel>
  );
}

function DetailRow({
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

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
}
