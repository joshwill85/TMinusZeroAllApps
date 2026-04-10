import {
  spaceXContractsResponseSchemaV1,
  spaceXContractsPageSchemaV1,
  spaceXDroneShipDetailSchemaV1,
  spaceXDroneShipListResponseSchemaV1,
  spaceXEnginesResponseSchemaV1,
  spaceXFlightsResponseSchemaV1,
  spaceXMissionOverviewSchemaV1,
  spaceXOverviewSchemaV1,
  spaceXVehiclesResponseSchemaV1,
  starshipFlightOverviewSchemaV1,
  starshipOverviewSchemaV1,
  type SpaceXMissionKeyV1
} from '@tminuszero/contracts';
import {
  fetchSpaceXContractPage,
  fetchSpaceXContractPreview,
  fetchSpaceXContracts,
  fetchSpaceXEngines,
  fetchSpaceXFinanceSignals,
  fetchSpaceXFlights,
  fetchSpaceXMissionSnapshot,
  fetchSpaceXPassengers,
  fetchSpaceXPayloads,
  fetchSpaceXProgramSnapshot,
  fetchSpaceXVehicles,
  parseSpaceXMissionKey
} from '@/lib/server/spacexProgram';
import { fetchProgramContractDiscoveryPage } from '@/lib/server/programContractDiscovery';
import { fetchSpaceXDroneShipDetail, fetchSpaceXDroneShipsIndex, parseSpaceXDroneShipSlug } from '@/lib/server/spacexDroneShips';
import { fetchStarshipFlightIndex, fetchStarshipFlightSnapshotBySlug, fetchStarshipProgramSnapshot } from '@/lib/server/starship';
import { fetchStarshipTimelineViewModel } from '@/lib/server/starshipUi';
import { fetchProgramUsaspendingAwardsPage } from '@/lib/server/usaspendingProgramAwards';
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
    href: mission.missionKey === 'starship' ? '/starship' : `/spacex/missions/${mission.missionKey}`,
    statusLabel: mission.statusLabel,
    highlight: mission.highlight
  }));
}

function formatDateLabel(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatCurrency(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(value);
  } catch {
    return String(value);
  }
}

function mapDiscoveryPreviewItem(item: {
  discoveryKey: string;
  title: string | null;
  summary: string | null;
  entityName: string | null;
  agencyName: string | null;
  publishedAt: string | null;
  amount: number | null;
  sourceUrl: string | null;
}) {
  return {
    id: item.discoveryKey,
    title: item.title || item.entityName || 'Unmatched contract record',
    summary: item.summary,
    meta: [item.agencyName, formatDateLabel(item.publishedAt), formatCurrency(item.amount)].filter(Boolean).join(' • ') || null,
    href: item.sourceUrl
  };
}

function mapUsaspendingPreviewItem(item: {
  awardId: string | null;
  title: string | null;
  recipient: string | null;
  awardedOn: string | null;
  obligatedAmount: number | null;
  sourceUrl: string | null;
}) {
  return {
    id: item.awardId || item.title || item.sourceUrl || 'usaspending-award',
    title: item.title || item.recipient || 'USAspending award',
    summary: item.recipient,
    meta: [formatDateLabel(item.awardedOn), formatCurrency(item.obligatedAmount)].filter(Boolean).join(' • ') || null,
    href: item.sourceUrl
  };
}

function mapStarshipTimelinePreview(event: {
  id: string;
  mission: string;
  title: string;
  summary: string;
  date: string;
  status: 'completed' | 'upcoming' | 'tentative' | 'superseded';
  source: { label: string; href?: string };
  launch?: Launch | null;
}) {
  return {
    id: event.id,
    missionLabel: event.mission === 'starship-program' ? 'Starship Program' : event.mission.replace(/^flight-/, 'Flight '),
    title: event.title,
    summary: event.summary,
    date: event.date,
    status: event.status,
    sourceLabel: event.source.label,
    href: event.launch ? buildLaunchHref(event.launch) : event.source.href || null
  };
}

