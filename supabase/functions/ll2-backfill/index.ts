import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting, readStringSetting } from '../_shared/settings.ts';
import {
  mapLl2ToLaunchUpsert,
  upsertLaunches,
  upsertLl2PayloadManifest,
  upsertLl2References,
  upsertLl2SpacecraftManifest
} from '../_shared/ll2Ingest.ts';

const LL2_BASE = 'https://ll.thespacedevs.com/2.3.0';
const LL2_USER_AGENT = Deno.env.get('LL2_USER_AGENT') || 'TMinusZero/0.1 (support@tminuszero.app)';
const LL2_API_KEY = Deno.env.get('LL2_API_KEY') || '';

const BACKFILL_EPOCH = '1960-01-01T00:00:00Z';

const DEFAULTS = {
  ll2RateLimitPerHour: 300,
  backfillLimit: 100,
  backfillOffset: 0,
  incrementalCallsPerMinute: 4,
  incrementalIntervalSeconds: 15,
  usLocationMaxAgeHours: 24
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  let force = false;
  try {
    const body = await req.json().catch(() => ({}));
    force = Boolean((body as any)?.force);
  } catch {
    force = false;
  }

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'll2_backfill_page');

  try {
    const settings = await getSettings(supabase, [
      'll2_backfill_job_enabled',
      'll2_backfill_cursor',
      'll2_backfill_offset',
      'll2_backfill_limit',
      'll2_backfill_done',
      'll2_backfill_completed_at',
      'll2_backfill_last_success_at',
      'll2_backfill_last_error',
      'll2_rate_limit_per_hour',
      'll2_location_filter_mode',
      'll2_us_location_ids',
      'll2_incremental_calls_per_minute',
      'll2_incremental_interval_seconds'
    ]);

    const jobEnabled = readBooleanSetting(settings.ll2_backfill_job_enabled, false);
    if (!jobEnabled && !force) {
      const result = { ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt };
      await finishIngestionRun(supabase, runId, true, result);
      return jsonResponse(result);
    }

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const lastSuccessAt = readStringSetting(settings.ll2_backfill_last_success_at, '');
    const lastSuccessMs = Date.parse(lastSuccessAt);
    const lastError = readStringSetting(settings.ll2_backfill_last_error, '').trim();
    const shouldWriteStatus = lastError.length > 0 || !Number.isFinite(lastSuccessMs) || nowMs - lastSuccessMs >= 30_000;

    async function touchSuccess() {
      if (!shouldWriteStatus) return;
      await upsertSettings(supabase, [
        { key: 'll2_backfill_last_success_at', value: nowIso },
        { key: 'll2_backfill_last_error', value: '' }
      ]);
    }

    const limit = clampInt(readNumberSetting(settings.ll2_backfill_limit, DEFAULTS.backfillLimit), 1, 100);
    const ll2RateLimit = readNumberSetting(settings.ll2_rate_limit_per_hour, DEFAULTS.ll2RateLimitPerHour);

    const locationFilterMode = readLocationFilterModeSetting(settings.ll2_location_filter_mode);
    const locationIds = locationFilterMode === 'us' ? await ensureUsLocationIds(supabase, ll2RateLimit) : [];
    if (locationFilterMode === 'us' && !locationIds.length) {
      await touchSuccess();
      const result = { ok: true, skipped: true, reason: 'missing_location_filter', elapsedMs: Date.now() - startedAt };
      await finishIngestionRun(supabase, runId, true, result);
      return jsonResponse(result);
    }

    const cursor = await ensureCursor(supabase, readStringSetting(settings.ll2_backfill_cursor, BACKFILL_EPOCH));
    const offset = await ensureOffset(supabase, settings.ll2_backfill_offset);

    const callsPerMinuteRaw = clampInt(
      readNumberSetting(settings.ll2_incremental_calls_per_minute, DEFAULTS.incrementalCallsPerMinute),
      1,
      20
    );
    const intervalSeconds = clampInt(
      readNumberSetting(settings.ll2_incremental_interval_seconds, DEFAULTS.incrementalIntervalSeconds),
      1,
      60
    );
    const maxCallsPerMinute = Math.floor(55 / intervalSeconds) + 1;
    const callsPerMinute = Math.max(1, Math.min(callsPerMinuteRaw, maxCallsPerMinute));

    const rate = await tryConsumeLl2Backfill(supabase, { ll2RateLimit, callsPerMinute });
    if (!rate.allowed) {
      await touchSuccess();
      const result = {
        ok: true,
        skipped: true,
        reason: rate.reason,
        rateLimit: ll2RateLimit,
        effectiveLimit: rate.effectiveLimit,
        reservedCalls: rate.reservedCalls,
        elapsedMs: Date.now() - startedAt
      };
      await finishIngestionRun(supabase, runId, true, result);
      return jsonResponse(result);
    }

    const { launches, skipped, total, skipReason } = await fetchLl2Launches({
      limit,
      ordering: 'last_updated',
      sinceIso: cursor,
      offset,
      locationIds
    });

    if (skipped) {
      await touchSuccess();
      const result = { ok: true, skipped: true, reason: skipReason || 'remote_skip', elapsedMs: Date.now() - startedAt };
      await finishIngestionRun(supabase, runId, true, result);
      return jsonResponse(result);
    }

    if (!launches.length) {
      await upsertSettings(supabase, [
        { key: 'll2_backfill_job_enabled', value: false },
        { key: 'll2_backfill_done', value: true },
        { key: 'll2_backfill_completed_at', value: nowIso }
      ]);
      await touchSuccess();
      const result = { ok: true, upserted: 0, total, cursor, done: true, elapsedMs: Date.now() - startedAt };
      await finishIngestionRun(supabase, runId, true, result);
      return jsonResponse(result);
    }

    await upsertLl2References(supabase, launches);
    const rows = launches.map(mapLl2ToLaunchUpsert);
    await upsertLaunches(supabase, rows);
    await upsertLl2PayloadManifest(supabase, launches);
    await upsertLl2SpacecraftManifest(supabase, launches);

    const state = computeNextCursorState({
      cursor,
      offset,
      launches
    });
    if (state.cursor !== cursor) {
      await upsertSettings(supabase, [
        { key: 'll2_backfill_cursor', value: state.cursor },
        { key: 'll2_backfill_offset', value: state.offset }
      ]);
    } else if (state.offset !== offset) {
      await upsertSetting(supabase, 'll2_backfill_offset', state.offset);
    }

    await touchSuccess();
    const result = {
      ok: true,
      fetched: launches.length,
      upserted: rows.length,
      total,
      cursorStart: cursor,
      cursorEnd: state.cursor,
      offsetStart: offset,
      offsetEnd: state.offset,
      reservedCalls: rate.reservedCalls,
      effectiveLimit: rate.effectiveLimit,
      elapsedMs: Date.now() - startedAt
    };
    await finishIngestionRun(supabase, runId, true, result);
    return jsonResponse(result);
  } catch (err) {
    const message = stringifyError(err);
    try {
      await upsertSetting(supabase, 'll2_backfill_last_error', message);
    } catch (inner) {
      console.error('Failed to persist ll2_backfill_last_error', stringifyError(inner));
    }
    const result = { ok: false, error: message, elapsedMs: Date.now() - startedAt };
    await finishIngestionRun(supabase, runId, false, undefined, message);
    return jsonResponse(result, 500);
  }
});

