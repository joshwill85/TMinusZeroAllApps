import {
  blueOriginContractsResponseSchemaV1,
  blueOriginEnginesResponseSchemaV1,
  blueOriginFlightsResponseSchemaV1,
  blueOriginMissionOverviewSchemaV1,
  blueOriginOverviewSchemaV1,
  blueOriginTravelersResponseSchemaV1,
  blueOriginVehiclesResponseSchemaV1,
  type BlueOriginMissionKeyV1
} from '@tminuszero/contracts';
import { fetchBlueOriginFlightIndex, fetchBlueOriginMissionSnapshot, fetchBlueOriginProgramSnapshot } from '@/lib/server/blueOrigin';
import { fetchBlueOriginContentViewModel } from '@/lib/server/blueOriginContent';
import {
  fetchBlueOriginContracts,
  parseBlueOriginContractsMissionFilter
} from '@/lib/server/blueOriginContracts';
import {
  fetchBlueOriginEngines,
  fetchBlueOriginFlights,
  fetchBlueOriginVehicles,
  parseBlueOriginEntityMissionFilter
} from '@/lib/server/blueOriginEntities';
import { fetchBlueOriginPayloads, fetchBlueOriginPassengers } from '@/lib/server/blueOriginPeoplePayloads';
import { fetchBlueOriginTravelerIndex } from '@/lib/server/blueOriginTravelers';
import type { Launch } from '@/lib/types/launch';
import { extractBlueOriginFlightCode, getBlueOriginMissionKeyFromLaunch } from '@/lib/utils/blueOrigin';
import { buildLaunchHref } from '@/lib/utils/launchLinks';

const BLUE_ORIGIN_MOBILE_MISSIONS: Array<{
  missionKey: Exclude<BlueOriginMissionKeyV1, 'blue-origin-program'>;
  title: string;
  description: string;
}> = [
  {
    missionKey: 'new-shepard',
    title: 'New Shepard',
    description: "Blue Origin's crewed suborbital program with flight history, travelers, payloads, and timeline changes."
  },
  {
    missionKey: 'new-glenn',
    title: 'New Glenn',
    description: "Blue Origin's orbital heavy-lift program with launch cadence, procurement context, and flight tracking."
  },
  {
    missionKey: 'blue-moon',
    title: 'Blue Moon',
    description: "Blue Origin's lunar lander architecture with Artemis-linked contracts, milestones, and mission evidence."
  },
  {
    missionKey: 'blue-ring',
    title: 'Blue Ring',
    description: "Blue Origin's in-space logistics platform with public milestones and supporting mission signals."
  },
  {
    missionKey: 'be-4',
    title: 'BE-4',
    description: "Blue Origin's engine program with deployment context, public milestones, and related launch-system integration."
  }
];

const BLUE_ORIGIN_MISSION_META: Record<
  Exclude<BlueOriginMissionKeyV1, 'blue-origin-program'>,
  { title: string; description: string; summary: string }
> = {
  'new-shepard': {
    title: 'New Shepard',
    description: "Blue Origin's crewed suborbital mission archive, traveler manifest, and launch cadence.",
    summary:
      "New Shepard is Blue Origin's suborbital program. This hub tracks notable missions, who flew, payload manifests, launch schedule changes, and official mission evidence."
  },
  'new-glenn': {
    title: 'New Glenn',
    description: "Blue Origin's orbital launch program with launch windows, contracts context, and notable flight updates.",
    summary:
      "New Glenn is Blue Origin's orbital launch program. This hub tracks mission cadence, launch windows, contracts and government records, and notable flight updates."
  },
  'blue-moon': {
    title: 'Blue Moon',
    description: "Blue Origin's lunar lander architecture with NASA-linked milestones and contracting records.",
    summary:
      "Blue Moon is Blue Origin's lunar lander architecture. This hub tracks NASA-linked milestones, contract records, and program timeline updates."
  },
  'blue-ring': {
    title: 'Blue Ring',
    description: "Blue Origin's in-space logistics platform with public milestones and supporting program events.",
    summary:
      "Blue Ring is Blue Origin's in-space logistics platform. This page tracks key milestones, supporting program events, and source-backed mission updates."
  },
  'be-4': {
    title: 'BE-4',
    description: "Blue Origin's methane-oxygen engine program with deployment context and integration milestones.",
    summary:
      "BE-4 is Blue Origin's methane-oxygen engine program. This page tracks public milestones, deployment context, and related evidence for launch-system integration."
  }
};

export function normalizeBlueOriginMobileMissionParam(value: string | null | undefined) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');

  if (normalized === 'new-shepard' || normalized === 'newshepard' || normalized === 'shepard') return 'new-shepard';
  if (normalized === 'new-glenn' || normalized === 'newglenn' || normalized === 'glenn') return 'new-glenn';
  if (normalized === 'blue-moon' || normalized === 'bluemoon') return 'blue-moon';
  if (normalized === 'blue-ring' || normalized === 'bluering') return 'blue-ring';
  if (normalized === 'be-4' || normalized === 'be4') return 'be-4';
  return null;
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
    missionKey: getBlueOriginMissionKeyFromLaunch(launch),
    flightCode: extractBlueOriginFlightCode(launch),
    href: buildLaunchHref(launch)
  };
}

