import {
  spaceXContractsResponseSchemaV1,
  spaceXEnginesResponseSchemaV1,
  spaceXFlightsResponseSchemaV1,
  spaceXMissionOverviewSchemaV1,
  spaceXOverviewSchemaV1,
  spaceXVehiclesResponseSchemaV1,
  type SpaceXMissionKeyV1
} from '@tminuszero/contracts';
import {
  fetchSpaceXContracts,
  fetchSpaceXEngines,
  fetchSpaceXFlights,
  fetchSpaceXMissionSnapshot,
  fetchSpaceXPassengers,
  fetchSpaceXPayloads,
  fetchSpaceXProgramSnapshot,
  fetchSpaceXVehicles,
  parseSpaceXMissionKey
} from '@/lib/server/spacexProgram';
import type { Launch } from '@/lib/types/launch';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { buildSpaceXFlightSlug, getSpaceXMissionKeyFromLaunch, getSpaceXMissionLabel, parseSpaceXMissionFilter } from '@/lib/utils/spacexProgram';

const SPACE_X_MISSIONS: Array<{
  missionKey: Exclude<SpaceXMissionKeyV1, 'spacex-program'>;
  title: string;
  description: string;
  statusLabel: string;
  highlight: string | null;
}> = [
  {
    missionKey: 'starship',
    title: 'Starship',
    description: 'Flight-test cadence, heavy-lift architecture, and mission-linked updates.',
    statusLabel: 'Flight test',
    highlight: 'Integrated mission tracking'
  },
  {
    missionKey: 'falcon-9',
    title: 'Falcon 9',
    description: 'Reusable launch cadence, manifest-linked missions, and recovery context.',
    statusLabel: 'Operational',
    highlight: 'High launch cadence'
  },
  {
    missionKey: 'falcon-heavy',
    title: 'Falcon Heavy',
    description: 'Heavy-lift mission routing, payload context, and milestone tracking.',
    statusLabel: 'Heavy lift',
    highlight: 'Mission-linked payload context'
  },
  {
    missionKey: 'dragon',
    title: 'Dragon',
    description: 'Crew and cargo transportation missions with passenger-linked records.',
    statusLabel: 'Crew + cargo',
    highlight: 'Passenger and payload coverage'
  }
];

export function normalizeSpaceXMobileMissionParam(value: string | null | undefined) {
  const parsed = parseSpaceXMissionKey(value);
  if (!parsed || parsed === 'spacex-program') return null;
  return parsed;
}

function mapLaunchSummary(launch: Launch) {
  return {
    id: launch.id,
    name: launch.name,
    provider: launch.provider,
    vehicle: launch.vehicle,
    net: launch.net,
    netPrecision: launch.netPrecision,
    status: launch.status,
    statusText: launch.statusText,
    imageUrl: launch.image?.thumbnail || null,
    padName: launch.pad?.name || null,
    padShortCode: launch.pad?.shortCode || null,
    padLocation: launch.pad?.locationName || null,
    missionName: launch.mission?.name || null,
    missionKey: getSpaceXMissionKeyFromLaunch(launch),
    flightSlug: buildSpaceXFlightSlug(launch),
    href: buildLaunchHref(launch)
  };
}

function buildMissionCards() {
  return SPACE_X_MISSIONS.map((mission) => ({
    missionKey: mission.missionKey,
    title: mission.title,
    description: mission.description,
    href: `/spacex/missions/${mission.missionKey}`,
    statusLabel: mission.statusLabel,
    highlight: mission.highlight
  }));
}

