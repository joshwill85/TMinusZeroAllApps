import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { createSupabaseAdminClient, createSupabasePublicClient } from '@/lib/server/supabaseServer';
import type { JepObserver } from '@/lib/server/jepObserver';
import { deriveJepCalibrationBand } from '@/lib/jep/calibration';
import { applyJepObserverGuidancePolicy } from '@/lib/jep/fallbackPolicy';
import { deriveJepForecastHorizon } from '@/lib/jep/forecastHorizon';
import { deriveJepGuidance } from '@/lib/jep/guidance';
import { deriveJepReadiness } from '@/lib/jep/readiness';
import { deriveJepCloudObstructionImpact, deriveJepWeatherContrastImpact } from '@/lib/jep/weather';
import {
  buildTrajectoryContract,
  TRAJECTORY_CONTRACT_COLUMNS,
  type TrajectoryContract
} from '@/lib/server/trajectoryContract';
import type { JepCalibrationBand, JepConfidence, LaunchJepScore } from '@/lib/types/jep';

const PAD_OBSERVER_HASH = 'pad';
const GATE_CACHE_TTL_MS = 60_000;

const SCORE_COLUMNS_EXTENDED =
  'probability, calibration_band, sunlit_margin_km, los_visible_fraction, weather_freshness_min, explainability, snapshot_at';
const WEATHER_LAYER_COLUMNS = 'cloud_cover_mid_pct, cloud_cover_high_pct';
const OBSERVER_SCORE_COLUMNS_BASE =
  'launch_id, observer_location_hash, observer_lat_bucket, observer_lon_bucket, score, illumination_factor, darkness_factor, los_factor, weather_factor, solar_depression_deg, cloud_cover_pct, cloud_cover_low_pct, time_confidence, trajectory_confidence, weather_confidence, weather_source, azimuth_source, geometry_only_fallback, model_version, computed_at, expires_at';
const LEGACY_SCORE_COLUMNS_BASE =
  'launch_id, score, illumination_factor, darkness_factor, los_factor, weather_factor, solar_depression_deg, cloud_cover_pct, cloud_cover_low_pct, time_confidence, trajectory_confidence, weather_confidence, weather_source, azimuth_source, geometry_only_fallback, model_version, computed_at, expires_at';
const OBSERVER_SCORE_COLUMNS_EXTENDED = `${OBSERVER_SCORE_COLUMNS_BASE}, ${SCORE_COLUMNS_EXTENDED}`;
const LEGACY_SCORE_COLUMNS_EXTENDED = `${LEGACY_SCORE_COLUMNS_BASE}, ${SCORE_COLUMNS_EXTENDED}`;
const OBSERVER_SCORE_COLUMNS_WEATHER_LAYERS = `${OBSERVER_SCORE_COLUMNS_EXTENDED}, ${WEATHER_LAYER_COLUMNS}`;
const LEGACY_SCORE_COLUMNS_WEATHER_LAYERS = `${LEGACY_SCORE_COLUMNS_EXTENDED}, ${WEATHER_LAYER_COLUMNS}`;

type LaunchJepScoreRow = {
  launch_id: string;
  observer_location_hash?: string | null;
  observer_lat_bucket?: number | string | null;
  observer_lon_bucket?: number | string | null;
  score: number | null;
  illumination_factor: number | string | null;
  darkness_factor: number | string | null;
  los_factor: number | string | null;
  weather_factor: number | string | null;
  solar_depression_deg: number | string | null;
  cloud_cover_pct: number | null;
  cloud_cover_low_pct: number | null;
  cloud_cover_mid_pct?: number | null;
  cloud_cover_high_pct?: number | null;
  time_confidence: string | null;
  trajectory_confidence: string | null;
  weather_confidence: string | null;
  weather_source: string | null;
  azimuth_source: string | null;
  geometry_only_fallback: boolean | null;
  model_version: string | null;
  computed_at: string | null;
  expires_at: string | null;
  probability?: number | string | null;
  calibration_band?: string | null;
  sunlit_margin_km?: number | string | null;
  los_visible_fraction?: number | string | null;
  weather_freshness_min?: number | string | null;
  explainability?: unknown;
  snapshot_at?: string | null;
};

type FetchLaunchJepScoreOptions = {
  viewerIsAdmin?: boolean;
  observer?: JepObserver | null;
  skipObserverRegistration?: boolean;
};

