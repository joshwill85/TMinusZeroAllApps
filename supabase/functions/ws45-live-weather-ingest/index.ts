import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting } from '../_shared/settings.ts';
import { getWs45LiveCadenceMinutes, normalizeWs45LiveBoardPayload } from '../../../shared/ws45LiveBoard.ts';

const LIVE_BOARD_URL = 'https://nimboard.rad.spaceforce.mil/nimboard';
const LIVE_BOARD_API_AGENCIES_URL = 'https://nimboard.rad.spaceforce.mil/api/agencies';
const LIVE_BOARD_API_LIGHTNING_URL = 'https://nimboard.rad.spaceforce.mil/api/lightningrings';

type LaunchCandidate = {
  launch_id: string;
  name: string | null;
  mission_name: string | null;
  net: string | null;
  window_start: string | null;
  window_end: string | null;
  pad_name: string | null;
  pad_short_code: string | null;
  pad_location_name: string | null;
  pad_state: string | null;
  pad_country_code: string | null;
};

serve(async (req) => {
  const startedAt = Date.now();
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const stats: Record<string, unknown> = {
    boardUrl: LIVE_BOARD_URL,
    agenciesUrl: LIVE_BOARD_API_AGENCIES_URL,
    lightningUrl: LIVE_BOARD_API_LIGHTNING_URL,
    cadenceMinutes: null,
    rowsInserted: 0,
    skipped: false,
    reason: null,
    errors: [] as Array<{ step: string; error: string; context?: Record<string, unknown> }>
  };

  const { runId } = await startIngestionRun(supabase, 'ws45_live_weather_ingest');

  try {
    const settings = await getSettings(supabase, ['ws45_live_weather_job_enabled']);
    if (!readBooleanSetting(settings.ws45_live_weather_job_enabled, true)) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt, stats });
    }

    const dueLaunch = await loadDueLaunchCandidate(supabase);
    if (!dueLaunch) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'no_launch_within_24h' });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_launch_within_24h', elapsedMs: Date.now() - startedAt, stats });
    }

    const launchAtIso = dueLaunch.window_start || dueLaunch.net;
    const cadenceMinutes = getWs45LiveCadenceMinutes(launchAtIso);
    stats.launchId = dueLaunch.launch_id;
    stats.launchName = dueLaunch.name;
    stats.launchNet = dueLaunch.net;
    stats.cadenceMinutes = cadenceMinutes;

    if (cadenceMinutes == null) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'launch_outside_cadence_window' });
      return jsonResponse({ ok: true, skipped: true, reason: 'launch_outside_cadence_window', elapsedMs: Date.now() - startedAt, stats });
    }

    const latestFetchedAt = await loadLatestSnapshotFetchedAt(supabase);
    if (latestFetchedAt) {
      const latestMs = Date.parse(latestFetchedAt);
      const ageMinutes = Number.isFinite(latestMs) ? Math.floor((Date.now() - latestMs) / (60 * 1000)) : null;
      stats.latestFetchedAt = latestFetchedAt;
      stats.latestAgeMinutes = ageMinutes;
      if (Number.isFinite(latestMs) && Date.now() - latestMs < cadenceMinutes * 60 * 1000) {
        await finishIngestionRun(supabase, runId, true, {
          ...stats,
          skipped: true,
          reason: 'not_due'
        });
        return jsonResponse({ ok: true, skipped: true, reason: 'not_due', elapsedMs: Date.now() - startedAt, stats });
      }
    }

    const agenciesRaw = await fetchJson(LIVE_BOARD_API_AGENCIES_URL);
    let lightningRingsRaw: unknown = [];
    try {
      lightningRingsRaw = await fetchJson(LIVE_BOARD_API_LIGHTNING_URL);
    } catch (err) {
      (stats.errors as Array<Record<string, unknown>>).push({
        step: 'fetch_lightningrings',
        error: stringifyError(err)
      });
    }

    const normalized = normalizeWs45LiveBoardPayload(agenciesRaw);
    stats.agencyCount = normalized.agencyCount;
    stats.ringCount = normalized.ringCount;
    stats.activePhase1Count = normalized.activePhase1Count;
    stats.activePhase2Count = normalized.activePhase2Count;
    stats.activeWindCount = normalized.activeWindCount;
    stats.activeSevereCount = normalized.activeSevereCount;
    stats.summary = normalized.summary;

    const { error: insertError } = await supabase.from('ws45_live_weather_snapshots').insert({
      agency_count: normalized.agencyCount,
      ring_count: normalized.ringCount,
      active_phase_1_count: normalized.activePhase1Count,
      active_phase_2_count: normalized.activePhase2Count,
      active_wind_count: normalized.activeWindCount,
      active_severe_count: normalized.activeSevereCount,
      summary: normalized.summary,
      agencies: normalized.agencies,
      lightning_rings: normalized.lightningRings,
      raw: {
        agencies: agenciesRaw,
        lightningRings: lightningRingsRaw
      }
    });
    if (insertError) throw insertError;

    stats.rowsInserted = 1;
    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<Record<string, unknown>>).push({ step: 'ingest', error: message });
    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, elapsedMs: Date.now() - startedAt, stats, error: message }, 500);
  }
});

async function loadDueLaunchCandidate(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const nowIso = new Date().toISOString();
  const horizonIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('launches_public_cache')
    .select('launch_id, name, mission_name, net, window_start, window_end, pad_name, pad_short_code, pad_location_name, pad_state, pad_country_code')
    .eq('pad_state', 'FL')
    .gte('net', nowIso)
    .lte('net', horizonIso)
    .order('net', { ascending: true })
    .limit(8);

  if (error) throw error;
  const launches = ((data || []) as LaunchCandidate[]).filter((row) => row.net || row.window_start);
  launches.sort((left, right) => parseLaunchAnchor(left) - parseLaunchAnchor(right));
  return launches[0] ?? null;
}

async function loadLatestSnapshotFetchedAt(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { data, error } = await supabase
    .from('ws45_live_weather_snapshots')
    .select('fetched_at')
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return typeof data?.fetched_at === 'string' ? data.fetched_at : null;
}

function parseLaunchAnchor(launch: LaunchCandidate) {
  const value = launch.window_start || launch.net || '';
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'TMinusZero/0.1 (support@tminuszero.app)'
    }
  });
  if (!response.ok) throw new Error(`live_board_http_${response.status}`);
  return await response.json();
}

async function startIngestionRun(supabase: ReturnType<typeof createSupabaseAdminClient>, jobName: string) {
  const { data, error } = await supabase.from('ingestion_runs').insert({ job_name: jobName }).select('id').single();
  if (error) {
    console.warn('Failed to start ingestion_runs record', { jobName, error: error.message });
    return { runId: null as number | null };
  }
  return { runId: Number((data as { id?: number } | null)?.id ?? 0) || null };
}

async function finishIngestionRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: number | null,
  success: boolean,
  stats?: Record<string, unknown>,
  errorMessage?: string
) {
  if (!runId) return;
  const update = {
    success,
    ended_at: new Date().toISOString(),
    stats: stats ?? {},
    error: errorMessage ?? null
  };
  const { error } = await supabase.from('ingestion_runs').update(update).eq('id', runId);
  if (error) {
    console.warn('Failed to update ingestion_runs record', { runId, error: error.message });
  }
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  return String(err);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
