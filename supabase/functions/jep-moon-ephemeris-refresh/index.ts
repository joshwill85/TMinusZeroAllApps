import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import {
  getSettings,
  readBooleanSetting,
  readNumberSetting,
  readStringArraySetting
} from '../_shared/settings.ts';
import {
  finishJepSourceFetchRun,
  startJepSourceFetchRun,
  upsertJepSourceVersion
} from '../_shared/jepSource.ts';
import {
  buildJepV6SourceVersionKey,
  deriveJepV6ObserverFeatureCell
} from '../../../apps/web/lib/jep/v6Foundation.ts';

const HORIZONS_BASE = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const HORIZONS_SOURCE_KEY = 'jpl_horizons_moon_observer';
const USNO_BASE = 'https://aa.usno.navy.mil/api/rstt/oneday';
const USNO_SOURCE_KEY = 'usno_rstt_oneday';
const USER_AGENT = Deno.env.get('JEP_MOON_USER_AGENT') || 'TMinusZero/0.1 (support@tminuszero.app)';
const PAD_OBSERVER_HASH = 'pad';

const DEFAULTS = {
  enabled: false,
  sourceJobsEnabled: false,
  usOnlyEnabled: true,
  usLaunchStates: ['FL', 'CA', 'TX'],
  horizonsEnabled: false,
  usnoEnabled: false,
  horizonDays: 16,
  maxLaunchesPerRun: 60,
  stepSeconds: 60,
  prelaunchPaddingMinutes: 5,
  postlaunchPaddingMinutes: 20,
  maxWindowMinutes: 180
} as const;

const SETTINGS_KEYS = [
  'jep_moon_ephemeris_job_enabled',
  'jep_moon_ephemeris_horizon_days',
  'jep_moon_ephemeris_max_launches_per_run',
  'jep_moon_ephemeris_step_seconds',
  'jep_moon_ephemeris_prelaunch_padding_minutes',
  'jep_moon_ephemeris_postlaunch_padding_minutes',
  'jep_moon_ephemeris_max_window_minutes',
  'jep_v6_source_jobs_enabled',
  'jep_v6_us_only_enabled',
  'jep_v6_us_launch_states',
  'jep_source_refresh_horizons_enabled',
  'jep_source_refresh_usno_enabled'
] as const;

type LaunchRow = {
  launch_id: string;
  net: string | null;
  window_start: string | null;
  window_end: string | null;
  net_precision: string | null;
  status_name: string | null;
  status_abbrev: string | null;
  pad_latitude: number | null;
  pad_longitude: number | null;
  pad_state: string | null;
  pad_country_code: string | null;
  cache_generated_at: string | null;
};

type MoonEphemerisUpsertRow = {
  launch_id: string;
  observer_location_hash: string;
  observer_feature_key: string;
  observer_lat_bucket: number | null;
  observer_lon_bucket: number | null;
  observer_elev_m: number | null;
  sample_at: string;
  sample_offset_sec: number;
  source_key: string;
  source_version_id: number | null;
  source_fetch_run_id: number | null;
  qa_source_key: string | null;
  qa_version_id: number | null;
  qa_fetch_run_id: number | null;
  moon_az_deg: number | null;
  moon_el_deg: number | null;
  moon_illum_frac: number | null;
  moon_phase_name: string | null;
  moon_phase_angle_deg: number | null;
  moonrise_utc: string | null;
  moonset_utc: string | null;
  metadata: Record<string, unknown>;
  confidence_payload: Record<string, unknown>;
  updated_at: string;
};

type HorizonsSample = {
  sampleAtIso: string;
  moonAzDeg: number | null;
  moonElDeg: number | null;
  apparentMagnitude: number | null;
  surfaceBrightness: number | null;
  rawVisibilityCode: string | null;
};

type HorizonsSeriesResult = {
  requestUrl: string;
  rawBody: string;
  apiVersion: string | null;
  samples: HorizonsSample[];
};

