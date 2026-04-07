import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { TRAJECTORY_PRODUCTS_FOLLOWUP_COALESCE, triggerEdgeJob } from '../_shared/edgeJobTrigger.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { normalizeLandingRole, upsertLl2LandingCatalogRows } from '../_shared/ll2LandingCatalog.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';

const LL2_BASE = 'https://ll.thespacedevs.com/2.3.0';
const LL2_USER_AGENT = Deno.env.get('LL2_USER_AGENT') || 'TMinusZero/0.1 (support@tminuszero.app)';
const LL2_API_KEY = Deno.env.get('LL2_API_KEY') || '';
const PARSER_VERSION = 'v1';

const DEFAULTS = {
  enabled: true,
  eligibleLimit: 8,
  lookaheadLimit: 50,
  lookbackHours: 24,
  expiryHours: 3,
  ll2RateLimitPerHour: 300
};

const SETTINGS_KEYS = [
  'trajectory_constraints_job_enabled',
  'trajectory_constraints_eligible_limit',
  'trajectory_constraints_lookahead_limit',
  'trajectory_constraints_lookback_hours',
  'trajectory_constraints_expiry_hours',
  'll2_rate_limit_per_hour'
];

type LaunchRow = {
  launch_id: string;
  ll2_launch_uuid: string | null;
  net: string | null;
  status_name: string | null;
  timeline: Array<{ relative_time?: string | null }> | null;
};

type LandingRole = 'booster' | 'spacecraft' | 'unknown';

type Ll2Landing = {
  id: number;
  landing_role?: LandingRole;
  attempt?: boolean;
  success?: boolean | null;
  description?: string | null;
  downrange_distance?: number | null;
  landing_location?: {
    id?: number;
    name?: string;
    abbrev?: string;
    latitude?: number | null;
    longitude?: number | null;
    location?: { name?: string } | null;
  } | null;
  type?: { id?: number; name?: string; abbrev?: string } | null;
};

