import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { tryConsumeProvider } from './rateLimit';
import { Launch } from '@/lib/types/launch';
import { APP_USER_AGENT } from '@/lib/brand';
import {
  derivePadShortCode,
  derivePadState,
  normalizeNetPrecision,
  parseNumber,
  selectVideoUrl
} from './ll2Utils';

export const LL2_BASE = 'https://ll.thespacedevs.com/2.3.0';
const LL2_USER_AGENT = process.env.LL2_USER_AGENT || APP_USER_AGENT;
const LL2_API_KEY = process.env.LL2_API_KEY || '';
const US_LOCATIONS_KEY = 'll2_us_location_ids';
const US_LOCATIONS_MAX_AGE_HOURS = 24;

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildLaunchName(row: any, mission: any, rocket: any) {
  const direct = normalizeNonEmptyString(row?.name);
  if (direct) return direct;

  const missionName = normalizeNonEmptyString(mission?.name);
  const rocketName = normalizeNonEmptyString(rocket?.full_name) || normalizeNonEmptyString(rocket?.name);

  if (rocketName && missionName) return `${rocketName} | ${missionName}`;
  if (missionName) return missionName;
  if (rocketName) return rocketName;

  const id = normalizeNonEmptyString(row?.id);
  if (id) return `Launch ${id.slice(0, 8)}`;
  return 'Launch';
}

export type LaunchUpsertRow = {
  ll2_launch_uuid: string;
  launch_designator?: string | null;
  name: string;
  slug?: string | null;
  status_id?: number | null;
  status_name?: string | null;
  status_abbrev?: string | null;
  net?: string | null;
  net_precision?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  provider?: string | null;
  provider_type?: string | null;
  provider_country_code?: string | null;
  provider_description?: string | null;
  vehicle?: string | null;
  rocket_full_name?: string | null;
  rocket_family?: string | null;
  rocket_description?: string | null;
  rocket_manufacturer?: string | null;
  rocket_manufacturer_logo_url?: string | null;
  rocket_manufacturer_image_url?: string | null;
  rocket_image_url?: string | null;
  rocket_variant?: string | null;
  rocket_length_m?: number | null;
  rocket_diameter_m?: number | null;
  rocket_reusable?: boolean | null;
  rocket_maiden_flight?: string | null;
  rocket_leo_capacity?: number | null;
  rocket_gto_capacity?: number | null;
  rocket_launch_mass?: number | null;
  rocket_launch_cost?: string | null;
  rocket_info_url?: string | null;
  rocket_wiki_url?: string | null;
  mission_name?: string | null;
  mission_description?: string | null;
  mission_type?: string | null;
  mission_orbit?: string | null;
  mission_agencies?: unknown | null;
  mission_info_urls?: unknown | null;
  mission_vid_urls?: unknown | null;
  launch_info_urls?: unknown | null;
  launch_vid_urls?: unknown | null;
  flightclub_url?: string | null;
  hashtag?: string | null;
  probability?: number | null;
  hold_reason?: string | null;
  fail_reason?: string | null;
  pad_name?: string | null;
  pad_short_code?: string | null;
  pad_state?: string | null;
  pad_timezone?: string | null;
  pad_location_name?: string | null;
  pad_country_code?: string | null;
  pad_map_url?: string | null;
  pad_latitude?: number | null;
  pad_longitude?: number | null;
  ll2_pad_id?: number | null;
  ll2_agency_id?: number | null;
  ll2_rocket_config_id?: number | null;
  webcast_live?: boolean | null;
  video_url?: string | null;
  image_thumbnail_url?: string | null;
  provider_logo_url?: string | null;
  provider_image_url?: string | null;
  programs?: unknown | null;
  crew?: unknown | null;
  payloads?: unknown | null;
  tier_auto?: string | null;
  tier_override?: string | null;
  featured?: boolean | null;
  hidden?: boolean | null;
  agency_launch_attempt_count?: number | null;
  agency_launch_attempt_count_year?: number | null;
  location_launch_attempt_count?: number | null;
  location_launch_attempt_count_year?: number | null;
  orbital_launch_attempt_count?: number | null;
  orbital_launch_attempt_count_year?: number | null;
  pad_launch_attempt_count?: number | null;
  pad_launch_attempt_count_year?: number | null;
  pad_turnaround?: string | null;
  mission_patches?: unknown | null;
  updates?: unknown | null;
  timeline?: unknown | null;
  image_url?: string | null;
  image_credit?: string | null;
  image_license_name?: string | null;
  image_license_url?: string | null;
  image_single_use?: boolean | null;
  last_updated_source?: string | null;
  updated_at?: string | null;
};

