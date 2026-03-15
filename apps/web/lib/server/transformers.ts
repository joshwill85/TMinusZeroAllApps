import type { LaunchInfoUrl, LaunchVidUrl } from '@/lib/types/launch';
import { Launch } from '@/lib/types/launch';
import { extractUrlFromValue, normalizeNetPrecision } from '@/lib/ingestion/ll2Utils';
import { resolveLaunchStatus } from '@/lib/server/launchStatus';

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeOptionalObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value;
}

function sanitizeLaunchInfoLinks(value: unknown): LaunchInfoUrl[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const links = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const url = normalizeOptionalString(record.url);
      if (!url) {
        return null;
      }

      const sanitized: LaunchInfoUrl = {
        url
      };

      const title = normalizeOptionalString(record.title);
      const description = normalizeOptionalString(record.description);
      const source = normalizeOptionalString(record.source);
      const featureImage = normalizeOptionalString(record.feature_image);
      const type = normalizeOptionalObject(record.type);
      const language = normalizeOptionalObject(record.language);

      if (title) sanitized.title = title;
      if (description) sanitized.description = description;
      if (source) sanitized.source = source;
      if (featureImage) sanitized.feature_image = featureImage;
      if (type) sanitized.type = type as LaunchInfoUrl['type'];
      if (language) sanitized.language = language as LaunchInfoUrl['language'];

      return sanitized;
    })
    .filter((entry): entry is LaunchInfoUrl => entry !== null);

  return links.length ? links : undefined;
}

function sanitizeLaunchVidLinks(value: unknown): LaunchVidUrl[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const links = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const url = normalizeOptionalString(record.url);
      if (!url) {
        return null;
      }

      const sanitized: LaunchVidUrl = {
        url
      };

      const title = normalizeOptionalString(record.title);
      const description = normalizeOptionalString(record.description);
      const source = normalizeOptionalString(record.source);
      const publisher = normalizeOptionalString(record.publisher);
      const featureImage = normalizeOptionalString(record.feature_image);
      const startTime = normalizeOptionalString(record.start_time);
      const endTime = normalizeOptionalString(record.end_time);
      const type = normalizeOptionalObject(record.type);
      const language = normalizeOptionalObject(record.language);

      if (title) sanitized.title = title;
      if (description) sanitized.description = description;
      if (source) sanitized.source = source;
      if (publisher) sanitized.publisher = publisher;
      if (featureImage) sanitized.feature_image = featureImage;
      if (startTime) sanitized.start_time = startTime;
      if (endTime) sanitized.end_time = endTime;
      if (type) sanitized.type = type as LaunchVidUrl['type'];
      if (language) sanitized.language = language as LaunchVidUrl['language'];
      if (typeof record.priority === 'number' && Number.isFinite(record.priority)) {
        sanitized.priority = Math.trunc(record.priority);
      }

      return sanitized;
    })
    .filter((entry): entry is LaunchVidUrl => entry !== null);

  return links.length ? links : undefined;
}

