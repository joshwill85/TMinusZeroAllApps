import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import {
  getSettings,
  readBooleanSetting,
  readNumberSetting,
  readStringArraySetting,
  readStringSetting
} from '../_shared/settings.ts';
import {
  finishJepSourceFetchRun,
  startJepSourceFetchRun,
  upsertJepSourceVersion
} from '../_shared/jepSource.ts';
import {
  BLACK_MARBLE_COLLECTION_ID,
  type ResolvedBlackMarbleFile,
  type BlackMarblePeriod,
  type BlackMarbleProductKey,
  type BlackMarbleTileAddress,
  deriveBlackMarblePeriod,
  deriveBlackMarbleTileAddress,
  isBlackMarbleLandMask,
  resolveBlackMarbleFileFromContents
} from '../_shared/jepBlackMarble.ts';
import {
  buildJepV6SourceVersionKey,
  deriveJepV6ObserverFeatureCell
} from '../../../apps/web/lib/jep/v6Foundation.ts';
import { computeJepV6AnthropogenicFactor } from '../../../apps/web/lib/jep/v6Background.ts';

const BLACK_MARBLE_USER_AGENT =
  Deno.env.get('JEP_BLACK_MARBLE_USER_AGENT') || 'TMinusZero/0.1 (support@tminuszero.app)';
const BLACK_MARBLE_DOWNLOAD_TOKEN = Deno.env.get('JEP_BLACK_MARBLE_DOWNLOAD_TOKEN') || '';
const DATA_ROOT = '/HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields';
const DATASET_BUNDLES = [
  {
    name: 'NearNadir_Composite_Snow_Free',
    radiancePath: `${DATA_ROOT}/NearNadir_Composite_Snow_Free`,
    qualityPath: `${DATA_ROOT}/NearNadir_Composite_Snow_Free_Quality`,
    observationCountPath: `${DATA_ROOT}/NearNadir_Composite_Snow_Free_Num`,
    stddevPath: `${DATA_ROOT}/NearNadir_Composite_Snow_Free_Std`
  },
  {
    name: 'AllAngle_Composite_Snow_Free',
    radiancePath: `${DATA_ROOT}/AllAngle_Composite_Snow_Free`,
    qualityPath: `${DATA_ROOT}/AllAngle_Composite_Snow_Free_Quality`,
    observationCountPath: `${DATA_ROOT}/AllAngle_Composite_Snow_Free_Num`,
    stddevPath: `${DATA_ROOT}/AllAngle_Composite_Snow_Free_Std`
  }
] as const;
const LAND_WATER_MASK_PATH = `${DATA_ROOT}/Land_Water_Mask`;

const DEFAULTS = {
  enabled: false,
  sourceJobsEnabled: false,
  usOnlyEnabled: true,
  usLaunchStates: ['FL', 'CA', 'TX'],
  backgroundSourceEnabled: false,
  horizonDays: 45,
  maxCellsPerRun: 96,
  normalizationScope: 'tile_land'
} as const;

const SETTINGS_KEYS = [
  'jep_background_light_job_enabled',
  'jep_background_light_horizon_days',
  'jep_background_light_max_cells_per_run',
  'jep_background_light_normalization_scope',
  'jep_v6_source_jobs_enabled',
  'jep_v6_us_only_enabled',
  'jep_v6_us_launch_states',
  'jep_source_refresh_black_marble_enabled'
] as const;

type LaunchRow = {
  launch_id: string;
  net: string | null;
  pad_latitude: number | null;
  pad_longitude: number | null;
  pad_state: string | null;
  pad_country_code: string | null;
};

type ExistingBackgroundRow = {
  observer_feature_key: string;
  source_version_id: number | null;
  confidence_payload: Record<string, unknown> | null;
};

type BackgroundCellUpsertRow = {
  observer_feature_key: string;
  observer_lat_bucket: number | null;
  observer_lon_bucket: number | null;
  source_key: string;
  source_version_id: number | null;
  source_fetch_run_id: number | null;
  product_key: BlackMarbleProductKey;
  period_start_date: string;
  period_end_date: string;
  tile_h: number;
  tile_v: number;
  tile_row_index: number;
  tile_col_index: number;
  radiance_dataset: string | null;
  radiance_nw_cm2_sr: number | null;
  radiance_log: number | null;
  radiance_stddev_nw_cm2_sr: number | null;
  radiance_observation_count: number | null;
  quality_code: number | null;
  land_water_code: number | null;
  normalization_scope: string;
  normalization_version: string;
  radiance_percentile: number | null;
  s_anthro: number | null;
  metadata: Record<string, unknown>;
  confidence_payload: Record<string, unknown>;
  updated_at: string;
};

type CellTarget = {
  targetKey: string;
  observerFeatureKey: string;
  observerLatBucket: number;
  observerLonBucket: number;
  featureCellDeg: number;
  launchIds: string[];
  period: BlackMarblePeriod;
  tile: BlackMarbleTileAddress;
};

