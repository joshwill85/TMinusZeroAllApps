'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import InfoCard from '../_components/InfoCard';
import SectionCard from '../_components/SectionCard';
import { useAdminResource } from '../_hooks/useAdminResource';
import { formatObservedCount, formatTimestamp, formatWs45SourceSnapshot } from '../_lib/format';
import { useSafePathname } from '@/lib/client/useSafePathname';
import { useSafeSearchParams } from '@/lib/client/useSafeSearchParams';

type Ws45Alert = {
  key: string;
  severity: string;
  message: string;
  first_seen_at: string;
  last_seen_at: string;
  occurrences: number;
  details?: Record<string, unknown> | null;
  affectedRows?: Array<{
    kind: 'forecast' | 'launch';
    id: string | null;
    launchId: string | null;
    forecastId: string | null;
    label: string;
    sourceLabel: string | null;
    missionName: string | null;
    pdfUrl: string | null;
    fetchedAt: string | null;
    issuedAt: string | null;
    validStart: string | null;
    validEnd: string | null;
    matchStatus: string | null;
    parseStatus: string | null;
    publishEligible: boolean | null;
    documentFamily: string | null;
    parseVersion: string | null;
  }>;
  affectedForecastIds?: string[];
  affectedLaunchIds?: string[];
  resolved?: boolean;
  resolved_at?: string | null;
};

type Ws45ForecastRow = {
  id: string;
  source_label: string | null;
  forecast_kind: string | null;
  pdf_url: string | null;
  issued_at: string | null;
  valid_start: string | null;
  valid_end: string | null;
  fetched_at: string | null;
  mission_name: string | null;
  match_status: string | null;
  match_confidence: number | null;
  parse_version: string | null;
  document_family: string | null;
  parse_status: string | null;
  parse_confidence: number | null;
  publish_eligible: boolean;
  quarantine_reasons: string[] | null;
  required_fields_missing: string[] | null;
  normalization_flags: string[] | null;
  matched_launch_id: string | null;
};

type Ws45CoverageRow = {
  launchId: string;
  launchName: string;
  net: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  padName: string | null;
  padShortCode: string | null;
  status: 'covered' | 'quarantined' | 'attention' | 'missing';
  statusReason: string;
  forecastId: string | null;
  sourceLabel: string | null;
  issuedAt: string | null;
  validStart: string | null;
  validEnd: string | null;
  parseVersion: string | null;
  documentFamily: string | null;
  matchStatus: string | null;
  parseStatus: string | null;
  quarantineReasons: string[];
  requiredFieldsMissing: string[];
};

type CountBucket = {
  label: string;
  count: number;
};

type Ws45TrendWindow = {
  label: string;
  since: string;
  totalDocs: number;
  parsedDocs: number;
  partialDocs: number;
  failedDocs: number;
  publishEligibleDocs: number;
  unknownFamilyDocs: number;
  parsedPct: number;
  publishPct: number;
  topFamily: string | null;
};

type Ws45ReplayVersionStat = {
  parserVersion: string;
  replayCount: number;
  recoveredCount: number;
  matchedCount: number;
  lastReplayAt: string | null;
};

type Ws45ParseRun = {
  id: string;
  forecast_id: string;
  parser_version: string | null;
  runtime: string | null;
  attempt_reason: string | null;
  document_mode: string | null;
  document_family: string | null;
  parse_status: string | null;
  parse_confidence: number | null;
  publish_eligible: boolean;
  missing_required_fields: string[] | null;
  validation_failures: string[] | null;
  normalization_flags: string[] | null;
  field_confidence: Record<string, number> | null;
  field_evidence: Record<string, unknown> | null;
  strategy_trace: Record<string, unknown> | null;
  stats: Record<string, unknown> | null;
  created_at: string | null;
};

type Ws45SummaryState = {
  mode: 'db' | 'stub';
  health: {
    latestIngestAt: string | null;
    latestParseRunAt: string | null;
    openAlertCount: number;
    recentForecastCount: number;
    publishEligibleCount: number;
    quarantinedCount: number;
    upcomingFloridaLaunchCount: number;
    coverageCount: number;
    coverageGapCount: number;
  };
  latestRun: Record<string, unknown> | null;
  alerts: Ws45Alert[];
  alertHistory: Ws45Alert[];
  recentForecasts: Ws45ForecastRow[];
  coverage: Ws45CoverageRow[];
  familyCounts: CountBucket[];
  parseStatusCounts: CountBucket[];
  trends: {
    windows: Ws45TrendWindow[];
    replayByVersion: Ws45ReplayVersionStat[];
  };
  parseRunsByForecast: Record<string, Ws45ParseRun[]>;
};