type PageParams = { limit?: number; offset?: number; ordering?: 'last_updated' | '-last_updated'; sinceIso?: string };

export async function fetchLl2LaunchesUpdated(sinceIso?: string) {
  return fetchLl2Page({ sinceIso, ordering: '-last_updated', limit: 20, offset: 0 });
}

export async function fetchLl2Page({ limit = 100, offset = 0, ordering = '-last_updated', sinceIso }: PageParams) {
  const locationIds = await getUsLocationIds();
  const rate = await tryConsumeProvider('ll2');
  if (!rate.allowed) {
    console.warn('LL2 rate limited; skipping call', { limit: rate.limit, windowEndsAt: rate.windowEndsAt.toISOString() });
    return { launches: [], skipped: true, total: 0, skipReason: 'rate_limit' };
  }

  const updatedFilter = sinceIso ? `&last_updated__gte=${encodeURIComponent(sinceIso)}` : '';
  const locationFilter = locationIds?.length ? `&location__ids=${locationIds.join(',')}` : '';
  const url = `${LL2_BASE}/launches/?format=json&limit=${limit}&offset=${offset}&mode=detailed&include_suborbital=true&ordering=${ordering}${locationFilter}${updatedFilter}`;
  const res = await fetch(url, { headers: buildLl2Headers() });
  if (res.status === 429) {
    console.warn('LL2 responded 429; backing off until next run.');
    return { launches: [], skipped: true, total: 0, skipReason: 'remote_rate_limit' };
  }
  if (res.status >= 500) {
    console.warn(`LL2 server error ${res.status}; skipping until next run.`);
    return { launches: [], skipped: true, total: 0, skipReason: `server_${res.status}` };
  }
  if (!res.ok) throw new Error(`LL2 fetch failed ${res.status}`);
  const json = await res.json();
  return { launches: json.results as any[], skipped: false, total: json.count ?? 0, skipReason: null };
}

