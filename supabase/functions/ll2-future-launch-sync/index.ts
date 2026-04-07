import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';
import { normalizeLandingRole, upsertLl2LandingCatalogRows, type Ll2LandingLike } from '../_shared/ll2LandingCatalog.ts';

const LL2_BASE = 'https://ll.thespacedevs.com/2.3.0';
const LL2_USER_AGENT = Deno.env.get('LL2_USER_AGENT') || 'TMinusZero/0.1 (support@tminuszero.app)';
const LL2_API_KEY = Deno.env.get('LL2_API_KEY') || '';

const DEFAULTS = {
  enabled: false,
  ll2RateLimitPerHour: 300,
  pageLimit: 100,
  pagesPerRun: 10,
  horizonDays: 3650
};

const SETTINGS_KEYS = [
  'll2_future_launch_sync_job_enabled',
  'll2_future_launch_sync_page_limit',
  'll2_future_launch_sync_pages_per_run',
  'll2_future_launch_sync_horizon_days',
  'll2_rate_limit_per_hour'
];

type LaunchMapRow = {
  launch_id: string;
  ll2_launch_uuid: string;
};

serve(async (req) => {
  const startedAt = Date.now();
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const force = Boolean(body?.force);

  const { runId } = await startIngestionRun(supabase, 'll2_future_launch_sync');

  const stats: Record<string, unknown> = {
    targetFutureLaunches: 0,
    ll2TotalFutureLaunches: 0,
    pagesFetched: 0,
    matchedLaunches: 0,
    launchesWithStages: 0,
    launchesWithoutStages: 0,
    launchesWithConcreteStage: 0,
    launchesWithPlaceholderOnlyStage: 0,
    launchesWithRecovery: 0,
    launcherRowsUpserted: 0,
    launcherJoinRowsUpserted: 0,
    landingCatalogRowsUpserted: 0,
    launchLandingRowsUpserted: 0,
    launchesMissingFromLl2: 0,
    missingLaunchRowsCleared: 0,
    ll2Calls: 0,
    ll2RateLimited: false,
    ll2RemoteRateLimited: false,
    complete: false
  };

  try {
    const settings = await getSettings(supabase, SETTINGS_KEYS);
    const enabled = readBooleanSetting(settings.ll2_future_launch_sync_job_enabled, DEFAULTS.enabled);
    if (!enabled && !force) {
      const result = { ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt, stats };
      await finishIngestionRun(supabase, runId, true, result.stats as Record<string, unknown>);
      return jsonResponse(result);
    }

    const pageLimit = clampInt(
      readOverrideNumber(body?.pageLimit, settings.ll2_future_launch_sync_page_limit, DEFAULTS.pageLimit),
      1,
      100
    );
    const pagesPerRun = clampInt(
      readOverrideNumber(body?.pagesPerRun, settings.ll2_future_launch_sync_pages_per_run, DEFAULTS.pagesPerRun),
      1,
      20
    );
    const horizonDays = clampInt(
      readOverrideNumber(body?.horizonDays, settings.ll2_future_launch_sync_horizon_days, DEFAULTS.horizonDays),
      1,
      3650
    );
    const ll2RateLimit = clampInt(readNumberSetting(settings.ll2_rate_limit_per_hour, DEFAULTS.ll2RateLimitPerHour), 1, 10_000);

    const now = new Date();
    const nowIso = now.toISOString();
    const horizonIso = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000).toISOString();

    const futureLaunchMap = await loadFutureLaunchMap(supabase, { nowIso, horizonIso });
    stats.targetFutureLaunches = futureLaunchMap.size;

    if (!futureLaunchMap.size) {
      const result = { ok: true, skipped: true, reason: 'no_future_launches', elapsedMs: Date.now() - startedAt, stats };
      await finishIngestionRun(supabase, runId, true, result.stats as Record<string, unknown>);
      return jsonResponse(result);
    }

    const fetchedAt = new Date().toISOString();
    const matchedLaunchUuids = new Set<string>();
    const launcherRows = new Map<number, Record<string, unknown>>();
    const launcherJoinRows = new Map<string, Record<string, unknown>>();
    const landingRows = new Map<string, Record<string, unknown>>();
    const landingCatalogInputs: Ll2LandingLike[] = [];

    let offset = 0;
    let total = 0;
    let sawTerminalPage = false;

    while ((stats.pagesFetched as number) < pagesPerRun) {
      if (matchedLaunchUuids.size >= futureLaunchMap.size) {
        sawTerminalPage = true;
        break;
      }

      const rate = await tryConsumeLl2(supabase, ll2RateLimit);
      if (!rate.allowed) {
        stats.ll2RateLimited = true;
        break;
      }

      const page = await fetchFutureLaunchPage({
        limit: pageLimit,
        offset,
        nowIso,
        horizonIso
      });
      stats.ll2Calls = (stats.ll2Calls as number) + 1;

      if (page.skipped) {
        if (page.skipReason === 'remote_rate_limit') {
          stats.ll2RemoteRateLimited = true;
          break;
        }
        throw new Error(`LL2 future launch sync skipped: ${page.skipReason || 'unknown'}`);
      }

      total = page.total;
      stats.ll2TotalFutureLaunches = total;
      stats.pagesFetched = (stats.pagesFetched as number) + 1;

      const rows = page.launches.filter((launch) => futureLaunchMap.has(String(launch?.id || '')));
      for (const launch of rows) {
        const ll2LaunchUuid = typeof launch?.id === 'string' ? launch.id.trim() : '';
        const launchId = futureLaunchMap.get(ll2LaunchUuid);
        if (!ll2LaunchUuid || !launchId) continue;

        matchedLaunchUuids.add(ll2LaunchUuid);
        stats.matchedLaunches = (stats.matchedLaunches as number) + 1;

        const launcherStages = Array.isArray(launch?.rocket?.launcher_stage) ? launch.rocket.launcher_stage : [];
        const spacecraftStages = Array.isArray(launch?.rocket?.spacecraft_stage) ? launch.rocket.spacecraft_stage : [];

        if (launcherStages.length > 0) {
          stats.launchesWithStages = (stats.launchesWithStages as number) + 1;
          const hasConcreteStage = launcherStages.some((stage) => stage?.launcher && stage.launcher.is_placeholder !== true);
          const hasOnlyPlaceholderStage = !hasConcreteStage && launcherStages.some((stage) => stage?.launcher?.is_placeholder === true);
          if (hasConcreteStage) {
            stats.launchesWithConcreteStage = (stats.launchesWithConcreteStage as number) + 1;
          } else if (hasOnlyPlaceholderStage) {
            stats.launchesWithPlaceholderOnlyStage = (stats.launchesWithPlaceholderOnlyStage as number) + 1;
          }
        } else {
          stats.launchesWithoutStages = (stats.launchesWithoutStages as number) + 1;
        }

        let launchHasRecovery = false;

        for (const stage of launcherStages) {
          const launcherRow = mapLauncherRow(stage?.launcher, fetchedAt);
          if (launcherRow && typeof launcherRow.ll2_launcher_id === 'number') {
            launcherRows.set(launcherRow.ll2_launcher_id, launcherRow);
            launcherJoinRows.set(`${ll2LaunchUuid}:${launcherRow.ll2_launcher_id}`, {
              ll2_launcher_id: launcherRow.ll2_launcher_id,
              ll2_launch_uuid: ll2LaunchUuid,
              launch_id: launchId
            });
          }

          const landing = stage?.landing ?? null;
          const landingId = toFiniteInt(landing?.id);
          if (landingId == null) continue;
          launchHasRecovery = true;
          landingCatalogInputs.push(landing as Ll2LandingLike);
          landingRows.set(`${ll2LaunchUuid}:${landingId}:booster`, {
            ll2_launch_uuid: ll2LaunchUuid,
            launch_id: launchId,
            ll2_landing_id: landingId,
            landing_role: normalizeLandingRole('booster'),
            fetched_at: fetchedAt,
            updated_at: fetchedAt
          });
        }

        for (const stage of spacecraftStages) {
          const landing = stage?.landing ?? null;
          const landingId = toFiniteInt(landing?.id);
          if (landingId == null) continue;
          launchHasRecovery = true;
          landingCatalogInputs.push(landing as Ll2LandingLike);
          landingRows.set(`${ll2LaunchUuid}:${landingId}:spacecraft`, {
            ll2_launch_uuid: ll2LaunchUuid,
            launch_id: launchId,
            ll2_landing_id: landingId,
            landing_role: normalizeLandingRole('spacecraft'),
            fetched_at: fetchedAt,
            updated_at: fetchedAt
          });
        }

        if (launchHasRecovery) {
          stats.launchesWithRecovery = (stats.launchesWithRecovery as number) + 1;
        }
      }

      if (page.launches.length < pageLimit || offset + page.launches.length >= total) {
        sawTerminalPage = true;
        break;
      }

      offset += page.launches.length;
    }

    if (launcherRows.size) {
      const { error } = await supabase.from('ll2_launchers').upsert([...launcherRows.values()], { onConflict: 'll2_launcher_id' });
      if (error) throw error;
      stats.launcherRowsUpserted = launcherRows.size;
    }

    const processedLaunchUuids = [...matchedLaunchUuids];
    if (processedLaunchUuids.length) {
      await replaceLaunchScopedLauncherRows(supabase, processedLaunchUuids, [...launcherJoinRows.values()]);
      stats.launcherJoinRowsUpserted = launcherJoinRows.size;

      const landingCatalogRowsUpserted = await upsertLl2LandingCatalogRows(supabase, landingCatalogInputs, fetchedAt);
      stats.landingCatalogRowsUpserted = landingCatalogRowsUpserted;

      await replaceLaunchScopedLandingRows(supabase, processedLaunchUuids, [...landingRows.values()]);
      stats.launchLandingRowsUpserted = landingRows.size;
    }

    const canClearMissing = sawTerminalPage && !(stats.ll2RateLimited as boolean) && !(stats.ll2RemoteRateLimited as boolean) && matchedLaunchUuids.size > 0;
    if (canClearMissing) {
      const missingLaunchUuids = [...futureLaunchMap.keys()].filter((uuid) => !matchedLaunchUuids.has(uuid));
      stats.launchesMissingFromLl2 = missingLaunchUuids.length;
      if (missingLaunchUuids.length) {
        await deleteRowsByLaunchUuids(supabase, 'll2_launcher_launches', missingLaunchUuids);
        await deleteRowsByLaunchUuids(supabase, 'll2_launch_landings', missingLaunchUuids);
        stats.missingLaunchRowsCleared = missingLaunchUuids.length;
      }
    }

    stats.complete = sawTerminalPage && !(stats.ll2RateLimited as boolean) && !(stats.ll2RemoteRateLimited as boolean);

    const ok = !(stats.ll2RateLimited as boolean) && !(stats.ll2RemoteRateLimited as boolean);
    await finishIngestionRun(supabase, runId, ok, stats, ok ? undefined : 'partial_failure');
    return jsonResponse({ ok, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});

async function loadFutureLaunchMap(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    nowIso,
    horizonIso
  }: {
    nowIso: string;
    horizonIso: string;
  }
) {
  const launchMap = new Map<string, string>();
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('launches_public_cache')
      .select('launch_id, ll2_launch_uuid')
      .eq('hidden', false)
      .not('ll2_launch_uuid', 'is', null)
      .gte('net', nowIso)
      .lte('net', horizonIso)
      .order('net', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const rows = (data || []) as LaunchMapRow[];
    for (const row of rows) {
      if (row?.launch_id && row?.ll2_launch_uuid) {
        launchMap.set(String(row.ll2_launch_uuid), String(row.launch_id));
      }
    }

    if (rows.length < pageSize) break;
    offset += rows.length;
  }

  return launchMap;
}

async function fetchFutureLaunchPage({
  limit,
  offset,
  nowIso,
  horizonIso
}: {
  limit: number;
  offset: number;
  nowIso: string;
  horizonIso: string;
}) {
  const url =
    `${LL2_BASE}/launches/?format=json&mode=detailed&include_suborbital=true` +
    `&ordering=net&limit=${limit}&offset=${Math.max(0, Math.trunc(offset))}` +
    `&net__gte=${encodeURIComponent(nowIso)}&net__lte=${encodeURIComponent(horizonIso)}`;

  const res = await fetch(url, { headers: buildLl2Headers() });
  if (res.status === 429) return { launches: [] as any[], skipped: true, total: 0, skipReason: 'remote_rate_limit' };
  if (res.status >= 500) return { launches: [] as any[], skipped: true, total: 0, skipReason: `server_${res.status}` };
  if (!res.ok) throw new Error(`LL2 future launch fetch failed ${res.status}`);

  const json = await res.json().catch(() => ({}));
  return {
    launches: Array.isArray(json?.results) ? (json.results as any[]) : [],
    skipped: false,
    total: typeof json?.count === 'number' ? json.count : 0,
    skipReason: null
  };
}

async function replaceLaunchScopedLauncherRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchUuids: string[],
  rows: Array<Record<string, unknown>>
) {
  await deleteRowsByLaunchUuids(supabase, 'll2_launcher_launches', launchUuids);
  if (!rows.length) return;

  for (const chunk of chunkArray(rows, 500)) {
    const { error } = await supabase.from('ll2_launcher_launches').upsert(chunk, { onConflict: 'll2_launcher_id,ll2_launch_uuid' });
    if (error) throw error;
  }
}

async function replaceLaunchScopedLandingRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchUuids: string[],
  rows: Array<Record<string, unknown>>
) {
  await deleteRowsByLaunchUuids(supabase, 'll2_launch_landings', launchUuids);
  if (!rows.length) return;

  for (const chunk of chunkArray(rows, 500)) {
    const { error } = await supabase.from('ll2_launch_landings').upsert(chunk, {
      onConflict: 'll2_launch_uuid,ll2_landing_id,landing_role'
    });
    if (error) throw error;
  }
}

async function deleteRowsByLaunchUuids(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  table: 'll2_launcher_launches' | 'll2_launch_landings',
  launchUuids: string[]
) {
  for (const chunk of chunkArray(launchUuids, 200)) {
    if (!chunk.length) continue;
    const { error } = await supabase.from(table).delete().in('ll2_launch_uuid', chunk);
    if (error) throw error;
  }
}

function mapLauncherRow(launcher: any, fetchedAt: string) {
  const launcherId = toFiniteInt(launcher?.id);
  if (launcherId == null) return null;

  return {
    ll2_launcher_id: launcherId,
    serial_number: normalizeText(launcher?.serial_number),
    flight_proven: typeof launcher?.flight_proven === 'boolean' ? launcher.flight_proven : null,
    status: normalizeLauncherStatus(launcher?.status),
    details: normalizeText(launcher?.details),
    image_url: extractImageUrl(launcher?.image ?? launcher?.image_url),
    launcher_config_id: toFiniteInt(launcher?.launcher_config?.id ?? launcher?.launcher_config_id),
    flights: typeof launcher?.flights === 'number' && Number.isFinite(launcher.flights) ? Math.trunc(launcher.flights) : null,
    first_launch_date: normalizeDateOnly(launcher?.first_launch_date),
    last_launch_date: normalizeDateOnly(launcher?.last_launch_date),
    raw: launcher,
    fetched_at: fetchedAt,
    updated_at: fetchedAt
  };
}

function normalizeLauncherStatus(value: unknown) {
  if (typeof value === 'string') return normalizeText(value);
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return normalizeText(record.name) || normalizeText(record.abbrev);
}

function extractImageUrl(value: unknown) {
  if (typeof value === 'string') return normalizeText(value);
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return normalizeText(record.image_url) || normalizeText(record.thumbnail_url);
}

function normalizeDateOnly(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const direct = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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

function buildLl2Headers() {
  const headers: Record<string, string> = { 'User-Agent': LL2_USER_AGENT, accept: 'application/json' };
  if (LL2_API_KEY) headers.Authorization = `Token ${LL2_API_KEY}`;
  return headers;
}

function readOverrideNumber(bodyValue: unknown, settingValue: unknown, fallback: number) {
  if (typeof bodyValue === 'number' && Number.isFinite(bodyValue)) return bodyValue;
  if (typeof bodyValue === 'string') {
    const parsed = Number(bodyValue);
    if (Number.isFinite(parsed)) return parsed;
  }
  return readNumberSetting(settingValue, fallback);
}

function toFiniteInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function chunkArray<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

function stringifyError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
