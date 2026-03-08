import { cache } from 'react';
import { isSupabaseConfigured } from '@/lib/server/env';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import type {
  SpaceXDroneShip,
  SpaceXDroneShipAssignmentRecord,
  SpaceXDroneShipBoosterStat,
  SpaceXDroneShipCoverage,
  SpaceXDroneShipDetail,
  SpaceXDroneShipLandingResult,
  SpaceXDroneShipListResponse,
  SpaceXDroneShipSlug,
  SpaceXDroneShipStatus
} from '@/lib/types/spacexProgram';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { buildSpaceXFlightSlug, getSpaceXMissionKeyFromText, getSpaceXMissionLabel } from '@/lib/utils/spacexProgram';

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

const QUERY_CHUNK_SIZE = 250;

const DRONE_SHIP_FALLBACK: Array<{
  slug: SpaceXDroneShipSlug;
  name: string;
  abbrev: string;
  status: SpaceXDroneShipStatus;
  description: string;
  wikidataId: string;
  wikiSourceUrl: string;
}> = [
  {
    slug: 'ocisly',
    name: 'Of Course I Still Love You',
    abbrev: 'OCISLY',
    status: 'active',
    description: 'Autonomous Spaceport Drone Ship supporting Falcon first-stage recovery operations.',
    wikidataId: 'Q23891316',
    wikiSourceUrl: 'https://www.wikidata.org/wiki/Q23891316'
  },
  {
    slug: 'asog',
    name: 'A Shortfall of Gravitas',
    abbrev: 'ASOG',
    status: 'active',
    description: 'Autonomous Spaceport Drone Ship assigned to Atlantic recovery campaigns.',
    wikidataId: 'Q107172359',
    wikiSourceUrl: 'https://www.wikidata.org/wiki/Q107172359'
  },
  {
    slug: 'jrti',
    name: 'Just Read the Instructions',
    abbrev: 'JRTI',
    status: 'active',
    description: 'Autonomous Spaceport Drone Ship used for Pacific recovery campaigns.',
    wikidataId: 'Q96157645',
    wikiSourceUrl: 'https://www.wikidata.org/wiki/Q96157645'
  }
];

type DroneShipRow = {
  slug: string | null;
  name: string | null;
  abbrev: string | null;
  status: string | null;
  description: string | null;
  wikidata_id: string | null;
  wiki_source_url: string | null;
  wikipedia_url: string | null;
  wikimedia_commons_category: string | null;
  wiki_last_synced_at: string | null;
  image_url: string | null;
  image_source_url: string | null;
  image_license: string | null;
  image_license_url: string | null;
  image_credit: string | null;
  image_alt: string | null;
  length_m: number | string | null;
  year_built: number | null;
  home_port: string | null;
  owner_name: string | null;
  operator_name: string | null;
  country_name: string | null;
};

type AssignmentRow = {
  launch_id: string | null;
  launch_library_id: string | null;
  ship_slug: string | null;
  ship_name_raw: string | null;
  ship_abbrev_raw: string | null;
  landing_attempt: boolean | null;
  landing_success: boolean | null;
  landing_result: string | null;
  landing_time: string | null;
  source: string | null;
  source_landing_id: string | null;
  last_verified_at: string | null;
};

type LaunchCacheRow = {
  launch_id: string | null;
  ll2_launch_uuid: string | null;
  name: string | null;
  slug: string | null;
  net: string | null;
  provider: string | null;
  vehicle: string | null;
  pad_name: string | null;
  pad_short_code: string | null;
  pad_location_name: string | null;
};

type LauncherJoinRow = {
  launch_id: string | null;
  ll2_launcher_id: number | null;
};

type LauncherRow = {
  ll2_launcher_id: number | null;
  serial_number: string | null;
};

