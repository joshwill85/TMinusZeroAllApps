import { config } from 'dotenv';
import { parseArgs } from 'node:util';
import { DEFAULT_TOP_IO_JOBS, computeMovement, percentile } from '@/lib/server/adminJobIo';

type IngestionRunRow = {
  id: number;
  job_name: string;
  started_at: string;
  ended_at: string | null;
  success: boolean | null;
  error: string | null;
  stats: unknown;
};

const DEFAULTS = {
  sinceHours: 72,
  limitPerJob: 200,
  timeoutMs: 20_000,
  retries: 3
};

config({ path: '.env.local' });
config();

const { values } = parseArgs({
  options: {
    sinceHours: { type: 'string', default: String(DEFAULTS.sinceHours) },
    limitPerJob: { type: 'string', default: String(DEFAULTS.limitPerJob) },
    timeoutMs: { type: 'string', default: String(DEFAULTS.timeoutMs) },
    retries: { type: 'string', default: String(DEFAULTS.retries) },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false }
  }
});

const usage = `Usage:
  ts-node --project tsconfig.scripts.json --transpile-only scripts/prod-io-top10-runs.ts \\
    --sinceHours 72 --limitPerJob 200

Notes:
  - Reads production ingestion_runs from Supabase REST.
  - Computes per-run "data moved" from each run's stats counters.
  - Movement is row/counter-based, not physical bytes.
`;

if (values.help) {
  console.log(usage);
  process.exit(0);
}

function requireEnv(name: string) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function fmtNum(value: number) {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function fmtPct(value: number) {
  if (!Number.isFinite(value)) return '0%';
  return `${value.toFixed(1)}%`;
}

async function fetchJsonWithRetry(url: string, headers: Record<string, string>, timeoutMs: number, retries: number) {
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal
      });
      clearTimeout(timer);

      const bodyText = await res.text();
      const body = bodyText ? JSON.parse(bodyText) : null;

      if (res.ok) return body;

      const message = typeof body?.message === 'string' ? body.message : `http_${res.status}`;
      lastError = `HTTP ${res.status}: ${message}`;
      if (res.status < 500 || attempt === retries) throw new Error(lastError);
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      lastError = message;
      if (attempt === retries) throw new Error(message);
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }

  throw new Error(lastError || 'unknown_fetch_error');
}

async function fetchRunsForJob(
  baseUrl: string,
  serviceRoleKey: string,
  job: string,
  sinceIso: string,
  limitPerJob: number,
  timeoutMs: number,
  retries: number
): Promise<IngestionRunRow[]> {
  const params = new URLSearchParams();
  params.set('select', 'id,job_name,started_at,ended_at,success,error,stats');
  params.set('job_name', `eq.${job}`);
  params.set('started_at', `gte.${sinceIso}`);
  params.set('order', 'started_at.desc');
  params.set('limit', String(limitPerJob));

  const url = `${baseUrl.replace(/\/$/, '')}/rest/v1/ingestion_runs?${params.toString()}`;
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Accept: 'application/json'
  };

  const rows = await fetchJsonWithRetry(url, headers, timeoutMs, retries);
  return Array.isArray(rows) ? (rows as IngestionRunRow[]) : [];
}

async function main() {
  const baseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const sinceHours = Math.max(1, Math.min(24 * 30, Number(values.sinceHours || DEFAULTS.sinceHours)));
  const limitPerJob = Math.max(1, Math.min(1000, Number(values.limitPerJob || DEFAULTS.limitPerJob)));
  const timeoutMs = Math.max(1_000, Math.min(120_000, Number(values.timeoutMs || DEFAULTS.timeoutMs)));
  const retries = Math.max(1, Math.min(8, Number(values.retries || DEFAULTS.retries)));

  const sinceIso = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

  const report = [] as Array<Record<string, unknown>>;

  for (const job of DEFAULT_TOP_IO_JOBS) {
    try {
      const rows = await fetchRunsForJob(baseUrl, serviceRoleKey, job, sinceIso, limitPerJob, timeoutMs, retries);
      const movements = rows.map((row) => ({
        runId: row.id,
        startedAt: row.started_at,
        success: row.success,
        movement: computeMovement(job, row.stats)
      }));

      const movedValues = movements.map((m) => m.movement.moved).sort((a, b) => a - b);
      const zeroMoveRuns = movedValues.filter((v) => v <= 0).length;
      const successRuns = movements.filter((m) => m.success === true).length;
      const recent = movements.slice(0, 5).map((m) => m.movement.moved);

      report.push({
        job,
        runs: movements.length,
        successRatePct: movements.length ? (successRuns / movements.length) * 100 : 0,
        avgMovedPerRun: movedValues.length ? movedValues.reduce((s, v) => s + v, 0) / movedValues.length : 0,
        p50MovedPerRun: percentile(movedValues, 0.5),
        p95MovedPerRun: percentile(movedValues, 0.95),
        zeroMoveRuns,
        zeroMoveRatePct: movements.length ? (zeroMoveRuns / movements.length) * 100 : 0,
        last5Moved: recent,
        movementSource: movements[0]?.movement.source || 'explicit',
        sampleKeys: movements[0]?.movement.keys.slice(0, 6) || []
      });
    } catch (err) {
      report.push({
        job,
        error: err instanceof Error ? err.message : String(err),
        runs: 0,
        successRatePct: 0,
        avgMovedPerRun: 0,
        p50MovedPerRun: 0,
        p95MovedPerRun: 0,
        zeroMoveRuns: 0,
        zeroMoveRatePct: 0,
        last5Moved: []
      });
    }
  }

  if (values.json) {
    console.log(JSON.stringify({ sinceIso, sinceHours, report }, null, 2));
    return;
  }

  console.log(`Window start: ${sinceIso}`);
  console.log('Movement unit: row/counter estimate from ingestion_runs.stats (not bytes).');
  console.log('');
  console.log('job\truns\tsuccess%\tavg_move\tp50\tp95\tzero_move%\tlast5\tnotes');

  for (const row of report) {
    const job = String(row.job || 'unknown');
    if (row.error) {
      console.log(`${job}\t0\t0%\t0\t0\t0\t0%\t[]\tERROR: ${String(row.error)}`);
      continue;
    }

    const last5 = Array.isArray(row.last5Moved) ? `[${row.last5Moved.map((n) => fmtNum(Number(n))).join(', ')}]` : '[]';
    const notes = Array.isArray(row.sampleKeys) ? String((row.sampleKeys as unknown[]).join(',')) : '';

    console.log(
      [
        job,
        String(row.runs || 0),
        fmtPct(Number(row.successRatePct || 0)),
        fmtNum(Number(row.avgMovedPerRun || 0)),
        fmtNum(Number(row.p50MovedPerRun || 0)),
        fmtNum(Number(row.p95MovedPerRun || 0)),
        fmtPct(Number(row.zeroMoveRatePct || 0)),
        last5,
        notes
      ].join('\t')
    );
  }

  console.log('');
  console.log('Trajectory focus checks:');
  for (const job of ['trajectory_constraints_ingest', 'trajectory_orbit_ingest', 'trajectory_products_generate']) {
    const row = report.find((r) => r.job === job);
    if (!row || row.error) {
      console.log(`- ${job}: unavailable (${row && row.error ? row.error : 'no data'})`);
      continue;
    }
    console.log(
      `- ${job}: avg=${fmtNum(Number(row.avgMovedPerRun || 0))}, p95=${fmtNum(Number(row.p95MovedPerRun || 0))}, zero-change=${fmtPct(Number(row.zeroMoveRatePct || 0))}`
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
