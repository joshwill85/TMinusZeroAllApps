import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';
import { derivePadState, normalizeNetPrecision, parseNumber } from '../_shared/ll2.ts';

const LL2_BASE = 'https://ll.thespacedevs.com/2.3.0';
const LL2_USER_AGENT = Deno.env.get('LL2_USER_AGENT') || 'TMinusZero/0.1 (support@tminuszero.app)';
const LL2_API_KEY = Deno.env.get('LL2_API_KEY') || '';

const DEFAULTS = {
  ll2RateLimitPerHour: 300,
  pageLimit: 100,
  pagesPerRun: 1
};

const CONDITIONAL_UPSERT_RPC_BY_TABLE: Record<string, string> = {
  ll2_locations: 'upsert_ll2_locations_if_changed',
  ll2_pads: 'upsert_ll2_pads_if_changed',
  ll2_rocket_configs: 'upsert_ll2_rocket_configs_if_changed',
  ll2_launchers: 'upsert_ll2_launchers_if_changed',
  ll2_astronauts: 'upsert_ll2_astronauts_if_changed'
};

type CatalogEntity = {
  slug: string;
  endpoint: string;
  offsetKey: string;
  table: string;
  conflict: string;
  query?: string;
  mapRow: (row: any, fetchedAt: string) => Record<string, unknown> | null;
  mapCache: (row: any, fetchedAt: string) => Record<string, unknown> | null;
  prepare?: (supabase: ReturnType<typeof createSupabaseAdminClient>, rows: any[], fetchedAt: string) => Promise<void>;
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const { runId } = await startIngestionRun(supabase, 'll2_catalog');
  const startedAt = Date.now();

  try {
    const settings = await getSettings(supabase, [
      'll2_catalog_job_enabled',
      'll2_catalog_page_limit',
      'll2_catalog_pages_per_run',
      'll2_rate_limit_per_hour',
      'll2_catalog_astronauts_offset',
      'll2_catalog_space_stations_offset',
      'll2_catalog_expeditions_offset',
      'll2_catalog_docking_events_offset',
      'll2_catalog_launcher_configurations_offset',
      'll2_catalog_launchers_offset',
      'll2_catalog_spacecraft_configurations_offset',
      'll2_catalog_locations_offset',
      'll2_catalog_pads_offset',
      'll2_catalog_events_offset',
      'll2_catalog_astronaut_flights_enabled',
      'll2_catalog_astronaut_flights_batch_size',
      'll2_catalog_astronaut_flights_offset',
      'll2_catalog_launcher_flights_enabled',
      'll2_catalog_launcher_flights_batch_size',
      'll2_catalog_launcher_flights_offset'
    ]);

    const jobEnabled = readBooleanSetting(settings.ll2_catalog_job_enabled, true);
    if (!jobEnabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled' });
    }

    const pageLimit = clampInt(readNumberSetting(settings.ll2_catalog_page_limit, DEFAULTS.pageLimit), 1, 100);
    const pagesPerRun = clampInt(readNumberSetting(settings.ll2_catalog_pages_per_run, DEFAULTS.pagesPerRun), 1, 5);
    const ll2RateLimit = readNumberSetting(settings.ll2_rate_limit_per_hour, DEFAULTS.ll2RateLimitPerHour);
    const fetchedAt = new Date().toISOString();

    const entities: CatalogEntity[] = [
      {
        slug: 'locations',
        endpoint: 'locations',
        offsetKey: 'll2_catalog_locations_offset',
        table: 'll2_locations',
        conflict: 'll2_location_id',
        mapRow: mapLocationRow,
        mapCache: mapLocationCache
      },
      {
        slug: 'pads',
        endpoint: 'pads',
        offsetKey: 'll2_catalog_pads_offset',
        table: 'll2_pads',
        conflict: 'll2_pad_id',
        mapRow: mapPadRow,
        mapCache: mapPadCache,
        prepare: upsertLocationsFromPads
      },
      {
        slug: 'launcher_configurations',
        endpoint: 'launcher_configurations',
        offsetKey: 'll2_catalog_launcher_configurations_offset',
        table: 'll2_rocket_configs',
        conflict: 'll2_config_id',
        query: 'mode=detailed',
        mapRow: mapLauncherConfigRow,
        mapCache: mapLauncherConfigCache
      },
      {
        slug: 'launchers',
        endpoint: 'launchers',
        offsetKey: 'll2_catalog_launchers_offset',
        table: 'll2_launchers',
        conflict: 'll2_launcher_id',
        query: 'mode=detailed',
        mapRow: mapLauncherRow,
        mapCache: mapLauncherCache
      },
      {
        slug: 'spacecraft_configurations',
        endpoint: 'spacecraft_configurations',
        offsetKey: 'll2_catalog_spacecraft_configurations_offset',
        table: 'll2_spacecraft_configurations',
        conflict: 'll2_spacecraft_config_id',
        mapRow: mapSpacecraftConfigRow,
        mapCache: mapSpacecraftConfigCache
      },
      {
        slug: 'astronauts',
        endpoint: 'astronauts',
        offsetKey: 'll2_catalog_astronauts_offset',
        table: 'll2_astronauts',
        conflict: 'll2_astronaut_id',
        mapRow: mapAstronautRow,
        mapCache: mapAstronautCache
      },
      {
        slug: 'space_stations',
        endpoint: 'space_stations',
        offsetKey: 'll2_catalog_space_stations_offset',
        table: 'll2_space_stations',
        conflict: 'll2_space_station_id',
        mapRow: mapSpaceStationRow,
        mapCache: mapSpaceStationCache
      },
      {
        slug: 'expeditions',
        endpoint: 'expeditions',
        offsetKey: 'll2_catalog_expeditions_offset',
        table: 'll2_expeditions',
        conflict: 'll2_expedition_id',
        mapRow: mapExpeditionRow,
        mapCache: mapExpeditionCache
      },
      {
        slug: 'docking_events',
        endpoint: 'docking_events',
        offsetKey: 'll2_catalog_docking_events_offset',
        table: 'll2_docking_events',
        conflict: 'll2_docking_event_id',
        mapRow: mapDockingEventRow,
        mapCache: mapDockingEventCache
      },
      {
        slug: 'events',
        endpoint: 'events',
        offsetKey: 'll2_catalog_events_offset',
        table: 'll2_events',
        conflict: 'll2_event_id',
        mapRow: mapEventRow,
        mapCache: mapEventCache
      }
    ];

    const summary: Array<Record<string, unknown>> = [];

    for (const entity of entities) {
      const offset = clampInt(readNumberSetting(settings[entity.offsetKey], 0), 0, 1_000_000_000);
      let nextOffset = offset;
      let pagesProcessed = 0;
      let fetched = 0;
      let total = 0;
      let skipReason: string | null = null;

      while (pagesProcessed < pagesPerRun) {
        const rate = await tryConsumeLl2(supabase, ll2RateLimit);
        if (!rate.allowed) {
          skipReason = 'rate_limit';
          break;
        }

        const page = await fetchLl2Page({
          endpoint: entity.endpoint,
          limit: pageLimit,
          offset: nextOffset,
          query: entity.query
        });
        if (page.skipped) {
          skipReason = page.skipReason || 'remote_skip';
          break;
        }

        const rows = page.rows;
        total = page.total ?? total;
        if (!rows.length) {
          nextOffset = 0;
          pagesProcessed += 1;
          break;
        }

        if (entity.prepare) {
          await entity.prepare(supabase, rows, fetchedAt);
        }

        const mapped = rows.map((row) => entity.mapRow(row, fetchedAt)).filter(Boolean) as Record<string, unknown>[];
        if (mapped.length) {
          await upsertCatalogTableRows(supabase, entity.table, entity.conflict, mapped);
        }

        const cacheRows = rows.map((row) => entity.mapCache(row, fetchedAt)).filter(Boolean) as Record<string, unknown>[];
        if (cacheRows.length) {
          await upsertLl2CatalogPublicCacheIfChanged(supabase, cacheRows);
        }

        fetched += rows.length;
        pagesProcessed += 1;

        if (rows.length < pageLimit) {
          nextOffset = 0;
          break;
        }

        nextOffset += rows.length;
      }

      if (nextOffset !== offset) {
        await upsertSetting(supabase, entity.offsetKey, nextOffset);
      }

      summary.push({
        entity: entity.slug,
        fetched,
        pages: pagesProcessed,
        offsetStart: offset,
        offsetEnd: nextOffset,
        total,
        skipReason
      });

      if (skipReason === 'rate_limit') break;
    }

    const astronautFlights = await runAstronautFlightsIngest({
      supabase,
      settings,
      ll2RateLimit,
      fetchedAt
    });
    const launcherFlights = await runLauncherFlightsIngest({
      supabase,
      settings,
      ll2RateLimit
    });

    const stats = { entities: summary, joins: { astronautFlights, launcherFlights }, elapsedMs: Date.now() - startedAt };
    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, ...stats });
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, undefined, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt }, 500);
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
  const safeOffset = Math.max(0, Math.trunc(offset));
  const extra = query ? `&${query}` : '';
  const ordering = query?.includes('ordering=') ? '' : '&ordering=id';
  const url = `${LL2_BASE}/${endpoint}/?format=json&limit=${limit}&offset=${safeOffset}${ordering}${extra}`;
  const res = await fetch(url, { headers: buildLl2Headers() });

  if (res.status === 429) {
    return { rows: [] as any[], skipped: true, total: 0, skipReason: 'remote_rate_limit' };
  }
  if (res.status >= 500) {
    return { rows: [] as any[], skipped: true, total: 0, skipReason: `server_${res.status}` };
  }
  if (!res.ok) throw new Error(`LL2 fetch failed ${res.status}`);

  const json = await res.json().catch(() => ({}));
  const results = Array.isArray(json.results) ? json.results : [];
  return { rows: results, skipped: false, total: json.count ?? 0, skipReason: null };
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

