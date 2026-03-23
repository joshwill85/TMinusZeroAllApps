import {
  combineJepWeatherFactors,
  computeJepWeatherContrastFactor,
  computeJepWeatherFactor,
  deriveJepCloudObstructionImpact,
  deriveJepWeatherContrastImpact
} from './weather';

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';
const NWS_BASE = 'https://api.weather.gov';
const EARTH_RADIUS_KM = 6371;
const SHADOW_H0_KM = 12;
const RE_KM = 6371;
const LOS_ELEVATION_THRESHOLD_DEG = 5;
const NWS_POINTS_CACHE_HOURS = 24;
const DEFAULT_NWS_USER_AGENT = 'TMinusZero/0.1 (support@tminuszero.app)';

export type JepComputeLaunch = {
  launchId: string;
  net: string | null;
  netPrecision: string | null;
  padLat: number | null;
  padLon: number | null;
  padCountryCode: string | null;
};

export type JepTrajectoryInput = {
  version: string | null;
  confidenceTier: string | null;
  product: Record<string, unknown> | null;
};

export type JepObserverSource = 'pad' | 'observer_registry' | 'query' | 'provided' | 'header';

export type JepObserverPoint = {
  hash: string;
  latDeg: number;
  lonDeg: number;
  source: JepObserverSource;
};

export type JepComputeSettings = {
  modelVersion: string;
  weatherCacheMinutes: number;
  openMeteoUsModels: string[];
};

export type WeatherPoint = {
  source: 'open_meteo' | 'nws' | 'mixed' | 'none';
  cloudCoverTotal: number | null;
  cloudCoverLow: number | null;
  cloudCoverMid: number | null;
  cloudCoverHigh: number | null;
  fetchedAtMs: number | null;
};

export type WeatherResolution = WeatherPoint & {
  skyCoverPct: number | null;
  ceilingFt: number | null;
  openMeteoFetched: boolean;
  nwsPointFetched: boolean;
  nwsGridFetched: boolean;
};

export type OpenMeteoForecast = {
  fetchedAtMs: number;
  timesMs: number[];
  cloudCoverTotal: Array<number | null>;
  cloudCoverLow: Array<number | null>;
  cloudCoverMid: Array<number | null>;
  cloudCoverHigh: Array<number | null>;
};

