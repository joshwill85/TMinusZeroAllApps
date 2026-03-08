import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import {
  classifyMission,
  finishIngestionRun,
  insertSourceDocument,
  jsonResponse,
  readBooleanSetting,
  startIngestionRun,
  stringifyError,
  toIsoOrNull,
  updateCheckpoint,
  upsertTimelineEvent
} from '../_shared/artemisIngest.ts';
import { ARTEMIS_SOURCE_URLS, extractRssItems, fetchTextWithMeta, stripHtml } from '../_shared/artemisSources.ts';

type ArtemisLaunchRow = {
  launch_id: string;
  name: string | null;
  mission_name: string | null;
  net: string | null;
  cache_generated_at: string | null;
  status_name: string | null;
  status_abbrev: string | null;
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'artemis_nasa_ingest');

  const stats: Record<string, unknown> = {
    sourcesFetched: 0,
    sourcesFailed: 0,
    sourceDocumentsInserted: 0,
    timelineEventsUpserted: 0,
    launchesConsidered: 0,
    errors: [] as Array<{ step: string; error: string; context?: Record<string, unknown> }>
  };

  const sourceKeys = ['nasa_campaign_pages', 'nasa_blog_posts', 'nasa_reference_timelines', 'nasa_rss'] as const;

  try {
    const enabled = await readBooleanSetting(supabase, 'artemis_nasa_job_enabled', true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    for (const key of sourceKeys) {
      await updateCheckpoint(supabase, key, {
        sourceType: 'nasa_primary',
        status: 'running',
        startedAt: new Date().toISOString(),
        lastError: null
      });
    }

    const campaign = await fetchTextWithMeta(ARTEMIS_SOURCE_URLS.nasaCampaign);
    const blog = await fetchTextWithMeta(ARTEMIS_SOURCE_URLS.nasaBlog);
    const timeline = await fetchTextWithMeta(ARTEMIS_SOURCE_URLS.nasaTimeline);
    const missionsFeed = await fetchTextWithMeta(ARTEMIS_SOURCE_URLS.nasaMissionsFeed);
    const blogFeed = await fetchTextWithMeta(ARTEMIS_SOURCE_URLS.nasaBlogFeed);

    const docs: Array<{ id: string; sourceKey: (typeof sourceKeys)[number] }> = [];

    const campaignDocId = await insertSourceDocument(supabase, {
      sourceKey: 'nasa_campaign_pages',
      sourceType: 'nasa_primary',
      url: ARTEMIS_SOURCE_URLS.nasaCampaign,
      title: 'NASA Artemis Campaign',
      summary: stripHtml(campaign.text).slice(0, 2400),
      announcedTime: toIsoOrNull(campaign.lastModified) || new Date().toISOString(),
      httpStatus: campaign.status,
      contentType: campaign.contentType,
      raw: { etag: campaign.etag, lastModified: campaign.lastModified }
    });
    docs.push({ id: campaignDocId, sourceKey: 'nasa_campaign_pages' });

    const blogDocId = await insertSourceDocument(supabase, {
      sourceKey: 'nasa_blog_posts',
      sourceType: 'nasa_primary',
      url: ARTEMIS_SOURCE_URLS.nasaBlog,
      title: 'NASA Artemis Blog',
      summary: stripHtml(blog.text).slice(0, 2400),
      announcedTime: toIsoOrNull(blog.lastModified) || new Date().toISOString(),
      httpStatus: blog.status,
      contentType: blog.contentType,
      raw: { etag: blog.etag, lastModified: blog.lastModified }
    });
    docs.push({ id: blogDocId, sourceKey: 'nasa_blog_posts' });

    const timelineDocId = await insertSourceDocument(supabase, {
      sourceKey: 'nasa_reference_timelines',
      sourceType: 'nasa_primary',
      url: ARTEMIS_SOURCE_URLS.nasaTimeline,
      title: 'NASA Artemis I Mission Timeline',
      summary: stripHtml(timeline.text).slice(0, 2400),
      announcedTime: toIsoOrNull(timeline.lastModified) || new Date().toISOString(),
      httpStatus: timeline.status,
      contentType: timeline.contentType,
      raw: { etag: timeline.etag, lastModified: timeline.lastModified }
    });
    docs.push({ id: timelineDocId, sourceKey: 'nasa_reference_timelines' });

    const mergedRss = [...extractRssItems(missionsFeed.text), ...extractRssItems(blogFeed.text)];
    const rssDocId = await insertSourceDocument(supabase, {
      sourceKey: 'nasa_rss',
      sourceType: 'nasa_primary',
      url: ARTEMIS_SOURCE_URLS.nasaMissionsFeed,
      title: 'NASA Artemis RSS Feed Bundle',
      summary: `Bundled ${mergedRss.length} RSS items from NASA Artemis mission and blog feeds.`,
      announcedTime: toIsoOrNull(missionsFeed.lastModified) || new Date().toISOString(),
      httpStatus: missionsFeed.status,
      contentType: missionsFeed.contentType,
      raw: {
        missionsFeedStatus: missionsFeed.status,
        blogFeedStatus: blogFeed.status,
        missionsFeedEtag: missionsFeed.etag,
        blogFeedEtag: blogFeed.etag,
        itemCount: mergedRss.length,
        items: mergedRss.slice(0, 250)
      }
    });
    docs.push({ id: rssDocId, sourceKey: 'nasa_rss' });

    stats.sourcesFetched = 5;
    stats.sourceDocumentsInserted = docs.length;

    const { data: launches, error: launchesError } = await supabase
      .from('launches_public_cache')
      .select('launch_id,name,mission_name,net,cache_generated_at,status_name,status_abbrev')
      .or('name.ilike.%Artemis%,mission_name.ilike.%Artemis%')
      .order('net', { ascending: true })
      .limit(200);

    if (launchesError) throw launchesError;

    const rows = (launches || []) as ArtemisLaunchRow[];
    stats.launchesConsidered = rows.length;

    let timelineUpserts = 0;
    for (const launch of rows) {
      const mission = classifyMission(`${launch.name || ''} ${launch.mission_name || ''}`);
      const eventTime = toIsoOrNull(launch.net);
      const announcedTime = toIsoOrNull(launch.cache_generated_at) || new Date().toISOString();
      const title = launch.name || launch.mission_name || 'Artemis milestone';
      const summary = `Status: ${launch.status_abbrev || launch.status_name || 'unknown'}.`;
      const fingerprint = ['nasa', launch.launch_id, eventTime || 'no-time', launch.status_name || 'unknown'].join('|');

      await upsertTimelineEvent(supabase, {
        fingerprint,
        missionKey: mission,
        title,
        summary,
        eventTime,
        eventTimePrecision: eventTime ? 'minute' : 'unknown',
        announcedTime,
        sourceType: 'nasa_primary',
        confidence: 'secondary',
        sourceDocumentId: campaignDocId,
        sourceUrl: ARTEMIS_SOURCE_URLS.nasaCampaign,
        tags: ['launch-feed']
      });
      timelineUpserts += 1;
    }

    for (const item of mergedRss.slice(0, 80)) {
      const mission = classifyMission(`${item.title} ${item.description}`);
      const announcedTime = toIsoOrNull(item.pubDate) || new Date().toISOString();
      if (!item.title) continue;
      const fingerprint = ['nasa-rss', item.link || item.title, announcedTime].join('|');
      await upsertTimelineEvent(supabase, {
        fingerprint,
        missionKey: mission,
        title: item.title,
        summary: item.description || 'NASA Artemis update',
        eventTime: null,
        eventTimePrecision: 'unknown',
        announcedTime,
        sourceType: 'nasa_primary',
        confidence: 'primary',
        sourceDocumentId: rssDocId,
        sourceUrl: item.link || ARTEMIS_SOURCE_URLS.nasaMissionsFeed,
        tags: ['rss-update']
      });
      timelineUpserts += 1;
    }

    stats.timelineEventsUpserted = timelineUpserts;

    for (const key of sourceKeys) {
      const recordCount = key === 'nasa_rss' ? mergedRss.length : rows.length;
      await updateCheckpoint(supabase, key, {
        sourceType: 'nasa_primary',
        status: 'complete',
        recordsIngested: recordCount,
        endedAt: new Date().toISOString(),
        lastAnnouncedTime: new Date().toISOString(),
        lastEventTime: rows[rows.length - 1]?.net || null,
        lastError: null
      });
    }

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });
    stats.sourcesFailed = Number(stats.sourcesFailed || 0) + 1;

    for (const key of sourceKeys) {
      await updateCheckpoint(supabase, key, {
        sourceType: 'nasa_primary',
        status: 'error',
        endedAt: new Date().toISOString(),
        lastError: message
      }).catch(() => undefined);
    }

    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});