type JepGateState = {
  publicEnabled: boolean;
  publicVisible: boolean;
  readiness: LaunchJepScore['readiness'];
};

type JepLaunchContext = {
  net: string | null;
  padLat: number | null;
  padLon: number | null;
  padCountryCode: string | null;
};

type Explainability = LaunchJepScore['explainability'];

let gateCache: { value: JepGateState; expiresAtMs: number } | null = null;
let observerSchemaSupported: boolean | null = null;
let extendedSchemaSupported: boolean | null = null;
let weatherLayerSchemaSupported: boolean | null = null;

export async function fetchLaunchJepScore(
  launchId: string,
  options: FetchLaunchJepScoreOptions = {}
): Promise<LaunchJepScore | null> {
  if (!isSupabaseConfigured()) return null;
  if (!launchId) return null;

  const gate = await loadJepVisibilityGate();
  if (!gate.publicVisible && options.viewerIsAdmin !== true) return null;

  const requestedObserver = options.observer ?? null;
  const requestedHash = requestedObserver?.locationHash || PAD_OBSERVER_HASH;
  const trajectoryPromise = fetchTrajectoryContractForJep(launchId);
  const launchContextPromise = fetchJepLaunchContext(launchId);

  const supabase = createSupabasePublicClient();
  let row = await fetchObserverRow(supabase, launchId, requestedHash);
  let usingPadFallback = false;

  if (!row && requestedHash !== PAD_OBSERVER_HASH) {
    usingPadFallback = true;
    row = await fetchObserverRow(supabase, launchId, PAD_OBSERVER_HASH);
  }

  if (!row) {
    row = await fetchLegacyRow(supabase, launchId);
    if (!row) {
      if (requestedObserver && options.skipObserverRegistration !== true) {
        void registerObserver(requestedObserver);
      }
      return null;
    }
    usingPadFallback = requestedHash !== PAD_OBSERVER_HASH;
  }

  const rowObserverHash = normalizeText(row.observer_location_hash) || PAD_OBSERVER_HASH;
  const snapshotAt = normalizeText(row.snapshot_at);
  const isSnapshot = snapshotAt != null;
  const expiresAtMs = row.expires_at ? Date.parse(row.expires_at) : Number.NaN;
  const isStale = !isSnapshot && Number.isFinite(expiresAtMs) ? expiresAtMs <= Date.now() : false;

  if (requestedObserver && options.skipObserverRegistration !== true && (usingPadFallback || isStale)) {
    void registerObserver(requestedObserver);
  }

  const factors = {
    illumination: clamp(normalizeNumber(row.illumination_factor, 0), 0, 1),
    darkness: clamp(normalizeNumber(row.darkness_factor, 0), 0, 1),
    lineOfSight: clamp(normalizeNumber(row.los_factor, 0), 0, 1),
    weather: clamp(normalizeNumber(row.weather_factor, 0), 0, 1),
    solarDepressionDeg: toNumber(row.solar_depression_deg),
    cloudCoverPct: toNumberInt(row.cloud_cover_pct),
    cloudCoverLowPct: toNumberInt(row.cloud_cover_low_pct),
    cloudCoverMidPct: toNumberInt(row.cloud_cover_mid_pct),
    cloudCoverHighPct: toNumberInt(row.cloud_cover_high_pct)
  };
  const score = clampInt(row.score ?? 0, 0, 100);
  const probability = resolveProbability(row, score);
  const calibrationBand = normalizeCalibrationBand(row.calibration_band) ?? deriveJepCalibrationBand(probability);
  const explainability =
    normalizeExplainability(row.explainability) ??
    buildDefaultExplainability({
      factors,
      isStale,
      usingPadFallback,
      geometryOnlyFallback: Boolean(row.geometry_only_fallback)
    });
  const trajectoryContract = await trajectoryPromise;
  const launchContext = await launchContextPromise;
  const weatherDetails =
    normalizeWeatherDetails((row.explainability as Record<string, unknown> | null)?.weatherDetails) ??
    buildDefaultWeatherDetails({
      factors,
      weatherSource: normalizeText(row.weather_source),
      geometryOnlyFallback: Boolean(row.geometry_only_fallback)
    });
  const horizon = deriveJepForecastHorizon({
    launchNetIso: launchContext?.net ?? null,
    isUsLaunch: isUsCountryCode(launchContext?.padCountryCode ?? null)
  });
  const allowObserverGuidance = rowObserverHash !== PAD_OBSERVER_HASH && !usingPadFallback;
  const guidanceObserver = allowObserverGuidance
    ? requestedObserver ??
      (toNumber(row.observer_lat_bucket) != null && toNumber(row.observer_lon_bucket) != null
        ? {
            latDeg: toNumber(row.observer_lat_bucket)!,
            lonDeg: toNumber(row.observer_lon_bucket)!,
            latBucket: toNumber(row.observer_lat_bucket)!,
            lonBucket: toNumber(row.observer_lon_bucket)!,
            locationHash: rowObserverHash,
            source: 'provided' as const
          }
        : null)
    : null;
  const guidance = applyJepObserverGuidancePolicy(
    deriveJepGuidance({
      trajectory: trajectoryContract,
      observer: guidanceObserver ? { latDeg: guidanceObserver.latDeg, lonDeg: guidanceObserver.lonDeg } : null,
      launchNetIso: launchContext?.net ?? null,
      currentScore: score,
      lineOfSightFactor: factors.lineOfSight,
      weatherFactor: factors.weather
    }),
    { allowObserverGuidance }
  );

  return {
    launchId: row.launch_id,
    mode: gate.readiness.probabilityReady ? 'probability' : 'watchability',
    readiness: gate.readiness,
    score,
    probability,
    calibrationBand,
    modelVersion: normalizeText(row.model_version) || 'jep_v5',
    computedAt: normalizeText(row.computed_at),
    expiresAt: normalizeText(row.expires_at),
    isStale,
    isSnapshot,
    snapshotAt,
    sunlitMarginKm: clampOptional(toNumber(row.sunlit_margin_km), 0, 5000),
    losVisibleFraction: clampOptional(toNumber(row.los_visible_fraction) ?? factors.lineOfSight, 0, 1),
    weatherFreshnessMinutes: toNumberInt(row.weather_freshness_min),
    factors,
    confidence: {
      time: normalizeConfidence(row.time_confidence),
      trajectory: normalizeConfidence(row.trajectory_confidence),
      weather: normalizeConfidence(row.weather_confidence)
    },
    source: {
      weather: normalizeText(row.weather_source),
      azimuth: normalizeText(row.azimuth_source),
      geometryOnlyFallback: Boolean(row.geometry_only_fallback)
    },
    planning: {
      hoursToNet: Number.isFinite(horizon.hoursToNet) ? round(horizon.hoursToNet, 1) : null,
      phase: horizon.phase,
      confidence: horizon.confidence,
      label: horizon.label,
      note: horizon.note,
      sourcePlan: [...horizon.sourcePlan],
      sourceUsed: weatherDetails?.sourceUsed ?? null
    },
    explainability,
    weatherDetails,
    observer: {
      locationHash: rowObserverHash,
      latBucket: toNumber(row.observer_lat_bucket),
      lonBucket: toNumber(row.observer_lon_bucket),
      personalized: rowObserverHash !== PAD_OBSERVER_HASH,
      usingPadFallback: requestedObserver != null && (usingPadFallback || rowObserverHash === PAD_OBSERVER_HASH)
    },
    bestWindow: guidance.bestWindow,
    directionBand: guidance.directionBand,
    elevationBand: guidance.elevationBand,
    scenarioWindows: guidance.scenarioWindows,
    trajectory: trajectoryContract ? mapTrajectoryContractToJepEvidence(trajectoryContract) : null
  };
}

