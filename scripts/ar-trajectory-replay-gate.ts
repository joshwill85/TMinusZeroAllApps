import fs from 'node:fs';
import path from 'node:path';
import type { ReplayBenchmarkReport } from '@/lib/ar/replayBenchmark';

type CliArgs = {
  reportPath: string;
  warnOnly: boolean;
  minCases: number;
  minSamples: number;
  maxOverallP95Deg: number;
  maxOverallDriftDeg: number;
  maxOverallSlopeDegPerMin: number;
  maxCaseP95Deg: number;
  maxCaseDriftDeg: number;
};

function parseNumberArg(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const getValue = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);

  return {
    reportPath: getValue('--report=') || '.artifacts/ar-trajectory-replay-bench.json',
    warnOnly: args.includes('--warn-only'),
    minCases: Math.max(1, Math.floor(parseNumberArg(getValue('--min-cases='), 6))),
    minSamples: Math.max(1, Math.floor(parseNumberArg(getValue('--min-samples='), 60))),
    maxOverallP95Deg: parseNumberArg(getValue('--max-overall-p95='), 3.5),
    maxOverallDriftDeg: parseNumberArg(getValue('--max-overall-drift='), 2.0),
    maxOverallSlopeDegPerMin: parseNumberArg(getValue('--max-overall-slope='), 1.8),
    maxCaseP95Deg: parseNumberArg(getValue('--max-case-p95='), 4.25),
    maxCaseDriftDeg: parseNumberArg(getValue('--max-case-drift='), 3.4)
  };
}

function readReportFromDisk(reportPathArg: string): ReplayBenchmarkReport {
  const reportPath = path.resolve(process.cwd(), reportPathArg);
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Replay benchmark report not found: ${reportPath}`);
  }
  const raw = fs.readFileSync(reportPath, 'utf8');
  const parsed = JSON.parse(raw) as ReplayBenchmarkReport;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Replay benchmark report is invalid.');
  }
  return parsed;
}

function fmt(value: number) {
  return Number.isFinite(value) ? value.toFixed(3) : String(value);
}

function evaluate(report: ReplayBenchmarkReport, args: CliArgs) {
  const failures: string[] = [];
  const overall = report.overall;

  if (report.sampleCount < args.minSamples) {
    failures.push(`sampleCount ${report.sampleCount} < minSamples ${args.minSamples}`);
  }
  if (report.evaluatedCaseCount < args.minCases) {
    failures.push(`evaluatedCaseCount ${report.evaluatedCaseCount} < minCases ${args.minCases}`);
  }
  if (!overall) {
    failures.push('overall summary missing');
    return failures;
  }

  if (overall.p95ErrorDeg > args.maxOverallP95Deg) {
    failures.push(`overall p95 ${fmt(overall.p95ErrorDeg)}deg > ${fmt(args.maxOverallP95Deg)}deg`);
  }
  if (Math.abs(overall.driftDeg) > args.maxOverallDriftDeg) {
    failures.push(`overall |drift| ${fmt(Math.abs(overall.driftDeg))}deg > ${fmt(args.maxOverallDriftDeg)}deg`);
  }
  if (Math.abs(overall.slopeDegPerMin) > args.maxOverallSlopeDegPerMin) {
    failures.push(
      `overall |slope| ${fmt(Math.abs(overall.slopeDegPerMin))}deg/min > ${fmt(args.maxOverallSlopeDegPerMin)}deg/min`
    );
  }

  for (const row of report.cases) {
    if (row.p95ErrorDeg > args.maxCaseP95Deg) {
      failures.push(`case ${row.id} p95 ${fmt(row.p95ErrorDeg)}deg > ${fmt(args.maxCaseP95Deg)}deg`);
    }
    if (Math.abs(row.driftDeg) > args.maxCaseDriftDeg) {
      failures.push(`case ${row.id} |drift| ${fmt(Math.abs(row.driftDeg))}deg > ${fmt(args.maxCaseDriftDeg)}deg`);
    }
  }

  return failures;
}

function main() {
  const args = parseArgs(process.argv);
  const report = readReportFromDisk(args.reportPath);
  const failures = evaluate(report, args);

  console.log('AR trajectory replay gate');
  console.log(`Report: ${path.resolve(process.cwd(), args.reportPath)}`);
  console.log(`Evaluated cases: ${report.evaluatedCaseCount}`);
  console.log(`Sample count: ${report.sampleCount}`);
  if (report.overall) {
    console.log(
      `Overall: p95=${fmt(report.overall.p95ErrorDeg)}deg drift=${fmt(report.overall.driftDeg)}deg slope=${fmt(report.overall.slopeDegPerMin)}deg/min`
    );
  }
  if (report.cases.length > 0) {
    const worstCaseP95 = report.cases.reduce((max, row) => Math.max(max, row.p95ErrorDeg), Number.NEGATIVE_INFINITY);
    const worstCaseDrift = report.cases.reduce((max, row) => Math.max(max, Math.abs(row.driftDeg)), Number.NEGATIVE_INFINITY);
    console.log(`Worst case: p95=${fmt(worstCaseP95)}deg |drift|=${fmt(worstCaseDrift)}deg`);
  }

  if (!failures.length) {
    console.log('Replay gate: PASS');
    return;
  }

  const prefix = args.warnOnly ? 'Replay gate: WARNING' : 'Replay gate: FAIL';
  console.log(prefix);
  for (const failure of failures) {
    console.log(`- ${failure}`);
  }
  if (!args.warnOnly) {
    process.exit(1);
  }
}

main();
