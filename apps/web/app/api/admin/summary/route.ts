import { NextResponse } from 'next/server';
import { startOfDay } from 'date-fns';
import fs from 'node:fs';
import path from 'node:path';
import { summarizeArRuntimePolicies, type ArRuntimePolicySummary } from '@/lib/ar/runtimePolicyTelemetry';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured } from '@/lib/server/env';
import { getWs45LiveCadenceMinutes } from '../../../../../../shared/ws45LiveBoard';
import { ADMIN_JOB_REGISTRY, type AdminJobRegistryEntry } from '../../../admin/_lib/jobRegistry';
import { buildOpsAlertExpiryCutoffIso } from '../../../admin/_lib/alerts';
import { requireAdminRequest } from '../_lib/auth';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type IngestionRun = {
  job_name: string;
  started_at: string;
  ended_at?: string | null;
  success?: boolean | null;
  error?: string | null;
  stats?: Record<string, unknown> | null;
};

type JobStatus = {
  id: string;
  label: string;
  schedule: string;
  slug?: string | null;
  cronJobName?: string | null;
  cronSchedule?: string | null;
  cronActive?: boolean | null;
  schedulerKind?: 'pg_cron' | 'managed' | 'bridge' | 'derived' | 'manual';
  group?: 'core' | 'secondary' | 'advanced';
  origin: 'server' | 'local';
  category: 'scheduled' | 'manual' | 'internal';
  status: 'operational' | 'degraded' | 'down' | 'paused' | 'running' | 'unknown';
  statusDetail?: string | null;
  enabled: boolean;
  enabledDetail?: string | null;
  manualRunSupported?: boolean;
  manualRunConfirmMessage?: string | null;
  manualRunPrompt?: string | null;
  manualRunPromptToken?: string | null;
  telemetryJobName?: string | null;
  lastRunAt?: string | null;
  lastEndedAt?: string | null;
  lastSuccessAt?: string | null;
  lastNewDataAt?: string | null;
  lastNewDataDetail?: string | null;
  lastError?: string | null;
  lastDurationSeconds?: number | null;
  consecutiveFailures?: number | null;
  command?: string | null;
};

type CronJobInfo = {
  jobname: string;
  schedule: string;
  active: boolean;
  command?: string | null;
};

type SchedulerSummary = {
  jobsEnabled: boolean;
  jobsBaseUrlSet: boolean;
  jobsApiKeySet: boolean;
  jobsAuthTokenSet: boolean;
  cronJobs: CronJobInfo[];
  cronError: string | null;
};

type TrajectoryPipelineFreshness = {
  checkedAt: string;
  eligibleLaunchIds: string[];
  missingProductsCount: number;
  staleProductsCount: number;
  missingLaunchIds: string[];
  staleLaunchIds: string[];
  precisionStaleProductsCount: number;
  precisionStaleLaunchIds: string[];
  catalogCoverage: {
    futureLaunches: number;
    rocketFamilyFilled: number;
    rocketFamilyFillRate: number | null;
    ll2RocketConfigFilled: number;
    ll2RocketConfigFillRate: number | null;
    configFamilyAvailable: number;
    configFamilyAvailableRate: number | null;
    repairableMissingRocketFamily: number;
    repairableMissingRocketFamilyRate: number | null;
    unrepairableMissingRocketFamily: number;
    unrepairableMissingRocketFamilyRate: number | null;
    sampleRepairableLaunchIds: string[];
    sampleUnrepairableLaunchIds: string[];
  };
  providerAdapters: {
    spacexInfographics: {
      status: 'operational' | 'degraded' | 'down' | 'unknown';
      lastRunAt: string | null;
      lastEndedAt: string | null;
      lastSuccessAt: string | null;
      lastRunSuccess: boolean | null;
      lastError: string | null;
      consecutiveFailures: number | null;
      latestRunStats: {
        candidates: number;
        considered: number;
        matched: number;
        missionsFetched: number;
        skippedNoMatch: number;
        skippedNoBundle: number;
        bundleRowsInput: number;
        bundleRowsInserted: number;
        bundleRowsUpdated: number;
        bundleRowsSkipped: number;
        constraintRowsInput: number;
        constraintRowsInserted: number;
        constraintRowsUpdated: number;
        constraintRowsSkipped: number;
        errorCount: number;
      } | null;
      outputs: {
        windowDays: number;
        missionInfographicRows: number;
        landingHintRows: number;
        latestMissionInfographicAt: string | null;
        latestLandingHintAt: string | null;
        parserRules: Array<{
          constraintType: string;
          parseRuleId: string | null;
          parserVersion: string | null;
          rows: number;
          latestFetchedAt: string | null;
        }>;
      };
    };
  };
  sourceFreshness: {
    alertsEnabled: boolean;
    orbit: {
      thresholdHours: number;
      launchesWithData: number;
      staleLaunchIds: string[];
      missingLaunchIds: string[];
    };
    landing: {
      thresholdHours: number;
      launchesWithData: number;
      staleLaunchIds: string[];
      missingLaunchIds: string[];
    };
    hazard: {
      thresholdHours: number;
      launchesWithData: number;
      staleLaunchIds: string[];
      missingLaunchIds: string[];
    };
  };
  coverage: {
    orbitLastEndedAt: string | null;
    landingLastEndedAt: string | null;
    hazardLastEndedAt: string | null;
    launches: Array<{
      launchId: string;
      orbit: {
        docsWithParsedOrbit: number;
        selectedCandidates: number;
        constraintsPrepared: number;
        usedSupgp: boolean;
        usedHazard: boolean;
        usedHeuristic: boolean;
      };
      landing: {
        ll2LaunchUuid: string | null;
        skippedNoLl2Id: boolean;
        landingsFetched: number;
        rowsPrepared: number;
      };
      hazard: {
        hazardAreasMatched: number;
        constraintsUpserted: number;
      };
    }>;
  };
  accuracy: {
    windowDays: number;
    windowStart: string;
    sampledSessions: number;
    sampleLimit: number;
    truncated: boolean;
    lock: {
      attempted: number;
      acquired: number;
      attemptRate: number | null;
      acquisitionRate: number | null;
      avgLossCount: number | null;
      autoModeSessions: number;
      manualDebugSessions: number;
      timeToLockBuckets: Record<string, number>;
    };
    fallback: {
      sessions: number;
      rate: number | null;
      skyCompassSessions: number;
      reasons: Record<string, number>;
    };
    precision: {
      trajectorySessions: number;
      trajectoryCoverageRate: number | null;
      sigmaReportedSessions: number;
      sigmaGoodSessions: number;
      sigmaGoodRate: number | null;
      sigmaGoodThresholdDeg: number;
      contractTierABSessions: number;
      contractTierABRate: number | null;
      qualityBuckets: {
        q0: number;
        q1: number;
        q2: number;
        q3: number;
      };
    };
    completeness: {
      requiredFieldValues: number;
      filledFieldValues: number;
      overallFillRate: number | null;
      fields: Array<{
        key: string;
        label: string;
        applicableSessions: number;
        filledSessions: number;
        fillRate: number | null;
      }>;
      runtimeFamilies: Array<{
        runtimeFamily: 'web' | 'ios_native' | 'android_native' | 'unknown';
        sessions: number;
        fields: Array<{
          key: string;
          label: string;
          applicableSessions: number;
          filledSessions: number;
          fillRate: number | null;
        }>;
      }>;
    };
    trend: Array<{
      day: string;
      sessions: number;
      lockAttemptRate: number | null;
      lockAcquisitionRate: number | null;
      fallbackRate: number | null;
      sigmaGoodRate: number | null;
      trajectoryCoverageRate: number | null;
    }>;
    runtimePolicies: ArRuntimePolicySummary;
  };
};

type JobDef = AdminJobRegistryEntry;

type Ws45LiveWindowStatus = {
  active: boolean;
  reason: 'active' | 'no_launch_within_24h' | 'launch_outside_cadence_window';
  cadenceMinutes: number | null;
  launchId: string | null;
  launchName: string | null;
  launchAt: string | null;
};

const TRAJECTORY_SOURCE_FRESHNESS_DEFAULTS = {
  alertsEnabled: true,
  orbitMaxAgeHours: 24,
  landingMaxAgeHours: 24,
  hazardMaxAgeHours: 24
} as const;

const TRAJECTORY_ACCURACY_DEFAULTS = {
  windowDays: 14,
  sigmaGoodThresholdDeg: 1.0,
  sampleLimit: 5000
} as const;

const STUB_SUMMARY = {
  ingestionRuns: [] as IngestionRun[],
  jobs: [] as JobStatus[],
  outboxCounts: { queued: 0, failed: 0, sentToday: 0 },
  trajectoryPipeline: null as TrajectoryPipelineFreshness | null,
  alerts: [] as Array<{
    key: string;
    severity: string;
    message: string;
    first_seen_at: string;
    last_seen_at: string;
    occurrences: number;
    details?: Record<string, unknown> | null;
  }>,
  scheduler: {
    jobsEnabled: false,
    jobsBaseUrlSet: false,
    jobsApiKeySet: false,
    jobsAuthTokenSet: false,
    cronJobs: [] as CronJobInfo[],
    cronError: null as string | null
  }
};