type UsnoQaResult = {
  requestUrl: string;
  rawBody: string;
  apiVersion: string | null;
  illumFrac: number | null;
  phaseName: string | null;
  moonriseUtc: string | null;
  moonsetUtc: string | null;
  metadata: Record<string, unknown>;
};

type SampleWindow = {
  startIso: string;
  stopIso: string;
  startMs: number;
  stopMs: number;
};

serve(async (req) => {
  const startedAt = Date.now();
  let supabase: ReturnType<typeof createSupabaseAdminClient>;

  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    return jsonResponse({ ok: false, stage: 'init', error: stringifyError(err) }, 500);
  }

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const force = Boolean(body?.force);
  const triggerMode = force ? 'manual' : 'scheduled';
  const { runId } = await startIngestionRun(supabase, 'jep_moon_ephemeris_refresh');

  const stats: Record<string, unknown> = {
    sourceJobsEnabled: DEFAULTS.sourceJobsEnabled,
    usOnlyEnabled: DEFAULTS.usOnlyEnabled,
    usLaunchStates: DEFAULTS.usLaunchStates,
    horizonsEnabled: DEFAULTS.horizonsEnabled,
    usnoEnabled: DEFAULTS.usnoEnabled,
    horizonDays: DEFAULTS.horizonDays,
    maxLaunchesPerRun: DEFAULTS.maxLaunchesPerRun,
    stepSeconds: DEFAULTS.stepSeconds,
    prelaunchPaddingMinutes: DEFAULTS.prelaunchPaddingMinutes,
    postlaunchPaddingMinutes: DEFAULTS.postlaunchPaddingMinutes,
    maxWindowMinutes: DEFAULTS.maxWindowMinutes,
    candidatesLoaded: 0,
    candidatesEligible: 0,
    launchesComputed: 0,
    launchesSkippedNonUs: 0,
    launchesSkippedNoWindow: 0,
    horizonsFetches: 0,
    usnoFetches: 0,
    rowsUpserted: 0,
    errors: [] as Array<Record<string, unknown>>
  };

  try {
    const settings = await getSettings(supabase, [...SETTINGS_KEYS]);
    const enabled = readBooleanSetting(settings.jep_moon_ephemeris_job_enabled, DEFAULTS.enabled);
    const sourceJobsEnabled = readBooleanSetting(settings.jep_v6_source_jobs_enabled, DEFAULTS.sourceJobsEnabled);
    const usOnlyEnabled = readBooleanSetting(settings.jep_v6_us_only_enabled, DEFAULTS.usOnlyEnabled);
    const usLaunchStates = normalizeStates(
      readStringArraySetting(settings.jep_v6_us_launch_states, [...DEFAULTS.usLaunchStates]),
      [...DEFAULTS.usLaunchStates]
    );
    const horizonsEnabled = readBooleanSetting(settings.jep_source_refresh_horizons_enabled, DEFAULTS.horizonsEnabled) || force;
    const usnoEnabled = readBooleanSetting(settings.jep_source_refresh_usno_enabled, DEFAULTS.usnoEnabled) || force;

    stats.sourceJobsEnabled = sourceJobsEnabled;
    stats.usOnlyEnabled = usOnlyEnabled;
    stats.usLaunchStates = usLaunchStates;
    stats.horizonsEnabled = horizonsEnabled;
    stats.usnoEnabled = usnoEnabled;

    if (!enabled && !force) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }
    if (!sourceJobsEnabled && !force) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'source_jobs_disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'source_jobs_disabled', elapsedMs: Date.now() - startedAt });
    }
    if (!horizonsEnabled) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'horizons_disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'horizons_disabled', elapsedMs: Date.now() - startedAt });
    }

    const horizonDays = clampInt(readNumberSetting(settings.jep_moon_ephemeris_horizon_days, DEFAULTS.horizonDays), 1, 30);
    const maxLaunchesPerRun = clampInt(
      readNumberSetting(settings.jep_moon_ephemeris_max_launches_per_run, DEFAULTS.maxLaunchesPerRun),
      1,
      200
    );
    const stepSeconds = clampInt(readNumberSetting(settings.jep_moon_ephemeris_step_seconds, DEFAULTS.stepSeconds), 60, 3600);
    const prelaunchPaddingMinutes = clampInt(
      readNumberSetting(settings.jep_moon_ephemeris_prelaunch_padding_minutes, DEFAULTS.prelaunchPaddingMinutes),
      0,
      60
    );
    const postlaunchPaddingMinutes = clampInt(
      readNumberSetting(settings.jep_moon_ephemeris_postlaunch_padding_minutes, DEFAULTS.postlaunchPaddingMinutes),
      1,
      120
    );
    const maxWindowMinutes = clampInt(
      readNumberSetting(settings.jep_moon_ephemeris_max_window_minutes, DEFAULTS.maxWindowMinutes),
      1,
      720
    );

    stats.horizonDays = horizonDays;
    stats.maxLaunchesPerRun = maxLaunchesPerRun;
    stats.stepSeconds = stepSeconds;
    stats.prelaunchPaddingMinutes = prelaunchPaddingMinutes;
    stats.postlaunchPaddingMinutes = postlaunchPaddingMinutes;
    stats.maxWindowMinutes = maxWindowMinutes;

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const horizonIso = new Date(nowMs + horizonDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: launchesRaw, error: launchesError } = await supabase
      .from('launches_public_cache')
      .select(
        'launch_id, net, window_start, window_end, net_precision, status_name, status_abbrev, pad_latitude, pad_longitude, pad_state, pad_country_code, cache_generated_at'
      )
      .gte('net', nowIso)
      .lte('net', horizonIso)
      .order('net', { ascending: true })
      .limit(maxLaunchesPerRun * 3);

    if (launchesError) throw launchesError;
    stats.candidatesLoaded = (launchesRaw || []).length;

    const launches = ((launchesRaw || []) as LaunchRow[])
      .filter((row) => isLaunchEligible(row))
      .filter((row) => {
        if (!usOnlyEnabled) return true;
        const matches = isUsLaunch(row, usLaunchStates);
        if (!matches) stats.launchesSkippedNonUs = Number(stats.launchesSkippedNonUs || 0) + 1;
        return matches;
      })
      .slice(0, maxLaunchesPerRun);

    stats.candidatesEligible = launches.length;

    if (!launches.length) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'no_candidates' });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_candidates', elapsedMs: Date.now() - startedAt });
    }

    const upserts: MoonEphemerisUpsertRow[] = [];
    const usnoCache = new Map<string, { result: UsnoQaResult; versionId: number | null; fetchRunId: number | null } | null>();

    for (const launch of launches) {
      const padLat = toFiniteNumber(launch.pad_latitude);
      const padLon = toFiniteNumber(launch.pad_longitude);
      if (padLat == null || padLon == null) continue;

      const sampleWindow = deriveSampleWindow({
        launch,
        prelaunchPaddingMinutes,
        postlaunchPaddingMinutes,
        maxWindowMinutes
      });
      if (!sampleWindow) {
        stats.launchesSkippedNoWindow = Number(stats.launchesSkippedNoWindow || 0) + 1;
        continue;
      }

      const featureCell = deriveJepV6ObserverFeatureCell(padLat, padLon);
      const observerFeatureKey = featureCell?.key ?? PAD_OBSERVER_HASH;
      const observerLatBucket = featureCell?.latCell ?? null;
      const observerLonBucket = featureCell?.lonCell ?? null;
      const horizonsRequestUrl = buildHorizonsRequestUrl({
        latDeg: padLat,
        lonDeg: padLon,
        startIso: sampleWindow.startIso,
        stopIso: sampleWindow.stopIso,
        stepSeconds
      });

      let horizonsFetchRunId: number | null = null;
      let horizonsVersionId: number | null = null;
      let horizonsResult: HorizonsSeriesResult | null = null;

      try {
        const startRun = await startJepSourceFetchRun(supabase, {
          sourceKey: HORIZONS_SOURCE_KEY,
          triggerMode,
          requestRef: horizonsRequestUrl,
          metadata: {
            launchId: launch.launch_id,
            observerLocationHash: PAD_OBSERVER_HASH,
            sampleStart: sampleWindow.startIso,
            sampleStop: sampleWindow.stopIso,
            stepSeconds
          }
        });
        horizonsFetchRunId = startRun.runId;

        horizonsResult = await fetchHorizonsMoonSeries(horizonsRequestUrl);
        stats.horizonsFetches = Number(stats.horizonsFetches || 0) + 1;

        const horizonsContentHash = await sha256Hex(horizonsResult.rawBody);
        horizonsVersionId = await upsertJepSourceVersion(supabase, {
          sourceKey: HORIZONS_SOURCE_KEY,
          versionKey: buildJepV6SourceVersionKey({
            sourceKey: HORIZONS_SOURCE_KEY,
            externalVersion: horizonsResult.apiVersion,
            contentHash: horizonsContentHash,
            requestUrl: horizonsResult.requestUrl
          }),
          versionLabel: horizonsResult.apiVersion,
          upstreamUrl: horizonsResult.requestUrl,
          contentHash: horizonsContentHash,
          fetchedAt: new Date().toISOString(),
          metadata: {
            sampleStart: sampleWindow.startIso,
            sampleStop: sampleWindow.stopIso,
            stepSeconds,
            sampleCount: horizonsResult.samples.length
          }
        });

        await finishJepSourceFetchRun(supabase, horizonsFetchRunId, {
          status: 'succeeded',
          versionId: horizonsVersionId,
          assetCount: 1,
          rowCount: horizonsResult.samples.length,
          metadata: {
            launchId: launch.launch_id,
            observerLocationHash: PAD_OBSERVER_HASH,
            sampleStart: sampleWindow.startIso,
            sampleStop: sampleWindow.stopIso,
            stepSeconds,
            apiVersion: horizonsResult.apiVersion
          }
        });
      } catch (err) {
        const message = stringifyError(err);
        await finishJepSourceFetchRun(supabase, horizonsFetchRunId, {
          status: 'failed',
          versionId: horizonsVersionId,
          errorText: message,
          metadata: {
            launchId: launch.launch_id,
            observerLocationHash: PAD_OBSERVER_HASH,
            sampleStart: sampleWindow.startIso,
            sampleStop: sampleWindow.stopIso
          }
        });
        (stats.errors as Array<Record<string, unknown>>).push({ launchId: launch.launch_id, source: HORIZONS_SOURCE_KEY, error: message });
        continue;
      }

      if (!horizonsResult?.samples.length) continue;

      let qaByDate = new Map<string, { result: UsnoQaResult; versionId: number | null; fetchRunId: number | null } | null>();
      if (usnoEnabled) {
        const dates = enumerateUtcDates(sampleWindow.startMs, sampleWindow.stopMs);
        for (const dateIso of dates) {
          const cacheKey = `${padLat.toFixed(4)}:${padLon.toFixed(4)}:${dateIso}`;
          let cached = usnoCache.get(cacheKey);
          if (cached === undefined) {
            cached = await fetchUsnoQaWithProvenance({
              supabase,
              triggerMode,
              latDeg: padLat,
              lonDeg: padLon,
              dateIso,
              launchId: launch.launch_id
            });
            if (cached?.result) stats.usnoFetches = Number(stats.usnoFetches || 0) + 1;
            usnoCache.set(cacheKey, cached ?? null);
          }
          qaByDate.set(dateIso, cached ?? null);
        }
      }

      for (const sample of horizonsResult.samples) {
        const sampleAtMs = Date.parse(sample.sampleAtIso);
        if (!Number.isFinite(sampleAtMs)) continue;
        const sampleDateIso = sample.sampleAtIso.slice(0, 10);
        const qa = qaByDate.get(sampleDateIso) ?? null;
        const sampleOffsetSec = deriveSampleOffsetSec(sampleAtMs, launch.net, sampleWindow.startMs);
        upserts.push({
          launch_id: launch.launch_id,
          observer_location_hash: PAD_OBSERVER_HASH,
          observer_feature_key: observerFeatureKey,
          observer_lat_bucket: observerLatBucket,
          observer_lon_bucket: observerLonBucket,
          observer_elev_m: null,
          sample_at: sample.sampleAtIso,
          sample_offset_sec: sampleOffsetSec,
          source_key: HORIZONS_SOURCE_KEY,
          source_version_id: horizonsVersionId,
          source_fetch_run_id: horizonsFetchRunId,
          qa_source_key: qa?.result ? USNO_SOURCE_KEY : null,
          qa_version_id: qa?.versionId ?? null,
          qa_fetch_run_id: qa?.fetchRunId ?? null,
          moon_az_deg: sample.moonAzDeg,
          moon_el_deg: sample.moonElDeg,
          moon_illum_frac: qa?.result.illumFrac ?? null,
          moon_phase_name: qa?.result.phaseName ?? null,
          moon_phase_angle_deg: null,
          moonrise_utc: qa?.result.moonriseUtc ?? null,
          moonset_utc: qa?.result.moonsetUtc ?? null,
          metadata: {
            requestWindow: {
              start: sampleWindow.startIso,
              stop: sampleWindow.stopIso,
              stepSeconds
            },
            launch: {
              net: launch.net,
              windowStart: launch.window_start,
              windowEnd: launch.window_end,
              netPrecision: launch.net_precision,
              cacheGeneratedAt: launch.cache_generated_at
            },
            horizons: {
              apiVersion: horizonsResult.apiVersion,
              rawVisibilityCode: sample.rawVisibilityCode,
              apparentMagnitude: sample.apparentMagnitude,
              surfaceBrightness: sample.surfaceBrightness
            },
            usno: qa?.result
              ? {
                  apiVersion: qa.result.apiVersion,
                  requestedDateUtc: sampleDateIso,
                  closestPhase: qa.result.metadata.closestPhase ?? null
                }
              : null
          },
          confidence_payload: {
            primarySource: HORIZONS_SOURCE_KEY,
            qaSource: qa?.result ? USNO_SOURCE_KEY : null,
            hasMoonPosition: sample.moonAzDeg != null && sample.moonElDeg != null,
            hasMoonIllumination: qa?.result.illumFrac != null,
            hasMoonRiseSet: Boolean(qa?.result.moonriseUtc || qa?.result.moonsetUtc)
          },
          updated_at: new Date().toISOString()
        });
      }

      stats.launchesComputed = Number(stats.launchesComputed || 0) + 1;
    }

    if (upserts.length) {
      const { error: upsertError } = await supabase
        .from('jep_moon_ephemerides')
        .upsert(upserts, { onConflict: 'launch_id,observer_location_hash,sample_at' });
      if (upsertError) throw upsertError;
    }

    stats.rowsUpserted = upserts.length;
    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});

