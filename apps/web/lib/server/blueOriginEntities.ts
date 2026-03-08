import { cache } from 'react';
import { fetchBlueOriginFlightIndex } from '@/lib/server/blueOrigin';
import { isSupabaseConfigured } from '@/lib/server/env';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import type {
  BlueOriginEngine,
  BlueOriginEngineDetail,
  BlueOriginEngineResponse,
  BlueOriginEngineSlug,
  BlueOriginEngineVehicleBinding,
  BlueOriginFlightRecord,
  BlueOriginFlightsResponse,
  BlueOriginVehicle,
  BlueOriginVehicleDetail,
  BlueOriginVehicleEngineBinding,
  BlueOriginVehicleEngineLink,
  BlueOriginVehicleResponse,
  BlueOriginVehicleSlug
} from '@/lib/types/blueOrigin';
import { buildBlueOriginFlightSlug, type BlueOriginMissionKey } from '@/lib/utils/blueOrigin';

const MAX_ENTITY_ROWS = 300;
const MAX_FLIGHT_ROWS = 600;

const MISSION_LABELS: Record<BlueOriginMissionKey, string> = {
  'blue-origin-program': 'Blue Origin Program',
  'new-shepard': 'New Shepard',
  'new-glenn': 'New Glenn',
  'blue-moon': 'Blue Moon',
  'blue-ring': 'Blue Ring',
  'be-4': 'BE-4 Engines'
};

const VEHICLE_SLUGS: readonly BlueOriginVehicleSlug[] = ['new-shepard', 'new-glenn', 'blue-moon', 'blue-ring'];
const ENGINE_SLUGS: readonly BlueOriginEngineSlug[] = ['be-3pm', 'be-3u', 'be-4', 'be-7'];
const MISSION_KEYS: readonly BlueOriginMissionKey[] = [
  'blue-origin-program',
  'new-shepard',
  'new-glenn',
  'blue-moon',
  'blue-ring',
  'be-4'
];

