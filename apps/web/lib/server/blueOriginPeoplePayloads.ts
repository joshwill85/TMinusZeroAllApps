import { cache } from 'react';
import { fetchBlueOriginLaunchBuckets } from '@/lib/server/blueOrigin';
import {
  fetchBlueOriginLl2Passengers,
  fetchBlueOriginWaybackAstronautDirectoryPassengers,
  fetchBlueOriginWaybackMissionPassengers,
  fetchBlueOriginWikipediaPassengers,
  fetchBlueOriginWikipediaProfilesByNames
} from '@/lib/server/blueOriginTravelerIngest';
import { createSupabasePrivilegedReadClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import type {
  BlueOriginPassengersResponse,
  BlueOriginPayload,
  BlueOriginPayloadsResponse,
  BlueOriginPassenger
} from '@/lib/types/blueOrigin';
import {
  buildBlueOriginTravelerIdentityKey,
  extractBlueOriginFlightCodeFromUrl,
  buildBlueOriginFlightSlug,
  buildBlueOriginTravelerSlug,
  extractBlueOriginFlightCode,
  getBlueOriginMissionKeyFromLaunch,
  isBlueOriginNonHumanCrewEntry,
  isBlueOriginOpenSourceProfileUrl,
  resolveBlueOriginTravelerCanonicalName,
  normalizeBlueOriginTravelerProfileUrl,
  normalizeBlueOriginTravelerRole,
  normalizeBlueOriginTravelerName,
  type BlueOriginMissionKey
} from '@/lib/utils/blueOrigin';

const MAX_ITEMS = 2000;
const NS_19_MISSION_URL = 'https://www.blueorigin.com/news/ns-19-mission-updates';
const NS_30_MISSION_URL = 'https://www.blueorigin.com/news/ns-30-mission-updates';
const NS_32_MISSION_URL = 'https://www.blueorigin.com/news/ns-32-mission-updates';
const NS_36_MISSION_URL = 'https://www.blueorigin.com/news/ns-36-mission-updates';
const NS_38_MISSION_URL = 'https://www.blueorigin.com/news/ns-38-mission-updates';
const PASSENGER_WIKIPEDIA_SUPPRESSION_BY_FLIGHT = new Map<string, Set<string>>([
  ['ns-30', new Set<string>(['russell wilson'])]
]);
const PASSENGER_WIKIPEDIA_ENRICHMENT_BLOCKLIST = new Set<string>(['russell wilson']);
const PASSENGER_AUTHORITATIVE_NAME_SUPPLEMENTS = new Map<string, Set<string>>([
  ['ns-19', new Set<string>(['laura shepard churchley'])],
  ['ns-30', new Set<string>(['elaine chia hyde', 'russell wilson'])],
  ['ns-32', new Set<string>(['gretchen green'])],
  ['ns-36', new Set<string>(['clint kelly iii'])]
]);
const PASSENGER_NOISE_PHRASE_PATTERN =
  /\b(?:share on|follow us|subscribe|watch on|press release|media kit)\b/i;
const PASSENGER_NOISE_TOKEN_PATTERN =
  /\b(?:share|facebook|linkedin|reddit|twitter|instagram|youtube|tiktok|club|future|nasa|kennedy|research|institute|laboratory|lab|center|payload|experiment|installation|device|deorbit|program|mission|patch|media|news|timeline|update|updates|gallery|video|watch|subscribe|follow|new shepard|new glenn|experience|parachute|parachutes)\b/i;
const withCache =
  typeof cache === 'function'
    ? cache
    : (<T extends (...args: any[]) => any>(fn: T): T => fn);

function createBlueOriginPrivateReadClient() {
  if (!isSupabaseAdminConfigured()) return null;
  return createSupabasePrivilegedReadClient();
}

const FALLBACK_PASSENGER_MANIFEST: Array<{
  missionKey: BlueOriginMissionKey;
  flightCode: string;
  name: string;
  role: string | null;
  launchDate: string | null;
  profileUrl?: string | null;
  imageUrl?: string | null;
  bio?: string | null;
  source: string;
  confidence: 'high' | 'medium' | 'low';
}> = [
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-19',
    name: 'Laura Shepard Churchley',
    role: 'Passenger',
    launchDate: '2021-12-11T15:00:42+00:00',
    profileUrl: NS_19_MISSION_URL,
    bio: "American philanthropist and daughter of astronaut Alan Shepard who flew to honor her father's legacy.",
    source: 'curated-fallback:official-page',
    confidence: 'high'
  },
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-36',
    name: 'Jeff Elgin',
    role: 'Passenger',
    launchDate: null,
    profileUrl: NS_36_MISSION_URL,
    bio: 'Entrepreneur and private pilot who founded several technology and software ventures in New York City.',
    source: 'curated-fallback:official-page',
    confidence: 'medium'
  },
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-36',
    name: 'Danna Karagussova',
    role: 'Passenger',
    launchDate: null,
    profileUrl: NS_36_MISSION_URL,
    bio: 'Kazakhstan-born entrepreneur with business and leadership roles in social innovation and community initiatives.',
    source: 'curated-fallback:official-page',
    confidence: 'medium'
  },
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-36',
    name: 'Clint Kelly III',
    role: 'Passenger',
    launchDate: '2025-10-08T13:40:27+00:00',
    profileUrl: NS_36_MISSION_URL,
    bio: 'Technology leader, entrepreneur, and U.S. Army veteran who served as both a firefighter and middle school teacher.',
    source: 'curated-fallback:official-page',
    confidence: 'medium'
  },
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-36',
    name: 'Will Lewis',
    role: 'Passenger',
    launchDate: null,
    profileUrl: NS_36_MISSION_URL,
    bio: 'Former teacher and entrepreneur focused on advancing educational access and student achievement.',
    source: 'curated-fallback:official-page',
    confidence: 'medium'
  },
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-36',
    name: 'Aaron Newman',
    role: 'Passenger',
    launchDate: null,
    profileUrl: NS_36_MISSION_URL,
    bio: 'Software and cybersecurity entrepreneur known for founding and operating technology companies.',
    source: 'curated-fallback:official-page',
    confidence: 'medium'
  },
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-36',
    name: 'Vitalii Ostrovskyi',
    role: 'Passenger',
    launchDate: null,
    profileUrl: NS_36_MISSION_URL,
    bio: 'Ukrainian private investor and entrepreneur supporting science, health, and educational initiatives.',
    source: 'curated-fallback:official-page',
    confidence: 'medium'
  },
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-38',
    name: 'Tim Dodd',
    role: 'Passenger',
    launchDate: '2026-01-22T16:25:35+00:00',
    profileUrl: NS_38_MISSION_URL,
    source: 'curated-fallback:official-recap',
    confidence: 'medium'
  },
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-38',
    name: 'Grace Potter',
    role: 'Passenger',
    launchDate: '2026-01-22T16:25:35+00:00',
    profileUrl: NS_38_MISSION_URL,
    source: 'curated-fallback:official-recap',
    confidence: 'medium'
  },
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-38',
    name: 'Allie Kuehner',
    role: 'Passenger',
    launchDate: '2026-01-22T16:25:35+00:00',
    profileUrl: NS_38_MISSION_URL,
    source: 'curated-fallback:official-recap',
    confidence: 'medium'
  },
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-38',
    name: 'Gokhan Erdem',
    role: 'Passenger',
    launchDate: '2026-01-22T16:25:35+00:00',
    profileUrl: NS_38_MISSION_URL,
    source: 'curated-fallback:official-recap',
    confidence: 'medium'
  },
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-38',
    name: 'Justin Sun',
    role: 'Passenger',
    launchDate: '2026-01-22T16:25:35+00:00',
    profileUrl: NS_38_MISSION_URL,
    source: 'curated-fallback:official-recap',
    confidence: 'medium'
  },
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-38',
    name: 'Arvinder Singh Bahal',
    role: 'Passenger',
    launchDate: '2026-01-22T16:25:35+00:00',
    profileUrl: NS_38_MISSION_URL,
    source: 'curated-fallback:official-recap',
    confidence: 'medium'
  },
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-30',
    name: 'Jesus Calleja',
    role: 'Passenger',
    launchDate: '2025-02-25T15:49:11+00:00',
    source: 'curated-fallback:official-release',
    confidence: 'medium'
  },
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-30',
    name: 'Russell Wilson',
    role: 'Passenger',
    launchDate: '2025-02-25T15:49:11+00:00',
    profileUrl: NS_30_MISSION_URL,
    bio: 'Australian technology entrepreneur and founder of crypto exchange CoinSpot.',
    source: 'curated-fallback:public-reporting',
    confidence: 'low'
  },
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-30',
    name: 'Lane Bess',
    role: 'Passenger',
    launchDate: '2025-02-25T15:49:11+00:00',
    source: 'curated-fallback:official-release',
    confidence: 'medium'
  },
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-30',
    name: 'Elaine Chia Hyde',
    role: 'Passenger',
    launchDate: '2025-02-25T15:49:11+00:00',
    source: 'curated-fallback:official-release',
    confidence: 'medium'
  },
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-30',
    name: 'Richard Scott',
    role: 'Passenger',
    launchDate: '2025-02-25T15:49:11+00:00',
    source: 'curated-fallback:official-release',
    confidence: 'medium'
  },
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-30',
    name: 'Tushar Shah',
    role: 'Passenger',
    launchDate: '2025-02-25T15:49:11+00:00',
    source: 'curated-fallback:official-release',
    confidence: 'medium'
  },
  {
    missionKey: 'new-shepard',
    flightCode: 'ns-32',
    name: 'Gretchen Green',
    role: 'Passenger',
    launchDate: '2025-05-31T13:39:11+00:00',
    profileUrl: NS_32_MISSION_URL,
    bio: 'Radiologist, educator, and explorer known for humanitarian and global health work.',
    source: 'curated-fallback:official-page',
    confidence: 'high'
  }
];

