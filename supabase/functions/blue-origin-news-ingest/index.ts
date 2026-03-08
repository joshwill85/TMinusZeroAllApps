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
  extractNewsLinks,
  fetchTextWithMeta,
  resolveBlueOriginSourceUrls,
  stripHtml
} from '../_shared/blueOriginSources.ts';

type LaunchRow = {
  launch_id: string;
  name: string | null;
  mission_name: string | null;
  net: string | null;
  provider: string | null;
};

type SnapiJoinRow = {
  snapi_uid: string;
  launch_id: string;
};

type SnapiRow = {
  snapi_uid: string;
  item_type: string;
  title: string;
  url: string;
  news_site: string | null;
  summary: string | null;
  image_url: string | null;
  published_at: string | null;
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const runStartedAtIso = new Date().toISOString();
  const { runId } = await startIngestionRun(supabase, 'blue_origin_news_ingest');

  const stats: Record<string, unknown> = {
    sourceDocumentsInserted: 0,
    timelineEventsUpserted: 0,
    launchesScanned: 0,
    snapiLinksScanned: 0,
    snapiItemsScanned: 0,
    officialLinksDiscovered: 0,
    sourceFetchFailures: 0,
    challengeResponses: 0,
    errors: [] as Array<{ step: string; error: string }>
  };

  try {
    const enabled = await readBooleanSetting(supabase, 'blue_origin_news_job_enabled', true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const retries = await readNumberSetting(supabase, 'blue_origin_source_fetch_retries', 4);
    const backoffMs = await readNumberSetting(supabase, 'blue_origin_source_fetch_backoff_ms', 900);
    const timeoutMs = await readNumberSetting(supabase, 'blue_origin_source_fetch_timeout_ms', 20_000);
    const itemLimit = clampInt(await readNumberSetting(supabase, 'blue_origin_news_backfill_limit', 400), 20, 400);
    const sourceUrls = await resolveBlueOriginSourceUrls(supabase);

    await updateCheckpoint(supabase, 'blue_origin_news', {
      sourceType: 'blue-origin-official',
      status: 'running',
      startedAt: runStartedAtIso,
      lastError: null,
      metadata: {
        retries,
        backoffMs,
        timeoutMs,
        itemLimit
      }
    });

    const sourceResponse = await fetchTextWithMeta(sourceUrls.news, { retries, backoffMs, timeoutMs });
    const sourceDocId = await insertSourceDocument(supabase, {
      sourceKey: 'blue_origin_news',
      sourceType: 'blue-origin-official',
      url: sourceUrls.news,
      title: 'Blue Origin News',
      summary: stripHtml(sourceResponse.text).slice(0, 2400) || `HTTP ${sourceResponse.status} while fetching ${sourceUrls.news}`,
      announcedTime: toIsoOrNull(sourceResponse.lastModified) || new Date().toISOString(),
      httpStatus: sourceResponse.status,
      contentType: sourceResponse.contentType,
      etag: sourceResponse.etag,
      lastModified: sourceResponse.lastModified,
      raw: {
        ok: sourceResponse.ok,
        challenge: sourceResponse.challenge,
        throttled: sourceResponse.throttled,
        retryAfterMs: sourceResponse.retryAfterMs,
        attemptCount: sourceResponse.attemptCount,
        finalUrl: sourceResponse.finalUrl,
        error: sourceResponse.error
      },
      error: sourceResponse.ok ? null : sourceResponse.error
    });
    stats.sourceDocumentsInserted = 1;
    if (!sourceResponse.ok) stats.sourceFetchFailures = Number(stats.sourceFetchFailures || 0) + 1;
    if (sourceResponse.challenge) stats.challengeResponses = Number(stats.challengeResponses || 0) + 1;

    const { data: launchRows, error: launchError } = await supabase
      .from('launches_public_cache')
      .select('launch_id,name,mission_name,net,provider')
      .or('provider.ilike.%Blue Origin%,name.ilike.%New Shepard%,name.ilike.%New Glenn%')
      .order('net', { ascending: false })
      .limit(600);
    if (launchError) throw launchError;

    const launches = (launchRows || []) as LaunchRow[];
    stats.launchesScanned = launches.length;

    const launchIds = launches.map((row) => row.launch_id);
    const missionByLaunch = new Map(
      launches.map((row) => [row.launch_id, classifyBlueOriginMission(`${row.name || ''} ${row.mission_name || ''}`)])
    );

    let joinRows = [] as SnapiJoinRow[];
    if (launchIds.length > 0) {
      const { data, error } = await supabase
        .from('snapi_item_launches')
        .select('snapi_uid,launch_id')
        .in('launch_id', launchIds)
        .limit(5_000);
      if (error) throw error;
      joinRows = (data || []) as SnapiJoinRow[];
    }
    stats.snapiLinksScanned = joinRows.length;

    const launchIdsByUid = new Map<string, string[]>();
    for (const row of joinRows) {
      const existing = launchIdsByUid.get(row.snapi_uid) || [];
      existing.push(row.launch_id);
      launchIdsByUid.set(row.snapi_uid, existing);
    }

    const snapiUids = [...new Set(joinRows.map((row) => row.snapi_uid))];
    const snapiItems = [] as SnapiRow[];
    for (const chunk of chunkArray(snapiUids, 200)) {
      const { data, error } = await supabase
        .from('snapi_items')
        .select('snapi_uid,item_type,title,url,news_site,summary,image_url,published_at')
        .in('snapi_uid', chunk)
        .order('published_at', { ascending: false })
        .limit(1_000);
      if (error) throw error;
      snapiItems.push(...((data || []) as SnapiRow[]));
    }
    stats.snapiItemsScanned = snapiItems.length;

    let ingested = 0;
    for (const item of snapiItems) {
      if (ingested >= itemLimit) break;
      const linkedLaunchIds = launchIdsByUid.get(item.snapi_uid) || [];
      const missionKey = linkedLaunchIds.length
        ? missionByLaunch.get(linkedLaunchIds[0]) || classifyBlueOriginMission(item.title || '')
        : classifyBlueOriginMission(item.title || '');
      const announcedTime = toIsoOrNull(item.published_at) || runStartedAtIso;

      await upsertTimelineEvent(supabase, {
        eventKey: `blue-origin:news:snapi:${item.snapi_uid}`,
        missionKey,
        title: item.title || 'Blue Origin news item',
        summary: (item.summary || item.news_site || 'Launch-linked Blue Origin article').slice(0, 1200),
        eventTime: toIsoOrNull(item.published_at),
        announcedTime,
        sourceType: 'll2-cache',
        confidence: 'medium',
        status: 'completed',
        sourceDocumentId: null,
        sourceUrl: item.url,
        metadata: {
          source: 'snapi_items',
          itemType: item.item_type || null,
          newsSite: item.news_site || null,
          linkedLaunchIds
        }
      });
      ingested += 1;
    }

    stats.timelineEventsUpserted = Number(stats.timelineEventsUpserted || 0) + ingested;

    if (sourceResponse.ok) {
      const officialLinks = extractNewsLinks(sourceResponse.text, sourceResponse.finalUrl || sourceUrls.news);
      stats.officialLinksDiscovered = officialLinks.length;

      for (const link of officialLinks.slice(0, 40)) {
        const slug = (() => {
          try {
            const parsed = new URL(link);
            return parsed.pathname.split('/').filter(Boolean).at(-1) || link;
          } catch {
            return link;
          }
        })();
        const missionKey = classifyBlueOriginMission(slug);

        await upsertTimelineEvent(supabase, {
          eventKey: `blue-origin:news:official:${slug}`,
          missionKey,
          title: `Official news indexed: ${slug}`,
          summary: 'Blue Origin official news item discovered during crawl.',
          eventTime: null,
          announcedTime: runStartedAtIso,
          sourceType: 'blue-origin-official',
          confidence: 'high',
          status: 'completed',
          sourceDocumentId: sourceDocId,
          sourceUrl: link,
          metadata: {
            source: 'blue-origin-news-page',
            slug
          }
        });
        stats.timelineEventsUpserted = Number(stats.timelineEventsUpserted || 0) + 1;
      }
    }

    await upsertTimelineEvent(supabase, {
      eventKey: `blue-origin:news-refresh:${runStartedAtIso.slice(0, 10)}`,
      missionKey: 'blue-origin-program',
      title: 'Blue Origin news feed refreshed',
      summary: sourceResponse.ok
        ? 'Official Blue Origin newsroom snapshot captured for weekly program intelligence update.'
        : 'Official Blue Origin newsroom was challenged or unavailable; launch-linked news cache used.',
      eventTime: null,
      announcedTime: runStartedAtIso,
      sourceType: sourceResponse.ok ? 'blue-origin-official' : 'll2-cache',
      confidence: sourceResponse.ok ? 'high' : 'medium',
      status: 'completed',
      sourceDocumentId: sourceDocId,
      sourceUrl: sourceUrls.news,
      metadata: {
        challenge: sourceResponse.challenge,
        status: sourceResponse.status,
        fallbackSnapiItems: ingested
      }
    });
    stats.timelineEventsUpserted = Number(stats.timelineEventsUpserted || 0) + 1;

    await updateCheckpoint(supabase, 'blue_origin_news', {
      sourceType: 'blue-origin-official',
      status: 'complete',
      endedAt: new Date().toISOString(),
      recordsIngested: Number(stats.timelineEventsUpserted || 0),
      lastAnnouncedTime: runStartedAtIso,
      lastEventTime: runStartedAtIso,
      lastError: null,
      metadata: {
        itemLimit,
        launchesScanned: stats.launchesScanned,
        snapiLinksScanned: stats.snapiLinksScanned,
        snapiItemsScanned: stats.snapiItemsScanned,
        officialLinksDiscovered: stats.officialLinksDiscovered,
        sourceFetchFailures: stats.sourceFetchFailures,
        challengeResponses: stats.challengeResponses
      }
    });

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });

    await updateCheckpoint(supabase, 'blue_origin_news', {
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

function chunkArray<T>(items: T[], chunkSize: number) {
  if (items.length === 0) return [] as T[][];
  const size = Math.max(1, Math.trunc(chunkSize));
  const out = [] as T[][];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
