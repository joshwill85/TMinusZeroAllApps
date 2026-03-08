import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import {
  finishIngestionRun,
  insertSourceDocument,
  jsonResponse,
  readBooleanSetting,
  readNumberSetting,
  startIngestionRun,
  stringifyError,
  toIsoOrNull,
  updateCheckpoint
} from '../_shared/blueOriginIngest.ts';
import { fetchTextWithMeta, resolveBlueOriginSourceUrls, stripHtml } from '../_shared/blueOriginSources.ts';

type SourceItem = {
  key: 'blue_origin_bootstrap';
  type: 'blue-origin-official';
  label: string;
  url: string;
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const runStartedAtIso = new Date().toISOString();
  const { runId } = await startIngestionRun(supabase, 'blue_origin_bootstrap');

  const stats: Record<string, unknown> = {
    sourceDocumentsInserted: 0,
    sourcesFetched: 0,
    sourceFetchFailures: 0,
    challengeResponses: 0,
    errors: [] as Array<{ step: string; error: string }>
  };

  try {
    const enabled = await readBooleanSetting(supabase, 'blue_origin_bootstrap_job_enabled', true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const retries = await readNumberSetting(supabase, 'blue_origin_source_fetch_retries', 4);
    const backoffMs = await readNumberSetting(supabase, 'blue_origin_source_fetch_backoff_ms', 900);
    const timeoutMs = await readNumberSetting(supabase, 'blue_origin_source_fetch_timeout_ms', 20_000);
    const sourceUrls = await resolveBlueOriginSourceUrls(supabase);

    await updateCheckpoint(supabase, 'blue_origin_bootstrap', {
      sourceType: 'blue-origin-official',
      status: 'running',
      startedAt: runStartedAtIso,
      lastError: null,
      metadata: {
        retries,
        backoffMs,
        timeoutMs
      }
    });

    const sources: SourceItem[] = [
      { key: 'blue_origin_bootstrap', type: 'blue-origin-official', label: 'Blue Origin Missions', url: sourceUrls.missions },
      { key: 'blue_origin_bootstrap', type: 'blue-origin-official', label: 'Blue Origin News', url: sourceUrls.news },
      { key: 'blue_origin_bootstrap', type: 'blue-origin-official', label: 'Blue Origin Gallery', url: sourceUrls.gallery }
    ];

    for (const source of sources) {
      const response = await fetchTextWithMeta(source.url, { retries, backoffMs, timeoutMs });
      const summary = stripHtml(response.text).slice(0, 2400) || `HTTP ${response.status} while fetching ${source.url}`;

      await insertSourceDocument(supabase, {
        sourceKey: source.key,
        sourceType: source.type,
        url: source.url,
        title: source.label,
        summary,
        announcedTime: toIsoOrNull(response.lastModified) || new Date().toISOString(),
        httpStatus: response.status,
        contentType: response.contentType,
        etag: response.etag,
        lastModified: response.lastModified,
        raw: {
          ok: response.ok,
          challenge: response.challenge,
          throttled: response.throttled,
          retryAfterMs: response.retryAfterMs,
          attemptCount: response.attemptCount,
          finalUrl: response.finalUrl,
          error: response.error
        },
        error: response.ok ? null : response.error
      });

      stats.sourceDocumentsInserted = Number(stats.sourceDocumentsInserted || 0) + 1;
      stats.sourcesFetched = Number(stats.sourcesFetched || 0) + 1;
      if (!response.ok) stats.sourceFetchFailures = Number(stats.sourceFetchFailures || 0) + 1;
      if (response.challenge) stats.challengeResponses = Number(stats.challengeResponses || 0) + 1;
    }

    await updateCheckpoint(supabase, 'blue_origin_bootstrap', {
      sourceType: 'blue-origin-official',
      status: 'complete',
      endedAt: new Date().toISOString(),
      recordsIngested: Number(stats.sourceDocumentsInserted || 0),
      lastAnnouncedTime: runStartedAtIso,
      lastError: null,
      metadata: {
        retries,
        backoffMs,
        timeoutMs,
        sourceFetchFailures: Number(stats.sourceFetchFailures || 0),
        challengeResponses: Number(stats.challengeResponses || 0)
      }
    });

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });

    await updateCheckpoint(supabase, 'blue_origin_bootstrap', {
      sourceType: 'blue-origin-official',
      status: 'error',
      endedAt: new Date().toISOString(),
      lastError: message
    }).catch(() => undefined);

    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});
