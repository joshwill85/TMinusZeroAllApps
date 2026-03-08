import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { TRAJECTORY_PRODUCTS_FOLLOWUP_COALESCE, triggerEdgeJob } from '../_shared/edgeJobTrigger.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';
import { buildNotamSourceUrl } from '../_shared/faa.ts';

const PARSER_VERSION = 'v1';

const DEFAULTS = {
  enabled: true,
  recordLimit: 500,
  matchHorizonDays: 21,
  windowBufferHours: 12
};

type LaunchRow = {
  launch_id: string;
  net: string | null;
  name: string | null;
};

type MatchRow = {
  launch_id: string | null;
  faa_tfr_record_id: string;
  faa_tfr_shape_id: string | null;
  match_status: 'matched' | 'ambiguous' | 'unmatched' | 'manual';
  match_confidence: number | null;
  match_score: number | null;
  match_meta: Record<string, unknown> | null;
  matched_at: string | null;
  updated_at: string | null;
};

type RecordRow = {
  id: string;
  source_key: string;
  notam_id: string | null;
  facility: string | null;
  state: string | null;
  title: string | null;
  valid_start: string | null;
  valid_end: string | null;
  mod_at: string | null;
  updated_at: string | null;
};

type ShapeRow = {
  id: string;
  faa_tfr_record_id: string;
  geometry: Record<string, unknown> | null;
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'faa_trajectory_hazard_ingest');

  const stats: Record<string, unknown> = {
    launchesFound: 0,
    matchesFetched: 0,
    recordsFetched: 0,
    shapesFetched: 0,
    rowsPrepared: 0,
    rowsSkippedNoRecord: 0,
    rowsSkippedNoShape: 0,
    rowsSkippedWindow: 0,
    constraintsUpserted: 0,
    constraintsMergedInput: 0,
    constraintsInserted: 0,
    constraintsUpdated: 0,
    constraintsSkipped: 0,
    mergeFallback: false,
    launchCoverage: {} as Record<
      string,
      {
        hazardAreasMatched: number;
        constraintsUpserted: number;
      }
    >,
    trajectoryProductsTrigger: null as Record<string, unknown> | null,
    errors: [] as Array<{ step: string; error: string; context?: Record<string, unknown> }>
  };

  try {
    const settings = await getSettings(supabase, [
      'faa_trajectory_hazard_job_enabled',
      'faa_trajectory_hazard_record_limit',
      'faa_trajectory_hazard_match_horizon_days',
      'faa_trajectory_hazard_window_buffer_hours'
    ]);

    const enabled = readBooleanSetting(settings.faa_trajectory_hazard_job_enabled, DEFAULTS.enabled);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const recordLimit = clampInt(readNumberSetting(settings.faa_trajectory_hazard_record_limit, DEFAULTS.recordLimit), 50, 2000);
    const matchHorizonDays = clampInt(
      readNumberSetting(settings.faa_trajectory_hazard_match_horizon_days, DEFAULTS.matchHorizonDays),
      3,
      90
    );
    const windowBufferHours = clampInt(
      readNumberSetting(settings.faa_trajectory_hazard_window_buffer_hours, DEFAULTS.windowBufferHours),
      0,
      72
    );

    const nowMs = Date.now();
    const fromIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
    const toIso = new Date(nowMs + matchHorizonDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: launches, error: launchesError } = await supabase
      .from('launches_public_cache')
      .select('launch_id, net, name')
      .gte('net', fromIso)
      .lte('net', toIso)
      .order('net', { ascending: true })
      .limit(300);
    if (launchesError) throw launchesError;

    const launchRows = ((launches || []) as LaunchRow[]).filter((row) => typeof row.launch_id === 'string');
    stats.launchesFound = launchRows.length;
    for (const launch of launchRows) {
      ensureFaaLaunchCoverage(stats, launch.launch_id);
    }
    if (!launchRows.length) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'no_launches' });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_launches', elapsedMs: Date.now() - startedAt, stats });
    }

    const launchIds = launchRows.map((row) => row.launch_id);
    const launchById = new Map<string, LaunchRow>(launchRows.map((row) => [row.launch_id, row]));

    const { data: matches, error: matchesError } = await supabase
      .from('faa_launch_matches')
      .select(
        'launch_id, faa_tfr_record_id, faa_tfr_shape_id, match_status, match_confidence, match_score, match_meta, matched_at, updated_at'
      )
      .in('launch_id', launchIds)
      .in('match_status', ['matched', 'manual'])
      .order('matched_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .limit(recordLimit);
    if (matchesError) throw matchesError;

    const matchRows = (matches || []) as MatchRow[];
    stats.matchesFetched = matchRows.length;
    if (!matchRows.length) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'no_matches' });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_matches', elapsedMs: Date.now() - startedAt, stats });
    }

    const recordIds = [...new Set(matchRows.map((row) => row.faa_tfr_record_id).filter(Boolean))];
    const shapeIds = [...new Set(matchRows.map((row) => row.faa_tfr_shape_id).filter(Boolean))];

    const [recordsRes, recordShapesRes] = await Promise.all([
      supabase
        .from('faa_tfr_records')
        .select('id, source_key, notam_id, facility, state, title, valid_start, valid_end, mod_at, updated_at')
        .in('id', recordIds),
      supabase
        .from('faa_tfr_shapes')
        .select('id, faa_tfr_record_id, geometry')
        .in('faa_tfr_record_id', recordIds)
    ]);
    const selectedShapesRes = shapeIds.length
      ? await supabase
          .from('faa_tfr_shapes')
          .select('id, faa_tfr_record_id, geometry')
          .in('id', shapeIds)
      : { data: [] as ShapeRow[], error: null };

    if (recordsRes.error) throw recordsRes.error;
    if (selectedShapesRes.error) throw selectedShapesRes.error;
    if (recordShapesRes.error) throw recordShapesRes.error;

    const records = (recordsRes.data || []) as RecordRow[];
    const selectedShapes = (selectedShapesRes.data || []) as ShapeRow[];
    const recordShapes = (recordShapesRes.data || []) as ShapeRow[];
    stats.recordsFetched = records.length;
    stats.shapesFetched = recordShapes.length;

    const recordById = new Map<string, RecordRow>(records.map((row) => [row.id, row]));
    const shapeById = new Map<string, ShapeRow>(selectedShapes.map((row) => [row.id, row]));
    const shapesByRecord = new Map<string, ShapeRow[]>();
    for (const shape of recordShapes) {
      const bucket = shapesByRecord.get(shape.faa_tfr_record_id) || [];
      bucket.push(shape);
      shapesByRecord.set(shape.faa_tfr_record_id, bucket);
    }

    const nowIso = new Date().toISOString();
    const constraintRows: Array<Record<string, unknown>> = [];
    const preparedConstraintRowsByLaunch = new Map<string, number>();

    for (const match of matchRows) {
      const launchId = typeof match.launch_id === 'string' ? match.launch_id : null;
      if (!launchId) continue;
      const launch = launchById.get(launchId) ?? null;
      if (!launch) continue;

      const record = recordById.get(match.faa_tfr_record_id) ?? null;
      if (!record) {
        stats.rowsSkippedNoRecord = (stats.rowsSkippedNoRecord as number) + 1;
        continue;
      }

      const launchNetMs = launch.net ? Date.parse(launch.net) : NaN;
      const recordStartMs = record.valid_start ? Date.parse(record.valid_start) : NaN;
      const recordEndMs = record.valid_end ? Date.parse(record.valid_end) : NaN;
      if (
        Number.isFinite(launchNetMs) &&
        !windowLikelyRelevant({
          launchNetMs,
          startMs: Number.isFinite(recordStartMs) ? recordStartMs : null,
          endMs: Number.isFinite(recordEndMs) ? recordEndMs : null,
          bufferHours: windowBufferHours
        })
      ) {
        stats.rowsSkippedWindow = (stats.rowsSkippedWindow as number) + 1;
        continue;
      }

      const shapesForMatch: ShapeRow[] = [];
      if (typeof match.faa_tfr_shape_id === 'string' && match.faa_tfr_shape_id) {
        const selected = shapeById.get(match.faa_tfr_shape_id) ?? null;
        if (selected) shapesForMatch.push(selected);
      }
      if (!shapesForMatch.length) {
        const fallbackShapes = shapesByRecord.get(record.id) || [];
        for (const shape of fallbackShapes) shapesForMatch.push(shape);
      }
      if (!shapesForMatch.length) {
        stats.rowsSkippedNoShape = (stats.rowsSkippedNoShape as number) + 1;
        continue;
      }

      for (const shape of shapesForMatch) {
        if (!shape.geometry || typeof shape.geometry !== 'object') continue;
        const sourceId = `faa:${record.id}:${shape.id}`;
        const confidence = deriveHazardConfidence({
          matchStatus: match.match_status,
          matchConfidence: match.match_confidence
        });
        const sourceHash = [
          'faa_tfr',
          record.id,
          shape.id,
          record.mod_at || '',
          record.updated_at || '',
          match.match_status || '',
          match.match_confidence == null ? '' : String(match.match_confidence)
        ].join(':');

        constraintRows.push({
          launch_id: launchId,
          source: 'faa_tfr',
          source_id: sourceId,
          constraint_type: 'hazard_area',
          confidence,
          ingestion_run_id: runId,
          source_hash: sourceHash,
          extracted_field_map: {
            geometry: true,
            valid_window: Boolean(record.valid_start || record.valid_end),
            notam_id: Boolean(record.notam_id),
            match_confidence: typeof match.match_confidence === 'number',
            match_score: typeof match.match_score === 'number'
          },
          parse_rule_id: 'faa_tfr_hazard_match_v1',
          parser_version: PARSER_VERSION,
          license_class: 'public_faa',
          data: {
            faaTfrRecordId: record.id,
            faaTfrShapeId: shape.id,
            sourceKey: record.source_key,
            notamId: record.notam_id,
            title: record.title,
            facility: record.facility,
            state: record.state,
            validStartUtc: record.valid_start,
            validEndUtc: record.valid_end,
            matchStatus: match.match_status,
            matchConfidence: match.match_confidence,
            matchScore: match.match_score,
            matchMeta: match.match_meta || {},
            sourceUrl: buildNotamSourceUrl(record.notam_id),
            parserVersion: PARSER_VERSION
          },
          geometry: shape.geometry,
          fetched_at: nowIso
        });
        preparedConstraintRowsByLaunch.set(launchId, (preparedConstraintRowsByLaunch.get(launchId) ?? 0) + 1);
        bumpFaaLaunchCoverage(stats, launchId, 'hazardAreasMatched');
      }
    }

    stats.rowsPrepared = constraintRows.length;
    if (!constraintRows.length) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'no_rows' });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_rows', elapsedMs: Date.now() - startedAt, stats });
    }

    const merged = await upsertTrajectoryConstraintsIfChanged(supabase, constraintRows);
    stats.constraintsMergedInput = merged.input;
    stats.constraintsInserted = merged.inserted;
    stats.constraintsUpdated = merged.updated;
    stats.constraintsSkipped = merged.skipped;
    stats.constraintsUpserted = merged.inserted + merged.updated;
    stats.mergeFallback = merged.usedFallback;

    for (const [launchId, count] of preparedConstraintRowsByLaunch.entries()) {
      for (let i = 0; i < count; i += 1) {
        bumpFaaLaunchCoverage(stats, launchId, 'constraintsUpserted');
      }
    }

    if (hasPositiveFaaLaunchCoverage(stats)) {
      stats.trajectoryProductsTrigger = await triggerEdgeJob({
        supabase,
        jobSlug: 'trajectory-products-generate',
        coalesce: TRAJECTORY_PRODUCTS_FOLLOWUP_COALESCE
      });
    }

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });
    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, elapsedMs: Date.now() - startedAt, error: message, stats }, 500);
  }
});

