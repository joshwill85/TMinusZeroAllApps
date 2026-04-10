import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting, readStringArraySetting, readStringSetting } from '../_shared/settings.ts';
import {
  DEFAULT_JEP_V6_MODEL_VERSION,
  buildJepV6FeatureSnapshotInputHash,
  deriveJepV6ObserverFeatureCell
} from '../../../apps/web/lib/jep/v6Foundation.ts';
import {
  JEP_V6_BACKGROUND_FEATURE_FAMILY,
  computeJepV6AnthropogenicFactor,
  computeJepV6BackgroundFactor
} from '../../../apps/web/lib/jep/v6Background.ts';
import {
  JEP_V6_SHADOW_SCORE_FAMILY,
  computeJepV6ShadowScore,
  type JepV6BackgroundInput,
  type JepV6HorizonInput,
  type JepV6RepresentativeCorridor
} from '../../../apps/web/lib/jep/v6Score.ts';
import {
  DEFAULT_JEP_V6_HORIZON_CORRIDOR_HALF_WIDTH_DEG,
  JEP_V6_HORIZON_FEATURE_FAMILY,
  computeJepV6LocalHorizonFactor,
  normalizeJepV6HorizonProfiles,
  summarizeJepV6HorizonCorridor
} from '../../../apps/web/lib/jep/v6Horizon.ts';
import {
  JEP_V6_MOON_FEATURE_FAMILY,
  angularSeparationDeg,
  circularMeanDeg,
  computeJepV6MoonFactor
} from '../../../apps/web/lib/jep/v6Moon.ts';
import {
  JEP_V6_VEHICLE_PRIOR_FEATURE_FAMILY,
  JEP_V6_VEHICLE_PRIOR_SOURCE_KEY,
  resolveJepV6VehiclePrior,
  type JepV6MissionProfileInput,
  type JepV6ResolvedVehiclePrior,
  type JepV6VehiclePriorRow
} from '../../../apps/web/lib/jep/v6VehiclePriors.ts';
import { deriveBlackMarblePeriod } from '../_shared/jepBlackMarble.ts';
import { computeJepScoreRecord, intervalMinutesForLaunch, type JepComputedScore } from '../../../apps/web/lib/jep/serverShared.ts';
import {
  combineJepWeatherFactors,
  computeJepCloudObstructionFactor,
  computeJepWeatherContrastFactor,
  computeJepWeatherFactor,
  deriveJepCloudObstructionImpact,
  deriveJepWeatherContrastImpact
} from '../../../apps/web/lib/jep/weather.ts';

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';
const NWS_BASE = 'https://api.weather.gov';
const NWS_USER_AGENT = Deno.env.get('NWS_USER_AGENT') || 'TMinusZero/0.1 (support@tminuszero.app)';
const EARTH_RADIUS_KM = 6371;
const SHADOW_H0_KM = 12;
const RE_KM = 6371;
const PAD_OBSERVER_HASH = 'pad';
const LOS_ELEVATION_THRESHOLD_DEG = 5;
const SNAPSHOT_LOCK_LOOKBACK_HOURS = 24;
const POST_LAUNCH_COMPUTE_GRACE_HOURS = 2;
const NWS_POINTS_CACHE_HOURS = 24;
const MOON_SAMPLE_MAX_DIFF_MS = 5 * 60 * 1000;

const DEFAULTS = {
  enabled: true,
  horizonDays: 16,
  maxLaunchesPerRun: 120,
  weatherCacheMinutes: 10,
  modelVersion: 'jep_v5',
  v6FeatureSnapshotsEnabled: false,
  v6MoonFeatureSnapshotsEnabled: false,
  v6BackgroundFeatureSnapshotsEnabled: false,
  v6VehiclePriorFeatureSnapshotsEnabled: false,
  v6HorizonFeatureSnapshotsEnabled: false,
  v6HorizonEnabled: false,
  horizonCorridorHalfWidthDeg: DEFAULT_JEP_V6_HORIZON_CORRIDOR_HALF_WIDTH_DEG,
  openMeteoUsModels: ['best_match', 'gfs_seamless'],
  observerLookbackDays: 14,
  observerRegistryLimit: 128,
  maxObserversPerLaunch: 12,
  maxObserverDistanceKm: 1800
};

const SETTINGS_KEYS = [
  'jep_score_job_enabled',
  'jep_score_horizon_days',
  'jep_score_max_launches_per_run',
  'jep_score_weather_cache_minutes',
  'jep_score_model_version',
  'jep_v6_feature_snapshots_enabled',
  'jep_v6_moon_feature_snapshots_enabled',
  'jep_v6_background_feature_snapshots_enabled',
  'jep_v6_vehicle_prior_feature_snapshots_enabled',
  'jep_v6_horizon_feature_snapshots_enabled',
  'jep_v6_shadow_enabled',
  'jep_v6_horizon_enabled',
  'jep_v6_model_version',
  'jep_horizon_corridor_half_width_deg',
  'jep_score_open_meteo_us_models',
  'jep_score_observer_lookback_days',
  'jep_score_observer_registry_limit',
  'jep_score_max_observers_per_launch',
  'jep_score_max_observer_distance_km'
];

type LaunchRow = {
  launch_id: string;
  net: string | null;
  net_precision: string | null;
  status_name: string | null;
  status_abbrev: string | null;
  pad_latitude: number | null;
  pad_longitude: number | null;
  pad_country_code: string | null;
  pad_state: string | null;
  mission_orbit: string | null;
  provider: string | null;
  vehicle: string | null;
  rocket_full_name: string | null;
  rocket_family: string | null;
  ll2_rocket_config_id: number | null;
};

type ScoreRow = {
  launch_id: string;
  observer_location_hash: string | null;
  input_hash: string;
  computed_at: string | null;
  expires_at: string | null;
  snapshot_at: string | null;
};

type CandidateScoreRow = {
  launch_id: string;
  observer_location_hash: string | null;
  model_version: string;
  input_hash: string;
  computed_at: string | null;
  expires_at: string | null;
  snapshot_at: string | null;
};

type FeatureSnapshotRow = {
  launch_id: string;
  observer_location_hash: string;
  observer_feature_key: string;
  observer_lat_bucket: number | null;
  observer_lon_bucket: number | null;
  feature_family: string;
  model_version: string;
  input_hash: string;
  trajectory_input_hash: string | null;
  source_refs: Array<Record<string, unknown>>;
  feature_payload: Record<string, unknown>;
  confidence_payload: Record<string, unknown>;
  computed_at: string;
  expires_at: string | null;
  snapshot_at: string | null;
  updated_at: string;
};

type MoonEphemerisRow = {
  launch_id: string;
  observer_location_hash: string;
  sample_at: string;
  sample_offset_sec: number | null;
  source_key: string | null;
  source_version_id: number | null;
  source_fetch_run_id: number | null;
  qa_source_key: string | null;
  qa_version_id: number | null;
  qa_fetch_run_id: number | null;
  moon_az_deg: number | null;
  moon_el_deg: number | null;
  moon_illum_frac: number | null;
  moon_phase_name: string | null;
  moon_phase_angle_deg: number | null;
  moonrise_utc: string | null;
  moonset_utc: string | null;
  metadata: Record<string, unknown> | null;
  confidence_payload: Record<string, unknown> | null;
};

type BackgroundLightRow = {
  observer_feature_key: string;
  source_key: string | null;
  source_version_id: number | null;
  source_fetch_run_id: number | null;
  product_key: string | null;
  period_start_date: string | null;
  period_end_date: string | null;
  radiance_dataset: string | null;
  radiance_nw_cm2_sr: number | null;
  radiance_log: number | null;
  radiance_stddev_nw_cm2_sr: number | null;
  radiance_observation_count: number | null;
  quality_code: number | null;
  land_water_code: number | null;
  radiance_percentile: number | null;
  s_anthro: number | null;
  metadata: Record<string, unknown> | null;
  confidence_payload: Record<string, unknown> | null;
  updated_at: string | null;
};

type HorizonMaskRow = {
  observer_feature_key: string;
  observer_lat_bucket: number | null;
  observer_lon_bucket: number | null;
  observer_cell_deg: number | null;
  azimuth_step_deg: number | null;
  terrain_mask_profile: unknown;
  building_mask_profile: unknown;
  total_mask_profile: unknown;
  dominant_source_profile: unknown;
  dominant_distance_m_profile: unknown;
  dem_source_key: string | null;
  dem_source_version_id: number | null;
  dem_release_id: string | null;
  building_source_key: string | null;
  building_source_version_id: number | null;
  building_release_id: string | null;
  metadata: Record<string, unknown> | null;
  confidence_payload: Record<string, unknown> | null;
  computed_at: string | null;
  updated_at: string | null;
};

type VehiclePriorRow = JepV6VehiclePriorRow;

type DueLaunch = {
  launch: LaunchRow;
  observers: ObserverPoint[];
};

type TrajectoryRow = {
  launch_id: string;
  generated_at?: string | null;
  confidence_tier: string | null;
  freshness_state: string | null;
  lineage_complete: boolean | null;
  product: Record<string, unknown> | null;
};

type NwsPointRow = {
  id?: string;
  coord_key: string;
  ll2_pad_id: number | null;
  latitude: number;
  longitude: number;
  cwa: string | null;
  grid_id: string;
  grid_x: number;
  grid_y: number;
  forecast_url: string;
  forecast_hourly_url: string;
  forecast_grid_data_url: string | null;
  time_zone: string | null;
  county_url: string | null;
  forecast_zone_url: string | null;
  raw?: unknown;
  fetched_at: string;
  updated_at: string;
};

type Sample = {
  tPlusSec: number;
  latDeg: number;
  lonDeg: number;
  altM: number;
  downrangeM: number;
  azimuthDeg: number;
};

type WeatherPoint = {
  source: 'open_meteo' | 'nws' | 'mixed' | 'none';
  cloudCoverTotal: number | null;
  cloudCoverLow: number | null;
  cloudCoverMid: number | null;
  cloudCoverHigh: number | null;
  fetchedAtMs: number | null;
};

type WeatherResolution = WeatherPoint & {
  skyCoverPct: number | null;
  ceilingFt: number | null;
  openMeteoFetched: boolean;
  nwsPointFetched: boolean;
  nwsGridFetched: boolean;
};

type OpenMeteoForecast = {
  fetchedAtMs: number;
  timesMs: number[];
  cloudCoverTotal: Array<number | null>;
  cloudCoverLow: Array<number | null>;
  cloudCoverMid: Array<number | null>;
  cloudCoverHigh: Array<number | null>;
};

type NwsGridForecast = {
  updatedAtMs: number | null;
  properties: Record<string, unknown> | null;
};

type ObserverRegistryRow = {
  observer_location_hash: string;
  lat_bucket: number | null;
  lon_bucket: number | null;
  last_seen_at: string | null;
};

type ObserverPoint = {
  hash: string;
  latDeg: number;
  lonDeg: number;
  source: 'pad' | 'observer_registry';
};

type WeatherSamplingMode = 'visible_path' | 'sunlit_path' | 'modeled_path' | 'observer_only';

type WeatherSamplingPoint = {
  role: 'path_start' | 'path_mid' | 'path_end';
  latDeg: number;
  lonDeg: number;
  tPlusSec: number | null;
  altitudeM: number | null;
  azimuthDeg: number | null;
  elevationDeg: number | null;
};

type WeatherSamplingPlan = {
  mode: WeatherSamplingMode;
  note: string;
  points: WeatherSamplingPoint[];
};

type WeatherAssessmentPoint = {
  role: 'observer' | 'path_start' | 'path_mid' | 'path_end' | 'pad';
  source: 'nws' | 'open_meteo' | 'mixed' | 'none';
  totalCloudPct: number | null;
  lowCloudPct: number | null;
  midCloudPct: number | null;
  highCloudPct: number | null;
  skyCoverPct: number | null;
  ceilingFt: number | null;
  obstructionFactor: number | null;
  obstructionLevel: 'clear' | 'partly_obstructed' | 'likely_blocked' | 'unknown';
  note: string | null;
};

type WeatherAssessment = {
  weatherFactor: number;
  primarySource: 'open_meteo' | 'nws' | 'mixed' | 'none';
  fetchedAtMs: number | null;
  openMeteoFetchCount: number;
  nwsPointFetchCount: number;
  nwsGridFetchCount: number;
  sourceUsed: 'nws_path_sampling' | 'open_meteo_path_fallback' | 'mixed_nws_open_meteo' | 'geometry_only';
  samplingMode: WeatherSamplingMode;
  samplingNote: string | null;
  contrastFactor: number | null;
  obstructionFactor: number | null;
  mainBlocker:
    | 'observer_low_ceiling'
    | 'observer_sky_cover'
    | 'path_low_ceiling'
    | 'path_sky_cover'
    | 'observer_low_clouds'
    | 'observer_mid_clouds'
    | 'observer_high_clouds'
    | 'mixed'
    | 'unknown';
  observer: WeatherAssessmentPoint | null;
  alongPath: {
    source: 'nws' | 'open_meteo' | 'mixed' | 'none';
    samplesConsidered: number;
    worstRole: 'path_start' | 'path_mid' | 'path_end' | null;
    skyCoverPct: number | null;
    ceilingFt: number | null;
    obstructionLevel: 'clear' | 'partly_obstructed' | 'likely_blocked' | 'unknown';
    note: string | null;
  } | null;
  pad: WeatherAssessmentPoint | null;
};

type JepCalibrationBand = 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' | 'UNKNOWN';

type RepresentativePlumeCorridor = {
  mode: 'visible_path' | 'sunlit_path';
  representativeTPlusSec: number;
  representativeAzimuthDeg: number;
  representativeElevationDeg: number | null;
  representativeAltitudeM: number | null;
  representativeDownrangeKm: number | null;
  sampleCount: number;
  corridorStartTPlusSec: number;
  corridorEndTPlusSec: number;
  azimuthSpreadDeg: number | null;
};

type IlluminationMetrics = {
  factor: number;
  sunlitMarginKm: number | null;
  litWeight: number;
  totalWeight: number;
};

type LosMetrics = {
  factor: number;
  visibleFraction: number;
  visibleWeight: number;
  totalWeight: number;
};

type JepScoreCandidateUpsert = {
  launch_id: string;
  observer_location_hash: string;
  observer_lat_bucket: number | null;
  observer_lon_bucket: number | null;
  score: number;
  raw_score: number;
  gate_open: boolean;
  vismap_modifier: number;
  baseline_model_version: string | null;
  baseline_score: number | null;
  score_delta: number | null;
  feature_refs: Record<string, unknown>;
  feature_availability: Record<string, unknown>;
  factor_payload: Record<string, unknown>;
  compatibility_payload: Record<string, unknown>;
  explainability: Record<string, unknown>;
  model_version: string;
  input_hash: string;
  computed_at: string;
  expires_at: string | null;
  snapshot_at: string | null;
  updated_at: string;
};