async function fetchUsnoQaWithProvenance({
  supabase,
  triggerMode,
  latDeg,
  lonDeg,
  dateIso,
  launchId
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  triggerMode: 'scheduled' | 'manual';
  latDeg: number;
  lonDeg: number;
  dateIso: string;
  launchId: string;
}) {
  const requestUrl = buildUsnoRequestUrl({ latDeg, lonDeg, dateIso });
  let fetchRunId: number | null = null;
  let versionId: number | null = null;
  try {
    const startRun = await startJepSourceFetchRun(supabase, {
      sourceKey: USNO_SOURCE_KEY,
      triggerMode,
      requestRef: requestUrl,
      metadata: {
        launchId,
        observerLocationHash: PAD_OBSERVER_HASH,
        requestedDateUtc: dateIso
      }
    });
    fetchRunId = startRun.runId;
    const result = await fetchUsnoMoonQa(requestUrl, dateIso);
    const contentHash = await sha256Hex(result.rawBody);
    versionId = await upsertJepSourceVersion(supabase, {
      sourceKey: USNO_SOURCE_KEY,
      versionKey: buildJepV6SourceVersionKey({
        sourceKey: USNO_SOURCE_KEY,
        externalVersion: result.apiVersion,
        contentHash,
        requestUrl
      }),
      versionLabel: result.apiVersion,
      upstreamUrl: requestUrl,
      contentHash,
      fetchedAt: new Date().toISOString(),
      metadata: {
        requestedDateUtc: dateIso,
        phaseName: result.phaseName,
        moonriseUtc: result.moonriseUtc,
        moonsetUtc: result.moonsetUtc
      }
    });
    await finishJepSourceFetchRun(supabase, fetchRunId, {
      status: 'succeeded',
      versionId,
      assetCount: 1,
      rowCount: 1,
      metadata: {
        launchId,
        observerLocationHash: PAD_OBSERVER_HASH,
        requestedDateUtc: dateIso,
        apiVersion: result.apiVersion
      }
    });
    return { result, versionId, fetchRunId };
  } catch (err) {
    await finishJepSourceFetchRun(supabase, fetchRunId, {
      status: 'failed',
      versionId,
      errorText: stringifyError(err),
      metadata: {
        launchId,
        observerLocationHash: PAD_OBSERVER_HASH,
        requestedDateUtc: dateIso
      }
    });
    return null;
  }
}