async function fetchObserverRow(supabase: ReturnType<typeof createSupabasePublicClient>, launchId: string, observerHash: string) {
  if (observerSchemaSupported === false) return null;
  const attempts = uniqueColumns([
    extendedSchemaSupported !== false && weatherLayerSchemaSupported !== false ? OBSERVER_SCORE_COLUMNS_WEATHER_LAYERS : null,
    extendedSchemaSupported !== false ? OBSERVER_SCORE_COLUMNS_EXTENDED : null,
    OBSERVER_SCORE_COLUMNS_BASE
  ]);

  for (const columns of attempts) {
    const { data, error } = await queryObserverRow(supabase, launchId, observerHash, columns);
    if (!error) {
      observerSchemaSupported = true;
      if (columns === OBSERVER_SCORE_COLUMNS_WEATHER_LAYERS) {
        extendedSchemaSupported = true;
        weatherLayerSchemaSupported = true;
      } else if (columns === OBSERVER_SCORE_COLUMNS_EXTENDED) {
        extendedSchemaSupported = true;
        weatherLayerSchemaSupported = false;
      } else {
        extendedSchemaSupported = false;
        weatherLayerSchemaSupported = false;
      }
      return data;
    }

    if (isMissingObserverSchemaError(error.message)) {
      observerSchemaSupported = false;
      return null;
    }

    if (columns === OBSERVER_SCORE_COLUMNS_WEATHER_LAYERS && isMissingWeatherLayerSchemaError(error.message)) {
      weatherLayerSchemaSupported = false;
      continue;
    }

    if (columns !== OBSERVER_SCORE_COLUMNS_BASE && isMissingExtendedSchemaError(error.message)) {
      extendedSchemaSupported = false;
      if (columns === OBSERVER_SCORE_COLUMNS_WEATHER_LAYERS) weatherLayerSchemaSupported = false;
      continue;
    }

    console.error('launch jep score observer query error', error);
    return null;
  }

  return null;
}

