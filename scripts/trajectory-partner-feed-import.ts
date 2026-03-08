import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import {
  buildPartnerTrajectoryConstraintRow,
  normalizePartnerTrajectoryFeedInput,
  type PartnerTrajectoryConstraintRow
} from '@/lib/trajectory/partnerFeedAdapter';

config({ path: '.env.local' });
config();

type CliArgs = {
  inputPath: string;
  dryRun: boolean;
  json: boolean;
  quiet: boolean;
};

type ImportSummary = {
  totalRows: number;
  validRows: number;
  insertedOrUpdatedRows: number;
  dryRun: boolean;
  usedFallback: boolean;
  errors: string[];
};

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const inputPath = value('--input=');
  if (!inputPath) throw new Error('Missing required --input=path argument.');
  return {
    inputPath,
    dryRun: args.includes('--dry-run'),
    json: args.includes('--json'),
    quiet: args.includes('--quiet')
  };
}

function resolvePath(pathArg: string) {
  return path.resolve(process.cwd(), pathArg);
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
  if (!rows.length) return [];

  const headers = rows[0]!.map((entry) => entry.trim());
  return rows.slice(1).map((entries) => {
    const mapped: Record<string, string> = {};
    headers.forEach((header, index) => {
      mapped[header] = entries[index] ?? '';
    });
    return mapped;
  });
}

function readInputRows(inputPath: string) {
  const fullPath = resolvePath(inputPath);
  const raw = fs.readFileSync(fullPath, 'utf8');
  if (fullPath.endsWith('.json')) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('JSON input must be an array of rows.');
    return parsed as Array<Record<string, unknown>>;
  }
  if (fullPath.endsWith('.csv')) {
    return parseCsv(raw) as Array<Record<string, unknown>>;
  }
  throw new Error('Unsupported input format. Use .json or .csv.');
}

async function upsertTrajectoryConstraintsIfChanged(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: Array<Record<string, unknown>>
) {
  const { data, error } = await supabase.rpc('upsert_launch_trajectory_constraints_if_changed', {
    rows_in: rows
  });
  if (!error) {
    const stats = asObject(data);
    const inserted = readInt(stats.inserted);
    const updated = readInt(stats.updated);
    return {
      touched: inserted + updated,
      usedFallback: false
    };
  }

  const { data: fallbackRows, error: fallbackError } = await supabase
    .from('launch_trajectory_constraints')
    .upsert(rows, { onConflict: 'launch_id,source,constraint_type,source_id' })
    .select('id');
  if (fallbackError) throw fallbackError;
  return {
    touched: Array.isArray(fallbackRows) ? fallbackRows.length : rows.length,
    usedFallback: true
  };
}

function asObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readInt(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return 0;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    throw new Error('Supabase env is not configured for partner trajectory import.');
  }

  const inputRows = readInputRows(args.inputPath);
  const errors: string[] = [];
  const normalizedRows: PartnerTrajectoryConstraintRow[] = [];

  for (const [index, rawRow] of inputRows.entries()) {
    const normalized = normalizePartnerTrajectoryFeedInput(rawRow);
    if (!normalized) {
      errors.push(`row ${index + 1}: invalid or incomplete partner trajectory payload`);
      continue;
    }
    normalizedRows.push(buildPartnerTrajectoryConstraintRow(normalized));
  }

  let touched = 0;
  let usedFallback = false;
  if (!args.dryRun && normalizedRows.length > 0) {
    const supabase = createSupabaseAdminClient();
    const result = await upsertTrajectoryConstraintsIfChanged(supabase, normalizedRows);
    touched = result.touched;
    usedFallback = result.usedFallback;
  }

  const summary: ImportSummary = {
    totalRows: inputRows.length,
    validRows: normalizedRows.length,
    insertedOrUpdatedRows: args.dryRun ? 0 : touched,
    dryRun: args.dryRun,
    usedFallback,
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
        `Inserted/updated rows: ${summary.insertedOrUpdatedRows}`,
        `Dry run: ${summary.dryRun ? 'yes' : 'no'}`,
        `Fallback upsert used: ${summary.usedFallback ? 'yes' : 'no'}`,
        `Errors: ${summary.errors.length}`
      ].join('\n') + '\n'
    );
    if (summary.errors.length > 0) {
      process.stdout.write(`${summary.errors.slice(0, 20).join('\n')}\n`);
    }
  }
}

void main().catch((error) => {
  console.error('trajectory-partner-feed-import failed', error);
  process.exitCode = 1;
});
