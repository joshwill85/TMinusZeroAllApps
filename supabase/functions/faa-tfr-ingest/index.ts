import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting, readStringSetting } from '../_shared/settings.ts';
import {
  FAA_USER_AGENT,
  bboxFromGeometry,
  geometryPointCount,
  normalizeNonEmptyString,
  parseBooleanish,
  parseDateWindowFromText,
  parseModAbsTime,
  parseNotamId,
  parseNotamIdFromSourceKey
} from '../_shared/faa.ts';

const DEFAULTS = {
  enabled: true,
  hourlyLimit: 500,
  tfrListUrl: 'https://tfr.faa.gov/tfrapi/getTfrList',
  tfrNoShapeUrl: 'https://tfr.faa.gov/tfrapi/noShapeTfrList',
  tfrShapesUrl:
    'https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&maxFeatures=500&outputFormat=application/json&srsname=EPSG:4326'
};

type ListItem = {
  notam_id?: string | null;
  facility?: string | null;
  state?: string | null;
  type?: string | null;
  description?: string | null;
  mod_date?: string | null;
  mod_abs_time?: string | null;
  is_new?: string | null;
  gid?: string | null;
};

type NoShapeItem = {
  notam_id?: string | null;
  cns_location_id?: string | null;
  notam_key?: string | null;
  title?: string | null;
  last_modification_datetime?: string | null;
  state?: string | null;
  legal?: string | null;
};

type ShapeFeature = {
  id?: string | null;
  geometry?: Record<string, unknown> | null;
  properties?: Record<string, unknown> | null;
};

type ShapeResponse = {
  type?: string;
  features?: ShapeFeature[];
};

type DraftRecord = {
  source: 'faa_tfr';
  source_key: string;
  notam_id: string | null;
  notam_key: string | null;
  gid: string | null;
  facility: string | null;
  state: string | null;
  type: string | null;
  legal: string | null;
  title: string | null;
  description: string | null;
  is_new: boolean | null;
  mod_date: string | null;
  mod_abs_time: string | null;
  mod_at: string | null;
  valid_start: string | null;
  valid_end: string | null;
  has_shape: boolean;
  status: 'active';
  raw: Record<string, unknown>;
};

type DraftShape = {
  sourceKey: string;
  sourceShapeId: string;
  geometry: Record<string, unknown>;
  raw: Record<string, unknown>;
};

type ExistingRecordRow = {
  id: string;
  source_key: string;
  notam_id: string | null;
  notam_key: string | null;
  gid: string | null;
  facility: string | null;
  state: string | null;
  type: string | null;
  legal: string | null;
  title: string | null;
  description: string | null;
  is_new: boolean | null;
  mod_date: string | null;
  mod_abs_time: string | null;
  mod_at: string | null;
  valid_start: string | null;
  valid_end: string | null;
  has_shape: boolean;
  status: 'active' | 'expired' | 'manual';
  raw: Record<string, unknown> | null;
};