async function fetchLegacyRow(supabase: ReturnType<typeof createSupabasePublicClient>, launchId: string) {
  const attempts = uniqueColumns([
    extendedSchemaSupported !== false && weatherLayerSchemaSupported !== false ? LEGACY_SCORE_COLUMNS_WEATHER_LAYERS : null,
    extendedSchemaSupported !== false ? LEGACY_SCORE_COLUMNS_EXTENDED : null,
    LEGACY_SCORE_COLUMNS_BASE
  ]);

  for (const columns of attempts) {
    const { data, error } = await queryLegacyRow(supabase, launchId, columns);
    if (!error) {
      if (columns === LEGACY_SCORE_COLUMNS_WEATHER_LAYERS) {
        extendedSchemaSupported = true;
        weatherLayerSchemaSupported = true;
      } else if (columns === LEGACY_SCORE_COLUMNS_EXTENDED) {
        extendedSchemaSupported = true;
        weatherLayerSchemaSupported = false;
      } else {
        extendedSchemaSupported = false;
        weatherLayerSchemaSupported = false;
      }
      return data;
    }

    if (columns === LEGACY_SCORE_COLUMNS_WEATHER_LAYERS && isMissingWeatherLayerSchemaError(error.message)) {
      weatherLayerSchemaSupported = false;
      continue;
    }

    if (columns !== LEGACY_SCORE_COLUMNS_BASE && isMissingExtendedSchemaError(error.message)) {
      extendedSchemaSupported = false;
      if (columns === LEGACY_SCORE_COLUMNS_WEATHER_LAYERS) weatherLayerSchemaSupported = false;
      continue;
    }

    console.error('launch jep score legacy query error', error);
    return null;
  }

  return null;
}

async function queryObserverRow(
  supabase: ReturnType<typeof createSupabasePublicClient>,
  launchId: string,
  observerHash: string,
  columns: string
) {
  const { data, error } = await supabase
    .from('launch_jep_scores')
    .select(columns)
    .eq('launch_id', launchId)
    .eq('observer_location_hash', observerHash)
    .maybeSingle();
  return {
    data: (data as LaunchJepScoreRow | null) ?? null,
    error
  };
}

async function queryLegacyRow(supabase: ReturnType<typeof createSupabasePublicClient>, launchId: string, columns: string) {
  const { data, error } = await supabase
    .from('launch_jep_scores')
    .select(columns)
    .eq('launch_id', launchId)
    .maybeSingle();
  return {
    data: (data as LaunchJepScoreRow | null) ?? null,
    error
  };
}

async function registerObserver(observer: JepObserver) {
  if (!isSupabaseAdminConfigured()) return;

  try {
    const admin = createSupabaseAdminClient();
    const nowIso = new Date().toISOString();
    const { error } = await admin.from('jep_observer_locations').upsert(
      {
        observer_location_hash: observer.locationHash,
        lat_bucket: observer.latBucket,
        lon_bucket: observer.lonBucket,
        source: observer.source,
        last_seen_at: nowIso,
        updated_at: nowIso
      },
      { onConflict: 'observer_location_hash' }
    );

    if (error && !isMissingObserverTableError(error.message)) {
      console.warn('jep observer register error', error.message);
    }
  } catch (error) {
    console.warn('jep observer register exception', error);
  }
}

