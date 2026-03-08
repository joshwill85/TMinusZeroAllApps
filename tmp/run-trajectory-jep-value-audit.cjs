#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function toFiniteNumber(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(part, total) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

function safeDateMs(v) {
  const ms = Date.parse(String(v || ''));
  return Number.isFinite(ms) ? ms : null;
}

function bool(v) {
  return v === true;
}

function hasTrajectoryRequiredSampleFields(product) {
  const samples = Array.isArray(product?.samples) ? product.samples : [];
  if (!samples.length) return false;
  for (const s of samples) {
    if (toFiniteNumber(s?.tPlusSec) == null) return false;
    const ecef = Array.isArray(s?.ecef) ? s.ecef : null;
    if (!ecef || ecef.length < 3) return false;
    if (toFiniteNumber(ecef[0]) == null || toFiniteNumber(ecef[1]) == null || toFiniteNumber(ecef[2]) == null) return false;
  }
  return true;
}

function sampleSigmaCoverage(product) {
  const samples = Array.isArray(product?.samples) ? product.samples : [];
  if (!samples.length) return 0;
  let withSigma = 0;
  for (const s of samples) {
    const sigma = toFiniteNumber(s?.sigmaDeg ?? s?.uncertainty?.sigmaDeg);
    if (sigma != null) withSigma += 1;
  }
  return withSigma / samples.length;
}

function parseNwsCloudSignals(data) {
  if (!data || typeof data !== 'object') {
    return {
      periodHasCloud: false,
      topLevelHasCloud: false,
      gridHasSkyCover: false,
      gridValuesCount: 0
    };
  }
  const d = data;
  const period = d.period && typeof d.period === 'object' ? d.period : null;
  const periodHasCloud =
    toFiniteNumber(period?.cloudCover) != null ||
    toFiniteNumber(period?.skyCover) != null ||
    toFiniteNumber(period?.cloudCover?.value) != null ||
    toFiniteNumber(period?.skyCover?.value) != null;

  const topLevelHasCloud =
    toFiniteNumber(d.cloudCoverPct) != null ||
    toFiniteNumber(d.cloudCover) != null ||
    toFiniteNumber(d.skyCoverPct) != null ||
    toFiniteNumber(d.skyCover) != null;

  const candidates = [
    d?.forecastGridData?.properties?.skyCover?.values,
    d?.gridData?.properties?.skyCover?.values,
    d?.grid?.skyCover?.values,
    d?.skyCover?.values,
    d?.skyCoverValues
  ];
  let gridValues = [];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) {
      gridValues = c;
      break;
    }
  }

  return {
    periodHasCloud,
    topLevelHasCloud,
    gridHasSkyCover: gridValues.length > 0,
    gridValuesCount: gridValues.length
  };
}