function windowLikelyRelevant({
  launchNetMs,
  startMs,
  endMs,
  bufferHours
}: {
  launchNetMs: number;
  startMs: number | null;
  endMs: number | null;
  bufferHours: number;
}) {
  const bufferMs = bufferHours * 60 * 60 * 1000;
  if (startMs != null && endMs != null) {
    return launchNetMs >= startMs - bufferMs && launchNetMs <= endMs + bufferMs;
  }
  if (startMs != null) return launchNetMs >= startMs - bufferMs;
  if (endMs != null) return launchNetMs <= endMs + bufferMs;
  return true;
}

function deriveHazardConfidence({
  matchStatus,
  matchConfidence
}: {
  matchStatus: MatchRow['match_status'];
  matchConfidence: number | null;
}) {
  let confidence = typeof matchConfidence === 'number' && Number.isFinite(matchConfidence) ? matchConfidence / 100 : 0.72;
  if (matchStatus === 'manual') confidence = Math.max(confidence, 0.88);
  return clamp(confidence, 0.5, 0.98);
}

function bumpFaaLaunchCoverage(
  stats: Record<string, unknown>,
  launchId: string,
  key: 'hazardAreasMatched' | 'constraintsUpserted'
) {
  ensureFaaLaunchCoverage(stats, launchId);
  const launchCoverage = stats.launchCoverage as Record<
    string,
    {
      hazardAreasMatched: number;
      constraintsUpserted: number;
    }
  >;
  launchCoverage[launchId][key] += 1;
}