type DroneShipDataset = {
  generatedAt: string;
  ships: SpaceXDroneShip[];
  assignments: SpaceXDroneShipAssignmentRecord[];
  assignmentsByShip: Map<SpaceXDroneShipSlug, SpaceXDroneShipAssignmentRecord[]>;
  boostersByShip: Map<SpaceXDroneShipSlug, SpaceXDroneShipBoosterStat[]>;
  coverage: SpaceXDroneShipCoverage;
};

type CanonicalShipRecord = Omit<SpaceXDroneShip, 'kpis'>;

export type SpaceXLaunchDroneShipAssignment = {
  shipSlug: SpaceXDroneShipSlug;
  shipName: string;
  shipAbbrev: string | null;
  landingResult: SpaceXDroneShipLandingResult;
};

export function parseSpaceXDroneShipSlug(value: string | null | undefined): SpaceXDroneShipSlug | null {
  const normalized = normalizeShipToken(value);
  if (!normalized) return null;
  if (normalized === 'ocisly' || normalized === 'ofcourseistillloveyou') return 'ocisly';
  if (normalized === 'asog' || normalized === 'ashortfallofgravitas') return 'asog';
  if (normalized === 'jrti' || normalized === 'justreadtheinstructions') return 'jrti';
  return null;
}

export const fetchSpaceXDroneShipsIndex = cache(async (): Promise<SpaceXDroneShipListResponse> => {
  const data = await fetchDroneShipDataset();
  const nowMs = Date.now();
  const upcomingAssignments = data.assignments
    .filter((entry) => {
      const netMs = Date.parse(entry.launchNet || '');
      return Number.isFinite(netMs) && netMs >= nowMs;
    })
    .sort((left, right) => Date.parse(left.launchNet || '') - Date.parse(right.launchNet || ''))
    .slice(0, 40);

  return {
    generatedAt: data.generatedAt,
    items: data.ships,
    coverage: data.coverage,
    upcomingAssignments
  };
});

export const fetchSpaceXDroneShipCoverageSummary = cache(async (): Promise<SpaceXDroneShipCoverage> => {
  const data = await fetchDroneShipDataset();
  return data.coverage;
});

export const fetchSpaceXDroneShipDetail = cache(async (slug: SpaceXDroneShipSlug): Promise<SpaceXDroneShipDetail | null> => {
  const data = await fetchDroneShipDataset();
  const ship = data.ships.find((entry) => entry.slug === slug);
  if (!ship) return null;

  const shipAssignments = data.assignmentsByShip.get(slug) || [];
  const nowMs = Date.now();
  const upcomingAssignments = shipAssignments
    .filter((entry) => {
      const netMs = Date.parse(entry.launchNet || '');
      return Number.isFinite(netMs) && netMs >= nowMs;
    })
    .sort((left, right) => Date.parse(left.launchNet || '') - Date.parse(right.launchNet || ''))
    .slice(0, 60);

  const recentAssignments = shipAssignments
    .filter((entry) => {
      const netMs = Date.parse(entry.launchNet || '');
      return !Number.isFinite(netMs) || netMs < nowMs;
    })
    .slice(0, 120);

  const launchSites = summarizeCounts(
    shipAssignments.map((entry) => entry.padLocationName || entry.padName || entry.padShortCode || '').filter(Boolean),
    12
  );
  const missionMix = summarizeCounts(
    shipAssignments.map((entry) => entry.missionKey),
    8
  ).map((entry) => ({
    missionKey: entry.name as SpaceXDroneShipAssignmentRecord['missionKey'],
    missionLabel: getSpaceXMissionLabel(entry.name as SpaceXDroneShipAssignmentRecord['missionKey']),
    count: entry.count
  }));

  return {
    generatedAt: data.generatedAt,
    ship,
    coverage: data.coverage,
    upcomingAssignments,
    recentAssignments,
    launchSites,
    missionMix,
    boosters: data.boostersByShip.get(slug) || []
  };
});

