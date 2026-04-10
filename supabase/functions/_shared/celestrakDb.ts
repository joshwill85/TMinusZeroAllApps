import { getCachedSetting, primeCachedSettings } from './settings.ts';
import { createSupabaseAdminClient } from './supabase.ts';

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

export type CelestrakDatasetManagedField = 'dataset_type' | 'code' | 'label' | 'query' | 'enabled' | 'min_interval_seconds';

export type CelestrakDatasetSyncRow = {
  dataset_key: string;
  dataset_type?: string | null;
  code?: string | null;
  label?: string | null;
  query?: Record<string, unknown> | null;
  enabled?: boolean | null;
  min_interval_seconds?: number | null;
};

type ExistingCelestrakDatasetRow = Partial<CelestrakDatasetSyncRow> & {
  dataset_key?: string | null;
};

export function planCelestrakDatasetSync<TDesired extends CelestrakDatasetSyncRow>({
  desiredRows,
  existingRows,
  managedFields
}: {
  desiredRows: readonly TDesired[];
  existingRows: readonly ExistingCelestrakDatasetRow[];
  managedFields: readonly CelestrakDatasetManagedField[];
}) {
  const existingByKey = new Map<string, ExistingCelestrakDatasetRow>();
  for (const row of existingRows) {
    const datasetKey = normalizeString(row?.dataset_key);
    if (!datasetKey) continue;
    existingByKey.set(datasetKey, row);
  }

  const rowsToInsert: TDesired[] = [];
  const rowsToUpdate: Array<{ desired: TDesired; existing: ExistingCelestrakDatasetRow }> = [];
  let unchangedCount = 0;

  for (const desired of desiredRows) {
    const existing = existingByKey.get(desired.dataset_key);
    if (!existing) {
      rowsToInsert.push(desired);
      continue;
    }

    if (hasManagedDatasetChanges(existing, desired, managedFields)) {
      rowsToUpdate.push({ desired, existing });
      continue;
    }

    unchangedCount += 1;
  }

  return {
    rowsToInsert,
    rowsToUpdate,
    unchangedCount
  };
}

export async function upsertCelestrakDatasetsInChunks(
  supabase: SupabaseAdminClient,
  rows: Array<Record<string, unknown>>,
  nowIso: string,
  chunkSize = 250
) {
  if (!rows.length) return;
  const chunks = chunkArray(rows, chunkSize);
  for (const chunk of chunks) {
    const payload = chunk.map((row) => ({
      ...row,
      updated_at: nowIso
    }));
    const { error } = await supabase.from('celestrak_datasets').upsert(payload, {
      onConflict: 'dataset_key',
      ignoreDuplicates: false
    });
    if (error) throw error;
  }
}

export async function upsertSatelliteIdentitiesIfChangedInChunks(
  supabase: SupabaseAdminClient,
  rows: Array<Record<string, unknown>>,
  chunkSize = 500
) {
  if (!rows.length) return;
  const chunks = chunkArray(rows, chunkSize);
  for (const chunk of chunks) {
    const { error } = await supabase.rpc('upsert_satellite_identities_if_changed', { rows_in: chunk });
    if (!error) continue;

    console.warn('upsert_satellite_identities_if_changed RPC failed; falling back to direct upsert', error);
    const { error: fallbackError } = await supabase.from('satellites').upsert(chunk, {
      onConflict: 'norad_cat_id',
      ignoreDuplicates: false
    });
    if (fallbackError) throw fallbackError;
  }
}

export async function upsertSetting(supabase: SupabaseAdminClient, key: string, value: unknown) {
  const { error } = await supabase
    .from('system_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
  primeCachedSettings(supabase as unknown as Parameters<typeof primeCachedSettings>[0], { [key]: value });
}

export async function upsertSettingIfChanged(supabase: SupabaseAdminClient, key: string, value: unknown) {
  const existingValue = await getCachedSetting(supabase as unknown as Parameters<typeof getCachedSetting>[0], key);
  if (existingValue !== undefined && jsonValueKey(existingValue) === jsonValueKey(value)) {
    return false;
  }

  await upsertSetting(supabase, key, value);
  return true;
}

function hasManagedDatasetChanges(
  existing: ExistingCelestrakDatasetRow,
  desired: CelestrakDatasetSyncRow,
  managedFields: readonly CelestrakDatasetManagedField[]
) {
  for (const field of managedFields) {
    switch (field) {
      case 'dataset_type':
      case 'code':
      case 'label':
        if (normalizeString(existing[field]) !== normalizeString(desired[field])) return true;
        break;
      case 'query':
        if (jsonValueKey(existing.query) !== jsonValueKey(desired.query)) return true;
        break;
      case 'enabled':
        if (normalizeBoolean(existing.enabled) !== normalizeBoolean(desired.enabled)) return true;
        break;
      case 'min_interval_seconds':
        if (normalizeInteger(existing.min_interval_seconds) !== normalizeInteger(desired.min_interval_seconds)) return true;
        break;
    }
  }
  return false;
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return false;
}

function normalizeInteger(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function chunkArray<T>(items: T[], size: number) {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function jsonValueKey(value: unknown) {
  return JSON.stringify(normalizeJsonValue(value));
}

function normalizeJsonValue(value: unknown): unknown {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((item) => normalizeJsonValue(item));
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, entryValue]) => [key, normalizeJsonValue(entryValue)]));
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return String(value);
}