export function mapLl2ToLaunch(row: any): Launch {
  const pad = row.pad || {};
  const agency = row.launch_service_provider || {};
  const rocket = row.rocket?.configuration || {};
  const manufacturer = rocket.manufacturer || {};
  const mission = row.mission || {};
  const orbit = mission.orbit || {};
  const programs = row.program || [];
  const crew = row.crew || [];
  const missionAgencies = mission.agencies || [];
  const locationName = pad.location?.name || pad.location_name || null;
  const padShortCode = derivePadShortCode(pad.name || '', pad.short_code || pad.abbrev || null);
  const image = row.image || {};
  const imageLicense = image?.license || {};
  const padLatitude = parseNumber(pad.latitude ?? pad.location?.latitude);
  const padLongitude = parseNumber(pad.longitude ?? pad.location?.longitude);

  return {
    id: row.id,
    ll2Id: row.id,
    ll2PadId: pad.id ?? undefined,
    ll2RocketConfigId: rocket.id ?? undefined,
    name: buildLaunchName(row, mission, rocket),
    launchDesignator: row.launch_designator || mission.launch_designator || undefined,
    agencyLaunchAttemptCount: row.agency_launch_attempt_count ?? undefined,
    agencyLaunchAttemptCountYear: row.agency_launch_attempt_count_year ?? undefined,
    locationLaunchAttemptCount: row.location_launch_attempt_count ?? undefined,
    locationLaunchAttemptCountYear: row.location_launch_attempt_count_year ?? undefined,
    orbitalLaunchAttemptCount: row.orbital_launch_attempt_count ?? undefined,
    orbitalLaunchAttemptCountYear: row.orbital_launch_attempt_count_year ?? undefined,
    padLaunchAttemptCount: row.pad_launch_attempt_count ?? undefined,
    padLaunchAttemptCountYear: row.pad_launch_attempt_count_year ?? undefined,
    padTurnaround: row.pad_turnaround || undefined,
    provider: agency.name || 'Unknown',
    providerType: normalizeAgencyType(agency.type) || undefined,
    providerCountryCode: resolveCountryCode(agency.country ?? agency.country_code) || undefined,
    providerDescription: agency.description || undefined,
    providerLogoUrl: extractImageUrl(agency.logo ?? agency.logo_url) || undefined,
    providerImageUrl: extractImageUrl(agency.image ?? agency.image_url) || undefined,
    vehicle: rocket.full_name || rocket.name || 'Unknown',
    rocket: {
      fullName: rocket.full_name || rocket.name || undefined,
      family: rocket.family || undefined,
      description: rocket.description || undefined,
      manufacturer: manufacturer.name || agency.name || undefined,
      manufacturerLogoUrl: extractImageUrl(manufacturer.logo ?? manufacturer.logo_url) || undefined,
      manufacturerImageUrl: extractImageUrl(manufacturer.image ?? manufacturer.image_url) || undefined,
      imageUrl: extractImageUrl(rocket.image ?? rocket.image_url) || undefined,
      variant: rocket.variant || undefined,
      lengthM: parseNumber(rocket.length) ?? undefined,
      diameterM: parseNumber(rocket.diameter) ?? undefined,
      reusable: rocket.reusable ?? undefined,
      maidenFlight: rocket.maiden_flight || undefined,
      leoCapacity: rocket.leo_capacity ?? undefined,
      gtoCapacity: rocket.gto_capacity ?? undefined,
      launchMass: rocket.launch_mass ?? undefined,
      launchCost: rocket.launch_cost || undefined,
      infoUrl: rocket.info_url || undefined,
      wikiUrl: rocket.wiki_url || undefined
    },
    mission: {
      name: mission.name || undefined,
      type: normalizeAgencyType(mission.type) || undefined,
      description: mission.description || undefined,
      orbit: orbit.name || orbit.abbrev || undefined,
      infoUrls: mission.info_urls || undefined,
      vidUrls: mission.vid_urls || undefined,
      agencies: missionAgencies.length
        ? missionAgencies.map((a: any) => ({
          id: a.id,
          name: a.name,
          type: normalizeAgencyType(a.type) || undefined,
          country_code: resolveCountryCode(a.country ?? a.country_code) || undefined,
          logoUrl: extractImageUrl(a.logo ?? a.logo_url) || undefined,
          imageUrl: extractImageUrl(a.image ?? a.image_url) || undefined
        }))
      : undefined
    },
    pad: {
      name: pad.name || 'Pad',
      shortCode: padShortCode || 'Pad',
      state: derivePadState(pad.location?.state_code || null, locationName) || 'NA',
      timezone: pad.location?.timezone_name || 'America/New_York',
      locationName: locationName || undefined,
      countryCode: resolveCountryCode(pad.location?.country ?? pad.location?.country_code) || undefined,
      mapUrl: pad.map_url || undefined,
      latitude: padLatitude ?? undefined,
      longitude: padLongitude ?? undefined
    },
    net: row.net,
    netPrecision: normalizeNetPrecision(row.net_precision),
    windowStart: row.window_start,
    windowEnd: row.window_end,
    webcastLive: row.webcast_live,
    videoUrl: selectVideoUrl(row.vid_urls ?? row.vidURLs, row.video_url) || undefined,
    image: {
      thumbnail: extractImageThumbnailUrl(row.image, row.infographic) || 'https://images2.imgbox.com/00/00/default.png',
      full: extractImageFullUrl(row.image) || undefined,
      credit: image?.credit || undefined,
      license: imageLicense?.name || undefined,
      licenseUrl: imageLicense?.link || imageLicense?.url || undefined,
      singleUse: typeof image?.single_use === 'boolean' ? image.single_use : undefined
    },
    tier: 'routine',
    status: mapStatus(row.status?.abbrev || row.status?.name || row.status?.description),
    statusText: row.status?.description || row.status?.name || 'Unknown',
    featured: false,
    launchInfoUrls: row.info_urls ?? row.infoURLs ?? undefined,
    launchVidUrls: row.vid_urls ?? row.vidURLs ?? undefined,
    flightclubUrl: row.flightclub_url || undefined,
    hashtag: row.hashtag || undefined,
    probability: typeof row.probability === 'number' ? row.probability : undefined,
    holdReason: row.holdreason ?? row.hold_reason ?? undefined,
    failReason: row.failreason || undefined,
    missionPatches: row.mission_patches || undefined,
    updates: row.updates || undefined,
    timeline: row.timeline || undefined,
    programs: programs.length
      ? programs.map((p: any) => ({
          id: p.id,
          name: p.name,
          type: p.type?.name || p.type,
          description: p.description,
          image_url: p.image_url,
          info_url: p.info_url,
          wiki_url: p.wiki_url,
          start_date: p.start_date,
          end_date: p.end_date,
          agencies: (p.agencies || []).map((a: any) => a.name)
        }))
      : undefined,
    crew: crew.length
      ? crew.map((c: any) => ({
          role: c.role,
          astronaut: c.astronaut?.name,
          astronaut_id: typeof c.astronaut?.id === 'number' ? c.astronaut.id : null,
          nationality: c.astronaut?.nationality
        }))
      : undefined,
    payloads: undefined
  };
}

