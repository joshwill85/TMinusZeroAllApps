import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import {
  classifyBlueOriginMission,
  finishIngestionRun,
  insertSourceDocument,
  jsonResponse,
  readBooleanSetting,
  readNumberSetting,
  startIngestionRun,
  stringifyError,
  toIsoOrNull,
  updateCheckpoint,
  upsertTimelineEvent
} from '../_shared/blueOriginIngest.ts';
import {
  extractBlueOriginFlightCodeFromUrl,
  extractMissionLinks,
  fetchTextWithMeta,
  resolveBlueOriginSourceUrls,
  stripHtml
} from '../_shared/blueOriginSources.ts';

type MissionLaunchRow = {
  launch_id: string;
  ll2_launch_uuid: string | null;
  name: string | null;
  mission_name: string | null;
  mission_description: string | null;
  net: string | null;
  cache_generated_at: string | null;
  status_name: string | null;
  status_abbrev: string | null;
  provider: string | null;
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const startedAtIso = new Date().toISOString();
  const { runId } = await startIngestionRun(supabase, 'blue_origin_missions_ingest');

  const stats: Record<string, unknown> = {
    sourceDocumentsInserted: 0,
    launchesScanned: 0,
    launchEventsUpserted: 0,
    missionLinksDiscovered: 0,
    missionLinkEventsUpserted: 0,
    flightsUpserted: 0,
    sourceFetchFailures: 0,
    challengeResponses: 0,
    timelineEventsUpserted: 0,
    errors: [] as Array<{ step: string; error: string }>
  };

  try {
    const enabled = await readBooleanSetting(supabase, 'blue_origin_missions_job_enabled', true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const retries = await readNumberSetting(supabase, 'blue_origin_source_fetch_retries', 4);
    const backoffMs = await readNumberSetting(supabase, 'blue_origin_source_fetch_backoff_ms', 900);
    const timeoutMs = await readNumberSetting(supabase, 'blue_origin_source_fetch_timeout_ms', 20_000);
    const launchLimit = clampInt(await readNumberSetting(supabase, 'blue_origin_missions_backfill_limit', 400), 50, 1200);
    const sourceUrls = await resolveBlueOriginSourceUrls(supabase);

    await updateCheckpoint(supabase, 'blue_origin_missions', {
      sourceType: 'blue-origin-official',
      status: 'running',
      startedAt: startedAtIso,
      lastError: null,
      metadata: {
        retries,
        backoffMs,
        timeoutMs,
        launchLimit
      }
    });

    const missionsPage = await fetchTextWithMeta(sourceUrls.missions, { retries, backoffMs, timeoutMs });
    const sourceDocId = await insertSourceDocument(supabase, {
      sourceKey: 'blue_origin_missions',
      sourceType: 'blue-origin-official',
      url: sourceUrls.missions,
      title: 'Blue Origin Missions',
      summary: stripHtml(missionsPage.text).slice(0, 2400) || `HTTP ${missionsPage.status} while fetching ${sourceUrls.missions}`,
      announcedTime: toIsoOrNull(missionsPage.lastModified) || new Date().toISOString(),
      httpStatus: missionsPage.status,
      contentType: missionsPage.contentType,
      etag: missionsPage.etag,
      lastModified: missionsPage.lastModified,
      raw: {
        ok: missionsPage.ok,
        challenge: missionsPage.challenge,
        throttled: missionsPage.throttled,
        retryAfterMs: missionsPage.retryAfterMs,
        attemptCount: missionsPage.attemptCount,
        finalUrl: missionsPage.finalUrl,
        error: missionsPage.error
      },
      error: missionsPage.ok ? null : missionsPage.error
    });
    stats.sourceDocumentsInserted = 1;
    if (!missionsPage.ok) stats.sourceFetchFailures = Number(stats.sourceFetchFailures || 0) + 1;
    if (missionsPage.challenge) stats.challengeResponses = Number(stats.challengeResponses || 0) + 1;

    const { data: launchRows, error: launchError } = await supabase
      .from('launches_public_cache')
      .select('launch_id,ll2_launch_uuid,name,mission_name,mission_description,net,cache_generated_at,status_name,status_abbrev,provider')
      .or('provider.ilike.%Blue Origin%,name.ilike.%New Shepard%,name.ilike.%New Glenn%,name.ilike.%Blue Moon%,name.ilike.%Blue Ring%')
      .order('net', { ascending: false })
      .limit(launchLimit);

    if (launchError) throw launchError;
    const launches = (launchRows || []) as MissionLaunchRow[];
    stats.launchesScanned = launches.length;
    const flightUpserts = [] as Array<Record<string, unknown>>;

    for (const launch of launches) {
      const missionKey = classifyBlueOriginMission(`${launch.name || ''} ${launch.mission_name || ''}`);
      const flightCode = extractFlightCode(`${launch.name || ''} ${launch.mission_name || ''}`);
      const announcedTime = toIsoOrNull(launch.cache_generated_at) || toIsoOrNull(launch.net) || startedAtIso;
      const status = mapTimelineStatus(launch.status_abbrev, launch.status_name, launch.net);
      const confidence = status === 'completed' ? 'high' : 'medium';
      const summary = buildLaunchSummary(launch);

      await upsertTimelineEvent(supabase, {
        eventKey: `blue-origin:launch:${launch.launch_id}`,
        missionKey,
        title: launch.name || launch.mission_name || 'Blue Origin mission update',
        summary,
        eventTime: launch.net,
        announcedTime,
        sourceType: 'll2-cache',
        confidence,
        status,
        sourceDocumentId: null,
        sourceUrl: null,
        metadata: {
          launchId: launch.launch_id,
          ll2LaunchUuid: launch.ll2_launch_uuid || null,
          flightCode,
          statusName: launch.status_name || null,
          statusAbbrev: launch.status_abbrev || null,
          provider: launch.provider || null
        }
      });
      stats.launchEventsUpserted = Number(stats.launchEventsUpserted || 0) + 1;

      if (flightCode) {
        flightUpserts.push({
          flight_code: flightCode,
          mission_key: missionKey,
          launch_id: launch.launch_id,
          ll2_launch_uuid: launch.ll2_launch_uuid || null,
          launch_name: launch.name || launch.mission_name || null,
          launch_date: launch.net,
          status,
          official_mission_url: null,
          source: 'launches_public_cache',
          confidence,
          metadata: {
            statusName: launch.status_name || null,
            statusAbbrev: launch.status_abbrev || null,
            provider: launch.provider || null
          },
          updated_at: new Date().toISOString()
        });
      }
    }

    if (flightUpserts.length > 0) {
      const { error: flightsUpsertError } = await supabase
        .from('blue_origin_flights')
        .upsert(flightUpserts, { onConflict: 'flight_code' });
      if (flightsUpsertError) throw flightsUpsertError;
      stats.flightsUpserted = flightUpserts.length;
    }

    if (missionsPage.ok) {
      const missionLinks = extractMissionLinks(missionsPage.text, missionsPage.finalUrl || sourceUrls.missions);
      stats.missionLinksDiscovered = missionLinks.length;

      for (const link of missionLinks) {
        const flightCode = extractBlueOriginFlightCodeFromUrl(link);
        const missionKey = classifyBlueOriginMission(link);
        const slug = (() => {
          try {
            const parsed = new URL(link);
            return parsed.pathname.split('/').filter(Boolean).at(-1) || link;
          } catch {
            return link;
          }
        })();

        await upsertTimelineEvent(supabase, {
          eventKey: `blue-origin:mission-page:${slug}`,
          missionKey,
          title: `Mission page indexed: ${slug}`,
          summary: `Official mission page discovered during missions crawl${flightCode ? ` (${flightCode.toUpperCase()})` : ''}.`,
          eventTime: null,
          announcedTime: startedAtIso,
          sourceType: 'blue-origin-official',
          confidence: 'high',
          status: 'completed',
          sourceDocumentId: sourceDocId,
          sourceUrl: link,
          metadata: {
            slug,
            flightCode
          }
        });
        stats.missionLinkEventsUpserted = Number(stats.missionLinkEventsUpserted || 0) + 1;
      }
    }

    stats.timelineEventsUpserted =
      Number(stats.launchEventsUpserted || 0) +
      Number(stats.missionLinkEventsUpserted || 0);

    await updateCheckpoint(supabase, 'blue_origin_missions', {
      sourceType: 'blue-origin-official',
      status: 'complete',
      endedAt: new Date().toISOString(),
      recordsIngested: Number(stats.timelineEventsUpserted || 0),
      lastAnnouncedTime: startedAtIso,
      lastEventTime: startedAtIso,
      lastError: null,
      metadata: {
        retries,
        backoffMs,
        timeoutMs,
        launchLimit,
        launchesScanned: stats.launchesScanned,
        missionLinksDiscovered: stats.missionLinksDiscovered,
        flightsUpserted: stats.flightsUpserted,
        sourceFetchFailures: stats.sourceFetchFailures,
        challengeResponses: stats.challengeResponses,
        sourceDocumentsInserted: stats.sourceDocumentsInserted
      }
    });

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });

    await updateCheckpoint(supabase, 'blue_origin_missions', {
      sourceType: 'blue-origin-official',
      status: 'error',
      endedAt: new Date().toISOString(),
      lastError: message
    }).catch(() => undefined);

    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function mapTimelineStatus(
  statusAbbrev: string | null,
  statusName: string | null,
  net: string | null
): 'completed' | 'upcoming' | 'tentative' | 'superseded' {
  const text = `${statusAbbrev || ''} ${statusName || ''}`.toLowerCase();
  if (text.includes('success') || text.includes('failure') || text.includes('partial')) return 'completed';
  if (text.includes('cancel') || text.includes('hold') || text.includes('delay') || text.includes('to be determined')) return 'tentative';

  const netMs = Date.parse(String(net || ''));
  if (Number.isFinite(netMs) && netMs > Date.now()) return 'upcoming';
  return 'completed';
}

function buildLaunchSummary(row: MissionLaunchRow) {
  const status = [row.status_name, row.status_abbrev].filter(Boolean).join(' / ');
  const description = (row.mission_description || '').trim();
  if (description) return description.slice(0, 1200);
  if (status) return `Mission status: ${status}.`;
  return 'Launch-linked Blue Origin mission update captured from launch cache.';
}

function extractFlightCode(text: string) {
  const normalized = text.toLowerCase();
  const ns = normalized.match(/\bns\s*[-#: ]?\s*(\d{1,3})\b/);
  if (ns?.[1]) return `ns-${Number(ns[1])}`;
  const ng = normalized.match(/\bng\s*[-#: ]?\s*(\d{1,3})\b/);
  if (ng?.[1]) return `ng-${Number(ng[1])}`;
  return null;
}
