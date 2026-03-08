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

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'artemis_oversight_ingest');
  const stats: Record<string, unknown> = {
    sourcesFetched: 0,
    sourceDocumentsInserted: 0,
    timelineEventsUpserted: 0,
    blockedSources: 0,
    errors: [] as Array<{ step: string; error: string }>
  };

  const checkpoints = [
    { key: 'oig_reports', type: 'oversight' as const },
    { key: 'gao_reports', type: 'oversight' as const }
  ];

  try {
    const enabled = await readBooleanSetting(supabase, 'artemis_oversight_job_enabled', true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    for (const entry of checkpoints) {
      await updateCheckpoint(supabase, entry.key, {
        sourceType: entry.type,
        status: 'running',
        startedAt: new Date().toISOString(),
        lastError: null
      });
    }

    const oigAudits = await fetchTextWithMeta(ARTEMIS_SOURCE_URLS.oigAudits);
    const oigFeed = await fetchTextWithMeta(ARTEMIS_SOURCE_URLS.oigFeed);
    const gaoSearch = await fetchTextWithMeta(ARTEMIS_SOURCE_URLS.gaoArtemisQuery);

    const oigDocId = await insertSourceDocument(supabase, {
      sourceKey: 'oig_reports',
      sourceType: 'oversight',
      url: ARTEMIS_SOURCE_URLS.oigAudits,
      title: 'NASA OIG Audits',
      summary: stripHtml(oigAudits.text).slice(0, 2400),
      announcedTime: toIsoOrNull(oigAudits.lastModified) || new Date().toISOString(),
      httpStatus: oigAudits.status,
      contentType: oigAudits.contentType,
      raw: { etag: oigAudits.etag, lastModified: oigAudits.lastModified }
    });

    const oigFeedItems = extractRssItems(oigFeed.text).filter((item) => /artemis|orion|sls|gateway|lunar/i.test(`${item.title} ${item.description}`));
    let upsertCount = 0;
    for (const item of oigFeedItems.slice(0, 60)) {
      if (!item.title) continue;
      const fingerprint = ['oig', item.link || item.title, item.pubDate || 'no-date'].join('|');
      await upsertTimelineEvent(supabase, {
        fingerprint,
        missionKey: classifyMission(`${item.title} ${item.description}`),
        title: item.title,
        summary: item.description || 'NASA OIG update',
        eventTime: null,
        eventTimePrecision: 'unknown',
        announcedTime: toIsoOrNull(item.pubDate) || new Date().toISOString(),
        sourceType: 'oversight',
        confidence: 'oversight',
        sourceDocumentId: oigDocId,
        sourceUrl: item.link || ARTEMIS_SOURCE_URLS.oigFeed,
        tags: ['oig']
      });
      upsertCount += 1;
    }

    let gaoError: string | null = null;
    if (!gaoSearch.ok) {
      gaoError = `gao_http_${gaoSearch.status}`;
      stats.blockedSources = Number(stats.blockedSources || 0) + 1;
      (stats.errors as Array<any>).push({ step: 'gao_fetch', error: gaoError });
    }

    const gaoDocId = await insertSourceDocument(supabase, {
      sourceKey: 'gao_reports',
      sourceType: 'oversight',
      url: ARTEMIS_SOURCE_URLS.gaoArtemisQuery,
      title: 'GAO Artemis Search',
      summary: stripHtml(gaoSearch.text).slice(0, 2400),
      announcedTime: toIsoOrNull(gaoSearch.lastModified) || new Date().toISOString(),
      httpStatus: gaoSearch.status,
      contentType: gaoSearch.contentType,
      raw: { etag: gaoSearch.etag, lastModified: gaoSearch.lastModified },
      error: gaoError
    });

    if (!gaoError) {
      const fingerprint = ['gao', gaoDocId, new Date().toISOString().slice(0, 13)].join('|');
      await upsertTimelineEvent(supabase, {
        fingerprint,
        missionKey: 'program',
        title: 'GAO Artemis oversight update',
        summary: 'GAO coverage refreshed for Artemis-related reports.',
        eventTime: null,
        eventTimePrecision: 'unknown',
        announcedTime: new Date().toISOString(),
        sourceType: 'oversight',
        confidence: 'oversight',
        sourceDocumentId: gaoDocId,
        sourceUrl: ARTEMIS_SOURCE_URLS.gaoArtemisQuery,
        tags: ['gao']
      });
      upsertCount += 1;
    }

    stats.sourcesFetched = 3;
    stats.sourceDocumentsInserted = 2;
    stats.timelineEventsUpserted = upsertCount;

    await updateCheckpoint(supabase, 'oig_reports', {
      sourceType: 'oversight',
      status: 'complete',
      recordsIngested: oigFeedItems.length,
      endedAt: new Date().toISOString(),
      lastAnnouncedTime: oigFeedItems[0]?.pubDate ? toIsoOrNull(oigFeedItems[0].pubDate) : new Date().toISOString(),
      lastError: null
    });

    await updateCheckpoint(supabase, 'gao_reports', {
      sourceType: 'oversight',
      status: 'complete',
      recordsIngested: gaoError ? 0 : 1,
      endedAt: new Date().toISOString(),
      lastError: gaoError
    });

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats, gaoError });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });

    for (const entry of checkpoints) {
      await updateCheckpoint(supabase, entry.key, {
        sourceType: entry.type,
        status: 'error',
        endedAt: new Date().toISOString(),
        lastError: message
      }).catch(() => undefined);
    }

    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});
