import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { normalizeNetPrecision } from '../_shared/ll2.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readNumberSetting } from '../_shared/settings.ts';

const NWS_BASE = 'https://api.weather.gov';
const NWS_USER_AGENT = Deno.env.get('NWS_USER_AGENT') || 'TMinusZero/0.1 (support@tminuszero.app)';

const DEFAULTS = {
  horizonDays: 14,
  pointsCacheHours: 24,
  maxLaunchesPerRun: 80
};

type LaunchRow = {
  id: string;
  ll2_launch_uuid: string;
  name: string;
  net: string | null;
  net_precision: string | null;
  window_start: string | null;
  window_end: string | null;
  pad_latitude: number | null;
  pad_longitude: number | null;
  ll2_pad_id: number | null;
  pad_country_code: string | null;
};

type NwsPointRow = {
  id: string;
  coord_key: string;
  ll2_pad_id: number | null;
  latitude: number;
  longitude: number;
  cwa: string | null;
  grid_id: string;
  grid_x: number;
  grid_y: number;
  forecast_url: string;
  forecast_hourly_url: string;
  forecast_grid_data_url: string | null;
  time_zone: string | null;
  county_url: string | null;
  forecast_zone_url: string | null;
  raw: unknown;
  fetched_at: string;
  updated_at: string;
};