export async function loadSpaceXOverviewPayload() {
  const [snapshot, flights, vehicles, engines, contracts, passengers, payloads] = await Promise.all([
    fetchSpaceXProgramSnapshot(),
    fetchSpaceXFlights('all'),
    fetchSpaceXVehicles('all'),
    fetchSpaceXEngines('all'),
    fetchSpaceXContracts('all'),
    fetchSpaceXPassengers('all'),
    fetchSpaceXPayloads('all')
  ]);

  return spaceXOverviewSchemaV1.parse({
    generatedAt: snapshot.generatedAt,
    title: 'SpaceX',
    description: 'Native program hub with mission, flight, hardware, and contract entry points for SpaceX coverage.',
    snapshot: {
      generatedAt: snapshot.generatedAt,
      lastUpdated: snapshot.lastUpdated,
      nextLaunch: snapshot.nextLaunch ? mapLaunchSummary(snapshot.nextLaunch) : null,
      upcoming: snapshot.upcoming.map(mapLaunchSummary),
      recent: snapshot.recent.map(mapLaunchSummary),
      faq: snapshot.faq
    },
    stats: {
      upcomingLaunches: snapshot.upcoming.length,
      recentLaunches: snapshot.recent.length,
      flights: flights.items.length,
      vehicles: vehicles.items.length,
      engines: engines.items.length,
      passengers: passengers.items.length,
      payloads: payloads.items.length,
      contracts: contracts.items.length
    },
    missions: buildMissionCards(),
    flights: flights.items.slice(0, 12).map((flight) => ({
      ...flight,
      launch: mapLaunchSummary(flight.launch)
    })),
    vehicles: vehicles.items,
    engines: engines.items,
    contracts: contracts.items.slice(0, 8)
  });
}

export async function loadSpaceXMissionOverviewPayload(missionKey: Exclude<SpaceXMissionKeyV1, 'spacex-program'>) {
  const [snapshot, passengers, payloads, contracts] = await Promise.all([
    fetchSpaceXMissionSnapshot(missionKey),
    fetchSpaceXPassengers(missionKey),
    fetchSpaceXPayloads(missionKey),
    fetchSpaceXContracts(missionKey)
  ]);

  return spaceXMissionOverviewSchemaV1.parse({
    generatedAt: snapshot.generatedAt,
    title: getSpaceXMissionLabel(missionKey),
    description: `${getSpaceXMissionLabel(missionKey)} mission snapshot with linked launch, passenger, payload, and contract records.`,
    snapshot: {
      generatedAt: snapshot.generatedAt,
      lastUpdated: snapshot.lastUpdated,
      missionKey: snapshot.missionKey,
      missionName: snapshot.missionName,
      nextLaunch: snapshot.nextLaunch ? mapLaunchSummary(snapshot.nextLaunch) : null,
      upcoming: snapshot.upcoming.map(mapLaunchSummary),
      recent: snapshot.recent.map(mapLaunchSummary),
      highlights: snapshot.highlights,
      faq: snapshot.faq
    },
    passengers: passengers.items,
    payloads: payloads.items,
    contracts: contracts.items
  });
}

export async function loadSpaceXFlightsPayload(mission: string | null) {
  const parsedMission = parseSpaceXMissionFilter(mission);
  if (!parsedMission) return null;
  const payload = await fetchSpaceXFlights(parsedMission);
  return spaceXFlightsResponseSchemaV1.parse({
    ...payload,
    items: payload.items.map((flight) => ({
      ...flight,
      launch: mapLaunchSummary(flight.launch)
    }))
  });
}

export async function loadSpaceXVehiclesPayload(mission: string | null) {
  const parsedMission = parseSpaceXMissionFilter(mission);
  if (!parsedMission) return null;
  return spaceXVehiclesResponseSchemaV1.parse(await fetchSpaceXVehicles(parsedMission));
}

export async function loadSpaceXEnginesPayload(mission: string | null) {
  const parsedMission = parseSpaceXMissionFilter(mission);
  if (!parsedMission) return null;
  return spaceXEnginesResponseSchemaV1.parse(await fetchSpaceXEngines(parsedMission));
}

export async function loadSpaceXContractsPayload(mission: string | null) {
  const parsedMission = parseSpaceXMissionFilter(mission);
  if (!parsedMission) return null;
  return spaceXContractsResponseSchemaV1.parse(await fetchSpaceXContracts(parsedMission));
}