type PassengerRow = {
  id: string;
  mission_key: BlueOriginMissionKey;
  flight_code: string | null;
  flight_slug: string | null;
  traveler_slug?: string | null;
  name: string;
  role: string | null;
  nationality: string | null;
  launch_id: string | null;
  launch_name: string | null;
  launch_date: string | null;
  source: string | null;
  confidence: string | null;
  metadata: Record<string, unknown> | null;
};

type PayloadRow = {
  id: string;
  mission_key: BlueOriginMissionKey;
  flight_code: string | null;
  flight_slug: string | null;
  name: string;
  payload_type: string | null;
  orbit: string | null;
  agency: string | null;
  launch_id: string | null;
  launch_name: string | null;
  launch_date: string | null;
  source: string | null;
  confidence: string | null;
};

export const fetchBlueOriginPassengers = withCache(async (mission: BlueOriginMissionKey | 'all' = 'all'): Promise<BlueOriginPassengersResponse> => {
  const generatedAt = new Date().toISOString();
  const [dbRows, derived, wikipediaRows, ll2Rows, waybackRows, astronautDirectoryRows] = await Promise.all([
    fetchPassengerRowsFromDatabase(mission),
    derivePassengersFromLaunches(mission),
    mission === 'all' || mission === 'new-shepard' ? fetchBlueOriginWikipediaPassengers() : Promise.resolve([] as BlueOriginPassenger[]),
    mission === 'all' || mission === 'new-shepard' ? fetchBlueOriginLl2Passengers() : Promise.resolve([] as BlueOriginPassenger[]),
    mission === 'all' || mission === 'new-shepard'
      ? fetchBlueOriginWaybackMissionPassengers()
      : Promise.resolve([] as BlueOriginPassenger[]),
    mission === 'all' || mission === 'new-shepard'
      ? fetchBlueOriginWaybackAstronautDirectoryPassengers()
      : Promise.resolve([] as BlueOriginPassenger[])
  ]);
  const fallback = buildFallbackPassengerRows(mission);
  const normalized = normalizePassengerRows([
    ...waybackRows,
    ...astronautDirectoryRows,
    ...ll2Rows,
    ...wikipediaRows,
    ...dbRows,
    ...derived,
    ...fallback
  ]);
  const reconciled = reconcileOfficialMissionRows(normalized);
  const enriched = await enrichPassengersWithWikipediaProfiles(reconciled);
  const withFlightMediaFallback = applyFlightLevelMediaFallback(enriched);
  const deduped = dedupePassengers(withFlightMediaFallback);
  const withBioFallback = applyPassengerBioFallback(deduped);
  return {
    generatedAt,
    mission,
    items: sortPassengers(withBioFallback).slice(0, MAX_ITEMS)
  };
});