export async function GET() {
  const gate = await requireAdminRequest();
  if (!gate.ok) return gate.response;
  const { supabase } = gate.context;

  const today = startOfDay(new Date()).toISOString();
  const alertExpiryCutoffIso = buildOpsAlertExpiryCutoffIso();

  const jobSettingKeys = buildJobSettingKeys();

  const [jobSettingsRes, ingestionRes, queuedRes, failedRes, sentTodayRes, alertsRes, cronRes] = await Promise.all([
    supabase.from('system_settings').select('key, value').in('key', jobSettingKeys),
    supabase
      .from('ingestion_runs')
      .select('job_name, started_at, ended_at, success, error, stats')
      .order('started_at', { ascending: false })
      .limit(5),
    supabase.from('notifications_outbox').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
    supabase.from('notifications_outbox').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
    supabase.from('notifications_outbox').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('scheduled_for', today),
    supabase
      .from('ops_alerts')
      .select('key, severity, message, first_seen_at, last_seen_at, occurrences, details')
      .eq('resolved', false)
      .gte('last_seen_at', alertExpiryCutoffIso)
      .order('last_seen_at', { ascending: false })
      .limit(20),
    supabase.rpc('get_all_cron_jobs')
  ]);

  const anyError = [
    jobSettingsRes.error,
    ingestionRes.error,
    queuedRes.error,
    failedRes.error,
    sentTodayRes.error,
    alertsRes.error,
    cronRes.error
  ].filter(Boolean);
  if (anyError.length) {
    console.error('admin summary partial errors', anyError);
  }

  const jobSettings = mapSettingRows(jobSettingsRes.data);
  const cronJobs = ((cronRes.data as CronJobInfo[] | null) ?? STUB_SUMMARY.scheduler.cronJobs).map((row) => ({
    jobname: row.jobname,
    schedule: row.schedule,
    active: Boolean(row.active),
    command: typeof row.command === 'string' ? row.command : null
  }));

  const jobs = await loadJobStatuses(supabase, jobSettings, cronJobs);
  const scheduler: SchedulerSummary = {
    jobsEnabled: readBooleanSetting(jobSettings.jobs_enabled, false),
    jobsBaseUrlSet: Boolean(readStringSetting(jobSettings.jobs_base_url)),
    jobsApiKeySet: Boolean(readStringSetting(jobSettings.jobs_apikey)),
    jobsAuthTokenSet: Boolean(readStringSetting(jobSettings.jobs_auth_token)),
    cronJobs,
    cronError: cronRes.error ? cronRes.error.message : null
  };

  const trajectoryPipeline = await loadTrajectoryPipelineFreshness(jobSettings).catch((err) => {
    console.warn('admin summary trajectory pipeline freshness failed', err);
    return null;
  });

  const summary = {
    ingestionRuns: ingestionRes.data ?? STUB_SUMMARY.ingestionRuns,
    jobs,
    outboxCounts: {
      queued: queuedRes.count ?? STUB_SUMMARY.outboxCounts.queued,
      failed: failedRes.count ?? STUB_SUMMARY.outboxCounts.failed,
      sentToday: sentTodayRes.count ?? STUB_SUMMARY.outboxCounts.sentToday
    },
    trajectoryPipeline,
    alerts: alertsRes.data ?? STUB_SUMMARY.alerts,
    scheduler
  };

  return NextResponse.json({ mode: 'db', summary }, { headers: { 'Cache-Control': 'private, no-store' } });
}

function buildJobSettingKeys() {
  const keys = new Set<string>([
    'jobs_enabled',
    'jobs_base_url',
    'jobs_apikey',
    'jobs_auth_token',

    'll2_incremental_last_success_at',
    'll2_incremental_last_error',
    'll2_incremental_last_new_data_at',
    'll2_incremental_last_new_data_count',

    'll2_payload_backfill_spacecraft_only',
    'jep_public_enabled',
    'jep_validation_ready',
    'jep_model_card_published',
    'jep_probability_min_labeled_outcomes',
    'jep_probability_labeled_outcomes',
    'jep_probability_max_ece',
    'jep_probability_current_ece',
    'jep_probability_max_brier',
    'jep_probability_current_brier',
    'jep_score_observer_lookback_days',
    'jep_score_observer_registry_limit',
    'jep_score_max_observers_per_launch',
    'jep_score_max_observer_distance_km',
    'trajectory_orbit_job_enabled',
    'trajectory_constraints_job_enabled',
    'trajectory_products_job_enabled',
    'trajectory_source_freshness_alerts_enabled',
    'trajectory_freshness_orbit_max_age_hours',
    'trajectory_freshness_landing_max_age_hours',
    'trajectory_freshness_hazard_max_age_hours',
    'trajectory_accuracy_window_days',
    'trajectory_accuracy_sigma_good_deg',
    'contract_story_enrichment_enabled',
    'contract_story_enrichment_artemis_enabled',
    'contract_story_enrichment_spacex_enabled',
    'contract_story_enrichment_blue_origin_enabled',
    'contract_story_sync_batch_limit',

    'celestrak_gp_job_enabled',
    'celestrak_satcat_job_enabled',
    'celestrak_intdes_job_enabled',
    'celestrak_supgp_job_enabled',

    'trajectory_products_top3_ids'
  ]);

  for (const job of ADMIN_JOB_REGISTRY) {
    if (job.enabledKey) keys.add(job.enabledKey);
  }

  return [...keys.values()];
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function readUuidArraySetting(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && isUuid(v));
  }
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string' && isUuid(v));
    } catch {
      // ignore
    }
  }
  return [];
}

