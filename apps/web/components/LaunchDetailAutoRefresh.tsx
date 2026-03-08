'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getNextAlignedRefreshMs, getTierRefreshSeconds, type ViewerTier } from '@/lib/tiers';

const LAUNCH_ROUTE_TRACE_KEY = '__tmzBlueOriginRouteTrace';
const LAUNCH_PERF_SLOW_RESOURCE_MS = 150;

type RouteTraceEntry = {
  targetPath: string;
  sourcePath: string;
  startedAtMs: number;
  clickedAtIso: string;
  traceLabel: string;
};

type WindowWithLaunchRouteTrace = Window & {
  [LAUNCH_ROUTE_TRACE_KEY]?: RouteTraceEntry;
};

function normalizePath(value: string) {
  const path = value.split('?')[0].split('#')[0];
  if (!path) return '/';
  if (path.startsWith('/')) return path;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      return new URL(path).pathname || '/';
    } catch {
      return '/';
    }
  }
  return `/${path}`;
}

function readTraceEntry() {
  if (typeof window === 'undefined') return null;
  return (window as WindowWithLaunchRouteTrace)[LAUNCH_ROUTE_TRACE_KEY] || null;
}

function clearTraceEntry() {
  if (typeof window === 'undefined') return;
  delete (window as WindowWithLaunchRouteTrace)[LAUNCH_ROUTE_TRACE_KEY];
}

function logClientPerformanceDiagnostics() {
  if (typeof performance === 'undefined') return;

  const navigationEntry = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (navigationEntry) {
    console.table([
      {
        navDurationMs: Number((navigationEntry.duration || 0).toFixed(2)),
        domContentLoadedMs: Number((navigationEntry.domContentLoadedEventEnd || 0).toFixed(2)),
        loadEventEndMs: Number((navigationEntry.loadEventEnd || 0).toFixed(2)),
        domInteractiveMs: Number((navigationEntry.domInteractive || 0).toFixed(2)),
        transferSizeBytes: navigationEntry.transferSize
      }
    ]);
  }

  const slowResources = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
    .filter((entry) => Number.isFinite(entry.duration) && entry.duration >= LAUNCH_PERF_SLOW_RESOURCE_MS)
    .sort((left, right) => right.duration - left.duration)
    .slice(0, 20)
    .map((entry) => ({
      initiatorType: entry.initiatorType || 'unknown',
      durationMs: Number(entry.duration.toFixed(2)),
      transferSizeBytes: entry.transferSize,
      name: truncateResourceName(entry.name)
    }));

  if (slowResources.length) {
    console.warn('[TMZ][Launches] slow resource timings (>=150ms)');
    console.table(slowResources);
  }
}

function truncateResourceName(name: string) {
  if (name.length <= 120) return name;
  return `${name.slice(0, 117)}...`;
}