type VehicleRow = {
  id: string;
  vehicle_slug: string;
  mission_key: string;
  display_name: string;
  vehicle_class: string | null;
  status: string | null;
  first_flight: string | null;
  description: string | null;
  official_url: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type EngineRow = {
  id: string;
  engine_slug: string;
  mission_key: string;
  display_name: string;
  propellants: string | null;
  cycle: string | null;
  thrust_vac_kn: number | null;
  thrust_sl_kn: number | null;
  status: string | null;
  description: string | null;
  official_url: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type VehicleEngineMapRow = {
  vehicle_slug: string;
  engine_slug: string;
  role: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
};

type FlightRow = {
  id: string;
  flight_code: string;
  mission_key: string;
  launch_id: string | null;
  ll2_launch_uuid: string | null;
  launch_name: string | null;
  launch_date: string | null;
  status: string | null;
  official_mission_url: string | null;
  source: string | null;
  confidence: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

const FALLBACK_VEHICLES: BlueOriginVehicle[] = [
  {
    id: 'fallback:new-shepard',
    vehicleSlug: 'new-shepard',
    missionKey: 'new-shepard',
    displayName: 'New Shepard',
    vehicleClass: 'suborbital',
    status: 'operational',
    firstFlight: '2015-04-29',
    description: "Blue Origin's reusable suborbital launch and landing system for crewed and research missions.",
    officialUrl: 'https://www.blueorigin.com/new-shepard',
    metadata: { sourceClass: 'curated-fallback', confidence: 'medium' },
    updatedAt: null
  },
  {
    id: 'fallback:new-glenn',
    vehicleSlug: 'new-glenn',
    missionKey: 'new-glenn',
    displayName: 'New Glenn',
    vehicleClass: 'orbital',
    status: 'active-flight-test',
    firstFlight: '2025-01-16',
    description: "Blue Origin's heavy-lift orbital launcher serving commercial, civil, and national security mission classes.",
    officialUrl: 'https://www.blueorigin.com/new-glenn',
    metadata: { sourceClass: 'curated-fallback', confidence: 'medium' },
    updatedAt: null
  },
  {
    id: 'fallback:blue-moon',
    vehicleSlug: 'blue-moon',
    missionKey: 'blue-moon',
    displayName: 'Blue Moon',
    vehicleClass: 'lunar-lander',
    status: 'in-development',
    firstFlight: null,
    description: "Blue Origin's lunar mission architecture for Artemis-linked and commercial lunar delivery scenarios.",
    officialUrl: 'https://www.blueorigin.com/blue-moon',
    metadata: { sourceClass: 'curated-fallback', confidence: 'medium' },
    updatedAt: null
  },
  {
    id: 'fallback:blue-ring',
    vehicleSlug: 'blue-ring',
    missionKey: 'blue-ring',
    displayName: 'Blue Ring',
    vehicleClass: 'in-space-logistics',
    status: 'in-development',
    firstFlight: null,
    description: "Blue Origin's in-space mobility and logistics platform for long-duration transportation and hosting.",
    officialUrl: 'https://www.blueorigin.com/blue-ring',
    metadata: { sourceClass: 'curated-fallback', confidence: 'medium' },
    updatedAt: null
  }
];

const FALLBACK_ENGINES: BlueOriginEngine[] = [
  {
    id: 'fallback:be-3pm',
    engineSlug: 'be-3pm',
    missionKey: 'new-shepard',
    displayName: 'BE-3PM',
    propellants: 'Liquid Hydrogen / Liquid Oxygen',
    cycle: 'Hydrogen-fueled, deep-throttle capable',
    thrustVacKN: null,
    thrustSlKN: null,
    status: 'operational',
    description: 'Reusable propulsion for New Shepard booster operations.',
    officialUrl: 'https://www.blueorigin.com/engines/be-3',
    metadata: { sourceClass: 'curated-fallback', confidence: 'medium' },
    updatedAt: null
  },
  {
    id: 'fallback:be-3u',
    engineSlug: 'be-3u',
    missionKey: 'blue-origin-program',
    displayName: 'BE-3U',
    propellants: 'Liquid Hydrogen / Liquid Oxygen',
    cycle: 'Vacuum-optimized upper-stage derivative',
    thrustVacKN: null,
    thrustSlKN: null,
    status: 'in-development',
    description: 'Vacuum-optimized variant for upper-stage mission architecture.',
    officialUrl: 'https://www.blueorigin.com/engines/be-3',
    metadata: { sourceClass: 'curated-fallback', confidence: 'medium' },
    updatedAt: null
  },
  {
    id: 'fallback:be-4',
    engineSlug: 'be-4',
    missionKey: 'be-4',
    displayName: 'BE-4',
    propellants: 'Liquefied Natural Gas / Liquid Oxygen',
    cycle: 'Oxidizer-rich staged combustion',
    thrustVacKN: null,
    thrustSlKN: null,
    status: 'operational',
    description: 'Methane-oxygen staged-combustion engine family for heavy-lift launch integration.',
    officialUrl: 'https://www.blueorigin.com/engines/be-4',
    metadata: { sourceClass: 'curated-fallback', confidence: 'medium' },
    updatedAt: null
  },
  {
    id: 'fallback:be-7',
    engineSlug: 'be-7',
    missionKey: 'blue-moon',
    displayName: 'BE-7',
    propellants: 'Liquid Hydrogen / Liquid Oxygen',
    cycle: 'High-precision deep throttle lunar descent',
    thrustVacKN: null,
    thrustSlKN: null,
    status: 'in-development',
    description: 'Lunar landing propulsion designed for precision throttle control.',
    officialUrl: 'https://www.blueorigin.com/engines/be-7',
    metadata: { sourceClass: 'curated-fallback', confidence: 'medium' },
    updatedAt: null
  }
];

const FALLBACK_VEHICLE_ENGINE_MAP: BlueOriginVehicleEngineLink[] = [
  {
    vehicleSlug: 'new-shepard',
    engineSlug: 'be-3pm',
    role: 'primary propulsion',
    notes: null,
    metadata: { sourceClass: 'curated-fallback', confidence: 'medium' }
  },
  {
    vehicleSlug: 'new-glenn',
    engineSlug: 'be-4',
    role: 'first-stage propulsion',
    notes: null,
    metadata: { sourceClass: 'curated-fallback', confidence: 'medium' }
  },
  {
    vehicleSlug: 'new-glenn',
    engineSlug: 'be-3u',
    role: 'upper-stage propulsion family',
    notes: 'Program architecture reference.',
    metadata: { sourceClass: 'curated-fallback', confidence: 'medium' }
  },
  {
    vehicleSlug: 'blue-moon',
    engineSlug: 'be-7',
    role: 'lunar descent propulsion',
    notes: null,
    metadata: { sourceClass: 'curated-fallback', confidence: 'medium' }
  }
];

export const fetchBlueOriginVehicles = cache(async (mission: BlueOriginMissionKey | 'all' = 'all'): Promise<BlueOriginVehicleResponse> => {
  const generatedAt = new Date().toISOString();
  const rows = await fetchVehiclesFromDatabase(mission);
  if (rows.length > 0) {
    return { generatedAt, mission, items: rows };
  }

  return {
    generatedAt,
    mission,
    items: FALLBACK_VEHICLES.filter((item) => (mission === 'all' ? true : item.missionKey === mission))
  };
});

export const fetchBlueOriginVehicleDetail = cache(async (vehicleSlug: BlueOriginVehicleSlug): Promise<BlueOriginVehicleDetail | null> => {
  const vehicle = await fetchVehicleBySlugFromDatabase(vehicleSlug);
  const resolvedVehicle = vehicle || FALLBACK_VEHICLES.find((entry) => entry.vehicleSlug === vehicleSlug) || null;
  if (!resolvedVehicle) return null;

  const mapRows = await fetchVehicleEngineMapForVehicle(vehicleSlug);
  const links = mapRows.length > 0 ? mapRows : FALLBACK_VEHICLE_ENGINE_MAP.filter((entry) => entry.vehicleSlug === vehicleSlug);
  const engines = await fetchEnginesBySlugs(links.map((entry) => entry.engineSlug));
  const engineBySlug = new Map(engines.map((engine) => [engine.engineSlug, engine]));

  const bindings: BlueOriginVehicleEngineBinding[] = links.map((link) => ({
    ...link,
    engine: engineBySlug.get(link.engineSlug) || FALLBACK_ENGINES.find((entry) => entry.engineSlug === link.engineSlug) || null
  }));

  return {
    vehicle: resolvedVehicle,
    engines: bindings
  };
});

export const fetchBlueOriginEngines = cache(async (mission: BlueOriginMissionKey | 'all' = 'all'): Promise<BlueOriginEngineResponse> => {
  const generatedAt = new Date().toISOString();
  const rows = await fetchEnginesFromDatabase(mission);
  if (rows.length > 0) {
    return { generatedAt, mission, items: rows };
  }

  return {
    generatedAt,
    mission,
    items: FALLBACK_ENGINES.filter((item) => (mission === 'all' ? true : item.missionKey === mission))
  };
});

export const fetchBlueOriginEngineDetail = cache(async (engineSlug: BlueOriginEngineSlug): Promise<BlueOriginEngineDetail | null> => {
  const engine = await fetchEngineBySlugFromDatabase(engineSlug);
  const resolvedEngine = engine || FALLBACK_ENGINES.find((entry) => entry.engineSlug === engineSlug) || null;
  if (!resolvedEngine) return null;

  const mapRows = await fetchVehicleEngineMapForEngine(engineSlug);
  const links = mapRows.length > 0 ? mapRows : FALLBACK_VEHICLE_ENGINE_MAP.filter((entry) => entry.engineSlug === engineSlug);
  const vehicles = await fetchVehiclesBySlugs(links.map((entry) => entry.vehicleSlug));
  const vehicleBySlug = new Map(vehicles.map((vehicle) => [vehicle.vehicleSlug, vehicle]));

  const bindings: BlueOriginEngineVehicleBinding[] = links.map((link) => ({
    ...link,
    vehicle: vehicleBySlug.get(link.vehicleSlug) || FALLBACK_VEHICLES.find((entry) => entry.vehicleSlug === link.vehicleSlug) || null
  }));

  return {
    engine: resolvedEngine,
    vehicles: bindings
  };
});

export const fetchBlueOriginFlights = cache(async (mission: BlueOriginMissionKey | 'all' = 'all'): Promise<BlueOriginFlightsResponse> => {
  const generatedAt = new Date().toISOString();
  const rows = await fetchFlightsFromDatabase(mission);
  if (rows.length > 0) {
    return {
      generatedAt,
      mission,
      items: dedupeFlightRecords(rows)
    };
  }

  const index = await fetchBlueOriginFlightIndex();
  const fallback = index
    .filter((entry) => (mission === 'all' ? true : entry.missionKey === mission))
    .map<BlueOriginFlightRecord>((entry) => ({
      id: `fallback:${entry.flightCode}`,
      flightCode: entry.flightCode,
      flightSlug: entry.flightSlug,
      missionKey: entry.missionKey,
      missionLabel: getBlueOriginMissionLabel(entry.missionKey),
      launchId: entry.nextLaunch?.id || null,
      ll2LaunchUuid: null,
      launchName: entry.nextLaunch?.name || null,
      launchDate: entry.nextLaunch?.net || entry.lastUpdated || null,
      status: entry.nextLaunch?.status || null,
      officialMissionUrl: null,
      source: 'launches_public_cache',
      confidence: 'medium',
      metadata: {
        upcomingCount: entry.upcomingCount,
        recentCount: entry.recentCount
      },
      updatedAt: entry.lastUpdated
    }));

  return {
    generatedAt,
    mission,
    items: dedupeFlightRecords(fallback)
  };
});

export function parseBlueOriginEntityMissionFilter(value: string | null): BlueOriginMissionKey | 'all' | null {
  if (!value) return 'all';
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '').replace(/_/g, '-');
  if (normalized === 'all') return 'all';
  if (normalized === 'program' || normalized === 'blue-origin' || normalized === 'blue-origin-program') return 'blue-origin-program';
  if (normalized === 'new-shepard' || normalized === 'newshepard' || normalized === 'shepard') return 'new-shepard';
  if (normalized === 'new-glenn' || normalized === 'newglenn' || normalized === 'glenn') return 'new-glenn';
  if (normalized === 'blue-moon' || normalized === 'bluemoon') return 'blue-moon';
  if (normalized === 'blue-ring' || normalized === 'bluering') return 'blue-ring';
  if (normalized === 'be-4' || normalized === 'be4') return 'be-4';
  return null;
}

export function parseBlueOriginVehicleSlug(value: string | null | undefined): BlueOriginVehicleSlug | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
  if (!VEHICLE_SLUGS.includes(normalized as BlueOriginVehicleSlug)) return null;
  return normalized as BlueOriginVehicleSlug;
}

export function parseBlueOriginEngineSlug(value: string | null | undefined): BlueOriginEngineSlug | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
  if (!ENGINE_SLUGS.includes(normalized as BlueOriginEngineSlug)) return null;
  return normalized as BlueOriginEngineSlug;
}