function ensureFaaLaunchCoverage(stats: Record<string, unknown>, launchId: string) {
  const launchCoverage = stats.launchCoverage as Record<
    string,
    {
      hazardAreasMatched: number;
      constraintsUpserted: number;
    }
  >;
  if (!launchCoverage[launchId]) {
    launchCoverage[launchId] = { hazardAreasMatched: 0, constraintsUpserted: 0 };
  }
}

function hasPositiveFaaLaunchCoverage(stats: Record<string, unknown>) {
  const launchCoverage = stats.launchCoverage as Record<
    string,
    {
      hazardAreasMatched: number;
      constraintsUpserted: number;
    }
  >;
  return Object.values(launchCoverage).some(
    (entry) =>
      (typeof entry?.hazardAreasMatched === 'number' && entry.hazardAreasMatched > 0) ||
      (typeof entry?.constraintsUpserted === 'number' && entry.constraintsUpserted > 0)
  );
}

async function upsertTrajectoryConstraintsIfChanged(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: Array<Record<string, unknown>>
) {
  const { data, error } = await supabase.rpc('upsert_launch_trajectory_constraints_if_changed', {
    rows_in: rows
  });
  if (!error) {
    const stats = asPlainObject(data);
    return {
      input: readInt(stats.input),
      inserted: readInt(stats.inserted),
      updated: readInt(stats.updated),
      skipped: readInt(stats.skipped),
      usedFallback: false
    };
  }

  console.warn('upsert_launch_trajectory_constraints_if_changed failed; falling back to upsert', error);
  const { data: fallbackRows, error: fallbackError } = await supabase
    .from('launch_trajectory_constraints')
    .upsert(rows, { onConflict: 'launch_id,source,constraint_type,source_id' })
    .select('id');
  if (fallbackError) throw fallbackError;
  const touched = Array.isArray(fallbackRows) ? fallbackRows.length : rows.length;
  return {
    input: rows.length,
    inserted: 0,
    updated: touched,
    skipped: Math.max(0, rows.length - touched),
    usedFallback: true
  };
}

function asPlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed));
  }
  return 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'unknown_error';
  }
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
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
