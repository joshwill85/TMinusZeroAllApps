import {
  PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS,
  PREMIUM_LAUNCH_HOT_REFRESH_SECONDS
} from '@tminuszero/domain';
import type { AdminJobGroup, AdminJobSchedulerKind } from './types';

export type AdminJobNewDataResult = {
  count: number;
  detail: string | null;
};

export type AdminJobRegistryEntry = {
  id: string;
  label: string;
  cadenceLabel: string;
  cadenceLabelPolicy: 'static' | 'managed' | 'conceptual';
  slug?: string | null;
  cronJobName?: string | null;
  schedulerKind: AdminJobSchedulerKind;
  group: AdminJobGroup;
  category: 'scheduled' | 'manual' | 'internal';
  origin: 'server' | 'local';
  source: 'heartbeat' | 'ingestion_runs' | 'none';
  thresholdMinutes: number | null;
  telemetryJobName?: string | null;
  enabledKey?: string | null;
  dispatcherGate?: 'invoke_edge_job' | 'bridge' | 'scheduler_only' | 'ungated';
  manualRunSupported: boolean;
  manualRunForceBody?: boolean;
  manualRunConfirmMessage?: string | null;
  manualRunPrompt?: string | null;
  manualRunPromptToken?: string | null;
  command?: string | null;
  newData?: (stats: unknown) => AdminJobNewDataResult;
};

export const ADMIN_JOB_GROUP_META: Record<AdminJobGroup, { label: string; description: string }> = {
  core: {
    label: 'Core',
    description: 'Primary production schedulers and high-signal operational jobs.'
  },
  secondary: {
    label: 'Secondary',
    description: 'Supporting ingestion, enrichment, and program jobs tracked by the same control plane.'
  },
  advanced: {
    label: 'Advanced',
    description: 'Force-runs, backfills, paused maintenance jobs, and local-only tooling.'
  }
};

export const LEGACY_ADMIN_SYNC_JOB_ALIASES: Record<string, string> = {
  sync_ll2: 'll2_incremental',
  refresh_public_cache: 'ingestion_cycle',
  dispatch_notifications: 'notifications_dispatch'
};