async function upsertCatalogTableRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  conflict: string,
  rows: Array<Record<string, unknown>>
) {
  if (!rows.length) return;

  const rpcName = CONDITIONAL_UPSERT_RPC_BY_TABLE[table];
  if (rpcName) {
    const { error } = await supabase.rpc(rpcName, { rows_in: rows });
    if (!error) return;

    // Backward-compatible fallback for environments before migration 0222.
    console.warn(`${rpcName} RPC failed; falling back to direct upsert`, error);
  }

  const { error } = await supabase.from(table).upsert(rows, { onConflict: conflict });
  if (error) throw error;
}

async function upsertLl2CatalogPublicCacheIfChanged(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: Array<Record<string, unknown>>
) {
  if (!rows.length) return;
  const { error } = await supabase.rpc('upsert_ll2_catalog_public_cache_if_changed', { rows_in: rows });
  if (!error) return;

  // Backward compatible fallback if the RPC isn't deployed yet.
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

async function runAstronautFlightsIngest({
  supabase,
  settings,
  ll2RateLimit,
  fetchedAt
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  settings: Record<string, unknown>;
  ll2RateLimit: number;
  fetchedAt: string;
}) {
  const enabled = readBooleanSetting(settings.ll2_catalog_astronaut_flights_enabled, false);
  if (!enabled) return { skipped: true, reason: 'disabled' };

  const batchSize = clampInt(readNumberSetting(settings.ll2_catalog_astronaut_flights_batch_size, 1), 1, 10);
  const offset = clampInt(readNumberSetting(settings.ll2_catalog_astronaut_flights_offset, 0), 0, 1_000_000_000);

  const { data, error } = await supabase
    .from('ll2_astronauts')
    .select('ll2_astronaut_id')
    .order('ll2_astronaut_id', { ascending: true })
    .range(offset, offset + batchSize - 1);
  if (error) throw error;

  const ids = (data || [])
    .map((row) => Number((row as { ll2_astronaut_id: unknown }).ll2_astronaut_id))
    .filter((value) => Number.isFinite(value));

  if (!ids.length) {
    if (offset !== 0) await upsertSetting(supabase, 'll2_catalog_astronaut_flights_offset', 0);
    return { fetched: 0, joinRows: 0, offsetStart: offset, offsetEnd: 0, batchSize };
  }

  let fetched = 0;
  let joinRows = 0;
  let skipReason: string | null = null;

  for (const astronautId of ids) {
    const rate = await tryConsumeLl2(supabase, ll2RateLimit);
    if (!rate.allowed) {
      skipReason = 'rate_limit';
      break;
    }

    const detail = await fetchLl2AstronautDetail(astronautId);
    if (detail.skipped) {
      skipReason = detail.skipReason || 'remote_skip';
      break;
    }
    if (detail.notFound || !detail.astronaut) continue;

    const mapped = mapAstronautRow(detail.astronaut, fetchedAt);
    if (mapped) {
      await upsertCatalogTableRows(supabase, 'll2_astronauts', 'll2_astronaut_id', [mapped]);
    }

    const cacheRow = mapAstronautCache(detail.astronaut, fetchedAt);
    if (cacheRow) {
      await upsertLl2CatalogPublicCacheIfChanged(supabase, [cacheRow]);
    }

    const flightIds = extractLaunchIds(detail.astronaut.flights || []);
    const launchMap = await mapLaunchIdsToInternal(supabase, flightIds);
    const rows = flightIds.map((id) => ({
      ll2_astronaut_id: astronautId,
      ll2_launch_uuid: id,
      launch_id: launchMap.get(id) || null
    }));

    await replaceAstronautLaunchRows(supabase, astronautId, rows);
    fetched += 1;
    joinRows += rows.length;
  }

  const nextOffset =
    skipReason ? offset : ids.length < batchSize ? 0 : clampInt(offset + ids.length, 0, 1_000_000_000);
  if (!skipReason && nextOffset !== offset) {
    await upsertSetting(supabase, 'll2_catalog_astronaut_flights_offset', nextOffset);
  }

  return {
    fetched,
    joinRows,
    batchSize,
    offsetStart: offset,
    offsetEnd: nextOffset,
    skipReason
  };
}

async function runLauncherFlightsIngest({
  supabase,
  settings,
  ll2RateLimit
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  settings: Record<string, unknown>;
  ll2RateLimit: number;
}) {
  const enabled = readBooleanSetting(settings.ll2_catalog_launcher_flights_enabled, false);
  if (!enabled) return { skipped: true, reason: 'disabled' };

  const batchSize = clampInt(readNumberSetting(settings.ll2_catalog_launcher_flights_batch_size, 1), 1, 10);
  const offset = clampInt(readNumberSetting(settings.ll2_catalog_launcher_flights_offset, 0), 0, 1_000_000_000);

  const { data, error } = await supabase
    .from('ll2_launchers')
    .select('ll2_launcher_id, serial_number, flights')
    .order('ll2_launcher_id', { ascending: true })
    .range(offset, offset + batchSize - 1);
  if (error) throw error;

  const launchers = (data || []).filter((row) => row && (row as { ll2_launcher_id?: unknown }).ll2_launcher_id != null);
  if (!launchers.length) {
    if (offset !== 0) await upsertSetting(supabase, 'll2_catalog_launcher_flights_offset', 0);
    return { fetched: 0, joinRows: 0, offsetStart: offset, offsetEnd: 0, batchSize };
  }

  let fetched = 0;
  let joinRows = 0;
  let skipReason: string | null = null;
  let missingSerials = 0;

  for (const row of launchers) {
    const launcherId = Number((row as { ll2_launcher_id: unknown }).ll2_launcher_id);
    if (!Number.isFinite(launcherId)) continue;

    const serial = String((row as { serial_number?: unknown }).serial_number || '').trim();
    const storedFlights = (row as { flights?: unknown }).flights;
    let flightIds = extractLaunchIds(Array.isArray(storedFlights) ? storedFlights : []);

    if (!flightIds.length) {
      if (!serial) {
        missingSerials += 1;
        continue;
      }

      const rate = await tryConsumeLl2(supabase, ll2RateLimit);
      if (!rate.allowed) {
        skipReason = 'rate_limit';
        break;
      }

      const page = await fetchLl2LaunchesBySerial(serial);
      if (page.skipped) {
        skipReason = page.skipReason || 'remote_skip';
        break;
      }

      flightIds = extractLaunchIds(page.launches || []);
    }
    const launchMap = await mapLaunchIdsToInternal(supabase, flightIds);
    const rows = flightIds.map((id) => ({
      ll2_launcher_id: launcherId,
      ll2_launch_uuid: id,
      launch_id: launchMap.get(id) || null
    }));

    await replaceLauncherLaunchRows(supabase, launcherId, rows);
    fetched += 1;
    joinRows += rows.length;
  }

  const nextOffset =
    skipReason ? offset : launchers.length < batchSize ? 0 : clampInt(offset + launchers.length, 0, 1_000_000_000);
  if (!skipReason && nextOffset !== offset) {
    await upsertSetting(supabase, 'll2_catalog_launcher_flights_offset', nextOffset);
  }

  return {
    fetched,
    joinRows,
    missingSerials,
    batchSize,
    offsetStart: offset,
    offsetEnd: nextOffset,
    skipReason
  };
}

async function fetchLl2AstronautDetail(astronautId: number) {
  const url = `${LL2_BASE}/astronauts/${astronautId}/?format=json&mode=detailed`;
  const res = await fetch(url, { headers: buildLl2Headers() });

  if (res.status === 404) {
    return { astronaut: null, skipped: false, skipReason: null, notFound: true };
  }
  if (res.status === 429) {
    return { astronaut: null, skipped: true, skipReason: 'remote_rate_limit', notFound: false };
  }
  if (res.status >= 500) {
    return { astronaut: null, skipped: true, skipReason: `server_${res.status}`, notFound: false };
  }
  if (!res.ok) throw new Error(`LL2 astronaut fetch failed ${res.status}`);

  const astronaut = await res.json().catch(() => null);
  return { astronaut, skipped: false, skipReason: null, notFound: false };
}

async function fetchLl2LaunchesBySerial(serialNumber: string) {
  const url = `${LL2_BASE}/launches/?format=json&limit=100&offset=0&serial_number=${encodeURIComponent(serialNumber)}`;
  const res = await fetch(url, { headers: buildLl2Headers() });

  if (res.status === 429) {
    return { launches: [] as any[], skipped: true, total: 0, skipReason: 'remote_rate_limit' };
  }
  if (res.status >= 500) {
    return { launches: [] as any[], skipped: true, total: 0, skipReason: `server_${res.status}` };
  }
  if (!res.ok) throw new Error(`LL2 launch fetch failed ${res.status}`);

  const json = await res.json().catch(() => ({}));
  return { launches: json.results as any[], skipped: false, total: json.count ?? 0, skipReason: null };
}

async function replaceAstronautLaunchRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  astronautId: number,
  rows: Array<{ ll2_astronaut_id: number; ll2_launch_uuid: string; launch_id: string | null }>
) {
  const { error: deleteError } = await supabase.from('ll2_astronaut_launches').delete().eq('ll2_astronaut_id', astronautId);
  if (deleteError) throw deleteError;
  if (!rows.length) return;
  const { error } = await supabase.from('ll2_astronaut_launches').upsert(rows, { onConflict: 'll2_astronaut_id,ll2_launch_uuid' });
  if (error) throw error;
}