function buildMissionCards() {
  return BLUE_ORIGIN_MOBILE_MISSIONS.map((mission) => ({
    missionKey: mission.missionKey,
    title: mission.title,
    description: mission.description,
    href: `/blue-origin/missions/${mission.missionKey}`,
    statusLabel: mission.missionKey === 'new-shepard' ? 'Flight-rich' : mission.missionKey === 'new-glenn' ? 'Orbital' : 'Program',
    highlight: mission.missionKey === 'new-shepard' ? 'Crew + payload detail' : mission.missionKey === 'new-glenn' ? 'Contracts + launches' : null
  }));
}

export async function loadBlueOriginOverviewPayload() {
  const [snapshot, flights, travelers, vehicles, engines, contracts, content] = await Promise.all([
    fetchBlueOriginProgramSnapshot(),
    fetchBlueOriginFlightIndex(),
    fetchBlueOriginTravelerIndex(),
    fetchBlueOriginVehicles('all'),
    fetchBlueOriginEngines('all'),
    fetchBlueOriginContracts('all'),
    fetchBlueOriginContentViewModel({ mission: 'all', kind: 'all', limit: 12, cursor: null })
  ]);

  return blueOriginOverviewSchemaV1.parse({
    generatedAt: snapshot.generatedAt,
    title: 'Blue Origin',
    description: 'Native mission, flight, traveler, hardware, contract, and content entry points for the Blue Origin hub.',
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
      flights: flights.length,
      travelers: travelers.items.length,
      vehicles: vehicles.items.length,
      engines: engines.items.length,
      contracts: contracts.items.length,
      contentItems: content.items.length
    },
    missions: buildMissionCards(),
    flights: flights.map((flight) => ({
      id: `flight:${flight.flightSlug}`,
      flightCode: flight.flightCode,
      flightSlug: flight.flightSlug,
      missionKey: flight.missionKey,
      missionLabel: flight.missionLabel,
      launchId: flight.nextLaunch?.id || null,
      ll2LaunchUuid: null,
      launchName: flight.nextLaunch?.name || null,
      launchDate: flight.nextLaunch?.net || null,
      status: flight.nextLaunch?.statusText || null,
      officialMissionUrl: null,
      source: 'launches_public_cache',
      confidence: 'medium',
      metadata: {
        upcomingCount: flight.upcomingCount,
        recentCount: flight.recentCount
      },
      updatedAt: flight.lastUpdated
    })),
    travelers: travelers.items,
    vehicles: vehicles.items,
    engines: engines.items,
    contracts: contracts.items,
    content: content.items
  });
}

export async function loadBlueOriginMissionOverviewPayload(missionKey: Exclude<BlueOriginMissionKeyV1, 'blue-origin-program'>) {
  const meta = BLUE_ORIGIN_MISSION_META[missionKey];
  const [snapshot, passengers, payloads, contracts, content] = await Promise.all([
    fetchBlueOriginMissionSnapshot(missionKey),
    fetchBlueOriginPassengers(missionKey),
    fetchBlueOriginPayloads(missionKey),
    fetchBlueOriginContracts(missionKey),
    fetchBlueOriginContentViewModel({ mission: missionKey, kind: 'all', limit: 12, cursor: null })
  ]);

  return blueOriginMissionOverviewSchemaV1.parse({
    generatedAt: snapshot.generatedAt,
    title: meta.title,
    description: meta.description,
    snapshot: {
      generatedAt: snapshot.generatedAt,
      lastUpdated: snapshot.lastUpdated,
      missionKey: snapshot.missionKey,
      missionName: snapshot.missionName,
      nextLaunch: snapshot.nextLaunch ? mapLaunchSummary(snapshot.nextLaunch) : null,
      upcoming: snapshot.upcoming.map(mapLaunchSummary),
      recent: snapshot.recent.map(mapLaunchSummary),
      highlights: snapshot.highlights,
      changes: snapshot.changes,
      faq: snapshot.faq
    },
    passengers: passengers.items,
    payloads: payloads.items,
    contracts: contracts.items,
    content: content.items
  });
}

export async function loadBlueOriginFlightsPayload(mission: string | null) {
  const parsedMission = parseBlueOriginEntityMissionFilter(mission);
  if (!parsedMission) return null;
  return blueOriginFlightsResponseSchemaV1.parse(await fetchBlueOriginFlights(parsedMission));
}

export async function loadBlueOriginTravelersPayload() {
  return blueOriginTravelersResponseSchemaV1.parse(await fetchBlueOriginTravelerIndex());
}

export async function loadBlueOriginVehiclesPayload(mission: string | null) {
  const parsedMission = parseBlueOriginEntityMissionFilter(mission);
  if (!parsedMission) return null;
  return blueOriginVehiclesResponseSchemaV1.parse(await fetchBlueOriginVehicles(parsedMission));
}

export async function loadBlueOriginEnginesPayload(mission: string | null) {
  const parsedMission = parseBlueOriginEntityMissionFilter(mission);
  if (!parsedMission) return null;
  return blueOriginEnginesResponseSchemaV1.parse(await fetchBlueOriginEngines(parsedMission));
}

export async function loadBlueOriginContractsPayload(mission: string | null) {
  const parsedMission = parseBlueOriginContractsMissionFilter(mission);
  if (!parsedMission) return null;
  return blueOriginContractsResponseSchemaV1.parse(await fetchBlueOriginContracts(parsedMission));
}