export function mapPublicCacheRow(row: any): Launch {
  return {
    id: row.launch_id,
    ll2Id: row.ll2_launch_uuid || row.launch_id,
    ll2AgencyId: row.ll2_agency_id ?? undefined,
    ll2PadId: row.ll2_pad_id ?? undefined,
    ll2RocketConfigId: row.ll2_rocket_config_id ?? undefined,
    name: row.name,
    slug: row.slug || undefined,
    cacheGeneratedAt: row.cache_generated_at || undefined,
    provider: row.provider || 'Unknown',
    launchDesignator: row.launch_designator || undefined,
    agencyLaunchAttemptCount: row.agency_launch_attempt_count ?? undefined,
    agencyLaunchAttemptCountYear: row.agency_launch_attempt_count_year ?? undefined,
    locationLaunchAttemptCount: row.location_launch_attempt_count ?? undefined,
    locationLaunchAttemptCountYear: row.location_launch_attempt_count_year ?? undefined,
    orbitalLaunchAttemptCount: row.orbital_launch_attempt_count ?? undefined,
    orbitalLaunchAttemptCountYear: row.orbital_launch_attempt_count_year ?? undefined,
    padLaunchAttemptCount: row.pad_launch_attempt_count ?? undefined,
    padLaunchAttemptCountYear: row.pad_launch_attempt_count_year ?? undefined,
    padTurnaround: row.pad_turnaround || undefined,
    providerType: row.provider_type || undefined,
    providerCountryCode: row.provider_country_code || undefined,
    providerDescription: row.provider_description || undefined,
    providerLogoUrl: row.provider_logo_url || undefined,
    providerImageUrl: row.provider_image_url || undefined,
    vehicle: row.vehicle || 'Unknown',
    rocket: {
      fullName: row.rocket_full_name || row.vehicle || undefined,
      family: row.rocket_family || undefined,
      description: row.rocket_description || undefined,
      manufacturer: row.rocket_manufacturer || undefined,
      manufacturerLogoUrl: row.rocket_manufacturer_logo_url || undefined,
      manufacturerImageUrl: row.rocket_manufacturer_image_url || undefined,
      imageUrl: row.rocket_image_url || undefined,
      variant: row.rocket_variant || undefined,
      lengthM: row.rocket_length_m ?? undefined,
      diameterM: row.rocket_diameter_m ?? undefined,
      reusable: row.rocket_reusable ?? undefined,
      maidenFlight: row.rocket_maiden_flight || undefined,
      leoCapacity: row.rocket_leo_capacity ?? undefined,
      gtoCapacity: row.rocket_gto_capacity ?? undefined,
      launchMass: row.rocket_launch_mass ?? undefined,
      launchCost: row.rocket_launch_cost || undefined,
      infoUrl: row.rocket_info_url || undefined,
      wikiUrl: row.rocket_wiki_url || undefined
    },
    mission: {
      name: row.mission_name || undefined,
      type: row.mission_type || undefined,
      description: row.mission_description || undefined,
      orbit: row.mission_orbit || undefined,
      infoUrls: sanitizeLaunchInfoLinks(row.mission_info_urls),
      vidUrls: sanitizeLaunchVidLinks(row.mission_vid_urls),
      agencies: row.mission_agencies || undefined
    },
    pad: {
      name: row.pad_name || 'Pad',
      shortCode: row.pad_short_code || row.pad_name || 'Pad',
      state: row.pad_state_code || 'NA',
      timezone: row.pad_timezone || 'America/New_York',
      locationName: row.pad_location_name || undefined,
      countryCode: row.pad_country_code || undefined,
      mapUrl: row.pad_map_url || undefined,
      latitude: row.pad_latitude ?? undefined,
      longitude: row.pad_longitude ?? undefined
    },
    net: row.net,
    netPrecision: normalizeNetPrecision(row.net_precision),
    windowStart: row.window_start,
    windowEnd: row.window_end,
    webcastLive: row.webcast_live,
    videoUrl: extractUrlFromValue(row.video_url) || undefined,
    image: {
      thumbnail: row.image_thumbnail_url || 'https://images2.imgbox.com/00/00/default.png',
      full: row.image_url || undefined,
      credit: row.image_credit || undefined,
      license: row.image_license_name || undefined,
      licenseUrl: row.image_license_url || undefined,
      singleUse: row.image_single_use ?? undefined
    },
    tier: (row.tier || 'routine') as Launch['tier'],
    status: resolveLaunchStatus(row.status_name, row.status_abbrev),
    statusText: row.status_abbrev || row.status_name || 'Unknown',
    featured: row.featured,
    programs: row.programs || undefined,
    crew: row.crew || undefined,
    payloads: row.payloads || undefined,
    launchInfoUrls: sanitizeLaunchInfoLinks(row.launch_info_urls),
    launchVidUrls: sanitizeLaunchVidLinks(row.launch_vid_urls),
    flightclubUrl: row.flightclub_url || undefined,
    hashtag: row.hashtag || undefined,
    probability: row.probability ?? undefined,
    weatherConcerns: row.weather_concerns || undefined,
    weatherIconUrl: row.weather_icon_url || undefined,
    holdReason: row.hold_reason || undefined,
    failReason: row.fail_reason || undefined,
    missionPatches: row.mission_patches || undefined,
    updates: row.updates || undefined,
    timeline: row.timeline || undefined,
    socialPrimaryPostId: row.social_primary_post_id || undefined,
    socialPrimaryPostUrl: row.social_primary_post_url || undefined,
    socialPrimaryPostPlatform: row.social_primary_post_platform || undefined,
    socialPrimaryPostHandle: row.social_primary_post_handle || undefined,
    socialPrimaryPostMatchedAt: row.social_primary_post_matched_at || undefined,
    socialPrimaryPostForDate: row.social_primary_post_for_date || undefined,
    spacexXPostId: row.spacex_x_post_id || undefined,
    spacexXPostUrl: row.spacex_x_post_url || undefined,
    spacexXPostCapturedAt: row.spacex_x_post_captured_at || undefined,
    spacexXPostForDate: row.spacex_x_post_for_date || undefined
  };
}