type TileDatasetBundle = {
  name: string;
  radiance: ArrayLike<number>;
  quality: ArrayLike<number>;
  observationCount: ArrayLike<number>;
  stddev: ArrayLike<number>;
};

type EvaluatedTarget = {
  target: CellTarget;
  bundleName: string | null;
  radiance: number | null;
  radianceLog: number | null;
  stddev: number | null;
  observationCount: number | null;
  qualityCode: number | null;
  landWaterCode: number | null;
  percentile: number | null;
  sAnthro: number | null;
  availability: string;
};

type TileMaterializationResult = {
  rows: BackgroundCellUpsertRow[];
  availableTargetKeys: Set<string>;
};

type H5Module = {
  ready: Promise<{ FS: { writeFile(path: string, data: Uint8Array): void; unlink(path: string): void } }>;
  File: new (filename: string, mode: string) => {
    get(path: string): { value: ArrayLike<number> | null | undefined } | null;
    close?: () => void;
  };
};

const blackMarbleYearsCache = new Map<BlackMarbleProductKey, Promise<number[]>>();
const blackMarbleDirectoryDaysCache = new Map<string, Promise<number[]>>();

type JepBackgroundLightSettingsOverrides = Partial<{
  enabled: boolean;
  sourceJobsEnabled: boolean;
  usOnlyEnabled: boolean;
  usLaunchStates: string[];
  backgroundSourceEnabled: boolean;
  horizonDays: number;
  maxCellsPerRun: number;
  normalizationScope: string;
}>;

export type RunJepBackgroundLightRefreshOptions = {
  supabase?: ReturnType<typeof createSupabaseAdminClient>;
  force?: boolean;
  runner?: 'edge' | 'batch';
  triggerMode?: 'scheduled' | 'manual' | 'backfill' | 'retry';
  settingsOverrides?: JepBackgroundLightSettingsOverrides;
};

export type RunJepBackgroundLightRefreshResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  elapsedMs: number;
  stats: Record<string, unknown>;
};