export function getBlueOriginMissionLabel(mission: BlueOriginMissionKey): string {
  return MISSION_LABELS[mission] || 'Blue Origin';
}

async function fetchVehiclesFromDatabase(mission: BlueOriginMissionKey | 'all') {
  if (!isSupabaseConfigured()) return [] as BlueOriginVehicle[];

  const supabase = createSupabasePublicClient();
  let query = supabase
    .from('blue_origin_vehicles')
    .select('id,vehicle_slug,mission_key,display_name,vehicle_class,status,first_flight,description,official_url,metadata,updated_at')
    .order('display_name', { ascending: true })
    .limit(MAX_ENTITY_ROWS);

  if (mission !== 'all') query = query.eq('mission_key', mission);

  const { data, error } = await query;
  if (error) {
    console.error('blue origin vehicles query error', error);
    return [] as BlueOriginVehicle[];
  }

  return ((data || []) as VehicleRow[]).map(mapVehicleRow);
}

async function fetchVehicleBySlugFromDatabase(vehicleSlug: BlueOriginVehicleSlug) {
  if (!isSupabaseConfigured()) return null;

  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from('blue_origin_vehicles')
    .select('id,vehicle_slug,mission_key,display_name,vehicle_class,status,first_flight,description,official_url,metadata,updated_at')
    .eq('vehicle_slug', vehicleSlug)
    .maybeSingle();

  if (error) {
    console.error('blue origin vehicle detail query error', error);
    return null;
  }

  return data ? mapVehicleRow(data as VehicleRow) : null;
}