async function replaceLauncherLaunchRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launcherId: number,
  rows: Array<{ ll2_launcher_id: number; ll2_launch_uuid: string; launch_id: string | null }>
) {
  const { error: deleteError } = await supabase.from('ll2_launcher_launches').delete().eq('ll2_launcher_id', launcherId);
  if (deleteError) throw deleteError;
  if (!rows.length) return;
  const { error } = await supabase.from('ll2_launcher_launches').upsert(rows, { onConflict: 'll2_launcher_id,ll2_launch_uuid' });
  if (error) throw error;
}

async function mapLaunchIdsToInternal(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  launchIds: string[]
) {
  const launchMap = new Map<string, string>();
  if (!launchIds.length) return launchMap;

  for (const chunk of chunkArray(launchIds, 200)) {
    if (!chunk.length) continue;
    const { data, error } = await supabase.from('launches').select('id, ll2_launch_uuid').in('ll2_launch_uuid', chunk);
    if (error) throw error;
    for (const row of data || []) {
      if (row.ll2_launch_uuid) launchMap.set(row.ll2_launch_uuid, row.id);
    }
  }
  return launchMap;
}

function extractLaunchIds(value: any[]): string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const item of value) {
    const id = item?.id || item?.launch_id;
    if (typeof id === 'string' && id.trim()) ids.add(id);
  }
  return [...ids];
}