export async function runJepBackgroundLightRefresh(
  options: RunJepBackgroundLightRefreshOptions = {}
): Promise<RunJepBackgroundLightRefreshResult> {
  const startedAt = Date.now();
  const supabase = options.supabase ?? createSupabaseAdminClient();
  const force = Boolean(options.force);
  const runner = options.runner || 'edge';
  const triggerMode = options.triggerMode || (runner === 'batch' ? 'manual' : 'scheduled');
  const settingsOverrides = options.settingsOverrides || {};
  const { runId } = await startIngestionRun(supabase, 'jep_background_light_refresh');

  const stats: Record<string, unknown> = {
    runner,
    triggerMode,
    sourceJobsEnabled: DEFAULTS.sourceJobsEnabled,
    usOnlyEnabled: DEFAULTS.usOnlyEnabled,
    usLaunchStates: DEFAULTS.usLaunchStates,
    backgroundSourceEnabled: DEFAULTS.backgroundSourceEnabled,
    normalizationScope: DEFAULTS.normalizationScope,
    tokenConfigured: Boolean(BLACK_MARBLE_DOWNLOAD_TOKEN),
    horizonDays: DEFAULTS.horizonDays,
    maxCellsPerRun: DEFAULTS.maxCellsPerRun,
    candidatesLoaded: 0,
    launchesEligible: 0,
    uniqueMonthlyTargets: 0,
    uniqueYearlyTargets: 0,
    monthlyResolved: 0,
    monthlyMissing: 0,
    yearlyResolved: 0,
    yearlyMissing: 0,
    fallbackTargets: 0,
    cellsSkippedFresh: 0,
    sourceVersionsResolved: 0,
    sourceFetches: 0,
    rowsUpserted: 0,
    tilesMaterialized: 0,
    errors: [] as Array<Record<string, unknown>>
  };

  try {
    const settings = await getSettings(supabase, [...SETTINGS_KEYS]);
    const enabled =
      typeof settingsOverrides.enabled === 'boolean'
        ? settingsOverrides.enabled
        : readBooleanSetting(settings.jep_background_light_job_enabled, DEFAULTS.enabled);
    const sourceJobsEnabled =
      typeof settingsOverrides.sourceJobsEnabled === 'boolean'
        ? settingsOverrides.sourceJobsEnabled
        : readBooleanSetting(settings.jep_v6_source_jobs_enabled, DEFAULTS.sourceJobsEnabled);
    const usOnlyEnabled =
      typeof settingsOverrides.usOnlyEnabled === 'boolean'
        ? settingsOverrides.usOnlyEnabled
        : readBooleanSetting(settings.jep_v6_us_only_enabled, DEFAULTS.usOnlyEnabled);
    const usLaunchStates = normalizeStates(
      settingsOverrides.usLaunchStates ?? readStringArraySetting(settings.jep_v6_us_launch_states, [...DEFAULTS.usLaunchStates]),
      [...DEFAULTS.usLaunchStates]
    );
    const backgroundSourceEnabled =
      typeof settingsOverrides.backgroundSourceEnabled === 'boolean'
        ? settingsOverrides.backgroundSourceEnabled
        : readBooleanSetting(settings.jep_source_refresh_black_marble_enabled, DEFAULTS.backgroundSourceEnabled) || force;
    const horizonDays = clampInt(
      settingsOverrides.horizonDays ?? readNumberSetting(settings.jep_background_light_horizon_days, DEFAULTS.horizonDays),
      1,
      365
    );
    const maxCellsPerRun = clampInt(
      settingsOverrides.maxCellsPerRun ?? readNumberSetting(settings.jep_background_light_max_cells_per_run, DEFAULTS.maxCellsPerRun),
      1,
      500
    );
    const normalizationScope =
      (settingsOverrides.normalizationScope ??
        readStringSetting(settings.jep_background_light_normalization_scope, DEFAULTS.normalizationScope))
        .trim() || DEFAULTS.normalizationScope;

    stats.sourceJobsEnabled = sourceJobsEnabled;
    stats.usOnlyEnabled = usOnlyEnabled;
    stats.usLaunchStates = usLaunchStates;
    stats.backgroundSourceEnabled = backgroundSourceEnabled;
    stats.horizonDays = horizonDays;
    stats.maxCellsPerRun = maxCellsPerRun;
    stats.normalizationScope = normalizationScope;

    if (!enabled && !force) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'disabled' });
      return { ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt, stats };
    }
    if (!sourceJobsEnabled && !force) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'source_jobs_disabled' });
      return { ok: true, skipped: true, reason: 'source_jobs_disabled', elapsedMs: Date.now() - startedAt, stats };
    }
    if (!backgroundSourceEnabled) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'black_marble_disabled' });
      return { ok: true, skipped: true, reason: 'black_marble_disabled', elapsedMs: Date.now() - startedAt, stats };
    }
    if (!BLACK_MARBLE_DOWNLOAD_TOKEN) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'download_token_missing' });
      return { ok: true, skipped: true, reason: 'download_token_missing', elapsedMs: Date.now() - startedAt, stats };
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const horizonIso = new Date(nowMs + horizonDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: launchesRaw, error: launchesError } = await supabase
      .from('launches_public_cache')
      .select('launch_id, net, pad_latitude, pad_longitude, pad_state, pad_country_code')
      .gte('net', nowIso)
      .lte('net', horizonIso)
      .order('net', { ascending: true })
      .limit(maxCellsPerRun * 6);

    if (launchesError) throw launchesError;
    stats.candidatesLoaded = (launchesRaw || []).length;

    const launches = ((launchesRaw || []) as LaunchRow[])
      .filter((launch) => isLaunchEligible(launch))
      .filter((launch) => (usOnlyEnabled ? isUsLaunch(launch, usLaunchStates) : true));
    stats.launchesEligible = launches.length;

    if (!launches.length) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'no_candidates' });
      return { ok: true, skipped: true, reason: 'no_candidates', elapsedMs: Date.now() - startedAt, stats };
    }

    const monthlyTargets = buildMonthlyTargets(launches, maxCellsPerRun);
    stats.uniqueMonthlyTargets = monthlyTargets.length;

    if (!monthlyTargets.length) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'no_targets' });
      return { ok: true, skipped: true, reason: 'no_targets', elapsedMs: Date.now() - startedAt, stats };
    }

    const { availableTargetKeys: monthlyAvailable, rows: monthlyRows } = await materializeTargets({
      supabase,
      targets: monthlyTargets,
      normalizationScope,
      stats,
      triggerMode
    });

    const yearlyTargets = buildYearlyFallbackTargets(monthlyTargets, monthlyAvailable, maxCellsPerRun);
    stats.uniqueYearlyTargets = yearlyTargets.length;
    stats.fallbackTargets = yearlyTargets.length;

    const { rows: yearlyRows } = yearlyTargets.length
      ? await materializeTargets({
          supabase,
          targets: yearlyTargets,
          normalizationScope,
          stats,
          triggerMode
        })
      : { rows: [] as BackgroundCellUpsertRow[] };

    const upserts = [...monthlyRows, ...yearlyRows];
    if (upserts.length) {
      const { error: upsertError } = await supabase
        .from('jep_background_light_cells')
        .upsert(upserts, { onConflict: 'observer_feature_key,source_key,period_start_date' });
      if (upsertError) throw upsertError;
    }

    stats.rowsUpserted = upserts.length;
    await finishIngestionRun(supabase, runId, true, stats);
    return { ok: true, elapsedMs: Date.now() - startedAt, stats };
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, stats, message);
    return { ok: false, error: message, elapsedMs: Date.now() - startedAt, stats };
  }
}

async function handleJepBackgroundLightRefreshRequest(req: Request) {
  let supabase: ReturnType<typeof createSupabaseAdminClient>;

  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    return jsonResponse({ ok: false, stage: 'init', error: stringifyError(err) }, 500);
  }

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const result = await runJepBackgroundLightRefresh({
    supabase,
    force: Boolean(body?.force),
    runner: 'edge',
    triggerMode: 'scheduled'
  });
  return jsonResponse(result, result.ok ? 200 : 500);
}

