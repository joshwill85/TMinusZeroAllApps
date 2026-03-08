import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting, readStringArraySetting, readStringSetting } from '../_shared/settings.ts';
import { allowNwsFallbackForObserverSource } from '../../../lib/jep/fallbackPolicy.ts';

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';
const EARTH_RADIUS_KM = 6371;
const SHADOW_H0_KM = 12;
const RE_KM = 6371;
const PAD_OBSERVER_HASH = 'pad';
const LOS_ELEVATION_THRESHOLD_DEG = 5;
const SNAPSHOT_LOCK_LOOKBACK_HOURS = 24;
const POST_LAUNCH_COMPUTE_GRACE_HOURS = 2;

const DEFAULTS = {
  enabled: true,
  horizonDays: 16,
  maxLaunchesPerRun: 120,
  weatherCacheMinutes: 10,
  modelVersion: 'jep_v3',
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
  mission_orbit: string | null;
  vehicle: string | null;
  rocket_family: string | null;
};

type ScoreRow = {
  launch_id: string;
  observer_location_hash: string | null;
  input_hash: string;
  expires_at: string | null;
  snapshot_at: string | null;
};

type DueLaunch = {
  launch: LaunchRow;
  observers: ObserverPoint[];
};

type TrajectoryRow = {
  launch_id: string;
  confidence_tier: string | null;
  freshness_state: string | null;
  lineage_complete: boolean | null;
  product: Record<string, unknown> | null;
};

type NwsRow = {
  launch_id: string;
  issued_at: string | null;
  data: Record<string, unknown> | null;
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
  source: 'open_meteo' | 'nws' | 'none';
  cloudCoverTotal: number | null;
  cloudCoverLow: number | null;
  fetchedAtMs: number | null;
};

type WeatherResolution = WeatherPoint & {
  openMeteoFetched: boolean;
};

