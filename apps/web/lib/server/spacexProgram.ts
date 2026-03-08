import { cache } from 'react';
import { buildContractStoryPresentation } from '@/lib/server/contractStoryPresentation';
import { fetchProgramContractLeadCountsBySeeds } from '@/lib/server/programContractDiscovery';
import { fetchProgramContractSourceCountsByStoryKeys } from '@/lib/server/programContractSourceLinks';
import {
  buildStoryLookupMapKey,
  fetchContractStorySummariesByAwards
} from '@/lib/server/programContractStories';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { mapPublicCacheRow } from '@/lib/server/transformers';
import { fetchSpaceXDroneShipAssignmentsByLaunchIds } from '@/lib/server/spacexDroneShips';
import { fetchProgramUsaspendingAwards } from '@/lib/server/usaspendingProgramAwards';
import {
  buildArtemisContractHref,
  fetchArtemisContractStoryByAwardId,
  resolveArtemisAwardIdFromContractSeed,
  type ArtemisContractAction as ArtemisContractActionRow,
  type ArtemisOpportunityNotice as ArtemisOpportunityNoticeRow,
  type ArtemisContractSpendingPoint as ArtemisContractSpendingPointRow
} from '@/lib/server/artemisContracts';
import type { Launch } from '@/lib/types/launch';
import type {
  SpaceXContractAction,
  SpaceXContractDetail,
  SpaceXContract,
  SpaceXContractsResponse,
  SpaceXEngine,
  SpaceXEngineDetail,
  SpaceXEngineResponse,
  SpaceXEngineSlug,
  SpaceXEngineVehicleBinding,
  SpaceXFinanceResponse,
  SpaceXFinanceSignal,
  SpaceXFlightRecord,
  SpaceXFlightsResponse,
  SpaceXMissionKey,
  SpaceXMissionSnapshot,
  SpaceXPassenger,
  SpaceXPassengersResponse,
  SpaceXPayload,
  SpaceXPayloadsResponse,
  SpaceXProgramFaqItem,
  SpaceXProgramSnapshot,
  SpaceXOpportunityNotice,
  SpaceXContractStory,
  SpaceXSocialPost,
  SpaceXSpendingPoint,
  SpaceXVehicle,
  SpaceXVehicleDetail,
  SpaceXVehicleEngineBinding,
  SpaceXVehicleEngineLink,
  SpaceXVehicleResponse,
  SpaceXVehicleSlug
} from '@/lib/types/spacexProgram';
import {
  buildSpaceXFlightSlug,
  getSpaceXMissionKeyFromLaunch,
  getSpaceXMissionKeyFromText,
  getSpaceXMissionLabel,
  isSpaceXMissionKey,
  isSpaceXProgramLaunch
} from '@/lib/utils/spacexProgram';
import { resolveUsaspendingAwardSourceUrl } from '@/lib/utils/usaspending';

const SPACEX_OR_FILTER = [
  'provider.ilike.%SpaceX%',
  'provider.ilike.%Space X%',
  'name.ilike.%Starship%',
  'name.ilike.%Super Heavy%',
  'name.ilike.%Falcon 9%',
  'name.ilike.%Falcon Heavy%',
  'name.ilike.%Crew Dragon%',
  'name.ilike.%Cargo Dragon%',
  'mission_name.ilike.%Starship%',
  'mission_name.ilike.%Falcon%',
  'mission_name.ilike.%Dragon%',
  'vehicle.ilike.%Starship%',
  'vehicle.ilike.%Falcon%',
  'vehicle.ilike.%Dragon%',
  'rocket_full_name.ilike.%Starship%',
  'rocket_full_name.ilike.%Falcon%',
  'rocket_full_name.ilike.%Dragon%'
].join(',');

const MAX_LAUNCH_ITEMS = 80;
const MAX_RECORD_ITEMS = 2200;
const SPACEX_COUNT_PAGE_SIZE = 1000;
const SPACEX_CONTRACTS_PAGE_SIZE = 1000;
const MAX_SPACEX_CONTRACT_ROWS = 50_000;
const LAST_UPDATED_MAX_FUTURE_MS = 5 * 60 * 1000;

type LaunchSocialRow = {
  launch_id: string;
  name: string | null;
  mission_name: string | null;
  net: string | null;
  social_primary_post_url: string | null;
  social_primary_post_platform: string | null;
  social_primary_post_handle: string | null;
  social_primary_post_id: string | null;
  social_primary_post_matched_at: string | null;
  spacex_x_post_url: string | null;
  spacex_x_post_id: string | null;
  spacex_x_post_captured_at: string | null;
};