if (import.meta.main) {
  serve(handleJepBackgroundLightRefreshRequest);
}

async function materializeTargets({
  supabase,
  targets,
  normalizationScope,
  stats,
  triggerMode
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  targets: CellTarget[];
  normalizationScope: string;
  stats: Record<string, unknown>;
  triggerMode: 'scheduled' | 'manual' | 'backfill' | 'retry';
}) {
  const rows: BackgroundCellUpsertRow[] = [];
  const availableTargetKeys = new Set<string>();
  const grouped = groupTargetsByTile(targets);

  for (const group of grouped.values()) {
    const first = group[0];
    if (!first) continue;

    let fetchRunId: number | null = null;
    let versionId: number | null = null;
    try {
      const publishedPeriod = await resolvePublishedBlackMarblePeriod(first.period);
      if (!publishedPeriod) {
        if (first.period.productKey === 'VNP46A3') {
          stats.monthlyMissing = Number(stats.monthlyMissing || 0) + group.length;
        } else {
          stats.yearlyMissing = Number(stats.yearlyMissing || 0) + group.length;
        }
        continue;
      }

      const contentsHtml = await fetchText(resolveBlackMarbleContentsUrl(publishedPeriod), true);
      const resolvedFile = resolveBlackMarbleFileFromContents({
        productKey: first.period.productKey,
        period: publishedPeriod,
        tileH: first.tile.tileH,
        tileV: first.tile.tileV,
        contentsHtml
      });

      if (!resolvedFile) {
        if (first.period.productKey === 'VNP46A3') {
          stats.monthlyMissing = Number(stats.monthlyMissing || 0) + group.length;
        } else {
          stats.yearlyMissing = Number(stats.yearlyMissing || 0) + group.length;
        }
        continue;
      }

      if (first.period.productKey === 'VNP46A3') {
        stats.monthlyResolved = Number(stats.monthlyResolved || 0) + group.length;
      } else {
        stats.yearlyResolved = Number(stats.yearlyResolved || 0) + group.length;
      }

      const releaseAt = parseBlackMarbleReleaseAt(resolvedFile.filename);
      versionId = await upsertJepSourceVersion(supabase, {
        sourceKey: resolvedFile.sourceKey,
        versionKey: buildJepV6SourceVersionKey({
          sourceKey: resolvedFile.sourceKey,
          externalVersion: resolvedFile.filename,
          requestUrl: resolvedFile.archiveUrl
        }),
        versionLabel: resolvedFile.filename,
        upstreamUrl: resolvedFile.archiveUrl,
        releaseAt,
        fetchedAt: new Date().toISOString(),
        metadata: {
          productKey: resolvedFile.productKey,
          directoryYear: resolvedFile.directoryYear,
          directoryDoy: resolvedFile.directoryDoy,
          tileH: resolvedFile.tileH,
          tileV: resolvedFile.tileV,
          ddsUrl: resolvedFile.ddsUrl,
          dmrHtmlUrl: resolvedFile.dmrHtmlUrl
        }
      });
      stats.sourceVersionsResolved = Number(stats.sourceVersionsResolved || 0) + 1;

      const existingByFeatureKey = await loadExistingRowsForTargets(
        supabase,
        group,
        resolvedFile.sourceKey,
        publishedPeriod.periodStartDate
      );
      const pendingTargets: CellTarget[] = [];
      for (const target of group) {
        const existing = existingByFeatureKey.get(target.observerFeatureKey);
        const availability = readAvailability(existing?.confidence_payload);
        if (existing && existing.source_version_id === versionId) {
          if (availability === 'ok') {
            availableTargetKeys.add(target.targetKey);
            stats.cellsSkippedFresh = Number(stats.cellsSkippedFresh || 0) + 1;
            continue;
          }
        }
        pendingTargets.push(target);
      }

      if (!pendingTargets.length) continue;

      const materializedTargets = pendingTargets.map((target) =>
        target.period.periodStartDate === publishedPeriod.periodStartDate &&
        target.period.productKey === publishedPeriod.productKey
          ? target
          : {
              ...target,
              period: publishedPeriod
            }
      );

      const sourceRun = await startJepSourceFetchRun(supabase, {
        sourceKey: resolvedFile.sourceKey,
        triggerMode,
        requestRef: resolvedFile.archiveUrl,
        metadata: {
          productKey: resolvedFile.productKey,
          periodStartDate: publishedPeriod.periodStartDate,
          tileH: resolvedFile.tileH,
          tileV: resolvedFile.tileV,
          targetCount: materializedTargets.length
        }
      });
      fetchRunId = sourceRun.runId;

      const fileBytes = await fetchBinary(resolvedFile.archiveUrl);
      stats.sourceFetches = Number(stats.sourceFetches || 0) + 1;

      const materialized = await materializeTileRows({
        targets: materializedTargets,
        resolvedFile,
        sourceVersionId: versionId,
        sourceFetchRunId: fetchRunId,
        normalizationScope,
        fileBytes
      });

      rows.push(...materialized.rows);
      for (const key of materialized.availableTargetKeys) {
        availableTargetKeys.add(key);
      }
      stats.tilesMaterialized = Number(stats.tilesMaterialized || 0) + 1;

      await finishJepSourceFetchRun(supabase, fetchRunId, {
        status: 'succeeded',
        versionId,
        assetCount: 1,
        rowCount: materialized.rows.length,
        metadata: {
          filename: resolvedFile.filename,
          tileH: resolvedFile.tileH,
          tileV: resolvedFile.tileV,
          targetCount: materializedTargets.length
        }
      });
      fetchRunId = null;
    } catch (err) {
      (stats.errors as Array<Record<string, unknown>>).push({
        sourceKey: first.period.sourceKey,
        periodStartDate: first.period.periodStartDate,
        tileH: first.tile.tileH,
        tileV: first.tile.tileV,
        error: stringifyError(err)
      });
      if (fetchRunId != null) {
        await finishJepSourceFetchRun(supabase, fetchRunId, {
          status: 'failed',
          versionId,
          errorText: stringifyError(err),
          metadata: {
            periodStartDate: first.period.periodStartDate,
            tileH: first.tile.tileH,
            tileV: first.tile.tileV
          }
        });
      }
    }
  }

  return { rows, availableTargetKeys };
}

