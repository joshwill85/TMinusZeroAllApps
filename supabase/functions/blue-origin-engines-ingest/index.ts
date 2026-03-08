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

type EngineSeed = {
  engineSlug: 'be-3pm' | 'be-3u' | 'be-4' | 'be-7';
  missionKey: 'blue-origin-program' | 'new-shepard' | 'new-glenn' | 'blue-moon' | 'be-4';
  displayName: string;
  propellants: string;
  cycle: string;
  thrustVacKN: number | null;
  thrustSlKN: number | null;
  status: string;
  description: string;
  officialUrl: string;
  vehicleLinks: Array<{ vehicleSlug: 'new-shepard' | 'new-glenn' | 'blue-moon' | 'blue-ring'; role: string; notes: string | null }>;
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const runStartedAtIso = new Date().toISOString();
  const { runId } = await startIngestionRun(supabase, 'blue_origin_engines_ingest');

  const stats: Record<string, unknown> = {
    sourceDocumentsInserted: 0,
    enginesUpserted: 0,
    vehicleEngineMapUpserted: 0,
    timelineEventsUpserted: 0,
    sourceFetchFailures: 0,
    challengeResponses: 0,
    errors: [] as Array<{ step: string; error: string }>
  };

  try {
    const enabled = await readBooleanSetting(supabase, 'blue_origin_engines_job_enabled', true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const retries = await readNumberSetting(supabase, 'blue_origin_source_fetch_retries', 4);
    const backoffMs = await readNumberSetting(supabase, 'blue_origin_source_fetch_backoff_ms', 900);
    const timeoutMs = await readNumberSetting(supabase, 'blue_origin_source_fetch_timeout_ms', 20_000);
    const sourceUrls = await resolveBlueOriginSourceUrls(supabase);
    const seeds = buildEngineSeeds(sourceUrls);

    await updateCheckpoint(supabase, 'blue_origin_engines', {
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

    const engineUpserts: Array<Record<string, unknown>> = [];
    const mapUpserts: Array<Record<string, unknown>> = [];
    for (const seed of seeds) {
      const sourceResponse = await fetchTextWithMeta(seed.officialUrl, { retries, backoffMs, timeoutMs });
      const sourceDocId = await insertSourceDocument(supabase, {
        sourceKey: 'blue_origin_engines',
        sourceType: 'blue-origin-official',
        url: seed.officialUrl,
        title: `${seed.displayName} official profile`,
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

      engineUpserts.push({
        engine_slug: seed.engineSlug,
        mission_key: seed.missionKey,
        display_name: seed.displayName,
        propellants: seed.propellants,
        cycle: seed.cycle,
        thrust_vac_kn: seed.thrustVacKN,
        thrust_sl_kn: seed.thrustSlKN,
        status: seed.status,
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

      for (const link of seed.vehicleLinks) {
        mapUpserts.push({
          vehicle_slug: link.vehicleSlug,
          engine_slug: seed.engineSlug,
          role: link.role,
          notes: link.notes,
          metadata: {
            sourceClass: 'curated-reference',
            confidence: 'medium'
          },
          updated_at: new Date().toISOString()
        });
      }

      await upsertTimelineEvent(supabase, {
        eventKey: `blue-origin:engine:${seed.engineSlug}`,
        missionKey: seed.missionKey === 'new-shepard' || seed.missionKey === 'new-glenn' || seed.missionKey === 'blue-moon' || seed.missionKey === 'be-4'
          ? seed.missionKey
          : 'blue-origin-program',
        title: `${seed.displayName} profile refreshed`,
        summary: seed.description,
        eventTime: null,
        announcedTime: runStartedAtIso,
        sourceType: 'blue-origin-official',
        confidence: sourceResponse.ok ? 'high' : 'medium',
        status: 'completed',
        sourceDocumentId: sourceDocId,
        sourceUrl: seed.officialUrl,
        metadata: {
          engineSlug: seed.engineSlug,
          cycle: seed.cycle,
          propellants: seed.propellants,
          fetchStatus: sourceResponse.status,
          fetchChallenge: sourceResponse.challenge
        }
      });
      stats.timelineEventsUpserted = Number(stats.timelineEventsUpserted || 0) + 1;
    }

    const { error: engineUpsertError } = await supabase.from('blue_origin_engines').upsert(engineUpserts, { onConflict: 'engine_slug' });
    if (engineUpsertError) throw engineUpsertError;
    stats.enginesUpserted = engineUpserts.length;

    if (mapUpserts.length > 0) {
      const { error: mapUpsertError } = await supabase
        .from('blue_origin_vehicle_engine_map')
        .upsert(mapUpserts, { onConflict: 'vehicle_slug,engine_slug' });
      if (mapUpsertError) throw mapUpsertError;
      stats.vehicleEngineMapUpserted = mapUpserts.length;
    }

    await updateCheckpoint(supabase, 'blue_origin_engines', {
      sourceType: 'blue-origin-official',
      status: 'complete',
      endedAt: new Date().toISOString(),
      recordsIngested: Number(stats.enginesUpserted || 0),
      lastAnnouncedTime: runStartedAtIso,
      lastEventTime: runStartedAtIso,
      lastError: null,
      metadata: {
        seedCount: seeds.length,
        sourceDocumentsInserted: stats.sourceDocumentsInserted,
        vehicleEngineMapUpserted: stats.vehicleEngineMapUpserted,
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

    await updateCheckpoint(supabase, 'blue_origin_engines', {
      sourceType: 'blue-origin-official',
      status: 'error',
      endedAt: new Date().toISOString(),
      lastError: message
    }).catch(() => undefined);

    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});

function buildEngineSeeds(sourceUrls: Record<string, string>): EngineSeed[] {
  return [
    {
      engineSlug: 'be-3pm',
      missionKey: 'new-shepard',
      displayName: 'BE-3PM',
      propellants: 'Liquid Hydrogen / Liquid Oxygen',
      cycle: 'Hydrogen-fueled, deep-throttle capable',
      thrustVacKN: null,
      thrustSlKN: null,
      status: 'operational',
      description: 'BE-3PM powers New Shepard with reusable vertical-launch and landing mission profiles for suborbital flight.',
      officialUrl: sourceUrls.be3pm || sourceUrls.newShepard,
      vehicleLinks: [{ vehicleSlug: 'new-shepard', role: 'primary propulsion', notes: null }]
    },
    {
      engineSlug: 'be-3u',
      missionKey: 'blue-origin-program',
      displayName: 'BE-3U',
      propellants: 'Liquid Hydrogen / Liquid Oxygen',
      cycle: 'Vacuum-optimized upper-stage derivative',
      thrustVacKN: null,
      thrustSlKN: null,
      status: 'in-development',
      description: 'BE-3U is the vacuum-optimized BE-3 derivative used for upper-stage mission architecture planning.',
      officialUrl: sourceUrls.be3u || sourceUrls.engines,
      vehicleLinks: [{ vehicleSlug: 'new-glenn', role: 'upper-stage propulsion family', notes: 'Program architecture reference.' }]
    },
    {
      engineSlug: 'be-4',
      missionKey: 'be-4',
      displayName: 'BE-4',
      propellants: 'Liquefied Natural Gas / Liquid Oxygen',
      cycle: 'Oxidizer-rich staged combustion',
      thrustVacKN: null,
      thrustSlKN: null,
      status: 'operational',
      description: "BE-4 is Blue Origin's methane-oxygen staged-combustion engine family for heavy-lift launch integration.",
      officialUrl: sourceUrls.be4 || sourceUrls.engines,
      vehicleLinks: [{ vehicleSlug: 'new-glenn', role: 'first-stage propulsion', notes: null }]
    },
    {
      engineSlug: 'be-7',
      missionKey: 'blue-moon',
      displayName: 'BE-7',
      propellants: 'Liquid Hydrogen / Liquid Oxygen',
      cycle: 'High-precision deep throttle lunar descent',
      thrustVacKN: null,
      thrustSlKN: null,
      status: 'in-development',
      description: 'BE-7 is the lunar landing engine program for Blue Moon, designed for precision descent and throttle control.',
      officialUrl: sourceUrls.be7 || sourceUrls.blueMoon,
      vehicleLinks: [{ vehicleSlug: 'blue-moon', role: 'lunar descent propulsion', notes: null }]
    }
  ];
}