type SpaceXContractsDbRow = {
  id: string;
  contract_key: string | null;
  mission_key: string | null;
  title: string | null;
  agency: string | null;
  customer: string | null;
  amount: number | null;
  awarded_on: string | null;
  description: string | null;
  source_url: string | null;
  source_label: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

const FALLBACK_CONTRACTS: SpaceXContract[] = [
  {
    id: 'fallback:nasa-commercial-crew',
    contractKey: 'NASA-COMMERCIAL-CREW',
    missionKey: 'dragon',
    title: 'NASA Commercial Crew Transportation Services',
    agency: 'NASA',
    customer: 'NASA',
    amount: null,
    awardedOn: null,
    description: 'Commercial Crew transportation services supporting International Space Station crew rotations.',
    sourceUrl: 'https://www.nasa.gov/humans-in-space/commercial-space/commercial-crew-program/',
    sourceLabel: 'NASA Commercial Crew',
    status: 'active',
    metadata: { sourceClass: 'government-record', confidence: 'medium' },
    updatedAt: null
  },
  {
    id: 'fallback:ussf-nssl-phase2',
    contractKey: 'USSF-NSSL-PHASE2-SPACEX',
    missionKey: 'falcon-9',
    title: 'U.S. Space Force National Security Space Launch contract allocations',
    agency: 'U.S. Space Force',
    customer: 'U.S. Space Force',
    amount: null,
    awardedOn: null,
    description: 'National security launch allocations supporting SpaceX missions within NSSL frameworks.',
    sourceUrl: 'https://www.spaceforce.mil/',
    sourceLabel: 'U.S. Space Force',
    status: 'active',
    metadata: { sourceClass: 'government-record', confidence: 'medium' },
    updatedAt: null
  }
];

const FALLBACK_VEHICLES: SpaceXVehicle[] = [
  {
    id: 'fallback:starship-super-heavy',
    vehicleSlug: 'starship-super-heavy',
    missionKey: 'starship',
    displayName: 'Starship / Super Heavy',
    vehicleClass: 'super-heavy-lift',
    status: 'flight-test',
    firstFlight: '2023-04-20',
    description: 'Fully reusable super-heavy launch system in integrated flight-test operations.',
    officialUrl: 'https://www.spacex.com/vehicles/starship/',
    metadata: { sourceClass: 'spacex-official', confidence: 'high' },
    updatedAt: null
  },
  {
    id: 'fallback:falcon-9',
    vehicleSlug: 'falcon-9',
    missionKey: 'falcon-9',
    displayName: 'Falcon 9',
    vehicleClass: 'orbital-launch-vehicle',
    status: 'operational',
    firstFlight: '2010-06-04',
    description: 'Reusable two-stage launch vehicle supporting crew, cargo, and commercial missions.',
    officialUrl: 'https://www.spacex.com/vehicles/falcon-9/',
    metadata: { sourceClass: 'spacex-official', confidence: 'high' },
    updatedAt: null
  },
  {
    id: 'fallback:falcon-heavy',
    vehicleSlug: 'falcon-heavy',
    missionKey: 'falcon-heavy',
    displayName: 'Falcon Heavy',
    vehicleClass: 'heavy-lift-launch-vehicle',
    status: 'operational',
    firstFlight: '2018-02-06',
    description: 'Heavy-lift launcher for high-energy and high-mass payload missions.',
    officialUrl: 'https://www.spacex.com/vehicles/falcon-heavy/',
    metadata: { sourceClass: 'spacex-official', confidence: 'high' },
    updatedAt: null
  },
  {
    id: 'fallback:dragon',
    vehicleSlug: 'dragon',
    missionKey: 'dragon',
    displayName: 'Dragon',
    vehicleClass: 'spacecraft',
    status: 'operational',
    firstFlight: '2010-12-08',
    description: 'Crew and cargo spacecraft for ISS transportation and private astronaut missions.',
    officialUrl: 'https://www.spacex.com/vehicles/dragon/',
    metadata: { sourceClass: 'spacex-official', confidence: 'high' },
    updatedAt: null
  }
];

const FALLBACK_ENGINES: SpaceXEngine[] = [
  {
    id: 'fallback:raptor',
    engineSlug: 'raptor',
    missionKey: 'starship',
    displayName: 'Raptor',
    propellants: 'Methane / Liquid Oxygen',
    cycle: 'Full-flow staged combustion',
    thrustVacKN: null,
    thrustSlKN: null,
    status: 'operational',
    description: 'Starship and Super Heavy methane-oxygen engine family.',
    officialUrl: 'https://www.spacex.com/vehicles/starship/',
    metadata: { sourceClass: 'spacex-official', confidence: 'high' },
    updatedAt: null
  },
  {
    id: 'fallback:merlin-1d',
    engineSlug: 'merlin-1d',
    missionKey: 'falcon-9',
    displayName: 'Merlin 1D',
    propellants: 'RP-1 / Liquid Oxygen',
    cycle: 'Gas-generator cycle',
    thrustVacKN: null,
    thrustSlKN: null,
    status: 'operational',
    description: 'Falcon first-stage kerolox engine family.',
    officialUrl: 'https://www.spacex.com/vehicles/falcon-9/',
    metadata: { sourceClass: 'spacex-official', confidence: 'high' },
    updatedAt: null
  },
  {
    id: 'fallback:merlin-vac',
    engineSlug: 'merlin-vac',
    missionKey: 'falcon-9',
    displayName: 'Merlin Vacuum',
    propellants: 'RP-1 / Liquid Oxygen',
    cycle: 'Vacuum-optimized gas-generator cycle',
    thrustVacKN: null,
    thrustSlKN: null,
    status: 'operational',
    description: 'Falcon upper-stage vacuum engine for orbital insertion burns.',
    officialUrl: 'https://www.spacex.com/vehicles/falcon-9/',
    metadata: { sourceClass: 'spacex-official', confidence: 'high' },
    updatedAt: null
  },
  {
    id: 'fallback:draco',
    engineSlug: 'draco',
    missionKey: 'dragon',
    displayName: 'Draco',
    propellants: 'MMH / NTO',
    cycle: 'Hypergolic reaction control thruster',
    thrustVacKN: null,
    thrustSlKN: null,
    status: 'operational',
    description: 'Dragon reaction control thrusters for orbital maneuvering and attitude control.',
    officialUrl: 'https://www.spacex.com/vehicles/dragon/',
    metadata: { sourceClass: 'spacex-official', confidence: 'medium' },
    updatedAt: null
  },
  {
    id: 'fallback:superdraco',
    engineSlug: 'superdraco',
    missionKey: 'dragon',
    displayName: 'SuperDraco',
    propellants: 'MMH / NTO',
    cycle: 'Hypergolic abort propulsion',
    thrustVacKN: null,
    thrustSlKN: null,
    status: 'operational',
    description: 'Crew Dragon launch escape propulsion system.',
    officialUrl: 'https://www.spacex.com/vehicles/dragon/',
    metadata: { sourceClass: 'spacex-official', confidence: 'medium' },
    updatedAt: null
  }
];

const FALLBACK_VEHICLE_ENGINE_MAP: SpaceXVehicleEngineLink[] = [
  {
    vehicleSlug: 'starship-super-heavy',
    engineSlug: 'raptor',
    role: 'primary propulsion',
    notes: null,
    metadata: { sourceClass: 'curated-fallback', confidence: 'high' }
  },
  {
    vehicleSlug: 'falcon-9',
    engineSlug: 'merlin-1d',
    role: 'first-stage propulsion',
    notes: null,
    metadata: { sourceClass: 'curated-fallback', confidence: 'high' }
  },
  {
    vehicleSlug: 'falcon-9',
    engineSlug: 'merlin-vac',
    role: 'upper-stage propulsion',
    notes: null,
    metadata: { sourceClass: 'curated-fallback', confidence: 'high' }
  },
  {
    vehicleSlug: 'falcon-heavy',
    engineSlug: 'merlin-1d',
    role: 'core and side-booster propulsion',
    notes: null,
    metadata: { sourceClass: 'curated-fallback', confidence: 'high' }
  },
  {
    vehicleSlug: 'falcon-heavy',
    engineSlug: 'merlin-vac',
    role: 'upper-stage propulsion',
    notes: null,
    metadata: { sourceClass: 'curated-fallback', confidence: 'high' }
  },
  {
    vehicleSlug: 'dragon',
    engineSlug: 'draco',
    role: 'orbital maneuvering',
    notes: null,
    metadata: { sourceClass: 'curated-fallback', confidence: 'high' }
  },
  {
    vehicleSlug: 'dragon',
    engineSlug: 'superdraco',
    role: 'launch escape system',
    notes: null,
    metadata: { sourceClass: 'curated-fallback', confidence: 'high' }
  }
];

export type SpaceXLaunchBuckets = {
  generatedAt: string;
  upcoming: Launch[];
  recent: Launch[];
};

export const fetchSpaceXLaunchBuckets = cache(async (): Promise<SpaceXLaunchBuckets> => {
  const generatedAt = new Date().toISOString();
  if (!isSupabaseConfigured()) return { generatedAt, upcoming: [], recent: [] };

  const supabase = createSupabasePublicClient();
  const nowIso = new Date().toISOString();

  const [upcomingRes, recentRes] = await Promise.all([
    supabase
      .from('launches_public_cache')
      .select('*')
      .or(SPACEX_OR_FILTER)
      .gte('net', nowIso)
      .order('net', { ascending: true })
      .limit(240),
    supabase
      .from('launches_public_cache')
      .select('*')
      .or(SPACEX_OR_FILTER)
      .lt('net', nowIso)
      .order('net', { ascending: false })
      .limit(280)
  ]);

  if (upcomingRes.error || recentRes.error) {
    console.error('spacex launch bucket query error', {
      upcoming: upcomingRes.error,
      recent: recentRes.error
    });
    return { generatedAt, upcoming: [], recent: [] };
  }

  const upcoming = dedupeById((upcomingRes.data || []).map(mapPublicCacheRow).filter(isSpaceXProgramLaunch)).slice(0, MAX_LAUNCH_ITEMS);
  const recent = dedupeById((recentRes.data || []).map(mapPublicCacheRow).filter(isSpaceXProgramLaunch)).slice(0, MAX_LAUNCH_ITEMS);

  return { generatedAt, upcoming, recent };
});

export const fetchSpaceXProgramSnapshot = cache(async (): Promise<SpaceXProgramSnapshot> => {
  const buckets = await fetchSpaceXLaunchBuckets();
  const combined = [...buckets.upcoming, ...buckets.recent];
  return {
    generatedAt: buckets.generatedAt,
    lastUpdated: resolveLastUpdated(combined, buckets.generatedAt),
    nextLaunch: buckets.upcoming[0] || null,
    upcoming: buckets.upcoming,
    recent: buckets.recent,
    faq: buildSpaceXFaq('program')
  };
});

export const fetchSpaceXTrackedFlightCount = cache(async (): Promise<number> => {
  if (!isSupabaseConfigured()) {
    const flights = await fetchSpaceXFlights('all');
    return flights.items.length;
  }

  const supabase = createSupabasePublicClient();
  const nowIso = new Date().toISOString();
  const [upcomingCount, recentCount] = await Promise.all([
    countSpaceXLaunchBucketRows(supabase, {
      comparison: 'gte',
      nowIso,
      ascending: true
    }),
    countSpaceXLaunchBucketRows(supabase, {
      comparison: 'lt',
      nowIso,
      ascending: false
    })
  ]);

  return upcomingCount + recentCount;
});

export const fetchSpaceXMissionSnapshot = cache(async (mission: SpaceXMissionKey): Promise<SpaceXMissionSnapshot> => {
  const buckets = await fetchSpaceXLaunchBuckets();
  const relevant = (launch: Launch) => (mission === 'spacex-program' ? true : getSpaceXMissionKeyFromLaunch(launch) === mission);

  const upcoming = buckets.upcoming.filter(relevant).slice(0, MAX_LAUNCH_ITEMS);
  const recent = buckets.recent.filter(relevant).slice(0, MAX_LAUNCH_ITEMS);
  const combined = dedupeById([...upcoming, ...recent]);

  return {
    generatedAt: buckets.generatedAt,
    lastUpdated: resolveLastUpdated(combined.length ? combined : [...buckets.upcoming, ...buckets.recent], buckets.generatedAt),
    missionKey: mission,
    missionName: getSpaceXMissionLabel(mission),
    nextLaunch: upcoming[0] || null,
    upcoming,
    recent,
    highlights: buildMissionHighlights(combined, mission),
    faq: buildSpaceXFaq('mission', mission)
  };
});

export const fetchSpaceXVehicles = cache(async (mission: SpaceXMissionKey | 'all' = 'all'): Promise<SpaceXVehicleResponse> => {
  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    mission,
    items: FALLBACK_VEHICLES.filter((item) => (mission === 'all' ? true : item.missionKey === mission))
  };
});