async function fetchHorizonsMoonSeries(requestUrl: string): Promise<HorizonsSeriesResult> {
  const res = await fetch(requestUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT
    }
  });
  if (!res.ok) throw new Error(`Horizons request failed: ${res.status} ${res.statusText}`);

  const payload = await res.json();
  if (payload?.error) throw new Error(`Horizons response error: ${String(payload.error)}`);

  const resultText = typeof payload?.result === 'string' ? payload.result : '';
  if (!resultText.trim()) throw new Error('Horizons response missing result payload');

  return {
    requestUrl,
    rawBody: JSON.stringify(payload),
    apiVersion: normalizeString(payload?.signature?.version) || extractHorizonsApiVersion(resultText),
    samples: parseHorizonsSamples(resultText)
  };
}

async function fetchUsnoMoonQa(requestUrl: string, dateIso: string): Promise<UsnoQaResult> {
  const res = await fetch(requestUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT
    }
  });
  if (!res.ok) throw new Error(`USNO request failed: ${res.status} ${res.statusText}`);

  const payload = await res.json();
  const data = payload?.properties?.data ?? {};

  return {
    requestUrl,
    rawBody: JSON.stringify(payload),
    apiVersion: normalizeString(payload?.apiversion),
    illumFrac: parsePercentString(data?.fracillum),
    phaseName: normalizeString(data?.curphase),
    moonriseUtc: extractUsnoPhenomenonTime(data?.moondata, 'Rise', dateIso),
    moonsetUtc: extractUsnoPhenomenonTime(data?.moondata, 'Set', dateIso),
    metadata: {
      closestPhase: data?.closestphase ?? null,
      moondata: Array.isArray(data?.moondata) ? data.moondata : [],
      sundata: Array.isArray(data?.sundata) ? data.sundata : []
    }
  };
}

