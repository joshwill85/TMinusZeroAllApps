import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';
import { buildUrl, CELESTRAK_SATCAT_ENDPOINT, DEFAULT_CELESTRAK_USER_AGENT, fetchJsonWithRetries } from '../_shared/celestrak.ts';

const USER_AGENT = Deno.env.get('CELESTRAK_USER_AGENT') || DEFAULT_CELESTRAK_USER_AGENT;

const DEFAULTS = {
  maxDatasetsPerRun: 6,
  upsertChunkSize: 500
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'celestrak_satcat_ingest');

  const stats: Record<string, unknown> = {
    datasetsClaimed: 0,
    datasetsProcessed: 0,
    satellitesUpserted: 0,
    errors: [] as Array<{ datasetKey: string; code: string; error: string }>
  };

  try {
    const settings = await getSettings(supabase, ['celestrak_satcat_job_enabled', 'celestrak_satcat_max_datasets_per_run']);
    const enabled = readBooleanSetting(settings.celestrak_satcat_job_enabled, true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled' });
    }

    const maxDatasets = clampInt(
      readNumberSetting(settings.celestrak_satcat_max_datasets_per_run, DEFAULTS.maxDatasetsPerRun),
      1,
      25
    );

    const { data: claimed, error: claimError } = await supabase.rpc('claim_celestrak_datasets', {
      dataset_type_filter: 'satcat',
      batch_size: maxDatasets
    });
    if (claimError) throw claimError;

    const datasets = Array.isArray(claimed) ? claimed : [];
    stats.datasetsClaimed = datasets.length;

    if (!datasets.length) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'no_due_datasets' });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_due_datasets' });
    }

    const fetchedAt = new Date().toISOString();

    for (const dataset of datasets) {
      const datasetKey = String(dataset?.dataset_key || '');
      const code = String(dataset?.code || '');
      try {
        if (!datasetKey || !code) throw new Error('invalid_dataset_row');

        const query = buildSatcatQuery(dataset);
        const result = await ingestSatcatGroup({ supabase, datasetKey, code, query, fetchedAt });
        stats.datasetsProcessed = (stats.datasetsProcessed as number) + 1;
        stats.satellitesUpserted = (stats.satellitesUpserted as number) + result.satellitesUpserted;

        await markDatasetSuccess(supabase, datasetKey, fetchedAt, 200);
      } catch (err) {
        const message = stringifyError(err);
        (stats.errors as Array<any>).push({ datasetKey, code, error: message });
        await markDatasetFailure(supabase, datasetKey, dataset, message);
      }
    }

    const ok = (stats.errors as Array<any>).length === 0;
    await finishIngestionRun(supabase, runId, ok, { ...stats, elapsedMs: Date.now() - startedAt }, ok ? undefined : 'partial_failure');
    return jsonResponse({ ok, stats });
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, { ...stats, error: message }, message);
    return jsonResponse({ ok: false, error: message, stats }, 500);
  }
});

function buildSatcatQuery(dataset: any): Record<string, unknown> {
  const q = dataset?.query;
  if (q && typeof q === 'object' && !Array.isArray(q)) return q as Record<string, unknown>;
  return { GROUP: dataset?.code, ONORBIT: 1 };
}

async function ingestSatcatGroup({
  supabase,
  datasetKey,
  code,
  query,
  fetchedAt
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  datasetKey: string;
  code: string;
  query: Record<string, unknown>;
  fetchedAt: string;
}) {
  const url = buildUrl(CELESTRAK_SATCAT_ENDPOINT, { ...query, FORMAT: 'JSON' });
  const res = await fetchJsonWithRetries<any[]>(url, { headers: { 'User-Agent': USER_AGENT, accept: 'application/json' } }, { retries: 3, backoffMs: 1250 });
  if (!res.ok) {
    const trimmed = (res.text || '').trim();
    if (res.status === 200 && /no satcat records found/i.test(trimmed)) {
      return { satellitesUpserted: 0, datasetKey, code };
    }
    const snippet = res.text ? res.text.slice(0, 220).replace(/\s+/g, ' ').trim() : '';
    throw new Error(`celestrak_satcat_${code}_${res.status}:${snippet || res.error}`);
  }

  if (!Array.isArray(res.data)) {
    throw new Error(`celestrak_satcat_${code}_invalid_json_shape`);
  }

  const satellites = new Map<string, any>();

  for (const item of res.data) {
    const normalized = normalizeSatcatRecord(item);
    const norad = normalized.norad_cat_id;
    if (!norad) continue;
    satellites.set(norad, { ...normalized, satcat_updated_at: fetchedAt, updated_at: fetchedAt });
  }

  const rows = [...satellites.values()];
  await upsertSatcatSatellitesIfChangedInChunks(supabase, rows, DEFAULTS.upsertChunkSize);
  return { satellitesUpserted: rows.length, datasetKey, code };
}

