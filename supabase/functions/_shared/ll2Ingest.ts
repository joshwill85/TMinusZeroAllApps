import { createSupabaseAdminClient } from './supabase.ts';
import {
  derivePadShortCode,
  derivePadState,
  normalizeNetPrecision,
  parseNumber,
  selectVideoUrl
} from './ll2.ts';

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

type Ll2RocketConfigReferenceRow = {
  ll2_config_id: number;
  name: string;
  full_name?: string | null;
  family?: string | null;
  manufacturer?: string | null;
};

async function bestEffortUpsertCelestrakIntdesDatasets(supabase: ReturnType<typeof createSupabaseAdminClient>, rows: any[]) {
  const designators = new Set<string>();
  for (const row of rows) {
    const designator = normalizeNonEmptyString(row?.launch_designator);
    if (designator) designators.add(designator);
  }

  if (!designators.size) return;

  const payload = [...designators].map((launchDesignator) => ({
    launch_designator: launchDesignator,
    enabled: true
  }));

  const { error } = await supabase
    .from('celestrak_intdes_datasets')
    .upsert(payload, { onConflict: 'launch_designator', ignoreDuplicates: true });

  if (error) {
    // Avoid breaking core LL2 ingestion if the optional INTDES job isn't deployed yet.
    const message = typeof error?.message === 'string' ? error.message : String(error);
    console.warn('celestrak_intdes_datasets upsert failed', message);
  }
}

function parseInteger(value: unknown): number | null {
  const n = parseNumber(value);
  if (n == null || !Number.isFinite(n)) return null;
  return Math.trunc(n);
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

function normalizeStringArray(value: unknown): string[] | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    const items = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item);
    return items.length ? items : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : null;
  }
  return null;
}

function mapStatus(status?: string) {
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

function normalizeDateTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function shouldTreatCrewEntryAsPayload(astronautName: string | null, role: string | null) {
  const name = (astronautName || '').trim().toLowerCase();
  const normalizedRole = (role || '').trim().toLowerCase();
  if (!name && !normalizedRole) return false;
  if (/\b(?:anthropomorphic|test\s+device|dummy|atd)\b/i.test(normalizedRole)) return true;
  if (/\bmannequin\b/i.test(name)) return true;
  return false;
}

function deriveCrewFromSpacecraftStages(spacecraftStages: any[]) {
  const crew: Array<{ role?: string; astronaut?: string; astronaut_id?: number | null; nationality?: string }> = [];
  const seen = new Set<string>();

  const ingestBucket = (bucket: unknown) => {
    if (!Array.isArray(bucket)) return;

    for (const entry of bucket) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as any;
      const role = normalizeNonEmptyString(row?.role?.role ?? row?.role) || null;
      const astronaut = row?.astronaut && typeof row.astronaut === 'object' ? (row.astronaut as any) : null;
      const name = normalizeNonEmptyString(astronaut?.name ?? row?.astronaut) || null;
      if (!name) continue;
      if (shouldTreatCrewEntryAsPayload(name, role)) continue;

      const astronautId = typeof astronaut?.id === 'number' ? astronaut.id : null;
      const nationality = normalizeNonEmptyString(astronaut?.nationality) || null;
      const key = `${(name || '').toLowerCase()}|${String(astronautId ?? '')}`;
      if (seen.has(key)) continue;
      seen.add(key);

      crew.push({
        role: role || undefined,
        astronaut: name,
        astronaut_id: astronautId,
        nationality: nationality || undefined
      });
    }
  };

  for (const stage of spacecraftStages) {
    ingestBucket(stage?.launch_crew);
    ingestBucket(stage?.onboard_crew);
    ingestBucket(stage?.landing_crew);
  }

  return crew;
}

