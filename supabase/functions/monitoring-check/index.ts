import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  getLl2IncrementalHeartbeatThresholdMinutes,
  resolveLaunchRefreshCadence
} from '../_shared/launchRefreshPolicy.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting, readStringArraySetting, readStringSetting } from '../_shared/settings.ts';
import { getWs45LiveCadenceMinutes } from '../../../shared/ws45LiveBoard.ts';

const JOB_THRESHOLDS_MINUTES: Record<string, number> = {
  nws_refresh: 60,
  public_cache_refresh: 60,
  ll2_catalog: 240,
  ll2_catalog_agencies: 96 * 60,
  ll2_future_launch_sync: 1440,
  ws45_forecasts_ingest: 600,
  ws45_live_weather_ingest: 90,
  ws45_planning_forecast_ingest: 360,
  ws45_weather_retention_cleanup: 2160,
  notifications_dispatch: 10,
  notifications_send: 5,
  social_posts_dispatch: 90,

  navcen_bnm_ingest: 180,
  faa_trajectory_hazard_ingest: 180,
  spacex_infographics_ingest: 1560,
  trajectory_orbit_ingest: 720,
  trajectory_constraints_ingest: 720,
  trajectory_products_generate: 720,
  trajectory_templates_generate: 1560,

  celestrak_gp_groups_sync: 2160,
  celestrak_supgp_sync: 90,
  celestrak_supgp_ingest: 90,
  celestrak_ingest: 420,
  celestrak_retention_cleanup: 2160
};
const JOB_ENABLED_SETTING_KEYS: Record<string, string> = {
  notifications_dispatch: 'notifications_dispatch_job_enabled',
  notifications_send: 'notifications_send_job_enabled',

  ll2_catalog: 'll2_catalog_job_enabled',
  ll2_catalog_agencies: 'll2_catalog_agencies_job_enabled',
  ll2_future_launch_sync: 'll2_future_launch_sync_job_enabled',
  ws45_live_weather_ingest: 'ws45_live_weather_job_enabled',
  ws45_planning_forecast_ingest: 'ws45_planning_forecast_job_enabled',
  ws45_weather_retention_cleanup: 'ws45_weather_retention_cleanup_enabled',
  navcen_bnm_ingest: 'navcen_bnm_job_enabled',
  faa_trajectory_hazard_ingest: 'faa_trajectory_hazard_job_enabled',
  spacex_infographics_ingest: 'spacex_infographics_job_enabled',
  trajectory_orbit_ingest: 'trajectory_orbit_job_enabled',
  trajectory_constraints_ingest: 'trajectory_constraints_job_enabled',
  trajectory_products_generate: 'trajectory_products_job_enabled',
  trajectory_templates_generate: 'trajectory_templates_job_enabled',

  celestrak_gp_groups_sync: 'celestrak_gp_groups_sync_enabled',
  celestrak_supgp_sync: 'celestrak_supgp_sync_enabled',
  celestrak_supgp_ingest: 'celestrak_supgp_job_enabled',
  celestrak_ingest: 'celestrak_ingest_job_enabled',
  celestrak_retention_cleanup: 'celestrak_retention_cleanup_enabled'
};
const JOB_CRON_MISMATCH_SUFFIX = '_cron_enabled_mismatch';
const DEFAULT_IGNORED_JOBS: string[] = [];

const CELESTRAK_DATASET_STALE_HOURS: Record<string, number> = {
  gp: 24,
  satcat: 48,
  supgp: 24
};

const TRAJECTORY_SOURCE_FRESHNESS_DEFAULTS = {
  enabled: true,
  orbitMaxAgeHours: 12,
  landingMaxAgeHours: 12,
  hazardMaxAgeHours: 3
};

