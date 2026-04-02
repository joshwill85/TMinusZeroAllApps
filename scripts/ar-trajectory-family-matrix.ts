import fs from 'node:fs';
import path from 'node:path';
import {
  evaluateFamilyMatrix,
  type FamilyMatrixFixture,
  type FamilyMatrixPolicy,
  type FamilyMatrixReport
} from '@/lib/ar/familyMatrix';

type CliArgs = {
  fixturePath: string;
  policyPath: string;
  outputPath: string;
  markdownPath: string;
  json: boolean;
  quiet: boolean;
  warnOnly: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  return {
    fixturePath: value('--fixture=') || 'scripts/fixtures/ar-trajectory-family-matrix-fixture.json',
    policyPath: value('--policy=') || 'docs/specs/ar-trajectory-three-surface-policy-v1.json',
    outputPath: value('--output=') || '.artifacts/ar-trajectory-family-matrix.json',
    markdownPath: value('--markdown=') || '.artifacts/ar-trajectory-family-matrix.md',
    json: args.includes('--json'),
    quiet: args.includes('--quiet'),
    warnOnly: args.includes('--warn-only')
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

function fmt(value: number | null | undefined, digits = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function buildMarkdown(report: FamilyMatrixReport) {
  const lines: string[] = [];
  lines.push('# AR Trajectory Family Matrix');
  lines.push('');
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- policyVersion: ${report.policyVersion}`);
  lines.push(`- fixtureSeed: ${report.fixtureSeed ?? '—'}`);
  lines.push(`- cases: ${report.fixtureCaseCount}`);
  lines.push(`- result: ${report.pass ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push('| Case | Result | Checks |');
  lines.push('|---|---|---:|');
  for (const caseRow of report.cases) {
    lines.push(`| ${caseRow.id} | ${caseRow.pass ? 'PASS' : 'FAIL'} | ${caseRow.checks.length} |`);
  }
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

function main() {
  const args = parseArgs(process.argv);
  const fixture = readJsonFile<FamilyMatrixFixture>(args.fixturePath);
  const policyBundle = readJsonFile<{ familyMatrix: FamilyMatrixPolicy }>(args.policyPath);
  const report = evaluateFamilyMatrix(fixture, policyBundle.familyMatrix);

  writeJson(args.outputPath, report);
  writeText(args.markdownPath, buildMarkdown(report));

  if (!args.quiet && !args.json) {
    const failed = report.checks.filter((row) => row.status === 'fail');
    console.log('AR trajectory family matrix');
    console.log(`Policy: ${policyBundle.familyMatrix.policyVersion}`);
    console.log(`Fixture: ${args.fixturePath}`);
    console.log(`Result: ${report.pass ? 'PASS' : args.warnOnly ? 'WARN' : 'FAIL'}`);
    console.log(`Checks: pass=${report.checks.length - failed.length} fail=${failed.length}`);
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

  if (!report.pass && !args.warnOnly) {
    process.exit(1);
  }
}

main();