export function mapLl2ToLaunchUpsert(row: any): LaunchUpsertRow {
  const pad = row.pad || {};
  const loc = pad.location || {};
  const agency = row.launch_service_provider || {};
  const rocket = row.rocket?.configuration || {};
  const manufacturer = rocket.manufacturer || {};
  const status = row.status || {};
  const mission = row.mission || {};
  const orbit = mission.orbit || {};
  const programs = row.program || [];
  const crew = row.crew || [];
  const missionAgencies = mission.agencies || [];
  const payloads = row.rocket?.payloads || row.mission?.payloads || row.rocket?.spacecraft_stage?.spacecraft || [];
  const image = row.image || {};
  const imageLicense = image?.license || {};

  const padLatitude = parseNumber(pad.latitude ?? loc.latitude);
  const padLongitude = parseNumber(pad.longitude ?? loc.longitude);
  const padState = derivePadState(loc.state_code || null, loc.name || null);

  return {
    ll2_launch_uuid: row.id,
    launch_designator: mission.launch_designator || row.launch_designator || null,
    name: buildLaunchName(row, mission, rocket),
    slug: row.slug || null,
    status_id: status.id || null,
    status_name: mapStatus(status.abbrev || status.name || status.description),
    status_abbrev: status.abbrev || status.name || null,
    net: row.net,
    net_precision: normalizeNetPrecision(row.net_precision),
    window_start: row.window_start || null,
    window_end: row.window_end || null,
    provider: agency.name || null,
    provider_type: normalizeAgencyType(agency.type),
    provider_country_code: resolveCountryCode(agency.country ?? agency.country_code),
    provider_description: agency.description || null,
    vehicle: rocket.full_name || rocket.name || null,
    rocket_full_name: rocket.full_name || rocket.name || null,
    rocket_family: rocket.family || null,
    rocket_description: rocket.description || null,
    rocket_manufacturer: manufacturer.name || agency.name || null,
    rocket_manufacturer_logo_url: extractImageUrl(manufacturer.logo ?? manufacturer.logo_url),
    rocket_manufacturer_image_url: extractImageUrl(manufacturer.image ?? manufacturer.image_url),
    rocket_image_url: extractImageUrl(rocket.image ?? rocket.image_url),
    rocket_variant: rocket.variant || null,
    rocket_length_m: parseNumber(rocket.length),
    rocket_diameter_m: parseNumber(rocket.diameter),
    rocket_reusable: rocket.reusable ?? null,
    rocket_maiden_flight: rocket.maiden_flight || null,
    rocket_leo_capacity: rocket.leo_capacity || null,
    rocket_gto_capacity: rocket.gto_capacity || null,
    rocket_launch_mass: rocket.launch_mass || null,
    rocket_launch_cost: rocket.launch_cost || null,
    rocket_info_url: rocket.info_url || null,
    rocket_wiki_url: rocket.wiki_url || null,
    mission_name: mission.name || null,
    mission_description: mission.description || null,
    mission_type: normalizeAgencyType(mission.type),
    mission_orbit: orbit.name || orbit.abbrev || null,
    mission_agencies: missionAgencies.length
      ? missionAgencies.map((a: any) => ({
          id: a.id,
          name: a.name,
          type: normalizeAgencyType(a.type),
          country_code: resolveCountryCode(a.country ?? a.country_code),
          logoUrl: extractImageUrl(a.logo ?? a.logo_url),
          imageUrl: extractImageUrl(a.image ?? a.image_url)
        }))
      : null,
    mission_info_urls: mission.info_urls || null,
    mission_vid_urls: mission.vid_urls || null,
    launch_info_urls: row.info_urls ?? row.infoURLs ?? null,
    launch_vid_urls: row.vid_urls ?? row.vidURLs ?? null,
    flightclub_url: row.flightclub_url || null,
    hashtag: row.hashtag || null,
    probability: typeof row.probability === 'number' ? row.probability : null,
    hold_reason: row.holdreason ?? row.hold_reason ?? null,
    fail_reason: row.failreason || null,
    pad_name: pad.name || null,
    pad_short_code: derivePadShortCode(pad.name || '', pad.short_code || pad.abbrev || null),
    pad_state: padState,
    pad_timezone: loc.timezone_name || 'America/New_York',
    pad_location_name: loc.name || null,
    pad_country_code: resolveCountryCode(loc.country ?? loc.country_code),
    pad_map_url: pad.map_url || null,
    pad_latitude: padLatitude ?? undefined,
    pad_longitude: padLongitude ?? undefined,
    ll2_pad_id: pad.id || null,
    ll2_agency_id: agency.id || null,
    ll2_rocket_config_id: rocket.id || null,
    webcast_live: row.webcast_live || row.webcast_live === true,
    video_url: selectVideoUrl(row.vid_urls ?? row.vidURLs, row.video_url),
    image_thumbnail_url: extractImageThumbnailUrl(row.image, row.infographic),
    provider_logo_url: extractImageUrl(agency.logo ?? agency.logo_url),
    provider_image_url: extractImageUrl(agency.image ?? agency.image_url),
    tier_auto: 'routine',
    featured: false,
    hidden: false,
    agency_launch_attempt_count: typeof row.agency_launch_attempt_count === 'number' ? row.agency_launch_attempt_count : null,
    agency_launch_attempt_count_year: typeof row.agency_launch_attempt_count_year === 'number' ? row.agency_launch_attempt_count_year : null,
    location_launch_attempt_count: typeof row.location_launch_attempt_count === 'number' ? row.location_launch_attempt_count : null,
    location_launch_attempt_count_year:
      typeof row.location_launch_attempt_count_year === 'number' ? row.location_launch_attempt_count_year : null,
    orbital_launch_attempt_count: typeof row.orbital_launch_attempt_count === 'number' ? row.orbital_launch_attempt_count : null,
    orbital_launch_attempt_count_year:
      typeof row.orbital_launch_attempt_count_year === 'number' ? row.orbital_launch_attempt_count_year : null,
    pad_launch_attempt_count: typeof row.pad_launch_attempt_count === 'number' ? row.pad_launch_attempt_count : null,
    pad_launch_attempt_count_year: typeof row.pad_launch_attempt_count_year === 'number' ? row.pad_launch_attempt_count_year : null,
    pad_turnaround: row.pad_turnaround || null,
    mission_patches: row.mission_patches || null,
    updates: row.updates || null,
    timeline: row.timeline || null,
    image_url: extractImageFullUrl(row.image),
    image_credit: image?.credit || null,
    image_license_name: imageLicense?.name || null,
    image_license_url: imageLicense?.link || imageLicense?.url || null,
    image_single_use: typeof image?.single_use === 'boolean' ? image.single_use : null,
    last_updated_source: row.last_updated || row.net || null,
    updated_at: new Date().toISOString(),
    programs: programs.length
      ? programs.map((p: any) => ({
          id: p.id,
          name: p.name,
          type: p.type?.name || p.type,
          description: p.description,
          image_url: p.image_url,
          info_url: p.info_url,
          wiki_url: p.wiki_url,
          start_date: p.start_date,
          end_date: p.end_date,
          agencies: (p.agencies || []).map((a: any) => a.name)
        }))
      : null,
    crew: crew.length
      ? crew.map((c: any) => ({
          role: c.role,
          astronaut: c.astronaut?.name,
          astronaut_id: typeof c.astronaut?.id === 'number' ? c.astronaut.id : null,
          nationality: c.astronaut?.nationality
        }))
      : null,
    payloads: payloads.length
      ? payloads.map((p: any) => ({
          name: p.name || p.serial_number || p.destination || 'Payload',
          type: p.type || p.destination || undefined,
          orbit: p.orbit?.name || p.orbit || undefined,
          agency: p.agency?.name || p.manufacturer?.name || undefined
        }))
      : null
  };
}