const TRAJECTORY_SOURCE_ALERT_KEYS = [
  'trajectory_products_missing_for_eligible',
  'trajectory_products_precision_stale',
  'trajectory_source_orbit_stale',
  'trajectory_source_landing_stale',
  'trajectory_source_hazard_stale'
] as const;

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'monitoring_check');
  const stats: Record<string, unknown> = {};

  try {
    const jobEnabledSettingKeys = [...new Set(Object.values(JOB_ENABLED_SETTING_KEYS))].filter(Boolean);
    const settings = await getSettings(supabase, [
      'jobs_enabled',
      'jobs_ignore',
      'll2_incremental_last_success_at',
      'll2_incremental_last_error',
      'trajectory_products_top3_ids',
      'trajectory_source_freshness_alerts_enabled',
      'trajectory_freshness_orbit_max_age_hours',
      'trajectory_freshness_landing_max_age_hours',
      'trajectory_freshness_hazard_max_age_hours',
      ...jobEnabledSettingKeys
    ]);

    let jobsEnabledUpdatedAtMs = NaN;
    try {
      const { data: jobsEnabledRow } = await supabase
        .from('system_settings')
        .select('updated_at')
        .eq('key', 'jobs_enabled')
        .maybeSingle();
      const updatedAtIso = jobsEnabledRow?.updated_at ? String(jobsEnabledRow.updated_at) : '';
      jobsEnabledUpdatedAtMs = updatedAtIso ? Date.parse(updatedAtIso) : NaN;
    } catch {
      jobsEnabledUpdatedAtMs = NaN;
    }

    const ignoredJobs = new Set([
      ...DEFAULT_IGNORED_JOBS,
      ...readStringArraySetting(settings.jobs_ignore, [])
    ].filter(Boolean));

    const jobsEnabled = readBooleanSetting(settings.jobs_enabled, false);
    stats.jobsEnabled = jobsEnabled;
    stats.jobsEnabledUpdatedAt = Number.isFinite(jobsEnabledUpdatedAtMs) ? new Date(jobsEnabledUpdatedAtMs).toISOString() : null;
    stats.ignoredJobs = [...ignoredJobs];
    if (!jobsEnabled) {
      await upsertAlert(supabase, {
        key: 'jobs_disabled',
        severity: 'info',
        message: 'Supabase scheduled jobs are disabled.',
        details: { jobs_enabled: jobsEnabled }
      });
      await resolveJobAlerts(supabase, ['ll2_incremental', ...Object.keys(JOB_THRESHOLDS_MINUTES), ...ignoredJobs]);
      await resolveCronEnablementAlerts(supabase, Object.keys(JOB_ENABLED_SETTING_KEYS));
      await resolveTrajectorySourceAlerts(supabase);
      await finishIngestionRun(supabase, runId, true, { ...stats, disabled: true });
      return jsonResponse({ ok: true, disabled: true });
    }

    await resolveAlert(supabase, 'jobs_disabled');

    if (ignoredJobs.size) {
      await resolveJobAlerts(supabase, [...ignoredJobs]);
    }

    if (!ignoredJobs.has('ll2_incremental')) {
      const ll2Cadence = await resolveLaunchRefreshCadence(supabase, Date.now());
      const ll2HeartbeatThresholdMinutes = getLl2IncrementalHeartbeatThresholdMinutes(ll2Cadence.recommendedIntervalSeconds);
      stats.ll2IncrementalCadence = ll2Cadence;
      stats.ll2IncrementalHeartbeatThresholdMinutes = ll2HeartbeatThresholdMinutes;
      await checkLl2IncrementalHeartbeat(supabase, {
        lastSuccessAt: readStringSetting(settings.ll2_incremental_last_success_at, ''),
        lastError: readStringSetting(settings.ll2_incremental_last_error, ''),
        thresholdMinutes: ll2HeartbeatThresholdMinutes
      });
    } else {
      await resolveJobAlerts(supabase, ['ll2_incremental']);
    }

    const disabledJobs = new Set<string>();
    for (const job of Object.keys(JOB_THRESHOLDS_MINUTES)) {
      const enabledKey = JOB_ENABLED_SETTING_KEYS[job];
      if (!enabledKey) continue;
      const jobEnabled = readBooleanSetting(settings[enabledKey], true);
      if (!jobEnabled) disabledJobs.add(job);
    }

    if (disabledJobs.size) {
      const disabled = [...disabledJobs];
      stats.disabledJobs = disabled;
      await resolveJobAlerts(supabase, disabled);
    }

    try {
      stats.cronEnablement = await checkCronEnablementConsistency(supabase, {
        settings,
        jobsEnabled
      });
    } catch (err) {
      stats.cronEnablementError = stringifyError(err);
    }

    const jobNames = Object.keys(JOB_THRESHOLDS_MINUTES).filter((job) => !ignoredJobs.has(job) && !disabledJobs.has(job));
    stats.checkedJobs = jobNames.length;
    if (jobNames.length === 0) {
      await finishIngestionRun(supabase, runId, true, { ...stats, ignoredOnly: true });
      return jsonResponse({ ok: true, ignored: [...ignoredJobs] });
    }

    let ws45LiveWindow: Ws45LiveWindowContext | null = null;
    if (jobNames.includes('ws45_live_weather_ingest')) {
      try {
        ws45LiveWindow = await loadWs45LiveWindowContext(supabase);
        stats.ws45LiveWindow = ws45LiveWindow;
      } catch (err) {
        stats.ws45LiveWindowError = stringifyError(err);
      }
    }

    const lastByJob: Record<string, any> = {};
    for (const job of jobNames) {
      const { data: last, error: lastError } = await supabase
        .from('ingestion_runs')
        .select('job_name, started_at, ended_at, success, error')
        .eq('job_name', job)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastError) throw new Error(lastError.message);
      if (last) lastByJob[job] = last;
    }

    const now = Date.now();

    for (const job of jobNames) {
      const last = lastByJob[job];
      let threshold = JOB_THRESHOLDS_MINUTES[job] ?? 60;

      if (job === 'ws45_live_weather_ingest') {
        const activeLiveWindow = ws45LiveWindow;
        if (activeLiveWindow && !activeLiveWindow.active) {
          await resolveJobAlerts(supabase, [job]);
          continue;
        }
        if (activeLiveWindow?.cadenceMinutes != null) {
          threshold = Math.max(threshold, activeLiveWindow.cadenceMinutes * 2);
        }
      }

      if (!last) {
        const enabledAgeMinutes = Number.isFinite(jobsEnabledUpdatedAtMs) ? (now - jobsEnabledUpdatedAtMs) / (1000 * 60) : Infinity;
        if (enabledAgeMinutes > threshold) {
          await upsertAlert(supabase, {
            key: `${job}_stale`,
            severity: 'warning',
            message: `No recent run found for ${job}.`,
            details: { job }
          });
        } else {
          await resolveAlert(supabase, `${job}_stale`);
        }
        await resolveAlert(supabase, `${job}_failed`);
        continue;
      }

      const lastEnd = Date.parse(last.ended_at || last.started_at);
      const ageMinutes = Number.isFinite(lastEnd) ? (now - lastEnd) / (1000 * 60) : Infinity;

      if (last.success === false) {
        await upsertAlert(supabase, {
          key: `${job}_failed`,
          severity: 'critical',
          message: `${job} last run failed.`,
          details: { job, error: last.error || null, started_at: last.started_at, ended_at: last.ended_at }
        });
      } else {
        await resolveAlert(supabase, `${job}_failed`);
      }

      if (ageMinutes > threshold) {
        await upsertAlert(supabase, {
          key: `${job}_stale`,
          severity: 'warning',
          message: `${job} has not completed in ${Math.round(ageMinutes)} minutes.`,
          details: { job, ageMinutes, thresholdMinutes: threshold, started_at: last.started_at, ended_at: last.ended_at }
        });
      } else {
        await resolveAlert(supabase, `${job}_stale`);
      }
    }

    try {
      stats.celestrakDatasets = await checkCelestrakDatasets(supabase);
    } catch (err) {
      stats.celestrakDatasetsError = stringifyError(err);
    }

    try {
      stats.ws45Forecasts = await checkWs45ForecastJoins(supabase);
    } catch (err) {
      stats.ws45ForecastsError = stringifyError(err);
    }

    try {
      stats.trajectorySourceFreshness = await checkTrajectorySourceFreshness(supabase, {
        enabled: readBooleanSetting(
          settings.trajectory_source_freshness_alerts_enabled,
          TRAJECTORY_SOURCE_FRESHNESS_DEFAULTS.enabled
        ),
        launchIds: readStringArraySetting(settings.trajectory_products_top3_ids, []),
        orbitMaxAgeHours: clampInt(
          readNumberSetting(settings.trajectory_freshness_orbit_max_age_hours, TRAJECTORY_SOURCE_FRESHNESS_DEFAULTS.orbitMaxAgeHours),
          1,
          168
        ),
        landingMaxAgeHours: clampInt(
          readNumberSetting(settings.trajectory_freshness_landing_max_age_hours, TRAJECTORY_SOURCE_FRESHNESS_DEFAULTS.landingMaxAgeHours),
          1,
          168
        ),
        hazardMaxAgeHours: clampInt(
          readNumberSetting(settings.trajectory_freshness_hazard_max_age_hours, TRAJECTORY_SOURCE_FRESHNESS_DEFAULTS.hazardMaxAgeHours),
          1,
          168
        )
      });
    } catch (err) {
      stats.trajectorySourceFreshnessError = stringifyError(err);
    }

    await finishIngestionRun(supabase, runId, true, { ...stats, elapsedMs: Date.now() - startedAt });
    return jsonResponse({ ok: true });
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, { ...stats, error: message }, message);
    return jsonResponse({ ok: false, error: message }, 500);
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