export const fetchBlueOriginPassengersDatabaseOnly = withCache(
  async (mission: BlueOriginMissionKey | 'all' = 'all'): Promise<BlueOriginPassengersResponse> => {
    const generatedAt = new Date().toISOString();
    const dbRows = await fetchPassengerRowsFromDatabase(mission);
    const normalized = normalizePassengerRows(dbRows);
    const reconciled = reconcileOfficialMissionRows(normalized);
    const deduped = dedupePassengers(reconciled);
    const withFlightMediaFallback = applyFlightLevelMediaFallback(deduped);
    const withBioFallback = applyPassengerBioFallback(withFlightMediaFallback);

    return {
      generatedAt,
      mission,
      items: sortPassengers(withBioFallback).slice(0, MAX_ITEMS)
    };
  }
);

export const fetchBlueOriginPayloads = withCache(async (mission: BlueOriginMissionKey | 'all' = 'all'): Promise<BlueOriginPayloadsResponse> => {
  const generatedAt = new Date().toISOString();
  const [dbRows, derived] = await Promise.all([fetchPayloadRowsFromDatabase(mission), derivePayloadsFromLaunches(mission)]);
  return {
    generatedAt,
    mission,
    items: dedupePayloads([...dbRows, ...derived]).slice(0, MAX_ITEMS)
  };
});

async function fetchPassengerRowsFromDatabase(mission: BlueOriginMissionKey | 'all') {
  if (!isSupabaseConfigured()) return [] as BlueOriginPassenger[];

  const queryClient = async (
    client: ReturnType<typeof createSupabasePrivilegedReadClient>,
    includeTravelerSlug: boolean
  ) => {
    const selectColumns = includeTravelerSlug
      ? 'id,mission_key,flight_code,flight_slug,traveler_slug,name,role,nationality,launch_id,launch_name,launch_date,source,confidence,metadata'
      : 'id,mission_key,flight_code,flight_slug,name,role,nationality,launch_id,launch_name,launch_date,source,confidence,metadata';

    let query = client
      .from('blue_origin_passengers')
      .select(selectColumns)
      .order('launch_date', { ascending: false, nullsFirst: false })
      .order('name', { ascending: true })
      .limit(MAX_ITEMS);

    if (mission !== 'all') {
      query = query.eq('mission_key', mission);
    }

    return await query;
  };

  const runQuery = async (
    client: ReturnType<typeof createSupabasePrivilegedReadClient>
  ) => {
    let result = await queryClient(client, true);
    if (result.error && /traveler_slug/i.test(result.error.message || '')) {
      result = await queryClient(client, false);
    }
    return result;
  };

  const supabase = createBlueOriginPrivateReadClient();
  if (!supabase) return [] as BlueOriginPassenger[];

  const dataResult = await runQuery(supabase);

  if (dataResult.error) {
    console.error('blue origin passengers query error', dataResult.error);
    return [] as BlueOriginPassenger[];
  }

  return ((dataResult.data || []) as unknown as PassengerRow[]).map((row) => ({
    id: row.id,
    missionKey: row.mission_key,
    flightCode: row.flight_code,
    flightSlug: row.flight_slug,
    travelerSlug: row.traveler_slug,
    seatIndex: readPassengerSeatIndex(row.metadata),
    name: row.name,
    role: row.role,
    nationality: row.nationality,
    launchId: row.launch_id,
    launchName: row.launch_name,
    launchDate: row.launch_date,
    profileUrl: resolvePreferredPassengerProfileUrl(row.metadata),
    imageUrl: readPassengerMetadataUrl(row.metadata, [
      'imageUrl',
      'image_url',
      'profileImage',
      'profile_image',
      'profile_image_thumbnail',
      'profileImageThumbnail'
    ]),
    bio: readPassengerMetadataText(row.metadata, ['bio', 'summary']),
    source: row.source || 'database',
    confidence: normalizeConfidence(row.confidence)
  }));
}