type ExistingShapeRow = {
  id: string;
  faa_tfr_record_id: string;
  source_shape_id: string;
  geometry: Record<string, unknown> | null;
  bbox_min_lat: number | null;
  bbox_min_lon: number | null;
  bbox_max_lat: number | null;
  bbox_max_lon: number | null;
  point_count: number | null;
  raw: Record<string, unknown> | null;
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'faa_tfr_ingest');

  const stats: Record<string, unknown> = {
    listFetched: 0,
    noShapeFetched: 0,
    shapeFeaturesFetched: 0,
    recordsPrepared: 0,
    recordsUpserted: 0,
    recordsSkippedUnchanged: 0,
    shapesPrepared: 0,
    shapesUpserted: 0,
    shapesSkippedUnchanged: 0,
    recordsWithoutSourceKey: 0,
    recordsWithoutNotamId: 0,
    cursorBefore: null as string | null,
    cursorAfter: null as string | null,
    errors: [] as Array<{ step: string; error: string; context?: Record<string, unknown> }>
  };

  try {
    const settings = await getSettings(supabase, [
      'faa_job_enabled',
      'faa_job_hourly_limit',
      'faa_tfr_list_url',
      'faa_tfr_noshape_url',
      'faa_tfr_shapes_url',
      'faa_job_cursor_mod_abs_time'
    ]);

    const enabled = readBooleanSetting(settings.faa_job_enabled, DEFAULTS.enabled);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const hourlyLimit = clampInt(readNumberSetting(settings.faa_job_hourly_limit, DEFAULTS.hourlyLimit), 50, 5000);
    const listUrl = readStringSetting(settings.faa_tfr_list_url, DEFAULTS.tfrListUrl).trim() || DEFAULTS.tfrListUrl;
    const noShapeUrl =
      readStringSetting(settings.faa_tfr_noshape_url, DEFAULTS.tfrNoShapeUrl).trim() || DEFAULTS.tfrNoShapeUrl;
    const shapesUrl =
      readStringSetting(settings.faa_tfr_shapes_url, DEFAULTS.tfrShapesUrl).trim() || DEFAULTS.tfrShapesUrl;

    const cursorBefore = normalizeNonEmptyString(readStringSetting(settings.faa_job_cursor_mod_abs_time, ''));
    stats.cursorBefore = cursorBefore;

    const [listItemsRaw, noShapeItemsRaw, shapePayload] = await Promise.all([
      fetchJson<ListItem[]>(listUrl),
      fetchJson<NoShapeItem[]>(noShapeUrl),
      fetchJson<ShapeResponse>(shapesUrl)
    ]);

    const listItems = Array.isArray(listItemsRaw) ? listItemsRaw : [];
    const noShapeItems = Array.isArray(noShapeItemsRaw) ? noShapeItemsRaw : [];
    const shapeFeatures = Array.isArray(shapePayload?.features) ? shapePayload.features : [];

    stats.listFetched = listItems.length;
    stats.noShapeFetched = noShapeItems.length;
    stats.shapeFeaturesFetched = shapeFeatures.length;

    const records = new Map<string, DraftRecord>();
    const shapes: DraftShape[] = [];

    for (const item of listItems) {
      const notamId = parseNotamId(item.notam_id) || parseNotamId(item.gid);
      const sourceKey = deriveSourceKey({
        notamKey: null,
        gid: normalizeNonEmptyString(item.gid),
        notamId,
        fallback: null
      });
      if (!sourceKey) {
        stats.recordsWithoutSourceKey = Number(stats.recordsWithoutSourceKey || 0) + 1;
        continue;
      }
      if (!notamId) stats.recordsWithoutNotamId = Number(stats.recordsWithoutNotamId || 0) + 1;

      const window = parseDateWindowFromText(item.description ?? null);
      const modAbsRaw = normalizeNonEmptyString(item.mod_abs_time);
      const modAt = parseModAbsTime(modAbsRaw) || parseDate(item.mod_date);

      mergeDraftRecord(records, {
        source: 'faa_tfr',
        source_key: sourceKey,
        notam_id: notamId,
        notam_key: null,
        gid: normalizeNonEmptyString(item.gid),
        facility: normalizeNonEmptyString(item.facility),
        state: normalizeNonEmptyString(item.state),
        type: normalizeNonEmptyString(item.type),
        legal: null,
        title: null,
        description: normalizeNonEmptyString(item.description),
        is_new: parseBooleanish(item.is_new),
        mod_date: normalizeNonEmptyString(item.mod_date),
        mod_abs_time: modAbsRaw,
        mod_at: modAt,
        valid_start: window.validStart,
        valid_end: window.validEnd,
        has_shape: false,
        status: 'active',
        raw: {
          list: item
        }
      });
    }

    for (const item of noShapeItems) {
      const notamKey = normalizeNonEmptyString(item.notam_key);
      const notamId = parseNotamId(item.notam_id) || parseNotamIdFromSourceKey(notamKey);
      const sourceKey = deriveSourceKey({
        notamKey,
        gid: null,
        notamId,
        fallback: null
      });
      if (!sourceKey) {
        stats.recordsWithoutSourceKey = Number(stats.recordsWithoutSourceKey || 0) + 1;
        continue;
      }
      if (!notamId) stats.recordsWithoutNotamId = Number(stats.recordsWithoutNotamId || 0) + 1;

      const window = parseDateWindowFromText(item.title ?? null);
      const modAbsRaw = normalizeNonEmptyString(item.last_modification_datetime);
      const modAt = parseModAbsTime(modAbsRaw);

      mergeDraftRecord(records, {
        source: 'faa_tfr',
        source_key: sourceKey,
        notam_id: notamId,
        notam_key: notamKey,
        gid: null,
        facility: normalizeNonEmptyString(item.cns_location_id),
        state: normalizeNonEmptyString(item.state),
        type: normalizeNonEmptyString(item.legal),
        legal: normalizeNonEmptyString(item.legal),
        title: normalizeNonEmptyString(item.title),
        description: null,
        is_new: null,
        mod_date: null,
        mod_abs_time: modAbsRaw,
        mod_at: modAt,
        valid_start: window.validStart,
        valid_end: window.validEnd,
        has_shape: false,
        status: 'active',
        raw: {
          noShape: item
        }
      });
    }

    for (const feature of shapeFeatures) {
      const props = feature.properties || {};
      const notamKey = normalizeNonEmptyString(props.NOTAM_KEY ?? props.notam_key);
      const notamId =
        parseNotamId(props.notam_id) ||
        parseNotamId(props.NOTAM_ID) ||
        parseNotamIdFromSourceKey(notamKey) ||
        parseNotamId(feature.id);
      const sourceKey = deriveSourceKey({
        notamKey,
        gid: normalizeNonEmptyString(props.GID ?? props.gid),
        notamId,
        fallback: normalizeNonEmptyString(feature.id)
      });
      if (!sourceKey) {
        stats.recordsWithoutSourceKey = Number(stats.recordsWithoutSourceKey || 0) + 1;
        continue;
      }
      if (!notamId) stats.recordsWithoutNotamId = Number(stats.recordsWithoutNotamId || 0) + 1;

      const title = normalizeNonEmptyString(props.TITLE ?? props.title);
      const legal = normalizeNonEmptyString(props.LEGAL ?? props.legal);
      const modAbsRaw = normalizeNonEmptyString(props.LAST_MODIFICATION_DATETIME ?? props.last_modification_datetime);
      const window = parseDateWindowFromText(title);

      mergeDraftRecord(records, {
        source: 'faa_tfr',
        source_key: sourceKey,
        notam_id: notamId,
        notam_key: notamKey,
        gid: normalizeNonEmptyString(props.GID ?? props.gid),
        facility: normalizeNonEmptyString(props.CNS_LOCATION_ID ?? props.cns_location_id),
        state: normalizeNonEmptyString(props.STATE ?? props.state),
        type: legal,
        legal,
        title,
        description: null,
        is_new: null,
        mod_date: null,
        mod_abs_time: modAbsRaw,
        mod_at: parseModAbsTime(modAbsRaw),
        valid_start: window.validStart,
        valid_end: window.validEnd,
        has_shape: true,
        status: 'active',
        raw: {
          featureProps: props
        }
      });

      if (feature.geometry && typeof feature.geometry === 'object') {
        shapes.push({
          sourceKey,
          sourceShapeId: normalizeNonEmptyString(feature.id) || sourceKey,
          geometry: feature.geometry,
          raw: {
            featureId: feature.id ?? null,
            properties: props
          }
        });
      }
    }

    const preparedRecords = Array.from(records.values());
    preparedRecords.sort((a, b) => {
      const aa = a.mod_at ? Date.parse(a.mod_at) : Number.NEGATIVE_INFINITY;
      const bb = b.mod_at ? Date.parse(b.mod_at) : Number.NEGATIVE_INFINITY;
      return bb - aa;
    });

    stats.recordsPrepared = preparedRecords.length;
    const ingestionIso = new Date().toISOString();
    const recordDrafts = preparedRecords.slice(0, hourlyLimit);
    const recordSourceKeys = recordDrafts.map((record) => record.source_key).filter(Boolean);

    let recordRowsBySourceKey = new Map<string, { id: string; notamId: string | null }>();
    const existingRecordsBySourceKey = new Map<string, ExistingRecordRow>();
    if (recordSourceKeys.length > 0) {
      const { data, error } = await supabase
        .from('faa_tfr_records')
        .select(
          'id, source_key, notam_id, notam_key, gid, facility, state, type, legal, title, description, is_new, mod_date, mod_abs_time, mod_at, valid_start, valid_end, has_shape, status, raw'
        )
        .eq('source', 'faa_tfr')
        .in('source_key', recordSourceKeys);
      if (error) throw error;

      for (const row of (data || []) as ExistingRecordRow[]) {
        existingRecordsBySourceKey.set(String(row.source_key), row);
        recordRowsBySourceKey.set(String(row.source_key), {
          id: String(row.id),
          notamId: parseNotamId(row.notam_id)
        });
      }
    }

    const recordRows = recordDrafts.map((record) => ({
      ...record,
      fetched_at: ingestionIso,
      updated_at: ingestionIso
    }));
    const recordRowsToUpsert = recordRows.filter((row) => hasDraftRecordChanged(row, existingRecordsBySourceKey.get(row.source_key)));
    stats.recordsSkippedUnchanged = recordRows.length - recordRowsToUpsert.length;

    if (recordRowsToUpsert.length > 0) {
      const { data: mergeData, error: mergeError } = await supabase.rpc('upsert_faa_tfr_records_if_changed', {
        rows_in: recordRowsToUpsert
      });

      if (!mergeError) {
        const mergeStats = asPlainObject(mergeData);
        stats.recordsUpserted = readInt(mergeStats.inserted) + readInt(mergeStats.updated);
        stats.recordsSkippedUnchanged = Number(stats.recordsSkippedUnchanged || 0) + readInt(mergeStats.skipped);

        const { data, error } = await supabase
          .from('faa_tfr_records')
          .select('id, source_key, notam_id')
          .eq('source', 'faa_tfr')
          .in(
            'source_key',
            recordRowsToUpsert.map((row) => row.source_key).filter((value): value is string => Boolean(value))
          );
        if (error) throw error;

        for (const row of data || []) {
          recordRowsBySourceKey.set(String((row as any).source_key), {
            id: String((row as any).id),
            notamId: parseNotamId((row as any).notam_id)
          });
        }
      } else {
        console.warn('upsert_faa_tfr_records_if_changed failed; falling back to upsert', mergeError);

        const { data, error } = await supabase
          .from('faa_tfr_records')
          .upsert(recordRowsToUpsert, { onConflict: 'source,source_key' })
          .select('id, source_key, notam_id');
        if (error) throw error;

        for (const row of data || []) {
          recordRowsBySourceKey.set(String((row as any).source_key), {
            id: String((row as any).id),
            notamId: parseNotamId((row as any).notam_id)
          });
        }
        stats.recordsUpserted = (data || []).length;
      }
    }

    const shapeRows: Array<Record<string, unknown>> = [];
    const dedupe = new Set<string>();
    for (const shape of shapes) {
      const record = recordRowsBySourceKey.get(shape.sourceKey);
      if (!record) continue;

      const dedupeKey = `${record.id}::${shape.sourceShapeId}`;
      if (dedupe.has(dedupeKey)) continue;
      dedupe.add(dedupeKey);

      const bbox = bboxFromGeometry(shape.geometry);
      shapeRows.push({
        faa_tfr_record_id: record.id,
        source_shape_id: shape.sourceShapeId,
        geometry: shape.geometry,
        bbox_min_lat: bbox?.minLat ?? null,
        bbox_min_lon: bbox?.minLon ?? null,
        bbox_max_lat: bbox?.maxLat ?? null,
        bbox_max_lon: bbox?.maxLon ?? null,
        point_count: geometryPointCount(shape.geometry),
        raw: shape.raw,
        fetched_at: ingestionIso,
        updated_at: ingestionIso
      });
    }

    stats.shapesPrepared = shapeRows.length;
    const shapeRecordIds = Array.from(new Set(shapeRows.map((row) => String(row.faa_tfr_record_id || '')).filter(Boolean)));
    const existingShapesByKey = new Map<string, ExistingShapeRow>();
    if (shapeRecordIds.length > 0) {
      const { data, error } = await supabase
        .from('faa_tfr_shapes')
        .select(
          'id, faa_tfr_record_id, source_shape_id, geometry, bbox_min_lat, bbox_min_lon, bbox_max_lat, bbox_max_lon, point_count, raw'
        )
        .in('faa_tfr_record_id', shapeRecordIds);
      if (error) throw error;

      for (const row of (data || []) as ExistingShapeRow[]) {
        existingShapesByKey.set(`${row.faa_tfr_record_id}::${row.source_shape_id}`, row);
      }
    }

    const shapeRowsToUpsert = shapeRows.filter((row) =>
      hasDraftShapeChanged(row, existingShapesByKey.get(`${row.faa_tfr_record_id}::${row.source_shape_id}`))
    );
    stats.shapesSkippedUnchanged = shapeRows.length - shapeRowsToUpsert.length;

    if (shapeRowsToUpsert.length > 0) {
      const { data: mergeData, error: mergeError } = await supabase.rpc('upsert_faa_tfr_shapes_if_changed', {
        rows_in: shapeRowsToUpsert
      });
      if (!mergeError) {
        const mergeStats = asPlainObject(mergeData);
        stats.shapesUpserted = readInt(mergeStats.inserted) + readInt(mergeStats.updated);
        stats.shapesSkippedUnchanged = Number(stats.shapesSkippedUnchanged || 0) + readInt(mergeStats.skipped);
      } else {
        console.warn('upsert_faa_tfr_shapes_if_changed failed; falling back to upsert', mergeError);

        const { data, error } = await supabase
          .from('faa_tfr_shapes')
          .upsert(shapeRowsToUpsert, { onConflict: 'faa_tfr_record_id,source_shape_id' })
          .select('id');
        if (error) throw error;
        stats.shapesUpserted = (data || []).length;
      }
    }

    const newestCursor =
      preparedRecords
        .map((row) => normalizeNonEmptyString(row.mod_abs_time))
        .filter(Boolean)
        .sort((a, b) => String(b).localeCompare(String(a)))[0] ?? null;

    stats.cursorAfter = newestCursor;

    await upsertSetting(supabase, 'faa_job_cursor_mod_abs_time', newestCursor ?? '');
    await upsertSetting(supabase, 'faa_tfr_ingest_last_success_at', new Date().toISOString());
    await upsertSetting(supabase, 'faa_tfr_ingest_last_error', '');

    const ok = (stats.errors as Array<any>).length === 0;
    await finishIngestionRun(supabase, runId, ok, stats, ok ? undefined : 'partial_failure');

    return jsonResponse({ ok, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });

    await upsertSetting(supabase, 'faa_tfr_ingest_last_error', message);
    await finishIngestionRun(supabase, runId, false, stats, message);

    return jsonResponse({ ok: false, elapsedMs: Date.now() - startedAt, error: message, stats }, 500);
  }
});