async function upsertAlert(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    key,
    severity,
    message,
    details
  }: {
    key: string;
    severity: 'info' | 'warning' | 'critical';
    message: string;
    details?: Record<string, unknown>;
  }
) {
  const now = new Date().toISOString();
  const { data } = await supabase.from('ops_alerts').select('id, occurrences').eq('key', key).maybeSingle();

  if (!data) {
    const { error } = await supabase.from('ops_alerts').insert({
      key,
      severity,
      message,
      details: details || null,
      first_seen_at: now,
      last_seen_at: now,
      occurrences: 1,
      resolved: false,
      resolved_at: null
    });
    if (error) console.warn('ops_alerts insert error', error.message);
    return;
  }

  const { error } = await supabase
    .from('ops_alerts')
    .update({
      severity,
      message,
      details: details || null,
      last_seen_at: now,
      occurrences: (data.occurrences || 0) + 1,
      resolved: false,
      resolved_at: null
    })
    .eq('key', key);

  if (error) console.warn('ops_alerts update error', error.message);
}

async function resolveAlert(supabase: ReturnType<typeof createSupabaseAdminClient>, key: string) {
  const { error } = await supabase
    .from('ops_alerts')
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq('key', key)
    .eq('resolved', false);

  if (error) console.warn('ops_alerts resolve error', error.message);
}

async function resolveJobAlerts(supabase: ReturnType<typeof createSupabaseAdminClient>, jobs: string[]) {
  const unique = [...new Set(jobs)].filter(Boolean);
  for (const job of unique) {
    await resolveAlert(supabase, `${job}_failed`);
    await resolveAlert(supabase, `${job}_stale`);
  }
}

async function resolveCronEnablementAlerts(supabase: ReturnType<typeof createSupabaseAdminClient>, jobs: string[]) {
  const unique = [...new Set(jobs)].filter(Boolean);
  for (const job of unique) {
    await resolveAlert(supabase, `${job}${JOB_CRON_MISMATCH_SUFFIX}`);
  }
}

