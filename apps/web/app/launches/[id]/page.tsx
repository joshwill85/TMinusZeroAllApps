import { notFound, permanentRedirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { cache, Suspense, type ReactNode } from 'react';
import clsx from 'clsx';
import type { ArTrajectorySummaryV1 } from '@tminuszero/contracts';
import {
  buildLaunchVideoEmbed,
  buildLaunchInventoryStatusMessage,
  selectPreferredResponsiveLaunchExternalResources,
  shouldShowLaunchInventoryCounts,
  shouldShowLaunchInventorySection
} from '@tminuszero/launch-detail-ui';
import type { BadgeTone } from '@/components/Badge';
import { Countdown } from '@/components/Countdown';
import { JsonLd } from '@/components/JsonLd';
import { TimeDisplay } from '@/components/TimeDisplay';
import { AddToCalendarButton } from '@/components/AddToCalendarButton';
import { ShareButton } from '@/components/ShareButton';
import { CameraGuideButton } from '@/components/ar/CameraGuideButton';
import { PremiumGateButton } from '@/components/PremiumGateButton';
import { WatchlistFollows } from '@/components/WatchlistFollows';
import { ChronoHelixTimeline } from '@/components/ChronoHelixTimeline';
import { ImageCreditLine } from '@/components/ImageCreditLine';
import { LaunchUpdateLog, type LaunchUpdateView } from '@/components/LaunchUpdateLog';
import { LaunchDetailAutoRefresh } from '@/components/LaunchDetailAutoRefresh';
import { LaunchDetailRefreshButton } from '@/components/LaunchDetailRefreshButton';
import { LaunchMilestoneMapLive } from '@/components/LaunchMilestoneMapLive';
import { ForecastAdvisoriesDisclosure } from '@/components/launch/ForecastAdvisoriesDisclosure';
import { LaunchMediaLightboxCard } from '@/components/launch/LaunchMediaLightboxCard';
import { Ws45ForecastPanel, type Ws45Forecast } from '@/components/Ws45ForecastPanel';
import { NwsForecastPanel, type NwsLaunchWeather } from '@/components/NwsForecastPanel';
import { Ws45OperationalPanel } from '@/components/Ws45OperationalPanel';
import { Ws45PlanningForecastPanel } from '@/components/Ws45PlanningForecastPanel';
import { PadSatellitePreviewImage } from '@/components/PadSatellitePreviewImage';
import { JepScoreClient } from '@/components/JepScoreClient';
import { LaunchFaaMapBlock } from '@/components/LaunchFaaMapBlock';
import { ThirdPartyVideoEmbed } from '@/components/ThirdPartyVideoEmbed';
import type { TimelineNode } from '@/components/ChronoHelixTimeline';
import { RocketPhotoGallery } from '@/components/RocketPhotoGallery';
import { XTimelineEmbed } from '@/components/XTimelineEmbed';
import { XTweetEmbed } from '@/components/XTweetEmbed';
import { mapLiveLaunchRow, mapPublicCacheRow } from '@/lib/server/transformers';
import { isCountdownEligible, isDateOnlyNet } from '@/lib/time';
import {
  isAppleMapsWebConfigured,
  getGoogleMapsStaticApiKey,
  getGoogleMapsWebApiKey,
  getOgImageVersion,
  getSiteUrl,
  isSupabaseAdminConfigured,
  isSupabaseConfigured
} from '@/lib/server/env';
import { loadArTrajectorySummary } from '@/lib/server/arTrajectory';
import { buildOgVersionSegment } from '@/lib/server/og';
import { US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { getViewerTier } from '@/lib/server/viewerTier';
import { fetchLaunchJepScore } from '@/lib/server/jep';
import { resolveJepObserverFromHeaders } from '@/lib/server/jepObserver';
import { buildLaunchDetailVersionSeed } from '@/lib/server/launchDetailVersion';
import { resolveWebLaunchMapPolicy } from '@/lib/server/mapProviderPolicy';
import { getAppleMapsWebAuthorizationTokenForRequest } from '@/lib/server/appleMapsWeb';
import { buildLaunchMissionTimeline } from '@tminuszero/domain';
import type { LaunchFaaMapRenderMode } from '@/lib/maps/providerTypes';
import type { LaunchJepScore } from '@/lib/types/jep';
import type {
  LaunchDetailEnrichment,
  Launch,
  LaunchExternalContent,
  LaunchExternalResource,
  LaunchInfoUrl,
  LaunchRecoveryDetail,
  LaunchStageSummary,
  LaunchTimelineResourceEvent,
  LaunchVidUrl
} from '@/lib/types/launch';
import { buildLaunchShare } from '@/lib/share';
import { SITE_META } from '@/lib/server/siteMeta';
import { parseIsoDurationToMs } from '@/lib/utils/launchMilestones';
import { parseLaunchParam } from '@/lib/utils/launchParams';
import { resolveProviderLogoUrl } from '@/lib/utils/providerLogo';
import { normalizeImageUrl } from '@/lib/utils/imageUrl';
import { isArtemisLaunch } from '@/lib/utils/launchArtemis';
import { isStarshipLaunch } from '@/lib/utils/launchStarship';
import { buildCatalogHref } from '@/lib/utils/catalog';
import { buildLaunchHref, buildLocationHref, buildProviderHref, buildRocketHref } from '@/lib/utils/launchLinks';
import { buildPadSatellitePreviewPath, formatCoordinatePair } from '@/lib/utils/googleMaps';
import { buildSatelliteHref, buildSatelliteOwnerHref, formatSatelliteOwnerLabel } from '@/lib/utils/satelliteLinks';
import { getLaunchStatusTone, type LaunchStatusTone } from '@/lib/utils/launchStatusTone';
import { getEffectivePrivacyPreferences } from '@/lib/server/privacyPreferences';
import { fetchLaunchFaaAirspace, fetchLaunchFaaAirspaceMap, type LaunchFaaAirspaceAdvisory } from '@/lib/server/faaAirspace';
import { fetchBlueOriginPassengersDatabaseOnly, fetchBlueOriginPayloads } from '@/lib/server/blueOriginPeoplePayloads';
import { fetchLaunchBoosterStats, type LaunchBoosterStats } from '@/lib/server/launchBoosterStats';
import { fetchLaunchDetailEnrichment } from '@/lib/server/launchDetailEnrichment';
import {
  buildWs45OperationalWeather,
  fetchWs45LiveWeatherSnapshotForLaunch,
  fetchWs45PlanningForecastsForLaunch,
  type Ws45OperationalWeather,
  type Ws45PlanningForecast
} from '@/lib/server/ws45RangeWeather';
import {
  buildBlueOriginTravelerSlug,
  extractBlueOriginFlightCode,
  isBlueOriginNonHumanCrewEntry,
  normalizeBlueOriginTravelerRole
} from '@/lib/utils/blueOrigin';

type RelatedNewsItem = {
  snapi_uid: string;
  item_type: 'article' | 'blog' | 'report';
  title: string;
  url: string;
  news_site?: string | null;
  summary?: string | null;
  image_url?: string | null;
  published_at?: string | null;
  authors?: Array<{ name?: string | null }> | null;
  featured?: boolean | null;
};

type RelatedEvent = {
  ll2_event_id: number;
  name: string;
  description?: string | null;
  type_name?: string | null;
  date?: string | null;
  date_precision?: string | null;
  location_name?: string | null;
  url?: string | null;
  image_url?: string | null;
  webcast_live?: boolean | null;
};

type LaunchUpdateRow = {
  id: number;
  launch_id: string;
  changed_fields: string[];
  old_values?: Record<string, any> | null;
  new_values?: Record<string, any> | null;
  detected_at?: string | null;
};

type RocketOutcomeStats = {
  successAllTime: number;
  failureAllTime: number;
  successYear: number;
  failureYear: number;
};

type LaunchPhoto = {
  label: string;
  url: string;
  credit?: string;
  license?: string;
  licenseUrl?: string;
  singleUse?: boolean;
};

type BlueOriginMissionGraphic = {
  id: string;
  label: string;
  url: string;
};

type BlueOriginMissionGraphics = {
  missionUrl: string;
  archiveSnapshotUrl: string | null;
  graphics: BlueOriginMissionGraphic[];
};

type BlueOriginEnhancementSourcePage = {
  url: string;
  canonicalUrl: string | null;
  title: string | null;
  provenance: 'live' | 'wayback' | null;
  archiveSnapshotUrl: string | null;
  fetchedAt: string | null;
};

type BlueOriginEnhancementPassenger = {
  name: string;
  role: string | null;
  bioSnippet: string | null;
  sourceUrl: string | null;
};

type BlueOriginEnhancementPayload = {
  name: string;
  payloadType: string | null;
  agency: string | null;
  description: string | null;
  sourceUrl: string | null;
};

type BlueOriginEnhancementFact = {
  key: string;
  label: string;
  value: string;
  unit: string | null;
  context: string | null;
  sourceUrl: string | null;
};

type BlueOriginLaunchEnhancements = {
  sourcePages: BlueOriginEnhancementSourcePage[];
  passengers: BlueOriginEnhancementPassenger[];
  payloads: BlueOriginEnhancementPayload[];
  facts: BlueOriginEnhancementFact[];
};

type PayloadManifestEntry = {
  kind?: 'payload_flight' | 'spacecraft_flight';
  id: number;
  url?: string | null;
  destination?: string | null;
  amount?: number | null;
  deployment_status?: 'confirmed' | 'unconfirmed' | 'unknown' | string | null;
  deployment_evidence?: string[] | null;
  deployment_notes?: string | null;
  payload?: {
    id: number;
    name: string;
    description?: string | null;
    mass_kg?: number | null;
    cost_usd?: number | null;
    wiki_link?: string | null;
    info_link?: string | null;
    program?: any[] | null;
    type?: { id: number; name: string } | null;
    manufacturer?: { id: number; name: string; abbrev?: string | null } | null;
    operator?: { id: number; name: string; abbrev?: string | null } | null;
    image?: {
      image_url?: string | null;
      thumbnail_url?: string | null;
      credit?: string | null;
      license_name?: string | null;
      license_url?: string | null;
      single_use?: boolean | null;
    } | null;
    raw?: any;
  } | null;
  landing?: {
    id: number;
    attempt?: boolean | null;
    success?: boolean | null;
    description?: string | null;
    downrange_distance_km?: number | null;
    landing_location?: any;
    landing_type?: any;
    raw?: any;
  } | null;
  docking_events?: Array<{
    id?: number | null;
    docking?: string | null;
    departure?: string | null;
    space_station_target?: { name?: string | null } | null;
  }>;
  raw?: any;
};

type SpacecraftStageCard = {
  id: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  destination?: string | null;
  sourceUrl?: string | null;
  infoUrl?: string | null;
  wikiUrl?: string | null;
  landingSummary?: string | null;
  dockingSummary?: string | null;
};

type LaunchInventoryOrbit = {
  source?: string | null;
  epoch?: string | null;
  inclination_deg?: number | null;
  raan_deg?: number | null;
  eccentricity?: number | null;
  arg_perigee_deg?: number | null;
  mean_anomaly_deg?: number | null;
  mean_motion_rev_per_day?: number | null;
  bstar?: number | null;
  fetched_at?: string | null;
};

type LaunchInventoryObject = {
  object_id?: string | null;
  norad_cat_id?: number | null;
  intl_des?: string | null;
  name?: string | null;
  object_type?: string | null;
  ops_status_code?: string | null;
  owner?: string | null;
  launch_date?: string | null;
  launch_site?: string | null;
  decay_date?: string | null;
  period_min?: number | null;
  inclination_deg?: number | null;
  apogee_km?: number | null;
  perigee_km?: number | null;
  rcs_m2?: number | null;
  data_status_code?: string | null;
  orbit_center?: string | null;
  orbit_type?: string | null;
  orbit?: LaunchInventoryOrbit | null;
};

type LaunchObjectInventory = {
  launch_designator?: string | null;
  inventory_status?: {
    catalog_state?: 'pending' | 'catalog_available' | 'catalog_empty' | 'error' | string | null;
    last_checked_at?: string | null;
    last_success_at?: string | null;
    last_error?: string | null;
    last_non_empty_at?: string | null;
    latest_snapshot_hash?: string | null;
  } | null;
  reconciliation?: {
    ll2_manifest_payload_count?: number | null;
    satcat_payload_count?: number | null;
    satcat_payloads_filter_count?: number | null;
    satcat_total_count?: number | null;
    satcat_type_counts?: {
      PAY?: number | null;
      RB?: number | null;
      DEB?: number | null;
      UNK?: number | null;
    } | null;
    delta_manifest_vs_satcat_payload?: number | null;
  } | null;
  satcat_payload_objects?: LaunchInventoryObject[] | null;
  satcat_non_payload_objects?: LaunchInventoryObject[] | null;
  history?: Array<{
    id?: number | null;
    captured_at?: string | null;
    object_count?: number | null;
    payload_count?: number | null;
    rb_count?: number | null;
    deb_count?: number | null;
    unk_count?: number | null;
  }> | null;
};

type Ll2SpacecraftFlightRow = {
  ll2_spacecraft_flight_id: number;
  ll2_launch_uuid: string;
  launch_crew: unknown;
  onboard_crew: unknown;
  landing_crew: unknown;
  active: boolean | null;
};

const INGESTION_STATUS_UPDATE_HIDE_UTC_DAY = '2026-01-03';
const INGESTION_STATUS_UPDATE_HIDE_START_MS = Date.parse(`${INGESTION_STATUS_UPDATE_HIDE_UTC_DAY}T00:00:00.000Z`);
const INGESTION_STATUS_UPDATE_HIDE_END_MS = Date.parse('2026-01-04T00:00:00.000Z');
const STATUS_ONLY_FIELDS = new Set(['status_id', 'status_name', 'status_abbrev']);
const TIMING_FIELDS = new Set(['net', 'net_precision', 'window_start', 'window_end']);
const OPERATIONS_FIELDS = new Set(['hold_reason', 'fail_reason']);
const DETAILS_FIELDS = new Set(['programs', 'crew', 'payloads', 'timeline']);
const CHANGELOG_FIELDS = new Set([...STATUS_ONLY_FIELDS, ...TIMING_FIELDS, ...OPERATIONS_FIELDS, ...DETAILS_FIELDS]);
const STATUS_TONE_STYLES: Record<LaunchStatusTone, { badge: string; text: string }> = {
  success: { badge: 'border-success/40 bg-success/10 text-success', text: 'text-success' },
  warning: { badge: 'border-warning/40 bg-warning/10 text-warning', text: 'text-warning' },
  danger: { badge: 'border-danger/40 bg-danger/10 text-danger', text: 'text-danger' },
  neutral: { badge: 'border-stroke bg-[rgba(234,240,255,0.04)] text-text3', text: 'text-text1' }
};
const BLUE_ORIGIN_MISSION_GRAPHICS_USER_AGENT = 'TMinusZero/0.1 (+https://tminusnow.app)';
const BLUE_ORIGIN_MULTISOURCE_CONSTRAINT_SOURCE = 'blueorigin_multisource';
const BLUE_ORIGIN_MISSION_SUMMARY_FACT_KEY = 'mission_summary';
const BLUE_ORIGIN_FAILURE_REASON_FACT_KEY = 'failure_reason';
const BLUE_ORIGIN_NOISE_PASSENGER_TOKEN =
  /\b(?:mission|launch|payload|news|timeline|profile|booster|capsule|spacecraft|vehicle|status|public|media|pod|video|image|gallery|infographic|patch|update|updates|share|facebook|linkedin|reddit|twitter|instagram|youtube|tiktok|club|future|nasa|kennedy|research|institute|laboratory|lab|center|experiment|installation|device|deorbit|program|watch|subscribe|follow|new shepard|new glenn|experience|parachute|parachutes)\b/i;
const BLUE_ORIGIN_NOISE_PAYLOAD_TOKEN =
  /\b(?:mission|launch|flight|blue origin|new shepard|new glenn|booster|capsule|crew|people|passengers|spaceflight|suborbital|orbital|news|timeline|statistics|profile|infographic|update|updates)\b/i;
const BLUE_ORIGIN_MULTISOURCE_CONSTRAINT_TYPES = [
  'bo_official_sources',
  'bo_manifest_passengers',
  'bo_manifest_payloads',
  'bo_mission_facts'
] as const;
const BLUE_ORIGIN_MULTISOURCE_CONSTRAINT_TYPE_SET = new Set<string>(BLUE_ORIGIN_MULTISOURCE_CONSTRAINT_TYPES);
const BLUE_ORIGIN_EXTERNAL_SOURCE_TIMEOUT_MS = 1800;
const BLUE_ORIGIN_EXTERNAL_SOURCE_INVALID_STATUS_CODES = new Set([404, 410, 451]);
const BLUE_ORIGIN_UNVERIFIED_SOURCE_PATTERN =
  /\b(?:launches_public_cache\.(?:crew|payloads))\b/i;

const BLUE_ORIGIN_MISSION_ARTIFACTS: Record<
  string,
  {
    missionUrl: string;
    patchProductUrl?: string;
    patchImageUrl?: string;
  }
> = {
  'ns-36': {
    missionUrl: 'https://www.blueorigin.com/news/new-shepard-ns-36-mission',
    patchProductUrl: 'https://shop.blueorigin.com/products/pre-sale-ns-36-mission-patch',
    patchImageUrl: 'https://shop.blueorigin.com/cdn/shop/files/FinalpatchNS-36forshop.png?v=1759793737'
  }
};

function shouldHideLaunchUpdate(update: LaunchUpdateRow): boolean {
  if (!update?.detected_at) return false;
  if (!Array.isArray(update.changed_fields) || update.changed_fields.length === 0) return false;

  const normalized = update.changed_fields.map((field) => field.toLowerCase().trim()).filter(Boolean);
  const isStatusOnly = normalized.length > 0 && normalized.every((field) => STATUS_ONLY_FIELDS.has(field));
  if (!isStatusOnly) return false;

  const detectedMs = Date.parse(update.detected_at);
  if (Number.isFinite(detectedMs)) {
    return detectedMs >= INGESTION_STATUS_UPDATE_HIDE_START_MS && detectedMs < INGESTION_STATUS_UPDATE_HIDE_END_MS;
  }

  return update.detected_at.startsWith(INGESTION_STATUS_UPDATE_HIDE_UTC_DAY);
}

function filterChangelogFields(fields: string[]) {
  return fields
    .map((field) => field.trim())
    .filter((field) => CHANGELOG_FIELDS.has(field.toLowerCase()));
}

const fetchLaunch = cache(async (id: string) => {
  let launch = null;

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.from('launches_public_cache').select('*').eq('launch_id', id).maybeSingle();
    if (!error && data) {
      launch = mapPublicCacheRow(data);
    }
  }

  return launch;
});

const fetchLiveLaunch = cache(async (id: string) => {
  let launch = null;

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.from('launches').select('*').eq('id', id).eq('hidden', false).maybeSingle();
    if (!error && data) {
      launch = mapLiveLaunchRow(data);
    }
  }

  return launch;
});

const fetchLl2SpacecraftFlights = cache(async (ll2LaunchUuid: string | null | undefined): Promise<Ll2SpacecraftFlightRow[]> => {
  const normalized = normalizeLl2LaunchUuid(ll2LaunchUuid);
  if (!normalized || !isSupabaseConfigured()) return [] as Ll2SpacecraftFlightRow[];

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('ll2_spacecraft_flights')
    .select('ll2_spacecraft_flight_id,ll2_launch_uuid,launch_crew,onboard_crew,landing_crew,active')
    .eq('ll2_launch_uuid', normalized)
    .limit(12);

  if (error || !Array.isArray(data)) return [] as Ll2SpacecraftFlightRow[];
  return data as Ll2SpacecraftFlightRow[];
});

const fetchLaunchUpdates = cache(async (launchId: string) => {
  if (!isSupabaseAdminConfigured()) return [] as LaunchUpdateRow[];
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('launch_updates')
    .select('id, launch_id, changed_fields, old_values, new_values, detected_at')
    .eq('launch_id', launchId)
    .order('detected_at', { ascending: false });

  if (error || !data) return [] as LaunchUpdateRow[];
  return data as LaunchUpdateRow[];
});

const fetchRelatedNews = cache(async (launchId: string) => {
  if (!isSupabaseConfigured()) return [] as RelatedNewsItem[];
  const supabase = createSupabaseServerClient();
  const { data: joins, error } = await supabase.from('snapi_item_launches').select('snapi_uid').eq('launch_id', launchId);
  if (error || !joins || joins.length === 0) return [] as RelatedNewsItem[];
  const snapiUids = joins.map((row) => row.snapi_uid);
  const { data } = await supabase
    .from('snapi_items')
    .select('snapi_uid, item_type, title, url, news_site, summary, image_url, published_at, authors, featured')
    .in('snapi_uid', snapiUids)
    .order('published_at', { ascending: false })
    .limit(12);
  return (data || []) as RelatedNewsItem[];
});

const fetchRelatedEvents = cache(async (launchId: string) => {
  if (!isSupabaseConfigured()) return [] as RelatedEvent[];
  const supabase = createSupabaseServerClient();
  const { data: joins, error } = await supabase
    .from('ll2_event_launches')
    .select('ll2_event_id')
    .eq('launch_id', launchId);
  if (error || !joins || joins.length === 0) return [] as RelatedEvent[];
  const eventIds = joins.map((row) => row.ll2_event_id);
  const { data } = await supabase
    .from('ll2_events')
    .select('ll2_event_id, name, description, type_name, date, date_precision, location_name, url, image_url, webcast_live')
    .in('ll2_event_id', eventIds);
  return (data || []) as RelatedEvent[];
});

const fetchPayloadManifest = cache(async (ll2LaunchUuid: string) => {
  if (!ll2LaunchUuid || !isSupabaseConfigured()) return [] as PayloadManifestEntry[];
  const supabase = createSupabaseServerClient();

  let { data, error } = await supabase.rpc('get_launch_payload_manifest_v2', {
    ll2_launch_uuid_in: ll2LaunchUuid,
    include_raw: false
  });

  if (isMissingRpcFunction(error)) {
    const fallback = await supabase.rpc('get_launch_payload_manifest', { ll2_launch_uuid_in: ll2LaunchUuid });
    data = fallback.data;
    error = fallback.error;
  }

  if (error || data == null) return [] as PayloadManifestEntry[];
  return parseRpcArray<PayloadManifestEntry>(data);
});

const fetchLaunchObjectInventory = cache(async (ll2LaunchUuid: string) => {
  if (!ll2LaunchUuid || !isSupabaseConfigured()) return null as LaunchObjectInventory | null;
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase.rpc('get_launch_object_inventory_v1', {
    ll2_launch_uuid_in: ll2LaunchUuid,
    include_orbit: true,
    history_limit: 5
  });

  if (isMissingRpcFunction(error)) {
    const fallback = await supabase.rpc('get_launch_satellite_payloads_v2', {
      ll2_launch_uuid_in: ll2LaunchUuid,
      include_raw: false
    });
    if (fallback.error || fallback.data == null) return null as LaunchObjectInventory | null;
    const payloads = parseRpcArray<LaunchInventoryObject>(fallback.data);
    return {
      launch_designator: null,
      inventory_status: {
        catalog_state: payloads.length ? 'catalog_available' : 'pending'
      },
      reconciliation: {
        ll2_manifest_payload_count: null,
        satcat_payload_count: payloads.length,
        satcat_payloads_filter_count: payloads.length,
        satcat_total_count: payloads.length,
        satcat_type_counts: { PAY: payloads.length, RB: 0, DEB: 0, UNK: 0 },
        delta_manifest_vs_satcat_payload: null
      },
      satcat_payload_objects: payloads,
      satcat_non_payload_objects: [],
      history: []
    } satisfies LaunchObjectInventory;
  }

  if (error || data == null) return null as LaunchObjectInventory | null;
  return parseRpcObject<LaunchObjectInventory>(data);
});

function parseRpcArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? (parsed as T[]) : ([] as T[]);
    } catch {
      return [] as T[];
    }
  }
  return [] as T[];
}

function parseRpcObject<T>(data: unknown): T | null {
  if (data && typeof data === 'object' && !Array.isArray(data)) return data as T;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function isMissingRpcFunction(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  if (error.code === '42883') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('function') && msg.includes('does not exist');
}

const fetchVehicleLaunches = cache(async (vehicle: string, rocketFullName?: string) => {
  if (!isSupabaseConfigured()) return [];
  const filters = [vehicle, rocketFullName].map((value) => value?.trim()).filter(Boolean) as string[];
  if (filters.length === 0) return [];
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from('launches_public_cache')
    .select('launch_id, name, mission_name, net, status_name, status_abbrev, vehicle, rocket_full_name')
    .in('pad_country_code', US_PAD_COUNTRY_CODES)
    .order('net', { ascending: true });
  const orFilter = buildVehicleOrFilter(filters);
  if (orFilter) {
    query = query.or(orFilter);
  }
  const { data, error } = await query;
  if (error || !data) return [];
  return data as Array<Record<string, any>>;
});

const fetchRocketOutcomeStats = cache(async (rocketFullName?: string, vehicle?: string) => {
  if (!isSupabaseConfigured()) return null;
  const filters = [rocketFullName, vehicle]
    .map((value) => value?.trim())
    .filter((value) => value && value.toLowerCase() !== 'unknown') as string[];
  if (filters.length === 0) return null;
  const supabase = createSupabaseServerClient();
  const orFilter = buildVehicleOrFilter(filters);
  if (!orFilter) return null;
  const { data, error } = await supabase
    .from('launches_public_cache')
    .select('status_name, status_abbrev, net')
    .or(orFilter);

  if (error || !data) return null;

  const now = new Date();
  const year = now.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year + 1, 0, 1);
  let successAllTime = 0;
  let failureAllTime = 0;
  let successYear = 0;
  let failureYear = 0;

  for (const row of data as Array<Record<string, any>>) {
    const statusMeta = classifyLaunchOutcome(row.status_name, row.status_abbrev);
    if (!statusMeta.isSuccess && !statusMeta.isFailure) continue;

    const netMs = row.net ? Date.parse(row.net) : NaN;
    const isYear = Number.isFinite(netMs) && netMs >= yearStart && netMs < yearEnd;

    if (statusMeta.isSuccess) {
      successAllTime += 1;
      if (isYear) successYear += 1;
    }
    if (statusMeta.isFailure) {
      failureAllTime += 1;
      if (isYear) failureYear += 1;
    }
  }

  return {
    successAllTime,
    failureAllTime,
    successYear,
    failureYear
  } satisfies RocketOutcomeStats;
});

const fetchWs45Forecast = cache(async (launchId: string, isEasternRange: boolean) => {
  if (!isSupabaseConfigured() || !isEasternRange) return null;
  const client = isSupabaseAdminConfigured() ? createSupabaseAdminClient() : createSupabaseServerClient();
  const { data, error } = await client
    .from('ws45_launch_forecasts')
    .select(
      'id, source_label, forecast_kind, pdf_url, issued_at, valid_start, valid_end, mission_name, match_status, match_confidence, forecast_discussion, launch_day_pov_percent, delay_24h_pov_percent, launch_day_primary_concerns, delay_24h_primary_concerns, launch_day, delay_24h'
    )
    .eq('matched_launch_id', launchId)
    .eq('publish_eligible', true)
    .or('forecast_kind.is.null,forecast_kind.neq.faq')
    .order('issued_at', { ascending: false })
    .order('fetched_at', { ascending: false })
    .limit(1);

  if (error) return null;
  return (data?.[0] as Ws45Forecast | undefined) ?? null;
});

const fetchNwsForecast = cache(async (launchId: string, isUsPad: boolean, within14Days: boolean) => {
  if (!isSupabaseConfigured() || !isUsPad || !within14Days) return null;
  const client = isSupabaseAdminConfigured() ? createSupabaseAdminClient() : createSupabaseServerClient();
  const { data, error } = await client
    .from('launch_weather')
    .select('id, issued_at, valid_start, valid_end, summary, probability, data')
    .eq('launch_id', launchId)
    .eq('source', 'nws')
    .maybeSingle();

  if (error) return null;
  return (data as NwsLaunchWeather | null) ?? null;
});

function buildWs45LaunchContext(launch: Launch) {
  return {
    launchName: launch.name,
    missionName: launch.mission?.name ?? null,
    net: launch.net,
    windowStart: launch.windowStart ?? null,
    windowEnd: launch.windowEnd ?? null,
    padName: launch.pad?.name ?? null,
    padShortCode: launch.pad?.shortCode ?? null,
    padLocationName: launch.pad?.locationName ?? null,
    padState: launch.pad?.state ?? null
  };
}

const fetchBlueOriginMissionGraphicsFromConstraints = cache(
  async (launchId: string): Promise<BlueOriginMissionGraphics | null> => {
    if (!isSupabaseAdminConfigured()) return null;
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from('launch_trajectory_constraints')
      .select('data')
      .eq('launch_id', launchId)
      .eq('source', 'blueorigin_mission_page')
      .eq('constraint_type', 'mission_infographic')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    const payload = data.data as any;
    const missionUrl = normalizeBlueOriginMissionSourceUrl(payload?.missionUrl || payload?.launchPageUrl);
    if (!missionUrl) return null;

    const archiveSnapshotUrl =
      typeof payload?.archiveSnapshotUrl === 'string' && payload.archiveSnapshotUrl.trim()
        ? payload.archiveSnapshotUrl.trim()
        : null;
    const flightCode = typeof payload?.flightCode === 'string' ? payload.flightCode : '';
    const rawGraphics = Array.isArray(payload?.graphics) ? payload.graphics : [];
    const byUrl = new Map<string, BlueOriginMissionGraphic>();

    for (const rawGraphic of rawGraphics) {
      const rawUrl =
        typeof rawGraphic === 'string'
          ? rawGraphic
          : rawGraphic && typeof rawGraphic === 'object' && typeof (rawGraphic as any).url === 'string'
            ? (rawGraphic as any).url
            : null;
      const normalizedUrl = normalizeBlueOriginGraphicAssetUrl(rawUrl);
      if (!normalizedUrl) continue;

      const dedupeKey = normalizeComparableUrl(normalizedUrl) || normalizedUrl;
      if (byUrl.has(dedupeKey)) continue;

      const label =
        rawGraphic &&
        typeof rawGraphic === 'object' &&
        typeof (rawGraphic as any).label === 'string' &&
        (rawGraphic as any).label.trim()
          ? (rawGraphic as any).label.trim()
          : buildBlueOriginMissionGraphicLabel(normalizedUrl, flightCode);

      byUrl.set(dedupeKey, {
        id: `blue-origin-graphic:${dedupeKey}`,
        label,
        url: normalizedUrl
      });
    }

    const graphics = sortBlueOriginMissionGraphics([...byUrl.values()]);
    if (!graphics.length) return null;

    return {
      missionUrl,
      archiveSnapshotUrl,
      graphics
    };
  }
);

const fetchBlueOriginMissionGraphics = cache(
  async (missionUrl: string, flightCode: string): Promise<BlueOriginMissionGraphics | null> => {
    const normalizedMissionUrl = normalizeBlueOriginMissionSourceUrl(missionUrl);
    if (!normalizedMissionUrl) return null;

    const liveMissionHtml = await fetchBlueOriginMissionPageHtml(normalizedMissionUrl);
    let graphics = liveMissionHtml ? extractBlueOriginMissionGraphicsFromHtml(liveMissionHtml, flightCode) : [];
    let archiveSnapshotUrl: string | null = null;

    if (!graphics.length) {
      const snapshot = await fetchWaybackMissionSnapshotHtml(normalizedMissionUrl);
      if (!snapshot) return null;
      archiveSnapshotUrl = snapshot.snapshotUrl;
      graphics = extractBlueOriginMissionGraphicsFromHtml(snapshot.html, flightCode);
    }

    if (!graphics.length) return null;

    return {
      missionUrl: normalizedMissionUrl,
      archiveSnapshotUrl,
      graphics
    };
  }
);

const fetchBlueOriginMissionGraphicsForLaunch = cache(
  async (launchId: string, missionUrl: string | null, flightCode: string): Promise<BlueOriginMissionGraphics | null> => {
    const cached = await fetchBlueOriginMissionGraphicsFromConstraints(launchId);
    if (cached) return cached;
    if (!missionUrl) return null;
    return fetchBlueOriginMissionGraphics(missionUrl, flightCode);
  }
);