async function main() {
  const cwd = process.cwd();
  loadEnvFile(path.join(cwd, '.env.local'));
  loadEnvFile(path.join(cwd, '.env'));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const nowMs = Date.now();
  const fromIso = new Date(nowMs - 60 * 60 * 1000).toISOString();

  const { data: settingsRows, error: settingsError } = await supabase
    .from('system_settings')
    .select('key, value')
    .in('key', [
      'trajectory_products_eligible_limit',
      'trajectory_products_lookahead_limit',
      'trajectory_products_top3_ids',
      'trajectory_products_lookback_hours',
      'trajectory_products_expiry_hours',
      'jep_score_horizon_days',
      'jep_score_model_version',
      'jep_score_open_meteo_us_models',
      'jep_score_weather_cache_minutes',
      'jep_score_max_launches_per_run'
    ]);

  if (settingsError) throw new Error(`settings query failed: ${settingsError.message}`);
  const settings = Object.fromEntries((settingsRows || []).map((r) => [r.key, r.value]));
  const horizonDays = Math.max(1, Number(settings.jep_score_horizon_days || 16));
  const horizonIso = new Date(nowMs + horizonDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: launchesRaw, error: launchesError } = await supabase
    .from('launches_public_cache')
    .select(
      'launch_id,net,name,provider,vehicle,rocket_family,pad_country_code,pad_latitude,pad_longitude,status_name,status_abbrev'
    )
    .gte('net', fromIso)
    .lte('net', horizonIso)
    .order('net', { ascending: true })
    .limit(500);

  if (launchesError) throw new Error(`launches query failed: ${launchesError.message}`);
  const launches = (launchesRaw || []).filter((row) => {
    const netMs = safeDateMs(row.net);
    if (!netMs) return false;
    const status = `${row.status_name || ''} ${row.status_abbrev || ''}`.toLowerCase();
    if (status.includes('success') || status.includes('failure') || status.includes('canceled') || status.includes('cancelled')) {
      return false;
    }
    return true;
  });

  const launchIds = launches.map((l) => l.launch_id).filter(Boolean);
  const usLaunches = launches.filter((l) => ['US', 'USA'].includes(String(l.pad_country_code || '').toUpperCase()));
  const falconLaunches = launches.filter((l) => {
    const str = `${l.vehicle || ''} ${l.rocket_family || ''}`.toLowerCase();
    return str.includes('falcon 9') || str.includes('falcon9');
  });

  let trajectoryById = new Map();
  let jepPadById = new Map();
  let nwsById = new Map();

  if (launchIds.length) {
    const [trajRes, jepRes, nwsRes] = await Promise.all([
      supabase
        .from('launch_trajectory_products')
        .select('launch_id,generated_at,confidence_tier,freshness_state,lineage_complete,quality,product')
        .in('launch_id', launchIds),
      supabase
        .from('launch_jep_scores')
        .select(
          'launch_id,observer_location_hash,score,probability,calibration_band,illumination_factor,darkness_factor,los_factor,weather_factor,solar_depression_deg,cloud_cover_pct,cloud_cover_low_pct,time_confidence,trajectory_confidence,weather_confidence,weather_source,azimuth_source,geometry_only_fallback,model_version,computed_at,expires_at,sunlit_margin_km,los_visible_fraction,weather_freshness_min,explainability,input_hash'
        )
        .in('launch_id', launchIds)
        .eq('observer_location_hash', 'pad'),
      supabase
        .from('launch_weather')
        .select('launch_id,source,issued_at,valid_start,valid_end,data,summary,probability')
        .in('launch_id', launchIds)
        .eq('source', 'nws')
    ]);

    if (trajRes.error) throw new Error(`trajectory query failed: ${trajRes.error.message}`);
    if (jepRes.error) throw new Error(`jep query failed: ${jepRes.error.message}`);
    if (nwsRes.error) throw new Error(`nws query failed: ${nwsRes.error.message}`);

    for (const row of trajRes.data || []) trajectoryById.set(row.launch_id, row);
    for (const row of jepRes.data || []) jepPadById.set(row.launch_id, row);
    for (const row of nwsRes.data || []) nwsById.set(row.launch_id, row);
  }

  const jobs = [
    'trajectory_orbit_ingest',
    'trajectory_constraints_ingest',
    'trajectory_products_generate',
    'jep_score_refresh',
    'nws_refresh'
  ];

  const latestRuns = {};
  for (const job of jobs) {
    const { data, error } = await supabase
      .from('ingestion_runs')
      .select('job_name,started_at,ended_at,success,stats,error')
      .eq('job_name', job)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`ingestion run query failed for ${job}: ${error.message}`);
    latestRuns[job] = data || null;
  }

  const { data: schedulerRows, error: schedulerError } = await supabase
    .from('managed_scheduler_jobs')
    .select('cron_job_name,edge_job_slug,interval_seconds,offset_seconds,enabled,next_run_at,updated_at')
    .in('cron_job_name', ['trajectory_orbit_ingest', 'trajectory_constraints_ingest', 'trajectory_products_generate', 'jep_score_refresh', 'nws_refresh'])
    .order('cron_job_name', { ascending: true });
  if (schedulerError) throw new Error(`scheduler query failed: ${schedulerError.message}`);

  const perLaunch = launches.map((launch) => {
    const traj = trajectoryById.get(launch.launch_id) || null;
    const product = traj?.product || null;
    const samples = Array.isArray(product?.samples) ? product.samples : [];
    const sampleCount = samples.length;
    const requiredSampleFields = hasTrajectoryRequiredSampleFields(product);
    const sigmaCoverage = sampleSigmaCoverage(product);
    const hasEvents = Array.isArray(product?.events) && product.events.length > 0;

    const jep = jepPadById.get(launch.launch_id) || null;
    const jepExpiresMs = safeDateMs(jep?.expires_at);
    const jepComputedMs = safeDateMs(jep?.computed_at);

    const nws = nwsById.get(launch.launch_id) || null;
    const nwsSignals = parseNwsCloudSignals(nws?.data || null);

    const weatherReadyByJep = !!jep && String(jep.weather_source || '').trim().toLowerCase() !== 'none';
    const trajectoryReady = !!traj && sampleCount > 0 && requiredSampleFields && hasEvents && sigmaCoverage >= 0.5;

    return {
      launch_id: launch.launch_id,
      net: launch.net,
      name: launch.name,
      provider: launch.provider,
      vehicle: launch.vehicle,
      country: launch.pad_country_code,
      is_falcon9: falconLaunches.some((x) => x.launch_id === launch.launch_id),
      trajectory: {
        present: !!traj,
        generated_at: traj?.generated_at || null,
        confidence_tier: traj?.confidence_tier || null,
        freshness_state: traj?.freshness_state || null,
        lineage_complete: traj?.lineage_complete ?? null,
        quality: traj?.quality ?? null,
        sample_count: sampleCount,
        required_sample_fields_ready: requiredSampleFields,
        sigma_coverage_rate: Number((sigmaCoverage * 100).toFixed(1)),
        has_events: hasEvents,
        ready_for_ar: trajectoryReady
      },
      jep_pad: {
        present: !!jep,
        model_version: jep?.model_version || null,
        computed_at: jep?.computed_at || null,
        expires_at: jep?.expires_at || null,
        not_expired: jepExpiresMs != null ? jepExpiresMs > nowMs : null,
        computed_within_24h: jepComputedMs != null ? nowMs - jepComputedMs <= 24 * 60 * 60 * 1000 : null,
        weather_source: jep?.weather_source || null,
        geometry_only_fallback: jep?.geometry_only_fallback ?? null,
        cloud_cover_pct: jep?.cloud_cover_pct ?? null,
        cloud_cover_low_pct: jep?.cloud_cover_low_pct ?? null,
        input_hash_present: !!jep?.input_hash,
        explainability_present: !!jep?.explainability,
        weather_ready_for_jep: weatherReadyByJep
      },
      nws_weather: {
        present: !!nws,
        issued_at: nws?.issued_at || null,
        summary: nws?.summary || null,
        probability: nws?.probability ?? null,
        period_has_cloud: nwsSignals.periodHasCloud,
        top_level_has_cloud: nwsSignals.topLevelHasCloud,
        grid_has_sky_cover: nwsSignals.gridHasSkyCover,
        grid_values_count: nwsSignals.gridValuesCount
      }
    };
  });

  const trajectoryPresent = perLaunch.filter((r) => r.trajectory.present).length;
  const trajectoryReady = perLaunch.filter((r) => r.trajectory.ready_for_ar).length;
  const trajectoryFresh = perLaunch.filter((r) => r.trajectory.freshness_state === 'fresh').length;
  const trajectoryAB = perLaunch.filter((r) => ['A', 'B'].includes(String(r.trajectory.confidence_tier || '').toUpperCase())).length;
  const trajectoryLineage = perLaunch.filter((r) => r.trajectory.lineage_complete === true).length;

  const jepPresent = perLaunch.filter((r) => r.jep_pad.present).length;
  const jepV3 = perLaunch.filter((r) => String(r.jep_pad.model_version || '').toLowerCase() === 'jep_v3').length;
  const jepNotExpired = perLaunch.filter((r) => r.jep_pad.not_expired === true).length;
  const jep24h = perLaunch.filter((r) => r.jep_pad.computed_within_24h === true).length;
  const jepWeatherReady = perLaunch.filter((r) => r.jep_pad.weather_ready_for_jep).length;
  const jepWeatherNone = perLaunch.filter((r) => String(r.jep_pad.weather_source || '').toLowerCase() === 'none').length;
  const jepGeometryFallback = perLaunch.filter((r) => r.jep_pad.geometry_only_fallback === true).length;

  const usIds = new Set(usLaunches.map((l) => l.launch_id));
  const usRows = perLaunch.filter((r) => usIds.has(r.launch_id));
  const usNwsPresent = usRows.filter((r) => r.nws_weather.present).length;
  const usNwsRecent = usRows.filter((r) => {
    const ms = safeDateMs(r.nws_weather.issued_at);
    return ms != null && nowMs - ms <= 24 * 60 * 60 * 1000;
  }).length;
  const usNwsCloudSignals = usRows.filter((r) => r.nws_weather.period_has_cloud || r.nws_weather.top_level_has_cloud || r.nws_weather.grid_has_sky_cover).length;

  const falconRows = perLaunch.filter((r) => r.is_falcon9);

  const summary = {
    generatedAt: new Date(nowMs).toISOString(),
    window: { fromIso, horizonIso, horizonDays },
    settings: {
      trajectory_products_eligible_limit: settings.trajectory_products_eligible_limit ?? null,
      trajectory_products_lookahead_limit: settings.trajectory_products_lookahead_limit ?? null,
      trajectory_products_top3_ids: settings.trajectory_products_top3_ids ?? null,
      jep_score_model_version: settings.jep_score_model_version ?? null,
      jep_score_open_meteo_us_models: settings.jep_score_open_meteo_us_models ?? null,
      jep_score_weather_cache_minutes: settings.jep_score_weather_cache_minutes ?? null,
      jep_score_max_launches_per_run: settings.jep_score_max_launches_per_run ?? null
    },
    launches: {
      eligibleCount: launches.length,
      usEligibleCount: usLaunches.length,
      falcon9EligibleCount: falconLaunches.length
    },
    trajectoryReadiness: {
      coverageRate: pct(trajectoryPresent, launches.length),
      arReadyRate: pct(trajectoryReady, launches.length),
      freshRate: pct(trajectoryFresh, Math.max(1, trajectoryPresent)),
      lineageCompleteRate: pct(trajectoryLineage, Math.max(1, trajectoryPresent)),
      confidenceABRate: pct(trajectoryAB, Math.max(1, trajectoryPresent))
    },
    jepReadiness: {
      padCoverageRate: pct(jepPresent, launches.length),
      modelV3Rate: pct(jepV3, Math.max(1, jepPresent)),
      notExpiredRate: pct(jepNotExpired, Math.max(1, jepPresent)),
      computedWithin24hRate: pct(jep24h, Math.max(1, jepPresent)),
      weatherReadyRate: pct(jepWeatherReady, Math.max(1, jepPresent)),
      weatherSourceNoneRate: pct(jepWeatherNone, Math.max(1, jepPresent)),
      geometryOnlyFallbackRate: pct(jepGeometryFallback, Math.max(1, jepPresent))
    },
    weatherReadiness: {
      usNwsCoverageRate: pct(usNwsPresent, Math.max(1, usRows.length)),
      usNwsRecent24hRate: pct(usNwsRecent, Math.max(1, usRows.length)),
      usNwsCloudSignalRate: pct(usNwsCloudSignals, Math.max(1, usRows.length))
    },
    falcon9Readiness: {
      eligibleCount: falconRows.length,
      trajectoryCoverageRate: pct(falconRows.filter((r) => r.trajectory.present).length, Math.max(1, falconRows.length)),
      arReadyRate: pct(falconRows.filter((r) => r.trajectory.ready_for_ar).length, Math.max(1, falconRows.length)),
      jepPadCoverageRate: pct(falconRows.filter((r) => r.jep_pad.present).length, Math.max(1, falconRows.length)),
      jepWeatherReadyRate: pct(falconRows.filter((r) => r.jep_pad.weather_ready_for_jep).length, Math.max(1, falconRows.length)),
      jepWeatherNoneRate: pct(
        falconRows.filter((r) => String(r.jep_pad.weather_source || '').toLowerCase() === 'none').length,
        Math.max(1, falconRows.filter((r) => r.jep_pad.present).length)
      )
    },
    latestRuns,
    scheduler: schedulerRows || [],
    verdict: {
      arTrajectory: trajectoryReady >= launches.length && trajectoryPresent >= launches.length ? 'GO' : trajectoryReady > 0 ? 'PARTIAL' : 'NO_GO',
      jep: jepPresent >= launches.length && jepWeatherNone === 0 ? 'GO' : jepPresent > 0 ? 'PARTIAL' : 'NO_GO'
    }
  };

  const outDir = path.join(cwd, 'tmp', 'deploy_inspect');
  fs.mkdirSync(outDir, { recursive: true });

  const summaryPath = path.join(outDir, 'live-data-readiness-summary.json');
  const perLaunchPath = path.join(outDir, 'live-data-readiness-per-launch.json');

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(perLaunchPath, JSON.stringify(perLaunch, null, 2));

  console.log(JSON.stringify({
    ok: true,
    summaryPath,
    perLaunchPath,
    generatedAt: summary.generatedAt,
    verdict: summary.verdict,
    launches: summary.launches,
    trajectoryReadiness: summary.trajectoryReadiness,
    jepReadiness: summary.jepReadiness,
    weatherReadiness: summary.weatherReadiness,
    falcon9Readiness: summary.falcon9Readiness
  }, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