export const fetchSpaceXVehicleDetail = cache(async (vehicleSlug: SpaceXVehicleSlug): Promise<SpaceXVehicleDetail | null> => {
  const vehicle = FALLBACK_VEHICLES.find((entry) => entry.vehicleSlug === vehicleSlug) || null;
  if (!vehicle) return null;

  const links = FALLBACK_VEHICLE_ENGINE_MAP.filter((entry) => entry.vehicleSlug === vehicleSlug);
  const bindings: SpaceXVehicleEngineBinding[] = links.map((link) => ({
    ...link,
    engine: FALLBACK_ENGINES.find((engine) => engine.engineSlug === link.engineSlug) || null
  }));

  return {
    vehicle,
    engines: bindings
  };
});

export const fetchSpaceXEngines = cache(async (mission: SpaceXMissionKey | 'all' = 'all'): Promise<SpaceXEngineResponse> => {
  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    mission,
    items: FALLBACK_ENGINES.filter((item) => (mission === 'all' ? true : item.missionKey === mission))
  };
});

export const fetchSpaceXEngineDetail = cache(async (engineSlug: SpaceXEngineSlug): Promise<SpaceXEngineDetail | null> => {
  const engine = FALLBACK_ENGINES.find((entry) => entry.engineSlug === engineSlug) || null;
  if (!engine) return null;

  const links = FALLBACK_VEHICLE_ENGINE_MAP.filter((entry) => entry.engineSlug === engineSlug);
  const bindings: SpaceXEngineVehicleBinding[] = links.map((link) => ({
    ...link,
    vehicle: FALLBACK_VEHICLES.find((vehicle) => vehicle.vehicleSlug === link.vehicleSlug) || null
  }));

  return {
    engine,
    vehicles: bindings
  };
});

