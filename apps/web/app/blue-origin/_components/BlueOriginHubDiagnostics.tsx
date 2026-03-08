'use client';

import { useEffect, useRef } from 'react';

type DiagnosticLaunchSample = {
  id: string;
  name: string;
  net: string | null;
  ll2Id: string | null;
  status: string | null;
  mission: string | null;
};

type DiagnosticDuplicateGroup = {
  key: string;
  count: number;
  sample: DiagnosticLaunchSample[];
};

type DiagnosticCrossBucketGroup = {
  key: string;
  upcomingCount: number;
  recentCount: number;
  upcomingSample: DiagnosticLaunchSample[];
  recentSample: DiagnosticLaunchSample[];
};

type DiagnosticMissingManifestLaunch = {
  key: string;
  id: string;
  name: string;
  net: string | null;
  mission: string | null;
  href: string;
};

type DiagnosticTimingRow = {
  phase: 'fetch' | 'transform' | 'server-total';
  step: string;
  ms: number;
  status: 'ok' | 'error';
  detail: string | null;
};

export type BlueOriginHubDiagnosticsPayload = {
  route: '/blue-origin';
  generatedAt: string;
  build: {
    revalidateSeconds: number;
    programGeneratedAt: string;
    programLastUpdated: string | null;
  };
  counts: {
    upcomingInput: number;
    recentInput: number;
    upcomingDeduped: number;
    recentDeduped: number;
    launchesRendered: number;
    passengers: number;
    payloads: number;
    contracts: number;
    timelineEvents: number;
    socialPostsRaw: number;
    socialPostsEmbedded: number;
    socialPostsRendered: number;
    mediaImages: number;
    youtubeVideos: number;
    vehicles: number;
    engines: number;
  };
  coverage: {
    travelerCoverageShare: number;
    payloadCoverageShare: number;
    highConfidenceTimelineShare: number;
    tentativeUpcomingShare: number;
  };
  duplicates: {
    upcoming: DiagnosticDuplicateGroup[];
    recent: DiagnosticDuplicateGroup[];
    combined: DiagnosticDuplicateGroup[];
    crossBucket: DiagnosticCrossBucketGroup[];
  };
  timings?: DiagnosticTimingRow[];
  launchesMissingManifest: DiagnosticMissingManifestLaunch[];
  warnings: string[];
};

type WindowWithBlueOriginDiagnostics = Window & {
  __tmzBlueOriginHubDiagnostics?: BlueOriginHubDiagnosticsPayload;
};