function deriveSourceKey({
  notamKey,
  gid,
  notamId,
  fallback
}: {
  notamKey: string | null;
  gid: string | null;
  notamId: string | null;
  fallback: string | null;
}) {
  return normalizeNonEmptyString(notamKey) || normalizeNonEmptyString(gid) || normalizeNonEmptyString(notamId) || normalizeNonEmptyString(fallback);
}

function mergeDraftRecord(store: Map<string, DraftRecord>, patch: DraftRecord) {
  const existing = store.get(patch.source_key);
  if (!existing) {
    store.set(patch.source_key, patch);
    return;
  }

  const merged: DraftRecord = {
    ...existing,
    source: 'faa_tfr',
    source_key: existing.source_key,
    notam_id: pickString(existing.notam_id, patch.notam_id),
    notam_key: pickString(existing.notam_key, patch.notam_key),
    gid: pickString(existing.gid, patch.gid),
    facility: pickString(existing.facility, patch.facility),
    state: pickString(existing.state, patch.state),
    type: pickString(existing.type, patch.type),
    legal: pickString(existing.legal, patch.legal),
    title: pickString(existing.title, patch.title),
    description: pickString(existing.description, patch.description),
    is_new: existing.is_new ?? patch.is_new,
    mod_date: pickString(existing.mod_date, patch.mod_date),
    mod_abs_time: pickString(existing.mod_abs_time, patch.mod_abs_time),
    mod_at: laterIso(existing.mod_at, patch.mod_at),
    valid_start: earlierIso(existing.valid_start, patch.valid_start),
    valid_end: laterIso(existing.valid_end, patch.valid_end),
    has_shape: Boolean(existing.has_shape || patch.has_shape),
    status: 'active',
    raw: {
      ...(existing.raw || {}),
      ...(patch.raw || {})
    }
  };

  store.set(patch.source_key, merged);
}