async function startIngestionRun(supabase: ReturnType<typeof createSupabaseAdminClient>, jobName: string) {
  const { data, error } = await supabase.from('ingestion_runs').insert({ job_name: jobName }).select('id').single();
  if (error || !data) {
    console.warn('Failed to start ingestion_runs record', { jobName, error: error?.message });
    return { runId: null as number | null };
  }
  return { runId: data.id as number };
}

async function finishIngestionRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: number | null,
  success: boolean,
  stats?: Record<string, unknown>,
  error?: string
) {
  if (runId == null) return;
  const { error: updateError } = await supabase
    .from('ingestion_runs')
    .update({
      ended_at: new Date().toISOString(),
      success,
      stats: stats ?? null,
      error: error ?? null
    })
    .eq('id', runId);
  if (updateError) {
    console.warn('Failed to update ingestion_runs record', { runId, updateError: updateError.message });
  }
}

function readLocationFilterModeSetting(value: unknown): 'us' | 'all' {
  const raw = readStringSetting(value, 'all').trim().toLowerCase();
  return raw === 'us' ? 'us' : 'all';
}

async function ensureCursor(supabase: ReturnType<typeof createSupabaseAdminClient>, cursor: string) {
  if (isValidIso(cursor)) return cursor;
  await upsertSetting(supabase, 'll2_backfill_cursor', BACKFILL_EPOCH);
  return BACKFILL_EPOCH;
}

async function ensureOffset(supabase: ReturnType<typeof createSupabaseAdminClient>, value: unknown) {
  const parsed = readNumberSetting(value, DEFAULTS.backfillOffset);
  const offset = clampInt(parsed, 0, 1_000_000_000);
  const shouldPersist =
    value === undefined ||
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    Math.trunc(parsed) !== parsed ||
    parsed !== offset;

  if (shouldPersist) {
    await upsertSetting(supabase, 'll2_backfill_offset', offset);
  }

  return offset;
}

function computeNextCursorState({
  cursor,
  offset,
  launches
}: {
  cursor: string;
  offset: number;
  launches: any[];
}) {
  if (!launches.length) return { cursor, offset };

  const lastUpdated = launches[launches.length - 1]?.last_updated;
  if (!isValidIso(lastUpdated)) return { cursor, offset };

  if (lastUpdated === cursor) {
    return { cursor, offset: offset + launches.length };
  }

  let tailCount = 0;
  for (let i = launches.length - 1; i >= 0; i -= 1) {
    if (launches[i]?.last_updated === lastUpdated) {
      tailCount += 1;
    } else {
      break;
    }
  }

  return { cursor: lastUpdated, offset: tailCount };
}

