import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { LL2_BASE, buildLl2Headers } from '@/lib/ingestion/ll2';

config({ path: '.env.local' });
config();

type Mode = 'report' | 'backfill';

type LaunchRow = {
  launch_id: string;
  ll2_launch_uuid: string | null;
  name: string | null;
  slug: string | null;
  provider: string | null;
  net: string | null;
};

type LauncherJoinRow = {
  ll2_launcher_id: number | null;
  ll2_launch_uuid: string | null;
  launch_id: string | null;
};

type Ll2LaunchDetail = {
  id?: string;
  rocket?: {
    launcher_stage?: unknown;
  };
};

type Ll2LauncherStage = {
  launcher?: {
    id?: unknown;
    serial_number?: unknown;
    flight_proven?: unknown;
    status?: unknown;
    first_launch_date?: unknown;
    last_launch_date?: unknown;
    details?: unknown;
    image_url?: unknown;
    flights?: unknown;
    launcher_config?: unknown;
  } | null;
};

type LauncherJoinUpsertRow = {
  ll2_launcher_id: number;
  ll2_launch_uuid: string;
  launch_id: string;
};

type LauncherUpsertRow = {
  ll2_launcher_id: number;
  serial_number?: string;
  flight_proven?: boolean;
  status?: string;
  first_launch_date?: string;
  last_launch_date?: string;
  details?: string;
  image_url?: string;
  launcher_config_id?: number;
  flights?: unknown;
  fetched_at: string;
  updated_at: string;
};

type MissingLaunch = {
  launchId: string;
  ll2LaunchUuid: string;
  name: string;
  net: string | null;
  slug: string | null;
  provider: string | null;
};

const SPACEX_PROVIDER_OR_FILTER = 'provider.ilike.%SpaceX%,provider.ilike.%Space X%';
const QUERY_CHUNK_SIZE = 250;
const UPSERT_CHUNK_SIZE = 500;
const LL2_FETCH_TIMEOUT_MS = 10_000;

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'report' },
    write: { type: 'boolean', default: false },
    limit: { type: 'string', default: '2000' },
    maxLl2Fetch: { type: 'string', default: '300' },
    dateFrom: { type: 'string' },
    dateTo: { type: 'string' },
    reportOut: { type: 'string' },
    help: { type: 'boolean', short: 'h' }
  }
});

const usage = `Usage:
  # Read-only audit (default)
  ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/spacex-booster-joins-backfill.ts

  # Backfill from existing join rows + LL2 launch detail and write updates
  ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/spacex-booster-joins-backfill.ts --mode=backfill --write

Options:
  --mode=report|backfill   default: report
  --write                  required to persist writes in backfill mode
  --limit=<n>              max SpaceX launches from cache (default: 2000)
  --maxLl2Fetch=<n>        max missing launches to query from LL2 in backfill mode (default: 300)
  --dateFrom=<iso>         optional net lower bound
  --dateTo=<iso>           optional net upper bound
  --reportOut=<path>       optional JSON report output path
`;

if (values.help) {
  console.log(usage);
  process.exit(0);
}