async function loadTrajectoryPipelineFreshness(settings: Record<string, unknown>): Promise<TrajectoryPipelineFreshness | null> {
  const checkedAt = new Date().toISOString();
  const eligibleLaunchIds = readUuidArraySetting(settings.trajectory_products_top3_ids);
  if (!isSupabaseAdminConfigured()) return null;
  const supabase = createSupabaseAdminClient();

  const sourceFreshnessAlertsEnabled = readBooleanSetting(
    settings.trajectory_source_freshness_alerts_enabled,
    TRAJECTORY_SOURCE_FRESHNESS_DEFAULTS.alertsEnabled
  );
  const orbitMaxAgeHours = clampIntValue(
    readNumberSetting(settings.trajectory_freshness_orbit_max_age_hours, TRAJECTORY_SOURCE_FRESHNESS_DEFAULTS.orbitMaxAgeHours),
    1,
    24 * 14
  );
  const landingMaxAgeHours = clampIntValue(
    readNumberSetting(
      settings.trajectory_freshness_landing_max_age_hours,
      TRAJECTORY_SOURCE_FRESHNESS_DEFAULTS.landingMaxAgeHours
    ),
    1,
    24 * 14
  );
  const hazardMaxAgeHours = clampIntValue(
    readNumberSetting(settings.trajectory_freshness_hazard_max_age_hours, TRAJECTORY_SOURCE_FRESHNESS_DEFAULTS.hazardMaxAgeHours),
    1,
    24 * 14
  );

  const accuracyWindowDays = clampIntValue(
    readNumberSetting(settings.trajectory_accuracy_window_days, TRAJECTORY_ACCURACY_DEFAULTS.windowDays),
    1,
    90
  );
  const sigmaGoodThresholdDeg = clampNumberValue(
    readNumberSetting(settings.trajectory_accuracy_sigma_good_deg, TRAJECTORY_ACCURACY_DEFAULTS.sigmaGoodThresholdDeg),
    0.1,
    20
  );
  const accuracySampleLimit = TRAJECTORY_ACCURACY_DEFAULTS.sampleLimit;
  const accuracyWindowStartIso = new Date(Date.now() - accuracyWindowDays * 24 * 60 * 60 * 1000).toISOString();

  const relevantTypes = ['landing', 'target_orbit', 'hazard_area'] as const;

  let productRows: Array<{ launch_id: string; generated_at: string; quality: number | null; freshness_state: string | null }> = [];
  let constraintRows: Array<{ launch_id: string; constraint_type: string; fetched_at: string }> = [];

  if (eligibleLaunchIds.length) {
    const [productsRes, constraintsRes] = await Promise.all([
      supabase
        .from('launch_trajectory_products')
        .select('launch_id, generated_at, quality, freshness_state')
        .in('launch_id', eligibleLaunchIds),
      supabase
        .from('launch_trajectory_constraints')
        .select('launch_id, constraint_type, fetched_at')
        .in('launch_id', eligibleLaunchIds)
        .in('constraint_type', [...relevantTypes])
    ]);

    if (productsRes.error) throw productsRes.error;
    if (constraintsRes.error) throw constraintsRes.error;

    productRows = Array.isArray(productsRes.data)
      ? (productsRes.data as Array<{ launch_id: string; generated_at: string; quality: number | null; freshness_state: string | null }>)
      : [];
    constraintRows = Array.isArray(constraintsRes.data)
      ? (constraintsRes.data as Array<{ launch_id: string; constraint_type: string; fetched_at: string }>)
      : [];
  }

  const [coverageRunsRes, accuracySessionsRes] = await Promise.all([
    supabase
      .from('ingestion_runs')
      .select('job_name, started_at, ended_at, success, stats')
      .in('job_name', ['trajectory_orbit_ingest', 'trajectory_constraints_ingest', 'navcen_bnm_ingest', 'faa_trajectory_hazard_ingest'])
      .order('started_at', { ascending: false })
      .limit(120),
    supabase
      .from('ar_camera_guide_sessions')
      .select(
        [
          'started_at',
          'runtime_family',
          'client_profile',
          'client_env',
          'release_profile',
          'screen_bucket',
          'location_fix_state',
          'alignment_ready',
          'heading_status',
          'pose_mode',
          'xr_supported',
          'xr_used',
          'xr_error_bucket',
          'lock_on_attempted',
          'lock_on_acquired',
          'lock_loss_count',
          'lock_on_mode',
          'time_to_lock_bucket',
          'vision_backend',
          'runtime_degradation_tier',
          'loop_restart_count',
          'fallback_reason',
          'mode_entered',
          'avg_sigma_deg',
          'contract_tier',
          'trajectory_quality',
          'render_tier',
          'dropped_frame_bucket',
          'time_to_usable_ms'
        ].join(', ')
      )
      .gte('started_at', accuracyWindowStartIso)
      .order('started_at', { ascending: false })
      .limit(accuracySampleLimit)
  ]);

  const spacexAdapterWindowDays = 30;
  const spacexAdapterWindowStartIso = new Date(Date.now() - spacexAdapterWindowDays * 24 * 60 * 60 * 1000).toISOString();
  const [spacexRunsRes, spacexConstraintRowsRes] = await Promise.all([
    supabase
      .from('ingestion_runs')
      .select('job_name, started_at, ended_at, success, error, stats')
      .eq('job_name', 'spacex_infographics_ingest')
      .order('started_at', { ascending: false })
      .limit(10),
    supabase
      .from('launch_trajectory_constraints')
      .select('constraint_type, fetched_at, parse_rule_id, parser_version')
      .or('source.eq.spacex_website,source.eq.spacex_content')
      .in('constraint_type', ['mission_infographic', 'landing_hint'])
      .gte('fetched_at', spacexAdapterWindowStartIso)
      .order('fetched_at', { ascending: false })
      .limit(1000)
  ]);

  const coverageRuns = coverageRunsRes.error || !Array.isArray(coverageRunsRes.data) ? [] : (coverageRunsRes.data as any[]);
  if (coverageRunsRes.error) {
    console.warn('admin summary trajectory coverage runs failed', coverageRunsRes.error.message);
  }

  const accuracyRows =
    accuracySessionsRes.error || !Array.isArray(accuracySessionsRes.data)
      ? []
      : (accuracySessionsRes.data as unknown as Array<{
          started_at: string | null;
          runtime_family: string | null;
          client_profile: string | null;
          client_env: string | null;
          release_profile: string | null;
          screen_bucket: string | null;
          location_fix_state: string | null;
          alignment_ready: boolean | null;
          heading_status: string | null;
          pose_mode: string | null;
          xr_supported: boolean | null;
          xr_used: boolean | null;
          xr_error_bucket: string | null;
          lock_on_attempted: boolean | null;
          lock_on_acquired: boolean | null;
          lock_loss_count: number | null;
          lock_on_mode: string | null;
          time_to_lock_bucket: string | null;
          vision_backend: string | null;
          runtime_degradation_tier: number | null;
          loop_restart_count: number | null;
          fallback_reason: string | null;
          mode_entered: string | null;
          avg_sigma_deg: number | null;
          contract_tier: string | null;
          trajectory_quality: number | null;
          render_tier: string | null;
          dropped_frame_bucket: string | null;
          time_to_usable_ms: number | null;
        }>);
  if (accuracySessionsRes.error) {
    console.warn('admin summary trajectory accuracy sessions failed', accuracySessionsRes.error.message);
  }

  const spacexRuns = spacexRunsRes.error || !Array.isArray(spacexRunsRes.data) ? [] : (spacexRunsRes.data as IngestionRun[]);
  if (spacexRunsRes.error) {
    console.warn('admin summary spacex infographics runs failed', spacexRunsRes.error.message);
  }

  const spacexConstraintRows =
    spacexConstraintRowsRes.error || !Array.isArray(spacexConstraintRowsRes.data)
      ? []
      : (spacexConstraintRowsRes.data as Array<{
          constraint_type: string | null;
          fetched_at: string | null;
          parse_rule_id: string | null;
          parser_version: string | null;
        }>);
  if (spacexConstraintRowsRes.error) {
    console.warn('admin summary spacex infographics constraints failed', spacexConstraintRowsRes.error.message);
  }

  const productGeneratedAtByLaunch = new Map<string, number>();
  const stalePrecisionLaunchIdSet = new Set<string>();
  for (const row of productRows) {
    const launchId = typeof row?.launch_id === 'string' ? row.launch_id : null;
    const generatedAtMs = typeof row?.generated_at === 'string' ? Date.parse(row.generated_at) : NaN;
    if (!launchId || !Number.isFinite(generatedAtMs)) continue;
    productGeneratedAtByLaunch.set(launchId, generatedAtMs);
    const quality = typeof row?.quality === 'number' && Number.isFinite(row.quality) ? row.quality : null;
    const freshnessState = typeof row?.freshness_state === 'string' ? row.freshness_state : null;
    if (quality != null && quality >= 1 && freshnessState === 'stale') stalePrecisionLaunchIdSet.add(launchId);
  }

  const newestConstraintAtByLaunch = new Map<string, number>();
  const newestOrbitConstraintByLaunch = new Map<string, number>();
  const newestLandingConstraintByLaunch = new Map<string, number>();
  const newestHazardConstraintByLaunch = new Map<string, number>();
  for (const row of constraintRows) {
    const launchId = typeof row?.launch_id === 'string' ? row.launch_id : null;
    const fetchedAtMs = typeof row?.fetched_at === 'string' ? Date.parse(row.fetched_at) : NaN;
    if (!launchId || !Number.isFinite(fetchedAtMs)) continue;
    const prev = newestConstraintAtByLaunch.get(launchId);
    if (prev == null || fetchedAtMs > prev) newestConstraintAtByLaunch.set(launchId, fetchedAtMs);
    const constraintType = typeof row?.constraint_type === 'string' ? row.constraint_type : null;
    if (constraintType === 'target_orbit') {
      const prevOrbit = newestOrbitConstraintByLaunch.get(launchId);
      if (prevOrbit == null || fetchedAtMs > prevOrbit) newestOrbitConstraintByLaunch.set(launchId, fetchedAtMs);
    } else if (constraintType === 'landing') {
      const prevLanding = newestLandingConstraintByLaunch.get(launchId);
      if (prevLanding == null || fetchedAtMs > prevLanding) newestLandingConstraintByLaunch.set(launchId, fetchedAtMs);
    } else if (constraintType === 'hazard_area') {
      const prevHazard = newestHazardConstraintByLaunch.get(launchId);
      if (prevHazard == null || fetchedAtMs > prevHazard) newestHazardConstraintByLaunch.set(launchId, fetchedAtMs);
    }
  }

  const missingLaunchIds: string[] = [];
  const staleLaunchIds: string[] = [];

  for (const launchId of eligibleLaunchIds) {
    const productAt = productGeneratedAtByLaunch.get(launchId);
    if (productAt == null) {
      missingLaunchIds.push(launchId);
      continue;
    }
    const newestConstraintAt = newestConstraintAtByLaunch.get(launchId);
    if (newestConstraintAt != null && newestConstraintAt > productAt) staleLaunchIds.push(launchId);
  }

  const nowMs = Date.now();
  const sourceFreshness = {
    alertsEnabled: sourceFreshnessAlertsEnabled,
    orbit: computeSourceFreshnessState({
      eligibleLaunchIds,
      newestByLaunch: newestOrbitConstraintByLaunch,
      thresholdHours: orbitMaxAgeHours,
      nowMs
    }),
    landing: computeSourceFreshnessState({
      eligibleLaunchIds,
      newestByLaunch: newestLandingConstraintByLaunch,
      thresholdHours: landingMaxAgeHours,
      nowMs
    }),
    hazard: computeSourceFreshnessState({
      eligibleLaunchIds,
      newestByLaunch: newestHazardConstraintByLaunch,
      thresholdHours: hazardMaxAgeHours,
      nowMs
    })
  };

  const coverage = summarizeTrajectoryCoverage({
    eligibleLaunchIds,
    runs: coverageRuns
  });

  const catalogCoverage = await summarizeTrajectoryCatalogCoverage({
    supabase,
    nowIso: checkedAt
  });
  const providerAdapters = {
    spacexInfographics: summarizeSpacexInfographicsAdapterHealth({
      runs: spacexRuns,
      constraintRows: spacexConstraintRows,
      windowDays: spacexAdapterWindowDays
    })
  };

  const accuracy = summarizeTrajectoryAccuracy({
    rows: accuracyRows,
    windowDays: accuracyWindowDays,
    windowStart: accuracyWindowStartIso,
    sampleLimit: accuracySampleLimit,
    sigmaGoodThresholdDeg
  });

  return {
    checkedAt,
    eligibleLaunchIds,
    missingProductsCount: missingLaunchIds.length,
    staleProductsCount: staleLaunchIds.length,
    missingLaunchIds,
    staleLaunchIds,
    precisionStaleProductsCount: stalePrecisionLaunchIdSet.size,
    precisionStaleLaunchIds: Array.from(stalePrecisionLaunchIdSet.values()),
    catalogCoverage,
    providerAdapters,
    sourceFreshness,
    coverage,
    accuracy
  };
}