const fetchBlueOriginLaunchEnhancementsFromConstraints = cache(
  async (launchId: string): Promise<BlueOriginLaunchEnhancements | null> => {
    if (!isSupabaseAdminConfigured()) return null;

    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from('launch_trajectory_constraints')
      .select('constraint_type, data, fetched_at')
      .eq('launch_id', launchId)
      .eq('source', BLUE_ORIGIN_MULTISOURCE_CONSTRAINT_SOURCE)
      .in('constraint_type', [...BLUE_ORIGIN_MULTISOURCE_CONSTRAINT_TYPES])
      .order('fetched_at', { ascending: false });

    if (error || !Array.isArray(data) || data.length === 0) return null;

    const sourcePagesByUrl = new Map<string, BlueOriginEnhancementSourcePage>();
    const passengersByName = new Map<string, BlueOriginEnhancementPassenger>();
    const payloadsByName = new Map<string, BlueOriginEnhancementPayload>();
    const factsByKey = new Map<string, BlueOriginEnhancementFact>();
    const passengerNoisePattern =
      /\b(?:share on|follow us|subscribe|watch on|press release|media kit|share|facebook|linkedin|reddit|twitter|instagram|youtube|tiktok|club|future|nasa|kennedy|research|institute|laboratory|lab|center|payload|experiment|installation|device|deorbit|program|mission|patch|media|news|timeline|update|updates|gallery|video|watch|subscribe|follow)\b/i;

    for (const row of data as Array<{ constraint_type?: string | null; data?: any; fetched_at?: string | null }>) {
      const constraintType = normalizeOptionalText(row.constraint_type || '');
      if (!constraintType || !BLUE_ORIGIN_MULTISOURCE_CONSTRAINT_TYPE_SET.has(constraintType)) continue;

      const payload = row.data as any;
      const fallbackFetchedAt = normalizeOptionalText(row.fetched_at || '') || null;

      if (constraintType === 'bo_official_sources') {
        // Only include pages that were actually fetched/crawled successfully.
        // Seed URL candidates can be numerous and frequently 404; they belong in audits/debug output, not user-facing UI.
        const sourceCandidates: unknown[] = Array.isArray(payload?.sourcePages) ? payload.sourcePages : [];

        for (const rawSource of sourceCandidates) {
          const sourceObject = rawSource && typeof rawSource === 'object' ? (rawSource as Record<string, unknown>) : null;
          const canonicalUrl = normalizeExternalUrl(sourceObject?.canonicalUrl) || null;
          const title = normalizeOptionalText(
            sourceObject && typeof sourceObject.title === 'string' ? sourceObject.title : null
          );
          const provenanceValue = normalizeOptionalText(
            sourceObject && typeof sourceObject.provenance === 'string' ? sourceObject.provenance : null
          );
          const provenance = provenanceValue === 'live' || provenanceValue === 'wayback' ? provenanceValue : null;
          const archiveSnapshotUrl = normalizeExternalUrl(
            sourceObject && typeof sourceObject.archiveSnapshotUrl === 'string' ? sourceObject.archiveSnapshotUrl : null
          );
          const openUrl =
            // Wayback crawls store the original Blue Origin URL plus an archive snapshot; prefer the snapshot for click-through.
            (provenance === 'wayback' ? archiveSnapshotUrl : null) ||
            normalizeExternalUrl(sourceObject?.url) ||
            canonicalUrl ||
            normalizeExternalUrl(rawSource);
          if (!openUrl) continue;
          const fetchedAt =
            normalizeOptionalText(sourceObject && typeof sourceObject.fetchedAt === 'string' ? sourceObject.fetchedAt : null) ||
            fallbackFetchedAt;

          const dedupeKey = normalizeComparableUrl(canonicalUrl || openUrl) || openUrl;
          const existing = sourcePagesByUrl.get(dedupeKey);
          if (!existing) {
            sourcePagesByUrl.set(dedupeKey, {
              url: openUrl,
              canonicalUrl,
              title: title || null,
              provenance,
              archiveSnapshotUrl: archiveSnapshotUrl || null,
              fetchedAt
            });
            continue;
          }

          if (!existing.canonicalUrl && canonicalUrl) existing.canonicalUrl = canonicalUrl;
          if (!existing.title && title) existing.title = title;
          if (!existing.provenance && provenance) existing.provenance = provenance;
          if (!existing.archiveSnapshotUrl && archiveSnapshotUrl) existing.archiveSnapshotUrl = archiveSnapshotUrl;
          if (!existing.fetchedAt && fetchedAt) existing.fetchedAt = fetchedAt;
        }
      }

      if (constraintType === 'bo_manifest_passengers') {
        const rawPassengers = Array.isArray(payload?.passengers) ? payload.passengers : [];

        for (const rawPassenger of rawPassengers) {
          if (!rawPassenger || typeof rawPassenger !== 'object') continue;
          const passenger = rawPassenger as Record<string, unknown>;
          const name = normalizeOptionalText(typeof passenger.name === 'string' ? passenger.name : '');
          if (!name) continue;
          if (passengerNoisePattern.test(name)) continue;
          if (!isLikelyBlueOriginEnhancementCrewName(name)) continue;
          if (isLikelyBlueOriginEnhancementPayloadName(name)) continue;

          const dedupeKey = name.toLowerCase();
          const role = normalizeOptionalText(typeof passenger.role === 'string' ? passenger.role : null) || null;
          const bioSnippet = normalizeOptionalText(typeof passenger.bioSnippet === 'string' ? passenger.bioSnippet : null) || null;
          const sourceUrl = normalizeExternalUrl(passenger.sourceUrl) || null;

          const existing = passengersByName.get(dedupeKey);
          if (!existing) {
            passengersByName.set(dedupeKey, {
              name,
              role,
              bioSnippet,
              sourceUrl
            });
            continue;
          }

          existing.role = pickRicherText(existing.role, role, ['passenger', 'crew']);
          existing.bioSnippet = pickLongerText(existing.bioSnippet, bioSnippet);
          if (!existing.sourceUrl && sourceUrl) existing.sourceUrl = sourceUrl;
        }
      }

      if (constraintType === 'bo_manifest_payloads') {
        const rawPayloads = Array.isArray(payload?.payloads) ? payload.payloads : [];

        for (const rawPayload of rawPayloads) {
          if (!rawPayload || typeof rawPayload !== 'object') continue;
          const payloadRow = rawPayload as Record<string, unknown>;
          const name = normalizeOptionalText(typeof payloadRow.name === 'string' ? payloadRow.name : '');
          if (!name) continue;

          const dedupeKey = name.toLowerCase();
          const payloadType =
            normalizeOptionalText(typeof payloadRow.payloadType === 'string' ? payloadRow.payloadType : null) || null;
          const agency = normalizeOptionalText(typeof payloadRow.agency === 'string' ? payloadRow.agency : null) || null;
          const description =
            normalizeOptionalText(typeof payloadRow.description === 'string' ? payloadRow.description : null) || null;
          const sourceUrl = normalizeExternalUrl(payloadRow.sourceUrl) || null;

          const existing = payloadsByName.get(dedupeKey);
          if (!existing) {
            payloadsByName.set(dedupeKey, {
              name,
              payloadType,
              agency,
              description,
              sourceUrl
            });
            continue;
          }

          existing.payloadType = pickRicherText(existing.payloadType, payloadType, ['payload', 'unknown', 'tbd']);
          existing.agency = pickRicherText(existing.agency, agency, ['unknown', 'tbd']);
          existing.description = pickLongerText(existing.description, description);
          if (!existing.sourceUrl && sourceUrl) existing.sourceUrl = sourceUrl;
        }
      }

      if (constraintType === 'bo_mission_facts') {
        const rawFacts = Array.isArray(payload?.facts) ? payload.facts : [];

        for (const rawFact of rawFacts) {
          if (!rawFact || typeof rawFact !== 'object') continue;
          const factRow = rawFact as Record<string, unknown>;
          const key = normalizeOptionalText(typeof factRow.key === 'string' ? factRow.key : '');
          const label = normalizeOptionalText(typeof factRow.label === 'string' ? factRow.label : '') || formatMissionFactLabel(key || null);
          const value = normalizeOptionalText(String(factRow.value ?? ''));
          if (!value) continue;

          const unit = normalizeOptionalText(typeof factRow.unit === 'string' ? factRow.unit : null) || null;
          const context = normalizeOptionalText(typeof factRow.context === 'string' ? factRow.context : null) || null;
          const sourceUrl = normalizeExternalUrl(factRow.sourceUrl) || null;
          const dedupeKey = `${(key || label).toLowerCase()}|${value.toLowerCase()}|${(unit || '').toLowerCase()}`;
          const existing = factsByKey.get(dedupeKey);

          if (!existing) {
            factsByKey.set(dedupeKey, {
              key: key || label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
              label,
              value,
              unit,
              context,
              sourceUrl
            });
            continue;
          }

          if (!existing.context && context) existing.context = context;
          if (!existing.sourceUrl && sourceUrl) existing.sourceUrl = sourceUrl;
        }
      }
    }

    const sourcePages = [...sourcePagesByUrl.values()].sort((left, right) => {
      const fetchedDelta = (right.fetchedAt || '').localeCompare(left.fetchedAt || '');
      if (fetchedDelta !== 0) return fetchedDelta;
      const leftTitle = left.title || left.url;
      const rightTitle = right.title || right.url;
      return leftTitle.localeCompare(rightTitle);
    });
    const passengers = [...passengersByName.values()].sort((left, right) => left.name.localeCompare(right.name));
    const payloads = [...payloadsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
    const facts = [...factsByKey.values()].sort((left, right) => {
      const labelDelta = left.label.localeCompare(right.label);
      if (labelDelta !== 0) return labelDelta;
      return left.value.localeCompare(right.value);
    });

    if (!sourcePages.length && !passengers.length && !payloads.length && !facts.length) return null;
    return {
      sourcePages,
      passengers,
      payloads,
      facts
    };
  }
);

async function fetchBlueOriginMissionPageHtml(missionUrl: string) {
  try {
    const response = await fetch(missionUrl, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': BLUE_ORIGIN_MISSION_GRAPHICS_USER_AGENT
      },
      next: { revalidate: 60 * 60 * 12 }
    });
    if (!response.ok) return null;

    const html = await response.text();
    if (!html.trim()) return null;
    return html;
  } catch {
    return null;
  }
}

async function fetchWaybackMissionSnapshotHtml(missionUrl: string) {
  const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(missionUrl)}&output=json&fl=timestamp,original,statuscode,mimetype&filter=statuscode:200&limit=20`;

  try {
    const cdxResponse = await fetch(cdxUrl, {
      headers: {
        accept: 'application/json',
        'user-agent': BLUE_ORIGIN_MISSION_GRAPHICS_USER_AGENT
      },
      next: { revalidate: 60 * 60 * 12 }
    });
    if (!cdxResponse.ok) return null;
    const cdxPayload = (await cdxResponse.json().catch(() => null)) as unknown;
    const latestTimestamp = extractLatestWaybackTimestamp(cdxPayload);
    if (!latestTimestamp) return null;

    const snapshotUrl = `https://web.archive.org/web/${latestTimestamp}id_/${missionUrl}`;
    const snapshotResponse = await fetch(snapshotUrl, {
      headers: { 'user-agent': BLUE_ORIGIN_MISSION_GRAPHICS_USER_AGENT },
      next: { revalidate: 60 * 60 * 12 }
    });
    if (!snapshotResponse.ok) return null;

    const html = await snapshotResponse.text();
    if (!html.trim()) return null;
    return { snapshotUrl, html };
  } catch {
    return null;
  }
}

function extractLatestWaybackTimestamp(payload: unknown) {
  if (!Array.isArray(payload) || payload.length <= 1) return null;

  let latest: string | null = null;
  for (let index = 1; index < payload.length; index += 1) {
    const row = payload[index];
    if (!Array.isArray(row) || row.length < 1) continue;
    const timestamp = String(row[0] || '').trim();
    if (!/^\d{14}$/.test(timestamp)) continue;
    if (!latest || timestamp > latest) latest = timestamp;
  }

  return latest;
}

function extractBlueOriginMissionGraphicsFromHtml(html: string, flightCode: string) {
  const normalizedFlightCode = (flightCode || '').trim().toLowerCase();
  const byUrl = new Map<string, BlueOriginMissionGraphic>();

  const addGraphic = (rawUrl: string) => {
    const normalizedUrl = normalizeBlueOriginGraphicAssetUrl(rawUrl);
    if (!normalizedUrl) return;
    if (!isLikelyBlueOriginMissionGraphic(normalizedUrl, normalizedFlightCode)) return;

    const dedupeKey = normalizeComparableUrl(normalizedUrl) || normalizedUrl;
    if (byUrl.has(dedupeKey)) return;

    byUrl.set(dedupeKey, {
      id: `blue-origin-graphic:${dedupeKey}`,
      label: buildBlueOriginMissionGraphicLabel(normalizedUrl, normalizedFlightCode),
      url: normalizedUrl
    });
  };

  const absoluteAssetPattern = /https:\/\/d1o72l87sylvqg\.cloudfront\.net\/(?:redstone|blue-origin)\/[^"'<)\s]+/gi;
  for (const match of html.matchAll(absoluteAssetPattern)) {
    addGraphic(match[0]);
  }

  const imageCandidatePattern = /(?:url|src)=["']([^"']+\.(?:png|jpe?g|webp|gif|avif|svg)(?:[?#][^"']*)?)["']/gi;
  for (const match of html.matchAll(imageCandidatePattern)) {
    const rawCandidate = String(match[1] || '').trim();
    if (!rawCandidate) continue;
    let normalizedCandidate = rawCandidate;
    try {
      normalizedCandidate = decodeURIComponent(rawCandidate);
    } catch {
      // ignore decode failures
    }
    addGraphic(normalizedCandidate);
  }

  const nextImagePattern = /\/_next\/image\?[^"'>\s]*url=([^&"'>\s]+)/gi;
  for (const match of html.matchAll(nextImagePattern)) {
    const encodedInnerUrl = match[1];
    if (!encodedInnerUrl) continue;
    try {
      const decodedUrl = decodeURIComponent(encodedInnerUrl);
      addGraphic(decodedUrl);
    } catch {
      continue;
    }
  }

  return sortBlueOriginMissionGraphics([...byUrl.values()]);
}

function normalizeBlueOriginGraphicAssetUrl(value: string | null | undefined) {
  const raw = decodeHtmlValue(value || '').replace(/\\+$/g, '').trim();
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== 'd1o72l87sylvqg.cloudfront.net') return null;

  const pathname = decodeURIComponent(parsed.pathname || '').replace(/\/+$/g, '');
  const normalizedPath = pathname.toLowerCase();
  if (!normalizedPath.startsWith('/redstone/') && !normalizedPath.startsWith('/blue-origin/')) return null;
  if (!/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(pathname)) return null;

  return `https://${host}${pathname}`;
}

function isLikelyBlueOriginMissionGraphic(assetUrl: string, flightCode: string) {
  let parsed: URL;
  try {
    parsed = new URL(assetUrl);
  } catch {
    return false;
  }

  const filename = parsed.pathname.split('/').pop() || '';
  const compactName = filename.toLowerCase().replace(/[^a-z0-9]/g, '');
  const compactFlightCode = flightCode.replace(/[^a-z0-9]/g, '');

  if (
    /(webcast|comingsoon|shop|logo|logos|icon|icons|avatar|badge|button|social|instagram|twitter|facebook|youtube|linkedin|careers|header|footer|menu|promo|404|fourohfour)/.test(
      compactName
    )
  ) {
    return false;
  }
  if (/(flightprofile|trajectory|missiontimeline|bythenumbers|boosterrecovery|infographic|missionprofile)/.test(compactName)) {
    return true;
  }
  if (compactFlightCode && compactName.includes(compactFlightCode)) return true;
  return false;
}

function buildBlueOriginMissionGraphicLabel(assetUrl: string, flightCode: string) {
  let filename = '';
  try {
    const parsed = new URL(assetUrl);
    filename = parsed.pathname.split('/').pop() || '';
  } catch {
    filename = assetUrl;
  }

  const withoutExtension = filename.replace(/\.[a-z0-9]+$/i, '');
  const withoutFlightPrefix = withoutExtension
    .replace(/^missions[_-]?[a-z]{2,3}[-_]?\d+[_-]?/i, '')
    .replace(/^(ng|ns)[-_]?\d+[_-]?/i, '')
    .replace(/^missions[_-]?/i, '');

  const normalizedWords = withoutFlightPrefix
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalizedWords) {
    return flightCode ? `${flightCode.toUpperCase()} Mission Graphic` : 'Mission Graphic';
  }
  return toTitleCase(normalizedWords);
}

function sortBlueOriginMissionGraphics(graphics: BlueOriginMissionGraphic[]) {
  const rank = (label: string) => {
    const normalized = label.toLowerCase();
    if (normalized.includes('flight profile')) return 1;
    if (normalized.includes('trajectory')) return 2;
    if (normalized.includes('mission timeline')) return 3;
    if (normalized.includes('by the numbers')) return 4;
    if (normalized.includes('booster recovery')) return 5;
    return 99;
  };

  return [...graphics].sort((left, right) => {
    const rankDelta = rank(left.label) - rank(right.label);
    if (rankDelta !== 0) return rankDelta;
    return left.label.localeCompare(right.label);
  });
}

function toTitleCase(value: string) {
  return value
    .split(' ')
    .map((token) => (token ? token.charAt(0).toUpperCase() + token.slice(1).toLowerCase() : token))
    .join(' ');
}

function decodeHtmlValue(value: string) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function isSpaceXProvider(provider: string | null | undefined) {
  if (typeof provider !== 'string') return false;
  const normalized = provider.trim().toLowerCase();
  if (!normalized || normalized === 'unknown') return false;
  return normalized === 'spacex' || normalized.includes('spacex');
}

function isBlueOriginProvider(provider: string | null | undefined) {
  if (typeof provider !== 'string') return false;
  const normalized = provider.trim().toLowerCase();
  if (!normalized || normalized === 'unknown') return false;
  return normalized === 'blue origin' || normalized.includes('blue origin');
}

function buildBlueOriginMissionSourceCandidates(
  launch: Launch,
  fallbackMissionUrl?: string | null,
  enhancements?: BlueOriginLaunchEnhancements | null
) {
  const flightCode = extractBlueOriginFlightCode(launch);
  const normalizedFlightCode = String(flightCode || '').trim().toLowerCase();
  const enhancementSourceCandidates = (enhancements?.sourcePages || []).map(
    (page) => page.canonicalUrl || page.url
  );
  const generatedCandidates = normalizedFlightCode
    ? [
        `https://www.blueorigin.com/missions/${normalizedFlightCode}`,
        normalizedFlightCode.startsWith('ns-')
          ? `https://www.blueorigin.com/news/new-shepard-${normalizedFlightCode}-mission`
          : null,
        normalizedFlightCode.startsWith('ng-')
          ? `https://www.blueorigin.com/news/new-glenn-${normalizedFlightCode}-mission`
          : null
      ]
    : [];
  const candidates = [
    ...(launch.launchInfoUrls || []).map((item) => item?.url),
    ...(launch.mission?.infoUrls || []).map((item) => item?.url),
    ...enhancementSourceCandidates,
    fallbackMissionUrl || null,
    ...generatedCandidates
  ];
  const normalizedCandidates: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeBlueOriginMissionSourceUrl(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    normalizedCandidates.push(normalized);
  }

  return normalizedCandidates;
}

async function resolveVerifiedBlueOriginMissionSourceUrl(
  launch: Launch,
  fallbackMissionUrl?: string | null,
  enhancements?: BlueOriginLaunchEnhancements | null
) {
  const candidates = buildBlueOriginMissionSourceCandidates(
    launch,
    fallbackMissionUrl,
    enhancements
  );
  for (const candidate of candidates) {
    if (await isLikelyReachableBlueOriginSourceUrl(candidate)) return candidate;
  }
  return null;
}

function normalizeBlueOriginMissionSourceUrl(value: string | null | undefined) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./i, '');
  if (host !== 'blueorigin.com') return null;

  const pathname = normalizeBlueOriginLocalePath(parsed.pathname);
  if (!pathname) return null;

  const isMissionPath =
    pathname.startsWith('/missions/') ||
    pathname.startsWith('/missions/by/') ||
    pathname.startsWith('/news/new-shepard-') ||
    pathname.startsWith('/news/new-glenn-') ||
    /^\/news\/(?:ns|ng)-\d{1,3}\b/.test(pathname);
  if (!isMissionPath) return null;

  return `https://www.blueorigin.com${pathname}`;
}

function normalizeBlueOriginLocalePath(pathname: string) {
  if (typeof pathname !== 'string') return '';
  const trimmed = pathname.trim();
  if (!trimmed) return '';

  const withoutTrailingSlash = trimmed.replace(/\/+$/g, '');
  if (!withoutTrailingSlash) return '';

  const localeAware = withoutTrailingSlash.toLowerCase().replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/, '');
  return localeAware || '/';
}

function getBlueOriginMissionArtifacts(launch: Launch) {
  const flightCode = extractBlueOriginFlightCode(launch);
  if (!flightCode) return null;

  const normalizedCode = flightCode.trim().toLowerCase();
  const curated = BLUE_ORIGIN_MISSION_ARTIFACTS[normalizedCode];
  if (curated) return curated;

  if (normalizedCode.startsWith('ns-')) {
    return {
      missionUrl: `https://www.blueorigin.com/news/new-shepard-${normalizedCode}-mission`
    };
  }

  if (normalizedCode.startsWith('ng-')) {
    return {
      missionUrl: `https://www.blueorigin.com/news/new-glenn-${normalizedCode}-mission`
    };
  }

  return null;
}

type BlueOriginTravelerProfile = {
  name: string;
  travelerSlug: string;
  role: string | null;
  nationality: string | null;
  profileUrl: string | null;
  imageUrl: string | null;
  bio: string | null;
};

function resolveBlueOriginTravelerProfiles(
  launch: Launch,
  rows: Awaited<ReturnType<typeof fetchBlueOriginPassengersDatabaseOnly>>['items']
): BlueOriginTravelerProfile[] {
  const launchId = normalizeLower(launch.id) || '';
  const flightCode = normalizeLower(extractBlueOriginFlightCode(launch));
  const matched = rows
    .filter((row) => matchesBlueOriginLaunchRecord(launchId, flightCode, row.launchId, row.flightCode))
    .filter((row) => isVerifiedBlueOriginPassengerRow(row))
    .filter((row) => !shouldTreatBlueOriginPassengerAsPayload(row));

  const deduped = new Map<string, BlueOriginTravelerProfile>();
  for (const row of matched) {
    const name = (row.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, {
        name,
        travelerSlug: row.travelerSlug || buildBlueOriginTravelerSlug(name),
        role: row.role,
        nationality: row.nationality,
        profileUrl: row.profileUrl || null,
        imageUrl: row.imageUrl || null,
        bio: row.bio || null
      });
      continue;
    }

    const existing = deduped.get(key);
    if (!existing) continue;
    if (!existing.profileUrl && row.profileUrl) existing.profileUrl = row.profileUrl;
    if (!existing.imageUrl && row.imageUrl) existing.imageUrl = row.imageUrl;
    if (!existing.bio && row.bio) existing.bio = row.bio;
    if (!existing.nationality && row.nationality) existing.nationality = row.nationality;
    if (!existing.role && row.role) existing.role = row.role;
    if (!existing.travelerSlug && row.travelerSlug) existing.travelerSlug = row.travelerSlug;
  }

  return [...deduped.values()];
}

function resolveBlueOriginCrewRows(
  launch: Launch,
  rows: Awaited<ReturnType<typeof fetchBlueOriginPassengersDatabaseOnly>>['items']
): NonNullable<Launch['crew']> {
  const launchId = normalizeLower(launch.id) || '';
  const flightCode = normalizeLower(extractBlueOriginFlightCode(launch));
  const matched = rows
    .filter((row) => matchesBlueOriginLaunchRecord(launchId, flightCode, row.launchId, row.flightCode))
    .filter((row) => isVerifiedBlueOriginPassengerRow(row))
    .filter((row) => !shouldTreatBlueOriginPassengerAsPayload(row));

  const normalized: NonNullable<Launch['crew']> = matched.map((row) => ({
    astronaut: row.name,
    role: row.role || 'Crew',
    nationality: row.nationality || undefined
  }));

  return dedupeCrewRows(normalized);
}

function resolveBlueOriginPayloadRows(
  launch: Launch,
  rows: Awaited<ReturnType<typeof fetchBlueOriginPayloads>>['items']
): NonNullable<Launch['payloads']> {
  const launchId = normalizeLower(launch.id) || '';
  const flightCode = normalizeLower(extractBlueOriginFlightCode(launch));
  const matched = rows
    .filter((row) => matchesBlueOriginLaunchRecord(launchId, flightCode, row.launchId, row.flightCode))
    .filter((row) => isVerifiedBlueOriginPayloadRow(row));

  const normalized: NonNullable<Launch['payloads']> = matched.map((row) => ({
    name: row.name,
    type: row.payloadType || undefined,
    orbit: row.orbit || undefined,
    agency: row.agency || undefined
  }));

  return dedupePayloadRows(normalized);
}

function resolveBlueOriginPassengerPayloadRows(
  launch: Launch,
  rows: Awaited<ReturnType<typeof fetchBlueOriginPassengersDatabaseOnly>>['items']
): NonNullable<Launch['payloads']> {
  const launchId = normalizeLower(launch.id) || '';
  const flightCode = normalizeLower(extractBlueOriginFlightCode(launch));
  const matched = rows
    .filter((row) => matchesBlueOriginLaunchRecord(launchId, flightCode, row.launchId, row.flightCode))
    .filter((row) => isVerifiedBlueOriginPassengerRow(row))
    .filter((row) => shouldTreatBlueOriginPassengerAsPayload(row));

  const normalized: NonNullable<Launch['payloads']> = matched.map((row) => ({
    name: row.name,
    type: row.role || 'Payload',
    orbit: undefined,
    agency: undefined
  }));

  return dedupePayloadRows(normalized);
}

function resolveCrewAndDevicePayloadsFromLl2SpacecraftFlights(flights: Ll2SpacecraftFlightRow[]) {
  const crew: NonNullable<Launch['crew']> = [];
  const devicePayloads: NonNullable<Launch['payloads']> = [];
  const avatarByAstronautId = new Map<number, string>();
  const avatarByAstronautName = new Map<string, string>();

  const pushAvatar = (astronautId: number | null, astronautName: string, url: string | null) => {
    const normalized = normalizeImageUrl(url);
    if (!normalized) return;
    if (astronautId != null) avatarByAstronautId.set(astronautId, normalized);
    avatarByAstronautName.set(astronautName.toLowerCase(), normalized);
  };

  const ingestCrewBucket = (bucket: unknown) => {
    if (!Array.isArray(bucket)) return;
    for (const entry of bucket) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as Record<string, any>;
      const role = normalizeBlueOriginTravelerRole(normalizeOptionalText(row?.role?.role ?? row?.role ?? null));
      const astronautObject =
        row?.astronaut && typeof row.astronaut === 'object' ? (row.astronaut as Record<string, any>) : null;
      const astronautName = normalizeOptionalText(astronautObject?.name ?? row?.astronaut ?? null);
      if (!astronautName) continue;

      const astronautIdRaw = astronautObject?.id;
      const astronautId =
        typeof astronautIdRaw === 'number' && Number.isFinite(astronautIdRaw) ? astronautIdRaw : null;

      const nationality = formatLl2Nationality(astronautObject?.nationality);
      const avatarUrl =
        normalizeOptionalText(astronautObject?.image?.thumbnail_url ?? null) ||
        normalizeOptionalText(astronautObject?.image?.thumbnailUrl ?? null) ||
        normalizeOptionalText(astronautObject?.profile_image_thumbnail ?? null) ||
        normalizeOptionalText(astronautObject?.profileImageThumbnail ?? null) ||
        normalizeOptionalText(astronautObject?.image?.image_url ?? null) ||
        normalizeOptionalText(astronautObject?.image?.imageUrl ?? null) ||
        normalizeOptionalText(astronautObject?.profile_image ?? null) ||
        normalizeOptionalText(astronautObject?.profileImage ?? null) ||
        normalizeOptionalText(astronautObject?.image_url ?? null) ||
        normalizeOptionalText(astronautObject?.imageUrl ?? null) ||
        null;
      pushAvatar(astronautId, astronautName, avatarUrl);

      if (shouldTreatLl2CrewMemberAsPayload(astronautName, role)) {
        devicePayloads.push({
          name: astronautName,
          type: role || 'Payload',
          orbit: undefined,
          agency: undefined
        });
        continue;
      }

      crew.push({
        astronaut: astronautName,
        astronaut_id: astronautId,
        role: role || 'Crew',
        nationality: nationality || undefined
      });
    }
  };

  for (const flight of flights) {
    ingestCrewBucket(flight.launch_crew);
    ingestCrewBucket(flight.onboard_crew);
    ingestCrewBucket(flight.landing_crew);
  }

  return {
    crew: dedupeCrewRows(crew),
    devicePayloads: dedupePayloadRows(devicePayloads),
    avatarByAstronautId,
    avatarByAstronautName
  };
}

function resolveBlueOriginTravelerProfilesFromLl2SpacecraftFlights(
  flights: Ll2SpacecraftFlightRow[]
): BlueOriginTravelerProfile[] {
  const deduped = new Map<string, BlueOriginTravelerProfile>();

  const ingestCrewBucket = (bucket: unknown) => {
    if (!Array.isArray(bucket)) return;

    for (const entry of bucket) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as Record<string, any>;
      const role = normalizeBlueOriginTravelerRole(normalizeOptionalText(row?.role?.role ?? row?.role ?? null));
      const astronautObject =
        row?.astronaut && typeof row.astronaut === 'object' ? (row.astronaut as Record<string, any>) : null;
      const name = normalizeOptionalText(astronautObject?.name ?? row?.astronaut ?? null);
      if (!name) continue;
      if (shouldTreatLl2CrewMemberAsPayload(name, role)) continue;

      const key = name.toLowerCase();
      const nationality = formatLl2Nationality(astronautObject?.nationality);
      const profileUrl = normalizeExternalUrl(astronautObject?.wiki) || normalizeExternalUrl(astronautObject?.url) || null;
      const imageUrl =
        normalizeExternalUrl(astronautObject?.image?.thumbnail_url) ||
        normalizeExternalUrl(astronautObject?.image?.thumbnailUrl) ||
        normalizeExternalUrl(astronautObject?.profile_image_thumbnail) ||
        normalizeExternalUrl(astronautObject?.profileImageThumbnail) ||
        normalizeExternalUrl(astronautObject?.image?.image_url) ||
        normalizeExternalUrl(astronautObject?.image?.imageUrl) ||
        normalizeExternalUrl(astronautObject?.profile_image) ||
        normalizeExternalUrl(astronautObject?.profileImage) ||
        null;
      const bio = normalizeOptionalText(astronautObject?.bio ?? null);

      const existing = deduped.get(key);
      if (!existing) {
        deduped.set(key, {
          name,
          travelerSlug: buildBlueOriginTravelerSlug(name),
          role: role || 'Crew',
          nationality: nationality || null,
          profileUrl,
          imageUrl,
          bio
        });
        continue;
      }

      if (!existing.profileUrl && profileUrl) existing.profileUrl = profileUrl;
      if (!existing.imageUrl && imageUrl) existing.imageUrl = imageUrl;
      if (!existing.bio && bio) existing.bio = bio;
      if (!existing.nationality && nationality) existing.nationality = nationality;
      if (!existing.role && role) existing.role = role;
    }
  };

  for (const flight of flights) {
    ingestCrewBucket(flight.launch_crew);
    ingestCrewBucket(flight.onboard_crew);
    ingestCrewBucket(flight.landing_crew);
  }

  return [...deduped.values()];
}

function shouldTreatLl2CrewMemberAsPayload(name: string, role: string | null | undefined) {
  return isBlueOriginNonHumanCrewEntry(name, role);
}

function formatLl2Nationality(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return '';
        const obj = entry as Record<string, unknown>;
        const nationalityNameComposed =
          typeof (obj as any).nationality_name_composed === 'string' ? (obj as any).nationality_name_composed : null;
        const nationalityName =
          typeof (obj as any).nationality_name === 'string' ? (obj as any).nationality_name : null;
        const name = typeof (obj as any).name === 'string' ? (obj as any).name : null;
        return (
          normalizeOptionalText(nationalityNameComposed) ||
          normalizeOptionalText(nationalityName) ||
          normalizeOptionalText(name) ||
          ''
        );
      })
      .filter(Boolean);
    return parts.length ? [...new Set(parts)].join(', ') : null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const nationalityNameComposed =
      typeof (obj as any).nationality_name_composed === 'string' ? (obj as any).nationality_name_composed : null;
    const nationalityName =
      typeof (obj as any).nationality_name === 'string' ? (obj as any).nationality_name : null;
    const name = typeof (obj as any).name === 'string' ? (obj as any).name : null;
    return (
      normalizeOptionalText(nationalityNameComposed) ||
      normalizeOptionalText(nationalityName) ||
      normalizeOptionalText(name) ||
      null
    );
  }
  return null;
}

