import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { summarizeTrajectoryOpsGaps } from '@/lib/trajectory/opsGapSummary';
import { parseIsoDurationToMs } from '@/lib/utils/launchMilestones';

config({ path: '.env.local' });
config();

type CoveragePolicy = {
  policyVersion: string;
  updatedAt: string;
  windowDefaults: {
    lookaheadLaunches: number;
    lookaheadDays: number;
  };
  thresholds: {
    minLaunchesEvaluated: number;
    minTruthTierOrbitCoverageRate: number;
    maxDerivedOnlyOrbitCoverageRate: number;
    maxNoDirectionalConstraintRate: number;
    maxMissingOrStaleProductRate: number;
    maxPadOnlyProductRate: number;
  };
};

type CliArgs = {
  policyPath: string;
  outputPath: string;
  markdownPath: string;
  lookaheadLaunches?: number;
  lookaheadDays?: number;
  skipDb: boolean;
  requireDb: boolean;
  warnOnly: boolean;
  quiet: boolean;
  json: boolean;
};

type CheckStatus = 'pass' | 'fail' | 'skip';

type CheckResult = {
  id: string;
  label: string;
  status: CheckStatus;
  value: number | string | null;
  threshold: string;
  details?: string;
};

type LaunchCoverageRow = {
  launchId: string;
  title: string;
  net: string | null;
  productQuality: number | null;
  productGeneratedAt: string | null;
  productDirectionalSource: string | null;
  primaryGap: string | null;
  productMissingOrStale: boolean;
  productPadOnly: boolean;
  hasTruthTierOrbit: boolean;
  hasDerivedOnlyOrbit: boolean;
  hasDirectionalConstraint: boolean;
  hasLandingLatLon: boolean;
  hasHazardGeometry: boolean;
};

type CoverageSummary = {
  launchesEvaluated: number;
  launchesWithTruthTierOrbit: number;
  launchesWithDerivedOnlyOrbit: number;
  launchesWithoutDirectionalConstraint: number;
  launchesMissingOrStaleProduct: number;
  launchesPadOnlyProduct: number;
  truthTierOrbitCoverageRate: number | null;
  derivedOnlyOrbitCoverageRate: number | null;
  noDirectionalConstraintRate: number | null;
  missingOrStaleProductRate: number | null;
  padOnlyProductRate: number | null;
};

type CoverageCheckReport = {
  generatedAt: string;
  policyVersion: string;
  policyPath: string;
  window: {
    lookaheadLaunches: number;
    lookaheadDays: number;
  };
  pass: boolean;
  checks: CheckResult[];
  summary: CoverageSummary | null;
  launches: LaunchCoverageRow[];
};

type LaunchRow = {
  launch_id: string;
  net: string | null;
  status_name: string | null;
  timeline: Array<{ relative_time?: string | null }> | null;
  pad_latitude: number | null;
  pad_longitude: number | null;
  name: string | null;
  mission_name: string | null;
};

type ProductRow = {
  launch_id: string;
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
  constraint_type: string;
  data: any;
  geometry: any;
  fetched_at: string;
};

const AR_EXPIRY_MS = 3 * 60 * 60 * 1000;

function parseNumberArg(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  return {
    policyPath: value('--policy=') || 'docs/specs/ar-trajectory-coverage-policy-v1.json',
    outputPath: value('--output=') || '.artifacts/ar-trajectory-coverage-check.json',
    markdownPath: value('--markdown=') || '.artifacts/ar-trajectory-coverage-check.md',
    lookaheadLaunches: value('--lookahead-launches=') ? Math.max(1, Math.floor(parseNumberArg(value('--lookahead-launches='), 8))) : undefined,
    lookaheadDays: value('--lookahead-days=') ? Math.max(3, Math.floor(parseNumberArg(value('--lookahead-days='), 50))) : undefined,
    skipDb: args.includes('--skip-db'),
    requireDb: args.includes('--require-db'),
    warnOnly: args.includes('--warn-only'),
    quiet: args.includes('--quiet'),
    json: args.includes('--json')
  };
}

