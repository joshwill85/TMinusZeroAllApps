import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';
import { buildUrl, CELESTRAK_SATCAT_ENDPOINT, DEFAULT_CELESTRAK_USER_AGENT, fetchJsonWithRetries } from '../_shared/celestrak.ts';

const USER_AGENT = Deno.env.get('CELESTRAK_USER_AGENT') || DEFAULT_CELESTRAK_USER_AGENT;

const DEFAULTS = {
  maxDesignatorsPerRun: 25,
  upsertChunkSize: 500
};

type LaunchInventoryItemRow = {
  object_id: string;
  norad_cat_id: number | null;
  object_name: string | null;
  object_type: 'PAY' | 'RB' | 'DEB' | 'UNK';
  ops_status_code: string | null;
  owner: string | null;
  launch_date: string | null;
  launch_site: string | null;
  decay_date: string | null;
  period_min: number | null;
  inclination_deg: number | null;
  apogee_km: number | null;
  perigee_km: number | null;
  rcs_m2: number | null;
  data_status_code: string | null;
  orbit_center: string | null;
  orbit_type: string | null;
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'celestrak_intdes_ingest');

  const stats: Record<string, unknown> = {
    designatorsClaimed: 0,
    designatorsProcessed: 0,
    satellitesUpserted: 0,
    snapshotsCreated: 0,
    snapshotItemsInserted: 0,
    unchangedSnapshots: 0,
    errors: [] as Array<{ launchDesignator: string; error: string }>
  };

  try {
    const settings = await getSettings(supabase, ['celestrak_intdes_job_enabled', 'celestrak_intdes_max_designators_per_run']);
    const enabled = readBooleanSetting(settings.celestrak_intdes_job_enabled, true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled' });
    }

    const maxDesignators = clampInt(
      readNumberSetting(settings.celestrak_intdes_max_designators_per_run, DEFAULTS.maxDesignatorsPerRun),
      1,
      200
    );

    const { data: claimed, error: claimError } = await supabase.rpc('claim_celestrak_intdes_datasets', {
      batch_size: maxDesignators
    });
    if (claimError) throw claimError;

    const datasets = Array.isArray(claimed) ? claimed : [];
    stats.designatorsClaimed = datasets.length;

    if (!datasets.length) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'no_due_designators' });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_due_designators' });
    }

    const fetchedAt = new Date().toISOString();

    for (const dataset of datasets) {
      const launchDesignator = typeof dataset?.launch_designator === 'string' ? dataset.launch_designator.trim() : '';
      try {
        if (!launchDesignator) throw new Error('invalid_launch_designator');

        const result = await ingestSatcatByIntdes({ supabase, launchDesignator, fetchedAt });
        stats.designatorsProcessed = (stats.designatorsProcessed as number) + 1;
        stats.satellitesUpserted = (stats.satellitesUpserted as number) + result.satellitesUpserted;
        stats.snapshotsCreated = (stats.snapshotsCreated as number) + result.snapshotsCreated;
        stats.snapshotItemsInserted = (stats.snapshotItemsInserted as number) + result.snapshotItemsInserted;
        stats.unchangedSnapshots = (stats.unchangedSnapshots as number) + (result.snapshotChanged ? 0 : 1);

        await markDatasetSuccess(supabase, launchDesignator, fetchedAt, 200, {
          catalogState: result.catalogState,
          latestSnapshotId: result.latestSnapshotId,
          latestSnapshotHash: result.latestSnapshotHash,
          lastNonEmptyAt: result.lastNonEmptyAt
        });
      } catch (err) {
        const message = stringifyError(err);
        (stats.errors as Array<any>).push({ launchDesignator, error: message });
        await markDatasetFailure(supabase, launchDesignator, dataset, message);
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

async function ingestSatcatByIntdes({
  supabase,
  launchDesignator,
  fetchedAt
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  launchDesignator: string;
  fetchedAt: string;
}) {
  const url = buildUrl(CELESTRAK_SATCAT_ENDPOINT, { INTDES: launchDesignator, FORMAT: 'JSON' });
  const payloadOnlyUrl = buildUrl(CELESTRAK_SATCAT_ENDPOINT, { INTDES: launchDesignator, PAYLOADS: 1, FORMAT: 'JSON' });

  const res = await fetchJsonWithRetries<any[]>(
    url,
    { headers: { 'User-Agent': USER_AGENT, accept: 'application/json' } },
    { retries: 3, backoffMs: 1250 }
  );
  if (!res.ok) {
    const trimmed = (res.text || '').trim();
    if (res.status === 200 && /no satcat records found/i.test(trimmed)) {
      return {
        satellitesUpserted: 0,
        snapshotsCreated: 0,
        snapshotItemsInserted: 0,
        snapshotChanged: false,
        catalogState: 'catalog_empty',
        latestSnapshotId: null,
        latestSnapshotHash: null,
        lastNonEmptyAt: null
      };
    }
    const snippet = res.text ? res.text.slice(0, 220).replace(/\s+/g, ' ').trim() : '';
    throw new Error(`celestrak_intdes_${launchDesignator}_${res.status}:${snippet || res.error}`);
  }

  if (!Array.isArray(res.data)) {
    throw new Error(`celestrak_intdes_${launchDesignator}_invalid_json_shape`);
  }

  const payloadOnlyRes = await fetchJsonWithRetries<any[]>(
    payloadOnlyUrl,
    { headers: { 'User-Agent': USER_AGENT, accept: 'application/json' } },
    { retries: 3, backoffMs: 1250 }
  );

  let payloadsFilterCount = 0;
  if (payloadOnlyRes.ok && Array.isArray(payloadOnlyRes.data)) {
    payloadsFilterCount = payloadOnlyRes.data.length;
  } else if (!payloadOnlyRes.ok) {
    const trimmed = (payloadOnlyRes.text || '').trim();
    if (!(payloadOnlyRes.status === 200 && /no satcat records found/i.test(trimmed))) {
      const snippet = payloadOnlyRes.text ? payloadOnlyRes.text.slice(0, 220).replace(/\s+/g, ' ').trim() : '';
      throw new Error(`celestrak_intdes_payloads_${launchDesignator}_${payloadOnlyRes.status}:${snippet || payloadOnlyRes.error}`);
    }
  }

  const satellites = new Map<string, any>();
  const inventoryItems = new Map<string, LaunchInventoryItemRow>();
  const typeCounts = { PAY: 0, RB: 0, DEB: 0, UNK: 0 };

  for (const item of res.data) {
    const normalized = normalizeSatcatRecord(item);
    const norad = normalized.norad_cat_id;
    if (!norad) continue;

    satellites.set(norad, { ...normalized, satcat_updated_at: fetchedAt, updated_at: fetchedAt });

    const objectId = normalized.intl_des;
    if (!objectId) continue;

    inventoryItems.set(objectId, {
      object_id: objectId,
      norad_cat_id: Number(norad),
      object_name: normalized.object_name,
      object_type: normalized.object_type,
      ops_status_code: normalized.ops_status_code,
      owner: normalized.owner,
      launch_date: normalized.launch_date,
      launch_site: normalized.launch_site,
      decay_date: normalized.decay_date,
      period_min: normalized.period_min,
      inclination_deg: normalized.inclination_deg,
      apogee_km: normalized.apogee_km,
      perigee_km: normalized.perigee_km,
      rcs_m2: normalized.rcs_m2,
      data_status_code:
        typeof item?.DATA_STATUS_CODE === 'string' && item.DATA_STATUS_CODE.trim() ? item.DATA_STATUS_CODE.trim() : null,
      orbit_center:
        typeof item?.ORBIT_CENTER === 'string' && item.ORBIT_CENTER.trim() ? item.ORBIT_CENTER.trim() : null,
      orbit_type:
        typeof item?.ORBIT_TYPE === 'string' && item.ORBIT_TYPE.trim() ? item.ORBIT_TYPE.trim() : null
    });

    if (normalized.object_type === 'PAY') typeCounts.PAY += 1;
    else if (normalized.object_type === 'RB') typeCounts.RB += 1;
    else if (normalized.object_type === 'DEB') typeCounts.DEB += 1;
    else typeCounts.UNK += 1;
  }

  const satelliteRows = [...satellites.values()];
  await upsertSatcatSatellitesIfChangedInChunks(supabase, satelliteRows, DEFAULTS.upsertChunkSize);

  const items = [...inventoryItems.values()].sort((a, b) => a.object_id.localeCompare(b.object_id));
  if (!items.length) {
    return {
      satellitesUpserted: satelliteRows.length,
      snapshotsCreated: 0,
      snapshotItemsInserted: 0,
      snapshotChanged: false,
      catalogState: 'catalog_empty',
      latestSnapshotId: null,
      latestSnapshotHash: null,
      lastNonEmptyAt: null
    };
  }

  const snapshotHash = await computeLaunchInventorySnapshotHash(launchDesignator, items, payloadsFilterCount);
  const snapshotResult = await upsertLaunchInventorySnapshot({
    supabase,
    launchDesignator,
    snapshotHash,
    items,
    payloadsFilterCount,
    typeCounts,
    capturedAt: fetchedAt
  });

  return {
    satellitesUpserted: satelliteRows.length,
    snapshotsCreated: snapshotResult.changed ? 1 : 0,
    snapshotItemsInserted: snapshotResult.changed ? items.length : 0,
    snapshotChanged: snapshotResult.changed,
    catalogState: 'catalog_available',
    latestSnapshotId: snapshotResult.snapshotId,
    latestSnapshotHash: snapshotHash,
    lastNonEmptyAt: fetchedAt
  };
}

async function markDatasetSuccess(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchDesignator: string,
  nowIso: string,
  httpStatus: number,
  details: {
    catalogState: string;
    latestSnapshotId: number | null;
    latestSnapshotHash: string | null;
    lastNonEmptyAt: string | null;
  }
) {
  const patch: Record<string, unknown> = {
    last_success_at: nowIso,
    last_checked_at: nowIso,
    consecutive_failures: 0,
    last_http_status: httpStatus,
    last_error: null,
    catalog_state: details.catalogState,
    latest_snapshot_id: details.latestSnapshotId,
    latest_snapshot_hash: details.latestSnapshotHash,
    updated_at: nowIso
  };

  if (details.lastNonEmptyAt) {
    patch.last_non_empty_at = details.lastNonEmptyAt;
  }

  await supabase
    .from('celestrak_intdes_datasets')
    .update(patch)
    .eq('launch_designator', launchDesignator);
}

async function markDatasetFailure(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchDesignator: string,
  dataset: any,
  errorMessage: string
) {
  const nowIso = new Date().toISOString();
  const statusMatch = errorMessage.match(/_(\d{3})(:|$)/);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : null;
  const failures = clampInt(Number(dataset?.consecutive_failures || 0) + 1, 0, 999999);

  await supabase
    .from('celestrak_intdes_datasets')
    .update({
      consecutive_failures: failures,
      last_http_status: httpStatus,
      last_error: errorMessage.slice(0, 500),
      catalog_state: 'error',
      last_checked_at: nowIso,
      updated_at: nowIso
    })
    .eq('launch_designator', launchDesignator);
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

function chunkArray<T>(items: T[], size: number) {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
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

    // Backward-compatible fallback for environments without the conditional SATCAT RPC.
    console.warn('upsert_satellites_satcat_if_changed RPC failed; falling back to direct upsert', error);
    const fallback = await supabase.from('satellites').upsert(chunk, { onConflict: 'norad_cat_id', ignoreDuplicates: false });
    if (fallback.error) throw fallback.error;
  }
}

async function computeLaunchInventorySnapshotHash(
  launchDesignator: string,
  items: LaunchInventoryItemRow[],
  payloadsFilterCount: number
) {
  const payload = JSON.stringify({
    launchDesignator,
    payloadsFilterCount,
    items: items.map((item) => ({
      object_id: item.object_id,
      norad_cat_id: item.norad_cat_id,
      object_name: item.object_name,
      object_type: item.object_type,
      ops_status_code: item.ops_status_code,
      owner: item.owner,
      launch_date: item.launch_date,
      launch_site: item.launch_site,
      decay_date: item.decay_date,
      period_min: item.period_min,
      inclination_deg: item.inclination_deg,
      apogee_km: item.apogee_km,
      perigee_km: item.perigee_km,
      rcs_m2: item.rcs_m2,
      data_status_code: item.data_status_code,
      orbit_center: item.orbit_center,
      orbit_type: item.orbit_type
    }))
  });

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const bytes = new Uint8Array(digest);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function upsertLaunchInventorySnapshot({
  supabase,
  launchDesignator,
  snapshotHash,
  items,
  payloadsFilterCount,
  typeCounts,
  capturedAt
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  launchDesignator: string;
  snapshotHash: string;
  items: LaunchInventoryItemRow[];
  payloadsFilterCount: number;
  typeCounts: { PAY: number; RB: number; DEB: number; UNK: number };
  capturedAt: string;
}) {
  const { data: existingSnapshot, error: existingSnapshotError } = await supabase
    .from('launch_object_inventory_snapshots')
    .select('id')
    .eq('launch_designator', launchDesignator)
    .eq('snapshot_hash', snapshotHash)
    .maybeSingle();
  if (existingSnapshotError) throw existingSnapshotError;

  if (existingSnapshot?.id) {
    return { snapshotId: Number(existingSnapshot.id), changed: false };
  }

  const { data: insertedSnapshot, error: insertSnapshotError } = await supabase
    .from('launch_object_inventory_snapshots')
    .insert({
      launch_designator: launchDesignator,
      snapshot_hash: snapshotHash,
      object_count: items.length,
      payload_count: typeCounts.PAY,
      rb_count: typeCounts.RB,
      deb_count: typeCounts.DEB,
      unk_count: typeCounts.UNK,
      payloads_filter_count: payloadsFilterCount,
      captured_at: capturedAt
    })
    .select('id')
    .single();
  if (insertSnapshotError || !insertedSnapshot?.id) throw insertSnapshotError || new Error('intdes_snapshot_insert_failed');

  const snapshotId = Number(insertedSnapshot.id);
  const chunkedItems = chunkArray(items, DEFAULTS.upsertChunkSize);
  for (const chunk of chunkedItems) {
    const rows = chunk.map((item) => ({ snapshot_id: snapshotId, ...item }));
    const { error: insertItemsError } = await supabase.from('launch_object_inventory_snapshot_items').insert(rows);
    if (insertItemsError) throw insertItemsError;
  }

  return { snapshotId, changed: true };
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

function parseNoradCatId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{1,9}$/.test(trimmed)) return trimmed.replace(/^0+/, '') || '0';
  }
  return null;
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeDateForPg(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s === '0' || s.toLowerCase() === 'null') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
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