export async function fetchSpaceXDroneShipAssignmentsByLaunchIds(launchIds: string[]) {
  const assignmentMap = new Map<string, SpaceXLaunchDroneShipAssignment>();
  const uniqueLaunchIds = uniqueStrings(launchIds.map((value) => normalizeText(value)).filter(Boolean));
  if (!uniqueLaunchIds.length || !isSupabaseConfigured()) return assignmentMap;

  const supabase = createSupabasePublicClient();
  const canonicalBySlug = new Map(DRONE_SHIP_FALLBACK.map((entry) => [entry.slug, entry]));

  for (const chunk of chunkArray(uniqueLaunchIds, QUERY_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('spacex_drone_ship_assignments')
      .select('launch_id, ship_slug, ship_name_raw, ship_abbrev_raw, landing_attempt, landing_success, landing_result')
      .in('launch_id', chunk)
      .not('ship_slug', 'is', null);
    if (error || !Array.isArray(data)) continue;

    for (const row of data as Array<{
      launch_id?: string | null;
      ship_slug?: string | null;
      ship_name_raw?: string | null;
      ship_abbrev_raw?: string | null;
      landing_attempt?: boolean | null;
      landing_success?: boolean | null;
      landing_result?: string | null;
    }>) {
      const launchId = normalizeText(row.launch_id);
      const shipSlug = parseSpaceXDroneShipSlug(row.ship_slug);
      if (!launchId || !shipSlug) continue;
      const canonical = canonicalBySlug.get(shipSlug);
      assignmentMap.set(launchId, {
        shipSlug,
        shipName: normalizeText(canonical?.name) || normalizeText(row.ship_name_raw) || shipSlug.toUpperCase(),
        shipAbbrev: normalizeText(canonical?.abbrev) || normalizeText(row.ship_abbrev_raw) || null,
        landingResult: parseLandingResult(row.landing_result, row.landing_attempt, row.landing_success)
      });
    }
  }

  return assignmentMap;
}

const fetchDroneShipDataset = cache(async (): Promise<DroneShipDataset> => {
  const generatedAt = new Date().toISOString();
  const fallbackShips = DRONE_SHIP_FALLBACK.map((entry) => ({
    slug: entry.slug,
    name: entry.name,
    abbrev: entry.abbrev,
    status: entry.status,
    description: entry.description,
    wikidataId: entry.wikidataId,
    wikiSourceUrl: entry.wikiSourceUrl,
    wikipediaUrl: null,
    wikimediaCommonsCategory: null,
    wikiLastSyncedAt: null,
    imageUrl: null,
    imageSourceUrl: null,
    imageLicense: null,
    imageLicenseUrl: null,
    imageCredit: null,
    imageAlt: `${entry.name} autonomous drone ship`,
    lengthM: null,
    yearBuilt: null,
    homePort: null,
    ownerName: null,
    operatorName: null,
    countryName: null,
    kpis: {
      assignmentsKnown: 0,
      upcomingAssignments: 0,
      assignmentsPastYear: 0,
      distinctBoostersRecovered: 0,
      distinctLaunchSitesServed: 0,
      coveragePercent: 0,
      firstAssignmentDate: null,
      lastAssignmentDate: null
    }
  })) satisfies SpaceXDroneShip[];

  if (!isSupabaseConfigured()) {
    return {
      generatedAt,
      ships: fallbackShips,
      assignments: [],
      assignmentsByShip: new Map(),
      boostersByShip: new Map(),
      coverage: {
        generatedAt,
        totalSpaceXLaunches: 0,
        knownLandingAssignments: 0,
        coveragePercent: 0,
        upcomingKnownAssignments: 0,
        lastVerifiedAt: null
      }
    };
  }

  const supabase = createSupabasePublicClient();
  const [shipRes, assignmentRes, totalCountRes] = await Promise.all([
    supabase
      .from('spacex_drone_ships')
      .select(
        'slug,name,abbrev,status,description,wikidata_id,wiki_source_url,wikipedia_url,wikimedia_commons_category,wiki_last_synced_at,image_url,image_source_url,image_license,image_license_url,image_credit,image_alt,length_m,year_built,home_port,owner_name,operator_name,country_name'
      ),
    supabase
      .from('spacex_drone_ship_assignments')
      .select(
        'launch_id,launch_library_id,ship_slug,ship_name_raw,ship_abbrev_raw,landing_attempt,landing_success,landing_result,landing_time,source,source_landing_id,last_verified_at'
      )
      .not('ship_slug', 'is', null),
    supabase.from('launches_public_cache').select('launch_id', { count: 'exact', head: true }).or(SPACEX_OR_FILTER)
  ]);

  if (assignmentRes.error && isMissingDroneShipRelationError(assignmentRes.error.message || '')) {
    return {
      generatedAt,
      ships: fallbackShips,
      assignments: [],
      assignmentsByShip: new Map(),
      boostersByShip: new Map(),
      coverage: {
        generatedAt,
        totalSpaceXLaunches: 0,
        knownLandingAssignments: 0,
        coveragePercent: 0,
        upcomingKnownAssignments: 0,
        lastVerifiedAt: null
      }
    };
  }

  const shipRows = Array.isArray(shipRes.data) ? (shipRes.data as DroneShipRow[]) : [];
  const canonicalShips = mergeCanonicalShips(shipRows);
  const canonicalShipBySlug = new Map(canonicalShips.map((entry) => [entry.slug, entry]));

  const assignmentRows = Array.isArray(assignmentRes.data) ? (assignmentRes.data as AssignmentRow[]) : [];
  const launchIds = uniqueStrings(assignmentRows.map((row) => normalizeText(row.launch_id)).filter(Boolean));
  const launchById = await fetchLaunchRowsById(supabase, launchIds);

  const assignments: SpaceXDroneShipAssignmentRecord[] = assignmentRows
    .map((row) => mapAssignmentRowToRecord(row, launchById, canonicalShipBySlug))
    .filter((entry): entry is SpaceXDroneShipAssignmentRecord => entry !== null)
    .sort(compareAssignmentDescending);

  const assignmentsByShip = new Map<SpaceXDroneShipSlug, SpaceXDroneShipAssignmentRecord[]>();
  for (const ship of canonicalShips) {
    assignmentsByShip.set(ship.slug, []);
  }
  for (const assignment of assignments) {
    const bucket = assignmentsByShip.get(assignment.shipSlug) || [];
    bucket.push(assignment);
    assignmentsByShip.set(assignment.shipSlug, bucket);
  }

  const boostersByShip = await fetchBoosterStatsByShip(supabase, assignmentsByShip);
  const totalSpaceXLaunches =
    typeof totalCountRes.count === 'number' && Number.isFinite(totalCountRes.count) ? totalCountRes.count : 0;

  const nowMs = Date.now();
  const trailingYearMs = nowMs - 365 * 24 * 60 * 60 * 1000;
  const ships: SpaceXDroneShip[] = canonicalShips.map((ship) => {
    const shipAssignments = assignmentsByShip.get(ship.slug) || [];
    const upcomingAssignments = shipAssignments.filter((entry) => {
      const netMs = Date.parse(entry.launchNet || '');
      return Number.isFinite(netMs) && netMs >= nowMs;
    }).length;
    const assignmentsPastYear = shipAssignments.filter((entry) => {
      const netMs = Date.parse(entry.launchNet || '');
      return Number.isFinite(netMs) && netMs >= trailingYearMs;
    }).length;
    const launchSiteCount = new Set(
      shipAssignments.map((entry) => entry.padLocationName || entry.padName || entry.padShortCode || '').filter(Boolean)
    ).size;
    const boostersCount = (boostersByShip.get(ship.slug) || []).length;
    const firstAssignmentDate = shipAssignments.length
      ? [...shipAssignments]
          .sort((left, right) => compareAssignmentAscending(left, right))[0]
          ?.launchNet?.slice(0, 10) || null
      : null;
    const lastAssignmentDate = shipAssignments.length
      ? shipAssignments[0]?.launchNet?.slice(0, 10) || null
      : null;

    return {
      slug: ship.slug,
      name: ship.name,
      abbrev: ship.abbrev || null,
      status: ship.status,
      description: ship.description || null,
      wikidataId: ship.wikidataId || null,
      wikiSourceUrl: ship.wikiSourceUrl || null,
      wikipediaUrl: ship.wikipediaUrl || null,
      wikimediaCommonsCategory: ship.wikimediaCommonsCategory || null,
      wikiLastSyncedAt: ship.wikiLastSyncedAt || null,
      imageUrl: ship.imageUrl || null,
      imageSourceUrl: ship.imageSourceUrl || null,
      imageLicense: ship.imageLicense || null,
      imageLicenseUrl: ship.imageLicenseUrl || null,
      imageCredit: ship.imageCredit || null,
      imageAlt: ship.imageAlt || `${ship.name} autonomous drone ship`,
      lengthM: ship.lengthM ?? null,
      yearBuilt: ship.yearBuilt ?? null,
      homePort: ship.homePort || null,
      ownerName: ship.ownerName || null,
      operatorName: ship.operatorName || null,
      countryName: ship.countryName || null,
      kpis: {
        assignmentsKnown: shipAssignments.length,
        upcomingAssignments,
        assignmentsPastYear,
        distinctBoostersRecovered: boostersCount,
        distinctLaunchSitesServed: launchSiteCount,
        coveragePercent: toPercent(shipAssignments.length, totalSpaceXLaunches),
        firstAssignmentDate,
        lastAssignmentDate
      }
    };
  });

  const coverage: SpaceXDroneShipCoverage = {
    generatedAt,
    totalSpaceXLaunches,
    knownLandingAssignments: assignments.length,
    coveragePercent: toPercent(assignments.length, totalSpaceXLaunches),
    upcomingKnownAssignments: assignments.filter((entry) => {
      const netMs = Date.parse(entry.launchNet || '');
      return Number.isFinite(netMs) && netMs >= nowMs;
    }).length,
    lastVerifiedAt: assignmentRows
      .map((row) => normalizeIso(row.last_verified_at))
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null
  };

  return {
    generatedAt,
    ships,
    assignments,
    assignmentsByShip,
    boostersByShip,
    coverage
  };
});

function mergeCanonicalShips(rows: DroneShipRow[]) {
  const bySlug = new Map<SpaceXDroneShipSlug, CanonicalShipRecord>(
    DRONE_SHIP_FALLBACK.map((entry) => [
      entry.slug,
      {
        slug: entry.slug,
        name: entry.name,
        abbrev: entry.abbrev,
        status: entry.status,
        description: entry.description,
        wikidataId: entry.wikidataId,
        wikiSourceUrl: entry.wikiSourceUrl,
        wikipediaUrl: null,
        wikimediaCommonsCategory: null,
        wikiLastSyncedAt: null,
        imageUrl: null,
        imageSourceUrl: null,
        imageLicense: null,
        imageLicenseUrl: null,
        imageCredit: null,
        imageAlt: `${entry.name} autonomous drone ship`,
        lengthM: null,
        yearBuilt: null,
        homePort: null,
        ownerName: null,
        operatorName: null,
        countryName: null
      }
    ])
  );

  for (const row of rows) {
    const slug = parseSpaceXDroneShipSlug(row.slug);
    if (!slug) continue;
    const fallback = bySlug.get(slug);
    bySlug.set(slug, {
      slug,
      name: normalizeText(row.name) || fallback?.name || slug.toUpperCase(),
      abbrev: normalizeText(row.abbrev) || fallback?.abbrev || slug.toUpperCase(),
      status: normalizeText(row.status) ? parseShipStatus(row.status) : fallback?.status || 'unknown',
      description: normalizeText(row.description) || fallback?.description || '',
      wikidataId: normalizeText(row.wikidata_id) || fallback?.wikidataId || null,
      wikiSourceUrl: normalizeText(row.wiki_source_url) || fallback?.wikiSourceUrl || null,
      wikipediaUrl: normalizeText(row.wikipedia_url) || fallback?.wikipediaUrl || null,
      wikimediaCommonsCategory: normalizeText(row.wikimedia_commons_category) || fallback?.wikimediaCommonsCategory || null,
      wikiLastSyncedAt: normalizeIso(row.wiki_last_synced_at) || fallback?.wikiLastSyncedAt || null,
      imageUrl: normalizeText(row.image_url) || fallback?.imageUrl || null,
      imageSourceUrl: normalizeText(row.image_source_url) || fallback?.imageSourceUrl || null,
      imageLicense: normalizeText(row.image_license) || fallback?.imageLicense || null,
      imageLicenseUrl: normalizeText(row.image_license_url) || fallback?.imageLicenseUrl || null,
      imageCredit: normalizeText(row.image_credit) || fallback?.imageCredit || null,
      imageAlt: normalizeText(row.image_alt) || fallback?.imageAlt || `${normalizeText(row.name) || fallback?.name || slug.toUpperCase()} autonomous drone ship`,
      lengthM: parseNumberValue(row.length_m) ?? fallback?.lengthM ?? null,
      yearBuilt: parseYearValue(row.year_built) ?? fallback?.yearBuilt ?? null,
      homePort: normalizeText(row.home_port) || fallback?.homePort || null,
      ownerName: normalizeText(row.owner_name) || fallback?.ownerName || null,
      operatorName: normalizeText(row.operator_name) || fallback?.operatorName || null,
      countryName: normalizeText(row.country_name) || fallback?.countryName || null
    });
  }

  return DRONE_SHIP_FALLBACK.map((entry) => bySlug.get(entry.slug)!).filter(Boolean);
}

function parseShipStatus(value: string | null | undefined): SpaceXDroneShipStatus {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'active') return 'active';
  if (normalized === 'retired') return 'retired';
  return 'unknown';
}