serve(async (req) => {
  const startedAt = Date.now();
  let supabase: ReturnType<typeof createSupabaseAdminClient>;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    return jsonResponse({ ok: false, stage: 'init', error: stringifyError(err) }, 500);
  }

  let authorized = false;
  try {
    authorized = await requireJobAuth(req, supabase);
  } catch (err) {
    return jsonResponse({ ok: false, stage: 'auth', error: stringifyError(err) }, 500);
  }
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const { runId } = await startIngestionRun(supabase, 'trajectory_constraints_ingest');

  const stats: Record<string, unknown> = {
    eligibleLaunchIds: [] as string[],
    launchesConsidered: 0,
    launchesSkippedNoLl2Id: 0,
    launchCoverage: [] as Array<{
      launchId: string;
      ll2LaunchUuid: string | null;
      skippedNoLl2Id: boolean;
      landingsFetched: number;
      rowsPrepared: number;
    }>,
    ll2Calls: 0,
    ll2RateLimited: false,
    ll2RemoteRateLimited: false,
    landingsFetched: 0,
    landingCatalogRowsUpserted: 0,
    launchLandingRowsUpserted: 0,
    rowsUpserted: 0,
    rowsMergedInput: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsSkipped: 0,
    mergeFallback: false,
    trajectoryProductsTrigger: null as Record<string, unknown> | null
  };

  try {
    const settings = await getSettings(supabase, SETTINGS_KEYS);
    const enabled = readBooleanSetting(settings.trajectory_constraints_job_enabled, DEFAULTS.enabled);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const eligibleLimit = clampInt(
      readNumberSetting(settings.trajectory_constraints_eligible_limit, DEFAULTS.eligibleLimit),
      1,
      10
    );
    const lookaheadLimit = clampInt(
      readNumberSetting(settings.trajectory_constraints_lookahead_limit, DEFAULTS.lookaheadLimit),
      eligibleLimit,
      200
    );
    const lookbackHours = clampInt(readNumberSetting(settings.trajectory_constraints_lookback_hours, DEFAULTS.lookbackHours), 1, 168);
    const expiryHours = clampInt(readNumberSetting(settings.trajectory_constraints_expiry_hours, DEFAULTS.expiryHours), 1, 24);
    const ll2RateLimit = clampInt(readNumberSetting(settings.ll2_rate_limit_per_hour, DEFAULTS.ll2RateLimitPerHour), 1, 10_000);

    const nowMs = Date.now();
    const fromIso = new Date(nowMs - lookbackHours * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('launches_public_cache')
      .select('launch_id, ll2_launch_uuid, net, status_name, timeline')
      .gte('net', fromIso)
      .order('net', { ascending: true })
      .limit(lookaheadLimit);

    if (error || !data) {
      throw new Error(`Failed to load launches_public_cache: ${error?.message || 'unknown error'}`);
    }

    const eligible: LaunchRow[] = [];
    const expiryMs = expiryHours * 60 * 60 * 1000;
    for (const row of data as LaunchRow[]) {
      const netMs = row.net ? Date.parse(row.net) : NaN;
      if (!Number.isFinite(netMs)) continue;
      const ignoreTimeline = row.status_name === 'hold' || row.status_name === 'scrubbed';
      const maxOffsetMs = ignoreTimeline ? 0 : getMaxTimelineOffsetMs(row.timeline) ?? 0;
      const expiresAtMs = netMs + maxOffsetMs + expiryMs;
      if (expiresAtMs < nowMs) continue;
      eligible.push(row);
      if (eligible.length >= eligibleLimit) break;
    }

    stats.eligibleLaunchIds = eligible.map((row) => row.launch_id).filter(Boolean);

    if (!eligible.length) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'no_eligible' });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_eligible', elapsedMs: Date.now() - startedAt });
    }

    const rows: Array<Record<string, unknown>> = [];
    const nowIso = new Date().toISOString();

    for (const launch of eligible) {
      stats.launchesConsidered = (stats.launchesConsidered as number) + 1;
      const coverage = {
        launchId: launch.launch_id,
        ll2LaunchUuid: launch.ll2_launch_uuid ?? null,
        skippedNoLl2Id: false,
        landingsFetched: 0,
        rowsPrepared: 0
      };
      if (!launch.ll2_launch_uuid) {
        stats.launchesSkippedNoLl2Id = (stats.launchesSkippedNoLl2Id as number) + 1;
        coverage.skippedNoLl2Id = true;
        (stats.launchCoverage as Array<typeof coverage>).push(coverage);
        continue;
      }

      const fetched = await fetchLandingsForLaunch({
        supabase,
        ll2LaunchId: launch.ll2_launch_uuid,
        ll2RateLimit,
        stats
      });

      stats.landingsFetched = (stats.landingsFetched as number) + fetched.length;
      coverage.landingsFetched = fetched.length;

      if (!(stats.ll2RateLimited as boolean) && !(stats.ll2RemoteRateLimited as boolean)) {
        const landingCatalogRows = await upsertLl2LandingCatalogRows(supabase, fetched, nowIso);
        stats.landingCatalogRowsUpserted = (stats.landingCatalogRowsUpserted as number) + landingCatalogRows;

        const refreshedRows = await refreshLaunchLandingRows(supabase, {
          launchId: launch.launch_id,
          ll2LaunchUuid: launch.ll2_launch_uuid,
          landings: fetched,
          fetchedAt: nowIso
        });
        stats.launchLandingRowsUpserted = (stats.launchLandingRowsUpserted as number) + refreshedRows;
      }

      for (const landing of fetched) {
        const hasCoords =
          typeof landing?.landing_location?.latitude === 'number' &&
          Number.isFinite(landing.landing_location.latitude) &&
          typeof landing?.landing_location?.longitude === 'number' &&
          Number.isFinite(landing.landing_location.longitude);
        const confidence = hasCoords ? 0.95 : 0.85;

        rows.push({
          launch_id: launch.launch_id,
          source: 'll2',
          source_id: String(landing.id),
          constraint_type: 'landing',
          confidence,
          ingestion_run_id: runId,
          source_hash: `ll2:${launch.ll2_launch_uuid}:landing:${landing.id}`,
          extracted_field_map: {
            landing_role: landing.landing_role != null,
            attempt: typeof landing.attempt === 'boolean',
            success: typeof landing.success === 'boolean',
            downrange_distance_km:
              typeof landing.downrange_distance === 'number' && Number.isFinite(landing.downrange_distance),
            landing_location_name: Boolean(landing?.landing_location?.name),
            landing_location_coords: hasCoords
          },
          parse_rule_id: 'll2_landings_extract_v1',
          parser_version: PARSER_VERSION,
          license_class: 'public_api_ll2',
          data: {
            id: landing.id,
            landing_role: landing.landing_role ?? null,
            attempt: landing.attempt ?? null,
            success: landing.success ?? null,
            description: landing.description ?? null,
            downrange_distance_km: landing.downrange_distance ?? null,
            landing_location: landing.landing_location ?? null,
            landing_type: landing.type ?? null,
            sourceUrl: `${LL2_BASE}/landings/?format=json&mode=detailed&limit=100`
          },
          fetched_at: nowIso
        });
        coverage.rowsPrepared += 1;
      }

      (stats.launchCoverage as Array<typeof coverage>).push(coverage);

      if ((stats.ll2RateLimited as boolean) || (stats.ll2RemoteRateLimited as boolean)) break;
    }

    if (rows.length) {
      const merged = await upsertTrajectoryConstraintsIfChanged(supabase, rows);
      stats.rowsMergedInput = merged.input;
      stats.rowsInserted = merged.inserted;
      stats.rowsUpdated = merged.updated;
      stats.rowsSkipped = merged.skipped;
      stats.rowsUpserted = merged.inserted + merged.updated;
      stats.mergeFallback = merged.usedFallback;
    }

    const ok = !(stats.ll2RateLimited as boolean) && !(stats.ll2RemoteRateLimited as boolean);
    if (ok) {
      stats.trajectoryProductsTrigger = await triggerEdgeJob({
        supabase,
        jobSlug: 'trajectory-products-generate',
        coalesce: TRAJECTORY_PRODUCTS_FOLLOWUP_COALESCE
      });
    }
    await finishIngestionRun(supabase, runId, ok, stats, ok ? undefined : 'partial_failure');
    return jsonResponse({ ok, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});