function parseHorizonsSamples(resultText: string) {
  const lines = resultText.split('\n');
  const startIndex = lines.findIndex((line) => line.trim() === '$$SOE');
  const endIndex = lines.findIndex((line) => line.trim() === '$$EOE');
  if (startIndex < 0 || endIndex <= startIndex) return [] as HorizonsSample[];

  const samples: HorizonsSample[] = [];
  for (const rawLine of lines.slice(startIndex + 1, endIndex)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(',').map((part) => part.trim());
    if (parts.length < 6) continue;
    const sampleAtIso = parseHorizonsTimestamp(parts[0]);
    if (!sampleAtIso) continue;
    samples.push({
      sampleAtIso,
      rawVisibilityCode: parts[1] || null,
      moonAzDeg: toFiniteNumber(parts[3]),
      moonElDeg: toFiniteNumber(parts[4]),
      apparentMagnitude: toFiniteNumber(parts[5]),
      surfaceBrightness: toFiniteNumber(parts[6])
    });
  }
  return samples;
}

function deriveSampleWindow({
  launch,
  prelaunchPaddingMinutes,
  postlaunchPaddingMinutes,
  maxWindowMinutes
}: {
  launch: LaunchRow;
  prelaunchPaddingMinutes: number;
  postlaunchPaddingMinutes: number;
  maxWindowMinutes: number;
}): SampleWindow | null {
  const netMs = Date.parse(String(launch.net || ''));
  const windowStartMs = Date.parse(String(launch.window_start || ''));
  const windowEndMs = Date.parse(String(launch.window_end || ''));

  const baseStartMs = Number.isFinite(windowStartMs) ? windowStartMs : netMs;
  if (!Number.isFinite(baseStartMs)) return null;

  let baseStopMs = Number.isFinite(windowEndMs) ? windowEndMs : netMs;
  if (!Number.isFinite(baseStopMs) || baseStopMs < baseStartMs) baseStopMs = baseStartMs;

  const clampedStopMs = Math.min(baseStopMs, baseStartMs + maxWindowMinutes * 60 * 1000);
  const startMs = baseStartMs - prelaunchPaddingMinutes * 60 * 1000;
  const stopMs = clampedStopMs + postlaunchPaddingMinutes * 60 * 1000;
  if (!(stopMs > startMs)) return null;

  return {
    startIso: new Date(startMs).toISOString(),
    stopIso: new Date(stopMs).toISOString(),
    startMs,
    stopMs
  };
}