serve(async (req) => {
  const startedAt = Date.now();
  let supabase: ReturnType<typeof createSupabaseAdminClient>;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    return jsonResponse({ ok: false, stage: 'init', error: stringifyError(err) }, 500);
  }

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const forceAll = Boolean(body?.forceAll || body?.force_all);

  const { runId } = await startIngestionRun(supabase, 'jep_score_refresh');

  const stats: Record<string, unknown> = {
    forceAll,
    horizonDays: DEFAULTS.horizonDays,
    maxLaunchesPerRun: DEFAULTS.maxLaunchesPerRun,
    weatherCacheMinutes: DEFAULTS.weatherCacheMinutes,
    observerLookbackDays: DEFAULTS.observerLookbackDays,
    observerRegistryLimit: DEFAULTS.observerRegistryLimit,
    maxObserversPerLaunch: DEFAULTS.maxObserversPerLaunch,
    maxObserverDistanceKm: DEFAULTS.maxObserverDistanceKm,
    candidatesLoaded: 0,
    candidatesEligible: 0,
    observerRegistryLoaded: 0,
    dueLaunches: 0,
    dueObserverVariants: 0,
    launchesComputed: 0,
    observerVariantsComputed: 0,
    launchesUpserted: 0,
    launchesSkippedNoTrajectory: 0,
    unchangedSkipped: 0,
    snapshotLocksRequested: 0,
    snapshotLocksApplied: 0,
    snapshotRowsComputed: 0,
    weatherFetches: 0,
    weatherFallbacks: 0,
    weatherSourceResolvedTotal: 0,
    weatherSourceResolvedOpenMeteo: 0,
    weatherSourceResolvedNws: 0,
    weatherSourceResolvedMixed: 0,
    weatherSourceResolvedNone: 0,
    weatherSourceUpsertedTotal: 0,
    weatherSourceUpsertedOpenMeteo: 0,
    weatherSourceUpsertedNws: 0,
    weatherSourceUpsertedMixed: 0,
    weatherSourceUpsertedNone: 0,
    featureSnapshotsEnabled: DEFAULTS.v6FeatureSnapshotsEnabled,
    moonFeatureSnapshotsEnabled: DEFAULTS.v6MoonFeatureSnapshotsEnabled,
    backgroundFeatureSnapshotsEnabled: DEFAULTS.v6BackgroundFeatureSnapshotsEnabled,
    vehiclePriorFeatureSnapshotsEnabled: DEFAULTS.v6VehiclePriorFeatureSnapshotsEnabled,
    horizonFeatureSnapshotsEnabled: DEFAULTS.v6HorizonFeatureSnapshotsEnabled,
    v6ShadowEnabled: false,
    v6HorizonEnabled: DEFAULTS.v6HorizonEnabled,
    v6ModelVersion: DEFAULT_JEP_V6_MODEL_VERSION,
    horizonCorridorHalfWidthDeg: DEFAULTS.horizonCorridorHalfWidthDeg,
    featureSnapshotsUpserted: 0,
    moonFeatureSourceRowsLoaded: 0,
    moonFeatureSnapshotsUpserted: 0,
    backgroundLightSourceRowsLoaded: 0,
    backgroundFeatureSnapshotsUpserted: 0,
    vehiclePriorRowsLoaded: 0,
    vehiclePriorFeatureSnapshotsUpserted: 0,
    horizonMaskRowsLoaded: 0,
    horizonFeatureSnapshotsUpserted: 0,
    candidateRowsLoaded: 0,
    candidateUpsertsRequested: 0,
    candidateRowsUpserted: 0,
    candidateUnchangedSkipped: 0,
    candidateGateOpen: 0,
    errors: [] as Array<Record<string, unknown>>
  };

  try {
    const settings = await getSettings(supabase, SETTINGS_KEYS);
    const enabled = readBooleanSetting(settings.jep_score_job_enabled, DEFAULTS.enabled);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const horizonDays = clampInt(readNumberSetting(settings.jep_score_horizon_days, DEFAULTS.horizonDays), 1, 30);
    const maxLaunchesPerRun = clampInt(
      readNumberSetting(settings.jep_score_max_launches_per_run, DEFAULTS.maxLaunchesPerRun),
      1,
      500
    );
    const weatherCacheMinutes = clampInt(
      readNumberSetting(settings.jep_score_weather_cache_minutes, DEFAULTS.weatherCacheMinutes),
      1,
      180
    );
    const modelVersion = readStringSetting(settings.jep_score_model_version, DEFAULTS.modelVersion).trim() || DEFAULTS.modelVersion;
    const v6FeatureSnapshotsEnabled = readBooleanSetting(
      settings.jep_v6_feature_snapshots_enabled,
      DEFAULTS.v6FeatureSnapshotsEnabled
    );
    const v6VehiclePriorFeatureSnapshotsEnabled = readBooleanSetting(
      settings.jep_v6_vehicle_prior_feature_snapshots_enabled,
      DEFAULTS.v6VehiclePriorFeatureSnapshotsEnabled
    );
    const v6MoonFeatureSnapshotsEnabled = readBooleanSetting(
      settings.jep_v6_moon_feature_snapshots_enabled,
      DEFAULTS.v6MoonFeatureSnapshotsEnabled
    );
    const v6BackgroundFeatureSnapshotsEnabled = readBooleanSetting(
      settings.jep_v6_background_feature_snapshots_enabled,
      DEFAULTS.v6BackgroundFeatureSnapshotsEnabled
    );
    const v6HorizonFeatureSnapshotsEnabled = readBooleanSetting(
      settings.jep_v6_horizon_feature_snapshots_enabled,
      DEFAULTS.v6HorizonFeatureSnapshotsEnabled
    );
    const v6ShadowEnabled = readBooleanSetting(settings.jep_v6_shadow_enabled, false);
    const v6HorizonEnabled = readBooleanSetting(settings.jep_v6_horizon_enabled, DEFAULTS.v6HorizonEnabled);
    const v6ModelVersion = readStringSetting(settings.jep_v6_model_version, DEFAULT_JEP_V6_MODEL_VERSION).trim() || DEFAULT_JEP_V6_MODEL_VERSION;
    const horizonCorridorHalfWidthDeg = clampNumber(
      readNumberSetting(settings.jep_horizon_corridor_half_width_deg, DEFAULTS.horizonCorridorHalfWidthDeg),
      0.5,
      20
    );
    const openMeteoUsModels = normalizeModelList(
      readStringArraySetting(settings.jep_score_open_meteo_us_models, DEFAULTS.openMeteoUsModels),
      DEFAULTS.openMeteoUsModels
    );
    const observerLookbackDays = clampInt(
      readNumberSetting(settings.jep_score_observer_lookback_days, DEFAULTS.observerLookbackDays),
      1,
      30
    );
    const observerRegistryLimit = clampInt(
      readNumberSetting(settings.jep_score_observer_registry_limit, DEFAULTS.observerRegistryLimit),
      1,
      500
    );
    const maxObserversPerLaunch = clampInt(
      readNumberSetting(settings.jep_score_max_observers_per_launch, DEFAULTS.maxObserversPerLaunch),
      0,
      100
    );
    const maxObserverDistanceKm = clampInt(
      readNumberSetting(settings.jep_score_max_observer_distance_km, DEFAULTS.maxObserverDistanceKm),
      100,
      5000
    );

    stats.horizonDays = horizonDays;
    stats.maxLaunchesPerRun = maxLaunchesPerRun;
    stats.weatherCacheMinutes = weatherCacheMinutes;
    stats.modelVersion = modelVersion;
    stats.featureSnapshotsEnabled = v6FeatureSnapshotsEnabled;
    stats.vehiclePriorFeatureSnapshotsEnabled = v6VehiclePriorFeatureSnapshotsEnabled;
    stats.moonFeatureSnapshotsEnabled = v6MoonFeatureSnapshotsEnabled;
    stats.backgroundFeatureSnapshotsEnabled = v6BackgroundFeatureSnapshotsEnabled;
    stats.horizonFeatureSnapshotsEnabled = v6HorizonFeatureSnapshotsEnabled;
    stats.v6ShadowEnabled = v6ShadowEnabled;
    stats.v6HorizonEnabled = v6HorizonEnabled;
    stats.v6ModelVersion = v6ModelVersion;
    stats.horizonCorridorHalfWidthDeg = horizonCorridorHalfWidthDeg;
    stats.openMeteoUsModels = openMeteoUsModels;
    stats.observerLookbackDays = observerLookbackDays;
    stats.observerRegistryLimit = observerRegistryLimit;
    stats.maxObserversPerLaunch = maxObserversPerLaunch;
    stats.maxObserverDistanceKm = maxObserverDistanceKm;

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const fromIso = new Date(nowMs - SNAPSHOT_LOCK_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
    const horizonIso = new Date(nowMs + horizonDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: launchesRaw, error: launchesError } = await supabase
      .from('launches_public_cache')
      .select(
        'launch_id, net, net_precision, status_name, status_abbrev, pad_latitude, pad_longitude, pad_country_code, pad_state, mission_orbit, provider, vehicle, rocket_full_name, rocket_family, ll2_rocket_config_id'
      )
      .gte('net', fromIso)
      .lte('net', horizonIso)
      .order('net', { ascending: true })
      .limit(maxLaunchesPerRun * 6);

    if (launchesError) throw launchesError;
    const launches = ((launchesRaw || []) as LaunchRow[]).filter((row) => isScoreEligible(row, nowMs));
    stats.candidatesLoaded = (launchesRaw || []).length;
    stats.candidatesEligible = launches.length;

    if (!launches.length) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'no_candidates' });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_candidates', elapsedMs: Date.now() - startedAt });
    }

    const activeObservers = await loadActiveObservers({
      supabase,
      nowMs,
      lookbackDays: observerLookbackDays,
      limit: observerRegistryLimit
    });
    stats.observerRegistryLoaded = activeObservers.length;

    const launchIds = launches.map((row) => row.launch_id);
    const existingScores = await loadExistingScores(supabase, launchIds);
    const existingCandidates = v6ShadowEnabled ? await loadExistingCandidateScores(supabase, launchIds, v6ModelVersion) : new Map<string, CandidateScoreRow>();
    stats.candidateRowsLoaded = existingCandidates.size;
    const trajectoryFreshnessByLaunch = await loadTrajectoryFreshness(supabase, launchIds);
    const due: DueLaunch[] = [];

    for (const launch of launches) {
      if (due.length >= maxLaunchesPerRun) break;
      const padLat = Number(launch.pad_latitude);
      const padLon = Number(launch.pad_longitude);
      const observers = selectObserversForLaunch({
        padLat,
        padLon,
        activeObservers,
        maxObserversPerLaunch,
        maxObserverDistanceKm
      });
      if (forceAll) {
        due.push({ launch, observers });
        continue;
      }
      const launchDue = observers.some((observer) => {
        const key = scoreKey(launch.launch_id, observer.hash);
        return isDueObserver(launch, existingScores.get(key), nowMs, trajectoryFreshnessByLaunch.get(launch.launch_id) ?? null);
      });
      if (!launchDue) continue;
      due.push({ launch, observers });
    }

    stats.dueLaunches = due.length;
    stats.dueObserverVariants = due.reduce((sum, item) => sum + item.observers.length, 0);

    if (!due.length) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'no_due_launches' });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_due_launches', elapsedMs: Date.now() - startedAt });
    }

    const dueIds = due.map((item) => item.launch.launch_id);
    const trajectories = await loadTrajectories(supabase, dueIds);
    const vehiclePriors =
      (v6FeatureSnapshotsEnabled || v6ShadowEnabled) &&
      (v6VehiclePriorFeatureSnapshotsEnabled || v6ShadowEnabled)
        ? await loadVehiclePriors(supabase)
        : [];
    stats.vehiclePriorRowsLoaded = vehiclePriors.length;
    const moonEphemeridesByLaunch =
      (v6FeatureSnapshotsEnabled || v6ShadowEnabled) && (v6MoonFeatureSnapshotsEnabled || v6BackgroundFeatureSnapshotsEnabled || v6ShadowEnabled)
        ? await loadMoonEphemerides(supabase, dueIds)
        : new Map<string, MoonEphemerisRow[]>();
    stats.moonFeatureSourceRowsLoaded = [...moonEphemeridesByLaunch.values()].reduce((sum, rows) => sum + rows.length, 0);
    const padFeatureKeys =
      (v6FeatureSnapshotsEnabled || v6ShadowEnabled) &&
      (v6BackgroundFeatureSnapshotsEnabled || v6HorizonFeatureSnapshotsEnabled || v6ShadowEnabled)
        ? [
            ...new Set(
              due
                .flatMap((entry) =>
                  entry.observers
                    .filter((observer) => observer.hash === PAD_OBSERVER_HASH)
                    .map((observer) => deriveJepV6ObserverFeatureCell(observer.latDeg, observer.lonDeg)?.key || null)
                )
                .filter((value): value is string => Boolean(value))
            )
          ]
        : [];
    const backgroundLightByFeatureKey =
      (v6FeatureSnapshotsEnabled || v6ShadowEnabled) &&
      (v6BackgroundFeatureSnapshotsEnabled || v6ShadowEnabled) &&
      padFeatureKeys.length
        ? await loadBackgroundLightCells(supabase, padFeatureKeys)
        : new Map<string, BackgroundLightRow[]>();
    stats.backgroundLightSourceRowsLoaded = [...backgroundLightByFeatureKey.values()].reduce((sum, rows) => sum + rows.length, 0);
    const horizonMasksByFeatureKey =
      (v6FeatureSnapshotsEnabled || v6ShadowEnabled) &&
      (v6HorizonFeatureSnapshotsEnabled || v6HorizonEnabled) &&
      padFeatureKeys.length
        ? await loadHorizonMasks(supabase, padFeatureKeys)
        : new Map<string, HorizonMaskRow>();
    stats.horizonMaskRowsLoaded = horizonMasksByFeatureKey.size;
    const weatherCache = new Map<string, { atMs: number; forecast: OpenMeteoForecast | null }>();
    const nwsPointCache = new Map<string, NwsPointRow | null>();
    const nwsGridCache = new Map<string, NwsGridForecast | null>();
    const upserts: Record<string, unknown>[] = [];
    const featureSnapshotUpserts: FeatureSnapshotRow[] = [];
    const candidateUpserts: JepScoreCandidateUpsert[] = [];
    const snapshotLocksByLaunch = new Map<string, Set<string>>();

    for (const entry of due) {
      const launch = entry.launch;
      const netMs = Date.parse(String(launch.net || ''));
      if (!Number.isFinite(netMs)) continue;
      const launchPassedT0 = netMs <= nowMs;
      const launchPastMs = Math.max(0, nowMs - netMs);
      const allowPostLaunchCompute = launchPastMs <= POST_LAUNCH_COMPUTE_GRACE_HOURS * 60 * 60 * 1000;

      const observersToCompute: ObserverPoint[] = [];
      for (const observer of entry.observers) {
        const key = scoreKey(launch.launch_id, observer.hash);
        const existing = existingScores.get(key);
        if (isSnapshotLocked(existing)) continue;

        if (launchPassedT0 && existing) {
          let lockSet = snapshotLocksByLaunch.get(launch.launch_id);
          if (!lockSet) {
            lockSet = new Set<string>();
            snapshotLocksByLaunch.set(launch.launch_id, lockSet);
          }
          lockSet.add(observer.hash);
          stats.snapshotLocksRequested = Number(stats.snapshotLocksRequested || 0) + 1;
          continue;
        }

        if (launchPassedT0 && !allowPostLaunchCompute) {
          continue;
        }

        observersToCompute.push(observer);
      }

      if (!observersToCompute.length) continue;

      const trajectory = trajectories.get(launch.launch_id);
      if (!trajectory || !trajectory.product) {
        stats.launchesSkippedNoTrajectory = Number(stats.launchesSkippedNoTrajectory || 0) + 1;
        continue;
      }

      try {
        const padLat = Number(launch.pad_latitude);
        const padLon = Number(launch.pad_longitude);
        const samples = parseSamples(trajectory.product, padLat, padLon);
        if (!samples.length) {
          stats.launchesSkippedNoTrajectory = Number(stats.launchesSkippedNoTrajectory || 0) + 1;
          continue;
        }

        const intervalMinutes = launchPassedT0 ? 0 : intervalMinutesForLaunch(netMs, nowMs);
        const computeLaunch = {
          launchId: launch.launch_id,
          net: launch.net,
          netPrecision: launch.net_precision,
          padLat: Number(launch.pad_latitude),
          padLon: Number(launch.pad_longitude),
          padCountryCode: launch.pad_country_code
        };
        const computeSettings = {
          modelVersion,
          weatherCacheMinutes,
          openMeteoUsModels
        };

        let launchComputed = false;

        for (const observer of observersToCompute) {
          const computed = await computeJepScoreRecord({
            supabase,
            launch: computeLaunch,
            observer: {
              hash: observer.hash,
              latDeg: observer.latDeg,
              lonDeg: observer.lonDeg,
              source: observer.source
            },
            trajectory: {
              version: null,
              confidenceTier: trajectory.confidence_tier,
              product: trajectory.product
            },
            nowMs,
            settings: computeSettings,
            weatherCaches: {
              weatherCache,
              nwsPointCache,
              nwsGridCache
            },
            launchPassedT0
          });
          if (!computed) continue;
          const weather = computed.weather;

          if (weather.openMeteoFetchCount > 0) {
            stats.weatherFetches = Number(stats.weatherFetches || 0) + weather.openMeteoFetchCount;
          }
          if (weather.sourceUsed === 'geometry_only') {
            stats.weatherFallbacks = Number(stats.weatherFallbacks || 0) + 1;
          }
          incrementWeatherSourceStats(stats, weather.primarySource, 'resolved');

          const existing = existingScores.get(scoreKey(launch.launch_id, observer.hash));
          const skipPublicUpsert = Boolean(
            !launchPassedT0 &&
              existing &&
              existing.input_hash === computed.row.input_hash &&
              existing.expires_at &&
              Date.parse(existing.expires_at) > nowMs + intervalMinutes * 30 * 1000
          );
          if (skipPublicUpsert) {
            stats.unchangedSkipped = Number(stats.unchangedSkipped || 0) + 1;
          }

          if (!skipPublicUpsert) {
            upserts.push(computed.row);
            incrementWeatherSourceStats(stats, weather.primarySource, 'upserted');
          }

          const moonRows = moonEphemeridesByLaunch.get(launch.launch_id) ?? [];
          const observerFeatureKey =
            deriveJepV6ObserverFeatureCell(observer.latDeg, observer.lonDeg)?.key ?? computed.row.observer_location_hash;
          const moonFeatureSnapshot =
            v6MoonFeatureSnapshotsEnabled || v6ShadowEnabled
              ? buildMoonFeatureSnapshot({
                  launch,
                  observer,
                  trajectory,
                  computed,
                  moonRows
                })
              : null;
          const vehiclePriorFeatureSnapshot =
            v6VehiclePriorFeatureSnapshotsEnabled || v6ShadowEnabled
              ? buildVehiclePriorFeatureSnapshot({
                  launch,
                  observer,
                  trajectory,
                  computed,
                  vehiclePriors
                })
              : null;
          const backgroundFeatureSnapshot =
            v6BackgroundFeatureSnapshotsEnabled || v6ShadowEnabled
              ? buildBackgroundFeatureSnapshot({
                  launch,
                  observer,
                  trajectory,
                  computed,
                  moonRows,
                  backgroundRows: backgroundLightByFeatureKey.get(observerFeatureKey) ?? []
                })
              : null;
          const horizonFeatureSnapshot =
            v6HorizonFeatureSnapshotsEnabled || v6HorizonEnabled
              ? buildHorizonFeatureSnapshot({
                  launch,
                  observer,
                  trajectory,
                  computed,
                  horizonMaskRow: horizonMasksByFeatureKey.get(observerFeatureKey) ?? null,
                  corridorHalfWidthDeg: horizonCorridorHalfWidthDeg
                })
              : null;

          if (v6FeatureSnapshotsEnabled) {
            featureSnapshotUpserts.push(
              buildV5BaselineFeatureSnapshot({
                launch,
                observer,
                trajectory,
                computed
              })
            );
            if (v6MoonFeatureSnapshotsEnabled && moonFeatureSnapshot) {
              featureSnapshotUpserts.push(moonFeatureSnapshot);
              stats.moonFeatureSnapshotsUpserted = Number(stats.moonFeatureSnapshotsUpserted || 0) + 1;
            }
            if (v6VehiclePriorFeatureSnapshotsEnabled && vehiclePriorFeatureSnapshot) {
              featureSnapshotUpserts.push(vehiclePriorFeatureSnapshot);
              stats.vehiclePriorFeatureSnapshotsUpserted = Number(stats.vehiclePriorFeatureSnapshotsUpserted || 0) + 1;
            }
            if (v6BackgroundFeatureSnapshotsEnabled && backgroundFeatureSnapshot) {
              featureSnapshotUpserts.push(backgroundFeatureSnapshot);
              stats.backgroundFeatureSnapshotsUpserted = Number(stats.backgroundFeatureSnapshotsUpserted || 0) + 1;
            }
            if (v6HorizonFeatureSnapshotsEnabled && horizonFeatureSnapshot) {
              featureSnapshotUpserts.push(horizonFeatureSnapshot);
              stats.horizonFeatureSnapshotsUpserted = Number(stats.horizonFeatureSnapshotsUpserted || 0) + 1;
            }
          }

          if (v6ShadowEnabled) {
            const candidateRow = buildShadowScoreCandidateRow({
              launch,
              observer,
              computed,
              vehiclePriorFeatureSnapshot,
              moonFeatureSnapshot,
              backgroundFeatureSnapshot,
              horizonFeatureSnapshot: v6HorizonEnabled ? horizonFeatureSnapshot : null,
              modelVersion: v6ModelVersion
            });
            if (candidateRow) {
              stats.candidateUpsertsRequested = Number(stats.candidateUpsertsRequested || 0) + 1;
              const existingCandidate = existingCandidates.get(
                candidateScoreKey(candidateRow.launch_id, candidateRow.observer_location_hash, candidateRow.model_version)
              );
              const candidateUnchanged = Boolean(
                !launchPassedT0 &&
                  existingCandidate &&
                  existingCandidate.input_hash === candidateRow.input_hash &&
                  existingCandidate.expires_at &&
                  Date.parse(existingCandidate.expires_at) > nowMs + intervalMinutes * 30 * 1000
              );
              if (candidateUnchanged) {
                stats.candidateUnchangedSkipped = Number(stats.candidateUnchangedSkipped || 0) + 1;
              } else {
                candidateUpserts.push(candidateRow);
                if (candidateRow.gate_open) {
                  stats.candidateGateOpen = Number(stats.candidateGateOpen || 0) + 1;
                }
              }
            }
          }

          launchComputed = true;
          stats.observerVariantsComputed = Number(stats.observerVariantsComputed || 0) + 1;
          if (launchPassedT0) {
            stats.snapshotRowsComputed = Number(stats.snapshotRowsComputed || 0) + 1;
          }
        }

        if (launchComputed) {
          stats.launchesComputed = Number(stats.launchesComputed || 0) + 1;
        }
      } catch (err) {
        (stats.errors as Array<Record<string, unknown>>).push({
          launchId: launch.launch_id,
          error: stringifyError(err)
        });
      }
    }

    if (snapshotLocksByLaunch.size > 0) {
      for (const [launchId, lockSet] of snapshotLocksByLaunch) {
        const hashes = [...lockSet];
        if (!hashes.length) continue;
        const { error: lockError } = await supabase
          .from('launch_jep_scores')
          .update({
            snapshot_at: nowIso,
            expires_at: null,
            updated_at: nowIso
          })
          .eq('launch_id', launchId)
          .in('observer_location_hash', hashes)
          .is('snapshot_at', null);
        if (lockError) throw lockError;
        stats.snapshotLocksApplied = Number(stats.snapshotLocksApplied || 0) + hashes.length;
      }
    }

    if (upserts.length) {
      const { error: upsertError } = await supabase
        .from('launch_jep_scores')
        .upsert(upserts, { onConflict: 'launch_id,observer_location_hash' });
      if (upsertError) throw upsertError;
    }

    stats.launchesUpserted = upserts.length;

    if (v6FeatureSnapshotsEnabled && featureSnapshotUpserts.length) {
      const { error: featureSnapshotError } = await supabase
        .from('jep_feature_snapshots')
        .upsert(featureSnapshotUpserts, { onConflict: 'launch_id,observer_location_hash,feature_family,input_hash' });
      if (featureSnapshotError) throw featureSnapshotError;
      stats.featureSnapshotsUpserted = featureSnapshotUpserts.length;
    }

    if (v6ShadowEnabled && candidateUpserts.length) {
      const { error: candidateUpsertError } = await supabase
        .from('launch_jep_score_candidates')
        .upsert(candidateUpserts, { onConflict: 'launch_id,observer_location_hash,model_version' });
      if (candidateUpsertError) throw candidateUpsertError;
      stats.candidateRowsUpserted = candidateUpserts.length;
    }

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});