async function ensureUsLocationIds(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  ll2RateLimit: number
) {
  const { data } = await supabase
    .from('system_settings')
    .select('value, updated_at')
    .eq('key', 'll2_us_location_ids')
    .maybeSingle();

  const existingIds = parseLocationIds(data?.value);
  const updatedAt = data?.updated_at ? Date.parse(data.updated_at) : NaN;
  const ageHours = Number.isFinite(updatedAt) ? (Date.now() - updatedAt) / (1000 * 60 * 60) : Infinity;

  if (existingIds.length && ageHours < DEFAULTS.usLocationMaxAgeHours) return existingIds;

  const rate = await tryConsumeLl2(supabase, ll2RateLimit);
  if (!rate.allowed) return existingIds;

  const url = `${LL2_BASE}/locations/?format=json&country_code=USA&limit=100`;
  const res = await fetch(url, { headers: buildLl2Headers() });
  if (!res.ok) return existingIds;

  const json = await res.json().catch(() => ({}));
  const ids = (json.results || []).map((loc: any) => loc?.id).filter((id: any) => typeof id === 'number');

  if (ids.length) {
    await upsertSetting(supabase, 'll2_us_location_ids', ids);
  }

  return ids.length ? ids : existingIds;
}

function parseLocationIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => Number(v)).filter((v) => Number.isFinite(v));
}

async function fetchLl2Launches({
  limit,
  ordering,
  sinceIso,
  offset,
  locationIds
}: {
  limit: number;
  ordering: 'last_updated' | '-last_updated';
  sinceIso?: string;
  offset: number;
  locationIds: number[];
}) {
  const updatedFilter = sinceIso ? `&last_updated__gte=${encodeURIComponent(sinceIso)}` : '';
  const locationFilter = locationIds.length ? `&location__ids=${locationIds.join(',')}` : '';
  const safeOffset = Math.max(0, Math.trunc(offset));
  const url = `${LL2_BASE}/launches/?format=json&limit=${limit}&offset=${safeOffset}&mode=detailed&include_suborbital=true&ordering=${ordering}${locationFilter}${updatedFilter}`;
  const res = await fetch(url, { headers: buildLl2Headers() });

  if (res.status === 429) {
    return { launches: [], skipped: true, total: 0, skipReason: 'remote_rate_limit' };
  }
  if (res.status >= 500) {
    return { launches: [], skipped: true, total: 0, skipReason: `server_${res.status}` };
  }
  if (!res.ok) throw new Error(`LL2 fetch failed ${res.status}`);

  const json = await res.json().catch(() => ({}));
  return { launches: json.results as any[], skipped: false, total: json.count ?? 0, skipReason: null };
}

function buildLl2Headers() {
  const headers: Record<string, string> = { 'User-Agent': LL2_USER_AGENT, accept: 'application/json' };
  if (LL2_API_KEY) {
    headers.Authorization = `Token ${LL2_API_KEY}`;
  }
  return headers;
}

async function tryConsumeLl2Backfill(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    ll2RateLimit,
    callsPerMinute
  }: {
    ll2RateLimit: number;
    callsPerMinute: number;
  }
) {
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setMinutes(0, 0, 0);
  const windowEndMs = windowStart.getTime() + 3600 * 1000;
  const remainingSeconds = Math.max(0, (windowEndMs - now.getTime()) / 1000);
  const remainingMinutes = Math.ceil(remainingSeconds / 60);
  const reservedCalls = Math.max(0, remainingMinutes * callsPerMinute);
  const effectiveLimit = ll2RateLimit - reservedCalls;
  if (effectiveLimit <= 0) {
    return { allowed: false, reason: 'reserved_budget', reservedCalls, effectiveLimit };
  }

  const { data, error } = await supabase.rpc('try_increment_api_rate', {
    provider_name: 'll2',
    window_start_in: windowStart.toISOString(),
    window_seconds_in: 3600,
    limit_in: effectiveLimit
  });

  if (error) {
    console.error('rateCounter try_increment_api_rate error', error);
    return { allowed: false, reason: 'rate_counter_error', reservedCalls, effectiveLimit };
  }

  return { allowed: Boolean(data), reservedCalls, effectiveLimit, reason: 'ok' as const };
}

async function tryConsumeLl2(supabase: ReturnType<typeof createSupabaseAdminClient>, limit: number) {
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setMinutes(0, 0, 0);

  const { data, error } = await supabase.rpc('try_increment_api_rate', {
    provider_name: 'll2',
    window_start_in: windowStart.toISOString(),
    window_seconds_in: 3600,
    limit_in: limit
  });

  if (error) {
    console.error('rateCounter try_increment_api_rate error', error);
    return { allowed: false };
  }

  return { allowed: Boolean(data) };
}

async function upsertSetting(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  key: string,
  value: unknown
) {
  const { error } = await supabase
    .from('system_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

async function upsertSettings(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  items: Array<{ key: string; value: unknown }>
) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('system_settings')
    .upsert(items.map((i) => ({ ...i, updated_at: now })), { onConflict: 'key' });
  if (error) throw error;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function isValidIso(value: unknown) {
  if (typeof value !== 'string') return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') return JSON.stringify(err);
  return String(err);
}