export const fetchSpaceXFlights = cache(async (mission: SpaceXMissionKey | 'all' = 'all'): Promise<SpaceXFlightsResponse> => {
  const buckets = await fetchSpaceXLaunchBuckets();
  const launches = dedupeById([...buckets.upcoming, ...buckets.recent]);
  const droneShipAssignments = await fetchSpaceXDroneShipAssignmentsByLaunchIds(launches.map((launch) => launch.id));
  const items = launches
    .filter((launch) => (mission === 'all' ? true : getSpaceXMissionKeyFromLaunch(launch) === mission))
    .map<SpaceXFlightRecord>((launch) => {
      const missionKey = getSpaceXMissionKeyFromLaunch(launch);
      const droneShipAssignment = droneShipAssignments.get(launch.id);
      return {
        id: launch.id,
        flightSlug: buildSpaceXFlightSlug(launch),
        missionKey,
        missionLabel: getSpaceXMissionLabel(missionKey),
        droneShipSlug: droneShipAssignment?.shipSlug || null,
        droneShipName: droneShipAssignment?.shipName || null,
        droneShipAbbrev: droneShipAssignment?.shipAbbrev || null,
        droneShipLandingResult: droneShipAssignment?.landingResult || 'unknown',
        launch
      };
    })
    .sort((a, b) => Date.parse(b.launch.net) - Date.parse(a.launch.net));

  return {
    generatedAt: buckets.generatedAt,
    mission,
    items
  };
});

const FALLBACK_SPACEX_SOCIAL_POSTS: SpaceXSocialPost[] = [
  {
    id: 'fallback:spacex:x',
    missionKey: 'spacex-program',
    missionLabel: getSpaceXMissionLabel('spacex-program'),
    launchId: null,
    launchName: 'SpaceX official account',
    launchDate: null,
    url: 'https://x.com/SpaceX',
    platform: 'x',
    handle: 'SpaceX',
    externalId: null,
    postedAt: null,
    summary: 'Official SpaceX social feed',
    source: 'curated-fallback',
    confidence: 'medium'
  }
];

export const fetchSpaceXSocialPosts = cache(async (limit = 5): Promise<SpaceXSocialPost[]> => {
  const boundedLimit = clampIntValue(limit, 5, 1, 20);
  const buckets = await fetchSpaceXLaunchBuckets();
  const launches = dedupeById([...buckets.upcoming, ...buckets.recent]);
  const missionByLaunchId = new Map(launches.map((launch) => [launch.id, getSpaceXMissionKeyFromLaunch(launch)]));

  if (!isSupabaseConfigured()) {
    return FALLBACK_SPACEX_SOCIAL_POSTS.slice(0, boundedLimit);
  }

  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from('launches_public_cache')
    .select(
      'launch_id,name,mission_name,net,social_primary_post_url,social_primary_post_platform,social_primary_post_handle,social_primary_post_id,social_primary_post_matched_at,spacex_x_post_url,spacex_x_post_id,spacex_x_post_captured_at'
    )
    .or(SPACEX_OR_FILTER)
    .order('net', { ascending: false })
    .limit(500);

  if (error) {
    console.error('spacex social feed query error', error);
    return FALLBACK_SPACEX_SOCIAL_POSTS.slice(0, boundedLimit);
  }

  const posts: SpaceXSocialPost[] = [];

  for (const row of (data || []) as LaunchSocialRow[]) {
    const missionKey =
      missionByLaunchId.get(row.launch_id) || getSpaceXMissionKeyFromText(`${row.name || ''} ${row.mission_name || ''}`) || 'spacex-program';
    const missionLabel = getSpaceXMissionLabel(missionKey);

    if (row.social_primary_post_url) {
      posts.push({
        id: `social:${row.launch_id}:primary`,
        missionKey,
        missionLabel,
        launchId: row.launch_id || null,
        launchName: row.name || row.mission_name || null,
        launchDate: normalizeIso(row.net),
        url: row.social_primary_post_url,
        platform: row.social_primary_post_platform || 'x',
        handle: normalizeHandle(row.social_primary_post_handle, row.social_primary_post_url),
        externalId: row.social_primary_post_id || null,
        postedAt: normalizeIso(row.social_primary_post_matched_at) || normalizeIso(row.net),
        summary: 'Launch-linked official social post',
        source: 'launches_public_cache.social_primary_post_url',
        confidence: 'medium'
      });
    }

    if (row.spacex_x_post_url) {
      posts.push({
        id: `social:${row.launch_id}:spacex`,
        missionKey,
        missionLabel,
        launchId: row.launch_id || null,
        launchName: row.name || row.mission_name || null,
        launchDate: normalizeIso(row.net),
        url: row.spacex_x_post_url,
        platform: 'x',
        handle: normalizeHandle('SpaceX', row.spacex_x_post_url),
        externalId: row.spacex_x_post_id || null,
        postedAt: normalizeIso(row.spacex_x_post_captured_at) || normalizeIso(row.net),
        summary: 'SpaceX timeline post',
        source: 'launches_public_cache.spacex_x_post_url',
        confidence: 'high'
      });
    }
  }

  const deduped = dedupeSocialPosts(posts);
  if (deduped.length === 0) {
    return FALLBACK_SPACEX_SOCIAL_POSTS.slice(0, boundedLimit);
  }

  return deduped.slice(0, boundedLimit);
});

export const fetchSpaceXFlightBySlug = cache(async (slug: string) => {
  const flights = await fetchSpaceXFlights('all');
  return flights.items.find((item) => item.flightSlug === slug) || null;
});

export const fetchSpaceXPassengers = cache(async (mission: SpaceXMissionKey | 'all' = 'all'): Promise<SpaceXPassengersResponse> => {
  const buckets = await fetchSpaceXLaunchBuckets();
  const items: SpaceXPassenger[] = [];
  const launches = dedupeById([...buckets.upcoming, ...buckets.recent]);

  for (const launch of launches) {
    const missionKey = getSpaceXMissionKeyFromLaunch(launch);
    if (mission !== 'all' && missionKey !== mission) continue;

    for (const crew of launch.crew || []) {
      const name = (crew?.astronaut || '').trim();
      if (!name) continue;
      items.push({
        id: `${launch.id}:${name.toLowerCase().replace(/\s+/g, '-')}`,
        missionKey,
        flightSlug: buildSpaceXFlightSlug(launch),
        name,
        role: crew?.role || null,
        nationality: crew?.nationality || null,
        launchId: launch.id,
        launchName: launch.name,
        launchDate: launch.net,
        source: 'launches_public_cache.crew',
        confidence: 'medium'
      });
    }
  }

  return {
    generatedAt: buckets.generatedAt,
    mission,
    items: dedupeByKey(items, (entry) => `${entry.launchId}:${entry.name.toLowerCase()}:${entry.role || ''}`).slice(0, MAX_RECORD_ITEMS)
  };
});

