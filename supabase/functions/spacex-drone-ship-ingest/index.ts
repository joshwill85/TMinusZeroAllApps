import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';
import {
  DRONE_SHIP_INGEST_DEFAULTS,
  DRONE_SHIP_INGEST_SETTINGS_KEYS,
  SPACEX_DRONE_SHIP_INGEST_JOB,
  canonicalizeShip,
  clampInt,
  fetchLandingsForLaunch,
  finishIngestionRun,
  jsonResponse,
  normalizeIso,
  normalizeText,
  releaseJobLock,
  resolveLandingResult,
  startIngestionRun,
  stringifyError,
  tryAcquireJobLock,
  upsertJobState
} from '../_shared/spacexDroneShips.ts';

type CandidateRow = {
  launch_id: string;
  ll2_launch_uuid: string | null;
  net: string | null;
  assignment_last_verified: string | null;
};

type ExistingAssignmentRow = {
  launch_id: string | null;
  launch_library_id: string | null;
  ship_slug: string | null;
  ship_name_raw: string | null;
  ship_abbrev_raw: string | null;
  landing_attempt: boolean | null;
  landing_success: boolean | null;
  landing_result: string | null;
  landing_time: string | null;
  source_landing_id: string | null;
};

type Ll2Landing = {
  id: number;
  attempt?: boolean;
  success?: boolean | null;
  landing?: string | null;
  landing_location?: {
    name?: string | null;
    abbrev?: string | null;
  } | null;
};

type AssignmentUpsertRow = {
  launch_id: string;
  launch_library_id: string | null;
  ship_slug: string | null;
  ship_name_raw: string | null;
  ship_abbrev_raw: string | null;
  landing_attempt: boolean | null;
  landing_success: boolean | null;
  landing_result: 'success' | 'failure' | 'no_attempt' | 'unknown';
  landing_time: string | null;
  source: 'll2';
  source_landing_id: string | null;
  last_verified_at: string;
  updated_at: string;
};