export function BlueOriginHubDiagnostics({ payload }: { payload: BlueOriginHubDiagnosticsPayload }) {
  const hasLoggedRef = useRef(false);

  useEffect(() => {
    if (hasLoggedRef.current) return;
    hasLoggedRef.current = true;

    const win = window as WindowWithBlueOriginDiagnostics;
    win.__tmzBlueOriginHubDiagnostics = payload;

    const diagnosticsTag = '[TMZ][BlueOriginHub]';
    const timestamp = formatDateTime(payload.generatedAt);
    const timingRows = Array.isArray(payload.timings) ? payload.timings : [];
    const duplicateSummary = {
      upcoming: payload.duplicates.upcoming.length,
      recent: payload.duplicates.recent.length,
      combined: payload.duplicates.combined.length,
      crossBucket: payload.duplicates.crossBucket.length
    };

    console.warn(`${diagnosticsTag} Diagnostics active @ ${timestamp}`);
    console.group(`${diagnosticsTag} diagnostics @ ${timestamp}`);
    console.info(
      `${diagnosticsTag} Saved payload on window.__tmzBlueOriginHubDiagnostics`,
      payload.route
    );
    console.log('Build', payload.build);
    console.table(payload.counts);
    console.table({
      travelerCoveragePct: Math.round(payload.coverage.travelerCoverageShare * 100),
      payloadCoveragePct: Math.round(payload.coverage.payloadCoverageShare * 100),
      highConfidenceTimelinePct: Math.round(payload.coverage.highConfidenceTimelineShare * 100),
      tentativeUpcomingPct: Math.round(payload.coverage.tentativeUpcomingShare * 100)
    });
    console.table(duplicateSummary);
    console.table(
      timingRows.map((row) => ({
        phase: row.phase,
        step: row.step,
        ms: roundMs(row.ms),
        status: row.status,
        detail: row.detail || ''
      }))
    );

    const slowTimingRows = timingRows.filter((row) => row.ms >= 250);
    if (slowTimingRows.length) {
      console.warn(`${diagnosticsTag} Slow server timing steps (>=250ms)`);
      console.table(
        slowTimingRows.map((row) => ({
          phase: row.phase,
          step: row.step,
          ms: roundMs(row.ms),
          status: row.status,
          detail: row.detail || ''
        }))
      );
    }

    if (payload.duplicates.combined.length) {
      console.warn(`${diagnosticsTag} Duplicate launch keys detected in combined source data`);
      console.table(
        payload.duplicates.combined.map((row) => ({
          key: row.key,
          count: row.count,
          sampleLaunches: row.sample.map((launch) => launch.name).join(' | ')
        }))
      );
    }

    if (payload.duplicates.crossBucket.length) {
      console.warn(`${diagnosticsTag} Launch keys found in both upcoming and recent buckets`);
      console.table(
        payload.duplicates.crossBucket.map((row) => ({
          key: row.key,
          upcomingCount: row.upcomingCount,
          recentCount: row.recentCount,
          upcomingSample: row.upcomingSample.map((launch) => launch.name).join(' | '),
          recentSample: row.recentSample.map((launch) => launch.name).join(' | ')
        }))
      );
    }

    if (payload.launchesMissingManifest.length) {
      console.warn(`${diagnosticsTag} Launches missing traveler/payload manifest links`);
      console.table(payload.launchesMissingManifest);
    }

    if (payload.warnings.length) {
      for (const warning of payload.warnings) {
        console.warn(`${diagnosticsTag} ${warning}`);
      }
    } else {
      console.info(`${diagnosticsTag} No warnings generated for this render`);
    }

    logClientPerformanceDiagnostics(diagnosticsTag);

    let longTaskObserver: PerformanceObserver | null = null;
    if (
      typeof PerformanceObserver !== 'undefined' &&
      Array.isArray(PerformanceObserver.supportedEntryTypes) &&
      PerformanceObserver.supportedEntryTypes.includes('longtask')
    ) {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          console.warn(`${diagnosticsTag} Long task detected`, {
            name: entry.name,
            startTimeMs: roundMs(entry.startTime),
            durationMs: roundMs(entry.duration)
          });
        }
      });

      try {
        longTaskObserver.observe({ entryTypes: ['longtask'] });
        console.info(`${diagnosticsTag} Long-task observer active`);
      } catch (error) {
        console.warn(`${diagnosticsTag} Failed to start long-task observer`, error);
        longTaskObserver = null;
      }
    } else {
      console.info(`${diagnosticsTag} Long-task observer not supported in this browser`);
    }

    console.log('Full diagnostics payload', payload);
    console.groupEnd();

    return () => {
      if (longTaskObserver) longTaskObserver.disconnect();
    };
  }, [payload]);

  return null;
}

function roundMs(value: number) {
  return Number(value.toFixed(2));
}

function formatDateTime(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(parsed));
}

function logClientPerformanceDiagnostics(diagnosticsTag: string) {
  if (typeof performance === 'undefined') return;

  const navigationEntry = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (navigationEntry) {
    console.table([
      {
        navDurationMs: roundMs(navigationEntry.duration),
        domContentLoadedMs: roundMs(navigationEntry.domContentLoadedEventEnd),
        loadEventEndMs: roundMs(navigationEntry.loadEventEnd),
        domInteractiveMs: roundMs(navigationEntry.domInteractive),
        transferSizeBytes: navigationEntry.transferSize
      }
    ]);
  }

  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const slowResources = resources
    .filter((entry) => Number.isFinite(entry.duration) && entry.duration >= 150)
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 30)
    .map((entry) => ({
      initiatorType: entry.initiatorType || 'unknown',
      durationMs: roundMs(entry.duration),
      transferSizeBytes: entry.transferSize,
      name: truncateResourceName(entry.name)
    }));

  if (slowResources.length) {
    console.warn(`${diagnosticsTag} Slow resource timings (>=150ms)`);
    console.table(slowResources);
  } else {
    console.info(`${diagnosticsTag} No slow resources detected (>=150ms)`);
  }
}

function truncateResourceName(name: string) {
  if (name.length <= 120) return name;
  return `${name.slice(0, 117)}...`;
}