function buildHorizonsRequestUrl({
  latDeg,
  lonDeg,
  startIso,
  stopIso,
  stepSeconds
}: {
  latDeg: number;
  lonDeg: number;
  startIso: string;
  stopIso: string;
  stepSeconds: number;
}) {
  const params = new URLSearchParams();
  params.set('format', 'json');
  params.set('COMMAND', "'301'");
  params.set('EPHEM_TYPE', "'OBSERVER'");
  params.set('CENTER', "'coord@399'");
  params.set('SITE_COORD', `'${lonDeg.toFixed(4)},${latDeg.toFixed(4)},0'`);
  params.set('START_TIME', `'${formatHorizonsTimestamp(startIso)}'`);
  params.set('STOP_TIME', `'${formatHorizonsTimestamp(stopIso)}'`);
  params.set('STEP_SIZE', `'${Math.max(1, Math.trunc(stepSeconds / 60))}m'`);
  params.set('QUANTITIES', "'4,9'");
  params.set('CSV_FORMAT', "'YES'");
  return `${HORIZONS_BASE}?${params.toString()}`;
}

function buildUsnoRequestUrl({ latDeg, lonDeg, dateIso }: { latDeg: number; lonDeg: number; dateIso: string }) {
  const params = new URLSearchParams();
  params.set('date', dateIso);
  params.set('coords', `${latDeg.toFixed(4)},${lonDeg.toFixed(4)}`);
  params.set('tz', '0');
  return `${USNO_BASE}?${params.toString()}`;
}