function mapLocationRow(row: any, fetchedAt: string) {
  if (!row?.id || !row?.name) return null;
  const countryCode = normalizeCountryCode(row.country ?? row.country_code);

  return {
    ll2_location_id: row.id,
    name: row.name,
    country_code: countryCode,
    timezone_name: row.timezone_name || null,
    latitude: parseNumber(row.latitude) ?? undefined,
    longitude: parseNumber(row.longitude) ?? undefined,
    description: row.description || null,
    map_image: row.map_image || null,
    total_launch_count: parseNumber(row.total_launch_count),
    total_landing_count: parseNumber(row.total_landing_count),
    raw: row,
    fetched_at: fetchedAt,
    updated_at: fetchedAt
  };
}

function mapLocationCache(row: any, fetchedAt: string) {
  const countryCode = normalizeCountryCode(row.country ?? row.country_code);
  const imageUrl = row.map_image || extractImageFullUrl(row.image ?? row.image_url) || null;
  return buildCatalogCacheRow({
    entityType: 'locations',
    id: row.id,
    name: row.name || 'Location',
    description: row.description || null,
    countryCodes: countryCode ? [countryCode] : null,
    imageUrl,
    data: {
      id: row.id,
      name: row.name,
      country_code: countryCode,
      description: row.description,
      timezone_name: row.timezone_name,
      latitude: row.latitude,
      longitude: row.longitude,
      map_image: row.map_image,
      total_launch_count: row.total_launch_count,
      total_landing_count: row.total_landing_count
    },
    fetchedAt
  });
}