async function materializeTileRows({
  targets,
  resolvedFile,
  sourceVersionId,
  sourceFetchRunId,
  normalizationScope,
  fileBytes
}: {
  targets: CellTarget[];
  resolvedFile: ResolvedBlackMarbleFile;
  sourceVersionId: number;
  sourceFetchRunId: number | null;
  normalizationScope: string;
  fileBytes: Uint8Array;
}): Promise<TileMaterializationResult> {
  const module = await loadH5Module();
  const ready = await module.ready;
  const filename = `black-marble-${crypto.randomUUID()}.h5`;
  ready.FS.writeFile(filename, fileBytes);

  let file: InstanceType<H5Module['File']> | null = null;

  try {
    file = new module.File(filename, 'r');
    const landMask = readDatasetValues(file, LAND_WATER_MASK_PATH);
    const bundles = DATASET_BUNDLES.map<TileDatasetBundle>((bundle) => ({
      name: bundle.name,
      radiance: readDatasetValues(file!, bundle.radiancePath),
      quality: readDatasetValues(file!, bundle.qualityPath),
      observationCount: readDatasetValues(file!, bundle.observationCountPath),
      stddev: readDatasetValues(file!, bundle.stddevPath)
    }));

    const evaluated = targets.map((target) => evaluateTarget(target, bundles, landMask));
    const percentilesByTarget = computePercentilesByBundle(evaluated, bundles, landMask);
    const nowIso = new Date().toISOString();
    const rows: BackgroundCellUpsertRow[] = [];
    const availableTargetKeys = new Set<string>();

    for (const item of evaluated) {
      const percentile = percentilesByTarget.get(item.target.targetKey) ?? null;
      const sAnthro = computeJepV6AnthropogenicFactor({ radiancePercentile: percentile }).factor;
      const availability =
        item.availability === 'ok' && percentile == null ? 'missing_tile_distribution' : item.availability;
      const row: BackgroundCellUpsertRow = {
        observer_feature_key: item.target.observerFeatureKey,
        observer_lat_bucket: item.target.observerLatBucket,
        observer_lon_bucket: item.target.observerLonBucket,
        source_key: resolvedFile.sourceKey,
        source_version_id: sourceVersionId,
        source_fetch_run_id: sourceFetchRunId,
        product_key: resolvedFile.productKey,
        period_start_date: item.target.period.periodStartDate,
        period_end_date: item.target.period.periodEndDate,
        tile_h: item.target.tile.tileH,
        tile_v: item.target.tile.tileV,
        tile_row_index: item.target.tile.rowIndex,
        tile_col_index: item.target.tile.colIndex,
        radiance_dataset: item.bundleName,
        radiance_nw_cm2_sr: item.radiance,
        radiance_log: item.radianceLog,
        radiance_stddev_nw_cm2_sr: item.stddev,
        radiance_observation_count: item.observationCount,
        quality_code: item.qualityCode,
        land_water_code: item.landWaterCode,
        normalization_scope: normalizationScope,
        normalization_version: 'percentile_v1',
        radiance_percentile: percentile,
        s_anthro: availability === 'ok' ? sAnthro : null,
        metadata: {
          availability,
          archiveUrl: resolvedFile.archiveUrl,
          ddsUrl: resolvedFile.ddsUrl,
          dmrHtmlUrl: resolvedFile.dmrHtmlUrl,
          filename: resolvedFile.filename,
          featureCellDeg: item.target.featureCellDeg,
          cellCenterLatDeg: round(item.target.tile.cellCenterLatDeg, 6),
          cellCenterLonDeg: round(item.target.tile.cellCenterLonDeg, 6),
          launchIds: item.target.launchIds
        },
        confidence_payload: {
          availability,
          dataset: item.bundleName,
          sourceVersionId,
          sourceFetchRunId,
          qualityCode: item.qualityCode,
          landWaterCode: item.landWaterCode,
          normalizationScope,
          usedGapFilledValue: item.qualityCode === 2,
          lowQualityValue: item.qualityCode === 1
        },
        updated_at: nowIso
      };
      rows.push(row);
      if (availability === 'ok' && sAnthro != null) {
        availableTargetKeys.add(item.target.targetKey);
      }
    }

    return { rows, availableTargetKeys };
  } finally {
    try {
      file?.close?.();
    } catch {
      // Best-effort cleanup in the WASM HDF5 bridge.
    }
    try {
      ready.FS.unlink(filename);
    } catch {
      // Ignore cleanup failures in the ephemeral virtual filesystem.
    }
  }
}

