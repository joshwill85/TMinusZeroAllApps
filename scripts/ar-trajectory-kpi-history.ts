import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';

config({ path: '.env.local' });
config();

type CliArgs = {
  kpiPath: string;
  comparePath: string;
  historyInPath: string;
  historyOutPath: string;
  markdownPath: string;
  runId: string;
  commit: string | null;
  branch: string | null;
  source: string;
  maxEntries: number;
  quiet: boolean;
  json: boolean;
};

type CheckStatus = 'pass' | 'fail' | 'skip' | 'exception';

type KpiReport = {
  generatedAt: string;
  policyVersion: string;
  pass: boolean;
  checks: Array<{ status: CheckStatus }>;
  replay: {
    sampleCount: number;
    evaluatedCaseCount: number;
    overallP95Deg: number | null;
    overallDriftDeg: number | null;
    overallSlopeDegPerMin: number | null;
    worstCaseP95Deg: number | null;
    worstCaseAbsDriftDeg: number | null;
  };
  telemetry: {
    sampledSessions: number;
    lockAcquisitionRate: number | null;
    lockLe5Rate: number | null;
    fallbackRate: number | null;
    trajectoryCoverageRate: number | null;
    sigmaGoodRate: number | null;
  } | null;
};

type ComparativeSummary = {
  overall: {
    p95DeltaDeg: number;
    absDriftDeltaDeg: number;
    absSlopeDeltaDegPerMin: number;
  } | null;
  worstCase: {
    p95DeltaDeg: number;
    absDriftDeltaDeg: number;
  } | null;
  skippedCases: {
    baseline: number;
    current: number;
    delta: number;
  };
};

type HistoryEntry = {
  runId: string;
  generatedAt: string;
  source: string;
  commit: string | null;
  branch: string | null;
  policyVersion: string;
  pass: boolean;
  checks: {
    pass: number;
    fail: number;
    exception: number;
    skip: number;
  };
  replay: KpiReport['replay'];
  comparative: {
    overallP95DeltaDeg: number | null;
    overallAbsDriftDeltaDeg: number | null;
    overallAbsSlopeDeltaDegPerMin: number | null;
    worstCaseP95DeltaDeg: number | null;
    worstCaseAbsDriftDeltaDeg: number | null;
    skippedCaseDelta: number;
  };
  telemetry: KpiReport['telemetry'];
};

type HistoryFile = {
  schemaVersion: 'v1';
  policyVersion: string;
  updatedAt: string;
  entries: HistoryEntry[];
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
    kpiPath: value('--kpi=') || '.artifacts/ar-trajectory-kpi-eval.json',
    comparePath: value('--compare=') || '.artifacts/ar-trajectory-benchmark-compare.json',
    historyInPath: value('--history-in=') || 'scripts/fixtures/ar-trajectory-kpi-history-v1.json',
    historyOutPath: value('--history-out=') || '.artifacts/ar-trajectory-kpi-history.json',
    markdownPath: value('--markdown=') || '.artifacts/ar-trajectory-kpi-history.md',
    runId:
      value('--run-id=') ||
      process.env.GITHUB_RUN_ID ||
      process.env.CI_PIPELINE_ID ||
      `local-${new Date().toISOString()}`,
    commit: value('--commit=') || process.env.GITHUB_SHA || null,
    branch: value('--branch=') || process.env.GITHUB_REF_NAME || null,
    source: value('--source=') || (process.env.CI ? 'ci' : 'local'),
    maxEntries: Math.max(1, Math.min(500, Math.floor(parseNumberArg(value('--max-entries='), 120)))),
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

function summarizeChecks(checks: Array<{ status: CheckStatus }>) {
  let pass = 0;
  let fail = 0;
  let exception = 0;
  let skip = 0;
  for (const row of checks) {
    if (row.status === 'pass') pass += 1;
    if (row.status === 'fail') fail += 1;
    if (row.status === 'exception') exception += 1;
    if (row.status === 'skip') skip += 1;
  }
  return { pass, fail, exception, skip };
}

function toIso(value: string | null | undefined) {
  if (!value) return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function buildHistoryEntry({
  args,
  kpi,
  compare
}: {
  args: CliArgs;
  kpi: KpiReport;
  compare: ComparativeSummary;
}): HistoryEntry {
  return {
    runId: args.runId,
    generatedAt: toIso(kpi.generatedAt) || new Date().toISOString(),
    source: args.source,
    commit: args.commit,
    branch: args.branch,
    policyVersion: kpi.policyVersion,
    pass: kpi.pass,
    checks: summarizeChecks(kpi.checks),
    replay: kpi.replay,
    comparative: {
      overallP95DeltaDeg: compare.overall?.p95DeltaDeg ?? null,
      overallAbsDriftDeltaDeg: compare.overall?.absDriftDeltaDeg ?? null,
      overallAbsSlopeDeltaDegPerMin: compare.overall?.absSlopeDeltaDegPerMin ?? null,
      worstCaseP95DeltaDeg: compare.worstCase?.p95DeltaDeg ?? null,
      worstCaseAbsDriftDeltaDeg: compare.worstCase?.absDriftDeltaDeg ?? null,
      skippedCaseDelta: compare.skippedCases.delta
    },
    telemetry: kpi.telemetry
  };
}

function mergeHistory({
  base,
  entry,
  maxEntries
}: {
  base: HistoryFile | null;
  entry: HistoryEntry;
  maxEntries: number;
}): HistoryFile {
  const baseEntries = Array.isArray(base?.entries) ? base!.entries : [];
  const nextEntries = baseEntries.filter((row) => row.runId !== entry.runId);
  nextEntries.push(entry);
  nextEntries.sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));
  const trimmed = nextEntries.slice(Math.max(0, nextEntries.length - maxEntries));
  return {
    schemaVersion: 'v1',
    policyVersion: entry.policyVersion,
    updatedAt: new Date().toISOString(),
    entries: trimmed
  };
}