async function upsertLocationsFromPads(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: any[],
  fetchedAt: string
) {
  const locations = new Map<number, Record<string, unknown>>();
  for (const row of rows) {
    const loc = row?.location;
    if (!loc?.id || !loc?.name) continue;
    const countryCode = normalizeCountryCode(loc.country ?? loc.country_code);

    locations.set(loc.id, {
      ll2_location_id: loc.id,
      name: loc.name,
      country_code: countryCode,
      timezone_name: loc.timezone_name || null,
      latitude: parseNumber(loc.latitude) ?? undefined,
      longitude: parseNumber(loc.longitude) ?? undefined,
      description: loc.description || null,
      map_image: loc.map_image || null,
      total_launch_count: parseNumber(loc.total_launch_count),
      total_landing_count: parseNumber(loc.total_landing_count),
      raw: loc,
      fetched_at: fetchedAt,
      updated_at: fetchedAt
    });
  }

  if (!locations.size) return;
  await upsertCatalogTableRows(
    supabase,
    'll2_locations',
    'll2_location_id',
    [...locations.values()] as Array<Record<string, unknown>>
  );
}

function mapPadRow(row: any, fetchedAt: string) {
  const loc = row?.location || {};
  if (!row?.id || !row?.name || !loc?.id) return null;
  const countryCode = normalizeCountryCode(row.country ?? row.country_code ?? loc.country ?? loc.country_code);

  return {
    ll2_pad_id: row.id,
    ll2_location_id: loc.id,
    name: row.name,
    latitude: parseNumber(row.latitude) ?? undefined,
    longitude: parseNumber(row.longitude) ?? undefined,
    state_code: derivePadState(loc.state_code || null, loc.name || null),
    agency_id: row.agency_id ? String(row.agency_id) : null,
    description: row.description || null,
    info_url: row.info_url || null,
    wiki_url: row.wiki_url || null,
    map_url: row.map_url || null,
    map_image: row.map_image || null,
    country_code: countryCode,
    total_launch_count: parseNumber(row.total_launch_count),
    orbital_launch_attempt_count: parseNumber(row.orbital_launch_attempt_count),
    raw: row,
    fetched_at: fetchedAt,
    updated_at: fetchedAt
  };
}

function mapPadCache(row: any, fetchedAt: string) {
  const loc = row?.location || {};
  const countryCode = normalizeCountryCode(row.country ?? row.country_code ?? loc.country ?? loc.country_code);
  const imageUrl = row.map_image || extractImageFullUrl(row.image ?? row.image_url) || null;
  return buildCatalogCacheRow({
    entityType: 'pads',
    id: row.id,
    name: row.name || 'Pad',
    description: row.description || null,
    countryCodes: countryCode ? [countryCode] : null,
    imageUrl,
    data: {
      id: row.id,
      name: row.name,
      location_id: loc.id,
      location_name: loc.name,
      country_code: countryCode,
      description: row.description,
      info_url: row.info_url,
      wiki_url: row.wiki_url,
      map_url: row.map_url,
      latitude: row.latitude,
      longitude: row.longitude,
      total_launch_count: row.total_launch_count,
      orbital_launch_attempt_count: row.orbital_launch_attempt_count
    },
    fetchedAt
  });
}

function mapLauncherConfigRow(row: any, fetchedAt: string) {
  if (!row?.id) return null;
  const manufacturer = row.manufacturer || {};
  const familyName = normalizeText(extractFamilyName(row.families ?? row.family));
  const imageUrl = extractImageFullUrl(row.image ?? row.image_url);

  return {
    ll2_config_id: row.id,
    name: row.name || 'Launch Vehicle',
    full_name: row.full_name || row.name || null,
    family: familyName,
    manufacturer: manufacturer.name || null,
    manufacturer_id: typeof manufacturer.id === 'number' ? manufacturer.id : null,
    variant: row.variant || null,
    reusable: typeof row.reusable === 'boolean' ? row.reusable : null,
    image_url: imageUrl,
    info_url: row.info_url || null,
    wiki_url: row.wiki_url || null,
    raw: row,
    fetched_at: fetchedAt,
    updated_at: fetchedAt
  };
}