export type NwsPointRow = {
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

export type NwsGridForecast = {
  updatedAtMs: number | null;
  properties: Record<string, unknown> | null;
};

export type Sample = {
  tPlusSec: number;
  latDeg: number;
  lonDeg: number;
  altM: number;
  downrangeM: number;
  azimuthDeg: number;
};

export type WeatherSamplingMode = 'visible_path' | 'sunlit_path' | 'modeled_path' | 'observer_only';

export type WeatherSamplingPoint = {
  role: 'path_start' | 'path_mid' | 'path_end';
  latDeg: number;
  lonDeg: number;
  tPlusSec: number | null;
  altitudeM: number | null;
  azimuthDeg: number | null;
  elevationDeg: number | null;
};

export type WeatherSamplingPlan = {
  mode: WeatherSamplingMode;
  note: string;
  points: WeatherSamplingPoint[];
};

export type WeatherAssessmentPoint = {
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

export type WeatherAssessment = {
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

export type JepCalibrationBand = 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' | 'UNKNOWN';

export type JepWeatherCaches = {
  weatherCache: Map<string, { atMs: number; forecast: OpenMeteoForecast | null }>;
  nwsPointCache: Map<string, NwsPointRow | null>;
  nwsGridCache: Map<string, NwsGridForecast | null>;
};

export type JepComputedScoreRow = {
  launch_id: string;
  observer_location_hash: string;
  observer_lat_bucket: number;
  observer_lon_bucket: number;
  score: number;
  probability: number;
  calibration_band: JepCalibrationBand;
  illumination_factor: number;
  darkness_factor: number;
  los_factor: number;
  sunlit_margin_km: number | null;
  los_visible_fraction: number;
  weather_factor: number;
  weather_freshness_min: number | null;
  solar_depression_deg: number;
  cloud_cover_pct: number | null;
  cloud_cover_low_pct: number | null;
  cloud_cover_mid_pct: number | null;
  cloud_cover_high_pct: number | null;
  time_confidence: string;
  trajectory_confidence: string;
  weather_confidence: string;
  weather_source: string;
  azimuth_source: string;
  geometry_only_fallback: boolean;
  explainability: Record<string, unknown>;
  model_version: string;
  input_hash: string;
  computed_at: string;
  expires_at: string | null;
  snapshot_at: string | null;
  updated_at: string;
};

export type JepComputedScore = {
  row: JepComputedScoreRow;
  weather: WeatherAssessment;
  samples: Sample[];
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

type SupabaseLike = {
  from: (table: string) => any;
};

export async function computeJepScoreRecord({
  supabase,
  launch,
  observer,
  trajectory,
  nowMs,
  settings,
  weatherCaches,
  signal,
  launchPassedT0 = false
}: {
  supabase: SupabaseLike;
  launch: JepComputeLaunch;
  observer: JepObserverPoint;
  trajectory: JepTrajectoryInput;
  nowMs: number;
  settings: JepComputeSettings;
  weatherCaches: JepWeatherCaches;
  signal?: AbortSignal;
  launchPassedT0?: boolean;
}): Promise<JepComputedScore | null> {
  const netMs = Date.parse(String(launch.net || ''));
  const padLat = launch.padLat;
  const padLon = launch.padLon;
  if (!Number.isFinite(netMs)) return null;
  if (padLat == null || !Number.isFinite(padLat) || padLon == null || !Number.isFinite(padLon)) return null;
  if (!trajectory.product) return null;

  const samples = parseSamples(trajectory.product, padLat, padLon);
  if (!samples.length) return null;

  const intervalMinutes = launchPassedT0 ? 0 : intervalMinutesForLaunch(netMs, nowMs);
  const expiresAt = launchPassedT0 ? null : new Date(nowMs + intervalMinutes * 60 * 1000).toISOString();
  const azimuthSource = deriveAzimuthSource(trajectory.product);
  const timeConfidence = mapTimeConfidence(launch.netPrecision);
  const trajectoryConfidence = mapTrajectoryConfidence(trajectory.confidenceTier);
  const depressionDeg = solarDepressionDegrees(observer.latDeg, observer.lonDeg, new Date(netMs));
  const darknessFactor = computeDarknessFactor(depressionDeg);
  const illumination = computeIlluminationMetrics({
    samples,
    events: trajectory.product.events,
    solarDepressionDeg: depressionDeg
  });
  const los = computeLosMetrics({
    samples,
    events: trajectory.product.events,
    solarDepressionDeg: depressionDeg,
    observerLatDeg: observer.latDeg,
    observerLonDeg: observer.lonDeg
  });
  const illuminationFactor = illumination.factor;
  const losFactor = los.factor;
  const samplingPlan = buildWeatherSamplingPlan({
    samples,
    observerLatDeg: observer.latDeg,
    observerLonDeg: observer.lonDeg,
    solarDepressionDeg: depressionDeg
  });

  const weather = await resolveWeatherAssessment({
    supabase,
    observer,
    launch,
    targetMs: netMs,
    samplingPlan,
    weatherCache: weatherCaches.weatherCache,
    nwsPointCache: weatherCaches.nwsPointCache,
    nwsGridCache: weatherCaches.nwsGridCache,
    weatherCacheMinutes: settings.weatherCacheMinutes,
    openMeteoUsModels: settings.openMeteoUsModels,
    signal
  });

  const weatherFactor = weather.weatherFactor;
  const geometryOnlyFallback = weather.primarySource === 'none' || weather.sourceUsed === 'geometry_only';
  const score = computeScore(illuminationFactor, darknessFactor, losFactor, weatherFactor);
  const weatherConfidence = mapWeatherConfidence(weather.fetchedAtMs, nowMs, weather.primarySource);
  const probability = computeCalibratedProbability({
    score,
    illuminationFactor,
    darknessFactor,
    losFactor,
    weatherFactor,
    timeConfidence,
    trajectoryConfidence,
    weatherConfidence
  });
  const calibrationBand = deriveCalibrationBand(probability);
  const weatherFreshnessMin =
    weather.fetchedAtMs != null && Number.isFinite(weather.fetchedAtMs)
      ? clampInt((nowMs - weather.fetchedAtMs) / 60000, 0, 60 * 24 * 7)
      : null;
  const explainability = buildExplainability({
    illuminationFactor,
    darknessFactor,
    losFactor,
    weatherFactor,
    geometryOnlyFallback,
    observerSource: observer.source,
    weatherConfidence,
    trajectoryConfidence,
    timeConfidence,
    weatherAssessment: weather
  });

  const inputPayload = {
    modelVersion: settings.modelVersion,
    observerHash: observer.hash,
    observerLatBucket: round(observer.latDeg, 3),
    observerLonBucket: round(observer.lonDeg, 3),
    score,
    probability: round(probability, 4),
    calibrationBand,
    illuminationFactor,
    darknessFactor,
    losFactor,
    weatherFactor,
    depressionDeg: round(depressionDeg, 3),
    sunlitMarginKm: illumination.sunlitMarginKm,
    losVisibleFraction: round(los.visibleFraction, 4),
    weatherFreshnessMin,
    cloudCoverTotal: toInt(weather.observer?.totalCloudPct ?? null),
    cloudCoverLow: toInt(weather.observer?.lowCloudPct ?? null),
    cloudCoverMid: toInt(weather.observer?.midCloudPct ?? null),
    cloudCoverHigh: toInt(weather.observer?.highCloudPct ?? null),
    timeConfidence,
    trajectoryConfidence,
    weatherConfidence,
    weatherSource: weather.primarySource,
    azimuthSource,
    geometryOnlyFallback,
    explainability
  };
  const inputHash = await hashPayload(inputPayload);
  const nowIso = new Date(nowMs).toISOString();

  return {
    row: {
      launch_id: launch.launchId,
      observer_location_hash: observer.hash,
      observer_lat_bucket: round(observer.latDeg, 3),
      observer_lon_bucket: round(observer.lonDeg, 3),
      score,
      probability: round(probability, 4),
      calibration_band: calibrationBand,
      illumination_factor: round(illuminationFactor, 3),
      darkness_factor: round(darknessFactor, 3),
      los_factor: round(losFactor, 3),
      sunlit_margin_km: illumination.sunlitMarginKm != null ? round(illumination.sunlitMarginKm, 3) : null,
      los_visible_fraction: round(los.visibleFraction, 4),
      weather_factor: round(weatherFactor, 3),
      weather_freshness_min: weatherFreshnessMin,
      solar_depression_deg: round(depressionDeg, 3),
      cloud_cover_pct: toInt(weather.observer?.totalCloudPct ?? null),
      cloud_cover_low_pct: toInt(weather.observer?.lowCloudPct ?? null),
      cloud_cover_mid_pct: toInt(weather.observer?.midCloudPct ?? null),
      cloud_cover_high_pct: toInt(weather.observer?.highCloudPct ?? null),
      time_confidence: timeConfidence,
      trajectory_confidence: trajectoryConfidence,
      weather_confidence: weatherConfidence,
      weather_source: weather.primarySource,
      azimuth_source: azimuthSource,
      geometry_only_fallback: geometryOnlyFallback,
      explainability: {
        ...explainability,
        sunlitMarginKm: illumination.sunlitMarginKm,
        losVisibleFraction: round(los.visibleFraction, 4),
        weatherDetails: {
          sourceUsed: weather.sourceUsed,
          mainBlocker: weather.mainBlocker,
          obstructionFactor: weather.obstructionFactor,
          contrastFactor: weather.contrastFactor,
          samplingMode: weather.samplingMode,
          samplingNote: weather.samplingNote,
          observer: weather.observer,
          alongPath: weather.alongPath,
          pad: weather.pad
        }
      },
      model_version: settings.modelVersion,
      input_hash: inputHash,
      computed_at: nowIso,
      expires_at: expiresAt,
      snapshot_at: launchPassedT0 ? nowIso : null,
      updated_at: nowIso
    },
    weather,
    samples
  };
}

export function intervalMinutesForLaunch(netMs: number, nowMs: number) {
  const hoursToNet = (netMs - nowMs) / (60 * 60 * 1000);
  if (hoursToNet <= 1) return 5;
  if (hoursToNet <= 6) return 15;
  if (hoursToNet <= 24) return 60;
  if (hoursToNet <= 24 * 7) return 360;
  return 1440;
}

export function normalizeModelList(input: string[], fallback: string[]) {
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
  openMeteoUsModels,
  signal
}: {
  supabase: SupabaseLike;
  observer: JepObserverPoint;
  launch: JepComputeLaunch;
  targetMs: number;
  samplingPlan: WeatherSamplingPlan | null;
  weatherCache: Map<string, { atMs: number; forecast: OpenMeteoForecast | null }>;
  nwsPointCache: Map<string, NwsPointRow | null>;
  nwsGridCache: Map<string, NwsGridForecast | null>;
  weatherCacheMinutes: number;
  openMeteoUsModels: string[];
  signal?: AbortSignal;
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
    openMeteoUsModels,
    signal
  });
  const padWeather =
    samePoint(observer.latDeg, observer.lonDeg, Number(launch.padLat), Number(launch.padLon))
      ? observerWeather
      : await resolvePointWeather({
          supabase,
          launch,
          lat: Number(launch.padLat),
          lon: Number(launch.padLon),
          targetMs,
          weatherCache,
          nwsPointCache,
          nwsGridCache,
          weatherCacheMinutes,
          openMeteoUsModels,
          signal
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
        openMeteoUsModels,
        signal
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
  openMeteoUsModels,
  signal
}: {
  supabase: SupabaseLike;
  launch: JepComputeLaunch;
  lat: number;
  lon: number;
  targetMs: number;
  weatherCache: Map<string, { atMs: number; forecast: OpenMeteoForecast | null }>;
  nwsPointCache: Map<string, NwsPointRow | null>;
  nwsGridCache: Map<string, NwsGridForecast | null>;
  weatherCacheMinutes: number;
  openMeteoUsModels: string[];
  signal?: AbortSignal;
}): Promise<WeatherResolution> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return emptyWeatherResolution();
  }

  const isUsLocation = isLikelyUsCoordinate(lat, lon) || isUsCountryCode(launch.padCountryCode);
  let openMeteoFetched = false;
  let nwsPointFetched = false;
  let nwsGridFetched = false;
  let cloudCoverTotal: number | null = null;
  let cloudCoverLow: number | null = null;
  let cloudCoverMid: number | null = null;
  let cloudCoverHigh: number | null = null;
  let skyCoverPct: number | null = null;
  let ceilingFt: number | null = null;
  const fetchedAtCandidates: Array<number | null> = [];

  const forecast = await resolveOpenMeteoForecast({
    lat,
    lon,
    isUsLocation,
    targetMs,
    weatherCache,
    weatherCacheMinutes,
    openMeteoUsModels,
    signal
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
    const nwsPoint = await resolveNwsPoint({
      supabase,
      lat,
      lon,
      ll2PadId: null,
      nwsPointCache,
      signal
    });
    nwsPointFetched = nwsPoint.pointFetched;
    if (nwsPoint.row?.forecast_grid_data_url) {
      const grid = await resolveNwsGridForecast(nwsPoint.row.forecast_grid_data_url, nwsGridCache, signal);
      nwsGridFetched = grid.gridFetched;
      if (grid.forecast?.properties) {
        const sample = sampleNwsGridForecast(grid.forecast.properties, targetMs);
        skyCoverPct = sample.skyCoverPct;
        ceilingFt = sample.ceilingFt;
        fetchedAtCandidates.push(grid.forecast.updatedAtMs);
      }
    }
  }

  const source =
    (skyCoverPct != null || ceilingFt != null) &&
    (cloudCoverTotal != null || cloudCoverLow != null || cloudCoverMid != null || cloudCoverHigh != null)
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
  usModels,
  signal
}: {
  lat: number;
  lon: number;
  isUsLocation: boolean;
  usModels: string[];
  signal?: AbortSignal;
}) {
  const modelAttempts = isUsLocation ? [...usModels, ''] : [''];

  for (const model of modelAttempts) {
    try {
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
        signal,
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
    } catch {
      if (signal?.aborted) throw new Error('aborted');
    }
  }

  return null;
}

async function resolveOpenMeteoForecast({
  lat,
  lon,
  isUsLocation,
  targetMs,
  weatherCache,
  weatherCacheMinutes,
  openMeteoUsModels,
  signal
}: {
  lat: number;
  lon: number;
  isUsLocation: boolean;
  targetMs: number;
  weatherCache: Map<string, { atMs: number; forecast: OpenMeteoForecast | null }>;
  weatherCacheMinutes: number;
  openMeteoUsModels: string[];
  signal?: AbortSignal;
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
      usModels: openMeteoUsModels,
      signal
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
  nwsPointCache,
  signal
}: {
  supabase: SupabaseLike;
  lat: number;
  lon: number;
  ll2PadId: number | null;
  nwsPointCache: Map<string, NwsPointRow | null>;
  signal?: AbortSignal;
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

  const fetched = await fetchNwsPoints(lat, lon, signal);
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

async function fetchNwsPoints(lat: number, lon: number, signal?: AbortSignal) {
  const url = `${NWS_BASE}/points/${lat},${lon}`;
  const res = await fetch(url, {
    signal,
    headers: {
      'User-Agent': resolveNwsUserAgent(),
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

async function resolveNwsGridForecast(url: string, nwsGridCache: Map<string, NwsGridForecast | null>, signal?: AbortSignal) {
  if (nwsGridCache.has(url)) {
    return {
      forecast: nwsGridCache.get(url) || null,
      gridFetched: false
    };
  }

  const res = await fetch(url, {
    signal,
    headers: {
      'User-Agent': resolveNwsUserAgent(),
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

function resolveNwsUserAgent() {
  const runtime = globalThis as {
    Deno?: { env?: { get?: (name: string) => string | undefined } };
    process?: { env?: Record<string, string | undefined> };
  };
  return runtime.Deno?.env?.get?.('NWS_USER_AGENT') || runtime.process?.env?.NWS_USER_AGENT || DEFAULT_NWS_USER_AGENT;
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
    const value = toFiniteNumber((row as Record<string, unknown>)?.value);
    if (value == null) continue;
    const { startMs, endMs } = parseNwsValidTime((row as Record<string, unknown>)?.validTime);
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

export function isUsCountryCode(value: string | null) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'US' || normalized === 'USA';
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
  const sourceCode = String((product?.sourceSufficiency as Record<string, any> | undefined)?.sourceSummary?.code || '')
    .trim()
    .toLowerCase();
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
  observerSource: JepObserverSource;
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

function toInt(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return clampInt(value, 0, 100);
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
