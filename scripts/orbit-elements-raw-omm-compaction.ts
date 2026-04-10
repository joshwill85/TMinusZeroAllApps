import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { Client } from 'pg';
import { ORBIT_OMM_DUPLICATED_KEYS } from '../supabase/functions/_shared/celestrak';

config({ path: '.env.local' });
config();

const DUPLICATED_KEYS = [...ORBIT_OMM_DUPLICATED_KEYS];

type Mode = 'report' | 'backfill';

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'report' },
    write: { type: 'boolean', default: false },
    batchSize: { type: 'string', default: '25000' },
    maxBatches: { type: 'string', default: '100' },
    pauseMs: { type: 'string', default: '100' },
    help: { type: 'boolean', short: 'h' }
  }
});

const usage = `Usage:
  # Report how many orbit_elements rows still contain duplicated raw_omm keys
  ts-node --project tsconfig.scripts.json --transpile-only scripts/orbit-elements-raw-omm-compaction.ts

  # Compact existing rows in batches (requires --write)
  ts-node --project tsconfig.scripts.json --transpile-only scripts/orbit-elements-raw-omm-compaction.ts --mode=backfill --write

Options:
  --mode=report|backfill   default: report
  --write                  required to persist updates in backfill mode
  --batchSize=25000        rows per update batch
  --maxBatches=100         max write batches per run
  --pauseMs=100            delay between write batches
`;

if (values.help) {
  console.log(usage);
  process.exit(0);
}

function parseMode(raw: string | undefined): Mode {
  return raw === 'backfill' ? 'backfill' : 'report';
}

function parsePositiveInt(raw: string | undefined, fallback: number, { min = 1, max = 1_000_000 } = {}) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function resolveProjectId() {
  const direct = process.env.SUPABASE_PROJECT_ID?.trim();
  if (direct) return direct;

  for (const rawUrl of [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_URL]) {
    if (!rawUrl) continue;
    const normalized = rawUrl.trim();
    if (!normalized) continue;

    try {
      const host = new URL(normalized).hostname;
      const ref = host.replace(/\.supabase\.co$/i, '').trim();
      if (ref && ref !== host) return ref;
    } catch {
      continue;
    }
  }

  return null;
}

function buildDatabaseUrl() {
  const direct = process.env.DATABASE_URL?.trim();
  if (direct) return direct;

  const projectId = resolveProjectId();
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  if (!projectId || !password) {
    throw new Error(
      'Missing DATABASE_URL (or SUPABASE_DB_PASSWORD plus a project ref from SUPABASE_PROJECT_ID/NEXT_PUBLIC_SUPABASE_URL/EXPO_PUBLIC_SUPABASE_URL).'
    );
  }

  const encoded = encodeURIComponent(password);
  return `postgresql://postgres:${encoded}@db.${projectId}.supabase.co:5432/postgres?sslmode=require`;
}

function shouldUseSsl(databaseUrl: string) {
  return databaseUrl.includes('sslmode=require') || databaseUrl.includes('.supabase.co');
}

