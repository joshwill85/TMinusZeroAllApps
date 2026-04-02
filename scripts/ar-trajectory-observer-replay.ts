import fs from 'node:fs';
import path from 'node:path';
import {
  buildObserverReplayRows,
  type FamilyMatrixFixture,
  type FamilyMatrixPolicy,
  type ObserverReplayRow
} from '@/lib/ar/familyMatrix';

type CliArgs = {
  fixturePath: string;
  policyPath: string;
  outputPath: string;
  markdownPath: string;
  json: boolean;
  quiet: boolean;
};

type ObserverReplayReport = {
  generatedAt: string;
  fixturePath: string;
  rowCount: number;
  rows: ObserverReplayRow[];
};

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  return {
    fixturePath: value('--fixture=') || 'scripts/fixtures/ar-trajectory-family-matrix-fixture.json',
    policyPath: value('--policy=') || 'docs/specs/ar-trajectory-three-surface-policy-v1.json',
    outputPath: value('--output=') || '.artifacts/ar-trajectory-observer-replay.json',
    markdownPath: value('--markdown=') || '.artifacts/ar-trajectory-observer-replay.md',
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

function fmt(value: number, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function buildMarkdown(report: ObserverReplayReport) {
  const lines: string[] = [];
  lines.push('# AR Trajectory Observer Replay');
  lines.push('');
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- fixturePath: \`${report.fixturePath}\``);
  lines.push(`- rows: ${report.rowCount}`);
  lines.push('');

  let activeCase = '';
  let activeObserver = '';
  for (const row of report.rows) {
    if (row.caseId !== activeCase) {
      activeCase = row.caseId;
      activeObserver = '';
      lines.push(`## ${row.caseLabel}`);
      lines.push('');
    }
    if (row.observerId !== activeObserver) {
      activeObserver = row.observerId;
      lines.push(`### ${row.observerLabel}`);
      lines.push('');
      lines.push('| T+ | Az | El | Pad Bearing | |Pad Delta| | Guard |');
      lines.push('|---|---:|---:|---:|---:|---|');
    }
    lines.push(
      `| ${row.tPlusSec} | ${fmt(row.azDeg)} | ${fmt(row.elDeg)} | ${fmt(row.padBearingDeg)} | ${fmt(row.padDeltaDeg)} | ${
        row.exceedsEastboundGuard ? 'FAIL' : 'PASS'
      } |`
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  const fixture = readJsonFile<FamilyMatrixFixture>(args.fixturePath);
  const policyBundle = readJsonFile<{ familyMatrix: FamilyMatrixPolicy }>(args.policyPath);
  const rows = buildObserverReplayRows(fixture, policyBundle.familyMatrix);
  const report: ObserverReplayReport = {
    generatedAt: new Date().toISOString(),
    fixturePath: args.fixturePath,
    rowCount: rows.length,
    rows
  };

  writeJson(args.outputPath, report);
  writeText(args.markdownPath, buildMarkdown(report));

  if (!args.quiet && !args.json) {
    const flagged = rows.filter((row) => row.exceedsEastboundGuard).length;
    console.log('AR trajectory observer replay');
    console.log(`Fixture: ${args.fixturePath}`);
    console.log(`Rows: ${rows.length}`);
    console.log(`Guard violations: ${flagged}`);
    console.log(`Wrote report: ${resolvePath(args.outputPath)}`);
    console.log(`Wrote markdown: ${resolvePath(args.markdownPath)}`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  }
}

main();
