import { createSupabaseAdminClient } from './supabase.ts';
import {
  planCelestrakDatasetSync,
  upsertCelestrakDatasetsInChunks
} from './celestrakDb.ts';
import {
  CELESTRAK_CURRENT_SUPGP_PAGE,
  DEFAULT_CELESTRAK_USER_AGENT,
  fetchTextWithRetries,
  parseCurrentSupgpDatasets,
  type CelestrakSupgpDataset
} from './celestrak.ts';

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

export const DEFAULT_CELESTRAK_SUPGP_SYNC_OPTIONS = {
  familyMinIntervalSeconds: 21_600,
  launchMinIntervalSeconds: 300,
  launchRetentionHours: 72
} as const;

export type CelestrakSupgpSyncStats = {
  url: string;
  datasetsFound: number;
  familyFeedsFound: number;
  launchFilesFound: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsUnchanged: number;
  rowsUpserted: number;
  staleLaunchRowsDisabled: number;
};

export async function syncCelestrakSupgpDatasets({
  supabase,
  userAgent = DEFAULT_CELESTRAK_USER_AGENT,
  familyMinIntervalSeconds,
  launchMinIntervalSeconds,
  launchRetentionHours
}: {
  supabase: SupabaseAdminClient;
  userAgent?: string;
  familyMinIntervalSeconds: number;
  launchMinIntervalSeconds: number;
  launchRetentionHours: number;
}): Promise<CelestrakSupgpSyncStats> {
  const stats: CelestrakSupgpSyncStats = {
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

  const htmlRes = await fetchTextWithRetries(
    CELESTRAK_CURRENT_SUPGP_PAGE,
    { headers: { 'User-Agent': userAgent, accept: 'text/html' } },
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
    throw new Error('no_supgp_datasets_parsed');
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

  return stats;
}

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