async function fetchTrajectoryContractForJep(launchId: string): Promise<TrajectoryContract | null> {
  if (!launchId || !isSupabaseAdminConfigured()) return null;

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('launch_trajectory_products')
      .select(TRAJECTORY_CONTRACT_COLUMNS)
      .eq('launch_id', launchId)
      .maybeSingle();

    if (error) {
      console.warn('jep trajectory contract fetch error', error.message);
      return null;
    }

    return buildTrajectoryContract(data);
  } catch (error) {
    console.warn('jep trajectory contract fetch exception', error);
    return null;
  }
}

async function fetchJepLaunchContext(launchId: string): Promise<JepLaunchContext | null> {
  if (!launchId || !isSupabaseAdminConfigured()) return null;

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('launches')
      .select('net,pad_latitude,pad_longitude,pad_country_code')
      .eq('id', launchId)
      .maybeSingle();

    if (error) {
      console.warn('jep launch context fetch error', error.message);
      return null;
    }

    return {
      net: normalizeText(data?.net) || null,
      padLat: toNumber(data?.pad_latitude),
      padLon: toNumber(data?.pad_longitude),
      padCountryCode: normalizeText(data?.pad_country_code) || null
    };
  } catch (error) {
    console.warn('jep launch context fetch exception', error);
    return null;
  }
}

function mapTrajectoryContractToJepEvidence(contract: TrajectoryContract): LaunchJepScore['trajectory'] {
  return {
    authorityTier: contract.authorityTier,
    qualityState: contract.qualityState,
    generatedAt: contract.generatedAt,
    evidenceEpoch: contract.evidenceEpoch,
    confidenceTier: contract.confidenceTier,
    freshnessState: contract.freshnessState,
    confidenceBadge: contract.confidenceBadge,
    confidenceBadgeLabel: contract.confidenceBadgeLabel,
    evidenceLabel: contract.evidenceLabel,
    safeModeActive: contract.safeModeActive,
    lineageComplete: contract.lineageComplete,
    confidenceReasons: contract.confidenceReasons,
    publishPolicy: {
      precisionClaim: contract.publishPolicy.precisionClaim,
      allowPrecision: contract.publishPolicy.allowPrecision,
      enforcePadOnly: contract.publishPolicy.enforcePadOnly,
      reasons: [...contract.publishPolicy.reasons],
      missingFields: [...contract.publishPolicy.missingFields],
      blockingReasons: [...contract.publishPolicy.blockingReasons]
    },
    sourceBlend: contract.sourceBlend,
    fieldProvenance: contract.fieldProvenance
  };
}