export function mapLl2ToLaunchUpsert(row: any) {
  const pad = row.pad || {};
  const loc = pad.location || {};
  const agency = row.launch_service_provider || {};
  const rocket = row.rocket?.configuration || {};
  const manufacturer = rocket.manufacturer || {};
  const status = row.status || {};
  const mission = row.mission || {};
  const orbit = mission.orbit || {};
  const programs = row.program || [];
  const crew = Array.isArray(row.crew) ? row.crew : [];
  const missionAgencies = mission.agencies || [];
  const payloadFlights = Array.isArray(row.rocket?.payloads) ? row.rocket.payloads : [];
  const spacecraftStageRaw = row.rocket?.spacecraft_stage;
  const spacecraftFlights = Array.isArray(spacecraftStageRaw)
    ? spacecraftStageRaw
    : spacecraftStageRaw && typeof spacecraftStageRaw === 'object'
      ? [spacecraftStageRaw]
      : [];
  const image = row.image || {};
  const imageLicense = image?.license || {};
  const derivedCrew = crew.length ? [] : deriveCrewFromSpacecraftStages(spacecraftFlights);

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
    rocket_leo_capacity: parseInteger(rocket.leo_capacity),
    rocket_gto_capacity: parseInteger(rocket.gto_capacity),
    rocket_launch_mass: parseInteger(rocket.launch_mass),
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
          country_code: resolveCountryCode(a.country ?? a.country_code)
        }))
      : null,
    mission_info_urls: mission.info_urls || null,
    mission_vid_urls: mission.vid_urls || null,
    launch_info_urls: row.info_urls ?? row.infoURLs ?? null,
    launch_vid_urls: row.vid_urls ?? row.vidURLs ?? null,
    flightclub_url: row.flightclub_url || null,
    hashtag: row.hashtag || null,
    probability: typeof row.probability === 'number' ? row.probability : null,
    weather_concerns: normalizeStringArray(row.weather_concerns),
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
    agency_launch_attempt_count_year:
      typeof row.agency_launch_attempt_count_year === 'number' ? row.agency_launch_attempt_count_year : null,
    location_launch_attempt_count:
      typeof row.location_launch_attempt_count === 'number' ? row.location_launch_attempt_count : null,
    location_launch_attempt_count_year:
      typeof row.location_launch_attempt_count_year === 'number' ? row.location_launch_attempt_count_year : null,
    orbital_launch_attempt_count:
      typeof row.orbital_launch_attempt_count === 'number' ? row.orbital_launch_attempt_count : null,
    orbital_launch_attempt_count_year:
      typeof row.orbital_launch_attempt_count_year === 'number' ? row.orbital_launch_attempt_count_year : null,
    pad_launch_attempt_count: typeof row.pad_launch_attempt_count === 'number' ? row.pad_launch_attempt_count : null,
    pad_launch_attempt_count_year:
      typeof row.pad_launch_attempt_count_year === 'number' ? row.pad_launch_attempt_count_year : null,
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
      : derivedCrew.length
        ? derivedCrew
        : null,
    payloads:
      payloadFlights.length || spacecraftFlights.length
        ? [
            ...payloadFlights.map((pf: any) => {
              const payload = pf?.payload || {};
              const payloadType = payload?.type || {};
              const operator = payload?.operator || {};
              const payloadManufacturer = payload?.manufacturer || {};
              const payloadId = typeof payload?.id === 'number' ? payload.id : null;
              const name = payload?.name || (payloadId != null ? `Payload ${payloadId}` : null) || pf?.destination || 'Payload';
              return {
                name,
                type: payloadType?.name || undefined,
                orbit: pf?.destination || undefined,
                agency: operator?.name || payloadManufacturer?.name || undefined
              };
            }),
            ...spacecraftFlights.map((sf: any) => {
              const spacecraft = sf?.spacecraft || {};
              const config = spacecraft?.spacecraft_config || {};
              const spacecraftType = config?.type || {};
              const spacecraftAgency = config?.agency || {};
              const spacecraftId = typeof spacecraft?.id === 'number' ? spacecraft.id : null;
              const name =
                spacecraft?.name ||
                spacecraft?.serial_number ||
                (spacecraftId != null ? `Spacecraft ${spacecraftId}` : null) ||
                sf?.destination ||
                'Spacecraft';
              return {
                name,
                type: spacecraftType?.name || undefined,
                orbit: sf?.destination || undefined,
                agency: spacecraftAgency?.name || undefined
              };
            })
          ]
        : null
		  };
}