let h5ModulePromise: Promise<H5Module> | null = null;

function loadH5Module(): Promise<H5Module> {
  if (!h5ModulePromise) {
    h5ModulePromise = import('https://cdn.jsdelivr.net/npm/h5wasm@0.10.1/dist/esm/hdf5_hl.js').then(
      (module) => (module.default as unknown as H5Module) ?? (module as unknown as H5Module)
    );
  }
  return h5ModulePromise;
}

function evaluateTarget(target: CellTarget, bundles: TileDatasetBundle[], landMask: ArrayLike<number>): EvaluatedTarget {
  const flatIndex = target.tile.rowIndex * 2400 + target.tile.colIndex;
  const landWaterCode = toFiniteNumber(landMask[flatIndex]);

  if (!isBlackMarbleLandMask(landWaterCode)) {
    return {
      target,
      bundleName: null,
      radiance: null,
      radianceLog: null,
      stddev: null,
      observationCount: null,
      qualityCode: null,
      landWaterCode,
      percentile: null,
      sAnthro: null,
      availability: 'non_land'
    };
  }

  for (const bundle of bundles) {
    const qualityCode = toFiniteNumber(bundle.quality[flatIndex]);
    const radiance = toFiniteNumber(bundle.radiance[flatIndex]);
    if (qualityCode == null || qualityCode === 255 || radiance == null || radiance < 0) {
      continue;
    }
    return {
      target,
      bundleName: bundle.name,
      radiance,
      radianceLog: Math.log1p(Math.max(0, radiance)),
      stddev: toFiniteNumber(bundle.stddev[flatIndex]),
      observationCount: toFiniteNumber(bundle.observationCount[flatIndex]),
      qualityCode,
      landWaterCode,
      percentile: null,
      sAnthro: null,
      availability: 'ok'
    };
  }

  return {
    target,
    bundleName: null,
    radiance: null,
    radianceLog: null,
    stddev: null,
    observationCount: null,
    qualityCode: null,
    landWaterCode,
    percentile: null,
    sAnthro: null,
    availability: 'missing_radiance'
  };
}

function computePercentilesByBundle(
  evaluated: EvaluatedTarget[],
  bundles: TileDatasetBundle[],
  landMask: ArrayLike<number>
) {
  const percentiles = new Map<string, number>();

  for (const bundle of bundles) {
    const bundleTargets = evaluated.filter((item) => item.availability === 'ok' && item.bundleName === bundle.name && item.radianceLog != null);
    if (!bundleTargets.length) continue;

    const counts = new Map<string, number>();
    for (const item of bundleTargets) counts.set(item.target.targetKey, 0);

    let validCount = 0;
    for (let idx = 0; idx < landMask.length; idx += 1) {
      const landWaterCode = toFiniteNumber(landMask[idx]);
      if (!isBlackMarbleLandMask(landWaterCode)) continue;
      const qualityCode = toFiniteNumber(bundle.quality[idx]);
      const radiance = toFiniteNumber(bundle.radiance[idx]);
      if (qualityCode == null || qualityCode === 255 || radiance == null || radiance < 0) continue;

      validCount += 1;
      const radianceLog = Math.log1p(Math.max(0, radiance));
      for (const item of bundleTargets) {
        if ((item.radianceLog ?? Number.POSITIVE_INFINITY) >= radianceLog - 1e-9) {
          counts.set(item.target.targetKey, Number(counts.get(item.target.targetKey) || 0) + 1);
        }
      }
    }

    if (!validCount) continue;
    for (const item of bundleTargets) {
      percentiles.set(item.target.targetKey, clamp(Number(counts.get(item.target.targetKey) || 0) / validCount, 0, 1));
    }
  }

  return percentiles;
}

async function loadExistingRowsForTargets(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  targets: CellTarget[],
  sourceKey: string,
  periodStartDate: string
) {
  const keys = [...new Set(targets.map((target) => target.observerFeatureKey))];
  const byFeatureKey = new Map<string, ExistingBackgroundRow>();
  if (!keys.length) return byFeatureKey;

  const { data, error } = await supabase
    .from('jep_background_light_cells')
    .select('observer_feature_key, source_version_id, confidence_payload')
    .eq('source_key', sourceKey)
    .eq('period_start_date', periodStartDate)
    .in('observer_feature_key', keys);
  if (error) throw error;
  for (const row of (data || []) as ExistingBackgroundRow[]) {
    byFeatureKey.set(row.observer_feature_key, row);
  }
  return byFeatureKey;
}