async function fetchEnginesFromDatabase(mission: BlueOriginMissionKey | 'all') {
  if (!isSupabaseConfigured()) return [] as BlueOriginEngine[];

  const supabase = createSupabasePublicClient();
  let query = supabase
    .from('blue_origin_engines')
    .select('id,engine_slug,mission_key,display_name,propellants,cycle,thrust_vac_kn,thrust_sl_kn,status,description,official_url,metadata,updated_at')
    .order('display_name', { ascending: true })
    .limit(MAX_ENTITY_ROWS);

  if (mission !== 'all') query = query.eq('mission_key', mission);

  const { data, error } = await query;
  if (error) {
    console.error('blue origin engines query error', error);
    return [] as BlueOriginEngine[];
  }

  return ((data || []) as EngineRow[]).map(mapEngineRow);
}

async function fetchEngineBySlugFromDatabase(engineSlug: BlueOriginEngineSlug) {
  if (!isSupabaseConfigured()) return null;

  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from('blue_origin_engines')
    .select('id,engine_slug,mission_key,display_name,propellants,cycle,thrust_vac_kn,thrust_sl_kn,status,description,official_url,metadata,updated_at')
    .eq('engine_slug', engineSlug)
    .maybeSingle();

  if (error) {
    console.error('blue origin engine detail query error', error);
    return null;
  }

  return data ? mapEngineRow(data as EngineRow) : null;
}