async function loadExistingScores(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchIds: string[]
) {
  const byKey = new Map<string, ScoreRow>();
  const chunkSize = 200;
  for (let i = 0; i < launchIds.length; i += chunkSize) {
    const slice = launchIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('launch_jep_scores')
      .select('launch_id, observer_location_hash, input_hash, computed_at, expires_at, snapshot_at')
      .in('launch_id', slice);
    if (error) throw error;
    for (const row of (data || []) as ScoreRow[]) {
      const hash = (row.observer_location_hash || PAD_OBSERVER_HASH).trim() || PAD_OBSERVER_HASH;
      byKey.set(scoreKey(row.launch_id, hash), row);
    }
  }
  return byKey;
}

async function loadExistingCandidateScores(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchIds: string[],
  modelVersion: string
) {
  const byKey = new Map<string, CandidateScoreRow>();
  const chunkSize = 200;
  for (let i = 0; i < launchIds.length; i += chunkSize) {
    const slice = launchIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('launch_jep_score_candidates')
      .select('launch_id, observer_location_hash, model_version, input_hash, computed_at, expires_at, snapshot_at')
      .eq('model_version', modelVersion)
      .in('launch_id', slice);
    if (error) {
      const text = `${error.message || ''}`.toLowerCase();
      if (text.includes('launch_jep_score_candidates')) return byKey;
      throw error;
    }
    for (const row of (data || []) as CandidateScoreRow[]) {
      const hash = (row.observer_location_hash || PAD_OBSERVER_HASH).trim() || PAD_OBSERVER_HASH;
      byKey.set(candidateScoreKey(row.launch_id, hash, row.model_version), row);
    }
  }
  return byKey;
}

async function loadTrajectoryFreshness(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchIds: string[]
) {
  const byId = new Map<string, number>();
  const chunkSize = 200;
  for (let i = 0; i < launchIds.length; i += chunkSize) {
    const slice = launchIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('launch_trajectory_products')
      .select('launch_id, generated_at')
      .in('launch_id', slice);
    if (error) throw error;
    for (const row of (data || []) as Array<{ launch_id: string; generated_at?: string | null }>) {
      const generatedAtMs = typeof row.generated_at === 'string' ? Date.parse(row.generated_at) : Number.NaN;
      if (!Number.isFinite(generatedAtMs)) continue;
      byId.set(row.launch_id, generatedAtMs);
    }
  }
  return byId;
}

async function loadTrajectories(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchIds: string[]
) {
  const byId = new Map<string, TrajectoryRow>();
  const chunkSize = 200;
  for (let i = 0; i < launchIds.length; i += chunkSize) {
    const slice = launchIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('launch_trajectory_products')
      .select('launch_id, confidence_tier, freshness_state, lineage_complete, product')
      .in('launch_id', slice);
    if (error) throw error;
    for (const row of (data || []) as TrajectoryRow[]) {
      byId.set(row.launch_id, row);
    }
  }
  return byId;
}