function buildMonthlyTargets(launches: LaunchRow[], maxCellsPerRun: number) {
  const byKey = new Map<string, CellTarget>();

  for (const launch of launches) {
    if (byKey.size >= maxCellsPerRun) break;
    const period = launch.net ? deriveBlackMarblePeriod('VNP46A3', launch.net) : null;
    const featureCell =
      launch.pad_latitude != null && launch.pad_longitude != null
        ? deriveJepV6ObserverFeatureCell(Number(launch.pad_latitude), Number(launch.pad_longitude))
        : null;
    const tile =
      launch.pad_latitude != null && launch.pad_longitude != null
        ? deriveBlackMarbleTileAddress(Number(launch.pad_latitude), Number(launch.pad_longitude))
        : null;

    if (!period || !featureCell || !tile) continue;

    const key = `${featureCell.key}|${period.sourceKey}|${period.periodStartDate}`;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.launchIds.includes(launch.launch_id)) existing.launchIds.push(launch.launch_id);
      continue;
    }

    byKey.set(key, {
      targetKey: key,
      observerFeatureKey: featureCell.key,
      observerLatBucket: featureCell.latCell,
      observerLonBucket: featureCell.lonCell,
      featureCellDeg: featureCell.cellDeg,
      launchIds: [launch.launch_id],
      period,
      tile
    });
  }

  return [...byKey.values()];
}

function buildYearlyFallbackTargets(monthlyTargets: CellTarget[], monthlyAvailable: Set<string>, maxCellsPerRun: number) {
  const byKey = new Map<string, CellTarget>();

  for (const target of monthlyTargets) {
    if (monthlyAvailable.has(target.targetKey)) continue;
    if (byKey.size >= maxCellsPerRun) break;
    const launchProxyDate = `${target.period.periodStartDate}T00:00:00.000Z`;
    const period = deriveBlackMarblePeriod('VNP46A4', launchProxyDate);
    if (!period) continue;
    const key = `${target.observerFeatureKey}|${period.sourceKey}|${period.periodStartDate}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.launchIds = dedupeLaunchIds([...existing.launchIds, ...target.launchIds]);
      continue;
    }
    byKey.set(key, {
      ...target,
      targetKey: key,
      launchIds: [...target.launchIds],
      period
    });
  }

  return [...byKey.values()];
}

function groupTargetsByTile(targets: CellTarget[]) {
  const grouped = new Map<string, CellTarget[]>();
  for (const target of targets) {
    const key = `${target.period.sourceKey}|${target.period.periodStartDate}|h${String(target.tile.tileH).padStart(2, '0')}v${String(target.tile.tileV).padStart(2, '0')}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(target);
    grouped.set(key, bucket);
  }
  return grouped;
}

function resolveBlackMarbleContentsUrl(period: BlackMarblePeriod) {
  return `https://ladsweb.modaps.eosdis.nasa.gov/api/v2/content/archives/allData/${BLACK_MARBLE_COLLECTION_ID}/${period.productKey}/${period.directoryYear}/${String(period.directoryDoy).padStart(3, '0')}/`;
}

async function resolvePublishedBlackMarblePeriod(period: BlackMarblePeriod) {
  if (period.productKey === 'VNP46A4') {
    return await resolvePublishedYearlyBlackMarblePeriod(period);
  }
  return await resolvePublishedMonthlyBlackMarblePeriod(period);
}

async function resolvePublishedMonthlyBlackMarblePeriod(period: BlackMarblePeriod) {
  const availableYears = await listBlackMarbleYears(period.productKey);
  const candidateYears = [...availableYears]
    .filter((year) => year <= period.directoryYear)
    .sort((left, right) => right - left);

  for (const year of candidateYears) {
    const availableDays = await listBlackMarbleDirectoryDays(period.productKey, year);
    const maxDesiredDay = year === period.directoryYear ? period.directoryDoy : 366;
    const selectedDay = [...availableDays]
      .filter((day) => day <= maxDesiredDay)
      .sort((left, right) => right - left)[0];
    if (!selectedDay) continue;
    return buildBlackMarblePeriodFromDirectory(period.productKey, year, selectedDay);
  }

  return null;
}

async function resolvePublishedYearlyBlackMarblePeriod(period: BlackMarblePeriod) {
  const availableYears = await listBlackMarbleYears(period.productKey);
  const selectedYear = [...availableYears]
    .filter((year) => year <= period.directoryYear)
    .sort((left, right) => right - left)[0];
  if (!selectedYear) return null;
  return buildBlackMarblePeriodFromDirectory(period.productKey, selectedYear, 1);
}

function listBlackMarbleYears(productKey: BlackMarbleProductKey) {
  const cached = blackMarbleYearsCache.get(productKey);
  if (cached) return cached;

  const promise = fetchText(
    `https://ladsweb.modaps.eosdis.nasa.gov/api/v2/content/archives/allData/${BLACK_MARBLE_COLLECTION_ID}/${productKey}/`,
    true
  ).then((contentsHtml) => parseBlackMarbleDirectoryNumbers(contentsHtml, productKey, 4));

  blackMarbleYearsCache.set(productKey, promise);
  return promise;
}