function mapAssignmentRowToRecord(
  row: AssignmentRow,
  launchById: Map<string, LaunchCacheRow>,
  canonicalShipBySlug: Map<SpaceXDroneShipSlug, ReturnType<typeof mergeCanonicalShips>[number]>
) {
  const launchId = normalizeText(row.launch_id);
  const shipSlug = parseSpaceXDroneShipSlug(row.ship_slug);
  if (!launchId || !shipSlug) return null;

  const launch = launchById.get(launchId);
  const canonicalShip = canonicalShipBySlug.get(shipSlug);
  const launchName = normalizeText(launch?.name) || `Launch ${launchId.slice(0, 8)}`;
  const launchSlug = normalizeText(launch?.slug) || null;
  const launchNet = normalizeIso(launch?.net) || normalizeIso(row.landing_time) || null;
  const missionKey =
    getSpaceXMissionKeyFromText(`${launchName} ${normalizeText(launch?.vehicle)} ${normalizeText(launch?.provider)}`) ||
    'spacex-program';

  return {
    launchId,
    ll2LaunchUuid: normalizeText(row.launch_library_id || launch?.ll2_launch_uuid) || null,
    launchName,
    launchSlug,
    launchNet,
    launchHref: buildLaunchHref({
      id: launchId,
      name: launchName,
      slug: launchSlug || undefined
    }),
    flightSlug: buildSpaceXFlightSlug({ id: launchId, name: launchName }),
    missionKey,
    missionLabel: getSpaceXMissionLabel(missionKey),
    provider: normalizeText(launch?.provider) || null,
    vehicle: normalizeText(launch?.vehicle) || null,
    padName: normalizeText(launch?.pad_name) || null,
    padShortCode: normalizeText(launch?.pad_short_code) || null,
    padLocationName: normalizeText(launch?.pad_location_name) || null,
    shipSlug,
    shipName: normalizeText(canonicalShip?.name) || normalizeText(row.ship_name_raw) || shipSlug.toUpperCase(),
    shipAbbrev: normalizeText(canonicalShip?.abbrev) || normalizeText(row.ship_abbrev_raw) || null,
    landingResult: parseLandingResult(row.landing_result, row.landing_attempt, row.landing_success),
    landingAttempt: typeof row.landing_attempt === 'boolean' ? row.landing_attempt : null,
    landingSuccess: typeof row.landing_success === 'boolean' ? row.landing_success : null,
    landingTime: normalizeIso(row.landing_time),
    source: normalizeText(row.source) || 'll2',
    sourceLandingId: normalizeText(row.source_landing_id) || null,
    lastVerifiedAt: normalizeIso(row.last_verified_at)
  } satisfies SpaceXDroneShipAssignmentRecord;
}

