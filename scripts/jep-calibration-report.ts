import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { summarizeJepCalibration, type JepCalibrationSample } from '@/lib/jep/calibration';
import type { JepCalibrationBand, JepObserverOutcome, JepReportMode } from '@/lib/types/jep';

config({ path: '.env.local' });
config();

type CliArgs = {
  days: number;
  limit: number;
  outputPath: string;
  markdownPath: string;
  json: boolean;
  quiet: boolean;
  write: boolean;
};

type OutcomeRow = {
  outcome: JepObserverOutcome | null;
  report_mode: JepReportMode | null;
  reported_probability: number | string | null;
  calibration_band: JepCalibrationBand | null;
  trajectory_authority_tier: string | null;
  observer_personalized: boolean | null;
  reported_at: string | null;
};

type GroupSummary = ReturnType<typeof summarizeJepCalibration> & { key: string };

function parseNumberArg(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  return {
    days: Math.max(1, Math.min(3650, Math.floor(parseNumberArg(value('--days='), 365)))),
    limit: Math.max(1, Math.min(100_000, Math.floor(parseNumberArg(value('--limit='), 25_000)))),
    outputPath: value('--output=') || '.artifacts/jep-calibration-report.json',
    markdownPath: value('--markdown=') || '.artifacts/jep-calibration-report.md',
    json: args.includes('--json'),
    quiet: args.includes('--quiet'),
    write: args.includes('--write')
  };
}