const WRITE_CHUNK_SIZE = 5;
const JOB_LOCK_NAME = SPACEX_DRONE_SHIP_INGEST_JOB;

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
    candidates: 0,
    candidatesChecked: 0,
    skippedNoLl2Id: 0,
    ll2Calls: 0,
    ll2RateLimited: false,
    ll2RemoteRateLimited: false,
    ll2Timeouts: 0,
    fetchTimeouts: 0,
    knownAssignments: 0,
    unknownAssignments: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsUnchanged: 0,
    failedLaunches: [] as Array<{ launchId: string; reason: string }>,
    skipped: false,
    skipReason: null as string | null
  };

  let lockId: string | null = null;
  let runId: number | null = null;

  try {
    const settings = await getSettings(supabase, [...DRONE_SHIP_INGEST_SETTINGS_KEYS]);
    const enabled = readBooleanSetting(settings.spacex_drone_ship_ingest_enabled, DRONE_SHIP_INGEST_DEFAULTS.enabled);
    if (!enabled) {
      stats.skipped = true;
      stats.skipReason = 'disabled';
      return jsonResponse({ ok: true, ...stats, elapsedMs: Date.now() - startedAt });
    }

    const batchSize = clampInt(
      readNumberSetting(settings.spacex_drone_ship_ingest_batch_size, DRONE_SHIP_INGEST_DEFAULTS.batchSize),
      1,
      50
    );
    const lookbackDays = clampInt(
      readNumberSetting(settings.spacex_drone_ship_ingest_lookback_days, DRONE_SHIP_INGEST_DEFAULTS.lookbackDays),
      1,
      14
    );
    const lookaheadDays = clampInt(
      readNumberSetting(settings.spacex_drone_ship_ingest_lookahead_days, DRONE_SHIP_INGEST_DEFAULTS.lookaheadDays),
      1,
      21
    );
    const staleHours = clampInt(
      readNumberSetting(settings.spacex_drone_ship_ingest_stale_hours, DRONE_SHIP_INGEST_DEFAULTS.staleHours),
      1,
      24 * 14
    );
    const lockTtlSeconds = clampInt(
      readNumberSetting(settings.spacex_drone_ship_ingest_lock_ttl_seconds, DRONE_SHIP_INGEST_DEFAULTS.lockTtlSeconds),
      120,
      3600
    );
    const ll2FetchTimeoutMs = clampInt(
      readNumberSetting(settings.spacex_drone_ship_ll2_fetch_timeout_ms, DRONE_SHIP_INGEST_DEFAULTS.ll2FetchTimeoutMs),
      2000,
      30000
    );
    const ll2RateLimit = clampInt(
      readNumberSetting(settings.ll2_rate_limit_per_hour, DRONE_SHIP_INGEST_DEFAULTS.ll2RateLimitPerHour),
      1,
      10000
    );

    lockId = crypto.randomUUID();
    const acquired = await tryAcquireJobLock(supabase, JOB_LOCK_NAME, lockTtlSeconds, lockId);
    if (!acquired) {
      stats.skipped = true;
      stats.skipReason = 'locked';
      return jsonResponse({ ok: true, ...stats, elapsedMs: Date.now() - startedAt });
    }

    const startedAtIso = new Date().toISOString();
    ({ runId } = await startIngestionRun(supabase, SPACEX_DRONE_SHIP_INGEST_JOB));
    await safeUpsertJobState(supabase, SPACEX_DRONE_SHIP_INGEST_JOB, {
      startedAt: startedAtIso,
      error: '',
      checkedCount: 0,
      changedCount: 0
    });

    const { data: candidateData, error: candidateError } = await supabase.rpc('get_spacex_drone_ship_ingest_candidates', {
      limit_n: batchSize,
      lookback_days: lookbackDays,
      lookahead_days: lookaheadDays,
      stale_hours: staleHours
    });
    if (candidateError) throw candidateError;

    const candidates = Array.isArray(candidateData) ? (candidateData as CandidateRow[]) : [];
    stats.candidates = candidates.length;
    if (!candidates.length) {
      stats.skipped = true;
      stats.skipReason = 'no_candidates';
      const completedAtIso = new Date().toISOString();
      await finishIngestionRun(supabase, runId, true, stats);
      await safeUpsertJobState(supabase, SPACEX_DRONE_SHIP_INGEST_JOB, {
        completedAt: completedAtIso,
        successAt: completedAtIso,
        error: '',
        checkedCount: 0,
        changedCount: 0
      });
      return jsonResponse({ ok: true, ...stats, elapsedMs: Date.now() - startedAt });
    }

    const existingRowsByLaunchId = await fetchExistingAssignments(supabase, candidates);
    const pendingRows: AssignmentUpsertRow[] = [];

    for (const candidate of candidates) {
      stats.candidatesChecked = Number(stats.candidatesChecked || 0) + 1;
      const launchId = normalizeText(candidate.launch_id);
      const ll2LaunchUuid = normalizeText(candidate.ll2_launch_uuid);
      if (!launchId) continue;
      if (!ll2LaunchUuid) {
        stats.skippedNoLl2Id = Number(stats.skippedNoLl2Id || 0) + 1;
        continue;
      }

      try {
        const landings = await fetchLandingsForLaunch({
          supabase,
          ll2LaunchUuid,
          ll2RateLimit,
          stats,
          timeoutMs: ll2FetchTimeoutMs
        });
        const selected = selectLanding(landings);
        const nextRow = buildAssignmentRow(launchId, ll2LaunchUuid, selected);

        if (nextRow.ship_slug) {
          stats.knownAssignments = Number(stats.knownAssignments || 0) + 1;
        } else {
          stats.unknownAssignments = Number(stats.unknownAssignments || 0) + 1;
        }

        const existing = existingRowsByLaunchId.get(launchId) || null;
        if (isMaterialAssignmentUnchanged(existing, nextRow)) {
          stats.rowsUnchanged = Number(stats.rowsUnchanged || 0) + 1;
          continue;
        }

        if (existing) {
          stats.rowsUpdated = Number(stats.rowsUpdated || 0) + 1;
        } else {
          stats.rowsInserted = Number(stats.rowsInserted || 0) + 1;
        }

        pendingRows.push(nextRow);
        existingRowsByLaunchId.set(launchId, nextRow);

        if (pendingRows.length >= WRITE_CHUNK_SIZE) {
          await flushAssignmentRows(supabase, pendingRows.splice(0, pendingRows.length));
        }
      } catch (err) {
        const reason = stringifyError(err);
        if (reason.startsWith('ll2_fetch_timeout:')) {
          stats.fetchTimeouts = Number(stats.fetchTimeouts || 0) + 1;
        }
        (stats.failedLaunches as Array<{ launchId: string; reason: string }>).push({ launchId, reason });
      }

      if ((stats.ll2RateLimited as boolean) || (stats.ll2RemoteRateLimited as boolean)) {
        break;
      }
    }

    if (pendingRows.length) {
      await flushAssignmentRows(supabase, pendingRows);
    }

    const hardRateLimited = (stats.ll2RateLimited as boolean) || (stats.ll2RemoteRateLimited as boolean);
    const hasFailures = (stats.failedLaunches as Array<{ launchId: string; reason: string }>).length > 0;
    const ok = !hardRateLimited && !hasFailures;
    const completedAtIso = new Date().toISOString();
    const changedCount = Number(stats.rowsInserted || 0) + Number(stats.rowsUpdated || 0);

    await finishIngestionRun(supabase, runId, ok, stats, ok ? undefined : 'partial_failure');
    await safeUpsertJobState(supabase, SPACEX_DRONE_SHIP_INGEST_JOB, {
      completedAt: completedAtIso,
      successAt: ok ? completedAtIso : undefined,
      error: ok ? '' : 'partial_failure',
      checkedCount: Number(stats.candidatesChecked || 0),
      changedCount
    });

    return jsonResponse({ ok, elapsedMs: Date.now() - startedAt, stats }, ok ? 200 : 502);
  } catch (err) {
    const message = stringifyError(err);
    const completedAtIso = new Date().toISOString();
    const changedCount = Number(stats.rowsInserted || 0) + Number(stats.rowsUpdated || 0);

    await finishIngestionRun(supabase, runId, false, stats, message);
    await safeUpsertJobState(supabase, SPACEX_DRONE_SHIP_INGEST_JOB, {
      completedAt: completedAtIso,
      error: message,
      checkedCount: Number(stats.candidatesChecked || 0),
      changedCount
    });

    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  } finally {
    await releaseJobLock(supabase, JOB_LOCK_NAME, lockId);
  }
});

