import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';
import {
  DRONE_SHIP_WIKI_DEFAULTS,
  DRONE_SHIP_WIKI_SETTINGS_KEYS,
  SPACEX_DRONE_SHIP_WIKI_SYNC_JOB,
  clampInt,
  finishIngestionRun,
  jsonResponse,
  releaseJobLock,
  startIngestionRun,
  stringifyError,
  syncDroneShipWikiEnrichment,
  tryAcquireJobLock,
  upsertJobState
} from '../_shared/spacexDroneShips.ts';

const JOB_LOCK_NAME = SPACEX_DRONE_SHIP_WIKI_SYNC_JOB;

serve(async (req) => {
  const startedAt = Date.now();
  let supabase: ReturnType<typeof createSupabaseAdminClient>;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    return jsonResponse({ ok: false, stage: 'init', error: stringifyError(err) }, 500);
  }

  try {
    const authorized = await requireJobAuth(req, supabase);
    if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);
  } catch (err) {
    return jsonResponse({ ok: false, stage: 'auth', error: stringifyError(err) }, 500);
  }

  const stats: Record<string, unknown> = {
    wikiCandidates: 0,
    wikiSynced: 0,
    wikiSkippedFresh: 0,
    wikiCalls: 0,
    wikiTimeouts: 0,
    wikiFailures: [] as Array<{ slug: string; reason: string }>,
    skipped: false,
    skipReason: null as string | null
  };

  let lockId: string | null = null;
  let runId: number | null = null;

  try {
    const settings = await getSettings(supabase, [...DRONE_SHIP_WIKI_SETTINGS_KEYS]);
    const enabled = readBooleanSetting(settings.spacex_drone_ship_wiki_sync_enabled, DRONE_SHIP_WIKI_DEFAULTS.enabled);
    if (!enabled) {
      stats.skipped = true;
      stats.skipReason = 'disabled';
      return jsonResponse({ ok: true, ...stats, elapsedMs: Date.now() - startedAt });
    }

    const syncIntervalDays = clampInt(
      readNumberSetting(settings.spacex_drone_ship_wiki_sync_interval_days, DRONE_SHIP_WIKI_DEFAULTS.syncIntervalDays),
      1,
      3650
    );
    const timeoutMs = clampInt(
      readNumberSetting(settings.spacex_drone_ship_wiki_fetch_timeout_ms, DRONE_SHIP_WIKI_DEFAULTS.wikiFetchTimeoutMs),
      2000,
      30000
    );
    const lockTtlSeconds = clampInt(
      readNumberSetting(settings.spacex_drone_ship_wiki_sync_lock_ttl_seconds, DRONE_SHIP_WIKI_DEFAULTS.lockTtlSeconds),
      120,
      3600
    );

    lockId = crypto.randomUUID();
    const acquired = await tryAcquireJobLock(supabase, JOB_LOCK_NAME, lockTtlSeconds, lockId);
    if (!acquired) {
      stats.skipped = true;
      stats.skipReason = 'locked';
      return jsonResponse({ ok: true, ...stats, elapsedMs: Date.now() - startedAt });
    }

    const startedAtIso = new Date().toISOString();
    ({ runId } = await startIngestionRun(supabase, SPACEX_DRONE_SHIP_WIKI_SYNC_JOB));
    await safeUpsertJobState(supabase, SPACEX_DRONE_SHIP_WIKI_SYNC_JOB, {
      startedAt: startedAtIso,
      error: '',
      checkedCount: 0,
      changedCount: 0
    });

    await syncDroneShipWikiEnrichment({
      supabase,
      syncIntervalDays,
      stats,
      timeoutMs
    });

    const hasFailures = (stats.wikiFailures as Array<{ slug: string; reason: string }>).length > 0;
    const ok = !hasFailures;
    const completedAtIso = new Date().toISOString();

    await finishIngestionRun(supabase, runId, ok, stats, ok ? undefined : 'partial_failure');
    await safeUpsertJobState(supabase, SPACEX_DRONE_SHIP_WIKI_SYNC_JOB, {
      completedAt: completedAtIso,
      successAt: ok ? completedAtIso : undefined,
      error: ok ? '' : 'partial_failure',
      checkedCount: Number(stats.wikiCandidates || 0),
      changedCount: Number(stats.wikiSynced || 0)
    });

    return jsonResponse({ ok, elapsedMs: Date.now() - startedAt, stats }, ok ? 200 : 502);
  } catch (err) {
    const message = stringifyError(err);
    const completedAtIso = new Date().toISOString();

    await finishIngestionRun(supabase, runId, false, stats, message);
    await safeUpsertJobState(supabase, SPACEX_DRONE_SHIP_WIKI_SYNC_JOB, {
      completedAt: completedAtIso,
      error: message,
      checkedCount: Number(stats.wikiCandidates || 0),
      changedCount: Number(stats.wikiSynced || 0)
    });

    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  } finally {
    await releaseJobLock(supabase, JOB_LOCK_NAME, lockId);
  }
});

async function safeUpsertJobState(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  jobPrefix: string,
  patch: Parameters<typeof upsertJobState>[2]
) {
  try {
    await upsertJobState(supabase, jobPrefix, patch);
  } catch (error) {
    console.warn('Failed to upsert job state', { jobPrefix, error: stringifyError(error) });
  }
}