async function loadActiveObservers({
  supabase,
  nowMs,
  lookbackDays,
  limit
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  nowMs: number;
  lookbackDays: number;
  limit: number;
}) {
  const cutoffIso = new Date(nowMs - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('jep_observer_locations')
    .select('observer_location_hash, lat_bucket, lon_bucket, last_seen_at')
    .gte('last_seen_at', cutoffIso)
    .order('last_seen_at', { ascending: false })
    .limit(limit);

  if (error) {
    const text = `${error.message || ''}`.toLowerCase();
    if (text.includes('jep_observer_locations')) return [] as ObserverRegistryRow[];
    throw error;
  }

  return (data || []) as ObserverRegistryRow[];
}

function selectObserversForLaunch({
  padLat,
  padLon,
  activeObservers,
  maxObserversPerLaunch,
  maxObserverDistanceKm
}: {
  padLat: number;
  padLon: number;
  activeObservers: ObserverRegistryRow[];
  maxObserversPerLaunch: number;
  maxObserverDistanceKm: number;
}) {
  const observers: ObserverPoint[] = [
    {
      hash: PAD_OBSERVER_HASH,
      latDeg: padLat,
      lonDeg: padLon,
      source: 'pad'
    }
  ];

  if (maxObserversPerLaunch <= 0) return observers;

  const ranked: Array<{ distKm: number; observer: ObserverPoint }> = [];
  for (const row of activeObservers) {
    const hash = String(row.observer_location_hash || '').trim();
    const lat = toFiniteNumber(row.lat_bucket);
    const lon = toFiniteNumber(row.lon_bucket);
    if (!hash || hash === PAD_OBSERVER_HASH || lat == null || lon == null) continue;
    const distKm = haversineKm(padLat, padLon, lat, lon);
    if (!Number.isFinite(distKm) || distKm > maxObserverDistanceKm) continue;
    ranked.push({
      distKm,
      observer: {
        hash,
        latDeg: lat,
        lonDeg: lon,
        source: 'observer_registry'
      }
    });
  }

  ranked.sort((a, b) => a.distKm - b.distKm);
  for (const entry of ranked.slice(0, maxObserversPerLaunch)) {
    observers.push(entry.observer);
  }

  return observers;
}

function scoreKey(launchId: string, observerHash: string) {
  return `${launchId}:${observerHash}`;
}

function candidateScoreKey(launchId: string, observerHash: string, modelVersion: string) {
  return `${launchId}:${observerHash}:${modelVersion}`;
}

function buildV5BaselineFeatureSnapshot({
  launch,
  observer,
  trajectory,
  computed
}: {
  launch: LaunchRow;
  observer: ObserverPoint;
  trajectory: TrajectoryRow;
  computed: JepComputedScore;
}): FeatureSnapshotRow {
  const featureCell = deriveJepV6ObserverFeatureCell(observer.latDeg, observer.lonDeg);
  return {
    launch_id: launch.launch_id,
    observer_location_hash: computed.row.observer_location_hash,
    observer_feature_key: featureCell?.key ?? computed.row.observer_location_hash,
    observer_lat_bucket: featureCell?.latCell ?? computed.row.observer_lat_bucket ?? null,
    observer_lon_bucket: featureCell?.lonCell ?? computed.row.observer_lon_bucket ?? null,
    feature_family: 'jep_v5_baseline',
    model_version: DEFAULT_JEP_V6_MODEL_VERSION,
    input_hash: computed.row.input_hash,
    trajectory_input_hash: null,
    source_refs: [
      {
        sourceKey: 'jep_v5_baseline',
        modelVersion: computed.row.model_version
      },
      {
        sourceKey: 'trajectory',
        provider: 'launch_trajectory',
        confidenceTier: trajectory.confidence_tier ?? null,
        freshnessState: trajectory.freshness_state ?? null
      },
      {
        sourceKey: 'weather',
        provider: computed.weather.primarySource,
        sourceUsed: computed.weather.sourceUsed,
        samplingMode: computed.weather.samplingMode
      }
    ],
    feature_payload: {
      observer: {
        source: observer.source,
        latDeg: observer.latDeg,
        lonDeg: observer.lonDeg,
        featureKey: featureCell?.key ?? null,
        featureCellDeg: featureCell?.cellDeg ?? null
      },
      launch: {
        net: launch.net,
        netPrecision: launch.net_precision,
        missionOrbit: launch.mission_orbit,
        vehicle: launch.vehicle,
        rocketFamily: launch.rocket_family,
        padCountryCode: launch.pad_country_code
      },
      baseline: {
        sourceModelVersion: computed.row.model_version
      },
      trajectory: {
        confidenceTier: trajectory.confidence_tier ?? null,
        freshnessState: trajectory.freshness_state ?? null,
        lineageComplete: trajectory.lineage_complete ?? null,
        sampleCount: computed.samples.length
      },
      factors: {
        score: computed.row.score,
        illumination: computed.row.illumination_factor,
        darkness: computed.row.darkness_factor,
        lineOfSight: computed.row.los_factor,
        weather: computed.row.weather_factor,
        sunlitMarginKm: computed.row.sunlit_margin_km,
        losVisibleFraction: computed.row.los_visible_fraction,
        solarDepressionDeg: computed.row.solar_depression_deg,
        weatherFreshnessMin: computed.row.weather_freshness_min,
        geometryOnlyFallback: computed.row.geometry_only_fallback
      },
      weather: {
        primarySource: computed.weather.primarySource,
        sourceUsed: computed.weather.sourceUsed,
        samplingMode: computed.weather.samplingMode,
        contrastFactor: computed.weather.contrastFactor,
        obstructionFactor: computed.weather.obstructionFactor,
        mainBlocker: computed.weather.mainBlocker
      },
      explainability: computed.row.explainability
    },
    confidence_payload: {
      timeConfidence: computed.row.time_confidence,
      trajectoryConfidence: computed.row.trajectory_confidence,
      weatherConfidence: computed.row.weather_confidence
    },
    computed_at: computed.row.computed_at,
    expires_at: computed.row.expires_at,
    snapshot_at: computed.row.snapshot_at,
    updated_at: computed.row.updated_at
  };
}

function buildVehiclePriorFeatureSnapshot({
  launch,
  observer,
  trajectory,
  computed,
  vehiclePriors
}: {
  launch: LaunchRow;
  observer: ObserverPoint;
  trajectory: TrajectoryRow;
  computed: JepComputedScore;
  vehiclePriors: VehiclePriorRow[];
}): FeatureSnapshotRow | null {
  if (observer.hash !== PAD_OBSERVER_HASH) return null;

  const featureCell = deriveJepV6ObserverFeatureCell(observer.latDeg, observer.lonDeg);
  if (!featureCell) return null;

  const resolvedPrior = resolveJepV6VehiclePrior(vehiclePriors, {
    launchId: launch.launch_id,
    net: launch.net,
    provider: launch.provider,
    padState: launch.pad_state,
    vehicle: launch.vehicle,
    rocketFamily: launch.rocket_family,
    rocketFullName: launch.rocket_full_name,
    ll2RocketConfigId: launch.ll2_rocket_config_id
  });
  const availability = resolvedPrior.availability ?? 'neutral_missing_vehicle_prior';
  const inputHash = buildJepV6FeatureSnapshotInputHash({
    launchId: launch.launch_id,
    observerFeatureCellKey: featureCell.key,
    featureFamily: JEP_V6_VEHICLE_PRIOR_FEATURE_FAMILY,
    modelVersion: DEFAULT_JEP_V6_MODEL_VERSION,
    inputs: {
      baselineInputHash: computed.row.input_hash,
      trajectoryConfidence: trajectory.confidence_tier ?? null,
      availability,
      launchClassifier: {
        provider: launch.provider,
        padState: launch.pad_state,
        rocketFullName: launch.rocket_full_name,
        rocketFamily: launch.rocket_family,
        ll2RocketConfigId: launch.ll2_rocket_config_id
      },
      prior:
        resolvedPrior.source === 'vehicle_prior'
          ? {
              familyKey: resolvedPrior.familyKey,
              matchMode: resolvedPrior.matchMode,
              missionProfileFactor: resolvedPrior.missionProfileFactor,
              analystConfidence: resolvedPrior.analystConfidence,
              sourceRevision: resolvedPrior.sourceRevision
            }
          : null
    }
  });

  return {
    launch_id: launch.launch_id,
    observer_location_hash: computed.row.observer_location_hash,
    observer_feature_key: featureCell.key,
    observer_lat_bucket: featureCell.latCell,
    observer_lon_bucket: featureCell.lonCell,
    feature_family: JEP_V6_VEHICLE_PRIOR_FEATURE_FAMILY,
    model_version: DEFAULT_JEP_V6_MODEL_VERSION,
    input_hash: inputHash,
    trajectory_input_hash: computed.row.input_hash,
    source_refs: buildVehiclePriorSourceRefs(resolvedPrior),
    feature_payload: {
      availability,
      observer: {
        source: observer.source,
        latDeg: observer.latDeg,
        lonDeg: observer.lonDeg,
        featureKey: featureCell.key,
        featureCellDeg: featureCell.cellDeg
      },
      launch: {
        net: launch.net,
        provider: launch.provider,
        padState: launch.pad_state,
        missionOrbit: launch.mission_orbit,
        vehicle: launch.vehicle,
        rocketFullName: launch.rocket_full_name,
        rocketFamily: launch.rocket_family,
        ll2RocketConfigId: launch.ll2_rocket_config_id,
        padCountryCode: launch.pad_country_code
      },
      prior:
        resolvedPrior.source === 'vehicle_prior'
          ? {
              familyKey: resolvedPrior.familyKey,
              familyLabel: resolvedPrior.familyLabel,
              derivedFamilyKey: resolvedPrior.derivedFamilyKey,
              matchMode: resolvedPrior.matchMode,
              ll2RocketConfigId: resolvedPrior.ll2RocketConfigId,
              analystConfidence: resolvedPrior.analystConfidence,
              sourceUrl: resolvedPrior.sourceUrl,
              sourceTitle: resolvedPrior.sourceTitle,
              sourceRevision: resolvedPrior.sourceRevision,
              rationale: resolvedPrior.rationale,
              metadata: resolvedPrior.metadata ?? {}
            }
          : null,
      derived: {
        sMissionProfile: resolvedPrior.missionProfileFactor,
        source: resolvedPrior.source,
        derivedFamilyKey: resolvedPrior.derivedFamilyKey,
        matchMode: resolvedPrior.matchMode
      }
    },
    confidence_payload: {
      availability,
      trajectoryConfidence: computed.row.trajectory_confidence,
      timeConfidence: computed.row.time_confidence,
      priorMatched: resolvedPrior.source === 'vehicle_prior',
      analystConfidence: resolvedPrior.analystConfidence,
      factorAvailable: resolvedPrior.missionProfileFactor != null,
      exactConfigJoinAvailable:
        resolvedPrior.source === 'vehicle_prior' && resolvedPrior.matchMode === 'config_id'
    },
    computed_at: computed.row.computed_at,
    expires_at: computed.row.expires_at,
    snapshot_at: computed.row.snapshot_at,
    updated_at: computed.row.updated_at
  };
}

function buildVehiclePriorSourceRefs(resolvedPrior: JepV6ResolvedVehiclePrior) {
  if (resolvedPrior.source !== 'vehicle_prior') return [] as Array<Record<string, unknown>>;
  return [
    {
      sourceKey: JEP_V6_VEHICLE_PRIOR_SOURCE_KEY,
      familyKey: resolvedPrior.familyKey,
      sourceUrl: resolvedPrior.sourceUrl,
      sourceTitle: resolvedPrior.sourceTitle,
      sourceRevision: resolvedPrior.sourceRevision
    }
  ];
}

function buildMoonFeatureSnapshot({
  launch,
  observer,
  trajectory,
  computed,
  moonRows
}: {
  launch: LaunchRow;
  observer: ObserverPoint;
  trajectory: TrajectoryRow;
  computed: JepComputedScore;
  moonRows: MoonEphemerisRow[];
}): FeatureSnapshotRow | null {
  if (observer.hash !== PAD_OBSERVER_HASH) return null;

  const featureCell = deriveJepV6ObserverFeatureCell(observer.latDeg, observer.lonDeg);
  const featureFamily = JEP_V6_MOON_FEATURE_FAMILY;
  const representativeCorridor = deriveRepresentativePlumeCorridor({
    samples: computed.samples,
    solarDepressionDeg: computed.row.solar_depression_deg,
    observerLatDeg: observer.latDeg,
    observerLonDeg: observer.lonDeg
  });

  const targetSampleAtMs =
    representativeCorridor && launch.net
      ? Date.parse(launch.net) + representativeCorridor.representativeTPlusSec * 1000
      : Number.NaN;
  const nearestMoonRow =
    representativeCorridor && Number.isFinite(targetSampleAtMs)
      ? findNearestMoonSample(moonRows, targetSampleAtMs, MOON_SAMPLE_MAX_DIFF_MS)
      : null;

  const moonFactor = representativeCorridor
    ? computeJepV6MoonFactor({
        moonAzDeg: nearestMoonRow?.moon_az_deg ?? null,
        moonElDeg: nearestMoonRow?.moon_el_deg ?? null,
        moonIllumFrac: nearestMoonRow?.moon_illum_frac ?? null,
        plumeAzimuthDeg: representativeCorridor.representativeAzimuthDeg
      })
    : {
        factor: null,
        azimuthSeparationDeg: null,
        moonVisible: null,
        illuminationTerm: null,
        separationTerm: null,
        penalty: null
      };

  const availability =
    representativeCorridor == null
      ? 'no_visible_or_sunlit_corridor'
      : nearestMoonRow == null
        ? 'missing_moon_ephemeris'
        : moonFactor.factor == null
          ? 'missing_moon_inputs'
          : 'ok';

  const inputHash = buildJepV6FeatureSnapshotInputHash({
    launchId: launch.launch_id,
    observerFeatureCellKey: featureCell?.key ?? computed.row.observer_location_hash,
    featureFamily,
    modelVersion: DEFAULT_JEP_V6_MODEL_VERSION,
    inputs: {
      baselineInputHash: computed.row.input_hash,
      trajectoryConfidence: trajectory.confidence_tier ?? null,
      availability,
      representativeCorridor: representativeCorridor
        ? {
            mode: representativeCorridor.mode,
            representativeTPlusSec: round(representativeCorridor.representativeTPlusSec, 3),
            representativeAzimuthDeg: round(representativeCorridor.representativeAzimuthDeg, 3),
            representativeDownrangeKm:
              representativeCorridor.representativeDownrangeKm != null
                ? round(representativeCorridor.representativeDownrangeKm, 3)
                : null,
            sampleCount: representativeCorridor.sampleCount,
            corridorStartTPlusSec: representativeCorridor.corridorStartTPlusSec,
            corridorEndTPlusSec: representativeCorridor.corridorEndTPlusSec,
            azimuthSpreadDeg: representativeCorridor.azimuthSpreadDeg != null ? round(representativeCorridor.azimuthSpreadDeg, 3) : null
          }
        : null,
      moonSample: nearestMoonRow
        ? {
            sampleAt: nearestMoonRow.sample_at,
            moonAzDeg: nearestMoonRow.moon_az_deg,
            moonElDeg: nearestMoonRow.moon_el_deg,
            moonIllumFrac: nearestMoonRow.moon_illum_frac,
            moonPhaseName: nearestMoonRow.moon_phase_name,
            sourceVersionId: nearestMoonRow.source_version_id ?? null,
            qaVersionId: nearestMoonRow.qa_version_id ?? null
          }
        : null
    }
  });

  return {
    launch_id: launch.launch_id,
    observer_location_hash: computed.row.observer_location_hash,
    observer_feature_key: featureCell?.key ?? computed.row.observer_location_hash,
    observer_lat_bucket: featureCell?.latCell ?? computed.row.observer_lat_bucket ?? null,
    observer_lon_bucket: featureCell?.lonCell ?? computed.row.observer_lon_bucket ?? null,
    feature_family: featureFamily,
    model_version: DEFAULT_JEP_V6_MODEL_VERSION,
    input_hash: inputHash,
    trajectory_input_hash: computed.row.input_hash,
    source_refs: buildMoonFeatureSourceRefs(nearestMoonRow),
    feature_payload: {
      availability,
      observer: {
        source: observer.source,
        latDeg: observer.latDeg,
        lonDeg: observer.lonDeg,
        featureKey: featureCell?.key ?? null,
        featureCellDeg: featureCell?.cellDeg ?? null
      },
      launch: {
        net: launch.net,
        missionOrbit: launch.mission_orbit,
        vehicle: launch.vehicle,
        rocketFamily: launch.rocket_family,
        padCountryCode: launch.pad_country_code
      },
      representativeCorridor,
      moon: nearestMoonRow
        ? {
            sampleAt: nearestMoonRow.sample_at,
            sampleOffsetSec: nearestMoonRow.sample_offset_sec,
            azDeg: nearestMoonRow.moon_az_deg,
            elDeg: nearestMoonRow.moon_el_deg,
            illumFrac: nearestMoonRow.moon_illum_frac,
            phaseName: nearestMoonRow.moon_phase_name,
            phaseAngleDeg: nearestMoonRow.moon_phase_angle_deg,
            riseUtc: nearestMoonRow.moonrise_utc,
            setUtc: nearestMoonRow.moonset_utc
          }
        : null,
      derived: {
        sMoon: moonFactor.factor,
        azimuthSeparationDeg: moonFactor.azimuthSeparationDeg,
        moonVisible: moonFactor.moonVisible,
        illuminationTerm: moonFactor.illuminationTerm,
        separationTerm: moonFactor.separationTerm,
        penalty: moonFactor.penalty
      },
      background: {
        anthropogenicAvailable: false,
        sAnthro: null,
        sBackground: null,
        note: 'Moon-only partial background feature; anthropogenic light is not loaded yet.'
      }
    },
    confidence_payload: {
      availability,
      trajectoryConfidence: computed.row.trajectory_confidence,
      timeConfidence: computed.row.time_confidence,
      moonSourceAvailable: Boolean(nearestMoonRow),
      moonQaAvailable: Boolean(nearestMoonRow?.qa_source_key),
      sMoonAvailable: moonFactor.factor != null
    },
    computed_at: computed.row.computed_at,
    expires_at: computed.row.expires_at,
    snapshot_at: computed.row.snapshot_at,
    updated_at: computed.row.updated_at
  };
}

function buildMoonFeatureSourceRefs(row: MoonEphemerisRow | null) {
  if (!row) return [] as Array<Record<string, unknown>>;
  const refs: Array<Record<string, unknown>> = [];
  if (row.source_key) {
    refs.push({
      sourceKey: row.source_key,
      sourceVersionId: row.source_version_id ?? null,
      sourceFetchRunId: row.source_fetch_run_id ?? null
    });
  }
  if (row.qa_source_key) {
    refs.push({
      sourceKey: row.qa_source_key,
      sourceVersionId: row.qa_version_id ?? null,
      sourceFetchRunId: row.qa_fetch_run_id ?? null
    });
  }
  return refs;
}

function buildBackgroundFeatureSnapshot({
  launch,
  observer,
  trajectory,
  computed,
  moonRows,
  backgroundRows
}: {
  launch: LaunchRow;
  observer: ObserverPoint;
  trajectory: TrajectoryRow;
  computed: JepComputedScore;
  moonRows: MoonEphemerisRow[];
  backgroundRows: BackgroundLightRow[];
}): FeatureSnapshotRow | null {
  if (observer.hash !== PAD_OBSERVER_HASH) return null;
  if (!launch.net) return null;

  const featureCell = deriveJepV6ObserverFeatureCell(observer.latDeg, observer.lonDeg);
  if (!featureCell) return null;

  const representativeCorridor = deriveRepresentativePlumeCorridor({
    samples: computed.samples,
    solarDepressionDeg: computed.row.solar_depression_deg,
    observerLatDeg: observer.latDeg,
    observerLonDeg: observer.lonDeg
  });
  const targetSampleAtMs =
    representativeCorridor && launch.net
      ? Date.parse(launch.net) + representativeCorridor.representativeTPlusSec * 1000
      : Number.NaN;
  const nearestMoonRow =
    representativeCorridor && Number.isFinite(targetSampleAtMs)
      ? findNearestMoonSample(moonRows, targetSampleAtMs, MOON_SAMPLE_MAX_DIFF_MS)
      : null;
  const moonFactor = representativeCorridor
    ? computeJepV6MoonFactor({
        moonAzDeg: nearestMoonRow?.moon_az_deg ?? null,
        moonElDeg: nearestMoonRow?.moon_el_deg ?? null,
        moonIllumFrac: nearestMoonRow?.moon_illum_frac ?? null,
        plumeAzimuthDeg: representativeCorridor.representativeAzimuthDeg
      })
    : {
        factor: null,
        azimuthSeparationDeg: null,
        moonVisible: null,
        illuminationTerm: null,
        separationTerm: null,
        penalty: null
      };

  const selectedBackground = selectBackgroundLightRow(backgroundRows, launch.net);
  const anthroFactor = computeJepV6AnthropogenicFactor({
    radiancePercentile: selectedBackground?.radiance_percentile ?? null
  });
  const backgroundAvailability = readBackgroundAvailability(selectedBackground) ?? 'unknown';
  const sBackground = computeJepV6BackgroundFactor({
    sMoon: moonFactor.factor,
    sAnthro: anthroFactor.factor
  });

  const availability =
    representativeCorridor == null
      ? 'no_visible_or_sunlit_corridor'
      : nearestMoonRow == null
        ? 'missing_moon_ephemeris'
        : moonFactor.factor == null
          ? 'missing_moon_inputs'
          : selectedBackground == null
            ? 'missing_background_light'
            : backgroundAvailability !== 'ok'
              ? `background_${backgroundAvailability}`
              : anthroFactor.factor == null
                ? 'missing_background_percentile'
                : sBackground == null
                  ? 'missing_background_terms'
                  : 'ok';

  const inputHash = buildJepV6FeatureSnapshotInputHash({
    launchId: launch.launch_id,
    observerFeatureCellKey: featureCell.key,
    featureFamily: JEP_V6_BACKGROUND_FEATURE_FAMILY,
    modelVersion: DEFAULT_JEP_V6_MODEL_VERSION,
    inputs: {
      baselineInputHash: computed.row.input_hash,
      trajectoryConfidence: trajectory.confidence_tier ?? null,
      availability,
      representativeCorridor: representativeCorridor
        ? {
            mode: representativeCorridor.mode,
            representativeTPlusSec: round(representativeCorridor.representativeTPlusSec, 3),
            representativeAzimuthDeg: round(representativeCorridor.representativeAzimuthDeg, 3),
            representativeDownrangeKm:
              representativeCorridor.representativeDownrangeKm != null
                ? round(representativeCorridor.representativeDownrangeKm, 3)
                : null,
            sampleCount: representativeCorridor.sampleCount
          }
        : null,
      moonSample: nearestMoonRow
        ? {
            sampleAt: nearestMoonRow.sample_at,
            sourceVersionId: nearestMoonRow.source_version_id ?? null,
            qaVersionId: nearestMoonRow.qa_version_id ?? null
          }
        : null,
      backgroundCell: selectedBackground
        ? {
            sourceKey: selectedBackground.source_key,
            sourceVersionId: selectedBackground.source_version_id ?? null,
            periodStartDate: selectedBackground.period_start_date,
            periodEndDate: selectedBackground.period_end_date,
            percentile: selectedBackground.radiance_percentile,
            dataset: selectedBackground.radiance_dataset
          }
        : null
    }
  });

  return {
    launch_id: launch.launch_id,
    observer_location_hash: computed.row.observer_location_hash,
    observer_feature_key: featureCell.key,
    observer_lat_bucket: featureCell.latCell,
    observer_lon_bucket: featureCell.lonCell,
    feature_family: JEP_V6_BACKGROUND_FEATURE_FAMILY,
    model_version: DEFAULT_JEP_V6_MODEL_VERSION,
    input_hash: inputHash,
    trajectory_input_hash: computed.row.input_hash,
    source_refs: buildCombinedBackgroundSourceRefs(nearestMoonRow, selectedBackground),
    feature_payload: {
      availability,
      observer: {
        source: observer.source,
        latDeg: observer.latDeg,
        lonDeg: observer.lonDeg,
        featureKey: featureCell.key,
        featureCellDeg: featureCell.cellDeg
      },
      launch: {
        net: launch.net,
        missionOrbit: launch.mission_orbit,
        vehicle: launch.vehicle,
        rocketFamily: launch.rocket_family,
        padCountryCode: launch.pad_country_code
      },
      representativeCorridor,
      moon: nearestMoonRow
        ? {
            sampleAt: nearestMoonRow.sample_at,
            sampleOffsetSec: nearestMoonRow.sample_offset_sec,
            azDeg: nearestMoonRow.moon_az_deg,
            elDeg: nearestMoonRow.moon_el_deg,
            illumFrac: nearestMoonRow.moon_illum_frac,
            phaseName: nearestMoonRow.moon_phase_name,
            phaseAngleDeg: nearestMoonRow.moon_phase_angle_deg
          }
        : null,
      backgroundLight: selectedBackground
        ? {
            sourceKey: selectedBackground.source_key,
            productKey: selectedBackground.product_key,
            periodStartDate: selectedBackground.period_start_date,
            periodEndDate: selectedBackground.period_end_date,
            dataset: selectedBackground.radiance_dataset,
            radiance: selectedBackground.radiance_nw_cm2_sr,
            radianceLog: selectedBackground.radiance_log,
            radianceStddev: selectedBackground.radiance_stddev_nw_cm2_sr,
            observationCount: selectedBackground.radiance_observation_count,
            qualityCode: selectedBackground.quality_code,
            landWaterCode: selectedBackground.land_water_code,
            percentile: selectedBackground.radiance_percentile,
            availability: backgroundAvailability
          }
        : null,
      derived: {
        sMoon: moonFactor.factor,
        sAnthro: anthroFactor.factor,
        sBackground,
        azimuthSeparationDeg: moonFactor.azimuthSeparationDeg,
        moonVisible: moonFactor.moonVisible,
        illuminationTerm: moonFactor.illuminationTerm,
        separationTerm: moonFactor.separationTerm,
        moonPenalty: moonFactor.penalty
      }
    },
    confidence_payload: {
      availability,
      trajectoryConfidence: computed.row.trajectory_confidence,
      timeConfidence: computed.row.time_confidence,
      moonSourceAvailable: Boolean(nearestMoonRow),
      backgroundSourceAvailable: Boolean(selectedBackground),
      backgroundAvailability,
      backgroundFallbackUsed: selectedBackground?.product_key === 'VNP46A4',
      sMoonAvailable: moonFactor.factor != null,
      sAnthroAvailable: anthroFactor.factor != null,
      sBackgroundAvailable: sBackground != null
    },
    computed_at: computed.row.computed_at,
    expires_at: computed.row.expires_at,
    snapshot_at: computed.row.snapshot_at,
    updated_at: computed.row.updated_at
  };
}

function buildCombinedBackgroundSourceRefs(moonRow: MoonEphemerisRow | null, backgroundRow: BackgroundLightRow | null) {
  const refs = buildMoonFeatureSourceRefs(moonRow);
  if (!backgroundRow?.source_key) return refs;
  refs.push({
    sourceKey: backgroundRow.source_key,
    sourceVersionId: backgroundRow.source_version_id ?? null,
    sourceFetchRunId: backgroundRow.source_fetch_run_id ?? null
  });
  return refs;
}

function buildHorizonFeatureSnapshot({
  launch,
  observer,
  trajectory,
  computed,
  horizonMaskRow,
  corridorHalfWidthDeg
}: {
  launch: LaunchRow;
  observer: ObserverPoint;
  trajectory: TrajectoryRow;
  computed: JepComputedScore;
  horizonMaskRow: HorizonMaskRow | null;
  corridorHalfWidthDeg: number;
}): FeatureSnapshotRow | null {
  if (observer.hash !== PAD_OBSERVER_HASH) return null;

  const featureCell = deriveJepV6ObserverFeatureCell(observer.latDeg, observer.lonDeg);
  if (!featureCell) return null;

  const representativeCorridor = deriveRepresentativePlumeCorridor({
    samples: computed.samples,
    solarDepressionDeg: computed.row.solar_depression_deg,
    observerLatDeg: observer.latDeg,
    observerLonDeg: observer.lonDeg
  });
  const normalizedProfiles = horizonMaskRow
    ? normalizeJepV6HorizonProfiles({
        azimuthStepDeg: horizonMaskRow.azimuth_step_deg,
        terrainMaskProfile: horizonMaskRow.terrain_mask_profile,
        buildingMaskProfile: horizonMaskRow.building_mask_profile,
        totalMaskProfile: horizonMaskRow.total_mask_profile,
        dominantSourceProfile: horizonMaskRow.dominant_source_profile,
        dominantDistanceMProfile: horizonMaskRow.dominant_distance_m_profile
      })
    : null;
  const corridorMask =
    representativeCorridor && normalizedProfiles
      ? summarizeJepV6HorizonCorridor({
          representativeAzimuthDeg: representativeCorridor.representativeAzimuthDeg,
          azimuthSpreadDeg: representativeCorridor.azimuthSpreadDeg,
          corridorHalfWidthDeg,
          profiles: normalizedProfiles
        })
      : null;
  const representativeElevationDeg = representativeCorridor?.representativeElevationDeg ?? null;
  const clearanceDeg =
    representativeElevationDeg != null && corridorMask?.totalMaskElDeg != null
      ? representativeElevationDeg - corridorMask.totalMaskElDeg
      : null;
  const localHorizonFactor = computeJepV6LocalHorizonFactor(clearanceDeg);
  const maskAvailability = readHorizonMaskAvailability(horizonMaskRow) ?? 'ok';
  const availability =
    representativeCorridor == null
      ? 'no_visible_or_sunlit_corridor'
      : horizonMaskRow == null
        ? 'missing_horizon_mask'
        : maskAvailability !== 'ok'
          ? `horizon_mask_${maskAvailability}`
          : corridorMask == null
            ? 'invalid_horizon_profile'
            : representativeElevationDeg == null
              ? 'missing_representative_elevation'
              : corridorMask.totalMaskElDeg == null
                ? 'missing_total_mask'
                : clearanceDeg == null
                  ? 'missing_clearance'
                  : localHorizonFactor == null
                    ? 'missing_clearance_factor'
                    : 'ok';

  const inputHash = buildJepV6FeatureSnapshotInputHash({
    launchId: launch.launch_id,
    observerFeatureCellKey: featureCell.key,
    featureFamily: JEP_V6_HORIZON_FEATURE_FAMILY,
    modelVersion: DEFAULT_JEP_V6_MODEL_VERSION,
    inputs: {
      baselineInputHash: computed.row.input_hash,
      trajectoryConfidence: trajectory.confidence_tier ?? null,
      availability,
      representativeCorridor: representativeCorridor
        ? {
            mode: representativeCorridor.mode,
            representativeTPlusSec: round(representativeCorridor.representativeTPlusSec, 3),
            representativeAzimuthDeg: round(representativeCorridor.representativeAzimuthDeg, 3),
            representativeElevationDeg:
              representativeCorridor.representativeElevationDeg != null
                ? round(representativeCorridor.representativeElevationDeg, 3)
                : null,
            representativeDownrangeKm:
              representativeCorridor.representativeDownrangeKm != null
                ? round(representativeCorridor.representativeDownrangeKm, 3)
                : null,
            sampleCount: representativeCorridor.sampleCount,
            azimuthSpreadDeg: representativeCorridor.azimuthSpreadDeg != null ? round(representativeCorridor.azimuthSpreadDeg, 3) : null
          }
        : null,
      horizonMask: horizonMaskRow
        ? {
            demSourceVersionId: horizonMaskRow.dem_source_version_id ?? null,
            demReleaseId: horizonMaskRow.dem_release_id ?? null,
            buildingSourceVersionId: horizonMaskRow.building_source_version_id ?? null,
            buildingReleaseId: horizonMaskRow.building_release_id ?? null,
            maskAvailability
          }
        : null,
      corridorMask: corridorMask
        ? {
            totalMaskElDeg: corridorMask.totalMaskElDeg != null ? round(corridorMask.totalMaskElDeg, 3) : null,
            corridorHalfWidthDeg: round(corridorMask.corridorHalfWidthDeg, 3),
            dominantSource: corridorMask.dominantSource,
            dominantDistanceM: corridorMask.dominantDistanceM != null ? round(corridorMask.dominantDistanceM, 1) : null
          }
        : null
    }
  });

  return {
    launch_id: launch.launch_id,
    observer_location_hash: computed.row.observer_location_hash,
    observer_feature_key: featureCell.key,
    observer_lat_bucket: featureCell.latCell,
    observer_lon_bucket: featureCell.lonCell,
    feature_family: JEP_V6_HORIZON_FEATURE_FAMILY,
    model_version: DEFAULT_JEP_V6_MODEL_VERSION,
    input_hash: inputHash,
    trajectory_input_hash: computed.row.input_hash,
    source_refs: buildHorizonFeatureSourceRefs(horizonMaskRow),
    feature_payload: {
      availability,
      observer: {
        source: observer.source,
        latDeg: observer.latDeg,
        lonDeg: observer.lonDeg,
        featureKey: featureCell.key,
        featureCellDeg: featureCell.cellDeg
      },
      launch: {
        net: launch.net,
        missionOrbit: launch.mission_orbit,
        vehicle: launch.vehicle,
        rocketFamily: launch.rocket_family,
        padCountryCode: launch.pad_country_code
      },
      representativeCorridor,
      horizonMask: horizonMaskRow
        ? {
            availability: maskAvailability,
            observerCellDeg: horizonMaskRow.observer_cell_deg,
            azimuthStepDeg: horizonMaskRow.azimuth_step_deg,
            demSourceKey: horizonMaskRow.dem_source_key,
            demReleaseId: horizonMaskRow.dem_release_id,
            buildingSourceKey: horizonMaskRow.building_source_key,
            buildingReleaseId: horizonMaskRow.building_release_id,
            metadata: horizonMaskRow.metadata ?? {}
          }
        : null,
      derived: {
        terrainMaskElDeg: corridorMask?.terrainMaskElDeg ?? null,
        buildingMaskElDeg: corridorMask?.buildingMaskElDeg ?? null,
        totalMaskElDeg: corridorMask?.totalMaskElDeg ?? null,
        clearanceDeg,
        sLocalHorizon: localHorizonFactor,
        dominantSource: corridorMask?.dominantSource ?? null,
        dominantDistanceM: corridorMask?.dominantDistanceM ?? null,
        corridorHalfWidthDeg: corridorMask?.corridorHalfWidthDeg ?? corridorHalfWidthDeg,
        corridorStartAzimuthDeg: corridorMask?.corridorStartAzimuthDeg ?? null,
        corridorEndAzimuthDeg: corridorMask?.corridorEndAzimuthDeg ?? null,
        samplesConsidered: corridorMask?.samplesConsidered ?? 0
      }
    },
    confidence_payload: {
      availability,
      trajectoryConfidence: computed.row.trajectory_confidence,
      timeConfidence: computed.row.time_confidence,
      maskAvailability,
      maskSourceAvailable: Boolean(horizonMaskRow),
      maskProfileValid: Boolean(corridorMask),
      clearanceAvailable: clearanceDeg != null,
      localHorizonFactorAvailable: localHorizonFactor != null
    },
    computed_at: computed.row.computed_at,
    expires_at: computed.row.expires_at,
    snapshot_at: computed.row.snapshot_at,
    updated_at: computed.row.updated_at
  };
}

function buildHorizonFeatureSourceRefs(row: HorizonMaskRow | null) {
  const refs: Array<Record<string, unknown>> = [];
  if (!row) return refs;
  if (row.dem_source_key) {
    refs.push({
      sourceKey: row.dem_source_key,
      sourceVersionId: row.dem_source_version_id ?? null,
      releaseId: row.dem_release_id ?? null
    });
  }
  if (row.building_source_key) {
    refs.push({
      sourceKey: row.building_source_key,
      sourceVersionId: row.building_source_version_id ?? null,
      releaseId: row.building_release_id ?? null
    });
  }
  return refs;
}

function buildShadowScoreCandidateRow({
  launch,
  observer,
  computed,
  vehiclePriorFeatureSnapshot,
  moonFeatureSnapshot,
  backgroundFeatureSnapshot,
  horizonFeatureSnapshot,
  modelVersion
}: {
  launch: LaunchRow;
  observer: ObserverPoint;
  computed: JepComputedScore;
  vehiclePriorFeatureSnapshot: FeatureSnapshotRow | null;
  moonFeatureSnapshot: FeatureSnapshotRow | null;
  backgroundFeatureSnapshot: FeatureSnapshotRow | null;
  horizonFeatureSnapshot: FeatureSnapshotRow | null;
  modelVersion: string;
}): JepScoreCandidateUpsert | null {
  if (observer.hash !== PAD_OBSERVER_HASH) return null;

  const featureCell = deriveJepV6ObserverFeatureCell(observer.latDeg, observer.lonDeg);
  const representativeCorridor =
    readRepresentativeCorridorFromFeatureSnapshot(backgroundFeatureSnapshot) ??
    readRepresentativeCorridorFromFeatureSnapshot(moonFeatureSnapshot) ??
    readRepresentativeCorridorFromFeatureSnapshot(horizonFeatureSnapshot);
  const background = buildShadowBackgroundInput({
    moonFeatureSnapshot,
    backgroundFeatureSnapshot
  });
  const horizon = buildShadowHorizonInput(horizonFeatureSnapshot);
  const missionProfile = buildShadowMissionProfileInput(vehiclePriorFeatureSnapshot);
  const shadow = computeJepV6ShadowScore({
    modelVersion,
    baselineModelVersion: computed.row.model_version,
    baselineScore: computed.row.score,
    solarDepressionDeg: computed.row.solar_depression_deg,
    illuminationFactor: computed.row.illumination_factor,
    sunlitMarginKm: computed.row.sunlit_margin_km,
    losVisibleFraction: computed.row.los_visible_fraction,
    representativeCorridor,
    background,
    horizon,
    missionProfile,
    weather: {
      cloudCoverLowPct: computed.row.cloud_cover_low_pct,
      cloudCoverMidPct: computed.row.cloud_cover_mid_pct,
      cloudCoverHighPct: computed.row.cloud_cover_high_pct,
      obstructionFactor: computed.weather.obstructionFactor
    }
  });

  const featureRefs = {
    baselineInputHash: computed.row.input_hash,
    vehiclePriorFeatureInputHash: vehiclePriorFeatureSnapshot?.input_hash ?? null,
    moonFeatureInputHash: moonFeatureSnapshot?.input_hash ?? null,
    backgroundFeatureInputHash: backgroundFeatureSnapshot?.input_hash ?? null,
    horizonFeatureInputHash: horizonFeatureSnapshot?.input_hash ?? null,
    representativeFeatureFamily: backgroundFeatureSnapshot
      ? JEP_V6_BACKGROUND_FEATURE_FAMILY
      : moonFeatureSnapshot
        ? JEP_V6_MOON_FEATURE_FAMILY
        : horizonFeatureSnapshot
          ? JEP_V6_HORIZON_FEATURE_FAMILY
          : null
  };
  const inputHash = buildJepV6FeatureSnapshotInputHash({
    launchId: launch.launch_id,
    observerFeatureCellKey: featureCell?.key ?? computed.row.observer_location_hash,
    featureFamily: JEP_V6_SHADOW_SCORE_FAMILY,
    modelVersion,
    inputs: {
      ...featureRefs,
      availability: shadow.availability,
      gateOpen: shadow.gateOpen,
      factors: shadow.factors,
      compatibility: shadow.compatibility
    }
  });

  return {
    launch_id: launch.launch_id,
    observer_location_hash: computed.row.observer_location_hash,
    observer_lat_bucket: featureCell?.latCell ?? computed.row.observer_lat_bucket ?? null,
    observer_lon_bucket: featureCell?.lonCell ?? computed.row.observer_lon_bucket ?? null,
    score: shadow.score,
    raw_score: shadow.rawScore,
    gate_open: shadow.gateOpen,
    vismap_modifier: shadow.vismapModifier,
    baseline_model_version: computed.row.model_version,
    baseline_score: computed.row.score,
    score_delta: shadow.score - computed.row.score,
    feature_refs: featureRefs,
    feature_availability: shadow.availability,
    factor_payload: shadow.factors,
    compatibility_payload: shadow.compatibility,
    explainability: shadow.explainability,
    model_version: modelVersion,
    input_hash: inputHash,
    computed_at: computed.row.computed_at,
    expires_at: computed.row.expires_at,
    snapshot_at: computed.row.snapshot_at,
    updated_at: computed.row.updated_at
  };
}

function buildShadowBackgroundInput({
  moonFeatureSnapshot,
  backgroundFeatureSnapshot
}: {
  moonFeatureSnapshot: FeatureSnapshotRow | null;
  backgroundFeatureSnapshot: FeatureSnapshotRow | null;
}): JepV6BackgroundInput {
  const moonDerived = readSnapshotDerivedPayload(moonFeatureSnapshot);
  const backgroundDerived = readSnapshotDerivedPayload(backgroundFeatureSnapshot);
  const backgroundAvailability = readSnapshotAvailability(backgroundFeatureSnapshot);
  if (backgroundFeatureSnapshot) {
    return {
      availability: backgroundAvailability,
      source: 'combined',
      sMoon: readNumberFromRecord(backgroundDerived, 'sMoon'),
      sAnthro: readNumberFromRecord(backgroundDerived, 'sAnthro'),
      sBackground: readNumberFromRecord(backgroundDerived, 'sBackground')
    };
  }

  if (moonFeatureSnapshot) {
    return {
      availability: readSnapshotAvailability(moonFeatureSnapshot),
      source: 'moon_only',
      sMoon: readNumberFromRecord(moonDerived, 'sMoon'),
      sAnthro: null,
      sBackground: null
    };
  }

  return {
    availability: 'neutral_missing_background',
    source: 'neutral',
    sMoon: null,
    sAnthro: null,
    sBackground: null
  };
}

function buildShadowMissionProfileInput(vehiclePriorFeatureSnapshot: FeatureSnapshotRow | null): JepV6MissionProfileInput {
  const derived = readSnapshotDerivedPayload(vehiclePriorFeatureSnapshot);
  const prior = vehiclePriorFeatureSnapshot?.feature_payload?.prior;
  const priorRecord = prior && typeof prior === 'object' ? (prior as Record<string, unknown>) : {};

  return {
    availability: readSnapshotAvailability(vehiclePriorFeatureSnapshot) ?? 'neutral_missing_vehicle_prior',
    source:
      readStringFromRecord(derived, 'source') === 'vehicle_prior' && vehiclePriorFeatureSnapshot
        ? 'vehicle_prior'
        : 'neutral',
    familyKey: readStringFromRecord(priorRecord, 'familyKey'),
    familyLabel: readStringFromRecord(priorRecord, 'familyLabel'),
    matchMode: readMissionProfileMatchMode(priorRecord),
    missionProfileFactor: readNumberFromRecord(derived, 'sMissionProfile'),
    analystConfidence: readStringFromRecord(priorRecord, 'analystConfidence'),
    sourceUrl: readStringFromRecord(priorRecord, 'sourceUrl'),
    sourceTitle: readStringFromRecord(priorRecord, 'sourceTitle'),
    sourceRevision: readStringFromRecord(priorRecord, 'sourceRevision'),
    rationale: readStringFromRecord(priorRecord, 'rationale')
  };
}

function buildShadowHorizonInput(horizonFeatureSnapshot: FeatureSnapshotRow | null): JepV6HorizonInput {
  const derived = readSnapshotDerivedPayload(horizonFeatureSnapshot);
  return {
    availability: readSnapshotAvailability(horizonFeatureSnapshot),
    source: horizonFeatureSnapshot ? 'local_mask' : 'neutral',
    terrainMaskElDeg: readNumberFromRecord(derived, 'terrainMaskElDeg'),
    buildingMaskElDeg: readNumberFromRecord(derived, 'buildingMaskElDeg'),
    totalMaskElDeg: readNumberFromRecord(derived, 'totalMaskElDeg'),
    clearanceDeg: readNumberFromRecord(derived, 'clearanceDeg'),
    factor: readNumberFromRecord(derived, 'sLocalHorizon'),
    dominantSource: readStringFromRecord(derived, 'dominantSource'),
    dominantDistanceM: readNumberFromRecord(derived, 'dominantDistanceM')
  };
}

function readMissionProfileMatchMode(record: Record<string, unknown>): JepV6MissionProfileInput['matchMode'] {
  const value = readStringFromRecord(record, 'matchMode');
  return value === 'config_id' || value === 'family_key' || value === 'pattern' ? value : 'none';
}

function readRepresentativeCorridorFromFeatureSnapshot(snapshot: FeatureSnapshotRow | null): JepV6RepresentativeCorridor | null {
  const raw = snapshot?.feature_payload?.representativeCorridor;
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const mode = record.mode === 'visible_path' || record.mode === 'sunlit_path' ? record.mode : null;
  if (!mode) return null;

  const representativeTPlusSec = toFiniteNumber(record.representativeTPlusSec);
  const representativeAzimuthDeg = toFiniteNumber(record.representativeAzimuthDeg);
  if (representativeTPlusSec == null || representativeAzimuthDeg == null) return null;

  return {
    mode,
    representativeTPlusSec,
    representativeAzimuthDeg,
    representativeElevationDeg: toFiniteNumber(record.representativeElevationDeg),
    representativeAltitudeM: toFiniteNumber(record.representativeAltitudeM),
    representativeDownrangeKm: toFiniteNumber(record.representativeDownrangeKm),
    sampleCount: clampInt(toFiniteNumber(record.sampleCount) ?? 0, 0, 10000),
    corridorStartTPlusSec: toFiniteNumber(record.corridorStartTPlusSec) ?? representativeTPlusSec,
    corridorEndTPlusSec: toFiniteNumber(record.corridorEndTPlusSec) ?? representativeTPlusSec,
    azimuthSpreadDeg: toFiniteNumber(record.azimuthSpreadDeg)
  };
}

function readSnapshotAvailability(snapshot: FeatureSnapshotRow | null) {
  const value = snapshot?.feature_payload?.availability;
  return typeof value === 'string' ? value : null;
}

function readSnapshotDerivedPayload(snapshot: FeatureSnapshotRow | null) {
  const derived = snapshot?.feature_payload?.derived;
  return derived && typeof derived === 'object' ? (derived as Record<string, unknown>) : {};
}

function readNumberFromRecord(record: Record<string, unknown>, key: string) {
  return toFiniteNumber(record[key]);
}

function readStringFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function readHorizonMaskAvailability(row: HorizonMaskRow | null) {
  const value = row?.confidence_payload?.availability;
  return typeof value === 'string' ? value : null;
}

async function loadVehiclePriors(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { data, error } = await supabase
    .from('jep_vehicle_priors')
    .select(
      'family_key, family_label, ll2_rocket_config_id, provider_key, pad_state, rocket_full_name_pattern, rocket_family_pattern, mission_profile_factor, analyst_confidence, source_url, source_title, source_revision, rationale, active_from_date, active_to_date, metadata'
    );
  if (error) {
    const text = `${error.message || ''}`.toLowerCase();
    if (text.includes('jep_vehicle_priors')) return [] as VehiclePriorRow[];
    throw error;
  }

  return ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    familyKey: typeof row.family_key === 'string' ? row.family_key : '',
    familyLabel: typeof row.family_label === 'string' ? row.family_label : null,
    ll2RocketConfigId: toFiniteInteger(row.ll2_rocket_config_id),
    providerKey: typeof row.provider_key === 'string' ? row.provider_key : null,
    padState: typeof row.pad_state === 'string' ? row.pad_state : null,
    rocketFullNamePattern: typeof row.rocket_full_name_pattern === 'string' ? row.rocket_full_name_pattern : null,
    rocketFamilyPattern: typeof row.rocket_family_pattern === 'string' ? row.rocket_family_pattern : null,
    missionProfileFactor: toFiniteNumber(row.mission_profile_factor),
    analystConfidence: typeof row.analyst_confidence === 'string' ? row.analyst_confidence : null,
    sourceUrl: typeof row.source_url === 'string' ? row.source_url : null,
    sourceTitle: typeof row.source_title === 'string' ? row.source_title : null,
    sourceRevision: typeof row.source_revision === 'string' ? row.source_revision : null,
    rationale: typeof row.rationale === 'string' ? row.rationale : null,
    activeFromDate: typeof row.active_from_date === 'string' ? row.active_from_date : null,
    activeToDate: typeof row.active_to_date === 'string' ? row.active_to_date : null,
    metadata: row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : null
  }));
}

