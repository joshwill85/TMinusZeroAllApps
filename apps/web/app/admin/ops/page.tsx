'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import InfoCard from '../_components/InfoCard';
import SectionCard from '../_components/SectionCard';
import { useAdminResource } from '../_hooks/useAdminResource';
import { formatAlertDetails, formatDurationSeconds, formatJson, formatRunDuration, formatTimestamp } from '../_lib/format';
import {
  formatJobCategory,
  formatJobStatusLabel,
  jobStatusBadgeClass,
  jobStatusDotClass,
  relatedJobIdFromAlertKey
} from '../_lib/jobs';
import { FALLBACK_ADMIN_SUMMARY, parseAdminSummary } from '../_lib/summary';
import { formatSyncTriggerError } from '../_lib/sync';
import type { IngestionRun, JobStatus } from '../_lib/types';

type AdminSyncJob =
  | 'sync_ll2'
  | 'refresh_public_cache'
  | 'dispatch_notifications'
  | 'ws45_forecasts_ingest'
  | 'nws_refresh'
  | 'billing_reconcile'
  | 'celestrak_gp_groups_sync'
  | 'celestrak_ingest'
  | 'celestrak_retention_cleanup'
  | 'spacex_infographics_ingest'
  | 'spacex_x_post_snapshot'
  | 'launch_social_refresh'
  | 'social_posts_dispatch'
  | 'launch_social_link_backfill'
  | 'll2_backfill'
  | 'll2_payload_backfill'
  | 'll2_catalog_agencies'
  | 'rocket_media_backfill'
  | 'trajectory_orbit_ingest'
  | 'trajectory_constraints_ingest'
  | 'trajectory_products_generate'
  | 'trajectory_templates_generate'
  | 'artemis_bootstrap'
  | 'artemis_nasa_ingest'
  | 'artemis_oversight_ingest'
  | 'artemis_budget_ingest'
  | 'artemis_procurement_ingest'
  | 'artemis_contracts_ingest'
  | 'artemis_snapshot_build'
  | 'artemis_content_ingest'
  | 'notifications_send'
  | 'monitoring_check';

const JOB_TRIGGER_BY_ID: Partial<Record<JobStatus['id'], AdminSyncJob>> = {
  ll2_incremental: 'sync_ll2',
  ingestion_cycle: 'refresh_public_cache',
  notifications_dispatch: 'dispatch_notifications',
  notifications_send: 'notifications_send',
  nws_refresh: 'nws_refresh',
  ws45_forecasts_ingest: 'ws45_forecasts_ingest',
  spacex_infographics_ingest: 'spacex_infographics_ingest',
  spacex_x_post_snapshot: 'spacex_x_post_snapshot',
  launch_social_refresh: 'launch_social_refresh',
  social_posts_dispatch: 'social_posts_dispatch',
  launch_social_link_backfill: 'launch_social_link_backfill',
  celestrak_gp_groups_sync: 'celestrak_gp_groups_sync',
  celestrak_ingest: 'celestrak_ingest',
  celestrak_retention_cleanup: 'celestrak_retention_cleanup',
  ll2_catalog_agencies: 'll2_catalog_agencies',
  trajectory_orbit_ingest: 'trajectory_orbit_ingest',
  trajectory_constraints_ingest: 'trajectory_constraints_ingest',
  trajectory_products_generate: 'trajectory_products_generate',
  trajectory_templates_generate: 'trajectory_templates_generate',
  artemis_bootstrap: 'artemis_bootstrap',
  artemis_nasa_ingest: 'artemis_nasa_ingest',
  artemis_oversight_ingest: 'artemis_oversight_ingest',
  artemis_budget_ingest: 'artemis_budget_ingest',
  artemis_procurement_ingest: 'artemis_procurement_ingest',
  artemis_contracts_ingest: 'artemis_contracts_ingest',
  artemis_snapshot_build: 'artemis_snapshot_build',
  artemis_content_ingest: 'artemis_content_ingest',
  monitoring_check: 'monitoring_check'
};

const ADVANCED_JOB_IDS = new Set<JobStatus['id']>(['ll2_backfill', 'll2_payload_backfill', 'rocket_media_backfill']);