export const fetchSpaceXPayloads = cache(async (mission: SpaceXMissionKey | 'all' = 'all'): Promise<SpaceXPayloadsResponse> => {
  const buckets = await fetchSpaceXLaunchBuckets();
  const items: SpaceXPayload[] = [];
  const launches = dedupeById([...buckets.upcoming, ...buckets.recent]);

  for (const launch of launches) {
    const missionKey = getSpaceXMissionKeyFromLaunch(launch);
    if (mission !== 'all' && missionKey !== mission) continue;

    for (const payload of launch.payloads || []) {
      const name = (payload?.name || '').trim();
      if (!name) continue;

      items.push({
        id: `${launch.id}:${name.toLowerCase().replace(/\s+/g, '-')}`,
        missionKey,
        flightSlug: buildSpaceXFlightSlug(launch),
        name,
        payloadType: payload?.type || null,
        orbit: payload?.orbit || null,
        agency: payload?.agency || null,
        launchId: launch.id,
        launchName: launch.name,
        launchDate: launch.net,
        source: 'launches_public_cache.payloads',
        confidence: 'medium'
      });
    }
  }

  return {
    generatedAt: buckets.generatedAt,
    mission,
    items: dedupeByKey(items, (entry) => `${entry.launchId}:${entry.name.toLowerCase()}:${entry.payloadType || ''}`).slice(0, MAX_RECORD_ITEMS)
  };
});

export const fetchSpaceXContracts = cache(async (mission: SpaceXMissionKey | 'all' = 'all'): Promise<SpaceXContractsResponse> => {
  const generatedAt = new Date().toISOString();
  const derived = await fetchSpaceXContractsFromSource();
  const records = await attachContractStoryPresentation(
    derived.length > 0 ? derived : FALLBACK_CONTRACTS
  );

  return {
    generatedAt,
    mission,
    items: records.filter((item) => (mission === 'all' ? true : item.missionKey === mission))
  };
});

export const fetchSpaceXContractDetailBySlug = cache(async (slug: string): Promise<SpaceXContractDetail | null> => {
  const normalizedSlug = parseSpaceXContractSlug(slug);
  if (!normalizedSlug) return null;

  const contracts = await fetchSpaceXContracts('all');
  const contract = contracts.items.find((item) => buildSpaceXContractSlug(item.contractKey) === normalizedSlug) || null;
  if (!contract) return null;
  const awardId = resolveArtemisAwardIdFromContractSeed({
    contractKey: contract.contractKey,
    sourceUrl: contract.sourceUrl,
    metadata: contract.metadata
  });
  const artemisStory = awardId
    ? await fetchArtemisContractStoryByAwardId(awardId, {
        contractLimit: 1200,
        actionLimit: 500,
        noticeLimit: 500,
        spendingLimit: 500
      })
    : null;
  const contractStory = artemisStory
    ? {
        piid: artemisStory.piid,
        storyHref: buildArtemisContractHref(artemisStory.piid),
        members: artemisStory.members.length,
        actions: artemisStory.actions.map(mapArtemisContractAction),
        notices: artemisStory.notices.map(mapArtemisOpportunityNotice),
        spending: artemisStory.spending.map(mapArtemisSpendingPoint),
        bidders: artemisStory.bidders
      }
    : null;

  const fallbackActions = buildSpaceXContractActions(contract);
  const fallbackSpending = buildSpaceXContractSpending(contract);

  return {
    generatedAt: new Date().toISOString(),
    contract,
    actions: contractStory && contractStory.actions.length ? contractStory.actions : fallbackActions,
    spending: contractStory && contractStory.spending.length ? contractStory.spending : fallbackSpending,
    notices: contractStory ? contractStory.notices : [],
    story: contractStory
  };
});

export const fetchSpaceXFinanceSignals = cache(async (): Promise<SpaceXFinanceResponse> => {
  const generatedAt = new Date().toISOString();
  const [contracts, launches] = await Promise.all([fetchSpaceXContracts('all'), fetchSpaceXLaunchBuckets()]);
  const obligations = contracts.items.reduce((sum, item) => sum + (typeof item.amount === 'number' ? item.amount : 0), 0);
  const trailing12MonthsLaunches = [...launches.upcoming, ...launches.recent].filter((launch) => {
    const netMs = Date.parse(launch.net);
    if (!Number.isFinite(netMs)) return false;
    return netMs >= Date.now() - 365 * 24 * 60 * 60 * 1000;
  }).length;

  const items: SpaceXFinanceSignal[] = [
    {
      id: 'spacex:finance:government-obligations',
      company: 'SpaceX',
      kind: 'government-obligations',
      title: 'USAspending-derived obligated value (filtered records)',
      value: obligations > 0 ? obligations : null,
      unit: obligations > 0 ? 'USD' : null,
      period: 'All available records',
      asOfDate: generatedAt.slice(0, 10),
      sourceLabel: 'USAspending-derived records',
      sourceUrl: 'https://www.usaspending.gov/',
      confidence: obligations > 0 ? 'medium' : 'low',
      disclaimer: 'Proxy metric. SpaceX is private and does not publish public-company earnings in SEC filing format.',
      metadata: { recordCount: contracts.items.length }
    },
    {
      id: 'spacex:finance:launch-cadence',
      company: 'SpaceX',
      kind: 'launch-cadence',
      title: 'Trailing 12-month launch cadence',
      value: trailing12MonthsLaunches,
      unit: 'launches',
      period: 'Trailing 12 months',
      asOfDate: generatedAt.slice(0, 10),
      sourceLabel: 'LL2 launch cache',
      sourceUrl: 'https://thespacedevs.com/llapi',
      confidence: trailing12MonthsLaunches > 0 ? 'high' : 'medium',
      disclaimer: 'Operational cadence proxy, not a financial earnings metric.',
      metadata: {}
    },
    {
      id: 'spacex:finance:private-disclosure',
      company: 'SpaceX',
      kind: 'private-company-disclosure',
      title: 'Public-market earnings availability',
      value: null,
      unit: null,
      period: null,
      asOfDate: generatedAt.slice(0, 10),
      sourceLabel: 'Program policy',
      sourceUrl: null,
      confidence: 'high',
      disclaimer: 'SpaceX is privately held; no SEC 10-Q/10-K earnings reporting applies.',
      metadata: { publicCompany: false }
    }
  ];

  return {
    generatedAt,
    company: 'SpaceX',
    publicEarningsAvailable: false,
    disclaimer: 'SpaceX is privately held. Investor module uses public proxy signals, not GAAP earnings statements.',
    items
  };
});