async function checkCronEnablementConsistency(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    settings,
    jobsEnabled
  }: {
    settings: Record<string, unknown>;
    jobsEnabled: boolean;
  }
) {
  const trackedJobs = Object.keys(JOB_ENABLED_SETTING_KEYS);
  if (!jobsEnabled) {
    await resolveCronEnablementAlerts(supabase, trackedJobs);
    return {
      checked: 0,
      mismatches: 0,
      disabled: true
    };
  }

  const { data: cronRows, error: cronError } = await supabase.rpc('get_all_cron_jobs');
  if (cronError) {
    throw new Error(`cron_mismatch_check_failed: ${cronError.message}`);
  }

  const cronByName = new Map<string, { active: boolean; schedule: string | null }>();
  for (const row of ((cronRows as Array<{ jobname?: string; active?: boolean; schedule?: string }> | null) || [])) {
    const jobName = typeof row?.jobname === 'string' ? row.jobname : '';
    if (!jobName) continue;
    cronByName.set(jobName, {
      active: Boolean(row.active),
      schedule: typeof row?.schedule === 'string' ? row.schedule : null
    });
  }

  const mismatches: Array<{
    job: string;
    enabledKey: string;
    settingEnabled: boolean;
    cronPresent: boolean;
    cronActive: boolean | null;
    schedule: string | null;
    state: 'enabled_but_cron_missing' | 'enabled_but_cron_paused' | 'disabled_but_cron_active';
  }> = [];

  for (const jobName of trackedJobs) {
    const enabledKey = JOB_ENABLED_SETTING_KEYS[jobName];
    const settingEnabled = readBooleanSetting(settings[enabledKey], true);
    const cron = cronByName.get(jobName) ?? null;
    const alertKey = `${jobName}${JOB_CRON_MISMATCH_SUFFIX}`;

    if (!cron) {
      if (settingEnabled) {
        mismatches.push({
          job: jobName,
          enabledKey,
          settingEnabled,
          cronPresent: false,
          cronActive: null,
          schedule: null,
          state: 'enabled_but_cron_missing'
        });
        await upsertAlert(supabase, {
          key: alertKey,
          severity: 'critical',
          message: `${jobName} is enabled in system_settings but no cron job exists.`,
          details: {
            job: jobName,
            enabledKey,
            settingEnabled,
            cronPresent: false
          }
        });
      } else {
        await resolveAlert(supabase, alertKey);
      }
      continue;
    }

    if (settingEnabled === cron.active) {
      await resolveAlert(supabase, alertKey);
      continue;
    }

    const state = settingEnabled ? 'enabled_but_cron_paused' : 'disabled_but_cron_active';
    mismatches.push({
      job: jobName,
      enabledKey,
      settingEnabled,
      cronPresent: true,
      cronActive: cron.active,
      schedule: cron.schedule ?? null,
      state
    });

    await upsertAlert(supabase, {
      key: alertKey,
      severity: 'warning',
      message:
        state === 'enabled_but_cron_paused'
          ? `${jobName} is enabled in system_settings but cron is paused.`
          : `${jobName} is disabled in system_settings but cron is still active.`,
      details: {
        job: jobName,
        enabledKey,
        settingEnabled,
        cronPresent: true,
        cronActive: cron.active,
        schedule: cron.schedule ?? null,
        mismatchState: state
      }
    });
  }

  return {
    checked: trackedJobs.length,
    mismatches: mismatches.length,
    mismatchJobs: mismatches.map((entry) => entry.job),
    rows: mismatches
  };
}