async function getUsLocationIds() {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from('system_settings')
    .select('value, updated_at')
    .eq('key', US_LOCATIONS_KEY)
    .maybeSingle();

  const existingIds = parseLocationIds(data?.value);
  const updatedAt = data?.updated_at ? Date.parse(data.updated_at) : NaN;
  const ageHours = Number.isFinite(updatedAt) ? (Date.now() - updatedAt) / (1000 * 60 * 60) : Infinity;

  if (existingIds.length && ageHours < US_LOCATIONS_MAX_AGE_HOURS) return existingIds;

  const rate = await tryConsumeProvider('ll2');
  if (!rate.allowed) {
    return existingIds.length ? existingIds : null;
  }

  const url = `${LL2_BASE}/locations/?format=json&country_code=USA&limit=100`;
  const res = await fetch(url, { headers: buildLl2Headers() });
  if (!res.ok) {
    console.warn('LL2 locations fetch failed', res.status);
    return existingIds.length ? existingIds : null;
  }

  const json = await res.json();
  const ids = (json.results || [])
    .map((loc: any) => loc.id)
    .filter((id: any) => typeof id === 'number');

  if (ids.length) {
    await supabase
      .from('system_settings')
      .upsert({ key: US_LOCATIONS_KEY, value: ids, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  }

  return ids.length ? ids : existingIds.length ? existingIds : null;
}

function parseLocationIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => Number(v)).filter((v) => Number.isFinite(v));
}

