'use client';

import { type ComponentPropsWithoutRef, type MouseEvent, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const BLUE_ORIGIN_NAV_TRACE_KEY = '__tmzBlueOriginRouteTrace';
const MAX_SLOW_RESOURCE_MS = 150;

type RouteTraceEntry = {
  targetPath: string;
  sourcePath: string;
  startedAtMs: number;
  clickedAtIso: string;
  traceLabel: string;
};

type WindowWithBlueOriginRouteTrace = Window & {
  [BLUE_ORIGIN_NAV_TRACE_KEY]?: RouteTraceEntry;
};

type BlueOriginServerTiming = {
  phase: 'fetch' | 'transform' | 'server-total';
  step: string;
  ms: number;
  status: 'ok' | 'error';
  detail: string | null;
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
  return (window as WindowWithBlueOriginRouteTrace)[BLUE_ORIGIN_NAV_TRACE_KEY] || null;
}

function clearTraceEntry() {
  if (typeof window === 'undefined') return;
  delete (window as WindowWithBlueOriginRouteTrace)[BLUE_ORIGIN_NAV_TRACE_KEY];
}

function writeTraceEntry(targetPath: string, sourcePath: string, traceLabel: string) {
  if (typeof window === 'undefined' || typeof performance === 'undefined') return;
  const entry: RouteTraceEntry = {
    targetPath: normalizePath(targetPath),
    sourcePath: normalizePath(sourcePath || '/'),
    startedAtMs: performance.now(),
    clickedAtIso: new Date().toISOString(),
    traceLabel
  };
  (window as WindowWithBlueOriginRouteTrace)[BLUE_ORIGIN_NAV_TRACE_KEY] = entry;
}

function isPrimaryClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function BlueOriginRouteTraceLink({
  href,
  traceLabel,
  children,
  onClick,
  prefetch = true,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof Link>, 'href'> & {
  href: string;
  traceLabel?: string;
}) {
  const sourcePath = usePathname();

  return (
    <Link
      href={href}
      prefetch={prefetch}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (!isPrimaryClick(event)) return;
        const normalizedTarget = normalizePath(href);
        if (process.env.NODE_ENV !== 'production') {
          console.debug('[TMZ][BlueOriginMission] captured route trace click', {
            targetPath: normalizedTarget,
            sourcePath: sourcePath || '/',
            traceLabel: traceLabel || normalizedTarget
          });
        }
        writeTraceEntry(normalizedTarget, sourcePath || '/', traceLabel || normalizedTarget);
      }}
    >
      {children}
    </Link>
  );
}

export function BlueOriginRouteTraceLogger({
  expectedPath,
  serverTimings
}: {
  expectedPath: string;
  serverTimings?: BlueOriginServerTiming[];
}) {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof performance === 'undefined' || typeof console === 'undefined') return;

    if (serverTimings && serverTimings.length) {
      console.group('[TMZ][BlueOriginMission] server timings');
      console.table(
        serverTimings.map((row) => ({
          phase: row.phase,
          step: row.step,
          ms: Number(row.ms.toFixed(2)),
          status: row.status,
          detail: row.detail || ''
        }))
      );
      console.groupEnd();
    }

    const current = normalizePath(pathname || '/');
    const entry = readTraceEntry();
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[TMZ][BlueOriginMission] no route trace entry found on landing', {
          expectedPath,
          currentPath: current
        });
      }
      logClientPerformanceDiagnostics();
      return;
    }
    const expected = normalizePath(expectedPath);
    if (current !== expected && !current.startsWith(`${expected}/`)) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[TMZ][BlueOriginMission] route trace path mismatch', {
          expectedPath: expected,
          currentPath: current,
          sourcePath: entry.sourcePath,
          targetPath: entry.targetPath,
          traceLabel: entry.traceLabel
        });
      }
      return;
    }

    const landingMs = Number((performance.now() - entry.startedAtMs).toFixed(2));
    const serverTotal = serverTimings?.find((row) => row.step === 'blueOriginMissionPage' && row.phase === 'server-total');
    const slowServerSteps = serverTimings?.filter((row) => row.ms >= 250) || [];
    console.info('[TMZ][BlueOriginMission] click-to-route landing', {
      traceLabel: entry.traceLabel,
      targetPath: entry.targetPath,
      sourcePath: entry.sourcePath,
      currentPath: current,
      clickedAtIso: entry.clickedAtIso,
      landingMs,
      serverTotalMs: serverTotal ? serverTotal.ms : null
    });
    if (slowServerSteps.length) {
      console.warn('[TMZ][BlueOriginMission] slow server timing steps (>=250ms)', {
        count: slowServerSteps.length,
        steps: slowServerSteps.map((row) => ({
          phase: row.phase,
          step: row.step,
          ms: Number(row.ms.toFixed(2)),
          status: row.status
        }))
      });
    }
    logClientPerformanceDiagnostics();
    clearTraceEntry();
  }, [expectedPath, pathname, serverTimings]);

  return null;
}

function logClientPerformanceDiagnostics() {
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
    .filter((entry) => Number.isFinite(entry.duration) && entry.duration >= MAX_SLOW_RESOURCE_MS)
    .sort((left, right) => right.duration - left.duration)
    .slice(0, 20)
    .map((entry) => ({
      initiatorType: entry.initiatorType || 'unknown',
      durationMs: Number(entry.duration.toFixed(2)),
      transferSizeBytes: entry.transferSize,
      name: truncateResourceName(entry.name)
    }));

  if (slowResources.length) {
    console.warn('[TMZ][BlueOriginMission] slow resource timings (>=150ms)');
    console.table(slowResources);
  }
}

function truncateResourceName(name: string) {
  if (name.length <= 120) return name;
  return `${name.slice(0, 117)}...`;
}