export async function upsertLaunches(supabase: ReturnType<typeof createSupabaseAdminClient>, rows: any[]) {
  if (!rows.length) return;
  const sanitized = rows.map((row) => {
    const name = normalizeNonEmptyString(row?.name);
    if (name) return row;
    const ll2 = normalizeNonEmptyString(row?.ll2_launch_uuid);
    const fallback = ll2 ? `Launch ${ll2.slice(0, 8)}` : 'Launch';
    return { ...row, name: fallback };
  });

  let hydrated = sanitized;
  try {
    hydrated = await fillMissingRocketFamiliesFromConfigs(supabase, sanitized);
  } catch (err) {
    console.warn('fillMissingRocketFamiliesFromConfigs failed', err instanceof Error ? err.message : String(err));
  }

  const { error } = await supabase.from('launches').upsert(hydrated, { onConflict: 'll2_launch_uuid' });
  if (error) throw error;

  try {
    await bestEffortUpsertCelestrakIntdesDatasets(supabase, hydrated);
  } catch (err) {
    console.warn('bestEffortUpsertCelestrakIntdesDatasets failed', err instanceof Error ? err.message : String(err));
  }
}

async function fillMissingRocketFamiliesFromConfigs(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: any[]
) {
  const configIds = Array.from(
    new Set(
      rows
        .filter((row) => !normalizeNonEmptyString(row?.rocket_family))
        .map((row) => parseInteger(row?.ll2_rocket_config_id))
        .filter((value): value is number => value != null)
    )
  );

  if (!configIds.length) return rows;

  const { data, error } = await supabase.from('ll2_rocket_configs').select('ll2_config_id, family').in('ll2_config_id', configIds);
  if (error) throw error;

  const familyByConfigId = new Map<number, string>();
  for (const row of data || []) {
    const configId = parseInteger(row?.ll2_config_id);
    const family = normalizeNonEmptyString(row?.family);
    if (configId != null && family) familyByConfigId.set(configId, family);
  }

  if (!familyByConfigId.size) return rows;

  return rows.map((row) => {
    if (normalizeNonEmptyString(row?.rocket_family)) return row;
    const configId = parseInteger(row?.ll2_rocket_config_id);
    if (configId == null) return row;
    const family = familyByConfigId.get(configId);
    return family ? { ...row, rocket_family: family } : row;
  });
}

export function mergeLl2RocketConfigReferenceRows(
  incomingRows: Ll2RocketConfigReferenceRow[],
  existingRows: Array<Partial<Ll2RocketConfigReferenceRow> | null | undefined> = []
) {
  const existingByConfigId = new Map<
    number,
    {
      full_name: string | null;
      family: string | null;
      manufacturer: string | null;
    }
  >();

  for (const row of existingRows) {
    const configId = parseInteger(row?.ll2_config_id);
    if (configId == null) continue;
    existingByConfigId.set(configId, {
      full_name: normalizeNonEmptyString(row?.full_name),
      family: normalizeNonEmptyString(row?.family),
      manufacturer: normalizeNonEmptyString(row?.manufacturer)
    });
  }

  const mergedByConfigId = new Map<number, Ll2RocketConfigReferenceRow>();
  for (const row of incomingRows) {
    const previous = mergedByConfigId.get(row.ll2_config_id) ?? null;
    const existing = existingByConfigId.get(row.ll2_config_id) ?? null;

    mergedByConfigId.set(row.ll2_config_id, {
      ll2_config_id: row.ll2_config_id,
      name: row.name,
      full_name: normalizeNonEmptyString(row.full_name) ?? previous?.full_name ?? existing?.full_name ?? null,
      family: normalizeNonEmptyString(row.family) ?? previous?.family ?? existing?.family ?? null,
      manufacturer: normalizeNonEmptyString(row.manufacturer) ?? previous?.manufacturer ?? existing?.manufacturer ?? null
    });
  }

  return [...mergedByConfigId.values()];
}

async function upsertRocketConfigReferences(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: Ll2RocketConfigReferenceRow[]
) {
  if (!rows.length) return;

  const configIds = [...new Set(rows.map((row) => row.ll2_config_id))];
  const { data, error } = await supabase
    .from('ll2_rocket_configs')
    .select('ll2_config_id, full_name, family, manufacturer')
    .in('ll2_config_id', configIds);
  if (error) throw error;

  const mergedRows = mergeLl2RocketConfigReferenceRows(rows, (data || []) as Partial<Ll2RocketConfigReferenceRow>[]);
  const { error: upsertError } = await supabase.from('ll2_rocket_configs').upsert(mergedRows, { onConflict: 'll2_config_id' });
  if (upsertError) throw upsertError;
}