async function loadJepVisibilityGate(): Promise<JepGateState> {
  const nowMs = Date.now();
  if (gateCache && gateCache.expiresAtMs > nowMs) {
    return gateCache.value;
  }

  if (!isSupabaseAdminConfigured()) {
    const readiness = deriveJepReadiness({
      publicEnabled: true,
      validationReady: true,
      modelCardPublished: false,
      labeledOutcomes: null,
      minLabeledOutcomes: null,
      currentEce: null,
      maxEce: null,
      currentBrier: null,
      maxBrier: null
    });
    const fallback: JepGateState = {
      publicEnabled: true,
      publicVisible: readiness.publicVisible,
      readiness
    };
    gateCache = { value: fallback, expiresAtMs: nowMs + GATE_CACHE_TTL_MS };
    return fallback;
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('system_settings')
    .select('key,value')
    .in('key', [
      'jep_public_enabled',
      'jep_validation_ready',
      'jep_model_card_published',
      'jep_probability_min_labeled_outcomes',
      'jep_probability_labeled_outcomes',
      'jep_probability_max_ece',
      'jep_probability_current_ece',
      'jep_probability_max_brier',
      'jep_probability_current_brier'
    ]);

  if (error) {
    console.warn('jep gate settings query error', error.message);
    const readiness = deriveJepReadiness({
      publicEnabled: false,
      validationReady: false,
      modelCardPublished: false,
      labeledOutcomes: null,
      minLabeledOutcomes: null,
      currentEce: null,
      maxEce: null,
      currentBrier: null,
      maxBrier: null
    });
    const fallback: JepGateState = {
      publicEnabled: false,
      publicVisible: readiness.publicVisible,
      readiness
    };
    gateCache = { value: fallback, expiresAtMs: nowMs + GATE_CACHE_TTL_MS };
    return fallback;
  }

  const map: Record<string, unknown> = {};
  for (const row of data || []) {
    map[row.key] = row.value;
  }

  const publicEnabled = readBooleanSetting(map.jep_public_enabled, false);
  const validationReady = readBooleanSetting(map.jep_validation_ready, false);
  const modelCardPublished = readBooleanSetting(map.jep_model_card_published, false);
  const readiness = deriveJepReadiness({
    publicEnabled,
    validationReady,
    modelCardPublished,
    labeledOutcomes: readIntegerSetting(map.jep_probability_labeled_outcomes),
    minLabeledOutcomes: readIntegerSetting(map.jep_probability_min_labeled_outcomes),
    currentEce: readRatioSetting(map.jep_probability_current_ece),
    maxEce: readRatioSetting(map.jep_probability_max_ece),
    currentBrier: readRatioSetting(map.jep_probability_current_brier),
    maxBrier: readRatioSetting(map.jep_probability_max_brier)
  });
  const value: JepGateState = {
    publicEnabled,
    publicVisible: readiness.publicVisible,
    readiness
  };

  gateCache = { value, expiresAtMs: nowMs + GATE_CACHE_TTL_MS };
  return value;
}

function resolveProbability(row: LaunchJepScoreRow, score: number) {
  const persisted = toNumber(row.probability);
  if (persisted != null) return clamp(persisted, 0, 1);
  return clamp(score / 100, 0, 1);
}

function normalizeConfidence(value: string | null): JepConfidence {
  const normalized = normalizeText(value)?.toUpperCase();
  if (normalized === 'HIGH' || normalized === 'MEDIUM' || normalized === 'LOW' || normalized === 'UNKNOWN') {
    return normalized;
  }
  return 'UNKNOWN';
}

function normalizeCalibrationBand(value: unknown): JepCalibrationBand | null {
  const normalized = normalizeText(value)?.toUpperCase();
  if (normalized === 'VERY_LOW' || normalized === 'LOW' || normalized === 'MEDIUM' || normalized === 'HIGH' || normalized === 'VERY_HIGH' || normalized === 'UNKNOWN') {
    return normalized;
  }
  return null;
}

function normalizeExplainability(value: unknown): Explainability | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const reasonCodes = Array.isArray(raw.reasonCodes)
    ? raw.reasonCodes
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0)
    : [];
  const weighted = raw.weightedContributions;
  if (!weighted || typeof weighted !== 'object' || Array.isArray(weighted)) return null;
  const weightedRaw = weighted as Record<string, unknown>;
  const illumination = clamp(normalizeNumber(weightedRaw.illumination, 0), 0, 1);
  const darkness = clamp(normalizeNumber(weightedRaw.darkness, 0), 0, 1);
  const lineOfSight = clamp(normalizeNumber(weightedRaw.lineOfSight ?? weightedRaw.line_of_sight, 0), 0, 1);
  const weather = clamp(normalizeNumber(weightedRaw.weather, 0), 0, 1);

  return {
    reasonCodes,
    weightedContributions: {
      illumination,
      darkness,
      lineOfSight,
      weather
    },
    safeMode: Boolean(raw.safeMode)
  };
}

function buildDefaultExplainability({
  factors,
  isStale,
  usingPadFallback,
  geometryOnlyFallback
}: {
  factors: LaunchJepScore['factors'];
  isStale: boolean;
  usingPadFallback: boolean;
  geometryOnlyFallback: boolean;
}): Explainability {
  const reasonCodes: string[] = [];
  if (geometryOnlyFallback) reasonCodes.push('geometry_only_weather_fallback');
  if (usingPadFallback) reasonCodes.push('observer_pad_fallback');
  if (isStale) reasonCodes.push('stale_score');
  if (!reasonCodes.length) reasonCodes.push('nominal');

  return {
    reasonCodes,
    weightedContributions: {
      illumination: round(factors.illumination * 0.35, 3),
      darkness: round(factors.darkness * 0.25, 3),
      lineOfSight: round(factors.lineOfSight * 0.25, 3),
      weather: round(factors.weather * 0.15, 3)
    },
    safeMode: geometryOnlyFallback || usingPadFallback || isStale
  };
}

