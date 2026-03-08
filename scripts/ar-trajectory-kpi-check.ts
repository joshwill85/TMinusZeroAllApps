import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import type { ReplayBenchmarkReport } from '@/lib/ar/replayBenchmark';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';

config({ path: '.env.local' });
config();

type KpiPolicy = {
  policyVersion: string;
  updatedAt: string;
  telemetry: {
    windowDays: number;
    sampleLimit: number;
    minSampledSessions: number;
    lock: {
      minAttemptRate: number;
      minAcquisitionRate: number;
      minLockLe5Rate: number;
      minAutoModeShare: number;
      maxAvgLossCount: number;
      minStabilityRate: number;
      stabilityMaxLossCount: number;
    };
    fallback: {
      maxFallbackRate: number;
    };
    precision: {
      sigmaGoodThresholdDeg: number;
      minTrajectoryCoverageRate: number;
      minSigmaGoodRate: number;
      minContractTierABRate: number;
    };
    frameBudget: {
      minLowDropRate: number;
      maxHighDropRate: number;
      minHealthyPoseRate: number;
    };
  };
  replay: {
    minCases: number;
    minSamples: number;
    maxOverallP95Deg: number;
    maxOverallDriftDeg: number;
    maxOverallSlopeDegPerMin: number;
    maxCaseP95Deg: number;
    maxCaseDriftDeg: number;
  };
  comparative: {
    baselineReportPath: string;
    maxOverallP95RegressionDeg: number;
    maxOverallAbsDriftRegressionDeg: number;
    maxOverallAbsSlopeRegressionDegPerMin: number;
    maxWorstCaseP95RegressionDeg: number;
    maxWorstCaseAbsDriftRegressionDeg: number;
    maxSkippedCaseIncrease: number;
  };
};

type CliArgs = {
  policyPath: string;
  reportPath: string;
  baselinePath?: string;
  exceptionsPath: string;
  outputPath: string;
  compareOutputPath: string;
  compareMarkdownPath: string;
  skipDb: boolean;
  requireDb: boolean;
  warnOnly: boolean;
  json: boolean;
  quiet: boolean;
};

type CheckStatus = 'pass' | 'fail' | 'skip' | 'exception';

type CheckResult = {
  id: string;
  label: string;
  status: CheckStatus;
  value?: number | string | null;
  threshold?: string;
  details?: string;
};

type KpiExceptionEntry = {
  checkId: string;
  expiresAt: string;
  reason: string;
  ticket: string;
  approvedBy: string;
};

type KpiExceptionFile = {
  policyVersion: string;
  updatedAt: string;
  exceptions: KpiExceptionEntry[];
};

type AppliedException = {
  checkId: string;
  expiresAt: string;
  reason: string;
  ticket: string;
  approvedBy: string;
};

type TelemetrySummary = {
  windowStart: string;
  sampledSessions: number;
  sampleLimit: number;
  truncated: boolean;
  lockAttemptRate: number | null;
  lockAcquisitionRate: number | null;
  lockLe5Rate: number | null;
  autoModeShare: number | null;
  avgLockLossCount: number | null;
  lockStabilityRate: number | null;
  fallbackRate: number | null;
  lowDropRate: number | null;
  highDropRate: number | null;
  healthyPoseRate: number | null;
  trajectoryCoverageRate: number | null;
  sigmaGoodRate: number | null;
  contractTierABRate: number | null;
};

type ComparativeCaseDelta = {
  id: string;
  baselineP95Deg: number;
  currentP95Deg: number;
  p95DeltaDeg: number;
  baselineAbsDriftDeg: number;
  currentAbsDriftDeg: number;
  absDriftDeltaDeg: number;
};

type ComparativeSummary = {
  baselineReportPath: string;
  currentReportPath: string;
  overall: {
    baselineP95Deg: number;
    currentP95Deg: number;
    p95DeltaDeg: number;
    baselineAbsDriftDeg: number;
    currentAbsDriftDeg: number;
    absDriftDeltaDeg: number;
    baselineAbsSlopeDegPerMin: number;
    currentAbsSlopeDegPerMin: number;
    absSlopeDeltaDegPerMin: number;
  } | null;
  worstCase: {
    baselineP95Deg: number;
    currentP95Deg: number;
    p95DeltaDeg: number;
    baselineAbsDriftDeg: number;
    currentAbsDriftDeg: number;
    absDriftDeltaDeg: number;
  } | null;
  skippedCases: {
    baseline: number;
    current: number;
    delta: number;
  };
  perCaseDeltas: ComparativeCaseDelta[];
};

type KpiReport = {
  generatedAt: string;
  policyVersion: string;
  policyPath: string;
  exceptionsPath: string;
  currentReplayReportPath: string;
  baselineReplayReportPath: string;
  pass: boolean;
  checks: CheckResult[];
  exceptionsApplied: AppliedException[];
  replay: {
    sampleCount: number;
    evaluatedCaseCount: number;
    overallP95Deg: number | null;
    overallDriftDeg: number | null;
    overallSlopeDegPerMin: number | null;
    worstCaseP95Deg: number | null;
    worstCaseAbsDriftDeg: number | null;
  };
  telemetry: TelemetrySummary | null;
  comparative: ComparativeSummary | null;
};

