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
  updateCheckpoint,
  upsertTimelineEvent
} from '../_shared/blueOriginIngest.ts';

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const runStartedAtIso = new Date().toISOString();
  const { runId } = await startIngestionRun(supabase, 'blue_origin_social_ingest');

  const stats: Record<string, unknown> = {
    launchesScanned: 0,
    timelineEventsUpserted: 0,
    errors: [] as Array<{ step: string; error: string }>
  };

  try {
    const enabled = await readBooleanSetting(supabase, 'blue_origin_social_job_enabled', true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    await updateCheckpoint(supabase, 'blue_origin_social', {
      sourceType: 'social',
      status: 'running',
      startedAt: runStartedAtIso,
      lastError: null
    });

    const { data: launchRows, error } = await supabase
      .from('launches_public_cache')
      .select('launch_id,name,mission_name,net,social_primary_post_url,social_primary_post_platform,social_primary_post_matched_at')
      .or('provider.ilike.%Blue Origin%,name.ilike.%New Shepard%,name.ilike.%New Glenn%')
      .not('social_primary_post_url', 'is', null)
      .order('net', { ascending: false })
      .limit(240);

    if (error) throw error;

    const rows = (launchRows || []) as Array<{
      launch_id: string;
      name: string | null;
      mission_name: string | null;
      net: string | null;
      social_primary_post_url: string | null;
      social_primary_post_platform: string | null;
      social_primary_post_matched_at: string | null;
    }>;

    stats.launchesScanned = rows.length;

    for (const row of rows) {
      if (!row.social_primary_post_url) continue;
      const missionKey = classifyBlueOriginMission(`${row.name || ''} ${row.mission_name || ''}`);
      const announcedTime = row.social_primary_post_matched_at || row.net || runStartedAtIso;

      await upsertTimelineEvent(supabase, {
        eventKey: `blue-origin:social:${row.launch_id}`,
        missionKey,
        title: row.name || row.mission_name || 'Blue Origin social update',
        summary: `Launch-linked social update (${row.social_primary_post_platform || 'social'}) captured for mission context.`,
        eventTime: row.net,
        announcedTime,
        sourceType: 'social',
        confidence: 'medium',
        status: 'completed',
        sourceUrl: row.social_primary_post_url,
        metadata: {
          platform: row.social_primary_post_platform || null,
          launchId: row.launch_id
        }
      });

      stats.timelineEventsUpserted = Number(stats.timelineEventsUpserted || 0) + 1;
    }

    await updateCheckpoint(supabase, 'blue_origin_social', {
      sourceType: 'social',
      status: 'complete',
      endedAt: new Date().toISOString(),
      recordsIngested: Number(stats.timelineEventsUpserted || 0),
      lastAnnouncedTime: runStartedAtIso,
      lastEventTime: runStartedAtIso,
      lastError: null,
      metadata: {
        launchesScanned: stats.launchesScanned
      }
    });

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });

    await updateCheckpoint(supabase, 'blue_origin_social', {
      sourceType: 'social',
      status: 'error',
      endedAt: new Date().toISOString(),
      lastError: message
    }).catch(() => undefined);

    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});
