import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import type { ReplayBenchmarkReport } from '@/lib/ar/replayBenchmark';

config({ path: '.env.local' });
config();

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

type CliArgs = {
  policyPath: string;
  reportPath: string;
  outputPath: string;
  markdownPath: string;
  warnOnly: boolean;
  quiet: boolean;
  json: boolean;
};

type CheckResult = {
  id: string;
  label: string;
  status: 'pass' | 'fail';
  value: number | string | null;
  threshold: string;
  details?: string;
};

type FamilyReplayReport = {
  generatedAt: string;
  policyVersion: string;
  policyPath: string;
  replayReportPath: string;
  pass: boolean;
  checks: CheckResult[];
};

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  return {
    policyPath: value('--policy=') || 'docs/specs/ar-trajectory-family-replay-policy-v1.json',
    reportPath: value('--report=') || '.artifacts/ar-trajectory-replay-bench.json',
    outputPath: value('--output=') || '.artifacts/ar-trajectory-family-replay-check.json',
    markdownPath: value('--markdown=') || '.artifacts/ar-trajectory-family-replay-check.md',
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

function fmt(value: number | null | undefined, digits = 3) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
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

function buildMarkdown(report: FamilyReplayReport) {
  const lines: string[] = [];
  lines.push('# AR Trajectory Family Replay Check');
  lines.push('');
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- policyVersion: ${report.policyVersion}`);
  lines.push(`- policyPath: \`${report.policyPath}\``);
  lines.push(`- replayReportPath: \`${report.replayReportPath}\``);
  lines.push(`- result: ${report.pass ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push('| Check | Value | Threshold | Status |');
  lines.push('|---|---:|---:|---|');
  for (const row of report.checks) {
    const value = typeof row.value === 'number' ? fmt(row.value) : (row.value ?? '—');
    lines.push(`| ${row.id} | ${value} | ${row.threshold} | ${row.status} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const policy = readJsonFile<FamilyReplayPolicy>(args.policyPath);
  const replay = readJsonFile<ReplayBenchmarkReport>(args.reportPath);

  const checks: CheckResult[] = [];
  checks.push(
    check({
      id: 'replay.skipped_cases',
      label: 'Skipped replay case count',
      pass: replay.skippedCases.length <= policy.maxSkippedCases,
      value: replay.skippedCases.length,
      threshold: `<= ${policy.maxSkippedCases}`
    })
  );

  const byId = new Map(replay.cases.map((row) => [row.id, row]));
  for (const required of policy.requiredCases) {
    const row = byId.get(required.id);
    const prefix = `case.${required.id}`;
    checks.push(
      check({
        id: `${prefix}.present`,
        label: `${required.label} present`,
        pass: Boolean(row),
        value: row ? 'yes' : 'no',
        threshold: 'yes'
      })
    );
    if (!row) continue;
    checks.push(
      check({
        id: `${prefix}.samples`,
        label: `${required.label} sample count`,
        pass: row.sampleCount >= required.minSamples,
        value: row.sampleCount,
        threshold: `>= ${required.minSamples}`
      })
    );
    checks.push(
      check({
        id: `${prefix}.p95`,
        label: `${required.label} p95`,
        pass: row.p95ErrorDeg <= required.maxP95Deg,
        value: row.p95ErrorDeg,
        threshold: `<= ${required.maxP95Deg}`
      })
    );
    checks.push(
      check({
        id: `${prefix}.abs_drift`,
        label: `${required.label} |drift|`,
        pass: Math.abs(row.driftDeg) <= required.maxAbsDriftDeg,
        value: Math.abs(row.driftDeg),
        threshold: `<= ${required.maxAbsDriftDeg}`
      })
    );
  }

  const pass = checks.every((row) => row.status !== 'fail');
  const report: FamilyReplayReport = {
    generatedAt: new Date().toISOString(),
    policyVersion: policy.policyVersion,
    policyPath: args.policyPath,
    replayReportPath: args.reportPath,
    pass,
    checks
  };

  writeJson(args.outputPath, report);
  writeText(args.markdownPath, buildMarkdown(report));

  if (!args.quiet && !args.json) {
    const failed = checks.filter((row) => row.status === 'fail');
    console.log('AR trajectory family replay check');
    console.log(`Policy: ${policy.policyVersion}`);
    console.log(`Replay report: ${args.reportPath}`);
    console.log(`Result: ${pass ? 'PASS' : args.warnOnly ? 'WARN' : 'FAIL'}`);
    console.log(`Checks: pass=${checks.length - failed.length} fail=${failed.length}`);
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