function hasDraftRecordChanged(
  draft: DraftRecord & { fetched_at?: string; updated_at?: string },
  existing: ExistingRecordRow | undefined
) {
  if (!existing) return true;

  return !(
    normalizeNonEmptyString(draft.notam_id) === normalizeNonEmptyString(existing.notam_id) &&
    normalizeNonEmptyString(draft.notam_key) === normalizeNonEmptyString(existing.notam_key) &&
    normalizeNonEmptyString(draft.gid) === normalizeNonEmptyString(existing.gid) &&
    normalizeNonEmptyString(draft.facility) === normalizeNonEmptyString(existing.facility) &&
    normalizeNonEmptyString(draft.state) === normalizeNonEmptyString(existing.state) &&
    normalizeNonEmptyString(draft.type) === normalizeNonEmptyString(existing.type) &&
    normalizeNonEmptyString(draft.legal) === normalizeNonEmptyString(existing.legal) &&
    normalizeNonEmptyString(draft.title) === normalizeNonEmptyString(existing.title) &&
    normalizeNonEmptyString(draft.description) === normalizeNonEmptyString(existing.description) &&
    normalizeNullableBoolean(draft.is_new) === normalizeNullableBoolean(existing.is_new) &&
    normalizeNonEmptyString(draft.mod_date) === normalizeNonEmptyString(existing.mod_date) &&
    normalizeNonEmptyString(draft.mod_abs_time) === normalizeNonEmptyString(existing.mod_abs_time) &&
    normalizeNonEmptyString(draft.mod_at) === normalizeNonEmptyString(existing.mod_at) &&
    normalizeNonEmptyString(draft.valid_start) === normalizeNonEmptyString(existing.valid_start) &&
    normalizeNonEmptyString(draft.valid_end) === normalizeNonEmptyString(existing.valid_end) &&
    Boolean(draft.has_shape) === Boolean(existing.has_shape) &&
    draft.status === existing.status &&
    stableJsonString(draft.raw) === stableJsonString(existing.raw)
  );
}

