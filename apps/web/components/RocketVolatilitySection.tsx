'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import type { RocketVolatilityLaunch, RocketVolatilitySummary } from '@/lib/types/rocketVolatility';

type LoadState = 'idle' | 'loading' | 'loaded' | 'unauthenticated' | 'premium_required' | 'admin_not_configured' | 'error';

export function RocketVolatilitySection({
  rocketName,
  lookbackDays,
  launches,
  adminConfigured
}: {
  rocketName: string;
  lookbackDays: number;
  launches: RocketVolatilityLaunch[];
  adminConfigured: boolean;
}) {
  const [state, setState] = useState<LoadState>('idle');
  const [volatility, setVolatility] = useState<RocketVolatilitySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const safeLaunches = useMemo(() => {
    const seen = new Set<string>();
    const rows: RocketVolatilityLaunch[] = [];
    for (const launch of Array.isArray(launches) ? launches : []) {
      const id = typeof launch?.id === 'string' ? launch.id.trim() : '';
      const name = typeof launch?.name === 'string' ? launch.name.trim() : '';
      if (!id || !name) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({ id, name });
      if (rows.length >= 50) break;
    }
    return rows;
  }, [launches]);

  const load = useCallback(async () => {
    if (!adminConfigured) {
      setState('admin_not_configured');
      return;
    }
    if (!safeLaunches.length) {
      setVolatility(null);
      setState('loaded');
      return;
    }

    setError(null);
    setState('loading');

    try {
      const res = await fetch('/api/me/rocket-volatility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookbackDays, launches: safeLaunches })
      });

      if (res.status === 401) {
        setVolatility(null);
        setState('unauthenticated');
        return;
      }
      if (res.status === 402) {
        setVolatility(null);
        setState('premium_required');
        return;
      }
      if (res.status === 503) {
        setVolatility(null);
        setState('admin_not_configured');
        return;
      }

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setVolatility(null);
        setError(typeof json?.error === 'string' ? json.error : `Request failed (${res.status})`);
        setState('error');
        return;
      }

      const summary = json?.volatility as RocketVolatilitySummary | null | undefined;
      setVolatility(summary ?? null);
      setState('loaded');
    } catch (err) {
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Failed to load volatility.';
      setVolatility(null);
      setError(message);
      setState('error');
    }
  }, [adminConfigured, lookbackDays, safeLaunches]);

  return (
    <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold text-text1">Schedule volatility</h2>
        <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
          Premium
        </span>
      </div>
      <p className="mt-2 text-xs text-text3">
        Tracks timing/status changes for up to the next 20 launches based on the last {formatNumber(lookbackDays)} days of updates.
      </p>

      {!adminConfigured ? (
        <div className="mt-3 text-sm text-text3">Supabase admin credentials are required to load launch update history.</div>
      ) : safeLaunches.length === 0 ? (
        <div className="mt-3 text-sm text-text3">No upcoming launches to analyze right now.</div>
      ) : state === 'unauthenticated' ? (
        <div className="mt-3 text-sm text-text2">
          Sign in to unlock Premium schedule volatility stats.{' '}
          <Link href="/auth/sign-in" className="text-primary hover:text-primary/80">
            Sign in
          </Link>
          .
        </div>
      ) : state === 'premium_required' ? (
        <div className="mt-3 text-sm text-text2">
          Upgrade to Premium to see timing change stats for upcoming {rocketName} launches.{' '}
          <Link href="/account" className="text-primary hover:text-primary/80">
            Manage subscription
          </Link>
          .
        </div>
      ) : state === 'admin_not_configured' ? (
        <div className="mt-3 text-sm text-text3">Supabase admin credentials are required to load launch update history.</div>
      ) : state === 'loading' ? (
        <div className="mt-4 text-sm text-text3">Loading volatility stats…</div>
      ) : state === 'error' ? (
        <div className="mt-3 text-sm text-text2">
          Failed to load volatility stats{error ? `: ${error}` : '.'}{' '}
          <button type="button" onClick={load} className="text-primary hover:text-primary/80">
            Try again
          </button>
          .
        </div>
      ) : volatility ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Launches analyzed" value={formatNumber(volatility.launchesAnalyzed)} detail="Next launches" />
            <KpiCard label="Timing updates" value={formatNumber(volatility.timingUpdates)} detail={`Last ${formatNumber(volatility.lookbackDays)} days`} />
            <KpiCard
              label="Median NET slip"
              value={volatility.medianNetSlipHours == null ? '—' : `${formatDecimal(volatility.medianNetSlipHours, 1)} h`}
              detail="Abs hours per NET change"
            />
            <KpiCard
              label="Most volatile"
              value={volatility.mostVolatile ? formatNumber(volatility.mostVolatile.timingUpdates) : '—'}
              detail={volatility.mostVolatile ? truncateText(volatility.mostVolatile.name, 40) : 'No timing changes logged'}
            />
          </div>

          {volatility.lastDetectedAt ? (
            <div className="mt-3 text-xs text-text3">Last update detected: {formatDetectedAt(volatility.lastDetectedAt)}</div>
          ) : null}

          <div className="mt-4">
            <div className="text-xs uppercase tracking-[0.1em] text-text3">Most volatile upcoming launches</div>
            <ul className="mt-3 grid gap-2 md:grid-cols-2">
              {volatility.perLaunch.slice(0, 6).map((row) => (
                <li key={row.launchId} className="rounded-xl border border-stroke bg-surface-0 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={buildLaunchHref({ id: row.launchId, name: row.name })}
                        className="block truncate text-sm font-semibold text-text1 transition hover:text-primary"
                      >
                        {row.name}
                      </Link>
                      <div className="mt-1 text-xs text-text3">
                        {formatNumber(row.timingUpdates)} timing • {formatNumber(row.statusUpdates)} status • {formatNumber(row.totalUpdates)} total
                      </div>
                    </div>
                    <div className="text-right text-xs text-text3">{row.lastDetectedAt ? formatDetectedAt(row.lastDetectedAt) : '—'}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <div className="mt-3 text-sm text-text3">
          {state === 'loaded' ? (
            <>
              No update history available for the selected launches.{' '}
              <button type="button" onClick={load} className="text-primary hover:text-primary/80">
                Reload
              </button>
              .
            </>
          ) : (
            <button type="button" onClick={load} className="btn-secondary w-fit rounded-lg px-3 py-2 text-sm">
              Load volatility stats
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function KpiCard({ label, value, detail }: { label: string; value: string; detail?: string | null }) {
  return (
    <div className="rounded-xl border border-stroke bg-surface-0 p-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-text3">{label}</div>
      <div className="mt-1 text-lg font-semibold text-text1">{value}</div>
      {detail ? <div className="text-xs text-text3">{detail}</div> : null}
    </div>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDecimal(value: number, digits: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function formatDetectedAt(value: string) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short'
  }).format(new Date(ms));
}

function truncateText(value: string, maxChars: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}
