import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import {
  finishIngestionRun,
  jsonResponse,
  readBooleanSetting,
  setSystemSetting,
  startIngestionRun,
  stringifyError,
  toIsoOrNull,
  updateCheckpoint
} from '../_shared/artemisIngest.ts';

type MissionKey =
  | 'program'
  | 'artemis-i'
  | 'artemis-ii'
  | 'artemis-iii'
  | 'artemis-iv'
  | 'artemis-v'
  | 'artemis-vi'
  | 'artemis-vii';

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'artemis_snapshot_build');
  const stats: Record<string, unknown> = {
    snapshotsUpserted: 0,
    timelineEventsUsed: 0,
    launchesUsed: 0,
    bootstrapComplete: false,
    errors: [] as Array<{ step: string; error: string }>
  };

  try {
    const enabled = await readBooleanSetting(supabase, 'artemis_snapshot_job_enabled', true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const { data: timelineRows, error: timelineError } = await supabase
      .from('artemis_timeline_events')
      .select('id, mission_key, title, summary, event_time, announced_time, source_type, confidence, supersedes_event_id, source_url, tags, metadata')
      .order('announced_time', { ascending: false })
      .limit(1200);
    if (timelineError) throw timelineError;

    const { data: launchRows, error: launchError } = await supabase
      .from('launches_public_cache')
      .select('launch_id, name, mission_name, net, status_name, status_abbrev, provider, vehicle, pad_name, pad_location_name')
      .or('name.ilike.%Artemis%,mission_name.ilike.%Artemis%')
      .order('net', { ascending: true })
      .limit(240);
    if (launchError) throw launchError;

    const allTimeline = Array.isArray(timelineRows) ? timelineRows : [];
    const allLaunches = Array.isArray(launchRows) ? launchRows : [];

    stats.timelineEventsUsed = allTimeline.length;
    stats.launchesUsed = allLaunches.length;

    const missionKeys: MissionKey[] = ['program', 'artemis-i', 'artemis-ii', 'artemis-iii', 'artemis-iv', 'artemis-v', 'artemis-vi', 'artemis-vii'];
    const nowIso = new Date().toISOString();

    for (const missionKey of missionKeys) {
      const missionEvents = allTimeline.filter((row) => row.mission_key === missionKey || (missionKey === 'program' && row.mission_key !== null));
      const missionLaunches = allLaunches.filter((row) => classifyMissionKey(`${row.name || ''} ${row.mission_name || ''}`) === missionKey || missionKey === 'program');

      const nextLaunch = missionLaunches.find((row) => {
        const netMs = Date.parse(String(row.net || ''));
        return Number.isFinite(netMs) && netMs >= Date.now();
      }) || null;

      const lastUpdated = missionEvents.reduce<string | null>((latest, row) => {
        const current = toIsoOrNull(row.announced_time);
        if (!current) return latest;
        if (!latest) return current;
        return Date.parse(current) > Date.parse(latest) ? current : latest;
      }, null);

      const snapshot = {
        missionKey,
        generatedAt: nowIso,
        lastUpdated,
        eventCount: missionEvents.length,
        launchCount: missionLaunches.length,
        nextLaunch,
        recentEvents: missionEvents.slice(0, 40)
      };

      const { error } = await supabase.from('artemis_mission_snapshots').upsert(
        {
          mission_key: missionKey,
          generated_at: nowIso,
          last_updated: lastUpdated,
          snapshot,
          updated_at: nowIso
        },
        { onConflict: 'mission_key' }
      );
      if (error) throw error;
      stats.snapshotsUpserted = Number(stats.snapshotsUpserted || 0) + 1;
    }

    const bootstrapComplete = await evaluateBootstrapComplete(supabase);
    stats.bootstrapComplete = bootstrapComplete;
    await setSystemSetting(supabase, 'artemis_bootstrap_complete', bootstrapComplete);

    await updateCheckpoint(supabase, 'nasa_campaign_pages', {
      sourceType: 'nasa_primary',
      metadata: {
        snapshotBuildAt: nowIso,
        bootstrapComplete
      }
    }).catch(() => undefined);

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });
    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});

async function evaluateBootstrapComplete(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { data, error } = await supabase
    .from('artemis_ingest_checkpoints')
    .select('status')
    .neq('status', 'complete')
    .limit(1);
  if (error) throw error;
  return !data || data.length === 0;
}

function classifyMissionKey(text: string): MissionKey {
  const value = text.toLowerCase();
  if (/\bartemis\s*(vii|7)\b/.test(value)) return 'artemis-vii';
  if (/\bartemis\s*(vi|6)\b/.test(value)) return 'artemis-vi';
  if (/\bartemis\s*(v|5)\b/.test(value)) return 'artemis-v';
  if (/\bartemis\s*(iv|4)\b/.test(value)) return 'artemis-iv';
  if (/\bartemis\s*(ii|2)\b/.test(value)) return 'artemis-ii';
  if (/\bartemis\s*(iii|3)\b/.test(value)) return 'artemis-iii';
  if (/\bartemis\s*(i|1)\b/.test(value)) return 'artemis-i';
  return 'program';
}
