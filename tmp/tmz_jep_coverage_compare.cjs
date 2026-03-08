const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i <= 0) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function safeDateMs(v) {
  const ms = Date.parse(String(v || ''));
  return Number.isFinite(ms) ? ms : null;
}

function trajectoryQualityLabel(traj) {
  if (!traj || typeof traj !== 'object') return 'none';
  if (typeof traj.quality_label === 'string' && traj.quality_label.trim()) return traj.quality_label.trim();
  const product = traj.product && typeof traj.product === 'object' ? traj.product : null;
  if (product && typeof product.qualityLabel === 'string' && product.qualityLabel.trim()) return product.qualityLabel.trim();
  return 'none';
}

(async () => {
  loadEnvFile('.env.local');
  loadEnvFile('.env');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const nowMs = Date.now();
  const fromIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const toIso = new Date(nowMs + 16 * 24 * 60 * 60 * 1000).toISOString();

  const { data: launchRows, error: launchError } = await supabase
    .from('launches_public_cache')
    .select('launch_id,net,name,provider,vehicle,rocket_family,pad_country_code,status_name,status_abbrev')
    .gte('net', fromIso)
    .lte('net', toIso)
    .order('net', { ascending: true })
    .limit(1200);

  if (launchError) throw new Error(`launches_public_cache query failed: ${launchError.message}`);

  const launches = (launchRows || []).filter((row) => {
    const netMs = safeDateMs(row.net);
    if (!netMs) return false;
    const status = `${row.status_name || ''} ${row.status_abbrev || ''}`.toLowerCase();
    if (status.includes('canceled') || status.includes('cancelled')) return false;
    return true;
  });

  const launchIds = launches.map((row) => row.launch_id).filter(Boolean);
  const jepRows = [];
  const trajRows = [];

  for (let i = 0; i < launchIds.length; i += 200) {
    const slice = launchIds.slice(i, i + 200);
    const [jepRes, trajRes] = await Promise.all([
      supabase
        .from('launch_jep_scores')
        .select(
          'launch_id,observer_location_hash,score,probability,calibration_band,model_version,computed_at,expires_at,snapshot_at,weather_source,geometry_only_fallback,time_confidence,trajectory_confidence,weather_confidence'
        )
        .in('launch_id', slice),
      supabase
        .from('launch_trajectory_products')
        .select('launch_id,quality,confidence_tier,freshness_state,lineage_complete,generated_at,product')
        .in('launch_id', slice)
    ]);

    if (jepRes.error) throw new Error(`launch_jep_scores query failed: ${jepRes.error.message}`);
    if (trajRes.error) throw new Error(`launch_trajectory_products query failed: ${trajRes.error.message}`);

    jepRows.push(...(jepRes.data || []));
    trajRows.push(...(trajRes.data || []));
  }

  const jepByLaunch = new Map();
  for (const row of jepRows) {
    const list = jepByLaunch.get(row.launch_id) || [];
    list.push(row);
    jepByLaunch.set(row.launch_id, list);
  }

  const trajByLaunch = new Map();
  for (const row of trajRows) {
    trajByLaunch.set(row.launch_id, row);
  }

  const coverage = {
    launches_considered: launches.length,
    with_trajectory_product: 0,
    with_traj_confidence_A_or_B: 0,
    with_traj_fresh: 0,
    with_any_jep_row: 0,
    with_pad_jep_row: 0,
    with_personalized_jep_row: 0,
    with_jep_computed_last_24h: 0,
    with_probability_field: 0,
    with_geometry_only_weather_fallback: 0,
    snapshot_locked_rows: 0
  };

  const providerCounts = {};
  const modeledByProvider = {};
  const trajectoryQualityCounts = {};

  for (const launch of launches) {
    const provider = String(launch.provider || 'Unknown');
    providerCounts[provider] = (providerCounts[provider] || 0) + 1;

    const traj = trajByLaunch.get(launch.launch_id) || null;
    const jepList = jepByLaunch.get(launch.launch_id) || [];

    if (traj) {
      coverage.with_trajectory_product += 1;
      const tier = String(traj.confidence_tier || '').toUpperCase();
      if (tier === 'A' || tier === 'B') coverage.with_traj_confidence_A_or_B += 1;
      if (String(traj.freshness_state || '').toLowerCase() === 'fresh') coverage.with_traj_fresh += 1;
    }

    const qualityLabel = trajectoryQualityLabel(traj);
    trajectoryQualityCounts[qualityLabel] = (trajectoryQualityCounts[qualityLabel] || 0) + 1;

    if (jepList.length > 0) coverage.with_any_jep_row += 1;

    const padRow = jepList.find((row) => String(row.observer_location_hash || '').trim() === 'pad') || null;
    if (padRow) {
      coverage.with_pad_jep_row += 1;
      modeledByProvider[provider] = (modeledByProvider[provider] || 0) + 1;
    }

    const personalizedCount = jepList.filter((row) => {
      const hash = String(row.observer_location_hash || '').trim();
      return hash && hash !== 'pad';
    }).length;

    if (personalizedCount > 0) coverage.with_personalized_jep_row += 1;

    const computedRecent = jepList.some((row) => {
      const ms = safeDateMs(row.computed_at);
      return ms != null && nowMs - ms <= 24 * 60 * 60 * 1000;
    });
    if (computedRecent) coverage.with_jep_computed_last_24h += 1;

    const hasProbability = jepList.some((row) => typeof row.probability === 'number' && Number.isFinite(row.probability));
    if (hasProbability) coverage.with_probability_field += 1;

    const hasGeoFallback = jepList.some((row) => row.geometry_only_fallback === true);
    if (hasGeoFallback) coverage.with_geometry_only_weather_fallback += 1;

    const hasSnapshot = jepList.some((row) => Boolean(String(row.snapshot_at || '').trim()));
    if (hasSnapshot) coverage.snapshot_locked_rows += 1;
  }

  const pct = (part, total) => Number(((part / Math.max(1, total)) * 100).toFixed(1));

  const result = {
    generatedAt: new Date(nowMs).toISOString(),
    window: { fromIso, toIso },
    coverage: {
      ...coverage,
      with_trajectory_product_pct: pct(coverage.with_trajectory_product, launches.length),
      with_traj_confidence_A_or_B_pct: pct(coverage.with_traj_confidence_A_or_B, launches.length),
      with_traj_fresh_pct: pct(coverage.with_traj_fresh, launches.length),
      with_any_jep_row_pct: pct(coverage.with_any_jep_row, launches.length),
      with_pad_jep_row_pct: pct(coverage.with_pad_jep_row, launches.length),
      with_personalized_jep_row_pct: pct(coverage.with_personalized_jep_row, launches.length),
      with_jep_computed_last_24h_pct: pct(coverage.with_jep_computed_last_24h, launches.length),
      with_probability_field_pct: pct(coverage.with_probability_field, launches.length),
      with_geometry_only_weather_fallback_pct: pct(coverage.with_geometry_only_weather_fallback, launches.length),
      snapshot_locked_rows_pct: pct(coverage.snapshot_locked_rows, launches.length)
    },
    providers_considered: Object.keys(providerCounts).length,
    provider_counts: providerCounts,
    modeled_by_provider: modeledByProvider,
    trajectory_quality_label_counts: trajectoryQualityCounts,
    sample_launches: launches.slice(0, 20).map((launch) => {
      const traj = trajByLaunch.get(launch.launch_id) || null;
      const jepList = jepByLaunch.get(launch.launch_id) || [];
      const pad = jepList.find((row) => String(row.observer_location_hash || '').trim() === 'pad') || null;
      const personalizedCount = jepList.filter((row) => {
        const hash = String(row.observer_location_hash || '').trim();
        return hash && hash !== 'pad';
      }).length;
      return {
        launch_id: launch.launch_id,
        name: launch.name,
        net: launch.net,
        provider: launch.provider,
        vehicle: launch.vehicle,
        rocket_family: launch.rocket_family,
        pad_country_code: launch.pad_country_code,
        trajectory: traj
          ? {
              quality_label: trajectoryQualityLabel(traj),
              confidence_tier: traj.confidence_tier,
              freshness_state: traj.freshness_state,
              lineage_complete: traj.lineage_complete,
              generated_at: traj.generated_at
            }
          : null,
        jep_pad: pad
          ? {
              score: pad.score,
              probability: pad.probability,
              calibration_band: pad.calibration_band,
              model_version: pad.model_version,
              weather_source: pad.weather_source,
              geometry_only_fallback: pad.geometry_only_fallback,
              time_confidence: pad.time_confidence,
              trajectory_confidence: pad.trajectory_confidence,
              weather_confidence: pad.weather_confidence,
              computed_at: pad.computed_at,
              expires_at: pad.expires_at,
              snapshot_at: pad.snapshot_at
            }
          : null,
        personalized_variants: personalizedCount
      };
    })
  };

  console.log(JSON.stringify(result, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