async function main() {
  const mode = parseMode(values.mode);
  const shouldWrite = values.write === true;
  const launchLimit = parsePositiveInt(values.limit, 2000);
  const maxLl2Fetch = parsePositiveInt(values.maxLl2Fetch, 300);
  const dateFrom = normalizeOptionalString(values.dateFrom);
  const dateTo = normalizeOptionalString(values.dateTo);
  const reportOut = normalizeOptionalString(values.reportOut);

  const supabaseUrl = sanitizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);
  const serviceRoleKey = sanitizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase configuration (NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).');
  }

  if (mode === 'backfill' && !shouldWrite) {
    console.log('[spacex-booster-joins] backfill mode running in dry-run (pass --write to persist changes)');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const launches = await fetchSpaceXLaunches({ supabase, limit: launchLimit, dateFrom, dateTo });
  if (launches.length === 0) {
    console.log('[spacex-booster-joins] no SpaceX launches returned for this query window');
    return;
  }

  const launchIds = launches.map((row) => row.launch_id);
  const ll2LaunchUuids = launches
    .map((row) => normalizeOptionalString(row.ll2_launch_uuid))
    .filter((value): value is string => Boolean(value));

  const [joinsByLaunchId, joinsByLl2Uuid] = await Promise.all([
    fetchLauncherJoinsByLaunchIds(supabase, launchIds),
    fetchLauncherJoinsByLl2Uuids(supabase, ll2LaunchUuids)
  ]);

  let coveredDirect = 0;
  let missingDirectButLl2Rows = 0;
  let missingBoth = 0;

  const missingDirectRows: Array<{ launch: MissingLaunch; ll2Rows: LauncherJoinRow[] }> = [];
  const missingBothRows: MissingLaunch[] = [];

  for (const launch of launches) {
    const launchId = launch.launch_id;
    const ll2LaunchUuid = normalizeOptionalString(launch.ll2_launch_uuid) || '';
    const directRows = joinsByLaunchId.get(launchId) || [];

    if (directRows.length > 0) {
      coveredDirect += 1;
      continue;
    }

    const viaLl2Rows = ll2LaunchUuid ? joinsByLl2Uuid.get(ll2LaunchUuid) || [] : [];
    const normalizedMissingLaunch: MissingLaunch = {
      launchId,
      ll2LaunchUuid,
      name: normalizeOptionalString(launch.name) || 'Launch',
      net: normalizeOptionalString(launch.net),
      slug: normalizeOptionalString(launch.slug),
      provider: normalizeOptionalString(launch.provider)
    };

    if (viaLl2Rows.length > 0) {
      missingDirectButLl2Rows += 1;
      missingDirectRows.push({ launch: normalizedMissingLaunch, ll2Rows: viaLl2Rows });
    } else {
      missingBoth += 1;
      missingBothRows.push(normalizedMissingLaunch);
    }
  }

  const existingJoinRepairRows = buildExistingJoinRepairRows(missingDirectRows);

  const ll2Candidates =
    mode === 'backfill'
      ? missingBothRows.filter((launch) => Boolean(normalizeOptionalString(launch.ll2LaunchUuid))).slice(0, maxLl2Fetch)
      : [];
  const ll2Backfill =
    mode === 'backfill'
      ? await buildLl2BackfillRows({
          launches: ll2Candidates
        })
      : {
          joinRows: [] as LauncherJoinUpsertRow[],
          launcherRows: [] as LauncherUpsertRow[],
          unresolved: [] as MissingLaunch[],
          fetchErrors: [] as Array<{ launch: MissingLaunch; reason: string }>,
          launchesWithRecoveredBoosters: 0
        };

  const finalJoinRows = dedupeJoinRows([...existingJoinRepairRows, ...ll2Backfill.joinRows]);
  const finalLauncherRows = dedupeLauncherRows(ll2Backfill.launcherRows);

  let writtenJoinRows = 0;
  let writtenLauncherRows = 0;
  if (mode === 'backfill' && shouldWrite) {
    if (finalLauncherRows.length > 0) {
      writtenLauncherRows = await upsertLauncherRows(supabase, finalLauncherRows);
    }
    if (finalJoinRows.length > 0) {
      writtenJoinRows = await upsertJoinRows(supabase, finalJoinRows);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode,
    write: shouldWrite,
    filters: { limit: launchLimit, maxLl2Fetch, dateFrom, dateTo },
    totals: {
      launchesConsidered: launches.length,
      coveredDirect,
      missingDirectButLl2Rows,
      missingBoth,
      existingJoinRepairRows: existingJoinRepairRows.length,
      ll2Candidates: ll2Candidates.length,
      ll2RecoveredLaunches: ll2Backfill.launchesWithRecoveredBoosters,
      ll2RecoveredJoinRows: ll2Backfill.joinRows.length,
      ll2RecoveredLauncherRows: ll2Backfill.launcherRows.length,
      unresolvedAfterLl2: ll2Backfill.unresolved.length,
      ll2FetchErrors: ll2Backfill.fetchErrors.length,
      preparedJoinRowsTotal: finalJoinRows.length,
      preparedLauncherRowsTotal: finalLauncherRows.length,
      writtenJoinRows,
      writtenLauncherRows
    },
    samples: {
      missingDirectButLl2Rows: missingDirectRows.slice(0, 25).map((entry) => ({
        launchId: entry.launch.launchId,
        ll2LaunchUuid: entry.launch.ll2LaunchUuid,
        name: entry.launch.name,
        net: entry.launch.net,
        slug: entry.launch.slug,
        provider: entry.launch.provider,
        ll2Rows: entry.ll2Rows
      })),
      missingBothRows: missingBothRows.slice(0, 50),
      unresolvedAfterLl2: ll2Backfill.unresolved.slice(0, 50),
      ll2FetchErrors: ll2Backfill.fetchErrors.slice(0, 25)
    }
  };

  console.log('[spacex-booster-joins] summary');
  console.log(JSON.stringify(report.totals, null, 2));

  if (missingBothRows.length > 0) {
    console.log('[spacex-booster-joins] missing launch sample (no join rows by launch_id and ll2_launch_uuid):');
    for (const launch of missingBothRows.slice(0, 12)) {
      console.log(
        `- ${launch.net || 'n/a'} | ${launch.launchId} | ${launch.ll2LaunchUuid || 'n/a'} | ${launch.name}`
      );
    }
  }

  if (reportOut) {
    await ensureParentDir(reportOut);
    await writeFile(reportOut, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[spacex-booster-joins] wrote report: ${reportOut}`);
  }
}

async function fetchSpaceXLaunches({
  supabase,
  limit,
  dateFrom,
  dateTo
}: {
  supabase: SupabaseClient;
  limit: number;
  dateFrom: string | null;
  dateTo: string | null;
}) {
  let query = supabase
    .from('launches_public_cache')
    .select('launch_id,ll2_launch_uuid,name,slug,provider,net')
    .or(SPACEX_PROVIDER_OR_FILTER)
    .order('net', { ascending: true })
    .limit(limit);

  if (dateFrom) {
    query = query.gte('net', dateFrom);
  }
  if (dateTo) {
    query = query.lte('net', dateTo);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (Array.isArray(data) ? data : [])
    .map((row) => normalizeLaunchRow(row))
    .filter((row): row is LaunchRow => Boolean(row));
}

function normalizeLaunchRow(value: unknown): LaunchRow | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;

  const launchId = normalizeOptionalString(row.launch_id);
  if (!launchId) return null;

  return {
    launch_id: launchId,
    ll2_launch_uuid: normalizeOptionalString(row.ll2_launch_uuid),
    name: normalizeOptionalString(row.name),
    slug: normalizeOptionalString(row.slug),
    provider: normalizeOptionalString(row.provider),
    net: normalizeOptionalString(row.net)
  };
}

async function fetchLauncherJoinsByLaunchIds(supabase: SupabaseClient, launchIds: string[]) {
  const byLaunchId = new Map<string, LauncherJoinRow[]>();
  for (const chunk of chunkArray(launchIds, QUERY_CHUNK_SIZE)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from('ll2_launcher_launches')
      .select('ll2_launcher_id,ll2_launch_uuid,launch_id')
      .in('launch_id', chunk);
    if (error) throw error;

    for (const row of Array.isArray(data) ? data : []) {
      const normalized = normalizeJoinRow(row);
      if (!normalized?.launch_id) continue;
      const existing = byLaunchId.get(normalized.launch_id);
      if (existing) {
        existing.push(normalized);
      } else {
        byLaunchId.set(normalized.launch_id, [normalized]);
      }
    }
  }
  return byLaunchId;
}

async function fetchLauncherJoinsByLl2Uuids(supabase: SupabaseClient, ll2Uuids: string[]) {
  const byLl2Uuid = new Map<string, LauncherJoinRow[]>();
  for (const chunk of chunkArray(ll2Uuids, QUERY_CHUNK_SIZE)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from('ll2_launcher_launches')
      .select('ll2_launcher_id,ll2_launch_uuid,launch_id')
      .in('ll2_launch_uuid', chunk);
    if (error) throw error;

    for (const row of Array.isArray(data) ? data : []) {
      const normalized = normalizeJoinRow(row);
      if (!normalized?.ll2_launch_uuid) continue;
      const existing = byLl2Uuid.get(normalized.ll2_launch_uuid);
      if (existing) {
        existing.push(normalized);
      } else {
        byLl2Uuid.set(normalized.ll2_launch_uuid, [normalized]);
      }
    }
  }
  return byLl2Uuid;
}

function normalizeJoinRow(value: unknown): LauncherJoinRow | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const launcherId = toFiniteInt(row.ll2_launcher_id);
  return {
    ll2_launcher_id: launcherId,
    ll2_launch_uuid: normalizeOptionalString(row.ll2_launch_uuid),
    launch_id: normalizeOptionalString(row.launch_id)
  };
}

function buildExistingJoinRepairRows(
  rows: Array<{ launch: MissingLaunch; ll2Rows: LauncherJoinRow[] }>
): LauncherJoinUpsertRow[] {
  const repairRows: LauncherJoinUpsertRow[] = [];
  for (const entry of rows) {
    for (const join of entry.ll2Rows) {
      const launcherId = toFiniteInt(join.ll2_launcher_id);
      const ll2LaunchUuid = normalizeOptionalString(join.ll2_launch_uuid) || entry.launch.ll2LaunchUuid;
      if (!launcherId || !ll2LaunchUuid) continue;
      repairRows.push({
        ll2_launcher_id: launcherId,
        ll2_launch_uuid: ll2LaunchUuid,
        launch_id: entry.launch.launchId
      });
    }
  }
  return repairRows;
}

async function buildLl2BackfillRows({
  launches
}: {
  launches: MissingLaunch[];
}) {
  const joinRows: LauncherJoinUpsertRow[] = [];
  const launcherRows: LauncherUpsertRow[] = [];
  const unresolved: MissingLaunch[] = [];
  const fetchErrors: Array<{ launch: MissingLaunch; reason: string }> = [];

  let launchesWithRecoveredBoosters = 0;

  for (const launch of launches) {
    const ll2LaunchUuid = normalizeOptionalString(launch.ll2LaunchUuid);
    if (!ll2LaunchUuid) {
      unresolved.push(launch);
      continue;
    }

    const detail = await fetchLl2LaunchDetail(ll2LaunchUuid);
    if (!detail.ok) {
      fetchErrors.push({ launch, reason: detail.reason });
      unresolved.push(launch);
      continue;
    }

    const stages = parseLauncherStages(detail.data);
    let launchRecoveredRows = 0;
    const nowIso = new Date().toISOString();

    for (const stage of stages) {
      const launcher = stage.launcher;
      const launcherId = toFiniteInt(launcher?.id);
      if (!launcherId) continue;

      joinRows.push({
        ll2_launcher_id: launcherId,
        ll2_launch_uuid: ll2LaunchUuid,
        launch_id: launch.launchId
      });

      const launcherRow = toLauncherUpsertRow(launcher, nowIso);
      if (launcherRow) launcherRows.push(launcherRow);
      launchRecoveredRows += 1;
    }

    if (launchRecoveredRows > 0) {
      launchesWithRecoveredBoosters += 1;
    } else {
      unresolved.push(launch);
    }
  }

  return {
    joinRows,
    launcherRows,
    unresolved,
    fetchErrors,
    launchesWithRecoveredBoosters
  };
}

async function fetchLl2LaunchDetail(
  ll2LaunchUuid: string
): Promise<{ ok: true; data: Ll2LaunchDetail } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('ll2_detail_timeout'), LL2_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${LL2_BASE}/launches/${encodeURIComponent(ll2LaunchUuid)}/?mode=detailed`, {
      headers: buildLl2Headers(),
      signal: controller.signal
    });

    if (response.status === 404) return { ok: false, reason: 'not_found' };
    if (response.status === 429) return { ok: false, reason: 'rate_limited' };
    if (response.status >= 500) return { ok: false, reason: `server_${response.status}` };
    if (!response.ok) return { ok: false, reason: `http_${response.status}` };

    const json = (await response.json().catch(() => null)) as Ll2LaunchDetail | null;
    if (!json || typeof json !== 'object') return { ok: false, reason: 'invalid_json' };

    return { ok: true, data: json };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `fetch_error:${message}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseLauncherStages(detail: Ll2LaunchDetail): Ll2LauncherStage[] {
  const stagesRaw = detail?.rocket?.launcher_stage;
  if (!Array.isArray(stagesRaw)) return [];
  return stagesRaw.filter((value): value is Ll2LauncherStage => Boolean(value && typeof value === 'object'));
}

function toLauncherUpsertRow(launcher: Ll2LauncherStage['launcher'], nowIso: string): LauncherUpsertRow | null {
  const launcherId = toFiniteInt(launcher?.id);
  if (!launcherId) return null;

  const row: LauncherUpsertRow = {
    ll2_launcher_id: launcherId,
    fetched_at: nowIso,
    updated_at: nowIso
  };

  const serialNumber = normalizeOptionalString(launcher?.serial_number);
  if (serialNumber) row.serial_number = serialNumber;

  if (typeof launcher?.flight_proven === 'boolean') {
    row.flight_proven = launcher.flight_proven;
  }

  const status = normalizeLauncherStatus(launcher?.status);
  if (status) row.status = status;

  const firstLaunchDate = normalizeDateOnly(launcher?.first_launch_date);
  if (firstLaunchDate) row.first_launch_date = firstLaunchDate;

  const lastLaunchDate = normalizeDateOnly(launcher?.last_launch_date);
  if (lastLaunchDate) row.last_launch_date = lastLaunchDate;

  const details = normalizeOptionalString(launcher?.details);
  if (details) row.details = details;

  const imageUrl = normalizeOptionalString(launcher?.image_url);
  if (imageUrl) row.image_url = imageUrl;

  const launcherConfigId = normalizeLauncherConfigId(launcher?.launcher_config);
  if (launcherConfigId) row.launcher_config_id = launcherConfigId;

  if (launcher?.flights != null) row.flights = launcher.flights;

  return row;
}

function normalizeLauncherStatus(value: unknown): string | null {
  if (typeof value === 'string') return normalizeOptionalString(value);
  if (!value || typeof value !== 'object') return null;

  const asRecord = value as Record<string, unknown>;
  return normalizeOptionalString(asRecord.name) || normalizeOptionalString(asRecord.abbrev);
}

function normalizeLauncherConfigId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (!value || typeof value !== 'object') return null;
  const configId = toFiniteInt((value as Record<string, unknown>).id);
  return configId;
}

function dedupeJoinRows(rows: LauncherJoinUpsertRow[]): LauncherJoinUpsertRow[] {
  const deduped = new Map<string, LauncherJoinUpsertRow>();
  for (const row of rows) {
    const key = `${row.ll2_launcher_id}:${row.ll2_launch_uuid}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, row);
      continue;
    }

    if (existing.launch_id !== row.launch_id) {
      // Keep the first row deterministically to avoid accidental reassignment collisions.
      continue;
    }
  }
  return [...deduped.values()];
}