export function buildLl2Headers() {
  const headers: Record<string, string> = { 'User-Agent': LL2_USER_AGENT, accept: 'application/json' };
  if (LL2_API_KEY) {
    headers.Authorization = `Token ${LL2_API_KEY}`;
  }
  return headers;
}

function resolveCountryCode(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const code = resolveCountryCode(item);
      if (code) return code;
    }
    return null;
  }
  if (typeof value === 'object') {
    const obj = value as {
      alpha_3_code?: string;
      alpha_2_code?: string;
      country_code?: string;
      code?: string;
    };
    return obj.alpha_3_code || obj.alpha_2_code || obj.country_code || obj.code || null;
  }
  return null;
}

function normalizeAgencyType(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const obj = value as { name?: string; abbrev?: string };
    return obj.name || obj.abbrev || null;
  }
  return null;
}

function extractImageUrl(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const obj = value as { image_url?: string; thumbnail_url?: string; url?: string };
    return obj.image_url || obj.thumbnail_url || obj.url || null;
  }
  return null;
}

function extractImageFullUrl(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const obj = value as { image_url?: string; url?: string; thumbnail_url?: string };
    return obj.image_url || obj.url || obj.thumbnail_url || null;
  }
  return null;
}

function extractImageThumbnailUrl(image: unknown, infographic: unknown): string | null {
  if (image && typeof image === 'object') {
    const obj = image as { thumbnail_url?: string; image_url?: string; url?: string };
    const thumb = obj.thumbnail_url || obj.image_url || obj.url;
    if (thumb) return thumb;
  }
  const primary = extractImageUrl(image);
  if (primary) return primary;
  return extractImageUrl(infographic);
}