function hasDraftShapeChanged(row: Record<string, unknown>, existing: ExistingShapeRow | undefined) {
  if (!existing) return true;

  return !(
    normalizeNonEmptyString(row.source_shape_id) === normalizeNonEmptyString(existing.source_shape_id) &&
    normalizeNonEmptyString(row.faa_tfr_record_id) === normalizeNonEmptyString(existing.faa_tfr_record_id) &&
    toFiniteNumber(row.bbox_min_lat) === toFiniteNumber(existing.bbox_min_lat) &&
    toFiniteNumber(row.bbox_min_lon) === toFiniteNumber(existing.bbox_min_lon) &&
    toFiniteNumber(row.bbox_max_lat) === toFiniteNumber(existing.bbox_max_lat) &&
    toFiniteNumber(row.bbox_max_lon) === toFiniteNumber(existing.bbox_max_lon) &&
    normalizeNullableInt(row.point_count) === normalizeNullableInt(existing.point_count) &&
    stableJsonString(row.geometry) === stableJsonString(existing.geometry) &&
    stableJsonString(row.raw) === stableJsonString(existing.raw)
  );
}

function normalizeNullableBoolean(value: boolean | null | undefined) {
  if (value == null) return null;
  return value === true;
}

function normalizeNullableInt(value: unknown) {
  const parsed = toFiniteNumber(value);
  return parsed == null ? null : Math.trunc(parsed);
}

function toFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stableJsonString(value: unknown) {
  return JSON.stringify(normalizeJsonValue(value));
}

function normalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValue(entry));
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalizeJsonValue((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  return value ?? null;
}

function pickString(a: string | null, b: string | null) {
  return normalizeNonEmptyString(a) || normalizeNonEmptyString(b);
}

function laterIso(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return a;
  return bMs > aMs ? b : a;
}

function earlierIso(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return a;
  return bMs < aMs ? b : a;
}

function parseDate(value: unknown) {
  const raw = normalizeNonEmptyString(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': FAA_USER_AGENT,
      accept: 'application/json, text/plain;q=0.9, */*;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`fetch_${response.status}_${url}`);
  }

  return (await response.json()) as T;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function asPlainObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readInt(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
}

async function upsertSetting(supabase: ReturnType<typeof createSupabaseAdminClient>, key: string, value: unknown) {
  const { error } = await supabase
    .from('system_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
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
