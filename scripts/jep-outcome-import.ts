import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { fetchLaunchJepScore } from '@/lib/server/jep';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { normalizeJepObserver } from '@/lib/server/jepObserver';
import { JEP_OBSERVER_OUTCOME_VALUES, type JepObserverOutcome, type JepOutcomeSource } from '@/lib/types/jep';

config({ path: '.env.local' });
config();

type CliArgs = {
  inputPath: string;
  dryRun: boolean;
  json: boolean;
  quiet: boolean;
  source: JepOutcomeSource;
};

type InputRow = {
  launch_id?: string;
  launchId?: string;
  outcome?: string;
  observer_lat?: number | string;
  observerLat?: number | string;
  observer_lon?: number | string;
  observerLon?: number | string;
  reported_at?: string;
  reportedAt?: string;
  reporter_key?: string;
  reporterKey?: string;
  source?: string;
};

type ImportSummary = {
  totalRows: number;
  validRows: number;
  insertedRows: number;
  dryRun: boolean;
  errors: string[];
};

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const source = normalizeSource(value('--source=')) ?? 'curated_import';
  const inputPath = value('--input=');
  if (!inputPath) {
    throw new Error('Missing required --input=path argument.');
  }
  return {
    inputPath,
    dryRun: args.includes('--dry-run'),
    json: args.includes('--json'),
    quiet: args.includes('--quiet'),
    source
  };
}

function resolvePath(pathArg: string) {
  return path.resolve(process.cwd(), pathArg);
}

function toFinite(value: number | string | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeOutcome(value: string | undefined): JepObserverOutcome | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized && (JEP_OBSERVER_OUTCOME_VALUES as readonly string[]).includes(normalized)) {
    return normalized as JepObserverOutcome;
  }
  return null;
}

function normalizeSource(value: string | undefined): JepOutcomeSource | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'curated_import' || normalized === 'admin_manual') return normalized;
  return null;
}

