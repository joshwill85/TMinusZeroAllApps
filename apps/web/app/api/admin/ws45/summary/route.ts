import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../_lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type CountBucket = {
  label: string;
  count: number;
};

type TrendWindow = {
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

type ReplayVersionStat = {
  parserVersion: string;
  replayCount: number;
  recoveredCount: number;
  matchedCount: number;
  lastReplayAt: string | null;
};

type NormalizedAlertRow = {
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
};

type CoverageRow = {
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

function toCountBuckets(map: Map<string, number>): CountBucket[] {
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function clampPercent(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}

function parseIsoMs(value: unknown) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : NaN;
}

function sortByFreshness(a: Record<string, any>, b: Record<string, any>) {
  const aMs = parseIsoMs(a?.issued_at || a?.fetched_at);
  const bMs = parseIsoMs(b?.issued_at || b?.fetched_at);
  if (Number.isFinite(aMs) && Number.isFinite(bMs)) return bMs - aMs;
  return String(b?.fetched_at || '').localeCompare(String(a?.fetched_at || ''));
}

function hasWindowOverlap(forecast: Record<string, any>, launch: Record<string, any>) {
  const forecastStart = parseIsoMs(forecast?.valid_start);
  const forecastEnd = parseIsoMs(forecast?.valid_end);
  const launchStart = parseIsoMs(launch?.window_start || launch?.net);
  const launchEnd = parseIsoMs(launch?.window_end || launch?.net || launch?.window_start);
  if (!Number.isFinite(forecastStart) || !Number.isFinite(forecastEnd) || !Number.isFinite(launchStart)) return false;
  const normalizedLaunchEnd = Number.isFinite(launchEnd) && launchEnd >= launchStart ? launchEnd : launchStart;
  return forecastStart <= normalizedLaunchEnd && forecastEnd >= launchStart;
}

function buildTrendWindow(label: string, since: string, recentForecasts: Array<Record<string, any>>): TrendWindow {
  const sinceMs = Date.parse(since);
  const rows = recentForecasts.filter((row) => {
    const fetchedAt = parseIsoMs(row?.fetched_at);
    return Number.isFinite(fetchedAt) && fetchedAt >= sinceMs;
  });

  const familyCounts = new Map<string, number>();
  let parsedDocs = 0;
  let partialDocs = 0;
  let failedDocs = 0;
  let publishEligibleDocs = 0;
  let unknownFamilyDocs = 0;

  for (const row of rows) {
    const parseStatus = String(row?.parse_status || 'failed');
    const family = String(row?.document_family || 'unknown_family');
    if (parseStatus === 'parsed') parsedDocs += 1;
    else if (parseStatus === 'partial') partialDocs += 1;
    else failedDocs += 1;
    if (row?.publish_eligible) publishEligibleDocs += 1;
    if (family === 'unknown_family') unknownFamilyDocs += 1;
    familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
  }

  return {
    label,
    since,
    totalDocs: rows.length,
    parsedDocs,
    partialDocs,
    failedDocs,
    publishEligibleDocs,
    unknownFamilyDocs,
    parsedPct: clampPercent(parsedDocs, rows.length),
    publishPct: clampPercent(publishEligibleDocs, rows.length),
    topFamily: toCountBuckets(familyCounts)[0]?.label ?? null
  };
}

function buildReplayVersionStats(parseRuns: Array<Record<string, any>>): ReplayVersionStat[] {
  const replayAttempts = new Set(['reparse', 'admin_replay', 'backfill']);
  const statsByVersion = new Map<string, ReplayVersionStat>();

  for (const row of parseRuns) {
    const attemptReason = String(row?.attempt_reason || '');
    if (!replayAttempts.has(attemptReason)) continue;

    const parserVersion = String(row?.parser_version || 'unknown');
    const current =
      statsByVersion.get(parserVersion) ?? {
        parserVersion,
        replayCount: 0,
        recoveredCount: 0,
        matchedCount: 0,
        lastReplayAt: null
      };

    current.replayCount += 1;
    if (row?.publish_eligible) current.recoveredCount += 1;
    const matchStatus = String((row?.stats as Record<string, unknown> | null)?.match_status || '');
    if (matchStatus === 'matched') current.matchedCount += 1;

    const createdAt = typeof row?.created_at === 'string' ? row.created_at : null;
    if (!current.lastReplayAt || (createdAt && createdAt > current.lastReplayAt)) current.lastReplayAt = createdAt;

    statsByVersion.set(parserVersion, current);
  }

  return [...statsByVersion.values()].sort((a, b) => {
    if (a.recoveredCount !== b.recoveredCount) return b.recoveredCount - a.recoveredCount;
    if (a.replayCount !== b.replayCount) return b.replayCount - a.replayCount;
    return String(b.lastReplayAt || '').localeCompare(String(a.lastReplayAt || ''));
  });
}

function normalizeAlertRows(details: Record<string, any> | null | undefined): NormalizedAlertRow[] {
  const rows = Array.isArray(details?.rows) ? (details?.rows as Array<Record<string, any>>) : [];
  return rows.slice(0, 8).map((row) => {
    const looksLikeForecast =
      typeof row?.pdf_url === 'string' ||
      typeof row?.source_label === 'string' ||
      typeof row?.parse_status === 'string' ||
      typeof row?.match_status === 'string';

    const id = typeof row?.id === 'string' ? row.id : null;
    return {
      kind: looksLikeForecast ? 'forecast' : 'launch',
      id,
      launchId: looksLikeForecast ? null : id,
      forecastId: looksLikeForecast ? id : null,
      label: String(row?.source_label || row?.mission_name || row?.name || 'WS45 item'),
      sourceLabel: typeof row?.source_label === 'string' ? row.source_label : null,
      missionName: typeof row?.mission_name === 'string' ? row.mission_name : typeof row?.name === 'string' ? row.name : null,
      pdfUrl: typeof row?.pdf_url === 'string' ? row.pdf_url : null,
      fetchedAt: typeof row?.fetched_at === 'string' ? row.fetched_at : null,
      issuedAt: typeof row?.issued_at === 'string' ? row.issued_at : null,
      validStart: typeof row?.valid_start === 'string' ? row.valid_start : null,
      validEnd: typeof row?.valid_end === 'string' ? row.valid_end : null,
      matchStatus: typeof row?.match_status === 'string' ? row.match_status : null,
      parseStatus: typeof row?.parse_status === 'string' ? row.parse_status : null,
      publishEligible: typeof row?.publish_eligible === 'boolean' ? row.publish_eligible : null,
      documentFamily: typeof row?.document_family === 'string' ? row.document_family : null,
      parseVersion: typeof row?.parse_version === 'string' ? row.parse_version : null
    };
  });
}

function buildCoverage(upcomingLaunches: Array<Record<string, any>>, recentForecasts: Array<Record<string, any>>): CoverageRow[] {
  const matchedByLaunch = new Map<string, Array<Record<string, any>>>();
  const nonMatchedCandidates = recentForecasts.filter((row) => {
    const status = String(row?.match_status || '');
    return status === 'ambiguous' || status === 'unmatched';
  });

  for (const row of recentForecasts) {
    const launchId = typeof row?.matched_launch_id === 'string' ? row.matched_launch_id : '';
    if (!launchId) continue;
    const bucket = matchedByLaunch.get(launchId) ?? [];
    bucket.push(row);
    matchedByLaunch.set(launchId, bucket);
  }

  for (const bucket of matchedByLaunch.values()) {
    bucket.sort(sortByFreshness);
  }

  return upcomingLaunches.map((launch) => {
    const launchId = String(launch?.id || '');
    const matchedRows = matchedByLaunch.get(launchId) ?? [];
    const publishable = matchedRows.find((row) => row?.publish_eligible && String(row?.match_status || '') === 'matched') ?? null;
    const quarantinedMatched = matchedRows.find((row) => !row?.publish_eligible && String(row?.match_status || '') === 'matched') ?? null;
    const overlappingCandidate = nonMatchedCandidates.filter((row) => hasWindowOverlap(row, launch)).sort(sortByFreshness)[0] ?? null;
    const chosen = publishable ?? quarantinedMatched ?? overlappingCandidate ?? null;

    let status: CoverageRow['status'] = 'missing';
    let statusReason = 'No recent WS45 forecast candidate found for this launch.';
    if (publishable) {
      status = 'covered';
      statusReason = 'Publishable matched forecast attached.';
    } else if (quarantinedMatched) {
      status = 'quarantined';
      statusReason = `Matched forecast exists but is quarantined: ${
        Array.isArray(quarantinedMatched?.quarantine_reasons) && quarantinedMatched.quarantine_reasons.length
          ? quarantinedMatched.quarantine_reasons.join(', ')
          : 'publish gate failed'
      }.`;
    } else if (overlappingCandidate) {
      status = 'attention';
      statusReason = `${String(overlappingCandidate?.match_status || 'candidate')} forecast overlaps this launch window but is not matched.`;
    }

    return {
      launchId,
      launchName: String(launch?.name || 'Upcoming launch'),
      net: launch?.net ?? null,
      windowStart: launch?.window_start ?? null,
      windowEnd: launch?.window_end ?? null,
      padName: launch?.pad_name ?? null,
      padShortCode: launch?.pad_short_code ?? null,
      status,
      statusReason,
      forecastId: chosen?.id ?? null,
      sourceLabel: chosen?.source_label ?? null,
      issuedAt: chosen?.issued_at ?? null,
      validStart: chosen?.valid_start ?? null,
      validEnd: chosen?.valid_end ?? null,
      parseVersion: chosen?.parse_version ?? null,
      documentFamily: chosen?.document_family ?? null,
      matchStatus: chosen?.match_status ?? null,
      parseStatus: chosen?.parse_status ?? null,
      quarantineReasons: Array.isArray(chosen?.quarantine_reasons) ? chosen.quarantine_reasons : [],
      requiredFieldsMissing: Array.isArray(chosen?.required_fields_missing) ? chosen.required_fields_missing : []
    };
  });
}

export async function GET() {
  const gate = await requireAdminRequest({ requireServiceRole: true });
  if (!gate.ok) return gate.response;

  const admin = gate.context.admin;
  if (!admin) return NextResponse.json({ error: 'supabase_admin_not_configured' }, { status: 501 });

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const horizonEndIso = new Date(nowMs + 14 * 24 * 60 * 60 * 1000).toISOString();
  const recentStartIso = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [latestRunRes, latestParseRunRes, alertsRes, alertHistoryRes, recentForecastsRes, upcomingLaunchesRes] = await Promise.all([
    admin
      .from('ingestion_runs')
      .select('started_at, ended_at, success, error, stats')
      .eq('job_name', 'ws45_forecasts_ingest')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from('ws45_forecast_parse_runs').select('created_at').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin
      .from('ops_alerts')
      .select('key, severity, message, last_seen_at, occurrences, details')
      .eq('resolved', false)
      .like('key', 'ws45_%')
      .order('last_seen_at', { ascending: false })
      .limit(25),
    admin
      .from('ops_alerts')
      .select('key, severity, message, last_seen_at, occurrences, details, resolved, resolved_at')
      .eq('resolved', true)
      .like('key', 'ws45_%')
      .order('resolved_at', { ascending: false })
      .limit(20),
    admin
      .from('ws45_launch_forecasts')
      .select(
        'id,source_label,forecast_kind,pdf_url,issued_at,valid_start,valid_end,fetched_at,mission_name,match_status,match_confidence,parse_version,document_family,parse_status,parse_confidence,publish_eligible,quarantine_reasons,required_fields_missing,normalization_flags,matched_launch_id'
      )
      .gte('fetched_at', recentStartIso)
      .order('fetched_at', { ascending: false })
      .limit(100),
    admin
      .from('launches')
      .select('id,name,net,window_start,window_end,pad_name,pad_short_code,pad_state')
      .eq('hidden', false)
      .eq('pad_state', 'FL')
      .gte('net', nowIso)
      .lte('net', horizonEndIso)
      .order('net', { ascending: true })
      .limit(25)
  ]);

  const anyError = [
    latestRunRes.error,
    latestParseRunRes.error,
    alertsRes.error,
    alertHistoryRes.error,
    recentForecastsRes.error,
    upcomingLaunchesRes.error
  ].filter(Boolean);
  if (anyError.length) {
    console.error('admin ws45 summary partial errors', anyError);
  }

  const recentForecasts = (((recentForecastsRes.data as Array<Record<string, any>> | null) ?? []).filter(
    (row) => String(row?.forecast_kind || '') !== 'faq'
  ) as Array<Record<string, any>>).sort(sortByFreshness);
  const recentForecastIds = recentForecasts.map((row) => String(row?.id || '')).filter(Boolean);
  const rawAlerts = (alertsRes.data as Array<Record<string, any>> | null) ?? [];
  const rawAlertHistory = (alertHistoryRes.data as Array<Record<string, any>> | null) ?? [];
  const upcomingLaunches = (upcomingLaunchesRes.data as Array<Record<string, any>> | null) ?? [];

  const parseRunsRes =
    recentForecastIds.length > 0
      ? await admin
          .from('ws45_forecast_parse_runs')
          .select(
            'id,forecast_id,parser_version,runtime,attempt_reason,document_mode,document_family,parse_status,parse_confidence,publish_eligible,missing_required_fields,validation_failures,normalization_flags,field_confidence,field_evidence,strategy_trace,stats,created_at'
          )
          .in('forecast_id', recentForecastIds)
          .order('created_at', { ascending: false })
          .limit(300)
      : ({ data: [], error: null } as const);

  if (parseRunsRes.error) {
    console.error('admin ws45 parse run query error', parseRunsRes.error);
  }

  const parseRuns = (((parseRunsRes.data as Array<Record<string, any>> | null) ?? []) as Array<Record<string, any>>).sort((a, b) =>
    String(b?.created_at || '').localeCompare(String(a?.created_at || ''))
  );
  const parseRunsByForecast = Object.fromEntries(
    recentForecastIds.map((forecastId) => [
      forecastId,
      parseRuns.filter((row) => String(row?.forecast_id || '') === forecastId).slice(0, 6)
    ])
  );

  const coverage = buildCoverage(upcomingLaunches, recentForecasts);
  const familyCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  for (const row of recentForecasts) {
    const family = String(row?.document_family || 'unknown_family');
    const parseStatus = String(row?.parse_status || 'failed');
    familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
    statusCounts.set(parseStatus, (statusCounts.get(parseStatus) || 0) + 1);
  }

  const alerts = rawAlerts.map((alert) => {
    const affectedRows = normalizeAlertRows(alert?.details as Record<string, any> | null);
    const affectedForecastIds = affectedRows.map((row) => row.forecastId).filter((value): value is string => Boolean(value));
    const affectedLaunchIds = affectedRows.map((row) => row.launchId).filter((value): value is string => Boolean(value));
    return {
      ...alert,
      affectedRows,
      affectedForecastIds,
      affectedLaunchIds
    };
  });
  const alertHistory = rawAlertHistory.map((alert) => {
    const affectedRows = normalizeAlertRows(alert?.details as Record<string, any> | null);
    const affectedForecastIds = affectedRows.map((row) => row.forecastId).filter((value): value is string => Boolean(value));
    const affectedLaunchIds = affectedRows.map((row) => row.launchId).filter((value): value is string => Boolean(value));
    return {
      ...alert,
      affectedRows,
      affectedForecastIds,
      affectedLaunchIds
    };
  });

  const trendWindows = [
    buildTrendWindow('24h', new Date(nowMs - 24 * 60 * 60 * 1000).toISOString(), recentForecasts),
    buildTrendWindow('7d', new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString(), recentForecasts),
    buildTrendWindow('30d', recentStartIso, recentForecasts)
  ];

  const publishEligibleCount = recentForecasts.filter((row) => Boolean(row?.publish_eligible)).length;
  const quarantinedCount = recentForecasts.filter((row) => !row?.publish_eligible).length;
  const health = {
    latestIngestAt: latestRunRes.data?.ended_at || latestRunRes.data?.started_at || null,
    latestParseRunAt: latestParseRunRes.data?.created_at || null,
    openAlertCount: alerts.length,
    recentForecastCount: recentForecasts.length,
    publishEligibleCount,
    quarantinedCount,
    upcomingFloridaLaunchCount: coverage.length,
    coverageCount: coverage.filter((row) => row.status === 'covered').length,
    coverageGapCount: coverage.filter((row) => row.status !== 'covered').length
  };

  return NextResponse.json(
    {
      mode: 'db',
      summary: {
        health,
        latestRun: latestRunRes.data ?? null,
        alerts,
        alertHistory,
        recentForecasts,
        coverage,
        familyCounts: toCountBuckets(familyCounts),
        parseStatusCounts: toCountBuckets(statusCounts),
        trends: {
          windows: trendWindows,
          replayByVersion: buildReplayVersionStats(parseRuns)
        },
        parseRunsByForecast
      }
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