function normalizeWeatherDetails(value: unknown): LaunchJepScore['weatherDetails'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const observer = normalizeWeatherPointSummary(raw.observer);
  const pad = normalizeWeatherPointSummary(raw.pad);
  const alongPath = normalizeWeatherPathSummary(raw.alongPath);
  const sourceUsed = normalizeText(raw.sourceUsed);
  const mainBlocker = normalizeWeatherMainBlocker(raw.mainBlocker);
  const samplingMode = normalizeWeatherSamplingMode(raw.samplingMode) ?? 'observer_only';
  return {
    sourceUsed,
    mainBlocker,
    obstructionFactor: clampOptional(toNumber(raw.obstructionFactor), 0, 1),
    contrastFactor: clampOptional(toNumber(raw.contrastFactor), 0, 1),
    samplingMode,
    samplingNote: normalizeText(raw.samplingNote),
    observer,
    alongPath,
    pad
  };
}

function buildDefaultWeatherDetails({
  factors,
  weatherSource,
  geometryOnlyFallback
}: {
  factors: LaunchJepScore['factors'];
  weatherSource: string | null;
  geometryOnlyFallback: boolean;
}): LaunchJepScore['weatherDetails'] {
  const contrast = deriveJepWeatherContrastImpact({
    cloudCoverTotal: factors.cloudCoverPct,
    cloudCoverLow: factors.cloudCoverLowPct,
    cloudCoverMid: factors.cloudCoverMidPct,
    cloudCoverHigh: factors.cloudCoverHighPct
  });
  const obstruction = deriveJepCloudObstructionImpact({
    skyCoverPct: factors.cloudCoverPct,
    ceilingFt: null
  });
  const source = normalizeWeatherPointSource(weatherSource);
  return {
    sourceUsed: geometryOnlyFallback
      ? 'geometry_only'
      : source === 'nws'
        ? 'nws_path_sampling'
        : source === 'mixed'
          ? 'mixed_nws_open_meteo'
          : source === 'open_meteo'
            ? 'open_meteo_path_fallback'
            : null,
    mainBlocker:
      contrast.dominantBlocker === 'low'
        ? 'observer_low_clouds'
        : contrast.dominantBlocker === 'mid'
          ? 'observer_mid_clouds'
          : contrast.dominantBlocker === 'high'
            ? 'observer_high_clouds'
            : contrast.dominantBlocker === 'mixed'
              ? 'mixed'
              : 'unknown',
    obstructionFactor: obstruction.factor,
    contrastFactor: contrast.factor,
    samplingMode: 'observer_only',
    samplingNote: 'This score row predates plume-path weather sampling, so only the observer weather point is available.',
    observer: {
      role: 'observer',
      source,
      totalCloudPct: factors.cloudCoverPct,
      lowCloudPct: factors.cloudCoverLowPct,
      midCloudPct: factors.cloudCoverMidPct,
      highCloudPct: factors.cloudCoverHighPct,
      skyCoverPct: factors.cloudCoverPct,
      ceilingFt: null,
      obstructionLevel: obstruction.level,
      note: null
    },
    alongPath: null,
    pad: null
  };
}

function normalizeWeatherPointSummary(value: unknown): NonNullable<LaunchJepScore['weatherDetails']>['observer'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const role = normalizeWeatherPointRole(raw.role);
  if (role == null) return null;
  return {
    role,
    source: normalizeWeatherPointSource(raw.source),
    totalCloudPct: clampOptional(toNumberInt(raw.totalCloudPct), 0, 100),
    lowCloudPct: clampOptional(toNumberInt(raw.lowCloudPct), 0, 100),
    midCloudPct: clampOptional(toNumberInt(raw.midCloudPct), 0, 100),
    highCloudPct: clampOptional(toNumberInt(raw.highCloudPct), 0, 100),
    skyCoverPct: clampOptional(toNumberInt(raw.skyCoverPct), 0, 100),
    ceilingFt: clampOptional(toNumber(raw.ceilingFt), 0, 60000),
    obstructionLevel: normalizeWeatherObstructionLevel(raw.obstructionLevel),
    note: normalizeText(raw.note)
  };
}

function normalizeWeatherPathSummary(value: unknown): NonNullable<LaunchJepScore['weatherDetails']>['alongPath'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  return {
    source: normalizeWeatherPointSource(raw.source),
    samplesConsidered: clampInt(toNumber(raw.samplesConsidered) ?? 0, 0, 12),
    worstRole: normalizeWeatherPathRole(raw.worstRole),
    skyCoverPct: clampOptional(toNumberInt(raw.skyCoverPct), 0, 100),
    ceilingFt: clampOptional(toNumber(raw.ceilingFt), 0, 60000),
    obstructionLevel: normalizeWeatherObstructionLevel(raw.obstructionLevel),
    note: normalizeText(raw.note)
  };
}