export function mapLiveLaunchRow(row: any): Launch {
  return {
    id: row.id,
    ll2Id: row.ll2_launch_uuid,
    ll2AgencyId: row.ll2_agency_id ?? undefined,
    ll2PadId: row.ll2_pad_id ?? undefined,
    ll2RocketConfigId: row.ll2_rocket_config_id ?? undefined,
    name: row.name,
    slug: row.slug || undefined,
    launchDesignator: row.launch_designator || undefined,
    agencyLaunchAttemptCount: row.agency_launch_attempt_count ?? undefined,
    agencyLaunchAttemptCountYear: row.agency_launch_attempt_count_year ?? undefined,
    locationLaunchAttemptCount: row.location_launch_attempt_count ?? undefined,
    locationLaunchAttemptCountYear: row.location_launch_attempt_count_year ?? undefined,
    orbitalLaunchAttemptCount: row.orbital_launch_attempt_count ?? undefined,
    orbitalLaunchAttemptCountYear: row.orbital_launch_attempt_count_year ?? undefined,
    padLaunchAttemptCount: row.pad_launch_attempt_count ?? undefined,
    padLaunchAttemptCountYear: row.pad_launch_attempt_count_year ?? undefined,
    padTurnaround: row.pad_turnaround || undefined,
    provider: row.provider || 'Unknown',
    providerType: row.provider_type || undefined,
    providerCountryCode: row.provider_country_code || undefined,
    providerDescription: row.provider_description || undefined,
    providerLogoUrl: row.provider_logo_url || undefined,
    providerImageUrl: row.provider_image_url || undefined,
    vehicle: row.vehicle || 'Unknown',
    rocket: {
      fullName: row.rocket_full_name || row.vehicle || undefined,
      family: row.rocket_family || undefined,
      description: row.rocket_description || undefined,
      manufacturer: row.rocket_manufacturer || undefined,
      manufacturerLogoUrl: row.rocket_manufacturer_logo_url || undefined,
      manufacturerImageUrl: row.rocket_manufacturer_image_url || undefined,
      imageUrl: row.rocket_image_url || undefined,
      variant: row.rocket_variant || undefined,
      lengthM: row.rocket_length_m ?? undefined,
      diameterM: row.rocket_diameter_m ?? undefined,
      reusable: row.rocket_reusable ?? undefined,
      maidenFlight: row.rocket_maiden_flight || undefined,
      leoCapacity: row.rocket_leo_capacity ?? undefined,
      gtoCapacity: row.rocket_gto_capacity ?? undefined,
      launchMass: row.rocket_launch_mass ?? undefined,
      launchCost: row.rocket_launch_cost || undefined,
      infoUrl: row.rocket_info_url || undefined,
      wikiUrl: row.rocket_wiki_url || undefined
    },
    mission: {
      name: row.mission_name || undefined,
      type: row.mission_type || undefined,
      description: row.mission_description || undefined,
      orbit: row.mission_orbit || undefined,
      infoUrls: sanitizeLaunchInfoLinks(row.mission_info_urls),
      vidUrls: sanitizeLaunchVidLinks(row.mission_vid_urls),
      agencies: row.mission_agencies || undefined
    },
    pad: {
      name: row.pad_name || 'Pad',
      shortCode: row.pad_short_code || 'Pad',
      state: row.pad_state || 'NA',
      timezone: row.pad_timezone || 'America/New_York',
      locationName: row.pad_location_name || undefined,
      countryCode: row.pad_country_code || undefined,
      mapUrl: row.pad_map_url || undefined,
      latitude: row.pad_latitude ?? undefined,
      longitude: row.pad_longitude ?? undefined
    },
    net: row.net,
    netPrecision: normalizeNetPrecision(row.net_precision),
    windowStart: row.window_start,
    windowEnd: row.window_end,
    webcastLive: row.webcast_live,
    videoUrl: extractUrlFromValue(row.video_url) || undefined,
    image: {
      thumbnail: row.image_thumbnail_url || 'https://images2.imgbox.com/00/00/default.png',
      full: row.image_url || undefined,
      credit: row.image_credit || undefined,
      license: row.image_license_name || undefined,
      licenseUrl: row.image_license_url || undefined,
      singleUse: row.image_single_use ?? undefined
    },
    tier: (row.tier_override || row.tier_auto || 'routine') as Launch['tier'],
    status: resolveLaunchStatus(row.status_name, row.status_abbrev),
    statusText: row.status_abbrev || row.status_name || 'Unknown',
    featured: row.featured,
    programs: row.programs || undefined,
    crew: row.crew || undefined,
    payloads: row.payloads || undefined,
    launchInfoUrls: sanitizeLaunchInfoLinks(row.launch_info_urls),
    launchVidUrls: sanitizeLaunchVidLinks(row.launch_vid_urls),
    flightclubUrl: row.flightclub_url || undefined,
    hashtag: row.hashtag || undefined,
    probability: row.probability ?? undefined,
    weatherConcerns: row.weather_concerns || undefined,
    weatherIconUrl: row.weather_icon_url || undefined,
    holdReason: row.hold_reason || undefined,
    failReason: row.fail_reason || undefined,
    missionPatches: row.mission_patches || undefined,
    updates: row.updates || undefined,
    timeline: row.timeline || undefined,
    lastUpdated: row.last_updated_source,
    changeSummary: undefined,
    socialPrimaryPostId: row.social_primary_post_id || undefined,
    socialPrimaryPostUrl: row.social_primary_post_url || undefined,
    socialPrimaryPostPlatform: row.social_primary_post_platform || undefined,
    socialPrimaryPostHandle: row.social_primary_post_handle || undefined,
    socialPrimaryPostMatchedAt: row.social_primary_post_matched_at || undefined,
    socialPrimaryPostForDate: row.social_primary_post_for_date || undefined,
    spacexXPostId: row.spacex_x_post_id || undefined,
    spacexXPostUrl: row.spacex_x_post_url || undefined,
    spacexXPostCapturedAt: row.spacex_x_post_captured_at || undefined,
    spacexXPostForDate: row.spacex_x_post_for_date || undefined
  };
}