type TelemetryRow = {
  started_at: string | null;
  lock_on_attempted: boolean | null;
  lock_on_acquired: boolean | null;
  lock_loss_count: number | null;
  lock_on_mode: string | null;
  time_to_lock_bucket: string | null;
  fallback_reason: string | null;
  mode_entered: string | null;
  dropped_frame_bucket: string | null;
  pose_update_rate_bucket: string | null;
  avg_sigma_deg: number | null;
  contract_tier: string | null;
  trajectory_quality: number | null;
};

function parseNumberArg(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  return {
    policyPath: value('--policy=') || 'docs/specs/ar-trajectory-kpi-policy-v1.json',
    reportPath: value('--report=') || '.artifacts/ar-trajectory-replay-bench.json',
    baselinePath: value('--baseline='),
    exceptionsPath: value('--exceptions=') || 'docs/specs/ar-trajectory-kpi-exceptions-v1.json',
    outputPath: value('--output=') || '.artifacts/ar-trajectory-kpi-eval.json',
    compareOutputPath: value('--compare-output=') || '.artifacts/ar-trajectory-benchmark-compare.json',
    compareMarkdownPath: value('--compare-markdown=') || '.artifacts/ar-trajectory-benchmark-compare.md',
    skipDb: args.includes('--skip-db'),
    requireDb: args.includes('--require-db'),
    warnOnly: args.includes('--warn-only'),
    json: args.includes('--json'),
    quiet: args.includes('--quiet')
  };
}

function resolvePath(pathArg: string) {
  return path.resolve(process.cwd(), pathArg);
}

function readJsonFile<T>(pathArg: string): T {
  const full = resolvePath(pathArg);
  if (!fs.existsSync(full)) throw new Error(`File not found: ${full}`);
  const raw = fs.readFileSync(full, 'utf8');
  return JSON.parse(raw) as T;
}