async function checkWs45ForecastJoins(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const recentStartIso = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString();
  const horizonEndIso = new Date(nowMs + 14 * 24 * 60 * 60 * 1000).toISOString();

  const [recentRes, launchesRes, coverageRes, latestRunRes] = await Promise.all([
    supabase
      .from('ws45_launch_forecasts')
      .select(
        'id,pdf_url,source_label,mission_name,forecast_kind,issued_at,fetched_at,valid_start,valid_end,match_status,match_confidence,document_family,parse_status,publish_eligible,required_fields_missing,quarantine_reasons,matched_launch_id,parse_version'
      )
      .gte('fetched_at', recentStartIso)
      .order('fetched_at', { ascending: false })
      .limit(100),
    supabase
      .from('launches')
      .select('id,name,net,window_start,window_end,pad_name,pad_short_code,pad_state')
      .eq('hidden', false)
      .eq('pad_state', 'FL')
      .gte('net', nowIso)
      .lte('net', horizonEndIso)
      .order('net', { ascending: true })
      .limit(25),
    supabase
      .from('ws45_launch_forecasts')
      .select('id,matched_launch_id,source_label,issued_at,valid_start,valid_end,match_status,match_confidence,publish_eligible,fetched_at,parse_version')
      .eq('publish_eligible', true)
      .eq('match_status', 'matched')
      .order('issued_at', { ascending: false })
      .order('fetched_at', { ascending: false })
      .limit(100),
    supabase
      .from('ingestion_runs')
      .select('started_at, ended_at, success, error, stats')
      .eq('job_name', 'ws45_forecasts_ingest')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  if (recentRes.error) throw recentRes.error;
  if (launchesRes.error) throw launchesRes.error;
  if (coverageRes.error) throw coverageRes.error;
  if (latestRunRes.error) throw latestRunRes.error;

  const recent = ((recentRes.data as any[] | null) ?? []).filter((row) => String(row?.forecast_kind || '') !== 'faq');
  const upcomingLaunches = (launchesRes.data as any[] | null) ?? [];
  const coverageRows = (coverageRes.data as any[] | null) ?? [];
  const coverageByLaunch = new Map<string, any>();
  for (const row of coverageRows) {
    const launchId = typeof row?.matched_launch_id === 'string' ? row.matched_launch_id : '';
    if (!launchId || coverageByLaunch.has(launchId)) continue;
    coverageByLaunch.set(launchId, row);
  }

  const missingIssued = recent.filter((row) => !row?.issued_at);
  const missingValidWindow = recent.filter((row) => !row?.valid_start || !row?.valid_end);
  const parseRequiredFieldsMissing = recent.filter((row) => {
    const fields = Array.isArray(row?.required_fields_missing) ? row.required_fields_missing : [];
    return fields.length > 0 || String(row?.parse_status || '') !== 'parsed';
  });
  const unknownShape = recent.filter((row) => String(row?.document_family || '') === 'unknown_family');
  const unmatchedUpcoming = recent.filter((row) => {
    const validEnd = row?.valid_end ? Date.parse(String(row.valid_end)) : NaN;
    return String(row?.match_status || '') === 'unmatched' && (!Number.isFinite(validEnd) || validEnd > nowMs);
  });
  const ambiguousUpcoming = recent.filter((row) => {
    const validEnd = row?.valid_end ? Date.parse(String(row.valid_end)) : NaN;
    return String(row?.match_status || '') === 'ambiguous' && (!Number.isFinite(validEnd) || validEnd > nowMs);
  });
  const publishEligibleCount = recent.filter((row) => Boolean(row?.publish_eligible)).length;
  const parseCompleteCount = recent.filter((row) => String(row?.parse_status || '') === 'parsed').length;
  const parseCompleteRate = recent.length ? parseCompleteCount / recent.length : 1;
  const publishEligibleRate = recent.length ? publishEligibleCount / recent.length : 1;

  const coverageGaps = upcomingLaunches.filter((launch) => !coverageByLaunch.has(String((launch as any).id || '')));

  const latestRun = latestRunRes.data as Record<string, any> | null;
  const latestRunErrors = Array.isArray(latestRun?.stats?.errors) ? (latestRun?.stats?.errors as Array<Record<string, any>>) : [];
  const hasWs45FetchError =
    latestRun?.success === false ||
    latestRunErrors.some((entry) => /ws45_(?:waf|html|pdf)/i.test(String(entry?.error || ''))) ||
    /ws45_(?:waf|html|pdf)/i.test(String(latestRun?.error || ''));
  const pdfsFound = Number(latestRun?.stats?.pdfsFound || 0);
  const forecastPdfsFound = Number(latestRun?.stats?.forecastPdfsFound ?? pdfsFound);
  const faqPdfsFound = Number(latestRun?.stats?.faqPdfsFound || 0);

  if (hasWs45FetchError) {
    await upsertAlert(supabase, {
      key: 'ws45_source_fetch_failed',
      severity: 'critical',
      message: '45 WS source fetch or PDF retrieval failed during the latest ingest.',
      details: {
        started_at: latestRun?.started_at ?? null,
        ended_at: latestRun?.ended_at ?? null,
        error: latestRun?.error ?? null,
        errors: latestRunErrors.slice(0, 10)
      }
    });
  } else {
    await resolveAlert(supabase, 'ws45_source_fetch_failed');
  }

  if (!hasWs45FetchError && forecastPdfsFound === 0) {
    await upsertAlert(supabase, {
      key: 'ws45_source_empty',
      severity: 'warning',
      message: '45 WS source page returned no launch forecast PDFs.',
      details: {
        started_at: latestRun?.started_at ?? null,
        ended_at: latestRun?.ended_at ?? null,
        pdfsFound,
        forecastPdfsFound,
        faqPdfsFound
      }
    });
  } else {
    await resolveAlert(supabase, 'ws45_source_empty');
  }

  await upsertOrResolveCountAlert(supabase, {
    key: 'ws45_parse_missing_issued',
    severity: 'warning',
    message: 'Recent 45 WS forecasts are missing issued times.',
    count: missingIssued.length,
    rows: missingIssued
  });

  await upsertOrResolveCountAlert(supabase, {
    key: 'ws45_parse_missing_valid_window',
    severity: 'critical',
    message: 'Recent 45 WS forecasts are missing valid windows.',
    count: missingValidWindow.length,
    rows: missingValidWindow
  });

  await upsertOrResolveCountAlert(supabase, {
    key: 'ws45_parse_required_fields_missing',
    severity: 'warning',
    message: 'Recent 45 WS forecasts failed required-field parsing or validation.',
    count: parseRequiredFieldsMissing.length,
    rows: parseRequiredFieldsMissing
  });

  await upsertOrResolveCountAlert(supabase, {
    key: 'ws45_shape_unknown_detected',
    severity: 'warning',
    message: 'Recent 45 WS forecasts used an unknown document family.',
    count: unknownShape.length,
    rows: unknownShape
  });

  await upsertOrResolveCountAlert(supabase, {
    key: 'ws45_match_unmatched_upcoming',
    severity: 'warning',
    message: '45 WS forecast PDF not matched to any upcoming launch.',
    count: unmatchedUpcoming.length,
    rows: unmatchedUpcoming
  });

  await upsertOrResolveCountAlert(supabase, {
    key: 'ws45_match_ambiguous_upcoming',
    severity: 'warning',
    message: '45 WS forecast PDF matched ambiguously to an upcoming launch.',
    count: ambiguousUpcoming.length,
    rows: ambiguousUpcoming
  });

  await upsertOrResolveCountAlert(supabase, {
    key: 'ws45_florida_launch_coverage_gap',
    severity: 'critical',
    message: 'Upcoming Florida launch lacks a publish-eligible 45 WS forecast.',
    count: coverageGaps.length,
    rows: coverageGaps
  });

  if (parseCompleteRate < 0.99 || publishEligibleRate < 0.98) {
    await upsertAlert(supabase, {
      key: 'ws45_success_rate_degraded',
      severity: 'warning',
      message: '45 WS parse completeness or publish eligibility has degraded.',
      details: {
        recentCount: recent.length,
        parseCompleteRate,
        publishEligibleRate,
        parseCompleteCount,
        publishEligibleCount
      }
    });
  } else {
    await resolveAlert(supabase, 'ws45_success_rate_degraded');
  }

  await resolveAlert(supabase, 'ws45_forecasts_unmatched_upcoming');

  return {
    recentCount: recent.length,
    parseCompleteCount,
    publishEligibleCount,
    parseCompleteRate,
    publishEligibleRate,
    sourcePdfCount: pdfsFound,
    sourceForecastPdfCount: forecastPdfsFound,
    sourceFaqPdfCount: faqPdfsFound,
    sourceFetchError: hasWs45FetchError,
    sourceEmptyTriggered: !hasWs45FetchError && forecastPdfsFound === 0,
    missingIssuedCount: missingIssued.length,
    missingValidWindowCount: missingValidWindow.length,
    unknownShapeCount: unknownShape.length,
    unmatchedUpcomingCount: unmatchedUpcoming.length,
    ambiguousUpcomingCount: ambiguousUpcoming.length,
    upcomingFloridaLaunches: upcomingLaunches.length,
    coverageGapCount: coverageGaps.length
  };
}

async function upsertOrResolveCountAlert(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    key,
    severity,
    message,
    count,
    rows
  }: {
    key: string;
    severity: 'info' | 'warning' | 'critical';
    message: string;
    count: number;
    rows: any[];
  }
) {
  if (count > 0) {
    await upsertAlert(supabase, {
      key,
      severity,
      message,
      details: {
        count,
        rows: rows.map((row) => ({
          id: row?.id ?? null,
          source_label: row?.source_label ?? null,
          mission_name: row?.mission_name ?? row?.name ?? null,
          fetched_at: row?.fetched_at ?? null,
          issued_at: row?.issued_at ?? null,
          valid_start: row?.valid_start ?? row?.window_start ?? null,
          valid_end: row?.valid_end ?? row?.window_end ?? null,
          match_status: row?.match_status ?? null,
          match_confidence: row?.match_confidence ?? null,
          parse_status: row?.parse_status ?? null,
          publish_eligible: row?.publish_eligible ?? null,
          document_family: row?.document_family ?? null,
          parse_version: row?.parse_version ?? null,
          pdf_url: row?.pdf_url ?? null
        }))
      }
    });
  } else {
    await resolveAlert(supabase, key);
  }
}

async function checkCelestrakDatasets(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { data, error } = await supabase
    .from('celestrak_datasets')
    .select(
      'dataset_key, dataset_type, code, label, enabled, created_at, last_success_at, consecutive_failures, last_http_status, last_error'
    );

  if (error) throw error;

  const now = Date.now();
  let total = 0;
  let enabledCount = 0;
  let failures = 0;
  let stale = 0;

  for (const row of data || []) {
    total += 1;

    const datasetKey = String((row as any).dataset_key || '');
    const datasetType = String((row as any).dataset_type || '');
    const code = String((row as any).code || datasetKey);
    const label = String((row as any).label || code);
    const isEnabled = Boolean((row as any).enabled);

    const keyBase = `celestrak_${datasetType}_${normalizeAlertKeyPart(code || datasetKey || 'unknown')}`;
    const failedKey = `${keyBase}_failed`;
    const staleKey = `${keyBase}_stale`;

    if (!isEnabled) {
      await resolveAlert(supabase, failedKey);
      await resolveAlert(supabase, staleKey);
      continue;
    }

    enabledCount += 1;

    const consecutive = clampInt(Number((row as any).consecutive_failures || 0), 0, 999999);
    const httpStatus = Number((row as any).last_http_status || 0) || null;
    const lastError = (row as any).last_error ? String((row as any).last_error) : '';

    if (consecutive > 0) {
      failures += 1;
      const severity = consecutive >= 3 ? 'critical' : 'warning';
      await upsertAlert(supabase, {
        key: failedKey,
        severity,
        message: `CelesTrak dataset failed: ${datasetType}:${label}`,
        details: {
          dataset_key: datasetKey,
          dataset_type: datasetType,
          code,
          failures: consecutive,
          last_http_status: httpStatus,
          last_error: lastError || null
        }
      });
    } else {
      await resolveAlert(supabase, failedKey);
    }

    const thresholdHours = CELESTRAK_DATASET_STALE_HOURS[datasetType] ?? 24;
    const referenceIso = (row as any).last_success_at || (row as any).created_at || null;
    const refMs = referenceIso ? Date.parse(String(referenceIso)) : NaN;
    const ageHours = Number.isFinite(refMs) ? (now - refMs) / (1000 * 60 * 60) : Infinity;

    if (ageHours > thresholdHours) {
      stale += 1;
      await upsertAlert(supabase, {
        key: staleKey,
        severity: 'warning',
        message: `CelesTrak dataset stale: ${datasetType}:${label}`,
        details: {
          dataset_key: datasetKey,
          dataset_type: datasetType,
          code,
          ageHours,
          thresholdHours,
          last_success_at: (row as any).last_success_at || null
        }
      });
    } else {
      await resolveAlert(supabase, staleKey);
    }
  }

  return { total, enabled: enabledCount, failures, stale };
}

async function resolveTrajectorySourceAlerts(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  for (const key of TRAJECTORY_SOURCE_ALERT_KEYS) {
    await resolveAlert(supabase, key);
  }
}

async function checkTrajectorySourceFreshness(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    enabled,
    launchIds,
    orbitMaxAgeHours,
    landingMaxAgeHours,
    hazardMaxAgeHours
  }: {
    enabled: boolean;
    launchIds: string[];
    orbitMaxAgeHours: number;
    landingMaxAgeHours: number;
    hazardMaxAgeHours: number;
  }
) {
  if (!enabled) {
    await resolveTrajectorySourceAlerts(supabase);
    return { enabled: false };
  }

  const ids = Array.from(new Set((launchIds || []).filter(Boolean)));
  if (!ids.length) {
    await resolveTrajectorySourceAlerts(supabase);
    return { enabled: true, checkedLaunches: 0, reason: 'no_eligible_launches' };
  }

  const { data: launchRows, error: launchError } = await supabase
    .from('launches_public_cache')
    .select('launch_id,name,net')
    .in('launch_id', ids);
  if (launchError) throw launchError;

  const { data: products, error: productsError } = await supabase
    .from('launch_trajectory_products')
    .select('launch_id,quality,freshness_state,generated_at')
    .in('launch_id', ids);
  if (productsError) throw productsError;

  const { data: constraints, error: constraintsError } = await supabase
    .from('launch_trajectory_constraints')
    .select('launch_id,constraint_type,fetched_at')
    .in('launch_id', ids)
    .in('constraint_type', ['target_orbit', 'landing', 'hazard_area']);
  if (constraintsError) throw constraintsError;
  const sourcePollFreshness = await loadTrajectorySourcePollFreshness(supabase);

  const launchMeta = new Map<string, { name: string | null; net: string | null }>();
  for (const row of (launchRows as any[] | null) || []) {
    const launchId = typeof row?.launch_id === 'string' ? row.launch_id : null;
    if (!launchId) continue;
    launchMeta.set(launchId, {
      name: typeof row?.name === 'string' ? row.name : null,
      net: typeof row?.net === 'string' ? row.net : null
    });
  }

  const productsByLaunch = new Map<string, any>();
  for (const row of (products as any[] | null) || []) {
    const launchId = typeof row?.launch_id === 'string' ? row.launch_id : null;
    if (!launchId) continue;
    productsByLaunch.set(launchId, row);
  }

  const missingProductIds = ids.filter((launchId) => !productsByLaunch.has(launchId));
  if (missingProductIds.length) {
    await upsertAlert(supabase, {
      key: 'trajectory_products_missing_for_eligible',
      severity: 'critical',
      message: 'Missing trajectory products for one or more eligible launches.',
      details: { count: missingProductIds.length, launchIds: missingProductIds }
    });
  } else {
    await resolveAlert(supabase, 'trajectory_products_missing_for_eligible');
  }

  const stalePrecisionProducts = [];
  for (const [launchId, row] of productsByLaunch.entries()) {
    const quality = Number(row?.quality);
    const freshnessState = typeof row?.freshness_state === 'string' ? row.freshness_state : 'unknown';
    if (!Number.isFinite(quality) || quality < 1) continue;
    if (freshnessState !== 'stale') continue;
    stalePrecisionProducts.push({
      launchId,
      quality,
      freshnessState,
      generatedAt: row?.generated_at ?? null,
      name: launchMeta.get(launchId)?.name ?? null,
      net: launchMeta.get(launchId)?.net ?? null
    });
  }
  if (stalePrecisionProducts.length) {
    await upsertAlert(supabase, {
      key: 'trajectory_products_precision_stale',
      severity: 'warning',
      message: 'Trajectory precision products are stale for eligible launches.',
      details: { count: stalePrecisionProducts.length, launches: stalePrecisionProducts }
    });
  } else {
    await resolveAlert(supabase, 'trajectory_products_precision_stale');
  }

  const constraintRows = (constraints as any[] | null) || [];
  const orbitBreaches = collectTrajectorySourceBreaches({
    ids,
    launchMeta,
    rows: constraintRows,
    constraintType: 'target_orbit',
    thresholdHours: orbitMaxAgeHours,
    successfulPollSeenMs: sourcePollFreshness.target_orbit
  });
  const landingBreaches = collectTrajectorySourceBreaches({
    ids,
    launchMeta,
    rows: constraintRows,
    constraintType: 'landing',
    thresholdHours: landingMaxAgeHours,
    successfulPollSeenMs: sourcePollFreshness.landing
  });
  const hazardBreaches = collectTrajectorySourceBreaches({
    ids,
    launchMeta,
    rows: constraintRows,
    constraintType: 'hazard_area',
    thresholdHours: hazardMaxAgeHours,
    successfulPollSeenMs: sourcePollFreshness.hazard_area
  });

  await upsertOrResolveSourceAlert(supabase, {
    key: 'trajectory_source_orbit_stale',
    message: 'Target orbit constraints are stale for eligible launches.',
    thresholdHours: orbitMaxAgeHours,
    breaches: orbitBreaches.breaches
  });
  await upsertOrResolveSourceAlert(supabase, {
    key: 'trajectory_source_landing_stale',
    message: 'Landing constraints are stale for eligible launches.',
    thresholdHours: landingMaxAgeHours,
    breaches: landingBreaches.breaches
  });
  await upsertOrResolveSourceAlert(supabase, {
    key: 'trajectory_source_hazard_stale',
    message: 'Hazard constraints are stale for eligible launches.',
    thresholdHours: hazardMaxAgeHours,
    breaches: hazardBreaches.breaches
  });

  return {
    enabled: true,
    checkedLaunches: ids.length,
    missingProducts: missingProductIds.length,
    stalePrecisionProducts: stalePrecisionProducts.length,
    orbit: {
      thresholdHours: orbitMaxAgeHours,
      launchesWithData: orbitBreaches.launchesWithData,
      staleLaunches: orbitBreaches.breaches.length,
      successfulPollSeenAt: orbitBreaches.successfulPollSeenAt
    },
    landing: {
      thresholdHours: landingMaxAgeHours,
      launchesWithData: landingBreaches.launchesWithData,
      staleLaunches: landingBreaches.breaches.length,
      successfulPollSeenAt: landingBreaches.successfulPollSeenAt
    },
    hazard: {
      thresholdHours: hazardMaxAgeHours,
      launchesWithData: hazardBreaches.launchesWithData,
      staleLaunches: hazardBreaches.breaches.length,
      successfulPollSeenAt: hazardBreaches.successfulPollSeenAt
    }
  };
}