async function fetchFlightsFromDatabase(mission: BlueOriginMissionKey | 'all') {
  if (!isSupabaseConfigured()) return [] as BlueOriginFlightRecord[];

  const supabase = createSupabasePublicClient();
  let query = supabase
    .from('blue_origin_flights')
    .select('id,flight_code,mission_key,launch_id,ll2_launch_uuid,launch_name,launch_date,status,official_mission_url,source,confidence,metadata,updated_at')
    .order('launch_date', { ascending: false, nullsFirst: false })
    .order('flight_code', { ascending: true })
    .limit(MAX_FLIGHT_ROWS);

  if (mission !== 'all') query = query.eq('mission_key', mission);

  const { data, error } = await query;
  if (error) {
    console.error('blue origin flights query error', error);
    return [] as BlueOriginFlightRecord[];
  }

  return ((data || []) as FlightRow[]).map(mapFlightRow);
}

async function fetchVehicleEngineMapForVehicle(vehicleSlug: BlueOriginVehicleSlug) {
  if (!isSupabaseConfigured()) return [] as BlueOriginVehicleEngineLink[];

  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from('blue_origin_vehicle_engine_map')
    .select('vehicle_slug,engine_slug,role,notes,metadata')
    .eq('vehicle_slug', vehicleSlug)
    .order('engine_slug', { ascending: true })
    .limit(64);

  if (error) {
    console.error('blue origin vehicle-engine map query error', error);
    return [] as BlueOriginVehicleEngineLink[];
  }

  return ((data || []) as VehicleEngineMapRow[]).map(mapVehicleEngineRow);
}

async function fetchVehicleEngineMapForEngine(engineSlug: BlueOriginEngineSlug) {
  if (!isSupabaseConfigured()) return [] as BlueOriginVehicleEngineLink[];

  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from('blue_origin_vehicle_engine_map')
    .select('vehicle_slug,engine_slug,role,notes,metadata')
    .eq('engine_slug', engineSlug)
    .order('vehicle_slug', { ascending: true })
    .limit(64);

  if (error) {
    console.error('blue origin engine-vehicle map query error', error);
    return [] as BlueOriginVehicleEngineLink[];
  }

  return ((data || []) as VehicleEngineMapRow[]).map(mapVehicleEngineRow);
}

async function fetchEnginesBySlugs(engineSlugs: BlueOriginEngineSlug[]) {
  if (!isSupabaseConfigured() || engineSlugs.length === 0) return [] as BlueOriginEngine[];
  const supabase = createSupabasePublicClient();
  const deduped = dedupe(engineSlugs);

  const { data, error } = await supabase
    .from('blue_origin_engines')
    .select('id,engine_slug,mission_key,display_name,propellants,cycle,thrust_vac_kn,thrust_sl_kn,status,description,official_url,metadata,updated_at')
    .in('engine_slug', deduped)
    .limit(64);

  if (error) {
    console.error('blue origin engines by slug query error', error);
    return [] as BlueOriginEngine[];
  }

  return ((data || []) as EngineRow[]).map(mapEngineRow);
}

async function fetchVehiclesBySlugs(vehicleSlugs: BlueOriginVehicleSlug[]) {
  if (!isSupabaseConfigured() || vehicleSlugs.length === 0) return [] as BlueOriginVehicle[];
  const supabase = createSupabasePublicClient();
  const deduped = dedupe(vehicleSlugs);

  const { data, error } = await supabase
    .from('blue_origin_vehicles')
    .select('id,vehicle_slug,mission_key,display_name,vehicle_class,status,first_flight,description,official_url,metadata,updated_at')
    .in('vehicle_slug', deduped)
    .limit(64);

  if (error) {
    console.error('blue origin vehicles by slug query error', error);
    return [] as BlueOriginVehicle[];
  }

  return ((data || []) as VehicleRow[]).map(mapVehicleRow);
}