function buildMarkdown(history: HistoryFile) {
  const entries = history.entries;
  const passes = entries.filter((row) => row.pass).length;
  const passRate = entries.length ? passes / entries.length : null;
  const latest = entries.length ? entries[entries.length - 1] : null;
  const first = entries.length ? entries[0] : null;
  const overallP95Trend =
    first && latest && first.replay.overallP95Deg != null && latest.replay.overallP95Deg != null
      ? latest.replay.overallP95Deg - first.replay.overallP95Deg
      : null;
  const driftTrend =
    first && latest && first.replay.overallDriftDeg != null && latest.replay.overallDriftDeg != null
      ? Math.abs(latest.replay.overallDriftDeg) - Math.abs(first.replay.overallDriftDeg)
      : null;

  const lines: string[] = [];
  lines.push('# AR Trajectory KPI Trend History');
  lines.push('');
  lines.push(`- policyVersion: ${history.policyVersion}`);
  lines.push(`- updatedAt: ${history.updatedAt}`);
  lines.push(`- entries: ${entries.length}`);
  lines.push(`- passRate: ${fmtPct(passRate)}`);
  lines.push(`- trend overall p95 delta (first->latest): ${fmt(overallP95Trend)}`);
  lines.push(`- trend overall |drift| delta (first->latest): ${fmt(driftTrend)}`);
  lines.push('');

  lines.push('## Runs');
  lines.push('');
  lines.push('| Date | Run | Commit | Branch | Pass | p95 | |drift| | cmp p95 delta | cmp |drift| delta | fail | exception |');
  lines.push('|---|---|---|---|---|---:|---:|---:|---:|---:|---:|');

  if (!entries.length) {
    lines.push('| — | — | — | — | — | — | — | — | — | — | — |');
  } else {
    for (const row of [...entries].reverse()) {
      lines.push(
        `| ${row.generatedAt} | ${row.runId} | ${row.commit ?? '—'} | ${row.branch ?? '—'} | ${row.pass ? 'pass' : 'fail'} | ${fmt(row.replay.overallP95Deg)} | ${fmt(row.replay.overallDriftDeg != null ? Math.abs(row.replay.overallDriftDeg) : null)} | ${fmt(row.comparative.overallP95DeltaDeg)} | ${fmt(row.comparative.overallAbsDriftDeltaDeg)} | ${row.checks.fail} | ${row.checks.exception} |`
      );
    }
  }
  lines.push('');

  if (latest?.telemetry) {
    lines.push('## Latest Telemetry Snapshot');
    lines.push('');
    lines.push(`- sampledSessions=${latest.telemetry.sampledSessions}`);
    lines.push(`- lockAcquisitionRate=${fmtPct(latest.telemetry.lockAcquisitionRate)}`);
    lines.push(`- lock<=5s rate=${fmtPct(latest.telemetry.lockLe5Rate)}`);
    lines.push(`- fallbackRate=${fmtPct(latest.telemetry.fallbackRate)}`);
    lines.push(`- trajectoryCoverageRate=${fmtPct(latest.telemetry.trajectoryCoverageRate)}`);
    lines.push(`- sigmaGoodRate=${fmtPct(latest.telemetry.sigmaGoodRate)}`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const kpi = readJsonFile<KpiReport>(args.kpiPath);
  const compare = readJsonFile<ComparativeSummary>(args.comparePath);
  const base = readJsonFileIfExists<HistoryFile>(args.historyInPath);

  const entry = buildHistoryEntry({ args, kpi, compare });
  const history = mergeHistory({ base, entry, maxEntries: args.maxEntries });
  const markdown = buildMarkdown(history);

  writeJson(args.historyOutPath, history);
  writeText(args.markdownPath, markdown);

  if (!args.quiet && !args.json) {
    console.log('AR trajectory KPI history');
    console.log(`Run: ${entry.runId}`);
    console.log(`Entries: ${history.entries.length}`);
    console.log(`Latest pass: ${entry.pass ? 'yes' : 'no'}`);
    console.log(`Wrote history: ${resolvePath(args.historyOutPath)}`);
    console.log(`Wrote markdown: ${resolvePath(args.markdownPath)}`);
  }
  if (args.json) {
    console.log(JSON.stringify(history, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
