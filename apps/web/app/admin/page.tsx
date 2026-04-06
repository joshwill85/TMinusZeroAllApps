'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import InfoCard from './_components/InfoCard';
import SectionCard from './_components/SectionCard';
import { useAdminResource } from './_hooks/useAdminResource';
import { formatTimestamp } from './_lib/format';
import { relatedJobIdFromAlertKey } from './_lib/jobs';
import { FALLBACK_ADMIN_SUMMARY, parseAdminSummary } from './_lib/summary';

function alertRank(severity: string) {
  const cleaned = String(severity || '').trim().toLowerCase();
  if (cleaned === 'critical') return 0;
  if (cleaned === 'warning') return 1;
  if (cleaned === 'info') return 2;
  return 3;
}

export default function AdminOverviewPage() {
  const { data: summary, status, error, refresh, lastRefreshedAt } = useAdminResource('/api/admin/summary', {
    initialData: FALLBACK_ADMIN_SUMMARY,
    parse: parseAdminSummary
  });

  const [refreshing, setRefreshing] = useState(false);

  const topAlerts = useMemo(() => {
    return summary.alerts
      .slice()
      .sort((a, b) => {
        const bySeverity = alertRank(a.severity) - alertRank(b.severity);
        if (bySeverity !== 0) return bySeverity;
        const aMs = Date.parse(a.last_seen_at);
        const bMs = Date.parse(b.last_seen_at);
        if (Number.isFinite(aMs) && Number.isFinite(bMs)) return bMs - aMs;
        return String(b.last_seen_at || '').localeCompare(String(a.last_seen_at || ''));
      })
      .slice(0, 5);
  }, [summary.alerts]);

  const jobIssues = useMemo(() => summary.jobs.filter((job) => job.status === 'down' || job.status === 'degraded').length, [summary.jobs]);
  const criticalAlerts = useMemo(
    () => summary.alerts.filter((alert) => String(alert.severity || '').toLowerCase() === 'critical').length,
    [summary.alerts]
  );

  async function refreshOverview() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-text3">Admin</p>
          <h1 className="text-3xl font-semibold text-text1">Control Panel</h1>
          <p className="text-sm text-text2">Entry point for ops, users, billing, coupons, and feedback.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.1em]"
            onClick={refreshOverview}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.1em] text-text3">
            {summary.mode === 'db' ? 'Live' : 'Stub'}
          </span>
        </div>
      </div>

      {status === 'loading' && (
        <div className="rounded-xl border border-stroke bg-surface-1 p-3 text-sm text-text3">Loading admin data...</div>
      )}

      {status === 'unauthorized' && (
        <div className="rounded-xl border border-warning bg-[rgba(251,191,36,0.08)] p-3 text-sm text-warning">
          {error || 'Admin access required. Sign in with an admin account to continue.'}
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-xl border border-danger bg-[rgba(251,113,133,0.08)] p-3 text-sm text-danger">
          {error || 'Failed to load admin data.'}
        </div>
      )}

      {status === 'ready' && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <InfoCard label="Open alerts" value={summary.alerts.length} />
            <InfoCard label="Critical alerts" value={criticalAlerts} />
            <InfoCard label="Job issues" value={jobIssues} />
            <InfoCard label="Outbox queued" value={summary.outboxCounts.queued} />
          </div>

          <SectionCard
            title="Quick links"
            description={
              <>
                Most work happens in <span className="font-semibold text-text1">Ops</span>. Sensitive actions are kept under Advanced.
              </>
            }
          >
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/ops" className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary">
                Ops
              </Link>
              <Link
                href="/admin/ws45"
                className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary"
              >
                WS45
              </Link>
              <Link
                href="/admin/users"
                className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary"
              >
                Users
              </Link>
              <Link
                href="/admin/billing"
                className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary"
              >
                Billing
              </Link>
              <Link
                href="/admin/coupons"
                className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary"
              >
                Coupons
              </Link>
              <Link
                href="/admin/feedback"
                className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-sm text-text1 hover:border-primary"
              >
                Feedback
              </Link>
            </div>
            {lastRefreshedAt && <div className="mt-3 text-xs text-text3">Last refreshed: {formatTimestamp(lastRefreshedAt)}</div>}
          </SectionCard>

          <SectionCard
            title="Top alerts"
            description="Most recent unresolved alerts. Use Ops to investigate and run checks."
            actions={
              <Link
                href="/admin/ops"
                className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.1em]"
              >
                Open ops
              </Link>
            }
          >
            <div className="space-y-2">
              {topAlerts.length === 0 && (
                <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-sm text-text3">
                  No active alerts.
                </div>
              )}
              {topAlerts.map((alert) => {
                const related = relatedJobIdFromAlertKey(alert.key);
                return (
                  <div key={alert.key} className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-text1">{alert.message}</div>
                        <div className="text-xs text-text3">
                          {alert.key} • last seen {formatTimestamp(alert.last_seen_at)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {related && (
                          <span
                            className={clsx(
                              'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]',
                              'border-stroke text-text3 bg-[rgba(255,255,255,0.02)]'
                            )}
                          >
                            {related}
                          </span>
                        )}
                        <span className="text-[11px] uppercase tracking-[0.08em] text-text3">{String(alert.severity || '—')}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
