'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  buildDetailVersionToken,
  getNextAdaptiveLaunchRefreshMs,
  getRecommendedLaunchRefreshIntervalSeconds,
  getTierRefreshSeconds,
  hasVersionChanged,
  PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS,
  tierToMode,
  type ViewerTier
} from '@tminuszero/domain';
import { subscribeToBrowserLaunchRefreshSignal } from '@/lib/api/supabase';
import { fetchLaunchDetailVersion } from '@/lib/api/queries';
import { useSafePathname } from '@/lib/client/useSafePathname';
import { useSafeSearchParams } from '@/lib/client/useSafeSearchParams';

const LAUNCH_ROUTE_TRACE_KEY = '__tmzBlueOriginRouteTrace';
const LAUNCH_PERF_SLOW_RESOURCE_MS = 150;
const LIVE_DETAIL_REFRESH_SIGNAL_COOLDOWN_MS = 1000;

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
  lastUpdated,
  initialVersion
}: {
  tier: ViewerTier;
  launchId: string;
  lastUpdated?: string | null;
  initialVersion?: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = useSafePathname();
  const searchParams = useSafeSearchParams();
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

  const [scheduledRefreshIntervalSeconds, setScheduledRefreshIntervalSeconds] = useState(() =>
    tier === 'premium' ? PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS : getTierRefreshSeconds(tier)
  );
  const [cadenceAnchorNet, setCadenceAnchorNet] = useState<string | null>(null);
  const refreshIntervalSeconds = getRecommendedLaunchRefreshIntervalSeconds(
    scheduledRefreshIntervalSeconds,
    tier === 'premium' ? PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS : getTierRefreshSeconds(tier)
  );
  const refreshIntervalMs = refreshIntervalSeconds * 1000;
  const scope = tierToMode(tier);
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const lastSeenRef = useRef<string | null>(initialVersion ?? buildDetailVersionToken(launchId, scope, lastUpdated ?? null));
  const lastSignalAtRef = useRef(0);
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
    lastSeenRef.current = initialVersion ?? buildDetailVersionToken(launchId, scope, lastUpdated ?? null);
  }, [initialVersion, lastUpdated, launchId, scope]);

  useEffect(() => {
    setScheduledRefreshIntervalSeconds(tier === 'premium' ? PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS : getTierRefreshSeconds(tier));
    setCadenceAnchorNet(null);
  }, [tier]);

  useEffect(() => {
    if (!Number.isFinite(refreshIntervalMs) || refreshIntervalMs <= 0) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const canCheckForUpdates = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return false;
      }
      if (typeof navigator !== 'undefined' && 'onLine' in navigator && navigator.onLine === false) {
        return false;
      }
      return true;
    };

    const checkForUpdates = async () => {
      if (!canCheckForUpdates()) {
        if (debugEnabled) console.log(`[${debugName}] refresh_paused_inactive`);
        return;
      }
      if (!launchId) {
        if (debugEnabled) console.log(`[${debugName}] refresh_no_launch_id`);
        router.refresh();
        return;
      }
      try {
        if (debugEnabled) console.log(`[${debugName}] version_check_start`, { launchId, scope });
        const startedAt = Date.now();
        const payload = await fetchLaunchDetailVersion(queryClient, launchId, { scope });
        if (debugEnabled) console.log(`[${debugName}] version_check_response`, { scope, ms: Date.now() - startedAt, version: payload.version });
        setScheduledRefreshIntervalSeconds(
          getRecommendedLaunchRefreshIntervalSeconds(
            payload.recommendedIntervalSeconds,
            tier === 'premium' ? PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS : getTierRefreshSeconds(tier)
          )
        );
        setCadenceAnchorNet(typeof payload.cadenceAnchorNet === 'string' ? payload.cadenceAnchorNet : null);
        const nextVersion = typeof payload?.version === 'string'
          ? payload.version
          : buildDetailVersionToken(launchId, scope, payload?.updatedAt ?? null);
        if (debugEnabled) console.log(`[${debugName}] version_check_payload`, { nextVersion, lastSeen: lastSeenRef.current });
        if (hasVersionChanged(lastSeenRef.current, nextVersion)) {
          lastSeenRef.current = nextVersion;
          if (debugEnabled) {
            console.log(`[${debugName}] refresh_triggered`, { reason: 'version_changed', nextVersion });
            if (debugTrace) console.trace(`[${debugName}] router.refresh trace`);
          }
          router.refresh();
        }
      } catch (err) {
        const status = typeof (err as { status?: unknown })?.status === 'number' ? Number((err as { status?: number }).status) : null;
        if (status === 401 || status === 402) {
          if (debugEnabled) console.log(`[${debugName}] refresh_auth_fallback`, { status, scope });
          router.refresh();
          return;
        }
        console.error('launch refresh check error', err);
        if (debugEnabled) console.log(`[${debugName}] version_check_error`, { error: String((err as any)?.message || err) });
      }
    };

    const schedule = () => {
      if (cancelled) return;
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (!canCheckForUpdates()) {
        setNextRefreshAt(null);
        return;
      }
      const now = Date.now();
      const next = getNextAdaptiveLaunchRefreshMs({
        nowMs: now,
        intervalSeconds: refreshIntervalSeconds,
        cadenceAnchorNet
      });
      setNextRefreshAt(next);
      const delay = Math.max(0, next - now);
      if (debugEnabled) console.log(`[${debugName}] schedule`, { now, next, delayMs: delay, tier, refreshIntervalSeconds, cadenceAnchorNet });
      timeout = setTimeout(async () => {
        if (cancelled) return;
        if (debugEnabled) console.log(`[${debugName}] tick`, { tier, now: Date.now() });
        await checkForUpdates();
        schedule();
      }, delay);
    };

    const resumeChecks = () => {
      if (cancelled || !canCheckForUpdates()) return;
      void checkForUpdates();
      schedule();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setNextRefreshAt(null);
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        return;
      }
      resumeChecks();
    };

    const handleOnline = () => resumeChecks();
    const handleFocus = () => resumeChecks();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleFocus);
    schedule();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleFocus);
    };
  }, [cadenceAnchorNet, debugEnabled, debugName, debugTrace, launchId, queryClient, refreshIntervalMs, refreshIntervalSeconds, router, scope, tier]);

  useEffect(() => {
    if (tier !== 'premium' || scope !== 'live' || !launchId) {
      return;
    }

    let cancelled = false;
    let cleanup: (() => void) | null = null;

    const handleSignal = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (typeof navigator !== 'undefined' && 'onLine' in navigator && navigator.onLine === false) return;

      const now = Date.now();
      if (now - lastSignalAtRef.current < LIVE_DETAIL_REFRESH_SIGNAL_COOLDOWN_MS) {
        return;
      }
      lastSignalAtRef.current = now;
      lastSeenRef.current = null;

      if (debugEnabled) {
        console.log(`[${debugName}] realtime_refresh_signal`, { launchId, scope });
      }

      router.refresh();
    };

    void subscribeToBrowserLaunchRefreshSignal({
      scope: 'detail_live',
      launchId,
      onSignal: handleSignal
    }).then((nextCleanup) => {
      if (cancelled) {
        nextCleanup?.();
        return;
      }
      cleanup = nextCleanup;
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [debugEnabled, debugName, launchId, router, scope, tier]);

  const summary = useMemo(() => {
    if (tier === 'premium') {
      return refreshIntervalSeconds <= 15
        ? 'Checks for updates every 15 seconds during the active launch window.'
        : 'Checks for updates every 2 minutes outside the active launch window.';
    }
    return 'Updates every 2 hours.';
  }, [refreshIntervalSeconds, tier]);

  const cadence =
    tier === 'premium'
      ? 'Refresh timing adapts to the site-wide launch window.'
      : 'Aligned to 12:00am, 2:00am, 4:00am, … local time.';
  const nextLabel = nextRefreshAt ? formatRefreshTime(nextRefreshAt, tier === 'premium' && refreshIntervalSeconds < 60) : null;

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
