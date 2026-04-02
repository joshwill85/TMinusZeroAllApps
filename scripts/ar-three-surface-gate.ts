import fs from 'node:fs';
import path from 'node:path';
import {
  evaluateFamilyMatrix,
  type FamilyMatrixFixture,
  type FamilyMatrixPolicy
} from '@/lib/ar/familyMatrix';
import type { SurfaceEvidenceManifest } from '@/lib/ar/surfaceEvidence';
import { runReplayBenchmark, type ReplayBenchmarkFixture, type ReplayBenchmarkReport } from '@/lib/ar/replayBenchmark';

type KpiPolicy = {
  replay: {
    minCases: number;
    minSamples: number;
    maxOverallP95Deg: number;
    maxOverallDriftDeg: number;
    maxOverallSlopeDegPerMin: number;
    maxCaseP95Deg: number;
    maxCaseDriftDeg: number;
  };
};

type FamilyReplayPolicy = {
  policyVersion: string;
  updatedAt: string;
  maxSkippedCases: number;
  requiredCases: Array<{
    id: string;
    label: string;
    minSamples: number;
    maxP95Deg: number;
    maxAbsDriftDeg: number;
  }>;
};

type ThreeSurfacePolicy = {
  familyMatrix: FamilyMatrixPolicy;
  surfaceEvidence: {
    requiredWebProfiles: string[];
    requiredIosProfiles: string[];
    requiredAndroidProfiles: string[];
    maxTimeToUsableSeconds: number;
    maxRelocalizationCount: number;
    maxTrackingResetCount: number;
  };
};

type GateCheck = {
  id: string;
  status: 'pass' | 'fail' | 'skipped';
  details: string;
};

type GateReport = {
  generatedAt: string;
  pass: boolean;
  warnOnly: boolean;
  replay: {
    pass: boolean;
    failures: string[];
  };
  familyReplay: {
    pass: boolean;
    failures: string[];
  };
  familyMatrix: {
    pass: boolean;
    failureCount: number;
  };
  surfaceEvidence: {
    evaluated: boolean;
    pass: boolean;
    failures: string[];
  };
  checks: GateCheck[];
};

