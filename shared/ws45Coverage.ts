export type Ws45CoverageRow = {
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

export const WS45_MISSION_FORECAST_EXPECTED_WINDOW_HOURS = 48;
const WS45_MISSION_FORECAST_EXPECTED_WINDOW_MS =
  WS45_MISSION_FORECAST_EXPECTED_WINDOW_HOURS * 60 * 60 * 1000;

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

export function isWs45CoverageEligibleLaunch(launch: Record<string, any>, nowMs = Date.now()) {
  const launchStartMs = parseIsoMs(launch?.window_start || launch?.net);
  if (!Number.isFinite(launchStartMs) || launchStartMs < nowMs) return false;
  return launchStartMs - nowMs <= WS45_MISSION_FORECAST_EXPECTED_WINDOW_MS;
}

export function buildWs45CoverageRows(
  upcomingLaunches: Array<Record<string, any>>,
  recentForecasts: Array<Record<string, any>>
): Ws45CoverageRow[] {
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

    let status: Ws45CoverageRow['status'] = 'missing';
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
