import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';

config({ path: '.env.local' });
config();

type AdmissionSignal = 'yes' | 'partial' | 'no' | 'unknown';
type AdmissionDecision = 'pass' | 'defer' | 'reject' | 'spike';

type RegistryEntry = {
  id: string;
  sourceFamily: string;
  intendedUse: string[];
  decision: AdmissionDecision;
  availability: AdmissionSignal;
  joinability: AdmissionSignal;
  usableCoverage: AdmissionSignal;
  allowedScope: string;
  reviewDoc: string | null;
  notes: string;
};

type RegistryFile = {
  policyVersion: string;
  updatedAt: string;
  entries: RegistryEntry[];
};

type CliArgs = {
  policyPath: string;
  outputPath: string;
  markdownPath: string;
  quiet: boolean;
  json: boolean;
  warnOnly: boolean;
};

type CheckStatus = 'pass' | 'fail' | 'warn';

type CheckResult = {
  id: string;
  label: string;
  status: CheckStatus;
  details: string;
};

type CheckReport = {
  generatedAt: string;
  policyVersion: string;
  policyPath: string;
  pass: boolean;
  summary: {
    entries: number;
    pass: number;
    fail: number;
    warn: number;
  };
  checks: CheckResult[];
};

const SIGNALS = new Set<AdmissionSignal>(['yes', 'partial', 'no', 'unknown']);
const DECISIONS = new Set<AdmissionDecision>(['pass', 'defer', 'reject', 'spike']);

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  return {
    policyPath: value('--policy=') || 'docs/specs/ar-trajectory-ingest-admission-registry-v1.json',
    outputPath: value('--output=') || '.artifacts/ar-trajectory-ingest-admission-check.json',
    markdownPath: value('--markdown=') || '.artifacts/ar-trajectory-ingest-admission-check.md',
    quiet: args.includes('--quiet'),
    json: args.includes('--json'),
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

function pushCheck(checks: CheckResult[], status: CheckStatus, id: string, label: string, details: string) {
  checks.push({ id, label, status, details });
}

function buildMarkdown(report: CheckReport) {
  const lines: string[] = [];
  lines.push('# AR Trajectory Ingest Admission Check');
  lines.push('');
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- policyVersion: ${report.policyVersion}`);
  lines.push(`- policyPath: ${report.policyPath}`);
  lines.push(`- pass: ${report.pass ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- entries=${report.summary.entries}`);
  lines.push(`- pass=${report.summary.pass}`);
  lines.push(`- fail=${report.summary.fail}`);
  lines.push(`- warn=${report.summary.warn}`);
  lines.push('');
  lines.push('## Checks');
  lines.push('');
  lines.push('| Status | Check | Details |');
  lines.push('|---|---|---|');
  if (!report.checks.length) {
    lines.push('| pass | registry.loaded | No checks emitted |');
  } else {
    for (const row of report.checks) {
      lines.push(`| ${row.status} | ${row.label} | ${row.details.replace(/\|/g, '\\|')} |`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  const registry = readJsonFile<RegistryFile>(args.policyPath);
  const checks: CheckResult[] = [];

  if (!registry.policyVersion || typeof registry.policyVersion !== 'string') {
    throw new Error('Missing policyVersion');
  }
  if (!Array.isArray(registry.entries) || registry.entries.length === 0) {
    throw new Error('Registry must contain at least one entry');
  }

  const ids = new Set<string>();

  for (const entry of registry.entries) {
    const label = `${entry.id} (${entry.sourceFamily})`;
    if (!entry.id || typeof entry.id !== 'string') {
      pushCheck(checks, 'fail', 'entry.id', 'Entry id', `invalid id for sourceFamily=${entry.sourceFamily || 'unknown'}`);
      continue;
    }
    if (ids.has(entry.id)) {
      pushCheck(checks, 'fail', `${entry.id}.duplicate`, 'Duplicate id', label);
    } else {
      ids.add(entry.id);
    }

    if (!DECISIONS.has(entry.decision)) {
      pushCheck(checks, 'fail', `${entry.id}.decision`, 'Decision enum', `${label} decision=${String(entry.decision)}`);
    } else {
      pushCheck(checks, 'pass', `${entry.id}.decision`, 'Decision enum', `${label} decision=${entry.decision}`);
    }

    for (const [field, value] of [
      ['availability', entry.availability],
      ['joinability', entry.joinability],
      ['usableCoverage', entry.usableCoverage]
    ] as const) {
      if (!SIGNALS.has(value)) {
        pushCheck(checks, 'fail', `${entry.id}.${field}`, 'Admission signal enum', `${label} ${field}=${String(value)}`);
      }
    }

    if (!Array.isArray(entry.intendedUse) || entry.intendedUse.length === 0) {
      pushCheck(checks, 'fail', `${entry.id}.intendedUse`, 'Intended use', `${label} intendedUse must be non-empty`);
    }

    if (entry.decision === 'pass') {
      const failingField = [
        ['availability', entry.availability],
        ['joinability', entry.joinability],
        ['usableCoverage', entry.usableCoverage]
      ].find(([, value]) => value !== 'yes');
      if (failingField) {
        pushCheck(
          checks,
          'fail',
          `${entry.id}.pass_gate`,
          'Pass decision gate',
          `${label} cannot be pass when ${failingField[0]}=${failingField[1]}`
        );
      } else {
        pushCheck(checks, 'pass', `${entry.id}.pass_gate`, 'Pass decision gate', `${label} clears yes/yes/yes`);
      }
    }

    if (entry.reviewDoc) {
      const full = resolvePath(entry.reviewDoc);
      if (!fs.existsSync(full)) {
        pushCheck(checks, 'fail', `${entry.id}.reviewDoc`, 'Review doc exists', `${label} missing ${entry.reviewDoc}`);
      } else {
        pushCheck(checks, 'pass', `${entry.id}.reviewDoc`, 'Review doc exists', `${label} -> ${entry.reviewDoc}`);
      }
    } else if (entry.decision === 'spike') {
      pushCheck(checks, 'warn', `${entry.id}.reviewDoc`, 'Review doc exists', `${label} is spike without a linked review doc`);
    }

    if (!entry.allowedScope || !entry.allowedScope.trim()) {
      pushCheck(checks, 'fail', `${entry.id}.allowedScope`, 'Allowed scope', `${label} allowedScope must be non-empty`);
    }
  }

  const summary = {
    entries: registry.entries.length,
    pass: checks.filter((row) => row.status === 'pass').length,
    fail: checks.filter((row) => row.status === 'fail').length,
    warn: checks.filter((row) => row.status === 'warn').length
  };

  const report: CheckReport = {
    generatedAt: new Date().toISOString(),
    policyVersion: registry.policyVersion,
    policyPath: args.policyPath,
    pass: summary.fail === 0,
    summary,
    checks
  };

  writeJson(args.outputPath, report);
  writeText(args.markdownPath, buildMarkdown(report));

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (!args.quiet) {
    console.log('AR trajectory ingest admission check');
    console.log(`Policy: ${report.policyVersion}`);
    console.log(`Result: ${report.pass ? 'PASS' : args.warnOnly ? 'WARN' : 'FAIL'}`);
    console.log(`Checks: pass=${summary.pass} fail=${summary.fail} warn=${summary.warn}`);
    console.log(`Wrote report: ${resolvePath(args.outputPath)}`);
    console.log(`Wrote markdown: ${resolvePath(args.markdownPath)}`);
  }

  if (!report.pass && !args.warnOnly) {
    process.exitCode = 1;
  }
}

main();
