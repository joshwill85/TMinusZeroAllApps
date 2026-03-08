import { config } from 'dotenv';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { summarizeTrajectoryOpsGaps } from '@/lib/trajectory/opsGapSummary';
import { parseIsoDurationToMs } from '@/lib/utils/launchMilestones';

config({ path: '.env.local' });
config();

type Args = {
  limit: number;
  lookahead: number;
  launchId?: string;
  verbose: boolean;
};

const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const AR_EXPIRY_MS = 3 * 60 * 60 * 1000;

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  const limitArg = args.find((arg) => arg.startsWith('--limit='));
  const lookaheadArg = args.find((arg) => arg.startsWith('--lookahead='));
  const launchIdArg = args.find((arg) => arg.startsWith('--launch-id='));
  const verbose = args.includes('--verbose') || args.includes('-v');
  return {
    limit: limitArg ? Math.max(1, Number(limitArg.split('=')[1])) : 3,
    lookahead: lookaheadArg ? Math.max(3, Number(lookaheadArg.split('=')[1])) : 50,
    launchId: launchIdArg ? String(launchIdArg.split('=')[1]).trim() : undefined,
    verbose
  };
}

function getMaxTimelineOffsetMs(timeline?: Array<{ relative_time?: string | null }> | null) {
  if (!Array.isArray(timeline) || timeline.length === 0) return null;
  let max = Number.NEGATIVE_INFINITY;
  for (const event of timeline) {
    const relative = typeof event?.relative_time === 'string' ? event.relative_time : null;
    const offsetMs = relative ? parseIsoDurationToMs(relative) : null;
    if (offsetMs == null) continue;
    if (offsetMs > max) max = offsetMs;
  }
  return max === Number.NEGATIVE_INFINITY ? null : max;
}

function computeExpiresAtMs(row: { net?: string | null; status_name?: string | null; timeline?: any }): number | null {
  const netMs = row.net ? Date.parse(row.net) : NaN;
  if (!Number.isFinite(netMs)) return null;
  const ignoreTimeline = row.status_name === 'hold' || row.status_name === 'scrubbed';
  const maxOffsetMs = ignoreTimeline ? 0 : getMaxTimelineOffsetMs(row.timeline) ?? 0;
  return netMs + maxOffsetMs + AR_EXPIRY_MS;
}

function fmtAge(iso: string | null | undefined, nowMs = Date.now()) {
  if (!iso) return '-';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '-';
  const diffMs = nowMs - ms;
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / (60 * 1000));
  const hours = Math.round(abs / (60 * 60 * 1000));
  const days = Math.round(abs / (24 * 60 * 60 * 1000));
  const body = days >= 2 ? `${days}d` : hours >= 2 ? `${hours}h` : `${mins}m`;
  return future ? `in ${body}` : `${body} ago`;
}