function collectTrajectorySourceBreaches({
  ids,
  launchMeta,
  rows,
  constraintType,
  thresholdHours,
  successfulPollSeenMs
}: {
  ids: string[];
  launchMeta: Map<string, { name: string | null; net: string | null }>;
  rows: any[];
  constraintType: 'target_orbit' | 'landing' | 'hazard_area';
  thresholdHours: number;
  successfulPollSeenMs: number | null;
}) {
  const idSet = new Set(ids);
  const newestByLaunch = new Map<string, number>();
  for (const row of rows) {
    const launchId = typeof row?.launch_id === 'string' ? row.launch_id : null;
    if (!launchId || !idSet.has(launchId)) continue;
    if (String(row?.constraint_type || '') !== constraintType) continue;
    const fetchedMs = Date.parse(String(row?.fetched_at || ''));
    if (!Number.isFinite(fetchedMs)) continue;
    const prev = newestByLaunch.get(launchId);
    if (prev == null || fetchedMs > prev) newestByLaunch.set(launchId, fetchedMs);
  }

  const nowMs = Date.now();
  const pollSeenMs =
    typeof successfulPollSeenMs === 'number' && Number.isFinite(successfulPollSeenMs) ? successfulPollSeenMs : null;
  const breaches = [];
  for (const launchId of ids) {
    const newestMs = newestByLaunch.get(launchId) ?? null;
    const effectiveNewestMs =
      newestMs != null && pollSeenMs != null ? Math.max(newestMs, pollSeenMs) : newestMs != null ? newestMs : pollSeenMs;
    if (effectiveNewestMs == null) continue;

    const ageHours = (nowMs - effectiveNewestMs) / (1000 * 60 * 60);
    if (!(ageHours > thresholdHours)) continue;
    breaches.push({
      launchId,
      ageHours,
      thresholdHours,
      freshestAt: new Date(effectiveNewestMs).toISOString(),
      materialFreshestAt: newestMs != null ? new Date(newestMs).toISOString() : null,
      successfulPollSeenAt: pollSeenMs != null ? new Date(pollSeenMs).toISOString() : null,
      name: launchMeta.get(launchId)?.name ?? null,
      net: launchMeta.get(launchId)?.net ?? null
    });
  }

  return {
    launchesWithData: newestByLaunch.size,
    successfulPollSeenAt: pollSeenMs != null ? new Date(pollSeenMs).toISOString() : null,
    breaches
  };
}

