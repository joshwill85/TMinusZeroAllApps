import { NextResponse } from 'next/server';
import { startOfDay } from 'date-fns';
import fs from 'node:fs';
import path from 'node:path';
import {
  PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS,
  PREMIUM_LAUNCH_HOT_REFRESH_SECONDS
} from '@tminuszero/domain';
import { summarizeArRuntimePolicies, type ArRuntimePolicySummary } from '@/lib/ar/runtimePolicyTelemetry';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured } from '@/lib/server/env';
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
  cronJobName?: string | null;
  cronSchedule?: string | null;
  cronActive?: boolean | null;
  origin: 'server' | 'local';
  category: 'scheduled' | 'manual' | 'internal';
  status: 'operational' | 'degraded' | 'down' | 'paused' | 'running' | 'unknown';
  statusDetail?: string | null;
  enabled: boolean;
  enabledDetail?: string | null;
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

type JobDef = {
  id: string;
  label: string;
  schedule: string;
  cronJobName?: string | null;
  category: 'scheduled' | 'internal' | 'manual';
  origin: 'server' | 'local';
  source: 'heartbeat' | 'ingestion_runs' | 'none';
  thresholdMinutes: number | null;
  ingestionJobName?: string | null;
  enabledKey?: string;
  newData?: (stats: unknown) => { count: number; detail: string | null };
  command?: string | null;
};