function mapLauncherConfigCache(row: any, fetchedAt: string) {
  const manufacturer = row.manufacturer || {};
  const countryCode = normalizeCountryCode(manufacturer.country ?? manufacturer.country_code);
  const familyName = normalizeText(extractFamilyName(row.families ?? row.family));
  const imageUrl = extractImageFullUrl(row.image ?? row.image_url);
  return buildCatalogCacheRow({
    entityType: 'launcher_configurations',
    id: row.id,
    name: row.full_name || row.name || 'Launch Vehicle',
    description: row.description || null,
    countryCodes: countryCode ? [countryCode] : null,
    imageUrl,
    data: {
      id: row.id,
      name: row.name,
      full_name: row.full_name,
      alias: row.alias,
      active: row.active,
      is_placeholder: row.is_placeholder,
      description: row.description,
      family: familyName,
      families: row.families,
      variant: row.variant,
      reusable: row.reusable,
      maiden_flight: row.maiden_flight,
      length: row.length,
      diameter: row.diameter,
      leo_capacity: row.leo_capacity,
      gto_capacity: row.gto_capacity,
      sso_capacity: row.sso_capacity,
      geo_capacity: row.geo_capacity,
      launch_mass: row.launch_mass,
      launch_cost: row.launch_cost,
      to_thrust: row.to_thrust,
      apogee: row.apogee,
      min_stage: row.min_stage,
      max_stage: row.max_stage,
      total_launch_count: row.total_launch_count,
      successful_launches: row.successful_launches,
      failed_launches: row.failed_launches,
      pending_launches: row.pending_launches,
      attempted_landings: row.attempted_landings,
      successful_landings: row.successful_landings,
      failed_landings: row.failed_landings,
      consecutive_successful_launches: row.consecutive_successful_launches,
      consecutive_successful_landings: row.consecutive_successful_landings,
      fastest_turnaround: row.fastest_turnaround,
      response_mode: row.response_mode,
      manufacturer: manufacturer?.name || null,
      manufacturer_id: manufacturer?.id || null,
      image_url: imageUrl,
      url: row.url,
      info_url: row.info_url,
      wiki_url: row.wiki_url
    },
    fetchedAt
  });
}

function mapLauncherRow(row: any, fetchedAt: string) {
  if (!row?.id) return null;
  const config = row.launcher_config || {};
  const imageUrl = extractImageFullUrl(row.image ?? row.image_url);

  return {
    ll2_launcher_id: row.id,
    serial_number: row.serial_number || null,
    flight_proven: typeof row.flight_proven === 'boolean' ? row.flight_proven : null,
    status: normalizeText(row.status?.name ?? row.status),
    details: row.details || null,
    image_url: imageUrl,
    launcher_config_id: typeof config.id === 'number' ? config.id : null,
    flights: row.flights || null,
    first_launch_date: normalizeDateOnly(row.first_launch_date),
    last_launch_date: normalizeDateOnly(row.last_launch_date),
    raw: row,
    fetched_at: fetchedAt,
    updated_at: fetchedAt
  };
}

function mapLauncherCache(row: any, fetchedAt: string) {
  const config = row.launcher_config || {};
  const name = row.serial_number || row.name || `Launcher ${row.id}`;
  const imageUrl = extractImageFullUrl(row.image ?? row.image_url);
  return buildCatalogCacheRow({
    entityType: 'launchers',
    id: row.id,
    name,
    description: row.details || null,
    countryCodes: null,
    imageUrl,
    data: {
      id: row.id,
      serial_number: row.serial_number,
      flight_proven: row.flight_proven,
      status: row.status,
      details: row.details,
      image_url: imageUrl,
      launcher_config: config,
      first_launch_date: row.first_launch_date,
      last_launch_date: row.last_launch_date
    },
    fetchedAt
  });
}

function mapSpacecraftConfigRow(row: any, fetchedAt: string) {
  if (!row?.id) return null;
  const agency = row.agency || {};
  const imageUrl = extractImageFullUrl(row.image ?? row.image_url);

  return {
    ll2_spacecraft_config_id: row.id,
    name: row.name || 'Spacecraft',
    agency_id: typeof agency.id === 'number' ? agency.id : null,
    agency_name: agency.name || null,
    in_use: typeof row.in_use === 'boolean' ? row.in_use : null,
    capability: row.capability || null,
    maiden_flight: normalizeDateOnly(row.maiden_flight),
    human_rated: typeof row.human_rated === 'boolean' ? row.human_rated : null,
    crew_capacity: parseNumber(row.crew_capacity),
    image_url: imageUrl,
    nation_url: row.nation_url || null,
    wiki_url: row.wiki_url || row.wiki_link || null,
    info_url: row.info_url || row.info_link || null,
    raw: row,
    fetched_at: fetchedAt,
    updated_at: fetchedAt
  };
}

function mapSpacecraftConfigCache(row: any, fetchedAt: string) {
  const agency = row.agency || {};
  const countryCode = normalizeCountryCode(agency.country ?? agency.country_code);
  const imageUrl = extractImageFullUrl(row.image ?? row.image_url);
  return buildCatalogCacheRow({
    entityType: 'spacecraft_configurations',
    id: row.id,
    name: row.name || 'Spacecraft',
    description: row.description || null,
    countryCodes: countryCode ? [countryCode] : null,
    imageUrl,
    data: {
      id: row.id,
      name: row.name,
      agency: agency,
      in_use: row.in_use,
      capability: row.capability,
      maiden_flight: row.maiden_flight,
      human_rated: row.human_rated,
      crew_capacity: row.crew_capacity,
      image_url: imageUrl,
      nation_url: row.nation_url,
      wiki_url: row.wiki_url || row.wiki_link,
      info_url: row.info_url || row.info_link
    },
    fetchedAt
  });
}