function resolvePath(pathArg: string) {
  return path.resolve(process.cwd(), pathArg);
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

function toNumber(value: number | string | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function fmt(value: number | null | undefined, digits = 4) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function fmtPct(value: number | null | undefined, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

function normalizeGroupKey(value: string | boolean | null | undefined, fallback: string) {
  if (typeof value === 'boolean') return value ? 'personalized' : 'pad_fallback';
  if (typeof value === 'string' && value.trim()) return value.trim();
  return fallback;
}

function buildSamples(rows: OutcomeRow[]): JepCalibrationSample[] {
  return rows.map((row) => ({
    probability: toNumber(row.reported_probability),
    outcome: row.outcome,
    reportMode: row.report_mode,
    calibrationBand: row.calibration_band,
    authorityTier: row.trajectory_authority_tier,
    observerPersonalized: row.observer_personalized
  }));
}

function buildGroupedSummaries(rows: OutcomeRow[], keyForRow: (row: OutcomeRow) => string) {
  const groups = new Map<string, OutcomeRow[]>();
  for (const row of rows) {
    const key = keyForRow(row);
    const bucket = groups.get(key) || [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  return [...groups.entries()]
    .map(([key, groupedRows]) => ({
      key,
      ...summarizeJepCalibration(buildSamples(groupedRows))
    }))
    .sort((a, b) => b.labeledSamples - a.labeledSamples || a.key.localeCompare(b.key));
}

function buildMarkdown({
  generatedAt,
  days,
  loadedRows,
  overall,
  byMode,
  byBand,
  byAuthority,
  byObserver
}: {
  generatedAt: string;
  days: number;
  loadedRows: number;
  overall: ReturnType<typeof summarizeJepCalibration>;
  byMode: GroupSummary[];
  byBand: GroupSummary[];
  byAuthority: GroupSummary[];
  byObserver: GroupSummary[];
}) {
  const lines: string[] = [];
  lines.push('# JEP Calibration Report');
  lines.push('');
  lines.push(`- generatedAt: ${generatedAt}`);
  lines.push(`- windowDays: ${days}`);
  lines.push(`- loadedRows: ${loadedRows}`);
  lines.push(`- labeledOutcomes: ${overall.labeledSamples}`);
  lines.push(`- Brier: ${fmt(overall.brierScore) ?? '—'}`);
  lines.push(`- ECE: ${fmt(overall.expectedCalibrationError) ?? '—'}`);
  lines.push('');
  lines.push('## Overall');
  lines.push('');
  lines.push(`- positiveRate: ${fmtPct(overall.observedRate)}`);
  lines.push(`- meanProbability: ${fmtPct(overall.meanProbability)}`);
  lines.push(`- skippedSamples: ${overall.skippedSamples}`);
  lines.push('');
  lines.push('## Reliability Bins');
  lines.push('');
  lines.push('| Bin | Count | Avg Probability | Observed Rate | Abs Gap |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const bin of overall.bins) {
    lines.push(
      `| ${(bin.start * 100).toFixed(0)}-${(bin.end * 100).toFixed(0)}% | ${bin.count} | ${fmtPct(bin.averageProbability)} | ${fmtPct(bin.empiricalRate)} | ${fmtPct(bin.absoluteGap)} |`
    );
  }
  lines.push('');

  const renderGroup = (title: string, groups: GroupSummary[]) => {
    lines.push(`## ${title}`);
    lines.push('');
    lines.push('| Group | Labeled | Brier | ECE | Observed Rate | Mean Probability |');
    lines.push('|---|---:|---:|---:|---:|---:|');
    if (groups.length === 0) {
      lines.push('| — | 0 | — | — | — | — |');
    } else {
      for (const row of groups) {
        lines.push(
          `| ${row.key} | ${row.labeledSamples} | ${fmt(row.brierScore) ?? '—'} | ${fmt(row.expectedCalibrationError) ?? '—'} | ${fmtPct(row.observedRate)} | ${fmtPct(row.meanProbability)} |`
        );
      }
    }
    lines.push('');
  };

  renderGroup('By Mode', byMode);
  renderGroup('By Calibration Band', byBand);
  renderGroup('By Authority Tier', byAuthority);
  renderGroup('By Observer Mode', byObserver);

  return `${lines.join('\n')}\n`;
}

async function loadOutcomeRows(windowStart: string, limit: number) {
  const admin = createSupabaseAdminClient();
  const rows: OutcomeRow[] = [];
  const pageSize = 1000;

  for (let offset = 0; offset < limit; offset += pageSize) {
    const upper = Math.min(limit - 1, offset + pageSize - 1);
    const { data, error } = await admin
      .from('jep_outcome_reports')
      .select('outcome,report_mode,reported_probability,calibration_band,trajectory_authority_tier,observer_personalized,reported_at')
      .gte('reported_at', windowStart)
      .order('reported_at', { ascending: false })
      .range(offset, upper);

    if (error) throw new Error(`Failed to load jep_outcome_reports (${error.message})`);
    const page = Array.isArray(data) ? (data as OutcomeRow[]) : [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

async function writeReadinessMetrics(overall: ReturnType<typeof summarizeJepCalibration>) {
  const admin = createSupabaseAdminClient();
  const updates = [
    { key: 'jep_probability_labeled_outcomes', value: overall.labeledSamples },
    { key: 'jep_probability_current_ece', value: overall.expectedCalibrationError },
    { key: 'jep_probability_current_brier', value: overall.brierScore }
  ];

  const { error } = await admin.from('system_settings').upsert(updates, { onConflict: 'key' });
  if (error) throw new Error(`Failed to update JEP readiness metrics (${error.message})`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    throw new Error('Supabase env is not configured for JEP calibration reporting.');
  }

  const windowStart = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000).toISOString();
  const rows = await loadOutcomeRows(windowStart, args.limit);
  const overall = summarizeJepCalibration(buildSamples(rows));
  const byMode = buildGroupedSummaries(rows, (row) => normalizeGroupKey(row.report_mode, 'unknown'));
  const byBand = buildGroupedSummaries(rows, (row) => normalizeGroupKey(row.calibration_band, 'unknown'));
  const byAuthority = buildGroupedSummaries(rows, (row) => normalizeGroupKey(row.trajectory_authority_tier, 'unknown'));
  const byObserver = buildGroupedSummaries(rows, (row) => normalizeGroupKey(row.observer_personalized, 'unknown'));

  const payload = {
    generatedAt: new Date().toISOString(),
    windowDays: args.days,
    loadedRows: rows.length,
    overall: {
      ...overall,
      brierScore: fmt(overall.brierScore),
      expectedCalibrationError: fmt(overall.expectedCalibrationError),
      meanProbability: fmt(overall.meanProbability),
      observedRate: fmt(overall.observedRate),
      bins: overall.bins.map((bin) => ({
        ...bin,
        averageProbability: fmt(bin.averageProbability),
        empiricalRate: fmt(bin.empiricalRate),
        absoluteGap: fmt(bin.absoluteGap)
      }))
    },
    byMode: byMode.map((row) => ({ ...row, brierScore: fmt(row.brierScore), expectedCalibrationError: fmt(row.expectedCalibrationError) })),
    byCalibrationBand: byBand.map((row) => ({
      ...row,
      brierScore: fmt(row.brierScore),
      expectedCalibrationError: fmt(row.expectedCalibrationError)
    })),
    byAuthorityTier: byAuthority.map((row) => ({
      ...row,
      brierScore: fmt(row.brierScore),
      expectedCalibrationError: fmt(row.expectedCalibrationError)
    })),
    byObserverMode: byObserver.map((row) => ({
      ...row,
      brierScore: fmt(row.brierScore),
      expectedCalibrationError: fmt(row.expectedCalibrationError)
    }))
  };

  writeJson(args.outputPath, payload);
  writeText(
    args.markdownPath,
    buildMarkdown({
      generatedAt: payload.generatedAt,
      days: args.days,
      loadedRows: rows.length,
      overall,
      byMode,
      byBand,
      byAuthority,
      byObserver
    })
  );

  if (args.write) {
    await writeReadinessMetrics(overall);
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  if (!args.quiet) {
    process.stdout.write(
      [
        `JEP calibration rows: ${rows.length}`,
        `Labeled outcomes: ${overall.labeledSamples}`,
        `Brier: ${fmt(overall.brierScore) ?? '—'}`,
        `ECE: ${fmt(overall.expectedCalibrationError) ?? '—'}`,
        `Output: ${resolvePath(args.outputPath)}`,
        `Markdown: ${resolvePath(args.markdownPath)}`,
        args.write ? 'Readiness settings updated.' : 'Readiness settings not updated.'
      ].join('\n') + '\n'
    );
  }
}

void main().catch((error) => {
  console.error('jep-calibration-report failed', error);
  process.exitCode = 1;
});