export async function loadSpaceXOverviewPayload() {
  const [snapshot, flights, vehicles, engines, contractPreview, passengers, payloads, droneShips, finance, discoveryPage, usaspendingPage] = await Promise.all([
    fetchSpaceXProgramSnapshot(),
    fetchSpaceXFlights('all'),
    fetchSpaceXVehicles('all'),
    fetchSpaceXEngines('all'),
    fetchSpaceXContractPreview(8),
    fetchSpaceXPassengers('all'),
    fetchSpaceXPayloads('all'),
    fetchSpaceXDroneShipsIndex(),
    fetchSpaceXFinanceSignals(),
    fetchProgramContractDiscoveryPage('spacex', { limit: 8 }),
    fetchProgramUsaspendingAwardsPage('spacex', { limit: 8 })
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
      contracts: contractPreview.total
    },
    missions: buildMissionCards(),
    flights: flights.items.slice(0, 12).map((flight) => ({
      ...flight,
      launch: mapLaunchSummary(flight.launch)
    })),
    vehicles: vehicles.items,
    engines: engines.items,
    contracts: contractPreview.items,
    droneShips: {
      items: droneShips.items,
      coverage: droneShips.coverage,
      upcomingAssignments: droneShips.upcomingAssignments
    },
    finance,
    discovery: discoveryPage.items.map(mapDiscoveryPreviewItem),
    usaspending: usaspendingPage.items.map(mapUsaspendingPreviewItem)
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

export async function loadSpaceXContractsPagePayload(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsedMission = parseSpaceXMissionFilter(searchParams.get('mission'));
  if (!parsedMission) return null;

  const limit = clampInt(searchParams.get('limit'), 100, 1, 500);
  const offset = clampInt(searchParams.get('offset'), 0, 0, 1_000_000);
  const page = await fetchSpaceXContractPage(limit, offset, parsedMission);

  return spaceXContractsPageSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    mission: parsedMission,
    total: page.total,
    offset: page.offset,
    limit: page.limit,
    hasMore: page.hasMore,
    items: page.items
  });
}

export async function loadSpaceXDroneShipsPayload() {
  return spaceXDroneShipListResponseSchemaV1.parse(await fetchSpaceXDroneShipsIndex());
}

export async function loadSpaceXDroneShipDetailPayload(slug: string | null | undefined) {
  const shipSlug = parseSpaceXDroneShipSlug(slug);
  if (!shipSlug) return null;
  const payload = await fetchSpaceXDroneShipDetail(shipSlug);
  if (!payload) return null;
  return spaceXDroneShipDetailSchemaV1.parse(payload);
}

export async function loadStarshipOverviewPayload() {
  const [snapshot, flights, timeline] = await Promise.all([
    fetchStarshipProgramSnapshot(),
    fetchStarshipFlightIndex(),
    fetchStarshipTimelineViewModel({
      mode: 'quick',
      mission: 'all',
      sourceType: 'all',
      includeSuperseded: false,
      from: null,
      to: null,
      cursor: null,
      limit: 12
    })
  ]);

  return starshipOverviewSchemaV1.parse({
    generatedAt: snapshot.generatedAt,
    title: 'Starship',
    description: 'Dedicated Starship workbench with per-flight routing, launch snapshots, and timeline evidence.',
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
      flightsTracked: flights.length,
      timelineEvents: timeline.kpis.totalEvents
    },
    flights: flights.map((entry) => ({
      ...entry,
      nextLaunch: entry.nextLaunch ? mapLaunchSummary(entry.nextLaunch) : null
    })),
    timeline: timeline.events.map(mapStarshipTimelinePreview)
  });
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = value == null ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export async function loadStarshipFlightOverviewPayload(slug: string | null | undefined) {
  const normalizedSlug = String(slug || '').trim().toLowerCase();
  if (!/^flight-\d{1,3}$/.test(normalizedSlug)) return null;

  const [snapshot, timeline] = await Promise.all([
    fetchStarshipFlightSnapshotBySlug(normalizedSlug),
    fetchStarshipTimelineViewModel({
      mode: 'quick',
      mission: normalizedSlug as `flight-${number}`,
      sourceType: 'all',
      includeSuperseded: false,
      from: null,
      to: null,
      cursor: null,
      limit: 16
    })
  ]);

  if (!snapshot) return null;

  return starshipFlightOverviewSchemaV1.parse({
    generatedAt: snapshot.generatedAt,
    title: snapshot.missionName,
    description: `${snapshot.missionName} native route with launch snapshots, recent changes, and timeline evidence.`,
    snapshot: {
      generatedAt: snapshot.generatedAt,
      lastUpdated: snapshot.lastUpdated,
      missionName: snapshot.missionName,
      flightNumber: snapshot.flightNumber,
      flightSlug: snapshot.flightSlug,
      nextLaunch: snapshot.nextLaunch ? mapLaunchSummary(snapshot.nextLaunch) : null,
      upcoming: snapshot.upcoming.map(mapLaunchSummary),
      recent: snapshot.recent.map(mapLaunchSummary),
      crewHighlights: snapshot.crewHighlights,
      changes: snapshot.changes,
      faq: snapshot.faq
    },
    timeline: timeline.events.map(mapStarshipTimelinePreview)
  });
}