async function loadHorizonMasks(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  observerFeatureKeys: string[]
) {
  const byFeatureKey = new Map<string, HorizonMaskRow>();
  const chunkSize = 200;
  for (let i = 0; i < observerFeatureKeys.length; i += chunkSize) {
    const slice = observerFeatureKeys.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('jep_horizon_masks')
      .select(
        'observer_feature_key, observer_lat_bucket, observer_lon_bucket, observer_cell_deg, azimuth_step_deg, terrain_mask_profile, building_mask_profile, total_mask_profile, dominant_source_profile, dominant_distance_m_profile, dem_source_key, dem_source_version_id, dem_release_id, building_source_key, building_source_version_id, building_release_id, metadata, confidence_payload, computed_at, updated_at'
      )
      .in('observer_feature_key', slice);
    if (error) {
      const text = `${error.message || ''}`.toLowerCase();
      if (text.includes('jep_horizon_masks')) return byFeatureKey;
      throw error;
    }
    for (const row of (data || []) as HorizonMaskRow[]) {
      byFeatureKey.set(row.observer_feature_key, row);
    }
  }
  return byFeatureKey;
}

async function loadBackgroundLightCells(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  observerFeatureKeys: string[]
) {
  const byFeatureKey = new Map<string, BackgroundLightRow[]>();
  const chunkSize = 200;
  for (let i = 0; i < observerFeatureKeys.length; i += chunkSize) {
    const slice = observerFeatureKeys.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('jep_background_light_cells')
      .select(
        'observer_feature_key, source_key, source_version_id, source_fetch_run_id, product_key, period_start_date, period_end_date, radiance_dataset, radiance_nw_cm2_sr, radiance_log, radiance_stddev_nw_cm2_sr, radiance_observation_count, quality_code, land_water_code, radiance_percentile, s_anthro, metadata, confidence_payload, updated_at'
      )
      .in('observer_feature_key', slice)
      .order('period_start_date', { ascending: false });
    if (error) {
      const text = `${error.message || ''}`.toLowerCase();
      if (text.includes('jep_background_light_cells')) return byFeatureKey;
      throw error;
    }
    for (const row of (data || []) as BackgroundLightRow[]) {
      const list = byFeatureKey.get(row.observer_feature_key) ?? [];
      list.push(row);
      byFeatureKey.set(row.observer_feature_key, list);
    }
  }
  return byFeatureKey;
}

function selectBackgroundLightRow(rows: BackgroundLightRow[], launchNetIso: string) {
  const monthlyPeriod = deriveBlackMarblePeriod('VNP46A3', launchNetIso);
  const yearlyPeriod = deriveBlackMarblePeriod('VNP46A4', launchNetIso);
  const monthlyRow = monthlyPeriod ? selectNearestBackgroundLightRow(rows, monthlyPeriod.sourceKey, monthlyPeriod.periodStartDate) : null;
  const yearlyRow = yearlyPeriod ? selectNearestBackgroundLightRow(rows, yearlyPeriod.sourceKey, yearlyPeriod.periodStartDate) : null;

  if (readBackgroundAvailability(monthlyRow) === 'ok') return monthlyRow;
  if (readBackgroundAvailability(yearlyRow) === 'ok') return yearlyRow;
  return monthlyRow ?? yearlyRow ?? null;
}

function selectNearestBackgroundLightRow(rows: BackgroundLightRow[], sourceKey: string, desiredPeriodStartDate: string) {
  const matchingRows = rows
    .filter(
      (row) =>
        row.source_key === sourceKey &&
        typeof row.period_start_date === 'string' &&
        row.period_start_date <= desiredPeriodStartDate
    )
    .sort((left, right) => String(right.period_start_date || '').localeCompare(String(left.period_start_date || '')));
  if (!matchingRows.length) return null;
  return matchingRows.find((row) => readBackgroundAvailability(row) === 'ok') ?? matchingRows[0] ?? null;
}

function readBackgroundAvailability(row: BackgroundLightRow | null) {
  const value = row?.confidence_payload?.availability;
  return typeof value === 'string' ? value : null;
}

async function loadMoonEphemerides(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchIds: string[]
) {
  const byLaunch = new Map<string, MoonEphemerisRow[]>();
  const chunkSize = 200;
  for (let i = 0; i < launchIds.length; i += chunkSize) {
    const slice = launchIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('jep_moon_ephemerides')
      .select(
        'launch_id, observer_location_hash, sample_at, sample_offset_sec, source_key, source_version_id, source_fetch_run_id, qa_source_key, qa_version_id, qa_fetch_run_id, moon_az_deg, moon_el_deg, moon_illum_frac, moon_phase_name, moon_phase_angle_deg, moonrise_utc, moonset_utc, metadata, confidence_payload'
      )
      .eq('observer_location_hash', PAD_OBSERVER_HASH)
      .in('launch_id', slice)
      .order('sample_at', { ascending: true });
    if (error) {
      const text = `${error.message || ''}`.toLowerCase();
      if (text.includes('jep_moon_ephemerides')) return byLaunch;
      throw error;
    }
    for (const row of (data || []) as MoonEphemerisRow[]) {
      const list = byLaunch.get(row.launch_id) ?? [];
      list.push(row);
      byLaunch.set(row.launch_id, list);
    }
  }
  return byLaunch;
}