export function buildSpaceXContractSlug(contractKey: string) {
  return normalizeSpaceXContractSlug(contractKey) || 'contract';
}

export function parseSpaceXContractSlug(value: string | null | undefined) {
  const normalized = normalizeSpaceXContractSlug(value || '');
  return normalized || null;
}

export function buildSpaceXFaq(scope: 'program' | 'mission', mission?: SpaceXMissionKey): SpaceXProgramFaqItem[] {
  if (scope === 'program') {
    return [
      {
        question: 'What does the SpaceX Program page track?',
        answer:
          'It tracks SpaceX mission-family schedules, flights, passengers, payloads, contracts, and proxy finance signals with source attribution.'
      },
      {
        question: 'Does SpaceX publish public-company earnings reports?',
        answer:
          'No. SpaceX is private, so this page uses clearly labeled proxy metrics such as obligations, contracts, and launch cadence.'
      }
    ];
  }

  const missionName = getSpaceXMissionLabel(mission || 'spacex-program');
  return [
    {
      question: `What is included on the ${missionName} mission page?`,
      answer:
        `${missionName} pages include schedule visibility, mission highlights, related contracts context, and connected passenger/payload records when available.`
    },
    {
      question: 'How should NET launch timing be interpreted?',
      answer:
        'NET means No Earlier Than and can shift due to readiness, weather, and range constraints. This page preserves recent and upcoming changes.'
    }
  ];
}

async function fetchSpaceXContractsFromProcurement() {
  const awards = await fetchProgramUsaspendingAwards('spacex', 1200);

  return awards
    .map<SpaceXContract | null>((award) => {
      if (!isSpaceXContractLikeAward(award)) return null;
      const awardId = award.awardId;
      if (!awardId) return null;

      const title = (award.title || '').trim() || `USASpending award ${awardId}`;
      const metadata = award.metadata || {};
      const missionKey = classifyMissionFromContractText(`${title} ${JSON.stringify(metadata)}`);
      const sourceUrl = resolveUsaspendingAwardSourceUrl({
        awardId,
        sourceUrl: award.sourceUrl,
        awardPageUrl: readMetadataUrl(metadata, ['awardPageUrl']),
        awardApiUrl: readMetadataUrl(metadata, ['awardApiUrl'])
      });

      return {
        id: `proc:${awardId}`,
        contractKey: `USASPENDING-${awardId}`,
        missionKey,
        title,
        agency: 'U.S. Government',
        customer: 'U.S. Government',
        amount: finiteNumberOrNull(award.obligatedAmount),
        awardedOn: normalizeDate(award.awardedOn),
        description: buildContractDescription(metadata, title),
        sourceUrl:
          sourceUrl ||
          readMetadataUrl(metadata, ['sourceUrl']) ||
          `https://www.usaspending.gov/search/?hash=${encodeURIComponent(awardId)}`,
        sourceLabel: award.sourceTitle || 'USASpending award record',
        status: 'awarded',
        metadata,
        updatedAt: award.updatedAt || null
      };
    })
    .filter((entry): entry is SpaceXContract => entry !== null);
}

function isSpaceXContractLikeAward(
  award: Awaited<ReturnType<typeof fetchProgramUsaspendingAwards>>[number]
) {
  if (award.awardFamily === 'contracts' || award.awardFamily === 'idvs') {
    return true;
  }
  if (award.awardFamily !== 'unknown') return false;

  const metadata = award.metadata || {};
  const sourceRow =
    metadata.sourceRow && typeof metadata.sourceRow === 'object' && !Array.isArray(metadata.sourceRow)
      ? (metadata.sourceRow as Record<string, unknown>)
      : null;
  const contractAwardType =
    (typeof sourceRow?.['Contract Award Type'] === 'string' ? sourceRow['Contract Award Type'] : null) ||
    (typeof sourceRow?.contract_award_type === 'string' ? sourceRow.contract_award_type : null);
  if (contractAwardType && contractAwardType.trim().length > 0) return true;

  const title = (award.title || '').toLowerCase();
  if (title.includes('contract') || title.includes('delivery order') || title.includes('purchase order')) {
    return true;
  }
  return false;
}