function extractUsnoPhenomenonTime(entries: unknown, phenomenon: string, dateIso: string) {
  if (!Array.isArray(entries)) return null;
  const match = entries.find((item) => normalizeString((item as Record<string, unknown>)?.phen)?.toLowerCase() === phenomenon.toLowerCase());
  const timeText = normalizeString((match as Record<string, unknown> | undefined)?.time);
  if (!timeText || timeText.includes('*')) return null;
  return parseUsnoClockTime(dateIso, timeText);
}

function parseUsnoClockTime(dateIso: string, timeText: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeText.trim());
  if (!match) return null;
  const [, hourText, minuteText] = match;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return new Date(`${dateIso}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`).toISOString();
}

function deriveSampleOffsetSec(sampleAtMs: number, netIso: string | null, fallbackStartMs: number) {
  const netMs = Date.parse(String(netIso || ''));
  if (Number.isFinite(netMs)) return Math.round((sampleAtMs - netMs) / 1000);
  return Math.round((sampleAtMs - fallbackStartMs) / 1000);
}

function parseHorizonsTimestamp(value: string) {
  const match = /^(\d{4})-([A-Za-z]{3})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(value.trim());
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '00'] = match;
  const month = MONTH_INDEX[monthText.toLowerCase()];
  if (!month) return null;
  const wholeSeconds = secondText.includes('.') ? Number(secondText) : Number(`${secondText}.0`);
  if (!Number.isFinite(wholeSeconds)) return null;
  const second = Math.trunc(wholeSeconds);
  const millis = Math.round((wholeSeconds - second) * 1000);
  return new Date(Date.UTC(Number(yearText), month - 1, Number(dayText), Number(hourText), Number(minuteText), second, millis)).toISOString();
}