function resolvePath(pathArg: string) {
  return path.resolve(process.cwd(), pathArg);
}

function readJsonFile<T>(pathArg: string): T {
  const full = resolvePath(pathArg);
  if (!fs.existsSync(full)) throw new Error(`File not found: ${full}`);
  return JSON.parse(fs.readFileSync(full, 'utf8')) as T;
}

function writeJson(pathArg: string, value: unknown) {
  const full = resolvePath(pathArg);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(pathArg: string, value: string) {
  const full = resolvePath(pathArg);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, value, 'utf8');
}

function safeRate(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function fmt(value: number | null | undefined, digits = 3) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function fmtPct(value: number | null | undefined, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

function check({
  id,
  label,
  pass,
  value,
  threshold,
  details
}: {
  id: string;
  label: string;
  pass: boolean;
  value: number | string | null;
  threshold: string;
  details?: string;
}): CheckResult {
  return {
    id,
    label,
    status: pass ? 'pass' : 'fail',
    value,
    threshold,
    details
  };
}

function skipCheck(id: string, label: string, details: string): CheckResult {
  return {
    id,
    label,
    status: 'skip',
    value: null,
    threshold: 'n/a',
    details
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

function computeExpiresAtMs(row: LaunchRow) {
  const netMs = row.net ? Date.parse(row.net) : NaN;
  if (!Number.isFinite(netMs)) return null;
  const ignoreTimeline = row.status_name === 'hold' || row.status_name === 'scrubbed';
  const maxOffsetMs = ignoreTimeline ? 0 : getMaxTimelineOffsetMs(row.timeline) ?? 0;
  return netMs + maxOffsetMs + AR_EXPIRY_MS;
}

function buildMarkdown(report: CoverageCheckReport) {
  const lines: string[] = [];
  lines.push('# AR Trajectory Coverage Check');
  lines.push('');
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- policyVersion: ${report.policyVersion}`);
  lines.push(`- lookaheadLaunches: ${report.window.lookaheadLaunches}`);
  lines.push(`- lookaheadDays: ${report.window.lookaheadDays}`);
  lines.push(`- result: ${report.pass ? 'PASS' : 'FAIL'}`);
  lines.push('');

  lines.push('## Checks');
  lines.push('');
  lines.push('| Check | Value | Threshold | Status |');
  lines.push('|---|---:|---:|---|');
  for (const row of report.checks) {
    const value = typeof row.value === 'number' ? fmt(row.value) : (row.value ?? '—');
    lines.push(`| ${row.id} | ${value} | ${row.threshold} | ${row.status} |`);
  }
  lines.push('');

  if (report.summary) {
    lines.push('## Summary');
    lines.push('');
    lines.push(`- launchesEvaluated=${report.summary.launchesEvaluated}`);
    lines.push(`- truthTierOrbitCoverageRate=${fmtPct(report.summary.truthTierOrbitCoverageRate)}`);
    lines.push(`- derivedOnlyOrbitCoverageRate=${fmtPct(report.summary.derivedOnlyOrbitCoverageRate)}`);
    lines.push(`- noDirectionalConstraintRate=${fmtPct(report.summary.noDirectionalConstraintRate)}`);
    lines.push(`- missingOrStaleProductRate=${fmtPct(report.summary.missingOrStaleProductRate)}`);
    lines.push(`- padOnlyProductRate=${fmtPct(report.summary.padOnlyProductRate)}`);
    lines.push('');
  }

  lines.push('## Launches');
  lines.push('');
  lines.push('| Launch | NET | Product | Directional source | Primary gap | Truth orbit | Derived-only orbit | Directional constraint | Pad-only product | Missing/stale product |');
  lines.push('|---|---|---:|---|---|---|---|---|---|---|');
  if (!report.launches.length) {
    lines.push('| — | — | — | — | — | — | — | — | — | — |');
  } else {
    for (const row of report.launches) {
      lines.push(
        `| ${row.title} | ${row.net ?? '—'} | ${row.productQuality ?? '—'} | ${row.productDirectionalSource ?? '—'} | ${row.primaryGap ?? '—'} | ${row.hasTruthTierOrbit ? 'yes' : 'no'} | ${row.hasDerivedOnlyOrbit ? 'yes' : 'no'} | ${row.hasDirectionalConstraint ? 'yes' : 'no'} | ${row.productPadOnly ? 'yes' : 'no'} | ${row.productMissingOrStale ? 'yes' : 'no'} |`
      );
    }
  }
  lines.push('');

  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const policy = readJsonFile<CoveragePolicy>(args.policyPath);
  const lookaheadLaunches = args.lookaheadLaunches ?? policy.windowDefaults.lookaheadLaunches;
  const lookaheadDays = args.lookaheadDays ?? policy.windowDefaults.lookaheadDays;

  const checks: CheckResult[] = [];
  const launchRows: LaunchCoverageRow[] = [];
  let summary: CoverageSummary | null = null;

  if (args.skipDb) {
    checks.push(skipCheck('coverage.db', 'Coverage DB checks', 'Skipped by --skip-db.'));
  } else if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    if (args.requireDb) {
      checks.push(
        check({
          id: 'coverage.db_env',
          label: 'Supabase env configured',
          pass: false,
          value: 'missing',
          threshold: 'configured'
        })
      );
    } else {
      checks.push(skipCheck('coverage.db_env', 'Coverage DB checks', 'Supabase env not configured; skipped.'));
    }
  } else {
    const supabase = createSupabaseAdminClient();
    const nowMs = Date.now();
    const fromIso = new Date(nowMs - lookaheadDays * 24 * 60 * 60 * 1000).toISOString();
    const candidateLimit = Math.min(500, Math.max(lookaheadLaunches * 20, 120));

    const { data: launchesData, error: launchesError } = await supabase
      .from('launches_public_cache')
      .select('launch_id, net, status_name, timeline, pad_latitude, pad_longitude, name, mission_name')
      .gte('net', fromIso)
      .order('net', { ascending: true })
      .limit(candidateLimit);

    if (launchesError || !Array.isArray(launchesData)) {
      throw new Error(`Failed to load launches_public_cache: ${launchesError?.message || 'unknown error'}`);
    }

    const eligible: LaunchRow[] = [];
    for (const row of launchesData as LaunchRow[]) {
      if (!row?.launch_id) continue;
      const expiresAtMs = computeExpiresAtMs(row);
      const hasPad = typeof row.pad_latitude === 'number' && Number.isFinite(row.pad_latitude) && typeof row.pad_longitude === 'number' && Number.isFinite(row.pad_longitude);
      if (expiresAtMs == null || expiresAtMs < nowMs || !hasPad) continue;
      eligible.push(row);
      if (eligible.length >= lookaheadLaunches) break;
    }

    const launchIds = eligible.map((row) => row.launch_id);
    if (launchIds.length === 0) {
      summary = {
        launchesEvaluated: 0,
        launchesWithTruthTierOrbit: 0,
        launchesWithDerivedOnlyOrbit: 0,
        launchesWithoutDirectionalConstraint: 0,
        launchesMissingOrStaleProduct: 0,
        launchesPadOnlyProduct: 0,
        truthTierOrbitCoverageRate: null,
        derivedOnlyOrbitCoverageRate: null,
        noDirectionalConstraintRate: null,
        missingOrStaleProductRate: null,
        padOnlyProductRate: null
      };
    } else {
      const [{ data: productsData, error: productsError }, { data: constraintsData, error: constraintsError }] = await Promise.all([
        supabase
          .from('launch_trajectory_products')
          .select('launch_id, quality, generated_at, confidence_tier, source_sufficiency, freshness_state, lineage_complete, product')
          .in('launch_id', launchIds),
        supabase
          .from('launch_trajectory_constraints')
          .select('launch_id, constraint_type, data, geometry, fetched_at')
          .in('launch_id', launchIds)
      ]);

      if (productsError) throw new Error(`Failed to load launch_trajectory_products: ${productsError.message}`);
      if (constraintsError) throw new Error(`Failed to load launch_trajectory_constraints: ${constraintsError.message}`);

      const productsByLaunch = new Map<string, ProductRow>();
      for (const row of (productsData || []) as ProductRow[]) {
        if (!row?.launch_id) continue;
        productsByLaunch.set(row.launch_id, row);
      }

      const constraintsByLaunch = new Map<string, ConstraintRow[]>();
      for (const row of (constraintsData || []) as ConstraintRow[]) {
        if (!row?.launch_id) continue;
        const list = constraintsByLaunch.get(row.launch_id) || [];
        list.push(row);
        constraintsByLaunch.set(row.launch_id, list);
      }

      let launchesWithTruthTierOrbit = 0;
      let launchesWithDerivedOnlyOrbit = 0;
      let launchesWithoutDirectionalConstraint = 0;
      let launchesMissingOrStaleProduct = 0;
      let launchesPadOnlyProduct = 0;

      for (const launch of eligible) {
        const product = productsByLaunch.get(launch.launch_id) ?? null;
        const allConstraints = constraintsByLaunch.get(launch.launch_id) || [];
        const gapSummary = summarizeTrajectoryOpsGaps({
          constraints: allConstraints,
          productRow: product,
          net: launch.net
        });

        const hasDirectionalConstraint = gapSummary.signals.hasDirectionalConstraint;
        const hasTruthTierOrbit = gapSummary.signals.hasTruthTierOrbit;
        const hasDerivedOnlyOrbit = gapSummary.signals.hasDerivedOnlyOrbit;
        const productMissingOrStale = gapSummary.freshness.missingProduct || gapSummary.freshness.productStale;
        const productPadOnly = Boolean(product && (gapSummary.product.qualityLabel === 'pad_only' || product.quality === 0));

        if (hasTruthTierOrbit) launchesWithTruthTierOrbit += 1;
        if (hasDerivedOnlyOrbit) launchesWithDerivedOnlyOrbit += 1;
        if (!hasDirectionalConstraint) launchesWithoutDirectionalConstraint += 1;
        if (productMissingOrStale) launchesMissingOrStaleProduct += 1;
        if (productPadOnly) launchesPadOnlyProduct += 1;

        launchRows.push({
          launchId: launch.launch_id,
          title: launch.mission_name || launch.name || launch.launch_id,
          net: launch.net,
          productQuality: product?.quality ?? null,
          productGeneratedAt: product?.generated_at ?? null,
          productDirectionalSource: gapSummary.product.directionalSourceLabel,
          primaryGap: gapSummary.primaryGap?.label ?? null,
          productMissingOrStale,
          productPadOnly,
          hasTruthTierOrbit,
          hasDerivedOnlyOrbit,
          hasDirectionalConstraint,
          hasLandingLatLon: gapSummary.signals.hasLandingLatLon,
          hasHazardGeometry: gapSummary.signals.hasHazardGeometry
        });
      }

      summary = {
        launchesEvaluated: eligible.length,
        launchesWithTruthTierOrbit: launchesWithTruthTierOrbit,
        launchesWithDerivedOnlyOrbit: launchesWithDerivedOnlyOrbit,
        launchesWithoutDirectionalConstraint: launchesWithoutDirectionalConstraint,
        launchesMissingOrStaleProduct,
        launchesPadOnlyProduct,
        truthTierOrbitCoverageRate: safeRate(launchesWithTruthTierOrbit, eligible.length),
        derivedOnlyOrbitCoverageRate: safeRate(launchesWithDerivedOnlyOrbit, eligible.length),
        noDirectionalConstraintRate: safeRate(launchesWithoutDirectionalConstraint, eligible.length),
        missingOrStaleProductRate: safeRate(launchesMissingOrStaleProduct, eligible.length),
        padOnlyProductRate: safeRate(launchesPadOnlyProduct, eligible.length)
      };
    }

    checks.push(
      check({
        id: 'coverage.min_launches',
        label: 'Evaluated launch count',
        pass: summary.launchesEvaluated >= policy.thresholds.minLaunchesEvaluated,
        value: summary.launchesEvaluated,
        threshold: `>= ${policy.thresholds.minLaunchesEvaluated}`
      })
    );
    checks.push(
      check({
        id: 'coverage.truth_tier_orbit_rate',
        label: 'Truth-tier orbit coverage rate',
        pass: (summary.truthTierOrbitCoverageRate ?? -1) >= policy.thresholds.minTruthTierOrbitCoverageRate,
        value: summary.truthTierOrbitCoverageRate,
        threshold: `>= ${policy.thresholds.minTruthTierOrbitCoverageRate}`
      })
    );
    checks.push(
      check({
        id: 'coverage.derived_only_orbit_rate',
        label: 'Derived-only orbit rate',
        pass: summary.derivedOnlyOrbitCoverageRate != null && summary.derivedOnlyOrbitCoverageRate <= policy.thresholds.maxDerivedOnlyOrbitCoverageRate,
        value: summary.derivedOnlyOrbitCoverageRate,
        threshold: `<= ${policy.thresholds.maxDerivedOnlyOrbitCoverageRate}`
      })
    );
    checks.push(
      check({
        id: 'coverage.no_directional_constraint_rate',
        label: 'No directional-constraint rate',
        pass: summary.noDirectionalConstraintRate != null && summary.noDirectionalConstraintRate <= policy.thresholds.maxNoDirectionalConstraintRate,
        value: summary.noDirectionalConstraintRate,
        threshold: `<= ${policy.thresholds.maxNoDirectionalConstraintRate}`
      })
    );
    checks.push(
      check({
        id: 'coverage.missing_or_stale_product_rate',
        label: 'Missing/stale product rate',
        pass: summary.missingOrStaleProductRate != null && summary.missingOrStaleProductRate <= policy.thresholds.maxMissingOrStaleProductRate,
        value: summary.missingOrStaleProductRate,
        threshold: `<= ${policy.thresholds.maxMissingOrStaleProductRate}`
      })
    );
    checks.push(
      check({
        id: 'coverage.pad_only_product_rate',
        label: 'Pad-only product rate',
        pass: summary.padOnlyProductRate != null && summary.padOnlyProductRate <= policy.thresholds.maxPadOnlyProductRate,
        value: summary.padOnlyProductRate,
        threshold: `<= ${policy.thresholds.maxPadOnlyProductRate}`
      })
    );
  }

  const pass = checks.every((row) => row.status !== 'fail');
  const report: CoverageCheckReport = {
    generatedAt: new Date().toISOString(),
    policyVersion: policy.policyVersion,
    policyPath: args.policyPath,
    window: {
      lookaheadLaunches,
      lookaheadDays
    },
    pass,
    checks,
    summary,
    launches: launchRows
  };

  writeJson(args.outputPath, report);
  writeText(args.markdownPath, buildMarkdown(report));

  if (!args.quiet && !args.json) {
    const failed = checks.filter((row) => row.status === 'fail');
    const skipped = checks.filter((row) => row.status === 'skip');
    console.log('AR trajectory coverage check');
    console.log(`Policy: ${policy.policyVersion}`);
    console.log(`Result: ${pass ? 'PASS' : args.warnOnly ? 'WARN' : 'FAIL'}`);
    console.log(`Checks: pass=${checks.filter((row) => row.status === 'pass').length} fail=${failed.length} skip=${skipped.length}`);
    if (summary) {
      console.log(
        `Summary: launches=${summary.launchesEvaluated} truth=${fmtPct(summary.truthTierOrbitCoverageRate)} derivedOnly=${fmtPct(summary.derivedOnlyOrbitCoverageRate)} noDirectional=${fmtPct(summary.noDirectionalConstraintRate)} stale=${fmtPct(summary.missingOrStaleProductRate)}`
      );
    } else {
      console.log('Summary: skipped');
    }
    if (failed.length) {
      console.log('Failed checks:');
      for (const row of failed) {
        const value = typeof row.value === 'number' ? fmt(row.value) : String(row.value ?? '—');
        console.log(`- ${row.id}: value=${value} threshold=${row.threshold}`);
      }
    }
    console.log(`Wrote report: ${resolvePath(args.outputPath)}`);
    console.log(`Wrote markdown: ${resolvePath(args.markdownPath)}`);
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  }

  if (!pass && !args.warnOnly) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