function deriveRepresentativePlumeCorridor({
  samples,
  solarDepressionDeg,
  observerLatDeg,
  observerLonDeg
}: {
  samples: Sample[];
  solarDepressionDeg: number;
  observerLatDeg: number;
  observerLonDeg: number;
}): RepresentativePlumeCorridor | null {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a.tPlusSec - b.tPlusSec);
  const endT = resolveJellyfishEndSeconds(sorted, null);
  const shadowKm = computeShadowHeightKm(solarDepressionDeg);

  const scored = sorted
    .filter((sample) => sample.tPlusSec >= 60 && sample.tPlusSec <= endT)
    .map((sample) => {
      const elevationDeg = elevationFromObserverDeg({
        observerLatDeg,
        observerLonDeg,
        targetLatDeg: sample.latDeg,
        targetLonDeg: sample.lonDeg,
        targetAltM: sample.altM
      });
      const weight = sample.tPlusSec >= 150 && sample.tPlusSec <= 300 ? 2 : 1;
      const sunlit = sample.altM / 1000 > shadowKm;
      const visible = sunlit && Number.isFinite(elevationDeg) && elevationDeg >= LOS_ELEVATION_THRESHOLD_DEG;
      return {
        sample,
        weight,
        sunlit,
        visible,
        elevationDeg: Number.isFinite(elevationDeg) ? elevationDeg : null
      };
    });

  const visible = scored.filter((entry) => entry.visible);
  const sunlit = scored.filter((entry) => entry.sunlit);
  const selected = visible.length ? visible : sunlit.length ? sunlit : [];
  if (!selected.length) return null;

  const mode = visible.length ? 'visible_path' : 'sunlit_path';
  const totalWeight = selected.reduce((sum, entry) => sum + entry.weight, 0);
  if (!totalWeight) return null;

  const representativeTPlusSec =
    selected.reduce((sum, entry) => sum + entry.sample.tPlusSec * entry.weight, 0) / totalWeight;
  const representativeAzimuthDeg = circularMeanDeg(
    selected.map((entry) => ({ deg: entry.sample.azimuthDeg, weight: entry.weight }))
  );
  if (representativeAzimuthDeg == null) return null;

  const azimuthSpreadDeg = selected.reduce((maxDiff, entry) => {
    const diff = angularSeparationDeg(entry.sample.azimuthDeg, representativeAzimuthDeg);
    return Math.max(maxDiff, diff);
  }, 0);
  const representativeElevationDeg = weightedAverage(
    selected.map((entry) => ({ value: entry.elevationDeg, weight: entry.weight }))
  );
  const representativeAltitudeM = weightedAverage(
    selected.map((entry) => ({ value: entry.sample.altM, weight: entry.weight }))
  );
  const representativeDownrangeKm = weightedAverage(
    selected.map((entry) => ({ value: entry.sample.downrangeM / 1000, weight: entry.weight }))
  );

  return {
    mode,
    representativeTPlusSec,
    representativeAzimuthDeg,
    representativeElevationDeg,
    representativeAltitudeM,
    representativeDownrangeKm,
    sampleCount: selected.length,
    corridorStartTPlusSec: selected[0]?.sample.tPlusSec ?? representativeTPlusSec,
    corridorEndTPlusSec: selected[selected.length - 1]?.sample.tPlusSec ?? representativeTPlusSec,
    azimuthSpreadDeg
  };
}

function findNearestMoonSample(rows: MoonEphemerisRow[], targetMs: number, maxDiffMs: number) {
  let best: MoonEphemerisRow | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const sampleMs = Date.parse(String(row.sample_at || ''));
    if (!Number.isFinite(sampleMs)) continue;
    const diff = Math.abs(sampleMs - targetMs);
    if (diff < bestDiff) {
      best = row;
      bestDiff = diff;
    }
  }
  if (!best || bestDiff > maxDiffMs) return null;
  return best;
}

function weightedAverage(entries: Array<{ value: number | null; weight: number }>) {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const entry of entries) {
    if (!Number.isFinite(entry.value) || !Number.isFinite(entry.weight) || entry.weight <= 0) continue;
    weightedSum += Number(entry.value) * entry.weight;
    totalWeight += entry.weight;
  }
  if (!totalWeight) return null;
  return weightedSum / totalWeight;
}

function incrementWeatherSourceStats(
  stats: Record<string, unknown>,
  source: WeatherPoint['source'],
  stage: 'resolved' | 'upserted'
) {
  const prefix = stage === 'resolved' ? 'weatherSourceResolved' : 'weatherSourceUpserted';
  const totalKey = `${prefix}Total`;
  stats[totalKey] = Number(stats[totalKey] || 0) + 1;

  if (source === 'open_meteo') {
    const key = `${prefix}OpenMeteo`;
    stats[key] = Number(stats[key] || 0) + 1;
    return;
  }
  if (source === 'nws') {
    const key = `${prefix}Nws`;
    stats[key] = Number(stats[key] || 0) + 1;
    return;
  }
  if (source === 'mixed') {
    const mixedKey = `${prefix}Mixed`;
    const nwsKey = `${prefix}Nws`;
    const openMeteoKey = `${prefix}OpenMeteo`;
    stats[mixedKey] = Number(stats[mixedKey] || 0) + 1;
    stats[nwsKey] = Number(stats[nwsKey] || 0) + 1;
    stats[openMeteoKey] = Number(stats[openMeteoKey] || 0) + 1;
    return;
  }
  const key = `${prefix}None`;
  stats[key] = Number(stats[key] || 0) + 1;
}

function isScoreEligible(row: LaunchRow, nowMs: number) {
  if (!row?.launch_id) return false;
  const netMs = Date.parse(String(row.net || ''));
  if (!Number.isFinite(netMs)) return false;
  if (netMs < nowMs - SNAPSHOT_LOCK_LOOKBACK_HOURS * 60 * 60 * 1000) return false;
  if (!Number.isFinite(Number(row.pad_latitude)) || !Number.isFinite(Number(row.pad_longitude))) return false;
  const status = `${row.status_name || ''} ${row.status_abbrev || ''}`.toLowerCase();
  if (status.includes('canceled') || status.includes('cancelled')) return false;
  if ((status.includes('success') || status.includes('failure')) && netMs > nowMs) return false;
  return true;
}

function isDueObserver(
  row: LaunchRow,
  existing: ScoreRow | undefined,
  nowMs: number,
  trajectoryGeneratedAtMs: number | null = null
) {
  if (isSnapshotLocked(existing)) return false;
  const netMs = Date.parse(String(row.net || ''));
  if (!Number.isFinite(netMs)) return true;
  if (netMs <= nowMs) return true;
  if (!existing || !existing.expires_at) return true;
  if (trajectoryGeneratedAtMs != null) {
    const computedAtMs = existing.computed_at ? Date.parse(existing.computed_at) : Number.NaN;
    if (!Number.isFinite(computedAtMs) || trajectoryGeneratedAtMs > computedAtMs) return true;
  }
  const expiresAtMs = Date.parse(existing.expires_at);
  if (!Number.isFinite(expiresAtMs)) return true;
  if (expiresAtMs <= nowMs) return true;
  const intervalMin = intervalMinutesForLaunch(netMs, nowMs);
  return expiresAtMs <= nowMs + intervalMin * 10 * 1000;
}

function isSnapshotLocked(existing: ScoreRow | undefined) {
  if (!existing) return false;
  const snapshotAt = String(existing.snapshot_at || '').trim();
  return snapshotAt.length > 0;
}

async function resolveWeatherAssessment({
  supabase,
  observer,
  launch,
  targetMs,
  samplingPlan,
  weatherCache,
  nwsPointCache,
  nwsGridCache,
  weatherCacheMinutes,
  openMeteoUsModels
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  observer: ObserverPoint;
  launch: LaunchRow;
  targetMs: number;
  samplingPlan: WeatherSamplingPlan | null;
  weatherCache: Map<string, { atMs: number; forecast: OpenMeteoForecast | null }>;
  nwsPointCache: Map<string, NwsPointRow | null>;
  nwsGridCache: Map<string, NwsGridForecast | null>;
  weatherCacheMinutes: number;
  openMeteoUsModels: string[];
}): Promise<WeatherAssessment> {
  const observerWeather = await resolvePointWeather({
    supabase,
    launch,
    lat: observer.latDeg,
    lon: observer.lonDeg,
    targetMs,
    weatherCache,
    nwsPointCache,
    nwsGridCache,
    weatherCacheMinutes,
    openMeteoUsModels
  });
  const padWeather =
    samePoint(observer.latDeg, observer.lonDeg, Number(launch.pad_latitude), Number(launch.pad_longitude))
      ? observerWeather
      : await resolvePointWeather({
          supabase,
          launch,
          lat: Number(launch.pad_latitude),
          lon: Number(launch.pad_longitude),
          targetMs,
          weatherCache,
          nwsPointCache,
          nwsGridCache,
          weatherCacheMinutes,
          openMeteoUsModels
        });

  const pathPoints = samplingPlan?.points ?? [];
  const pathWeather = [] as Array<{ point: WeatherSamplingPoint; weather: WeatherResolution }>;
  for (const point of pathPoints) {
    pathWeather.push({
      point,
      weather: await resolvePointWeather({
        supabase,
        launch,
        lat: point.latDeg,
        lon: point.lonDeg,
        targetMs,
        weatherCache,
        nwsPointCache,
        nwsGridCache,
        weatherCacheMinutes,
        openMeteoUsModels
      })
    });
  }

  const contrastFactor = deriveContrastFactor(observerWeather);
  const obstructionFactor = deriveObstructionFactor(observerWeather, pathWeather);
  const fallbackLayerFactor = computeJepWeatherFactor({
    cloudCoverTotal: observerWeather.cloudCoverTotal,
    cloudCoverLow: observerWeather.cloudCoverLow,
    cloudCoverMid: observerWeather.cloudCoverMid,
    cloudCoverHigh: observerWeather.cloudCoverHigh
  });
  const weatherFactor =
    obstructionFactor != null || contrastFactor != null
      ? combineJepWeatherFactors({
          obstructionFactor: obstructionFactor ?? fallbackLayerFactor,
          contrastFactor: contrastFactor ?? fallbackLayerFactor
        })
      : fallbackLayerFactor;

  const usedSources = [observerWeather, padWeather, ...pathWeather.map((entry) => entry.weather)]
    .map((entry) => entry.source)
    .filter((entry) => entry !== 'none');
  const primarySource = summarizeSource(usedSources);
  const sourceUsed =
    primarySource === 'mixed'
      ? 'mixed_nws_open_meteo'
      : primarySource === 'nws'
        ? 'nws_path_sampling'
        : primarySource === 'open_meteo'
          ? 'open_meteo_path_fallback'
          : 'geometry_only';
  const fetchedAtMs = minFinite([
    observerWeather.fetchedAtMs,
    padWeather.fetchedAtMs,
    ...pathWeather.map((entry) => entry.weather.fetchedAtMs)
  ]);
  const observerSummary = summarizeAssessmentPoint('observer', observerWeather);
  const pathSummary = summarizePathAssessment(pathWeather);
  const padSummary = summarizeAssessmentPoint('pad', padWeather);

  return {
    weatherFactor: round(clamp(weatherFactor, 0.08, 1), 3),
    primarySource,
    fetchedAtMs,
    openMeteoFetchCount:
      Number(observerWeather.openMeteoFetched) +
      Number(padWeather.openMeteoFetched && padWeather !== observerWeather) +
      pathWeather.reduce((sum, entry) => sum + Number(entry.weather.openMeteoFetched), 0),
    nwsPointFetchCount:
      Number(observerWeather.nwsPointFetched) +
      Number(padWeather.nwsPointFetched && padWeather !== observerWeather) +
      pathWeather.reduce((sum, entry) => sum + Number(entry.weather.nwsPointFetched), 0),
    nwsGridFetchCount:
      Number(observerWeather.nwsGridFetched) +
      Number(padWeather.nwsGridFetched && padWeather !== observerWeather) +
      pathWeather.reduce((sum, entry) => sum + Number(entry.weather.nwsGridFetched), 0),
    sourceUsed,
    samplingMode: samplingPlan?.mode ?? 'observer_only',
    samplingNote: samplingPlan?.note ?? 'Using the observer point only because no plume path sample was available.',
    contrastFactor: contrastFactor != null ? round(contrastFactor, 3) : null,
    obstructionFactor: obstructionFactor != null ? round(obstructionFactor, 3) : null,
    mainBlocker: deriveMainWeatherBlocker({
      observerWeather,
      pathWeather,
      observerSummary,
      pathSummary
    }),
    observer: observerSummary,
    alongPath: pathSummary,
    pad: padSummary
  };
}

async function resolvePointWeather({
  supabase,
  launch,
  lat,
  lon,
  targetMs,
  weatherCache,
  nwsPointCache,
  nwsGridCache,
  weatherCacheMinutes,
  openMeteoUsModels
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  launch: LaunchRow;
  lat: number;
  lon: number;
  targetMs: number;
  weatherCache: Map<string, { atMs: number; forecast: OpenMeteoForecast | null }>;
  nwsPointCache: Map<string, NwsPointRow | null>;
  nwsGridCache: Map<string, NwsGridForecast | null>;
  weatherCacheMinutes: number;
  openMeteoUsModels: string[];
}): Promise<WeatherResolution> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return emptyWeatherResolution();
  }

  const isUsLocation = isLikelyUsCoordinate(lat, lon) || isUsCountryCode(launch.pad_country_code);
  let openMeteoFetched = false;
  let nwsPointFetched = false;
  let nwsGridFetched = false;
  let cloudCoverTotal: number | null = null;
  let cloudCoverLow: number | null = null;
  let cloudCoverMid: number | null = null;
  let cloudCoverHigh: number | null = null;
  let skyCoverPct: number | null = null;
  let ceilingFt: number | null = null;
  let fetchedAtCandidates: Array<number | null> = [];

  const forecast = await resolveOpenMeteoForecast({
    lat,
    lon,
    isUsLocation,
    targetMs,
    weatherCache,
    weatherCacheMinutes,
    openMeteoUsModels
  });
  if (forecast != null) {
    cloudCoverTotal = forecast.cloudCoverTotal;
    cloudCoverLow = forecast.cloudCoverLow;
    cloudCoverMid = forecast.cloudCoverMid;
    cloudCoverHigh = forecast.cloudCoverHigh;
    fetchedAtCandidates.push(forecast.fetchedAtMs);
    openMeteoFetched = forecast.openMeteoFetched;
  }

  if (isUsLocation) {
    try {
      const nwsPoint = await resolveNwsPoint({
        supabase,
        lat,
        lon,
        ll2PadId: null,
        nwsPointCache
      });
      nwsPointFetched = nwsPoint.pointFetched;
      if (nwsPoint.row?.forecast_grid_data_url) {
        const grid = await resolveNwsGridForecast(nwsPoint.row.forecast_grid_data_url, nwsGridCache);
        nwsGridFetched = grid.gridFetched;
        if (grid.forecast?.properties) {
          const sample = sampleNwsGridForecast(grid.forecast.properties, targetMs);
          skyCoverPct = sample.skyCoverPct;
          ceilingFt = sample.ceilingFt;
          fetchedAtCandidates.push(grid.forecast.updatedAtMs);
        }
      }
    } catch (err) {
      // NWS path sampling is additive. If it fails for a point, keep the Open-Meteo fallback
      // rather than aborting the full launch score refresh.
      console.warn('jep-score-refresh nws weather fallback warning', {
        lat,
        lon,
        error: stringifyError(err)
      });
    }
  }

  const source =
    (skyCoverPct != null || ceilingFt != null) && (cloudCoverTotal != null || cloudCoverLow != null || cloudCoverMid != null || cloudCoverHigh != null)
      ? 'mixed'
      : skyCoverPct != null || ceilingFt != null
        ? 'nws'
        : cloudCoverTotal != null || cloudCoverLow != null || cloudCoverMid != null || cloudCoverHigh != null
          ? 'open_meteo'
          : 'none';

  return {
    source,
    cloudCoverTotal,
    cloudCoverLow,
    cloudCoverMid,
    cloudCoverHigh,
    skyCoverPct: skyCoverPct ?? cloudCoverTotal,
    ceilingFt,
    fetchedAtMs: minFinite(fetchedAtCandidates),
    openMeteoFetched,
    nwsPointFetched,
    nwsGridFetched
  };
}

async function fetchOpenMeteoForecast({
  lat,
  lon,
  isUsLocation,
  usModels
}: {
  lat: number;
  lon: number;
  isUsLocation: boolean;
  usModels: string[];
}) {
  const modelAttempts = isUsLocation ? [...usModels, ''] : [''];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    for (const model of modelAttempts) {
      const params = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        hourly: 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility',
        timezone: 'UTC',
        forecast_days: '16'
      });
      if (model) params.set('models', model);

      const res = await fetch(`${OPEN_METEO_BASE}?${params.toString()}`, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'User-Agent': 'tminuszero.app (contact@tminuszero.app)' }
      });

      if (!res.ok) continue;
      const payload = await res.json();
      const hourly = payload?.hourly;
      const timesRaw = Array.isArray(hourly?.time) ? (hourly.time as unknown[]) : [];
      const cloudCoverRaw = Array.isArray(hourly?.cloud_cover) ? (hourly.cloud_cover as unknown[]) : [];
      const cloudCoverLowRaw = Array.isArray(hourly?.cloud_cover_low) ? (hourly.cloud_cover_low as unknown[]) : [];
      const cloudCoverMidRaw = Array.isArray(hourly?.cloud_cover_mid) ? (hourly.cloud_cover_mid as unknown[]) : [];
      const cloudCoverHighRaw = Array.isArray(hourly?.cloud_cover_high) ? (hourly.cloud_cover_high as unknown[]) : [];
      if (!timesRaw.length || !cloudCoverRaw.length) continue;

      const timesMs: number[] = [];
      const cloudCoverTotal: Array<number | null> = [];
      const cloudCoverLow: Array<number | null> = [];
      const cloudCoverMid: Array<number | null> = [];
      const cloudCoverHigh: Array<number | null> = [];

      const maxLen = Math.max(timesRaw.length, cloudCoverRaw.length, cloudCoverLowRaw.length, cloudCoverMidRaw.length, cloudCoverHighRaw.length);
      for (let i = 0; i < maxLen; i += 1) {
        const t = Date.parse(String(timesRaw[i] || ''));
        if (!Number.isFinite(t)) continue;
        timesMs.push(t);
        cloudCoverTotal.push(toFiniteNumber(cloudCoverRaw[i]));
        cloudCoverLow.push(toFiniteNumber(cloudCoverLowRaw[i]));
        cloudCoverMid.push(toFiniteNumber(cloudCoverMidRaw[i]));
        cloudCoverHigh.push(toFiniteNumber(cloudCoverHighRaw[i]));
      }

      if (!timesMs.length) continue;

      return {
        fetchedAtMs: Date.now(),
        timesMs,
        cloudCoverTotal,
        cloudCoverLow,
        cloudCoverMid,
        cloudCoverHigh
      } as OpenMeteoForecast;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveOpenMeteoForecast({
  lat,
  lon,
  isUsLocation,
  targetMs,
  weatherCache,
  weatherCacheMinutes,
  openMeteoUsModels
}: {
  lat: number;
  lon: number;
  isUsLocation: boolean;
  targetMs: number;
  weatherCache: Map<string, { atMs: number; forecast: OpenMeteoForecast | null }>;
  weatherCacheMinutes: number;
  openMeteoUsModels: string[];
}) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const nowMs = Date.now();
  let openMeteoFetched = false;

  const cached = weatherCache.get(key);
  let forecast = cached?.forecast || null;
  if (!cached || nowMs - cached.atMs > weatherCacheMinutes * 60 * 1000) {
    forecast = await fetchOpenMeteoForecast({
      lat,
      lon,
      isUsLocation,
      usModels: openMeteoUsModels
    });
    weatherCache.set(key, { atMs: nowMs, forecast });
    openMeteoFetched = Boolean(forecast);
  }

  if (!forecast || !forecast.timesMs.length) return null;
  const idx = nearestTimeIndex(forecast.timesMs, targetMs);
  if (idx < 0) return null;
  return {
    cloudCoverTotal: idx < forecast.cloudCoverTotal.length ? forecast.cloudCoverTotal[idx] : null,
    cloudCoverLow: idx < forecast.cloudCoverLow.length ? forecast.cloudCoverLow[idx] : null,
    cloudCoverMid: idx < forecast.cloudCoverMid.length ? forecast.cloudCoverMid[idx] : null,
    cloudCoverHigh: idx < forecast.cloudCoverHigh.length ? forecast.cloudCoverHigh[idx] : null,
    fetchedAtMs: forecast.fetchedAtMs,
    openMeteoFetched
  };
}