function summarizeSpacexInfographicsAdapterHealth({
  runs,
  constraintRows,
  windowDays
}: {
  runs: IngestionRun[];
  constraintRows: Array<{
    constraint_type: string | null;
    fetched_at: string | null;
    parse_rule_id: string | null;
    parser_version: string | null;
  }>;
  windowDays: number;
}): TrajectoryPipelineFreshness['providerAdapters']['spacexInfographics'] {
  const latestRun = runs[0] ?? null;
  const latestSuccessRun = runs.find((run) => run.success === true) ?? null;
  const consecutiveFailures = computeConsecutiveFailures(runs);
  const latestStats = latestRun?.stats && typeof latestRun.stats === 'object' ? latestRun.stats : null;
  const rawErrors = Array.isArray((latestStats as any)?.errors) ? ((latestStats as any).errors as unknown[]) : [];
  const latestRunStats = latestRun
    ? {
        candidates: Math.max(0, Math.round(readNumber(latestStats, 'candidates') ?? 0)),
        considered: Math.max(0, Math.round(readNumber(latestStats, 'considered') ?? 0)),
        matched: Math.max(0, Math.round(readNumber(latestStats, 'matched') ?? 0)),
        missionsFetched: Math.max(0, Math.round(readNumber(latestStats, 'missionsFetched') ?? 0)),
        skippedNoMatch: Math.max(0, Math.round(readNumber(latestStats, 'skippedNoMatch') ?? 0)),
        skippedNoBundle: Math.max(0, Math.round(readNumber(latestStats, 'skippedNoBundle') ?? 0)),
        bundleRowsInput: Math.max(0, Math.round(readNumber(latestStats, 'bundleRowsInput') ?? 0)),
        bundleRowsInserted: Math.max(0, Math.round(readNumber(latestStats, 'bundleRowsInserted') ?? 0)),
        bundleRowsUpdated: Math.max(0, Math.round(readNumber(latestStats, 'bundleRowsUpdated') ?? 0)),
        bundleRowsSkipped: Math.max(0, Math.round(readNumber(latestStats, 'bundleRowsSkipped') ?? 0)),
        constraintRowsInput: Math.max(0, Math.round(readNumber(latestStats, 'constraintRowsInput') ?? 0)),
        constraintRowsInserted: Math.max(0, Math.round(readNumber(latestStats, 'constraintRowsInserted') ?? 0)),
        constraintRowsUpdated: Math.max(0, Math.round(readNumber(latestStats, 'constraintRowsUpdated') ?? 0)),
        constraintRowsSkipped: Math.max(0, Math.round(readNumber(latestStats, 'constraintRowsSkipped') ?? 0)),
        errorCount: rawErrors.length
      }
    : null;

  let missionInfographicRows = 0;
  let landingHintRows = 0;
  let latestMissionInfographicAt: string | null = null;
  let latestLandingHintAt: string | null = null;
  const parserRuleMap = new Map<
    string,
    {
      constraintType: string;
      parseRuleId: string | null;
      parserVersion: string | null;
      rows: number;
      latestFetchedAt: string | null;
    }
  >();

  for (const row of constraintRows) {
    const constraintType = typeof row?.constraint_type === 'string' ? row.constraint_type : null;
    const fetchedAt = typeof row?.fetched_at === 'string' ? row.fetched_at : null;
    const parseRuleId = typeof row?.parse_rule_id === 'string' ? row.parse_rule_id : null;
    const parserVersion = typeof row?.parser_version === 'string' ? row.parser_version : null;
    if (!constraintType) continue;

    if (constraintType === 'mission_infographic') {
      missionInfographicRows += 1;
      if (!latestMissionInfographicAt) latestMissionInfographicAt = fetchedAt;
    } else if (constraintType === 'landing_hint') {
      landingHintRows += 1;
      if (!latestLandingHintAt) latestLandingHintAt = fetchedAt;
    }

    const key = `${constraintType}::${parseRuleId || 'unknown'}::${parserVersion || 'unknown'}`;
    const current = parserRuleMap.get(key);
    if (current) {
      current.rows += 1;
      if (!current.latestFetchedAt && fetchedAt) current.latestFetchedAt = fetchedAt;
      continue;
    }
    parserRuleMap.set(key, {
      constraintType,
      parseRuleId,
      parserVersion,
      rows: 1,
      latestFetchedAt: fetchedAt
    });
  }

  let status: 'operational' | 'degraded' | 'down' | 'unknown' = 'unknown';
  if (latestRun) {
    if (latestRun.success === false) {
      status = (consecutiveFailures ?? 0) >= 2 ? 'down' : 'degraded';
    } else if (latestRun.success === true) {
      status = latestRunStats && latestRunStats.errorCount > 0 ? 'degraded' : 'operational';
    }
  }

  return {
    status,
    lastRunAt: latestRun?.started_at ?? null,
    lastEndedAt: latestRun?.ended_at ?? null,
    lastSuccessAt: latestSuccessRun?.ended_at ?? latestSuccessRun?.started_at ?? null,
    lastRunSuccess: typeof latestRun?.success === 'boolean' ? latestRun.success : null,
    lastError: latestRun?.error ?? null,
    consecutiveFailures,
    latestRunStats,
    outputs: {
      windowDays,
      missionInfographicRows,
      landingHintRows,
      latestMissionInfographicAt,
      latestLandingHintAt,
      parserRules: Array.from(parserRuleMap.values()).sort((a, b) => {
        const aTime = a.latestFetchedAt ? Date.parse(a.latestFetchedAt) : NaN;
        const bTime = b.latestFetchedAt ? Date.parse(b.latestFetchedAt) : NaN;
        if (Number.isFinite(aTime) && Number.isFinite(bTime) && bTime !== aTime) return bTime - aTime;
        return a.constraintType.localeCompare(b.constraintType);
      })
    }
  };
}

function computeSourceFreshnessState({
  eligibleLaunchIds,
  newestByLaunch,
  thresholdHours,
  nowMs
}: {
  eligibleLaunchIds: string[];
  newestByLaunch: Map<string, number>;
  thresholdHours: number;
  nowMs: number;
}) {
  const staleLaunchIds: string[] = [];
  const missingLaunchIds: string[] = [];
  let launchesWithData = 0;

  for (const launchId of eligibleLaunchIds) {
    const newestMs = newestByLaunch.get(launchId);
    if (newestMs == null) {
      missingLaunchIds.push(launchId);
      continue;
    }
    launchesWithData += 1;
    const ageHours = (nowMs - newestMs) / (1000 * 60 * 60);
    if (ageHours > thresholdHours) staleLaunchIds.push(launchId);
  }

  return {
    thresholdHours,
    launchesWithData,
    staleLaunchIds,
    missingLaunchIds
  };
}

function summarizeTrajectoryCoverage({
  eligibleLaunchIds,
  runs
}: {
  eligibleLaunchIds: string[];
  runs: Array<{
    job_name?: string | null;
    ended_at?: string | null;
    success?: boolean | null;
    stats?: Record<string, unknown> | null;
  }>;
}): TrajectoryPipelineFreshness['coverage'] {
  const orbitRun = findLatestSuccessfulRun(runs, 'trajectory_orbit_ingest');
  const landingRun = findLatestSuccessfulRun(runs, 'trajectory_constraints_ingest');
  const navcenHazardRun = findLatestSuccessfulRun(runs, 'navcen_bnm_ingest');
  const faaHazardRun = findLatestSuccessfulRun(runs, 'faa_trajectory_hazard_ingest');

  const byLaunch = new Map<
    string,
    {
      launchId: string;
      orbit: {
        docsWithParsedOrbit: number;
        selectedCandidates: number;
        constraintsPrepared: number;
        usedSupgp: boolean;
        usedHazard: boolean;
        usedHeuristic: boolean;
      };
      landing: {
        ll2LaunchUuid: string | null;
        skippedNoLl2Id: boolean;
        landingsFetched: number;
        rowsPrepared: number;
      };
      hazard: {
        hazardAreasMatched: number;
        constraintsUpserted: number;
      };
    }
  >();

  for (const launchId of eligibleLaunchIds) {
    byLaunch.set(launchId, {
      launchId,
      orbit: {
        docsWithParsedOrbit: 0,
        selectedCandidates: 0,
        constraintsPrepared: 0,
        usedSupgp: false,
        usedHazard: false,
        usedHeuristic: false
      },
      landing: {
        ll2LaunchUuid: null,
        skippedNoLl2Id: false,
        landingsFetched: 0,
        rowsPrepared: 0
      },
      hazard: {
        hazardAreasMatched: 0,
        constraintsUpserted: 0
      }
    });
  }

  const orbitCoverage = Array.isArray((orbitRun?.stats as any)?.launchCoverage) ? ((orbitRun?.stats as any).launchCoverage as any[]) : [];
  for (const row of orbitCoverage) {
    const launchId = typeof row?.launchId === 'string' ? row.launchId : null;
    if (!launchId || !byLaunch.has(launchId)) continue;
    const target = byLaunch.get(launchId)!;
    target.orbit = {
      docsWithParsedOrbit: Math.max(0, Math.round(readNumber(row, 'docsWithParsedOrbit') ?? 0)),
      selectedCandidates: Math.max(0, Math.round(readNumber(row, 'selectedCandidates') ?? 0)),
      constraintsPrepared: Math.max(0, Math.round(readNumber(row, 'constraintsPrepared') ?? 0)),
      usedSupgp: Boolean(row?.usedSupgp),
      usedHazard: Boolean(row?.usedHazard),
      usedHeuristic: Boolean(row?.usedHeuristic)
    };
  }

  const landingCoverage = Array.isArray((landingRun?.stats as any)?.launchCoverage) ? ((landingRun?.stats as any).launchCoverage as any[]) : [];
  for (const row of landingCoverage) {
    const launchId = typeof row?.launchId === 'string' ? row.launchId : null;
    if (!launchId || !byLaunch.has(launchId)) continue;
    const target = byLaunch.get(launchId)!;
    target.landing = {
      ll2LaunchUuid: typeof row?.ll2LaunchUuid === 'string' ? row.ll2LaunchUuid : null,
      skippedNoLl2Id: Boolean(row?.skippedNoLl2Id),
      landingsFetched: Math.max(0, Math.round(readNumber(row, 'landingsFetched') ?? 0)),
      rowsPrepared: Math.max(0, Math.round(readNumber(row, 'rowsPrepared') ?? 0))
    };
  }

  const mergeHazardCoverage = (hazardCoverage: unknown) => {
    if (!hazardCoverage || typeof hazardCoverage !== 'object' || Array.isArray(hazardCoverage)) return;
    for (const [launchId, row] of Object.entries(hazardCoverage as Record<string, unknown>)) {
      if (!byLaunch.has(launchId)) continue;
      const target = byLaunch.get(launchId)!;
      target.hazard = {
        hazardAreasMatched:
          target.hazard.hazardAreasMatched + Math.max(0, Math.round(readNumber(row, 'hazardAreasMatched') ?? 0)),
        constraintsUpserted:
          target.hazard.constraintsUpserted + Math.max(0, Math.round(readNumber(row, 'constraintsUpserted') ?? 0))
      };
    }
  };

  mergeHazardCoverage((navcenHazardRun?.stats as any)?.launchCoverage);
  mergeHazardCoverage((faaHazardRun?.stats as any)?.launchCoverage);

  const navcenHazardEndedAtMs = typeof navcenHazardRun?.ended_at === 'string' ? Date.parse(navcenHazardRun.ended_at) : NaN;
  const faaHazardEndedAtMs = typeof faaHazardRun?.ended_at === 'string' ? Date.parse(faaHazardRun.ended_at) : NaN;
  const hazardLastEndedAtMs = Math.max(
    Number.isFinite(navcenHazardEndedAtMs) ? navcenHazardEndedAtMs : Number.NEGATIVE_INFINITY,
    Number.isFinite(faaHazardEndedAtMs) ? faaHazardEndedAtMs : Number.NEGATIVE_INFINITY
  );

  return {
    orbitLastEndedAt: orbitRun?.ended_at ?? null,
    landingLastEndedAt: landingRun?.ended_at ?? null,
    hazardLastEndedAt: Number.isFinite(hazardLastEndedAtMs) ? new Date(hazardLastEndedAtMs).toISOString() : null,
    launches: Array.from(byLaunch.values())
  };
}