async function loadTrajectorySourcePollFreshness(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const jobNames = [
    'trajectory_orbit_ingest',
    'trajectory_constraints_ingest',
    'navcen_bnm_ingest',
    'faa_trajectory_hazard_ingest'
  ];

  const { data, error } = await supabase
    .from('ingestion_runs')
    .select('job_name, started_at, ended_at, success')
    .in('job_name', jobNames)
    .eq('success', true)
    .order('ended_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  const newestByJob = new Map<string, number>();
  for (const row of (data as any[] | null) || []) {
    const jobName = typeof row?.job_name === 'string' ? row.job_name : null;
    if (!jobName || newestByJob.has(jobName)) continue;
    const endedMs = Date.parse(String(row?.ended_at || row?.started_at || ''));
    if (!Number.isFinite(endedMs)) continue;
    newestByJob.set(jobName, endedMs);
  }

  const newestFor = (names: string[]) => {
    let newest = Number.NEGATIVE_INFINITY;
    for (const name of names) {
      const value = newestByJob.get(name);
      if (value != null && value > newest) newest = value;
    }
    return Number.isFinite(newest) ? newest : null;
  };

  return {
    target_orbit: newestFor(['trajectory_orbit_ingest']),
    landing: newestFor(['trajectory_constraints_ingest']),
    hazard_area: newestFor(['navcen_bnm_ingest', 'faa_trajectory_hazard_ingest'])
  };
}

async function upsertOrResolveSourceAlert(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    key,
    message,
    thresholdHours,
    breaches
  }: {
    key: (typeof TRAJECTORY_SOURCE_ALERT_KEYS)[number];
    message: string;
    thresholdHours: number;
    breaches: Array<{
      launchId: string;
      ageHours: number;
      thresholdHours: number;
      freshestAt: string;
      materialFreshestAt?: string | null;
      successfulPollSeenAt?: string | null;
      name: string | null;
      net: string | null;
    }>;
  }
) {
  if (!breaches.length) {
    await resolveAlert(supabase, key);
    return;
  }

  await upsertAlert(supabase, {
    key,
    severity: 'warning',
    message,
    details: {
      count: breaches.length,
      thresholdHours,
      launches: breaches.map((row) => ({
        ...row,
        ageHours: Number(row.ageHours.toFixed(2))
      }))
    }
  });
}

function normalizeAlertKeyPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '');
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

async function checkLl2IncrementalHeartbeat(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    lastSuccessAt,
    lastError,
    thresholdMinutes
  }: {
    lastSuccessAt: string;
    lastError: string;
    thresholdMinutes: number;
  }
) {
  const now = Date.now();
  const lastSuccessMs = Date.parse(lastSuccessAt);
  const ageMinutes = Number.isFinite(lastSuccessMs) ? (now - lastSuccessMs) / (1000 * 60) : Infinity;

  if (lastError.trim()) {
    await upsertAlert(supabase, {
      key: 'll2_incremental_failed',
      severity: 'critical',
      message: 'll2_incremental last run failed.',
      details: { error: lastError.trim(), lastSuccessAt: lastSuccessAt || null }
    });
  } else {
    await resolveAlert(supabase, 'll2_incremental_failed');
  }

  if (ageMinutes > thresholdMinutes) {
    await upsertAlert(supabase, {
      key: 'll2_incremental_stale',
      severity: 'warning',
      message: `ll2_incremental has not reported success in ${Math.round(ageMinutes)} minutes.`,
      details: { ageMinutes, thresholdMinutes, lastSuccessAt: lastSuccessAt || null }
    });
  } else {
    await resolveAlert(supabase, 'll2_incremental_stale');
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

type Ws45LiveWindowContext = {
  active: boolean;
  reason: 'active' | 'no_launch_within_24h' | 'launch_outside_cadence_window';
  cadenceMinutes: number | null;
  launchId: string | null;
  launchName: string | null;
  launchAt: string | null;
};

async function loadWs45LiveWindowContext(supabase: ReturnType<typeof createSupabaseAdminClient>): Promise<Ws45LiveWindowContext> {
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

  if (error) throw error;

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

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') return JSON.stringify(err);
  return String(err);
}