function buildAssignmentRow(
  launchId: string,
  ll2LaunchUuid: string,
  selected: Ll2Landing | null
): AssignmentUpsertRow {
  const canonical = canonicalizeShip(selected?.landing_location?.name, selected?.landing_location?.abbrev);
  const landingAttempt = typeof selected?.attempt === 'boolean' ? selected.attempt : null;
  const landingSuccess = typeof selected?.success === 'boolean' ? selected.success : null;
  const landingResult = resolveLandingResult(landingAttempt, landingSuccess);
  const landingTime = normalizeIso(selected?.landing ?? null);
  const nowIso = new Date().toISOString();

  return {
    launch_id: launchId,
    launch_library_id: ll2LaunchUuid || null,
    ship_slug: canonical.slug,
    ship_name_raw: canonical.nameRaw,
    ship_abbrev_raw: canonical.abbrevRaw,
    landing_attempt: landingAttempt,
    landing_success: landingSuccess,
    landing_result: landingResult,
    landing_time: landingTime,
    source: 'll2',
    source_landing_id: selected ? String(selected.id) : null,
    last_verified_at: nowIso,
    updated_at: nowIso
  };
}

async function fetchExistingAssignments(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  candidates: CandidateRow[]
) {
  const launchIds = candidates.map((row) => normalizeText(row.launch_id)).filter(Boolean);
  const byLaunchId = new Map<string, ExistingAssignmentRow | AssignmentUpsertRow>();
  if (!launchIds.length) return byLaunchId;

  const { data, error } = await supabase
    .from('spacex_drone_ship_assignments')
    .select(
      'launch_id,launch_library_id,ship_slug,ship_name_raw,ship_abbrev_raw,landing_attempt,landing_success,landing_result,landing_time,source_landing_id'
    )
    .in('launch_id', launchIds);
  if (error) throw error;

  for (const row of (data || []) as ExistingAssignmentRow[]) {
    const launchId = normalizeText(row.launch_id);
    if (!launchId) continue;
    byLaunchId.set(launchId, row);
  }

  return byLaunchId;
}

async function flushAssignmentRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: AssignmentUpsertRow[]
) {
  if (!rows.length) return;
  const { error } = await supabase.from('spacex_drone_ship_assignments').upsert(rows, {
    onConflict: 'launch_id'
  });
  if (error) throw error;
}

function isMaterialAssignmentUnchanged(
  existing: ExistingAssignmentRow | AssignmentUpsertRow | null,
  next: AssignmentUpsertRow
) {
  if (!existing) return false;
  return (
    normalizeText(existing.launch_library_id) === normalizeText(next.launch_library_id) &&
    normalizeText(existing.ship_slug) === normalizeText(next.ship_slug) &&
    normalizeText(existing.ship_name_raw) === normalizeText(next.ship_name_raw) &&
    normalizeText(existing.ship_abbrev_raw) === normalizeText(next.ship_abbrev_raw) &&
    normalizeNullableBoolean(existing.landing_attempt) === normalizeNullableBoolean(next.landing_attempt) &&
    normalizeNullableBoolean(existing.landing_success) === normalizeNullableBoolean(next.landing_success) &&
    normalizeText(existing.landing_result) === normalizeText(next.landing_result) &&
    normalizeIso(existing.landing_time) === normalizeIso(next.landing_time) &&
    normalizeText(existing.source_landing_id) === normalizeText(next.source_landing_id)
  );
}

function normalizeNullableBoolean(value: boolean | null | undefined) {
  return typeof value === 'boolean' ? value : null;
}

function selectLanding(landings: Ll2Landing[]) {
  if (!Array.isArray(landings) || landings.length === 0) return null;

  const scored = landings
    .filter((landing): landing is Ll2Landing => Number.isFinite(Number(landing?.id)))
    .map((landing) => {
      const canonical = canonicalizeShip(landing.landing_location?.name, landing.landing_location?.abbrev);
      let score = 0;
      if (canonical.slug) score += 100;
      if (landing.success === true) score += 30;
      if (landing.attempt === true) score += 15;
      if (landing.landing_location?.name) score += 5;
      if (landing.landing_location?.abbrev) score += 3;
      return { landing, score };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftAttempt = left.landing.attempt === true ? 1 : 0;
      const rightAttempt = right.landing.attempt === true ? 1 : 0;
      if (rightAttempt !== leftAttempt) return rightAttempt - leftAttempt;
      const leftSuccess = left.landing.success === true ? 1 : 0;
      const rightSuccess = right.landing.success === true ? 1 : 0;
      if (rightSuccess !== leftSuccess) return rightSuccess - leftSuccess;
      return Number(left.landing.id) - Number(right.landing.id);
    });

  return scored[0]?.landing || null;
}

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