type CliArgs = {
  replayFixturePath: string;
  familyMatrixFixturePath: string;
  threeSurfacePolicyPath: string;
  kpiPolicyPath: string;
  familyReplayPolicyPath: string;
  surfaceEvidencePath?: string;
  requireSurfaceEvidence: boolean;
  outputPath: string;
  markdownPath: string;
  warnOnly: boolean;
  json: boolean;
  quiet: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  return {
    replayFixturePath: value('--replay-fixture=') || 'scripts/fixtures/ar-trajectory-replay-fixture.json',
    familyMatrixFixturePath: value('--family-fixture=') || 'scripts/fixtures/ar-trajectory-family-matrix-fixture.json',
    threeSurfacePolicyPath: value('--policy=') || 'docs/specs/ar-trajectory-three-surface-policy-v1.json',
    kpiPolicyPath: value('--kpi-policy=') || 'docs/specs/ar-trajectory-kpi-policy-v1.json',
    familyReplayPolicyPath: value('--family-replay-policy=') || 'docs/specs/ar-trajectory-family-replay-policy-v1.json',
    surfaceEvidencePath: value('--surface-evidence='),
    requireSurfaceEvidence: args.includes('--require-surface-evidence'),
    outputPath: value('--output=') || '.artifacts/ar-three-surface-gate.json',
    markdownPath: value('--markdown=') || '.artifacts/ar-three-surface-gate.md',
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

function fmt(value: number) {
  return Number.isFinite(value) ? value.toFixed(3) : String(value);
}

function evaluateReplay(report: ReplayBenchmarkReport, policy: KpiPolicy['replay']) {
  const failures: string[] = [];
  const overall = report.overall;
  if (report.sampleCount < policy.minSamples) failures.push(`sampleCount ${report.sampleCount} < ${policy.minSamples}`);
  if (report.evaluatedCaseCount < policy.minCases) failures.push(`evaluatedCaseCount ${report.evaluatedCaseCount} < ${policy.minCases}`);
  if (!overall) {
    failures.push('overall summary missing');
    return failures;
  }
  if (overall.p95ErrorDeg > policy.maxOverallP95Deg) {
    failures.push(`overall p95 ${fmt(overall.p95ErrorDeg)}deg > ${fmt(policy.maxOverallP95Deg)}deg`);
  }
  if (Math.abs(overall.driftDeg) > policy.maxOverallDriftDeg) {
    failures.push(`overall |drift| ${fmt(Math.abs(overall.driftDeg))}deg > ${fmt(policy.maxOverallDriftDeg)}deg`);
  }
  if (Math.abs(overall.slopeDegPerMin) > policy.maxOverallSlopeDegPerMin) {
    failures.push(`overall |slope| ${fmt(Math.abs(overall.slopeDegPerMin))}deg/min > ${fmt(policy.maxOverallSlopeDegPerMin)}deg/min`);
  }
  for (const row of report.cases) {
    if (row.p95ErrorDeg > policy.maxCaseP95Deg) {
      failures.push(`case ${row.id} p95 ${fmt(row.p95ErrorDeg)}deg > ${fmt(policy.maxCaseP95Deg)}deg`);
    }
    if (Math.abs(row.driftDeg) > policy.maxCaseDriftDeg) {
      failures.push(`case ${row.id} |drift| ${fmt(Math.abs(row.driftDeg))}deg > ${fmt(policy.maxCaseDriftDeg)}deg`);
    }
  }
  return failures;
}

function evaluateFamilyReplay(report: ReplayBenchmarkReport, policy: FamilyReplayPolicy) {
  const failures: string[] = [];
  if (report.skippedCases.length > policy.maxSkippedCases) {
    failures.push(`skippedCases ${report.skippedCases.length} > ${policy.maxSkippedCases}`);
  }
  const byId = new Map(report.cases.map((row) => [row.id, row]));
  for (const required of policy.requiredCases) {
    const row = byId.get(required.id);
    if (!row) {
      failures.push(`missing required case ${required.id}`);
      continue;
    }
    if (row.sampleCount < required.minSamples) failures.push(`case ${required.id} samples ${row.sampleCount} < ${required.minSamples}`);
    if (row.p95ErrorDeg > required.maxP95Deg) failures.push(`case ${required.id} p95 ${fmt(row.p95ErrorDeg)}deg > ${fmt(required.maxP95Deg)}deg`);
    if (Math.abs(row.driftDeg) > required.maxAbsDriftDeg) {
      failures.push(`case ${required.id} |drift| ${fmt(Math.abs(row.driftDeg))}deg > ${fmt(required.maxAbsDriftDeg)}deg`);
    }
  }
  return failures;
}

function evaluateSurfaceEvidence(manifest: SurfaceEvidenceManifest, policy: ThreeSurfacePolicy) {
  const failures: string[] = [];
  const byProfile = new Map(manifest.runs.map((run) => [run.profile, run]));
  const requiredProfiles = [
    ...policy.surfaceEvidence.requiredWebProfiles,
    ...policy.surfaceEvidence.requiredIosProfiles,
    ...policy.surfaceEvidence.requiredAndroidProfiles
  ];

  for (const profile of requiredProfiles) {
    const run = byProfile.get(profile);
    if (!run) {
      failures.push(`missing surface evidence profile ${profile}`);
      continue;
    }
    if (run.status === 'fail') failures.push(`surface evidence profile ${profile} failed`);
    if (typeof run.timeToUsableSeconds === 'number' && run.timeToUsableSeconds > policy.surfaceEvidence.maxTimeToUsableSeconds) {
      failures.push(`surface evidence profile ${profile} timeToUsable ${run.timeToUsableSeconds}s > ${policy.surfaceEvidence.maxTimeToUsableSeconds}s`);
    }
    if (run.canClaimPrecision === true && run.precisionClaimAllowed !== true) {
      failures.push(`surface evidence profile ${profile} claims precision without runtime approval`);
    }
    if (run.surface === 'ios' && typeof run.relocalizationCount === 'number' && run.relocalizationCount > policy.surfaceEvidence.maxRelocalizationCount) {
      failures.push(`surface evidence profile ${profile} relocalizationCount ${run.relocalizationCount} > ${policy.surfaceEvidence.maxRelocalizationCount}`);
    }
    if (run.surface === 'android' && typeof run.trackingResetCount === 'number' && run.trackingResetCount > policy.surfaceEvidence.maxTrackingResetCount) {
      failures.push(`surface evidence profile ${profile} trackingResetCount ${run.trackingResetCount} > ${policy.surfaceEvidence.maxTrackingResetCount}`);
    }
  }

  for (const comparison of manifest.comparisons ?? []) {
    if (comparison.degraded === true) continue;
    if (comparison.divergenceDeg > policy.familyMatrix.maxCrossSurfaceDivergenceDeg) {
      failures.push(
        `cross-surface divergence ${comparison.fixtureId}/${comparison.observerId}/T${comparison.tPlusSec} ${comparison.divergenceDeg}deg > ${policy.familyMatrix.maxCrossSurfaceDivergenceDeg}deg`
      );
    }
  }

  return failures;
}

function buildMarkdown(report: GateReport) {
  const lines: string[] = [];
  lines.push('# AR Three-Surface Gate');
  lines.push('');
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- result: ${report.pass ? 'PASS' : report.warnOnly ? 'WARN' : 'FAIL'}`);
  lines.push(`- warnOnly: ${report.warnOnly ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('| Component | Result | Details |');
  lines.push('|---|---|---|');
  lines.push(`| Replay | ${report.replay.pass ? 'PASS' : 'FAIL'} | ${report.replay.failures.length ? report.replay.failures.join('; ') : 'ok'} |`);
  lines.push(
    `| Family replay | ${report.familyReplay.pass ? 'PASS' : 'FAIL'} | ${report.familyReplay.failures.length ? report.familyReplay.failures.join('; ') : 'ok'} |`
  );
  lines.push(`| Family matrix | ${report.familyMatrix.pass ? 'PASS' : 'FAIL'} | failures=${report.familyMatrix.failureCount} |`);
  lines.push(
    `| Surface evidence | ${
      report.surfaceEvidence.evaluated ? (report.surfaceEvidence.pass ? 'PASS' : 'FAIL') : 'SKIPPED'
    } | ${report.surfaceEvidence.failures.length ? report.surfaceEvidence.failures.join('; ') : report.surfaceEvidence.evaluated ? 'ok' : 'not provided'} |`
  );
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  const replayFixture = readJsonFile<ReplayBenchmarkFixture>(args.replayFixturePath);
  const familyFixture = readJsonFile<FamilyMatrixFixture>(args.familyMatrixFixturePath);
  const threeSurfacePolicy = readJsonFile<ThreeSurfacePolicy>(args.threeSurfacePolicyPath);
  const kpiPolicy = readJsonFile<KpiPolicy>(args.kpiPolicyPath);
  const familyReplayPolicy = readJsonFile<FamilyReplayPolicy>(args.familyReplayPolicyPath);

  const replayReport = runReplayBenchmark(replayFixture);
  const replayFailures = evaluateReplay(replayReport, kpiPolicy.replay);
  const familyReplayFailures = evaluateFamilyReplay(replayReport, familyReplayPolicy);
  const familyMatrixReport = evaluateFamilyMatrix(familyFixture, threeSurfacePolicy.familyMatrix);
  const familyMatrixFailureCount = familyMatrixReport.checks.filter((row) => row.status === 'fail').length;

  let surfaceEvidenceEvaluated = false;
  let surfaceEvidenceFailures: string[] = [];
  if (args.surfaceEvidencePath) {
    const manifest = readJsonFile<SurfaceEvidenceManifest>(args.surfaceEvidencePath);
    surfaceEvidenceEvaluated = true;
    surfaceEvidenceFailures = evaluateSurfaceEvidence(manifest, threeSurfacePolicy);
  } else if (args.requireSurfaceEvidence) {
    surfaceEvidenceEvaluated = true;
    surfaceEvidenceFailures = ['surface evidence manifest required but not provided'];
  }

  const report: GateReport = {
    generatedAt: new Date().toISOString(),
    pass:
      replayFailures.length === 0 &&
      familyReplayFailures.length === 0 &&
      familyMatrixFailureCount === 0 &&
      surfaceEvidenceFailures.length === 0,
    warnOnly: args.warnOnly,
    replay: { pass: replayFailures.length === 0, failures: replayFailures },
    familyReplay: { pass: familyReplayFailures.length === 0, failures: familyReplayFailures },
    familyMatrix: { pass: familyMatrixFailureCount === 0, failureCount: familyMatrixFailureCount },
    surfaceEvidence: {
      evaluated: surfaceEvidenceEvaluated,
      pass: surfaceEvidenceFailures.length === 0,
      failures: surfaceEvidenceFailures
    },
    checks: [
      {
        id: 'replay',
        status: replayFailures.length === 0 ? 'pass' : 'fail',
        details: replayFailures.length === 0 ? 'Replay gate passed.' : replayFailures.join('; ')
      },
      {
        id: 'family_replay',
        status: familyReplayFailures.length === 0 ? 'pass' : 'fail',
        details: familyReplayFailures.length === 0 ? 'Family replay gate passed.' : familyReplayFailures.join('; ')
      },
      {
        id: 'family_matrix',
        status: familyMatrixFailureCount === 0 ? 'pass' : 'fail',
        details:
          familyMatrixFailureCount === 0
            ? 'Family matrix gate passed.'
            : `${familyMatrixFailureCount} family matrix checks failed.`
      },
      {
        id: 'surface_evidence',
        status: surfaceEvidenceEvaluated ? (surfaceEvidenceFailures.length === 0 ? 'pass' : 'fail') : 'skipped',
        details: surfaceEvidenceEvaluated
          ? surfaceEvidenceFailures.length === 0
            ? 'Surface evidence gate passed.'
            : surfaceEvidenceFailures.join('; ')
          : 'Surface evidence not provided.'
      }
    ]
  };

  writeJson(args.outputPath, report);
  writeText(args.markdownPath, buildMarkdown(report));

  if (!args.quiet && !args.json) {
    console.log('AR three-surface gate');
    console.log(`Result: ${report.pass ? 'PASS' : args.warnOnly ? 'WARN' : 'FAIL'}`);
    console.log(`Replay failures: ${replayFailures.length}`);
    console.log(`Family replay failures: ${familyReplayFailures.length}`);
    console.log(`Family matrix failures: ${familyMatrixFailureCount}`);
    console.log(`Surface evidence: ${surfaceEvidenceEvaluated ? `${surfaceEvidenceFailures.length} failures` : 'skipped'}`);
    console.log(`Wrote report: ${resolvePath(args.outputPath)}`);
    console.log(`Wrote markdown: ${resolvePath(args.markdownPath)}`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  }

  if (!report.pass && !args.warnOnly) {
    process.exit(1);
  }
}

main();