export async function upsertLl2References(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launches: any[],
  { insertOnly = false }: { insertOnly?: boolean } = {}
) {
  if (!launches.length) return;

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
  const pads = new Map<
    number,
    {
      ll2_pad_id: number;
      ll2_location_id: number;
      name: string;
      latitude?: number | null;
      longitude?: number | null;
      state_code?: string | null;
    }
  >();
  const rockets = new Map<number, Ll2RocketConfigReferenceRow>();

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
      const existingRocket = rockets.get(rocket.id) ?? null;
      rockets.set(rocket.id, {
        ll2_config_id: rocket.id,
        name: rocket.name,
        full_name: normalizeNonEmptyString(rocket.full_name) ?? existingRocket?.full_name ?? null,
        family: normalizeNonEmptyString(rocket.family) ?? existingRocket?.family ?? null,
        manufacturer: normalizeNonEmptyString(rocket.manufacturer?.name) ?? existingRocket?.manufacturer ?? null
      });
    }
  }

  await Promise.all([
    upsertReference(supabase, 'll2_agencies', [...agencies.values()], 'll2_agency_id', { insertOnly }),
    upsertReference(supabase, 'll2_locations', [...locations.values()], 'll2_location_id', { insertOnly }),
    upsertReference(supabase, 'll2_pads', [...pads.values()], 'll2_pad_id', { insertOnly }),
    // Keep rocket config metadata current even during incremental runs so family-level joins
    // can repair blank launch rows without waiting for a full reference backfill, but
    // never let sparse incremental payloads erase known config metadata.
    upsertRocketConfigReferences(supabase, [...rockets.values()])
  ]);
}

async function upsertReference(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  table: 'll2_agencies' | 'll2_locations' | 'll2_pads' | 'll2_rocket_configs',
  rows: any[],
  conflict: string,
  { insertOnly = false }: { insertOnly?: boolean } = {}
) {
  if (!rows.length) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict: conflict, ignoreDuplicates: insertOnly });
  if (error) throw error;
}

