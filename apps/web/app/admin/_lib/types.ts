export type IngestionRun = {
  job_name: string;
  started_at: string;
  ended_at?: string | null;
  success?: boolean | null;
  error?: string | null;
  stats?: Record<string, unknown> | null;
};

export type AdminJobSchedulerKind = 'pg_cron' | 'managed' | 'bridge' | 'derived' | 'manual';

export type AdminJobGroup = 'core' | 'secondary' | 'advanced';

export type JobStatus = {
  id: string;
  label: string;
  schedule: string;
  slug?: string | null;
  cronJobName?: string | null;
  cronSchedule?: string | null;
  cronActive?: boolean | null;
  schedulerKind?: AdminJobSchedulerKind;
  group?: AdminJobGroup;
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

export type CronJobInfo = {
  jobname: string;
  schedule: string;
  active: boolean;
  command?: string | null;
};

export type SchedulerSummary = {
  jobsEnabled: boolean;
  jobsBaseUrlSet: boolean;
  jobsApiKeySet: boolean;
  jobsAuthTokenSet: boolean;
  cronJobs: CronJobInfo[];
  cronError: string | null;
};

export type TrajectoryPipelineFreshness = {
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
    runtimePolicies: {
      sampledSessions: number;
      sampleLimit: number;
      truncated: boolean;
      profiles: Array<{
        profile: string;
        defaultPoseMode: 'webxr' | 'sensor_fused';
        recommendedPoseMode: 'webxr' | 'sensor_fused' | null;
        applyInRuntime: boolean;
        confidence: 'low' | 'medium' | 'high';
        fieldReady: boolean;
        sampleCount: number;
        arEnteredSessions: number;
        fallbackSessions: number;
        xrEligibleSessions: number;
        xrUsedSessions: number;
        xrHealthySessions: number;
        smoothSessions: number;
        lowDegradationSessions: number;
        restartFreeArSessions: number;
        lockAttemptedSessions: number;
        lockAcquiredSessions: number;
        lockUsefulSessions: number;
        fastLockSessions: number;
        supportGroupCount: number;
        qualifiedSupportGroupCount: number;
        xrQualifiedSupportGroupCount: number;
        supportGroups: Array<{
          key: string;
          clientEnv: string | null;
          screenBucket: string | null;
          sampleCount: number;
          xrUsedSessions: number;
          xrHealthySessions: number;
          smoothSessions: number;
          lockUsefulSessions: number;
        }>;
        metrics: {
          arEntryRate: number | null;
          fallbackRate: number | null;
          xrHealthyRate: number | null;
          smoothSessionRate: number | null;
          lowDegradationRate: number | null;
          restartFreeArRate: number | null;
          lockAcquireRate: number | null;
          lockUsefulRate: number | null;
          fastLockRate: number | null;
        };
        reasons: string[];
      }>;
      overrides: Array<{
        profile: string;
        poseMode: 'webxr' | 'sensor_fused';
        confidence: 'low' | 'medium' | 'high';
        reasons: string[];
      }>;
    };
  };
};

export type OpsAlert = {
  key: string;
  severity: string;
  message: string;
  first_seen_at: string;
  last_seen_at: string;
  occurrences: number;
  details?: Record<string, unknown> | null;
};

export type AdminSummaryPayload = {
  ingestionRuns: IngestionRun[];
  jobs: JobStatus[];
  outboxCounts: { queued: number; failed: number; sentToday: number };
  trajectoryPipeline: TrajectoryPipelineFreshness | null;
  alerts: OpsAlert[];
  scheduler: SchedulerSummary;
};

export type AdminSummaryMode = 'stub' | 'db';

export type AdminSummaryResponse = {
  mode: AdminSummaryMode;
  summary: AdminSummaryPayload;
  error?: string;
};

export type AdminMetricsSummary = {
  mode: 'db' | 'stub';
  collectedAt: string;
  latestSampleAt: string | null;
  stale: boolean;
  staleMinutes: number | null;
  windowHours: number;
  resolution: '1m' | '5m';
  cards: {
    diskReadBps: number | null;
    diskWriteBps: number | null;
    ioWaitPct: number | null;
    deadlocksPerMin: number | null;
    checkpointWriteMsPerSec: number | null;
    dbSizeMb: number | null;
    fsSizeBytes: number | null;
    fsAvailBytes: number | null;
    fsUsedBytes: number | null;
  };
  notes: string[];
};

export type AdminMetricSeriesPoint = {
  sampledAt: string;
  value: number;
};

export type AdminMetricSeries = {
  metricKey: string;
  points: AdminMetricSeriesPoint[];
};

export type AdminMetricsSeriesResponse = {
  mode: 'db' | 'stub';
  collectedAt: string;
  latestSampleAt: string | null;
  resolution: '1m' | '5m';
  windowHours: number;
  series: AdminMetricSeries[];
};

export type AdminQueryIoOutlier = {
  query: string;
  calls: number;
  total_exec_time: number;
  mean_exec_time: number;
  rows: number;
  shared_blks_hit: number;
  shared_blks_read: number;
  shared_blks_dirtied: number;
  shared_blks_written: number;
  temp_blks_read: number;
  temp_blks_written: number;
};

export type AdminTableWritePressureRow = {
  table_name: string;
  total_writes: number;
  n_tup_ins: number;
  n_tup_upd: number;
  n_tup_del: number;
  n_tup_hot_upd: number;
  n_live_tup: number;
  n_dead_tup: number;
  dead_ratio: number;
  seq_scan: number;
  idx_scan: number;
  last_autovacuum: string | null;
  last_autoanalyze: string | null;
};

export type AdminQueryIoResponse = {
  mode: 'db' | 'stub';
  outliers: AdminQueryIoOutlier[];
  tableWritePressure: AdminTableWritePressureRow[];
};

export type AdminJobIoRow = {
  job: string;
  runs: number;
  successRatePct: number;
  avgMovedPerRun: number;
  p50MovedPerRun: number;
  p95MovedPerRun: number;
  zeroMoveRuns: number;
  zeroMoveRatePct: number;
  last5Moved: number[];
  movementSource: 'explicit' | 'generic';
  sampleKeys: string[];
  error?: string;
};

export type AdminJobIoResponse = {
  mode: 'db' | 'stub';
  sinceIso: string;
  sinceHours: number;
  rows: AdminJobIoRow[];
};

export type AdminSchedulerMetricsJob = {
  cronJobName: string;
  edgeJobSlug: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastEnqueuedAt: string | null;
  lastDispatchedAt: string | null;
  lastError: string | null;
  queued: number;
  sending: number;
  sentWindow: number;
  failedWindow: number;
};

export type AdminSchedulerMetricsSummary = {
  jobsTotal: number;
  jobsEnabled: number;
  queued: number;
  sending: number;
  sentWindow: number;
  failedWindow: number;
  sentTotal: number;
  failedTotal: number;
  oldestQueuedAt: string | null;
  avgLagSeconds: number | null;
  p95LagSeconds: number | null;
};

export type AdminSchedulerMetricsResponse = {
  mode: 'db' | 'stub';
  windowHours: number;
  summary: AdminSchedulerMetricsSummary;
  jobs: AdminSchedulerMetricsJob[];
};