async function summarizeTrajectoryCatalogCoverage({
  supabase,
  nowIso
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  nowIso: string;
}): Promise<TrajectoryPipelineFreshness['catalogCoverage']> {
  const rows: Array<{
    launch_id: string;
    ll2_rocket_config_id: number | null;
    rocket_family: string | null;
  }> = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('launches_public_cache')
      .select('launch_id, ll2_rocket_config_id, rocket_family')
      .eq('hidden', false)
      .gte('net', nowIso)
      .order('net', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const chunk = Array.isArray(data)
      ? (data as Array<{
          launch_id: string;
          ll2_rocket_config_id: number | null;
          rocket_family: string | null;
        }>)
      : [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    offset += chunk.length;
  }

  const rocketConfigIds = Array.from(
    new Set(
      rows
        .map((row) => (typeof row.ll2_rocket_config_id === 'number' ? row.ll2_rocket_config_id : null))
        .filter((value): value is number => value != null)
    )
  );

  const configFamilyById = new Map<number, string>();
  for (let index = 0; index < rocketConfigIds.length; index += 500) {
    const chunk = rocketConfigIds.slice(index, index + 500);
    if (!chunk.length) continue;
    const { data, error } = await supabase
      .from('ll2_rocket_configs')
      .select('ll2_config_id, family')
      .in('ll2_config_id', chunk);
    if (error) throw error;
    for (const row of data || []) {
      const configId = typeof row?.ll2_config_id === 'number' ? row.ll2_config_id : null;
      const family = typeof row?.family === 'string' ? row.family.trim() : '';
      if (configId != null && family) configFamilyById.set(configId, family);
    }
  }

  let rocketFamilyFilled = 0;
  let ll2RocketConfigFilled = 0;
  let configFamilyAvailable = 0;
  let repairableMissingRocketFamily = 0;
  let unrepairableMissingRocketFamily = 0;
  const sampleRepairableLaunchIds: string[] = [];
  const sampleUnrepairableLaunchIds: string[] = [];

  for (const row of rows) {
    const hasRocketFamily = hasFilledText(row.rocket_family);
    const configId = typeof row.ll2_rocket_config_id === 'number' ? row.ll2_rocket_config_id : null;
    const hasRocketConfig = configId != null;
    const hasConfigFamily = configId != null && configFamilyById.has(configId);

    if (hasRocketFamily) rocketFamilyFilled += 1;
    if (hasRocketConfig) ll2RocketConfigFilled += 1;
    if (hasConfigFamily) configFamilyAvailable += 1;

    if (!hasRocketFamily) {
      if (hasConfigFamily) {
        repairableMissingRocketFamily += 1;
        if (sampleRepairableLaunchIds.length < 10) sampleRepairableLaunchIds.push(row.launch_id);
      } else {
        unrepairableMissingRocketFamily += 1;
        if (sampleUnrepairableLaunchIds.length < 10) sampleUnrepairableLaunchIds.push(row.launch_id);
      }
    }
  }

  const futureLaunches = rows.length;
  const blankRocketFamilies = Math.max(0, futureLaunches - rocketFamilyFilled);

  return {
    futureLaunches,
    rocketFamilyFilled,
    rocketFamilyFillRate: ratio(rocketFamilyFilled, futureLaunches),
    ll2RocketConfigFilled,
    ll2RocketConfigFillRate: ratio(ll2RocketConfigFilled, futureLaunches),
    configFamilyAvailable,
    configFamilyAvailableRate: ratio(configFamilyAvailable, futureLaunches),
    repairableMissingRocketFamily,
    repairableMissingRocketFamilyRate: ratio(repairableMissingRocketFamily, blankRocketFamilies),
    unrepairableMissingRocketFamily,
    unrepairableMissingRocketFamilyRate: ratio(unrepairableMissingRocketFamily, blankRocketFamilies),
    sampleRepairableLaunchIds,
    sampleUnrepairableLaunchIds
  };
}

function summarizeTrajectoryAccuracy({
  rows,
  windowDays,
  windowStart,
  sampleLimit,
  sigmaGoodThresholdDeg
}: {
  rows: Array<{
    started_at: string | null;
    runtime_family: string | null;
    client_profile: string | null;
    client_env: string | null;
    release_profile: string | null;
    screen_bucket: string | null;
    location_fix_state: string | null;
    alignment_ready: boolean | null;
    heading_status: string | null;
    pose_mode: string | null;
    xr_supported: boolean | null;
    xr_used: boolean | null;
    xr_error_bucket: string | null;
    lock_on_attempted: boolean | null;
    lock_on_acquired: boolean | null;
    lock_loss_count: number | null;
    lock_on_mode: string | null;
    time_to_lock_bucket: string | null;
    vision_backend: string | null;
    runtime_degradation_tier: number | null;
    loop_restart_count: number | null;
    fallback_reason: string | null;
    mode_entered: string | null;
    avg_sigma_deg: number | null;
    contract_tier: string | null;
    trajectory_quality: number | null;
    render_tier: string | null;
    dropped_frame_bucket: string | null;
    time_to_usable_ms: number | null;
  }>;
  windowDays: number;
  windowStart: string;
  sampleLimit: number;
  sigmaGoodThresholdDeg: number;
}): TrajectoryPipelineFreshness['accuracy'] {
  const timeToLockBuckets: Record<string, number> = {
    '<2s': 0,
    '2..5s': 0,
    '5..10s': 0,
    '10..20s': 0,
    '20..60s': 0,
    '60s+': 0
  };
  const fallbackReasons: Record<string, number> = {};

  let attempted = 0;
  let acquired = 0;
  let lockLossSum = 0;
  let lockLossSamples = 0;
  let autoModeSessions = 0;
  let manualDebugSessions = 0;

  let fallbackSessions = 0;
  let skyCompassSessions = 0;

  let trajectorySessions = 0;
  let sigmaReportedSessions = 0;
  let sigmaGoodSessions = 0;
  let contractTierABSessions = 0;

  let q0 = 0;
  let q1 = 0;
  let q2 = 0;
  let q3 = 0;

  const trendByDay = new Map<
    string,
    {
      sessions: number;
      attempted: number;
      acquired: number;
      fallback: number;
      trajectory: number;
      sigmaReported: number;
      sigmaGood: number;
    }
  >();

  for (const row of rows) {
    const day = normalizeIsoDay(row.started_at);
    const dayStats =
      trendByDay.get(day) ??
      {
        sessions: 0,
        attempted: 0,
        acquired: 0,
        fallback: 0,
        trajectory: 0,
        sigmaReported: 0,
        sigmaGood: 0
      };

    dayStats.sessions += 1;

    const lockAttempted = row.lock_on_attempted === true;
    if (lockAttempted) {
      attempted += 1;
      dayStats.attempted += 1;
    }
    if (lockAttempted && row.lock_on_acquired === true) {
      acquired += 1;
      dayStats.acquired += 1;
    }

    if (lockAttempted && row.lock_on_acquired === true && typeof row.lock_loss_count === 'number' && Number.isFinite(row.lock_loss_count)) {
      lockLossSum += row.lock_loss_count;
      lockLossSamples += 1;
    }

    if (row.lock_on_mode === 'auto') autoModeSessions += 1;
    else if (row.lock_on_mode === 'manual_debug') manualDebugSessions += 1;

    const lockBucket = typeof row.time_to_lock_bucket === 'string' ? row.time_to_lock_bucket : null;
    if (lockAttempted && lockBucket) {
      timeToLockBuckets[lockBucket] = (timeToLockBuckets[lockBucket] ?? 0) + 1;
    }

    const fallbackReason = typeof row.fallback_reason === 'string' ? row.fallback_reason : null;
    const isSkyCompass = row.mode_entered === 'sky_compass';
    if (isSkyCompass) skyCompassSessions += 1;
    if (fallbackReason || isSkyCompass) {
      fallbackSessions += 1;
      dayStats.fallback += 1;
    }
    if (fallbackReason) {
      fallbackReasons[fallbackReason] = (fallbackReasons[fallbackReason] ?? 0) + 1;
    }

    const quality = typeof row.trajectory_quality === 'number' && Number.isFinite(row.trajectory_quality) ? row.trajectory_quality : null;
    if (quality != null) {
      const q = Math.max(0, Math.min(3, Math.round(quality)));
      if (q === 0) q0 += 1;
      else if (q === 1) q1 += 1;
      else if (q === 2) q2 += 1;
      else if (q === 3) q3 += 1;
      if (q >= 1) {
        trajectorySessions += 1;
        dayStats.trajectory += 1;
        const contractTier = typeof row.contract_tier === 'string' ? row.contract_tier.toUpperCase() : '';
        if (contractTier === 'A' || contractTier === 'B') {
          contractTierABSessions += 1;
        }
      }
    }

    const sigmaDeg = typeof row.avg_sigma_deg === 'number' && Number.isFinite(row.avg_sigma_deg) ? row.avg_sigma_deg : null;
    if (sigmaDeg != null) {
      sigmaReportedSessions += 1;
      dayStats.sigmaReported += 1;
      if (sigmaDeg <= sigmaGoodThresholdDeg) {
        sigmaGoodSessions += 1;
        dayStats.sigmaGood += 1;
      }
    }

    trendByDay.set(day, dayStats);
  }

  const trend = Array.from(trendByDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, value]) => ({
      day,
      sessions: value.sessions,
      lockAttemptRate: safeRate(value.attempted, value.sessions),
      lockAcquisitionRate: safeRate(value.acquired, value.attempted),
      fallbackRate: safeRate(value.fallback, value.sessions),
      sigmaGoodRate: safeRate(value.sigmaGood, value.sigmaReported),
      trajectoryCoverageRate: safeRate(value.trajectory, value.sessions)
    }));

  const sessions = rows.length;
  const runtimePolicies = summarizeArRuntimePolicies(rows, { sampleLimit });
  const completeness = summarizeTrajectoryAccuracyCompleteness(rows);
  return {
    windowDays,
    windowStart,
    sampledSessions: sessions,
    sampleLimit,
    truncated: sessions >= sampleLimit,
    lock: {
      attempted,
      acquired,
      attemptRate: safeRate(attempted, sessions),
      acquisitionRate: safeRate(acquired, attempted),
      avgLossCount: lockLossSamples > 0 ? lockLossSum / lockLossSamples : null,
      autoModeSessions,
      manualDebugSessions,
      timeToLockBuckets
    },
    fallback: {
      sessions: fallbackSessions,
      rate: safeRate(fallbackSessions, sessions),
      skyCompassSessions,
      reasons: fallbackReasons
    },
    precision: {
      trajectorySessions,
      trajectoryCoverageRate: safeRate(trajectorySessions, sessions),
      sigmaReportedSessions,
      sigmaGoodSessions,
      sigmaGoodRate: safeRate(sigmaGoodSessions, sigmaReportedSessions),
      sigmaGoodThresholdDeg,
      contractTierABSessions,
      contractTierABRate: safeRate(contractTierABSessions, trajectorySessions),
      qualityBuckets: {
        q0,
        q1,
        q2,
        q3
      }
    },
    completeness,
    trend,
    runtimePolicies
  };
}