function dedupeLauncherRows(rows: LauncherUpsertRow[]) {
  const deduped = new Map<number, LauncherUpsertRow>();
  for (const row of rows) {
    const existing = deduped.get(row.ll2_launcher_id);
    if (!existing) {
      deduped.set(row.ll2_launcher_id, row);
      continue;
    }
    deduped.set(row.ll2_launcher_id, mergeLauncherRows(existing, row));
  }
  return [...deduped.values()];
}

function mergeLauncherRows(left: LauncherUpsertRow, right: LauncherUpsertRow): LauncherUpsertRow {
  return {
    ll2_launcher_id: left.ll2_launcher_id,
    serial_number: right.serial_number || left.serial_number,
    flight_proven: typeof right.flight_proven === 'boolean' ? right.flight_proven : left.flight_proven,
    status: right.status || left.status,
    first_launch_date: right.first_launch_date || left.first_launch_date,
    last_launch_date: right.last_launch_date || left.last_launch_date,
    details: right.details || left.details,
    image_url: right.image_url || left.image_url,
    launcher_config_id: right.launcher_config_id || left.launcher_config_id,
    flights: right.flights ?? left.flights,
    fetched_at: right.fetched_at,
    updated_at: right.updated_at
  };
}

async function upsertJoinRows(supabase: SupabaseClient, rows: LauncherJoinUpsertRow[]) {
  let written = 0;
  for (const chunk of chunkArray(rows, UPSERT_CHUNK_SIZE)) {
    if (chunk.length === 0) continue;
    const { error } = await supabase
      .from('ll2_launcher_launches')
      .upsert(chunk, { onConflict: 'll2_launcher_id,ll2_launch_uuid' });
    if (error) throw error;
    written += chunk.length;
  }
  return written;
}

async function upsertLauncherRows(supabase: SupabaseClient, rows: LauncherUpsertRow[]) {
  let written = 0;
  for (const chunk of chunkArray(rows, UPSERT_CHUNK_SIZE)) {
    if (chunk.length === 0) continue;
    const { error } = await supabase.from('ll2_launchers').upsert(chunk, { onConflict: 'll2_launcher_id' });
    if (error) throw error;
    written += chunk.length;
  }
  return written;
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function parseMode(value: string | undefined): Mode {
  if (value === 'report' || value === 'backfill') return value;
  throw new Error(`Invalid --mode value: ${String(value)} (expected report|backfill)`);
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function sanitizeEnvValue(value: string | undefined) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    return normalized.slice(1, -1).trim();
  }
  return normalized;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeDateOnly(value: unknown): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function toFiniteInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

async function ensureParentDir(filePath: string) {
  await mkdir(dirname(filePath), { recursive: true });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[spacex-booster-joins] fatal', message);
  process.exit(1);
});