function mapVehicleRow(row: VehicleRow): BlueOriginVehicle {
  return {
    id: row.id,
    vehicleSlug: normalizeVehicleSlug(row.vehicle_slug) || 'new-shepard',
    missionKey: normalizeMissionKey(row.mission_key),
    displayName: row.display_name,
    vehicleClass: row.vehicle_class,
    status: row.status,
    firstFlight: row.first_flight,
    description: row.description,
    officialUrl: row.official_url,
    metadata: toMetadata(row.metadata),
    updatedAt: row.updated_at
  };
}

function mapEngineRow(row: EngineRow): BlueOriginEngine {
  return {
    id: row.id,
    engineSlug: normalizeEngineSlug(row.engine_slug) || 'be-4',
    missionKey: normalizeMissionKey(row.mission_key),
    displayName: row.display_name,
    propellants: row.propellants,
    cycle: row.cycle,
    thrustVacKN: row.thrust_vac_kn,
    thrustSlKN: row.thrust_sl_kn,
    status: row.status,
    description: row.description,
    officialUrl: row.official_url,
    metadata: toMetadata(row.metadata),
    updatedAt: row.updated_at
  };
}

function mapVehicleEngineRow(row: VehicleEngineMapRow): BlueOriginVehicleEngineLink {
  return {
    vehicleSlug: normalizeVehicleSlug(row.vehicle_slug) || 'new-shepard',
    engineSlug: normalizeEngineSlug(row.engine_slug) || 'be-4',
    role: row.role,
    notes: row.notes,
    metadata: toMetadata(row.metadata)
  };
}

function mapFlightRow(row: FlightRow): BlueOriginFlightRecord {
  const missionKey = normalizeMissionKey(row.mission_key);
  const flightCode = normalizeFlightCode(row.flight_code);

  return {
    id: row.id,
    flightCode,
    flightSlug: buildBlueOriginFlightSlug(flightCode),
    missionKey,
    missionLabel: getBlueOriginMissionLabel(missionKey),
    launchId: row.launch_id,
    ll2LaunchUuid: row.ll2_launch_uuid,
    launchName: row.launch_name,
    launchDate: row.launch_date,
    status: row.status,
    officialMissionUrl: row.official_mission_url,
    source: row.source,
    confidence: normalizeConfidence(row.confidence),
    metadata: toMetadata(row.metadata),
    updatedAt: row.updated_at
  };
}

function normalizeMissionKey(value: string | null | undefined): BlueOriginMissionKey {
  if (!value) return 'blue-origin-program';
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
  if (MISSION_KEYS.includes(normalized as BlueOriginMissionKey)) {
    return normalized as BlueOriginMissionKey;
  }
  return 'blue-origin-program';
}

function normalizeVehicleSlug(value: string | null | undefined): BlueOriginVehicleSlug | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
  if (!VEHICLE_SLUGS.includes(normalized as BlueOriginVehicleSlug)) return null;
  return normalized as BlueOriginVehicleSlug;
}

function normalizeEngineSlug(value: string | null | undefined): BlueOriginEngineSlug | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
  if (!ENGINE_SLUGS.includes(normalized as BlueOriginEngineSlug)) return null;
  return normalized as BlueOriginEngineSlug;
}

function normalizeFlightCode(value: string | null | undefined) {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-')
    .replace(/-+/g, '-');
}

function normalizeConfidence(value: string | null | undefined): 'high' | 'medium' | 'low' {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'high') return 'high';
  if (normalized === 'low') return 'low';
  return 'medium';
}

function toMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {} as Record<string, unknown>;
  return value as Record<string, unknown>;
}

function dedupe<T extends string>(items: T[]) {
  return [...new Set(items)];
}

function dedupeFlightRecords(items: BlueOriginFlightRecord[]) {
  const byKey = new Map<string, BlueOriginFlightRecord>();

  for (const item of items) {
    const key = `${item.missionKey}:${item.flightCode}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }

    const currentScore = flightRecordScore(item);
    const existingScore = flightRecordScore(existing);
    if (currentScore > existingScore) {
      byKey.set(key, item);
    }
  }

  return [...byKey.values()].sort((a, b) => flightRecordScore(b) - flightRecordScore(a));
}

function flightRecordScore(item: BlueOriginFlightRecord) {
  const launchDate = Date.parse(item.launchDate || '');
  const updated = Date.parse(item.updatedAt || '');
  const primary = Number.isFinite(launchDate) ? launchDate : 0;
  const secondary = Number.isFinite(updated) ? updated : 0;
  return primary * 10 + secondary;
}