async function fetchPayloadRowsFromDatabase(mission: BlueOriginMissionKey | 'all') {
  if (!isSupabaseConfigured()) return [] as BlueOriginPayload[];

  const selectColumns =
    'id,mission_key,flight_code,flight_slug,name,payload_type,orbit,agency,launch_id,launch_name,launch_date,source,confidence';
  const queryClient = async (
    client: ReturnType<typeof createSupabasePrivilegedReadClient>
  ) => {
    let query = client
      .from('blue_origin_payloads')
      .select(selectColumns)
      .order('launch_date', { ascending: false, nullsFirst: false })
      .order('name', { ascending: true })
      .limit(MAX_ITEMS);

    if (mission !== 'all') {
      query = query.eq('mission_key', mission);
    }

    return await query;
  };

  const supabase = createBlueOriginPrivateReadClient();
  if (!supabase) return [] as BlueOriginPayload[];

  const dataResult = await queryClient(supabase);

  if (dataResult.error) {
    console.error('blue origin payloads query error', dataResult.error);
    return [] as BlueOriginPayload[];
  }

  return ((dataResult.data || []) as PayloadRow[]).map((row) => ({
    id: row.id,
    missionKey: row.mission_key,
    flightCode: row.flight_code,
    flightSlug: row.flight_slug,
    name: row.name,
    payloadType: row.payload_type,
    orbit: row.orbit,
    agency: row.agency,
    launchId: row.launch_id,
    launchName: row.launch_name,
    launchDate: row.launch_date,
    source: row.source || 'database',
    confidence: normalizeConfidence(row.confidence)
  }));
}

async function derivePassengersFromLaunches(mission: BlueOriginMissionKey | 'all') {
  const buckets = await fetchBlueOriginLaunchBuckets();
  const launches = [...buckets.upcoming, ...buckets.recent];
  const deduped = dedupeById(launches);

  const passengers: BlueOriginPassenger[] = [];

  for (const launch of deduped) {
    const missionKey = getBlueOriginMissionKeyFromLaunch(launch) || 'blue-origin-program';
    if (mission !== 'all' && missionKey !== mission) continue;

    const flightCode = extractBlueOriginFlightCode(launch);
    const flightSlug = flightCode ? buildBlueOriginFlightSlug(flightCode) : null;

    for (const crew of launch.crew || []) {
      const name = crew?.astronaut?.trim();
      if (!name) continue;
      const role = crew?.role?.trim() || 'passenger';

      passengers.push({
        id: `${launch.id}:${name.toLowerCase().replace(/\s+/g, '-')}`,
        missionKey,
        flightCode,
        flightSlug,
        name,
        role,
        nationality: crew?.nationality || null,
        launchId: launch.id,
        launchName: launch.name,
        launchDate: launch.net,
        profileUrl: null,
        imageUrl: null,
        bio: null,
        source: 'launches_public_cache.crew',
        confidence: 'medium'
      });
    }
  }

  return dedupePassengers(passengers).slice(0, MAX_ITEMS);
}

async function derivePayloadsFromLaunches(mission: BlueOriginMissionKey | 'all') {
  const buckets = await fetchBlueOriginLaunchBuckets();
  const launches = [...buckets.upcoming, ...buckets.recent];
  const deduped = dedupeById(launches);

  const payloads: BlueOriginPayload[] = [];

  for (const launch of deduped) {
    const missionKey = getBlueOriginMissionKeyFromLaunch(launch) || 'blue-origin-program';
    if (mission !== 'all' && missionKey !== mission) continue;

    const flightCode = extractBlueOriginFlightCode(launch);
    const flightSlug = flightCode ? buildBlueOriginFlightSlug(flightCode) : null;

    for (const payload of launch.payloads || []) {
      const name = payload?.name?.trim();
      if (!name) continue;

      payloads.push({
        id: `${launch.id}:${name.toLowerCase().replace(/\s+/g, '-')}`,
        missionKey,
        flightCode,
        flightSlug,
        name,
        payloadType: payload?.type?.trim() || null,
        orbit: payload?.orbit?.trim() || null,
        agency: payload?.agency?.trim() || null,
        launchId: launch.id,
        launchName: launch.name,
        launchDate: launch.net,
        source: 'launches_public_cache.payloads',
        confidence: 'medium'
      });
    }
  }

  return dedupePayloads(payloads).slice(0, MAX_ITEMS);
}