type OpenMeteoForecast = {
  fetchedAtMs: number;
  timesMs: number[];
  cloudCoverTotal: Array<number | null>;
  cloudCoverLow: Array<number | null>;
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

type JepCalibrationBand = 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' | 'UNKNOWN';

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

  const { runId } = await startIngestionRun(supabase, 'jep_score_refresh');

  const stats: Record<string, unknown> = {
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
    weatherSourceResolvedNone: 0,
    weatherSourceUpsertedTotal: 0,
    weatherSourceUpsertedOpenMeteo: 0,
    weatherSourceUpsertedNws: 0,
    weatherSourceUpsertedNone: 0,
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
        'launch_id, net, net_precision, status_name, status_abbrev, pad_latitude, pad_longitude, pad_country_code, mission_orbit, vehicle, rocket_family'
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
      const launchDue = observers.some((observer) => {
        const key = scoreKey(launch.launch_id, observer.hash);
        return isDueObserver(launch, existingScores.get(key), nowMs);
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
    const nwsByLaunch = await loadNwsRows(supabase, dueIds);
    const weatherCache = new Map<string, { atMs: number; forecast: OpenMeteoForecast | null }>();
    const upserts: Record<string, unknown>[] = [];
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
        const expiresAt = launchPassedT0 ? null : new Date(nowMs + intervalMinutes * 60 * 1000).toISOString();
        const azimuthSource = deriveAzimuthSource(trajectory.product);
        const timeConfidence = mapTimeConfidence(launch.net_precision);
        const trajectoryConfidence = mapTrajectoryConfidence(trajectory.confidence_tier);

        let launchComputed = false;

        for (const observer of observersToCompute) {
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

          const weather = await resolveObserverWeather({
            observer,
            launch,
            targetMs: netMs,
            weatherCache,
            weatherCacheMinutes,
            openMeteoUsModels,
            isUsObserver: isLikelyUsCoordinate(observer.latDeg, observer.lonDeg),
            // The cached NWS rows are launch-site forecasts, so only pad observers can reuse them safely.
            allowNwsFallback: allowNwsFallbackForObserverSource(observer.source),
            nws: nwsByLaunch.get(launch.launch_id) || null
          });

          if (weather.openMeteoFetched) {
            stats.weatherFetches = Number(stats.weatherFetches || 0) + 1;
          }
          if (weather.source === 'none') {
            stats.weatherFallbacks = Number(stats.weatherFallbacks || 0) + 1;
          }
          incrementWeatherSourceStats(stats, weather.source, 'resolved');

          const weatherFactor = computeWeatherFactor(weather.cloudCoverTotal, weather.cloudCoverLow);
          const geometryOnlyFallback = weather.source === 'none';
          const score = computeScore(illuminationFactor, darknessFactor, losFactor, weatherFactor);
          const weatherConfidence = mapWeatherConfidence(weather.fetchedAtMs, nowMs, weather.source);
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
            timeConfidence
          });

          const inputPayload = {
            modelVersion,
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
            cloudCoverTotal: toInt(weather.cloudCoverTotal),
            cloudCoverLow: toInt(weather.cloudCoverLow),
            timeConfidence,
            trajectoryConfidence,
            weatherConfidence,
            weatherSource: weather.source,
            azimuthSource,
            geometryOnlyFallback,
            explainability
          };
          const inputHash = await hashPayload(inputPayload);
          const existing = existingScores.get(scoreKey(launch.launch_id, observer.hash));
          if (
            !launchPassedT0 &&
            existing &&
            existing.input_hash === inputHash &&
            existing.expires_at &&
            Date.parse(existing.expires_at) > nowMs + intervalMinutes * 30 * 1000
          ) {
            stats.unchangedSkipped = Number(stats.unchangedSkipped || 0) + 1;
            continue;
          }

          upserts.push({
            launch_id: launch.launch_id,
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
            cloud_cover_pct: toInt(weather.cloudCoverTotal),
            cloud_cover_low_pct: toInt(weather.cloudCoverLow),
            time_confidence: timeConfidence,
            trajectory_confidence: trajectoryConfidence,
            weather_confidence: weatherConfidence,
            weather_source: weather.source,
            azimuth_source: azimuthSource,
            geometry_only_fallback: geometryOnlyFallback,
            explainability: {
              ...explainability,
              sunlitMarginKm: illumination.sunlitMarginKm,
              losVisibleFraction: round(los.visibleFraction, 4)
            },
            model_version: modelVersion,
            input_hash: inputHash,
            computed_at: nowIso,
            expires_at: expiresAt,
            snapshot_at: launchPassedT0 ? nowIso : null,
            updated_at: nowIso
          });
          incrementWeatherSourceStats(stats, weather.source, 'upserted');

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
      .select('launch_id, observer_location_hash, input_hash, expires_at, snapshot_at')
      .in('launch_id', slice);
    if (error) throw error;
    for (const row of (data || []) as ScoreRow[]) {
      const hash = (row.observer_location_hash || PAD_OBSERVER_HASH).trim() || PAD_OBSERVER_HASH;
      byKey.set(scoreKey(row.launch_id, hash), row);
    }
  }
  return byKey;
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

async function loadNwsRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchIds: string[]
) {
  const byId = new Map<string, NwsRow>();
  const chunkSize = 200;
  for (let i = 0; i < launchIds.length; i += chunkSize) {
    const slice = launchIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('launch_weather')
      .select('launch_id, issued_at, data')
      .eq('source', 'nws')
      .in('launch_id', slice);
    if (error) throw error;
    for (const row of (data || []) as NwsRow[]) {
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

function isDueObserver(row: LaunchRow, existing: ScoreRow | undefined, nowMs: number) {
  if (isSnapshotLocked(existing)) return false;
  const netMs = Date.parse(String(row.net || ''));
  if (!Number.isFinite(netMs)) return true;
  if (netMs <= nowMs) return true;
  if (!existing || !existing.expires_at) return true;
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

function intervalMinutesForLaunch(netMs: number, nowMs: number) {
  const hoursToNet = (netMs - nowMs) / (60 * 60 * 1000);
  if (hoursToNet <= 1) return 5;
  if (hoursToNet <= 6) return 15;
  if (hoursToNet <= 24) return 60;
  if (hoursToNet <= 24 * 7) return 360;
  return 1440;
}

async function resolveObserverWeather({
  observer,
  launch,
  targetMs,
  weatherCache,
  weatherCacheMinutes,
  openMeteoUsModels,
  isUsObserver,
  allowNwsFallback,
  nws
}: {
  observer: ObserverPoint;
  launch: LaunchRow;
  targetMs: number;
  weatherCache: Map<string, { atMs: number; forecast: OpenMeteoForecast | null }>;
  weatherCacheMinutes: number;
  openMeteoUsModels: string[];
  isUsObserver: boolean;
  allowNwsFallback: boolean;
  nws: NwsRow | null;
}): Promise<WeatherResolution> {
  const lat = observer.latDeg;
  const lon = observer.lonDeg;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return {
      source: 'none',
      cloudCoverTotal: null,
      cloudCoverLow: null,
      fetchedAtMs: null,
      openMeteoFetched: false
    };
  }

  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const nowMs = Date.now();
  let openMeteoFetched = false;

  const cached = weatherCache.get(key);
  let forecast = cached?.forecast || null;
  if (!cached || nowMs - cached.atMs > weatherCacheMinutes * 60 * 1000) {
    forecast = await fetchOpenMeteoForecast({
      lat,
      lon,
      isUsLocation: isUsObserver || String(launch.pad_country_code || '').toUpperCase() === 'US',
      usModels: openMeteoUsModels
    });
    weatherCache.set(key, { atMs: nowMs, forecast });
    openMeteoFetched = Boolean(forecast);
  }

  if (forecast && forecast.timesMs.length) {
    const idx = nearestTimeIndex(forecast.timesMs, targetMs);
    if (idx >= 0) {
      const total = idx < forecast.cloudCoverTotal.length ? forecast.cloudCoverTotal[idx] : null;
      const low = idx < forecast.cloudCoverLow.length ? forecast.cloudCoverLow[idx] : null;
      if (total != null || low != null) {
        return {
          source: 'open_meteo',
          cloudCoverTotal: total,
          cloudCoverLow: low,
          fetchedAtMs: forecast.fetchedAtMs,
          openMeteoFetched
        };
      }
    }
  }

  if (allowNwsFallback) {
    const nwsCloud = parseNwsCloud(nws?.data ?? null, targetMs);
    if (nwsCloud.total != null || nwsCloud.low != null) {
      return {
        source: 'nws',
        cloudCoverTotal: nwsCloud.total,
        cloudCoverLow: nwsCloud.low,
        fetchedAtMs: nws?.issued_at ? Date.parse(nws.issued_at) || nowMs : nowMs,
        openMeteoFetched
      };
    }
  }

  return {
    source: 'none',
    cloudCoverTotal: null,
    cloudCoverLow: null,
    fetchedAtMs: null,
    openMeteoFetched
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
      if (!timesRaw.length || !cloudCoverRaw.length) continue;

      const timesMs: number[] = [];
      const cloudCoverTotal: Array<number | null> = [];
      const cloudCoverLow: Array<number | null> = [];

      const maxLen = Math.max(timesRaw.length, cloudCoverRaw.length, cloudCoverLowRaw.length);
      for (let i = 0; i < maxLen; i += 1) {
        const t = Date.parse(String(timesRaw[i] || ''));
        if (!Number.isFinite(t)) continue;
        timesMs.push(t);
        cloudCoverTotal.push(toFiniteNumber(cloudCoverRaw[i]));
        cloudCoverLow.push(toFiniteNumber(cloudCoverLowRaw[i]));
      }

      if (!timesMs.length) continue;

      return {
        fetchedAtMs: Date.now(),
        timesMs,
        cloudCoverTotal,
        cloudCoverLow
      } as OpenMeteoForecast;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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

function parseNwsCloud(data: Record<string, unknown> | null, targetMs: number) {
  if (!data) return { total: null as number | null, low: null as number | null };
  const period = data.period && typeof data.period === 'object' ? (data.period as Record<string, unknown>) : null;
  const periodTotal = toFiniteNumber(
    period?.cloudCover ?? period?.skyCover ?? (period?.cloudCover as any)?.value ?? (period?.skyCover as any)?.value
  );
  const periodLow = toFiniteNumber(
    (period?.cloudCoverLow as any)?.value ??
      (period?.cloudCoverLow as any) ??
      (period?.skyCoverLow as any)?.value ??
      (period?.skyCoverLow as any)
  );
  const topLevelTotal = toFiniteNumber(
    (data as any)?.cloudCoverPct ?? (data as any)?.cloudCover ?? (data as any)?.skyCoverPct ?? (data as any)?.skyCover
  );
  const topLevelLow = toFiniteNumber(
    (data as any)?.cloudCoverLowPct ?? (data as any)?.cloudCoverLow ?? (data as any)?.skyCoverLowPct ?? (data as any)?.skyCoverLow
  );
  const gridTotal = extractNwsGridSkyCover(data, targetMs);
  const total = firstFiniteNumber(periodTotal, topLevelTotal, gridTotal);
  const low = firstFiniteNumber(periodLow, topLevelLow);
  return { total, low };
}

function extractNwsGridSkyCover(data: Record<string, unknown>, targetMs: number) {
  const dataAny = data as any;
  const direct = toFiniteNumber(dataAny?.gridSkyCoverPct);
  if (direct != null) return direct;

  const values = resolveNwsSkyCoverValues(data);
  if (!values.length) return null;
  return pickNwsGridValue(values, targetMs);
}

function resolveNwsSkyCoverValues(data: Record<string, unknown>) {
  const dataAny = data as any;
  const candidateArrays = [
    dataAny?.forecastGridData?.properties?.skyCover?.values,
    dataAny?.gridData?.properties?.skyCover?.values,
    dataAny?.grid?.skyCover?.values,
    dataAny?.skyCover?.values,
    dataAny?.skyCoverValues
  ];
  for (const value of candidateArrays) {
    if (Array.isArray(value) && value.length) return value as Array<Record<string, unknown>>;
  }
  return [] as Array<Record<string, unknown>>;
}

function pickNwsGridValue(values: Array<Record<string, unknown>>, targetMs: number) {
  if (!values.length) return null;

  let nearest: number | null = null;
  let nearestDiff = Number.POSITIVE_INFINITY;

  for (const row of values) {
    const value = toFiniteNumber((row as any)?.value);
    if (value == null) continue;

    const { startMs, endMs } = parseNwsValidTime((row as any)?.validTime);
    if (startMs == null) continue;
    if (targetMs >= startMs && (endMs == null || targetMs < endMs)) {
      return clamp(value, 0, 100);
    }

    const diff = Math.abs(startMs - targetMs);
    if (diff < nearestDiff) {
      nearestDiff = diff;
      nearest = value;
    }
  }

  return nearest != null ? clamp(nearest, 0, 100) : null;
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

function computeWeatherFactor(cloudCoverTotal: number | null, cloudCoverLow: number | null) {
  const low = cloudCoverLow != null ? clamp(cloudCoverLow, 0, 100) : null;
  const total = cloudCoverTotal != null ? clamp(cloudCoverTotal, 0, 100) : null;
  if (low != null && low > 40) return 0;
  if (total == null) return 1;
  if (total < 20) return 1;
  return clamp(1 - (total - 20) / 70, 0, 1);
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
  timeConfidence
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
}) {
  const reasonCodes: string[] = [];
  if (geometryOnlyFallback) reasonCodes.push('geometry_only_weather_fallback');
  if (observerSource !== 'pad') reasonCodes.push('personalized_observer');
  if (weatherConfidence === 'LOW' || weatherConfidence === 'UNKNOWN') reasonCodes.push('weather_confidence_limited');
  if (trajectoryConfidence === 'LOW' || trajectoryConfidence === 'UNKNOWN') reasonCodes.push('trajectory_confidence_limited');
  if (timeConfidence === 'LOW' || timeConfidence === 'UNKNOWN') reasonCodes.push('time_confidence_limited');
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