function formatHorizonsTimestamp(iso: string) {
  const value = new Date(iso);
  const year = value.getUTCFullYear();
  const month = MONTH_NAMES[value.getUTCMonth()];
  const day = String(value.getUTCDate()).padStart(2, '0');
  const hour = String(value.getUTCHours()).padStart(2, '0');
  const minute = String(value.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function extractHorizonsApiVersion(resultText: string) {
  const match = /API VERSION\s*:\s*([^\n]+)/i.exec(resultText);
  return match?.[1]?.trim() || null;
}

function isLaunchEligible(row: LaunchRow) {
  if (!row.launch_id) return false;
  if (toFiniteNumber(row.pad_latitude) == null || toFiniteNumber(row.pad_longitude) == null) return false;
  const netMs = Date.parse(String(row.net || ''));
  if (!Number.isFinite(netMs)) return false;
  const status = `${row.status_name || ''} ${row.status_abbrev || ''}`.toLowerCase();
  if (status.includes('cancel') || status.includes('failure') || status.includes('success')) return false;
  return true;
}

function isUsLaunch(row: LaunchRow, allowedStates: string[]) {
  const countryCode = normalizeString(row.pad_country_code)?.toUpperCase() || '';
  if (!countryCode || !US_COUNTRY_CODES.has(countryCode)) return false;
  const stateCode = normalizeState(row.pad_state);
  if (!allowedStates.length) return true;
  return !!stateCode && allowedStates.includes(stateCode);
}

function normalizeStates(values: string[], fallback: string[]) {
  const normalized = values.map((value) => normalizeState(value)).filter((value): value is string => Boolean(value));
  return normalized.length ? [...new Set(normalized)] : fallback;
}

function normalizeState(value: string | null | undefined) {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (normalized === 'FLORIDA') return 'FL';
  if (normalized === 'CALIFORNIA') return 'CA';
  if (normalized === 'TEXAS') return 'TX';
  return normalized || null;
}

function parsePercentString(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = /(-?\d+(?:\.\d+)?)\s*%/.exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return null;
  return clamp(parsed / 100, 0, 1);
}

function enumerateUtcDates(startMs: number, stopMs: number) {
  const dates: string[] = [];
  const current = new Date(startMs);
  current.setUTCHours(0, 0, 0, 0);
  const end = new Date(stopMs);
  end.setUTCHours(0, 0, 0, 0);

  while (current.getTime() <= end.getTime()) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function startIngestionRun(supabase: ReturnType<typeof createSupabaseAdminClient>, jobName: string) {
  const { data, error } = await supabase.from('ingestion_runs').insert({ job_name: jobName }).select('id').single();
  if (error) {
    console.warn('Failed to start ingestion_runs record', { jobName, error: error?.message });
    return { runId: null as string | null };
  }
  return { runId: data?.id ? String(data.id) : null };
}

async function finishIngestionRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: string | null,
  success: boolean,
  stats?: Record<string, unknown>,
  message?: string
) {
  if (!runId) return;
  const update = {
    finished_at: new Date().toISOString(),
    success,
    stats: stats || {},
    error_message: message || null
  };
  const { error } = await supabase.from('ingestion_runs').update(update).eq('id', runId);
  if (error) {
    console.warn('Failed to update ingestion_runs record', { runId, error: error.message });
  }
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

function stringifyError(value: unknown) {
  if (value instanceof Error) return value.message;
  return String(value);
}

function toFiniteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function normalizeString(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const US_COUNTRY_CODES = new Set(['US', 'USA']);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
};