export async function upsertLl2PayloadManifest(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launches: any[]
) {
  if (!Array.isArray(launches) || launches.length === 0) return;

  const nowIso = new Date().toISOString();

  const processedLaunchUuids = Array.from(
    new Set(
      launches
        .map((row) => (typeof row?.id === 'string' ? row.id.trim() : ''))
        .filter((id) => id)
    )
  );

  const launchIdByLl2 = new Map<string, string>();
  if (processedLaunchUuids.length) {
    const { data, error } = await supabase
      .from('launches')
      .select('id, ll2_launch_uuid')
      .in('ll2_launch_uuid', processedLaunchUuids);
    if (error) throw error;
    for (const row of data || []) {
      if (row?.ll2_launch_uuid && row?.id) {
        launchIdByLl2.set(String(row.ll2_launch_uuid), String(row.id));
      }
    }
  }

  const payloadTypes = new Map<number, Record<string, unknown>>();
  const agencies = new Map<number, Record<string, unknown>>();
  const payloads = new Map<number, Record<string, unknown>>();
  const landings = new Map<number, Record<string, unknown>>();
  const payloadFlights = new Map<number, Record<string, unknown>>();
  const dockingEvents = new Map<string, Record<string, unknown>>();

  for (const launch of launches) {
    const ll2LaunchUuid = typeof launch?.id === 'string' ? launch.id.trim() : '';
    if (!ll2LaunchUuid) continue;

    const flightRows = Array.isArray(launch?.rocket?.payloads) ? launch.rocket.payloads : [];
    for (const pf of flightRows) {
      const pfId = typeof pf?.id === 'number' ? pf.id : null;
      if (pfId == null) continue;

      const payload = pf?.payload || {};
      const payloadId = typeof payload?.id === 'number' ? payload.id : null;

      const payloadType = payload?.type || {};
      const payloadTypeId = typeof payloadType?.id === 'number' ? payloadType.id : null;
      const payloadTypeName = normalizeNonEmptyString(payloadType?.name);
      if (payloadTypeId != null && payloadTypeName) {
        payloadTypes.set(payloadTypeId, {
          ll2_payload_type_id: payloadTypeId,
          name: payloadTypeName,
          raw: payloadType,
          fetched_at: nowIso,
          updated_at: nowIso
        });
      }

      const manufacturer = payload?.manufacturer || {};
      const manufacturerId = typeof manufacturer?.id === 'number' ? manufacturer.id : null;
      const manufacturerName = normalizeNonEmptyString(manufacturer?.name);
      if (manufacturerId != null && manufacturerName) {
        agencies.set(manufacturerId, {
          ll2_agency_id: manufacturerId,
          name: manufacturerName,
          abbrev: normalizeNonEmptyString(manufacturer?.abbrev),
          updated_at: nowIso
        });
      }

      const operator = payload?.operator || {};
      const operatorId = typeof operator?.id === 'number' ? operator.id : null;
      const operatorName = normalizeNonEmptyString(operator?.name);
      if (operatorId != null && operatorName) {
        agencies.set(operatorId, {
          ll2_agency_id: operatorId,
          name: operatorName,
          abbrev: normalizeNonEmptyString(operator?.abbrev),
          updated_at: nowIso
        });
      }

      if (payloadId != null) {
        const image = payload?.image || {};
        const imageLicense = image?.license || {};
        payloads.set(payloadId, {
          ll2_payload_id: payloadId,
          name: normalizeNonEmptyString(payload?.name) || `Payload ${payloadId}`,
          description: normalizeNonEmptyString(payload?.description),
          payload_type_id: payloadTypeId,
          manufacturer_id: manufacturerId,
          operator_id: operatorId,
          wiki_link: normalizeNonEmptyString(payload?.wiki_link),
          info_link: normalizeNonEmptyString(payload?.info_link),
          cost_usd: typeof payload?.cost === 'number' ? payload.cost : null,
          mass_kg: typeof payload?.mass === 'number' ? payload.mass : null,
          program: Array.isArray(payload?.program) ? payload.program : null,
          image_url: normalizeNonEmptyString(image?.image_url),
          thumbnail_url: normalizeNonEmptyString(image?.thumbnail_url),
          image_credit: normalizeNonEmptyString(image?.credit),
          image_license_name: normalizeNonEmptyString(imageLicense?.name),
          image_license_url: normalizeNonEmptyString(imageLicense?.link || imageLicense?.url),
          image_single_use: typeof image?.single_use === 'boolean' ? image.single_use : null,
          raw: payload,
          fetched_at: nowIso,
          updated_at: nowIso
        });
      }

      const landing = pf?.landing || null;
      const landingId = typeof landing?.id === 'number' ? landing.id : null;
      if (landingId != null) {
        landings.set(landingId, {
          ll2_landing_id: landingId,
          attempt: typeof landing?.attempt === 'boolean' ? landing.attempt : null,
          success: typeof landing?.success === 'boolean' ? landing.success : null,
          description: normalizeNonEmptyString(landing?.description),
          downrange_distance_km: typeof landing?.downrange_distance === 'number' ? landing.downrange_distance : null,
          landing_location: landing?.landing_location ?? null,
          landing_type: landing?.type ?? null,
          raw: landing,
          fetched_at: nowIso,
          updated_at: nowIso
        });
      }

      payloadFlights.set(pfId, {
        ll2_payload_flight_id: pfId,
        ll2_launch_uuid: ll2LaunchUuid,
        launch_id: launchIdByLl2.get(ll2LaunchUuid) || null,
        ll2_payload_id: payloadId,
        url: normalizeNonEmptyString(pf?.url),
        destination: normalizeNonEmptyString(pf?.destination),
        amount: typeof pf?.amount === 'number' ? Math.trunc(pf.amount) : null,
        ll2_landing_id: landingId,
        active: true,
        last_seen_at: nowIso,
        raw: pf,
        fetched_at: nowIso,
        updated_at: nowIso
      });

      const dockings = Array.isArray(pf?.docking_events) ? pf.docking_events : [];
      for (const de of dockings) {
        const dockingId = typeof de?.id === 'number' ? de.id : null;
        if (dockingId == null) continue;
        const key = `${pfId}:${dockingId}`;
        dockingEvents.set(key, {
          ll2_payload_flight_id: pfId,
          ll2_docking_event_id: dockingId,
          docking: normalizeDateTime(de?.docking),
          departure: normalizeDateTime(de?.departure),
          docking_location: de?.docking_location ?? null,
          space_station: de?.space_station_target ?? null,
          flight_vehicle: de?.flight_vehicle_target ?? null,
          raw: de,
          fetched_at: nowIso,
          updated_at: nowIso
        });
      }
    }
  }

  if (payloadTypes.size) {
    const { error } = await supabase.from('ll2_payload_types').upsert([...payloadTypes.values()], { onConflict: 'll2_payload_type_id' });
    if (error) throw error;
  }

  if (agencies.size) {
    const { error } = await supabase.from('ll2_agencies').upsert([...agencies.values()], { onConflict: 'll2_agency_id' });
    if (error) throw error;
  }

  if (payloads.size) {
    const { error } = await supabase.from('ll2_payloads').upsert([...payloads.values()], { onConflict: 'll2_payload_id' });
    if (error) throw error;
  }

  if (landings.size) {
    const { error } = await supabase.from('ll2_landings').upsert([...landings.values()], { onConflict: 'll2_landing_id' });
    if (error) throw error;
  }

  if (payloadFlights.size) {
    const { error } = await supabase.from('ll2_payload_flights').upsert([...payloadFlights.values()], { onConflict: 'll2_payload_flight_id' });
    if (error) throw error;
  }

  if (dockingEvents.size) {
    const { error } = await supabase
      .from('ll2_payload_flight_docking_events')
      .upsert([...dockingEvents.values()], { onConflict: 'll2_payload_flight_id,ll2_docking_event_id' });
    if (error) throw error;
  }

  if (!processedLaunchUuids.length) return;

  const deactivatePatch = { active: false, updated_at: nowIso };
  const nullSeen = await supabase
    .from('ll2_payload_flights')
    .update(deactivatePatch)
    .in('ll2_launch_uuid', processedLaunchUuids)
    .eq('active', true)
    .is('last_seen_at', null);
  if (nullSeen.error) throw nullSeen.error;

  const staleSeen = await supabase
    .from('ll2_payload_flights')
    .update(deactivatePatch)
    .in('ll2_launch_uuid', processedLaunchUuids)
    .eq('active', true)
    .lt('last_seen_at', nowIso);
  if (staleSeen.error) throw staleSeen.error;
}