serve(async (req) => {
  const startedAt = Date.now();
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const stats: Record<string, unknown> = {
    horizonDays: DEFAULTS.horizonDays,
    pointsCacheHours: DEFAULTS.pointsCacheHours,
    maxLaunchesPerRun: DEFAULTS.maxLaunchesPerRun,
    launchesConsidered: 0,
    launchesSkipped: 0,
    launchesUpdated: 0,
    pointsCacheHits: 0,
    pointsFetched: 0,
    pointsUpserted: 0,
    forecastFetches: 0,
    forecastMatches: 0,
    forecastMisses: 0,
    errors: [] as Array<{ step: string; error: string; context?: Record<string, unknown> }>
  };

  const { runId } = await startIngestionRun(supabase, 'nws_refresh');

  try {
    const settings = await getSettings(supabase, [
      'nws_horizon_days',
      'nws_points_cache_hours',
      'nws_max_launches_per_run'
    ]);

    const horizonDays = clampInt(readNumberSetting(settings.nws_horizon_days, DEFAULTS.horizonDays), 1, 14);
    const pointsCacheHours = clampInt(readNumberSetting(settings.nws_points_cache_hours, DEFAULTS.pointsCacheHours), 1, 168);
    const maxLaunchesPerRun = clampInt(
      readNumberSetting(settings.nws_max_launches_per_run, DEFAULTS.maxLaunchesPerRun),
      1,
      500
    );

    stats.horizonDays = horizonDays;
    stats.pointsCacheHours = pointsCacheHours;
    stats.maxLaunchesPerRun = maxLaunchesPerRun;

    const now = new Date();
    const nowIso = now.toISOString();
    const horizonIso = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000).toISOString();

    const launches = await loadCandidateLaunches(supabase, { nowIso, horizonIso, limit: maxLaunchesPerRun });
    stats.launchesConsidered = launches.length;

    const candidates = launches
      .map((l) => ({ launch: l, ...extractForecastTarget(l) }))
      .filter((l) => l.targetMs != null && l.lat != null && l.lon != null) as Array<{
      launch: LaunchRow;
      targetMs: number;
      targetIso: string;
      lat: number;
      lon: number;
      coordKey: string;
    }>;

    stats.launchesSkipped = launches.length - candidates.length;

    const pointsByPadId = new Map<number, NwsPointRow>();
    const pointsByCoordKey = new Map<string, NwsPointRow>();

    const padIds = [...new Set(candidates.map((c) => c.launch.ll2_pad_id).filter((v): v is number => Number.isFinite(v)))];
    const coordKeys = [...new Set(candidates.map((c) => c.coordKey).filter(Boolean))];

    if (padIds.length) {
      const { data, error } = await supabase.from('nws_points').select('*').in('ll2_pad_id', padIds);
      if (error) throw error;
      for (const row of (data || []) as NwsPointRow[]) {
        if (row.ll2_pad_id != null) pointsByPadId.set(row.ll2_pad_id, row);
        if (row.coord_key) pointsByCoordKey.set(row.coord_key, row);
      }
    }
    if (coordKeys.length) {
      const missingCoordKeys = coordKeys.filter((k) => !pointsByCoordKey.has(k));
      if (missingCoordKeys.length) {
        const { data, error } = await supabase.from('nws_points').select('*').in('coord_key', missingCoordKeys);
        if (error) throw error;
        for (const row of (data || []) as NwsPointRow[]) {
          if (row.ll2_pad_id != null) pointsByPadId.set(row.ll2_pad_id, row);
          if (row.coord_key) pointsByCoordKey.set(row.coord_key, row);
        }
      }
    }

    const pointsStaleBefore = new Date(Date.now() - pointsCacheHours * 60 * 60 * 1000).toISOString();

    const requiredPoints: Array<{ ll2PadId: number | null; coordKey: string; lat: number; lon: number }> = [];
    for (const c of candidates) {
      const existing =
        (c.launch.ll2_pad_id != null ? pointsByPadId.get(c.launch.ll2_pad_id) : null) || pointsByCoordKey.get(c.coordKey) || null;

      if (!existing) {
        requiredPoints.push({ ll2PadId: c.launch.ll2_pad_id, coordKey: c.coordKey, lat: c.lat, lon: c.lon });
        continue;
      }

      const fetchedAtMs = Date.parse(existing.fetched_at);
      if (!Number.isFinite(fetchedAtMs) || existing.fetched_at < pointsStaleBefore) {
        requiredPoints.push({ ll2PadId: c.launch.ll2_pad_id, coordKey: c.coordKey, lat: c.lat, lon: c.lon });
      } else {
        stats.pointsCacheHits = (stats.pointsCacheHits as number) + 1;
      }
    }

    const uniquePointKeys = new Set<string>();
    const pointsToFetch = requiredPoints.filter((p) => {
      const key = p.ll2PadId != null ? `pad:${p.ll2PadId}` : `coord:${p.coordKey}`;
      if (uniquePointKeys.has(key)) return false;
      uniquePointKeys.add(key);
      return true;
    });

    for (const p of pointsToFetch) {
      try {
        const points = await fetchNwsPoints(p.lat, p.lon);
        stats.pointsFetched = (stats.pointsFetched as number) + 1;
        const upsertPayload = {
          coord_key: p.coordKey,
          ll2_pad_id: p.ll2PadId,
          latitude: p.lat,
          longitude: p.lon,
          cwa: points.cwa,
          grid_id: points.gridId,
          grid_x: points.gridX,
          grid_y: points.gridY,
          forecast_url: points.forecast,
          forecast_hourly_url: points.forecastHourly,
          forecast_grid_data_url: points.forecastGridData,
          time_zone: points.timeZone,
          county_url: points.county,
          forecast_zone_url: points.forecastZone,
          raw: points.raw,
          fetched_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const existingByPad = p.ll2PadId != null ? pointsByPadId.get(p.ll2PadId) : null;
        const { data, error } = existingByPad
          ? await supabase.from('nws_points').update(upsertPayload).eq('id', existingByPad.id).select('*').maybeSingle()
          : await supabase.from('nws_points').upsert(upsertPayload, { onConflict: 'coord_key' }).select('*').maybeSingle();

        if (error) throw error;
        if (data) {
          stats.pointsUpserted = (stats.pointsUpserted as number) + 1;
          const row = data as unknown as NwsPointRow;
          if (row.ll2_pad_id != null) pointsByPadId.set(row.ll2_pad_id, row);
          pointsByCoordKey.set(row.coord_key, row);
        }
      } catch (err) {
        (stats.errors as Array<any>).push({
          step: 'points_fetch',
          error: stringifyError(err),
          context: { ll2PadId: p.ll2PadId, coordKey: p.coordKey, lat: p.lat, lon: p.lon }
        });
      }
    }

    // Fetch forecasts (per unique gridpoint).
    type ForecastBundle = {
      forecast: NwsForecastResponse | null;
      hourly: NwsForecastResponse | null;
      point: NwsPointRow;
    };
    const forecastByGridKey = new Map<string, ForecastBundle>();
    const uniquePointRows = [...new Set(candidates.map((c) => resolvePoint(pointsByPadId, pointsByCoordKey, c.launch.ll2_pad_id, c.coordKey)).filter(Boolean))] as NwsPointRow[];

    for (const point of uniquePointRows) {
      const gridKey = `${point.grid_id}:${point.grid_x},${point.grid_y}`;
      if (forecastByGridKey.has(gridKey)) continue;

      const bundle: ForecastBundle = { forecast: null, hourly: null, point };
      forecastByGridKey.set(gridKey, bundle);

      try {
        bundle.forecast = await fetchForecast(point.forecast_url);
        stats.forecastFetches = (stats.forecastFetches as number) + 1;
      } catch (err) {
        (stats.errors as Array<any>).push({
          step: 'forecast_fetch',
          error: stringifyError(err),
          context: { gridKey, url: point.forecast_url }
        });
      }

      try {
        bundle.hourly = await fetchForecast(point.forecast_hourly_url);
        stats.forecastFetches = (stats.forecastFetches as number) + 1;
      } catch (err) {
        (stats.errors as Array<any>).push({
          step: 'forecast_hourly_fetch',
          error: stringifyError(err),
          context: { gridKey, url: point.forecast_hourly_url }
        });
      }
    }

    const weatherUpserts: any[] = [];
    const iconUpdateTimestamp = new Date().toISOString();
    const launchIconUpdates: Array<{
      id: string;
      ll2_launch_uuid: string;
      name: string;
      weather_icon_url: string | null;
      updated_at: string;
    }> = [];

    for (const c of candidates) {
      const point = resolvePoint(pointsByPadId, pointsByCoordKey, c.launch.ll2_pad_id, c.coordKey);
      if (!point) continue;
      const gridKey = `${point.grid_id}:${point.grid_x},${point.grid_y}`;
      const bundle = forecastByGridKey.get(gridKey);
      if (!bundle) continue;

      const match = matchForecastForTime({
        targetMs: c.targetMs,
        forecast: bundle.forecast,
        hourly: bundle.hourly
      });

      if (!match) {
        stats.forecastMisses = (stats.forecastMisses as number) + 1;
        continue;
      }

      stats.forecastMatches = (stats.forecastMatches as number) + 1;

      const issuedAt = match.generatedAt || match.updateTime || null;
      const probability = toPrecipProbability(match.period?.probabilityOfPrecipitation);
      const summary = typeof match.period?.shortForecast === 'string' ? match.period.shortForecast : null;
      const icon = typeof match.period?.icon === 'string' ? match.period.icon : null;

      weatherUpserts.push({
        launch_id: c.launch.id,
        source: 'nws',
        issued_at: issuedAt,
        valid_start: match.period?.startTime || null,
        valid_end: match.period?.endTime || null,
        summary,
        probability,
        data: {
          provider: 'nws',
          forecastKind: match.kind,
          grid: { gridId: point.grid_id, gridX: point.grid_x, gridY: point.grid_y, cwa: point.cwa || null },
          point: { latitude: point.latitude, longitude: point.longitude, timeZone: point.time_zone || null },
          generatedAt: match.generatedAt,
          updateTime: match.updateTime,
          period: match.period
        }
      });

      // Only show icons for launches with a specific time (countdown eligible).
      const cardIcon = icon ? forceIconSize(icon, 'small') : null;
      launchIconUpdates.push({
        id: c.launch.id,
        ll2_launch_uuid: c.launch.ll2_launch_uuid,
        name: c.launch.name,
        weather_icon_url: cardIcon,
        updated_at: iconUpdateTimestamp
      });
    }

    if (weatherUpserts.length) {
      const { error } = await supabase.from('launch_weather').upsert(weatherUpserts, { onConflict: 'launch_id,source' });
      if (error) throw error;
    }

    if (launchIconUpdates.length) {
      const { error } = await supabase.from('launches').upsert(launchIconUpdates, { onConflict: 'id' });
      if (error) throw error;
      stats.launchesUpdated = launchIconUpdates.length;
    }

    const ok = (stats.errors as Array<any>).length === 0;
    await finishIngestionRun(supabase, runId, ok, stats, ok ? undefined : 'partial_failure');
    return jsonResponse({ ok, elapsedMs: Date.now() - startedAt, stats }, ok ? 200 : 207);
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });
    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, elapsedMs: Date.now() - startedAt, error: message, stats }, 500);
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

