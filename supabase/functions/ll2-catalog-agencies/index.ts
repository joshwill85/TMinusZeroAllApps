import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting, readStringSetting } from '../_shared/settings.ts';

const LL2_BASE = 'https://ll.thespacedevs.com/2.3.0';
const LL2_USER_AGENT = Deno.env.get('LL2_USER_AGENT') || 'TMinusZero/0.1 (support@tminuszero.app)';
const LL2_API_KEY = Deno.env.get('LL2_API_KEY') || '';

const DEFAULTS = {
  ll2RateLimitPerHour: 300,
  pageLimit: 100,
  minIntervalSeconds: 72 * 60 * 60
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const { runId } = await startIngestionRun(supabase, 'll2_catalog_agencies');
  const startedAt = Date.now();

  try {
    const settings = await getSettings(supabase, [
      'll2_catalog_agencies_job_enabled',
      'll2_catalog_agencies_min_interval_seconds',
      'll2_catalog_agencies_last_success_at',
      'll2_catalog_page_limit',
      'll2_rate_limit_per_hour'
    ]);

    const jobEnabled = readBooleanSetting(settings.ll2_catalog_agencies_job_enabled, true);
    if (!jobEnabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled' });
    }

    const minIntervalSeconds = clampInt(
      readNumberSetting(settings.ll2_catalog_agencies_min_interval_seconds, DEFAULTS.minIntervalSeconds),
      3600,
      14 * 24 * 60 * 60
    );
    const lastSuccessAt = readStringSetting(settings.ll2_catalog_agencies_last_success_at, '');
    const lastSuccessMs = Date.parse(lastSuccessAt);
    const nowMs = Date.now();
    if (Number.isFinite(lastSuccessMs) && nowMs - lastSuccessMs < minIntervalSeconds * 1000) {
      const nextDueAt = new Date(lastSuccessMs + minIntervalSeconds * 1000).toISOString();
      const stats = {
        skipped: true,
        reason: 'not_due',
        minIntervalSeconds,
        lastSuccessAt,
        nextDueAt,
        elapsedMs: Date.now() - startedAt
      };
      await finishIngestionRun(supabase, runId, true, stats);
      return jsonResponse({ ok: true, ...stats });
    }

    const pageLimit = clampInt(readNumberSetting(settings.ll2_catalog_page_limit, DEFAULTS.pageLimit), 1, 100);
    const ll2RateLimit = readNumberSetting(settings.ll2_rate_limit_per_hour, DEFAULTS.ll2RateLimitPerHour);
    const fetchedAt = new Date().toISOString();

    let fetched = 0;
    let total = 0;
    let pages = 0;
    let nextOffset = 0;
    let partial = false;

    while (true) {
      const rate = await tryConsumeLl2(supabase, ll2RateLimit);
      if (!rate.allowed) {
        if (pages === 0) {
          const stats = {
            skipped: true,
            reason: 'rate_limit',
            minIntervalSeconds,
            elapsedMs: Date.now() - startedAt
          };
          await finishIngestionRun(supabase, runId, true, stats);
          return jsonResponse({ ok: true, ...stats });
        }
        partial = true;
        break;
      }

      const page = await fetchLl2Page({
        endpoint: 'agencies',
        limit: pageLimit,
        offset: nextOffset
      });
      if (page.skipped) {
        const stats = {
          skipped: true,
          reason: page.skipReason || 'remote_skip',
          minIntervalSeconds,
          elapsedMs: Date.now() - startedAt
        };
        await finishIngestionRun(supabase, runId, true, stats);
        return jsonResponse({ ok: true, ...stats });
      }

      const rows = page.rows;
      total = page.total ?? total;
      if (!rows.length) break;

      const mapped = rows.map((row) => mapAgencyRow(row, fetchedAt)).filter(Boolean) as Record<string, unknown>[];
      if (mapped.length) {
        const { error } = await supabase.from('ll2_agencies').upsert(mapped, { onConflict: 'll2_agency_id' });
        if (error) throw error;
      }

      const cacheRows = rows
        .map((row) => mapAgencyCache(row, fetchedAt))
        .filter(Boolean) as Record<string, unknown>[];
      if (cacheRows.length) {
        await upsertLl2CatalogPublicCacheIfChanged(supabase, cacheRows);
      }

      fetched += rows.length;
      pages += 1;

      if (rows.length < pageLimit) break;

      nextOffset += rows.length;
      if (total > 0 && nextOffset >= total) break;
    }

    const completed = !partial;
    if (completed) {
      await upsertSetting(supabase, 'll2_catalog_agencies_last_success_at', fetchedAt);
    }

    const stats = {
      fetched,
      total,
      pages,
      partial,
      minIntervalSeconds,
      lastSuccessAt: completed ? fetchedAt : lastSuccessAt || null,
      elapsedMs: Date.now() - startedAt
    };
    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, stats });
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, undefined, message);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});