async function fetchSpaceXContractsFromScopedTable() {
  if (!isSupabaseConfigured()) return [] as SpaceXContract[];

  const supabase = createSupabasePublicClient();
  const rows: SpaceXContractsDbRow[] = [];
  let from = 0;

  while (rows.length < MAX_SPACEX_CONTRACT_ROWS) {
    const to = from + SPACEX_CONTRACTS_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('spacex_contracts')
      .select(
        'id,contract_key,mission_key,title,agency,customer,amount,awarded_on,description,source_url,source_label,status,metadata,updated_at'
      )
      .order('awarded_on', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('contract_key', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .range(from, to);

    if (error) {
      if (isMissingSpacexContractsRelationError(error.message || '')) return [];
      console.error('spacex contracts table query error', error);
      return [];
    }

    const chunk = (data || []) as SpaceXContractsDbRow[];
    if (!chunk.length) break;
    rows.push(...chunk);

    if (chunk.length < SPACEX_CONTRACTS_PAGE_SIZE) break;
    from += chunk.length;
  }

  return rows
    .slice(0, MAX_SPACEX_CONTRACT_ROWS)
    .map(mapSpacexContractsDbRow)
    .filter((row): row is SpaceXContract => row !== null);
}

function mapSpacexContractsDbRow(row: SpaceXContractsDbRow): SpaceXContract | null {
  const contractKey = row.contract_key;
  if (!contractKey) return null;
  const metadata = row.metadata || {};
  const title = (row.title || '').trim() || `USASpending award ${contractKey}`;
  const missionFromRow = isSpaceXMissionKey(row.mission_key || '') ? (row.mission_key as SpaceXMissionKey) : null;
  const missionKey = missionFromRow ?? classifyMissionFromContractText(`${title} ${row.description || ''} ${JSON.stringify(metadata)}`);
  const awardId = resolveArtemisAwardIdFromContractSeed({
    contractKey,
    sourceUrl: row.source_url,
    metadata
  });
  const sourceUrl =
    resolveUsaspendingAwardSourceUrl({
      awardId,
      sourceUrl: row.source_url,
      awardPageUrl: readMetadataUrl(metadata, ['awardPageUrl']),
      awardApiUrl: readMetadataUrl(metadata, ['awardApiUrl'])
    }) ||
    readMetadataUrl(metadata, ['sourceUrl']) ||
    null;

  return {
    id: row.id,
    contractKey,
    missionKey,
    title,
    agency: row.agency,
    customer: row.customer,
    amount: finiteNumberOrNull(row.amount),
    awardedOn: normalizeDate(row.awarded_on),
    description: buildContractDescription(metadata, row.description || title),
    sourceUrl,
    sourceLabel: row.source_label || 'USASpending award record',
    status: row.status || 'awarded',
    metadata,
    updatedAt: row.updated_at || null
  };
}

async function fetchSpaceXContractsFromSource() {
  const fromTable = await fetchSpaceXContractsFromScopedTable();
  if (fromTable.length > 0) return fromTable;
  return fetchSpaceXContractsFromProcurement();
}

async function attachContractStoryPresentation(rows: SpaceXContract[]) {
  if (rows.length < 1) return rows;

  const seeds = rows.map((row) => ({
    awardId: resolveArtemisAwardIdFromContractSeed({
      contractKey: row.contractKey,
      sourceUrl: row.sourceUrl,
      metadata: row.metadata
    }),
    piid: readMetadataText(row.metadata, ['piid']),
    contractKey: row.contractKey,
    solicitationId: readMetadataText(row.metadata, ['solicitationId', 'solicitation_id']),
    noticeId: readMetadataText(row.metadata, ['noticeId', 'notice_id']),
    sourceUrl: row.sourceUrl,
    metadata: row.metadata
  }));

  const [storyMap, leadCounts] = await Promise.all([
    fetchContractStorySummariesByAwards('spacex', seeds),
    fetchProgramContractLeadCountsBySeeds('spacex', seeds)
  ]);
  const exactSourceCounts = await fetchProgramContractSourceCountsByStoryKeys(
    [...new Set([...storyMap.values()].map((story) => story.storyKey).filter(Boolean))]
  );

  return rows.map((row, index) => {
    const key = buildStoryLookupMapKey(seeds[index]);
    const story = key ? storyMap.get(key) || null : null;
    const leadCount = key ? leadCounts.get(key) || 0 : 0;
    const exactSourceCount = story ? exactSourceCounts.get(story.storyKey) || 0 : 0;

    return {
      ...row,
      contractStory: story,
      storyPresentation: buildContractStoryPresentation({
        scope: 'spacex',
        story,
        leadCount,
        exactSourceCount,
        fallbackContractKey: row.contractKey
      })
    } satisfies SpaceXContract;
  });
}

function isMissingSpacexContractsRelationError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes('relation') && normalized.includes('spacex_contracts') && normalized.includes('does not exist');
}

function classifyMissionFromContractText(text: string): SpaceXMissionKey {
  const mission = getSpaceXMissionKeyFromText(text);
  if (mission) return mission;
  return 'spacex-program';
}

function readMetadataUrl(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && /^https?:\/\//.test(value)) return value;
  }
  return null;
}