async function markDatasetSuccess(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  datasetKey: string,
  nowIso: string,
  httpStatus: number
) {
  await supabase
    .from('celestrak_datasets')
    .update({
      last_success_at: nowIso,
      consecutive_failures: 0,
      last_http_status: httpStatus,
      last_error: null,
      updated_at: nowIso
    })
    .eq('dataset_key', datasetKey);
}

async function markDatasetFailure(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  datasetKey: string,
  dataset: any,
  errorMessage: string
) {
  const nowIso = new Date().toISOString();
  const statusMatch = errorMessage.match(/_(\d{3})(:|$)/);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : null;
  const failures = clampInt(Number(dataset?.consecutive_failures || 0) + 1, 0, 999999);

  await supabase
    .from('celestrak_datasets')
    .update({
      consecutive_failures: failures,
      last_http_status: httpStatus,
      last_error: errorMessage.slice(0, 500),
      updated_at: nowIso
    })
    .eq('dataset_key', datasetKey);
}

async function startIngestionRun(supabase: ReturnType<typeof createSupabaseAdminClient>, jobName: string) {
  const { data, error } = await supabase.from('ingestion_runs').insert({ job_name: jobName }).select('id').single();
  if (error || !data) {
    console.warn('Failed to start ingestion_runs record', { jobName, error: error?.message });
    return { runId: null as number | null };
  }
  return { runId: data.id as number };
}

async function finishIngestionRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: number | null,
  success: boolean,
  stats?: Record<string, unknown>,
  error?: string
) {
  if (runId == null) return;
  const { error: updateError } = await supabase
    .from('ingestion_runs')
    .update({
      ended_at: new Date().toISOString(),
      success,
      stats: stats ?? null,
      error: error ?? null
    })
    .eq('id', runId);
  if (updateError) {
    console.warn('Failed to update ingestion_runs record', { runId, updateError: updateError.message });
  }
}

function parseNoradCatId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\\d{1,9}$/.test(trimmed)) return trimmed.replace(/^0+/, '') || '0';
  }
  return null;
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeDateForPg(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function chunkArray<T>(items: T[], size: number) {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function upsertInChunks(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  rows: any[],
  { onConflict, ignoreDuplicates }: { onConflict: string; ignoreDuplicates: boolean }
) {
  if (!rows.length) return;
  const chunks = chunkArray(rows, DEFAULTS.upsertChunkSize);
  for (const chunk of chunks) {
    const { error } = await supabase.from(table).upsert(chunk, { onConflict, ignoreDuplicates });
    if (error) throw error;
  }
}

async function upsertSatcatSatellitesIfChangedInChunks(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: any[],
  chunkSize: number
) {
  if (!rows.length) return;
  const chunks = chunkArray(rows, chunkSize);
  for (const chunk of chunks) {
    const { error } = await supabase.rpc('upsert_satellites_satcat_if_changed', { rows_in: chunk });
    if (!error) continue;

    // Backward-compatible fallback when RPC is not yet deployed.
    console.warn('upsert_satellites_satcat_if_changed RPC failed; falling back to direct upsert', error);
    await upsertInChunks(supabase, 'satellites', chunk, { onConflict: 'norad_cat_id', ignoreDuplicates: false });
  }
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') return JSON.stringify(err);
  return String(err);
}

function normalizeSatcatRecord(item: any) {
  const norad = parseNoradCatId(item?.NORAD_CAT_ID);
  return {
    norad_cat_id: norad,
    intl_des: normalizeSatcatText(item?.OBJECT_ID),
    object_name: normalizeSatcatText(item?.OBJECT_NAME),
    object_type: normalizeSatcatObjectType(item?.OBJECT_TYPE),
    ops_status_code: normalizeSatcatText(item?.OPS_STATUS_CODE),
    owner: normalizeSatcatText(item?.OWNER),
    launch_date: normalizeDateForPg(item?.LAUNCH_DATE),
    launch_site: normalizeSatcatText(item?.LAUNCH_SITE),
    decay_date: normalizeDateForPg(item?.DECAY_DATE),
    period_min: parseFiniteNumber(item?.PERIOD),
    inclination_deg: parseFiniteNumber(item?.INCLINATION),
    apogee_km: parseFiniteNumber(item?.APOGEE),
    perigee_km: parseFiniteNumber(item?.PERIGEE),
    rcs_m2: parseFiniteNumber(item?.RCS),
    raw_satcat: item
  };
}

function normalizeSatcatText(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeSatcatObjectType(value: unknown): 'PAY' | 'RB' | 'DEB' | 'UNK' {
  if (typeof value !== 'string') return 'UNK';
  const normalized = value.trim().toUpperCase();
  if (normalized === 'R/B') return 'RB';
  if (normalized === 'PAY' || normalized === 'RB' || normalized === 'DEB') return normalized;
  return 'UNK';
}