async function fetchLl2Page({
  endpoint,
  limit,
  offset,
  query
}: {
  endpoint: string;
  limit: number;
  offset: number;
  query?: string;
}) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (query) {
    for (const part of query.split('&')) {
      const [key, value] = part.split('=');
      if (key && value) params.append(key, value);
    }
  }

  const url = `${LL2_BASE}/${endpoint}?${params.toString()}`;
  const res = await fetch(url, { headers: buildLl2Headers() });

  if (res.status === 429) {
    return { rows: [] as any[], skipped: true, total: 0, skipReason: 'rate_limit' };
  }
  if (res.status >= 500) {
    return { rows: [] as any[], skipped: true, total: 0, skipReason: `server_${res.status}` };
  }
  if (!res.ok) throw new Error(`LL2 fetch failed ${res.status}`);

  const json = await res.json().catch(() => ({}));
  const results = Array.isArray((json as any).results) ? (json as any).results : [];
  return { rows: results, skipped: false, total: (json as any).count ?? 0, skipReason: null };
}

function buildLl2Headers() {
  const headers: Record<string, string> = { 'User-Agent': LL2_USER_AGENT, accept: 'application/json' };
  if (LL2_API_KEY) {
    headers.Authorization = `Token ${LL2_API_KEY}`;
  }
  return headers;
}

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

async function upsertLl2CatalogPublicCacheIfChanged(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: Array<Record<string, unknown>>
) {
  if (!rows.length) return;
  const { error } = await supabase.rpc('upsert_ll2_catalog_public_cache_if_changed', { rows_in: rows });
  if (!error) return;

  console.warn('upsert_ll2_catalog_public_cache_if_changed RPC failed; falling back to direct upsert', error);
  const { error: upsertError } = await supabase
    .from('ll2_catalog_public_cache')
    .upsert(rows, { onConflict: 'entity_type,entity_id' });
  if (upsertError) throw upsertError;
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

function mapAgencyRow(row: any, fetchedAt: string) {
  if (!row?.id) return null;
  const countryCode = normalizeCountryCode(row.country ?? row.country_code);
  const imageUrl = extractImageFullUrl(row.image ?? row.image_url);
  const logoUrl = extractImageFullUrl(row.logo ?? row.social_logo ?? row.logo_url);

  return {
    ll2_agency_id: row.id,
    name: row.name || 'Agency',
    abbrev: row.abbrev || null,
    type: row.type || null,
    country_code: countryCode,
    description: row.description || null,
    administrator: row.administrator || null,
    founding_year: row.founding_year || null,
    launchers: row.launchers || null,
    spacecraft: row.spacecraft || null,
    parent: row.parent || null,
    image_url: imageUrl,
    logo_url: logoUrl,
    featured: typeof row.featured === 'boolean' ? row.featured : null,
    raw: row,
    fetched_at: fetchedAt,
    updated_at: fetchedAt
  };
}

function mapAgencyCache(row: any, fetchedAt: string) {
  const countryCode = normalizeCountryCode(row.country ?? row.country_code);
  const typeName = normalizeText(row.type?.name ?? row.type);
  const imageUrl = extractImageFullUrl(row.image ?? row.image_url);
  const logoUrl = extractImageFullUrl(row.logo ?? row.social_logo ?? row.logo_url);
  return buildCatalogCacheRow({
    entityType: 'agencies',
    id: row.id,
    name: row.name || 'Agency',
    description: row.description || null,
    countryCodes: countryCode ? [countryCode] : null,
    imageUrl: logoUrl || imageUrl || null,
    data: {
      id: row.id,
      name: row.name,
      abbrev: row.abbrev,
      type: typeName,
      country_code: countryCode,
      description: row.description,
      administrator: row.administrator,
      founding_year: row.founding_year,
      launchers: row.launchers,
      spacecraft: row.spacecraft,
      parent: row.parent,
      image_url: imageUrl,
      logo_url: logoUrl,
      featured: row.featured
    },
    fetchedAt
  });
}

function buildCatalogCacheRow({
  entityType,
  id,
  name,
  slug,
  description,
  countryCodes,
  imageUrl,
  data,
  fetchedAt
}: {
  entityType: string;
  id: unknown;
  name: string;
  slug?: string | null;
  description?: string | null;
  countryCodes?: string[] | null;
  imageUrl?: string | null;
  data: Record<string, unknown>;
  fetchedAt: string;
}) {
  if (id == null || !name) return null;
  const entityId = String(id);
  const codes = countryCodes && countryCodes.length ? [...new Set(countryCodes.map(normalizeCountryCode).filter(Boolean))] : null;

  return {
    entity_type: entityType,
    entity_id: entityId,
    name,
    slug: slug || null,
    description: description || null,
    country_codes: codes && codes.length ? codes : null,
    image_url: imageUrl || null,
    data,
    fetched_at: fetchedAt,
    updated_at: fetchedAt
  };
}

function normalizeCountryCode(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.toUpperCase();
    return normalized === 'US' ? 'USA' : normalized;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const code = normalizeCountryCode(item);
      if (code) return code;
    }
    return null;
  }
  if (typeof value === 'object') {
    const obj = value as {
      alpha_3_code?: string;
      alpha_2_code?: string;
      country_code?: string;
      code?: string;
    };
    const code = obj.alpha_3_code || obj.alpha_2_code || obj.country_code || obj.code || null;
    return code ? normalizeCountryCode(code) : null;
  }
  return null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function extractImageFullUrl(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const obj = value as { image_url?: string; url?: string; thumbnail_url?: string };
    return obj.image_url || obj.url || obj.thumbnail_url || null;
  }
  return null;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
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