function listBlackMarbleDirectoryDays(productKey: BlackMarbleProductKey, year: number) {
  const cacheKey = `${productKey}|${year}`;
  const cached = blackMarbleDirectoryDaysCache.get(cacheKey);
  if (cached) return cached;

  const promise = fetchText(
    `https://ladsweb.modaps.eosdis.nasa.gov/api/v2/content/archives/allData/${BLACK_MARBLE_COLLECTION_ID}/${productKey}/${year}/`,
    true
  ).then((contentsHtml) => parseBlackMarbleDirectoryNumbers(contentsHtml, `${productKey}/${year}`, 3));

  blackMarbleDirectoryDaysCache.set(cacheKey, promise);
  return promise;
}

function parseBlackMarbleDirectoryNumbers(contentsHtml: string, pathToken: string, width: 3 | 4) {
  const pattern = new RegExp(`${escapeRegExp(pathToken)}/(\\d{${width}})/`, 'g');
  const values = new Set<number>();
  for (const match of contentsHtml.matchAll(pattern)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) values.add(value);
  }
  return [...values].sort((left, right) => left - right);
}

function buildBlackMarblePeriodFromDirectory(productKey: BlackMarbleProductKey, year: number, dayOfYear: number) {
  const date = new Date(Date.UTC(year, 0, dayOfYear));
  return deriveBlackMarblePeriod(productKey, date.toISOString());
}

async function fetchText(url: string, authorized: boolean) {
  const response = await fetch(url, {
    headers: buildHeaders(authorized),
    redirect: 'follow'
  });
  if (!response.ok) {
    throw new Error(`Black Marble request failed (${response.status}) for ${url}`);
  }
  return await response.text();
}

async function fetchBinary(url: string) {
  const response = await fetch(url, {
    headers: buildHeaders(true),
    redirect: 'follow'
  });
  if (!response.ok) {
    throw new Error(`Black Marble download failed (${response.status}) for ${url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function buildHeaders(authorized: boolean) {
  const headers = new Headers({
    'user-agent': BLACK_MARBLE_USER_AGENT
  });
  if (authorized && BLACK_MARBLE_DOWNLOAD_TOKEN) {
    headers.set('authorization', `Bearer ${BLACK_MARBLE_DOWNLOAD_TOKEN}`);
  }
  return headers;
}

function readDatasetValues(file: InstanceType<H5Module['File']>, path: string) {
  const dataset = file.get(path);
  const value = dataset?.value;
  if (!value || typeof value.length !== 'number') {
    throw new Error(`Black Marble dataset missing: ${path}`);
  }
  return value;
}

function parseBlackMarbleReleaseAt(filename: string) {
  const match = filename.match(/\.002\.(\d{13})\.h5$/);
  if (!match) return null;
  const raw = match[1];
  const year = Number(raw.slice(0, 4));
  const doy = Number(raw.slice(4, 7));
  const hour = Number(raw.slice(7, 9));
  const minute = Number(raw.slice(9, 11));
  const second = Number(raw.slice(11, 13));
  if (![year, doy, hour, minute, second].every(Number.isFinite)) return null;
  const timestamp = Date.UTC(year, 0, doy, hour, minute, second);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function readAvailability(payload: Record<string, unknown> | null | undefined) {
  const value = payload?.availability;
  return typeof value === 'string' ? value : null;
}

function isLaunchEligible(launch: LaunchRow) {
  if (!launch.net) return false;
  return Number.isFinite(Number(launch.pad_latitude)) && Number.isFinite(Number(launch.pad_longitude));
}

const US_PAD_COUNTRY_CODES = new Set(['US', 'USA']);

function isUsLaunch(launch: LaunchRow, states: string[]) {
  const countryCode = String(launch.pad_country_code || '').trim().toUpperCase();
  if (!US_PAD_COUNTRY_CODES.has(countryCode)) return false;
  const state = String(launch.pad_state || '').trim().toUpperCase();
  return state ? states.includes(state) : false;
}

function normalizeStates(states: string[], fallback: string[]) {
  const normalized = states.map((state) => state.trim().toUpperCase()).filter(Boolean);
  return normalized.length ? [...new Set(normalized)] : fallback;
}

function dedupeLaunchIds(ids: string[]) {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  stats: Record<string, unknown>,
  errorMessage?: string
) {
  if (!runId) return;
  const update: Record<string, unknown> = {
    success,
    ended_at: new Date().toISOString(),
    stats
  };
  if (errorMessage) update.error = errorMessage;
  const { error } = await supabase.from('ingestion_runs').update(update).eq('id', runId);
  if (error) {
    console.warn('Failed to update ingestion_runs record', { runId, error: error.message });
  }
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    }
  });
}

function stringifyError(value: unknown) {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits: number) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toFiniteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  return null;
}