const FALLBACK_SUMMARY: Ws45SummaryState = {
  mode: 'stub',
  health: {
    latestIngestAt: null,
    latestParseRunAt: null,
    openAlertCount: 0,
    recentForecastCount: 0,
    publishEligibleCount: 0,
    quarantinedCount: 0,
    upcomingFloridaLaunchCount: 0,
    coverageCount: 0,
    coverageGapCount: 0
  },
  latestRun: null,
  alerts: [],
  alertHistory: [],
  recentForecasts: [],
  coverage: [],
  familyCounts: [],
  parseStatusCounts: [],
  trends: {
    windows: [],
    replayByVersion: []
  },
  parseRunsByForecast: {}
};

function parseWs45Summary(value: unknown): Ws45SummaryState {
  if (!value || typeof value !== 'object') return FALLBACK_SUMMARY;
  const mode = (value as any).mode === 'db' ? 'db' : 'stub';
  const summary = (value as any).summary;
  if (!summary || typeof summary !== 'object') return FALLBACK_SUMMARY;
  return {
    ...FALLBACK_SUMMARY,
    ...summary,
    health: { ...FALLBACK_SUMMARY.health, ...((summary as any).health || {}) },
    alerts: Array.isArray((summary as any).alerts) ? ((summary as any).alerts as Ws45Alert[]) : [],
    alertHistory: Array.isArray((summary as any).alertHistory) ? ((summary as any).alertHistory as Ws45Alert[]) : [],
    recentForecasts: Array.isArray((summary as any).recentForecasts) ? ((summary as any).recentForecasts as Ws45ForecastRow[]) : [],
    coverage: Array.isArray((summary as any).coverage) ? ((summary as any).coverage as Ws45CoverageRow[]) : [],
    familyCounts: Array.isArray((summary as any).familyCounts) ? ((summary as any).familyCounts as CountBucket[]) : [],
    parseStatusCounts: Array.isArray((summary as any).parseStatusCounts) ? ((summary as any).parseStatusCounts as CountBucket[]) : [],
    trends: {
      windows: Array.isArray((summary as any).trends?.windows) ? ((summary as any).trends.windows as Ws45TrendWindow[]) : [],
      replayByVersion: Array.isArray((summary as any).trends?.replayByVersion)
        ? ((summary as any).trends.replayByVersion as Ws45ReplayVersionStat[])
        : []
    },
    parseRunsByForecast:
      (summary as any).parseRunsByForecast && typeof (summary as any).parseRunsByForecast === 'object'
        ? ((summary as any).parseRunsByForecast as Record<string, Ws45ParseRun[]>)
        : {},
    latestRun: (summary as any).latestRun && typeof (summary as any).latestRun === 'object' ? (summary as any).latestRun : null,
    mode
  };
}

function badgeClass(status: string) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'covered' || normalized === 'parsed' || normalized === 'matched') {
    return 'border-success/40 bg-success/10 text-success';
  }
  if (normalized === 'warning' || normalized === 'partial' || normalized === 'ambiguous') {
    return 'border-warning/40 bg-warning/10 text-warning';
  }
  if (normalized === 'quarantined' || normalized === 'attention') {
    return 'border-warning/40 bg-warning/10 text-warning';
  }
  if (normalized === 'critical' || normalized === 'failed' || normalized === 'missing' || normalized === 'unmatched') {
    return 'border-danger/40 bg-[rgba(251,113,133,0.08)] text-danger';
  }
  return 'border-stroke bg-[rgba(255,255,255,0.02)] text-text3';
}

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '0%';
  return `${Math.round(value)}%`;
}

function formatValueList(values: string[] | null | undefined) {
  if (!values || values.length === 0) return '—';
  return values.join(', ');
}

function formatDetailValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.length ? value.map((item) => formatDetailValue(item)).join(', ') : '—';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function renderWs45SourceSummary(alert: Ws45Alert) {
  const sourceSummary = formatWs45SourceSnapshot(alert.details);
  return sourceSummary ? <div className="mt-1 text-xs text-text2">{sourceSummary}</div> : null;
}

