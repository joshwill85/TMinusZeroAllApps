import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'node:util';

type IngestionRunRow = {
  id: number;
  job_name: string;
  started_at: string;
  ended_at: string | null;
  success: boolean | null;
  error: string | null;
  stats: unknown | null;
};

type SettingRow = { key: string; value: unknown; updated_at: string | null };

config({ path: '.env.local' });
config();

const { values } = parseArgs({
  options: {
    projectRef: { type: 'string' },
    ll2LaunchUuid: { type: 'string' },
    sinceHours: { type: 'string', default: '48' },
    help: { type: 'boolean', short: 'h' }
  }
});

const usage = `Usage:
  ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/prod-pipeline-health.ts \\
    --projectRef lixuhtyqprseulhdvynq \\
    --ll2LaunchUuid 18292387-fbeb-43ac-97a0-1ade50bd68f1

Notes:
  - Reads production health via Supabase service role (no writes).
  - Prints only non-secret diagnostics (no keys/tokens).
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

function toBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const cleaned = value.trim().toLowerCase();
    if (cleaned === 'true') return true;
    if (cleaned === 'false') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

function toString(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function fmtIso(value: string | null | undefined) {
  const raw = (value || '').trim();
  if (!raw) return '—';
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return raw;
  return new Date(ms).toISOString();
}

async function main() {
  const projectRef = String(values.projectRef || '').trim() || String(process.env.SUPABASE_PROJECT_REF || '').trim();
  if (!projectRef) throw new Error('Missing --projectRef (or SUPABASE_PROJECT_REF env).');

  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const sinceHours = Math.max(1, Math.min(24 * 30, Number(values.sinceHours || 48)));
  const sinceIso = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

  const settings = await loadSettings(admin, [
    'jobs_enabled',
    'll2_incremental_use_edge_burst',
    'll2_incremental_last_success_at',
    'll2_incremental_last_error',
    'll2_payload_backfill_job_enabled',
    'll2_payload_backfill_spacecraft_only',
    'll2_payload_backfill_cursor',
    'll2_payload_backfill_offset',
    'll2_payload_backfill_done',
    'll2_payload_backfill_completed_at',
    'll2_payload_backfill_last_success_at',
    'll2_payload_backfill_last_error',
    'trajectory_orbit_job_enabled',
    'celestrak_satcat_job_enabled',
    'celestrak_intdes_job_enabled'
  ]);

  const jobLocks = await loadJobLocks(admin);
  const lastRuns = await loadRecentRuns(admin, sinceIso, [
    'ingestion_cycle',
    'll2_catalog',
    'celestrak_satcat_ingest',
    'celestrak_intdes_ingest',
    'trajectory_constraints_ingest',
    'trajectory_products_generate',
    'trajectory_orbit_ingest',
    'll2_payload_backfill_page',
    'monitoring_check'
  ]);

  const ll2LaunchUuid = String(values.ll2LaunchUuid || '').trim();
  const satelliteCount = ll2LaunchUuid ? await loadSatelliteCount(admin, ll2LaunchUuid) : null;
  const payloadKindCounts = ll2LaunchUuid ? await loadPayloadManifestKindCounts(admin, ll2LaunchUuid) : null;

  const spacecraftTables = [
    { table: 'll2_spacecraft_types', key: 'll2_spacecraft_type_id' },
    { table: 'll2_spacecraft_configs', key: 'll2_spacecraft_config_id' },
    { table: 'll2_spacecrafts', key: 'll2_spacecraft_id' },
    { table: 'll2_spacecraft_flights', key: 'll2_spacecraft_flight_id' }
  ];
  const spacecraftHasRows: Record<string, boolean> = {};
  for (const entry of spacecraftTables) {
    spacecraftHasRows[entry.table] = await tableHasAnyRow(admin, entry.table, entry.key);
  }

  console.log(`Project: ${projectRef}`);
  console.log(`Supabase URL: ${supabaseUrl}`);
  console.log('');

  console.log('Settings (high signal):');
  console.log(`- jobs_enabled: ${toBoolean(settings.get('jobs_enabled'), false)}`);
  console.log(`- ll2_incremental_use_edge_burst: ${toBoolean(settings.get('ll2_incremental_use_edge_burst'), false)}`);
  console.log(`- ll2_incremental_last_success_at: ${fmtIso(toString(settings.get('ll2_incremental_last_success_at')) || null)}`);
  console.log(`- ll2_incremental_last_error: ${toString(settings.get('ll2_incremental_last_error')) ? '(non-empty)' : '(empty)'}`);
  console.log(`- ll2_payload_backfill_job_enabled: ${toBoolean(settings.get('ll2_payload_backfill_job_enabled'), false)}`);
  console.log(`- ll2_payload_backfill_spacecraft_only: ${toBoolean(settings.get('ll2_payload_backfill_spacecraft_only'), false)}`);
  console.log(`- ll2_payload_backfill_done: ${toBoolean(settings.get('ll2_payload_backfill_done'), false)}`);
  console.log(`- ll2_payload_backfill_completed_at: ${fmtIso(toString(settings.get('ll2_payload_backfill_completed_at')) || null)}`);
  console.log(`- ll2_payload_backfill_last_success_at: ${fmtIso(toString(settings.get('ll2_payload_backfill_last_success_at')) || null)}`);
  console.log(`- ll2_payload_backfill_last_error: ${toString(settings.get('ll2_payload_backfill_last_error')) ? '(non-empty)' : '(empty)'}`);
  console.log(`- trajectory_orbit_job_enabled: ${toBoolean(settings.get('trajectory_orbit_job_enabled'), true)}`);
  console.log(`- celestrak_satcat_job_enabled: ${toBoolean(settings.get('celestrak_satcat_job_enabled'), true)}`);
  console.log(`- celestrak_intdes_job_enabled: ${toBoolean(settings.get('celestrak_intdes_job_enabled'), true)}`);
  console.log('');

  console.log('Job locks:');
  const burst = jobLocks.get('ll2_incremental_burst');
  console.log(
    `- ll2_incremental_burst: ${burst ? `locked_until=${fmtIso(burst.locked_until)} updated_at=${fmtIso(burst.updated_at)}` : 'missing'}`
  );
  console.log('');

  console.log(`Recent ingestion_runs (since ${sinceIso}):`);
  for (const [jobName, row] of lastRuns) {
    console.log(
      `- ${jobName}: ${row ? `${row.success ? 'OK' : row.success === false ? 'FAIL' : '—'} started=${fmtIso(row.started_at)} ended=${fmtIso(row.ended_at || null)}` : 'no rows'}`
    );
  }
  console.log('');

  console.log('Spacecraft manifest tables (any rows?):');
  for (const entry of spacecraftTables) {
    console.log(`- ${entry.table}: ${spacecraftHasRows[entry.table] ? 'yes' : 'no'}`);
  }
  console.log('');

  if (ll2LaunchUuid) {
    console.log(`Launch detail sanity (ll2_launch_uuid=${ll2LaunchUuid}):`);
    console.log(`- satellites via get_launch_satellite_payloads_v2 (fallback v1): ${satelliteCount == null ? '—' : satelliteCount}`);
    if (payloadKindCounts) {
      console.log(
        `- payload manifest kinds via get_launch_payload_manifest_v2 (fallback v1): payload_flight=${payloadKindCounts.payload_flight} spacecraft_flight=${payloadKindCounts.spacecraft_flight}`
      );
    }
  }
}

async function loadSettings(
  admin: ReturnType<typeof createClient>,
  keys: string[]
): Promise<Map<string, unknown>> {
  const { data, error } = await admin.from('system_settings').select('key,value,updated_at').in('key', keys);
  if (error) throw new Error(`loadSettings failed: ${error.message}`);
  const byKey = new Map<string, unknown>();
  for (const row of (data || []) as SettingRow[]) {
    if (row?.key) byKey.set(row.key, row.value);
  }
  return byKey;
}

async function loadJobLocks(admin: ReturnType<typeof createClient>) {
  const { data, error } = await admin.from('job_locks').select('lock_name,locked_until,updated_at');
  if (error) throw new Error(`loadJobLocks failed: ${error.message}`);
  const byName = new Map<string, { locked_until: string; updated_at: string }>();
  for (const row of (data || []) as any[]) {
    if (!row?.lock_name) continue;
    byName.set(row.lock_name, { locked_until: row.locked_until, updated_at: row.updated_at });
  }
  return byName;
}

async function loadRecentRuns(admin: ReturnType<typeof createClient>, sinceIso: string, jobs: string[]) {
  const { data, error } = await admin
    .from('ingestion_runs')
    .select('id,job_name,started_at,ended_at,success,error,stats')
    .gte('started_at', sinceIso)
    .in('job_name', jobs)
    .order('started_at', { ascending: false })
    .limit(500);

  if (error) throw new Error(`loadRecentRuns failed: ${error.message}`);

  const latestByName = new Map<string, IngestionRunRow>();
  for (const row of (data || []) as IngestionRunRow[]) {
    if (!latestByName.has(row.job_name)) latestByName.set(row.job_name, row);
  }

  const ordered = new Map<string, IngestionRunRow | null>();
  for (const jobName of jobs) {
    ordered.set(jobName, latestByName.get(jobName) || null);
  }
  return ordered;
}

async function tableHasAnyRow(admin: ReturnType<typeof createClient>, table: string, column: string) {
  const { data, error } = await admin.from(table).select(column).limit(1);
  if (error) throw new Error(`tableHasAnyRow failed for ${table}: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