function deriveBlueOriginSyntheticLaunchPayloadRows(missionSummary: string | null): NonNullable<Launch['payloads']> {
  const summary = normalizeOptionalText(missionSummary);
  if (!summary) return [];

  const lower = summary.toLowerCase();

  const experimentMatch = summary.match(/\b(\d{1,4})\s+experiments?\b/i);
  if (experimentMatch?.[1]) {
    const count = Number(experimentMatch[1] || '');
    if (Number.isFinite(count) && count > 0) {
      return dedupePayloadRows([
        {
          name: `Experiments (${count})`,
          type: 'Experiment',
          orbit: undefined,
          agency: undefined
        }
      ]);
    }
  }

  const payloadCountMatch = summary.match(
    /\b(?:more\s+than\s+|over\s+|around\s+|approximately\s+|roughly\s+)?(\d{1,4})\s+[^.\n]{0,60}?\bpayloads?\b/i
  );
  if (payloadCountMatch?.[1]) {
    const count = Number(payloadCountMatch[1] || '');
    if (Number.isFinite(count) && count > 0) {
      const label = lower.includes('microgravity')
        ? 'Microgravity research payloads'
        : lower.includes('commercial')
          ? 'Commercial payloads'
          : lower.includes('research') || lower.includes('science') || lower.includes('scientific')
            ? 'Research payloads'
            : 'Payloads';
      return dedupePayloadRows([
        {
          name: `${label} (${count})`,
          type: label,
          orbit: undefined,
          agency: undefined
        }
      ]);
    }
  }

  if (lower.includes('blue ring') && lower.includes('payload')) {
    return dedupePayloadRows([
      {
        name: 'Blue Ring prototype payload',
        type: 'Payload',
        orbit: undefined,
        agency: undefined
      }
    ]);
  }

  if (/\bpayloads?\b/i.test(summary)) {
    const label = lower.includes('lunar gravity')
      ? 'Lunar gravity payloads'
      : lower.includes('microgravity') || lower.includes('weightlessness')
        ? 'Microgravity research payloads'
        : lower.includes('commercial') || lower.includes('customer')
          ? 'Commercial payloads'
          : lower.includes('postcard')
            ? 'Postcards payload'
            : lower.includes('payload mission')
              ? 'Mission payload set'
              : 'Mission payloads';
    return dedupePayloadRows([
      {
        name: label,
        type: label,
        orbit: undefined,
        agency: undefined
      }
    ]);
  }

  return [];
}

function filterBlueOriginCrewRows(rows: NonNullable<Launch['crew']>) {
  const filtered = rows.filter((row) => {
    const astronaut = normalizeOptionalText(row.astronaut);
    if (!astronaut) return false;
    if (!isLikelyBlueOriginEnhancementCrewName(astronaut)) return false;
    if (isLikelyBlueOriginEnhancementPayloadName(astronaut)) return false;
    return true;
  }).map((row) => ({
    ...row,
    role: normalizeBlueOriginTravelerRole(normalizeOptionalText(row.role)) || 'Crew'
  }));
  return dedupeCrewRows(filtered);
}

function filterBlueOriginPayloadRows(rows: NonNullable<Launch['payloads']>) {
  const filtered = rows.filter((row) => {
    const name = normalizeOptionalText(row.name);
    if (!name) return false;
    return isLikelyBlueOriginEnhancementPayloadName(name);
  });
  return dedupePayloadRows(filtered);
}

function mergeCrewRows(base: NonNullable<Launch['crew']>, supplement: NonNullable<Launch['crew']>) {
  return dedupeCrewRows([...base, ...supplement]);
}

function mergePayloadRows(base: NonNullable<Launch['payloads']>, supplement: NonNullable<Launch['payloads']>) {
  return dedupePayloadRows([...base, ...supplement]);
}

function buildCrewSignature(rows: NonNullable<Launch['crew']>) {
  return rows
    .map((row) => {
      const astronaut = normalizeOptionalText(row.astronaut) || '';
      const role = normalizeOptionalText(row.role) || '';
      const nationality = normalizeOptionalText(row.nationality) || '';
      return `${astronaut.toLowerCase()}|${role.toLowerCase()}|${nationality.toLowerCase()}`;
    })
    .sort()
    .join('||');
}

function buildPayloadSignature(rows: NonNullable<Launch['payloads']>) {
  return rows
    .map((row) => {
      const name = normalizeOptionalText(row.name) || '';
      const type = normalizeOptionalText(row.type) || '';
      const orbit = normalizeOptionalText(row.orbit) || '';
      const agency = normalizeOptionalText(row.agency) || '';
      return `${name.toLowerCase()}|${type.toLowerCase()}|${orbit.toLowerCase()}|${agency.toLowerCase()}`;
    })
    .sort()
    .join('||');
}

function dedupeCrewRows(rows: NonNullable<Launch['crew']>) {
  const byAstronaut = new Map<string, NonNullable<Launch['crew']>[number]>();

  for (const row of rows) {
    const astronaut = normalizeOptionalText(row.astronaut);
    if (!astronaut) continue;
    const astronautIdRaw = (row as any)?.astronaut_id ?? (row as any)?.astronautId ?? null;
    const astronautId = typeof astronautIdRaw === 'number' && Number.isFinite(astronautIdRaw) ? astronautIdRaw : null;
    const role = normalizeOptionalText(row.role) || undefined;
    const nationality = normalizeOptionalText(row.nationality) || undefined;
    const key = astronaut.toLowerCase();
    const existing = byAstronaut.get(key);

    if (!existing) {
      byAstronaut.set(key, {
        ...row,
        astronaut,
        astronaut_id: astronautId ?? (row as any)?.astronaut_id ?? undefined,
        role,
        nationality
      });
      continue;
    }

    const mergedRole = pickRicherText(existing.role || null, role || null, ['passenger', 'crew']);
    const mergedNationality = pickRicherText(existing.nationality || null, nationality || null, ['unknown', 'n/a']);
    const existingAstronautIdRaw = (existing as any)?.astronaut_id ?? (existing as any)?.astronautId ?? null;
    const existingAstronautId =
      typeof existingAstronautIdRaw === 'number' && Number.isFinite(existingAstronautIdRaw) ? existingAstronautIdRaw : null;
    byAstronaut.set(key, {
      ...existing,
      astronaut,
      astronaut_id: existingAstronautId ?? astronautId ?? (existing as any)?.astronaut_id ?? (row as any)?.astronaut_id ?? undefined,
      role: mergedRole || undefined,
      nationality: mergedNationality || undefined
    });
  }

  return [...byAstronaut.values()];
}

function dedupePayloadRows(rows: NonNullable<Launch['payloads']>) {
  const byName = new Map<string, NonNullable<Launch['payloads']>[number]>();

  for (const row of rows) {
    const name = normalizeOptionalText(row.name);
    if (!name) continue;
    const type = normalizeOptionalText(row.type) || undefined;
    const orbit = normalizeOptionalText(row.orbit) || undefined;
    const agency = normalizeOptionalText(row.agency) || undefined;
    const key = name.toLowerCase();
    const existing = byName.get(key);

    if (!existing) {
      byName.set(key, {
        ...row,
        name,
        type,
        orbit,
        agency
      });
      continue;
    }

    const mergedType = pickRicherText(existing.type || null, type || null, ['payload', 'unknown', 'tbd', 'n/a']);
    const mergedOrbit = pickRicherText(existing.orbit || null, orbit || null, ['unknown', 'tbd', 'n/a']);
    const mergedAgency = pickRicherText(existing.agency || null, agency || null, ['unknown', 'tbd', 'n/a']);

    byName.set(key, {
      ...existing,
      name,
      type: mergedType || undefined,
      orbit: mergedOrbit || undefined,
      agency: mergedAgency || undefined
    });
  }

  return [...byName.values()];
}

function isExcludedBlueOriginManifestSource(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return false;
  return BLUE_ORIGIN_UNVERIFIED_SOURCE_PATTERN.test(normalized.toLowerCase());
}

function isVerifiedBlueOriginPassengerRow(row: {
  name: string;
  source?: string | null;
  confidence?: string | null;
}) {
  const name = normalizeOptionalText(row.name);
  if (!name) return false;
  if (!isLikelyBlueOriginEnhancementCrewName(name)) return false;
  if (isLikelyBlueOriginEnhancementPayloadName(name)) return false;
  if (isExcludedBlueOriginManifestSource(row.source || null)) return false;
  return row.confidence === 'high' || row.confidence === 'medium';
}

function isVerifiedBlueOriginPayloadRow(row: {
  name: string;
  source?: string | null;
  confidence?: string | null;
}) {
  const name = normalizeOptionalText(row.name);
  if (!name) return false;
  if (!isLikelyBlueOriginEnhancementPayloadName(name)) return false;
  if (isExcludedBlueOriginManifestSource(row.source || null)) return false;
  return row.confidence === 'high' || row.confidence === 'medium';
}

function shouldTreatBlueOriginPassengerAsPayload(row: { name: string; role?: string | null }) {
  const role = normalizeOptionalText(row.role || null) || '';
  const name = normalizeOptionalText(row.name || null) || '';
  const normalizedRole = role.toLowerCase();
  const normalizedName = name.toLowerCase();

  if (!normalizedRole && !normalizedName) return false;
  if (/\b(?:anthropomorphic|test\s+device|atd|dummy)\b/i.test(normalizedRole)) return true;
  if (/\bmannequin\b/i.test(normalizedName)) return true;
  return false;
}

function matchesBlueOriginLaunchRecord(
  launchId: string | null,
  flightCode: string | null,
  rowLaunchId: string | null,
  rowFlightCode: string | null
) {
  const normalizedLaunchId = normalizeLower(rowLaunchId);
  if (launchId && normalizedLaunchId && launchId === normalizedLaunchId) return true;

  const normalizedFlightCode = normalizeLower(rowFlightCode);
  if (flightCode && normalizedFlightCode && flightCode === normalizedFlightCode) return true;
  return false;
}

function normalizeLower(value: string | null | undefined) {
  const normalized = (value || '').trim().toLowerCase();
  return normalized || null;
}

function normalizeLl2LaunchUuid(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidPattern.test(normalized) ? normalized : null;
}

function extractXStatusId(url: string | null | undefined) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  const match = raw.match(/status\/(\d+)/i);
  if (match?.[1]) return match[1];
  if (/^\d+$/.test(raw)) return raw;
  return null;
}

function extractXHandleFromUrl(url: string | null | undefined) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  const match = raw.match(/x\.com\/([^/]+)\/status\/\d+/i);
  if (!match?.[1]) return null;
  return match[1].replace(/^@+/, '').trim() || null;
}

function dedupeLaunchCrewNames(launch: Launch) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const row of launch.crew || []) {
    const name = String(row?.astronaut || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(name);
  }
  return output;
}

function truncateMetaDescription(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function dedupeMetaKeywords(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }
  return output.slice(0, 32);
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const parsed = parseLaunchParam(params.id);
  if (!parsed) {
    return {
      title: `Launch not found | ${SITE_META.siteName}`,
      robots: { index: false, follow: false }
    };
  }

  const launch = await fetchLaunch(parsed.launchId);
  if (!launch) {
    return {
      title: `Launch not found | ${SITE_META.siteName}`,
      robots: { index: false, follow: false }
    };
  }

  const crewNames = dedupeLaunchCrewNames(launch).slice(0, 6);
  const blueOriginFlightCode = extractBlueOriginFlightCode(launch)?.toUpperCase() || null;
  const isBlueOriginLaunch =
    /blue\s*origin/i.test(String(launch.provider || '')) || Boolean(blueOriginFlightCode);
  const blueOriginTitleSeo = isBlueOriginLaunch
    ? blueOriginFlightCode
      ? `Blue Origin ${blueOriginFlightCode} New Shepard`
      : 'Blue Origin New Shepard'
    : null;
  const crewSnippet = crewNames.length ? `${crewNames.join(', ')}` : null;
  const title = blueOriginTitleSeo
    ? crewNames.length
      ? `${launch.name} | ${blueOriginTitleSeo} | ${crewNames[0]} | ${SITE_META.siteName}`
      : `${launch.name} | ${blueOriginTitleSeo} | ${SITE_META.siteName}`
    : crewNames.length
      ? `${launch.name} | ${crewNames[0]} | ${SITE_META.siteName}`
      : `${launch.name} | ${SITE_META.siteName}`;
  const descriptionBase = crewSnippet
    ? `${launch.name} mission details with crew manifest (${crewSnippet}), launch window, and countdown from ${launch.pad.shortCode} in ${launch.pad.state}.`
    : `Countdown and launch window for ${launch.name} from ${launch.pad.shortCode} in ${launch.pad.state}.`;
  const blueOriginFlightSeo = blueOriginFlightCode
    ? ` Blue Origin ${blueOriginFlightCode} New Shepard mission coverage with launch details and crew context.`
    : '';
  const description = truncateMetaDescription(`${descriptionBase}${blueOriginFlightSeo}`, 320);
  const canonical = buildLaunchHref(launch);
  const siteUrl = getSiteUrl();
  const pageUrl = `${siteUrl}${canonical}`;
  const ogVersion = getOgImageVersion();
  const versionSegment = buildOgVersionSegment({ baseVersion: ogVersion, cacheGeneratedAt: launch.cacheGeneratedAt });
  const ogImage = `${siteUrl}/launches/${launch.id}/opengraph-image/${versionSegment}/jpeg`;

  return {
    title,
    description,
    keywords: dedupeMetaKeywords([
      launch.name,
      launch.provider,
      launch.vehicle,
      crewSnippet || '',
      ...crewNames.flatMap((name) => [
        name,
        `${name} goes to space`,
        `${name} went to space`,
        `${name} ${launch.name}`,
        isBlueOriginLaunch ? `${name} Blue Origin` : '',
        isBlueOriginLaunch && blueOriginFlightCode ? `${name} ${blueOriginFlightCode}` : ''
      ]),
      isBlueOriginLaunch ? 'Blue Origin crew' : '',
      isBlueOriginLaunch ? 'New Shepard crew' : '',
      blueOriginFlightCode ? `Blue Origin ${blueOriginFlightCode}` : '',
      blueOriginFlightCode ? `New Shepard ${blueOriginFlightCode}` : '',
      blueOriginFlightCode ? `New Shepherd ${blueOriginFlightCode}` : '',
      blueOriginFlightCode ? `${blueOriginFlightCode} flight` : '',
      blueOriginFlightCode ? `Blue Origin ${blueOriginFlightCode} flight` : '',
      blueOriginFlightCode ? `New Shepard flight ${blueOriginFlightCode}` : ''
    ]),
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: pageUrl,
      type: 'website',
      siteName: SITE_META.siteName,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: `${launch.name} launch card`,
          type: 'image/jpeg'
        }
      ]
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [
        {
          url: ogImage,
          alt: `${launch.name} launch card`
        }
      ]
    }
  };
}