export default function AdminWs45Page() {
  const router = useRouter();
  const pathname = useSafePathname();
  const searchParams = useSafeSearchParams();
  const { data: summary, status, error, refresh, lastRefreshedAt } = useAdminResource('/api/admin/ws45/summary', {
    initialData: FALLBACK_SUMMARY,
    parse: parseWs45Summary
  });

  const [triggering, setTriggering] = useState<null | 'ingest' | 'monitor' | 'replay' | 'replay_selected' | 'replay_affected'>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const selectedForecastId = searchParams.get('forecast');
  const selectedAlertKey = searchParams.get('alert');

  const topFamily = useMemo(() => summary.familyCounts.slice().sort((a, b) => b.count - a.count)[0] ?? null, [summary.familyCounts]);
  const topParseStatus = useMemo(() => summary.parseStatusCounts.slice().sort((a, b) => b.count - a.count)[0] ?? null, [summary.parseStatusCounts]);
  const selectedAlert = useMemo(
    () => [...summary.alerts, ...summary.alertHistory].find((alert) => alert.key === selectedAlertKey) ?? null,
    [selectedAlertKey, summary.alertHistory, summary.alerts]
  );
  const selectedForecast = useMemo(() => {
    if (!summary.recentForecasts.length) return null;
    const candidateIds = [selectedForecastId, selectedAlert?.affectedForecastIds?.[0] ?? null].filter(
      (value): value is string => Boolean(value)
    );
    for (const candidateId of candidateIds) {
      const exact = summary.recentForecasts.find((row) => row.id === candidateId);
      if (exact) return exact;
    }
    return summary.recentForecasts[0] ?? null;
  }, [selectedAlert, selectedForecastId, summary.recentForecasts]);
  const selectedParseRuns = useMemo(
    () => (selectedForecast ? summary.parseRunsByForecast[selectedForecast.id] ?? [] : []),
    [selectedForecast, summary.parseRunsByForecast]
  );
  const latestSelectedParseRun = selectedParseRuns[0] ?? null;

  function updateViewState({
    forecastId,
    alertKey,
    anchorId
  }: {
    forecastId?: string | null;
    alertKey?: string | null;
    anchorId?: string;
  }) {
    const next = new URLSearchParams(searchParams.toString());
    if (forecastId) next.set('forecast', forecastId);
    else next.delete('forecast');
    if (alertKey) next.set('alert', alertKey);
    else next.delete('alert');
    const query = next.toString();
    const href = `${pathname}${query ? `?${query}` : ''}${anchorId ? `#${anchorId}` : ''}`;
    router.replace(href, { scroll: false });
    if (anchorId && typeof document !== 'undefined') {
      requestAnimationFrame(() => {
        document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  async function runAction(
    kind: 'ingest' | 'monitor' | 'replay' | 'replay_selected' | 'replay_affected',
    options?: { forecastId?: string | null; forecastIds?: string[] }
  ) {
    if (triggering) return;
    if (kind === 'replay_selected' && !options?.forecastId) {
      setActionError('Select a forecast before running a targeted replay.');
      return;
    }
    if (kind === 'replay_affected' && !(options?.forecastIds && options.forecastIds.length)) {
      setActionError('No affected forecasts were available for replay.');
      return;
    }
    setTriggering(kind);
    setActionError(null);
    setActionMessage(null);
    try {
      let response: Response;
      if (kind === 'ingest') {
        response = await fetch('/api/admin/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job: 'ws45_forecasts_ingest' })
        });
      } else if (kind === 'monitor') {
        response = await fetch('/api/admin/ws45/monitor', { method: 'POST' });
      } else if (kind === 'replay_selected') {
        response = await fetch('/api/admin/ws45/reparse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: 'forecast_id', forecastId: options?.forecastId })
        });
      } else if (kind === 'replay_affected') {
        response = await fetch('/api/admin/ws45/reparse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: 'forecast_ids', forecastIds: options?.forecastIds })
        });
      } else {
        response = await fetch('/api/admin/ws45/reparse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: 'quarantined_recent', limit: 25 })
        });
      }

      const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
      if (!response.ok) {
        const message = typeof payload.error === 'string' ? payload.error : 'Action failed.';
        throw new Error(message);
      }

      if (kind === 'replay' || kind === 'replay_selected' || kind === 'replay_affected') {
        const updated = Number(payload?.result?.updated || 0);
        const reparsed = Number(payload?.result?.reparsed || 0);
        setActionMessage(
          kind === 'replay_selected'
            ? `Selected replay completed: ${updated} updated, ${reparsed} reparsed.`
            : kind === 'replay_affected'
              ? `Affected replay completed: ${updated} updated, ${reparsed} reparsed.`
              : `Replay completed: ${updated} updated, ${reparsed} reparsed.`
        );
      } else if (kind === 'monitor') {
        setActionMessage('Monitoring check completed.');
      } else {
        setActionMessage('WS45 ingest completed.');
      }

      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setTriggering(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-text3">Admin / WS45</p>
          <h1 className="text-3xl font-semibold text-text1">45th Weather Squadron</h1>
          <p className="text-sm text-text2">Monitor ingest freshness, parse health, and Florida launch coverage.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.1em]"
            onClick={() => void refresh()}
          >
            Refresh
          </button>
          <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.1em] text-text3">
            {summary.mode === 'db' ? 'Live' : 'Stub'}
          </span>
        </div>
      </div>

      {status === 'loading' && (
        <div className="rounded-xl border border-stroke bg-surface-1 p-3 text-sm text-text3">Loading WS45 admin data...</div>
      )}

      {status === 'unauthorized' && (
        <div className="rounded-xl border border-warning bg-[rgba(251,191,36,0.08)] p-3 text-sm text-warning">
          {error || 'Admin access required. Sign in with an admin account to continue.'}
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-xl border border-danger bg-[rgba(251,113,133,0.08)] p-3 text-sm text-danger">
          {error || 'Failed to load WS45 admin data.'}
        </div>
      )}

      {actionError && <div className="rounded-xl border border-danger bg-[rgba(251,113,133,0.08)] p-3 text-sm text-danger">{actionError}</div>}
      {actionMessage && <div className="rounded-xl border border-stroke bg-[rgba(234,240,255,0.04)] p-3 text-sm text-text2">{actionMessage}</div>}

      {status === 'ready' && (
        <>
          <div className="grid gap-4 md:grid-cols-5">
            <InfoCard label="Open alerts" value={summary.health.openAlertCount} />
            <InfoCard label="Publish eligible" value={summary.health.publishEligibleCount} />
            <InfoCard label="Quarantined" value={summary.health.quarantinedCount} />
            <InfoCard label="Coverage gaps" value={summary.health.coverageGapCount} />
            <InfoCard label="Recent forecasts" value={summary.health.recentForecastCount} />
          </div>

          <SectionCard
            title="Actions"
            description={
              <div>
                <div>Safe operational controls for WS45 only.</div>
                {lastRefreshedAt ? <div className="mt-1 text-xs text-text3">Last refreshed: {formatTimestamp(lastRefreshedAt)}</div> : null}
              </div>
            }
            actions={
              <>
                <button
                  type="button"
                  className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.1em]"
                  disabled={Boolean(triggering)}
                  onClick={() => void runAction('ingest')}
                >
                  {triggering === 'ingest' ? 'Running…' : 'Run ingest'}
                </button>
                <button
                  type="button"
                  className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.1em]"
                  disabled={Boolean(triggering)}
                  onClick={() => void runAction('monitor')}
                >
                  {triggering === 'monitor' ? 'Running…' : 'Run monitor'}
                </button>
                <button
                  type="button"
                  className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.1em]"
                  disabled={Boolean(triggering)}
                  onClick={() => void runAction('replay')}
                >
                  {triggering === 'replay' ? 'Running…' : 'Replay quarantined'}
                </button>
              </>
            }
          >
            <div className="grid gap-4 md:grid-cols-3">
              <InfoCard label="Latest ingest" value={formatTimestamp(summary.health.latestIngestAt)} />
              <InfoCard label="Latest parse run" value={formatTimestamp(summary.health.latestParseRunAt)} />
              <InfoCard
                label="Florida coverage"
                value={`${summary.health.coverageCount}/${summary.health.upcomingFloridaLaunchCount}`}
              />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <InfoCard label="Top family" value={topFamily ? `${topFamily.label} (${topFamily.count})` : '—'} />
              <InfoCard label="Top parse status" value={topParseStatus ? `${topParseStatus.label} (${topParseStatus.count})` : '—'} />
            </div>
          </SectionCard>

          <SectionCard title="Drift And Trends" description="Recent parse completeness, publishability, and replay recovery by parser version.">
            <div className="grid gap-4 md:grid-cols-3">
              {summary.trends.windows.map((window) => (
                <div key={window.label} className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-text1">{window.label}</div>
                      <div className="text-xs text-text3">{window.totalDocs} docs</div>
                    </div>
                    <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
                      since {formatTimestamp(window.since)}
                    </span>
                  </div>
                  <div className="mt-4 space-y-3">
                    <div>
                      <div className="flex items-center justify-between text-xs text-text2">
                        <span>Parse completeness</span>
                        <span>{formatPercent(window.parsedPct)}</span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-[rgba(255,255,255,0.06)]">
                        <div className="h-2 rounded-full bg-success" style={{ width: `${window.parsedPct}%` }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-xs text-text2">
                        <span>Publish eligible</span>
                        <span>{formatPercent(window.publishPct)}</span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-[rgba(255,255,255,0.06)]">
                        <div className="h-2 rounded-full bg-primary" style={{ width: `${window.publishPct}%` }} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-text3">
                      <div>Partial: {window.partialDocs}</div>
                      <div>Failed: {window.failedDocs}</div>
                      <div>Unknown family: {window.unknownFamilyDocs}</div>
                      <div>Top family: {window.topFamily || '—'}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              <div className="text-xs uppercase tracking-[0.08em] text-text3">Replay Recovery By Parser Version</div>
              {summary.trends.replayByVersion.length === 0 && (
                <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-sm text-text3">
                  No replay activity recorded in the current summary horizon.
                </div>
              )}
              {summary.trends.replayByVersion.map((row) => (
                <div key={row.parserVersion} className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-text1">{row.parserVersion}</div>
                    <div className="text-xs text-text3">last replay {formatTimestamp(row.lastReplayAt)}</div>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-text2 md:grid-cols-3">
                    <div>Replay attempts: {row.replayCount}</div>
                    <div>Recovered publishable: {row.recoveredCount}</div>
                    <div>Matched outcomes: {row.matchedCount}</div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <div id="ws45-alerts">
          <SectionCard title="Open Alerts" description="Unresolved WS45-specific alerts from `ops_alerts`.">
            <div className="space-y-2">
              {summary.alerts.length === 0 && (
                <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-sm text-text3">No active WS45 alerts.</div>
              )}
              {summary.alerts.map((alert) => (
                <div
                  key={alert.key}
                  className={clsx(
                    'rounded-lg border bg-[rgba(255,255,255,0.02)] px-3 py-2',
                    selectedAlertKey === alert.key ? 'border-primary/60 shadow-[0_0_0_1px_rgba(80,125,255,0.15)]' : 'border-stroke'
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-text1">{alert.message}</div>
                      <div className="text-xs text-text3">
                        {alert.key} • observed since {formatTimestamp(alert.first_seen_at)} • last seen {formatTimestamp(alert.last_seen_at)} •{' '}
                        {formatObservedCount(alert.occurrences)}
                      </div>
                      {renderWs45SourceSummary(alert)}
                    </div>
                    <div className="flex items-center gap-2">
                      {alert.affectedForecastIds && alert.affectedForecastIds.length > 0 ? (
                        <button
                          type="button"
                          className="btn-secondary rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.08em]"
                          disabled={Boolean(triggering)}
                          onClick={() => void runAction('replay_affected', { forecastIds: alert.affectedForecastIds })}
                        >
                          {triggering === 'replay_affected' ? 'Running…' : 'Replay affected'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn-secondary rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.08em]"
                        onClick={() =>
                          updateViewState({
                            forecastId: alert.affectedForecastIds?.[0] ?? null,
                            alertKey: alert.key,
                            anchorId: alert.affectedForecastIds?.[0] ? 'ws45-drilldown' : 'ws45-alerts'
                          })
                        }
                      >
                        Focus
                      </button>
                      <span className={clsx('rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]', badgeClass(alert.severity))}>
                        {alert.severity}
                      </span>
                    </div>
                  </div>
                  {alert.affectedRows && alert.affectedRows.length > 0 ? (
                    <div className="mt-3 space-y-2 border-t border-stroke/70 pt-3">
                      {alert.affectedRows.map((row, index) => (
                        <div key={`${alert.key}-${row.id || index}`} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-stroke/70 bg-[rgba(255,255,255,0.015)] px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-sm text-text1">{row.label}</div>
                            <div className="text-xs text-text3">
                              {row.kind === 'forecast' ? 'Forecast impact' : 'Launch impact'}
                              {row.parseStatus ? ` • parse ${row.parseStatus}` : ''}
                              {row.matchStatus ? ` • match ${row.matchStatus}` : ''}
                              {row.documentFamily ? ` • ${row.documentFamily}` : ''}
                            </div>
                            {(row.issuedAt || row.validStart || row.validEnd) && (
                              <div className="mt-1 text-xs text-text2">
                                issued {formatTimestamp(row.issuedAt)} • valid {formatTimestamp(row.validStart)} to {formatTimestamp(row.validEnd)}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {row.kind === 'forecast' && row.forecastId ? (
                              <button
                                type="button"
                                className="btn-secondary rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.08em]"
                                onClick={() =>
                                  updateViewState({
                                    forecastId: row.forecastId,
                                    alertKey: alert.key,
                                    anchorId: 'ws45-drilldown'
                                  })
                                }
                              >
                                Inspect
                              </button>
                            ) : null}
                            {row.kind === 'launch' && row.launchId ? (
                              <Link
                                href={`/launches/${row.launchId}`}
                                className="btn-secondary rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.08em]"
                              >
                                Open launch
                              </Link>
                            ) : null}
                            {row.pdfUrl ? (
                              <a
                                href={row.pdfUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="btn-secondary rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.08em]"
                              >
                                PDF
                              </a>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </SectionCard>
          </div>

          <SectionCard title="Recent Alert History" description="Recently resolved WS45 alerts for operational context and postmortem review.">
            <div className="space-y-2">
              {summary.alertHistory.length === 0 && (
                <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-sm text-text3">
                  No resolved WS45 alerts in the recent history window.
                </div>
              )}
              {summary.alertHistory.map((alert) => (
                <div
                  key={`${alert.key}-${alert.resolved_at || alert.last_seen_at}`}
                  className={clsx(
                    'rounded-lg border bg-[rgba(255,255,255,0.02)] px-3 py-2',
                    selectedAlertKey === alert.key ? 'border-primary/60 shadow-[0_0_0_1px_rgba(80,125,255,0.15)]' : 'border-stroke'
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-text1">{alert.message}</div>
                      <div className="text-xs text-text3">
                        {alert.key} • observed since {formatTimestamp(alert.first_seen_at)} • resolved {formatTimestamp(alert.resolved_at)} • last seen{' '}
                        {formatTimestamp(alert.last_seen_at)} • {formatObservedCount(alert.occurrences)}
                      </div>
                      {renderWs45SourceSummary(alert)}
                      {alert.affectedRows && alert.affectedRows.length > 0 ? (
                        <div className="mt-1 text-xs text-text2">Affected items retained: {alert.affectedRows.length}</div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="btn-secondary rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.08em]"
                        onClick={() =>
                          updateViewState({
                            forecastId: alert.affectedForecastIds?.[0] ?? null,
                            alertKey: alert.key,
                            anchorId: alert.affectedForecastIds?.[0] ? 'ws45-drilldown' : 'ws45-alerts'
                          })
                        }
                      >
                        Review
                      </button>
                      <span className={clsx('rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]', badgeClass('covered'))}>
                        resolved
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Upcoming Florida Coverage" description="Current publishable WS45 forecast coverage for upcoming Florida launches.">
            <div className="space-y-2">
              {summary.coverage.length === 0 && (
                <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-sm text-text3">
                  No upcoming Florida launches in the current monitoring horizon.
                </div>
              )}
              {summary.coverage.map((row) => (
                <div key={row.launchId} className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-text1">
                        <Link href={`/launches/${row.launchId}`} className="transition hover:text-primary">
                          {row.launchName}
                        </Link>
                      </div>
                      <div className="text-xs text-text3">
                        {formatTimestamp(row.net)} • {[row.padShortCode, row.padName].filter(Boolean).join(' • ') || 'Florida'}
                      </div>
                      {row.sourceLabel ? (
                        <div className="mt-1 text-xs text-text2">
                          {row.sourceLabel} • issued {formatTimestamp(row.issuedAt)} • valid {formatTimestamp(row.validStart)} to{' '}
                          {formatTimestamp(row.validEnd)}
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-text2">No publishable WS45 forecast currently attached.</div>
                      )}
                      <div className="mt-1 text-xs text-text2">{row.statusReason}</div>
                      {row.quarantineReasons.length > 0 ? (
                        <div className="mt-1 text-xs text-warning">Quarantine: {row.quarantineReasons.join(', ')}</div>
                      ) : null}
                      {row.requiredFieldsMissing.length > 0 ? (
                        <div className="mt-1 text-xs text-text3">Missing fields: {row.requiredFieldsMissing.join(', ')}</div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {row.forecastId ? (
                        <button
                          type="button"
                          className="btn-secondary rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.08em]"
                          onClick={() => updateViewState({ forecastId: row.forecastId, alertKey: null, anchorId: 'ws45-drilldown' })}
                        >
                          Inspect forecast
                        </button>
                      ) : null}
                      {row.parseVersion ? (
                        <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
                          {row.parseVersion}
                        </span>
                      ) : null}
                      {row.matchStatus ? (
                        <span className={clsx('rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]', badgeClass(row.matchStatus))}>
                          {row.matchStatus}
                        </span>
                      ) : null}
                      {row.parseStatus ? (
                        <span className={clsx('rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]', badgeClass(row.parseStatus))}>
                          {row.parseStatus}
                        </span>
                      ) : null}
                      <span className={clsx('rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]', badgeClass(row.status))}>
                        {row.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Recent Forecasts" description="Recent WS45 documents with publish and quarantine state.">
            <div className="space-y-2">
              {summary.recentForecasts.length === 0 && (
                <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-sm text-text3">No recent WS45 forecasts found.</div>
              )}
              {summary.recentForecasts.map((row) => (
                <div
                  key={row.id}
                  className={clsx(
                    'rounded-lg border bg-[rgba(255,255,255,0.02)] px-3 py-3',
                    selectedForecast?.id === row.id ? 'border-primary/60 shadow-[0_0_0_1px_rgba(80,125,255,0.15)]' : 'border-stroke'
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-text1">{row.source_label || row.mission_name || 'WS45 forecast'}</div>
                      <div className="text-xs text-text3">
                        fetched {formatTimestamp(row.fetched_at)} • issued {formatTimestamp(row.issued_at)} • {row.document_family || 'unknown_family'}
                      </div>
                      <div className="mt-1 text-xs text-text2">
                        {row.quarantine_reasons && row.quarantine_reasons.length
                          ? `Quarantine: ${row.quarantine_reasons.join(', ')}`
                          : row.publish_eligible
                            ? 'Publish eligible.'
                            : 'Not publish eligible.'}
                      </div>
                      {row.pdf_url ? (
                        <div className="mt-1">
                          <a
                            href={row.pdf_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary transition hover:underline"
                          >
                            View PDF
                          </a>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="btn-secondary rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.08em]"
                        onClick={() => updateViewState({ forecastId: row.id, alertKey: null, anchorId: 'ws45-drilldown' })}
                      >
                        Inspect
                      </button>
                      {row.parse_version ? (
                        <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
                          {row.parse_version}
                        </span>
                      ) : null}
                      <span className={clsx('rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]', badgeClass(row.parse_status || 'failed'))}>
                        {row.parse_status || 'failed'}
                      </span>
                      <span className={clsx('rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]', badgeClass(row.match_status || 'unmatched'))}>
                        {row.match_status || 'unmatched'}
                      </span>
                      <span
                        className={clsx(
                          'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]',
                          badgeClass(row.publish_eligible ? 'covered' : 'missing')
                        )}
                      >
                        {row.publish_eligible ? 'publishable' : 'quarantined'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <div id="ws45-drilldown">
          <SectionCard
            title="Document Drilldown"
            description="Canonical fields, parse evidence, and parser history for the selected WS45 document."
            actions={
              selectedForecast ? (
                <>
                  {selectedForecast.pdf_url ? (
                    <a
                      href={selectedForecast.pdf_url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.1em]"
                    >
                      View PDF
                    </a>
                  ) : null}
                  <button
                    type="button"
                    className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.1em]"
                    disabled={Boolean(triggering)}
                    onClick={() => void runAction('replay_selected', { forecastId: selectedForecast.id })}
                  >
                    {triggering === 'replay_selected' ? 'Running…' : 'Replay selected'}
                  </button>
                </>
              ) : null
            }
          >
            {!selectedForecast && (
              <div className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2 text-sm text-text3">
                Select a recent forecast to inspect parse evidence.
              </div>
            )}

            {selectedForecast && (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-4">
                  <InfoCard label="Issued" value={formatTimestamp(selectedForecast.issued_at)} />
                  <InfoCard label="Valid start" value={formatTimestamp(selectedForecast.valid_start)} />
                  <InfoCard label="Valid end" value={formatTimestamp(selectedForecast.valid_end)} />
                  <InfoCard label="Match confidence" value={selectedForecast.match_confidence ?? '—'} />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
                    <div className="text-xs uppercase tracking-[0.08em] text-text3">Canonical State</div>
                    <div className="mt-3 space-y-2 text-sm text-text2">
                      <div>
                        <span className="text-text3">Document:</span> {selectedForecast.source_label || selectedForecast.mission_name || 'WS45 forecast'}
                      </div>
                      <div>
                        <span className="text-text3">Parse state:</span> {selectedForecast.parse_status || 'failed'}
                      </div>
                      <div>
                        <span className="text-text3">Match state:</span> {selectedForecast.match_status || 'unmatched'}
                      </div>
                      <div>
                        <span className="text-text3">Publish eligibility:</span> {selectedForecast.publish_eligible ? 'publishable' : 'quarantined'}
                      </div>
                      <div>
                        <span className="text-text3">Required fields missing:</span> {formatValueList(selectedForecast.required_fields_missing)}
                      </div>
                      <div>
                        <span className="text-text3">Quarantine reasons:</span> {formatValueList(selectedForecast.quarantine_reasons)}
                      </div>
                      <div>
                        <span className="text-text3">Normalization flags:</span> {formatValueList(selectedForecast.normalization_flags)}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
                    <div className="text-xs uppercase tracking-[0.08em] text-text3">Latest Parse Run</div>
                    {!latestSelectedParseRun && <div className="mt-3 text-sm text-text3">No parse-run history recorded yet.</div>}
                    {latestSelectedParseRun && (
                      <div className="mt-3 space-y-2 text-sm text-text2">
                        <div>
                          <span className="text-text3">When:</span> {formatTimestamp(latestSelectedParseRun.created_at)}
                        </div>
                        <div>
                          <span className="text-text3">Attempt:</span> {latestSelectedParseRun.attempt_reason || '—'} via {latestSelectedParseRun.runtime || '—'}
                        </div>
                        <div>
                          <span className="text-text3">Parser:</span> {latestSelectedParseRun.parser_version || '—'}
                        </div>
                        <div>
                          <span className="text-text3">Family:</span> {latestSelectedParseRun.document_family || 'unknown_family'}
                        </div>
                        <div>
                          <span className="text-text3">Confidence:</span> {latestSelectedParseRun.parse_confidence ?? '—'}
                        </div>
                        <div>
                          <span className="text-text3">Validation failures:</span> {formatValueList(latestSelectedParseRun.validation_failures)}
                        </div>
                        <div>
                          <span className="text-text3">Normalization flags:</span> {formatValueList(latestSelectedParseRun.normalization_flags)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4 md:col-span-2">
                    <div className="text-xs uppercase tracking-[0.08em] text-text3">Evidence Snippets</div>
                    {!latestSelectedParseRun?.field_evidence && <div className="mt-3 text-sm text-text3">No field evidence captured for this parse run.</div>}
                    {latestSelectedParseRun?.field_evidence && (
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {Object.entries(latestSelectedParseRun.field_evidence).map(([key, value]) => (
                          <div key={key} className="rounded-lg border border-stroke/70 bg-[rgba(255,255,255,0.015)] px-3 py-2">
                            <div className="text-[10px] uppercase tracking-[0.08em] text-text3">{key.replace(/_/g, ' ')}</div>
                            <div className="mt-1 break-words text-sm text-text2">{formatDetailValue(value)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
                    <div className="text-xs uppercase tracking-[0.08em] text-text3">Field Confidence</div>
                    {!latestSelectedParseRun?.field_confidence && <div className="mt-3 text-sm text-text3">No field confidence captured for this parse run.</div>}
                    {latestSelectedParseRun?.field_confidence && (
                      <div className="mt-3 space-y-2">
                        {Object.entries(latestSelectedParseRun.field_confidence).map(([key, value]) => (
                          <div key={key}>
                            <div className="flex items-center justify-between text-xs text-text2">
                              <span>{key.replace(/_/g, ' ')}</span>
                              <span>{formatPercent(value)}</span>
                            </div>
                            <div className="mt-1 h-2 rounded-full bg-[rgba(255,255,255,0.06)]">
                              <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
                    <div className="text-xs uppercase tracking-[0.08em] text-text3">Strategy Trace</div>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-text2">
                      {latestSelectedParseRun?.strategy_trace ? JSON.stringify(latestSelectedParseRun.strategy_trace, null, 2) : 'No strategy trace captured.'}
                    </pre>
                  </div>
                  <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
                    <div className="text-xs uppercase tracking-[0.08em] text-text3">Parse History</div>
                    <div className="mt-3 space-y-2">
                      {selectedParseRuns.length === 0 && <div className="text-sm text-text3">No parse-run history recorded yet.</div>}
                      {selectedParseRuns.map((run) => (
                        <div key={run.id} className="rounded-lg border border-stroke/70 bg-[rgba(255,255,255,0.015)] px-3 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-text1">
                              {run.parser_version || 'unknown'} • {run.attempt_reason || 'attempt'}
                            </div>
                            <span className={clsx('rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]', badgeClass(run.publish_eligible ? 'covered' : run.parse_status || 'failed'))}>
                              {run.publish_eligible ? 'publishable' : run.parse_status || 'failed'}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-text3">
                            {formatTimestamp(run.created_at)} • {run.runtime || '—'} • family {run.document_family || 'unknown_family'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}