function fmtIso(iso: string | null | undefined) {
  if (!iso) return '-';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '-';
  return new Date(ms).toISOString();
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

type LaunchRow = {
  launch_id: string;
  net: string | null;
  status_name: string | null;
  timeline: any;
  pad_latitude: number | null;
  pad_longitude: number | null;
  name: string | null;
  mission_name: string | null;
  mission_orbit: string | null;
  provider: string | null;
  vehicle: string | null;
  rocket_family: string | null;
  pad_name: string | null;
  location_name: string | null;
};

type ProductRow = {
  launch_id: string;
  version: string;
  quality: number;
  generated_at: string;
  confidence_tier?: unknown;
  source_sufficiency?: unknown;
  freshness_state?: unknown;
  lineage_complete?: boolean | null;
  product?: unknown;
};

type ConstraintRow = {
  launch_id: string;
  source: string;
  source_id: string | null;
  constraint_type: string;
  data: any;
  geometry: any;
  confidence: number | null;
  fetched_at: string;
};

function newestFetchedAtIso(constraints: ConstraintRow[]) {
  let bestMs = Number.NEGATIVE_INFINITY;
  let bestIso: string | null = null;
  for (const c of constraints) {
    const ms = Date.parse(c.fetched_at);
    if (!Number.isFinite(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      bestIso = c.fetched_at;
    }
  }
  return bestIso;
}

async function loadLatestRuns(supabase: ReturnType<typeof createSupabaseAdminClient>, jobNames: string[]) {
  const { data, error } = await supabase
    .from('ingestion_runs')
    .select('job_name, started_at, ended_at, success, error')
    .in('job_name', jobNames)
    .order('started_at', { ascending: false })
    .limit(400);

  if (error || !Array.isArray(data)) return new Map<string, any>();

  const out = new Map<string, any>();
  for (const row of data as any[]) {
    const job = typeof row?.job_name === 'string' ? row.job_name : null;
    if (!job) continue;
    if (out.has(job)) continue;
    out.set(job, row);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const supabase = createSupabaseAdminClient();
  const nowMs = Date.now();
  const fromIso = new Date(nowMs - LOOKBACK_MS).toISOString();

  const jobNames = [
    'trajectory_products_generate',
    'trajectory_constraints_ingest',
    'navcen_bnm_ingest',
    'trajectory_orbit_ingest',
    'spacex_infographics_ingest',
    'trajectory_templates_generate',
    'public_cache_refresh'
  ];
  const latestRuns = await loadLatestRuns(supabase, jobNames);

  let eligible: LaunchRow[] = [];
  if (args.launchId) {
    const { data, error } = await supabase
      .from('launches_public_cache')
      .select(
        'launch_id, net, status_name, timeline, pad_latitude, pad_longitude, name, mission_name, mission_orbit, provider, vehicle, rocket_family, pad_name, location_name'
      )
      .eq('launch_id', args.launchId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load launch ${args.launchId}: ${error.message}`);
    if (!data) throw new Error(`Launch not found: ${args.launchId}`);
    eligible = [data as LaunchRow];
  } else {
    const { data, error } = await supabase
      .from('launches_public_cache')
      .select(
        'launch_id, net, status_name, timeline, pad_latitude, pad_longitude, name, mission_name, mission_orbit, provider, vehicle, rocket_family, pad_name, location_name'
      )
      .gte('net', fromIso)
      .order('net', { ascending: true })
      .limit(args.lookahead);

    if (error || !data) {
      throw new Error(`Failed to load launches_public_cache: ${error?.message || 'unknown error'}`);
    }

    const out: LaunchRow[] = [];
    for (const row of data as any[]) {
      if (!row?.launch_id) continue;
      const expiresAtMs = computeExpiresAtMs(row);
      if (expiresAtMs == null || expiresAtMs < nowMs) continue;
      const hasPad = isFiniteNumber(row.pad_latitude) && isFiniteNumber(row.pad_longitude);
      if (!hasPad) continue;
      out.push(row as LaunchRow);
      if (out.length >= args.limit) break;
    }
    eligible = out;
  }

  if (!eligible.length) {
    console.log('ar-trajectory-coverage: no eligible launches found');
    return;
  }

  const launchIds = eligible.map((l) => l.launch_id);

  const [{ data: products, error: productsError }, { data: constraints, error: constraintsError }] = await Promise.all([
    supabase
      .from('launch_trajectory_products')
      .select(
        'launch_id, version, quality, generated_at, confidence_tier, source_sufficiency, freshness_state, lineage_complete, product'
      )
      .in('launch_id', launchIds),
    supabase
      .from('launch_trajectory_constraints')
      .select('launch_id, source, source_id, constraint_type, data, geometry, confidence, fetched_at')
      .in('launch_id', launchIds)
  ]);

  if (productsError) throw new Error(`Failed to load launch_trajectory_products: ${productsError.message}`);
  if (constraintsError) throw new Error(`Failed to load launch_trajectory_constraints: ${constraintsError.message}`);

  const productsByLaunch = new Map<string, ProductRow>();
  for (const p of (products || []) as any[]) {
    if (!p?.launch_id) continue;
    productsByLaunch.set(String(p.launch_id), p as ProductRow);
  }

  const constraintsByLaunch = new Map<string, ConstraintRow[]>();
  for (const c of (constraints || []) as any[]) {
    const launchId = typeof c?.launch_id === 'string' ? c.launch_id : null;
    if (!launchId) continue;
    const list = constraintsByLaunch.get(launchId) || [];
    list.push(c as ConstraintRow);
    constraintsByLaunch.set(launchId, list);
  }

  console.log(`AR trajectory coverage (next ${eligible.length} launches)`);
  console.log(`As of: ${new Date(nowMs).toISOString()}`);
  console.log('');
  console.log('Job freshness (latest ingestion_runs):');
  for (const name of jobNames) {
    const run = latestRuns.get(name) as any;
    if (!run) {
      console.log(`- ${name}: no runs found`);
      continue;
    }
    const ok = run.success === true ? 'ok' : run.success === false ? 'fail' : 'unknown';
    const startedAt = fmtIso(run.started_at);
    const endedAt = fmtIso(run.ended_at);
    const age = fmtAge(run.started_at, nowMs);
    console.log(`- ${name}: ${ok} (started ${startedAt}, ended ${endedAt}, ${age})`);
    if (run.success === false && run.error) {
      console.log(`  error: ${String(run.error)}`);
    }
  }

  let launchesWithTruthOrbit = 0;
  let launchesWithDerivedOnlyOrbit = 0;
  let launchesWithoutExternalDirectionalConstraints = 0;
  let launchesMissingOrStaleProduct = 0;

  for (let i = 0; i < eligible.length; i += 1) {
    const launch = eligible[i];
    const expiresAtMs = computeExpiresAtMs(launch);
    const expiresAtIso = expiresAtMs != null ? new Date(expiresAtMs).toISOString() : '-';
    const product = productsByLaunch.get(launch.launch_id) ?? null;
    const allConstraints = constraintsByLaunch.get(launch.launch_id) || [];

    const byType = (type: string) => allConstraints.filter((c) => c.constraint_type === type);
    const landing = byType('landing');
    const orbit = byType('target_orbit');
    const hazards = byType('hazard_area');
    const infographic = byType('mission_infographic');
    const gapSummary = summarizeTrajectoryOpsGaps({
      constraints: allConstraints,
      productRow: product,
      net: launch.net
    });
    const missingProduct = gapSummary.freshness.missingProduct;
    const productStale = gapSummary.freshness.productStale;
    if (gapSummary.signals.hasTruthTierOrbit) launchesWithTruthOrbit += 1;
    else if (gapSummary.signals.hasDerivedOnlyOrbit) launchesWithDerivedOnlyOrbit += 1;
    if (missingProduct || productStale) launchesMissingOrStaleProduct += 1;

    const title = launch.mission_name || launch.name || launch.launch_id;
    const subtitle = [launch.provider, launch.vehicle, launch.rocket_family, launch.mission_orbit].filter(Boolean).join(' · ');

    console.log('');
    console.log(`${i + 1}) ${title}`);
    if (subtitle) console.log(`   ${subtitle}`);
    console.log(`   LaunchId: ${launch.launch_id}`);
    console.log(`   NET: ${fmtIso(launch.net)} (${fmtAge(launch.net, nowMs)})`);
    console.log(`   ExpiresAt: ${expiresAtIso}`);
    console.log(
      `   Pad: ${launch.pad_name || '-'} (${isFiniteNumber(launch.pad_latitude) ? launch.pad_latitude.toFixed(5) : '?'}, ${isFiniteNumber(launch.pad_longitude) ? launch.pad_longitude.toFixed(5) : '?'})`
    );
    console.log(`   Location: ${launch.location_name || '-'}`);

    if (missingProduct) {
      console.log('   Product: MISSING');
    } else {
      console.log(
        `   Product: quality=${product.quality} version=${product.version} generated_at=${fmtIso(product.generated_at)} (${fmtAge(product.generated_at, nowMs)})${productStale ? ' [STALE]' : ''}`
      );
      console.log(
        `   Product basis: source=${gapSummary.product.sourceSummaryLabel || '-'} direction=${gapSummary.product.directionalSourceLabel} confidence=${gapSummary.product.confidenceTier || '-'}`
      );
    }

    console.log('   Constraints:');
    console.log(
      `   - landing: ${landing.length} (newest ${fmtIso(newestFetchedAtIso(landing))})${gapSummary.signals.hasLandingLatLon ? '' : ' [NO LAT/LON]'}`
    );
    console.log(
      `   - target_orbit: ${orbit.length} (newest ${fmtIso(newestFetchedAtIso(orbit))}) dir=${gapSummary.signals.hasOrbitFlightAzimuth ? 'az' : gapSummary.signals.hasOrbitInclination ? 'inc' : 'none'} alt=${gapSummary.signals.hasOrbitAltitude ? 'yes' : 'no'} truth=${gapSummary.counts.orbitTruth} derived=${gapSummary.counts.orbitDerived}`
    );
    console.log(
      `   - hazard_area: ${hazards.length} (newest ${fmtIso(newestFetchedAtIso(hazards))}) geom=${gapSummary.counts.hazardWithGeometry} window_near_net=${Number.isFinite(Date.parse(launch.net || '')) ? gapSummary.counts.hazardNearNet : '-'}`
    );
    console.log(
      `   - mission_infographic: ${infographic.length} (newest ${fmtIso(newestFetchedAtIso(infographic))})`
    );

    if (!gapSummary.signals.hasDirectionalConstraint) {
      launchesWithoutExternalDirectionalConstraints += 1;
    }
    if (gapSummary.gapReasons.length) {
      console.log(`   WARN: ${gapSummary.gapReasons.map((reason) => reason.label).join('; ')}`);
    }

    if (args.verbose) {
      const sources = new Set<string>();
      for (const c of allConstraints) {
        const s = typeof c.source === 'string' ? c.source : '';
        if (s) sources.add(s);
      }
      console.log(`   Sources: ${sources.size ? Array.from(sources).sort().join(', ') : '-'}`);
    }
  }

  console.log('');
  console.log('Coverage summary:');
  console.log(`- Launches with truth-tier orbit constraints: ${launchesWithTruthOrbit}/${eligible.length}`);
  console.log(`- Launches with derived-only orbit constraints: ${launchesWithDerivedOnlyOrbit}/${eligible.length}`);
  console.log(
    `- Launches without external directional constraints: ${launchesWithoutExternalDirectionalConstraints}/${eligible.length}`
  );
  console.log(`- Launches with missing/stale products: ${launchesMissingOrStaleProduct}/${eligible.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
