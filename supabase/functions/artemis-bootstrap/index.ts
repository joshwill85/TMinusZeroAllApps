import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import {
  ARTEMIS_SOURCE_KEYS,
  finishIngestionRun,
  insertSourceDocument,
  isBootstrapComplete,
  jsonResponse,
  loadCheckpoints,
  readBooleanSetting,
  setSystemSetting,
  startIngestionRun,
  stringifyError,
  toIsoOrNull,
  updateCheckpoint
} from '../_shared/artemisIngest.ts';
import { ARTEMIS_SOURCE_URLS, fetchJsonWithMeta, fetchTextWithMeta, stripHtml } from '../_shared/artemisSources.ts';

type SourceSpec = {
  sourceType: 'nasa_primary' | 'oversight' | 'budget' | 'procurement' | 'technical' | 'media';
  url: string;
  title: string;
  kind: 'text' | 'json';
};

const SOURCE_SPECS: Record<(typeof ARTEMIS_SOURCE_KEYS)[number], SourceSpec> = {
  nasa_campaign_pages: {
    sourceType: 'nasa_primary',
    url: ARTEMIS_SOURCE_URLS.nasaCampaign,
    title: 'NASA Artemis Campaign',
    kind: 'text'
  },
  nasa_blog_posts: {
    sourceType: 'nasa_primary',
    url: ARTEMIS_SOURCE_URLS.nasaBlog,
    title: 'NASA Artemis Blog',
    kind: 'text'
  },
  nasa_reference_timelines: {
    sourceType: 'nasa_primary',
    url: ARTEMIS_SOURCE_URLS.nasaTimeline,
    title: 'NASA Artemis Timeline',
    kind: 'text'
  },
  nasa_rss: {
    sourceType: 'nasa_primary',
    url: ARTEMIS_SOURCE_URLS.nasaMissionsFeed,
    title: 'NASA Artemis Missions RSS',
    kind: 'text'
  },
  oig_reports: {
    sourceType: 'oversight',
    url: ARTEMIS_SOURCE_URLS.oigAudits,
    title: 'NASA OIG Audits',
    kind: 'text'
  },
  gao_reports: {
    sourceType: 'oversight',
    url: ARTEMIS_SOURCE_URLS.gaoArtemisQuery,
    title: 'GAO Artemis Search',
    kind: 'text'
  },
  moon_to_mars_docs: {
    sourceType: 'technical',
    url: 'https://www.nasa.gov/wp-json/wp/v2/search?search=Moon%20to%20Mars',
    title: 'Moon to Mars Architecture Search',
    kind: 'json'
  },
  ntrs_api: {
    sourceType: 'technical',
    url: ARTEMIS_SOURCE_URLS.ntrsSearch,
    title: 'NASA NTRS Artemis Search',
    kind: 'json'
  },
  techport_api: {
    sourceType: 'technical',
    url: ARTEMIS_SOURCE_URLS.techportRoot,
    title: 'NASA TechPort Root',
    kind: 'text'
  },
  nasa_budget_docs: {
    sourceType: 'budget',
    url: ARTEMIS_SOURCE_URLS.nasaBudgetRequestFy26,
    title: 'NASA Budget Request FY26',
    kind: 'text'
  },
  usaspending_awards: {
    sourceType: 'procurement',
    url: ARTEMIS_SOURCE_URLS.usaspendingTopTier,
    title: 'USASpending Top Tier Agencies',
    kind: 'json'
  },
  nasa_media_assets: {
    sourceType: 'media',
    url: ARTEMIS_SOURCE_URLS.nasaImagesSearch,
    title: 'NASA Images API Artemis Search',
    kind: 'json'
  }
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'artemis_bootstrap');
  const stats: Record<string, unknown> = {
    checkpointsProcessed: 0,
    checkpointsCompleted: 0,
    sourceDocumentsInserted: 0,
    skipped: false,
    errors: [] as Array<{ step: string; error: string; sourceKey?: string }>
  };

  try {
    const enabled = await readBooleanSetting(supabase, 'artemis_bootstrap_job_enabled', true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const alreadyComplete = await isBootstrapComplete(supabase);
    if (alreadyComplete) {
      await setSystemSetting(supabase, 'artemis_bootstrap_complete', true);
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'already_complete' });
      return jsonResponse({ ok: true, skipped: true, reason: 'already_complete', elapsedMs: Date.now() - startedAt });
    }

    const checkpoints = await loadCheckpoints(supabase);

    for (const checkpoint of checkpoints) {
      if (checkpoint.status === 'complete') continue;
      const sourceKey = checkpoint.source_key as keyof typeof SOURCE_SPECS;
      const spec = SOURCE_SPECS[sourceKey];
      if (!spec) continue;

      stats.checkpointsProcessed = Number(stats.checkpointsProcessed || 0) + 1;

      await updateCheckpoint(supabase, sourceKey, {
        sourceType: spec.sourceType,
        status: 'running',
        startedAt: new Date().toISOString(),
        lastError: null
      });

      try {
        if (spec.kind === 'json') {
          const response = await fetchJsonWithMeta(spec.url);
          await insertSourceDocument(supabase, {
            sourceKey,
            sourceType: spec.sourceType,
            url: spec.url,
            title: spec.title,
            summary: JSON.stringify(response.json).slice(0, 2400),
            announcedTime: toIsoOrNull(response.lastModified) || new Date().toISOString(),
            httpStatus: response.status,
            contentType: response.contentType,
            raw: {
              etag: response.etag,
              lastModified: response.lastModified,
              ok: response.ok
            },
            error: response.ok ? null : `http_${response.status}`
          });
        } else {
          const response = await fetchTextWithMeta(spec.url);
          await insertSourceDocument(supabase, {
            sourceKey,
            sourceType: spec.sourceType,
            url: spec.url,
            title: spec.title,
            summary: stripHtml(response.text).slice(0, 2400),
            announcedTime: toIsoOrNull(response.lastModified) || new Date().toISOString(),
            httpStatus: response.status,
            contentType: response.contentType,
            raw: {
              etag: response.etag,
              lastModified: response.lastModified,
              ok: response.ok
            },
            error: response.ok ? null : `http_${response.status}`
          });
        }

        await updateCheckpoint(supabase, sourceKey, {
          sourceType: spec.sourceType,
          status: 'complete',
          recordsIngested: Number(checkpoint.records_ingested || 0) + 1,
          endedAt: new Date().toISOString(),
          lastAnnouncedTime: new Date().toISOString(),
          lastError: null
        });

        stats.checkpointsCompleted = Number(stats.checkpointsCompleted || 0) + 1;
        stats.sourceDocumentsInserted = Number(stats.sourceDocumentsInserted || 0) + 1;
      } catch (err) {
        const message = stringifyError(err);
        (stats.errors as Array<any>).push({ step: 'source', error: message, sourceKey });
        await updateCheckpoint(supabase, sourceKey, {
          sourceType: spec.sourceType,
          status: 'error',
          endedAt: new Date().toISOString(),
          lastError: message
        }).catch(() => undefined);
      }
    }

    const completeNow = await isBootstrapComplete(supabase);
    await setSystemSetting(supabase, 'artemis_bootstrap_complete', completeNow);

    const ok = (stats.errors as Array<any>).length === 0;
    await finishIngestionRun(supabase, runId, ok, { ...stats, bootstrapComplete: completeNow }, ok ? undefined : 'partial_failure');
    return jsonResponse({ ok, elapsedMs: Date.now() - startedAt, stats: { ...stats, bootstrapComplete: completeNow } });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });
    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});