function readJsonFileIfExists<T>(pathArg: string): T | null {
  const full = resolvePath(pathArg);
  if (!fs.existsSync(full)) return null;
  const raw = fs.readFileSync(full, 'utf8');
  return JSON.parse(raw) as T;
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

function fmt(value: number | null | undefined, digits = 3) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function fmtPct(value: number | null | undefined, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

function safeRate(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function passFailCheck({
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
  value?: number | string | null;
  threshold?: string;
  details?: string;
}): CheckResult {
  return {
    id,
    label,
    status: pass ? 'pass' : 'fail',
    value: value ?? null,
    threshold,
    details
  };
}

function skipCheck(id: string, label: string, details: string): CheckResult {
  return { id, label, status: 'skip', details };
}

function worstCaseP95(report: ReplayBenchmarkReport) {
  if (!Array.isArray(report.cases) || !report.cases.length) return null;
  return report.cases.reduce((max, row) => Math.max(max, row.p95ErrorDeg), Number.NEGATIVE_INFINITY);
}

function worstCaseAbsDrift(report: ReplayBenchmarkReport) {
  if (!Array.isArray(report.cases) || !report.cases.length) return null;
  return report.cases.reduce((max, row) => Math.max(max, Math.abs(row.driftDeg)), Number.NEGATIVE_INFINITY);
}

function buildComparativeSummary(
  current: ReplayBenchmarkReport,
  baseline: ReplayBenchmarkReport,
  currentPath: string,
  baselinePath: string
): ComparativeSummary {
  const currentById = new Map(current.cases.map((row) => [row.id, row]));
  const perCaseDeltas: ComparativeCaseDelta[] = [];

  for (const baseRow of baseline.cases) {
    const currentRow = currentById.get(baseRow.id);
    if (!currentRow) continue;
    const baselineAbsDriftDeg = Math.abs(baseRow.driftDeg);
    const currentAbsDriftDeg = Math.abs(currentRow.driftDeg);
    perCaseDeltas.push({
      id: baseRow.id,
      baselineP95Deg: baseRow.p95ErrorDeg,
      currentP95Deg: currentRow.p95ErrorDeg,
      p95DeltaDeg: currentRow.p95ErrorDeg - baseRow.p95ErrorDeg,
      baselineAbsDriftDeg,
      currentAbsDriftDeg,
      absDriftDeltaDeg: currentAbsDriftDeg - baselineAbsDriftDeg
    });
  }

  const baselineOverall = baseline.overall;
  const currentOverall = current.overall;
  const overall =
    baselineOverall && currentOverall
      ? {
          baselineP95Deg: baselineOverall.p95ErrorDeg,
          currentP95Deg: currentOverall.p95ErrorDeg,
          p95DeltaDeg: currentOverall.p95ErrorDeg - baselineOverall.p95ErrorDeg,
          baselineAbsDriftDeg: Math.abs(baselineOverall.driftDeg),
          currentAbsDriftDeg: Math.abs(currentOverall.driftDeg),
          absDriftDeltaDeg: Math.abs(currentOverall.driftDeg) - Math.abs(baselineOverall.driftDeg),
          baselineAbsSlopeDegPerMin: Math.abs(baselineOverall.slopeDegPerMin),
          currentAbsSlopeDegPerMin: Math.abs(currentOverall.slopeDegPerMin),
          absSlopeDeltaDegPerMin: Math.abs(currentOverall.slopeDegPerMin) - Math.abs(baselineOverall.slopeDegPerMin)
        }
      : null;

  const baselineWorstP95 = worstCaseP95(baseline);
  const currentWorstP95 = worstCaseP95(current);
  const baselineWorstAbsDrift = worstCaseAbsDrift(baseline);
  const currentWorstAbsDrift = worstCaseAbsDrift(current);
  const worstCase =
    baselineWorstP95 != null &&
    currentWorstP95 != null &&
    baselineWorstAbsDrift != null &&
    currentWorstAbsDrift != null
      ? {
          baselineP95Deg: baselineWorstP95,
          currentP95Deg: currentWorstP95,
          p95DeltaDeg: currentWorstP95 - baselineWorstP95,
          baselineAbsDriftDeg: baselineWorstAbsDrift,
          currentAbsDriftDeg: currentWorstAbsDrift,
          absDriftDeltaDeg: currentWorstAbsDrift - baselineWorstAbsDrift
        }
      : null;

  return {
    baselineReportPath: baselinePath,
    currentReportPath: currentPath,
    overall,
    worstCase,
    skippedCases: {
      baseline: baseline.skippedCases.length,
      current: current.skippedCases.length,
      delta: current.skippedCases.length - baseline.skippedCases.length
    },
    perCaseDeltas
  };
}

function buildComparativeMarkdown(summary: ComparativeSummary) {
  const lines: string[] = [];
  lines.push('# AR Trajectory Comparative Benchmark');
  lines.push('');
  lines.push(`- Current: \`${summary.currentReportPath}\``);
  lines.push(`- Baseline: \`${summary.baselineReportPath}\``);
  lines.push('');

  lines.push('## Overall');
  lines.push('');
  lines.push('| Metric | Baseline | Current | Delta |');
  lines.push('|---|---:|---:|---:|');
  if (summary.overall) {
    lines.push(
      `| p95 deg | ${fmt(summary.overall.baselineP95Deg)} | ${fmt(summary.overall.currentP95Deg)} | ${fmt(summary.overall.p95DeltaDeg)} |`
    );
    lines.push(
      `| |drift| deg | ${fmt(summary.overall.baselineAbsDriftDeg)} | ${fmt(summary.overall.currentAbsDriftDeg)} | ${fmt(summary.overall.absDriftDeltaDeg)} |`
    );
    lines.push(
      `| |slope| deg/min | ${fmt(summary.overall.baselineAbsSlopeDegPerMin)} | ${fmt(summary.overall.currentAbsSlopeDegPerMin)} | ${fmt(summary.overall.absSlopeDeltaDegPerMin)} |`
    );
  } else {
    lines.push('| overall | — | — | — |');
  }
  lines.push('');

  lines.push('## Worst Case');
  lines.push('');
  lines.push('| Metric | Baseline | Current | Delta |');
  lines.push('|---|---:|---:|---:|');
  if (summary.worstCase) {
    lines.push(
      `| worst p95 deg | ${fmt(summary.worstCase.baselineP95Deg)} | ${fmt(summary.worstCase.currentP95Deg)} | ${fmt(summary.worstCase.p95DeltaDeg)} |`
    );
    lines.push(
      `| worst |drift| deg | ${fmt(summary.worstCase.baselineAbsDriftDeg)} | ${fmt(summary.worstCase.currentAbsDriftDeg)} | ${fmt(summary.worstCase.absDriftDeltaDeg)} |`
    );
  } else {
    lines.push('| worst case | — | — | — |');
  }
  lines.push('');

  lines.push('## Skipped Cases');
  lines.push('');
  lines.push(`- baseline=${summary.skippedCases.baseline}`);
  lines.push(`- current=${summary.skippedCases.current}`);
  lines.push(`- delta=${summary.skippedCases.delta}`);
  lines.push('');

  lines.push('## Per Case Deltas');
  lines.push('');
  lines.push('| Case | Baseline p95 | Current p95 | Delta p95 | Baseline |drift| | Current |drift| | Delta |drift| |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  if (summary.perCaseDeltas.length === 0) {
    lines.push('| (none) | — | — | — | — | — | — |');
  } else {
    for (const row of summary.perCaseDeltas) {
      lines.push(
        `| ${row.id} | ${fmt(row.baselineP95Deg)} | ${fmt(row.currentP95Deg)} | ${fmt(row.p95DeltaDeg)} | ${fmt(row.baselineAbsDriftDeg)} | ${fmt(row.currentAbsDriftDeg)} | ${fmt(row.absDriftDeltaDeg)} |`
      );
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function evaluateReplayChecks(report: ReplayBenchmarkReport, policy: KpiPolicy['replay']) {
  const checks: CheckResult[] = [];
  checks.push(
    passFailCheck({
      id: 'replay.min_samples',
      label: 'Replay sample count',
      pass: report.sampleCount >= policy.minSamples,
      value: report.sampleCount,
      threshold: `>= ${policy.minSamples}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'replay.min_cases',
      label: 'Replay evaluated case count',
      pass: report.evaluatedCaseCount >= policy.minCases,
      value: report.evaluatedCaseCount,
      threshold: `>= ${policy.minCases}`
    })
  );

  if (!report.overall) {
    checks.push(
      passFailCheck({
        id: 'replay.overall.present',
        label: 'Replay overall summary present',
        pass: false,
        details: 'Missing overall summary in replay report.'
      })
    );
    return checks;
  }

  checks.push(
    passFailCheck({
      id: 'replay.overall_p95',
      label: 'Replay overall p95',
      pass: report.overall.p95ErrorDeg <= policy.maxOverallP95Deg,
      value: report.overall.p95ErrorDeg,
      threshold: `<= ${policy.maxOverallP95Deg}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'replay.overall_abs_drift',
      label: 'Replay overall |drift|',
      pass: Math.abs(report.overall.driftDeg) <= policy.maxOverallDriftDeg,
      value: Math.abs(report.overall.driftDeg),
      threshold: `<= ${policy.maxOverallDriftDeg}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'replay.overall_abs_slope',
      label: 'Replay overall |slope|',
      pass: Math.abs(report.overall.slopeDegPerMin) <= policy.maxOverallSlopeDegPerMin,
      value: Math.abs(report.overall.slopeDegPerMin),
      threshold: `<= ${policy.maxOverallSlopeDegPerMin}`
    })
  );

  const worstP95 = worstCaseP95(report);
  const worstAbsDrift = worstCaseAbsDrift(report);
  if (worstP95 != null) {
    checks.push(
      passFailCheck({
        id: 'replay.case_worst_p95',
        label: 'Replay worst-case p95',
        pass: worstP95 <= policy.maxCaseP95Deg,
        value: worstP95,
        threshold: `<= ${policy.maxCaseP95Deg}`
      })
    );
  }
  if (worstAbsDrift != null) {
    checks.push(
      passFailCheck({
        id: 'replay.case_worst_abs_drift',
        label: 'Replay worst-case |drift|',
        pass: worstAbsDrift <= policy.maxCaseDriftDeg,
        value: worstAbsDrift,
        threshold: `<= ${policy.maxCaseDriftDeg}`
      })
    );
  }

  return checks;
}

function evaluateComparativeChecks(summary: ComparativeSummary, policy: KpiPolicy['comparative']) {
  const checks: CheckResult[] = [];
  if (!summary.overall || !summary.worstCase) {
    checks.push(
      passFailCheck({
        id: 'comparative.summary_present',
        label: 'Comparative overall/worst summary present',
        pass: false,
        details: 'Missing comparable baseline/current overall metrics.'
      })
    );
    return checks;
  }

  checks.push(
    passFailCheck({
      id: 'comparative.overall_p95_regression',
      label: 'Comparative overall p95 regression',
      pass: summary.overall.p95DeltaDeg <= policy.maxOverallP95RegressionDeg,
      value: summary.overall.p95DeltaDeg,
      threshold: `<= ${policy.maxOverallP95RegressionDeg}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'comparative.overall_abs_drift_regression',
      label: 'Comparative overall |drift| regression',
      pass: summary.overall.absDriftDeltaDeg <= policy.maxOverallAbsDriftRegressionDeg,
      value: summary.overall.absDriftDeltaDeg,
      threshold: `<= ${policy.maxOverallAbsDriftRegressionDeg}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'comparative.overall_abs_slope_regression',
      label: 'Comparative overall |slope| regression',
      pass: summary.overall.absSlopeDeltaDegPerMin <= policy.maxOverallAbsSlopeRegressionDegPerMin,
      value: summary.overall.absSlopeDeltaDegPerMin,
      threshold: `<= ${policy.maxOverallAbsSlopeRegressionDegPerMin}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'comparative.worst_case_p95_regression',
      label: 'Comparative worst-case p95 regression',
      pass: summary.worstCase.p95DeltaDeg <= policy.maxWorstCaseP95RegressionDeg,
      value: summary.worstCase.p95DeltaDeg,
      threshold: `<= ${policy.maxWorstCaseP95RegressionDeg}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'comparative.worst_case_abs_drift_regression',
      label: 'Comparative worst-case |drift| regression',
      pass: summary.worstCase.absDriftDeltaDeg <= policy.maxWorstCaseAbsDriftRegressionDeg,
      value: summary.worstCase.absDriftDeltaDeg,
      threshold: `<= ${policy.maxWorstCaseAbsDriftRegressionDeg}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'comparative.skipped_case_increase',
      label: 'Comparative skipped case increase',
      pass: summary.skippedCases.delta <= policy.maxSkippedCaseIncrease,
      value: summary.skippedCases.delta,
      threshold: `<= ${policy.maxSkippedCaseIncrease}`
    })
  );

  return checks;
}

async function loadTelemetrySummary(policy: KpiPolicy['telemetry']) {
  const windowStart = new Date(Date.now() - policy.windowDays * 24 * 60 * 60 * 1000).toISOString();
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('ar_camera_guide_sessions')
    .select('*')
    .gte('started_at', windowStart)
    .order('started_at', { ascending: false })
    .limit(policy.sampleLimit);

  if (error) throw new Error(`Failed to load ar_camera_guide_sessions: ${error.message}`);

  const rows = (Array.isArray(data) ? data : []) as TelemetryRow[];
  const sampledSessions = rows.length;

  let lockAttempted = 0;
  let lockAcquired = 0;
  let autoMode = 0;
  let manualMode = 0;
  let lockLe5 = 0;
  let lockLossSum = 0;
  let lockLossCount = 0;
  let stableLocks = 0;
  let fallbackSessions = 0;
  let lowDrop = 0;
  let highDrop = 0;
  let healthyPose = 0;
  let trajectorySessions = 0;
  let sigmaReported = 0;
  let sigmaGood = 0;
  let contractTierAB = 0;

  for (const row of rows) {
    const lockAttemptedRow = row.lock_on_attempted === true;
    if (lockAttemptedRow) {
      lockAttempted += 1;
      if (row.lock_on_acquired === true) lockAcquired += 1;
      if (row.time_to_lock_bucket === '<2s' || row.time_to_lock_bucket === '2..5s') lockLe5 += 1;
    }
    if (row.lock_on_mode === 'auto') autoMode += 1;
    if (row.lock_on_mode === 'manual_debug') manualMode += 1;

    if (lockAttemptedRow && row.lock_on_acquired === true && typeof row.lock_loss_count === 'number' && Number.isFinite(row.lock_loss_count)) {
      lockLossSum += row.lock_loss_count;
      lockLossCount += 1;
      if (row.lock_loss_count <= policy.lock.stabilityMaxLossCount) stableLocks += 1;
    }

    if (typeof row.fallback_reason === 'string' || row.mode_entered === 'sky_compass') fallbackSessions += 1;

    if (row.dropped_frame_bucket === '0..1' || row.dropped_frame_bucket === '1..5') lowDrop += 1;
    if (row.dropped_frame_bucket === '15..30' || row.dropped_frame_bucket === '30+') highDrop += 1;
    if (
      row.pose_update_rate_bucket === '15..30' ||
      row.pose_update_rate_bucket === '30..60' ||
      row.pose_update_rate_bucket === '60+'
    ) {
      healthyPose += 1;
    }

    if (typeof row.trajectory_quality === 'number' && Number.isFinite(row.trajectory_quality) && row.trajectory_quality >= 1) {
      trajectorySessions += 1;
      const tier = typeof row.contract_tier === 'string' ? row.contract_tier.toUpperCase() : '';
      if (tier === 'A' || tier === 'B') contractTierAB += 1;
    }

    if (typeof row.avg_sigma_deg === 'number' && Number.isFinite(row.avg_sigma_deg)) {
      sigmaReported += 1;
      if (row.avg_sigma_deg <= policy.precision.sigmaGoodThresholdDeg) sigmaGood += 1;
    }
  }

  const autoShareDenominator = autoMode + manualMode;
  return {
    windowStart,
    sampledSessions,
    sampleLimit: policy.sampleLimit,
    truncated: sampledSessions >= policy.sampleLimit,
    lockAttemptRate: safeRate(lockAttempted, sampledSessions),
    lockAcquisitionRate: safeRate(lockAcquired, lockAttempted),
    lockLe5Rate: safeRate(lockLe5, lockAttempted),
    autoModeShare: safeRate(autoMode, autoShareDenominator),
    avgLockLossCount: lockLossCount > 0 ? lockLossSum / lockLossCount : null,
    lockStabilityRate: safeRate(stableLocks, lockLossCount),
    fallbackRate: safeRate(fallbackSessions, sampledSessions),
    lowDropRate: safeRate(lowDrop, sampledSessions),
    highDropRate: safeRate(highDrop, sampledSessions),
    healthyPoseRate: safeRate(healthyPose, sampledSessions),
    trajectoryCoverageRate: safeRate(trajectorySessions, sampledSessions),
    sigmaGoodRate: safeRate(sigmaGood, sigmaReported),
    contractTierABRate: safeRate(contractTierAB, trajectorySessions)
  } satisfies TelemetrySummary;
}

function evaluateTelemetryChecks(summary: TelemetrySummary, policy: KpiPolicy['telemetry']) {
  const checks: CheckResult[] = [];
  checks.push(
    passFailCheck({
      id: 'telemetry.min_sampled_sessions',
      label: 'Telemetry sampled sessions',
      pass: summary.sampledSessions >= policy.minSampledSessions,
      value: summary.sampledSessions,
      threshold: `>= ${policy.minSampledSessions}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'telemetry.lock_attempt_rate',
      label: 'Telemetry lock attempt rate',
      pass: (summary.lockAttemptRate ?? -1) >= policy.lock.minAttemptRate,
      value: summary.lockAttemptRate,
      threshold: `>= ${policy.lock.minAttemptRate}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'telemetry.lock_acquisition_rate',
      label: 'Telemetry lock acquisition rate',
      pass: (summary.lockAcquisitionRate ?? -1) >= policy.lock.minAcquisitionRate,
      value: summary.lockAcquisitionRate,
      threshold: `>= ${policy.lock.minAcquisitionRate}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'telemetry.lock_le5_rate',
      label: 'Telemetry lock <=5s rate',
      pass: (summary.lockLe5Rate ?? -1) >= policy.lock.minLockLe5Rate,
      value: summary.lockLe5Rate,
      threshold: `>= ${policy.lock.minLockLe5Rate}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'telemetry.lock_auto_mode_share',
      label: 'Telemetry auto lock-on share',
      pass: (summary.autoModeShare ?? -1) >= policy.lock.minAutoModeShare,
      value: summary.autoModeShare,
      threshold: `>= ${policy.lock.minAutoModeShare}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'telemetry.lock_avg_loss_count',
      label: 'Telemetry avg lock loss count',
      pass: summary.avgLockLossCount != null && summary.avgLockLossCount <= policy.lock.maxAvgLossCount,
      value: summary.avgLockLossCount,
      threshold: `<= ${policy.lock.maxAvgLossCount}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'telemetry.lock_stability_rate',
      label: 'Telemetry lock stability rate',
      pass: (summary.lockStabilityRate ?? -1) >= policy.lock.minStabilityRate,
      value: summary.lockStabilityRate,
      threshold: `>= ${policy.lock.minStabilityRate}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'telemetry.fallback_rate',
      label: 'Telemetry fallback rate',
      pass: summary.fallbackRate != null && summary.fallbackRate <= policy.fallback.maxFallbackRate,
      value: summary.fallbackRate,
      threshold: `<= ${policy.fallback.maxFallbackRate}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'telemetry.frame_budget_low_drop_rate',
      label: 'Telemetry low-drop frame rate',
      pass: (summary.lowDropRate ?? -1) >= policy.frameBudget.minLowDropRate,
      value: summary.lowDropRate,
      threshold: `>= ${policy.frameBudget.minLowDropRate}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'telemetry.frame_budget_high_drop_rate',
      label: 'Telemetry high-drop frame rate',
      pass: summary.highDropRate != null && summary.highDropRate <= policy.frameBudget.maxHighDropRate,
      value: summary.highDropRate,
      threshold: `<= ${policy.frameBudget.maxHighDropRate}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'telemetry.frame_budget_healthy_pose_rate',
      label: 'Telemetry healthy pose update rate',
      pass: (summary.healthyPoseRate ?? -1) >= policy.frameBudget.minHealthyPoseRate,
      value: summary.healthyPoseRate,
      threshold: `>= ${policy.frameBudget.minHealthyPoseRate}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'telemetry.precision_trajectory_coverage_rate',
      label: 'Telemetry trajectory coverage rate',
      pass: (summary.trajectoryCoverageRate ?? -1) >= policy.precision.minTrajectoryCoverageRate,
      value: summary.trajectoryCoverageRate,
      threshold: `>= ${policy.precision.minTrajectoryCoverageRate}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'telemetry.precision_sigma_good_rate',
      label: `Telemetry sigma<=${policy.precision.sigmaGoodThresholdDeg.toFixed(1)} good rate`,
      pass: (summary.sigmaGoodRate ?? -1) >= policy.precision.minSigmaGoodRate,
      value: summary.sigmaGoodRate,
      threshold: `>= ${policy.precision.minSigmaGoodRate}`
    })
  );
  checks.push(
    passFailCheck({
      id: 'telemetry.precision_contract_tier_ab_rate',
      label: 'Telemetry contract tier A/B rate',
      pass: (summary.contractTierABRate ?? -1) >= policy.precision.minContractTierABRate,
      value: summary.contractTierABRate,
      threshold: `>= ${policy.precision.minContractTierABRate}`
    })
  );
  return checks;
}

function validateExceptionsFile({
  policyVersion,
  pathArg,
  raw
}: {
  policyVersion: string;
  pathArg: string;
  raw: KpiExceptionFile | null;
}) {
  const checks: CheckResult[] = [];
  if (!raw) {
    checks.push(skipCheck('exceptions.file_present', 'KPI exception file present', `No file found at ${pathArg}; no overrides applied.`));
    return {
      checks,
      activeByCheckId: new Map<string, KpiExceptionEntry>()
    };
  }

  if (raw.policyVersion !== policyVersion) {
    checks.push(
      passFailCheck({
        id: 'exceptions.policy_version_match',
        label: 'KPI exception policy version matches KPI policy',
        pass: false,
        value: raw.policyVersion,
        threshold: `== ${policyVersion}`
      })
    );
  } else {
    checks.push(
      passFailCheck({
        id: 'exceptions.policy_version_match',
        label: 'KPI exception policy version matches KPI policy',
        pass: true,
        value: raw.policyVersion,
        threshold: `== ${policyVersion}`
      })
    );
  }

  const rows = Array.isArray(raw.exceptions) ? raw.exceptions : [];
  const now = Date.now();
  const invalidRows: number[] = [];
  const expiredRows: number[] = [];
  const activeByCheckId = new Map<string, KpiExceptionEntry>();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const hasFields =
      typeof row?.checkId === 'string' &&
      row.checkId.length > 0 &&
      typeof row.expiresAt === 'string' &&
      row.expiresAt.length > 0 &&
      typeof row.reason === 'string' &&
      row.reason.length > 0 &&
      typeof row.ticket === 'string' &&
      row.ticket.length > 0 &&
      typeof row.approvedBy === 'string' &&
      row.approvedBy.length > 0;
    if (!hasFields) {
      invalidRows.push(index);
      continue;
    }
    const expiresAtTs = Date.parse(row.expiresAt);
    if (!Number.isFinite(expiresAtTs)) {
      invalidRows.push(index);
      continue;
    }
    if (expiresAtTs < now) {
      expiredRows.push(index);
      continue;
    }
    activeByCheckId.set(row.checkId, row);
  }

  checks.push(
    passFailCheck({
      id: 'exceptions.rows_valid',
      label: 'KPI exception rows valid',
      pass: invalidRows.length === 0,
      value: rows.length - invalidRows.length,
      threshold: `all ${rows.length} valid`,
      details: invalidRows.length ? `Invalid rows at index: ${invalidRows.join(', ')}` : undefined
    })
  );
  checks.push(
    passFailCheck({
      id: 'exceptions.none_expired',
      label: 'KPI exception rows not expired',
      pass: expiredRows.length === 0,
      value: rows.length - expiredRows.length,
      threshold: `all ${rows.length} active`,
      details: expiredRows.length ? `Expired rows at index: ${expiredRows.join(', ')}` : undefined
    })
  );

  return {
    checks,
    activeByCheckId
  };
}

function applyKpiExceptions({
  checks,
  activeByCheckId
}: {
  checks: CheckResult[];
  activeByCheckId: Map<string, KpiExceptionEntry>;
}) {
  const applied: AppliedException[] = [];
  const next = checks.map((check) => {
    if (check.status !== 'fail') return check;
    if (check.id.startsWith('exceptions.')) return check;
    const exception = activeByCheckId.get(check.id);
    if (!exception) return check;
    applied.push({
      checkId: exception.checkId,
      expiresAt: exception.expiresAt,
      reason: exception.reason,
      ticket: exception.ticket,
      approvedBy: exception.approvedBy
    });
    const details = [check.details, `Exception ${exception.ticket} approved by ${exception.approvedBy} until ${exception.expiresAt}: ${exception.reason}`]
      .filter((value) => Boolean(value))
      .join(' ');
    return {
      ...check,
      status: 'exception' as const,
      details
    };
  });
  return { checks: next, applied };
}

function summarizeReplay(report: ReplayBenchmarkReport) {
  return {
    sampleCount: report.sampleCount,
    evaluatedCaseCount: report.evaluatedCaseCount,
    overallP95Deg: report.overall?.p95ErrorDeg ?? null,
    overallDriftDeg: report.overall?.driftDeg ?? null,
    overallSlopeDegPerMin: report.overall?.slopeDegPerMin ?? null,
    worstCaseP95Deg: worstCaseP95(report),
    worstCaseAbsDriftDeg: worstCaseAbsDrift(report)
  };
}

function printSummary(report: KpiReport, warnOnly: boolean) {
  const failed = report.checks.filter((check) => check.status === 'fail');
  const skipped = report.checks.filter((check) => check.status === 'skip');
  const exceptions = report.checks.filter((check) => check.status === 'exception');

  console.log('AR trajectory KPI policy check');
  console.log(`Policy: ${report.policyVersion}`);
  console.log(`Replay report: ${report.currentReplayReportPath}`);
  console.log(`Baseline report: ${report.baselineReplayReportPath}`);
  console.log(`Exceptions file: ${report.exceptionsPath}`);
  console.log(`Result: ${report.pass ? 'PASS' : warnOnly ? 'WARN' : 'FAIL'}`);
  console.log(
    `Checks: pass=${report.checks.filter((check) => check.status === 'pass').length} fail=${failed.length} exception=${exceptions.length} skip=${skipped.length}`
  );
  console.log(
    `Replay: samples=${report.replay.sampleCount} cases=${report.replay.evaluatedCaseCount} p95=${fmt(report.replay.overallP95Deg)} drift=${fmt(report.replay.overallDriftDeg)} slope=${fmt(report.replay.overallSlopeDegPerMin)}`
  );
  if (report.telemetry) {
    console.log(
      `Telemetry: sessions=${report.telemetry.sampledSessions} lock=${fmtPct(report.telemetry.lockAcquisitionRate)} lock<=5=${fmtPct(report.telemetry.lockLe5Rate)} fallback=${fmtPct(report.telemetry.fallbackRate)} traj=${fmtPct(report.telemetry.trajectoryCoverageRate)} sigma=${fmtPct(report.telemetry.sigmaGoodRate)}`
    );
  } else {
    console.log('Telemetry: skipped');
  }
  if (report.exceptionsApplied.length) {
    console.log('Applied exceptions:');
    for (const row of report.exceptionsApplied) {
      console.log(`- ${row.checkId} (${row.ticket}) expires=${row.expiresAt} approvedBy=${row.approvedBy}`);
    }
  }
  if (failed.length) {
    console.log('Failed checks:');
    for (const row of failed) {
      const value = row.value == null ? '' : ` value=${typeof row.value === 'number' ? fmt(row.value) : String(row.value)}`;
      const threshold = row.threshold ? ` threshold=${row.threshold}` : '';
      const details = row.details ? ` details=${row.details}` : '';
      console.log(`- ${row.id}:${value}${threshold}${details}`.trim());
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);

  const policy = readJsonFile<KpiPolicy>(args.policyPath);
  const rawExceptions = readJsonFileIfExists<KpiExceptionFile>(args.exceptionsPath);
  const exceptionValidation = validateExceptionsFile({
    policyVersion: policy.policyVersion,
    pathArg: args.exceptionsPath,
    raw: rawExceptions
  });
  const currentReport = readJsonFile<ReplayBenchmarkReport>(args.reportPath);

  const baselinePath = args.baselinePath || policy.comparative.baselineReportPath;
  const baselineReport = readJsonFile<ReplayBenchmarkReport>(baselinePath);

  const comparativeSummary = buildComparativeSummary(currentReport, baselineReport, args.reportPath, baselinePath);
  const comparativeMarkdown = buildComparativeMarkdown(comparativeSummary);

  const checks: CheckResult[] = [];
  checks.push(...exceptionValidation.checks);
  checks.push(...evaluateReplayChecks(currentReport, policy.replay));
  checks.push(...evaluateComparativeChecks(comparativeSummary, policy.comparative));

  let telemetrySummary: TelemetrySummary | null = null;
  if (args.skipDb) {
    checks.push(skipCheck('telemetry.window', 'Telemetry checks', 'Skipped by --skip-db.'));
  } else if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    if (args.requireDb) {
      checks.push(
        passFailCheck({
          id: 'telemetry.env_configured',
          label: 'Supabase env configured for telemetry checks',
          pass: false,
          details: 'Supabase env not configured but --require-db was set.'
        })
      );
    } else {
      checks.push(skipCheck('telemetry.env_configured', 'Telemetry checks', 'Supabase env not configured; skipped.'));
    }
  } else {
    telemetrySummary = await loadTelemetrySummary(policy.telemetry);
    checks.push(...evaluateTelemetryChecks(telemetrySummary, policy.telemetry));
  }

  const exceptionApplied = applyKpiExceptions({
    checks,
    activeByCheckId: exceptionValidation.activeByCheckId
  });
  const checksWithExceptions = exceptionApplied.checks;
  const pass = checksWithExceptions.every((check) => check.status !== 'fail');
  const report: KpiReport = {
    generatedAt: new Date().toISOString(),
    policyVersion: policy.policyVersion,
    policyPath: args.policyPath,
    exceptionsPath: args.exceptionsPath,
    currentReplayReportPath: args.reportPath,
    baselineReplayReportPath: baselinePath,
    pass,
    checks: checksWithExceptions,
    exceptionsApplied: exceptionApplied.applied,
    replay: summarizeReplay(currentReport),
    telemetry: telemetrySummary,
    comparative: comparativeSummary
  };

  writeJson(args.outputPath, report);
  writeJson(args.compareOutputPath, comparativeSummary);
  writeText(args.compareMarkdownPath, comparativeMarkdown);

  if (!args.quiet && !args.json) {
    printSummary(report, args.warnOnly);
    console.log(`Wrote KPI report: ${resolvePath(args.outputPath)}`);
    console.log(`Wrote comparative report (json): ${resolvePath(args.compareOutputPath)}`);
    console.log(`Wrote comparative report (md): ${resolvePath(args.compareMarkdownPath)}`);
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