function readRegistryNumber(stats: unknown, key: string) {
  if (!stats || typeof stats !== 'object') return null;
  const parts = key.split('.').filter(Boolean);
  let cursor: any = stats;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object') return null;
    cursor = cursor[part];
  }
  if (typeof cursor === 'number' && Number.isFinite(cursor)) return cursor;
  if (typeof cursor === 'string') {
    const value = Number(cursor);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function readRegistryBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const cleaned = value.trim().toLowerCase();
    if (cleaned === 'true') return true;
    if (cleaned === 'false') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

export const ADMIN_JOB_REGISTRY: readonly AdminJobRegistryEntry[] = [
  {
    id: 'll2_incremental',
    label: 'LL2 incremental',
    cadenceLabel: `Minute bridge with ~${PREMIUM_LAUNCH_HOT_REFRESH_SECONDS}s Edge bursts (${Math.trunc(
      PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS / 60
    )} min default refresh outside the hot window)`,
    cadenceLabelPolicy: 'conceptual',
    slug: 'll2-incremental-burst',
    cronJobName: 'll2_incremental_burst',
    schedulerKind: 'bridge',
    group: 'core',
    category: 'scheduled',
    origin: 'server',
    source: 'heartbeat',
    thresholdMinutes: 5,
    enabledKey: 'll2_incremental_job_enabled',
    dispatcherGate: 'bridge',
    manualRunSupported: true
  },
  {
    id: 'ingestion_cycle',
    label: 'Ingestion cycle',
    cadenceLabel: 'Every 30 min',
    cadenceLabelPolicy: 'managed',
    slug: 'ingestion-cycle',
    cronJobName: 'ingestion_cycle',
    schedulerKind: 'managed',
    group: 'core',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 120,
    dispatcherGate: 'ungated',
    manualRunSupported: true
  },
  {
    id: 'snapi_ingest',
    label: 'SNAPI ingest',
    cadenceLabel: 'Via ingestion cycle',
    cadenceLabelPolicy: 'conceptual',
    slug: null,
    cronJobName: null,
    schedulerKind: 'derived',
    group: 'secondary',
    category: 'internal',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 60,
    manualRunSupported: false,
    newData: (stats) => {
      const items = readRegistryNumber(stats, 'uniqueItems') ?? readRegistryNumber(stats, 'items') ?? 0;
      return { count: items, detail: items ? `items=${items}` : null };
    }
  },
  {
    id: 'll2_event_ingest',
    label: 'LL2 event ingest',
    cadenceLabel: 'Via ingestion cycle',
    cadenceLabelPolicy: 'conceptual',
    slug: null,
    cronJobName: null,
    schedulerKind: 'derived',
    group: 'secondary',
    category: 'internal',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 60,
    enabledKey: 'll2_event_ingest_enabled',
    dispatcherGate: 'scheduler_only',
    manualRunSupported: false,
    newData: (stats) => {
      const upserted = readRegistryNumber(stats, 'upserted') ?? 0;
      return { count: upserted, detail: upserted ? `upserted=${upserted}` : null };
    }
  },
  {
    id: 'public_cache_refresh',
    label: 'Public cache refresh',
    cadenceLabel: 'Via ingestion cycle',
    cadenceLabelPolicy: 'conceptual',
    slug: null,
    cronJobName: null,
    schedulerKind: 'derived',
    group: 'secondary',
    category: 'internal',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 60,
    manualRunSupported: false,
    newData: (stats) => {
      const refreshed = readRegistryNumber(stats, 'refreshed') ?? 0;
      const removed = readRegistryNumber(stats, 'removed') ?? 0;
      const total = refreshed + removed;
      return { count: total, detail: total ? `refreshed=${refreshed}, removed=${removed}` : null };
    }
  },
  {
    id: 'll2_catalog',
    label: 'LL2 catalog',
    cadenceLabel: 'Every 2 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'll2-catalog',
    cronJobName: 'll2_catalog',
    schedulerKind: 'managed',
    group: 'core',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 240,
    enabledKey: 'll2_catalog_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true,
    newData: (stats) => {
      const entities =
        typeof stats === 'object' && stats && Array.isArray((stats as any).entities) ? ((stats as any).entities as any[]) : [];
      const total = entities.reduce((sum, row) => sum + (typeof row?.total === 'number' ? row.total : 0), 0);
      return { count: total, detail: total ? `entities=${entities.length}, total=${total}` : null };
    }
  },
  {
    id: 'll2_catalog_agencies',
    label: 'LL2 catalog agencies',
    cadenceLabel: 'Every 72 hours (checked every 6 hours)',
    cadenceLabelPolicy: 'conceptual',
    slug: 'll2-catalog-agencies',
    cronJobName: 'll2_catalog_agencies',
    schedulerKind: 'managed',
    group: 'core',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 96 * 60,
    enabledKey: 'll2_catalog_agencies_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true,
    newData: (stats) => {
      const fetched = readRegistryNumber(stats, 'fetched') ?? 0;
      return { count: fetched, detail: fetched ? `fetched=${fetched}` : null };
    }
  },
  {
    id: 'll2_future_launch_sync',
    label: 'LL2 future launch sync',
    cadenceLabel: 'Every 12 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'll2-future-launch-sync',
    cronJobName: 'll2_future_launch_sync',
    schedulerKind: 'managed',
    group: 'core',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 24 * 60,
    enabledKey: 'll2_future_launch_sync_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true,
    newData: (stats) => {
      const launcherJoins = readRegistryNumber(stats, 'launcherJoinRowsUpserted') ?? 0;
      const launchLandings = readRegistryNumber(stats, 'launchLandingRowsUpserted') ?? 0;
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
    cadenceLabel: 'Every 8 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'nws-refresh',
    cronJobName: 'nws_refresh',
    schedulerKind: 'managed',
    group: 'core',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 16 * 60,
    dispatcherGate: 'ungated',
    manualRunSupported: true,
    newData: (stats) => {
      const launchesUpdated = readRegistryNumber(stats, 'launchesUpdated') ?? 0;
      const pointsUpserted = readRegistryNumber(stats, 'pointsUpserted') ?? 0;
      const total = launchesUpdated + pointsUpserted;
      return { count: total, detail: total ? `launchesUpdated=${launchesUpdated}, pointsUpserted=${pointsUpserted}` : null };
    }
  },
  {
    id: 'notifications_dispatch',
    label: 'Notifications dispatch',
    cadenceLabel: 'Every 2 min',
    cadenceLabelPolicy: 'static',
    slug: 'notifications-dispatch',
    cronJobName: 'notifications_dispatch',
    schedulerKind: 'pg_cron',
    group: 'core',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10,
    enabledKey: 'notifications_dispatch_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true,
    newData: (stats) => {
      const processed = readRegistryNumber(stats, 'processed') ?? 0;
      const queued = readRegistryNumber(stats, 'queued') ?? 0;
      return { count: queued, detail: processed || queued ? `processed=${processed}, queued=${queued}` : null };
    }
  },
  {
    id: 'notifications_send',
    label: 'Notifications send',
    cadenceLabel: 'Every 1 min',
    cadenceLabelPolicy: 'static',
    slug: 'notifications-send',
    cronJobName: 'notifications_send',
    schedulerKind: 'pg_cron',
    group: 'core',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10,
    enabledKey: 'notifications_send_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true,
    newData: (stats) => {
      const sent = readRegistryNumber(stats, 'sent') ?? 0;
      const failed = readRegistryNumber(stats, 'failed') ?? 0;
      const processed = readRegistryNumber(stats, 'processed') ?? 0;
      const total = sent + failed;
      return { count: total, detail: processed ? `processed=${processed}, sent=${sent}, failed=${failed}` : null };
    }
  },
  {
    id: 'monitoring_check',
    label: 'Monitoring check',
    cadenceLabel: 'Every hour',
    cadenceLabelPolicy: 'managed',
    slug: 'monitoring-check',
    cronJobName: 'monitoring_check',
    schedulerKind: 'managed',
    group: 'core',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 180,
    dispatcherGate: 'ungated',
    manualRunSupported: true
  },
  {
    id: 'ws45_forecasts_ingest',
    label: 'WS45 forecasts ingest',
    cadenceLabel: 'Every 4 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'ws45-forecast-ingest',
    cronJobName: 'ws45_forecasts_ingest',
    schedulerKind: 'managed',
    group: 'core',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 12 * 60,
    dispatcherGate: 'ungated',
    manualRunSupported: true
  },
  {
    id: 'ws45_live_weather_ingest',
    label: 'WS45 live weather ingest',
    cadenceLabel: 'Adaptive live cadence (15 min base scheduler)',
    cadenceLabelPolicy: 'conceptual',
    slug: 'ws45-live-weather-ingest',
    cronJobName: 'ws45_live_weather_ingest',
    schedulerKind: 'managed',
    group: 'core',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 45,
    enabledKey: 'ws45_live_weather_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'ws45_planning_forecast_ingest',
    label: 'WS45 planning forecast ingest',
    cadenceLabel: 'Every 4 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'ws45-planning-forecast-ingest',
    cronJobName: 'ws45_planning_forecast_ingest',
    schedulerKind: 'managed',
    group: 'core',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 12 * 60,
    enabledKey: 'ws45_planning_forecast_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'ws45_weather_retention_cleanup',
    label: 'WS45 weather retention cleanup',
    cadenceLabel: 'Daily',
    cadenceLabelPolicy: 'managed',
    slug: 'ws45-weather-retention-cleanup',
    cronJobName: 'ws45_weather_retention_cleanup',
    schedulerKind: 'managed',
    group: 'core',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 48 * 60,
    enabledKey: 'ws45_weather_retention_cleanup_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'artemis_bootstrap',
    label: 'Artemis bootstrap',
    cadenceLabel: 'Every 15 min until bootstrap completes',
    cadenceLabelPolicy: 'managed',
    slug: 'artemis-bootstrap',
    cronJobName: 'artemis_bootstrap',
    schedulerKind: 'managed',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 90,
    enabledKey: 'artemis_bootstrap_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true,
    manualRunForceBody: true
  },
  {
    id: 'artemis_nasa_ingest',
    label: 'Artemis NASA ingest',
    cadenceLabel: 'Every 3 days',
    cadenceLabelPolicy: 'static',
    slug: 'artemis-nasa-ingest',
    cronJobName: 'artemis_nasa_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 6 * 24 * 60,
    enabledKey: 'artemis_nasa_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'artemis_oversight_ingest',
    label: 'Artemis oversight ingest',
    cadenceLabel: 'Every 12 hours',
    cadenceLabelPolicy: 'static',
    slug: 'artemis-oversight-ingest',
    cronJobName: 'artemis_oversight_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 24 * 60,
    enabledKey: 'artemis_oversight_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'artemis_budget_ingest',
    label: 'Artemis budget ingest',
    cadenceLabel: 'Weekly (Monday 04:17 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'artemis-budget-ingest',
    cronJobName: 'artemis_budget_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10 * 24 * 60,
    enabledKey: 'artemis_budget_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'artemis_procurement_ingest',
    label: 'Artemis procurement ingest',
    cadenceLabel: 'Daily (04:47 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'artemis-procurement-ingest',
    cronJobName: 'artemis_procurement_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 36 * 60,
    enabledKey: 'artemis_procurement_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'artemis_contracts_ingest',
    label: 'Artemis contracts ingest',
    cadenceLabel: 'Three times daily (05:17, 13:17, 21:17 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'artemis-contracts-ingest',
    cronJobName: 'artemis_contracts_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 24 * 60,
    enabledKey: 'artemis_contracts_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true,
    newData: (stats) => {
      const contracts = readRegistryNumber(stats, 'normalizedContractsUpserted') ?? 0;
      const actions = readRegistryNumber(stats, 'normalizedActionsUpserted') ?? 0;
      const notices = readRegistryNumber(stats, 'samNoticesUpserted') ?? 0;
      return {
        count: contracts + actions + notices,
        detail: `contracts=${contracts}, actions=${actions}, notices=${notices}`
      };
    }
  },
  {
    id: 'program_contract_story_sync',
    label: 'Program contract story sync',
    cadenceLabel: 'Every 4 hours',
    cadenceLabelPolicy: 'static',
    slug: 'program-contract-story-sync',
    cronJobName: 'program_contract_story_sync',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 8 * 60,
    dispatcherGate: 'ungated',
    manualRunSupported: true,
    newData: (stats) => {
      const totalStories = readRegistryNumber(stats, 'totalStories') ?? 0;
      const totalUpserted = readRegistryNumber(stats, 'totalUpserted') ?? 0;
      return {
        count: totalUpserted,
        detail: totalStories || totalUpserted ? `stories=${totalStories}, upserted=${totalUpserted}` : null
      };
    }
  },
  {
    id: 'artemis_snapshot_build',
    label: 'Artemis snapshot build',
    cadenceLabel: 'Every 3 days',
    cadenceLabelPolicy: 'static',
    slug: 'artemis-snapshot-build',
    cronJobName: 'artemis_snapshot_build',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 6 * 24 * 60,
    enabledKey: 'artemis_snapshot_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'artemis_content_ingest',
    label: 'Artemis content ingest',
    cadenceLabel: 'Every 12 hours',
    cadenceLabelPolicy: 'static',
    slug: 'artemis-content-ingest',
    cronJobName: 'artemis_content_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 36 * 60,
    enabledKey: 'artemis_content_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true,
    newData: (stats) => {
      const upserted = readRegistryNumber(stats, 'upserted') ?? 0;
      const unchanged = readRegistryNumber(stats, 'unchangedSkipped') ?? 0;
      return {
        count: upserted,
        detail: upserted || unchanged ? `upserted=${upserted}, unchanged=${unchanged}` : null
      };
    }
  },
  {
    id: 'artemis_nasa_blog_backfill',
    label: 'Artemis NASA blog backfill',
    cadenceLabel: 'Weekly (Sunday 05:15 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'artemis-nasa-blog-backfill',
    cronJobName: 'artemis_nasa_blog_backfill',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10 * 24 * 60,
    enabledKey: 'artemis_nasa_blog_backfill_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'artemis_crew_ingest',
    label: 'Artemis crew ingest',
    cadenceLabel: 'Weekly (Sunday 05:35 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'artemis-crew-ingest',
    cronJobName: 'artemis_crew_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10 * 24 * 60,
    enabledKey: 'artemis_crew_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'artemis_components_ingest',
    label: 'Artemis components ingest',
    cadenceLabel: 'Weekly (Sunday 05:55 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'artemis-components-ingest',
    cronJobName: 'artemis_components_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10 * 24 * 60,
    enabledKey: 'artemis_components_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'billing_reconcile',
    label: 'Billing reconcile',
    cadenceLabel: 'Every 3 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'billing-reconcile',
    cronJobName: 'billing_reconcile',
    schedulerKind: 'managed',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 540,
    dispatcherGate: 'ungated',
    manualRunSupported: true,
    manualRunConfirmMessage: 'Trigger Billing reconcile? This may contact Stripe and update local billing state.'
  },
  {
    id: 'spacex_infographics_ingest',
    label: 'SpaceX infographics ingest',
    cadenceLabel: 'Daily',
    cadenceLabelPolicy: 'static',
    slug: 'spacex-infographics-ingest',
    cronJobName: 'spacex_infographics_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 36 * 60,
    enabledKey: 'spacex_infographics_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'spacex_x_post_snapshot',
    label: 'SpaceX X post snapshot',
    cadenceLabel: 'Hourly',
    cadenceLabelPolicy: 'managed',
    slug: 'spacex-x-post-snapshot',
    cronJobName: 'spacex_x_post_snapshot',
    schedulerKind: 'managed',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 180,
    dispatcherGate: 'ungated',
    manualRunSupported: true
  },
  {
    id: 'launch_social_refresh',
    label: 'Launch social refresh',
    cadenceLabel: 'Every 3 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'launch-social-refresh',
    cronJobName: 'launch_social_refresh',
    schedulerKind: 'managed',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 540,
    dispatcherGate: 'ungated',
    manualRunSupported: true
  },
  {
    id: 'social_posts_dispatch',
    label: 'Social posts dispatch',
    cadenceLabel: 'Every 30 min',
    cadenceLabelPolicy: 'managed',
    slug: 'social-posts-dispatch',
    cronJobName: 'social_posts_dispatch',
    schedulerKind: 'managed',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 120,
    dispatcherGate: 'ungated',
    manualRunSupported: true
  },
  {
    id: 'launch_social_link_backfill',
    label: 'Launch social link backfill',
    cadenceLabel: 'Every 4 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'launch-social-link-backfill',
    cronJobName: 'launch_social_link_backfill',
    schedulerKind: 'managed',
    group: 'advanced',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 12 * 60,
    enabledKey: 'launch_social_link_backfill_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'll2_backfill',
    label: 'LL2 backfill',
    cadenceLabel: 'Every 1 min (when enabled)',
    cadenceLabelPolicy: 'static',
    slug: 'll2-backfill',
    cronJobName: 'll2_backfill',
    schedulerKind: 'pg_cron',
    group: 'advanced',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10,
    telemetryJobName: 'll2_backfill_page',
    enabledKey: 'll2_backfill_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true,
    manualRunForceBody: true,
    manualRunConfirmMessage: 'Force-run LL2 backfill? This can be expensive.',
    manualRunPrompt: 'Type FORCE LL2 BACKFILL to confirm.',
    manualRunPromptToken: 'FORCE LL2 BACKFILL',
    newData: (stats) => {
      const upserted = readRegistryNumber(stats, 'upserted') ?? 0;
      return { count: upserted, detail: upserted ? `upserted=${upserted}` : null };
    }
  },
  {
    id: 'll2_payload_backfill',
    label: 'LL2 payload backfill',
    cadenceLabel: 'Every 1 min (when enabled)',
    cadenceLabelPolicy: 'static',
    slug: 'll2-payload-backfill',
    cronJobName: 'll2_payload_backfill',
    schedulerKind: 'pg_cron',
    group: 'advanced',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10,
    telemetryJobName: 'll2_payload_backfill_page',
    enabledKey: 'll2_payload_backfill_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true,
    manualRunForceBody: true,
    manualRunConfirmMessage: 'Force-run LL2 payload backfill? This can be expensive.',
    manualRunPrompt: 'Type FORCE LL2 PAYLOAD BACKFILL to confirm.',
    manualRunPromptToken: 'FORCE LL2 PAYLOAD BACKFILL',
    newData: (stats) => {
      const spacecraftOnly = readRegistryBoolean((stats as any)?.spacecraftOnly, false);
      if (spacecraftOnly) {
        const fetched = readRegistryNumber(stats, 'fetched') ?? 0;
        const spacecraftFlights = readRegistryNumber(stats, 'spacecraftFlights') ?? 0;
        const spacecrafts = readRegistryNumber(stats, 'spacecrafts') ?? 0;
        return {
          count: spacecraftFlights,
          detail:
            fetched || spacecraftFlights || spacecrafts
              ? `spacecraftOnly=true, fetched=${fetched}, spacecraftFlights=${spacecraftFlights}, spacecrafts=${spacecrafts}`
              : 'spacecraftOnly=true'
        };
      }

      const upserted = readRegistryNumber(stats, 'upserted') ?? 0;
      const payloadFlights = readRegistryNumber(stats, 'payloadFlights') ?? 0;
      return {
        count: upserted,
        detail: upserted || payloadFlights ? `upserted=${upserted}, payloadFlights=${payloadFlights}` : null
      };
    }
  },
  {
    id: 'rocket_media_backfill',
    label: 'Rocket media backfill',
    cadenceLabel: 'Every 6 hours',
    cadenceLabelPolicy: 'static',
    slug: 'rocket-media-backfill',
    cronJobName: 'rocket_media_backfill',
    schedulerKind: 'pg_cron',
    group: 'advanced',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 12 * 60,
    enabledKey: 'rocket_media_backfill_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true,
    manualRunForceBody: true,
    manualRunConfirmMessage: 'Force-run Rocket media backfill? This can be expensive.',
    manualRunPrompt: 'Type FORCE ROCKET MEDIA BACKFILL to confirm.',
    manualRunPromptToken: 'FORCE ROCKET MEDIA BACKFILL'
  },
  {
    id: 'og_prewarm',
    label: 'OG prewarm',
    cadenceLabel: 'Every 5 min (when enabled)',
    cadenceLabelPolicy: 'static',
    slug: 'og-prewarm',
    cronJobName: 'og_prewarm',
    schedulerKind: 'pg_cron',
    group: 'advanced',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 20,
    enabledKey: 'og_prewarm_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'ops_metrics_collect',
    label: 'Ops metrics collect',
    cadenceLabel: 'Every 5 min (when enabled)',
    cadenceLabelPolicy: 'static',
    slug: 'ops-metrics-collect',
    cronJobName: 'ops_metrics_collect',
    schedulerKind: 'pg_cron',
    group: 'advanced',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 20,
    enabledKey: 'ops_metrics_collection_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'navcen_bnm_ingest',
    label: 'NAVCEN BNM ingest',
    cadenceLabel: 'Every 3 hours (:24 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'navcen-bnm-ingest',
    cronJobName: 'navcen_bnm_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 540,
    enabledKey: 'navcen_bnm_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'trajectory_orbit_ingest',
    label: 'Trajectory orbit ingest',
    cadenceLabel: 'Every 3 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'trajectory-orbit-ingest',
    cronJobName: 'trajectory_orbit_ingest',
    schedulerKind: 'managed',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 540,
    enabledKey: 'trajectory_orbit_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'trajectory_constraints_ingest',
    label: 'Trajectory constraints ingest',
    cadenceLabel: 'Every 3 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'trajectory-constraints-ingest',
    cronJobName: 'trajectory_constraints_ingest',
    schedulerKind: 'managed',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 540,
    enabledKey: 'trajectory_constraints_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'trajectory_products_generate',
    label: 'Trajectory products generate',
    cadenceLabel: 'Every 3 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'trajectory-products-generate',
    cronJobName: 'trajectory_products_generate',
    schedulerKind: 'managed',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 540,
    enabledKey: 'trajectory_products_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'trajectory_templates_generate',
    label: 'Trajectory templates generate',
    cadenceLabel: 'Daily (03:15 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'trajectory-templates-generate',
    cronJobName: 'trajectory_templates_generate',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 36 * 60,
    enabledKey: 'trajectory_templates_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'jep_score_refresh',
    label: 'JEP score refresh',
    cadenceLabel: 'Every 2 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'jep-score-refresh',
    cronJobName: 'jep_score_refresh',
    schedulerKind: 'managed',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 360,
    enabledKey: 'jep_score_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'jep_moon_ephemeris_refresh',
    label: 'JEP moon ephemeris refresh',
    cadenceLabel: 'Every 4 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'jep-moon-ephemeris-refresh',
    cronJobName: 'jep_moon_ephemeris_refresh',
    schedulerKind: 'managed',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 12 * 60,
    enabledKey: 'jep_moon_ephemeris_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'jep_background_light_refresh',
    label: 'JEP background light refresh',
    cadenceLabel: 'Every 12 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'jep-background-light-refresh',
    cronJobName: 'jep_background_light_refresh',
    schedulerKind: 'managed',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 36 * 60,
    enabledKey: 'jep_background_light_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'celestrak_gp_groups_sync',
    label: 'CelesTrak GP groups sync',
    cadenceLabel: 'Daily (~04:12 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'celestrak-gp-groups-sync',
    cronJobName: 'celestrak_gp_groups_sync',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 36 * 60,
    enabledKey: 'celestrak_gp_groups_sync_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true,
    newData: (stats) => {
      const gpInserted = readRegistryNumber(stats, 'gpRowsInserted') ?? 0;
      const satcatInserted = readRegistryNumber(stats, 'satcatRowsInserted') ?? 0;
      const total = gpInserted + satcatInserted;
      return { count: total, detail: total ? `gpInserted=${gpInserted}, satcatInserted=${satcatInserted}` : null };
    }
  },
  {
    id: 'celestrak_supgp_sync',
    label: 'CelesTrak SupGP sync',
    cadenceLabel: 'Every 3 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'celestrak-supgp-sync',
    cronJobName: 'celestrak_supgp_sync',
    schedulerKind: 'managed',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 540,
    enabledKey: 'celestrak_supgp_sync_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'celestrak_supgp_ingest',
    label: 'CelesTrak SupGP ingest',
    cadenceLabel: 'Hourly',
    cadenceLabelPolicy: 'managed',
    slug: 'celestrak-supgp-ingest',
    cronJobName: 'celestrak_supgp_ingest',
    schedulerKind: 'managed',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 180,
    enabledKey: 'celestrak_supgp_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'celestrak_ingest',
    label: 'CelesTrak ingest (orchestrated)',
    cadenceLabel: 'Every 6 hours',
    cadenceLabelPolicy: 'static',
    slug: 'celestrak-ingest',
    cronJobName: 'celestrak_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 420,
    enabledKey: 'celestrak_ingest_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true,
    newData: (stats) => {
      const gpOrbit = readRegistryNumber(stats, 'gp.orbitElementsUpserted') ?? 0;
      const supgpOrbit = readRegistryNumber(stats, 'supgp.orbitElementsUpserted') ?? 0;
      const satcatSat = readRegistryNumber(stats, 'satcat.satellitesUpserted') ?? 0;
      const intdesSat = readRegistryNumber(stats, 'intdes.satellitesUpserted') ?? 0;
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
    cadenceLabel: 'Daily (~04:42 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'celestrak-retention-cleanup',
    cronJobName: 'celestrak_retention_cleanup',
    schedulerKind: 'pg_cron',
    group: 'advanced',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 36 * 60,
    enabledKey: 'celestrak_retention_cleanup_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true,
    newData: (stats) => {
      const deleted = readRegistryNumber(stats, 'deleted') ?? 0;
      return { count: deleted, detail: deleted ? `deleted=${deleted}` : null };
    }
  },
  {
    id: 'faa_tfr_ingest',
    label: 'FAA TFR ingest',
    cadenceLabel: 'Every 3 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'faa-tfr-ingest',
    cronJobName: 'faa_tfr_ingest',
    schedulerKind: 'managed',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 540,
    enabledKey: 'faa_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'faa_notam_detail_ingest',
    label: 'FAA NOTAM detail ingest',
    cadenceLabel: 'Every 3 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'faa-notam-detail-ingest',
    cronJobName: 'faa_notam_detail_ingest',
    schedulerKind: 'managed',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 540,
    enabledKey: 'faa_notam_detail_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'faa_launch_match',
    label: 'FAA launch match',
    cadenceLabel: 'Every 3 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'faa-launch-match',
    cronJobName: 'faa_launch_match',
    schedulerKind: 'managed',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 540,
    enabledKey: 'faa_match_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'faa_trajectory_hazard_ingest',
    label: 'FAA trajectory hazard ingest',
    cadenceLabel: 'Every 3 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'faa-trajectory-hazard-ingest',
    cronJobName: 'faa_trajectory_hazard_ingest',
    schedulerKind: 'managed',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 540,
    enabledKey: 'faa_trajectory_hazard_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'spacex_drone_ship_ingest',
    label: 'SpaceX drone-ship ingest',
    cadenceLabel: 'Every 48 hours',
    cadenceLabelPolicy: 'managed',
    slug: 'spacex-drone-ship-ingest',
    cronJobName: 'spacex_drone_ship_ingest',
    schedulerKind: 'managed',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 72 * 60,
    enabledKey: 'spacex_drone_ship_ingest_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'spacex_drone_ship_wiki_sync',
    label: 'SpaceX drone-ship wiki sync',
    cadenceLabel: 'Weekly',
    cadenceLabelPolicy: 'managed',
    slug: 'spacex-drone-ship-wiki-sync',
    cronJobName: 'spacex_drone_ship_wiki_sync',
    schedulerKind: 'managed',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10 * 24 * 60,
    enabledKey: 'spacex_drone_ship_wiki_sync_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'blue_origin_bootstrap',
    label: 'Blue Origin bootstrap',
    cadenceLabel: 'Weekly (Monday 00:00 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'blue-origin-bootstrap',
    cronJobName: 'blue_origin_bootstrap',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10 * 24 * 60,
    enabledKey: 'blue_origin_bootstrap_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'blue_origin_vehicles_ingest',
    label: 'Blue Origin vehicles ingest',
    cadenceLabel: 'Weekly (Monday 01:30 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'blue-origin-vehicles-ingest',
    cronJobName: 'blue_origin_vehicles_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10 * 24 * 60,
    enabledKey: 'blue_origin_vehicles_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'blue_origin_engines_ingest',
    label: 'Blue Origin engines ingest',
    cadenceLabel: 'Weekly (Monday 03:00 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'blue-origin-engines-ingest',
    cronJobName: 'blue_origin_engines_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10 * 24 * 60,
    enabledKey: 'blue_origin_engines_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'blue_origin_missions_ingest',
    label: 'Blue Origin missions ingest',
    cadenceLabel: 'Weekly (Monday 04:30 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'blue-origin-missions-ingest',
    cronJobName: 'blue_origin_missions_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10 * 24 * 60,
    enabledKey: 'blue_origin_missions_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'blue_origin_news_ingest',
    label: 'Blue Origin news ingest',
    cadenceLabel: 'Weekly (Monday 06:00 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'blue-origin-news-ingest',
    cronJobName: 'blue_origin_news_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10 * 24 * 60,
    enabledKey: 'blue_origin_news_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'blue_origin_media_ingest',
    label: 'Blue Origin media ingest',
    cadenceLabel: 'Weekly (Monday 07:30 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'blue-origin-media-ingest',
    cronJobName: 'blue_origin_media_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10 * 24 * 60,
    enabledKey: 'blue_origin_media_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'blue_origin_passengers_ingest',
    label: 'Blue Origin passengers ingest',
    cadenceLabel: 'Weekly (Monday 09:00 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'blue-origin-passengers-ingest',
    cronJobName: 'blue_origin_passengers_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10 * 24 * 60,
    enabledKey: 'blue_origin_passengers_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'blue_origin_payloads_ingest',
    label: 'Blue Origin payloads ingest',
    cadenceLabel: 'Weekly (Monday 10:30 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'blue-origin-payloads-ingest',
    cronJobName: 'blue_origin_payloads_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10 * 24 * 60,
    enabledKey: 'blue_origin_payloads_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'blue_origin_contracts_ingest',
    label: 'Blue Origin contracts ingest',
    cadenceLabel: 'Weekly (Monday 12:00 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'blue-origin-contracts-ingest',
    cronJobName: 'blue_origin_contracts_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10 * 24 * 60,
    enabledKey: 'blue_origin_contracts_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'blue_origin_social_ingest',
    label: 'Blue Origin social ingest',
    cadenceLabel: 'Weekly (Monday 13:30 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'blue-origin-social-ingest',
    cronJobName: 'blue_origin_social_ingest',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10 * 24 * 60,
    enabledKey: 'blue_origin_social_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  },
  {
    id: 'blue_origin_snapshot_build',
    label: 'Blue Origin snapshot build',
    cadenceLabel: 'Weekly (Monday 15:00 UTC)',
    cadenceLabelPolicy: 'static',
    slug: 'blue-origin-snapshot-build',
    cronJobName: 'blue_origin_snapshot_build',
    schedulerKind: 'pg_cron',
    group: 'secondary',
    category: 'scheduled',
    origin: 'server',
    source: 'ingestion_runs',
    thresholdMinutes: 10 * 24 * 60,
    enabledKey: 'blue_origin_snapshot_job_enabled',
    dispatcherGate: 'invoke_edge_job',
    manualRunSupported: true
  }
];

export const ADMIN_JOB_REGISTRY_BY_ID = new Map(ADMIN_JOB_REGISTRY.map((job) => [job.id, job]));

export const ADMIN_RUNNABLE_JOB_IDS = new Set(
  ADMIN_JOB_REGISTRY.filter((job) => job.manualRunSupported).map((job) => job.id)
);

export function getAdminJobRegistryEntry(jobId: string | null | undefined) {
  if (!jobId) return null;
  return ADMIN_JOB_REGISTRY_BY_ID.get(jobId) ?? null;
}

export function normalizeAdminSyncJobId(jobId: string | null | undefined) {
  const raw = typeof jobId === 'string' ? jobId.trim() : '';
  if (!raw) return null;
  const canonical = LEGACY_ADMIN_SYNC_JOB_ALIASES[raw] ?? raw;
  return ADMIN_JOB_REGISTRY_BY_ID.has(canonical) ? canonical : null;
}