function parseRpcArray(data: unknown) {
  if (Array.isArray(data)) return data;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function isMissingRpcFunction(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  if (error.code === '42883') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('function') && msg.includes('does not exist');
}

async function loadSatelliteCount(admin: ReturnType<typeof createClient>, ll2LaunchUuid: string) {
  let { data, error } = await admin.rpc('get_launch_satellite_payloads_v2', {
    ll2_launch_uuid_in: ll2LaunchUuid,
    include_raw: false
  });

  if (isMissingRpcFunction(error)) {
    const fallback = await admin.rpc('get_launch_satellite_payloads', { ll2_launch_uuid_in: ll2LaunchUuid });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw new Error(`loadSatelliteCount failed: ${error.message}`);
  return parseRpcArray(data).length;
}

async function loadPayloadManifestKindCounts(admin: ReturnType<typeof createClient>, ll2LaunchUuid: string) {
  let { data, error } = await admin.rpc('get_launch_payload_manifest_v2', {
    ll2_launch_uuid_in: ll2LaunchUuid,
    include_raw: false
  });

  if (isMissingRpcFunction(error)) {
    const fallback = await admin.rpc('get_launch_payload_manifest', { ll2_launch_uuid_in: ll2LaunchUuid });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw new Error(`loadPayloadManifestKindCounts failed: ${error.message}`);
  const rows = parseRpcArray(data);

  let payload_flight = 0;
  let spacecraft_flight = 0;
  for (const row of rows as any[]) {
    const kind = row?.kind;
    if (kind === 'payload_flight') payload_flight += 1;
    if (kind === 'spacecraft_flight') spacecraft_flight += 1;
  }

  return { payload_flight, spacecraft_flight };
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exitCode = 1;
});

