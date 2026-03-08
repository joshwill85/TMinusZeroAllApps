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
  updateCheckpoint,
  upsertTimelineEvent
} from '../_shared/blueOriginIngest.ts';
import { fetchTextWithMeta, resolveBlueOriginSourceUrls, stripHtml } from '../_shared/blueOriginSources.ts';

type VehicleSeed = {
  vehicleSlug: 'new-shepard' | 'new-glenn' | 'blue-moon' | 'blue-ring';
  missionKey: 'new-shepard' | 'new-glenn' | 'blue-moon' | 'blue-ring';
  displayName: string;
  vehicleClass: string;
  status: string;
  firstFlight: string | null;
  description: string;
  officialUrl: string;
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const runStartedAtIso = new Date().toISOString();
  const { runId } = await startIngestionRun(supabase, 'blue_origin_vehicles_ingest');

  const stats: Record<string, unknown> = {
    sourceDocumentsInserted: 0,
    vehiclesUpserted: 0,
    timelineEventsUpserted: 0,
    sourceFetchFailures: 0,
    challengeResponses: 0,
    errors: [] as Array<{ step: string; error: string }>
  };

  try {
    const enabled = await readBooleanSetting(supabase, 'blue_origin_vehicles_job_enabled', true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const retries = await readNumberSetting(supabase, 'blue_origin_source_fetch_retries', 4);
    const backoffMs = await readNumberSetting(supabase, 'blue_origin_source_fetch_backoff_ms', 900);
    const timeoutMs = await readNumberSetting(supabase, 'blue_origin_source_fetch_timeout_ms', 20_000);
    const sourceUrls = await resolveBlueOriginSourceUrls(supabase);
    const seeds = buildVehicleSeeds(sourceUrls);

    await updateCheckpoint(supabase, 'blue_origin_vehicles', {
      sourceType: 'blue-origin-official',
      status: 'running',
      startedAt: runStartedAtIso,
      lastError: null,
      metadata: {
        retries,
        backoffMs,
        timeoutMs,
        seedCount: seeds.length
      }
    });

    const upserts: Array<Record<string, unknown>> = [];
    for (const seed of seeds) {
      const sourceResponse = await fetchTextWithMeta(seed.officialUrl, { retries, backoffMs, timeoutMs });
      const sourceDocId = await insertSourceDocument(supabase, {
        sourceKey: 'blue_origin_vehicles',
        sourceType: 'blue-origin-official',
        url: seed.officialUrl,
        title: `${seed.displayName} official page`,
        summary: stripHtml(sourceResponse.text).slice(0, 2400) || `HTTP ${sourceResponse.status} while fetching ${seed.officialUrl}`,
        announcedTime: runStartedAtIso,
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
      stats.sourceDocumentsInserted = Number(stats.sourceDocumentsInserted || 0) + 1;
      if (!sourceResponse.ok) stats.sourceFetchFailures = Number(stats.sourceFetchFailures || 0) + 1;
      if (sourceResponse.challenge) stats.challengeResponses = Number(stats.challengeResponses || 0) + 1;

      upserts.push({
        vehicle_slug: seed.vehicleSlug,
        mission_key: seed.missionKey,
        display_name: seed.displayName,
        vehicle_class: seed.vehicleClass,
        status: seed.status,
        first_flight: seed.firstFlight,
        description: seed.description,
        official_url: seed.officialUrl,
        source_document_id: sourceDocId,
        metadata: {
          sourceClass: 'blue-origin-official',
          fetchStatus: sourceResponse.status,
          fetchChallenge: sourceResponse.challenge,
          confidence: sourceResponse.ok ? 'high' : 'medium'
        },
        updated_at: new Date().toISOString()
      });

      await upsertTimelineEvent(supabase, {
        eventKey: `blue-origin:vehicle:${seed.vehicleSlug}`,
        missionKey: seed.missionKey,
        title: `${seed.displayName} profile refreshed`,
        summary: seed.description,
        eventTime: seed.firstFlight ? `${seed.firstFlight}T00:00:00Z` : null,
        announcedTime: runStartedAtIso,
        sourceType: 'blue-origin-official',
        confidence: sourceResponse.ok ? 'high' : 'medium',
        status: 'completed',
        sourceDocumentId: sourceDocId,
        sourceUrl: seed.officialUrl,
        metadata: {
          vehicleSlug: seed.vehicleSlug,
          vehicleClass: seed.vehicleClass,
          fetchStatus: sourceResponse.status,
          fetchChallenge: sourceResponse.challenge
        }
      });
      stats.timelineEventsUpserted = Number(stats.timelineEventsUpserted || 0) + 1;
    }

    const { error: upsertError } = await supabase.from('blue_origin_vehicles').upsert(upserts, { onConflict: 'vehicle_slug' });
    if (upsertError) throw upsertError;
    stats.vehiclesUpserted = upserts.length;

    await updateCheckpoint(supabase, 'blue_origin_vehicles', {
      sourceType: 'blue-origin-official',
      status: 'complete',
      endedAt: new Date().toISOString(),
      recordsIngested: Number(stats.vehiclesUpserted || 0),
      lastAnnouncedTime: runStartedAtIso,
      lastEventTime: runStartedAtIso,
      lastError: null,
      metadata: {
        seedCount: seeds.length,
        sourceDocumentsInserted: stats.sourceDocumentsInserted,
        timelineEventsUpserted: stats.timelineEventsUpserted,
        sourceFetchFailures: stats.sourceFetchFailures,
        challengeResponses: stats.challengeResponses
      }
    });

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });

    await updateCheckpoint(supabase, 'blue_origin_vehicles', {
      sourceType: 'blue-origin-official',
      status: 'error',
      endedAt: new Date().toISOString(),
      lastError: message
    }).catch(() => undefined);

    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});

function buildVehicleSeeds(sourceUrls: Record<string, string>): VehicleSeed[] {
  return [
    {
      vehicleSlug: 'new-shepard',
      missionKey: 'new-shepard',
      displayName: 'New Shepard',
      vehicleClass: 'suborbital',
      status: 'operational',
      firstFlight: '2015-04-29',
      description:
        "Blue Origin's reusable suborbital system for human spaceflight and research payloads, with vertically landed booster operations.",
      officialUrl: sourceUrls.newShepard
    },
    {
      vehicleSlug: 'new-glenn',
      missionKey: 'new-glenn',
      displayName: 'New Glenn',
      vehicleClass: 'orbital',
      status: 'active-flight-test',
      firstFlight: '2025-01-16',
      description:
        "Blue Origin's heavy-lift orbital launch vehicle program supporting commercial, civil, and national security mission classes.",
      officialUrl: sourceUrls.newGlenn
    },
    {
      vehicleSlug: 'blue-moon',
      missionKey: 'blue-moon',
      displayName: 'Blue Moon',
      vehicleClass: 'lunar-lander',
      status: 'in-development',
      firstFlight: null,
      description:
        "Blue Origin's lunar lander family and mission architecture for Artemis and lunar cargo or crewed surface logistics campaigns.",
      officialUrl: sourceUrls.blueMoon
    },
    {
      vehicleSlug: 'blue-ring',
      missionKey: 'blue-ring',
      displayName: 'Blue Ring',
      vehicleClass: 'in-space-logistics',
      status: 'in-development',
      firstFlight: null,
      description:
        "Blue Origin's in-space logistics and mobility platform for long-duration operations, hosting, transportation, and mission services.",
      officialUrl: sourceUrls.blueRing
    }
  ];
}
