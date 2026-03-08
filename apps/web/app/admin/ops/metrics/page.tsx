'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import InfoCard from '../../_components/InfoCard';
import SectionCard from '../../_components/SectionCard';
import { formatTimestamp } from '../../_lib/format';
import type {
  AdminJobIoResponse,
  AdminMetricsSeriesResponse,
  AdminMetricsSummary,
  AdminQueryIoResponse,
  AdminSchedulerMetricsResponse
} from '../../_lib/types';

type TabId = 'overview' | 'io' | 'query' | 'scheduler' | 'jobs';

const TAB_ITEMS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'io', label: 'IO Throughput' },
  { id: 'query', label: 'Query IO' },
  { id: 'scheduler', label: 'Scheduler' },
  { id: 'jobs', label: 'Job IO' }
];

const WINDOW_OPTIONS = [1, 6, 24, 72, 168];

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

function fmtNum(value: number | null | undefined, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function fmtPct(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)}%`;
}

function fmtBytes(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = value;
  let idx = 0;
  while (n >= 1024 && idx < units.length - 1) {
    n /= 1024;
    idx += 1;
  }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[idx]}`;
}

function fmtBytesPerSec(value: number | null | undefined) {
  const raw = fmtBytes(value);
  return raw === '—' ? raw : `${raw}/s`;
}