export function LaunchDetailAutoRefresh({
  tier,
  launchId,
  lastUpdated
}: {
  tier: ViewerTier;
  launchId: string;
  lastUpdated?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const debugToken = String(searchParams.get('debug') || '').trim().toLowerCase();
  const debugEnabled =
    debugToken === '1' ||
    debugToken === 'true' ||
    debugToken === 'launch' ||
    debugToken === 'detail' ||
    debugToken === 'launchdetail' ||
    debugToken === 'refresh' ||
    debugToken === 'trace';
  const debugTrace = debugEnabled && debugToken === 'trace';

  const refreshIntervalSeconds = getTierRefreshSeconds(tier);
  const refreshIntervalMs = refreshIntervalSeconds * 1000;
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const lastSeenRef = useRef<string | null>(lastUpdated ?? null);
  const debugSessionIdRef = useRef(Math.random().toString(36).slice(2));
  const debugName = useMemo(() => `LaunchDetailAutoRefresh:${debugSessionIdRef.current}`, []);

  useEffect(() => {
    if (!debugEnabled) return;
    console.log(`[${debugName}] mounted`, {
      tier,
      launchId,
      lastUpdated: lastUpdated ?? null,
      refreshIntervalMs
    });
    return () => console.log(`[${debugName}] unmounted`);
  }, [debugEnabled, debugName, launchId, lastUpdated, refreshIntervalMs, tier]);

  useEffect(() => {
    if (typeof performance === 'undefined' || typeof console === 'undefined') return;
    const entry = readTraceEntry();
    if (!entry) {
      if (debugEnabled) {
        console.debug('[TMZ][Launches] no route trace entry found on landing', {
          currentPath: normalizePath(pathname || '/')
        });
      }
      return;
    }

    const current = normalizePath(pathname || '/');
    const expected = normalizePath(entry.targetPath);
    if (current !== expected && !current.startsWith(`${expected}/`)) {
      if (debugEnabled) {
        console.warn('[TMZ][Launches] route trace path mismatch', {
          expectedPath: expected,
          currentPath: current,
          sourcePath: entry.sourcePath,
          targetPath: entry.targetPath,
          traceLabel: entry.traceLabel
        });
      }
      clearTraceEntry();
      return;
    }

    const landingMs = Number((performance.now() - entry.startedAtMs).toFixed(2));
    console.info('[TMZ][Launches] click-to-route landing', {
      traceLabel: entry.traceLabel,
      targetPath: entry.targetPath,
      sourcePath: entry.sourcePath,
      currentPath: current,
      clickedAtIso: entry.clickedAtIso,
      landingMs
    });
    logClientPerformanceDiagnostics();
    clearTraceEntry();
  }, [debugEnabled, pathname]);

  useEffect(() => {
    lastSeenRef.current = lastUpdated ?? null;
  }, [lastUpdated]);

  useEffect(() => {
    if (!Number.isFinite(refreshIntervalMs) || refreshIntervalMs <= 0) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const checkForUpdates = async () => {
      if (!launchId) {
        if (debugEnabled) console.log(`[${debugName}] refresh_no_launch_id`);
        router.refresh();
        return;
      }
      try {
        const url = `/api/live/launches/${launchId}/version`;
        if (debugEnabled) console.log(`[${debugName}] version_check_start`, { url });
        const startedAt = Date.now();
        const res = await fetch(url, { cache: 'no-store' });
        if (debugEnabled) console.log(`[${debugName}] version_check_response`, { url, status: res.status, ok: res.ok, ms: Date.now() - startedAt });
        if (res.status === 401 || res.status === 402) {
          if (debugEnabled) console.log(`[${debugName}] refresh_auth_fallback`, { status: res.status });
          router.refresh();
          return;
        }
        if (!res.ok) return;
        const json = await res.json().catch(() => ({}));
        const latest = typeof json?.lastUpdated === 'string' ? json.lastUpdated : null;
        if (debugEnabled) console.log(`[${debugName}] version_check_payload`, { latest, lastSeen: lastSeenRef.current });
        if (latest && latest !== lastSeenRef.current) {
          lastSeenRef.current = latest;
          if (debugEnabled) {
            console.log(`[${debugName}] refresh_triggered`, { reason: 'version_changed', latest });
            if (debugTrace) console.trace(`[${debugName}] router.refresh trace`);
          }
          router.refresh();
        }
      } catch (err) {
        console.error('launch refresh check error', err);
        if (debugEnabled) console.log(`[${debugName}] version_check_error`, { error: String((err as any)?.message || err) });
      }
    };

    const schedule = () => {
      if (cancelled) return;
      const now = Date.now();
      const next = getNextAlignedRefreshMs(now, refreshIntervalMs);
      setNextRefreshAt(next);
      const delay = Math.max(0, next - now);
      if (debugEnabled) console.log(`[${debugName}] schedule`, { now, next, delayMs: delay, tier });
      timeout = setTimeout(async () => {
        if (cancelled) return;
        if (debugEnabled) console.log(`[${debugName}] tick`, { tier, now: Date.now() });
        if (tier === 'premium') {
          await checkForUpdates();
        } else {
          if (debugEnabled) {
            console.log(`[${debugName}] refresh_triggered`, { reason: 'non_premium_interval' });
            if (debugTrace) console.trace(`[${debugName}] router.refresh trace`);
          }
          router.refresh();
        }
        schedule();
      }, delay);
    };

    schedule();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [debugEnabled, debugName, debugTrace, launchId, refreshIntervalMs, router, tier]);

  const summary = useMemo(() => {
    if (tier === 'premium') return 'Checks for updates every 15 seconds.';
    if (tier === 'free') return 'Updates every 15 minutes.';
    return 'Updates every 2 hours.';
  }, [tier]);

  const cadence =
    tier === 'premium'
      ? 'Aligned to :00, :15, :30, :45 each minute.'
      : tier === 'free'
        ? 'Aligned to :00, :15, :30, :45 each hour.'
        : 'Aligned to 12:00am, 2:00am, 4:00am, … local time.';
  const nextLabel = nextRefreshAt ? formatRefreshTime(nextRefreshAt, tier === 'premium') : null;

  return (
    <div className="mt-2 text-xs text-text3">
      <span>{summary}</span>
      <span className="ml-2">{cadence}</span>
      {nextLabel && <span className="ml-2">Next refresh at {nextLabel}.</span>}
    </div>
  );
}

function formatRefreshTime(value: number, includeSeconds: boolean) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined
  }).format(date);
}