function mapAstronautRow(row: any, fetchedAt: string) {
  if (!row?.id) return null;
  const agency = row.agency || {};
  const astronautImage = row.image && typeof row.image === 'object' ? row.image : null;
  const profileImage =
    row.profile_image ||
    astronautImage?.image_url ||
    astronautImage?.url ||
    row.image_url ||
    row.imageUrl ||
    null;
  const profileImageThumbnail =
    row.profile_image_thumbnail ||
    astronautImage?.thumbnail_url ||
    astronautImage?.thumbnailUrl ||
    astronautImage?.image_url ||
    astronautImage?.url ||
    row.profile_image ||
    profileImage ||
    null;

  return {
    ll2_astronaut_id: row.id,
    name: row.name || 'Astronaut',
    status: normalizeText(row.status?.name ?? row.status),
    type: normalizeText(row.type?.name ?? row.type),
    agency_id: typeof agency.id === 'number' ? agency.id : null,
    agency_name: agency.name || null,
    nationality: row.nationality || null,
    in_space: typeof row.in_space === 'boolean' ? row.in_space : null,
    time_in_space: row.time_in_space || null,
    eva_time: row.eva_time || null,
    age: parseNumber(row.age),
    date_of_birth: normalizeDateOnly(row.date_of_birth),
    date_of_death: normalizeDateOnly(row.date_of_death),
    bio: row.bio || null,
    profile_image: profileImage,
    profile_image_thumbnail: profileImageThumbnail,
    twitter: row.twitter || null,
    instagram: row.instagram || null,
    wiki: row.wiki || null,
    raw: row,
    fetched_at: fetchedAt,
    updated_at: fetchedAt
  };
}

function mapAstronautCache(row: any, fetchedAt: string) {
  const agency = row.agency || {};
  const countryCode = normalizeCountryCode(agency.country ?? agency.country_code);
  const astronautImage = row.image && typeof row.image === 'object' ? row.image : null;
  const profileImage =
    row.profile_image ||
    astronautImage?.image_url ||
    astronautImage?.url ||
    row.image_url ||
    row.imageUrl ||
    null;
  const profileImageThumbnail =
    row.profile_image_thumbnail ||
    astronautImage?.thumbnail_url ||
    astronautImage?.thumbnailUrl ||
    astronautImage?.image_url ||
    astronautImage?.url ||
    row.profile_image ||
    profileImage ||
    null;
  return buildCatalogCacheRow({
    entityType: 'astronauts',
    id: row.id,
    name: row.name || 'Astronaut',
    description: row.bio || null,
    countryCodes: countryCode ? [countryCode] : null,
    imageUrl: profileImageThumbnail || profileImage,
    data: {
      id: row.id,
      name: row.name,
      status: row.status,
      type: row.type,
      agency: agency,
      nationality: row.nationality,
      in_space: row.in_space,
      time_in_space: row.time_in_space,
      eva_time: row.eva_time,
      age: row.age,
      date_of_birth: row.date_of_birth,
      date_of_death: row.date_of_death,
      bio: row.bio,
      profile_image: profileImage,
      profile_image_thumbnail: profileImageThumbnail,
      wiki: row.wiki
    },
    fetchedAt
  });
}

function mapSpaceStationRow(row: any, fetchedAt: string) {
  if (!row?.id) return null;
  const imageUrl = extractImageFullUrl(row.image ?? row.image_url);

  return {
    ll2_space_station_id: row.id,
    name: row.name || 'Space Station',
    status: normalizeText(row.status?.name ?? row.status),
    type: normalizeText(row.type?.name ?? row.type),
    founded: normalizeDateOnly(row.founded),
    deorbited: normalizeDateOnly(row.deorbited),
    description: row.description || null,
    orbit: normalizeText(row.orbit?.name ?? row.orbit),
    owners: row.owners || null,
    active_expeditions: row.active_expeditions || null,
    image_url: imageUrl,
    raw: row,
    fetched_at: fetchedAt,
    updated_at: fetchedAt
  };
}

function mapSpaceStationCache(row: any, fetchedAt: string) {
  const ownerCodes = collectCountryCodes(row.owners);
  const imageUrl = extractImageFullUrl(row.image ?? row.image_url);
  return buildCatalogCacheRow({
    entityType: 'space_stations',
    id: row.id,
    name: row.name || 'Space Station',
    description: row.description || null,
    countryCodes: ownerCodes,
    imageUrl,
    data: {
      id: row.id,
      name: row.name,
      status: row.status,
      type: row.type,
      founded: row.founded,
      deorbited: row.deorbited,
      description: row.description,
      orbit: row.orbit,
      owners: row.owners,
      active_expeditions: row.active_expeditions,
      image_url: imageUrl
    },
    fetchedAt
  });
}

function mapExpeditionRow(row: any, fetchedAt: string) {
  if (!row?.id) return null;
  const station = row.spacestation || {};

  return {
    ll2_expedition_id: row.id,
    name: row.name || 'Expedition',
    start_time: normalizeDateTime(row.start),
    end_time: normalizeDateTime(row.end),
    space_station_id: typeof station.id === 'number' ? station.id : null,
    mission_patches: row.mission_patches || null,
    spacewalks: row.spacewalks || null,
    raw: row,
    fetched_at: fetchedAt,
    updated_at: fetchedAt
  };
}

