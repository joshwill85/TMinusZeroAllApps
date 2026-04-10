import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';
import { normalizeNonEmptyString } from '../_shared/faa.ts';
import {
  computeLaunchWindow,
  decideLaunchMatch,
  scoreLaunchCandidate,
  type LaunchRow,
  type ShapeRow,
  type TfrRecordRow
} from '../_shared/faaLaunchMatch.ts';
import {
  buildDirectionalPriorsByLaunch,
  type DirectionalPrior,
  type TrajectoryConstraintRow
} from '../_shared/trajectoryDirection.ts';

const DEFAULTS = {
  enabled: true,
  candidateLimit: 250,
  recordLimit: 400,
  horizonDays: 21,
  lookbackHours: 24
};

type DirtyLaunchRow = {
  launch_id: string;
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'faa_launch_match');

  const stats: Record<string, unknown> = {
    launchesFetched: 0,
    directionalLaunches: 0,
    dirtyLaunchesFetched: 0,
    dirtyLaunchesCleared: 0,
    recordsFetched: 0,
    shapesFetched: 0,
    recordsProcessed: 0,
    matched: 0,
    ambiguous: 0,
    unmatched: 0,
    expiredUpdated: 0,
    deletedAutoRows: 0,
    insertedRows: 0,
    updatedRows: 0,
    errors: [] as Array<{ step: string; error: string }>
  };

  try {
    const settings = await getSettings(supabase, [
      'faa_match_job_enabled',
      'faa_match_candidate_limit',
      'faa_match_record_limit',
      'faa_job_match_horizon_days'
    ]);

    const enabled = readBooleanSetting(settings.faa_match_job_enabled, DEFAULTS.enabled);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const candidateLimit = clampInt(readNumberSetting(settings.faa_match_candidate_limit, DEFAULTS.candidateLimit), 20, 1500);
    const recordLimit = clampInt(readNumberSetting(settings.faa_match_record_limit, DEFAULTS.recordLimit), 20, 1500);
    const horizonDays = clampInt(readNumberSetting(settings.faa_job_match_horizon_days, DEFAULTS.horizonDays), 3, 90);

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const launchFromIso = new Date(nowMs - DEFAULTS.lookbackHours * 60 * 60 * 1000).toISOString();
    const launchToIso = new Date(nowMs + horizonDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: expiredRows, error: expiredError } = await supabase
      .from('faa_tfr_records')
      .update({ status: 'expired', updated_at: nowIso })
      .eq('status', 'active')
      .lt('valid_end', nowIso)
      .select('id');
    if (expiredError) throw expiredError;
    stats.expiredUpdated = (expiredRows || []).length;

    const [dirtyLaunchesRes, horizonLaunchesRes, recordsRes] = await Promise.all([
      supabase
        .from('faa_launch_match_dirty_launches')
        .select('launch_id')
        .order('last_queued_at', { ascending: true })
        .limit(candidateLimit),
      supabase
        .from('launches')
        .select(
          'id, name, mission_name, mission_orbit, provider, vehicle, net, window_start, window_end, pad_name, pad_short_code, pad_state, pad_country_code, pad_latitude, pad_longitude, location_name'
        )
        .eq('hidden', false)
        .gte('net', launchFromIso)
        .lte('net', launchToIso)
        .order('net', { ascending: true })
        .limit(candidateLimit),
      supabase
        .from('faa_tfr_records')
        .select(
          'id, source_key, notam_id, facility, state, type, legal, title, description, valid_start, valid_end, mod_at, status, has_shape'
        )
        .in('status', ['active', 'manual'])
        .order('mod_at', { ascending: false, nullsFirst: false })
        .order('updated_at', { ascending: false })
        .limit(recordLimit)
    ]);

    if (dirtyLaunchesRes.error) throw dirtyLaunchesRes.error;
    if (horizonLaunchesRes.error) throw horizonLaunchesRes.error;
    if (recordsRes.error) throw recordsRes.error;

    const dirtyLaunchIds = Array.from(
      new Set(((dirtyLaunchesRes.data || []) as DirtyLaunchRow[]).map((row) => String(row.launch_id)).filter(Boolean))
    );
    stats.dirtyLaunchesFetched = dirtyLaunchIds.length;

    let dirtyLaunches: LaunchRow[] = [];
    if (dirtyLaunchIds.length > 0) {
      const { data, error } = await supabase
        .from('launches')
        .select(
          'id, name, mission_name, mission_orbit, provider, vehicle, net, window_start, window_end, pad_name, pad_short_code, pad_state, pad_country_code, pad_latitude, pad_longitude, location_name'
        )
        .eq('hidden', false)
        .in('id', dirtyLaunchIds);
      if (error) throw error;
      dirtyLaunches = ((data || []) as LaunchRow[]).sort((a, b) => {
        const aa = a.net ? Date.parse(a.net) : Number.POSITIVE_INFINITY;
        const bb = b.net ? Date.parse(b.net) : Number.POSITIVE_INFINITY;
        return aa - bb;
      });
    }

    const launchesById = new Map<string, LaunchRow>();
    const launches: LaunchRow[] = [];
    for (const launch of dirtyLaunches) {
      if (launchesById.has(launch.id)) continue;
      launchesById.set(launch.id, launch);
      launches.push(launch);
      if (launches.length >= candidateLimit) break;
    }

    for (const launch of (horizonLaunchesRes.data || []) as LaunchRow[]) {
      if (launches.length >= candidateLimit) break;
      if (launchesById.has(launch.id)) continue;
      launchesById.set(launch.id, launch);
      launches.push(launch);
    }

    const records = (recordsRes.data || []) as TfrRecordRow[];

    stats.launchesFetched = launches.length;
    stats.recordsFetched = records.length;

    if (records.length === 0) {
      await upsertSetting(supabase, 'faa_match_last_success_at', new Date().toISOString());
      await upsertSetting(supabase, 'faa_match_last_error', '');
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'no_records' });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_records', elapsedMs: Date.now() - startedAt, stats });
    }

    let shapesByRecord = new Map<string, ShapeRow[]>();
    const recordIds = records.map((record) => record.id);

    if (recordIds.length > 0) {
      const { data: shapes, error: shapesError } = await supabase
        .from('faa_tfr_shapes')
        .select('id, faa_tfr_record_id, geometry, bbox_min_lat, bbox_min_lon, bbox_max_lat, bbox_max_lon')
        .in('faa_tfr_record_id', recordIds);
      if (shapesError) throw shapesError;

      const shapeRows = (shapes || []) as ShapeRow[];
      stats.shapesFetched = shapeRows.length;

      shapesByRecord = new Map<string, ShapeRow[]>();
      for (const shape of shapeRows) {
        const bucket = shapesByRecord.get(shape.faa_tfr_record_id) || [];
        bucket.push(shape);
        shapesByRecord.set(shape.faa_tfr_record_id, bucket);
      }
    }

    const launchWindows = new Map<string, ReturnType<typeof computeLaunchWindow>>(launches.map((launch) => [launch.id, computeLaunchWindow(launch)]));
    const launchIds = launches.map((launch) => launch.id);
    let directionalPriorsByLaunch = new Map<string, DirectionalPrior>();

    if (launchIds.length > 0) {
      const { data: constraintRowsRaw, error: constraintError } = await supabase
        .from('launch_trajectory_constraints')
        .select('launch_id, source, source_id, constraint_type, data, confidence, fetched_at')
        .in('launch_id', launchIds)
        .in('constraint_type', ['target_orbit', 'landing'])
        .order('fetched_at', { ascending: false });
      if (constraintError) throw constraintError;

      directionalPriorsByLaunch = buildDirectionalPriorsByLaunch(
        launches,
        ((constraintRowsRaw || []) as TrajectoryConstraintRow[]).filter((row) => normalizeNonEmptyString(row.launch_id) != null)
      );
      stats.directionalLaunches = directionalPriorsByLaunch.size;
    }

    const rowsToInsert: Array<Record<string, unknown>> = [];

    for (const record of records) {
      const shapes = shapesByRecord.get(record.id) || [];
      const ranked = launches
        .map((launch) => scoreLaunchCandidate({
          launch,
          launchWindow: launchWindows.get(launch.id) || { startMs: null, endMs: null, netMs: null },
          record,
          shapes,
          nowMs,
          directionalPrior: directionalPriorsByLaunch.get(launch.id) || null
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score);

      const decision = decideLaunchMatch(ranked);
      const { best, second, scoreGap, matchStatus, launchId, shapeId, matchConfidence, matchScore } = decision;

      if (matchStatus === 'matched') {
        stats.matched = Number(stats.matched || 0) + 1;
      } else if (matchStatus === 'ambiguous') {
        stats.ambiguous = Number(stats.ambiguous || 0) + 1;
      } else {
        stats.unmatched = Number(stats.unmatched || 0) + 1;
      }

      rowsToInsert.push({
        launch_id: launchId,
        faa_tfr_record_id: record.id,
        faa_tfr_shape_id: shapeId,
        match_status: matchStatus,
        match_confidence: matchConfidence,
        match_score: matchScore,
        match_strategy: 'v2_time_shape_corridor',
        match_meta: {
          record: {
            sourceKey: record.source_key,
            notamId: record.notam_id,
            state: record.state,
            facility: record.facility,
            hasShape: record.has_shape
          },
          bestCandidate: best
            ? {
                launchId: best.launch.id,
                score: Number(best.score.toFixed(2)),
                reasons: best.reasons,
                shapeId: best.shapeId,
                shapeContainsPad: best.shapeContainsPad,
                shapeBBoxHit: best.shapeBBoxHit,
                shapeCorridorHit: best.shapeCorridorHit,
                shapeCorridorDiffDeg: best.shapeCorridorDiffDeg,
                timeOverlap: best.timeOverlap,
                deltaHours: best.deltaHours,
                directionalAzDeg: best.directionalAzDeg,
                directionalSigmaDeg: best.directionalSigmaDeg,
                directionalSource: best.directionalSource,
                directionalProvenance: best.directionalProvenance,
                recordTypeClass: best.recordTypeClass,
                hasSpatialEvidence: best.hasSpatialEvidence,
                hasTextEvidence: best.hasTextEvidence
              }
            : null,
          scoreGap: scoreGap != null ? Number(scoreGap.toFixed(2)) : null,
          topCandidates: ranked.slice(0, 3).map((candidate) => ({
            launchId: candidate.launch.id,
            score: Number(candidate.score.toFixed(2)),
            reasons: candidate.reasons
          })),
          evaluatedLaunchCount: launches.length,
          shapeCount: shapes.length,
          evaluatedAt: nowIso
        },
        match_origin: 'auto',
        matched_at: nowIso,
        updated_at: nowIso
      });
    }

    stats.recordsProcessed = rowsToInsert.length;

    if (rowsToInsert.length > 0) {
      const { data: mergeData, error: mergeError } = await supabase.rpc('upsert_faa_launch_matches_auto_if_changed', {
        rows_in: rowsToInsert
      });

      if (!mergeError) {
        const mergeStats = asPlainObject(mergeData);
        stats.insertedRows = readInt(mergeStats.inserted);
        stats.updatedRows = readInt(mergeStats.updated);
        stats.deletedAutoRows = readInt(mergeStats.dedupDeleted);
      } else {
        // Backward-compatible fallback for environments before migration 0222.
        console.warn('upsert_faa_launch_matches_auto_if_changed failed; falling back to delete+insert', mergeError);

        if (recordIds.length > 0) {
          const { data: deletedRows, error: deleteError } = await supabase
            .from('faa_launch_matches')
            .delete()
            .eq('match_origin', 'auto')
            .in('faa_tfr_record_id', recordIds)
            .select('id');
          if (deleteError) throw deleteError;
          stats.deletedAutoRows = (deletedRows || []).length;
        }

        const chunks = chunkArray(rowsToInsert, 200);
        let insertedTotal = 0;
        for (const chunk of chunks) {
          const { data: insertedRows, error: insertError } = await supabase
            .from('faa_launch_matches')
            .insert(chunk)
            .select('id');
          if (insertError) throw insertError;
          insertedTotal += (insertedRows || []).length;
        }
        stats.insertedRows = insertedTotal;
      }
    }

    if (dirtyLaunchIds.length > 0) {
      const { data: clearedRows, error: clearError } = await supabase
        .from('faa_launch_match_dirty_launches')
        .delete()
        .in('launch_id', dirtyLaunchIds)
        .select('launch_id');
      if (clearError) throw clearError;
      stats.dirtyLaunchesCleared = (clearedRows || []).length;
    }

    await upsertSetting(supabase, 'faa_match_last_success_at', new Date().toISOString());
    await upsertSetting(supabase, 'faa_match_last_error', '');

    const ok = (stats.errors as Array<any>).length === 0;
    await finishIngestionRun(supabase, runId, ok, stats, ok ? undefined : 'partial_failure');

    return jsonResponse({ ok, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });

    await upsertSetting(supabase, 'faa_match_last_error', message);
    await finishIngestionRun(supabase, runId, false, stats, message);

    return jsonResponse({ ok: false, elapsedMs: Date.now() - startedAt, error: message, stats }, 500);
  }
});

async function upsertSetting(supabase: ReturnType<typeof createSupabaseAdminClient>, key: string, value: unknown) {
  const { error } = await supabase
    .from('system_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
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

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function chunkArray<T>(items: T[], size: number) {
  if (size <= 0 || items.length <= size) return [items];
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
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