export async function upsertLl2SpacecraftManifest(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launches: any[]
) {
  if (!Array.isArray(launches) || launches.length === 0) return;

  const nowIso = new Date().toISOString();

  const processedLaunchUuids = Array.from(
    new Set(
      launches
        .map((row) => (typeof row?.id === 'string' ? row.id.trim() : ''))
        .filter((id) => id)
    )
  );

  const launchIdByLl2 = new Map<string, string>();
  if (processedLaunchUuids.length) {
    const { data, error } = await supabase
      .from('launches')
      .select('id, ll2_launch_uuid')
      .in('ll2_launch_uuid', processedLaunchUuids);
    if (error) throw error;
    for (const row of data || []) {
      if (row?.ll2_launch_uuid && row?.id) {
        launchIdByLl2.set(String(row.ll2_launch_uuid), String(row.id));
      }
    }
  }

  const agencies = new Map<number, Record<string, unknown>>();
  const spacecraftTypes = new Map<number, Record<string, unknown>>();
  const spacecraftConfigs = new Map<number, Record<string, unknown>>();
  const spacecrafts = new Map<number, Record<string, unknown>>();
  const landings = new Map<number, Record<string, unknown>>();
  const spacecraftFlights = new Map<number, Record<string, unknown>>();
  const dockingEvents = new Map<string, Record<string, unknown>>();

  for (const launch of launches as any[]) {
    const ll2LaunchUuid = typeof launch?.id === 'string' ? launch.id.trim() : '';
    if (!ll2LaunchUuid) continue;

    const flightRows = Array.isArray(launch?.rocket?.spacecraft_stage) ? launch.rocket.spacecraft_stage : [];
    for (const sf of flightRows) {
      const sfId = typeof sf?.id === 'number' ? sf.id : null;
      if (sfId == null) continue;

      const spacecraft = sf?.spacecraft || {};
      const spacecraftId = typeof spacecraft?.id === 'number' ? spacecraft.id : null;

      const config = spacecraft?.spacecraft_config || {};
      const configId = typeof config?.id === 'number' ? config.id : null;

      const spacecraftType = config?.type || {};
      const spacecraftTypeId = typeof spacecraftType?.id === 'number' ? spacecraftType.id : null;
      const spacecraftTypeName = normalizeNonEmptyString(spacecraftType?.name);
      if (spacecraftTypeId != null && spacecraftTypeName) {
        spacecraftTypes.set(spacecraftTypeId, {
          ll2_spacecraft_type_id: spacecraftTypeId,
          name: spacecraftTypeName,
          raw: spacecraftType,
          fetched_at: nowIso,
          updated_at: nowIso
        });
      }

      const agency = config?.agency || {};
      const agencyId = typeof agency?.id === 'number' ? agency.id : null;
      const agencyName = normalizeNonEmptyString(agency?.name);
      if (agencyId != null && agencyName) {
        agencies.set(agencyId, {
          ll2_agency_id: agencyId,
          name: agencyName,
          abbrev: normalizeNonEmptyString(agency?.abbrev),
          updated_at: nowIso
        });
      }

      if (configId != null) {
        const image = config?.image || {};
        const imageLicense = image?.license || {};
        spacecraftConfigs.set(configId, {
          ll2_spacecraft_config_id: configId,
          name: normalizeNonEmptyString(config?.name) || `Spacecraft config ${configId}`,
          spacecraft_type_id: spacecraftTypeId,
          agency_id: agencyId,
          family: normalizeNonEmptyString(config?.family),
          in_use: typeof config?.in_use === 'boolean' ? config.in_use : null,
          image_url: normalizeNonEmptyString(image?.image_url),
          thumbnail_url: normalizeNonEmptyString(image?.thumbnail_url),
          image_credit: normalizeNonEmptyString(image?.credit),
          image_license_name: normalizeNonEmptyString(imageLicense?.name),
          image_license_url: normalizeNonEmptyString(imageLicense?.link || imageLicense?.url),
          image_single_use: typeof image?.single_use === 'boolean' ? image.single_use : null,
          raw: config,
          fetched_at: nowIso,
          updated_at: nowIso
        });
      }

      if (spacecraftId != null) {
        const image = spacecraft?.image || {};
        const imageLicense = image?.license || {};
        spacecrafts.set(spacecraftId, {
          ll2_spacecraft_id: spacecraftId,
          name: normalizeNonEmptyString(spacecraft?.name) || `Spacecraft ${spacecraftId}`,
          serial_number: normalizeNonEmptyString(spacecraft?.serial_number),
          description: normalizeNonEmptyString(spacecraft?.description),
          status: spacecraft?.status ?? null,
          in_space: typeof spacecraft?.in_space === 'boolean' ? spacecraft.in_space : null,
          spacecraft_config_id: configId,
          image_url: normalizeNonEmptyString(image?.image_url),
          thumbnail_url: normalizeNonEmptyString(image?.thumbnail_url),
          image_credit: normalizeNonEmptyString(image?.credit),
          image_license_name: normalizeNonEmptyString(imageLicense?.name),
          image_license_url: normalizeNonEmptyString(imageLicense?.link || imageLicense?.url),
          image_single_use: typeof image?.single_use === 'boolean' ? image.single_use : null,
          raw: spacecraft,
          fetched_at: nowIso,
          updated_at: nowIso
        });
      }

      const landing = sf?.landing || null;
      const landingId = typeof landing?.id === 'number' ? landing.id : null;
      if (landingId != null) {
        landings.set(landingId, {
          ll2_landing_id: landingId,
          attempt: typeof landing?.attempt === 'boolean' ? landing.attempt : null,
          success: typeof landing?.success === 'boolean' ? landing.success : null,
          description: normalizeNonEmptyString(landing?.description),
          downrange_distance_km: typeof landing?.downrange_distance === 'number' ? landing.downrange_distance : null,
          landing_location: landing?.landing_location ?? null,
          landing_type: landing?.type ?? null,
          raw: landing,
          fetched_at: nowIso,
          updated_at: nowIso
        });
      }

      spacecraftFlights.set(sfId, {
        ll2_spacecraft_flight_id: sfId,
        ll2_launch_uuid: ll2LaunchUuid,
        launch_id: launchIdByLl2.get(ll2LaunchUuid) || null,
        ll2_spacecraft_id: spacecraftId,
        url: normalizeNonEmptyString(sf?.url),
        destination: normalizeNonEmptyString(sf?.destination),
        mission_end: normalizeDateTime(sf?.mission_end),
        duration: normalizeNonEmptyString(sf?.duration),
        turn_around_time: normalizeNonEmptyString(sf?.turn_around_time),
        ll2_landing_id: landingId,
        launch_crew: sf?.launch_crew ?? null,
        onboard_crew: sf?.onboard_crew ?? null,
        landing_crew: sf?.landing_crew ?? null,
        active: true,
        last_seen_at: nowIso,
        raw: sf,
        fetched_at: nowIso,
        updated_at: nowIso
      });

      const dockings = Array.isArray(sf?.docking_events) ? sf.docking_events : [];
      for (const de of dockings) {
        const dockingId = typeof de?.id === 'number' ? de.id : null;
        if (dockingId == null) continue;
        const key = `${sfId}:${dockingId}`;
        dockingEvents.set(key, {
          ll2_spacecraft_flight_id: sfId,
          ll2_docking_event_id: dockingId,
          docking: normalizeDateTime(de?.docking),
          departure: normalizeDateTime(de?.departure),
          docking_location: de?.docking_location ?? null,
          space_station: de?.space_station_target ?? null,
          flight_vehicle: de?.flight_vehicle_target ?? null,
          raw: de,
          fetched_at: nowIso,
          updated_at: nowIso
        });
      }
    }
  }

  if (agencies.size) {
    const { error } = await supabase.from('ll2_agencies').upsert([...agencies.values()], { onConflict: 'll2_agency_id' });
    if (error) throw error;
  }

  if (spacecraftTypes.size) {
    const { error } = await supabase
      .from('ll2_spacecraft_types')
      .upsert([...spacecraftTypes.values()], { onConflict: 'll2_spacecraft_type_id' });
    if (error) throw error;
  }

  if (spacecraftConfigs.size) {
    const { error } = await supabase
      .from('ll2_spacecraft_configs')
      .upsert([...spacecraftConfigs.values()], { onConflict: 'll2_spacecraft_config_id' });
    if (error) throw error;
  }

  if (spacecrafts.size) {
    const { error } = await supabase.from('ll2_spacecrafts').upsert([...spacecrafts.values()], { onConflict: 'll2_spacecraft_id' });
    if (error) throw error;
  }

  if (landings.size) {
    const { error } = await supabase.from('ll2_landings').upsert([...landings.values()], { onConflict: 'll2_landing_id' });
    if (error) throw error;
  }

  if (spacecraftFlights.size) {
    const { error } = await supabase
      .from('ll2_spacecraft_flights')
      .upsert([...spacecraftFlights.values()], { onConflict: 'll2_spacecraft_flight_id' });
    if (error) throw error;
  }

  if (dockingEvents.size) {
    const { error } = await supabase
      .from('ll2_spacecraft_flight_docking_events')
      .upsert([...dockingEvents.values()], { onConflict: 'll2_spacecraft_flight_id,ll2_docking_event_id' });
    if (error) throw error;
  }

  if (!processedLaunchUuids.length) return;

  const deactivatePatch = { active: false, updated_at: nowIso };
  const nullSeen = await supabase
    .from('ll2_spacecraft_flights')
    .update(deactivatePatch)
    .in('ll2_launch_uuid', processedLaunchUuids)
    .eq('active', true)
    .is('last_seen_at', null);
  if (nullSeen.error) throw nullSeen.error;

  const staleSeen = await supabase
    .from('ll2_spacecraft_flights')
    .update(deactivatePatch)
    .in('ll2_launch_uuid', processedLaunchUuids)
    .eq('active', true)
    .lt('last_seen_at', nowIso);
  if (staleSeen.error) throw staleSeen.error;
}