function mapExpeditionCache(row: any, fetchedAt: string) {
  const station = row.spacestation || {};
  const stationCodes = collectCountryCodes(station.owners);
  return buildCatalogCacheRow({
    entityType: 'expeditions',
    id: row.id,
    name: row.name || 'Expedition',
    description: null,
    countryCodes: stationCodes,
    imageUrl: extractImageUrl(row.mission_patches) || null,
    data: {
      id: row.id,
      name: row.name,
      start: row.start,
      end: row.end,
      space_station: station,
      mission_patches: row.mission_patches,
      spacewalks: row.spacewalks
    },
    fetchedAt
  });
}

function mapDockingEventRow(row: any, fetchedAt: string) {
  if (!row?.id) return null;
  const station = row.space_station?.station || row.space_station || {};

  return {
    ll2_docking_event_id: row.id,
    launch_id: row.launch_id || null,
    docking: normalizeDateTime(row.docking),
    departure: normalizeDateTime(row.departure),
    flight_vehicle: row.flight_vehicle || null,
    docking_location: row.docking_location || null,
    space_station_id: typeof station.id === 'number' ? station.id : null,
    space_station_name: station.name || null,
    raw: row,
    fetched_at: fetchedAt,
    updated_at: fetchedAt
  };
}

function mapDockingEventCache(row: any, fetchedAt: string) {
  const station = row.space_station?.station || row.space_station || {};
  const stationCodes = collectCountryCodes(station.owners);
  return buildCatalogCacheRow({
    entityType: 'docking_events',
    id: row.id,
    name: row.name || `Docking ${row.id}`,
    description: null,
    countryCodes: stationCodes,
    imageUrl: null,
    data: {
      id: row.id,
      launch_id: row.launch_id,
      docking: row.docking,
      departure: row.departure,
      flight_vehicle: row.flight_vehicle,
      docking_location: row.docking_location,
      space_station: station
    },
    fetchedAt
  });
}

function mapEventRow(event: any, fetchedAt: string) {
  if (!event?.id) return null;
  const type = event.type || {};
  const location = event.location || {};
  const image = event.image || {};
  const imageLicense = image?.license || {};

  return {
    ll2_event_id: event.id,
    name: event.name || 'Event',
    slug: event.slug || null,
    description: event.description || null,
    type_id: typeof type.id === 'number' ? type.id : null,
    type_name: type.name || null,
    date: normalizeDateTime(event.date),
    date_precision: event.date_precision != null ? normalizeNetPrecision(event.date_precision) : null,
    duration: event.duration || null,
    location_id: typeof location.id === 'number' ? location.id : null,
    location_name: extractLocationName(location) || (typeof event.location === 'string' ? event.location : null),
    location_country_code: normalizeCountryCode(location.country ?? location.country_code),
    webcast_live: typeof event.webcast_live === 'boolean' ? event.webcast_live : null,
    image_url: extractImageFullUrl(image),
    image_credit: image?.credit || null,
    image_license_name: imageLicense?.name || null,
    image_license_url: imageLicense?.link || imageLicense?.url || null,
    image_single_use: typeof image?.single_use === 'boolean' ? image.single_use : null,
    info_urls: event.info_urls || null,
    vid_urls: event.vid_urls || null,
    updates: event.updates || null,
    url: event.url || null,
    last_updated_source: event.last_updated || null,
    raw: event,
    fetched_at: fetchedAt,
    updated_at: fetchedAt
  };
}

function mapEventCache(event: any, fetchedAt: string) {
  const location = event.location || {};
  const locationName = extractLocationName(location) || (typeof event.location === 'string' ? event.location : null);
  const locationCode = normalizeCountryCode(location.country ?? location.country_code);

  return buildCatalogCacheRow({
    entityType: 'events',
    id: event.id,
    name: event.name || 'Event',
    slug: event.slug || null,
    description: event.description || null,
    countryCodes: locationCode ? [locationCode] : null,
    imageUrl: extractImageFullUrl(event.image),
    data: {
      id: event.id,
      name: event.name,
      slug: event.slug,
      type: event.type,
      description: event.description,
      date: event.date,
      date_precision: event.date_precision,
      duration: event.duration,
      location: locationName,
      location_country_code: locationCode,
      webcast_live: event.webcast_live,
      info_urls: event.info_urls,
      vid_urls: event.vid_urls,
      updates: event.updates,
      url: event.url
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

function collectCountryCodes(value: unknown): string[] | null {
  const out = new Set<string>();
  addCountryCodes(out, value);
  return out.size ? [...out] : null;
}

function addCountryCodes(out: Set<string>, value: unknown) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) addCountryCodes(out, item);
    return;
  }
  const code = normalizeCountryCode(value);
  if (code) out.add(code);
}

function extractLocationName(value: unknown) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const obj = value as { name?: string; location_name?: string };
    return obj.name || obj.location_name || null;
  }
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

function extractImageUrl(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = extractImageUrl(item);
      if (url) return url;
    }
    return null;
  }
  if (typeof value === 'object') {
    const obj = value as { image_url?: string; url?: string; thumbnail_url?: string };
    return obj.image_url || obj.url || obj.thumbnail_url || null;
  }
  return null;
}

function extractFamilyName(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = extractFamilyName(item);
      if (name) return name;
    }
    return null;
  }
  if (typeof value === 'object') {
    const obj = value as { name?: string; family?: string };
    return obj.name || obj.family || null;
  }
  return null;
}

function chunkArray<T>(items: T[], size: number) {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function normalizeDateTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function normalizeDateOnly(value: unknown): string | null {
  const iso = normalizeDateTime(value);
  return iso ? iso.slice(0, 10) : null;
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
