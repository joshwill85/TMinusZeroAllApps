import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';
import {
  normalizeNonEmptyString,
  pointInBoundingBox,
  pointInGeometry,
  type GeoPoint,
  type GeometryBBox
} from '../_shared/faa.ts';

const DEFAULTS = {
  enabled: true,
  candidateLimit: 250,
  recordLimit: 400,
  horizonDays: 21,
  lookbackHours: 24,
  bboxPaddingDeg: 0.15
};

type LaunchRow = {
  id: string;
  name: string | null;
  mission_name: string | null;
  provider: string | null;
  vehicle: string | null;
  net: string | null;
  window_start: string | null;
  window_end: string | null;
  pad_name: string | null;
  pad_short_code: string | null;
  pad_state: string | null;
  pad_country_code: string | null;
  pad_latitude: number | null;
  pad_longitude: number | null;
};

type DirtyLaunchRow = {
  launch_id: string;
};

type TfrRecordRow = {
  id: string;
  source_key: string;
  notam_id: string | null;
  facility: string | null;
  state: string | null;
  type: string | null;
  legal: string | null;
  title: string | null;
  description: string | null;
  valid_start: string | null;
  valid_end: string | null;
  mod_at: string | null;
  status: 'active' | 'expired' | 'manual';
  has_shape: boolean;
};

type ShapeRow = {
  id: string;
  faa_tfr_record_id: string;
  geometry: Record<string, unknown> | null;
  bbox_min_lat: number | null;
  bbox_min_lon: number | null;
  bbox_max_lat: number | null;
  bbox_max_lon: number | null;
};

type LaunchWindow = {
  startMs: number | null;
  endMs: number | null;
  netMs: number | null;
};