function parseMaybeIso(value: string | undefined) {
  if (!value || !value.trim()) return new Date().toISOString();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function buildReporterHash(rawKey: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || 'jep_outcome_import';
  return crypto.createHash('sha256').update(`${secret}:${rawKey}`).digest('hex').slice(0, 40);
}

function stableReporterKey(row: Required<Pick<InputRow, 'launchId' | 'outcome'>>) {
  return `${row.launchId}:${row.outcome}`;
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const next = text[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ',') {
      row.push(current);
      current = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(current);
      current = '';
      if (row.some((entry) => entry.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((entry) => entry.length > 0)) rows.push(row);
  if (rows.length === 0) return [];

  const headers = rows[0]!.map((entry) => entry.trim());
  return rows.slice(1).map((entries) => {
    const mapped: Record<string, string> = {};
    headers.forEach((header, index) => {
      mapped[header] = entries[index] ?? '';
    });
    return mapped;
  });
}

function readInputRows(inputPath: string): InputRow[] {
  const fullPath = resolvePath(inputPath);
  const raw = fs.readFileSync(fullPath, 'utf8');
  if (fullPath.endsWith('.json')) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('JSON input must be an array of rows.');
    return parsed as InputRow[];
  }
  if (fullPath.endsWith('.csv')) {
    return parseCsv(raw) as InputRow[];
  }
  throw new Error('Unsupported input format. Use .json or .csv.');
}

async function main() {
  const args = parseArgs(process.argv);
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    throw new Error('Supabase env is not configured for JEP outcome import.');
  }

  const rows = readInputRows(args.inputPath);
  const admin = createSupabaseAdminClient();
  const snapshotCache = new Map<string, Awaited<ReturnType<typeof fetchLaunchJepScore>>>();
  const upserts: Record<string, unknown>[] = [];
  const errors: string[] = [];

  for (const [index, rawRow] of rows.entries()) {
    const launchId = String(rawRow.launch_id || rawRow.launchId || '').trim();
    const outcome = normalizeOutcome(rawRow.outcome);
    const reportedAt = parseMaybeIso(rawRow.reported_at || rawRow.reportedAt);
    if (!launchId) {
      errors.push(`row ${index + 1}: missing launch_id`);
      continue;
    }
    if (!outcome) {
      errors.push(`row ${index + 1}: invalid outcome`);
      continue;
    }
    if (!reportedAt) {
      errors.push(`row ${index + 1}: invalid reported_at`);
      continue;
    }

    const observerLat = toFinite(rawRow.observer_lat ?? rawRow.observerLat);
    const observerLon = toFinite(rawRow.observer_lon ?? rawRow.observerLon);
    const observer =
      observerLat != null && observerLon != null ? normalizeJepObserver(observerLat, observerLon, 'provided') : null;
    if ((observerLat != null || observerLon != null) && !observer) {
      errors.push(`row ${index + 1}: invalid observer coordinates`);
      continue;
    }

    const cacheKey = `${launchId}:${observer?.locationHash || 'pad'}`;
    if (!snapshotCache.has(cacheKey)) {
      const snapshot = await fetchLaunchJepScore(launchId, {
        viewerIsAdmin: true,
        observer,
        skipObserverRegistration: true
      });
      snapshotCache.set(cacheKey, snapshot);
    }

    const snapshot = snapshotCache.get(cacheKey) || null;
    if (!snapshot) {
      errors.push(`row ${index + 1}: no JEP score snapshot found for ${launchId}`);
      continue;
    }

    const reporterKey =
      String(rawRow.reporter_key || rawRow.reporterKey || '').trim() ||
      stableReporterKey({ launchId, outcome });

    upserts.push({
      launch_id: snapshot.launchId,
      reporter_hash: buildReporterHash(reporterKey),
      observer_location_hash: snapshot.observer.locationHash,
      observer_lat_bucket: snapshot.observer.latBucket,
      observer_lon_bucket: snapshot.observer.lonBucket,
      observer_personalized: snapshot.observer.personalized,
      outcome,
      source: normalizeSource(rawRow.source) ?? args.source,
      report_mode: snapshot.mode,
      reported_score: snapshot.score,
      reported_probability: snapshot.probability,
      calibration_band: snapshot.calibrationBand,
      model_version: snapshot.modelVersion,
      score_computed_at: snapshot.computedAt,
      trajectory_authority_tier: snapshot.trajectory?.authorityTier ?? null,
      trajectory_quality_state: snapshot.trajectory?.qualityState ?? null,
      trajectory_confidence_tier: snapshot.trajectory?.confidenceTier ?? null,
      trajectory_safe_mode: snapshot.trajectory?.safeModeActive ?? false,
      trajectory_evidence_epoch: snapshot.trajectory?.evidenceEpoch ?? null,
      reported_at: reportedAt,
      updated_at: new Date().toISOString()
    });
  }

  if (!args.dryRun && upserts.length > 0) {
    const chunkSize = 200;
    for (let index = 0; index < upserts.length; index += chunkSize) {
      const chunk = upserts.slice(index, index + chunkSize);
      const { error } = await admin.from('jep_outcome_reports').upsert(chunk, {
        onConflict: 'launch_id,observer_location_hash,reporter_hash'
      });
      if (error) throw new Error(`Failed to upsert jep_outcome_reports (${error.message})`);
    }
  }

  const summary: ImportSummary = {
    totalRows: rows.length,
    validRows: upserts.length,
    insertedRows: args.dryRun ? 0 : upserts.length,
    dryRun: args.dryRun,
    errors
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  if (!args.quiet) {
    process.stdout.write(
      [
        `Input rows: ${summary.totalRows}`,
        `Valid rows: ${summary.validRows}`,
        `Inserted rows: ${summary.insertedRows}`,
        `Dry run: ${summary.dryRun ? 'yes' : 'no'}`,
        `Errors: ${summary.errors.length}`
      ].join('\n') + '\n'
    );
    if (summary.errors.length > 0) {
      process.stdout.write(`${summary.errors.slice(0, 20).join('\n')}\n`);
    }
  }
}

void main().catch((error) => {
  console.error('jep-outcome-import failed', error);
  process.exitCode = 1;
});