export default async function LaunchDetailPage({ params }: { params: { id: string } }) {
  const parsed = parseLaunchParam(params.id);
  if (!parsed) return notFound();

  const viewer = await getViewerTier();
  const launch = viewer.mode === 'live' ? await fetchLiveLaunch(parsed.launchId) : await fetchLaunch(parsed.launchId);
  if (!launch) return notFound();

  const canonicalPath = buildLaunchHref(launch);
  const canonicalId = canonicalPath.split('/').pop();
  if (canonicalId && canonicalId !== parsed.raw) {
    permanentRedirect(canonicalPath);
  }
  const arHref = `${canonicalPath}/ar`;
  const canUseArTrajectory = viewer.capabilities.canUseArTrajectory;
  const canUseChangeLog = viewer.capabilities.canUseChangeLog;
  const canUseEnhancedForecastInsights = viewer.capabilities.canUseEnhancedForecastInsights;

  const isAuthed = viewer.isAuthed;
  const isEasternRange = launch.pad?.state === 'FL';

  const dateOnly = !isCountdownEligible(launch);
  const statusTone = getLaunchStatusTone(launch.status, launch.statusText);
  const statusToneStyles = STATUS_TONE_STYLES[statusTone];
  const mission = launch.mission || {};
  const rocket = launch.rocket || { fullName: launch.vehicle };
  const isArtemis = isArtemisLaunch(launch);
  const isStarship = isStarshipLaunch(launch);
  const isSpaceX = isSpaceXProvider(launch.provider);
  const primarySocialIsX = (launch.socialPrimaryPostPlatform || '').toLowerCase() === 'x';
  const matchedTweetId = String(
    launch.socialPrimaryPostId ||
      launch.spacexXPostId ||
      extractXStatusId(launch.socialPrimaryPostUrl || launch.spacexXPostUrl) ||
      ''
  ).trim();
  const matchedTweetUrl = String(
    launch.socialPrimaryPostUrl ||
      launch.spacexXPostUrl ||
      (matchedTweetId && launch.socialPrimaryPostHandle
        ? `https://x.com/${encodeURIComponent(launch.socialPrimaryPostHandle.replace(/^@+/, ''))}/status/${encodeURIComponent(matchedTweetId)}`
        : matchedTweetId && isSpaceX
          ? `https://x.com/SpaceX/status/${encodeURIComponent(matchedTweetId)}`
          : '')
  ).trim();
  const derivedHandle = extractXHandleFromUrl(matchedTweetUrl);
  const matchedHandle = String(
    launch.socialPrimaryPostHandle || (derivedHandle ? `@${derivedHandle}` : isSpaceX ? '@SpaceX' : '')
  ).trim();
  const showMatchedXPost = (primarySocialIsX || isSpaceX) && Boolean(matchedTweetId || matchedTweetUrl);
  const isBlueOrigin = isBlueOriginProvider(launch.provider);
  const blueOriginArtifactsRaw = isBlueOrigin ? getBlueOriginMissionArtifacts(launch) : null;
  const blueOriginFlightCode = isBlueOrigin ? extractBlueOriginFlightCode(launch) : null;
  const ll2SpacecraftFlightsPromise = fetchLl2SpacecraftFlights(launch.ll2Id);
  const blueOriginEnhancementsPromise = isBlueOrigin
    ? fetchBlueOriginLaunchEnhancementsFromConstraints(launch.id)
    : Promise.resolve(null);
  const [ll2SpacecraftFlights, blueOriginPassengersResponse, blueOriginPayloadsResponse, rawBlueOriginEnhancements] = await Promise.all([
    ll2SpacecraftFlightsPromise,
    isBlueOrigin ? fetchBlueOriginPassengersDatabaseOnly('all') : Promise.resolve(null),
    isBlueOrigin ? fetchBlueOriginPayloads('all') : Promise.resolve(null),
    blueOriginEnhancementsPromise
  ]);
  const blueOriginEnhancements = isBlueOrigin
    ? await sanitizeBlueOriginLaunchEnhancements(rawBlueOriginEnhancements)
    : null;
  const blueOriginMissionSourceUrl = isBlueOrigin
    ? await resolveVerifiedBlueOriginMissionSourceUrl(
        launch,
        blueOriginArtifactsRaw?.missionUrl || null,
        blueOriginEnhancements
      )
    : null;
  const blueOriginEnhancementsWithMissionSource = isBlueOrigin
    ? withBlueOriginMissionSourceFallback(blueOriginEnhancements, blueOriginMissionSourceUrl)
    : blueOriginEnhancements;
  const blueOriginArtifacts = isBlueOrigin
    ? await sanitizeBlueOriginMissionArtifacts(blueOriginArtifactsRaw, blueOriginMissionSourceUrl)
    : null;
  const blueOriginMissionGraphicsPromise =
    isBlueOrigin
      ? fetchBlueOriginMissionGraphicsForLaunch(launch.id, blueOriginMissionSourceUrl, blueOriginFlightCode || '')
      : Promise.resolve(null);
  const ll2SpacecraftCrewBundle = resolveCrewAndDevicePayloadsFromLl2SpacecraftFlights(ll2SpacecraftFlights);
  const blueOriginTravelerProfilesRaw =
    isBlueOrigin && (blueOriginPassengersResponse?.items.length || ll2SpacecraftCrewBundle.crew.length)
      ? blueOriginPassengersResponse?.items.length
        ? resolveBlueOriginTravelerProfiles(launch, blueOriginPassengersResponse.items)
        : resolveBlueOriginTravelerProfilesFromLl2SpacecraftFlights(ll2SpacecraftFlights)
      : [];
  const blueOriginTravelerProfiles = blueOriginTravelerProfilesRaw.length
    ? await sanitizeBlueOriginTravelerProfiles(blueOriginTravelerProfilesRaw)
    : [];
  const blueOriginTravelerImageUrls = [
    ...new Set(blueOriginTravelerProfiles.map((traveler) => traveler.imageUrl).filter(Boolean))
  ] as string[];
  const baseBlueOriginCrew = isBlueOrigin ? filterBlueOriginCrewRows(launch.crew || []) : launch.crew || [];
  const baseBlueOriginPayloads = isBlueOrigin
    ? filterBlueOriginPayloadRows(launch.payloads || [])
    : launch.payloads || [];
  const supplementalBlueOriginCrew = blueOriginPassengersResponse
    ? resolveBlueOriginCrewRows(launch, blueOriginPassengersResponse.items)
    : [];
  const supplementalBlueOriginPayloadsFromDb = blueOriginPayloadsResponse
    ? resolveBlueOriginPayloadRows(launch, blueOriginPayloadsResponse.items)
    : [];
  const supplementalBlueOriginPayloadsFromCrewDevices = blueOriginPassengersResponse
    ? resolveBlueOriginPassengerPayloadRows(launch, blueOriginPassengersResponse.items)
    : [];
  const supplementalBlueOriginPayloads = mergePayloadRows(
    mergePayloadRows(supplementalBlueOriginPayloadsFromDb, supplementalBlueOriginPayloadsFromCrewDevices),
    ll2SpacecraftCrewBundle.devicePayloads
  );
  const blueOriginMissionSummary = resolveBlueOriginEnhancementText(
    getBlueOriginEnhancementFactValue(blueOriginEnhancementsWithMissionSource, BLUE_ORIGIN_MISSION_SUMMARY_FACT_KEY),
    mission.description
  );
  const blueOriginFailureReason = resolveBlueOriginEnhancementText(
    getBlueOriginEnhancementFactValue(blueOriginEnhancementsWithMissionSource, BLUE_ORIGIN_FAILURE_REASON_FACT_KEY),
    launch.failReason
  );

  const mergedCrew = mergeCrewRows(
    baseBlueOriginCrew,
    mergeCrewRows(supplementalBlueOriginCrew, ll2SpacecraftCrewBundle.crew)
  );
  let mergedPayloads = mergePayloadRows(baseBlueOriginPayloads, supplementalBlueOriginPayloads);
  const hasExplicitBlueOriginPayloadRows =
    isBlueOrigin && (baseBlueOriginPayloads.length > 0 || supplementalBlueOriginPayloadsFromDb.length > 0);
  if (isBlueOrigin && !hasExplicitBlueOriginPayloadRows) {
    mergedPayloads = mergePayloadRows(mergedPayloads, deriveBlueOriginSyntheticLaunchPayloadRows(blueOriginMissionSummary));
  }
  const hasCrewAugment = buildCrewSignature(mergedCrew) !== buildCrewSignature(baseBlueOriginCrew);
  const hasPayloadAugment = buildPayloadSignature(mergedPayloads) !== buildPayloadSignature(baseBlueOriginPayloads);
  const launchWithProgramAugments =
    hasCrewAugment || hasPayloadAugment
      ? {
          ...launch,
          crew: mergedCrew,
          payloads: mergedPayloads
        }
      : launch;
  const hasPrograms = Array.isArray(launch.programs) && launch.programs.length > 0;
  const hasCrew = Array.isArray(launchWithProgramAugments.crew) && launchWithProgramAugments.crew.length > 0;
  const hasPayloads = Array.isArray(launchWithProgramAugments.payloads) && launchWithProgramAugments.payloads.length > 0;
  const heroImage = normalizeImageUrl(launch.image?.thumbnail) || normalizeImageUrl(launch.image?.full);
  const photoEntries = buildLaunchPhotoEntries({ launch, rocket });
  const primaryPhoto = photoEntries[0];
  const extraPhotos = photoEntries.slice(1);
  const watchUrl = launch.videoUrl;
  const providerLogoUrl = resolveProviderLogoUrl(launch);
  const providerHref = buildProviderHref(launch.provider);
  const rocketHref = buildRocketHref(launch, rocket.fullName || launch.vehicle);
  const locationHref = buildLocationHref(launch);
  const padCatalogHref =
    launch.ll2PadId != null ? `/catalog/pads/${encodeURIComponent(String(launch.ll2PadId))}` : locationHref;
  const infoLinks = normalizeInfoLinks(launch.launchInfoUrls, mission.infoUrls);
  const vidLinks = normalizeVidLinks(launch.launchVidUrls, mission.vidUrls);
  const watchLinks = buildWatchLinks(watchUrl, vidLinks);
  const primaryWatchLink = watchLinks[0] || null;
  const primaryWatchUrl = primaryWatchLink?.url;
  const requestHeaders = headers();
  const webMapPolicy = resolveWebLaunchMapPolicy({
    userAgent: requestHeaders.get('user-agent'),
    pad: {
      latitude: launch.pad.latitude,
      longitude: launch.pad.longitude,
      label: launch.pad.shortCode || launch.pad.name || launch.name || 'Launch pad'
    },
    fallbackPadMapUrl: launch.pad.mapUrl || null,
    hasGoogleStaticApiKey: Boolean(getGoogleMapsStaticApiKey()),
    hasGoogleWebApiKey: Boolean(getGoogleMapsWebApiKey()),
    hasAppleMapsWebConfig: isAppleMapsWebConfigured()
  });
  const googleMapsWebApiKey = webMapPolicy.faaMapMode === 'google' ? getGoogleMapsWebApiKey() : null;
  const appleMapsAuthorizationToken =
    webMapPolicy.faaMapMode === 'apple' ? getAppleMapsWebAuthorizationTokenForRequest(requestHeaders) : null;
  const faaMapMode: LaunchFaaMapRenderMode =
    webMapPolicy.faaMapMode === 'apple' && !appleMapsAuthorizationToken ? 'fallback' : webMapPolicy.faaMapMode;
  const padMapsHref = webMapPolicy.padMapsHref;
  const googleMapsPadPreviewUrl =
    webMapPolicy.allowGoogleStaticPadPreview
      ? buildPadSatellitePreviewPath({ launchId: launch.id, ll2PadId: launch.ll2PadId })
      : null;
  const externalLinksRaw = buildExternalLinks({
    watch: watchUrl,
    flightclub: launch.flightclubUrl,
    padMap: padMapsHref || undefined,
    padMapLabel: webMapPolicy.padMapsProviderLabel === 'Map provider' ? 'Pad map' : 'Pad satellite map',
    rocketInfo: rocket.infoUrl,
    rocketWiki: rocket.wikiUrl,
    infoLinks,
    vidLinks
  });
  const externalLinks = isBlueOrigin ? await sanitizeBlueOriginExternalLinks(externalLinksRaw) : externalLinksRaw;
  const blueOriginExistingResourceUrls = isBlueOrigin
    ? [
        ...externalLinks.map((link) => link.url),
        blueOriginArtifacts?.missionUrl || '',
        blueOriginArtifacts?.patchProductUrl || '',
        ...blueOriginTravelerProfiles.map((traveler) => traveler.profileUrl || '')
      ].filter((url): url is string => Boolean(url))
    : [];
  const share = buildLaunchShare(launch);
  const timelineRowsPromise = fetchVehicleLaunches(launch.vehicle, rocket.fullName);
  const relatedNewsPromise = fetchRelatedNews(launch.id);
  const relatedEventsPromise = fetchRelatedEvents(launch.id);
  const payloadManifestPromise = fetchPayloadManifest(launch.ll2Id);
  const launchObjectInventoryPromise = fetchLaunchObjectInventory(launch.ll2Id);
  const launchDetailEnrichmentPromise = fetchLaunchDetailEnrichment(launch.id, launch.ll2Id);
  const launchUpdatesPromise = canUseChangeLog ? fetchLaunchUpdates(launch.id) : Promise.resolve([] as LaunchUpdateRow[]);
  const rocketStatsPromise = fetchRocketOutcomeStats(rocket.fullName, launch.vehicle);
  const boosterStatsPromise = isSpaceXProvider(launch.provider)
    ? fetchLaunchBoosterStats(launch.id, launch.ll2Id)
    : Promise.resolve([] as LaunchBoosterStats[]);
  const padTimezone = launch.pad?.timezone || 'America/New_York';
  const launchDetailEnrichment = await launchDetailEnrichmentPromise;
  const timelineEvents = buildLaunchTimelineEvents({
    launch,
    externalContent: launchDetailEnrichment.externalContent,
    timezone: padTimezone
  });

  const privacyPrefs = await getEffectivePrivacyPreferences({ userId: viewer.userId });
  const blockThirdPartyEmbeds = privacyPrefs.blockThirdPartyEmbeds;
  const nowMs = Date.now();
  const netMs = Date.parse(launch.net);
  const arTrajectory = await loadArTrajectorySummary(launch.id);
  const isArEligible = arTrajectory.eligible;
  const showArTrajectoryCard = shouldShowLaunchDetailArTrajectoryCard(arTrajectory, canUseArTrajectory);
  const arTrajectoryAction = getLaunchDetailArTrajectoryAction(arTrajectory, canUseArTrajectory);
  const within14Days =
    !dateOnly &&
    Number.isFinite(netMs) &&
    netMs > nowMs &&
    netMs <= nowMs + 14 * 24 * 60 * 60 * 1000;
  const padCountry = (launch.pad?.countryCode || '').toUpperCase();
  const isUsPad = padCountry === 'USA' || padCountry === 'US';
  const watchEmbed = primaryWatchUrl ? buildLaunchVideoEmbed(primaryWatchUrl) : null;
  const showWatchSection = Boolean(primaryWatchUrl);
  const jepObserver = resolveJepObserverFromHeaders(requestHeaders);
  const ws45LaunchContext = buildWs45LaunchContext(launch);

  const ws45ForecastPromise = canUseEnhancedForecastInsights ? fetchWs45Forecast(launch.id, isEasternRange) : Promise.resolve(null);
  const ws45OperationalPromise =
    canUseEnhancedForecastInsights
      ? fetchWs45LiveWeatherSnapshotForLaunch(ws45LaunchContext, isEasternRange).then((snapshot) =>
          buildWs45OperationalWeather(snapshot, ws45LaunchContext)
        )
      : Promise.resolve(null as Ws45OperationalWeather | null);
  const ws45PlanningPromise =
    canUseEnhancedForecastInsights
      ? fetchWs45PlanningForecastsForLaunch(ws45LaunchContext, isEasternRange)
      : Promise.resolve({
          planning24h: null as Ws45PlanningForecast | null,
          weekly: null as Ws45PlanningForecast | null
        });
  const nwsForecastPromise = fetchNwsForecast(launch.id, isUsPad, within14Days);
  const jepScorePromise = fetchLaunchJepScore(launch.id, { observer: jepObserver, viewerIsAdmin: viewer.isAdmin });
  const faaAirspacePromise = fetchLaunchFaaAirspace({ launchId: launch.id, limit: 6 });
  const faaAirspaceMapPromise = fetchLaunchFaaAirspaceMap({ launchId: launch.id, limit: 8 });
  const refreshVersion = (viewer.mode === 'live' ? launch.lastUpdated : launch.cacheGeneratedAt) ?? null;
  const detailVersionSeed = await buildLaunchDetailVersionSeed({
    launchId: launch.id,
    scope: viewer.mode === 'live' ? 'live' : 'public',
    launchCoreUpdatedAt: refreshVersion,
    ll2LaunchId: launch.ll2Id ?? null
  });

  const siteUrl = getSiteUrl();
  const pageUrl = `${siteUrl}${canonicalPath}`;
  const organizationId = `${siteUrl}#organization`;
  const websiteId = `${siteUrl}#website`;
  const providerName = launch.provider?.trim();
  const normalizedProvider = providerName && providerName.toLowerCase() !== 'unknown' ? providerName : undefined;
  const providerUrl = providerHref ? `${siteUrl}${providerHref}` : undefined;
  const rocketName = (rocket.fullName || launch.vehicle || '').trim();
  const rocketUrl = `${siteUrl}${rocketHref}`;
  const rocketManufacturer = rocket.manufacturer?.trim();
  const locationUrl = `${siteUrl}${locationHref}`;
  const schemaStartDate = (() => {
    const candidate = (launch.windowStart || '').trim() || launch.net;
    if (!candidate) return undefined;
    const parsed = Date.parse(candidate);
    if (!Number.isFinite(parsed)) return undefined;
    const iso = new Date(parsed).toISOString();
    return dateOnly ? iso.slice(0, 10) : iso;
  })();
  const schemaEndDate = (() => {
    if (dateOnly) return undefined;
    const candidate = launch.windowEnd?.trim();
    if (!candidate) return undefined;
    const parsed = Date.parse(candidate);
    if (!Number.isFinite(parsed)) return undefined;
    return new Date(parsed).toISOString();
  })();
  const schemaImage = normalizeImageUrl(launch.image?.full) || normalizeImageUrl(launch.image?.thumbnail) || undefined;
  const schemaDescription =
    (blueOriginMissionSummary || '').trim() ||
    `Countdown and launch window for ${launch.name} from ${launch.pad.name}${launch.pad.state ? ` in ${launch.pad.state}` : ''}.`;
  const schemaModifiedDate = (() => {
    const candidates = [launch.lastUpdated, launch.cacheGeneratedAt].map((value) => value?.trim()).filter(Boolean) as string[];
    for (const candidate of candidates) {
      const parsed = Date.parse(candidate);
      if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    }
    return undefined;
  })();
  const schemaEventStatus =
    launch.status === 'scrubbed'
      ? 'https://schema.org/EventCancelled'
      : launch.status === 'hold'
        ? 'https://schema.org/EventPostponed'
        : 'https://schema.org/EventScheduled';
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Launches', item: `${siteUrl}/#schedule` },
      { '@type': 'ListItem', position: 3, name: launch.name, item: pageUrl }
    ]
  };
  const eventJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    '@id': `${pageUrl}#event`,
    name: launch.name,
    url: pageUrl,
    startDate: schemaStartDate,
    endDate: schemaEndDate,
    eventStatus: schemaEventStatus,
    description: schemaDescription,
    image: schemaImage ? [schemaImage] : undefined,
    location: {
      '@type': 'Place',
      name: launch.pad.name,
      url: locationUrl,
      address: {
        '@type': 'PostalAddress',
        addressLocality: launch.pad.locationName || undefined,
        addressRegion: launch.pad.state || undefined,
        addressCountry: padCountry || undefined
      }
    },
    organizer: normalizedProvider
      ? {
          '@type': 'Organization',
          name: normalizedProvider,
          url: providerUrl
        }
      : undefined,
    about:
      rocketName && rocketName.toLowerCase() !== 'unknown'
        ? {
            '@type': 'Product',
            name: rocketName,
            url: rocketUrl,
            manufacturer: rocketManufacturer ? { '@type': 'Organization', name: rocketManufacturer } : undefined
          }
        : undefined
  };
  const videoJsonLd = (() => {
    if (!primaryWatchUrl) return null;
    const embed = buildLaunchVideoEmbed(primaryWatchUrl);
    const thumbnailUrl = embed?.thumbnailUrl || schemaImage || undefined;
    const uploadDate = (() => {
      if (Number.isFinite(netMs) && netMs <= nowMs) return new Date(netMs).toISOString();
      if (schemaModifiedDate) return schemaModifiedDate;
      return new Date(nowMs).toISOString();
    })();
    return {
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      '@id': `${pageUrl}#video`,
      name: `${launch.name} launch coverage`,
      description: schemaDescription,
      uploadDate,
      thumbnailUrl: thumbnailUrl ? [thumbnailUrl] : undefined,
      embedUrl: embed?.src,
      contentUrl: primaryWatchUrl,
      isLiveBroadcast: Boolean(launch.webcastLive)
    };
  })();
  const webPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': pageUrl,
    url: pageUrl,
    name: `${launch.name} launch details`,
    description: schemaDescription,
    isPartOf: { '@id': websiteId },
    publisher: { '@id': organizationId },
    mainEntity: { '@id': eventJsonLd['@id'] },
    primaryImageOfPage: schemaImage ? { '@type': 'ImageObject', url: schemaImage } : undefined,
    dateModified: schemaModifiedDate || undefined
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 overflow-x-hidden px-4 py-10 md:overflow-x-visible md:px-8">
      <JsonLd data={[breadcrumbJsonLd, webPageJsonLd, eventJsonLd, ...(videoJsonLd ? [videoJsonLd] : [])]} />
      <div className="sticky top-4 z-30">
        <div className="rounded-full border border-stroke bg-[rgba(7,9,19,0.82)] px-3 py-2 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <Link
              href="/#schedule"
              className="btn-secondary flex h-10 w-10 items-center justify-center rounded-full border border-stroke text-text2 hover:border-primary hover:text-primary"
              aria-label="Back to feed"
            >
              <BackArrowIcon className="h-4 w-4" />
            </Link>
            <div className="min-w-0 flex-1 text-center">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text3">
                {dateOnly ? 'Launch window' : 'T- countdown'}
              </div>
              <div className="mt-1 whitespace-nowrap">
                {dateOnly ? (
                  <span className="rounded-full bg-[rgba(234,240,255,0.05)] px-3 py-1 text-xs font-semibold text-text2">Time TBD</span>
                ) : (
                  <Countdown net={launch.net} initialNowMs={nowMs} />
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isArEligible &&
                (canUseArTrajectory ? (
                  <CameraGuideButton
                    href={arHref}
                    launchId={launch.id}
                    className="btn-secondary flex h-10 w-10 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary transition hover:border-primary"
                  >
                    <TrajectoryBadgeIcon className="h-4 w-4" />
                    <span className="sr-only">Open AR trajectory</span>
                  </CameraGuideButton>
                ) : (
                  <PremiumGateButton
                    isAuthed={isAuthed}
                    featureLabel="AR trajectory"
                    ariaLabel="AR trajectory (Premium)"
                    className="btn-secondary flex h-10 w-10 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary transition hover:border-primary"
                  >
                    <TrajectoryBadgeIcon className="h-4 w-4" />
                  </PremiumGateButton>
                ))}
              <AddToCalendarButton
                launch={launch}
                variant="icon"
                showAddBadge
                requiresAuth={!viewer.capabilities.canUseOneOffCalendar}
                isAuthed={isAuthed}
                className="h-10 w-10 rounded-full"
              />
              <LaunchDetailRefreshButton
                tier={viewer.tier}
                launchId={launch.id}
                lastUpdated={refreshVersion}
                initialVersion={detailVersionSeed.version}
                className="h-10 w-10 rounded-full"
              />
              <ShareButton url={share.path} title={share.title} text={share.text} variant="icon" className="h-10 w-10 rounded-full" />
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div>
          <h1 className="text-3xl font-semibold text-text1">{launch.name}</h1>
          <p className="text-sm text-text2">
            {providerHref ? (
              <Link href={providerHref} className="transition hover:text-primary">
                {launch.provider}
              </Link>
            ) : (
              launch.provider
            )}{' '}
            •{' '}
            <Link href={rocketHref} className="transition hover:text-primary">
              {rocket.fullName || launch.vehicle}
            </Link>{' '}
            • {launch.pad.name} ({launch.pad.state})
          </p>
          <LaunchDetailAutoRefresh
            tier={viewer.tier}
            launchId={launch.id}
            lastUpdated={refreshVersion}
            initialVersion={detailVersionSeed.version}
          />
        </div>
      </div>

      {showArTrajectoryCard &&
        (arTrajectoryAction.disabled ? (
          <LaunchDetailArTrajectoryCard
            description={buildLaunchDetailArTrajectoryDescription(arTrajectory, canUseArTrajectory)}
            generatedAt={arTrajectory.generatedAt}
            actionLabel={arTrajectoryAction.label}
            disabled
          />
        ) : canUseArTrajectory ? (
          <CameraGuideButton href={arHref} launchId={launch.id} className="group block">
            <LaunchDetailArTrajectoryCard
              description={buildLaunchDetailArTrajectoryDescription(arTrajectory, canUseArTrajectory)}
              generatedAt={arTrajectory.generatedAt}
              actionLabel={arTrajectoryAction.label}
            />
          </CameraGuideButton>
        ) : (
          <PremiumGateButton
            isAuthed={isAuthed}
            featureLabel="AR trajectory"
            ariaLabel="AR trajectory (Premium)"
            className="group block w-full text-left"
            showLockIcon={false}
            asDiv
          >
            <LaunchDetailArTrajectoryCard
              description={buildLaunchDetailArTrajectoryDescription(arTrajectory, canUseArTrajectory)}
              generatedAt={arTrajectory.generatedAt}
              actionLabel={arTrajectoryAction.label}
            />
          </PremiumGateButton>
        ))}

      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(380px,1fr)]">
        <div className="relative overflow-hidden rounded-2xl border border-stroke bg-surface-1 md:col-span-2">
          {heroImage && (
            <div className="absolute inset-0">
              <img src={heroImage} alt="" className="h-full w-full object-cover opacity-85" />
              <div className="absolute inset-0 bg-[rgba(4,7,16,0.08)]" />
              <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/30 to-[rgba(7,9,19,0.8)]" />
              <div className="absolute inset-y-0 left-0 w-[64%] bg-gradient-to-r from-[rgba(7,9,19,0.54)] via-[rgba(7,9,19,0.18)] to-transparent" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.18),_transparent_60%)]" />
            </div>
          )}
          <div className="relative z-10 flex flex-col gap-4 p-5">
            <div className="max-w-[42rem] rounded-[2rem] border border-white/10 bg-[rgba(7,9,19,0.56)] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl md:p-6">
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs uppercase tracking-[0.1em] text-text3">
                <span className={`rounded-full border px-3 py-1 ${statusToneStyles.badge}`}>{launch.statusText}</span>
                <span className="rounded-full border border-stroke px-3 py-1">{launch.tier.toUpperCase()}</span>
                {launch.webcastLive && <span className="rounded-full border border-success px-3 py-1 text-success">Webcast live</span>}
                {launch.hashtag && <span className="rounded-full border border-stroke px-3 py-1">#{launch.hashtag.replace('#', '')}</span>}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {providerLogoUrl && (
                  providerHref ? (
                    <Link
                      href={providerHref}
                      className="relative flex h-12 w-[min(200px,55vw)] items-center justify-center overflow-hidden rounded-xl border border-stroke bg-black/30 px-4 transition hover:border-primary"
                    >
                      <img
                        src={providerLogoUrl}
                        alt={`${launch.provider} logo`}
                        className="max-h-[84%] w-full object-contain"
                        loading="lazy"
                        decoding="async"
                      />
                    </Link>
                  ) : (
                    <div className="relative flex h-12 w-[min(200px,55vw)] items-center justify-center overflow-hidden rounded-xl border border-stroke bg-black/30 px-4">
                      <img
                        src={providerLogoUrl}
                        alt={`${launch.provider} logo`}
                        className="max-h-[84%] w-full object-contain"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                  )
                )}
                <div>
                  <h2 className="text-2xl font-semibold text-text1">{mission.name || launch.name}</h2>
                  <p className="text-sm text-text2">
                    {providerHref ? (
                      <Link href={providerHref} className="transition hover:text-primary">
                        {launch.provider}
                      </Link>
                    ) : (
                      launch.provider
                    )}{' '}
                    •{' '}
                    <Link href={rocketHref} className="transition hover:text-primary">
                      {rocket.fullName || launch.vehicle}
                    </Link>{' '}
                    • {launch.pad.shortCode}
                  </p>
                </div>
              </div>
              <div className="mt-4 w-full rounded-2xl border border-stroke bg-[rgba(255,255,255,0.06)] p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col items-start gap-2">
                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-text3">
                      Launch window
                    </span>
                    <div className="whitespace-nowrap">
                      <TimeDisplay net={launch.net} netPrecision={launch.netPrecision} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <WatchlistFollows
                      isAuthed={isAuthed}
                      canUseSavedItems={viewer.capabilities.canUseSavedItems}
                      launchId={launch.id}
                      launchName={launch.name}
                      provider={launch.provider}
                      ll2PadId={launch.ll2PadId}
                      padShortCode={launch.pad.shortCode}
                      padLabel={launch.pad.locationName || launch.pad.name || launch.pad.shortCode}
                      ll2RocketConfigId={launch.ll2RocketConfigId}
                      rocketLabel={rocket.fullName || launch.vehicle}
                      launchSiteLabel={launch.pad.locationName || launch.pad.name}
                      state={launch.pad.state}
                    />
                  </div>
                </div>
              </div>
              {blueOriginMissionSummary && <p className="mt-4 max-w-2xl text-sm text-text2">{blueOriginMissionSummary}</p>}
            </div>
            {(launch.holdReason || blueOriginFailureReason || launch.failReason) && (
              <div className="grid gap-2 md:grid-cols-2">
                {launch.holdReason && <Info label="Hold reason" value={launch.holdReason} />}
                {blueOriginFailureReason && <Info label="Failure reason" value={blueOriginFailureReason} />}
                {launch.failReason && !blueOriginFailureReason && (
                  <Info label="Failure reason" value={launch.failReason} />
                )}
              </div>
            )}
          </div>
        </div>
        <section className="rounded-2xl border border-stroke bg-surface-1 p-4 lg:p-5">
          <div className="flex h-full flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.08em] text-text3">Launch vehicle</div>
                <div className="mt-1 text-xl font-semibold text-text1">
                  <Link href={rocketHref} className="transition hover:text-primary">
                    {rocket.fullName || launch.vehicle}
                  </Link>
                </div>
                <p className="mt-1 text-sm text-text3">
                  Vehicle profile, dimensions, and quick hardware context for this mission.
                </p>
              </div>
              <Link
                href={rocketHref}
                className="inline-flex items-center gap-2 rounded-full border border-stroke bg-[rgba(255,255,255,0.03)] px-3 py-1.5 text-xs uppercase tracking-[0.08em] text-text2 transition hover:border-primary hover:text-primary"
              >
                Vehicle data
                <ArrowUpRightIcon className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="flex flex-1 flex-col gap-4 xl:flex-row xl:items-stretch">
              {primaryPhoto?.url ? (
                <div className="xl:w-[44%] xl:min-w-[210px]">
                  <div className="overflow-hidden rounded-2xl border border-stroke bg-black/20">
                    <img
                      src={primaryPhoto.url}
                      alt={`${rocket.fullName || launch.vehicle} photo`}
                      className="h-48 w-full object-cover xl:h-full xl:min-h-[220px]"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <ImageCreditLine
                    credit={primaryPhoto.credit}
                    license={primaryPhoto.license}
                    licenseUrl={primaryPhoto.licenseUrl}
                    singleUse={primaryPhoto.singleUse}
                  />
                </div>
              ) : null}

              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  {rocket.variant && <Info label="Variant" value={rocket.variant} />}
                  {rocket.family && <Info label="Family" value={rocket.family} />}
                  {rocket.lengthM != null && <Info label="Length" value={`${rocket.lengthM} m`} />}
                  {rocket.diameterM != null && <Info label="Diameter" value={`${rocket.diameterM} m`} />}
                  {rocket.reusable !== undefined && <Info label="Reusable" value={rocket.reusable ? 'Yes' : 'No'} />}
                  {rocket.launchMass != null && <Info label="Launch mass" value={`${rocket.launchMass} t`} />}
                </div>

                {extraPhotos.length > 0 && (
                  <div className="rounded-2xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                    <div className="mb-2 text-[11px] uppercase tracking-[0.08em] text-text3">Vehicle gallery</div>
                    <RocketPhotoGallery photos={extraPhotos} launchName={launch.name} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      {timelineEvents.length > 0 && (
        <LaunchMilestoneMapLive events={timelineEvents} launchNetMs={Number.isFinite(netMs) ? netMs : null} />
      )}

      <Suspense fallback={<LoadingPanel label="Loading forecast outlook..." />}>
        <ConsolidatedWeatherSection
          ws45ForecastPromise={ws45ForecastPromise}
          ws45OperationalPromise={ws45OperationalPromise}
          ws45PlanningPromise={ws45PlanningPromise}
          nwsForecastPromise={nwsForecastPromise}
          faaAirspacePromise={faaAirspacePromise}
          faaAirspaceMapPromise={faaAirspaceMapPromise}
          faaMapMode={faaMapMode}
          googleMapsWebApiKey={googleMapsWebApiKey}
          appleMapsAuthorizationToken={appleMapsAuthorizationToken}
          padMapsHref={padMapsHref}
          padMapsLinkLabel={webMapPolicy.padMapsLinkLabel}
          faaMapUnavailableMessage={webMapPolicy.faaUnavailableMessage}
          isEasternRange={isEasternRange}
          isUsPad={isUsPad}
          within14Days={within14Days}
          padTimezone={padTimezone}
          canUseEnhancedForecastInsights={canUseEnhancedForecastInsights}
        />
      </Suspense>

      <Suspense fallback={<LoadingPanel label="Loading visibility score..." />}>
        <LaunchJepScoreSection jepScorePromise={jepScorePromise} padTimezone={padTimezone} />
      </Suspense>

      <Suspense fallback={<LoadingPanel label="Loading stages and recovery..." />}>
        <LaunchStagesAndRecoverySection
          enrichmentPromise={Promise.resolve(launchDetailEnrichment)}
          payloadManifestPromise={payloadManifestPromise}
          launch={launch}
          padTimezone={padTimezone}
        />
      </Suspense>

      <Suspense fallback={<LoadingPanel label="Loading mission resources..." />}>
        <LaunchMissionResourcesSection enrichmentPromise={Promise.resolve(launchDetailEnrichment)} />
      </Suspense>

      {showWatchSection && (
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.1em] text-text3">Watch</div>
              <h2 className="text-xl font-semibold text-text1">Live coverage</h2>
              <p className="text-sm text-text3">Stream links and embedded coverage.</p>
            </div>
            {primaryWatchUrl && (
              <a
                href={primaryWatchUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary rounded-lg px-4 py-2 text-sm"
              >
                Open stream
              </a>
            )}
          </div>

          {primaryWatchUrl && (
            <div className="mt-4">
              {watchEmbed ? (
                <ThirdPartyVideoEmbed
                  src={watchEmbed.src}
                  title={watchEmbed.title}
                  externalUrl={primaryWatchUrl}
                  previewImageUrl={primaryWatchLink?.imageUrl || schemaImage}
                  previewAlt={primaryWatchLink?.label || 'Stream preview'}
                  hostLabel={primaryWatchLink?.host || 'stream'}
                  blocked={blockThirdPartyEmbeds}
                />
              ) : (
                <div className="space-y-3">
                  <a
                    href={primaryWatchUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="group relative block overflow-hidden rounded-xl border border-stroke bg-black/50"
                    style={{ aspectRatio: '16 / 9' }}
                  >
                    {primaryWatchLink?.imageUrl || schemaImage ? (
                      <img
                        src={primaryWatchLink?.imageUrl || schemaImage}
                        alt={primaryWatchLink.label || 'Stream preview'}
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="h-full w-full bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.35),_transparent_70%)]" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                    <div className="absolute bottom-3 left-3 right-3 space-y-1 text-white">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-white/70">
                        {primaryWatchLink?.host || 'Stream'}
                      </div>
                      <div className="text-sm font-semibold">{primaryWatchLink?.label || 'Watch coverage'}</div>
                      <div className="text-[11px] text-white/70">Open stream</div>
                    </div>
                  </a>
                  <div className="rounded-xl border border-dashed border-stroke bg-[rgba(255,255,255,0.02)] p-4 text-sm text-text3">
                    This stream provider can&apos;t be embedded here. Use the stream link instead.
                  </div>
                </div>
              )}
            </div>
          )}

          {watchLinks.length > 1 && (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-[0.08em] text-text3">More watch links</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {watchLinks.slice(1).map((link) => (
                  <a
                    key={link.url}
                    className="group flex h-full flex-col overflow-hidden rounded-xl border border-stroke bg-surface-0 transition hover:border-primary"
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <div className="relative h-28 w-full overflow-hidden bg-black/30">
                      {link.imageUrl ? (
                        <img
                          src={link.imageUrl}
                          alt=""
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="h-full w-full bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.3),_transparent_60%)]" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                      <span className="absolute left-3 top-3 rounded-full border border-white/20 bg-black/40 px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-white">
                        {link.meta}
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text3">
                        <span className="uppercase tracking-[0.08em]">{link.host}</span>
                      </div>
                      <div className="text-sm font-semibold text-text1">{link.label}</div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Suspense fallback={<LoadingPanel label="Loading related events..." />}>
        <RelatedEventsSection relatedEventsPromise={relatedEventsPromise} padTimezone={padTimezone} />
      </Suspense>

      <Suspense fallback={<LoadingPanel label="Loading vehicle timeline..." />}>
        <VehicleTimelineSection
          timelineRowsPromise={timelineRowsPromise}
          launch={launch}
          rocket={rocket}
          rocketHref={rocketHref}
        />
      </Suspense>

      <Suspense fallback={<LoadingPanel label="Loading related news..." />}>
        <RelatedNewsSection relatedNewsPromise={relatedNewsPromise} />
      </Suspense>

      {showMatchedXPost && (
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.1em] text-text3">{launch.provider || 'Provider'}</div>
              <h2 className="text-xl font-semibold text-text1">Launch social post</h2>
              <p className="text-sm text-text3">
                Official {matchedHandle || 'provider'} social post tied to this launch.
              </p>
            </div>
            <a
              href={matchedTweetUrl || 'https://x.com'}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary rounded-lg px-4 py-2 text-sm"
            >
              Open on X
            </a>
          </div>

          {blockThirdPartyEmbeds ? (
            <div className="mt-4 rounded-xl border border-dashed border-stroke bg-[rgba(255,255,255,0.02)] p-4 text-sm text-text3">
              Embedded posts from X are disabled in your Privacy Choices settings.{' '}
              <Link className="text-primary hover:underline" href="/legal/privacy-choices">
                Update preferences
              </Link>{' '}
              or use the link instead.
            </div>
          ) : matchedTweetId ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)]">
              <XTweetEmbed
                tweetId={matchedTweetId}
                tweetUrl={matchedTweetUrl || undefined}
                theme="dark"
                conversation="none"
              />
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-stroke bg-[rgba(255,255,255,0.02)] p-4 text-sm text-text3">
              A source post URL is available, but no status ID could be extracted for embed rendering.
            </div>
          )}
        </div>
      )}

      {isArtemis && (
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.1em] text-text3">Artemis</div>
              <h2 className="text-xl font-semibold text-text1">Updates on X</h2>
              <p className="text-sm text-text3">Latest posts from @NASAArtemis.</p>
            </div>
            <a
              href="https://x.com/NASAArtemis"
              target="_blank"
              rel="noreferrer"
              className="btn-secondary rounded-lg px-4 py-2 text-sm"
            >
              Open on X
            </a>
          </div>

          {blockThirdPartyEmbeds ? (
            <div className="mt-4 rounded-xl border border-dashed border-stroke bg-[rgba(255,255,255,0.02)] p-4 text-sm text-text3">
              Embedded posts from X are disabled in your Privacy Choices settings.{' '}
              <Link className="text-primary hover:underline" href="/legal/privacy-choices">
                Update preferences
              </Link>{' '}
              or use the link instead.
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)]">
              <XTimelineEmbed
                handle="NASAArtemis"
                height={420}
                tweetLimit={3}
                theme="dark"
                chrome="noheader nofooter noborders transparent"
              />
            </div>
          )}
        </div>
      )}

      {isStarship && (
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.1em] text-text3">Starship</div>
              <h2 className="text-xl font-semibold text-text1">Updates on X</h2>
              <p className="text-sm text-text3">Latest posts from @SpaceX.</p>
            </div>
            <a
              href="https://x.com/SpaceX"
              target="_blank"
              rel="noreferrer"
              className="btn-secondary rounded-lg px-4 py-2 text-sm"
            >
              Open on X
            </a>
          </div>

          {blockThirdPartyEmbeds ? (
            <div className="mt-4 rounded-xl border border-dashed border-stroke bg-[rgba(255,255,255,0.02)] p-4 text-sm text-text3">
              Embedded posts from X are disabled in your Privacy Choices settings.{' '}
              <Link className="text-primary hover:underline" href="/legal/privacy-choices">
                Update preferences
              </Link>{' '}
              or use the link instead.
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)]">
              <XTimelineEmbed
                handle="SpaceX"
                height={420}
                tweetLimit={3}
                theme="dark"
                chrome="noheader nofooter noborders transparent"
              />
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4 md:col-span-2">
          <h2 className="text-xl font-semibold text-text1">Launch info</h2>
          <dl className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Info
              label="Provider"
              value={
                providerHref ? (
                  <Link href={providerHref} className="transition hover:text-primary">
                    {launch.provider}
                  </Link>
                ) : (
                  launch.provider
                )
              }
            />
            <Info
              label="Vehicle"
              value={
                <Link href={rocketHref} className="transition hover:text-primary">
                  {rocket.fullName || launch.vehicle}
                </Link>
              }
            />
            <Info
              label="Pad"
              value={
                <Link href={padCatalogHref} className="transition hover:text-primary">
                  {`${launch.pad.name} (${launch.pad.shortCode})`}
                </Link>
              }
            />
            <Info label="State" value={launch.pad.state} />
            <Info
              label={
                <abbr title="No Earlier Than (earliest possible launch time)" className="no-underline">
                  NET
                </abbr>
              }
              value={launch.net}
            />
            {launch.windowStart && <Info label="Window start" value={launch.windowStart} />}
            {launch.windowEnd && <Info label="Window end" value={launch.windowEnd} />}
            {mission.orbit && <Info label="Orbit" value={mission.orbit} />}
            {mission.type && <Info label="Mission type" value={mission.type} />}
            {launch.pad.locationName && (
              <Info
                label="Launch site"
                value={
                  <Link href={padCatalogHref} className="transition hover:text-primary">
                    {launch.pad.locationName}
                  </Link>
                }
              />
            )}
            {rocket.reusable !== undefined && <Info label="Reusable" value={rocket.reusable ? 'Yes' : 'No'} />}
            {rocket.leoCapacity && <Info label="LEO capacity (kg)" value={String(rocket.leoCapacity)} />}
            {rocket.gtoCapacity && <Info label="GTO capacity (kg)" value={String(rocket.gtoCapacity)} />}
          </dl>
          {padMapsHref ? (
            <PadSatellitePreviewCard
              pad={launch.pad}
              mapHref={padMapsHref}
              mapProviderLabel={webMapPolicy.padMapsProviderLabel}
              staticPreviewUrl={googleMapsPadPreviewUrl}
              fallbackMapUrl={launch.pad.mapUrl || null}
            />
          ) : null}
          {(blueOriginMissionSummary || mission.description || mission.name) && (
            <div className="mt-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-sm text-text2">
              <div className="text-xs uppercase tracking-[0.08em] text-text3">{mission.name || 'Mission'}</div>
              {(blueOriginMissionSummary || mission.description) && <p className="text-text1">{blueOriginMissionSummary || mission.description}</p>}
            </div>
          )}
          {(rocket.fullName || rocket.description) && (
            <div className="mt-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-sm text-text2">
              <div className="flex flex-wrap items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.08em] text-text3">Rocket</div>
                  <Link href={rocketHref} className="text-text1 transition hover:text-primary">
                    {rocket.fullName || launch.vehicle}
                  </Link>
                </div>
                {rocket.manufacturer && (
                  <span className="text-xs text-text3">
                    Manufacturer:{' '}
                    <Link
                      href={buildCatalogHref({ entity: 'agencies', q: rocket.manufacturer })}
                      className="transition hover:text-primary"
                    >
                      {rocket.manufacturer}
                    </Link>
                  </span>
                )}
              </div>
              {rocket.description && <p className="mt-2">{rocket.description}</p>}
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-text3">
                {rocket.maidenFlight && <Info label="Maiden flight" value={rocket.maidenFlight} />}
                {rocket.launchMass && <Info label="Launch mass (t)" value={String(rocket.launchMass)} />}
                {rocket.launchCost && <Info label="Launch cost" value={rocket.launchCost} />}
              </div>
              {(rocket.infoUrl || rocket.wikiUrl) && (
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  {rocket.infoUrl && (
                    <a className="text-primary" href={rocket.infoUrl} target="_blank" rel="noreferrer">
                      Vehicle info
                    </a>
                  )}
                  {rocket.wikiUrl && (
                    <a className="text-primary" href={rocket.wikiUrl} target="_blank" rel="noreferrer">
                      Vehicle wiki
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
          {externalLinks.length > 0 && (
            <div className="mt-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-sm text-text2">
              <div className="text-xs uppercase tracking-[0.08em] text-text3">Links & sources</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {externalLinks.map((link) => (
                  <a
                    key={link.url}
                    className="flex min-w-0 flex-col gap-1 rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1 hover:border-primary sm:flex-row sm:items-center sm:justify-between"
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="min-w-0 break-words sm:truncate">{link.label}</span>
                    <span className="text-xs text-text3 sm:shrink-0 sm:text-right">{link.meta}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
          {(launch.providerDescription || launch.providerType || launch.providerCountryCode) && (
            <div className="mt-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-sm text-text2">
              <div className="text-xs uppercase tracking-[0.08em] text-text3">Service provider</div>
              <div className="text-text1">
                {providerHref ? (
                  <Link href={providerHref} className="transition hover:text-primary">
                    {launch.provider}
                  </Link>
                ) : (
                  launch.provider
                )}
              </div>
              {providerHref && (
                <div className="mt-1 text-xs text-text3">
                  <Link href={providerHref} className="transition hover:text-primary">
                    Open provider page
                  </Link>
                </div>
              )}
              {(launch.providerType || launch.providerCountryCode) && (
                <div className="text-xs text-text3">{[launch.providerType, launch.providerCountryCode].filter(Boolean).join(' • ')}</div>
              )}
              {launch.providerDescription && <p className="mt-1 text-text2">{launch.providerDescription}</p>}
            </div>
          )}
          {hasPrograms && (
            <div className="mt-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-sm text-text2">
              <div className="text-xs uppercase tracking-[0.08em] text-text3">Programs</div>
              <ul className="mt-2 space-y-2">
                {launch.programs?.map((p, idx) => (
                  <li key={`${p.id || idx}`} className="rounded-md border border-stroke px-3 py-2">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 break-words text-text1">{p.name}</div>
                      {p.type && <div className="text-xs text-text3 sm:text-right">{p.type}</div>}
                    </div>
                    {p.description && <div className="mt-1 text-xs text-text3">{p.description}</div>}
                    {(p.info_url || p.wiki_url) && (
                      <div className="mt-1 flex flex-wrap gap-3 text-xs">
                        {p.info_url && (
                          <a className="text-primary" href={p.info_url} target="_blank" rel="noreferrer">
                            Program info
                          </a>
                        )}
                        {p.wiki_url && (
                          <a className="text-primary" href={p.wiki_url} target="_blank" rel="noreferrer">
                            Program wiki
                          </a>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hasCrew && (
            <div id="crew" className="mt-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-sm text-text2">
              <div className="text-xs uppercase tracking-[0.08em] text-text3">Crew</div>
              <ul className="mt-1 space-y-1">
                {launchWithProgramAugments.crew?.map((c, idx) => (
                  <li
                    key={`${c.astronaut || idx}`}
                    className="flex flex-col gap-1 rounded-md border border-stroke px-2 py-1 sm:flex-row sm:items-center sm:justify-between"
                  >
                    {(() => {
                      const rawId = (c as any)?.astronaut_id ?? (c as any)?.astronautId ?? (c as any)?.id;
                      const astronautId = typeof rawId === 'number' && Number.isFinite(rawId) ? rawId : null;
                      const name = (c as any)?.astronaut || 'Crew';
                      const avatarUrl =
                        (astronautId != null ? ll2SpacecraftCrewBundle.avatarByAstronautId.get(astronautId) : null) ||
                        (typeof name === 'string' && name.trim()
                          ? ll2SpacecraftCrewBundle.avatarByAstronautName.get(name.trim().toLowerCase()) || null
                          : null);

                      const label = typeof name === 'string' && name.trim() ? name : 'Crew';
                      const nameNode = (() => {
                        if (isBlueOrigin && typeof label === 'string' && label.trim()) {
                          const travelerSlug = buildBlueOriginTravelerSlug(label);
                          return (
                            <Link href={`/blue-origin/travelers/${travelerSlug}`} className="transition hover:text-primary">
                              {label}
                            </Link>
                          );
                        }
                        if (astronautId != null) {
                          return (
                            <Link
                              href={`/catalog/astronauts/${encodeURIComponent(String(astronautId))}`}
                              className="transition hover:text-primary"
                            >
                              {label}
                            </Link>
                          );
                        }
                        if (typeof label === 'string' && label.trim()) {
                          return (
                            <Link
                              href={buildCatalogHref({ entity: 'astronauts', q: label })}
                              className="transition hover:text-primary"
                            >
                              {label}
                            </Link>
                          );
                        }
                        return label;
                      })();

                      return (
                        <div className="flex min-w-0 items-center gap-2 text-text1">
                          {avatarUrl ? (
                            <img
                              src={avatarUrl}
                              alt=""
                              className="h-8 w-8 shrink-0 rounded-md border border-stroke object-cover bg-white/5"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <span className="h-8 w-8 shrink-0 rounded-md border border-stroke bg-surface-2/40" aria-hidden="true" />
                          )}
                          <span className="min-w-0 break-words">{nameNode}</span>
                        </div>
                      );
                    })()}
                    <span className="text-xs text-text3 sm:text-right">{c.role}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Suspense fallback={hasPayloads ? <PayloadSummaryBlock launch={launchWithProgramAugments} /> : null}>
            <PayloadManifestSection
              payloadManifestPromise={payloadManifestPromise}
              launchObjectInventoryPromise={launchObjectInventoryPromise}
              launch={launchWithProgramAugments}
            />
          </Suspense>
          {blueOriginArtifacts ? (
            <div className="mt-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-sm text-text2">
              <div className="text-xs uppercase tracking-[0.08em] text-text3">Blue Origin mission resources</div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                <a className="text-primary" href={blueOriginArtifacts.missionUrl} target="_blank" rel="noreferrer">
                  Official mission page
                </a>
                <Link href="/blue-origin/travelers" className="text-primary hover:text-primary/80">
                  Crew directory
                </Link>
                {blueOriginArtifacts.patchProductUrl ? (
                  <a className="text-primary" href={blueOriginArtifacts.patchProductUrl} target="_blank" rel="noreferrer">
                    Mission patch page
                  </a>
                ) : null}
              </div>
              {blueOriginArtifacts.patchImageUrl ? (
                <a href={blueOriginArtifacts.patchImageUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block">
                  <img
                    src={blueOriginArtifacts.patchImageUrl}
                    alt="Mission patch"
                    className="h-24 w-24 rounded-lg border border-stroke object-contain bg-white/5 p-1"
                    loading="lazy"
                    decoding="async"
                  />
                </a>
              ) : null}
              {blueOriginTravelerImageUrls.length === 1 ? (
                <a href={blueOriginTravelerImageUrls[0]} target="_blank" rel="noreferrer" className="mt-3 inline-block">
                  <img
                    src={blueOriginTravelerImageUrls[0]}
                    alt="Blue Origin crew image"
                    className="h-24 w-24 rounded-lg border border-stroke object-cover bg-white/5"
                    loading="lazy"
                    decoding="async"
                  />
                </a>
              ) : null}
              {blueOriginTravelerProfiles.length ? (
                <div className="mt-3">
                  <div className="text-xs uppercase tracking-[0.08em] text-text3">Crew profiles</div>
                  <ul className="mt-2 space-y-2">
                    {blueOriginTravelerProfiles.map((traveler) => (
                      <li key={`blue-origin-traveler:${traveler.name}`} className="rounded-md border border-stroke p-2">
                        <div className="flex items-center gap-2">
                          {traveler.imageUrl ? (
                            <img
                              src={traveler.imageUrl}
                              alt={traveler.name}
                              className="h-10 w-10 rounded-md border border-stroke object-cover"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : null}
                          <div className="min-w-0">
                            <Link
                              href={`/blue-origin/travelers/${traveler.travelerSlug}`}
                              className="font-semibold text-text1 hover:text-primary"
                            >
                              {traveler.name}
                            </Link>
                            {traveler.profileUrl ? (
                              <a href={traveler.profileUrl} target="_blank" rel="noreferrer" className="mt-0.5 block text-[11px] text-primary hover:text-primary/80">
                                Source profile
                              </a>
                            ) : null}
                            <div className="text-[11px] text-text3">
                              {[traveler.role, traveler.nationality].filter(Boolean).join(' • ') || 'Crew'}
                            </div>
                          </div>
                        </div>
                        {traveler.bio ? <p className="mt-1 text-xs text-text3">{traveler.bio}</p> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          {isBlueOrigin ? (
            <Suspense fallback={<LoadingPanel label="Loading Blue Origin mission graphics..." />}>
              <BlueOriginMissionGraphicsSection
                missionGraphicsPromise={blueOriginMissionGraphicsPromise}
                existingLinkUrls={blueOriginExistingResourceUrls}
              />
            </Suspense>
          ) : null}
          {isBlueOrigin ? (
            <BlueOriginLaunchEnhancementsSection
              enhancements={blueOriginEnhancementsWithMissionSource}
              existingLinkUrls={blueOriginExistingResourceUrls}
            />
          ) : null}
          {!padMapsHref && launch.pad.mapUrl && !webMapPolicy.isSafari && (
            <div className="mt-3 text-sm text-text3">
              <a className="text-primary" href={launch.pad.mapUrl} target="_blank" rel="noreferrer">
                View pad map
              </a>
            </div>
          )}
          {mission.agencies && mission.agencies.length > 0 && (
            <div className="mt-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-sm text-text2">
              <div className="text-xs uppercase tracking-[0.08em] text-text3">Mission agencies</div>
              <ul className="mt-1 space-y-1">
                {mission.agencies.map((agency, idx) => (
                  <li
                    key={agency.id || idx}
                    className="flex flex-col gap-1 rounded-md border border-stroke px-2 py-1 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="min-w-0 break-words text-text1">
                      {agency.id ? (
                        <Link
                          href={`/catalog/agencies/${encodeURIComponent(String(agency.id))}`}
                          className="transition hover:text-primary"
                        >
                          {agency.name}
                        </Link>
                      ) : agency.name ? (
                        <Link
                          href={buildCatalogHref({ entity: 'agencies', q: agency.name })}
                          className="transition hover:text-primary"
                        >
                          {agency.name}
                        </Link>
                      ) : (
                        'Agency'
                      )}
                    </span>
                    <span className="text-xs text-text3 sm:text-right">{agency.type}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <Suspense fallback={<LoadingPanel label="Loading launch updates..." />}>
        <LaunchUpdatesSection
          launchUpdatesPromise={launchUpdatesPromise}
          padTimezone={padTimezone}
          canUseChangeLog={canUseChangeLog}
        />
      </Suspense>

      <Suspense fallback={<LoadingPanel label="Loading launch stats..." />}>
        <LaunchStoryStatsSection
          rocketStatsPromise={rocketStatsPromise}
          boosterStatsPromise={boosterStatsPromise}
          launch={launch}
          rocket={rocket}
          rocketHref={rocketHref}
        />
      </Suspense>
    </div>
  );
}

function PadSatellitePreviewCard({
  pad,
  mapHref,
  mapProviderLabel,
  staticPreviewUrl,
  fallbackMapUrl
}: {
  pad: Launch['pad'];
  mapHref: string;
  mapProviderLabel: string;
  staticPreviewUrl: string | null;
  fallbackMapUrl?: string | null;
}) {
  const coordinateLabel = formatCoordinatePair(pad, 5);
  const locationLabel = [pad.locationName || pad.name, pad.state && pad.state !== 'NA' ? pad.state : null].filter(Boolean).join(' • ');
  const showFallbackMapLink = Boolean(fallbackMapUrl && fallbackMapUrl !== mapHref);
  const providerDisplayLabel = mapProviderLabel === 'Map provider' ? 'the configured map provider' : mapProviderLabel;

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)]">
      <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
        <div>
          <div className="text-xs uppercase tracking-[0.08em] text-text3">Pad satellite view</div>
          <p className="mt-1 text-sm text-text2">Open the launch pad in {providerDisplayLabel} using the pad coordinates.</p>
        </div>
        <a
          className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.08em] text-primary transition hover:border-primary hover:bg-primary/15"
          href={mapHref}
          target="_blank"
          rel="noreferrer"
        >
          {mapProviderLabel === 'Map provider' ? 'Open map' : `Open in ${mapProviderLabel}`}
        </a>
      </div>
      <a
        href={mapHref}
        target="_blank"
        rel="noreferrer"
        className="block border-y border-stroke bg-surface-0 transition hover:opacity-95"
        aria-label={`Open ${pad.name} in ${mapProviderLabel}`}
      >
        <PadSatellitePreviewImage src={staticPreviewUrl} alt={`Satellite view of ${pad.name}`} padName={pad.name} providerLabel={providerDisplayLabel} />
      </a>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-text3">
        <span className="font-medium text-text2">{locationLabel}</span>
        {coordinateLabel ? <span>{coordinateLabel}</span> : null}
        {showFallbackMapLink ? (
          <a className="text-primary hover:text-primary/80" href={fallbackMapUrl || undefined} target="_blank" rel="noreferrer">
            Provider map
          </a>
        ) : null}
      </div>
    </div>
  );
}

function PayloadSummaryBlock({ launch }: { launch: Launch }) {
  const payloads = Array.isArray(launch.payloads) ? launch.payloads : [];
  if (payloads.length === 0) return null;

  return (
    <div id="payloads" className="mt-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-sm text-text2">
      <div className="text-xs uppercase tracking-[0.08em] text-text3">Payloads</div>
      <ul className="mt-1 space-y-1">
        {payloads.map((p, idx) => (
          <li
            key={`${p.name || idx}`}
            className="flex flex-col gap-1 rounded-md border border-stroke px-2 py-1 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0">
              <div className="break-words text-text1">{p.name || 'Payload'}</div>
              {p.type && <div className="text-xs text-text3">{p.type}</div>}
            </div>
            {(p.orbit || p.agency) && (
              <div className="text-left text-xs text-text3 sm:text-right">
                {p.orbit && <div className="break-words">{p.orbit}</div>}
                {p.agency && (
                  <div className="break-words">
                    <Link
                      href={buildCatalogHref({ entity: 'agencies', q: p.agency })}
                      className="transition hover:text-primary"
                    >
                      {p.agency}
                    </Link>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

async function PayloadManifestSection({
  payloadManifestPromise,
  launchObjectInventoryPromise,
  launch
}: {
  payloadManifestPromise: Promise<PayloadManifestEntry[]>;
  launchObjectInventoryPromise: Promise<LaunchObjectInventory | null>;
  launch: Launch;
}) {
  const [manifest, launchObjectInventory] = await Promise.all([payloadManifestPromise, launchObjectInventoryPromise]);
  const resolvedManifest = Array.isArray(manifest) ? manifest : [];
  const payloadObjects = Array.isArray(launchObjectInventory?.satcat_payload_objects)
    ? (launchObjectInventory?.satcat_payload_objects as LaunchInventoryObject[])
    : [];
  const nonPayloadObjects = Array.isArray(launchObjectInventory?.satcat_non_payload_objects)
    ? (launchObjectInventory?.satcat_non_payload_objects as LaunchInventoryObject[])
    : [];
  const totalInventoryObjects = payloadObjects.length + nonPayloadObjects.length;
  const inventoryCatalogState =
    launchObjectInventory?.inventory_status?.catalog_state ?? (totalInventoryObjects > 0 ? 'catalog_available' : null);
  const shouldShowInventoryBlock = shouldShowLaunchInventorySection({
    launchNet: launch.net ?? null,
    launchDesignator: launchObjectInventory?.launch_designator || launch.launchDesignator || null,
    catalogState: inventoryCatalogState,
    totalObjectCount: totalInventoryObjects
  });
  const hasManifest = resolvedManifest.length > 0;
  const hasSummary = Array.isArray(launch.payloads) && launch.payloads.length > 0;

  if (!hasManifest && !shouldShowInventoryBlock) {
    if (hasSummary) return <PayloadSummaryBlock launch={launch} />;
    return (
      <div id="payloads" className="mt-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-sm text-text2">
        <div className="text-xs uppercase tracking-[0.08em] text-text3">Payloads</div>
        <div className="mt-1 text-xs text-text3">
          No payload manifest data found for this launch yet.
          {launch.launchDesignator ? ` (Designator: ${launch.launchDesignator})` : ''}
        </div>
      </div>
    );
  }

  const number = new Intl.NumberFormat('en-US');

  return (
    <>
      {hasManifest ? (
        <div id="payloads" className="mt-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-sm text-text2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-[0.08em] text-text3">Payload manifest</div>
        <div className="text-xs text-text3">
          {resolvedManifest.length} item{resolvedManifest.length === 1 ? '' : 's'}
        </div>
      </div>

      <div className="mt-2 space-y-2">
        {resolvedManifest.map((entry) => {
          const kind = entry?.kind === 'spacecraft_flight' ? 'spacecraft_flight' : 'payload_flight';
          const payload = entry.payload || null;
          const payloadName = payload?.name || 'Payload';
          const payloadType = payload?.type?.name || null;
          const destination = entry.destination || null;
          const amount = typeof entry.amount === 'number' ? entry.amount : null;
          const manufacturer = payload?.manufacturer || null;
          const operator = payload?.operator || null;
          const agency = operator || manufacturer;
          const agencyName = agency?.name || null;
          const agencyHref =
            agency?.id != null
              ? `/catalog/agencies/${encodeURIComponent(String(agency.id))}`
              : agencyName
                ? buildCatalogHref({ entity: 'agencies', q: agencyName })
                : null;

          const imageUrl = normalizeImageUrl(payload?.image?.thumbnail_url || payload?.image?.image_url || null) || null;
          const infoLink = payload?.info_link || null;
          const wikiLink = payload?.wiki_link || null;

          const landing = entry.landing || null;
          const dockingEvents = Array.isArray(entry.docking_events) ? entry.docking_events : [];

          const landingName =
            landing?.landing_location && typeof landing.landing_location === 'object'
              ? ((landing.landing_location as any).name || (landing.landing_location as any).abbrev || null)
              : null;

          const landingStatus =
            landing?.attempt === true
              ? landing.success === true
                ? 'Successful landing'
                : landing.success === false
                  ? 'Failed landing'
                  : 'Landing attempted'
              : landing?.attempt === false
                ? 'No landing attempt'
                : null;

          return (
            <details key={entry.id} className="rounded-md border border-stroke bg-black/20 px-3 py-2" open={resolvedManifest.length === 1}>
              <summary className="cursor-pointer select-none list-none">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="break-words text-text1">{payloadName}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-text3">
                      {payloadType && <span>{payloadType}</span>}
                      {destination && <span>→ {destination}</span>}
                      {kind === 'spacecraft_flight' && <span>Spacecraft</span>}
                      {amount != null && <span>×{amount}</span>}
                    </div>
                  </div>
                  {agencyName && (
                    <div className="text-left text-xs text-text3 sm:text-right">
                      {agencyHref ? (
                        <Link href={agencyHref} className="transition hover:text-primary">
                          {agencyName}
                        </Link>
                      ) : (
                        agencyName
                      )}
                    </div>
                  )}
                </div>
              </summary>

              <div className="mt-3 grid gap-3 md:grid-cols-[96px,1fr]">
                {imageUrl && (
                  <div className="overflow-hidden rounded-md border border-stroke bg-black/30">
                    <img src={imageUrl} alt={payloadName} className="h-24 w-full object-cover" loading="lazy" decoding="async" />
                  </div>
                )}
                <div className="min-w-0 space-y-2">
                  {payload?.description && <div className="text-xs text-text2">{payload.description}</div>}

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text3">
                    {typeof payload?.mass_kg === 'number' && Number.isFinite(payload.mass_kg) && (
                      <div>Mass: {number.format(payload.mass_kg)} kg</div>
                    )}
                    {typeof payload?.cost_usd === 'number' && Number.isFinite(payload.cost_usd) && (
                      <div>Cost: ${number.format(payload.cost_usd)}</div>
                    )}
                    {entry.deployment_status && (
                      <div>
                        Deployment:{' '}
                        {entry.deployment_status === 'confirmed'
                          ? 'Confirmed'
                          : entry.deployment_status === 'unconfirmed'
                            ? 'Unconfirmed'
                            : 'Unknown'}
                      </div>
                    )}
                    {landingStatus && (
                      <div>
                        {landingStatus}
                        {landingName ? ` (${landingName})` : ''}
                      </div>
                    )}
                  </div>

                  {entry.deployment_notes && <div className="text-[11px] text-text3">Deployment notes: {entry.deployment_notes}</div>}

                  {(infoLink || wikiLink || entry.url) && (
                    <div className="flex flex-wrap gap-2 text-xs">
                      {entry.url && (
                        <a className="text-primary hover:underline" href={entry.url} target="_blank" rel="noreferrer">
                          {kind === 'spacecraft_flight' ? 'LL2 spacecraft flight' : 'LL2 payload flight'}
                        </a>
                      )}
                      {infoLink && (
                        <a className="text-primary hover:underline" href={infoLink} target="_blank" rel="noreferrer">
                          Info
                        </a>
                      )}
                      {wikiLink && (
                        <a className="text-primary hover:underline" href={wikiLink} target="_blank" rel="noreferrer">
                          Wikipedia
                        </a>
                      )}
                    </div>
                  )}

                  {payload?.image?.credit && (
                    <div className="text-[11px] text-text3">
                      Image credit: {payload.image.credit}
                      {payload.image.license_name ? ` (${payload.image.license_name})` : ''}
                      {payload.image.license_url ? (
                        <>
                          {' '}
                          <a className="text-primary hover:underline" href={payload.image.license_url} target="_blank" rel="noreferrer">
                            License
                          </a>
                        </>
                      ) : null}
                    </div>
                  )}

                  {dockingEvents.length > 0 && (
                    <div className="rounded-md border border-stroke bg-[rgba(255,255,255,0.02)] p-2 text-xs text-text3">
                      <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Docking events</div>
                      <ul className="mt-1 space-y-1">
                        {dockingEvents.map((de, idx) => {
                          const station =
                            de?.space_station_target && typeof de.space_station_target === 'object' ? de.space_station_target : null;
                          const stationName = station?.name || null;
                          const docking = typeof de?.docking === 'string' ? de.docking : null;
                          const departure = typeof de?.departure === 'string' ? de.departure : null;
                          return (
                            <li key={de?.id ?? idx} className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                              <span className="min-w-0 break-words text-text2">
                                {stationName ? `Docking @ ${stationName}` : 'Docking'}
                              </span>
                              <span className="text-[11px] text-text3">
                                {docking ? `Docking: ${docking}` : ''}
                                {departure ? ` • Departure: ${departure}` : ''}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </div>
      ) : (
        <PayloadSummaryBlock launch={launch} />
      )}

      {shouldShowInventoryBlock ? (
        <LaunchObjectInventoryBlock inventory={launchObjectInventory} launchDesignatorFallback={launch.launchDesignator || null} />
      ) : null}
    </>
  );
}

function LaunchObjectInventoryBlock({
  inventory,
  launchDesignatorFallback
}: {
  inventory: LaunchObjectInventory | null;
  launchDesignatorFallback: string | null;
}) {
  const payloadObjects = Array.isArray(inventory?.satcat_payload_objects)
    ? (inventory?.satcat_payload_objects as LaunchInventoryObject[])
    : [];
  const nonPayloadObjects = Array.isArray(inventory?.satcat_non_payload_objects)
    ? (inventory?.satcat_non_payload_objects as LaunchInventoryObject[])
    : [];
  const totalObjects = payloadObjects.length + nonPayloadObjects.length;
  const designator = inventory?.launch_designator || launchDesignatorFallback || null;
  const reconciliation = inventory?.reconciliation || null;
  const status = inventory?.inventory_status || null;
  const state = status?.catalog_state || (totalObjects > 0 ? 'catalog_available' : null);
  const ll2ManifestCount =
    typeof reconciliation?.ll2_manifest_payload_count === 'number' ? reconciliation.ll2_manifest_payload_count : null;
  const satcatPayloadCount =
    typeof reconciliation?.satcat_payload_count === 'number' ? reconciliation.satcat_payload_count : payloadObjects.length;
  const delta =
    typeof reconciliation?.delta_manifest_vs_satcat_payload === 'number' ? reconciliation.delta_manifest_vs_satcat_payload : null;
  const rbCount = typeof reconciliation?.satcat_type_counts?.RB === 'number' ? reconciliation.satcat_type_counts.RB : null;
  const debCount = typeof reconciliation?.satcat_type_counts?.DEB === 'number' ? reconciliation.satcat_type_counts.DEB : null;
  const unkCount = typeof reconciliation?.satcat_type_counts?.UNK === 'number' ? reconciliation.satcat_type_counts.UNK : null;
  const showInventoryCounts = shouldShowLaunchInventoryCounts({
    catalogState: state,
    totalObjectCount: totalObjects
  });
  const shouldShowReconciliation = showInventoryCounts;
  const latestHistoryCapturedAt =
    Array.isArray(inventory?.history) && inventory.history[0]?.captured_at ? inventory.history[0].captured_at : null;
  const statusMessage = buildLaunchInventoryStatusMessage({
    launchDesignator: designator,
    catalogState: state,
    totalObjectCount: totalObjects
  });

  return (
    <div className="mt-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-sm text-text2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-[0.08em] text-text3">Objects from this launch</div>
        {showInventoryCounts ? (
          <div className="text-xs text-text3">
            {totalObjects} object{totalObjects === 1 ? '' : 's'}
          </div>
        ) : null}
      </div>
      <div className="mt-1 text-xs text-text3">SATCAT inventory{designator ? ` for ${designator}` : ''}</div>

      {statusMessage ? <div className="mt-2 text-xs text-text3">{statusMessage}</div> : null}
      {status?.last_checked_at ? <div className="mt-1 text-[11px] text-text3">Last checked: {status.last_checked_at}</div> : null}
      {status?.last_success_at ? <div className="mt-1 text-[11px] text-text3">Last success: {status.last_success_at}</div> : null}
      {status?.last_non_empty_at ? <div className="mt-1 text-[11px] text-text3">Last non-empty: {status.last_non_empty_at}</div> : null}
      {latestHistoryCapturedAt ? <div className="mt-1 text-[11px] text-text3">Latest snapshot: {latestHistoryCapturedAt}</div> : null}
      {status?.latest_snapshot_hash ? (
        <div className="mt-1 text-[11px] text-text3">
          Snapshot hash: <code className="rounded bg-black/30 px-1 py-0.5 text-[10px]">{status.latest_snapshot_hash}</code>
        </div>
      ) : null}
      {state === 'error' && status?.last_error ? <div className="mt-1 text-[11px] text-danger">Error: {status.last_error}</div> : null}

      {shouldShowReconciliation &&
      (ll2ManifestCount != null ||
        satcatPayloadCount != null ||
        (delta != null && delta !== 0) ||
        (rbCount != null && rbCount > 0) ||
        (debCount != null && debCount > 0) ||
        (unkCount != null && unkCount > 0)) ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text3">
          {ll2ManifestCount != null ? <span>LL2 payloads: {ll2ManifestCount}</span> : null}
          {satcatPayloadCount != null ? <span>SATCAT payloads: {satcatPayloadCount}</span> : null}
          {delta != null && delta !== 0 ? <span>Delta: {delta > 0 ? `+${delta}` : delta}</span> : null}
          {rbCount != null && rbCount > 0 ? <span>RB: {rbCount}</span> : null}
          {debCount != null && debCount > 0 ? <span>DEB: {debCount}</span> : null}
          {unkCount != null && unkCount > 0 ? <span>UNK: {unkCount}</span> : null}
        </div>
      ) : null}

      {payloadObjects.length > 0 ? (
        <>
          <div className="mt-3 text-[11px] uppercase tracking-[0.08em] text-text3">SATCAT payload objects</div>
          <LaunchObjectList objects={payloadObjects} />
        </>
      ) : null}

      {nonPayloadObjects.length > 0 ? (
        <>
          <div className="mt-3 text-[11px] uppercase tracking-[0.08em] text-text3">SATCAT non-payload objects</div>
          <LaunchObjectList objects={nonPayloadObjects} />
        </>
      ) : null}
    </div>
  );
}

function LaunchObjectList({ objects }: { objects: LaunchInventoryObject[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {objects.map((obj, idx) => {
        const ownerCode = typeof obj.owner === 'string' ? obj.owner.trim() : '';
        const ownerLabel = ownerCode ? (formatSatelliteOwnerLabel(ownerCode) || ownerCode) : null;
        const ownerHref = ownerCode ? buildSatelliteOwnerHref(ownerCode) : null;
        const objectId = obj.object_id || obj.intl_des || null;
        const key = objectId || (obj.norad_cat_id != null ? `norad-${obj.norad_cat_id}` : `obj-${idx}`);
        const orbit = obj.orbit || null;
        const norad =
          typeof obj.norad_cat_id === 'number' && Number.isFinite(obj.norad_cat_id) && obj.norad_cat_id > 0
            ? Math.trunc(obj.norad_cat_id)
            : null;
        const satelliteHref = norad != null ? buildSatelliteHref(norad) : null;
        const hasTechnicalDetails = Boolean(
          obj.launch_date ||
            obj.launch_site ||
            obj.decay_date ||
            obj.period_min != null ||
            obj.rcs_m2 != null ||
            obj.ops_status_code ||
            obj.data_status_code ||
            obj.orbit_center ||
            obj.orbit_type ||
            orbit?.epoch ||
            orbit?.source ||
            orbit?.fetched_at
        );

        return (
          <li
            key={key}
            className="flex flex-col gap-1 rounded-md border border-stroke px-2 py-1 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0">
              <div className="break-words text-text1">{obj.name || 'Object'}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-text3">
                {objectId ? <span className="break-words">{objectId}</span> : null}
                {norad != null ? (
                  <span className="break-words">
                    NORAD{' '}
                    {satelliteHref ? (
                      <Link href={satelliteHref} className="text-primary hover:underline">
                        {norad}
                      </Link>
                    ) : (
                      norad
                    )}
                  </span>
                ) : null}
                {obj.object_type ? <span>{obj.object_type}</span> : null}
                {ownerLabel ? (
                  <span className="break-words">
                    {ownerHref ? (
                      <Link href={ownerHref} className="text-primary hover:underline">
                        {ownerLabel}
                      </Link>
                    ) : (
                      ownerLabel
                    )}
                  </span>
                ) : null}
                {obj.ops_status_code ? <span>Ops: {obj.ops_status_code}</span> : null}
                {obj.data_status_code ? <span>Data: {obj.data_status_code}</span> : null}
              </div>

              {hasTechnicalDetails ? (
                <details className="mt-1 text-xs text-text3">
                  <summary className="cursor-pointer select-none">Technical details</summary>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {obj.orbit_type ? <span>Orbit type: {obj.orbit_type}</span> : null}
                    {obj.orbit_center ? <span>Orbit center: {obj.orbit_center}</span> : null}
                    {obj.launch_date ? <span>Launch date: {obj.launch_date}</span> : null}
                    {obj.launch_site ? <span>Launch site: {obj.launch_site}</span> : null}
                    {obj.decay_date ? <span>Decay date: {obj.decay_date}</span> : null}
                    {typeof obj.period_min === 'number' && Number.isFinite(obj.period_min) ? (
                      <span>Period: {obj.period_min.toFixed(2)} min</span>
                    ) : null}
                    {typeof obj.rcs_m2 === 'number' && Number.isFinite(obj.rcs_m2) ? (
                      <span>RCS: {obj.rcs_m2.toFixed(3)} m²</span>
                    ) : null}
                    {orbit?.source ? <span>Orbit source: {orbit.source}</span> : null}
                    {orbit?.epoch ? <span>Epoch: {orbit.epoch}</span> : null}
                    {orbit?.fetched_at ? <span>Orbit fetched: {orbit.fetched_at}</span> : null}
                  </div>
                </details>
              ) : null}
            </div>

            {(obj.apogee_km != null || obj.perigee_km != null || obj.inclination_deg != null || orbit?.epoch) && (
              <div className="text-xs text-text3 sm:text-right">
                {typeof obj.inclination_deg === 'number' && Number.isFinite(obj.inclination_deg) ? (
                  <div>Inc: {obj.inclination_deg.toFixed(1)}°</div>
                ) : null}
                {typeof obj.perigee_km === 'number' || typeof obj.apogee_km === 'number' ? (
                  <div>
                    {typeof obj.perigee_km === 'number' && Number.isFinite(obj.perigee_km) ? `${Math.round(obj.perigee_km)} km` : '?'} →{' '}
                    {typeof obj.apogee_km === 'number' && Number.isFinite(obj.apogee_km) ? `${Math.round(obj.apogee_km)} km` : '?'}
                  </div>
                ) : null}
                {orbit?.epoch ? <div>Epoch: {orbit.epoch}</div> : null}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

async function ConsolidatedWeatherSection({
  ws45ForecastPromise,
  ws45OperationalPromise,
  ws45PlanningPromise,
  nwsForecastPromise,
  faaAirspacePromise,
  faaAirspaceMapPromise,
  faaMapMode,
  googleMapsWebApiKey,
  appleMapsAuthorizationToken,
  padMapsHref,
  padMapsLinkLabel,
  faaMapUnavailableMessage,
  isEasternRange,
  isUsPad,
  within14Days,
  padTimezone,
  canUseEnhancedForecastInsights
}: {
  ws45ForecastPromise: Promise<Ws45Forecast | null>;
  ws45OperationalPromise: Promise<Ws45OperationalWeather | null>;
  ws45PlanningPromise: Promise<{ planning24h: Ws45PlanningForecast | null; weekly: Ws45PlanningForecast | null }>;
  nwsForecastPromise: Promise<NwsLaunchWeather | null>;
  faaAirspacePromise: ReturnType<typeof fetchLaunchFaaAirspace>;
  faaAirspaceMapPromise: ReturnType<typeof fetchLaunchFaaAirspaceMap>;
  faaMapMode: LaunchFaaMapRenderMode;
  googleMapsWebApiKey: string | null;
  appleMapsAuthorizationToken: string | null;
  padMapsHref: string | null;
  padMapsLinkLabel: string;
  faaMapUnavailableMessage: string;
  isEasternRange: boolean;
  isUsPad: boolean;
  within14Days: boolean;
  padTimezone: string;
  canUseEnhancedForecastInsights: boolean;
}) {
  const ws45Eligible = isEasternRange && canUseEnhancedForecastInsights;
  const showNws = isUsPad && within14Days;
  const [ws45Forecast, ws45Operational, ws45Planning, nwsForecast, faaAirspace, faaAirspaceMap] = await Promise.all([
    ws45ForecastPromise,
    ws45OperationalPromise,
    ws45PlanningPromise,
    nwsForecastPromise,
    faaAirspacePromise,
    faaAirspaceMapPromise
  ]);
  const showWs45 = ws45Eligible && Boolean(ws45Forecast);
  const showOperational = ws45Eligible && Boolean(ws45Operational);
  const showPlanning24h = ws45Eligible && Boolean(ws45Planning.planning24h);
  const showWeekly = ws45Eligible && Boolean(ws45Planning.weekly);
  const hasForecastPanels = showWs45 || showNws || showOperational || showPlanning24h || showWeekly;
  const advisories = faaAirspace?.advisories ?? [];
  const hasAdvisories = advisories.length > 0;
  if (!hasForecastPanels && !hasAdvisories) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-stroke bg-surface-1">
      <div className="p-4">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Weather</div>
          <h2 className="mt-1 text-xl font-semibold text-text1">Forecast outlook</h2>
          <p className="mt-1 max-w-2xl text-xs text-text3">
            {buildForecastOutlookDescription({
              showWs45,
              showOperational,
              showPlanning24h,
              showWeekly,
              showNws,
              advisoryCount: advisories.length
            })}
          </p>
        </div>
      </div>

      <div className="border-t border-stroke/70 px-4 pb-4 pt-4">
        {hasForecastPanels ? (
          <div className="flex flex-col gap-3">
            {showOperational && (
              <Ws45OperationalPanel
                operational={ws45Operational}
                padTimezone={padTimezone}
                className="rounded-xl border border-stroke bg-black/20 p-4"
              />
            )}
            {showWs45 && (
              <Ws45ForecastPanel
                forecast={ws45Forecast}
                padTimezone={padTimezone}
                className="rounded-xl border border-stroke bg-black/20 p-4"
              />
            )}
            {showNws && (
              <NwsForecastPanel
                forecast={nwsForecast}
                padTimezone={padTimezone}
                className="rounded-xl border border-stroke bg-black/20 p-4"
              />
            )}
            {showPlanning24h && (
              <Ws45PlanningForecastPanel
                forecast={ws45Planning.planning24h}
                kind="planning_24h"
                padTimezone={padTimezone}
                className="rounded-xl border border-stroke bg-black/20 p-4"
              />
            )}
            {showWeekly && (
              <Ws45PlanningForecastPanel
                forecast={ws45Planning.weekly}
                kind="weekly_planning"
                padTimezone={padTimezone}
                className="rounded-xl border border-stroke bg-black/20 p-4"
              />
            )}
          </div>
        ) : null}

        {hasAdvisories ? (
          <div className={clsx(hasForecastPanels ? 'mt-6 border-t border-stroke/50 pt-4' : '')}>
            <ForecastAdvisoriesDisclosure count={advisories.length}>
              <LaunchFaaAirspaceContent
                advisories={advisories}
                mapData={faaAirspaceMap}
                renderMode={faaMapMode}
                googleMapsWebApiKey={googleMapsWebApiKey}
                appleMapsAuthorizationToken={appleMapsAuthorizationToken}
                padMapsHref={padMapsHref}
                padMapsLinkLabel={padMapsLinkLabel}
                unavailableMessage={faaMapUnavailableMessage}
                padTimezone={padTimezone}
              />
            </ForecastAdvisoriesDisclosure>
          </div>
        ) : null}
      </div>
    </section>
  );
}

async function LaunchJepScoreSection({
  jepScorePromise,
  padTimezone
}: {
  jepScorePromise: Promise<LaunchJepScore | null>;
  padTimezone: string;
}) {
  const score = await jepScorePromise;
  if (!score) {
    return (
      <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
        <div className="text-xs uppercase tracking-[0.1em] text-text3">Jellyfish effect</div>
        <h2 className="mt-1 text-xl font-semibold text-text1">JEP visibility score</h2>
        <p className="mt-2 text-sm text-text3">
          Visibility scoring is not available for this launch yet. Check back as launch timing and forecast inputs refresh.
        </p>
      </section>
    );
  }

  return (
    <JepScoreClient launchId={score.launchId} initialScore={score} padTimezone={padTimezone} />
  );
}

function buildForecastOutlookDescription({
  showWs45,
  showOperational,
  showPlanning24h,
  showWeekly,
  showNws,
  advisoryCount
}: {
  showWs45: boolean;
  showOperational: boolean;
  showPlanning24h: boolean;
  showWeekly: boolean;
  showNws: boolean;
  advisoryCount: number;
}) {
  const parts = [
    showOperational ? 'live range conditions from the 5 WS live board' : null,
    showWs45 ? 'enhanced mission forecast insights' : null,
    showNws ? 'an NWS forecast for the pad location at T-0 (api.weather.gov)' : null,
    showPlanning24h ? 'the 45 WS 24-hour planning forecast' : null,
    showWeekly ? 'a Cape weekly outlook for near-term launches' : null
  ].filter(Boolean) as string[];
  const forecastDescription = parts.length ? joinWithAnd(parts) : null;

  if (!forecastDescription) {
    return 'Matched FAA launch advisories and launch-day airspace notices.';
  }

  if (advisoryCount > 0) {
    return `${capitalizeSentence(forecastDescription)}. Includes ${advisoryCount} matched FAA launch ${advisoryCount === 1 ? 'advisory' : 'advisories'}.`;
  }

  return `${capitalizeSentence(forecastDescription)}.`;
}

function joinWithAnd(parts: string[]) {
  if (parts.length <= 1) return parts[0] || '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function capitalizeSentence(value: string) {
  if (!value) return value;
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function LaunchFaaAirspaceContent({
  advisories,
  mapData,
  renderMode,
  googleMapsWebApiKey,
  appleMapsAuthorizationToken,
  padMapsHref,
  padMapsLinkLabel,
  unavailableMessage,
  padTimezone
}: {
  advisories: LaunchFaaAirspaceAdvisory[];
  mapData: Awaited<ReturnType<typeof fetchLaunchFaaAirspaceMap>>;
  renderMode: LaunchFaaMapRenderMode;
  googleMapsWebApiKey: string | null;
  appleMapsAuthorizationToken: string | null;
  padMapsHref: string | null;
  padMapsLinkLabel: string;
  unavailableMessage: string;
  padTimezone: string | null;
}) {
  const hasMapBlock = Boolean(mapData?.advisoryCount);

  return (
    <>
      <LaunchFaaMapBlock
        data={mapData}
        renderMode={renderMode}
        googleMapsApiKey={googleMapsWebApiKey}
        appleMapsAuthorizationToken={appleMapsAuthorizationToken}
        padMapsHref={padMapsHref}
        padMapsLinkLabel={padMapsLinkLabel}
        unavailableMessage={unavailableMessage}
      />

      <div className={clsx('space-y-3', hasMapBlock ? 'mt-4' : '')}>
        {advisories.map((advisory) => {
          const confidence = advisory.matchConfidence != null ? `${Math.round(advisory.matchConfidence)}%` : 'n/a';
          const windowLabel = formatFaaWindow(advisory, padTimezone);
          const statusLabel = advisory.isActiveNow
            ? 'Active now'
            : advisory.status === 'expired'
              ? 'Expired'
              : 'Scheduled';
          const primarySourceUrl = advisory.sourceGraphicUrl || advisory.sourceUrl;
          const rawSourceUrl = advisory.sourceRawUrl;
          const showRawSecondary = Boolean(rawSourceUrl && rawSourceUrl !== primarySourceUrl);
          const rawTextPreview = buildFaaNoticePreview(advisory.rawText);

          return (
            <article
              key={advisory.matchId}
              className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text1">{advisory.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text3">
                    <span
                      className={clsx(
                        'rounded-full border px-2 py-0.5',
                        advisory.isActiveNow ? 'border-warning/50 text-warning' : 'border-stroke'
                      )}
                    >
                      {statusLabel}
                    </span>
                    <span className="rounded-full border border-stroke px-2 py-0.5">
                      {advisory.matchStatus}
                    </span>
                    <span className="rounded-full border border-stroke px-2 py-0.5">confidence {confidence}</span>
                    {advisory.notamId && <span className="rounded-full border border-stroke px-2 py-0.5">{advisory.notamId}</span>}
                  </div>
                </div>
                <div className="text-right text-xs text-text3">
                  {advisory.shapeCount > 0 && <div>{advisory.shapeCount} shape{advisory.shapeCount === 1 ? '' : 's'}</div>}
                  {advisory.state && <div>{advisory.state}</div>}
                </div>
              </div>

              <div className="mt-2 grid gap-2 text-xs text-text2 md:grid-cols-2">
                {windowLabel && (
                  <div>
                    <div className="uppercase tracking-[0.08em] text-text3">Window</div>
                    <div>{windowLabel}</div>
                  </div>
                )}
                {(advisory.facility || advisory.type) && (
                  <div>
                    <div className="uppercase tracking-[0.08em] text-text3">Details</div>
                    <div>{[advisory.facility, advisory.type].filter(Boolean).join(' • ')}</div>
                  </div>
                )}
              </div>

              {rawTextPreview && (
                <div className="mt-3 rounded-xl border border-stroke bg-surface-0 p-3">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Restriction summary</div>
                  <p className="mt-2 text-sm text-text2">{rawTextPreview}</p>
                </div>
              )}

              {advisory.rawText && (
                <details className="mt-3 rounded-xl border border-stroke bg-surface-0 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-text1">Official notice text</summary>
                  <div className="mt-2 text-xs text-text3">
                    {advisory.rawTextFetchedAt ? `Saved ${formatDate(advisory.rawTextFetchedAt, padTimezone || 'UTC')}` : 'Saved FAA detail cache'}
                  </div>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-xs leading-6 text-text2">
                    {advisory.rawText}
                  </pre>
                </details>
              )}

              {primarySourceUrl && (
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  <a
                    href={primarySourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex text-primary hover:text-primary/80"
                  >
                    {advisory.sourceGraphicUrl ? 'Open FAA graphic page' : 'View FAA source'}
                  </a>
                  {showRawSecondary && rawSourceUrl && (
                    <a
                      href={rawSourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex text-text3 hover:text-text2"
                    >
                      View raw NOTAM text
                    </a>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-text3">
        Advisory data is informational. Confirm operational constraints with official FAA publications.
      </p>
    </>
  );
}

function formatFaaWindow(advisory: LaunchFaaAirspaceAdvisory, timezone: string | null) {
  if (isDateOnlyUtcWindow(advisory.validStart, advisory.validEnd)) {
    return formatFaaDateOnlyWindow(advisory.validStart, advisory.validEnd);
  }
  const start = advisory.validStart ? formatDate(advisory.validStart, timezone) : null;
  const end = advisory.validEnd ? formatDate(advisory.validEnd, timezone) : null;
  if (start && end) return `${start} to ${end}`;
  if (start) return `Starts ${start}`;
  if (end) return `Ends ${end}`;
  return null;
}

function formatFaaDateOnlyWindow(validStart: string | null, validEnd: string | null) {
  if (!validStart) return null;

  const startLabel = formatUtcDateOnly(validStart);
  if (!validEnd) return startLabel;

  const endMs = Date.parse(validEnd);
  if (!Number.isFinite(endMs)) return startLabel;

  const lastDayLabel = formatUtcDateOnly(new Date(endMs - 1).toISOString());
  return startLabel === lastDayLabel ? startLabel : `${startLabel} to ${lastDayLabel}`;
}

function formatUtcDateOnly(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  }).format(new Date(value));
}

function buildFaaNoticePreview(rawText: string | null | undefined) {
  const normalized = String(rawText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
  if (!normalized) return null;

  const withoutHeader = normalized
    .replace(/^!FDC\s+\S+\s+[A-Z]{2,4}\s+[A-Z]{2}\.\.?/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!withoutHeader) return null;

  return withoutHeader.length > 240 ? `${withoutHeader.slice(0, 237).trimEnd()}...` : withoutHeader;
}

function isDateOnlyUtcWindow(validStart: string | null, validEnd: string | null) {
  if (!validStart || !validEnd) return false;
  const start = new Date(validStart);
  const end = new Date(validEnd);
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return false;

  const dayMs = 24 * 60 * 60 * 1000;
  return (
    start.getUTCHours() === 0 &&
    start.getUTCMinutes() === 0 &&
    start.getUTCSeconds() === 0 &&
    start.getUTCMilliseconds() === 0 &&
    end.getUTCHours() === 0 &&
    end.getUTCMinutes() === 0 &&
    end.getUTCSeconds() === 0 &&
    end.getUTCMilliseconds() === 0 &&
    (endMs - startMs) % dayMs === 0
  );
}

async function LaunchStagesAndRecoverySection({
  enrichmentPromise,
  payloadManifestPromise,
  launch,
  padTimezone
}: {
  enrichmentPromise: Promise<LaunchDetailEnrichment>;
  payloadManifestPromise: Promise<PayloadManifestEntry[]>;
  launch: Launch;
  padTimezone: string | null;
}) {
  const [enrichment, manifest] = await Promise.all([enrichmentPromise, payloadManifestPromise]);
  const firstStages = Array.isArray(enrichment.firstStages) ? enrichment.firstStages : [];
  const fallbackFirstStage = typeof launch.firstStageBooster === 'string' ? launch.firstStageBooster.trim() : '';
  const spacecraftStages = buildSpacecraftStageCards(manifest);
  const recovery = mergeRecoveryDetails(enrichment.recovery, buildManifestRecoveryDetails(manifest));

  if (!firstStages.length && !fallbackFirstStage && !spacecraftStages.length && !recovery.length) return null;

  return (
    <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Vehicle details</div>
          <h2 className="text-xl font-semibold text-text1">Stages & recovery</h2>
        </div>
        <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
          Presence based
        </span>
      </div>

      {(firstStages.length > 0 || fallbackFirstStage || spacecraftStages.length > 0) && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {firstStages.map((stage) => (
            <LaunchFirstStageCard key={stage.id} stage={stage} />
          ))}
          {!firstStages.length && fallbackFirstStage ? <LaunchFallbackFirstStageCard label={fallbackFirstStage} /> : null}
          {spacecraftStages.map((stage) => (
            <SpacecraftStageCardPanel key={stage.id} stage={stage} />
          ))}
        </div>
      )}

      {recovery.length > 0 && (
        <div className="mt-4">
          <div className="text-xs uppercase tracking-[0.08em] text-text3">Recovery</div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {recovery.map((detail) => (
              <LaunchRecoveryCard key={detail.id} detail={detail} padTimezone={padTimezone} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function LaunchFirstStageCard({ stage }: { stage: LaunchStageSummary }) {
  const currentYear = new Date().getUTCFullYear();
  const hasImage = Boolean(normalizeImageUrl(stage.imageUrl || null));
  const status = normalizeMeaningfulText(stage.status);

  return (
    <article className="overflow-hidden rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)]">
      {hasImage ? (
        <img
          src={normalizeImageUrl(stage.imageUrl || null) || undefined}
          alt={stage.title}
          className="h-40 w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : null}
      <div className="p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.08em] text-text3">First stage</div>
            <h3 className="mt-1 text-base font-semibold text-text1">{stage.title}</h3>
            {stage.serialNumber && stage.serialNumber !== stage.title ? (
              <div className="text-xs text-text3">Serial: {stage.serialNumber}</div>
            ) : null}
          </div>
          {status ? (
            <span className="rounded-full border border-stroke px-2 py-0.5 text-[11px] uppercase tracking-[0.08em] text-text3">
              {status}
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text3">
          {stage.totalMissions != null ? <div>Tracked flights: {formatCount(stage.totalMissions)}</div> : null}
          {stage.missionsThisYear != null ? <div>{formatCount(stage.missionsThisYear)} in {currentYear}</div> : null}
          {stage.firstLaunchDate ? <div>First flight: {formatDateOnlyLabel(stage.firstLaunchDate)}</div> : null}
          {stage.lastMissionNet ? <div>Last mission: {formatDate(stage.lastMissionNet, 'UTC')}</div> : null}
          {!stage.lastMissionNet && stage.lastLaunchDate ? <div>Last mission: {formatDateOnlyLabel(stage.lastLaunchDate)}</div> : null}
        </div>

        {stage.description ? <p className="mt-2 text-xs text-text2">{stage.description}</p> : null}
      </div>
    </article>
  );
}

function LaunchFallbackFirstStageCard({ label }: { label: string }) {
  return (
    <article className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text3">First stage</div>
      <h3 className="mt-1 text-base font-semibold text-text1">{label}</h3>
      <p className="mt-2 text-xs text-text3">Structured core-level LL2 data is not available for this launch yet.</p>
    </article>
  );
}

function SpacecraftStageCardPanel({ stage }: { stage: SpacecraftStageCard }) {
  const imageUrl = normalizeImageUrl(stage.imageUrl || null) || null;

  return (
    <article className="overflow-hidden rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)]">
      {imageUrl ? (
        <img src={imageUrl} alt={stage.title} className="h-40 w-full object-cover" loading="lazy" decoding="async" />
      ) : null}
      <div className="p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.08em] text-text3">Spacecraft stage</div>
            <h3 className="mt-1 text-base font-semibold text-text1">{stage.title}</h3>
            {stage.subtitle ? <div className="text-xs text-text3">{stage.subtitle}</div> : null}
          </div>
          {stage.destination ? (
            <span className="rounded-full border border-stroke px-2 py-0.5 text-[11px] uppercase tracking-[0.08em] text-text3">
              {stage.destination}
            </span>
          ) : null}
        </div>

        {stage.description ? <p className="mt-2 text-xs text-text2">{stage.description}</p> : null}

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text3">
          {stage.landingSummary ? <div>{stage.landingSummary}</div> : null}
          {stage.dockingSummary ? <div>{stage.dockingSummary}</div> : null}
        </div>

        {(stage.sourceUrl || stage.infoUrl || stage.wikiUrl) ? (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {stage.sourceUrl ? (
              <a className="text-primary hover:underline" href={stage.sourceUrl} target="_blank" rel="noreferrer">
                LL2 spacecraft flight
              </a>
            ) : null}
            {stage.infoUrl ? (
              <a className="text-primary hover:underline" href={stage.infoUrl} target="_blank" rel="noreferrer">
                Info
              </a>
            ) : null}
            {stage.wikiUrl ? (
              <a className="text-primary hover:underline" href={stage.wikiUrl} target="_blank" rel="noreferrer">
                Wikipedia
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function LaunchRecoveryCard({
  detail,
  padTimezone
}: {
  detail: LaunchRecoveryDetail;
  padTimezone: string | null;
}) {
  const location = buildRecoveryLocationLabel(detail);
  const title = normalizeMeaningfulText(detail.title) || normalizeMeaningfulText(detail.returnSite) || location || 'Recovery';
  const badgeTone =
    detail.success === true ? 'border-success text-success' : detail.success === false ? 'border-danger text-danger' : 'border-stroke text-text3';
  const returnTime = detail.returnDateTime ? formatDate(detail.returnDateTime, padTimezone) : null;
  const subtitle = buildRecoverySubtitle(detail);
  const coordinates =
    detail.latitude != null && detail.longitude != null
      ? `${detail.latitude.toFixed(3)}, ${detail.longitude.toFixed(3)}`
      : null;

  return (
    <article className="rounded-lg border border-stroke bg-surface-0 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{formatRecoveryRoleLabel(detail.role)}</div>
          <h3 className="mt-1 text-sm font-semibold text-text1">{title}</h3>
          {subtitle ? <div className="mt-1 text-xs text-text3">{subtitle}</div> : null}
        </div>
        <span className={clsx('rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.08em]', badgeTone)}>
          {formatRecoverySourceLabel(detail)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text3">
        {normalizeMeaningfulText(detail.landingTypeName) ? <div>Type: {normalizeMeaningfulText(detail.landingTypeName)}</div> : null}
        {location ? <div>Location: {location}</div> : null}
        {detail.downrangeDistanceKm != null ? <div>Downrange: {formatCount(Math.round(detail.downrangeDistanceKm))} km</div> : null}
        {returnTime ? <div>Return: {returnTime}</div> : null}
        {coordinates ? <div>Coords: {coordinates}</div> : null}
      </div>

      {detail.description ? <p className="mt-2 text-xs text-text2">{detail.description}</p> : null}
    </article>
  );
}

async function LaunchMissionResourcesSection({
  enrichmentPromise
}: {
  enrichmentPromise: Promise<LaunchDetailEnrichment>;
}) {
  const enrichment = await enrichmentPromise;
  const resources = flattenExternalResources(enrichment.externalContent);

  if (!resources.length) return null;

  return (
    <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Mission resources</div>
          <h2 className="text-xl font-semibold text-text1">Official media & resources</h2>
          <p className="text-sm text-text3">Matched SpaceX launch-page assets and media references for this launch.</p>
        </div>
        <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
          SpaceX content
        </span>
      </div>

      {resources.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {resources.map((resource) => (
            <LaunchExternalResourceCard key={resource.id} resource={resource} />
          ))}
        </div>
      )}
    </section>
  );
}

function LaunchExternalResourceCard({ resource }: { resource: LaunchExternalResource }) {
  const previewUrl =
    normalizeImageUrl(
      resource.previewUrl || (resource.kind === 'image' || resource.kind === 'infographic' ? resource.url : null)
    ) || null;

  if (previewUrl) {
    return (
      <LaunchMediaLightboxCard
        imageUrl={previewUrl}
        alt={resource.label}
        href={resource.url}
        buttonLabel={`Open ${resource.label}`}
        className="bg-[rgba(255,255,255,0.02)]"
      />
    );
  }

  return (
    <a
      href={resource.url}
      target="_blank"
      rel="noreferrer"
      className="group block overflow-hidden rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] transition hover:border-primary"
    >
      <div className="p-3">
        <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{formatExternalResourceKind(resource.kind)}</div>
        <div className="mt-1 text-sm font-semibold text-text1">{resource.label}</div>
        <div className="mt-1 text-xs text-text3">{formatLinkHost(resource.url)}</div>
      </div>
    </a>
  );
}

function buildSpacecraftStageCards(manifest: PayloadManifestEntry[]): SpacecraftStageCard[] {
  if (!Array.isArray(manifest) || manifest.length === 0) return [];

  return manifest.flatMap((entry) => {
    if (entry?.kind !== 'spacecraft_flight') return [];

    const payload = entry.payload || null;
    const subtitle = [payload?.type?.name || null, payload?.operator?.name || payload?.manufacturer?.name || null]
      .filter(Boolean)
      .join(' • ');

    return [
      {
        id: `spacecraft_stage:${entry.id}`,
        title: payload?.name || `Spacecraft ${entry.id}`,
        subtitle: subtitle || null,
        description: payload?.description || null,
        imageUrl: normalizeImageUrl(payload?.image?.thumbnail_url || payload?.image?.image_url || null) || null,
        destination: entry.destination || null,
        sourceUrl: entry.url || null,
        infoUrl: payload?.info_link || null,
        wikiUrl: payload?.wiki_link || null,
        landingSummary: buildManifestLandingSummary(entry.landing || null),
        dockingSummary: buildDockingSummary(entry.docking_events || [])
      } satisfies SpacecraftStageCard
    ];
  });
}

function buildManifestRecoveryDetails(manifest: PayloadManifestEntry[]): LaunchRecoveryDetail[] {
  if (!Array.isArray(manifest) || manifest.length === 0) return [];

  const rows: LaunchRecoveryDetail[] = [];
  for (const entry of manifest) {
    const landing = entry?.landing || null;
    const landingId = typeof landing?.id === 'number' && Number.isFinite(landing.id) ? landing.id : null;
    if (landingId == null) continue;

    const location =
      landing?.landing_location && typeof landing.landing_location === 'object' ? landing.landing_location : null;
    const landingType = landing?.landing_type && typeof landing.landing_type === 'object' ? landing.landing_type : null;
    const locationContext =
      location?.location && typeof location.location === 'object' ? (location.location as Record<string, unknown>) : null;
    const landingLocationName =
      normalizeMeaningfulText(typeof location?.name === 'string' ? location.name : null) ||
      normalizeMeaningfulText(typeof location?.abbrev === 'string' ? location.abbrev : null);
    const landingTypeName =
      normalizeMeaningfulText(typeof landingType?.name === 'string' ? landingType.name : null) ||
      normalizeMeaningfulText(typeof landingType?.abbrev === 'string' ? landingType.abbrev : null);

    rows.push({
      id: `${entry.kind === 'spacecraft_flight' ? 'spacecraft' : 'unknown'}:${landingId}`,
      role: entry.kind === 'spacecraft_flight' ? 'spacecraft' : 'unknown',
      source: 'll2',
      sourceId: String(landingId),
      title: [landingTypeName, landingLocationName].filter(Boolean).join(' • ') || `Landing ${landingId}`,
      attempt: typeof landing?.attempt === 'boolean' ? landing.attempt : null,
      success: typeof landing?.success === 'boolean' ? landing.success : null,
      description: normalizeMeaningfulText(typeof landing?.description === 'string' ? landing.description : null),
      downrangeDistanceKm:
        typeof landing?.downrange_distance_km === 'number' && Number.isFinite(landing.downrange_distance_km)
          ? landing.downrange_distance_km
          : null,
      landingLocationName,
      landingLocationAbbrev: normalizeMeaningfulText(typeof location?.abbrev === 'string' ? location.abbrev : null),
      landingLocationContext: normalizeMeaningfulText(typeof locationContext?.name === 'string' ? locationContext.name : null),
      latitude:
        typeof location?.latitude === 'number' && Number.isFinite(location.latitude) ? location.latitude : null,
      longitude:
        typeof location?.longitude === 'number' && Number.isFinite(location.longitude) ? location.longitude : null,
      landingTypeName,
      landingTypeAbbrev: normalizeMeaningfulText(typeof landingType?.abbrev === 'string' ? landingType.abbrev : null),
      returnSite: null,
      returnDateTime: null,
      fetchedAt: null
    });
  }

  return rows;
}

function mergeRecoveryDetails(
  primary: LaunchRecoveryDetail[] | null | undefined,
  supplemental: LaunchRecoveryDetail[] | null | undefined
) {
  const merged = new Map<string, LaunchRecoveryDetail>();

  for (const detail of primary || []) {
    if (!detail?.id) continue;
    merged.set(detail.id, detail);
  }

  for (const detail of supplemental || []) {
    if (!detail?.id || merged.has(detail.id)) continue;
    merged.set(detail.id, detail);
  }

  return [...merged.values()].sort((left, right) => {
    const roleRank = (value: LaunchRecoveryDetail['role']) =>
      value === 'booster' ? 0 : value === 'spacecraft' ? 1 : 2;
    const roleDelta = roleRank(left.role) - roleRank(right.role);
    if (roleDelta !== 0) return roleDelta;
    const sourceDelta = (right.fetchedAt || '').localeCompare(left.fetchedAt || '');
    if (sourceDelta !== 0) return sourceDelta;
    return (left.title || left.id).localeCompare(right.title || right.id);
  });
}

function buildManifestLandingSummary(landing: PayloadManifestEntry['landing']) {
  if (!landing) return null;

  const outcome =
    landing.attempt === true
      ? landing.success === true
        ? 'Successful landing'
        : landing.success === false
          ? 'Failed landing'
          : 'Landing attempted'
      : landing.attempt === false
        ? 'No landing attempt'
        : null;

  const location =
    landing.landing_location && typeof landing.landing_location === 'object'
      ? (normalizeMeaningfulText((landing.landing_location as Record<string, unknown>).name as string | null | undefined) ||
          normalizeMeaningfulText((landing.landing_location as Record<string, unknown>).abbrev as string | null | undefined) ||
          null)
      : null;

  return [outcome, location ? `@ ${location}` : null].filter(Boolean).join(' • ') || null;
}

function buildDockingSummary(events: PayloadManifestEntry['docking_events']) {
  const rows = Array.isArray(events) ? events : [];
  if (!rows.length) return null;

  if (rows.length === 1) {
    const row = rows[0] || null;
    const station =
      row?.space_station_target && typeof row.space_station_target === 'object'
        ? row.space_station_target.name || null
        : null;
    return station ? `Docking @ ${station}` : 'Docking event';
  }

  return `${rows.length} docking events`;
}

function buildRecoveryLocationLabel(detail: LaunchRecoveryDetail) {
  const returnSite = normalizeMeaningfulText(detail.returnSite);
  if (returnSite) return returnSite;
  return [normalizeMeaningfulText(detail.landingLocationName), normalizeMeaningfulText(detail.landingLocationContext)]
    .filter(Boolean)
    .join(' • ') || null;
}

function buildRecoverySubtitle(detail: LaunchRecoveryDetail) {
  const outcome =
    detail.attempt === true
      ? detail.success === true
        ? 'Successful landing'
        : detail.success === false
          ? 'Failed landing'
          : 'Landing attempted'
      : detail.attempt === false
        ? 'No landing attempt'
      : detail.returnSite || detail.returnDateTime
          ? 'Recovery hint'
          : null;

  if (!outcome) return null;
  return [outcome, detail.source === 'spacex_content' ? 'SpaceX content' : 'LL2'].join(' • ');
}

function formatRecoveryRoleLabel(role: LaunchRecoveryDetail['role']) {
  if (role === 'booster') return 'Booster recovery';
  if (role === 'spacecraft') return 'Spacecraft recovery';
  return 'Recovery';
}

function formatRecoverySourceLabel(detail: LaunchRecoveryDetail) {
  return detail.source === 'spacex_content' ? 'Hint' : 'LL2';
}

function flattenExternalResources(items: LaunchExternalContent[]) {
  const deduped = new Map<string, LaunchExternalResource>();

  for (const item of items || []) {
    const resources = selectPreferredResponsiveLaunchExternalResources(item.resources || [], 'desktop');
    for (const resource of resources) {
      const normalizedUrl = normalizeComparableUrl(resource.url) || resource.url;
      const key = `${resource.kind}:${normalizedUrl}`;
      if (!deduped.has(key)) deduped.set(key, resource);
    }
  }

  const rank = (kind: LaunchExternalResource['kind']) =>
    kind === 'page'
      ? 0
      : kind === 'infographic'
        ? 1
        : kind === 'webcast'
          ? 2
          : kind === 'image'
            ? 3
            : kind === 'video'
              ? 4
              : kind === 'document'
                ? 5
                : 6;

  return [...deduped.values()].sort((left, right) => {
    const kindDelta = rank(left.kind) - rank(right.kind);
    if (kindDelta !== 0) return kindDelta;
    return left.label.localeCompare(right.label);
  });
}

function flattenExternalTimelineEvents(items: LaunchExternalContent[]) {
  const deduped = new Map<string, LaunchTimelineResourceEvent>();
  const insertionOrder = new Map<string, number>();
  let nextOrder = 0;

  for (const item of items || []) {
    for (const event of item.timelineEvents || []) {
      if (!event?.id) continue;
      const key = `${event.phase || 'timeline'}:${event.time || ''}:${event.label}`;
      if (!deduped.has(key)) {
        deduped.set(key, event);
        insertionOrder.set(key, nextOrder);
        nextOrder += 1;
      }
    }
  }

  const phaseRank = (phase: LaunchTimelineResourceEvent['phase']) =>
    phase === 'prelaunch' ? 0 : phase === 'timeline' ? 1 : phase === 'postlaunch' ? 2 : 3;

  return [...deduped.entries()]
    .sort(([leftKey, left], [rightKey, right]) => {
      const phaseDelta = phaseRank(left.phase) - phaseRank(right.phase);
      if (phaseDelta !== 0) return phaseDelta;
      const timeDelta = compareTimelineResourceEventTime(left, right);
      if (timeDelta !== 0) return timeDelta;
      const insertionDelta = (insertionOrder.get(leftKey) ?? 0) - (insertionOrder.get(rightKey) ?? 0);
      if (insertionDelta !== 0) return insertionDelta;
      return left.label.localeCompare(right.label);
    })
    .map(([, event]) => event);
}

function compareTimelineResourceEventTime(left: LaunchTimelineResourceEvent, right: LaunchTimelineResourceEvent) {
  const leftOffsetSec = parseTimelineResourceEventOffsetSec(left.time, left.phase);
  const rightOffsetSec = parseTimelineResourceEventOffsetSec(right.time, right.phase);

  if (leftOffsetSec != null && rightOffsetSec != null && leftOffsetSec !== rightOffsetSec) {
    return leftOffsetSec - rightOffsetSec;
  }
  if (leftOffsetSec != null && rightOffsetSec == null) return -1;
  if (leftOffsetSec == null && rightOffsetSec != null) return 1;

  const leftTime = (left.time || '').trim();
  const rightTime = (right.time || '').trim();
  if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);

  return 0;
}

function parseTimelineResourceEventOffsetSec(
  value?: string | null,
  phase?: LaunchTimelineResourceEvent['phase']
): number | null {
  const timeText = typeof value === 'string' ? value.trim() : '';
  if (!timeText) return null;

  const isoMs = parseIsoDurationToMs(timeText);
  if (isoMs != null) return Math.round(isoMs / 1000);

  const explicitClock = parseExplicitTimelineEventClock(timeText);
  if (explicitClock != null) return explicitClock;

  const unsignedClock = parseUnsignedTimelineEventClock(timeText);
  if (unsignedClock == null) return null;

  return phase === 'prelaunch' ? -unsignedClock : unsignedClock;
}

function parseExplicitTimelineEventClock(value: string): number | null {
  const match = value.match(/^T\s*([+-])\s*(\d{1,2})(?::(\d{2}))(?::(\d{2}))?$/i);
  if (!match) return null;

  const sign = match[1] === '-' ? -1 : 1;
  const first = Number(match[2]);
  const second = Number(match[3]);
  const third = match[4] != null ? Number(match[4]) : 0;
  if (![first, second, third].every(Number.isFinite)) return null;

  const totalSeconds = match[4] != null ? first * 3600 + second * 60 + third : first * 60 + second;
  return sign * totalSeconds;
}

function parseUnsignedTimelineEventClock(value: string): number | null {
  const match = value.match(/^(\d{1,2})(?::(\d{2}))(?::(\d{2}))?$/);
  if (!match) return null;

  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = match[3] != null ? Number(match[3]) : 0;
  if (![first, second, third].every(Number.isFinite)) return null;

  return match[3] != null ? first * 3600 + second * 60 + third : first * 60 + second;
}

function formatExternalResourceKind(kind: LaunchExternalResource['kind']) {
  if (kind === 'page') return 'Launch page';
  if (kind === 'infographic') return 'Infographic';
  if (kind === 'webcast') return 'Webcast';
  if (kind === 'image') return 'Image';
  if (kind === 'video') return 'Video';
  if (kind === 'document') return 'Document';
  return 'Resource';
}

async function BlueOriginMissionGraphicsSection({
  missionGraphicsPromise,
  existingLinkUrls
}: {
  missionGraphicsPromise: Promise<BlueOriginMissionGraphics | null>;
  existingLinkUrls: string[];
}) {
  const info = await missionGraphicsPromise;
  if (!info || info.graphics.length === 0) return null;

  const seen = new Set(
    existingLinkUrls
      .map((url) => normalizeComparableUrl(url))
      .filter((url): url is string => Boolean(url))
  );

  const graphics = info.graphics.filter((graphic) => {
    const key = normalizeComparableUrl(graphic.url) || graphic.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!graphics.length) return null;

  return (
    <section className="mt-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-sm text-text2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.08em] text-text3">Blue Origin mission graphics</div>
          <h3 className="text-base font-semibold text-text1">Official infographic links</h3>
        </div>
        <span className="rounded-full border border-stroke px-2 py-0.5 text-[11px] text-text3">
          {graphics.length} link{graphics.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <a className="text-primary hover:text-primary/80" href={info.missionUrl} target="_blank" rel="noreferrer">
          Mission page source
        </a>
        {info.archiveSnapshotUrl ? (
          <a className="text-primary hover:text-primary/80" href={info.archiveSnapshotUrl} target="_blank" rel="noreferrer">
            Archived snapshot source
          </a>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {graphics.map((graphic) => (
          <a
            key={graphic.id}
            href={graphic.url}
            target="_blank"
            rel="noreferrer"
            className="flex min-w-0 items-center justify-between rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1 transition hover:border-primary"
          >
            <span className="min-w-0 truncate">{graphic.label}</span>
            <span className="ml-3 shrink-0 text-xs text-text3">Open ↗</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function BlueOriginLaunchEnhancementsSection({
  enhancements,
  existingLinkUrls
}: {
  enhancements: BlueOriginLaunchEnhancements | null;
  existingLinkUrls: string[];
}) {
  if (!enhancements) return null;

  const seen = new Set(
    existingLinkUrls
      .map((url) => normalizeComparableUrl(url))
      .filter((url): url is string => Boolean(url))
  );

  const sourcePages = enhancements.sourcePages.filter((page) => {
    const dedupeKey = normalizeComparableUrl(page.canonicalUrl || page.url) || page.url;
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  });

  const facts = enhancements.facts;
  const payloadDetails = enhancements.payloads.filter((payload) => payload.description);
  const passengerDetails = enhancements.passengers.filter((passenger) => passenger.bioSnippet);
  const hasContent = sourcePages.length > 0 || facts.length > 0 || payloadDetails.length > 0 || passengerDetails.length > 0;
  if (!hasContent) return null;

  return (
    <section className="mt-3 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3 text-sm text-text2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.08em] text-text3">Blue Origin official enhancements</div>
          <h3 className="text-base font-semibold text-text1">Added launch details</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-text3">
          {enhancements.passengers.length ? (
            <span className="rounded-full border border-stroke px-2 py-0.5">{enhancements.passengers.length} crew</span>
          ) : null}
          {enhancements.payloads.length ? (
            <span className="rounded-full border border-stroke px-2 py-0.5">{enhancements.payloads.length} payloads</span>
          ) : null}
          {facts.length ? <span className="rounded-full border border-stroke px-2 py-0.5">{facts.length} facts</span> : null}
        </div>
      </div>

      {facts.length ? (
        <div className="mt-3">
          <div className="text-xs uppercase tracking-[0.08em] text-text3">Mission facts</div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {facts.map((fact) => (
              <div key={`${fact.key}:${fact.value}:${fact.unit || ''}`} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
                <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{fact.label}</div>
                <div className="text-sm font-semibold text-text1">
                  {fact.value}
                  {fact.unit ? ` ${fact.unit}` : ''}
                </div>
                {fact.context ? <div className="text-[11px] text-text3">{fact.context}</div> : null}
                {fact.sourceUrl ? (
                  <a href={fact.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex text-[11px] text-primary hover:text-primary/80">
                    Source
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {payloadDetails.length || passengerDetails.length ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {payloadDetails.length ? (
            <div className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
              <div className="text-xs uppercase tracking-[0.08em] text-text3">Payload notes</div>
              <ul className="mt-2 space-y-1">
                {payloadDetails.slice(0, 6).map((payload) => (
                  <li key={payload.name} className="text-xs text-text2">
                    <span className="font-semibold text-text1">{payload.name}</span>
                    {payload.description ? `: ${payload.description}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {passengerDetails.length ? (
            <div className="rounded-lg border border-stroke bg-surface-0 px-3 py-2">
              <div className="text-xs uppercase tracking-[0.08em] text-text3">Crew notes</div>
              <ul className="mt-2 space-y-1">
                {passengerDetails.slice(0, 6).map((passenger) => (
                  <li key={passenger.name} className="text-xs text-text2">
                    <span className="font-semibold text-text1">{passenger.name}</span>
                    {passenger.bioSnippet ? `: ${passenger.bioSnippet}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {sourcePages.length ? (
        <div className="mt-3">
          <div className="text-xs uppercase tracking-[0.08em] text-text3">Official source pages</div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {sourcePages.map((page) => {
              const label = page.title || formatBlueOriginSourcePageLabel(page.canonicalUrl || page.url);
              return (
                <a
                  key={page.canonicalUrl || page.url}
                  href={page.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center justify-between rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1 transition hover:border-primary"
                >
                  <span className="min-w-0 truncate">{label}</span>
                  <span className="ml-3 shrink-0 text-xs text-text3">Open ↗</span>
                </a>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

async function RelatedEventsSection({
  relatedEventsPromise,
  padTimezone
}: {
  relatedEventsPromise: Promise<RelatedEvent[]>;
  padTimezone: string | null;
}) {
  const relatedEvents = await relatedEventsPromise;
  const relatedEventViews = buildRelatedEventTimeline(relatedEvents, padTimezone);
  if (relatedEventViews.length === 0) return null;
  const nextRelatedEvent = relatedEventViews.find((event) => event.isNext);

  return (
    <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Related events</div>
          <h2 className="text-xl font-semibold text-text1">Related events</h2>
        </div>
        {nextRelatedEvent && (
          <div className="text-xs text-text3">
            Next: {nextRelatedEvent.name}
            {nextRelatedEvent.dateLabel ? ` (${nextRelatedEvent.dateLabel})` : ''}
          </div>
        )}
      </div>
      <div className="mt-4">
        <ol className="relative border-l border-stroke pl-4">
          {relatedEventViews.map((event) => (
            <li key={event.id} className="relative pb-4 last:pb-0">
              <span
                className={`absolute -left-[9px] top-3 h-3 w-3 rounded-full border ${
                  event.isNext
                    ? 'border-primary bg-primary/70'
                    : event.isPast
                      ? 'border-stroke bg-surface-2'
                      : 'border-stroke bg-surface-1'
                }`}
              />
              <div
                className={`rounded-lg border px-3 py-2 ${
                  event.isNext ? 'border-primary/50 bg-primary/10' : 'border-stroke bg-[rgba(255,255,255,0.02)]'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/catalog/events/${encodeURIComponent(String(event.id))}`} className="text-sm text-text1 hover:text-primary">
                    {event.name}
                  </Link>
                  {event.dateLabel && <div className="text-xs text-text3">{event.dateLabel}</div>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text3">
                  {event.typeName && <span>{event.typeName}</span>}
                  {event.locationName && <span>{event.locationName}</span>}
                  {event.webcastLive && <span className="rounded-full border border-success px-2 py-0.5 text-success">Live</span>}
                </div>
                {event.description && <div className="mt-2 text-xs text-text2">{event.description}</div>}
                {event.url && (
                  <a
                    href={event.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex text-xs text-primary hover:text-primary/80"
                  >
                    Event details
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

async function VehicleTimelineSection({
  timelineRowsPromise,
  launch,
  rocket,
  rocketHref
}: {
  timelineRowsPromise: Promise<Array<Record<string, any>>>;
  launch: Launch;
  rocket: Launch['rocket'];
  rocketHref: string;
}) {
  const timelineRows = await timelineRowsPromise;
  const timelineNodes = buildTimelineNodes(timelineRows, launch);
  const initialNowMs = Date.now();
  return (
    <ChronoHelixTimeline
      nodes={timelineNodes}
      initialLaunchId={launch.id}
      vehicleLabel={rocket?.fullName || launch.vehicle}
      vehicleHref={rocketHref}
      initialNowMs={initialNowMs}
    />
  );
}

async function RelatedNewsSection({ relatedNewsPromise }: { relatedNewsPromise: Promise<RelatedNewsItem[]> }) {
  const relatedNews = await relatedNewsPromise;
  const filteredNews = relatedNews.filter((item) => item.url && item.title);
  if (filteredNews.length === 0) return null;
  const newsItems = filteredNews.slice(0, 6);

  return (
    <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Related coverage</div>
          <h2 className="text-xl font-semibold text-text1">Launch news</h2>
          <p className="text-sm text-text3">Linked via Spaceflight News API (SNAPI).</p>
        </div>
        <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
          {filteredNews.length} items
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {newsItems.map((item) => {
          const title = item.title || 'Untitled';
          const summary = item.summary ? truncateText(item.summary, 160) : null;
          const published = formatNewsDate(item.published_at);
          const authors = formatAuthors(item.authors);
          const badge = formatNewsType(item.item_type);
          const site = formatNewsSourceLabel(item.news_site, item.url);
          const imageUrl = normalizeImageUrl(item.image_url);
          return (
            <a
              key={item.snapi_uid}
              className="group flex h-full flex-col overflow-hidden rounded-xl border border-stroke bg-surface-0 transition hover:border-primary"
              href={item.url}
              target="_blank"
              rel="noreferrer"
            >
              <div className="relative h-28 w-full overflow-hidden">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt=""
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="h-full w-full bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.3),_transparent_60%)]" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                <span className="absolute left-3 top-3 rounded-full border border-white/20 bg-black/40 px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-white">
                  {badge}
                </span>
                {item.featured && (
                  <span className="absolute right-3 top-3 rounded-full border border-white/20 bg-black/40 px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-white">
                    Featured
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text3">
                  <span className="uppercase tracking-[0.08em]">{site}</span>
                  {published && <span>{published}</span>}
                </div>
                <div className="text-sm font-semibold text-text1">{title}</div>
                {summary && <p className="text-xs text-text2">{summary}</p>}
                {authors && <div className="text-[11px] text-text3">By {authors}</div>}
              </div>
            </a>
          );
        })}
      </div>
      {filteredNews.length > newsItems.length && (
        <div className="mt-2 text-xs text-text3">+{filteredNews.length - newsItems.length} more coverage links available.</div>
      )}
    </div>
  );
}

async function LaunchUpdatesSection({
  launchUpdatesPromise,
  padTimezone,
  canUseChangeLog
}: {
  launchUpdatesPromise: Promise<LaunchUpdateRow[]>;
  padTimezone: string | null;
  canUseChangeLog: boolean;
}) {
  if (!canUseChangeLog) return null;
  const launchUpdates = await launchUpdatesPromise;
  const updateRows = launchUpdates
    .filter((update) => !shouldHideLaunchUpdate(update))
    .flatMap((update) => {
      const filteredFields = filterChangelogFields(update.changed_fields ?? []);
      if (filteredFields.length === 0) return [];
      return [buildLaunchUpdateView({ ...update, changed_fields: filteredFields }, padTimezone)];
    });
  return <LaunchUpdateLog updates={updateRows} initialCount={5} />;
}

type BonusInsight = {
  label: string;
  value: string;
  detail?: string;
  accent: string;
};

async function LaunchStoryStatsSection({
  rocketStatsPromise,
  boosterStatsPromise,
  launch,
  rocket,
  rocketHref
}: {
  rocketStatsPromise: Promise<RocketOutcomeStats | null>;
  boosterStatsPromise: Promise<LaunchBoosterStats[]>;
  launch: Launch;
  rocket: Launch['rocket'];
  rocketHref: string;
}) {
  const [rocketStats, boosterStats] = await Promise.all([rocketStatsPromise, boosterStatsPromise]);
  const currentYear = new Date().getUTCFullYear();
  const providerAllTime = toNumberOrNull(launch.agencyLaunchAttemptCount);
  const providerYear = toNumberOrNull(launch.agencyLaunchAttemptCountYear);
  const padAllTime = toNumberOrNull(launch.padLaunchAttemptCount);
  const padYear = toNumberOrNull(launch.padLaunchAttemptCountYear);
  const rocketSuccessAllTime = rocketStats ? rocketStats.successAllTime : null;
  const rocketSuccessYear = rocketStats ? rocketStats.successYear : null;
  const rocketLabel = rocket?.fullName || launch.vehicle;

  const providerStory = buildStoryLine({
    subject: launch.provider,
    allTime: providerAllTime,
    year: providerYear,
    unit: 'launches',
    yearLabel: String(currentYear)
  });
  const rocketStory = buildStoryLine({
    subject: rocketLabel,
    allTime: rocketSuccessAllTime,
    year: rocketSuccessYear,
    unit: 'successful missions',
    yearLabel: String(currentYear)
  });
  const rocketStoryNode = linkifyStorySubject(rocketStory, rocketLabel, rocketHref);
  const padStory = buildStoryLine({
    subject: launch.pad.name,
    allTime: padAllTime,
    year: padYear,
    unit: 'launches from this pad',
    yearLabel: String(currentYear)
  });
  const bonusInsights = buildBonusInsights({ rocketStats, launch, year: currentYear });

  return (
    <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Launch story</div>
          <h2 className="text-xl font-semibold text-text1">Mission stats</h2>
          <p className="text-sm text-text3">Provider, rocket, pad, and booster history tied to this launch.</p>
        </div>
        <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
          {currentYear} snapshot
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <StoryStatCard
          eyebrow="Provider legacy"
          title={launch.provider}
          allTime={providerAllTime}
          year={providerYear}
          yearLabel={String(currentYear)}
          allTimeLabel="Lifetime launches"
          story={providerStory}
          accent="bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.3),_transparent_70%)]"
          barClass="bg-gradient-to-r from-cyan-400/70 via-sky-400/70 to-transparent"
        />
        <StoryStatCard
          eyebrow="Rocket track record"
          title={
            <Link href={rocketHref} className="transition hover:text-primary">
              {rocketLabel}
            </Link>
          }
          allTime={rocketSuccessAllTime}
          year={rocketSuccessYear}
          yearLabel={String(currentYear)}
          allTimeLabel="Successful missions"
          story={rocketStoryNode}
          accent="bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.28),_transparent_70%)]"
          barClass="bg-gradient-to-r from-emerald-400/70 via-lime-400/50 to-transparent"
        />
        <StoryStatCard
          eyebrow="Pad history"
          title={launch.pad.name}
          allTime={padAllTime}
          year={padYear}
          yearLabel={String(currentYear)}
          allTimeLabel="Pad launches"
          story={padStory}
          accent="bg-[radial-gradient(circle_at_top,_rgba(251,146,60,0.3),_transparent_70%)]"
          barClass="bg-gradient-to-r from-amber-400/70 via-orange-400/60 to-transparent"
        />
      </div>
      {bonusInsights.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {bonusInsights.map((insight) => (
            <BonusInsightCard key={insight.label} insight={insight} />
          ))}
        </div>
      )}
      {boosterStats.length > 0 && <BoosterMissionStatsGrid boosters={boosterStats} year={currentYear} />}
    </div>
  );
}

function StoryStatCard({
  eyebrow,
  title,
  allTime,
  year,
  yearLabel,
  allTimeLabel,
  story,
  accent,
  barClass
}: {
  eyebrow: string;
  title: ReactNode;
  allTime: number | null;
  year: number | null;
  yearLabel: string;
  allTimeLabel: string;
  story: ReactNode;
  accent: string;
  barClass: string;
}) {
  const sharePct = computeSharePct(year, allTime);
  const yearBadge = year != null ? `${formatCount(year)} in ${yearLabel}` : `${yearLabel} TBD`;
  const barWidth = sharePct != null ? `${sharePct}%` : '0%';

  return (
    <div className="relative overflow-hidden rounded-2xl border border-stroke bg-surface-0 p-4">
      <div className={`absolute inset-0 ${accent}`} />
      <div className="relative z-10 flex h-full flex-col gap-3">
        <div className="text-xs uppercase tracking-[0.08em] text-text3">{eyebrow}</div>
        <div className="text-base font-semibold text-text1">{title}</div>
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-3xl font-semibold text-text1">{formatCount(allTime)}</div>
            <div className="text-xs text-text3">{allTimeLabel}</div>
          </div>
          <div className="rounded-full border border-stroke bg-black/20 px-3 py-1 text-xs text-text2">{yearBadge}</div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full border border-stroke bg-black/20">
          <div className={`h-full ${barClass}`} style={{ width: barWidth }} />
        </div>
        <div className="text-xs text-text2">{story}</div>
      </div>
    </div>
  );
}

function BonusInsightCard({ insight }: { insight: BonusInsight }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-stroke bg-surface-0 p-4">
      <div className={`absolute inset-0 ${insight.accent}`} />
      <div className="relative z-10">
        <div className="text-xs uppercase tracking-[0.08em] text-text3">{insight.label}</div>
        <div className="mt-2 text-2xl font-semibold text-text1">{insight.value}</div>
        {insight.detail && <div className="mt-1 text-xs text-text2">{insight.detail}</div>}
      </div>
    </div>
  );
}

function BoosterMissionStatsGrid({
  boosters,
  year
}: {
  boosters: LaunchBoosterStats[];
  year: number;
}) {
  const boosterPalette = [
    {
      accent: 'bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.28),_transparent_70%)]',
      barClass: 'bg-gradient-to-r from-cyan-400/70 via-sky-400/70 to-transparent'
    },
    {
      accent: 'bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.24),_transparent_70%)]',
      barClass: 'bg-gradient-to-r from-emerald-400/70 via-lime-400/50 to-transparent'
    },
    {
      accent: 'bg-[radial-gradient(circle_at_top,_rgba(251,146,60,0.26),_transparent_70%)]',
      barClass: 'bg-gradient-to-r from-amber-400/70 via-orange-400/60 to-transparent'
    }
  ] as const;

  return (
    <div className="mt-4 rounded-2xl border border-stroke bg-surface-0 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Booster story</div>
          <h3 className="text-xl font-semibold text-text1">First-stage boosters</h3>
          <p className="text-sm text-text3">Core-level mission cadence associated with this launch.</p>
        </div>
        <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
          {boosters.length} core{boosters.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {boosters.map((booster, index) => {
          const serialLabel = booster.serialNumber || `Core ${booster.ll2LauncherId}`;
          const statusLabel = booster.status || 'Status unknown';
          const firstFlightLabel = formatDateOnlyLabel(booster.firstLaunchDate);
          const lastMissionLabel = booster.lastMissionNet
            ? formatDate(booster.lastMissionNet, 'UTC')
            : formatDateOnlyLabel(booster.lastLaunchDate);
          const flightProvenLabel =
            booster.flightProven === true
              ? 'Flight proven'
              : booster.flightProven === false
                ? 'Not flight proven'
                : 'Provenance unknown';
          const { accent, barClass } = boosterPalette[index % boosterPalette.length];

          return (
            <StoryStatCard
              key={booster.ll2LauncherId}
              eyebrow="Core history"
              title={
                <Link
                  href={`/catalog/launchers/${encodeURIComponent(String(booster.ll2LauncherId))}`}
                  className="transition hover:text-primary"
                >
                  {serialLabel}
                </Link>
              }
              allTime={booster.totalMissions}
              year={booster.missionsThisYear}
              yearLabel={String(year)}
              allTimeLabel="Total missions"
              story={
                <>
                  <span>
                    {statusLabel}. {flightProvenLabel}. Tracked {formatCount(booster.trackedMissions)} missions.
                  </span>
                  <span className="mt-1 block text-[11px] text-text3">First flight: {firstFlightLabel}</span>
                  <span className="block text-[11px] text-text3">Last mission: {lastMissionLabel}</span>
                </>
              }
              accent={accent}
              barClass={barClass}
            />
          );
        })}
      </div>
    </div>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text3">
      {label}
    </div>
  );
}

type LaunchTimelineView = {
  id: string;
  label: string;
  description?: string;
  relativeLabel?: string;
  absoluteLabel?: string;
  absoluteMs?: number | null;
  isNext: boolean;
  isPast: boolean;
};

type RelatedEventView = {
  id: number;
  name: string;
  typeName?: string;
  locationName?: string;
  description?: string;
  dateLabel?: string;
  dateMs?: number | null;
  url?: string;
  webcastLive?: boolean;
  isNext: boolean;
  isPast: boolean;
};

function buildLaunchTimelineEvents({
  launch,
  externalContent,
  timezone
}: {
  launch: Launch;
  externalContent: LaunchExternalContent[];
  timezone: string | null;
}): LaunchTimelineView[] {
  const netMs = Date.parse(launch.net);
  const events = buildLaunchMissionTimeline({
    ll2Timeline: Array.isArray(launch.timeline) ? launch.timeline : [],
    providerExternalContent: externalContent,
    includeFamilyTemplate: false
  })
    .map((event) => {
      const absoluteMs =
        Number.isFinite(netMs) && typeof event.offsetSeconds === 'number' && Number.isFinite(event.offsetSeconds)
          ? netMs + event.offsetSeconds * 1000
          : null;
      const absoluteLabel =
        absoluteMs != null ? formatDate(new Date(absoluteMs).toISOString(), timezone) : undefined;

      return {
        id: event.id,
        label: event.label,
        description: event.description || undefined,
        relativeLabel: event.time || undefined,
        absoluteLabel: absoluteLabel === 'none' ? undefined : absoluteLabel,
        absoluteMs,
        isNext: false,
        isPast: false
      } satisfies LaunchTimelineView;
    })
    .filter((event) => event.label);

  events.sort((a, b) => {
    if (a.absoluteMs == null && b.absoluteMs == null) return 0;
    if (a.absoluteMs == null) return 1;
    if (b.absoluteMs == null) return -1;
    return a.absoluteMs - b.absoluteMs;
  });

  return events.map((event) => ({
    ...event,
    isNext: false,
    isPast: false
  }));
}

function buildRelatedEventTimeline(events: RelatedEvent[], timezone: string | null): RelatedEventView[] {
  if (!events.length) return [];
  const now = Date.now();

  const mapped = events
    .map((event) => {
      const dateMs = event.date ? Date.parse(event.date) : NaN;
      const normalizedDateMs = Number.isFinite(dateMs) ? dateMs : null;
      const dateLabel = formatEventDate(event.date, event.date_precision, timezone);
      const description = trimEventDescription(event.description);

      return {
        id: event.ll2_event_id,
        name: event.name || 'Event',
        typeName: event.type_name || undefined,
        locationName: event.location_name || undefined,
        description,
        dateLabel,
        dateMs: normalizedDateMs,
        url: event.url || undefined,
        webcastLive: event.webcast_live ?? false,
        isNext: false,
        isPast: false
      } satisfies RelatedEventView;
    })
    .filter((event) => event.name);

  mapped.sort((a, b) => {
    const aMs = a.dateMs ?? Number.POSITIVE_INFINITY;
    const bMs = b.dateMs ?? Number.POSITIVE_INFINITY;
    return aMs - bMs;
  });

  const nextIndex = mapped.findIndex((event) => (event.dateMs ?? Number.POSITIVE_INFINITY) >= now);

  return mapped.map((event, index) => ({
    ...event,
    isNext: index === nextIndex && nextIndex >= 0,
    isPast: event.dateMs != null ? event.dateMs < now : false
  }));
}

function formatTimelineOffset(value: string, offsetMs: number | null): string {
  if (offsetMs == null) return value;
  const sign = offsetMs < 0 ? '-' : '+';
  const absMs = Math.abs(offsetMs);
  const totalSeconds = Math.round(absMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`;
  return `T${sign}${clock}`;
}

function formatEventDate(value?: string | null, precision?: string | null, timezone?: string | null) {
  if (!value) return 'TBD';
  if (precision && precision.toLowerCase() === 'tbd') return 'TBD';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'TBD';
  const zone = timezone || 'UTC';
  if (precision === 'day' || precision === 'month') {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: zone }).format(date);
  }
  return formatDate(value, zone);
}

function trimEventDescription(value?: string | null, limit = 160) {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit - 3).trimEnd()}...`;
}


function Info({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{label}</div>
      <div className="break-words text-sm text-text1">{value}</div>
    </div>
  );
}

function buildLaunchUpdateView(update: LaunchUpdateRow, timezone: string | null): LaunchUpdateView {
  const fields = update.changed_fields ?? [];
  return {
    id: String(update.id ?? `${update.launch_id}:${update.detected_at ?? ''}`),
    detectedAt: update.detected_at ?? null,
    detectedLabel: formatDetectedAt(update.detected_at, timezone),
    summary: summarizeChangedFields(fields),
    tags: buildUpdateTags(fields),
    details: buildChangeDetails({
      fields,
      oldValues: update.old_values ?? null,
      newValues: update.new_values ?? null,
      timezone
    })
  };
}

function formatDetectedAt(value: any, timezone: string | null) {
  const formatted = formatDate(value, timezone);
  return formatted === 'none' ? 'Unknown' : formatted;
}

function summarizeChangedFields(fields: string[]) {
  const normalized = new Set(fields.map((f) => f.toLowerCase()));
  const parts: string[] = [];
  const hasPrefix = (prefix: string) => Array.from(normalized).some((f) => f.startsWith(prefix));
  const hasAny = (keys: string[]) => keys.some((k) => normalized.has(k));

  if (hasAny(['status_abbrev', 'status_name', 'status_id'])) parts.push('Status updated');
  if (hasAny(['net', 'net_precision', 'window_start', 'window_end'])) parts.push('Timing updated');
  if (hasAny(['hold_reason', 'fail_reason'])) parts.push('Operations updated');
  if (hasAny(['video_url', 'webcast_live', 'hashtag', 'flightclub_url', 'pad_map_url', 'launch_info_urls', 'launch_vid_urls', 'mission_info_urls', 'mission_vid_urls'])) {
    parts.push('Links updated');
  }
  if (hasAny(['provider', 'provider_type', 'provider_country_code', 'provider_description', 'provider_logo_url', 'provider_image_url'])) {
    parts.push('Provider updated');
  }
  if (hasPrefix('pad_')) parts.push('Pad updated');
  if (hasPrefix('mission_')) parts.push('Mission updated');
  if (hasPrefix('rocket_')) parts.push('Rocket updated');
  if (hasAny(['programs', 'crew', 'payloads', 'timeline'])) parts.push('Details updated');
  if (hasPrefix('image_')) parts.push('Media updated');
  if (hasAny(['hidden', 'featured', 'tier_override', 'tier_auto'])) parts.push('Admin override');
  if (normalized.has('name')) parts.push('Name updated');
  return parts.length ? parts.join(' • ') : fields.length ? `Updated: ${fields.join(', ')}` : 'Updated';
}

function buildUpdateTags(fields: string[]) {
  const normalized = new Set(fields.map((f) => f.toLowerCase()));
  const hasPrefix = (prefix: string) => Array.from(normalized).some((f) => f.startsWith(prefix));
  const hasAny = (keys: string[]) => keys.some((k) => normalized.has(k));
  const tags: Array<{ label: string; tone: BadgeTone }> = [];
  if (hasAny(['status_abbrev', 'status_name', 'status_id'])) {
    tags.push({ label: 'Status', tone: 'success' });
  }
  if (hasAny(['net', 'net_precision', 'window_start', 'window_end'])) {
    tags.push({ label: 'Timing', tone: 'info' });
  }
  if (hasAny(['hold_reason', 'fail_reason'])) {
    tags.push({ label: 'Operations', tone: 'neutral' });
  }
  if (hasAny(['video_url', 'webcast_live', 'flightclub_url', 'launch_info_urls', 'launch_vid_urls', 'mission_info_urls', 'mission_vid_urls', 'pad_map_url'])) {
    tags.push({ label: 'Watch', tone: 'primary' });
  }
  if (hasPrefix('mission_')) {
    tags.push({ label: 'Mission', tone: 'neutral' });
  }
  if (hasPrefix('rocket_')) {
    tags.push({ label: 'Rocket', tone: 'neutral' });
  }
  if (hasPrefix('pad_')) {
    tags.push({ label: 'Pad', tone: 'neutral' });
  }
  if (hasAny(['provider', 'provider_type', 'provider_country_code', 'provider_description'])) {
    tags.push({ label: 'Provider', tone: 'neutral' });
  }
  if (hasAny(['programs', 'crew', 'payloads', 'timeline'])) {
    tags.push({ label: 'Details', tone: 'neutral' });
  }
  if (hasAny(['hidden', 'featured', 'tier_override', 'tier_auto'])) {
    tags.push({ label: 'Admin', tone: 'warning' });
  }
  if (normalized.has('name')) {
    tags.push({ label: 'Name', tone: 'neutral' });
  }
  if (!tags.length) {
    tags.push({ label: 'Update', tone: 'neutral' });
  }
  return tags;
}

function buildChangeDetails({
  fields,
  oldValues,
  newValues,
  timezone
}: {
  fields: string[];
  oldValues: Record<string, any> | null;
  newValues: Record<string, any> | null;
  timezone: string | null;
}) {
  const details: string[] = [];
  const normalized = new Set(fields.map((f) => f.toLowerCase()));
  const handled = new Set<string>();

  if (normalized.has('status_abbrev') || normalized.has('status_name') || normalized.has('status_id')) {
    details.push(`Status: ${formatSimple(pickStatus(oldValues))} -> ${formatSimple(pickStatus(newValues))}`);
    handled.add('status_abbrev');
    handled.add('status_name');
    handled.add('status_id');
  }

  if (normalized.has('net')) {
    details.push(`NET: ${formatDate(oldValues?.net, timezone)} -> ${formatDate(newValues?.net, timezone)}`);
    handled.add('net');
  }

  if (normalized.has('window_start')) {
    details.push(`Window start: ${formatDate(oldValues?.window_start, timezone)} -> ${formatDate(newValues?.window_start, timezone)}`);
    handled.add('window_start');
  }

  if (normalized.has('window_end')) {
    details.push(`Window end: ${formatDate(oldValues?.window_end, timezone)} -> ${formatDate(newValues?.window_end, timezone)}`);
    handled.add('window_end');
  }

  if (normalized.has('net_precision')) {
    details.push(`NET precision: ${formatSimple(oldValues?.net_precision)} -> ${formatSimple(newValues?.net_precision)}`);
    handled.add('net_precision');
  }

  if (normalized.has('video_url')) {
    details.push(`Watch link: ${formatUrl(oldValues?.video_url)} -> ${formatUrl(newValues?.video_url)}`);
    handled.add('video_url');
  }

  if (normalized.has('webcast_live')) {
    details.push(`Webcast live: ${formatBool(oldValues?.webcast_live)} -> ${formatBool(newValues?.webcast_live)}`);
    handled.add('webcast_live');
  }

  if (normalized.has('featured')) {
    details.push(`Featured: ${formatBool(oldValues?.featured)} -> ${formatBool(newValues?.featured)}`);
    handled.add('featured');
  }

  if (normalized.has('hidden')) {
    details.push(`Hidden: ${formatBool(oldValues?.hidden)} -> ${formatBool(newValues?.hidden)}`);
    handled.add('hidden');
  }

  if (normalized.has('tier_override')) {
    details.push(`Tier override: ${formatSimple(oldValues?.tier_override)} -> ${formatSimple(newValues?.tier_override)}`);
    handled.add('tier_override');
  }

  if (normalized.has('name')) {
    details.push(`Name: ${formatSimple(oldValues?.name)} -> ${formatSimple(newValues?.name)}`);
    handled.add('name');
  }

  if (normalized.has('mission_agencies')) {
    details.push(`Mission agencies: ${formatListSummary(oldValues?.mission_agencies, (a) => a?.name)} -> ${formatListSummary(newValues?.mission_agencies, (a) => a?.name)}`);
    handled.add('mission_agencies');
  }

  if (normalized.has('programs')) {
    details.push(`Programs: ${formatListSummary(oldValues?.programs, (p) => p?.name)} -> ${formatListSummary(newValues?.programs, (p) => p?.name)}`);
    handled.add('programs');
  }

  if (normalized.has('crew')) {
    details.push(`Crew: ${formatListSummary(oldValues?.crew, (c) => c?.astronaut)} -> ${formatListSummary(newValues?.crew, (c) => c?.astronaut)}`);
    handled.add('crew');
  }

  if (normalized.has('payloads')) {
    details.push(`Payloads: ${formatListSummary(oldValues?.payloads, (p) => p?.name)} -> ${formatListSummary(newValues?.payloads, (p) => p?.name)}`);
    handled.add('payloads');
  }

  if (normalized.has('timeline')) {
    details.push(`Timeline events: ${formatCountSummary(oldValues?.timeline)} -> ${formatCountSummary(newValues?.timeline)}`);
    handled.add('timeline');
  }

  if (normalized.has('mission_info_urls')) {
    details.push(`Mission info links: ${formatUrlListSummary(oldValues?.mission_info_urls)} -> ${formatUrlListSummary(newValues?.mission_info_urls)}`);
    handled.add('mission_info_urls');
  }

  if (normalized.has('mission_vid_urls')) {
    details.push(`Mission video links: ${formatUrlListSummary(oldValues?.mission_vid_urls)} -> ${formatUrlListSummary(newValues?.mission_vid_urls)}`);
    handled.add('mission_vid_urls');
  }

  if (normalized.has('launch_info_urls')) {
    details.push(`Launch info links: ${formatUrlListSummary(oldValues?.launch_info_urls)} -> ${formatUrlListSummary(newValues?.launch_info_urls)}`);
    handled.add('launch_info_urls');
  }

  if (normalized.has('launch_vid_urls')) {
    details.push(`Launch video links: ${formatUrlListSummary(oldValues?.launch_vid_urls)} -> ${formatUrlListSummary(newValues?.launch_vid_urls)}`);
    handled.add('launch_vid_urls');
  }

  fields.forEach((field) => {
    const key = field.toLowerCase();
    if (handled.has(key)) return;
    const oldValue = formatSimple(oldValues?.[field]);
    const newValue = formatSimple(newValues?.[field]);
    details.push(`${labelize(field)}: ${oldValue} -> ${newValue}`);
  });

  return details;
}

function pickStatus(values: Record<string, any> | null) {
  if (!values) return null;
  return values.status_abbrev || values.status_name || values.status_id || null;
}

function formatSimple(value: any) {
  if (value === null || value === undefined || value === '') return 'none';
  if (typeof value === 'string') return truncateString(value, 140);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'none';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    try {
      return truncateString(JSON.stringify(value), 140);
    } catch {
      return 'unavailable';
    }
  }
  return String(value);
}

function formatBool(value: any) {
  if (value === null || value === undefined) return 'none';
  return value ? 'yes' : 'no';
}

function formatDate(value: any, timezone: string | null) {
  if (!value) return 'none';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatSimple(value);
  const zone = timezone || 'America/New_York';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
    timeZoneName: 'short'
  }).format(date);
}

function formatDateOnlyLabel(value: string | null | undefined) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return '--';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return normalized;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(parsed);
}

function formatUrl(value: any) {
  if (!value) return 'none';
  const raw = String(value).trim();
  if (!raw) return 'none';
  try {
    const url = new URL(raw);
    const host = url.host.replace(/^www\\./, '');
    const path = url.pathname.length > 24 ? `${url.pathname.slice(0, 24)}...` : url.pathname;
    return `${host}${path}`;
  } catch {
    return raw.length > 32 ? `${raw.slice(0, 32)}...` : raw;
  }
}

function labelize(value: string) {
  return value.replace(/_/g, ' ').replace(/\\b\\w/g, (char) => char.toUpperCase());
}

function truncateString(value: string, limit: number) {
  const trimmed = String(value || '').trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function asArray(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function formatCountSummary(value: any) {
  const list = asArray(value);
  return list.length ? String(list.length) : 'none';
}

function formatListSummary(value: any, label: (item: any) => string | null | undefined, maxItems = 3) {
  const list = asArray(value);
  if (!list.length) return 'none';
  const names = list
    .map((item) => (typeof label(item) === 'string' ? String(label(item)).trim() : ''))
    .filter(Boolean);
  const unique = Array.from(new Set(names));
  if (!unique.length) return String(list.length);
  const preview = unique.slice(0, maxItems).join(', ');
  return unique.length > maxItems ? `${list.length} (${preview}…)` : `${list.length} (${preview})`;
}

function extractUrl(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'object') {
    const url = (value as any).url ?? (value as any).info_url ?? (value as any).wiki_url;
    if (typeof url === 'string' && url.trim()) return url.trim();
  }
  return null;
}

function formatUrlListSummary(value: any, maxHosts = 3) {
  const list = asArray(value);
  const urls = list.map(extractUrl).filter(Boolean) as string[];
  if (!urls.length) return 'none';
  const hosts = urls
    .map((raw) => {
      try {
        return new URL(raw).host.replace(/^www\\./, '');
      } catch {
        return null;
      }
    })
    .filter(Boolean) as string[];
  const uniqueHosts = Array.from(new Set(hosts));
  if (!uniqueHosts.length) return String(urls.length);
  const preview = uniqueHosts.slice(0, maxHosts).join(', ');
  return uniqueHosts.length > maxHosts ? `${urls.length} (${preview}…)` : `${urls.length} (${preview})`;
}

function formatNewsDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

function formatNewsSourceLabel(source?: string | null, url?: string | null) {
  if (source && source.trim().length > 0) return source.trim();
  if (!url) return 'Launch coverage';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Launch coverage';
  }
}

function formatNewsType(type: RelatedNewsItem['item_type']) {
  switch (type) {
    case 'blog':
      return 'Blog';
    case 'report':
      return 'Report';
    default:
      return 'Article';
  }
}

function formatAuthors(authors: RelatedNewsItem['authors']) {
  if (!Array.isArray(authors)) return null;
  const names = authors.map((a) => a?.name?.trim()).filter(Boolean) as string[];
  if (!names.length) return null;
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

function truncateText(value: string, maxChars: number) {
  if (!value) return '';
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 3).trim()}...`;
}

function toNumberOrNull(value?: number | null) {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatCount(value?: number | null) {
  const numeric = toNumberOrNull(value);
  if (numeric === null) return '--';
  return numeric.toLocaleString('en-US');
}

function computeSharePct(part?: number | null, total?: number | null) {
  const partValue = toNumberOrNull(part);
  const totalValue = toNumberOrNull(total);
  if (partValue === null || totalValue === null || totalValue <= 0) return null;
  const raw = (partValue / totalValue) * 100;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

function buildBonusInsights({
  rocketStats,
  launch,
  year
}: {
  rocketStats: RocketOutcomeStats | null;
  launch: Launch;
  year: number;
}) {
  const insights: BonusInsight[] = [];
  const reliability = buildReliabilityInsight(rocketStats, year);
  if (reliability) insights.push(reliability);
  const padTurnaround = buildPadTurnaroundInsight(launch.padTurnaround);
  if (padTurnaround) insights.push(padTurnaround);
  const windowInsight = buildWindowInsight(launch);
  if (windowInsight) insights.push(windowInsight);
  return insights.slice(0, 2);
}

function buildReliabilityInsight(stats: RocketOutcomeStats | null, year: number): BonusInsight | null {
  if (!stats) return null;
  const totalAllTime = stats.successAllTime + stats.failureAllTime;
  if (totalAllTime <= 0) return null;
  const allTimeRate = formatRate(stats.successAllTime, totalAllTime);
  const yearTotal = stats.successYear + stats.failureYear;
  const detail = yearTotal
    ? `${year}: ${formatRate(stats.successYear, yearTotal)} (${formatCount(stats.successYear)}/${formatCount(yearTotal)})`
    : `${year}: no completed missions yet`;
  return {
    label: 'Rocket reliability',
    value: `${allTimeRate} all time`,
    detail,
    accent: 'bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.2),_transparent_70%)]'
  };
}

function buildPadTurnaroundInsight(padTurnaround?: string | null): BonusInsight | null {
  if (!padTurnaround) return null;
  const formatted = formatPadTurnaround(padTurnaround);
  if (!formatted) return null;
  return {
    label: 'Pad turnaround',
    value: formatted,
    detail: 'Reported pad reuse cadence.',
    accent: 'bg-[radial-gradient(circle_at_top,_rgba(251,146,60,0.22),_transparent_70%)]'
  };
}

function buildWindowInsight(launch: Launch): BonusInsight | null {
  const windowLength = formatWindowLength(launch.windowStart, launch.windowEnd);
  return {
    label: 'Launch window',
    value: windowLength || 'TBD',
    detail: windowLength ? 'Planned window length for liftoff.' : 'Window length not published yet.',
    accent: 'bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.18),_transparent_70%)]'
  };
}

function formatRate(success: number, total: number) {
  if (total <= 0) return '0%';
  return `${Math.round((success / total) * 100)}%`;
}

function formatPadTurnaround(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = parseIsoDurationToMs(trimmed);
  if (ms == null) return trimmed;
  return formatDurationMs(ms);
}

function formatWindowLength(windowStart?: string | null, windowEnd?: string | null) {
  if (!windowStart || !windowEnd) return null;
  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return formatDurationMs(endMs - startMs);
}

function formatDurationMs(ms: number) {
  const totalSeconds = Math.round(Math.abs(ms) / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes && days === 0) parts.push(`${minutes}m`);
  if (!parts.length) parts.push(`${totalSeconds}s`);
  return parts.join(' ');
}

function buildStoryLine({
  subject,
  allTime,
  year,
  unit,
  yearLabel
}: {
  subject: string;
  allTime: number | null;
  year: number | null;
  unit: string;
  yearLabel: string;
}) {
  if (allTime != null && year != null) {
    return `${subject} has ${formatCount(allTime)} ${unit} on record, with ${formatCount(year)} in ${yearLabel}.`;
  }
  if (allTime != null) {
    return `${subject} has ${formatCount(allTime)} ${unit} on record.`;
  }
  if (year != null) {
    return `${subject} has ${formatCount(year)} ${unit} in ${yearLabel}.`;
  }
  return `Catalog counts for ${subject} are still loading.`;
}

function linkifyStorySubject(story: string, subject: string, href: string) {
  if (!subject || !href) return story;
  const index = story.indexOf(subject);
  if (index < 0) return story;
  const before = story.slice(0, index);
  const after = story.slice(index + subject.length);
  return (
    <>
      {before}
      <Link href={href} className="transition hover:text-primary">
        {subject}
      </Link>
      {after}
    </>
  );
}

function normalizeInfoLinks(primary?: LaunchInfoUrl[], secondary?: LaunchInfoUrl[]) {
  const items = [...(primary || []), ...(secondary || [])];
  const seen = new Set<string>();
  const normalized = [];
  for (const item of items) {
    const url = item?.url?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    normalized.push({
      url,
      label: item.title || item.source || item.type?.name || 'Mission info',
      meta: item.source || item.type?.name || 'Info'
    });
  }
  return normalized;
}

function normalizeVidLinks(primary?: LaunchVidUrl[], secondary?: LaunchVidUrl[]) {
  const items = [...(primary || []), ...(secondary || [])];
  const seen = new Set<string>();
  const normalized = [];
  for (const item of items) {
    const url = item?.url?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const imageUrl = typeof item?.feature_image === 'string' ? item.feature_image.trim() : '';
    normalized.push({
      url,
      label: item.title || item.publisher || item.source || 'Video',
      meta: item.type?.name || 'Video',
      imageUrl: imageUrl || undefined
    });
  }
  return normalized;
}

function buildLaunchPhotoEntries({
  launch,
  rocket
}: {
  launch: Launch;
  rocket: Launch['rocket'];
}): LaunchPhoto[] {
  const photos: LaunchPhoto[] = [];
  const seen = new Map<string, LaunchPhoto>();
  const launchImage = normalizeImageUrl(launch.image?.full) || normalizeImageUrl(launch.image?.thumbnail);
  const rocketImage = normalizeImageUrl(rocket?.imageUrl) || launchImage;
  const credit = launch.image?.credit?.trim() || undefined;
  const license = launch.image?.license?.trim() || undefined;
  const licenseUrl = launch.image?.licenseUrl?.trim() || undefined;
  const singleUse = launch.image?.singleUse ?? undefined;
  const rocketUsesLaunchImage = Boolean(launchImage) && (!rocketImage || rocketImage === launchImage);

  const add = (entry: LaunchPhoto) => {
    const rawUrl = entry.url?.trim();
    if (!rawUrl) return;
    const url = normalizeImageUrl(rawUrl) || rawUrl;
    const existing = seen.get(url);
    if (existing) {
      if (!existing.credit && entry.credit) existing.credit = entry.credit;
      if (!existing.license && entry.license) existing.license = entry.license;
      if (!existing.licenseUrl && entry.licenseUrl) existing.licenseUrl = entry.licenseUrl;
      if (existing.singleUse == null && entry.singleUse != null) existing.singleUse = entry.singleUse;
      return;
    }
    const normalized: LaunchPhoto = { ...entry, url };
    photos.push(normalized);
    seen.set(url, normalized);
  };

  if (rocketImage) {
    add({
      label: 'Rocket',
      url: rocketImage,
      ...(rocketUsesLaunchImage
        ? {
            credit,
            license,
            licenseUrl,
            singleUse
          }
        : {})
    });
  }

  if (launchImage) {
    add({
      label: 'Launch',
      url: launchImage,
      credit,
      license,
      licenseUrl,
      singleUse
    });
  }

  const manufacturerImageUrl = normalizeImageUrl(rocket?.manufacturerImageUrl);
  if (manufacturerImageUrl) {
    add({ label: 'Manufacturer', url: manufacturerImageUrl });
  }

  const providerImageUrl = normalizeImageUrl(launch.providerImageUrl);
  if (providerImageUrl) {
    add({ label: 'Provider', url: providerImageUrl });
  }

  return photos;
}

type WatchLinkView = { url: string; label: string; meta: string; host: string; imageUrl?: string };

function buildWatchLinks(
  primaryUrl: string | undefined,
  vidLinks: Array<{ url: string; label: string; meta: string; imageUrl?: string }>
): WatchLinkView[] {
  const normalizedPrimary = primaryUrl?.trim();
  const links: WatchLinkView[] = [];
  const linksByUrl = new Map<string, WatchLinkView>();

  const add = (entry: { url: string; label: string; meta: string; imageUrl?: string }) => {
    const url = entry.url.trim();
    if (!url) return;
    const host = formatLinkHost(url);
    const imageUrl = entry.imageUrl?.trim() || buildLaunchVideoEmbed(url)?.thumbnailUrl || undefined;
    const existing = linksByUrl.get(url);
    if (existing) {
      if (!existing.imageUrl && imageUrl) existing.imageUrl = imageUrl;
      if (existing.label === 'Watch coverage' && entry.label) existing.label = entry.label;
      if (existing.meta === 'Live/Replay' && entry.meta) existing.meta = entry.meta;
      return;
    }
    const next = { ...entry, url, host, imageUrl: imageUrl || undefined };
    linksByUrl.set(url, next);
    links.push(next);
  };

  if (normalizedPrimary) {
    add({ url: normalizedPrimary, label: 'Watch coverage', meta: 'Live/Replay' });
  }

  vidLinks.forEach(add);

  return links;
}

function formatLinkHost(url: string) {
  try {
    return new URL(url).host.replace(/^www\\./, '');
  } catch {
    return 'External';
  }
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function normalizeMeaningfulText(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;

  const lower = normalized.toLowerCase();
  if (lower === 'unknown' || lower === 'tbd' || lower === 'n/a' || lower === 'na' || lower === 'none') {
    return null;
  }

  return normalized;
}

function isLikelyBlueOriginEnhancementCrewName(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return false;
  if (/\b(ns-\d+|mission|launch|flight|payload)\b/i.test(normalized)) return false;
  if (normalized.length < 2 || normalized.length > 90) return false;
  if (BLUE_ORIGIN_NOISE_PASSENGER_TOKEN.test(normalized)) return false;
  if (!/[A-Za-z]/.test(normalized)) return false;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6) return false;

  return words.some((word) => /^[A-Z][A-Za-z.'’-]*$/.test(word));
}

function isLikelyBlueOriginEnhancementPayloadName(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return false;
  if (normalized.length < 3 || normalized.length > 90) return false;
  if (BLUE_ORIGIN_NOISE_PAYLOAD_TOKEN.test(normalized)) return false;
  if (!/[A-Za-z]/.test(normalized)) return false;
  if (normalized.split(/\s+/).filter(Boolean).length > 8) return false;

  return true;
}

function getBlueOriginEnhancementFactValue(
  blueOriginEnhancements: BlueOriginLaunchEnhancements | null,
  factKey: string
) {
  const normalizedFactKey = normalizeOptionalText(factKey);
  if (!normalizedFactKey) return null;

  const normalizedFactKeyWithSpaces = normalizedFactKey.replace(/_/g, ' ').toLowerCase();
  const normalizedFactKeyValue = normalizedFactKey.toLowerCase();

  const facts = blueOriginEnhancements?.facts || [];
  const values = facts
    .map((fact) => {
      const key = normalizeOptionalText(fact.key)?.toLowerCase() || '';
      const label = normalizeOptionalText(fact.label)?.toLowerCase() || '';
      if (key !== normalizedFactKeyValue && label !== normalizedFactKeyWithSpaces) return null;
      return normalizeOptionalText(fact.value);
    })
    .filter((value): value is string => Boolean(value));

  let resolved: string | null = null;
  for (const value of values) {
    resolved = pickRicherText(resolved, value);
  }
  return resolved;
}

function resolveBlueOriginEnhancementText(
  enhancementText: string | null | undefined,
  fallbackText: string | null | undefined
) {
  const enhancement = normalizeOptionalText(enhancementText);
  if (enhancement) return enhancement;
  return normalizeOptionalText(fallbackText);
}

function normalizeExternalUrl(value: unknown) {
  const normalized = normalizeOptionalText(typeof value === 'string' ? value : null);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

const isLikelyReachableBlueOriginSourceUrl = cache(async (url: string) => {
  const normalizedUrl = normalizeExternalUrl(url);
  if (!normalizedUrl) return false;

  const runProbe = async (method: 'HEAD' | 'GET') => {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort('blue_origin_source_probe_timeout'),
      BLUE_ORIGIN_EXTERNAL_SOURCE_TIMEOUT_MS
    );
    try {
      return await fetch(normalizedUrl, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': BLUE_ORIGIN_MISSION_GRAPHICS_USER_AGENT
        },
        next: { revalidate: 60 * 60 * 12 }
      });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  try {
    let response = await runProbe('HEAD');
    if (response.status === 405 || response.status === 501) {
      response = await runProbe('GET');
    }

    if (response.ok) return true;
    if (BLUE_ORIGIN_EXTERNAL_SOURCE_INVALID_STATUS_CODES.has(response.status)) return false;
    return false;
  } catch {
    // Strict gating: hide links unless we can verify they are reachable.
    return false;
  }
});

async function sanitizeBlueOriginMissionArtifacts(
  artifacts: ReturnType<typeof getBlueOriginMissionArtifacts> | null,
  verifiedMissionUrl: string | null
) {
  if (!artifacts) return null;

  const patchProductUrl = artifacts.patchProductUrl
    ? (await isLikelyReachableBlueOriginSourceUrl(artifacts.patchProductUrl))
      ? artifacts.patchProductUrl
      : undefined
    : undefined;

  const patchImageUrl = normalizeExternalUrl(artifacts.patchImageUrl || null) || undefined;
  const missionUrl = verifiedMissionUrl || null;
  if (!missionUrl) return null;

  return {
    ...artifacts,
    missionUrl,
    patchProductUrl,
    patchImageUrl
  };
}

async function sanitizeBlueOriginExternalLinks(
  links: Array<{ url: string; label: string; meta: string }>
) {
  if (!links.length) return links;

  const uniqueUrls = [
    ...new Set(links.map((link) => normalizeExternalUrl(link.url)).filter((url): url is string => Boolean(url)))
  ];

  const urlValidity = new Map<string, boolean>();
  await Promise.all(
    uniqueUrls.map(async (url) => {
      urlValidity.set(url, await isLikelyReachableBlueOriginSourceUrl(url));
    })
  );

  return links
    .map((link) => {
      const normalizedUrl = normalizeExternalUrl(link.url);
      if (!normalizedUrl) return null;
      if (!urlValidity.get(normalizedUrl)) return null;
      return { ...link, url: normalizedUrl };
    })
    .filter((value): value is { url: string; label: string; meta: string } => Boolean(value));
}

async function sanitizeBlueOriginTravelerProfiles(
  travelers: BlueOriginTravelerProfile[]
) {
  if (!travelers.length) return travelers;

  const profileUrlValidity = new Map<string, boolean>();
  const profileUrls = [
    ...new Set(
      travelers
        .map((traveler) => normalizeExternalUrl(traveler.profileUrl))
        .filter((url): url is string => Boolean(url))
    )
  ];
  await Promise.all(
    profileUrls.map(async (url) => {
      profileUrlValidity.set(url, await isLikelyReachableBlueOriginSourceUrl(url));
    })
  );

  return travelers.map((traveler) => {
    const profileUrl = normalizeExternalUrl(traveler.profileUrl);
    if (!profileUrl) return traveler;
    if (profileUrlValidity.get(profileUrl)) return traveler;
    return { ...traveler, profileUrl: null };
  });
}

async function sanitizeBlueOriginLaunchEnhancements(
  enhancements: BlueOriginLaunchEnhancements | null
) {
  if (!enhancements) return null;

  const candidateUrls = new Set<string>();
  const collect = (value: string | null | undefined) => {
    const normalized = normalizeExternalUrl(value);
    if (normalized) candidateUrls.add(normalized);
  };

  for (const sourcePage of enhancements.sourcePages) {
    collect(sourcePage.canonicalUrl);
    collect(sourcePage.url);
    collect(sourcePage.archiveSnapshotUrl);
  }
  for (const passenger of enhancements.passengers) collect(passenger.sourceUrl);
  for (const payload of enhancements.payloads) collect(payload.sourceUrl);
  for (const fact of enhancements.facts) collect(fact.sourceUrl);

  const urlValidity = new Map<string, boolean>();
  await Promise.all(
    [...candidateUrls].map(async (url) => {
      urlValidity.set(url, await isLikelyReachableBlueOriginSourceUrl(url));
    })
  );
  const resolveIfValid = (value: string | null | undefined) => {
    const normalized = normalizeExternalUrl(value);
    if (!normalized) return null;
    return urlValidity.get(normalized) ? normalized : null;
  };

  const sourcePages = enhancements.sourcePages
    .map((page) => {
      const canonicalUrl = resolveIfValid(page.canonicalUrl);
      const url = resolveIfValid(page.url);
      const archiveSnapshotUrl = resolveIfValid(page.archiveSnapshotUrl);
      const resolvedUrl = canonicalUrl || url || archiveSnapshotUrl;
      if (!resolvedUrl) return null;
      return {
        ...page,
        url: resolvedUrl,
        canonicalUrl: canonicalUrl || null,
        archiveSnapshotUrl
      };
    })
    .filter((value): value is BlueOriginEnhancementSourcePage => Boolean(value));

  const passengers = enhancements.passengers.map((passenger) => ({
    ...passenger,
    sourceUrl: resolveIfValid(passenger.sourceUrl)
  }));
  const payloads = enhancements.payloads.map((payload) => ({
    ...payload,
    sourceUrl: resolveIfValid(payload.sourceUrl)
  }));
  const facts = enhancements.facts.map((fact) => ({
    ...fact,
    sourceUrl: resolveIfValid(fact.sourceUrl)
  }));

  return {
    ...enhancements,
    sourcePages,
    passengers,
    payloads,
    facts
  };
}

function withBlueOriginMissionSourceFallback(
  enhancements: BlueOriginLaunchEnhancements | null,
  missionSourceUrl: string | null
) {
  if (!enhancements) return enhancements;
  const normalizedMissionUrl = normalizeExternalUrl(missionSourceUrl);
  if (!normalizedMissionUrl) return enhancements;

  const hasMissionSource = enhancements.sourcePages.some((page) => {
    const candidates = [page.canonicalUrl, page.url, page.archiveSnapshotUrl];
    return candidates.some((value) => normalizeExternalUrl(value) === normalizedMissionUrl);
  });
  if (hasMissionSource) return enhancements;

  const fallbackSource: BlueOriginEnhancementSourcePage = {
    url: normalizedMissionUrl,
    canonicalUrl: normalizedMissionUrl,
    archiveSnapshotUrl: null,
    provenance: 'live',
    title: 'Blue Origin mission page',
    fetchedAt: null
  };

  return {
    ...enhancements,
    sourcePages: [fallbackSource, ...enhancements.sourcePages]
  };
}

function pickLongerText(current: string | null, next: string | null) {
  if (!next) return current;
  if (!current) return next;
  return next.length > current.length ? next : current;
}

function pickRicherText(
  current: string | null,
  next: string | null,
  genericValues: string[] = ['unknown', 'tbd', 'n/a']
) {
  if (!next) return current;
  if (!current) return next;

  const currentValue = current.trim();
  const nextValue = next.trim();
  if (!currentValue) return nextValue || null;
  if (!nextValue) return currentValue || null;

  const currentNormalized = currentValue.toLowerCase();
  const nextNormalized = nextValue.toLowerCase();
  const generic = new Set(genericValues.map((value) => value.toLowerCase()));
  const currentIsGeneric = generic.has(currentNormalized);
  const nextIsGeneric = generic.has(nextNormalized);

  if (currentIsGeneric && !nextIsGeneric) return nextValue;
  if (!currentIsGeneric && nextIsGeneric) return currentValue;
  if (nextValue.length > currentValue.length) return nextValue;
  return currentValue;
}

function formatMissionFactLabel(key: string | null) {
  const normalizedKey = normalizeOptionalText(key);
  if (!normalizedKey) return 'Mission Fact';
  return normalizedKey
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .map((token) => (token ? token.charAt(0).toUpperCase() + token.slice(1).toLowerCase() : token))
    .join(' ');
}

function formatBlueOriginSourcePageLabel(url: string) {
  const normalized = normalizeOptionalText(url);
  if (!normalized) return 'Source page';
  try {
    const parsed = new URL(normalized);
    const path = parsed.pathname.replace(/\/+$/g, '');
    if (!path || path === '/') return formatLinkHost(normalized);
    return path
      .split('/')
      .filter(Boolean)
      .slice(-2)
      .join(' / ')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  } catch {
    return normalized;
  }
}

function normalizeComparableUrl(url: string | null | undefined) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    const normalizedHost = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const normalizedPath = parsed.pathname.replace(/\/+$/g, '') || '/';
    return `${parsed.protocol}//${normalizedHost}${normalizedPath}${parsed.search}`;
  } catch {
    return null;
  }
}

function buildExternalLinks({
  watch,
  flightclub,
  padMap,
  padMapLabel,
  rocketInfo,
  rocketWiki,
  infoLinks,
  vidLinks
}: {
  watch?: string;
  flightclub?: string;
  padMap?: string;
  padMapLabel?: string;
  rocketInfo?: string;
  rocketWiki?: string;
  infoLinks: Array<{ url: string; label: string; meta: string }>;
  vidLinks: Array<{ url: string; label: string; meta: string }>;
}) {
  const links = new Map<string, { url: string; label: string; meta: string }>();
  const add = (entry: { url: string; label: string; meta: string }) => {
    const normalizedUrl = normalizeExternalUrl(entry.url) || entry.url.trim();
    if (!normalizedUrl) return;

    const existing = links.get(normalizedUrl);
    if (existing) {
      if (existing.label === 'Watch coverage' && entry.label) existing.label = entry.label;
      if (existing.meta === 'Live/Replay' && entry.meta) existing.meta = entry.meta;
      return;
    }

    links.set(normalizedUrl, { ...entry, url: normalizedUrl });
  };

  if (watch) add({ url: watch, label: 'Watch coverage', meta: 'Live/Replay' });
  if (flightclub) add({ url: flightclub, label: 'Trajectory (FlightClub)', meta: 'Trajectory' });
  if (padMap) {
    const isSatelliteMap = Boolean(padMapLabel && padMapLabel.toLowerCase().includes('satellite'));
    add({ url: padMap, label: padMapLabel || 'Pad map', meta: isSatelliteMap ? 'Satellite' : 'Location' });
  }
  if (rocketInfo) add({ url: rocketInfo, label: 'Rocket info', meta: 'Vehicle' });
  if (rocketWiki) add({ url: rocketWiki, label: 'Rocket wiki', meta: 'Reference' });
  infoLinks.forEach(add);
  vidLinks.forEach(add);
  return [...links.values()];
}

function LaunchDetailArTrajectoryCard({
  description,
  generatedAt,
  actionLabel,
  disabled = false
}: {
  description: string;
  generatedAt: string | null;
  actionLabel: string;
  disabled?: boolean;
}) {
  const generatedAtLabel = formatArTrajectoryGeneratedAt(generatedAt);

  return (
    <div
      className={clsx(
        'rounded-2xl border p-4 transition',
        disabled
          ? 'border-stroke bg-surface-1 opacity-70'
          : 'border-primary/30 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.14),_rgba(11,16,35,0.92)_70%)] hover:border-primary/60'
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">AR trajectory</div>
          <h2 className="mt-1 text-xl font-semibold text-text1">Launch camera guide</h2>
          <p className="mt-2 max-w-3xl text-sm text-text3">{description}</p>
        </div>
        <TrajectoryBadgeIcon className={clsx('h-5 w-5', disabled ? 'text-text4' : 'text-primary')} />
      </div>

      {generatedAtLabel && (
        <p className="mt-3 text-sm text-text3">Latest trajectory package generated {generatedAtLabel}.</p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
        <span className={clsx('text-sm font-semibold', disabled ? 'text-text3' : 'text-primary')}>{actionLabel}</span>
        {!disabled ? <ArrowUpRightIcon className="h-4 w-4 text-primary transition group-hover:translate-x-0.5" /> : null}
      </div>
    </div>
  );
}

function shouldShowLaunchDetailArTrajectoryCard(arTrajectory: ArTrajectorySummaryV1, canUseArTrajectory: boolean) {
  return canUseArTrajectory || arTrajectory.availabilityReason !== 'not_eligible';
}

function getLaunchDetailArTrajectoryAction(arTrajectory: ArTrajectorySummaryV1, canUseArTrajectory: boolean) {
  if (!canUseArTrajectory) {
    return { label: 'Upgrade for AR', disabled: false };
  }

  if (arTrajectory.availabilityReason === 'not_eligible') {
    return { label: 'AR unavailable', disabled: true };
  }

  if (arTrajectory.availabilityReason === 'trajectory_missing' || !arTrajectory.hasTrajectory) {
    return { label: 'Trajectory pending', disabled: true };
  }

  return { label: 'Open AR trajectory', disabled: false };
}

function buildLaunchDetailArTrajectoryDescription(arTrajectory: ArTrajectorySummaryV1, canUseArTrajectory: boolean) {
  if (!canUseArTrajectory) {
    return arTrajectory.hasTrajectory
      ? 'Premium unlocks the AR trajectory experience for this launch.'
      : 'Premium unlocks AR trajectory when an eligible launch package is ready.';
  }

  if (arTrajectory.availabilityReason === 'not_eligible') {
    return 'This launch is outside the current AR-eligible program window, so AR trajectory stays locked out.';
  }

  if (arTrajectory.availabilityReason === 'trajectory_missing') {
    return 'This launch is AR-eligible, but the premium trajectory package has not been published yet.';
  }

  if (arTrajectory.qualityState === 'precision') {
    return 'Precision-grade AR is ready with full trajectory guidance and milestone overlays.';
  }

  if (arTrajectory.qualityState === 'safe_corridor') {
    return 'Safe-corridor AR is ready with guided trajectory bounds and milestone overlays.';
  }

  return 'Guide-only AR is ready. Precision lock-on stays disabled until directional confidence improves.';
}

function formatArTrajectoryGeneratedAt(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function BackArrowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true" fill="none">
      <path d="M13.5 4.5 8 10l5.5 5.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowUpRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true" fill="none">
      <path d="M6 14 14 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8 6h6v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrajectoryBadgeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <path
        d="M4.5 8.5V5.5h3M19.5 8.5V5.5h-3M4.5 15.5v3h3M19.5 15.5v3h-3"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      />
      <path d="M7.5 15.5c2.1-5.2 5-8 8.8-8.6 1.1-.2 2.3-.2 3.7.1" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
      <path d="m18.25 5.85 2.2 1.35-1.45 2.15" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="11.2" cy="11.9" r="1.45" fill="currentColor" />
    </svg>
  );
}

function buildTimelineNodes(rows: Array<Record<string, any>>, currentLaunch: Launch): TimelineNode[] {
  const nodes = rows.map((row) => mapTimelineRow(row, currentLaunch.id));
  if (!nodes.find((node) => node.id === currentLaunch.id)) {
    nodes.push(mapTimelineFromLaunch(currentLaunch));
  }
  const unique = new Map<string, TimelineNode>();
  for (const node of nodes) {
    unique.set(node.id, node);
  }
  return [...unique.values()].sort((a, b) => {
    const aTime = new Date(a.date).getTime();
    const bTime = new Date(b.date).getTime();
    return (Number.isNaN(aTime) ? 0 : aTime) - (Number.isNaN(bTime) ? 0 : bTime);
  });
}

function mapTimelineRow(row: Record<string, any>, currentId: string): TimelineNode {
  const statusLabel = String(row.status_abbrev || row.status_name || '').trim() || undefined;
  return {
    id: String(row.launch_id || ''),
    date: row.net || '',
    status: inferTimelineStatus(statusLabel, row.net),
    vehicleName: row.rocket_full_name || row.vehicle || 'Unknown',
    missionName: row.mission_name || row.name || 'Launch',
    isCurrent: String(row.launch_id || '') === currentId,
    statusLabel
  };
}

function mapTimelineFromLaunch(launch: Launch): TimelineNode {
  return {
    id: launch.id,
    date: launch.net,
    status: inferTimelineStatus(launch.statusText, launch.net),
    vehicleName: launch.rocket?.fullName || launch.vehicle || 'Unknown',
    missionName: launch.mission?.name || launch.name || 'Launch',
    isCurrent: true,
    statusLabel: launch.statusText
  };
}

function inferTimelineStatus(statusLabel?: string, netIso?: string): TimelineNode['status'] {
  const label = (statusLabel || '').toLowerCase();
  if (label.includes('success')) return 'success';
  if (label.includes('failure') || label.includes('fail') || label.includes('scrub') || label.includes('abort')) {
    return 'failure';
  }
  if (label.includes('hold') || label.includes('tbd') || label.includes('go')) return 'upcoming';
  if (netIso) {
    const netTime = new Date(netIso).getTime();
    if (!Number.isNaN(netTime) && netTime > Date.now()) return 'upcoming';
  }
  return 'failure';
}

function buildVehicleOrFilter(values: string[]) {
  if (!values.length) return '';
  const unique = Array.from(new Set(values));
  const clauses = unique.flatMap((value) => {
    const escaped = escapeOrValue(value);
    return [`vehicle.eq.${escaped}`, `rocket_full_name.eq.${escaped}`];
  });
  return clauses.join(',');
}

function escapeOrValue(value: string) {
  const escaped = value.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function classifyLaunchOutcome(statusName?: string | null, statusAbbrev?: string | null) {
  const combined = `${statusName ?? ''} ${statusAbbrev ?? ''}`.toLowerCase();
  const isSuccess = combined.includes('success') || combined.includes('successful');
  const isFailure = combined.includes('fail') || combined.includes('anomaly') || combined.includes('partial');
  return { isSuccess: isSuccess && !isFailure, isFailure };
}