const JOB_ID_TO_INGESTION_NAME: Record<string, string> = {
  ll2_backfill: 'll2_backfill_page',
  ll2_payload_backfill: 'll2_payload_backfill_page'
};

function statusRank(status: JobStatus['status']) {
  if (status === 'down') return 0;
  if (status === 'degraded') return 1;
  if (status === 'running') return 2;
  if (status === 'paused') return 3;
  if (status === 'unknown') return 4;
  return 5;
}

function alertRank(severity: string) {
  const cleaned = String(severity || '').trim().toLowerCase();
  if (cleaned === 'critical') return 0;
  if (cleaned === 'warning') return 1;
  if (cleaned === 'info') return 2;
  return 3;
}

function formatSeverity(severity: string) {
  const cleaned = String(severity || '').trim().toUpperCase();
  return cleaned || 'UNKNOWN';
}

function severityClass(severity: string) {
  const cleaned = String(severity || '').trim().toLowerCase();
  if (cleaned === 'critical') return 'border-danger text-danger';
  if (cleaned === 'warning') return 'border-warning text-warning';
  if (cleaned === 'info') return 'border-stroke text-text2';
  return 'border-stroke text-text2';
}

export default function AdminOpsPage() {
  const { data: summary, status, error, refresh, lastRefreshedAt } = useAdminResource('/api/admin/summary', {
    initialData: FALLBACK_ADMIN_SUMMARY,
    parse: parseAdminSummary
  });

  const [refreshing, setRefreshing] = useState(false);
  const [triggering, setTriggering] = useState<AdminSyncJob | null>(null);
  const [updatingBackfills, setUpdatingBackfills] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [alertSeverity, setAlertSeverity] = useState<'all' | 'critical' | 'warning' | 'info'>('all');
  const [alertSearch, setAlertSearch] = useState('');

  const [jobSearch, setJobSearch] = useState('');
  const [showOperationalJobs, setShowOperationalJobs] = useState(false);

  const [highlightJobId, setHighlightJobId] = useState<string | null>(null);

  const [jobRunsByName, setJobRunsByName] = useState<Record<string, IngestionRun[]>>({});
  const [jobRunsErrorByName, setJobRunsErrorByName] = useState<Record<string, string>>({});
  const [loadingJobRunsFor, setLoadingJobRunsFor] = useState<string | null>(null);

  const jobById = useMemo(() => new Map(summary.jobs.map((job) => [job.id, job])), [summary.jobs]);

  const jobsWithRelatedAlerts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const alert of summary.alerts) {
      const related = relatedJobIdFromAlertKey(alert.key);
      if (!related) continue;
      if (!jobById.has(related)) continue;
      counts.set(related, (counts.get(related) ?? 0) + 1);
    }
    return counts;
  }, [jobById, summary.alerts]);

  const alertsFreshness = useMemo(() => {
    let latestMs = -Infinity;
    let latestIso: string | null = null;
    for (const alert of summary.alerts) {
      const ms = Date.parse(alert.last_seen_at);
      if (!Number.isFinite(ms)) continue;
      if (ms > latestMs) {
        latestMs = ms;
        latestIso = alert.last_seen_at;
      }
    }
    if (!latestIso || !Number.isFinite(latestMs)) return null;
    const ageMinutes = (Date.now() - latestMs) / (1000 * 60);
    return { latestIso, ageMinutes, isStale: Number.isFinite(ageMinutes) ? ageMinutes > 15 : false };
  }, [summary.alerts]);

  const filteredAlerts = useMemo(() => {
    const q = alertSearch.trim().toLowerCase();
    return summary.alerts
      .filter((alert) => {
        const sev = String(alert.severity || '').trim().toLowerCase();
        if (alertSeverity !== 'all' && sev !== alertSeverity) return false;
        if (!q) return true;
        return String(alert.key || '').toLowerCase().includes(q) || String(alert.message || '').toLowerCase().includes(q);
      })
      .slice()
      .sort((a, b) => {
        const bySeverity = alertRank(a.severity) - alertRank(b.severity);
        if (bySeverity !== 0) return bySeverity;
        const aMs = Date.parse(a.last_seen_at);
        const bMs = Date.parse(b.last_seen_at);
        if (Number.isFinite(aMs) && Number.isFinite(bMs)) return bMs - aMs;
        return String(b.last_seen_at || '').localeCompare(String(a.last_seen_at || ''));
      });
  }, [alertSearch, alertSeverity, summary.alerts]);

  const jobStatusSummary = useMemo(() => {
    if (!summary.jobs.length) return { label: 'No job data', tone: 'neutral', issues: 0 };
    const issues = summary.jobs.filter((job) => job.status === 'down' || job.status === 'degraded').length;
    if (issues === 0) return { label: 'All operational', tone: 'success', issues };
    return { label: `${issues} issue${issues === 1 ? '' : 's'}`, tone: 'warning', issues };
  }, [summary.jobs]);

  const filteredJobs = useMemo(() => {
    const q = jobSearch.trim().toLowerCase();
    return summary.jobs
      .filter((job) => {
        if (!showOperationalJobs && job.status === 'operational') return false;
        if (!q) return true;
        return String(job.label || '').toLowerCase().includes(q) || String(job.id || '').toLowerCase().includes(q);
      })
      .slice()
      .sort((a, b) => {
        const byRank = statusRank(a.status) - statusRank(b.status);
        if (byRank !== 0) return byRank;
        return a.label.localeCompare(b.label);
      });
  }, [jobSearch, showOperationalJobs, summary.jobs]);

  async function refreshSummary() {
    if (refreshing) return;
    setRefreshing(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  async function triggerJob(job: AdminSyncJob) {
    if (triggering) return false;
    setTriggering(job);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await fetch('/api/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = formatSyncTriggerError(json) || (typeof (json as any)?.error === 'string' ? String((json as any).error) : null);
        throw new Error(message || 'Failed to trigger job');
      }
      setActionMessage(`Triggered ${job}`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionError(message || 'Trigger failed');
      return false;
    } finally {
      setTriggering(null);
    }
  }

  async function runMonitoringCheckAndRefresh() {
    const ok = await triggerJob('monitoring_check');
    if (!ok) return;
    await refreshSummary();
  }

  async function disableBackfills({
    exclude = []
  }: { exclude?: Array<'ll2_backfill' | 'll2_payload_backfill' | 'rocket_media_backfill'> } = {}) {
    if (updatingBackfills) return;
    setUpdatingBackfills(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await fetch('/api/admin/backfills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disable_all', exclude })
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to disable backfills');
      }
      setActionMessage('Backfills disabled');
      await refreshSummary();
    } catch (err: any) {
      setActionError(err?.message || 'Failed to disable backfills');
    } finally {
      setUpdatingBackfills(false);
    }
  }

  async function setBackfillEnabled(backfill: 'll2_backfill' | 'll2_payload_backfill' | 'rocket_media_backfill', enabled: boolean) {
    if (updatingBackfills) return;
    setUpdatingBackfills(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await fetch('/api/admin/backfills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_enabled', backfill, enabled })
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to update backfill setting');
      }
      setActionMessage(`Backfill ${backfill} ${enabled ? 'enabled' : 'disabled'}`);
      await refreshSummary();
    } catch (err: any) {
      setActionError(err?.message || 'Failed to update backfill setting');
    } finally {
      setUpdatingBackfills(false);
    }
  }

  async function startPayloadSpacecraftOnlyBackfill() {
    if (updatingBackfills) return;
    setUpdatingBackfills(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await fetch('/api/admin/backfills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start_payload_spacecraft_only', limit: 50 })
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to start spacecraft-only backfill');
      }
      setActionMessage('Started spacecraft-only payload backfill');
      await refreshSummary();
    } catch (err: any) {
      setActionError(err?.message || 'Failed to start spacecraft-only backfill');
    } finally {
      setUpdatingBackfills(false);
    }
  }

  function scrollToJob(jobId: string) {
    setHighlightJobId(jobId);
    const target = document.getElementById(`job-${jobId}`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => setHighlightJobId((prev) => (prev === jobId ? null : prev)), 3500);
  }

  async function loadJobRuns(jobId: string) {
    const jobName = JOB_ID_TO_INGESTION_NAME[jobId] || jobId;
    if (loadingJobRunsFor) return;
    setLoadingJobRunsFor(jobName);
    setJobRunsErrorByName((prev) => {
      const next = { ...prev };
      delete next[jobName];
      return next;
    });
    try {
      const res = await fetch(`/api/admin/ingestion-runs?job=${encodeURIComponent(jobName)}&limit=25`, { cache: 'no-store' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const message = typeof json?.error === 'string' ? json.error : 'Failed to load runs';
        throw new Error(message);
      }
      const json = (await res.json()) as { runs?: IngestionRun[] };
      const runs = Array.isArray(json.runs) ? json.runs : [];
      setJobRunsByName((prev) => ({ ...prev, [jobName]: runs }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setJobRunsErrorByName((prev) => ({ ...prev, [jobName]: message || 'Failed to load runs' }));
    } finally {
      setLoadingJobRunsFor(null);
    }
  }

  const topStats = useMemo(() => {
    const openAlerts = summary.alerts.length;
    const criticalAlerts = summary.alerts.filter((a) => String(a.severity).toLowerCase() === 'critical').length;
    const issues = jobStatusSummary.issues;
    return { openAlerts, criticalAlerts, issues };
  }, [jobStatusSummary.issues, summary.alerts]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-text3">Admin</p>
          <h1 className="text-3xl font-semibold text-text1">Ops</h1>
          <p className="text-sm text-text2">Monitoring, scheduler state, alerts, and ingestion telemetry.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/ops/metrics"
            className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.1em]"
          >
            Metrics
          </Link>
          <Link
            href="/admin/ops/trajectory"
            className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.1em]"
          >
            Trajectory
          </Link>
          <button
            type="button"
            className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.1em]"
            onClick={refreshSummary}
            disabled={refreshing || triggering != null}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.1em] text-text3">
            {summary.mode === 'db' ? 'Live' : 'Stub'}
          </span>
        </div>
      </div>

      {status === 'loading' && (
        <div className="rounded-xl border border-stroke bg-surface-1 p-3 text-sm text-text3">Loading ops data...</div>
      )}

      {status === 'unauthorized' && (
        <div className="rounded-xl border border-warning bg-[rgba(251,191,36,0.08)] p-3 text-sm text-warning">
          {error || 'Admin access required. Sign in with an admin account to continue.'}
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-xl border border-danger bg-[rgba(251,113,133,0.08)] p-3 text-sm text-danger">
          {error || 'Failed to load ops data.'}
        </div>
      )}

      {actionError && (
        <div className="rounded-xl border border-danger bg-[rgba(251,113,133,0.08)] p-3 text-sm text-danger">
          {actionError}
        </div>
      )}
      {actionMessage && (
        <div className="rounded-xl border border-stroke bg-[rgba(234,240,255,0.04)] p-3 text-sm text-text2">
          {actionMessage}
        </div>
      )}

      {status === 'ready' && (
        <div className="grid gap-4 md:grid-cols-4">
          <InfoCard label="Open alerts" value={topStats.openAlerts} />
          <InfoCard label="Critical alerts" value={topStats.criticalAlerts} />
          <InfoCard label="Job issues" value={topStats.issues} />
          <InfoCard label="Outbox queued" value={summary.outboxCounts.queued} />
        </div>
      )}

      {status === 'ready' && (
        <SectionCard
          title="Ops alerts"
          description={
            <div>
              <div>Unresolved scheduler and ingestion warnings from `ops_alerts`.</div>
              {alertsFreshness ? (
                <div className={clsx('mt-1 text-xs', alertsFreshness.isStale ? 'text-warning' : 'text-text3')}>
                  Latest alert seen: {formatTimestamp(alertsFreshness.latestIso)}
                  {Number.isFinite(alertsFreshness.ageMinutes) ? ` (${Math.round(alertsFreshness.ageMinutes)}m ago)` : ''}
                  {lastRefreshedAt ? ` • Last refreshed: ${formatTimestamp(lastRefreshedAt)}` : ''}
                </div>
              ) : lastRefreshedAt ? (
                <div className="mt-1 text-xs text-text3">Last refreshed: {formatTimestamp(lastRefreshedAt)}</div>
              ) : null}
            </div>
          }
          actions={
            <>
              <button
                type="button"
                className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.1em]"
                onClick={runMonitoringCheckAndRefresh}
                disabled={triggering === 'monitoring_check' || refreshing}
              >
                {triggering === 'monitoring_check' ? 'Running…' : 'Run check'}
              </button>
              <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.1em] text-text3">
                {summary.alerts.length ? `${summary.alerts.length} open` : 'Clear'}
              </span>
            </>
          }
        >
          <div className="flex flex-col gap-2 md:flex-row">
            <input
              className="w-full rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
              placeholder="Search alerts (key/message)…"
              value={alertSearch}
              onChange={(e) => setAlertSearch(e.target.value)}
            />
            <select
              className="w-full rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1 md:w-56"
              value={alertSeverity}
              onChange={(e) => setAlertSeverity(e.target.value as any)}
            >
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
          </div>

          <div className="mt-3 space-y-2">
            {filteredAlerts.length === 0 && (
              <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-sm text-text3">
                No active alerts.
              </div>
            )}
            {filteredAlerts.map((alert) => {
              const details = formatAlertDetails(alert.details);
              const related = relatedJobIdFromAlertKey(alert.key);
              const hasRelatedJob = related ? jobById.has(related) : false;
              return (
                <div
                  key={alert.key}
                  className={clsx('rounded-lg border px-3 py-2 text-sm', severityClass(alert.severity))}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="font-semibold">{alert.message}</span>
                    <div className="flex items-center gap-2">
                      {hasRelatedJob && related && (
                        <button
                          type="button"
                          className="btn-secondary rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
                          onClick={() => scrollToJob(related)}
                        >
                          View job
                        </button>
                      )}
                      <span className="text-xs uppercase tracking-[0.08em]">{formatSeverity(alert.severity)}</span>
                    </div>
                  </div>
                  <div className="text-xs text-text3">Key: {alert.key}</div>
                  <div className="text-xs text-text3">Last seen: {formatTimestamp(alert.last_seen_at)}</div>
                  <div className="text-xs text-text3">Occurrences: {alert.occurrences}</div>
                  {details && (
                    <div className="mt-2 whitespace-pre-wrap break-words rounded-md border border-stroke bg-surface-0 px-2 py-1 text-[11px] font-mono text-text3">
                      {details}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {status === 'ready' && (
        <SectionCard
          title="Jobs"
          description="Scheduler configuration, cron checks, and last-known results for every job."
          actions={
            <span
              className={clsx(
                'rounded-full border px-3 py-1 text-xs uppercase tracking-[0.1em]',
                jobStatusSummary.tone === 'success'
                  ? 'border-success/40 text-success bg-success/10'
                  : jobStatusSummary.tone === 'warning'
                    ? 'border-warning/40 text-warning bg-warning/10'
                    : 'border-stroke text-text3'
              )}
            >
              {jobStatusSummary.label}
            </span>
          }
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <InfoCard label="Jobs enabled" value={summary.scheduler.jobsEnabled ? 'On' : 'Off'} />
            <InfoCard label="Jobs base URL" value={summary.scheduler.jobsBaseUrlSet ? 'Set' : 'Missing'} />
            <InfoCard label="Jobs API key" value={summary.scheduler.jobsApiKeySet ? 'Set' : 'Missing'} />
            <InfoCard label="Jobs auth token" value={summary.scheduler.jobsAuthTokenSet ? 'Set' : 'Missing'} />
          </div>

          {summary.scheduler.cronError && (
            <div className="mt-3 rounded-lg border border-warning bg-[rgba(251,191,36,0.08)] px-3 py-2 text-xs text-warning">
              Cron check failed: {summary.scheduler.cronError}
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2 md:flex-row">
            <input
              className="w-full rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
              placeholder="Search jobs…"
              value={jobSearch}
              onChange={(e) => setJobSearch(e.target.value)}
            />
            <label className="flex items-center gap-2 rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-sm text-text2 md:w-56">
              <input
                type="checkbox"
                checked={showOperationalJobs}
                onChange={(e) => setShowOperationalJobs(e.target.checked)}
              />
              Show operational
            </label>
          </div>

          <div className="mt-3 space-y-2">
            {filteredJobs.length === 0 && (
              <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-sm text-text3">
                No job telemetry available yet.
              </div>
            )}
            {filteredJobs.map((job) => {
              const lastRunTimestamp = job.lastEndedAt || job.lastRunAt || null;
              const durationLabel = job.lastDurationSeconds != null ? formatDurationSeconds(job.lastDurationSeconds) : null;
              const statusDetails = [job.statusDetail, job.enabledDetail]
                .map((value) => (typeof value === 'string' ? value.trim() : ''))
                .filter((value) => value.length > 0);
              const statusDetailLabel = statusDetails.length ? Array.from(new Set(statusDetails)).join(' • ') : '—';
              const triggerName = JOB_TRIGGER_BY_ID[job.id];
              const isAdvanced = ADVANCED_JOB_IDS.has(job.id);
              const relatedAlerts = jobsWithRelatedAlerts.get(job.id) ?? 0;
              return (
                <div
                  key={job.id}
                  id={`job-${job.id}`}
                  className={clsx(
                    'rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-sm',
                    highlightJobId === job.id && 'border-primary/60 shadow-glow'
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <div className="font-semibold text-text1">{job.label}</div>
                      {job.origin === 'local' && (
                        <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-warning">
                          Local
                        </span>
                      )}
                      {job.category !== 'scheduled' && (
                        <span
                          className={clsx(
                            'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]',
                            job.category === 'manual'
                              ? 'border-warning/40 text-warning bg-warning/10'
                              : 'border-stroke text-text3 bg-[rgba(255,255,255,0.02)]'
                          )}
                        >
                          {formatJobCategory(job.category)}
                        </span>
                      )}
                      {!job.enabled && (
                        <span className="rounded-full border border-stroke bg-[rgba(255,255,255,0.02)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
                          Disabled
                        </span>
                      )}
                      {relatedAlerts > 0 && (
                        <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-warning">
                          {relatedAlerts} alert{relatedAlerts === 1 ? '' : 's'}
                        </span>
                      )}
                      {isAdvanced && (
                        <span className="rounded-full border border-stroke bg-[rgba(255,255,255,0.02)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
                          Advanced
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {triggerName && !isAdvanced && (
                        <button
                          type="button"
                          className="btn-secondary rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
                          disabled={triggering != null || refreshing}
                          onClick={() => triggerJob(triggerName)}
                        >
                          {triggering === triggerName ? 'Running…' : 'Run'}
                        </button>
                      )}
                      {job.id !== 'll2_incremental' && (
                        <button
                          type="button"
                          className="btn-secondary rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
                          disabled={loadingJobRunsFor != null}
                          onClick={() => loadJobRuns(job.id)}
                        >
                          {loadingJobRunsFor === (JOB_ID_TO_INGESTION_NAME[job.id] || job.id) ? 'Loading…' : 'Runs'}
                        </button>
                      )}
                      <span
                        className={clsx(
                          'inline-flex items-center gap-2 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]',
                          jobStatusBadgeClass(job.status)
                        )}
                      >
                        <span className={clsx('h-2 w-2 rounded-full', jobStatusDotClass(job.status))} />
                        {formatJobStatusLabel(job.status)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-1 grid gap-1 text-xs text-text3 sm:grid-cols-2">
                    <div>Cadence: {job.schedule}</div>
                    <div>
                      Cron:{' '}
                      {job.cronSchedule ? `${job.cronSchedule}${job.cronActive === false ? ' (paused)' : ''}` : job.cronJobName ? 'Missing' : '—'}
                    </div>
                    <div>Last run: {formatTimestamp(lastRunTimestamp)}</div>
                    <div>Last success: {formatTimestamp(job.lastSuccessAt)}</div>
                    <div>
                      Last new data: {formatTimestamp(job.lastNewDataAt)}
                      {job.lastNewDataDetail ? ` • ${job.lastNewDataDetail}` : ''}
                    </div>
                    <div>Duration: {durationLabel || '—'}</div>
                    <div>Status: {statusDetailLabel}</div>
                    <div>Failures: {job.consecutiveFailures != null ? job.consecutiveFailures : '—'}</div>
                    {job.command && (
                      <div className="sm:col-span-2 break-words font-mono text-[11px] text-text3">Command: {job.command}</div>
                    )}
                  </div>

                  {job.lastError && <div className="mt-2 break-words text-xs text-danger">Error: {job.lastError}</div>}

                  {(() => {
                    const jobName = JOB_ID_TO_INGESTION_NAME[job.id] || job.id;
                    const runs = jobRunsByName[jobName];
                    const runsError = jobRunsErrorByName[jobName];
                    if (!runs && !runsError) return null;
                    return (
                      <div className="mt-3 rounded-lg border border-stroke bg-surface-0 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs uppercase tracking-[0.08em] text-text3">Recent runs ({jobName})</div>
                          <button
                            type="button"
                            className="btn-secondary rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
                            disabled={loadingJobRunsFor != null}
                            onClick={() => loadJobRuns(job.id)}
                          >
                            Refresh runs
                          </button>
                        </div>
                        {runsError && <div className="mt-2 text-xs text-warning">{runsError}</div>}
                        {runs && runs.length === 0 && <div className="mt-2 text-xs text-text3">No runs found.</div>}
                        {runs && runs.length > 0 && (
                          <div className="mt-2 space-y-2">
                            {runs.map((run) => {
                              const duration = formatRunDuration(run.started_at, run.ended_at);
                              return (
                                <div
                                  key={`${run.job_name}-${run.started_at}`}
                                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-xs"
                                >
                                  <div className="min-w-0">
                                    <div className="font-semibold text-text1">{run.job_name}</div>
                                    <div className="text-text3">Started: {formatTimestamp(run.started_at)}</div>
                                    <div className="text-text3">
                                      Ended: {formatTimestamp(run.ended_at)}
                                      {duration ? ` • ${duration}` : ''}
                                    </div>
                                    {run.error && <div className="break-words text-danger">Error: {run.error}</div>}
                                  </div>
                                  <span
                                    className={clsx(
                                      'text-[11px] uppercase tracking-[0.08em]',
                                      run.success === false ? 'text-danger' : run.success === true ? 'text-success' : 'text-text3'
                                    )}
                                  >
                                    {run.success === false ? 'Failed' : run.success === true ? 'OK' : 'Pending'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>

          <details className="mt-4 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
            <summary className="cursor-pointer text-xs uppercase tracking-[0.08em] text-text3">Advanced</summary>
            <div className="mt-3 space-y-2">
              <div className="text-sm text-text3">Backfills and force-runs live here to reduce accidental use.</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary"
                  disabled={triggering != null || updatingBackfills}
                  onClick={() => disableBackfills({ exclude: ['ll2_payload_backfill'] })}
                >
                  Disable backfills (keep payload)
                </button>
                <button
                  type="button"
                  className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary"
                  disabled={triggering != null || updatingBackfills}
                  onClick={() => {
                    const confirm = window.confirm(
                      'Disable LL2 payload backfill? This can pause spacecraft manifest backfill and stop payload manifest refresh.'
                    );
                    if (!confirm) return;
                    void setBackfillEnabled('ll2_payload_backfill', false);
                  }}
                >
                  Disable payload backfill job
                </button>
                <button
                  type="button"
                  className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary"
                  disabled={triggering != null || updatingBackfills}
                  onClick={() => setBackfillEnabled('ll2_payload_backfill', true)}
                >
                  Enable payload backfill job
                </button>
                <button
                  type="button"
                  className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary"
                  disabled={triggering != null || updatingBackfills}
                  onClick={() => {
                    const confirm = window.confirm('Trigger Billing reconcile? This may contact Stripe and update local billing state.');
                    if (!confirm) return;
                    void triggerJob('billing_reconcile');
                  }}
                >
                  {triggering === 'billing_reconcile' ? 'Running…' : 'Billing reconcile'}
                </button>
                <button
                  type="button"
                  className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary"
                  disabled={triggering != null || updatingBackfills}
                  onClick={() => {
                    const confirm = window.confirm('Force-run LL2 backfill? This can be expensive.');
                    if (!confirm) return;
                    const typed = window.prompt('Type FORCE LL2 BACKFILL to confirm.');
                    if (!typed || typed.trim().toUpperCase() !== 'FORCE LL2 BACKFILL') return;
                    void triggerJob('ll2_backfill');
                  }}
                >
                  {triggering === 'll2_backfill' ? 'Running…' : 'LL2 backfill (force)'}
                </button>
                <button
                  type="button"
                  className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary"
                  disabled={triggering != null || updatingBackfills}
                  onClick={() => {
                    const confirm = window.confirm('Force-run LL2 payload backfill? This can be expensive.');
                    if (!confirm) return;
                    const typed = window.prompt('Type FORCE LL2 PAYLOAD BACKFILL to confirm.');
                    if (!typed || typed.trim().toUpperCase() !== 'FORCE LL2 PAYLOAD BACKFILL') return;
                    void triggerJob('ll2_payload_backfill');
                  }}
                >
                  {triggering === 'll2_payload_backfill' ? 'Running…' : 'LL2 payload backfill (force)'}
                </button>
                <button
                  type="button"
                  className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary"
                  disabled={triggering != null || updatingBackfills}
                  onClick={() => {
                    const confirm = window.confirm('Force-run Rocket media backfill? This can be expensive.');
                    if (!confirm) return;
                    const typed = window.prompt('Type FORCE ROCKET MEDIA BACKFILL to confirm.');
                    if (!typed || typed.trim().toUpperCase() !== 'FORCE ROCKET MEDIA BACKFILL') return;
                    void triggerJob('rocket_media_backfill');
                  }}
                >
                  {triggering === 'rocket_media_backfill' ? 'Running…' : 'Rocket media backfill (force)'}
                </button>
                <button
                  type="button"
                  className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary"
                  disabled={triggering != null || updatingBackfills}
                  onClick={() => {
                    const confirm = window.confirm(
                      'Start spacecraft-only payload backfill? This will reset the cursor and re-scan LL2 launches, but will NOT rewrite payload rows.'
                    );
                    if (!confirm) return;
                    const typed = window.prompt('Type START SPACECRAFT ONLY to confirm.');
                    if (!typed || typed.trim().toUpperCase() !== 'START SPACECRAFT ONLY') return;
                    void startPayloadSpacecraftOnlyBackfill();
                  }}
                >
                  Start spacecraft-only payload backfill
                </button>
              </div>
            </div>
          </details>
        </SectionCard>
      )}

      {status === 'ready' && (
        <SectionCard title="Ingestion runs" description="Last 5 runs from `ingestion_runs`.">
          <div className="space-y-2">
            {summary.ingestionRuns.length === 0 && (
              <div className="text-sm text-text3">No runs yet (stub data shown).</div>
            )}
            {summary.ingestionRuns.map((run) => {
              const duration = formatRunDuration(run.started_at, run.ended_at);
              const stats = formatJson(run.stats);
              return (
                <div
                  key={`${run.job_name}-${run.started_at}`}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-text1">{run.job_name}</div>
                    <div className="text-xs text-text3">Started: {formatTimestamp(run.started_at)}</div>
                    <div className="text-xs text-text3">
                      Ended: {formatTimestamp(run.ended_at)}
                      {duration ? ` • ${duration}` : ''}
                    </div>
                    {run.error && <div className="break-words text-xs text-danger">Error: {run.error}</div>}
                    {stats && <div className="break-words font-mono text-xs text-text3">Stats: {stats}</div>}
                  </div>
                  <span className={run.success === false ? 'text-danger' : run.success === true ? 'text-success' : 'text-text3'}>
                    {run.success === false ? 'Failed' : run.success === true ? 'OK' : 'Pending'}
                  </span>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {status === 'ready' && (
        <SectionCard
          title="Notification outbox"
          description="Queued/failed counts come from notifications_outbox; legacy channels are retired and push is the remaining delivery path."
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <InfoCard label="Queued" value={summary.outboxCounts.queued ?? 0} />
            <InfoCard label="Failed" value={summary.outboxCounts.failed ?? 0} />
            <InfoCard label="Sent today" value={summary.outboxCounts.sentToday ?? 0} />
          </div>
        </SectionCard>
      )}
    </div>
  );
}