function readMetadataText(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function buildContractDescription(metadata: Record<string, unknown>, fallbackTitle: string) {
  const candidates = [metadata.description, metadata.awardDescription, metadata.note];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return fallbackTitle;
}

function buildMissionHighlights(launches: Launch[], mission: SpaceXMissionKey) {
  const highlights: string[] = [];
  for (const launch of launches) {
    if (launch.mission?.type?.trim()) {
      const value = `Mission type: ${launch.mission.type.trim()}`;
      if (!highlights.includes(value)) highlights.push(value);
    }
    if (launch.pad?.shortCode?.trim()) {
      const value = `Pad: ${launch.pad.shortCode.trim()}`;
      if (!highlights.includes(value)) highlights.push(value);
    }
    for (const crew of launch.crew || []) {
      const astronaut = crew?.astronaut?.trim();
      if (!astronaut) continue;
      const value = crew?.role ? `${astronaut} (${crew.role})` : astronaut;
      if (!highlights.includes(value)) highlights.push(value);
      if (highlights.length >= 10) return highlights;
    }
    for (const payload of launch.payloads || []) {
      const name = payload?.name?.trim();
      if (!name) continue;
      const value = `Payload: ${name}`;
      if (!highlights.includes(value)) highlights.push(value);
      if (highlights.length >= 10) return highlights;
    }
  }

  if (!highlights.length) {
    if (mission === 'starship') highlights.push('Integrated flight-test cadence and developmental milestones.');
    if (mission === 'falcon-9') highlights.push('Reusable medium-lift mission cadence across commercial and government manifests.');
    if (mission === 'falcon-heavy') highlights.push('Heavy-lift mission readiness and schedule movement.');
    if (mission === 'dragon') highlights.push('Crew and cargo transportation mission context.');
    if (mission === 'spacex-program') highlights.push('Program-level SpaceX launch and systems timeline tracking.');
  }

  return highlights.slice(0, 10);
}

async function countSpaceXLaunchBucketRows(
  client: ReturnType<typeof createSupabasePublicClient>,
  options: {
    comparison: 'gte' | 'lt';
    nowIso: string;
    ascending: boolean;
  }
) {
  let offset = 0;
  const seen = new Set<string>();

  while (true) {
    let query = client
      .from('launches_public_cache')
      .select('*')
      .or(SPACEX_OR_FILTER)
      .order('net', { ascending: options.ascending })
      .range(offset, offset + SPACEX_COUNT_PAGE_SIZE - 1);

    query = options.comparison === 'gte' ? query.gte('net', options.nowIso) : query.lt('net', options.nowIso);

    const { data, error } = await query;
    if (error) {
      console.error('spacex tracked flight count query error', {
        comparison: options.comparison,
        error
      });
      return seen.size;
    }

    const rows = data || [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const launch = mapPublicCacheRow(row);
      if (!isSpaceXProgramLaunch(launch)) continue;
      seen.add(launch.id);
    }

    if (rows.length < SPACEX_COUNT_PAGE_SIZE) break;
    offset += rows.length;
  }

  return seen.size;
}

function resolveLastUpdated(launches: Launch[], fallbackIso: string) {
  const maxAllowedMs = Date.now() + LAST_UPDATED_MAX_FUTURE_MS;
  const candidates = launches
    .flatMap((launch) => [launch.cacheGeneratedAt, launch.lastUpdated, launch.net])
    .map((value) => toIsoOrNull(value))
    .filter((value): value is string => {
      if (!value) return false;
      const parsedMs = Date.parse(value);
      return Number.isFinite(parsedMs) && parsedMs <= maxAllowedMs;
    });

  if (!candidates.length) {
    const fallback = toIsoOrNull(fallbackIso);
    if (!fallback) return null;
    const parsedFallbackMs = Date.parse(fallback);
    return Number.isFinite(parsedFallbackMs) && parsedFallbackMs <= maxAllowedMs ? fallback : null;
  }

  return candidates.reduce((latest, current) => (Date.parse(current) > Date.parse(latest) ? current : latest));
}

function toIsoOrNull(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeIso(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function finiteNumberOrNull(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function buildSpaceXContractActions(contract: SpaceXContract): SpaceXContractAction[] {
  const sourceClass = String(contract.metadata?.sourceClass || '').toLowerCase();
  const source = sourceClass.includes('government') ? 'government-record' : 'derived-fallback';

  return [
    {
      id: `fallback:${contract.id}:action:0`,
      actionKey: `${contract.contractKey}:base-award`,
      modNumber: '0',
      actionDate: contract.awardedOn,
      obligationDelta: contract.amount,
      obligationCumulative: contract.amount,
      source,
      metadata: { derived: true },
      updatedAt: contract.updatedAt
    }
  ];
}

function mapArtemisContractAction(row: ArtemisContractActionRow): SpaceXContractAction {
  return {
    id: row.id,
    actionKey: row.actionKey,
    modNumber: row.modNumber,
    actionDate: row.actionDate,
    obligationDelta: row.obligationDelta,
    obligationCumulative: row.obligationCumulative,
    source: row.source || 'sam',
    metadata: row.metadata,
    updatedAt: row.updatedAt
  };
}

function mapArtemisOpportunityNotice(row: ArtemisOpportunityNoticeRow): SpaceXOpportunityNotice {
  return {
    id: row.id,
    noticeId: row.noticeId,
    solicitationId: row.solicitationId,
    title: row.title,
    postedDate: row.postedDate,
    responseDeadline: row.responseDeadline,
    awardeeName: row.awardeeName,
    awardAmount: row.awardAmount,
    noticeUrl: row.noticeUrl,
    metadata: row.metadata,
    updatedAt: row.updatedAt
  };
}

function mapArtemisSpendingPoint(row: ArtemisContractSpendingPointRow): SpaceXSpendingPoint {
  return {
    id: row.id,
    fiscalYear: row.fiscalYear,
    fiscalMonth: row.fiscalMonth,
    obligations: row.obligations,
    outlays: row.outlays,
    source: row.source || 'sam',
    metadata: row.metadata,
    updatedAt: row.updatedAt
  };
}

function buildSpaceXContractSpending(contract: SpaceXContract): SpaceXSpendingPoint[] {
  if (contract.amount == null || !contract.awardedOn) return [];
  const parsed = Date.parse(`${contract.awardedOn}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return [];
  const date = new Date(parsed);

  return [
    {
      id: `fallback:${contract.id}:spending:${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`,
      fiscalYear: date.getUTCFullYear(),
      fiscalMonth: date.getUTCMonth() + 1,
      obligations: contract.amount,
      outlays: null,
      source: 'derived-fallback',
      metadata: { derived: true },
      updatedAt: contract.updatedAt
    }
  ];
}

function normalizeSpaceXContractSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 128);
}

function dedupeById<T extends { id: string }>(values: T[]) {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const value of values) {
    if (seen.has(value.id)) continue;
    seen.add(value.id);
    deduped.push(value);
  }
  return deduped;
}

function dedupeSocialPosts(values: SpaceXSocialPost[]) {
  const byUrl = new Map<string, SpaceXSocialPost>();

  for (const value of values) {
    const normalizedUrl = normalizeSocialUrl(value.url);
    if (!normalizedUrl) continue;
    const existing = byUrl.get(normalizedUrl);
    if (!existing) {
      byUrl.set(normalizedUrl, value);
      continue;
    }

    const candidatePostedAt = Date.parse(value.postedAt || '');
    const existingPostedAt = Date.parse(existing.postedAt || '');
    const candidateMs = Number.isFinite(candidatePostedAt) ? candidatePostedAt : 0;
    const existingMs = Number.isFinite(existingPostedAt) ? existingPostedAt : 0;

    if (candidateMs > existingMs) {
      byUrl.set(normalizedUrl, value);
    }
  }

  return [...byUrl.values()].sort((a, b) => {
    const left = Date.parse(a.postedAt || '');
    const right = Date.parse(b.postedAt || '');
    const leftMs = Number.isFinite(left) ? left : 0;
    const rightMs = Number.isFinite(right) ? right : 0;
    return rightMs - leftMs;
  });
}

function normalizeSocialUrl(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return trimmed.replace(/\/$/, '');
  }
}

function normalizeHandle(primary: string | null | undefined, url: string | null | undefined) {
  const candidate = (primary || '').trim();
  if (candidate) return candidate.replace(/^@+/, '');
  const source = (url || '').trim();
  const match = source.match(/x\.com\/([A-Za-z0-9_]+)/i) || source.match(/twitter\.com\/([A-Za-z0-9_]+)/i);
  return match?.[1] || null;
}

function clampIntValue(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function dedupeByKey<T>(values: T[], toKey: (value: T) => string) {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const value of values) {
    const key = toKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }
  return deduped;
}

export function parseSpaceXVehicleSlug(value: string | null | undefined): SpaceXVehicleSlug | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
  if (normalized === 'starship-super-heavy') return normalized;
  if (normalized === 'falcon-9') return normalized;
  if (normalized === 'falcon-heavy') return normalized;
  if (normalized === 'dragon') return normalized;
  return null;
}

export function parseSpaceXEngineSlug(value: string | null | undefined): SpaceXEngineSlug | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
  if (normalized === 'raptor') return normalized;
  if (normalized === 'merlin-1d') return normalized;
  if (normalized === 'merlin-vac') return normalized;
  if (normalized === 'draco') return normalized;
  if (normalized === 'superdraco') return normalized;
  return null;
}

export function parseSpaceXMissionKey(value: string | null | undefined): SpaceXMissionKey | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
  if (isSpaceXMissionKey(normalized)) return normalized;
  if (normalized === 'spacex' || normalized === 'space-x' || normalized === 'program') return 'spacex-program';
  if (normalized === 'falcon9' || normalized === 'f9') return 'falcon-9';
  if (normalized === 'falconheavy' || normalized === 'fh') return 'falcon-heavy';
  if (normalized === 'crew-dragon' || normalized === 'cargo-dragon') return 'dragon';
  return null;
}