function normalizeWeatherMainBlocker(value: unknown): NonNullable<LaunchJepScore['weatherDetails']>['mainBlocker'] {
  const normalized = normalizeText(value);
  switch (normalized) {
    case 'observer_low_ceiling':
    case 'observer_sky_cover':
    case 'path_low_ceiling':
    case 'path_sky_cover':
    case 'observer_low_clouds':
    case 'observer_mid_clouds':
    case 'observer_high_clouds':
    case 'mixed':
    case 'unknown':
      return normalized;
    default:
      return 'unknown';
  }
}

function normalizeWeatherSamplingMode(value: unknown): NonNullable<LaunchJepScore['weatherDetails']>['samplingMode'] | null {
  const normalized = normalizeText(value);
  if (
    normalized === 'visible_path' ||
    normalized === 'sunlit_path' ||
    normalized === 'modeled_path' ||
    normalized === 'observer_only'
  ) {
    return normalized;
  }
  return null;
}

function normalizeWeatherObstructionLevel(value: unknown): NonNullable<
  NonNullable<LaunchJepScore['weatherDetails']>['observer']
>['obstructionLevel'] {
  const normalized = normalizeText(value);
  if (
    normalized === 'clear' ||
    normalized === 'partly_obstructed' ||
    normalized === 'likely_blocked' ||
    normalized === 'unknown'
  ) {
    return normalized;
  }
  return 'unknown';
}

function normalizeWeatherPointSource(value: unknown): NonNullable<
  NonNullable<LaunchJepScore['weatherDetails']>['observer']
>['source'] {
  const normalized = normalizeText(value);
  if (normalized === 'nws' || normalized === 'open_meteo' || normalized === 'mixed' || normalized === 'none') {
    return normalized;
  }
  return 'none';
}

function normalizeWeatherPointRole(value: unknown): NonNullable<
  NonNullable<LaunchJepScore['weatherDetails']>['observer']
>['role'] | null {
  const normalized = normalizeText(value);
  if (
    normalized === 'observer' ||
    normalized === 'path_start' ||
    normalized === 'path_mid' ||
    normalized === 'path_end' ||
    normalized === 'pad'
  ) {
    return normalized;
  }
  return null;
}

function normalizeWeatherPathRole(value: unknown): NonNullable<
  NonNullable<LaunchJepScore['weatherDetails']>['alongPath']
>['worstRole'] {
  const normalized = normalizeText(value);
  if (normalized === 'path_start' || normalized === 'path_mid' || normalized === 'path_end') return normalized;
  return null;
}

function isUsCountryCode(value: unknown) {
  const normalized = normalizeText(value)?.toUpperCase();
  return normalized === 'US' || normalized === 'USA';
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNumberInt(value: unknown) {
  const n = toNumber(value);
  return n == null ? null : Math.round(n);
}

function normalizeNumber(value: unknown, fallback: number) {
  const n = toNumber(value);
  return n == null ? fallback : n;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clampOptional(value: number | null, min: number, max: number) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals: number) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function readBooleanSetting(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

function readIntegerSetting(value: unknown) {
  const parsed = toNumber(value);
  if (parsed == null) return null;
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

function readRatioSetting(value: unknown) {
  const parsed = toNumber(value);
  if (parsed == null) return null;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null;
  return parsed;
}

function isMissingObserverSchemaError(message: string) {
  const text = (message || '').toLowerCase();
  return text.includes('observer_location_hash') || text.includes('observer_lat_bucket') || text.includes('observer_lon_bucket');
}

function isMissingExtendedSchemaError(message: string) {
  const text = (message || '').toLowerCase();
  return (
    text.includes('probability') ||
    text.includes('calibration_band') ||
    text.includes('sunlit_margin_km') ||
    text.includes('los_visible_fraction') ||
    text.includes('weather_freshness_min') ||
    text.includes('explainability') ||
    text.includes('snapshot_at')
  );
}

function isMissingWeatherLayerSchemaError(message: string) {
  const text = (message || '').toLowerCase();
  return text.includes('cloud_cover_mid_pct') || text.includes('cloud_cover_high_pct');
}

function uniqueColumns(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function isMissingObserverTableError(message: string) {
  const text = (message || '').toLowerCase();
  return text.includes('jep_observer_locations') && (text.includes('does not exist') || text.includes('relation'));
}