function mapStatus(status?: string): Launch['status'] {
  if (!status) return 'unknown';
  const normalized = status.toLowerCase().trim();
  if (!normalized) return 'unknown';

  if (
    normalized.includes('partial failure') ||
    normalized.includes('failure') ||
    normalized.includes('scrub')
  ) {
    return 'scrubbed';
  }
  if (normalized.includes('hold')) return 'hold';
  if (
    normalized.includes('tbd') ||
    normalized.includes('tbc') ||
    normalized.includes('to be determined') ||
    normalized.includes('to be confirmed')
  ) {
    return 'tbd';
  }
  if (
    normalized.includes('go') ||
    normalized.includes('success') ||
    normalized.includes('in flight') ||
    normalized.includes('in-flight')
  ) {
    return 'go';
  }
  return 'unknown';
}

export async function upsertLaunches(rows: LaunchUpsertRow[]) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from('launches').upsert(rows, { onConflict: 'll2_launch_uuid' });
  if (error) console.error('upsert launches error', error);
}

export async function upsertLl2References(launches: any[]) {
  if (!launches.length) return;
  const supabase = createSupabaseAdminClient();

  const agencies = new Map<number, { ll2_agency_id: number; name: string; abbrev?: string | null }>();
  const locations = new Map<
    number,
    {
      ll2_location_id: number;
      name: string;
      country_code: string | null;
      timezone_name?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    }
  >();
  const pads = new Map<number, { ll2_pad_id: number; ll2_location_id: number; name: string; latitude?: number | null; longitude?: number | null; state_code?: string | null }>();
  const rockets = new Map<number, { ll2_config_id: number; name: string; full_name?: string | null; family?: string | null; manufacturer?: string | null }>();

  for (const row of launches) {
    const agency = row.launch_service_provider;
    if (agency?.id && agency?.name) {
      agencies.set(agency.id, { ll2_agency_id: agency.id, name: agency.name, abbrev: agency.abbrev || null });
    }

    const manufacturer = row.rocket?.configuration?.manufacturer;
    if (manufacturer?.id && manufacturer?.name) {
      agencies.set(manufacturer.id, { ll2_agency_id: manufacturer.id, name: manufacturer.name, abbrev: manufacturer.abbrev || null });
    }

    const loc = row.pad?.location;
    const locCountryCode = resolveCountryCode(loc?.country ?? loc?.country_code);
    if (loc?.id && loc?.name) {
      locations.set(loc.id, {
        ll2_location_id: loc.id,
        name: loc.name,
        country_code: locCountryCode ?? null,
        timezone_name: loc.timezone_name || null,
        latitude: parseNumber(loc.latitude) ?? undefined,
        longitude: parseNumber(loc.longitude) ?? undefined
      });
    }

    const pad = row.pad;
    if (pad?.id && pad?.name && loc?.id) {
      pads.set(pad.id, {
        ll2_pad_id: pad.id,
        ll2_location_id: loc.id,
        name: pad.name,
        latitude: parseNumber(pad.latitude) ?? undefined,
        longitude: parseNumber(pad.longitude) ?? undefined,
        state_code: derivePadState(loc.state_code || null, loc.name || null)
      });
    }

    const rocket = row.rocket?.configuration;
    if (rocket?.id && rocket?.name) {
      rockets.set(rocket.id, {
        ll2_config_id: rocket.id,
        name: rocket.name,
        full_name: rocket.full_name || null,
        family: rocket.family || null,
        manufacturer: rocket.manufacturer?.name || null
      });
    }
  }

  if (locations.size) {
    const { error } = await supabase.from('ll2_locations').upsert([...locations.values()], { onConflict: 'll2_location_id' });
    if (error) console.error('upsert ll2_locations error', error);
  }

  if (pads.size) {
    const { error } = await supabase.from('ll2_pads').upsert([...pads.values()], { onConflict: 'll2_pad_id' });
    if (error) console.error('upsert ll2_pads error', error);
  }

  if (agencies.size) {
    const { error } = await supabase.from('ll2_agencies').upsert([...agencies.values()], { onConflict: 'll2_agency_id' });
    if (error) console.error('upsert ll2_agencies error', error);
  }

  if (rockets.size) {
    const { error } = await supabase.from('ll2_rocket_configs').upsert([...rockets.values()], { onConflict: 'll2_config_id' });
    if (error) console.error('upsert ll2_rocket_configs error', error);
  }
}
