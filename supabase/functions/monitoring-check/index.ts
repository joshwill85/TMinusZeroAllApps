import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting, readStringArraySetting, readStringSetting } from '../_shared/settings.ts';

const JOB_THRESHOLDS_MINUTES: Record<string, number> = {
  nws_refresh: 60,
  public_cache_refresh: 60,
  ll2_catalog: 240,
  ll2_catalog_agencies: 96 * 60,
  ws45_forecasts_ingest: 180,
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
  celestrak_ingest: 420,
  celestrak_retention_cleanup: 2160
};
const JOB_ENABLED_SETTING_KEYS: Record<string, string> = {
  notifications_dispatch: 'notifications_dispatch_job_enabled',
  notifications_send: 'notifications_send_job_enabled',

  ll2_catalog: 'll2_catalog_job_enabled',
  ll2_catalog_agencies: 'll2_catalog_agencies_job_enabled',
  navcen_bnm_ingest: 'navcen_bnm_job_enabled',
  faa_trajectory_hazard_ingest: 'faa_trajectory_hazard_job_enabled',
  spacex_infographics_ingest: 'spacex_infographics_job_enabled',
  trajectory_orbit_ingest: 'trajectory_orbit_job_enabled',
  trajectory_constraints_ingest: 'trajectory_constraints_job_enabled',
  trajectory_products_generate: 'trajectory_products_job_enabled',
  trajectory_templates_generate: 'trajectory_templates_job_enabled',

  celestrak_gp_groups_sync: 'celestrak_gp_groups_sync_enabled',
  celestrak_ingest: 'celestrak_ingest_job_enabled',
  celestrak_retention_cleanup: 'celestrak_retention_cleanup_enabled'
};
const JOB_CRON_MISMATCH_SUFFIX = '_cron_enabled_mismatch';
const DEFAULT_IGNORED_JOBS: string[] = [];
const LL2_INCREMENTAL_HEARTBEAT_THRESHOLD_MINUTES = 2;

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
      await checkLl2IncrementalHeartbeat(supabase, {
        lastSuccessAt: readStringSetting(settings.ll2_incremental_last_success_at, ''),
        lastError: readStringSetting(settings.ll2_incremental_last_error, ''),
        thresholdMinutes: LL2_INCREMENTAL_HEARTBEAT_THRESHOLD_MINUTES
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
      const threshold = JOB_THRESHOLDS_MINUTES[job] ?? 60;

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
  const { data, error } = await supabase
    .from('ws45_launch_forecasts')
    .select('id, pdf_url, source_label, mission_name, forecast_kind, issued_at, fetched_at, valid_start, valid_end, match_status, match_confidence')
    .in('match_status', ['unmatched', 'ambiguous'])
    .order('issued_at', { ascending: false })
    .order('fetched_at', { ascending: false })
    .limit(20);

  if (error) throw error;

  const forecasts = (data as any[] | null) ?? [];
  const relevant = forecasts.filter((row) => {
    if (String(row?.forecast_kind || '') === 'faq') return false;
    const validEnd = row?.valid_end ? Date.parse(String(row.valid_end)) : NaN;
    if (Number.isFinite(validEnd)) return validEnd > nowMs;
    return true;
  });
  const count = relevant.length;
  const key = 'ws45_forecasts_unmatched_upcoming';

  if (count > 0) {
    await upsertAlert(supabase, {
      key,
      severity: 'warning',
      message: '45 WS forecast PDF not matched to any upcoming launch.',
      details: {
        count,
        forecasts: relevant.map((row) => ({
          id: row.id,
          match_status: row.match_status,
          match_confidence: row.match_confidence,
          source_label: row.source_label,
          mission_name: row.mission_name,
          issued_at: row.issued_at,
          fetched_at: row.fetched_at,
          valid_start: row.valid_start,
          valid_end: row.valid_end,
          pdf_url: row.pdf_url
        }))
      }
    });
  } else {
    await resolveAlert(supabase, key);
  }

  return { unmatchedUpcomingCount: count };
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

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') return JSON.stringify(err);
  return String(err);
}