async function sleep(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSummary(client: Client) {
  const result = await client.query<{
    rows_needing_compaction: string;
    total_rows: string;
    avg_raw_omm_bytes: string | null;
    avg_trimmed_raw_omm_bytes: string | null;
    avg_bytes_saved_per_row: string | null;
  }>(
    `
      with sample as (
        select raw_omm
        from public.orbit_elements tablesample system (0.5)
        where jsonb_typeof(raw_omm) = 'object'
          and raw_omm ?| $1::text[]
      )
      select
        (select count(*)::bigint
         from public.orbit_elements
         where jsonb_typeof(raw_omm) = 'object'
           and raw_omm ?| $1::text[])::text as rows_needing_compaction,
        (select count(*)::bigint from public.orbit_elements)::text as total_rows,
        (select round(avg(pg_column_size(raw_omm))::numeric, 1)::text from sample) as avg_raw_omm_bytes,
        (select round(avg(pg_column_size(raw_omm - $1::text[]))::numeric, 1)::text from sample) as avg_trimmed_raw_omm_bytes,
        (select round(avg(pg_column_size(raw_omm) - pg_column_size(raw_omm - $1::text[]))::numeric, 1)::text from sample) as avg_bytes_saved_per_row
    `,
    [DUPLICATED_KEYS]
  );

  return result.rows[0];
}

async function compactBatch(client: Client, batchSize: number) {
  const result = await client.query(
    `
      with candidates as (
        select id
        from public.orbit_elements
        where jsonb_typeof(raw_omm) = 'object'
          and raw_omm ?| $1::text[]
        order by id asc
        limit $2
      )
      update public.orbit_elements oe
      set raw_omm = oe.raw_omm - $1::text[]
      from candidates
      where oe.id = candidates.id
    `,
    [DUPLICATED_KEYS, batchSize]
  );
  return result.rowCount ?? 0;
}

async function querySingleValue<T extends Record<string, unknown>>(client: Client, sql: string, valuesIn: unknown[] = []) {
  const result = await client.query<T>(sql, valuesIn);
  return result.rows[0] ?? null;
}

async function main() {
  const mode = parseMode(values.mode);
  const shouldWrite = values.write === true;
  const batchSize = parsePositiveInt(values.batchSize, 25_000, { min: 100, max: 250_000 });
  const maxBatches = parsePositiveInt(values.maxBatches, 100, { min: 1, max: 10_000 });
  const pauseMs = parsePositiveInt(values.pauseMs, 100, { min: 0, max: 60_000 });

  if (mode === 'backfill' && !shouldWrite) {
    console.log('[orbit-elements-raw-omm] backfill mode is dry-run; pass --write to persist changes');
  }

  const databaseUrl = buildDatabaseUrl();
  const ssl = shouldUseSsl(databaseUrl) ? { rejectUnauthorized: false } : undefined;
  const client = new Client({ connectionString: databaseUrl, ssl, application_name: 'orbit-elements-raw-omm-compaction' });

  try {
    await client.connect();
    await client.query(`set lock_timeout = '2s'`);
    await client.query(`set statement_timeout = '10min'`);

    const before = await fetchSummary(client);
    const rowsNeeding = Number(before?.rows_needing_compaction || 0);
    const totalRows = Number(before?.total_rows || 0);
    const avgSaved = Number(before?.avg_bytes_saved_per_row || 0);
    const estimatedBytes = Number.isFinite(avgSaved) ? Math.round(rowsNeeding * avgSaved) : 0;

    console.log('[orbit-elements-raw-omm] summary before');
    console.table([
      {
        rowsNeedingCompaction: rowsNeeding,
        totalRows,
        avgRawOmmBytes: before?.avg_raw_omm_bytes ?? 'n/a',
        avgTrimmedRawOmmBytes: before?.avg_trimmed_raw_omm_bytes ?? 'n/a',
        avgBytesSavedPerRow: before?.avg_bytes_saved_per_row ?? 'n/a',
        estimatedLogicalSavingsMb: estimatedBytes ? (estimatedBytes / 1024 / 1024).toFixed(1) : 'n/a'
      }
    ]);

    if (mode !== 'backfill' || !shouldWrite || rowsNeeding === 0) {
      return;
    }

    let totalUpdated = 0;
    let batches = 0;
    while (batches < maxBatches) {
      const updated = await compactBatch(client, batchSize);
      batches += 1;
      totalUpdated += updated;
      console.log(`[orbit-elements-raw-omm] batch ${batches}: updated ${updated} rows`);
      if (updated < batchSize) break;
      if (pauseMs > 0) await sleep(pauseMs);
    }

    const after = await fetchSummary(client);
    console.log('[orbit-elements-raw-omm] summary after');
    console.table([
      {
        rowsUpdated: totalUpdated,
        batches,
        rowsRemaining: Number(after?.rows_needing_compaction || 0),
        totalRows: Number(after?.total_rows || 0),
        avgRawOmmBytes: after?.avg_raw_omm_bytes ?? 'n/a',
        avgTrimmedRawOmmBytes: after?.avg_trimmed_raw_omm_bytes ?? 'n/a',
        avgBytesSavedPerRow: after?.avg_bytes_saved_per_row ?? 'n/a'
      }
    ]);

    const dbSize = await querySingleValue<{ db_size_pretty: string; db_size_bytes: string }>(
      client,
      `select pg_size_pretty(pg_database_size(current_database())) as db_size_pretty, pg_database_size(current_database())::text as db_size_bytes`
    );
    if (dbSize) {
      console.log('[orbit-elements-raw-omm] note: physical DB size will not shrink until the table is rewritten or repacked');
      console.table([dbSize]);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
