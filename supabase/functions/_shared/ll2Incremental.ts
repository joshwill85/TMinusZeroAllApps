import { getSettings, readBooleanSetting, readNumberSetting, readStringSetting } from './settings.ts';
import {
  mapLl2ToLaunchUpsert,
  upsertLaunches,
  upsertLl2PayloadManifest,
  upsertLl2References,
  upsertLl2SpacecraftManifest
} from './ll2Ingest.ts';
import { createSupabaseAdminClient } from './supabase.ts';

const LL2_BASE = 'https://ll.thespacedevs.com/2.3.0';
const LL2_USER_AGENT = Deno.env.get('LL2_USER_AGENT') || 'TMinusZero/0.1 (support@tminuszero.app)';
const LL2_API_KEY = Deno.env.get('LL2_API_KEY') || '';

const DEFAULTS = {
  ll2RateLimitPerHour: 300,
  incrementalLimit: 100,
  incrementalOffset: 0,
  usLocationMaxAgeHours: 24
};

export type Ll2IncrementalResult =
  | { ok: true; skipped: true; reason: string; elapsedMs: number; rateLimit?: number }
  | {
      ok: true;
      skipped?: false;
      fetched: number;
      upserted: number;
      total: number;
      cursorStart: string;
      cursorEnd: string;
      offsetStart: number;
      offsetEnd: number;
      elapsedMs: number;
    }
  | { ok: false; error: string; elapsedMs: number };

export async function runLl2IncrementalOnce(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const startedAt = Date.now();

  try {
    const settings = await getSettings(supabase, [
      'll2_incremental_job_enabled',
      'll2_incremental_cursor',
      'll2_incremental_offset',
      'll2_incremental_limit',
      'll2_incremental_last_success_at',
      'll2_incremental_last_error',
      'll2_rate_limit_per_hour',
      'll2_location_filter_mode',
      'll2_us_location_ids'
    ]);

    const jobEnabled = readBooleanSetting(settings.ll2_incremental_job_enabled, true);
    if (!jobEnabled) return { ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt } satisfies Ll2IncrementalResult;

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const lastSuccessAt = readStringSetting(settings.ll2_incremental_last_success_at, '');
    const lastSuccessMs = Date.parse(lastSuccessAt);
    const lastError = readStringSetting(settings.ll2_incremental_last_error, '').trim();
    const shouldWriteStatus = lastError.length > 0 || !Number.isFinite(lastSuccessMs) || nowMs - lastSuccessMs >= 30_000;

    async function touchSuccess() {
      if (!shouldWriteStatus) return;
      await upsertSettings(supabase, [
        { key: 'll2_incremental_last_success_at', value: nowIso },
        { key: 'll2_incremental_last_error', value: '' }
      ]);
    }

    const limit = clampInt(readNumberSetting(settings.ll2_incremental_limit, DEFAULTS.incrementalLimit), 1, 100);
    const ll2RateLimit = readNumberSetting(settings.ll2_rate_limit_per_hour, DEFAULTS.ll2RateLimitPerHour);

    const locationFilterMode = readLocationFilterModeSetting(settings.ll2_location_filter_mode);
    const locationIds = locationFilterMode === 'us' ? await ensureUsLocationIds(supabase, ll2RateLimit) : [];
    if (locationFilterMode === 'us' && !locationIds.length) {
      await touchSuccess();
      return { ok: true, skipped: true, reason: 'missing_location_filter', elapsedMs: Date.now() - startedAt } satisfies Ll2IncrementalResult;
    }

    const cursor = await ensureCursor(supabase, readStringSetting(settings.ll2_incremental_cursor, ''));
    const offset = await ensureOffset(supabase, settings.ll2_incremental_offset);

    const rate = await tryConsumeLl2(supabase, ll2RateLimit);
    if (!rate.allowed) {
      await touchSuccess();
      return {
        ok: true,
        skipped: true,
        reason: 'rate_limit',
        rateLimit: ll2RateLimit,
        elapsedMs: Date.now() - startedAt
      } satisfies Ll2IncrementalResult;
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
      return {
        ok: true,
        skipped: true,
        reason: skipReason || 'remote_skip',
        elapsedMs: Date.now() - startedAt
      } satisfies Ll2IncrementalResult;
    }

    if (!launches.length) {
      await touchSuccess();
      return {
        ok: true,
        fetched: 0,
        upserted: 0,
        total,
        cursorStart: cursor,
        cursorEnd: cursor,
        offsetStart: offset,
        offsetEnd: offset,
        elapsedMs: Date.now() - startedAt
      } satisfies Ll2IncrementalResult;
    }

    await upsertLl2References(supabase, launches, { insertOnly: true });
    const rows = launches.map(mapLl2ToLaunchUpsert);
    await upsertLaunches(supabase, rows);
    await upsertLl2PayloadManifest(supabase, launches);
    await upsertLl2SpacecraftManifest(supabase, launches);

    await upsertSettings(supabase, [
      { key: 'll2_incremental_last_new_data_at', value: nowIso },
      { key: 'll2_incremental_last_new_data_count', value: rows.length }
    ]);

    const state = computeNextCursorState({
      cursor,
      offset,
      launches
    });
    if (state.cursor !== cursor) {
      await upsertSettings(supabase, [
        { key: 'll2_incremental_cursor', value: state.cursor },
        { key: 'll2_incremental_offset', value: state.offset }
      ]);
    } else if (state.offset !== offset) {
      await upsertSetting(supabase, 'll2_incremental_offset', state.offset);
    }

    await touchSuccess();
    return {
      ok: true,
      fetched: launches.length,
      upserted: rows.length,
      total,
      cursorStart: cursor,
      cursorEnd: state.cursor,
      offsetStart: offset,
      offsetEnd: state.offset,
      elapsedMs: Date.now() - startedAt
    } satisfies Ll2IncrementalResult;
  } catch (err) {
    const message = stringifyError(err);
    try {
      await upsertSetting(supabase, 'll2_incremental_last_error', message);
    } catch (inner) {
      console.error('Failed to persist ll2_incremental_last_error', stringifyError(inner));
    }
    return { ok: false, error: message, elapsedMs: Date.now() - startedAt } satisfies Ll2IncrementalResult;
  }
}

async function ensureCursor(supabase: ReturnType<typeof createSupabaseAdminClient>, cursor: string) {
  if (isValidIso(cursor)) return cursor;

  const { data, error } = await supabase
    .from('launches')
    .select('last_updated_source')
    .order('last_updated_source', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  const fallback = new Date().toISOString();
  const next = isValidIso(data?.last_updated_source) ? String(data?.last_updated_source) : fallback;
  await upsertSetting(supabase, 'll2_incremental_cursor', next);
  return next;
}

async function ensureOffset(supabase: ReturnType<typeof createSupabaseAdminClient>, value: unknown) {
  const parsed = readNumberSetting(value, DEFAULTS.incrementalOffset);
  const offset = clampInt(parsed, 0, 1_000_000_000);
  const shouldPersist =
    value === undefined ||
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    Math.trunc(parsed) !== parsed ||
    parsed !== offset;

  if (shouldPersist) {
    await upsertSetting(supabase, 'll2_incremental_offset', offset);
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

function readLocationFilterModeSetting(value: unknown): 'us' | 'all' {
  const raw = readStringSetting(value, 'all').trim().toLowerCase();
  return raw === 'us' ? 'us' : 'all';
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
  if (!items.length) return;
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

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') return JSON.stringify(err);
  return String(err);
}