type CandidateScore = {
  launch: LaunchRow;
  score: number;
  reasons: string[];
  shapeId: string | null;
  shapeContainsPad: boolean;
  shapeBBoxHit: boolean;
  timeOverlap: boolean;
  deltaHours: number | null;
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'faa_launch_match');

  const stats: Record<string, unknown> = {
    launchesFetched: 0,
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
          'id, name, mission_name, provider, vehicle, net, window_start, window_end, pad_name, pad_short_code, pad_state, pad_country_code, pad_latitude, pad_longitude'
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
          'id, name, mission_name, provider, vehicle, net, window_start, window_end, pad_name, pad_short_code, pad_state, pad_country_code, pad_latitude, pad_longitude'
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

    const launchWindows = new Map<string, LaunchWindow>(launches.map((launch) => [launch.id, computeLaunchWindow(launch)]));

    const rowsToInsert: Array<Record<string, unknown>> = [];

    for (const record of records) {
      const shapes = shapesByRecord.get(record.id) || [];
      const ranked = launches
        .map((launch) => scoreLaunchCandidate({
          launch,
          launchWindow: launchWindows.get(launch.id) || { startMs: null, endMs: null, netMs: null },
          record,
          shapes,
          nowMs
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score);

      const best = ranked[0] || null;
      const second = ranked[1] || null;
      const scoreGap = best && second ? best.score - second.score : null;

      let matchStatus: 'matched' | 'ambiguous' | 'unmatched' = 'unmatched';
      let launchId: string | null = null;
      let shapeId: string | null = null;
      let matchConfidence: number | null = null;
      let matchScore: number | null = null;

      if (best) {
        const roundedScore = Math.round(best.score);
        matchConfidence = clampInt(roundedScore, 0, 100);
        matchScore = Number(best.score.toFixed(2));

        if (best.score >= 65 && (scoreGap == null || scoreGap >= 8)) {
          matchStatus = 'matched';
          launchId = best.launch.id;
          shapeId = best.shapeId;
        } else if (best.score >= 52) {
          matchStatus = 'ambiguous';
          launchId = best.launch.id;
          shapeId = best.shapeId;
        }
      }

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
        match_strategy: 'v1_time_shape_state',
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
                timeOverlap: best.timeOverlap,
                deltaHours: best.deltaHours
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

function scoreLaunchCandidate({
  launch,
  launchWindow,
  record,
  shapes,
  nowMs
}: {
  launch: LaunchRow;
  launchWindow: LaunchWindow;
  record: TfrRecordRow;
  shapes: ShapeRow[];
  nowMs: number;
}): CandidateScore {
  let score = 0;
  const reasons: string[] = [];

  const recordWindow = computeRecordWindow(record);

  let shapeId: string | null = null;
  let shapeContainsPad = false;
  let shapeBBoxHit = false;

  const timeResult = scoreTimeAlignment({ launchWindow, recordWindow, nowMs });
  score += timeResult.score;
  if (timeResult.reason) reasons.push(timeResult.reason);

  const stateMatch = isSameToken(record.state, launch.pad_state);
  if (stateMatch) {
    score += 10;
    reasons.push('state_match');
  }

  const recordText = [record.facility, record.title, record.legal, record.description]
    .map((value) => normalizeNonEmptyString(value)?.toLowerCase() || '')
    .join(' ');

  const padTokens = [launch.pad_short_code, launch.pad_name]
    .map((value) => normalizeToken(value))
    .filter(Boolean) as string[];

  if (padTokens.some((token) => token.length >= 3 && recordText.includes(token))) {
    score += 14;
    reasons.push('pad_text_match');
  }

  const providerToken = normalizeToken(launch.provider);
  if (providerToken && providerToken.length >= 4 && recordText.includes(providerToken)) {
    score += 8;
    reasons.push('provider_text_match');
  }

  const vehicleToken = normalizeToken(launch.vehicle);
  if (vehicleToken && vehicleToken.length >= 4 && recordText.includes(vehicleToken)) {
    score += 8;
    reasons.push('vehicle_text_match');
  }

  const isSpaceOps = ['space operations', 'space operation', 'space launch', 'launch operations'].some((needle) =>
    recordText.includes(needle)
  );
  if (isSpaceOps) {
    score += 6;
    reasons.push('space_ops_type');
  }

  const hasPadPoint =
    typeof launch.pad_latitude === 'number' &&
    Number.isFinite(launch.pad_latitude) &&
    typeof launch.pad_longitude === 'number' &&
    Number.isFinite(launch.pad_longitude);

  if (hasPadPoint && shapes.length > 0) {
    const point: GeoPoint = { lat: Number(launch.pad_latitude), lon: Number(launch.pad_longitude) };

    let bestShapeScore = 0;
    for (const shape of shapes) {
      const bbox = toBBox(shape);
      const bboxHit = pointInBoundingBox(point, bbox, DEFAULTS.bboxPaddingDeg);
      if (!bboxHit) continue;

      shapeBBoxHit = true;

      let shapeScore = 8;
      let containsPad = false;
      if (shape.geometry && pointInGeometry(point, shape.geometry)) {
        shapeScore = 36;
        containsPad = true;
      }

      if (shapeScore > bestShapeScore) {
        bestShapeScore = shapeScore;
        shapeId = shape.id;
        shapeContainsPad = containsPad;
      }
    }

    if (bestShapeScore > 0) {
      score += bestShapeScore;
      reasons.push(shapeContainsPad ? 'shape_contains_pad' : 'shape_bbox_hit');
    }
  }

  const launchNameToken = normalizeToken(launch.name);
  if (launchNameToken && launchNameToken.length >= 6 && recordText.includes(launchNameToken)) {
    score += 10;
    reasons.push('launch_name_text_match');
  }

  score = Math.min(100, Math.max(0, score));

  return {
    launch,
    score,
    reasons,
    shapeId,
    shapeContainsPad,
    shapeBBoxHit,
    timeOverlap: timeResult.overlap,
    deltaHours: timeResult.deltaHours
  };
}

function computeLaunchWindow(launch: LaunchRow): LaunchWindow {
  const netMs = launch.net ? Date.parse(launch.net) : NaN;
  const startMsRaw = launch.window_start ? Date.parse(launch.window_start) : NaN;
  const endMsRaw = launch.window_end ? Date.parse(launch.window_end) : NaN;

  const net = Number.isFinite(netMs) ? netMs : null;
  const start = Number.isFinite(startMsRaw) ? startMsRaw : net;
  const end = Number.isFinite(endMsRaw) ? endMsRaw : net;

  return {
    startMs: start,
    endMs: end,
    netMs: net
  };
}

function computeRecordWindow(record: TfrRecordRow) {
  const startMsRaw = record.valid_start ? Date.parse(record.valid_start) : NaN;
  const endMsRaw = record.valid_end ? Date.parse(record.valid_end) : NaN;

  const startMs = Number.isFinite(startMsRaw) ? startMsRaw : null;
  const endMs = Number.isFinite(endMsRaw) ? endMsRaw : null;

  return { startMs, endMs };
}

function scoreTimeAlignment({
  launchWindow,
  recordWindow,
  nowMs
}: {
  launchWindow: LaunchWindow;
  recordWindow: { startMs: number | null; endMs: number | null };
  nowMs: number;
}) {
  const launchStart = launchWindow.startMs;
  const launchEnd = launchWindow.endMs;
  const launchNet = launchWindow.netMs;
  const recordStart = recordWindow.startMs;
  const recordEnd = recordWindow.endMs;

  if (recordStart != null && recordEnd != null && launchStart != null && launchEnd != null) {
    const overlaps = launchStart <= recordEnd && launchEnd >= recordStart;
    if (overlaps) {
      return {
        score: 44,
        reason: 'time_overlap',
        overlap: true,
        deltaHours: 0
      };
    }

    const deltaMs = Math.min(Math.abs(launchStart - recordEnd), Math.abs(recordStart - launchEnd));
    const deltaHours = deltaMs / (60 * 60 * 1000);
    if (deltaHours <= 6) return { score: 26, reason: 'time_near_6h', overlap: false, deltaHours };
    if (deltaHours <= 24) return { score: 14, reason: 'time_near_24h', overlap: false, deltaHours };
    if (deltaHours <= 72) return { score: 6, reason: 'time_near_72h', overlap: false, deltaHours };
    return { score: 0, reason: null, overlap: false, deltaHours };
  }

  if (launchNet != null && recordStart != null && recordEnd == null) {
    if (launchNet >= recordStart) {
      const deltaHours = (launchNet - recordStart) / (60 * 60 * 1000);
      if (deltaHours <= 24) return { score: 12, reason: 'time_after_open_start', overlap: false, deltaHours };
    }
  }

  if (launchNet != null && recordEnd != null && recordStart == null) {
    if (launchNet <= recordEnd) {
      const deltaHours = (recordEnd - launchNet) / (60 * 60 * 1000);
      if (deltaHours <= 24) return { score: 12, reason: 'time_before_open_end', overlap: false, deltaHours };
    }
  }

  if (launchNet != null && recordStart == null && recordEnd == null) {
    const deltaHours = Math.abs(nowMs - launchNet) / (60 * 60 * 1000);
    if (deltaHours <= 24) return { score: 8, reason: 'time_recent_launch', overlap: false, deltaHours };
  }

  return { score: 0, reason: null, overlap: false, deltaHours: null as number | null };
}

function toBBox(shape: ShapeRow): GeometryBBox | null {
  const minLat = typeof shape.bbox_min_lat === 'number' ? shape.bbox_min_lat : NaN;
  const minLon = typeof shape.bbox_min_lon === 'number' ? shape.bbox_min_lon : NaN;
  const maxLat = typeof shape.bbox_max_lat === 'number' ? shape.bbox_max_lat : NaN;
  const maxLon = typeof shape.bbox_max_lon === 'number' ? shape.bbox_max_lon : NaN;

  if (![minLat, minLon, maxLat, maxLon].every((value) => Number.isFinite(value))) return null;

  return {
    minLat,
    minLon,
    maxLat,
    maxLon
  };
}

function normalizeToken(value: string | null | undefined) {
  return normalizeNonEmptyString(value)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isSameToken(a: string | null | undefined, b: string | null | undefined) {
  const aa = normalizeToken(a);
  const bb = normalizeToken(b);
  if (!aa || !bb) return false;
  return aa === bb;
}

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