async function loadCandidateLaunches(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  { nowIso, horizonIso, limit }: { nowIso: string; horizonIso: string; limit: number }
) {
  // NWS coverage is (primarily) USA; skip non-USA pads to avoid noisy 404s.
  // Note: LL2 can emit ISO3 ("USA") or ISO2 ("US") country codes.
  const { data, error } = await supabase
    .from('launches')
    .select(
      'id, ll2_launch_uuid, name, net, net_precision, window_start, window_end, pad_latitude, pad_longitude, ll2_pad_id, pad_country_code'
    )
    .eq('hidden', false)
    .gte('net', nowIso)
    .lt('net', horizonIso)
    .in('pad_country_code', ['USA', 'US'])
    .order('net', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data || []) as LaunchRow[];
}

function extractForecastTarget(launch: LaunchRow) {
  const lat = typeof launch.pad_latitude === 'number' ? launch.pad_latitude : null;
  const lon = typeof launch.pad_longitude === 'number' ? launch.pad_longitude : null;

  // Only forecast for launches with a specific T-0 time (aligns with card behavior).
  const precision = normalizeNetPrecision(launch.net_precision);
  const precisionEligible = precision === 'minute' || precision === 'hour';

  const netIso = isValidIso(launch.net) ? (launch.net as string) : null;
  const windowIso = isValidIso(launch.window_start) ? (launch.window_start as string) : null;
  const netMs = netIso ? Date.parse(netIso) : NaN;
  const windowMs = windowIso ? Date.parse(windowIso) : NaN;
  const netSpecific = isSpecificTime(netMs);
  const windowSpecific = isSpecificTime(windowMs);

  const coordKey = lat != null && lon != null ? toCoordKey(lat, lon) : '';
  if (!precisionEligible) {
    return { targetMs: null as number | null, targetIso: null as string | null, lat, lon, coordKey };
  }

  const targetIso = netSpecific ? netIso : windowSpecific ? windowIso : null;
  const targetMs = netSpecific ? netMs : windowSpecific ? windowMs : NaN;

  if (!targetIso || !Number.isFinite(targetMs)) {
    return { targetMs: null as number | null, targetIso: null as string | null, lat, lon, coordKey };
  }

  return { targetMs, targetIso: targetIso as string, lat, lon, coordKey };
}

