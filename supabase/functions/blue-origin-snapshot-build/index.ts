import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import {
  classifyBlueOriginMission,
  finishIngestionRun,
  jsonResponse,
  readBooleanSetting,
  startIngestionRun,
  stringifyError,
  toIsoOrNull,
  updateCheckpoint
} from '../_shared/blueOriginIngest.ts';

type MissionKey = 'blue-origin-program' | 'new-shepard' | 'new-glenn' | 'blue-moon' | 'blue-ring' | 'be-4';

const MISSION_KEYS: MissionKey[] = ['blue-origin-program', 'new-shepard', 'new-glenn', 'blue-moon', 'blue-ring', 'be-4'];

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const runStartedAtIso = new Date().toISOString();
  const { runId } = await startIngestionRun(supabase, 'blue_origin_snapshot_build');

  const stats: Record<string, unknown> = {
    snapshotsUpserted: 0,
    launchesUsed: 0,
    timelineEventsUsed: 0,
    errors: [] as Array<{ step: string; error: string }>
  };

  try {
    const enabled = await readBooleanSetting(supabase, 'blue_origin_snapshot_job_enabled', true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    await updateCheckpoint(supabase, 'blue_origin_snapshot', {
      sourceType: 'curated-fallback',
      status: 'running',
      startedAt: runStartedAtIso,
      lastError: null
    });

    const { data: timelineRows, error: timelineError } = await supabase
      .from('blue_origin_timeline_events')
      .select('event_key,mission_key,title,summary,event_time,announced_time,source_type,confidence,status,source_url,metadata')
      .order('announced_time', { ascending: false })
      .limit(1600);

    if (timelineError) throw timelineError;

    const { data: launchRows, error: launchError } = await supabase
      .from('launches_public_cache')
      .select('launch_id,name,mission_name,net,status_name,status_abbrev,provider,vehicle,pad_name,pad_location_name')
      .or('provider.ilike.%Blue Origin%,name.ilike.%New Shepard%,name.ilike.%New Glenn%,name.ilike.%Blue Moon%,name.ilike.%Blue Ring%')
      .order('net', { ascending: true })
      .limit(400);

    if (launchError) throw launchError;

    const allTimeline = Array.isArray(timelineRows) ? timelineRows : [];
    const allLaunches = Array.isArray(launchRows) ? launchRows : [];

    stats.timelineEventsUsed = allTimeline.length;
    stats.launchesUsed = allLaunches.length;

    for (const missionKey of MISSION_KEYS) {
      const missionEvents = allTimeline.filter((row) => missionKey === 'blue-origin-program' || row.mission_key === missionKey);
      const missionLaunches = allLaunches.filter((row) => {
        if (missionKey === 'blue-origin-program') return true;
        const classified = classifyBlueOriginMission(`${row.name || ''} ${row.mission_name || ''}`);
        return classified === missionKey;
      });

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
        generatedAt: runStartedAtIso,
        lastUpdated,
        eventCount: missionEvents.length,
        launchCount: missionLaunches.length,
        nextLaunch,
        recentEvents: missionEvents.slice(0, 80)
      };

      const { error } = await supabase
        .from('blue_origin_mission_snapshots')
        .upsert(
          {
            mission_key: missionKey,
            generated_at: runStartedAtIso,
            last_updated: lastUpdated,
            snapshot,
            updated_at: runStartedAtIso
          },
          { onConflict: 'mission_key' }
        );

      if (error) throw error;
      stats.snapshotsUpserted = Number(stats.snapshotsUpserted || 0) + 1;
    }

    await updateCheckpoint(supabase, 'blue_origin_snapshot', {
      sourceType: 'curated-fallback',
      status: 'complete',
      endedAt: new Date().toISOString(),
      recordsIngested: Number(stats.snapshotsUpserted || 0),
      lastAnnouncedTime: runStartedAtIso,
      lastEventTime: runStartedAtIso,
      lastError: null,
      metadata: {
        launchesUsed: stats.launchesUsed,
        timelineEventsUsed: stats.timelineEventsUsed
      }
    });

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });

    await updateCheckpoint(supabase, 'blue_origin_snapshot', {
      sourceType: 'curated-fallback',
      status: 'error',
      endedAt: new Date().toISOString(),
      lastError: message
    }).catch(() => undefined);

    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});