const SERVER_JOB_DEFS: readonly JobDef[] = [
  {
    id: 'll2_incremental',
    label: 'LL2 incremental',
    schedule: `Adaptive: every ${Math.trunc(PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS / 60)} min, every ${PREMIUM_LAUNCH_HOT_REFRESH_SECONDS} sec in the hot window`,
    cronJobName: null,
    category: 'scheduled',
    origin: 'server',
    source: 'heartbeat',
    thresholdMinutes: 5,
    enabledKey: 'll2_incremental_job_enabled'
  },
  {
    id: 'ingestion_cycle',
    label: 'Ingestion cycle',
    schedule: 'Every 15 min',
    cronJobName: 'ingestion_cycle',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 60
  },
  {
    id: 'snapi_ingest',
    label: 'SNAPI ingest',
    schedule: 'Via ingestion cycle (15 min)',
    cronJobName: null,
    category: 'internal',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 60,
    newData: (stats) => {
      const items = readNumber(stats, 'uniqueItems') ?? readNumber(stats, 'items') ?? 0;
      return { count: items, detail: items ? `items=${items}` : null };
    }
  },
  {
    id: 'll2_event_ingest',
    label: 'LL2 event ingest',
    schedule: 'Via ingestion cycle (15 min)',
    cronJobName: null,
    category: 'internal',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 60,
    enabledKey: 'll2_event_ingest_enabled',
    newData: (stats) => {
      const upserted = readNumber(stats, 'upserted') ?? 0;
      return { count: upserted, detail: upserted ? `upserted=${upserted}` : null };
    }
  },
  {
    id: 'public_cache_refresh',
    label: 'Public cache refresh',
    schedule: 'Via ingestion cycle (15 min)',
    cronJobName: null,
    category: 'internal',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 60,
    newData: (stats) => {
      const refreshed = readNumber(stats, 'refreshed') ?? 0;
      const removed = readNumber(stats, 'removed') ?? 0;
      const total = refreshed + removed;
      return { count: total, detail: total ? `refreshed=${refreshed}, removed=${removed}` : null };
    }
  },
  {
    id: 'll2_catalog',
    label: 'LL2 catalog',
    schedule: 'Every 2 hours (:37 UTC)',
    cronJobName: 'll2_catalog',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 240,
    enabledKey: 'll2_catalog_job_enabled',
    newData: (stats) => {
      const entities = typeof stats === 'object' && stats && Array.isArray((stats as any).entities) ? ((stats as any).entities as any[]) : [];
      const total = entities.reduce((sum, row) => sum + (typeof row?.total === 'number' ? row.total : 0), 0);
      return { count: total, detail: total ? `entities=${entities.length}, total=${total}` : null };
    }
  },
  {
    id: 'll2_catalog_agencies',
    label: 'LL2 catalog agencies',
    schedule: 'Every 72 hours (checked every 6 hours at :53 UTC)',
    cronJobName: 'll2_catalog_agencies',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 96 * 60,
    enabledKey: 'll2_catalog_agencies_job_enabled',
    newData: (stats) => {
      const fetched = readNumber(stats, 'fetched') ?? 0;
      return { count: fetched, detail: fetched ? `fetched=${fetched}` : null };
    }
  },
  {
    id: 'll2_future_launch_sync',
    label: 'LL2 future launch sync',
    schedule: 'Every 12 hours (:30 UTC)',
    cronJobName: 'll2_future_launch_sync',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 1440,
    enabledKey: 'll2_future_launch_sync_job_enabled',
    newData: (stats) => {
      const launcherJoins = readNumber(stats, 'launcherJoinRowsUpserted') ?? 0;
      const launchLandings = readNumber(stats, 'launchLandingRowsUpserted') ?? 0;
      const total = launcherJoins + launchLandings;
      return {
        count: total,
        detail: total ? `launcherJoins=${launcherJoins}, launchLandings=${launchLandings}` : null
      };
    }
  },
  {
    id: 'nws_refresh',
    label: 'NWS weather refresh',
    schedule: 'Every 20 min',
    cronJobName: 'nws_refresh',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 60,
    newData: (stats) => {
      const launchesUpdated = readNumber(stats, 'launchesUpdated') ?? 0;
      const pointsUpserted = readNumber(stats, 'pointsUpserted') ?? 0;
      const total = launchesUpdated + pointsUpserted;
      return { count: total, detail: total ? `launchesUpdated=${launchesUpdated}, pointsUpserted=${pointsUpserted}` : null };
    }
  },
  {
    id: 'notifications_dispatch',
    label: 'Notifications dispatch',
    schedule: 'Every 2 min',
    cronJobName: 'notifications_dispatch',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10,
    enabledKey: 'notifications_dispatch_job_enabled',
    newData: (stats) => {
      const queued = readNumber(stats, 'queued') ?? 0;
      return { count: queued, detail: queued ? `queued=${queued}` : null };
    }
  },
  {
    id: 'notifications_send',
    label: 'Notifications send',
    schedule: 'Every 1 min',
    cronJobName: 'notifications_send',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 5,
    enabledKey: 'notifications_send_job_enabled',
    newData: (stats) => {
      const sent = readNumber(stats, 'sent') ?? 0;
      const failed = readNumber(stats, 'failed') ?? 0;
      const processed = readNumber(stats, 'processed') ?? 0;
      const total = sent + failed;
      return { count: total, detail: processed ? `processed=${processed}, sent=${sent}, failed=${failed}` : null };
    }
  },
  {
    id: 'artemis_bootstrap',
    label: 'Artemis bootstrap',
    schedule: 'Every 15 min',
    cronJobName: 'artemis_bootstrap',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 90,
    enabledKey: 'artemis_bootstrap_job_enabled'
  },
  {
    id: 'artemis_nasa_ingest',
    label: 'Artemis NASA ingest',
    schedule: 'Hourly (:07 UTC)',
    cronJobName: 'artemis_nasa_ingest',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 180,
    enabledKey: 'artemis_nasa_job_enabled'
  },
  {
    id: 'artemis_oversight_ingest',
    label: 'Artemis oversight ingest',
    schedule: 'Every 12 hours (:35)',
    cronJobName: 'artemis_oversight_ingest',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 24 * 60,
    enabledKey: 'artemis_oversight_job_enabled'
  },
  {
    id: 'artemis_budget_ingest',
    label: 'Artemis budget ingest',
    schedule: 'Daily (02:50 UTC)',
    cronJobName: 'artemis_budget_ingest',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 36 * 60,
    enabledKey: 'artemis_budget_job_enabled'
  },
  {
    id: 'artemis_procurement_ingest',
    label: 'Artemis procurement ingest',
    schedule: 'Daily (03:15 UTC)',
    cronJobName: 'artemis_procurement_ingest',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 36 * 60,
    enabledKey: 'artemis_procurement_job_enabled'
  },
  {
    id: 'artemis_contracts_ingest',
    label: 'Artemis contracts ingest',
    schedule: 'Weekly (Monday 05:17 UTC)',
    cronJobName: 'artemis_contracts_ingest',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10 * 24 * 60,
    enabledKey: 'artemis_contracts_job_enabled',
    newData: (stats) => {
      const contracts = readNumber(stats, 'normalizedContractsUpserted') ?? 0;
      const actions = readNumber(stats, 'normalizedActionsUpserted') ?? 0;
      const notices = readNumber(stats, 'samNoticesUpserted') ?? 0;
      return {
        count: contracts + actions + notices,
        detail: `contracts=${contracts}, actions=${actions}, notices=${notices}`
      };
    }
  },
  {
    id: 'program_contract_story_sync',
    label: 'Program contract story sync',
    schedule: 'Every 4 hours (:45 UTC)',
    cronJobName: 'program_contract_story_sync',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 8 * 60,
    enabledKey: 'contract_story_sync_job_enabled',
    newData: (stats) => {
      const totalStories = readNumber(stats, 'totalStories') ?? 0;
      const totalUpserted = readNumber(stats, 'totalUpserted') ?? 0;
      return {
        count: totalUpserted,
        detail:
          totalStories || totalUpserted
            ? `stories=${totalStories}, upserted=${totalUpserted}`
            : null
      };
    }
  },
  {
    id: 'artemis_snapshot_build',
    label: 'Artemis snapshot build',
    schedule: 'Hourly (:20 UTC)',
    cronJobName: 'artemis_snapshot_build',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 180,
    enabledKey: 'artemis_snapshot_job_enabled'
  },
  {
    id: 'artemis_content_ingest',
    label: 'Artemis content ingest',
    schedule: 'Hourly (:32 UTC)',
    cronJobName: 'artemis_content_ingest',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 180,
    enabledKey: 'artemis_content_job_enabled',
    newData: (stats) => {
      const upserted = readNumber(stats, 'upserted') ?? 0;
      const unchanged = readNumber(stats, 'unchangedSkipped') ?? 0;
      return {
        count: upserted,
        detail: upserted || unchanged ? `upserted=${upserted}, unchanged=${unchanged}` : null
      };
    }
  },
  {
    id: 'monitoring_check',
    label: 'Monitoring check',
    schedule: 'Every 5 min',
    cronJobName: 'monitoring_check',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 15
  },
  {
    id: 'll2_backfill',
    label: 'LL2 backfill',
    schedule: 'Every 1 min (when enabled)',
    cronJobName: 'll2_backfill',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    ingestionJobName: 'll2_backfill_page',
    thresholdMinutes: 10,
    enabledKey: 'll2_backfill_job_enabled',
    newData: (stats) => {
      const upserted = readNumber(stats, 'upserted') ?? 0;
      return { count: upserted, detail: upserted ? `upserted=${upserted}` : null };
    }
  },
  {
    id: 'll2_payload_backfill',
    label: 'LL2 payload backfill',
    schedule: 'Every 1 min (when enabled)',
    cronJobName: 'll2_payload_backfill',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    ingestionJobName: 'll2_payload_backfill_page',
    thresholdMinutes: 10,
    enabledKey: 'll2_payload_backfill_job_enabled',
    newData: (stats) => {
      const spacecraftOnly = readBooleanSetting((stats as any)?.spacecraftOnly, false);
      if (spacecraftOnly) {
        const fetched = readNumber(stats, 'fetched') ?? 0;
        const spacecraftFlights = readNumber(stats, 'spacecraftFlights') ?? 0;
        const spacecrafts = readNumber(stats, 'spacecrafts') ?? 0;
        return {
          count: spacecraftFlights,
          detail:
            fetched || spacecraftFlights || spacecrafts
              ? `spacecraftOnly=true, fetched=${fetched}, spacecraftFlights=${spacecraftFlights}, spacecrafts=${spacecrafts}`
              : 'spacecraftOnly=true'
        };
      }

      const upserted = readNumber(stats, 'upserted') ?? 0;
      const payloadFlights = readNumber(stats, 'payloadFlights') ?? 0;
      return {
        count: upserted,
        detail: upserted || payloadFlights ? `upserted=${upserted}, payloadFlights=${payloadFlights}` : null
      };
    }
  },
  {
    id: 'rocket_media_backfill',
    label: 'Rocket media backfill',
    schedule: 'Every 6 hours',
    cronJobName: 'rocket_media_backfill',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 60 * 12,
    enabledKey: 'rocket_media_backfill_job_enabled',
    newData: (stats) => {
      const launchesUpdated = readNumber(stats, 'launchesUpdated') ?? 0;
      const cacheUpdated = readNumber(stats, 'cacheUpdated') ?? 0;
      const total = launchesUpdated + cacheUpdated;
      return { count: total, detail: total ? `launchesUpdated=${launchesUpdated}, cacheUpdated=${cacheUpdated}` : null };
    }
  },
  {
    id: 'spacex_infographics_ingest',
    label: 'SpaceX infographics ingest',
    schedule: 'Daily (05:12 UTC)',
    cronJobName: 'spacex_infographics_ingest',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 1560,
    enabledKey: 'spacex_infographics_job_enabled',
    newData: (stats) => {
      const upserted = readNumber(stats, 'upserted') ?? 0;
      return { count: upserted, detail: upserted ? `upserted=${upserted}` : null };
    }
  },
  {
    id: 'spacex_x_post_snapshot',
    label: 'SpaceX X post snapshot',
    schedule: 'Every 15 min',
    cronJobName: 'spacex_x_post_snapshot',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 60,
    enabledKey: 'spacex_x_snapshot_enabled',
    newData: (stats) => {
      const updated = readNumber(stats, 'updated') ?? 0;
      const matched = readNumber(stats, 'matched') ?? 0;
      return { count: updated, detail: matched || updated ? `matched=${matched}, updated=${updated}` : null };
    }
  },
  {
    id: 'launch_social_refresh',
    label: 'Launch social refresh',
    schedule: 'Every 15 min',
    cronJobName: 'launch_social_refresh',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 45,
    enabledKey: 'launch_social_enabled',
    newData: (stats) => {
      const matched = readNumber(stats, 'matched') ?? 0;
      const candidates = readNumber(stats, 'candidatesUpserted') ?? 0;
      return { count: matched, detail: candidates ? `matched=${matched}, candidates=${candidates}` : null };
    }
  },
  {
    id: 'social_posts_dispatch',
    label: 'Social posts dispatch',
    schedule: 'Every 30 min (:08/:38 UTC)',
    cronJobName: 'social_posts_dispatch',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 90,
    newData: (stats) => {
      const posted = readNumber(stats, 'posted') ?? 0;
      const updatesSent = readNumber(stats, 'updatesSent') ?? 0;
      const repliesSent = readNumber(stats, 'missionRepliesSent') ?? 0;
      const total = posted + updatesSent + repliesSent;
      return {
        count: total,
        detail:
          total || readNumber(stats, 'coreBacklog')
            ? `posted=${posted}, updates=${updatesSent}, replies=${repliesSent}, coreBacklog=${readNumber(stats, 'coreBacklog') ?? 0}`
            : null
      };
    }
  },
  {
    id: 'launch_social_link_backfill',
    label: 'Launch social link backfill',
    schedule: 'Every 4 hours (:27)',
    cronJobName: 'launch_social_link_backfill',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 8 * 60,
    enabledKey: 'launch_social_link_backfill_enabled',
    newData: (stats) => {
      const matchesUpserted = readNumber(stats, 'matchesUpserted') ?? 0;
      const socialRowsInserted = readNumber(stats, 'socialRowsInserted') ?? 0;
      return {
        count: matchesUpserted,
        detail:
          matchesUpserted || socialRowsInserted
            ? `matches=${matchesUpserted}, socialRows=${socialRowsInserted}`
            : null
      };
    }
  },
  {
    id: 'ws45_forecasts_ingest',
    label: '45th Weather ingest',
    schedule: 'Every 30 min',
    cronJobName: 'ws45_forecasts_ingest',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 180,
    newData: (stats) => {
      const inserted = readNumber(stats, 'rowsInserted') ?? 0;
      const updated = readNumber(stats, 'rowsUpdated') ?? 0;
      const total = inserted + updated;
      return { count: total, detail: total ? `inserted=${inserted}, updated=${updated}` : null };
    }
  },
  {
    id: 'navcen_bnm_ingest',
    label: 'NAVCEN BNM hazard ingest',
    schedule: 'Hourly (:33 UTC)',
    cronJobName: 'navcen_bnm_ingest',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 180,
    enabledKey: 'navcen_bnm_job_enabled',
    newData: (stats) => {
      const constraints = readNumber(stats, 'constraintsUpserted') ?? 0;
      return { count: constraints, detail: constraints ? `constraints=${constraints}` : null };
    }
  },
  {
    id: 'trajectory_orbit_ingest',
    label: 'Trajectory orbit ingest',
    schedule: 'Every 6 hours (:21 UTC)',
    cronJobName: 'trajectory_orbit_ingest',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 720,
    enabledKey: 'trajectory_orbit_job_enabled',
    newData: (stats) => {
      const constraints = readNumber(stats, 'constraintsUpserted') ?? 0;
      return { count: constraints, detail: constraints ? `constraints=${constraints}` : null };
    }
  },
  {
    id: 'trajectory_constraints_ingest',
    label: 'Trajectory constraints ingest',
    schedule: 'Every 6 hours (:24 UTC)',
    cronJobName: 'trajectory_constraints_ingest',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 720,
    enabledKey: 'trajectory_constraints_job_enabled',
    newData: (stats) => {
      const upserted = readNumber(stats, 'rowsUpserted') ?? 0;
      return { count: upserted, detail: upserted ? `upserted=${upserted}` : null };
    }
  },
  {
    id: 'trajectory_products_generate',
    label: 'Trajectory products generate',
    schedule: 'Every 6 hours (:27 UTC)',
    cronJobName: 'trajectory_products_generate',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 720,
    enabledKey: 'trajectory_products_job_enabled',
    newData: (stats) => {
      const upserted = readNumber(stats, 'upserted') ?? 0;
      return { count: upserted, detail: upserted ? `upserted=${upserted}` : null };
    }
  },
  {
    id: 'jep_score_refresh',
    label: 'JEP score refresh',
    schedule: 'Every 5 min (managed scheduler)',
    cronJobName: 'jep_score_refresh',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 15,
    enabledKey: 'jep_score_job_enabled',
    newData: (stats) => {
      const upserted = readNumber(stats, 'launchesUpserted') ?? 0;
      const computed = readNumber(stats, 'launchesComputed') ?? 0;
      return {
        count: upserted,
        detail: upserted || computed ? `upserted=${upserted}, computed=${computed}` : null
      };
    }
  },
  {
    id: 'trajectory_templates_generate',
    label: 'Trajectory templates generate',
    schedule: 'Daily (03:15 UTC)',
    cronJobName: 'trajectory_templates_generate',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 1560,
    enabledKey: 'trajectory_templates_job_enabled',
    newData: (stats) => {
      const templates = readNumber(stats, 'templatesWritten') ?? 0;
      const samples = readNumber(stats, 'samplesUsed') ?? 0;
      return { count: templates, detail: templates ? `templates=${templates}, samples=${samples}` : null };
    }
  },
  {
    id: 'celestrak_gp_groups_sync',
    label: 'CelesTrak GP groups sync',
    schedule: 'Daily (~04:12 UTC)',
    cronJobName: 'celestrak_gp_groups_sync',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 2160,
    enabledKey: 'celestrak_gp_groups_sync_enabled',
    newData: (stats) => {
      const gpInserted = readNumber(stats, 'gpRowsInserted') ?? 0;
      const satcatInserted = readNumber(stats, 'satcatRowsInserted') ?? 0;
      const total = gpInserted + satcatInserted;
      return { count: total, detail: total ? `gpInserted=${gpInserted}, satcatInserted=${satcatInserted}` : null };
    }
  },
  {
    id: 'celestrak_ingest',
    label: 'CelesTrak ingest (orchestrated)',
    schedule: 'Every 6 hours (:11 UTC)',
    cronJobName: 'celestrak_ingest',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 420,
    enabledKey: 'celestrak_ingest_job_enabled',
    newData: (stats) => {
      const gpOrbit = readNumber(stats, 'gp.orbitElementsUpserted') ?? 0;
      const supgpOrbit = readNumber(stats, 'supgp.orbitElementsUpserted') ?? 0;
      const satcatSat = readNumber(stats, 'satcat.satellitesUpserted') ?? 0;
      const intdesSat = readNumber(stats, 'intdes.satellitesUpserted') ?? 0;
      const totalOrbit = gpOrbit + supgpOrbit;
      const totalSatellites = satcatSat + intdesSat;
      const count = totalOrbit + totalSatellites;
      const detailParts = [
        totalOrbit ? `orbitElements=${totalOrbit}` : null,
        totalSatellites ? `satellites=${totalSatellites}` : null
      ].filter(Boolean);
      return { count, detail: detailParts.length ? detailParts.join(', ') : null };
    }
  },
  {
    id: 'celestrak_retention_cleanup',
    label: 'CelesTrak retention cleanup',
    schedule: 'Daily (~04:42 UTC)',
    cronJobName: 'celestrak_retention_cleanup',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 2160,
    enabledKey: 'celestrak_retention_cleanup_enabled',
    newData: (stats) => {
      const deleted = readNumber(stats, 'deleted') ?? 0;
      return { count: deleted, detail: deleted ? `deleted=${deleted}` : null };
    }
  }
] as const;

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
      .select('key, severity, message, last_seen_at, occurrences, details')
      .eq('resolved', false)
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

    'll2_incremental_job_enabled',
    'll2_incremental_last_success_at',
    'll2_incremental_last_error',
    'll2_incremental_last_new_data_at',
    'll2_incremental_last_new_data_count',

    'll2_catalog_job_enabled',
    'll2_catalog_agencies_job_enabled',
    'll2_future_launch_sync_job_enabled',
    'll2_event_ingest_enabled',

    'll2_backfill_job_enabled',
    'll2_payload_backfill_job_enabled',
    'll2_payload_backfill_spacecraft_only',
    'rocket_media_backfill_job_enabled',
    'spacex_infographics_job_enabled',
    'spacex_x_snapshot_enabled',
    'launch_social_enabled',
    'launch_social_link_backfill_enabled',
    'navcen_bnm_job_enabled',
    'jep_score_job_enabled',
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
    'artemis_bootstrap_job_enabled',
    'artemis_nasa_job_enabled',
    'artemis_oversight_job_enabled',
    'artemis_budget_job_enabled',
    'artemis_procurement_job_enabled',
    'contract_story_sync_job_enabled',
    'contract_story_enrichment_enabled',
    'contract_story_enrichment_artemis_enabled',
    'contract_story_enrichment_spacex_enabled',
    'contract_story_enrichment_blue_origin_enabled',
    'contract_story_sync_batch_limit',
    'artemis_snapshot_job_enabled',
    'artemis_content_job_enabled',

    'celestrak_gp_groups_sync_enabled',
    'celestrak_ingest_job_enabled',
    'celestrak_gp_job_enabled',
    'celestrak_satcat_job_enabled',
    'celestrak_intdes_job_enabled',
    'celestrak_supgp_job_enabled',
    'celestrak_retention_cleanup_enabled',

    'trajectory_products_top3_ids'
  ]);

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
          'client_profile',
          'client_env',
          'screen_bucket',
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
          'dropped_frame_bucket'
        ].join(', ')
      )
      .gte('started_at', accuracyWindowStartIso)
      .order('started_at', { ascending: false })
      .limit(accuracySampleLimit)
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
          client_profile: string | null;
          client_env: string | null;
          screen_bucket: string | null;
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
        }>);
  if (accuracySessionsRes.error) {
    console.warn('admin summary trajectory accuracy sessions failed', accuracySessionsRes.error.message);
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
    sourceFreshness,
    coverage,
    accuracy
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

function summarizeTrajectoryAccuracy({
  rows,
  windowDays,
  windowStart,
  sampleLimit,
  sigmaGoodThresholdDeg
}: {
  rows: Array<{
    started_at: string | null;
    client_profile: string | null;
    client_env: string | null;
    screen_bucket: string | null;
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
    trend,
    runtimePolicies
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

async function loadJobStatuses(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  settings: Record<string, unknown>,
  cronJobs: CronJobInfo[]
) {
  const jobsEnabled = readBooleanSetting(settings.jobs_enabled, false);
  const now = Date.now();
  const cronByName = new Map(cronJobs.map((job) => [job.jobname, job]));

  const localDefs = loadLocalJobDefs();
  const jobDefs = [...SERVER_JOB_DEFS, ...localDefs];

  const ingestionJobNames = Array.from(
    new Set(
      jobDefs
        .filter((job) => job.source === 'ingestion_runs')
        .map((job) => job.ingestionJobName || job.id)
        .filter(Boolean) as string[]
    )
  );

  const recentRunsByJobName = await loadRecentRunsByJobName(supabase, ingestionJobNames);

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
        schedule: job.schedule,
        cronJobName,
        cronSchedule,
        cronActive,
        origin: job.origin,
        category: job.category,
        enabled: isEnabled,
        enabledDetail,
        status,
        statusDetail,
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
        schedule: job.schedule,
        cronJobName,
        cronSchedule,
        cronActive,
        origin: job.origin,
        category: job.category,
        enabled: isEnabled,
        enabledDetail,
        status,
        statusDetail,
        command: job.command ?? null
      } satisfies JobStatus;
    }

    const ingestionJobName = job.ingestionJobName || job.id;
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
    const isStale = job.thresholdMinutes != null && ageMinutes != null && ageMinutes > job.thresholdMinutes;

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

    if (cronMismatchDetail && status !== 'down') {
      status = 'degraded';
      statusDetail = joinDetails(statusDetail, cronMismatchDetail);
    }

    return {
      id: job.id,
      label: job.label,
      schedule: job.schedule,
      cronJobName,
      cronSchedule,
      cronActive,
      origin: job.origin,
      category: job.category,
      enabled: isEnabled,
      enabledDetail,
      status,
      statusDetail,
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
    schedule: 'Manual (local)',
    cronJobName: null,
    category: 'manual',
    origin: 'local',
    source: 'none',
    thresholdMinutes: null,
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