function nearestTimeIndex(timesMs: number[], targetMs: number) {
  let bestIdx = -1;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < timesMs.length; i += 1) {
    const ms = timesMs[i];
    if (!Number.isFinite(ms)) continue;
    const diff = Math.abs(ms - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

async function resolveNwsPoint({
  supabase,
  lat,
  lon,
  ll2PadId,
  nwsPointCache
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  lat: number;
  lon: number;
  ll2PadId: number | null;
  nwsPointCache: Map<string, NwsPointRow | null>;
}) {
  const coordKey = toCoordKey(lat, lon);
  if (nwsPointCache.has(coordKey)) {
    return {
      row: nwsPointCache.get(coordKey) || null,
      pointFetched: false
    };
  }

  const { data, error } = await supabase.from('nws_points').select('*').eq('coord_key', coordKey).maybeSingle();
  if (error) throw error;
  const existing = (data as NwsPointRow | null) ?? null;
  const staleBeforeIso = new Date(Date.now() - NWS_POINTS_CACHE_HOURS * 60 * 60 * 1000).toISOString();
  if (existing && existing.forecast_grid_data_url && existing.fetched_at >= staleBeforeIso) {
    nwsPointCache.set(coordKey, existing);
    return { row: existing, pointFetched: false };
  }

  const fetched = await fetchNwsPoints(lat, lon);
  const payload = {
    coord_key: coordKey,
    ll2_pad_id: ll2PadId,
    latitude: lat,
    longitude: lon,
    cwa: fetched.cwa,
    grid_id: fetched.gridId,
    grid_x: fetched.gridX,
    grid_y: fetched.gridY,
    forecast_url: fetched.forecast,
    forecast_hourly_url: fetched.forecastHourly,
    forecast_grid_data_url: fetched.forecastGridData,
    time_zone: fetched.timeZone,
    county_url: fetched.county,
    forecast_zone_url: fetched.forecastZone,
    raw: fetched.raw,
    fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const { data: upserted, error: upsertError } = await supabase
    .from('nws_points')
    .upsert(payload, { onConflict: 'coord_key' })
    .select('*')
    .maybeSingle();
  if (upsertError) throw upsertError;
  const row = (upserted as NwsPointRow | null) ?? null;
  nwsPointCache.set(coordKey, row);
  return { row, pointFetched: true };
}

async function fetchNwsPoints(lat: number, lon: number) {
  const url = `${NWS_BASE}/points/${lat},${lon}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': NWS_USER_AGENT,
      accept: 'application/geo+json'
    }
  });
  if (!res.ok) throw new Error(`nws_points_${res.status}`);
  const json = await res.json();
  const props = json?.properties || {};
  const gridId = String(props.gridId || props.gridID || '').trim();
  const gridX = Number(props.gridX);
  const gridY = Number(props.gridY);
  const forecast = String(props.forecast || '').trim();
  const forecastHourly = String(props.forecastHourly || '').trim();
  const forecastGridData = String(props.forecastGridData || '').trim();
  const timeZone = typeof props.timeZone === 'string' ? props.timeZone : null;
  const cwa = typeof props.cwa === 'string' ? props.cwa : null;
  const county = typeof props.county === 'string' ? props.county : null;
  const forecastZone = typeof props.forecastZone === 'string' ? props.forecastZone : null;

  if (!gridId || !Number.isFinite(gridX) || !Number.isFinite(gridY) || !forecast || !forecastHourly) {
    throw new Error('nws_points_missing_fields');
  }

  return {
    gridId,
    gridX: Math.trunc(gridX),
    gridY: Math.trunc(gridY),
    forecast,
    forecastHourly,
    forecastGridData: forecastGridData || null,
    timeZone,
    cwa,
    county,
    forecastZone,
    raw: json
  };
}

async function resolveNwsGridForecast(url: string, nwsGridCache: Map<string, NwsGridForecast | null>) {
  if (nwsGridCache.has(url)) {
    return {
      forecast: nwsGridCache.get(url) || null,
      gridFetched: false
    };
  }

  const res = await fetch(url, {
    headers: {
      'User-Agent': NWS_USER_AGENT,
      accept: 'application/geo+json'
    }
  });
  if (!res.ok) throw new Error(`nws_grid_${res.status}`);
  const json = await res.json();
  const forecast: NwsGridForecast = {
    updatedAtMs: Date.parse(String(json?.properties?.updateTime || json?.properties?.generatedAt || '')) || Date.now(),
    properties: json?.properties && typeof json.properties === 'object' ? (json.properties as Record<string, unknown>) : null
  };
  nwsGridCache.set(url, forecast);
  return {
    forecast,
    gridFetched: true
  };
}

function sampleNwsGridForecast(properties: Record<string, unknown>, targetMs: number) {
  return {
    skyCoverPct: extractNwsGridField(properties, 'skyCover', targetMs, { clampMin: 0, clampMax: 100 }),
    ceilingFt: extractNwsGridField(properties, 'ceiling', targetMs, { clampMin: 0 })
  };
}

function extractNwsGridField(
  properties: Record<string, unknown>,
  field: string,
  targetMs: number,
  options: { clampMin?: number; clampMax?: number } = {}
) {
  const candidate = (properties as Record<string, any>)[field];
  const values = Array.isArray(candidate?.values) ? (candidate.values as Array<Record<string, unknown>>) : [];
  if (!values.length) return null;

  let nearest: number | null = null;
  let nearestDiff = Number.POSITIVE_INFINITY;

  for (const row of values) {
    const value = toFiniteNumber((row as any)?.value);
    if (value == null) continue;
    const { startMs, endMs } = parseNwsValidTime((row as any)?.validTime);
    if (startMs == null) continue;
    const normalized = clampMaybe(value, options.clampMin ?? null, options.clampMax ?? null);

    if (targetMs >= startMs && (endMs == null || targetMs < endMs)) {
      return normalized;
    }

    const diff = Math.abs(startMs - targetMs);
    if (diff < nearestDiff) {
      nearestDiff = diff;
      nearest = normalized;
    }
  }

  return nearest;
}

function parseNwsValidTime(raw: unknown) {
  const text = String(raw || '').trim();
  if (!text) return { startMs: null as number | null, endMs: null as number | null };
  const [startIso, durationIso] = text.split('/');
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return { startMs: null as number | null, endMs: null as number | null };

  const durationMs = parseIsoDurationMs(durationIso);
  if (durationMs == null) return { startMs, endMs: null as number | null };
  return { startMs, endMs: startMs + durationMs };
}

function parseIsoDurationMs(raw: unknown) {
  const text = String(raw || '').trim().toUpperCase();
  if (!text) return null;
  const match = text.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!match) return null;
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  const totalMs = (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
  if (!Number.isFinite(totalMs) || totalMs <= 0) return null;
  return totalMs;
}

function buildWeatherSamplingPlan({
  samples,
  observerLatDeg,
  observerLonDeg,
  solarDepressionDeg
}: {
  samples: Sample[];
  observerLatDeg: number;
  observerLonDeg: number;
  solarDepressionDeg: number;
}): WeatherSamplingPlan | null {
  if (!samples.length) return null;
  const shadowKm = computeShadowHeightKm(solarDepressionDeg);
  const filtered = samples.filter((sample) => sample.tPlusSec >= 60 && sample.tPlusSec <= resolveJellyfishEndSeconds(samples, null));
  if (!filtered.length) return null;

  const scored = filtered.map((sample) => {
    const altKm = sample.altM / 1000;
    const sunlit = altKm > shadowKm;
    const elevationDeg = elevationFromObserverDeg({
      observerLatDeg,
      observerLonDeg,
      targetLatDeg: sample.latDeg,
      targetLonDeg: sample.lonDeg,
      targetAltM: sample.altM
    });
    return {
      sample,
      sunlit,
      visible: sunlit && Number.isFinite(elevationDeg) && elevationDeg >= LOS_ELEVATION_THRESHOLD_DEG,
      elevationDeg
    };
  });

  const visible = scored.filter((entry) => entry.visible);
  const sunlit = scored.filter((entry) => entry.sunlit);
  const selected = visible.length > 0 ? visible : sunlit.length > 0 ? sunlit : scored;
  const mode: WeatherSamplingMode =
    visible.length > 0 ? 'visible_path' : sunlit.length > 0 ? 'sunlit_path' : 'modeled_path';
  const pointSamples = selectWeatherPathSamples(selected);

  return {
    mode,
    note:
      mode === 'visible_path'
        ? 'Sampling the start, middle, and end of the currently visible plume path.'
        : mode === 'sunlit_path'
          ? 'No clear visible segment is modeled, so the weather check follows the strongest sunlit part of the path.'
          : 'No visible or sunlit plume segment is modeled, so the weather check follows the broader modeled ascent path for planning only.',
    points: pointSamples.map((entry, index, items) => ({
      role: weatherPathRole(index, items.length),
      latDeg: entry.sample.latDeg,
      lonDeg: entry.sample.lonDeg,
      tPlusSec: Math.round(entry.sample.tPlusSec),
      altitudeM: Math.round(entry.sample.altM),
      azimuthDeg: round(entry.sample.azimuthDeg, 1),
      elevationDeg: round(entry.elevationDeg, 1)
    }))
  };
}

function selectWeatherPathSamples(samples: Array<{ sample: Sample; elevationDeg: number }>) {
  if (samples.length <= 1) return samples.slice(0, 1);
  if (samples.length === 2) return [samples[0], samples[1]];
  const midIndex = Math.floor((samples.length - 1) / 2);
  return [samples[0], samples[midIndex], samples[samples.length - 1]];
}

function weatherPathRole(index: number, count: number): WeatherSamplingPoint['role'] {
  if (count === 1) return 'path_mid';
  if (count === 2) return index === 0 ? 'path_start' : 'path_end';
  return index === 0 ? 'path_start' : index === count - 1 ? 'path_end' : 'path_mid';
}

function deriveContrastFactor(weather: WeatherResolution) {
  if (
    weather.cloudCoverTotal == null &&
    weather.cloudCoverLow == null &&
    weather.cloudCoverMid == null &&
    weather.cloudCoverHigh == null
  ) {
    return null;
  }

  return computeJepWeatherContrastFactor({
    cloudCoverTotal: weather.cloudCoverTotal,
    cloudCoverLow: weather.cloudCoverLow,
    cloudCoverMid: weather.cloudCoverMid,
    cloudCoverHigh: weather.cloudCoverHigh
  });
}

function deriveObstructionFactor(
  observerWeather: WeatherResolution,
  pathWeather: Array<{ point: WeatherSamplingPoint; weather: WeatherResolution }>
) {
  const weighted: Array<{ weight: number; factor: number }> = [];

  const observerImpact = deriveJepCloudObstructionImpact({
    skyCoverPct: observerWeather.skyCoverPct,
    ceilingFt: observerWeather.ceilingFt
  });
  if (observerImpact.level !== 'unknown') {
    weighted.push({ weight: 0.45, factor: observerImpact.factor });
  }

  for (const entry of pathWeather) {
    const impact = deriveJepCloudObstructionImpact({
      skyCoverPct: entry.weather.skyCoverPct,
      ceilingFt: entry.weather.ceilingFt,
      elevationDeg: entry.point.elevationDeg
    });
    if (impact.level === 'unknown') continue;
    const weight = entry.point.role === 'path_start' ? 0.25 : entry.point.role === 'path_mid' ? 0.2 : 0.1;
    weighted.push({ weight, factor: impact.factor });
  }

  if (!weighted.length) return null;
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const weightedAverage = weighted.reduce((sum, entry) => sum + entry.weight * entry.factor, 0) / totalWeight;
  const worstFactor = weighted.reduce((lowest, entry) => Math.min(lowest, entry.factor), 1);
  return clamp(weightedAverage * 0.75 + worstFactor * 0.25, 0.08, 1);
}

function summarizeAssessmentPoint(
  role: WeatherAssessmentPoint['role'],
  weather: WeatherResolution
): WeatherAssessmentPoint | null {
  if (
    weather.cloudCoverTotal == null &&
    weather.cloudCoverLow == null &&
    weather.cloudCoverMid == null &&
    weather.cloudCoverHigh == null &&
    weather.skyCoverPct == null &&
    weather.ceilingFt == null
  ) {
    return null;
  }

  const obstruction = deriveJepCloudObstructionImpact({
    skyCoverPct: weather.skyCoverPct,
    ceilingFt: weather.ceilingFt
  });
  return {
    role,
    source: weather.source,
    totalCloudPct: toInt(weather.cloudCoverTotal),
    lowCloudPct: toInt(weather.cloudCoverLow),
    midCloudPct: toInt(weather.cloudCoverMid),
    highCloudPct: toInt(weather.cloudCoverHigh),
    skyCoverPct: toInt(weather.skyCoverPct),
    ceilingFt: weather.ceilingFt != null ? clampInt(weather.ceilingFt, 0, 60000) : null,
    obstructionFactor: round(obstruction.factor, 3),
    obstructionLevel: obstruction.level,
    note: formatAssessmentPointNote(role, weather, obstruction)
  };
}

function summarizePathAssessment(pathWeather: Array<{ point: WeatherSamplingPoint; weather: WeatherResolution }>) {
  if (!pathWeather.length) return null;

  const pathPoints = pathWeather
    .map((entry) => ({
      role: entry.point.role,
      source: entry.weather.source,
      skyCoverPct: entry.weather.skyCoverPct,
      ceilingFt: entry.weather.ceilingFt,
      obstruction: deriveJepCloudObstructionImpact({
        skyCoverPct: entry.weather.skyCoverPct,
        ceilingFt: entry.weather.ceilingFt,
        elevationDeg: entry.point.elevationDeg
      })
    }))
    .filter((entry) => entry.obstruction.level !== 'unknown');

  if (!pathPoints.length) {
    return {
      source: 'none' as const,
      samplesConsidered: 0,
      worstRole: null,
      skyCoverPct: null,
      ceilingFt: null,
      obstructionLevel: 'unknown' as const,
      note: null
    };
  }

  const worst = pathPoints.reduce((current, entry) =>
    entry.obstruction.factor < current.obstruction.factor ? entry : current
  );
  return {
    source: summarizeSource(pathPoints.map((entry) => entry.source)),
    samplesConsidered: pathPoints.length,
    worstRole: worst.role,
    skyCoverPct: toInt(worst.skyCoverPct),
    ceilingFt: worst.ceilingFt != null ? clampInt(worst.ceilingFt, 0, 60000) : null,
    obstructionLevel: worst.obstruction.level,
    note: formatPathAssessmentNote(worst)
  };
}

function deriveMainWeatherBlocker({
  observerWeather,
  pathWeather,
  observerSummary,
  pathSummary
}: {
  observerWeather: WeatherResolution;
  pathWeather: Array<{ point: WeatherSamplingPoint; weather: WeatherResolution }>;
  observerSummary: WeatherAssessmentPoint | null;
  pathSummary: WeatherAssessment['alongPath'];
}): WeatherAssessment['mainBlocker'] {
  const observerObstruction = deriveJepCloudObstructionImpact({
    skyCoverPct: observerWeather.skyCoverPct,
    ceilingFt: observerWeather.ceilingFt
  });
  const observerContrast = deriveJepWeatherContrastImpact({
    cloudCoverTotal: observerWeather.cloudCoverTotal,
    cloudCoverLow: observerWeather.cloudCoverLow,
    cloudCoverMid: observerWeather.cloudCoverMid,
    cloudCoverHigh: observerWeather.cloudCoverHigh
  });
  const pathWorst = pathWeather
    .map((entry) => ({
      role: entry.point.role,
      obstruction: deriveJepCloudObstructionImpact({
        skyCoverPct: entry.weather.skyCoverPct,
        ceilingFt: entry.weather.ceilingFt,
        elevationDeg: entry.point.elevationDeg
      })
    }))
    .filter((entry) => entry.obstruction.level !== 'unknown')
    .reduce((current, entry) => {
      if (!current) return entry;
      return entry.obstruction.penalties.combined > current.obstruction.penalties.combined ? entry : current;
    }, null as { role: WeatherSamplingPoint['role']; obstruction: ReturnType<typeof deriveJepCloudObstructionImpact> } | null);

  if (pathWorst && pathWorst.obstruction.penalties.combined >= observerObstruction.penalties.combined + 0.08) {
    if (pathWorst.obstruction.penalties.ceiling >= pathWorst.obstruction.penalties.sky && pathSummary?.ceilingFt != null) {
      return 'path_low_ceiling';
    }
    return 'path_sky_cover';
  }

  if (observerSummary) {
    if (observerObstruction.penalties.ceiling >= observerObstruction.penalties.sky && observerSummary.ceilingFt != null) {
      return 'observer_low_ceiling';
    }
    if (observerObstruction.penalties.sky >= 0.2 && observerSummary.skyCoverPct != null) {
      return 'observer_sky_cover';
    }
  }

  if (observerContrast.dominantBlocker === 'low') return 'observer_low_clouds';
  if (observerContrast.dominantBlocker === 'mid') return 'observer_mid_clouds';
  if (observerContrast.dominantBlocker === 'high') return 'observer_high_clouds';
  if (observerContrast.dominantBlocker === 'mixed') return 'mixed';
  return 'unknown';
}

function formatAssessmentPointNote(
  role: WeatherAssessmentPoint['role'],
  weather: WeatherResolution,
  obstruction: ReturnType<typeof deriveJepCloudObstructionImpact>
) {
  const label = role === 'observer' ? 'At your location' : role === 'pad' ? 'At the pad' : 'At this path sample';
  if (obstruction.level === 'likely_blocked') {
    if (weather.ceilingFt != null && weather.ceilingFt <= 4000) {
      return `${label}, a low ceiling near ${Math.round(weather.ceilingFt)} ft makes the plume path look blocked.`;
    }
    if (weather.skyCoverPct != null) {
      return `${label}, sky cover near ${Math.round(weather.skyCoverPct)}% makes blockage likely.`;
    }
  }
  if (obstruction.level === 'partly_obstructed') {
    if (weather.ceilingFt != null) {
      return `${label}, cloud structure near ${Math.round(weather.ceilingFt)} ft could partly obstruct the plume.`;
    }
    if (weather.skyCoverPct != null) {
      return `${label}, sky cover near ${Math.round(weather.skyCoverPct)}% softens the weather outlook.`;
    }
  }
  if (obstruction.level === 'clear') {
    return `${label}, clouds are not the main blocker right now.`;
  }
  return null;
}

function formatPathAssessmentNote(worst: {
  role: WeatherSamplingPoint['role'];
  skyCoverPct: number | null;
  ceilingFt: number | null;
  obstruction: ReturnType<typeof deriveJepCloudObstructionImpact>;
}) {
  const position = worst.role === 'path_start' ? 'early' : worst.role === 'path_mid' ? 'middle' : 'late';
  if (worst.obstruction.level === 'likely_blocked') {
    if (worst.ceilingFt != null && worst.ceilingFt <= 4000) {
      return `The ${position} plume path runs under a low ceiling near ${Math.round(worst.ceilingFt)} ft, so blockage looks likely.`;
    }
    if (worst.skyCoverPct != null) {
      return `The ${position} plume path sits under sky cover near ${Math.round(worst.skyCoverPct)}%, so blockage looks likely.`;
    }
  }
  if (worst.obstruction.level === 'partly_obstructed') {
    if (worst.ceilingFt != null) {
      return `The ${position} plume path may be partly obstructed by cloud layers near ${Math.round(worst.ceilingFt)} ft.`;
    }
    if (worst.skyCoverPct != null) {
      return `The ${position} plume path runs through sky cover near ${Math.round(worst.skyCoverPct)}%, which could soften visibility.`;
    }
  }
  return 'Clouds along the modeled plume path are not the main blocker right now.';
}

function summarizeSource(sources: Array<WeatherPoint['source']>) {
  const unique = [...new Set(sources.filter((source) => source !== 'none'))];
  if (!unique.length) return 'none' as const;
  if (unique.length > 1 || unique[0] === 'mixed') return 'mixed' as const;
  return unique[0] as 'open_meteo' | 'nws';
}

function samePoint(aLat: number, aLon: number, bLat: number, bLon: number) {
  return Number.isFinite(aLat) && Number.isFinite(aLon) && Number.isFinite(bLat) && Number.isFinite(bLon)
    ? Math.abs(aLat - bLat) < 0.0001 && Math.abs(aLon - bLon) < 0.0001
    : false;
}

function emptyWeatherResolution(): WeatherResolution {
  return {
    source: 'none',
    cloudCoverTotal: null,
    cloudCoverLow: null,
    cloudCoverMid: null,
    cloudCoverHigh: null,
    skyCoverPct: null,
    ceilingFt: null,
    fetchedAtMs: null,
    openMeteoFetched: false,
    nwsPointFetched: false,
    nwsGridFetched: false
  };
}

function minFinite(values: Array<number | null>) {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!finite.length) return null;
  return Math.min(...finite);
}

function clampMaybe(value: number, min: number | null, max: number | null) {
  let result = value;
  if (min != null) result = Math.max(min, result);
  if (max != null) result = Math.min(max, result);
  return result;
}

function toCoordKey(lat: number, lon: number) {
  const latFixed = normalizeCoord(lat).toFixed(4);
  const lonFixed = normalizeCoord(lon).toFixed(4);
  return `${latFixed},${lonFixed}`;
}

function normalizeCoord(value: number) {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 10_000) / 10_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function isUsCountryCode(value: string | null) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'US' || normalized === 'USA';
}

function normalizeModelList(input: string[], fallback: string[]) {
  const deduped = new Set<string>();
  for (const raw of input) {
    const value = String(raw || '').trim();
    if (!value) continue;
    deduped.add(value);
  }
  if (!deduped.size) {
    for (const raw of fallback) {
      const value = String(raw || '').trim();
      if (!value) continue;
      deduped.add(value);
    }
  }
  return [...deduped];
}

function firstFiniteNumber(...values: Array<number | null>) {
  for (const value of values) {
    if (value != null && Number.isFinite(value)) return value;
  }
  return null;
}

function mapTimeConfidence(netPrecision: string | null) {
  const value = String(netPrecision || '').trim().toLowerCase();
  if (!value) return 'UNKNOWN';
  if (value.includes('second') || value.includes('minute') || value === 'min' || value === 'minute') return 'HIGH';
  if (value.includes('hour')) return 'MEDIUM';
  if (value.includes('day') || value.includes('week') || value.includes('month')) return 'LOW';
  if (value === 'tbd') return 'UNKNOWN';
  return 'UNKNOWN';
}

function mapTrajectoryConfidence(confidenceTier: string | null) {
  const tier = String(confidenceTier || '').trim().toUpperCase();
  if (tier === 'A' || tier === 'B') return 'HIGH';
  if (tier === 'C') return 'MEDIUM';
  if (tier === 'D') return 'LOW';
  return 'UNKNOWN';
}

function mapWeatherConfidence(fetchedAtMs: number | null, nowMs: number, source: WeatherPoint['source']) {
  if (source === 'none' || fetchedAtMs == null || !Number.isFinite(fetchedAtMs)) return 'UNKNOWN';
  const ageHours = Math.max(0, (nowMs - fetchedAtMs) / (60 * 60 * 1000));
  if (ageHours < 6) return 'HIGH';
  if (ageHours <= 24) return 'MEDIUM';
  return 'LOW';
}

function deriveAzimuthSource(product: Record<string, unknown>) {
  const sourceCode = String((product?.sourceSufficiency as any)?.sourceSummary?.code || '').trim().toLowerCase();
  if (sourceCode.includes('hazard') || sourceCode.includes('bnm')) return 'bnm';
  if (sourceCode.includes('tfr') || sourceCode.includes('faa')) return 'tfr';
  if (sourceCode.includes('landing') || sourceCode.includes('constraint')) return 'default_table';

  const qualityLabel = String(product?.qualityLabel || '').trim().toLowerCase();
  if (qualityLabel === 'landing_constrained' || qualityLabel === 'estimate_corridor') return 'default_table';
  return 'default_table';
}

function computeScore(illumination: number, darkness: number, los: number, weather: number) {
  const raw = clamp(illumination, 0, 1) * clamp(darkness, 0, 1) * clamp(los, 0, 1) * clamp(weather, 0, 1);
  return Math.round(clamp(raw, 0, 1) * 100);
}

function computeCalibratedProbability({
  score,
  illuminationFactor,
  darknessFactor,
  losFactor,
  weatherFactor,
  timeConfidence,
  trajectoryConfidence,
  weatherConfidence
}: {
  score: number;
  illuminationFactor: number;
  darknessFactor: number;
  losFactor: number;
  weatherFactor: number;
  timeConfidence: string;
  trajectoryConfidence: string;
  weatherConfidence: string;
}) {
  const scoreNorm = clamp(score / 100, 0, 1);
  const confidenceBoost =
    confidenceValue(timeConfidence) * 0.22 +
    confidenceValue(trajectoryConfidence) * 0.32 +
    confidenceValue(weatherConfidence) * 0.18;
  const linear =
    -2.8 +
    scoreNorm * 4.3 +
    illuminationFactor * 0.7 +
    darknessFactor * 0.45 +
    losFactor * 0.6 +
    weatherFactor * 0.25 +
    confidenceBoost;
  return clamp(sigmoid(linear), 0, 1);
}

function deriveCalibrationBand(probability: number): JepCalibrationBand {
  if (probability < 0.15) return 'VERY_LOW';
  if (probability < 0.35) return 'LOW';
  if (probability < 0.6) return 'MEDIUM';
  if (probability < 0.82) return 'HIGH';
  return 'VERY_HIGH';
}

function buildExplainability({
  illuminationFactor,
  darknessFactor,
  losFactor,
  weatherFactor,
  geometryOnlyFallback,
  observerSource,
  weatherConfidence,
  trajectoryConfidence,
  timeConfidence,
  weatherAssessment
}: {
  illuminationFactor: number;
  darknessFactor: number;
  losFactor: number;
  weatherFactor: number;
  geometryOnlyFallback: boolean;
  observerSource: ObserverPoint['source'];
  weatherConfidence: string;
  trajectoryConfidence: string;
  timeConfidence: string;
  weatherAssessment: WeatherAssessment;
}) {
  const reasonCodes: string[] = [];
  if (geometryOnlyFallback) reasonCodes.push('geometry_only_weather_fallback');
  if (observerSource !== 'pad') reasonCodes.push('personalized_observer');
  if (weatherConfidence === 'LOW' || weatherConfidence === 'UNKNOWN') reasonCodes.push('weather_confidence_limited');
  if (trajectoryConfidence === 'LOW' || trajectoryConfidence === 'UNKNOWN') reasonCodes.push('trajectory_confidence_limited');
  if (timeConfidence === 'LOW' || timeConfidence === 'UNKNOWN') reasonCodes.push('time_confidence_limited');
  if (weatherAssessment.samplingMode !== 'observer_only') reasonCodes.push('weather_path_sampling');
  if (weatherAssessment.sourceUsed === 'mixed_nws_open_meteo') reasonCodes.push('weather_mixed_sources');
  if (weatherAssessment.mainBlocker !== 'unknown') reasonCodes.push(`weather_blocker_${weatherAssessment.mainBlocker}`);
  if (!reasonCodes.length) reasonCodes.push('nominal');

  return {
    reasonCodes,
    weightedContributions: {
      illumination: round(illuminationFactor * 0.35, 3),
      darkness: round(darknessFactor * 0.25, 3),
      lineOfSight: round(losFactor * 0.25, 3),
      weather: round(weatherFactor * 0.15, 3)
    },
    safeMode: geometryOnlyFallback
  };
}

function computeIlluminationMetrics({
  samples,
  events,
  solarDepressionDeg
}: {
  samples: Sample[];
  events: unknown;
  solarDepressionDeg: number;
}): IlluminationMetrics {
  if (!samples.length) return { factor: 0, sunlitMarginKm: null, litWeight: 0, totalWeight: 0 };
  const sorted = [...samples].sort((a, b) => a.tPlusSec - b.tPlusSec);
  const endT = resolveJellyfishEndSeconds(sorted, events);
  const shadowKm = computeShadowHeightKm(solarDepressionDeg);

  let litWeight = 0;
  let totalWeight = 0;
  let sunlitMarginWeighted = 0;
  for (const sample of sorted) {
    if (sample.tPlusSec < 60 || sample.tPlusSec > endT) continue;
    const weight = sample.tPlusSec >= 150 && sample.tPlusSec <= 300 ? 2 : 1;
    totalWeight += weight;
    const altKm = sample.altM / 1000;
    if (altKm > shadowKm) {
      litWeight += weight;
      sunlitMarginWeighted += (altKm - shadowKm) * weight;
    }
  }

  if (!totalWeight) return { factor: 0, sunlitMarginKm: null, litWeight, totalWeight };
  const factor = clamp(litWeight / totalWeight, 0, 1);
  const sunlitMarginKm = litWeight > 0 ? clamp(sunlitMarginWeighted / litWeight, 0, 2000) : null;
  return { factor, sunlitMarginKm, litWeight, totalWeight };
}

function computeLosMetrics({
  samples,
  events,
  solarDepressionDeg,
  observerLatDeg,
  observerLonDeg
}: {
  samples: Sample[];
  events: unknown;
  solarDepressionDeg: number;
  observerLatDeg: number;
  observerLonDeg: number;
}): LosMetrics {
  if (!samples.length) return { factor: 0, visibleFraction: 0, visibleWeight: 0, totalWeight: 0 };
  const sorted = [...samples].sort((a, b) => a.tPlusSec - b.tPlusSec);
  const endT = resolveJellyfishEndSeconds(sorted, events);
  const shadowKm = computeShadowHeightKm(solarDepressionDeg);

  let visibleWeight = 0;
  let totalWeight = 0;

  for (const sample of sorted) {
    if (sample.tPlusSec < 60 || sample.tPlusSec > endT) continue;
    const altKm = sample.altM / 1000;
    if (altKm <= shadowKm) continue;

    const weight = sample.tPlusSec >= 150 && sample.tPlusSec <= 300 ? 2 : 1;
    totalWeight += weight;

    const elevationDeg = elevationFromObserverDeg({
      observerLatDeg,
      observerLonDeg,
      targetLatDeg: sample.latDeg,
      targetLonDeg: sample.lonDeg,
      targetAltM: sample.altM
    });

    if (Number.isFinite(elevationDeg) && elevationDeg >= LOS_ELEVATION_THRESHOLD_DEG) {
      visibleWeight += weight;
    }
  }

  if (!totalWeight) return { factor: 0, visibleFraction: 0, visibleWeight, totalWeight };
  const visibleFraction = clamp(visibleWeight / totalWeight, 0, 1);
  return { factor: visibleFraction, visibleFraction, visibleWeight, totalWeight };
}

function resolveJellyfishEndSeconds(samples: Sample[], events: unknown) {
  if (Array.isArray(events)) {
    for (const eventRaw of events) {
      const event = eventRaw as Record<string, unknown>;
      const label = String(event?.label || '').toLowerCase();
      const key = String(event?.key || '').toLowerCase();
      const t = toFiniteNumber(event?.tPlusSec);
      if (t == null) continue;
      if (label.includes('seco') || key.includes('seco')) return clampInt(t, 120, 1200);
    }
  }

  let maxT = 600;
  for (const sample of samples) {
    if (sample.tPlusSec > maxT) maxT = sample.tPlusSec;
  }
  return clampInt(maxT, 180, 1200);
}

function computeDarknessFactor(depressionDeg: number) {
  if (depressionDeg > 18) return 0.1;
  if (depressionDeg >= 12 && depressionDeg <= 18) return 0.6;
  if (depressionDeg >= 6 && depressionDeg < 12) return 1.0;
  if (depressionDeg >= 3 && depressionDeg < 6) return 0.8;
  if (depressionDeg >= 0 && depressionDeg < 3) return 0.3;
  return 0;
}

function computeShadowHeightKm(solarDepressionDeg: number) {
  const gammaDeg = Math.max(0, solarDepressionDeg);
  const gammaRad = (gammaDeg * Math.PI) / 180;
  const cosGamma = Math.cos(gammaRad);
  if (!Number.isFinite(cosGamma) || Math.abs(cosGamma) < 1e-6) return Number.POSITIVE_INFINITY;
  return (RE_KM + SHADOW_H0_KM) / cosGamma - RE_KM;
}

function parseSamples(product: Record<string, unknown>, padLat: number, padLon: number): Sample[] {
  const rawSamples = Array.isArray(product?.samples) ? (product.samples as unknown[]) : [];
  const samples: Sample[] = [];
  for (const raw of rawSamples) {
    const sample = raw as Record<string, unknown>;
    const tPlusSec = toFiniteNumber(sample?.tPlusSec);
    if (tPlusSec == null || tPlusSec < 0) continue;

    const latDegDirect = toFiniteNumber(sample?.latDeg ?? sample?.lat_deg);
    const lonDegDirect = toFiniteNumber(sample?.lonDeg ?? sample?.lon_deg);
    const altMDirect = toFiniteNumber(sample?.altM ?? sample?.alt_m);
    const downrangeDirect = toFiniteNumber(sample?.downrangeM ?? sample?.downrange_m);
    const azimuthDirect = toFiniteNumber(sample?.azimuthDeg ?? sample?.azimuth_deg);

    let latDeg = latDegDirect;
    let lonDeg = lonDegDirect;
    let altM = altMDirect;

    if ((latDeg == null || lonDeg == null || altM == null) && Array.isArray(sample?.ecef) && sample.ecef.length >= 3) {
      const x = toFiniteNumber(sample.ecef[0]);
      const y = toFiniteNumber(sample.ecef[1]);
      const z = toFiniteNumber(sample.ecef[2]);
      if (x != null && y != null && z != null) {
        const geod = ecefToGeodetic(x, y, z);
        latDeg = geod.latDeg;
        lonDeg = geod.lonDeg;
        altM = geod.altM;
      }
    }

    if (latDeg == null || lonDeg == null || altM == null) continue;
    const downrangeM = downrangeDirect ?? haversineKm(padLat, padLon, latDeg, lonDeg) * 1000;
    const azimuthDeg = azimuthDirect ?? bearingDeg(padLat, padLon, latDeg, lonDeg);

    samples.push({
      tPlusSec,
      latDeg,
      lonDeg,
      altM,
      downrangeM,
      azimuthDeg
    });
  }

  samples.sort((a, b) => a.tPlusSec - b.tPlusSec);
  return samples;
}

function ecefToGeodetic(x: number, y: number, z: number) {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const b = a * (1 - f);
  const ep2 = (a * a - b * b) / (b * b);

  const p = Math.sqrt(x * x + y * y);
  const theta = Math.atan2(z * a, p * b);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);

  const lon = Math.atan2(y, x);
  const lat = Math.atan2(z + ep2 * b * sinTheta * sinTheta * sinTheta, p - e2 * a * cosTheta * cosTheta * cosTheta);
  const sinLat = Math.sin(lat);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const alt = p / Math.cos(lat) - N;

  return {
    latDeg: (lat * 180) / Math.PI,
    lonDeg: wrapLon((lon * 180) / Math.PI),
    altM: alt
  };
}

function ecefFromLatLon(latDeg: number, lonDeg: number, altMeters = 0) {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const n = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const x = (n + altMeters) * cosLat * cosLon;
  const y = (n + altMeters) * cosLat * sinLon;
  const z = (n * (1 - e2) + altMeters) * sinLat;
  return [x, y, z] as const;
}

function elevationFromObserverDeg({
  observerLatDeg,
  observerLonDeg,
  targetLatDeg,
  targetLonDeg,
  targetAltM
}: {
  observerLatDeg: number;
  observerLonDeg: number;
  targetLatDeg: number;
  targetLonDeg: number;
  targetAltM: number;
}) {
  const [ox, oy, oz] = ecefFromLatLon(observerLatDeg, observerLonDeg, 0);
  const [tx, ty, tz] = ecefFromLatLon(targetLatDeg, targetLonDeg, targetAltM);

  const dx = tx - ox;
  const dy = ty - oy;
  const dz = tz - oz;

  const lat = (observerLatDeg * Math.PI) / 180;
  const lon = (observerLonDeg * Math.PI) / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  const east = -sinLon * dx + cosLon * dy;
  const north = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
  const up = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;

  const horiz = Math.sqrt(east * east + north * north);
  if (!Number.isFinite(horiz) || !Number.isFinite(up)) return Number.NaN;
  return (Math.atan2(up, horiz) * 180) / Math.PI;
}

function solarDepressionDegrees(latDeg: number, lonDeg: number, date: Date) {
  const rad = Math.PI / 180;
  const dayOfYear = getDayOfYearUtc(date);
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (hours - 12) / 24);

  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const timeOffset = eqTime + 4 * lonDeg;
  const trueSolarMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60 + timeOffset;
  const hourAngleDeg = trueSolarMinutes / 4 - 180;
  const hourAngleRad = hourAngleDeg * rad;
  const latRad = latDeg * rad;

  const cosZenith = clamp(
    Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngleRad),
    -1,
    1
  );
  const zenithDeg = (Math.acos(cosZenith) * 180) / Math.PI;
  const elevationDeg = 90 - zenithDeg;
  return -elevationDeg;
}

function getDayOfYearUtc(date: Date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const now = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((now - start) / (24 * 60 * 60 * 1000)) + 1;
}

function confidenceValue(value: string) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'HIGH') return 1;
  if (normalized === 'MEDIUM') return 0.6;
  if (normalized === 'LOW') return 0.25;
  return 0;
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

async function hashPayload(payload: unknown) {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toFiniteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toFiniteInteger(value: unknown) {
  const numberValue = toFiniteNumber(value);
  return numberValue == null ? null : Math.trunc(numberValue);
}

function toInt(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return clampInt(value, 0, 100);
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return clamp(value, min, max);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function round(value: number, decimals: number) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function wrapLon(lonDeg: number) {
  return ((((lonDeg + 180) % 360) + 360) % 360) - 180;
}

function bearingDeg(lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const phi1 = lat1Deg * toRad;
  const phi2 = lat2Deg * toRad;
  const dLambda = (lon2Deg - lon1Deg) * toRad;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (Math.atan2(y, x) * toDeg + 360) % 360;
}

function haversineKm(lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number) {
  const toRad = Math.PI / 180;
  const dLat = (lat2Deg - lat1Deg) * toRad;
  const dLon = (lon2Deg - lon1Deg) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1Deg * toRad) * Math.cos(lat2Deg * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isLikelyUsCoordinate(lat: number, lon: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const conus = lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66;
  const alaska = lat >= 51 && lat <= 72 && lon >= -170 && lon <= -129;
  const hawaii = lat >= 18 && lat <= 23 && lon >= -161 && lon <= -154;
  return conus || alaska || hawaii;
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'unknown_error';
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function startIngestionRun(supabase: ReturnType<typeof createSupabaseAdminClient>, jobName: string) {
  const { data, error } = await supabase.from('ingestion_runs').insert({ job_name: jobName }).select('id').single();
  if (error || !data) {
    console.warn('Failed to start ingestion_runs record', { jobName, error: error?.message });
    return { runId: null as number | null };
  }
  return { runId: data.id as number };
}

async function finishIngestionRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: number | null,
  success: boolean,
  stats?: Record<string, unknown>,
  error?: string
) {
  if (!runId) return;
  const update: Record<string, unknown> = {
    success,
    ended_at: new Date().toISOString()
  };
  if (stats) update.stats = stats;
  if (error) update.error = error;
  const { error: updateError } = await supabase.from('ingestion_runs').update(update).eq('id', runId);
  if (updateError) {
    console.warn('Failed to update ingestion_runs record', { runId, error: updateError.message });
  }
}
