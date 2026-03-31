import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';
import {
  planCelestrakDatasetSync,
  upsertCelestrakDatasetsInChunks,
  upsertSetting,
  upsertSettingIfChanged
} from '../_shared/celestrakDb.ts';
import {
  CELESTRAK_CURRENT_SUPGP_PAGE,
  DEFAULT_CELESTRAK_USER_AGENT,
  fetchTextWithRetries,
  parseCurrentSupgpDatasets,
  type CelestrakSupgpDataset
} from '../_shared/celestrak.ts';

const USER_AGENT = Deno.env.get('CELESTRAK_USER_AGENT') || DEFAULT_CELESTRAK_USER_AGENT;

const DEFAULTS = {
  familyMinIntervalSeconds: 21_600,
  launchMinIntervalSeconds: 300,
  launchRetentionHours: 72
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'celestrak_supgp_sync');
  const stats: Record<string, unknown> = {
    url: CELESTRAK_CURRENT_SUPGP_PAGE,
    datasetsFound: 0,
    familyFeedsFound: 0,
    launchFilesFound: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsUnchanged: 0,
    rowsUpserted: 0,
    staleLaunchRowsDisabled: 0
  };

  try {
    const settings = await getSettings(supabase, [
      'celestrak_supgp_sync_enabled',
      'celestrak_supgp_family_min_interval_seconds',
      'celestrak_supgp_launch_min_interval_seconds',
      'celestrak_supgp_launch_retention_hours'
    ]);

    const enabled = readBooleanSetting(settings.celestrak_supgp_sync_enabled, true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled' });
    }

    const familyMinIntervalSeconds = clampInt(
      readNumberSetting(settings.celestrak_supgp_family_min_interval_seconds, DEFAULTS.familyMinIntervalSeconds),
      900,
      86400 * 7
    );
    const launchMinIntervalSeconds = clampInt(
      readNumberSetting(settings.celestrak_supgp_launch_min_interval_seconds, DEFAULTS.launchMinIntervalSeconds),
      300,
      21_600
    );
    const launchRetentionHours = clampInt(
      readNumberSetting(settings.celestrak_supgp_launch_retention_hours, DEFAULTS.launchRetentionHours),
      6,
      24 * 14
    );

    const htmlRes = await fetchTextWithRetries(
      CELESTRAK_CURRENT_SUPGP_PAGE,
      { headers: { 'User-Agent': USER_AGENT, accept: 'text/html' } },
      { retries: 3, backoffMs: 1000 }
    );
    if (!htmlRes.ok) {
      throw new Error(`celestrak_current_supgp_${htmlRes.status || htmlRes.error}`);
    }

    const discovered = parseCurrentSupgpDatasets(htmlRes.text)
      .filter((entry) => shouldKeepSupgpDataset(entry, launchRetentionHours))
      .sort((left, right) => left.file.localeCompare(right.file));

    stats.datasetsFound = discovered.length;
    stats.familyFeedsFound = discovered.filter((entry) => entry.category === 'family_feed').length;
    stats.launchFilesFound = discovered.filter((entry) => entry.category === 'launch_file').length;

    if (!discovered.length) {
      await finishIngestionRun(supabase, runId, false, { ...stats, error: 'no_supgp_datasets_parsed' }, 'no_supgp_datasets_parsed');
      return jsonResponse({ ok: false, error: 'no_supgp_datasets_parsed', stats }, 500);
    }

    const nowIso = new Date().toISOString();
    const rows = discovered.map((entry) => ({
      dataset_key: `supgp:${entry.file}`,
      dataset_type: 'supgp',
      code: entry.file,
      label: entry.label,
      query: { FILE: entry.file },
      enabled: true,
      min_interval_seconds: entry.category === 'launch_file' ? launchMinIntervalSeconds : familyMinIntervalSeconds
    }));

    const discoveredKeys = new Set(rows.map((row) => row.dataset_key));
    const { data: discoveredRows, error: discoveredError } = await supabase
      .from('celestrak_datasets')
      .select('dataset_key, dataset_type, code, label, query, enabled, min_interval_seconds')
      .in('dataset_key', rows.map((row) => row.dataset_key));
    if (discoveredError) throw discoveredError;

    const { data: enabledRows, error: enabledError } = await supabase
      .from('celestrak_datasets')
      .select('dataset_key, dataset_type, code, label, query, enabled, min_interval_seconds')
      .eq('dataset_type', 'supgp')
      .eq('enabled', true);
    if (enabledError) throw enabledError;

    const existingRowsByKey = new Map<string, Record<string, unknown>>();
    for (const row of ((discoveredRows as Array<Record<string, unknown>> | null) || []).concat((enabledRows as Array<Record<string, unknown>> | null) || [])) {
      const datasetKey = typeof row?.dataset_key === 'string' ? row.dataset_key : '';
      if (!datasetKey) continue;
      existingRowsByKey.set(datasetKey, row);
    }

    const syncPlan = planCelestrakDatasetSync({
      desiredRows: rows,
      existingRows: [...existingRowsByKey.values()],
      managedFields: ['code', 'label', 'query', 'enabled', 'min_interval_seconds']
    });
    const rowsToUpsert = [...syncPlan.rowsToInsert, ...syncPlan.rowsToUpdate.map(({ desired }) => desired)];
    await upsertCelestrakDatasetsInChunks(supabase, rowsToUpsert, nowIso);

    stats.rowsInserted = syncPlan.rowsToInsert.length;
    stats.rowsUpdated = syncPlan.rowsToUpdate.length;
    stats.rowsUnchanged = syncPlan.unchangedCount;
    stats.rowsUpserted = rowsToUpsert.length;

    const staleLaunchKeys = ((enabledRows as Array<Record<string, unknown>> | null) || [])
      .filter((row) => {
        const datasetKey = typeof row?.dataset_key === 'string' ? row.dataset_key : '';
        if (!datasetKey || discoveredKeys.has(datasetKey)) return false;
        const code = typeof row?.code === 'string' ? row.code : '';
        const query = row?.query && typeof row.query === 'object' && !Array.isArray(row.query) ? (row.query as Record<string, unknown>) : null;
        const file = typeof query?.FILE === 'string' ? query.FILE : code;
        return looksLikeManagedLaunchFile(file);
      })
      .map((row) => String(row.dataset_key));

    if (staleLaunchKeys.length > 0) {
      const { error: disableError } = await supabase
        .from('celestrak_datasets')
        .update({
          enabled: false,
          updated_at: nowIso
        })
        .in('dataset_key', staleLaunchKeys);
      if (disableError) throw disableError;
    }
    stats.staleLaunchRowsDisabled = staleLaunchKeys.length;

    await upsertSetting(supabase, 'celestrak_supgp_last_synced_at', nowIso);
    await upsertSettingIfChanged(supabase, 'celestrak_supgp_last_synced_count', discovered.length);

    await finishIngestionRun(supabase, runId, true, { ...stats, elapsedMs: Date.now() - startedAt });
    return jsonResponse({ ok: true, stats });
  } catch (err) {
    const message = stringifyError(err);
    await upsertSetting(supabase, 'celestrak_supgp_last_error', message);
    await finishIngestionRun(supabase, runId, false, { ...stats, error: message }, message);
    return jsonResponse({ ok: false, error: message, stats }, 500);
  }
});

function shouldKeepSupgpDataset(entry: CelestrakSupgpDataset, launchRetentionHours: number) {
  if (entry.category !== 'launch_file') return true;
  const referenceIso = entry.launchWindowEndAt ?? entry.launchAt;
  if (!referenceIso) return true;
  const referenceMs = Date.parse(referenceIso);
  if (!Number.isFinite(referenceMs)) return true;
  const cutoffMs = Date.now() - launchRetentionHours * 60 * 60 * 1000;
  return referenceMs >= cutoffMs;
}

function looksLikeManagedLaunchFile(file: string) {
  const value = String(file || '').trim().toLowerCase();
  if (!value) return false;
  return /(^|[-_])(b\d+|g\d+-\d+|\d{1,2})([-_]|$)/.test(value) || /starlink-g\d+-\d+/.test(value) || /transporter-\d+/.test(value) || /bandwagon-\d+/.test(value);
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
