import { isJepPublicVisibilityForced, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { createSupabaseAdminClient, createSupabasePublicClient } from '@/lib/server/supabaseServer';
import type { JepObserver } from '@/lib/server/jepObserver';
import { deriveJepCalibrationBand } from '@/lib/jep/calibration';
import { applyJepObserverGuidancePolicy } from '@/lib/jep/fallbackPolicy';
import { deriveJepForecastHorizon } from '@/lib/jep/forecastHorizon';
import { deriveJepGuidance, deriveJepSolarWindowRange } from '@/lib/jep/guidance';
import { deriveJepReadiness } from '@/lib/jep/readiness';
import {
  computeJepScoreRecord,
  normalizeModelList,
  type JepComputeLaunch,
  type JepComputeSettings,
  type JepComputedScore,
  type JepObserverPoint,
  type JepTrajectoryInput,
  type JepWeatherCaches,
  type NwsGridForecast,
  type NwsPointRow,
  type OpenMeteoForecast
} from '@/lib/jep/serverShared';
import { deriveJepCloudObstructionImpact, deriveJepWeatherContrastImpact } from '@/lib/jep/weather';
import {
  buildTrajectoryContract,
  TRAJECTORY_CONTRACT_COLUMNS,
  type TrajectoryContractRow,
  type TrajectoryContract
} from '@/lib/server/trajectoryContract';
import type { JepCalibrationBand, JepConfidence, JepConfidenceLabel, JepViewpoint, JepVisibilityCall, LaunchJepScore } from '@/lib/types/jep';

const PAD_OBSERVER_HASH = 'pad';
const GATE_CACHE_TTL_MS = 60_000;
const TRANSIENT_TIMEOUT_MS = 750;
const TRANSIENT_CACHE_TTL_MS = 60_000;
const TRANSIENT_PERSIST_HORIZON_MS = 24 * 60 * 60 * 1000;
const TRANSIENT_RESULT_CACHE_MAX_ENTRIES = 256;
const TRANSIENT_WEATHER_CACHE_MAX_ENTRIES = 256;
const DEFAULT_TRANSIENT_MODEL_VERSION = 'jep_v5';
const DEFAULT_V6_MODEL_VERSION = 'jep_v6';
const DEFAULT_TRANSIENT_WEATHER_CACHE_MINUTES = 10;
const DEFAULT_TRANSIENT_OPEN_METEO_US_MODELS = ['best_match', 'gfs_seamless'];

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

type LaunchJepCandidateRow = {
  launch_id: string;
  observer_location_hash: string | null;
  observer_lat_bucket: number | string | null;
  observer_lon_bucket: number | string | null;
  score: number | string | null;
  baseline_score?: number | string | null;
  model_version: string | null;
  computed_at: string | null;
  expires_at: string | null;
  snapshot_at?: string | null;
  factor_payload?: unknown;
  compatibility_payload?: unknown;
  explainability?: unknown;
};

type FetchLaunchJepScoreOptions = {
  viewerIsAdmin?: boolean;
  observer?: JepObserver | null;
  skipObserverRegistration?: boolean;
  allowTransientCompute?: boolean;
};

type JepGateState = {
  publicEnabled: boolean;
  publicVisible: boolean;
  readiness: LaunchJepScore['readiness'];
  transientPersonalizationEnabled: boolean;
  v6ShadowEnabled: boolean;
  v6PublicEnabled: boolean;
  v6FeatureSnapshotsEnabled: boolean;
};

type JepLaunchContext = {
  net: string | null;
  netPrecision: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  padLat: number | null;
  padLon: number | null;
  padCountryCode: string | null;
};

type Explainability = LaunchJepScore['explainability'];

type JepTrajectoryContext = {
  contract: TrajectoryContract | null;
  input: JepTrajectoryInput | null;
};

type JepTransientSettings = JepComputeSettings & {
  enabled: boolean;
};

type TransientCacheEntry = {
  value: JepComputedScore;
  expiresAtMs: number;
};

let gateCache: { value: JepGateState; expiresAtMs: number } | null = null;
let transientSettingsCache: { value: JepTransientSettings; expiresAtMs: number } | null = null;
let observerSchemaSupported: boolean | null = null;
let extendedSchemaSupported: boolean | null = null;
let weatherLayerSchemaSupported: boolean | null = null;
const transientResultCache = new Map<string, TransientCacheEntry>();
const transientInFlight = new Map<string, Promise<JepComputedScore | null>>();
const transientWeatherCache = new Map<string, { atMs: number; forecast: OpenMeteoForecast | null }>();

export async function fetchLaunchJepScore(
  launchId: string,
  options: FetchLaunchJepScoreOptions = {}
): Promise<LaunchJepScore | null> {
  if (!isSupabaseConfigured()) return null;
  if (!launchId) return null;

  const gate = await loadJepVisibilityGate();
  if (!gate.publicVisible && options.viewerIsAdmin !== true && !isJepPublicVisibilityForced()) return null;

  const requestedObserver = options.observer ?? null;
  const requestedHash = requestedObserver?.locationHash || PAD_OBSERVER_HASH;
  const trajectoryContextPromise = fetchTrajectoryContextForJep(launchId);
  const launchContextPromise = fetchJepLaunchContext(launchId);

  const supabase = createSupabasePublicClient();
  const v6ModelVersionPromise = gate.v6PublicEnabled ? loadJepV6ModelVersion().catch(() => DEFAULT_V6_MODEL_VERSION) : Promise.resolve(null);
  let row = await fetchObserverRow(supabase, launchId, requestedHash);
  if (requestedObserver && options.skipObserverRegistration !== true && (!row || isRowStale(row))) {
    void registerObserver(requestedObserver);
  }

  if (
    requestedObserver &&
    options.allowTransientCompute === true &&
    gate.transientPersonalizationEnabled &&
    isExplicitTransientObserverSource(requestedObserver.source) &&
    requestedHash !== PAD_OBSERVER_HASH &&
    (!row || isRowStale(row)) &&
    !isRowSnapshotLocked(row)
  ) {
    const [launchContext, trajectoryContext] = await Promise.all([launchContextPromise, trajectoryContextPromise]);
    const transient = await computeTransientLaunchJepScore({
      launchId,
      requestedObserver,
      existingRow: row,
      gate,
      launchContext,
      trajectoryContext
    });
    if (transient) return transient;
  }

  let usingPadFallback = false;
  if (!row && requestedHash !== PAD_OBSERVER_HASH) {
    usingPadFallback = true;
    row = await fetchObserverRow(supabase, launchId, PAD_OBSERVER_HASH);
  }

  if (!row) {
    row = await fetchLegacyRow(supabase, launchId);
    if (!row) return null;
    usingPadFallback = requestedHash !== PAD_OBSERVER_HASH;
  }

  if (gate.v6PublicEnabled) {
    const v6ModelVersion = (await v6ModelVersionPromise) || DEFAULT_V6_MODEL_VERSION;
    const candidateObserverHash = usingPadFallback ? PAD_OBSERVER_HASH : requestedHash;
    const candidate = await fetchPublicV6CandidateRow(launchId, candidateObserverHash, v6ModelVersion);
    if (candidate) {
      row = mergeV6CandidateIntoScoreRow(candidate, row);
    }
  }

  const [trajectoryContext, launchContext] = await Promise.all([trajectoryContextPromise, launchContextPromise]);
  return mapRowToLaunchJepScore({
    row,
    requestedObserver,
    usingPadFallback,
    gate,
    trajectoryContract: trajectoryContext?.contract ?? null,
    launchContext
  });
}

export async function canAttemptTransientJepPersonalization(observer: JepObserver | null | undefined) {
  if (!observer || !isExplicitTransientObserverSource(observer.source)) return false;
  const gate = await loadJepVisibilityGate();
  return gate.transientPersonalizationEnabled;
}

async function mapRowToLaunchJepScore({
  row,
  requestedObserver,
  usingPadFallback,
  gate,
  trajectoryContract,
  launchContext
}: {
  row: LaunchJepScoreRow;
  requestedObserver: JepObserver | null;
  usingPadFallback: boolean;
  gate: JepGateState;
  trajectoryContract: TrajectoryContract | null;
  launchContext: JepLaunchContext | null;
}): Promise<LaunchJepScore> {
  const rowObserverHash = normalizeText(row.observer_location_hash) || PAD_OBSERVER_HASH;
  const snapshotAt = normalizeText(row.snapshot_at);
  const isSnapshot = snapshotAt != null;
  const expiresAtMs = row.expires_at ? Date.parse(row.expires_at) : Number.NaN;
  const isStale = !isSnapshot && Number.isFinite(expiresAtMs) ? expiresAtMs <= Date.now() : false;
  const normalizedWeatherFactor = normalizeLegacyWeatherFactor(row);
  const factors = {
    illumination: clamp(normalizeNumber(row.illumination_factor, 0), 0, 1),
    darkness: clamp(normalizeNumber(row.darkness_factor, 0), 0, 1),
    lineOfSight: clamp(normalizeNumber(row.los_factor, 0), 0, 1),
    weather: normalizedWeatherFactor,
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
  const solarRangeObserver =
    guidanceObserver ??
    (launchContext?.padLat != null && launchContext?.padLon != null
      ? {
          latDeg: launchContext.padLat,
          lonDeg: launchContext.padLon
        }
      : null);
  const solarWindowRange = deriveJepSolarWindowRange({
    observer: solarRangeObserver,
    launchNetIso: launchContext?.net ?? null,
    launchWindowStartIso: launchContext?.windowStart ?? null,
    launchWindowEndIso: launchContext?.windowEnd ?? null
  });
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
    modelVersion: normalizeText(row.model_version) || DEFAULT_TRANSIENT_MODEL_VERSION,
    computedAt: normalizeText(row.computed_at),
    expiresAt: normalizeText(row.expires_at),
    isStale,
    isSnapshot,
    snapshotAt,
    sunlitMarginKm: clampOptional(toNumber(row.sunlit_margin_km), 0, 5000),
    losVisibleFraction: clampOptional(toNumber(row.los_visible_fraction) ?? factors.lineOfSight, 0, 1),
    weatherFreshnessMinutes: toNumberInt(row.weather_freshness_min),
    visibilityCall: deriveVisibilityCall(score, factors),
    viewpoint: deriveViewpoint(rowObserverHash, usingPadFallback),
    confidenceLabel: deriveConfidenceLabel({
      time: row.time_confidence,
      trajectory: row.trajectory_confidence,
      weather: row.weather_confidence,
      geometryOnlyFallback: row.geometry_only_fallback
    }),
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
    solarWindowRange,
    bestWindow: guidance.bestWindow,
    directionBand: guidance.directionBand,
    elevationBand: guidance.elevationBand,
    scenarioWindows: guidance.scenarioWindows,
    trajectory: trajectoryContract ? mapTrajectoryContractToJepEvidence(trajectoryContract) : null
  };
}

function deriveVisibilityCall(
  score: number,
  factors: Pick<LaunchJepScore['factors'], 'darkness' | 'illumination' | 'lineOfSight'>
): JepVisibilityCall {
  if (score <= 0 || factors.darkness <= 0 || factors.illumination <= 0 || factors.lineOfSight <= 0) {
    return 'not_expected';
  }
  if (score >= 85) return 'highly_favorable';
  if (score >= 65) return 'favorable';
  return 'possible';
}

function deriveViewpoint(rowObserverHash: string, usingPadFallback: boolean): JepViewpoint {
  return usingPadFallback || rowObserverHash === PAD_OBSERVER_HASH ? 'launch_site_reference' : 'personal';
}

function deriveConfidenceLabel({
  time,
  trajectory,
  weather,
  geometryOnlyFallback
}: {
  time: string | null;
  trajectory: string | null;
  weather: string | null;
  geometryOnlyFallback: boolean | null;
}): JepConfidenceLabel {
  if (geometryOnlyFallback) return 'low';
  const ranks = [normalizeConfidence(time), normalizeConfidence(trajectory), normalizeConfidence(weather)].map(confidenceRank);
  const minRank = ranks.reduce((best, rank) => Math.min(best, rank), Number.POSITIVE_INFINITY);
  if (minRank >= 3) return 'high';
  if (minRank >= 2) return 'medium';
  return 'low';
}

function confidenceRank(value: JepConfidence) {
  if (value === 'HIGH') return 3;
  if (value === 'MEDIUM') return 2;
  if (value === 'LOW') return 1;
  return 0;
}

async function computeTransientLaunchJepScore({
  launchId,
  requestedObserver,
  existingRow,
  gate,
  launchContext,
  trajectoryContext
}: {
  launchId: string;
  requestedObserver: JepObserver;
  existingRow: LaunchJepScoreRow | null;
  gate: JepGateState;
  launchContext: JepLaunchContext | null;
  trajectoryContext: JepTrajectoryContext | null;
}): Promise<LaunchJepScore | null> {
  if (!isSupabaseAdminConfigured()) return null;
  if (!launchContext?.net || launchContext.padLat == null || launchContext.padLon == null) return null;
  if (!trajectoryContext?.input?.product) return null;

  const netMs = Date.parse(launchContext.net);
  if (!Number.isFinite(netMs) || netMs <= Date.now()) return null;

  const settings = await loadJepTransientSettings();
  if (!settings.enabled) return null;

  const trajectoryVersion = trajectoryContext.input.version || trajectoryContext.contract?.version || 'none';
  const cacheKey = `${launchId}:${requestedObserver.locationHash}:${trajectoryVersion}:${settings.modelVersion}`;
  const cached = readTransientScoreCache(cacheKey);
  if (cached) {
    console.info('jep transient cache hit', { launchId, observerSource: requestedObserver.source });
    return mapRowToLaunchJepScore({
      row: cached.row as LaunchJepScoreRow,
      requestedObserver,
      usingPadFallback: false,
      gate,
      trajectoryContract: trajectoryContext.contract,
      launchContext
    });
  }

  const inFlight = transientInFlight.get(cacheKey);
  if (inFlight) {
    console.info('jep transient inflight join', { launchId, observerSource: requestedObserver.source });
    const joined = await inFlight;
    if (!joined) return null;
    return mapRowToLaunchJepScore({
      row: joined.row as LaunchJepScoreRow,
      requestedObserver,
      usingPadFallback: false,
      gate,
      trajectoryContract: trajectoryContext.contract,
      launchContext
    });
  }

  const promise = runTransientLaunchJepComputation({
    cacheKey,
    launchId,
    requestedObserver,
    existingRow,
    launchContext,
    trajectoryContext,
    settings
  });
  transientInFlight.set(cacheKey, promise);

  try {
    const computed = await promise;
    if (!computed) return null;
    return mapRowToLaunchJepScore({
      row: computed.row as LaunchJepScoreRow,
      requestedObserver,
      usingPadFallback: false,
      gate,
      trajectoryContract: trajectoryContext.contract,
      launchContext
    });
  } finally {
    transientInFlight.delete(cacheKey);
  }
}

async function runTransientLaunchJepComputation({
  cacheKey,
  launchId,
  requestedObserver,
  existingRow,
  launchContext,
  trajectoryContext,
  settings
}: {
  cacheKey: string;
  launchId: string;
  requestedObserver: JepObserver;
  existingRow: LaunchJepScoreRow | null;
  launchContext: JepLaunchContext;
  trajectoryContext: JepTrajectoryContext;
  settings: JepTransientSettings;
}): Promise<JepComputedScore | null> {
  const startedAt = Date.now();
  const admin = createSupabaseAdminClient();
  trimMapToMaxEntries(transientWeatherCache, TRANSIENT_WEATHER_CACHE_MAX_ENTRIES);
  const launch: JepComputeLaunch = {
    launchId,
    net: launchContext.net,
    netPrecision: launchContext.netPrecision,
    padLat: launchContext.padLat,
    padLon: launchContext.padLon,
    padCountryCode: launchContext.padCountryCode
  };
  const observer: JepObserverPoint = {
    hash: requestedObserver.locationHash,
    latDeg: requestedObserver.latBucket,
    lonDeg: requestedObserver.lonBucket,
    source: requestedObserver.source
  };
  const weatherCaches: JepWeatherCaches = {
    weatherCache: transientWeatherCache,
    nwsPointCache: new Map<string, NwsPointRow | null>(),
    nwsGridCache: new Map<string, NwsGridForecast | null>()
  };

  try {
    const computed = await computeTransientWithinDeadline((signal) =>
      computeJepScoreRecord({
        supabase: admin,
        launch,
        observer,
        trajectory: trajectoryContext.input!,
        nowMs: Date.now(),
        settings,
        weatherCaches,
        signal
      })
    );
    if (!computed) {
      console.info('jep transient timeout_or_empty', { launchId, elapsedMs: Date.now() - startedAt });
      return null;
    }

    writeTransientScoreCache(cacheKey, computed);
    console.info('jep transient success', { launchId, elapsedMs: Date.now() - startedAt });
    await persistTransientScoreIfNeeded({
      admin,
      requestedObserver,
      existingRow,
      computed,
      launchContext
    });
    return computed;
  } catch (error) {
    console.warn('jep transient error', {
      launchId,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

async function computeTransientWithinDeadline(factory: (signal: AbortSignal) => Promise<JepComputedScore | null>) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<JepComputedScore | null>((resolve) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, TRANSIENT_TIMEOUT_MS);
    });
    return await Promise.race([factory(controller.signal), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function readTransientScoreCache(cacheKey: string) {
  const cached = transientResultCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAtMs <= Date.now()) {
    transientResultCache.delete(cacheKey);
    return null;
  }
  return cached.value;
}

function writeTransientScoreCache(cacheKey: string, computed: JepComputedScore) {
  pruneExpiredTransientScoreCache();
  const expiresAtMs = computed.row.expires_at ? Date.parse(computed.row.expires_at) : Number.NaN;
  const ttlMs = Number.isFinite(expiresAtMs)
    ? Math.max(1_000, Math.min(TRANSIENT_CACHE_TTL_MS, expiresAtMs - Date.now()))
    : TRANSIENT_CACHE_TTL_MS;
  transientResultCache.set(cacheKey, {
    value: computed,
    expiresAtMs: Date.now() + ttlMs
  });
  trimMapToMaxEntries(transientResultCache, TRANSIENT_RESULT_CACHE_MAX_ENTRIES);
}

function pruneExpiredTransientScoreCache() {
  const nowMs = Date.now();
  for (const [key, entry] of transientResultCache) {
    if (entry.expiresAtMs <= nowMs) transientResultCache.delete(key);
  }
}

async function persistTransientScoreIfNeeded({
  admin,
  requestedObserver,
  existingRow,
  computed,
  launchContext
}: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  requestedObserver: JepObserver;
  existingRow: LaunchJepScoreRow | null;
  computed: JepComputedScore;
  launchContext: JepLaunchContext;
}) {
  if (requestedObserver.source !== 'provided') return;
  if (isRowSnapshotLocked(existingRow)) return;
  if (existingRow && !isRowStale(existingRow)) return;

  const netMs = Date.parse(String(launchContext.net || ''));
  if (!Number.isFinite(netMs)) return;
  const nowMs = Date.now();
  if (netMs <= nowMs || netMs - nowMs > TRANSIENT_PERSIST_HORIZON_MS) return;

  try {
    const { error } = await admin
      .from('launch_jep_scores')
      .upsert(computed.row, { onConflict: 'launch_id,observer_location_hash' });
    if (error) {
      console.warn('jep transient persist failed', {
        launchId: computed.row.launch_id,
        error: error.message
      });
      return;
    }
    console.info('jep transient persisted', { launchId: computed.row.launch_id });
  } catch (error) {
    console.warn('jep transient persist exception', {
      launchId: computed.row.launch_id,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function isExplicitTransientObserverSource(source: JepObserver['source']) {
  return source === 'query' || source === 'provided';
}

function isRowSnapshotLocked(row: LaunchJepScoreRow | null) {
  return Boolean(normalizeText(row?.snapshot_at));
}

function isRowStale(row: LaunchJepScoreRow | null) {
  if (!row || isRowSnapshotLocked(row)) return false;
  const expiresAtMs = row.expires_at ? Date.parse(row.expires_at) : Number.NaN;
  return Number.isFinite(expiresAtMs) ? expiresAtMs <= Date.now() : false;
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

async function fetchPublicV6CandidateRow(launchId: string, observerHash: string, modelVersion: string) {
  if (!isSupabaseAdminConfigured()) return null;

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('launch_jep_score_candidates')
      .select(
        'launch_id, observer_location_hash, observer_lat_bucket, observer_lon_bucket, score, baseline_score, model_version, computed_at, expires_at, snapshot_at, factor_payload, compatibility_payload, explainability'
      )
      .eq('launch_id', launchId)
      .eq('observer_location_hash', observerHash)
      .eq('model_version', modelVersion)
      .maybeSingle();

    if (error) {
      const text = `${error.message || ''}`.toLowerCase();
      if (text.includes('launch_jep_score_candidates')) return null;
      console.warn('launch jep v6 candidate query error', error.message);
      return null;
    }

    return (data as LaunchJepCandidateRow | null) ?? null;
  } catch (error) {
    console.warn('launch jep v6 candidate query exception', error);
    return null;
  }
}

function mergeV6CandidateIntoScoreRow(candidate: LaunchJepCandidateRow, baseline: LaunchJepScoreRow | null): LaunchJepScoreRow {
  const compatibility = normalizeCandidateCompatibility(candidate.compatibility_payload);
  const factorPayload = normalizeCandidateFactorPayload(candidate.factor_payload);
  const reasonCodes = normalizeCandidateReasonCodes(candidate.explainability);

  const cloudCoverMidPct =
    factorPayload.cloudCoverMidPct ??
    compatibility.cloudCoverMidPct ??
    toNumber(baseline?.cloud_cover_mid_pct) ??
    null;
  const cloudCoverHighPct =
    factorPayload.cloudCoverHighPct ??
    compatibility.cloudCoverHighPct ??
    toNumber(baseline?.cloud_cover_high_pct) ??
    null;

  return {
    launch_id: candidate.launch_id,
    observer_location_hash: normalizeText(candidate.observer_location_hash) || baseline?.observer_location_hash || PAD_OBSERVER_HASH,
    observer_lat_bucket: candidate.observer_lat_bucket ?? baseline?.observer_lat_bucket ?? null,
    observer_lon_bucket: candidate.observer_lon_bucket ?? baseline?.observer_lon_bucket ?? null,
    score: toNumber(candidate.score) ?? baseline?.score ?? 0,
    illumination_factor: compatibility.illumination ?? baseline?.illumination_factor ?? 0,
    darkness_factor: factorPayload.darkness ?? compatibility.darkness ?? baseline?.darkness_factor ?? 0,
    los_factor: compatibility.lineOfSight ?? baseline?.los_factor ?? 0,
    weather_factor: compatibility.weather ?? baseline?.weather_factor ?? 0,
    solar_depression_deg: factorPayload.solarDepressionDeg ?? baseline?.solar_depression_deg ?? null,
    cloud_cover_pct: factorPayload.cloudCoverPct ?? compatibility.cloudCoverPct ?? baseline?.cloud_cover_pct ?? null,
    cloud_cover_low_pct: factorPayload.cloudCoverLowPct ?? compatibility.cloudCoverLowPct ?? baseline?.cloud_cover_low_pct ?? null,
    cloud_cover_mid_pct: cloudCoverMidPct,
    cloud_cover_high_pct: cloudCoverHighPct,
    time_confidence: baseline?.time_confidence ?? 'UNKNOWN',
    trajectory_confidence: baseline?.trajectory_confidence ?? 'UNKNOWN',
    weather_confidence: baseline?.weather_confidence ?? 'UNKNOWN',
    weather_source: baseline?.weather_source ?? null,
    azimuth_source: baseline?.azimuth_source ?? null,
    geometry_only_fallback: baseline?.geometry_only_fallback ?? false,
    model_version: normalizeText(candidate.model_version) || DEFAULT_V6_MODEL_VERSION,
    computed_at: candidate.computed_at ?? baseline?.computed_at ?? null,
    expires_at: candidate.expires_at ?? baseline?.expires_at ?? null,
    probability: null,
    calibration_band: null,
    sunlit_margin_km: factorPayload.sunlitMarginKm ?? baseline?.sunlit_margin_km ?? null,
    los_visible_fraction: factorPayload.losVisibleFraction ?? baseline?.los_visible_fraction ?? compatibility.lineOfSight ?? null,
    weather_freshness_min: baseline?.weather_freshness_min ?? null,
    explainability: {
      reasonCodes,
      weightedContributions: {
        illumination: round((compatibility.illumination ?? 0) * 0.35, 3),
        darkness: round((factorPayload.darkness ?? compatibility.darkness ?? 0) * 0.25, 3),
        lineOfSight: round((compatibility.lineOfSight ?? 0) * 0.25, 3),
        weather: round((compatibility.weather ?? 0) * 0.15, 3)
      },
      safeMode: false
    },
    snapshot_at: candidate.snapshot_at ?? baseline?.snapshot_at ?? null
  };
}

async function loadJepV6ModelVersion() {
  if (!isSupabaseAdminConfigured()) return DEFAULT_V6_MODEL_VERSION;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from('system_settings').select('value').eq('key', 'jep_v6_model_version').maybeSingle();
  if (error) throw error;
  const raw = data?.value;
  return normalizeText(typeof raw === 'string' ? raw : null) || (typeof raw === 'number' ? String(raw) : '') || DEFAULT_V6_MODEL_VERSION;
}

function normalizeCandidateCompatibility(value: unknown) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    illumination: clampOptional(toNumber(raw.illumination), 0, 1),
    darkness: clampOptional(toNumber(raw.darkness), 0, 1),
    lineOfSight: clampOptional(toNumber(raw.lineOfSight ?? raw.line_of_sight), 0, 1),
    weather: clampOptional(toNumber(raw.weather), 0, 1),
    cloudCoverPct: clampOptional(toNumber(raw.cloudCoverPct ?? raw.cloud_cover_pct), 0, 100),
    cloudCoverLowPct: clampOptional(toNumber(raw.cloudCoverLowPct ?? raw.cloud_cover_low_pct), 0, 100),
    cloudCoverMidPct: clampOptional(toNumber(raw.cloudCoverMidPct ?? raw.cloud_cover_mid_pct), 0, 100),
    cloudCoverHighPct: clampOptional(toNumber(raw.cloudCoverHighPct ?? raw.cloud_cover_high_pct), 0, 100)
  };
}

function normalizeCandidateFactorPayload(value: unknown) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    darkness: clampOptional(toNumber(raw.darkness), 0, 1),
    solarDepressionDeg: toNumber(raw.solarDepressionDeg ?? raw.solar_depression_deg),
    sunlitMarginKm: clampOptional(toNumber(raw.sunlitMarginKm ?? raw.sunlit_margin_km), 0, 5000),
    losVisibleFraction: clampOptional(toNumber(raw.losVisibleFraction ?? raw.los_visible_fraction), 0, 1),
    cloudCoverPct: clampOptional(toNumber(raw.cloudCoverPct ?? raw.cloud_cover_pct), 0, 100),
    cloudCoverLowPct: clampOptional(toNumber(raw.cloudCoverLowPct ?? raw.cloud_cover_low_pct), 0, 100),
    cloudCoverMidPct: clampOptional(toNumber(raw.cloudCoverMidPct ?? raw.cloud_cover_mid_pct), 0, 100),
    cloudCoverHighPct: clampOptional(toNumber(raw.cloudCoverHighPct ?? raw.cloud_cover_high_pct), 0, 100)
  };
}

function normalizeCandidateReasonCodes(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['jep_v6_public_candidate'];
  const raw = value as Record<string, unknown>;
  const codes = Array.isArray(raw.reasonCodes)
    ? raw.reasonCodes
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0)
    : [];
  return codes.length ? codes : ['jep_v6_public_candidate'];
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

async function fetchTrajectoryContextForJep(launchId: string): Promise<JepTrajectoryContext | null> {
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

    const row = (data as TrajectoryContractRow | null) ?? null;
    return {
      contract: buildTrajectoryContract(row),
      input: row
        ? {
            version: normalizeText(row.version),
            confidenceTier: normalizeText(row.confidence_tier),
            product: row.product && typeof row.product === 'object' && !Array.isArray(row.product) ? (row.product as Record<string, unknown>) : null
          }
        : null
    };
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
      .select('net,net_precision,window_start,window_end,pad_latitude,pad_longitude,pad_country_code')
      .eq('id', launchId)
      .maybeSingle();

    if (error) {
      console.warn('jep launch context fetch error', error.message);
      return null;
    }

    return {
      net: normalizeText(data?.net) || null,
      netPrecision: normalizeText(data?.net_precision) || null,
      windowStart: normalizeText(data?.window_start) || null,
      windowEnd: normalizeText(data?.window_end) || null,
      padLat: toNumber(data?.pad_latitude),
      padLon: toNumber(data?.pad_longitude),
      padCountryCode: normalizeText(data?.pad_country_code) || null
    };
  } catch (error) {
    console.warn('jep launch context fetch exception', error);
    return null;
  }
}

function normalizeLegacyWeatherFactor(row: LaunchJepScoreRow) {
  const rawFactor = clamp(normalizeNumber(row.weather_factor, 0), 0, 1);
  const hasWeatherSignal =
    normalizeText(row.weather_source) !== 'none' ||
    [row.cloud_cover_pct, row.cloud_cover_low_pct, row.cloud_cover_mid_pct, row.cloud_cover_high_pct].some((value) =>
      Number.isFinite(toNumber(value))
    );
  if (hasWeatherSignal && rawFactor <= 0) return 0.08;
  return rawFactor;
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
  const forcePublicVisible = isJepPublicVisibilityForced();
  const nowMs = Date.now();
  if (gateCache && gateCache.expiresAtMs > nowMs) {
    if (!forcePublicVisible) {
      return gateCache.value;
    }
    return {
      ...gateCache.value,
      publicEnabled: true,
      publicVisible: true
    };
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
      publicVisible: forcePublicVisible ? true : readiness.publicVisible,
      readiness,
      transientPersonalizationEnabled: false,
      v6ShadowEnabled: false,
      v6PublicEnabled: false,
      v6FeatureSnapshotsEnabled: false
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
      'jep_transient_personalization_enabled',
      'jep_v6_shadow_enabled',
      'jep_v6_public_enabled',
      'jep_v6_feature_snapshots_enabled',
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
      publicEnabled: forcePublicVisible ? true : false,
      publicVisible: forcePublicVisible ? true : readiness.publicVisible,
      readiness,
      transientPersonalizationEnabled: false,
      v6ShadowEnabled: false,
      v6PublicEnabled: false,
      v6FeatureSnapshotsEnabled: false
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
    publicEnabled: forcePublicVisible ? true : publicEnabled,
    publicVisible: forcePublicVisible ? true : readiness.publicVisible,
    readiness,
    transientPersonalizationEnabled: readBooleanSetting(map.jep_transient_personalization_enabled, false),
    v6ShadowEnabled: readBooleanSetting(map.jep_v6_shadow_enabled, false),
    v6PublicEnabled: readBooleanSetting(map.jep_v6_public_enabled, false),
    v6FeatureSnapshotsEnabled: readBooleanSetting(map.jep_v6_feature_snapshots_enabled, false)
  };

  gateCache = { value, expiresAtMs: nowMs + GATE_CACHE_TTL_MS };
  return value;
}

async function loadJepTransientSettings(): Promise<JepTransientSettings> {
  const nowMs = Date.now();
  if (transientSettingsCache && transientSettingsCache.expiresAtMs > nowMs) {
    return transientSettingsCache.value;
  }

  const fallback: JepTransientSettings = {
    enabled: false,
    modelVersion: DEFAULT_TRANSIENT_MODEL_VERSION,
    weatherCacheMinutes: DEFAULT_TRANSIENT_WEATHER_CACHE_MINUTES,
    openMeteoUsModels: [...DEFAULT_TRANSIENT_OPEN_METEO_US_MODELS]
  };

  if (!isSupabaseAdminConfigured()) {
    transientSettingsCache = { value: fallback, expiresAtMs: nowMs + GATE_CACHE_TTL_MS };
    return fallback;
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('system_settings')
      .select('key,value')
      .in('key', [
        'jep_transient_personalization_enabled',
        'jep_score_model_version',
        'jep_score_weather_cache_minutes',
        'jep_score_open_meteo_us_models'
      ]);

    if (error) {
      console.warn('jep transient settings query error', error.message);
      transientSettingsCache = { value: fallback, expiresAtMs: nowMs + GATE_CACHE_TTL_MS };
      return fallback;
    }

    const map: Record<string, unknown> = {};
    for (const row of data || []) {
      map[row.key] = row.value;
    }

    const value: JepTransientSettings = {
      enabled: readBooleanSetting(map.jep_transient_personalization_enabled, false),
      modelVersion: readStringSetting(map.jep_score_model_version, DEFAULT_TRANSIENT_MODEL_VERSION),
      weatherCacheMinutes: clampInt(
        readIntegerSetting(map.jep_score_weather_cache_minutes) ?? DEFAULT_TRANSIENT_WEATHER_CACHE_MINUTES,
        1,
        60
      ),
      openMeteoUsModels: normalizeModelList(
        readStringArraySetting(map.jep_score_open_meteo_us_models),
        DEFAULT_TRANSIENT_OPEN_METEO_US_MODELS
      )
    };
    transientSettingsCache = { value, expiresAtMs: nowMs + GATE_CACHE_TTL_MS };
    return value;
  } catch (error) {
    console.warn('jep transient settings exception', error);
    transientSettingsCache = { value: fallback, expiresAtMs: nowMs + GATE_CACHE_TTL_MS };
    return fallback;
  }
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

function readStringSetting(value: unknown, fallback: string) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return fallback;
}

function readStringArraySetting(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0);
  }
  return [];
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

function trimMapToMaxEntries<K, V>(map: Map<K, V>, maxEntries: number) {
  if (maxEntries < 1) {
    map.clear();
    return;
  }

  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value as K | undefined;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}