function fmtAgeMinutes(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${Math.round(value)}m`;
}

function SimpleLineChart({
  points,
  stroke,
  height = 90
}: {
  points: Array<{ sampledAt: string; value: number }>;
  stroke: string;
  height?: number;
}) {
  if (!points.length) {
    return <div className="h-[90px] rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-xs text-text3">No data</div>;
  }

  const width = 360;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;

  const d = points
    .map((point, idx) => {
      const x = (idx / Math.max(1, points.length - 1)) * width;
      const y = height - ((point.value - min) / spread) * (height - 8) - 4;
      return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <div className="rounded-lg border border-stroke bg-surface-0 p-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[90px] w-full">
        <path d={d} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

async function fetchJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(url, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = typeof (json as any)?.error === 'string' ? (json as any).error : 'request_failed';
    return { ok: false, status: res.status, error };
  }
  return { ok: true, data: json as T };
}

export default function AdminOpsMetricsPage() {
  const [windowHours, setWindowHours] = useState<number>(24);
  const [resolution, setResolution] = useState<'1m' | '5m'>('1m');
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const [unauthorized, setUnauthorized] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const [summaryState, setSummaryState] = useState<LoadState>('idle');
  const [summary, setSummary] = useState<AdminMetricsSummary | null>(null);

  const [seriesState, setSeriesState] = useState<LoadState>('idle');
  const [series, setSeries] = useState<AdminMetricsSeriesResponse | null>(null);

  const [queryState, setQueryState] = useState<LoadState>('idle');
  const [queryIo, setQueryIo] = useState<AdminQueryIoResponse | null>(null);

  const [schedulerState, setSchedulerState] = useState<LoadState>('idle');
  const [scheduler, setScheduler] = useState<AdminSchedulerMetricsResponse | null>(null);

  const [jobState, setJobState] = useState<LoadState>('idle');
  const [jobIo, setJobIo] = useState<AdminJobIoResponse | null>(null);

  const loadSummary = useCallback(async () => {
    setSummaryState('loading');
    setGlobalError(null);
    const res = await fetchJson<AdminMetricsSummary>(
      `/api/admin/metrics/summary?windowHours=${windowHours}&resolution=${resolution}`
    );
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        setUnauthorized(true);
        setSummaryState('error');
        return;
      }
      setGlobalError(res.error);
      setSummaryState('error');
      return;
    }
    setSummary(res.data);
    setSummaryState('ready');
  }, [resolution, windowHours]);

  const loadSeries = useCallback(async () => {
    setSeriesState('loading');
    const res = await fetchJson<AdminMetricsSeriesResponse>(
      `/api/admin/metrics/series?windowHours=${windowHours}&resolution=${resolution}`
    );
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) setUnauthorized(true);
      setSeriesState('error');
      setGlobalError((prev) => prev || res.error);
      return;
    }
    setSeries(res.data);
    setSeriesState('ready');
  }, [resolution, windowHours]);

  const loadQueryIo = useCallback(async () => {
    setQueryState('loading');
    const res = await fetchJson<AdminQueryIoResponse>('/api/admin/metrics/query-io?limit=25');
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) setUnauthorized(true);
      setQueryState('error');
      setGlobalError((prev) => prev || res.error);
      return;
    }
    setQueryIo(res.data);
    setQueryState('ready');
  }, []);

  const loadScheduler = useCallback(async () => {
    setSchedulerState('loading');
    const res = await fetchJson<AdminSchedulerMetricsResponse>(`/api/admin/metrics/scheduler?windowHours=${windowHours}`);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) setUnauthorized(true);
      setSchedulerState('error');
      setGlobalError((prev) => prev || res.error);
      return;
    }
    setScheduler(res.data);
    setSchedulerState('ready');
  }, [windowHours]);

  const loadJobIo = useCallback(async () => {
    setJobState('loading');
    const res = await fetchJson<AdminJobIoResponse>('/api/admin/metrics/job-io?sinceHours=72&limitPerJob=200');
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) setUnauthorized(true);
      setJobState('error');
      setGlobalError((prev) => prev || res.error);
      return;
    }
    setJobIo(res.data);
    setJobState('ready');
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (activeTab !== 'io') return;
    void loadSeries();
  }, [activeTab, loadSeries]);

  useEffect(() => {
    if (activeTab !== 'query') return;
    void loadQueryIo();
  }, [activeTab, loadQueryIo]);

  useEffect(() => {
    if (activeTab !== 'scheduler') return;
    void loadScheduler();
  }, [activeTab, loadScheduler]);

  useEffect(() => {
    if (activeTab !== 'jobs') return;
    void loadJobIo();
  }, [activeTab, loadJobIo]);

  const seriesByKey = useMemo(() => {
    const map = new Map<string, Array<{ sampledAt: string; value: number }>>();
    for (const item of series?.series || []) map.set(item.metricKey, item.points || []);
    return map;
  }, [series]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-text3">Admin</p>
          <h1 className="text-3xl font-semibold text-text1">Ops Metrics</h1>
          <p className="text-sm text-text2">IO observability, query pressure, and ingestion movement reporting.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin/ops" className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.1em]">
            Back to ops
          </Link>
          <button
            type="button"
            className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.1em]"
            onClick={() => {
              void loadSummary();
              if (activeTab === 'io') void loadSeries();
              if (activeTab === 'query') void loadQueryIo();
              if (activeTab === 'scheduler') void loadScheduler();
              if (activeTab === 'jobs') void loadJobIo();
            }}
            disabled={summaryState === 'loading'}
          >
            {summaryState === 'loading' ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <SectionCard
        title="Time Window"
        description="Applies to overview and throughput series."
        actions={
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
              value={windowHours}
              onChange={(event) => setWindowHours(Number(event.target.value))}
            >
              {WINDOW_OPTIONS.map((hours) => (
                <option key={hours} value={hours}>
                  {hours >= 24 ? `${hours / 24}d` : `${hours}h`}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
              value={resolution}
              onChange={(event) => setResolution(event.target.value === '5m' ? '5m' : '1m')}
            >
              <option value="1m">1m</option>
              <option value="5m">5m</option>
            </select>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          {TAB_ITEMS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'rounded-full border px-3 py-1 text-xs uppercase tracking-[0.08em]',
                activeTab === tab.id ? 'border-primary/60 bg-primary/10 text-text1' : 'border-stroke text-text3 hover:text-text1'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </SectionCard>

      {unauthorized && (
        <div className="rounded-xl border border-warning bg-[rgba(251,191,36,0.08)] p-3 text-sm text-warning">
          Admin access required. Sign in with an admin account to continue.
        </div>
      )}

      {globalError && (
        <div className="rounded-xl border border-danger bg-[rgba(251,113,133,0.08)] p-3 text-sm text-danger">
          {globalError}
        </div>
      )}

      {activeTab === 'overview' && (
        <SectionCard
          title="Overview"
          description={summary?.latestSampleAt ? `Latest sample ${formatTimestamp(summary.latestSampleAt)}` : 'No sample yet'}
          actions={
            <span
              className={clsx(
                'rounded-full border px-3 py-1 text-xs uppercase tracking-[0.1em]',
                summary?.stale ? 'border-warning/40 bg-warning/10 text-warning' : 'border-success/40 bg-success/10 text-success'
              )}
            >
              {summary?.stale ? `Stale (${fmtAgeMinutes(summary?.staleMinutes)})` : 'Fresh'}
            </span>
          }
        >
          {summaryState === 'loading' && <div className="text-sm text-text3">Loading metrics summary...</div>}
          {summaryState === 'ready' && summary && (
            <>
              <div className="grid gap-3 md:grid-cols-4">
                <InfoCard label="Disk read/s" value={fmtBytesPerSec(summary.cards.diskReadBps)} />
                <InfoCard label="Disk write/s" value={fmtBytesPerSec(summary.cards.diskWriteBps)} />
                <InfoCard label="IO wait" value={fmtPct(summary.cards.ioWaitPct)} />
                <InfoCard label="Deadlocks/min" value={fmtNum(summary.cards.deadlocksPerMin, 3)} />
                <InfoCard label="Checkpoint write ms/s" value={fmtNum(summary.cards.checkpointWriteMsPerSec, 3)} />
                <InfoCard label="DB size" value={`${fmtNum(summary.cards.dbSizeMb, 1)} MB`} />
                <InfoCard label="FS used" value={fmtBytes(summary.cards.fsUsedBytes)} />
                <InfoCard label="FS avail" value={fmtBytes(summary.cards.fsAvailBytes)} />
              </div>
              {summary.notes.length > 0 && (
                <div className="mt-3 space-y-1 text-xs text-warning">
                  {summary.notes.map((note) => (
                    <div key={note}>{note}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </SectionCard>
      )}

      {activeTab === 'io' && (
        <SectionCard title="IO Throughput" description="Derived rates from stored counter metrics.">
          {seriesState === 'loading' && <div className="text-sm text-text3">Loading throughput series...</div>}
          {seriesState === 'ready' && (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs uppercase tracking-[0.08em] text-text3">Disk read bytes/s</div>
                <SimpleLineChart points={seriesByKey.get('disk_read_bps') || []} stroke="#60a5fa" />
              </div>
              <div>
                <div className="mb-1 text-xs uppercase tracking-[0.08em] text-text3">Disk write bytes/s</div>
                <SimpleLineChart points={seriesByKey.get('disk_write_bps') || []} stroke="#f59e0b" />
              </div>
              <div>
                <div className="mb-1 text-xs uppercase tracking-[0.08em] text-text3">Checkpoint write ms/s</div>
                <SimpleLineChart points={seriesByKey.get('checkpoint_write_ms_per_sec') || []} stroke="#34d399" />
              </div>
              <div>
                <div className="mb-1 text-xs uppercase tracking-[0.08em] text-text3">Deadlocks per minute</div>
                <SimpleLineChart points={seriesByKey.get('deadlocks_per_min') || []} stroke="#f87171" />
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {activeTab === 'query' && (
        <SectionCard title="Query IO" description="pg_stat_statements outliers and table write pressure.">
          {queryState === 'loading' && <div className="text-sm text-text3">Loading query IO data...</div>}
          {queryState === 'ready' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-stroke bg-surface-0">
                <div className="px-3 py-2 text-xs uppercase tracking-[0.08em] text-text3">Top query outliers</div>
                <div className="max-h-[320px] overflow-auto">
                  <table className="w-full text-left text-xs text-text2">
                    <thead className="sticky top-0 bg-surface-0 text-[11px] uppercase tracking-[0.08em] text-text3">
                      <tr>
                        <th className="px-3 py-2">Query</th>
                        <th className="px-3 py-2">Calls</th>
                        <th className="px-3 py-2">Total ms</th>
                        <th className="px-3 py-2">Blk write</th>
                        <th className="px-3 py-2">Temp write</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(queryIo?.outliers || []).map((row, idx) => (
                        <tr key={`${idx}-${row.query.slice(0, 20)}`} className="border-t border-stroke">
                          <td className="px-3 py-2">
                            <div className="max-w-[440px] whitespace-pre-wrap break-words font-mono text-[11px]">{row.query}</div>
                          </td>
                          <td className="px-3 py-2">{row.calls}</td>
                          <td className="px-3 py-2">{fmtNum(row.total_exec_time, 2)}</td>
                          <td className="px-3 py-2">{row.shared_blks_written}</td>
                          <td className="px-3 py-2">{row.temp_blks_written}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-xl border border-stroke bg-surface-0">
                <div className="px-3 py-2 text-xs uppercase tracking-[0.08em] text-text3">Table write pressure</div>
                <div className="max-h-[320px] overflow-auto">
                  <table className="w-full text-left text-xs text-text2">
                    <thead className="sticky top-0 bg-surface-0 text-[11px] uppercase tracking-[0.08em] text-text3">
                      <tr>
                        <th className="px-3 py-2">Table</th>
                        <th className="px-3 py-2">Writes</th>
                        <th className="px-3 py-2">Dead tuples</th>
                        <th className="px-3 py-2">Dead ratio</th>
                        <th className="px-3 py-2">Last autovacuum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(queryIo?.tableWritePressure || []).map((row) => (
                        <tr key={row.table_name} className="border-t border-stroke">
                          <td className="px-3 py-2 font-mono">{row.table_name}</td>
                          <td className="px-3 py-2">{row.total_writes}</td>
                          <td className="px-3 py-2">{row.n_dead_tup}</td>
                          <td className="px-3 py-2">{fmtPct(row.dead_ratio * 100)}</td>
                          <td className="px-3 py-2">{formatTimestamp(row.last_autovacuum)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {activeTab === 'scheduler' && (
        <SectionCard title="Managed Scheduler" description="Queue depth, dispatch lag, and per-job backlog for managed cron jobs.">
          {schedulerState === 'loading' && <div className="text-sm text-text3">Loading scheduler metrics...</div>}
          {schedulerState === 'ready' && scheduler && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <InfoCard
                  label="Enabled jobs"
                  value={`${Math.max(0, scheduler.summary.jobsEnabled)}/${Math.max(0, scheduler.summary.jobsTotal)}`}
                />
                <InfoCard label="Queued" value={fmtNum(scheduler.summary.queued, 0)} />
                <InfoCard label="Sending" value={fmtNum(scheduler.summary.sending, 0)} />
                <InfoCard label="Sent (window)" value={fmtNum(scheduler.summary.sentWindow, 0)} />
                <InfoCard label="Failed (window)" value={fmtNum(scheduler.summary.failedWindow, 0)} />
                <InfoCard label="Avg lag (s)" value={fmtNum(scheduler.summary.avgLagSeconds, 1)} />
                <InfoCard label="P95 lag (s)" value={fmtNum(scheduler.summary.p95LagSeconds, 1)} />
                <InfoCard label="Oldest queued" value={formatTimestamp(scheduler.summary.oldestQueuedAt)} />
              </div>

              <div className="rounded-xl border border-stroke bg-surface-0">
                <div className="px-3 py-2 text-xs uppercase tracking-[0.08em] text-text3">Per-job queue state</div>
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full text-left text-xs text-text2">
                    <thead className="sticky top-0 bg-surface-0 text-[11px] uppercase tracking-[0.08em] text-text3">
                      <tr>
                        <th className="px-3 py-2">Job</th>
                        <th className="px-3 py-2">Queued</th>
                        <th className="px-3 py-2">Sending</th>
                        <th className="px-3 py-2">Sent</th>
                        <th className="px-3 py-2">Failed</th>
                        <th className="px-3 py-2">Next run</th>
                        <th className="px-3 py-2">Last dispatch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(scheduler.jobs || []).map((row) => (
                        <tr key={row.cronJobName} className="border-t border-stroke">
                          <td className="px-3 py-2 font-mono">
                            {row.cronJobName}
                            {row.lastError ? <div className="text-danger">Error: {row.lastError}</div> : null}
                          </td>
                          <td className="px-3 py-2">{fmtNum(row.queued, 0)}</td>
                          <td className="px-3 py-2">{fmtNum(row.sending, 0)}</td>
                          <td className="px-3 py-2">{fmtNum(row.sentWindow, 0)}</td>
                          <td className="px-3 py-2">{fmtNum(row.failedWindow, 0)}</td>
                          <td className="px-3 py-2">{formatTimestamp(row.nextRunAt)}</td>
                          <td className="px-3 py-2">{formatTimestamp(row.lastDispatchedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {activeTab === 'jobs' && (
        <SectionCard title="Job IO" description="Estimated row/counter movement from ingestion_runs.stats.">
          {jobState === 'loading' && <div className="text-sm text-text3">Loading job IO metrics...</div>}
          {jobState === 'ready' && (
            <div className="rounded-xl border border-stroke bg-surface-0">
              <div className="px-3 py-2 text-xs uppercase tracking-[0.08em] text-text3">
                Window start: {formatTimestamp(jobIo?.sinceIso || null)}
              </div>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-left text-xs text-text2">
                  <thead className="sticky top-0 bg-surface-0 text-[11px] uppercase tracking-[0.08em] text-text3">
                    <tr>
                      <th className="px-3 py-2">Job</th>
                      <th className="px-3 py-2">Runs</th>
                      <th className="px-3 py-2">Success %</th>
                      <th className="px-3 py-2">Avg move</th>
                      <th className="px-3 py-2">P95 move</th>
                      <th className="px-3 py-2">Zero move %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(jobIo?.rows || []).map((row) => (
                      <tr key={row.job} className="border-t border-stroke">
                        <td className="px-3 py-2 font-mono">
                          {row.job}
                          {row.error ? <div className="text-danger">Error: {row.error}</div> : null}
                        </td>
                        <td className="px-3 py-2">{row.runs}</td>
                        <td className="px-3 py-2">{fmtPct(row.successRatePct)}</td>
                        <td className="px-3 py-2">{fmtNum(row.avgMovedPerRun, 1)}</td>
                        <td className="px-3 py-2">{fmtNum(row.p95MovedPerRun, 1)}</td>
                        <td className="px-3 py-2">{fmtPct(row.zeroMoveRatePct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