function hasFilledText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasFilledNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value);
}

function ratio(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function inferTelemetryRuntimeFamily(row: {
  runtime_family: string | null;
  release_profile: string | null;
  client_profile: string | null;
  client_env: string | null;
  pose_mode: string | null;
}) {
  if (row.runtime_family === 'web' || row.runtime_family === 'ios_native' || row.runtime_family === 'android_native') {
    return row.runtime_family;
  }
  if (hasFilledText(row.release_profile)) {
    if (row.release_profile!.startsWith('ios_native_')) return 'ios_native' as const;
    if (row.release_profile!.startsWith('android_native_')) return 'android_native' as const;
    return 'web' as const;
  }
  if (hasFilledText(row.client_profile) || hasFilledText(row.client_env) || row.pose_mode === 'webxr') {
    return 'web' as const;
  }
  return 'unknown' as const;
}

function summarizeTrajectoryAccuracyCompleteness(
  rows: Array<{
    runtime_family: string | null;
    client_profile: string | null;
    client_env: string | null;
    release_profile: string | null;
    location_fix_state: string | null;
    alignment_ready: boolean | null;
    heading_status: string | null;
    pose_mode: string | null;
    vision_backend: string | null;
    mode_entered: string | null;
    time_to_usable_ms: number | null;
  }>
): TrajectoryPipelineFreshness['accuracy']['completeness'] {
  const fieldDefs = [
    {
      key: 'runtime_family',
      label: 'Runtime family',
      scope: 'all' as const,
      isFilled: (row: (typeof rows)[number]) => hasFilledText(row.runtime_family)
    },
    {
      key: 'release_profile',
      label: 'Release profile',
      scope: 'all' as const,
      isFilled: (row: (typeof rows)[number]) => hasFilledText(row.release_profile)
    },
    {
      key: 'mode_entered',
      label: 'Mode entered',
      scope: 'all' as const,
      isFilled: (row: (typeof rows)[number]) => hasFilledText(row.mode_entered)
    },
    {
      key: 'pose_mode',
      label: 'Pose mode',
      scope: 'all' as const,
      isFilled: (row: (typeof rows)[number]) => hasFilledText(row.pose_mode)
    },
    {
      key: 'vision_backend',
      label: 'Vision backend',
      scope: 'all' as const,
      isFilled: (row: (typeof rows)[number]) => hasFilledText(row.vision_backend)
    },
    {
      key: 'heading_status',
      label: 'Heading status',
      scope: 'all' as const,
      isFilled: (row: (typeof rows)[number]) => hasFilledText(row.heading_status)
    },
    {
      key: 'time_to_usable_ms',
      label: 'Time to usable',
      scope: 'all' as const,
      isFilled: (row: (typeof rows)[number]) => hasFilledNumber(row.time_to_usable_ms)
    },
    {
      key: 'client_profile',
      label: 'Client profile',
      scope: 'web' as const,
      isFilled: (row: (typeof rows)[number]) => hasFilledText(row.client_profile)
    },
    {
      key: 'location_fix_state',
      label: 'Location fix state',
      scope: 'native' as const,
      isFilled: (row: (typeof rows)[number]) => hasFilledText(row.location_fix_state)
    },
    {
      key: 'alignment_ready',
      label: 'Alignment ready',
      scope: 'native' as const,
      isFilled: (row: (typeof rows)[number]) => typeof row.alignment_ready === 'boolean'
    }
  ];

  const fieldAppliesToRuntime = (
    scope: 'all' | 'web' | 'native',
    runtimeFamily: 'web' | 'ios_native' | 'android_native' | 'unknown'
  ) => {
    if (scope === 'all') return true;
    if (scope === 'web') return runtimeFamily === 'web';
    return runtimeFamily === 'ios_native' || runtimeFamily === 'android_native';
  };

  const summarizeFields = (subset: typeof rows) =>
    fieldDefs
      .map((field) => {
        let applicableSessions = 0;
        let filledSessions = 0;
        for (const row of subset) {
          const runtimeFamily = inferTelemetryRuntimeFamily(row);
          if (!fieldAppliesToRuntime(field.scope, runtimeFamily)) continue;
          applicableSessions += 1;
          if (field.isFilled(row)) filledSessions += 1;
        }
        return {
          key: field.key,
          label: field.label,
          applicableSessions,
          filledSessions,
          fillRate: safeRate(filledSessions, applicableSessions)
        };
      })
      .filter((field) => field.applicableSessions > 0);

  const fields = summarizeFields(rows);
  const requiredFieldValues = fields.reduce((sum, field) => sum + field.applicableSessions, 0);
  const filledFieldValues = fields.reduce((sum, field) => sum + field.filledSessions, 0);
  const runtimeFamilies = (['web', 'ios_native', 'android_native', 'unknown'] as const)
    .map((runtimeFamily) => {
      const familyRows = rows.filter((row) => inferTelemetryRuntimeFamily(row) === runtimeFamily);
      return {
        runtimeFamily,
        sessions: familyRows.length,
        fields: summarizeFields(familyRows)
      };
    })
    .filter((runtimeFamily) => runtimeFamily.sessions > 0);

  return {
    requiredFieldValues,
    filledFieldValues,
    overallFillRate: safeRate(filledFieldValues, requiredFieldValues),
    fields,
    runtimeFamilies
  };
}

function findLatestSuccessfulRun(
  runs: Array<{ job_name?: string | null; ended_at?: string | null; success?: boolean | null; stats?: Record<string, unknown> | null }>,
  jobName: string
) {
  for (const row of runs) {
    if (row?.job_name !== jobName) continue;
    if (!row?.ended_at) continue;
    if (row?.success !== true) continue;
    return row;
  }
  for (const row of runs) {
    if (row?.job_name !== jobName) continue;
    if (!row?.ended_at) continue;
    return row;
  }
  return null;
}

function clampIntValue(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampNumberValue(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function safeRate(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function normalizeIsoDay(iso: string | null) {
  const parsed = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(parsed)) return 'unknown';
  return new Date(parsed).toISOString().slice(0, 10);
}

function mapSettingRows(rows: Array<{ key: string; value: unknown }> | null) {
  const merged: Record<string, unknown> = {};
  (rows || []).forEach((row) => {
    merged[row.key] = row.value;
  });
  return merged;
}

function formatManagedCadenceLabel(intervalSeconds: number) {
  if (intervalSeconds % (7 * 24 * 60 * 60) === 0) {
    const weeks = intervalSeconds / (7 * 24 * 60 * 60);
    return `Every ${weeks} week${weeks === 1 ? '' : 's'}`;
  }
  if (intervalSeconds % (24 * 60 * 60) === 0) {
    const days = intervalSeconds / (24 * 60 * 60);
    return `Every ${days} day${days === 1 ? '' : 's'}`;
  }
  if (intervalSeconds % (60 * 60) === 0) {
    const hours = intervalSeconds / (60 * 60);
    return `Every ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (intervalSeconds % 60 === 0) {
    const minutes = intervalSeconds / 60;
    return `Every ${minutes} min`;
  }
  return `Every ${intervalSeconds} sec`;
}

function resolveJobSchedule(job: JobDef, cronSchedule: string | null) {
  if (job.cadenceLabelPolicy !== 'managed' || !cronSchedule) return job.cadenceLabel;
  const match = /^managed\/(\d+)s offset (\d+)s$/.exec(cronSchedule);
  if (!match) return job.cadenceLabel;
  const intervalSeconds = Number(match[1]);
  return Number.isFinite(intervalSeconds) ? formatManagedCadenceLabel(intervalSeconds) : job.cadenceLabel;
}

async function loadJobStatuses(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  settings: Record<string, unknown>,
  cronJobs: CronJobInfo[]
) {
  const jobsEnabled = readBooleanSetting(settings.jobs_enabled, false);
  const now = Date.now();
  const cronByName = new Map(cronJobs.map((job) => [job.jobname, job]));

  const localDefs = loadLocalJobDefs();
  const jobDefs = [...ADMIN_JOB_REGISTRY, ...localDefs];

  const ingestionJobNames = Array.from(
    new Set(
      jobDefs
        .filter((job) => job.source === 'ingestion_runs')
        .map((job) => job.telemetryJobName || job.id)
        .filter(Boolean) as string[]
    )
  );

  const recentRunsByJobName = await loadRecentRunsByJobName(supabase, ingestionJobNames);
  const ws45LiveWindow = await loadWs45LiveWindowStatus(supabase);

  const joinDetails = (...parts: Array<string | null | undefined>) => {
    const items = parts
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter((part) => part.length > 0);
    if (!items.length) return null;
    return Array.from(new Set(items)).join(' • ');
  };

  return jobDefs.map((job) => {
    const enabledKey = job.enabledKey;
    const jobEnabled = enabledKey ? readBooleanSetting(settings[enabledKey], true) : true;
    const schedulerActive = job.origin === 'local' || job.category === 'manual' ? true : jobsEnabled;
    const isEnabled = schedulerActive && jobEnabled;
    const cronJobName = job.origin === 'server' ? (job.cronJobName ?? null) : null;

    const cron = job.origin === 'server' && job.cronJobName ? (cronByName.get(job.cronJobName) ?? null) : null;
    const cronActive = cron ? Boolean(cron.active) : null;
    const cronSchedule = cron ? cron.schedule : null;
    const isManagedCron = Boolean(cron?.command && cron.command.includes('managed_scheduler_tick'));
    const schedule = resolveJobSchedule(job, cronSchedule);

    const cronMismatchDetail = (() => {
      if (!cronJobName || !schedulerActive || isManagedCron) return null;
      if (!cron) return jobEnabled ? 'Enabled in settings but cron missing' : null;
      if (jobEnabled && cronActive === false) return 'Enabled in settings but cron paused';
      if (!jobEnabled && cronActive === true) return 'Disabled in settings but cron active';
      return null;
    })();

    let enabledDetail = !schedulerActive ? 'Scheduler disabled' : !jobEnabled ? 'Disabled' : null;
    if (job.id === 'll2_payload_backfill') {
      const spacecraftOnly = readBooleanSetting(settings.ll2_payload_backfill_spacecraft_only, false);
      if (spacecraftOnly) {
        enabledDetail = enabledDetail ? `${enabledDetail} (spacecraft-only)` : 'Spacecraft-only';
      }
    }

    if (job.source === 'heartbeat') {
      const lastSuccessAt = readStringSetting(settings.ll2_incremental_last_success_at);
      const lastError = readStringSetting(settings.ll2_incremental_last_error);
      const lastNewDataAt = readStringSetting(settings.ll2_incremental_last_new_data_at);
      const lastNewDataCount = readNumberSetting(settings.ll2_incremental_last_new_data_count, 0);

      const ageMinutes =
        lastSuccessAt && Number.isFinite(Date.parse(lastSuccessAt))
          ? computeAgeMinutes(lastSuccessAt, now)
          : null;
      const isStale =
        ageMinutes != null &&
        Number.isFinite(ageMinutes) &&
        job.thresholdMinutes != null &&
        ageMinutes > job.thresholdMinutes;

      let status: JobStatus['status'] = 'unknown';
      let statusDetail: string | null = null;

      if (!isEnabled) {
        status = cronMismatchDetail ? 'degraded' : 'paused';
        statusDetail = cronMismatchDetail ?? enabledDetail;
      } else if (!lastSuccessAt && !lastError) {
        status = 'unknown';
        statusDetail = 'No telemetry yet';
      } else if (lastError) {
        status = 'down';
        statusDetail = 'Last run failed';
      } else if (isStale) {
        status = 'degraded';
        statusDetail = `Last success ${Math.round(ageMinutes ?? 0)}m ago`;
      } else {
        status = 'operational';
      }

      if (cronMismatchDetail && status !== 'down') {
        status = 'degraded';
        statusDetail = joinDetails(statusDetail, cronMismatchDetail);
      }

      return {
        id: job.id,
        label: job.label,
        schedule,
        slug: job.slug ?? null,
        cronJobName,
        cronSchedule,
        cronActive,
        schedulerKind: job.schedulerKind,
        group: job.group,
        origin: job.origin,
        category: job.category,
        enabled: isEnabled,
        enabledDetail,
        status,
        statusDetail,
        manualRunSupported: job.manualRunSupported,
        manualRunConfirmMessage: job.manualRunConfirmMessage ?? null,
        manualRunPrompt: job.manualRunPrompt ?? null,
        manualRunPromptToken: job.manualRunPromptToken ?? null,
        telemetryJobName: null,
        lastSuccessAt: lastSuccessAt || null,
        lastNewDataAt: lastNewDataAt || null,
        lastNewDataDetail: lastNewDataAt && lastNewDataCount ? `upserted=${lastNewDataCount}` : null,
        lastError: lastError || null
      } satisfies JobStatus;
    }

    if (job.source === 'none') {
      let status: JobStatus['status'] = 'unknown';
      let statusDetail: string | null = null;

      if (!isEnabled) {
        status = cronMismatchDetail ? 'degraded' : 'paused';
        statusDetail = cronMismatchDetail ?? enabledDetail;
      } else if (job.origin === 'local') {
        status = 'unknown';
        statusDetail = 'Run locally';
      } else if (job.cronJobName && cronActive === false) {
        status = cronMismatchDetail ? 'degraded' : 'paused';
        statusDetail = cronMismatchDetail ?? 'Cron paused';
      } else if (job.cronJobName && !cron) {
        status = 'down';
        statusDetail = 'Cron missing';
      } else {
        status = 'operational';
        statusDetail = 'Scheduler configured';
      }

      if (cronMismatchDetail && status !== 'down') {
        status = 'degraded';
        statusDetail = joinDetails(statusDetail, cronMismatchDetail);
      }

      return {
        id: job.id,
        label: job.label,
        schedule,
        slug: job.slug ?? null,
        cronJobName,
        cronSchedule,
        cronActive,
        schedulerKind: job.schedulerKind,
        group: job.group,
        origin: job.origin,
        category: job.category,
        enabled: isEnabled,
        enabledDetail,
        status,
        statusDetail,
        manualRunSupported: job.manualRunSupported,
        manualRunConfirmMessage: job.manualRunConfirmMessage ?? null,
        manualRunPrompt: job.manualRunPrompt ?? null,
        manualRunPromptToken: job.manualRunPromptToken ?? null,
        telemetryJobName: null,
        command: job.command ?? null
      } satisfies JobStatus;
    }

    const ingestionJobName = job.telemetryJobName || job.id;
    const runs = recentRunsByJobName[ingestionJobName] || [];
    const lastRun = runs[0] ?? null;

    const lastRunAt = lastRun?.started_at ?? null;
    const lastEndedAt = lastRun?.ended_at ?? null;
    const lastError = lastRun?.error ?? null;
    const durationSeconds = computeDurationSeconds(lastRun?.started_at, lastRun?.ended_at);

    const lastSuccess = runs.find((r) => r.success === true && Boolean(r.ended_at)) ?? null;
    const lastSuccessAt = lastSuccess?.ended_at ?? null;

    const lastNewData = findLastNewDataRun(runs, job);
    const lastNewDataAt = lastNewData?.ended_at ?? null;
    const lastNewDataDetail = lastNewData ? extractNewDataDetail(lastNewData.stats, job) : null;

    const consecutiveFailures = computeConsecutiveFailures(runs);

    const lastEndTimestamp = Date.parse(lastRun?.ended_at || lastRun?.started_at || '');
    const ageMinutes = Number.isFinite(lastEndTimestamp) ? (now - lastEndTimestamp) / (1000 * 60) : null;
    const effectiveThresholdMinutes =
      job.id === 'ws45_live_weather_ingest' && ws45LiveWindow.active && ws45LiveWindow.cadenceMinutes != null
        ? Math.max(job.thresholdMinutes ?? 0, ws45LiveWindow.cadenceMinutes * 2)
        : job.thresholdMinutes;
    const isStale = effectiveThresholdMinutes != null && ageMinutes != null && ageMinutes > effectiveThresholdMinutes;

    let status: JobStatus['status'] = 'unknown';
    let statusDetail: string | null = null;

    if (!isEnabled) {
      status = cronMismatchDetail ? 'degraded' : 'paused';
      statusDetail = cronMismatchDetail ?? enabledDetail;
    } else if (job.cronJobName && cronActive === false) {
      status = cronMismatchDetail ? 'degraded' : 'paused';
      statusDetail = cronMismatchDetail ?? 'Cron paused';
    } else if (job.cronJobName && !cron) {
      status = 'down';
      statusDetail = 'Cron missing';
    } else if (!lastRun) {
      status = 'unknown';
      statusDetail = 'No telemetry yet';
    } else if (!lastRun.ended_at) {
      status = 'running';
      statusDetail = 'In progress';
    } else if (lastRun.success === false) {
      status = 'down';
      statusDetail = consecutiveFailures != null && consecutiveFailures > 1 ? `${consecutiveFailures} failures in a row` : 'Last run failed';
    } else if (isStale) {
      status = 'degraded';
      statusDetail = `Last run ${Math.round(ageMinutes ?? 0)}m ago`;
    } else {
      status = 'operational';
    }

    if (
      job.id === 'ws45_live_weather_ingest' &&
      isEnabled &&
      !ws45LiveWindow.active &&
      status !== 'down' &&
      status !== 'running'
    ) {
      status = 'operational';
      statusDetail =
        ws45LiveWindow.reason === 'no_launch_within_24h'
          ? 'Standby: no Florida launch within 24h'
          : 'Standby: outside live cadence window';
    }

    if (cronMismatchDetail && status !== 'down') {
      status = 'degraded';
      statusDetail = joinDetails(statusDetail, cronMismatchDetail);
    }

    return {
      id: job.id,
      label: job.label,
      schedule,
      slug: job.slug ?? null,
      cronJobName,
      cronSchedule,
      cronActive,
      schedulerKind: job.schedulerKind,
      group: job.group,
      origin: job.origin,
      category: job.category,
      enabled: isEnabled,
      enabledDetail,
      status,
      statusDetail,
      manualRunSupported: job.manualRunSupported,
      manualRunConfirmMessage: job.manualRunConfirmMessage ?? null,
      manualRunPrompt: job.manualRunPrompt ?? null,
      manualRunPromptToken: job.manualRunPromptToken ?? null,
      telemetryJobName: job.source === 'ingestion_runs' ? job.telemetryJobName || job.id : null,
      lastRunAt,
      lastEndedAt,
      lastSuccessAt,
      lastNewDataAt,
      lastNewDataDetail,
      lastError,
      lastDurationSeconds: durationSeconds,
      consecutiveFailures,
      command: job.command ?? null
    } satisfies JobStatus;
  });
}

function readBooleanSetting(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const cleaned = value.trim().toLowerCase();
    if (cleaned === 'true') return true;
    if (cleaned === 'false') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

function readStringSetting(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

function readNumberSetting(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function computeAgeMinutes(iso: string, nowMs: number) {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return (nowMs - parsed) / (1000 * 60);
}

function computeDurationSeconds(startedAt?: string | null, endedAt?: string | null) {
  if (!startedAt || !endedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 1000);
}

function readNumber(stats: unknown, key: string) {
  if (!stats || typeof stats !== 'object') return null;
  const parts = key.split('.').filter(Boolean);
  let cursor: any = stats as any;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object') return null;
    cursor = cursor[part];
  }
  const value = cursor;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function loadLocalJobDefs(): JobDef[] {
  const scripts = readPackageScripts();
  const jobScriptNames = Object.keys(scripts)
    .filter(isJobScriptName)
    .sort((a, b) => a.localeCompare(b));

  return jobScriptNames.map((name) => ({
    id: `local:${name}`,
    label: formatLocalJobLabel(name),
    cadenceLabel: 'Manual (local)',
    cadenceLabelPolicy: 'static',
    slug: null,
    cronJobName: null,
    schedulerKind: 'manual',
    group: 'advanced',
    category: 'manual',
    origin: 'local',
    source: 'none',
    thresholdMinutes: null,
    dispatcherGate: 'ungated',
    manualRunSupported: false,
    command: `npm run ${name}`
  }));
}

function readPackageScripts(): Record<string, string> {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const json = JSON.parse(raw) as any;
    const scripts = json?.scripts && typeof json.scripts === 'object' ? (json.scripts as Record<string, unknown>) : {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(scripts)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function isJobScriptName(name: string) {
  return (
    name.startsWith('ingest:') ||
    name.startsWith('cache:') ||
    name.startsWith('trajectory:') ||
    name.startsWith('backfill:') ||
    name.startsWith('dispatch:')
  );
}

function formatLocalJobLabel(name: string) {
  const cleaned = name.replace(/[:_]+/g, ' ').trim();
  const words = cleaned.split(/\s+/g);
  const normalized = words
    .map((word) => {
      const upper = word.toUpperCase();
      if (upper === 'LL2' || upper === 'SNAPI' || upper === 'WS45' || upper === 'NWS') return upper;
      if (upper === 'PG') return 'Postgres';
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');

  return normalized || name;
}

async function loadRecentRunsByJobName(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  ingestionJobNames: string[]
): Promise<Record<string, IngestionRun[]>> {
  if (!ingestionJobNames.length) return {};

  const { data, error } = await supabase.rpc('get_ingestion_runs_recent', {
    job_names: ingestionJobNames,
    per_job: 25
  });

  if (error) {
    console.warn('admin get_ingestion_runs_recent error', error.message);
    return {};
  }

  const runs = Array.isArray(data) ? (data as IngestionRun[]) : [];
  const grouped: Record<string, IngestionRun[]> = {};
  for (const run of runs) {
    const jobName = String(run?.job_name || '').trim();
    if (!jobName) continue;
    (grouped[jobName] ||= []).push(run);
  }
  return grouped;
}

async function loadWs45LiveWindowStatus(
  supabase: ReturnType<typeof createSupabaseServerClient>
): Promise<Ws45LiveWindowStatus> {
  const nowIso = new Date().toISOString();
  const horizonIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('launches_public_cache')
    .select('launch_id, name, mission_name, net, window_start')
    .eq('pad_state', 'FL')
    .gte('net', nowIso)
    .lte('net', horizonIso)
    .order('net', { ascending: true })
    .limit(8);

  if (error) {
    console.warn('admin ws45 live window status error', error.message);
    return {
      active: false,
      reason: 'no_launch_within_24h',
      cadenceMinutes: null,
      launchId: null,
      launchName: null,
      launchAt: null
    };
  }

  const launches = (Array.isArray(data) ? data : [])
    .map((row) => ({
      launchId: typeof row?.launch_id === 'string' ? row.launch_id : null,
      launchName:
        (typeof row?.name === 'string' && row.name.trim()) ||
        (typeof row?.mission_name === 'string' && row.mission_name.trim()) ||
        null,
      launchAt:
        (typeof row?.window_start === 'string' && row.window_start) ||
        (typeof row?.net === 'string' && row.net) ||
        null
    }))
    .filter((row) => row.launchAt)
    .sort((left, right) => {
      const leftMs = Date.parse(String(left.launchAt || ''));
      const rightMs = Date.parse(String(right.launchAt || ''));
      return (Number.isFinite(leftMs) ? leftMs : Number.MAX_SAFE_INTEGER) - (Number.isFinite(rightMs) ? rightMs : Number.MAX_SAFE_INTEGER);
    });

  const nextLaunch = launches[0] ?? null;
  if (!nextLaunch) {
    return {
      active: false,
      reason: 'no_launch_within_24h',
      cadenceMinutes: null,
      launchId: null,
      launchName: null,
      launchAt: null
    };
  }

  const cadenceMinutes = getWs45LiveCadenceMinutes(nextLaunch.launchAt);
  if (cadenceMinutes == null) {
    return {
      active: false,
      reason: 'launch_outside_cadence_window',
      cadenceMinutes: null,
      launchId: nextLaunch.launchId,
      launchName: nextLaunch.launchName,
      launchAt: nextLaunch.launchAt
    };
  }

  return {
    active: true,
    reason: 'active',
    cadenceMinutes,
    launchId: nextLaunch.launchId,
    launchName: nextLaunch.launchName,
    launchAt: nextLaunch.launchAt
  };
}

function computeConsecutiveFailures(runs: IngestionRun[]) {
  let failures = 0;
  for (const run of runs) {
    if (!run.ended_at) break;
    if (run.success === false) {
      failures += 1;
      continue;
    }
    if (run.success === true) break;
    break;
  }
  return failures || null;
}

function findLastNewDataRun(runs: IngestionRun[], job: JobDef) {
  for (const run of runs) {
    if (!run.ended_at) continue;
    if (run.success !== true) continue;
    const count = extractNewDataCount(run.stats, job);
    if (count > 0) return run;
  }
  return null;
}

function extractNewDataCount(stats: unknown, job: JobDef) {
  if (job.newData) {
    try {
      return job.newData(stats).count;
    } catch {
      return 0;
    }
  }

  const candidates = ['upserted', 'inserted', 'updated', 'deleted', 'processed', 'queued', 'sent'];
  return candidates.reduce((sum, key) => sum + (readNumber(stats, key) ?? 0), 0);
}

function extractNewDataDetail(stats: unknown, job: JobDef) {
  if (job.newData) {
    try {
      return job.newData(stats).detail;
    } catch {
      return null;
    }
  }
  return null;
}