async function fetchBoosterStatsByShip(
  supabase: ReturnType<typeof createSupabasePublicClient>,
  assignmentsByShip: Map<SpaceXDroneShipSlug, SpaceXDroneShipAssignmentRecord[]>
) {
  const allAssignments = [...assignmentsByShip.values()].flat();
  const launchIds = uniqueStrings(allAssignments.map((entry) => entry.launchId).filter(Boolean));
  const boostersByShip = new Map<SpaceXDroneShipSlug, SpaceXDroneShipBoosterStat[]>();
  for (const key of ['ocisly', 'asog', 'jrti'] as SpaceXDroneShipSlug[]) boostersByShip.set(key, []);
  if (!launchIds.length) return boostersByShip;

  const launchToShip = new Map(allAssignments.map((entry) => [entry.launchId, entry.shipSlug]));
  const launcherJoins: LauncherJoinRow[] = [];

  for (const chunk of chunkArray(launchIds, QUERY_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('ll2_launcher_launches')
      .select('launch_id,ll2_launcher_id')
      .in('launch_id', chunk);
    if (error || !Array.isArray(data)) continue;
    launcherJoins.push(...(data as LauncherJoinRow[]));
  }

  const seenLaunchLauncher = new Set<string>();
  const countsByShip = new Map<SpaceXDroneShipSlug, Map<number, number>>();
  for (const shipSlug of ['ocisly', 'asog', 'jrti'] as SpaceXDroneShipSlug[]) {
    countsByShip.set(shipSlug, new Map());
  }

  for (const row of launcherJoins) {
    const launchId = normalizeText(row.launch_id);
    const launcherId = typeof row.ll2_launcher_id === 'number' ? row.ll2_launcher_id : null;
    if (!launchId || !launcherId) continue;
    const shipSlug = launchToShip.get(launchId);
    if (!shipSlug) continue;
    const dedupeKey = `${launchId}:${launcherId}`;
    if (seenLaunchLauncher.has(dedupeKey)) continue;
    seenLaunchLauncher.add(dedupeKey);

    const bucket = countsByShip.get(shipSlug) || new Map<number, number>();
    bucket.set(launcherId, (bucket.get(launcherId) || 0) + 1);
    countsByShip.set(shipSlug, bucket);
  }

  const allLauncherIds = uniqueNumbers(
    [...countsByShip.values()].flatMap((map) => [...map.keys()])
  );
  const launcherById = await fetchLauncherRowsById(supabase, allLauncherIds);

  for (const [shipSlug, counts] of countsByShip.entries()) {
    const boosters = [...counts.entries()]
      .map(([launcherId, missions]) => ({
        ll2LauncherId: launcherId,
        serialNumber: normalizeText(launcherById.get(launcherId)?.serial_number) || null,
        missions
      }))
      .sort((left, right) => {
        if (right.missions !== left.missions) return right.missions - left.missions;
        const leftSerial = left.serialNumber || '';
        const rightSerial = right.serialNumber || '';
        return leftSerial.localeCompare(rightSerial);
      });
    boostersByShip.set(shipSlug, boosters);
  }

  return boostersByShip;
}

async function fetchLaunchRowsById(
  supabase: ReturnType<typeof createSupabasePublicClient>,
  launchIds: string[]
) {
  const byId = new Map<string, LaunchCacheRow>();
  if (!launchIds.length) return byId;

  for (const chunk of chunkArray(launchIds, QUERY_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('launches_public_cache')
      .select('launch_id,ll2_launch_uuid,name,slug,net,provider,vehicle,pad_name,pad_short_code,pad_location_name')
      .in('launch_id', chunk);
    if (error || !Array.isArray(data)) continue;
    for (const row of data as LaunchCacheRow[]) {
      const launchId = normalizeText(row.launch_id);
      if (!launchId) continue;
      byId.set(launchId, row);
    }
  }

  return byId;
}

async function fetchLauncherRowsById(
  supabase: ReturnType<typeof createSupabasePublicClient>,
  launcherIds: number[]
) {
  const byId = new Map<number, LauncherRow>();
  if (!launcherIds.length) return byId;

  for (const chunk of chunkArray(launcherIds, QUERY_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('ll2_launchers')
      .select('ll2_launcher_id,serial_number')
      .in('ll2_launcher_id', chunk);
    if (error || !Array.isArray(data)) continue;
    for (const row of data as LauncherRow[]) {
      const launcherId = typeof row.ll2_launcher_id === 'number' ? row.ll2_launcher_id : null;
      if (!launcherId) continue;
      byId.set(launcherId, row);
    }
  }

  return byId;
}

function parseLandingResult(
  landingResult: string | null | undefined,
  landingAttempt: boolean | null | undefined,
  landingSuccess: boolean | null | undefined
): SpaceXDroneShipLandingResult {
  const normalized = normalizeText(landingResult).toLowerCase();
  if (normalized === 'success') return 'success';
  if (normalized === 'failure') return 'failure';
  if (normalized === 'no_attempt') return 'no_attempt';
  if (landingAttempt === false) return 'no_attempt';
  if (landingAttempt === true && landingSuccess === true) return 'success';
  if (landingAttempt === true && landingSuccess === false) return 'failure';
  return 'unknown';
}

function compareAssignmentDescending(left: SpaceXDroneShipAssignmentRecord, right: SpaceXDroneShipAssignmentRecord) {
  const leftMs = Date.parse(left.launchNet || left.landingTime || '');
  const rightMs = Date.parse(right.launchNet || right.landingTime || '');
  const safeLeft = Number.isFinite(leftMs) ? leftMs : 0;
  const safeRight = Number.isFinite(rightMs) ? rightMs : 0;
  return safeRight - safeLeft;
}

function compareAssignmentAscending(left: SpaceXDroneShipAssignmentRecord, right: SpaceXDroneShipAssignmentRecord) {
  const leftMs = Date.parse(left.launchNet || left.landingTime || '');
  const rightMs = Date.parse(right.launchNet || right.landingTime || '');
  const safeLeft = Number.isFinite(leftMs) ? leftMs : Number.MAX_SAFE_INTEGER;
  const safeRight = Number.isFinite(rightMs) ? rightMs : Number.MAX_SAFE_INTEGER;
  return safeLeft - safeRight;
}

function summarizeCounts(values: string[], limit: number) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = normalizeText(value);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.name.localeCompare(right.name);
    })
    .slice(0, limit);
}

function toPercent(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  const ratio = (numerator / denominator) * 100;
  return Math.round(ratio * 10) / 10;
}

function normalizeShipToken(value: string | null | undefined) {
  if (!value) return '';
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeIso(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function parseNumberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseYearValue(value: unknown) {
  const parsed = parseNumberValue(value);
  if (!Number.isFinite(parsed ?? NaN)) return null;
  const year = Math.round(parsed as number);
  if (year < 1800 || year > 2100) return null;
  return year;
}

function chunkArray<T>(values: T[], size: number) {
  if (!values.length) return [] as T[][];
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value > 0))];
}

function isMissingDroneShipRelationError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('spacex_drone_ship_assignments') ||
    normalized.includes('spacex_drone_ships')
  ) && normalized.includes('does not exist');
}