function isSpecificTime(ms: number) {
  if (!Number.isFinite(ms)) return false;
  // Heuristic: LL2 often encodes TBD as midnight; treat as non-specific.
  const d = new Date(ms);
  return !(d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0);
}

function resolvePoint(
  pointsByPadId: Map<number, NwsPointRow>,
  pointsByCoordKey: Map<string, NwsPointRow>,
  ll2PadId: number | null,
  coordKey: string
) {
  if (ll2PadId != null) {
    const byPad = pointsByPadId.get(ll2PadId);
    if (byPad) return byPad;
  }
  return pointsByCoordKey.get(coordKey) || null;
}

async function fetchNwsPoints(lat: number, lon: number) {
  const url = `${NWS_BASE}/points/${lat},${lon}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': NWS_USER_AGENT,
      accept: 'application/geo+json'
    }
  });
  if (!res.ok) throw new Error(`nws_points_${res.status}`);
  const json = await res.json();
  const props = json?.properties || {};
  const gridId = String(props.gridId || props.gridID || '').trim();
  const gridX = Number(props.gridX);
  const gridY = Number(props.gridY);
  const forecast = String(props.forecast || '').trim();
  const forecastHourly = String(props.forecastHourly || '').trim();
  const forecastGridData = String(props.forecastGridData || '').trim();
  const timeZone = typeof props.timeZone === 'string' ? props.timeZone : null;
  const cwa = typeof props.cwa === 'string' ? props.cwa : null;
  const county = typeof props.county === 'string' ? props.county : null;
  const forecastZone = typeof props.forecastZone === 'string' ? props.forecastZone : null;

  if (!gridId || !Number.isFinite(gridX) || !Number.isFinite(gridY) || !forecast || !forecastHourly) {
    throw new Error('nws_points_missing_fields');
  }

  return {
    gridId,
    gridX: Math.trunc(gridX),
    gridY: Math.trunc(gridY),
    forecast,
    forecastHourly,
    forecastGridData: forecastGridData || null,
    timeZone,
    cwa,
    county,
    forecastZone,
    raw: json
  };
}

type NwsForecastResponse = {
  properties?: {
    generatedAt?: string;
    updateTime?: string;
    periods?: any[];
  };
};

async function fetchForecast(url: string): Promise<NwsForecastResponse> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': NWS_USER_AGENT,
      accept: 'application/geo+json'
    }
  });
  if (!res.ok) throw new Error(`nws_forecast_${res.status}`);
  return (await res.json()) as NwsForecastResponse;
}

function matchForecastForTime({
  targetMs,
  forecast,
  hourly
}: {
  targetMs: number;
  forecast: NwsForecastResponse | null;
  hourly: NwsForecastResponse | null;
}): { kind: 'hourly' | 'forecast'; generatedAt: string | null; updateTime: string | null; period: any } | null {
  const hourlyPeriods = Array.isArray(hourly?.properties?.periods) ? (hourly!.properties!.periods as any[]) : [];
  const forecastPeriods = Array.isArray(forecast?.properties?.periods) ? (forecast!.properties!.periods as any[]) : [];

  const hourlyMatch = pickPeriodForTime(hourlyPeriods, targetMs);
  if (hourlyMatch) {
    return {
      kind: 'hourly',
      generatedAt: normalizeIso(hourly?.properties?.generatedAt) || null,
      updateTime: normalizeIso(hourly?.properties?.updateTime) || null,
      period: hourlyMatch
    };
  }

  const forecastMatch = pickPeriodForTime(forecastPeriods, targetMs);
  if (forecastMatch) {
    return {
      kind: 'forecast',
      generatedAt: normalizeIso(forecast?.properties?.generatedAt) || null,
      updateTime: normalizeIso(forecast?.properties?.updateTime) || null,
      period: forecastMatch
    };
  }

  return null;
}

function pickPeriodForTime(periods: any[], targetMs: number) {
  if (!periods.length) return null;
  let first: any = null;
  let last: any = null;
  let bestFuture: any = null;
  let bestFutureStart = Number.POSITIVE_INFINITY;

  for (const p of periods) {
    const startMs = Date.parse(String(p?.startTime || ''));
    const endMs = Date.parse(String(p?.endTime || ''));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (!first || startMs < Date.parse(String(first.startTime || ''))) first = p;
    if (!last || endMs > Date.parse(String(last.endTime || ''))) last = p;
    if (targetMs >= startMs && targetMs < endMs) return p;
    if (startMs >= targetMs && startMs < bestFutureStart) {
      bestFutureStart = startMs;
      bestFuture = p;
    }
  }

  // Outside range; pick closest sensible default.
  if (bestFuture) return bestFuture;
  return last || first || null;
}

function toPrecipProbability(value: any): number | null {
  const raw = value?.value;
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const pct = clampInt(Math.round(n), 0, 100);
  return pct;
}

function forceIconSize(iconUrl: string, size: 'small' | 'medium' | 'large') {
  try {
    const u = new URL(iconUrl);
    u.searchParams.set('size', size);
    return u.toString();
  } catch {
    return iconUrl;
  }
}

function normalizeIso(value: unknown) {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function isValidIso(value: unknown) {
  if (typeof value !== 'string') return false;
  return Number.isFinite(Date.parse(value));
}

function toCoordKey(lat: number, lon: number) {
  const latFixed = normalizeCoord(lat).toFixed(4);
  const lonFixed = normalizeCoord(lon).toFixed(4);
  return `${latFixed},${lonFixed}`;
}

function normalizeCoord(value: number) {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 10_000) / 10_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