function normalizeConfidence(value: string | null | undefined): 'high' | 'medium' | 'low' {
  const normalized = (value || '').toLowerCase().trim();
  if (normalized === 'high') return 'high';
  if (normalized === 'low') return 'low';
  return 'medium';
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

function dedupePassengers(items: BlueOriginPassenger[]) {
  const deduped = new Map<string, BlueOriginPassenger>();
  for (const item of items) {
    const normalizedName = normalizePassengerName(item.name);
    if (!normalizedName) continue;
    const launchKey =
      normalizeDedupeKey(item.flightCode) ||
      normalizeDedupeKey(item.launchId) ||
      normalizeDedupeKey(item.launchName) ||
      'na';
    const key = `${launchKey}:${normalizedName}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, { ...item });
      continue;
    }

    const preferred = pickPreferredPassengerRow(existing, item);
    const secondary = preferred === existing ? item : existing;
    deduped.set(key, mergePassengerRows(preferred, secondary));
  }
  return [...deduped.values()];
}

function pickPreferredPassengerRow(left: BlueOriginPassenger, right: BlueOriginPassenger) {
  const leftScore = passengerRowScore(left);
  const rightScore = passengerRowScore(right);
  if (rightScore > leftScore) return right;
  return left;
}

function mergePassengerRows(preferred: BlueOriginPassenger, secondary: BlueOriginPassenger) {
  const merged: BlueOriginPassenger = { ...preferred };
  const blockOpenSourceBackfill =
    isPublicReportingPassengerSource(preferred.source) && isWikipediaPassengerSource(secondary.source);

  if (!merged.profileUrl && secondary.profileUrl && !blockOpenSourceBackfill) merged.profileUrl = secondary.profileUrl;
  if (!merged.imageUrl && secondary.imageUrl && !blockOpenSourceBackfill) merged.imageUrl = secondary.imageUrl;
  if (!merged.bio && secondary.bio && !blockOpenSourceBackfill) merged.bio = secondary.bio;
  if (!merged.launchDate && secondary.launchDate) merged.launchDate = secondary.launchDate;
  if (!merged.launchId && secondary.launchId) merged.launchId = secondary.launchId;
  if (!merged.flightCode && secondary.flightCode) merged.flightCode = secondary.flightCode;
  if (!merged.flightSlug && secondary.flightSlug) merged.flightSlug = secondary.flightSlug;
  if (!merged.nationality && secondary.nationality) merged.nationality = secondary.nationality;
  if (!merged.launchName && secondary.launchName) merged.launchName = secondary.launchName;
  if ((!merged.role || !isCanonicalPassengerRole(merged.role)) && secondary.role && isCanonicalPassengerRole(secondary.role)) {
    merged.role = secondary.role;
  } else if (!merged.role && secondary.role) {
    merged.role = secondary.role;
  }
  if (merged.seatIndex == null && secondary.seatIndex != null) merged.seatIndex = secondary.seatIndex;

  return merged;
}

function passengerRowScore(row: BlueOriginPassenger) {
  let score = passengerSourceRank(row.source) * 100;
  score += passengerConfidenceRank(row.confidence) * 20;
  if (row.profileUrl) score += 6;
  if (row.imageUrl) score += 5;
  if (row.bio) score += 5;
  if (row.nationality) score += 1;
  if (row.role) score += 1;
  return score;
}

function passengerSourceRank(source: string | null | undefined) {
  const normalized = (source || '').toLowerCase();
  if (normalized.startsWith('blue-origin-wayback:new-shepard-mission-page')) return 9;
  if (normalized.startsWith('blue-origin-wayback:new-shepard-astronaut-directory')) return 8.5;
  if (normalized.startsWith('blue-origin-wayback:new-shepard-mission-rollup')) return 8;
  if (normalized.startsWith('ll2-api:')) return 7;
  if (normalized.startsWith('curated-fallback:public-reporting')) return 6.5;
  if (normalized === 'database') return 6;
  if (normalized.startsWith('wikipedia:')) return 5;
  if (normalized.startsWith('launches_public_cache.crew')) return 3;
  if (normalized.startsWith('curated-fallback:')) return 2;
  return 1;
}

function passengerConfidenceRank(value: BlueOriginPassenger['confidence']) {
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  return 1;
}

function sortPassengers(items: BlueOriginPassenger[]) {
  return [...items].sort((left, right) => {
    const leftDate = Date.parse(left.launchDate || '');
    const rightDate = Date.parse(right.launchDate || '');
    if (Number.isFinite(leftDate) && Number.isFinite(rightDate) && leftDate !== rightDate) {
      return rightDate - leftDate;
    }
    if (left.flightCode && right.flightCode && left.flightCode !== right.flightCode) {
      return right.flightCode.localeCompare(left.flightCode, undefined, { numeric: true, sensitivity: 'base' });
    }
    return left.name.localeCompare(right.name);
  });
}

function dedupePayloads(items: BlueOriginPayload[]) {
  const seen = new Set<string>();
  const deduped: BlueOriginPayload[] = [];
  for (const item of items) {
    const launchKey =
      normalizeDedupeKey(item.flightCode) ||
      normalizeDedupeKey(item.launchId) ||
      normalizeDedupeKey(item.launchName) ||
      'na';
    const key = `${launchKey}:${item.name.toLowerCase()}:${(item.payloadType || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function normalizeDedupeKey(value: string | null | undefined) {
  const normalized = (value || '').trim().toLowerCase();
  return normalized || null;
}

function reconcileOfficialMissionRows(items: BlueOriginPassenger[]) {
  const missionPageNamesByFlight = new Map<string, Set<string>>();
  const astronautDirectoryNamesByFlight = new Map<string, Set<string>>();
  const rollupNamesByFlight = new Map<string, Set<string>>();
  const ll2NamesByFlight = new Map<string, Set<string>>();
  const fallbackNamesByFlight = new Map<string, Set<string>>();

  for (const row of items) {
    const flightCode = resolvePassengerFlightCode(row);
    if (!flightCode) continue;

    const passengerName = normalizePassengerName(row.name);
    if (!passengerName) continue;

    const source = (row.source || '').toLowerCase();
    if (source.startsWith('blue-origin-wayback:new-shepard-astronaut-directory')) {
      const directoryNames = astronautDirectoryNamesByFlight.get(flightCode) || new Set<string>();
      directoryNames.add(passengerName);
      astronautDirectoryNamesByFlight.set(flightCode, directoryNames);
    }
    if (source.startsWith('ll2-api:')) {
      const ll2Names = ll2NamesByFlight.get(flightCode) || new Set<string>();
      ll2Names.add(passengerName);
      ll2NamesByFlight.set(flightCode, ll2Names);
    }
    if (source.startsWith('curated-fallback:')) {
      const fallbackNames = fallbackNamesByFlight.get(flightCode) || new Set<string>();
      fallbackNames.add(passengerName);
      fallbackNamesByFlight.set(flightCode, fallbackNames);
    }
    if (!source.startsWith('blue-origin-wayback:')) continue;

    if (source.includes('mission-rollup')) {
      const rollupNames = rollupNamesByFlight.get(flightCode) || new Set<string>();
      rollupNames.add(passengerName);
      rollupNamesByFlight.set(flightCode, rollupNames);
      continue;
    }

    const missionNames = missionPageNamesByFlight.get(flightCode) || new Set<string>();
    missionNames.add(passengerName);
    missionPageNamesByFlight.set(flightCode, missionNames);
  }

  const authoritativeNamesByFlight = new Map<string, Set<string>>();
  const flightCodes = new Set<string>([
    ...missionPageNamesByFlight.keys(),
    ...astronautDirectoryNamesByFlight.keys(),
    ...ll2NamesByFlight.keys(),
    ...rollupNamesByFlight.keys(),
    ...fallbackNamesByFlight.keys()
  ]);
  for (const flightCode of flightCodes) {
    const directoryNames = astronautDirectoryNamesByFlight.get(flightCode);
    if (directoryNames && directoryNames.size >= 4) {
      authoritativeNamesByFlight.set(flightCode, directoryNames);
      continue;
    }

    const missionNames = missionPageNamesByFlight.get(flightCode);
    if (missionNames && missionNames.size >= 4) {
      authoritativeNamesByFlight.set(flightCode, missionNames);
      continue;
    }

    const ll2Names = ll2NamesByFlight.get(flightCode);
    if (ll2Names && ll2Names.size >= 4) {
      authoritativeNamesByFlight.set(flightCode, ll2Names);
      continue;
    }

    const rollupNames = rollupNamesByFlight.get(flightCode);
    if (rollupNames && rollupNames.size >= 6) {
      authoritativeNamesByFlight.set(flightCode, rollupNames);
      continue;
    }

    const fallbackNames = fallbackNamesByFlight.get(flightCode);
    if (
      fallbackNames &&
      fallbackNames.size >= 5 &&
      !(missionNames && missionNames.size >= 1) &&
      !(directoryNames && directoryNames.size >= 1) &&
      !(ll2Names && ll2Names.size >= 1) &&
      !(rollupNames && rollupNames.size >= 1)
    ) {
      authoritativeNamesByFlight.set(flightCode, fallbackNames);
      continue;
    }
  }

  for (const [flightCode, supplementalNames] of PASSENGER_AUTHORITATIVE_NAME_SUPPLEMENTS) {
    const officialNames = authoritativeNamesByFlight.get(flightCode);
    if (!officialNames || !supplementalNames.size) continue;
    const mergedNames = new Set<string>([...officialNames, ...supplementalNames]);
    authoritativeNamesByFlight.set(flightCode, mergedNames);
  }

  if (!authoritativeNamesByFlight.size) return items;

  return items.filter((row) => {
    const flightCode = resolvePassengerFlightCode(row);
    if (!flightCode) return true;

    const officialNames = authoritativeNamesByFlight.get(flightCode);
    if (!officialNames) return true;

    const source = (row.source || '').toLowerCase();
    if (source.startsWith('blue-origin-wayback:')) {
      const normalizedName = normalizePassengerName(row.name);
      if (!normalizedName) return false;
      return officialNames.has(normalizedName);
    }

    const normalizedName = normalizePassengerName(row.name);
    if (!normalizedName) return false;
    return officialNames.has(normalizedName);
  });
}

function resolvePassengerFlightCode(item: BlueOriginPassenger) {
  const direct = normalizeDedupeKey(item.flightCode);
  if (direct) return direct;

  const launchName = (item.launchName || '').trim().toLowerCase();
  if (!launchName) return null;
  const match = launchName.match(/\b(ns-\d+)\b/);
  return match?.[1] || null;
}

function normalizePassengerName(value: string | null | undefined) {
  return buildBlueOriginTravelerIdentityKey(value);
}

function normalizePassengerRows(items: BlueOriginPassenger[]) {
  const normalized: BlueOriginPassenger[] = [];

  for (const row of items) {
    const flightCode = normalizePassengerFlightCode(row.flightCode, row.launchName);
    const cleanedName = normalizePassengerDisplayName(row.name, flightCode);
    if (!cleanedName) continue;
    if (isBlueOriginNonHumanCrewEntry(cleanedName, row.role)) continue;
    const source = normalizeOptionalText(row.source) || 'derived';
    if (shouldSuppressWikipediaPassengerRow(cleanedName, flightCode, source)) continue;

    normalized.push({
      ...row,
      flightCode,
      flightSlug: flightCode ? buildBlueOriginFlightSlug(flightCode) : row.flightSlug || null,
      travelerSlug: row.travelerSlug || buildBlueOriginTravelerSlug(cleanedName),
      name: cleanedName,
      role: normalizePassengerRole(row.role),
      nationality: normalizePassengerNationality(row.nationality),
      profileUrl: normalizeProfileUrl(row.profileUrl || null, row.source),
      imageUrl: normalizeUrl(row.imageUrl || null),
      bio: normalizePassengerBio(row.bio || null),
      launchId: normalizeOptionalText(row.launchId),
      launchName: normalizeOptionalText(row.launchName),
      source
    });
  }

  return normalized;
}

function normalizePassengerDisplayName(value: string | null | undefined, flightCode: string | null) {
  const normalized = normalizeBlueOriginTravelerName(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;
  if (/[|=]/.test(normalized)) return null;
  if (!/\p{L}/u.test(normalized)) return null;
  if (/(crew\d+_|position\d+|flights?\d+)/i.test(normalized)) return null;
  if (normalized.length > 96) return null;
  if (PASSENGER_NOISE_PHRASE_PATTERN.test(normalized)) return null;
  if (PASSENGER_NOISE_TOKEN_PATTERN.test(normalized)) return null;

  const normalizedKey = normalizePassengerName(normalized);
  if (!normalizedKey) return null;
  const tokens = normalizedKey.split(' ').filter(Boolean);
  if (tokens.length < 2 || tokens.length > 6) return null;
  if (!tokens.some((token) => token.length >= 2)) return null;

  return resolveBlueOriginTravelerCanonicalName(normalized, flightCode) || normalized;
}

function normalizePassengerRole(value: string | null | undefined) {
  return normalizeBlueOriginTravelerRole(value);
}

function normalizePassengerNationality(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  return normalized.length > 96 ? normalized.slice(0, 96) : normalized;
}

function normalizePassengerBio(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  return normalized.length > 1200 ? `${normalized.slice(0, 1197)}...` : normalized;
}

function normalizePassengerFlightCode(
  flightCode: string | null | undefined,
  launchName: string | null | undefined
) {
  const direct = (flightCode || '').trim().toLowerCase();
  if (/^(ns|ng)-\d{1,3}$/.test(direct)) return direct;

  const launchMatch = (launchName || '').match(/\b(ns|ng)[-_ ]?(\d{1,3})\b/i);
  if (!launchMatch?.[1] || !launchMatch?.[2]) return null;
  return `${launchMatch[1].toLowerCase()}-${Number(launchMatch[2])}`;
}

async function enrichPassengersWithWikipediaProfiles(items: BlueOriginPassenger[]) {
  const namesNeedingEnrichment = [...new Set(items
    .filter((row) => !isPublicReportingPassengerSource(row.source))
    .filter((row) => !isWikipediaEnrichmentBlocked(row))
    .filter((row) => !row.profileUrl || !row.imageUrl || !row.bio)
    .map((row) => row.name)
    .filter(Boolean))];

  if (!namesNeedingEnrichment.length) return items;
  const lookups = await fetchBlueOriginWikipediaProfilesByNames(namesNeedingEnrichment);
  if (!lookups.size) return items;

  return items.map((row) => {
    const key = normalizePassengerName(row.name);
    if (!key) return row;
    const lookup = lookups.get(key);
    if (!lookup) return row;
    const fallbackProfileUrl = normalizeProfileUrl(lookup.profileUrl || null, 'wikipedia');
    return {
      ...row,
      profileUrl: row.profileUrl || fallbackProfileUrl || null,
      imageUrl: row.imageUrl || lookup.imageUrl || null,
      bio: row.bio || lookup.bio || null
    };
  });
}

function applyFlightLevelMediaFallback(items: BlueOriginPassenger[]) {
  const flightPassengerCounts = new Map<string, number>();
  for (const row of items) {
    const flightKey = normalizeDedupeKey(row.flightCode) || normalizeDedupeKey(row.launchId);
    if (!flightKey) continue;
    flightPassengerCounts.set(flightKey, (flightPassengerCounts.get(flightKey) || 0) + 1);
  }

  const flightMedia = new Map<
    string,
    {
      imageUrl: string | null;
      profileUrl: string | null;
    }
  >();

  for (const row of items) {
    const flightKey = normalizeDedupeKey(row.flightCode) || normalizeDedupeKey(row.launchId);
    if (!flightKey) continue;

    const existing = flightMedia.get(flightKey) || { imageUrl: null, profileUrl: null };
    const source = (row.source || '').toLowerCase();
    const profileFlightCode = extractFlightCodeFromMissionProfileUrl(row.profileUrl);
    const rowFlightCode = normalizeDedupeKey(row.flightCode);
    const isCanonicalMissionProfile =
      Boolean(profileFlightCode && rowFlightCode && profileFlightCode === rowFlightCode) &&
      (source.startsWith('blue-origin-wayback:new-shepard-mission-page') ||
        source.startsWith('curated-fallback:official-page'));

    if (!existing.imageUrl && row.imageUrl && isCanonicalMissionProfile) existing.imageUrl = row.imageUrl;
    if (!existing.profileUrl && row.profileUrl && isCanonicalMissionProfile) {
      existing.profileUrl = row.profileUrl;
    }
    if (!existing.profileUrl && row.profileUrl) existing.profileUrl = row.profileUrl;
    if (!existing.imageUrl && row.imageUrl) existing.imageUrl = row.imageUrl;
    flightMedia.set(flightKey, existing);
  }

  return items.map((row) => {
    const flightKey = normalizeDedupeKey(row.flightCode) || normalizeDedupeKey(row.launchId);
    if (!flightKey) return row;
    const media = flightMedia.get(flightKey);
    if (!media) return row;
    if ((flightPassengerCounts.get(flightKey) || 0) > 1) return row;

    const source = (row.source || '').toLowerCase();
    const rowFlightCode = normalizeDedupeKey(row.flightCode);
    const rowProfileFlightCode = extractFlightCodeFromMissionProfileUrl(row.profileUrl);
    const hasMismatchedMissionProfile =
      Boolean(rowProfileFlightCode && rowFlightCode) && rowProfileFlightCode !== rowFlightCode;
    const replaceRollupProfile =
      source.startsWith('blue-origin-wayback:new-shepard-mission-rollup') && Boolean(media.profileUrl);
    const replaceRollupImage =
      source.startsWith('blue-origin-wayback:new-shepard-mission-rollup') && Boolean(media.imageUrl);

    const profileUrl =
      (!row.profileUrl || hasMismatchedMissionProfile || replaceRollupProfile) && media.profileUrl
        ? media.profileUrl
        : row.profileUrl;
    const imageUrl = (!row.imageUrl || replaceRollupImage) && media.imageUrl ? media.imageUrl : row.imageUrl;

    if (profileUrl === row.profileUrl && imageUrl === row.imageUrl) return row;

    return {
      ...row,
      imageUrl: imageUrl || null,
      profileUrl: profileUrl || null
    };
  });
}

function extractFlightCodeFromMissionProfileUrl(value: string | null | undefined) {
  const extracted = extractBlueOriginFlightCodeFromUrl(value);
  return normalizeDedupeKey(extracted);
}

function applyPassengerBioFallback(items: BlueOriginPassenger[]) {
  return items.map((row) => {
    if (row.bio) return row;
    const flightCode = (row.flightCode || '').trim().toUpperCase();
    const launchLabel = row.launchName || (flightCode ? `New Shepard | ${flightCode}` : 'a Blue Origin mission');
    return {
      ...row,
      bio: `${row.name} is listed on the official crew manifest for ${launchLabel}.`
    };
  });
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = (value || '').trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function isCanonicalPassengerRole(value: string | null | undefined) {
  const normalized = (value || '').trim().toLowerCase();
  return normalized === 'crew' || normalized === 'passenger' || normalized === 'anthropomorphic test device';
}

function shouldSuppressWikipediaPassengerRow(name: string, flightCode: string | null, source: string) {
  if (!isWikipediaPassengerSource(source) || !flightCode) return false;
  const suppressedNames = PASSENGER_WIKIPEDIA_SUPPRESSION_BY_FLIGHT.get(flightCode);
  if (!suppressedNames?.size) return false;
  const normalizedName = normalizePassengerName(name);
  if (!normalizedName) return false;
  return suppressedNames.has(normalizedName);
}

function isWikipediaEnrichmentBlocked(row: BlueOriginPassenger) {
  const normalizedName = normalizePassengerName(row.name);
  if (!normalizedName) return false;
  return PASSENGER_WIKIPEDIA_ENRICHMENT_BLOCKLIST.has(normalizedName);
}

function isWikipediaPassengerSource(value: string | null | undefined) {
  return (value || '').toLowerCase().startsWith('wikipedia:');
}

function isPublicReportingPassengerSource(value: string | null | undefined) {
  return (value || '').toLowerCase().startsWith('curated-fallback:public-reporting');
}

function normalizeUrl(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  try {
    return new URL(normalized).toString();
  } catch {
    return null;
  }
}

function normalizeProfileUrl(value: string | null | undefined, source?: string | null | undefined) {
  if (isOpenSourcePassengerSource(source)) return null;
  const normalized = normalizeBlueOriginTravelerProfileUrl(value);
  if (!normalized) return null;
  if (isBlueOriginOpenSourceProfileUrl(normalized)) return null;
  return normalized;
}

function isOpenSourcePassengerSource(value: string | null | undefined) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.startsWith('ll2') ||
    normalized.startsWith('wikipedia') ||
    normalized.includes('open-source') ||
    normalized.includes('opensource')
  );
}

const PASSENGER_PROFILE_URL_KEYS = [
  'sourceUrl',
  'source_url',
  'missionUrl',
  'mission_url',
  'profileUrl',
  'profile_url',
  'wikiUrl',
  'wiki_url',
  'll2AstronautUrl',
  'll2_astronaut_url',
  'astronautUrl',
  'astronaut_url',
  'url'
];

function resolvePreferredPassengerProfileUrl(metadata: Record<string, unknown> | null | undefined) {
  const candidates = collectPassengerMetadataUrls(metadata, PASSENGER_PROFILE_URL_KEYS);
  if (!candidates.length) return null;

  const ranked = candidates
    .map((value) => {
      const normalized = normalizeProfileUrl(value);
      if (!normalized) return null;
      return {
        url: normalized,
        score: rankPassengerProfileUrl(normalized)
      };
    })
    .filter((value): value is { url: string; score: number } => Boolean(value))
    .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));

  return ranked[0]?.url || null;
}

function collectPassengerMetadataUrls(
  metadata: Record<string, unknown> | null | undefined,
  keys: string[]
) {
  if (!metadata || typeof metadata !== 'object') return [] as string[];
  const values = [] as string[];
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      values.push(value.trim());
    }
  }
  return [...new Set(values)];
}

function rankPassengerProfileUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 0;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.toLowerCase();

  if (host === 'blueorigin.com' && /^\/news\/(?:ns|ng)-\d{1,3}-mission-updates$/.test(path)) return 125;
  if (host === 'blueorigin.com' && /^\/news\/(?:new-shepard|new-glenn)-(?:ns|ng)-\d{1,3}-mission$/.test(path)) return 120;
  if (host === 'blueorigin.com' && path.startsWith('/missions/')) return 110;
  if (host === 'blueorigin.com') return 100;
  if (host === 'web.archive.org') return 90;
  if (host === 'nasa.gov') return 70;
  return 30;
}