async function fetchLandingsForLaunch({
  supabase,
  ll2LaunchId,
  ll2RateLimit,
  stats
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  ll2LaunchId: string;
  ll2RateLimit: number;
  stats: Record<string, unknown>;
}) {
  const firstStage = await fetchLandingsByQuery({
    supabase,
    query: `firststage_launch__ids=${encodeURIComponent(ll2LaunchId)}`,
    role: 'booster',
    ll2RateLimit,
    stats
  });
  const spacecraft = await fetchLandingsByQuery({
    supabase,
    query: `spacecraft_launch__ids=${encodeURIComponent(ll2LaunchId)}`,
    role: 'spacecraft',
    ll2RateLimit,
    stats
  });
  const byId = new Map<number, Ll2Landing>();
  // Prefer booster landings when the same landing appears in both query modes.
  for (const row of [...spacecraft, ...firstStage]) {
    if (typeof row?.id === 'number') byId.set(row.id, row);
  }
  return [...byId.values()];
}

async function fetchLandingsByQuery({
  supabase,
  query,
  role,
  ll2RateLimit,
  stats
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  query: string;
  role: LandingRole;
  ll2RateLimit: number;
  stats: Record<string, unknown>;
}): Promise<Ll2Landing[]> {
  if ((stats.ll2RateLimited as boolean) || (stats.ll2RemoteRateLimited as boolean)) return [];

  const rate = await tryConsumeLl2(supabase, ll2RateLimit);
  if (!rate.allowed) {
    stats.ll2RateLimited = true;
    return [];
  }

  const url = `${LL2_BASE}/landings/?format=json&mode=detailed&limit=100&${query}`;
  const res = await fetch(url, { headers: buildLl2Headers() });
  stats.ll2Calls = (stats.ll2Calls as number) + 1;

  if (res.status === 429) {
    stats.ll2RemoteRateLimited = true;
    return [];
  }
  if (res.status >= 500) {
    throw new Error(`LL2 landings fetch failed ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(`LL2 landings fetch failed ${res.status}`);
  }

  const json = await res.json().catch(() => ({} as any));
  const results = Array.isArray(json?.results) ? (json.results as Ll2Landing[]) : [];
  return results.map((row) => ({ ...row, landing_role: role }));
}

async function refreshLaunchLandingRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    launchId,
    ll2LaunchUuid,
    landings,
    fetchedAt
  }: {
    launchId: string;
    ll2LaunchUuid: string;
    landings: Ll2Landing[];
    fetchedAt: string;
  }
) {
  const { error: deleteError } = await supabase.from('ll2_launch_landings').delete().eq('ll2_launch_uuid', ll2LaunchUuid);
  if (deleteError) throw deleteError;

  if (!Array.isArray(landings) || landings.length === 0) return 0;

  const rows = dedupeLaunchLandingRows(
    landings.map((landing) => ({
      ll2_launch_uuid: ll2LaunchUuid,
      launch_id: launchId,
      ll2_landing_id: landing.id,
      landing_role: normalizeLandingRole(landing.landing_role),
      fetched_at: fetchedAt,
      updated_at: fetchedAt
    }))
  );

  if (!rows.length) return 0;

  const { error } = await supabase
    .from('ll2_launch_landings')
    .upsert(rows, { onConflict: 'll2_launch_uuid,ll2_landing_id,landing_role' });
  if (error) throw error;

  return rows.length;
}

function dedupeLaunchLandingRows(
  rows: Array<{
    ll2_launch_uuid: string;
    launch_id: string;
    ll2_landing_id: number;
    landing_role: LandingRole;
    fetched_at: string;
    updated_at: string;
  }>
) {
  const deduped = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!row.ll2_launch_uuid || !row.launch_id || !Number.isFinite(row.ll2_landing_id)) continue;
    const key = `${row.ll2_launch_uuid}:${row.ll2_landing_id}:${row.landing_role}`;
    deduped.set(key, row);
  }
  return [...deduped.values()];
}

function buildLl2Headers() {
  const headers: Record<string, string> = { 'User-Agent': LL2_USER_AGENT, accept: 'application/json' };
  if (LL2_API_KEY) headers.Authorization = `Token ${LL2_API_KEY}`;
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

function getMaxTimelineOffsetMs(timeline?: Array<{ relative_time?: string | null }> | null) {
  if (!Array.isArray(timeline) || timeline.length === 0) return null;
  let max = Number.NEGATIVE_INFINITY;
  for (const event of timeline) {
    const relative = typeof event?.relative_time === 'string' ? event.relative_time : null;
    const offsetMs = relative ? parseIsoDurationToMs(relative) : null;
    if (offsetMs == null) continue;
    if (offsetMs > max) max = offsetMs;
  }
  return max === Number.NEGATIVE_INFINITY ? null : max;
}

function parseIsoDurationToMs(value?: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const negative = trimmed.startsWith('-');
  const normalized = negative ? trimmed.slice(1) : trimmed;
  const match = normalized.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!match) return null;
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  if (![days, hours, minutes, seconds].every(Number.isFinite)) return null;
  const totalSeconds = ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
  const ms = totalSeconds * 1000;
  return negative ? -ms : ms;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'unknown_error';
  }
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

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

async function upsertTrajectoryConstraintsIfChanged(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: Array<Record<string, unknown>>
) {
  const { data, error } = await supabase.rpc('upsert_launch_trajectory_constraints_if_changed', {
    rows_in: rows
  });
  if (!error) {
    const stats = asPlainObject(data);
    return {
      input: readInt(stats.input),
      inserted: readInt(stats.inserted),
      updated: readInt(stats.updated),
      skipped: readInt(stats.skipped),
      usedFallback: false
    };
  }

  console.warn('upsert_launch_trajectory_constraints_if_changed failed; falling back to upsert', error);
  const { data: fallbackRows, error: fallbackError } = await supabase
    .from('launch_trajectory_constraints')
    .upsert(rows, { onConflict: 'launch_id,source,constraint_type,source_id' })
    .select('id');
  if (fallbackError) throw fallbackError;
  const touched = Array.isArray(fallbackRows) ? fallbackRows.length : rows.length;
  return {
    input: rows.length,
    inserted: 0,
    updated: touched,
    skipped: Math.max(0, rows.length - touched),
    usedFallback: true
  };
}

function asPlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed));
  }
  return 0;
}