function readPassengerMetadataUrl(
  metadata: Record<string, unknown> | null | undefined,
  keys: string[]
) {
  if (!metadata || typeof metadata !== 'object') return null;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readPassengerMetadataText(
  metadata: Record<string, unknown> | null | undefined,
  keys: string[]
) {
  if (!metadata || typeof metadata !== 'object') return null;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readPassengerSeatIndex(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata || typeof metadata !== 'object') return null;

  const seatKeys = ['seatIndex', 'seat_index', 'seatNumber', 'seat_number', 'seat', 'positionIndex', 'position_index', 'position'];
  for (const key of seatKeys) {
    const normalized = normalizeSeatIndex(metadata[key]);
    if (normalized != null) return normalized;
  }
  return null;
}

function normalizeSeatIndex(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return value;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10);
    return parsed >= 1 ? parsed : null;
  }

  const match = trimmed.match(/\b(?:seat|position|slot)\s*#?\s*(\d+)\b/i) || trimmed.match(/\b(\d+)\b/);
  if (!match) return null;

  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function buildFallbackPassengerRows(mission: BlueOriginMissionKey | 'all') {
  return FALLBACK_PASSENGER_MANIFEST
    .filter((entry) => (mission === 'all' ? true : entry.missionKey === mission))
    .map<BlueOriginPassenger>((entry) => ({
      id: `fallback:${entry.flightCode}:${entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      missionKey: entry.missionKey,
      flightCode: entry.flightCode,
      flightSlug: buildBlueOriginFlightSlug(entry.flightCode),
      travelerSlug: buildBlueOriginTravelerSlug(entry.name),
      name: entry.name,
      role: entry.role,
      nationality: null,
      launchId: null,
      launchName: `New Shepard | ${entry.flightCode.toUpperCase()}`,
      launchDate: entry.launchDate,
      profileUrl: entry.profileUrl || null,
      imageUrl: entry.imageUrl || null,
      bio: entry.bio || null,
      source: entry.source,
      confidence: entry.confidence
    }));
}
