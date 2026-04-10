import { parsePublicOrbitData } from '../apps/web/lib/trajectory/publicOrbitSignals';
import { stripHtml, type FetchTextResult } from './rocket-lab-source-audit-lib';

export type BlueOriginOfficialSourcePage = {
  canonicalUrl?: string | null;
  url?: string | null;
  provenance?: string | null;
  archiveSnapshotUrl?: string | null;
  title?: string | null;
  fetchedAt?: string | null;
};

export type BlueOriginFieldAuditLaunchInput = {
  launchId: string;
  ll2LaunchUuid: string | null;
  flightCode: string | null;
  name: string | null;
  missionName: string | null;
  net: string | null;
  missionSummary: string | null;
  officialSourcePages: BlueOriginOfficialSourcePage[];
  officialSourceHealth: {
    checked: number;
    broken: number;
    errors: number;
  };
  anomalies: string[];
};

export type BlueOriginFieldSignals = {
  profileSignalCount: number;
  timelineSignalCount: number;
  recoverySignalCount: number;
  visibilitySignalCount: number;
  numericMissionFactCount: number;
  matchedKeywords: string[];
  numericFacts: {
    microgravityMinutes: number | null;
    lunarGravityMinutes: number | null;
    apogeeKm: number | null;
    altitudeKm: number | null;
    maxVelocity: string | null;
    gForce: string | null;
  };
};

export type BlueOriginFieldAuditLaunchReport = {
  launchId: string;
  ll2LaunchUuid: string | null;
  flightCode: string | null;
  name: string | null;
  missionName: string | null;
  net: string | null;
  missionSummary: string | null;
  selectedSourceUrl: string | null;
  selectedSourceTitle: string | null;
  selectedSourceProvenance: string | null;
  pageFetched: boolean;
  fetchStatus: number | null;
  fetchError: string | null;
  orbit: {
    inclinationDeg: number | null;
    flightAzimuthDeg: number | null;
    altitudeKm: number | null;
    apogeeKm: number | null;
    perigeeKm: number | null;
    orbitClass: string | null;
    anyNumericOrbitField: boolean;
  };
  signals: BlueOriginFieldSignals;
  hasAuthorityFieldBundle: boolean;
};

export type BlueOriginFieldAuditSummary = {
  launchesScanned: number;
  launchesWithOfficialSourcePages: number;
  launchesWithHealthyOfficialSources: number;
  launchesAudited: number;
  launchesFetchedSuccessfully: number;
  launchesWithProfileSignals: number;
  launchesWithTimelineSignals: number;
  launchesWithRecoverySignals: number;
  launchesWithVisibilitySignals: number;
  launchesWithNumericMissionFacts: number;
  launchesWithAnyNumericOrbitField: number;
  launchesWithAuthorityFieldBundle: number;
};

export type BlueOriginFieldAuditSignal = 'yes' | 'partial' | 'no';
export type BlueOriginFieldAuditDecision = 'pass' | 'defer' | 'reject';

export type BlueOriginFieldAuditReport = {
  generatedAt: string;
  mode: 'fixture' | 'live';
  fixtureJsonPath: string | null;
  auditJsonPath: string;
  decision: BlueOriginFieldAuditDecision;
  availability: BlueOriginFieldAuditSignal;
  joinability: BlueOriginFieldAuditSignal;
  usableCoverage: BlueOriginFieldAuditSignal;
  summary: BlueOriginFieldAuditSummary;
  reasons: string[];
  launches: BlueOriginFieldAuditLaunchReport[];
};

const PROFILE_PATTERNS = [
  /\bflight\s+profile\b/i,
  /\bmission\s+profile\b/i,
  /\bmission\s+timeline\b/i,
  /\bby\s+the\s+numbers\b/i,
  /\bflight[_-]?profile\b/i,
  /\bmission[_-]?profile\b/i,
  /\bmission[_-]?timeline\b/i,
  /\bby[_-]?the[_-]?numbers\b/i,
  /\bflightprofile\b/i,
  /\bmissionprofile\b/i,
  /\bmissiontimeline\b/i,
  /\bbooster[_-]?recovery\b/i
] as const;

const TIMELINE_PATTERNS = [
  /\bliftoff\b/i,
  /\blift[- ]off\b/i,
  /\bmain engine cutoff\b/i,
  /\bengine cutoff\b/i,
  /\bbooster landing\b/i,
  /\bcapsule separation\b/i,
  /\bpayload deployment\b/i,
  /\bmission elapsed time\b/i,
  /\bofficial launch time\b/i,
  /\bcrew capsule landing time\b/i,
  /\bmax q\b/i
] as const;

const RECOVERY_PATTERNS = [
  /\bbooster landing\b/i,
  /\bbooster recovery\b/i,
  /\bcrew capsule landing\b/i,
  /\bcapsule landing\b/i,
  /\brecovery\b/i,
  /\breusable booster\b/i
] as const;

const VISIBILITY_PATTERNS = [
  /\bvisibility map\b/i,
  /\bviewing area\b/i,
  /\bwatch live\b/i,
  /\blivestream\b/i,
  /\bwebcast\b/i,
  /\blive coverage\b/i
] as const;

export function buildBlueOriginFieldAuditReport(input: {
  mode: 'fixture' | 'live';
  fixtureJsonPath: string | null;
  auditJsonPath: string;
  launches: BlueOriginFieldAuditLaunchInput[];
  fetchedPages: Map<string, FetchTextResult>;
}) {
  const launches = input.launches.map((launch) => {
    const selectedSource = pickBlueOriginSourcePage(launch.officialSourcePages);
    const selectedSourceUrl = selectedSource ? resolveBlueOriginSourceUrl(selectedSource) : null;
    const fetch = selectedSourceUrl ? input.fetchedPages.get(selectedSourceUrl) : null;
    const pageFetched = Boolean(fetch?.ok);
    const html = pageFetched ? fetch?.text || '' : '';
    const stripped = pageFetched ? stripHtml(html) : '';
    const orbit = parsePublicOrbitData(stripped);
    const signals = pageFetched ? evaluateBlueOriginFieldSignals(html, stripped) : emptyFieldSignals();
    const anyNumericOrbitField =
      orbit.inclination_deg != null ||
      orbit.flight_azimuth_deg != null ||
      orbit.altitude_km != null ||
      orbit.apogee_km != null ||
      orbit.perigee_km != null;
    const hasAuthorityFieldBundle =
      (signals.numericMissionFactCount > 0 || anyNumericOrbitField) &&
      (signals.profileSignalCount > 0 || signals.timelineSignalCount > 0);

    return {
      launchId: launch.launchId,
      ll2LaunchUuid: launch.ll2LaunchUuid,
      flightCode: launch.flightCode,
      name: launch.name,
      missionName: launch.missionName,
      net: launch.net,
      missionSummary: launch.missionSummary,
      selectedSourceUrl,
      selectedSourceTitle: selectedSource?.title || null,
      selectedSourceProvenance: selectedSource?.provenance || null,
      pageFetched,
      fetchStatus: fetch?.status ?? null,
      fetchError: fetch?.error ?? null,
      orbit: {
        inclinationDeg: orbit.inclination_deg,
        flightAzimuthDeg: orbit.flight_azimuth_deg,
        altitudeKm: orbit.altitude_km,
        apogeeKm: orbit.apogee_km,
        perigeeKm: orbit.perigee_km,
        orbitClass: orbit.orbit_class,
        anyNumericOrbitField
      },
      signals,
      hasAuthorityFieldBundle
    } satisfies BlueOriginFieldAuditLaunchReport;
  });

  const launchesWithOfficialSourcePages = input.launches.filter((launch) => launch.officialSourcePages.length > 0).length;
  const launchesWithHealthyOfficialSources = input.launches.filter(
    (launch) =>
      launch.officialSourcePages.length > 0 &&
      (launch.officialSourceHealth.broken || 0) === 0 &&
      (launch.officialSourceHealth.errors || 0) === 0
  ).length;

  const summary: BlueOriginFieldAuditSummary = {
    launchesScanned: input.launches.length,
    launchesWithOfficialSourcePages,
    launchesWithHealthyOfficialSources,
    launchesAudited: launches.filter((launch) => Boolean(launch.selectedSourceUrl)).length,
    launchesFetchedSuccessfully: launches.filter((launch) => launch.pageFetched).length,
    launchesWithProfileSignals: launches.filter((launch) => launch.signals.profileSignalCount > 0).length,
    launchesWithTimelineSignals: launches.filter((launch) => launch.signals.timelineSignalCount > 0).length,
    launchesWithRecoverySignals: launches.filter((launch) => launch.signals.recoverySignalCount > 0).length,
    launchesWithVisibilitySignals: launches.filter((launch) => launch.signals.visibilitySignalCount > 0).length,
    launchesWithNumericMissionFacts: launches.filter((launch) => launch.signals.numericMissionFactCount > 0).length,
    launchesWithAnyNumericOrbitField: launches.filter((launch) => launch.orbit.anyNumericOrbitField).length,
    launchesWithAuthorityFieldBundle: launches.filter((launch) => launch.hasAuthorityFieldBundle).length
  };

  const availability: BlueOriginFieldAuditSignal = launchesWithOfficialSourcePages > 0 ? 'yes' : 'no';
  const joinability: BlueOriginFieldAuditSignal =
    availability === 'no'
      ? 'no'
      : launchesWithOfficialSourcePages === input.launches.length && launchesWithHealthyOfficialSources === input.launches.length
        ? 'yes'
        : 'partial';
  const bundleCoverage = safeRate(summary.launchesWithAuthorityFieldBundle, summary.launchesAudited);
  const usableCoverage: BlueOriginFieldAuditSignal =
    typeof bundleCoverage === 'number' && bundleCoverage >= 0.6 ? 'yes' : 'no';
  const decision: BlueOriginFieldAuditDecision = availability === 'no' ? 'reject' : 'defer';

  const reasons: string[] = [];
  reasons.push(
    `Field audit evaluated ${summary.launchesAudited}/${summary.launchesScanned} Blue Origin launches with official source pages from the existing audit snapshot.`
  );
  reasons.push(
    `Mission-profile signals were present on ${summary.launchesWithProfileSignals}/${summary.launchesAudited} audited launches, timeline signals on ${summary.launchesWithTimelineSignals}/${summary.launchesAudited}, recovery signals on ${summary.launchesWithRecoverySignals}/${summary.launchesAudited}, and numeric mission facts on ${summary.launchesWithNumericMissionFacts}/${summary.launchesAudited}.`
  );
  reasons.push(
    `Only ${summary.launchesWithAuthorityFieldBundle}/${summary.launchesAudited} audited launches carried both a numeric mission fact or orbit-like value and mission-profile or timeline structure, so usable coverage remains "${usableCoverage}".`
  );

  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    fixtureJsonPath: input.fixtureJsonPath,
    auditJsonPath: input.auditJsonPath,
    decision,
    availability,
    joinability,
    usableCoverage,
    summary,
    reasons,
    launches
  } satisfies BlueOriginFieldAuditReport;
}

function pickBlueOriginSourcePage(pages: BlueOriginOfficialSourcePage[]) {
  return [...pages].sort((left, right) => rankSourcePage(right) - rankSourcePage(left))[0] || null;
}

function rankSourcePage(page: BlueOriginOfficialSourcePage) {
  let score = 0;
  if (page.archiveSnapshotUrl) score += 30;
  if (page.canonicalUrl) score += 20;
  if (page.url) score += 10;
  if ((page.provenance || '').toLowerCase() === 'wayback') score += 5;
  return score;
}

function resolveBlueOriginSourceUrl(page: BlueOriginOfficialSourcePage) {
  const raw = page.archiveSnapshotUrl || page.canonicalUrl || page.url || null;
  if (!raw) return null;
  return raw.replace(/^http:\/\/web\.archive\.org\//i, 'https://web.archive.org/');
}

function evaluateBlueOriginFieldSignals(html: string, strippedHtml: string): BlueOriginFieldSignals {
  const text = strippedHtml.toLowerCase();
  const raw = html.toLowerCase();

  const profileMatches = matchPatterns(text, raw, PROFILE_PATTERNS);
  const timelineMatches = matchPatterns(text, raw, TIMELINE_PATTERNS);
  const recoveryMatches = matchPatterns(text, raw, RECOVERY_PATTERNS);
  const visibilityMatches = matchPatterns(text, raw, VISIBILITY_PATTERNS);

  const microgravityMinutes = extractNumber(
    strippedHtml,
    /(?:roughly\s+|approximately\s+|about\s+)?(\d+(?:\.\d+)?)\s+minutes?\s+of\s+(?:microgravity|weightlessness)/i
  );
  const lunarGravityMinutes = extractNumber(
    strippedHtml,
    /(?:roughly\s+|approximately\s+|about\s+)?(\d+(?:\.\d+)?)\s+minutes?\s+of\s+lunar\s+gravity/i
  );
  const apogeeKm = extractDistanceKm(strippedHtml, /apogee\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*(km|kilometers|kilometres|mi|mile|miles|ft|feet)\b/i);
  const altitudeKm = extractDistanceKm(
    strippedHtml,
    /altitude\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*(km|kilometers|kilometres|mi|mile|miles|ft|feet)\b/i
  );
  const maxVelocity = extractTextValue(strippedHtml, /maximum\s+velocity:\s*([^\n.;]+)/i);
  const gForce = extractTextValue(strippedHtml, /(?:max|maximum|peak)\s+g[-\s]*force:\s*([^\n.;]+)/i);

  const numericMissionFactCount = countTruthy([
    microgravityMinutes != null,
    lunarGravityMinutes != null,
    apogeeKm != null,
    altitudeKm != null,
    Boolean(maxVelocity),
    Boolean(gForce)
  ]);

  return {
    profileSignalCount: profileMatches.length,
    timelineSignalCount: timelineMatches.length,
    recoverySignalCount: recoveryMatches.length,
    visibilitySignalCount: visibilityMatches.length,
    numericMissionFactCount,
    matchedKeywords: [...profileMatches, ...timelineMatches, ...recoveryMatches, ...visibilityMatches],
    numericFacts: {
      microgravityMinutes,
      lunarGravityMinutes,
      apogeeKm,
      altitudeKm,
      maxVelocity,
      gForce
    }
  };
}

function matchPatterns(text: string, raw: string, patterns: readonly RegExp[]) {
  const matches = new Set<string>();
  for (const pattern of patterns) {
    if (pattern.test(text) || pattern.test(raw)) {
      matches.add(pattern.source.replace(/\\b/g, '').replace(/\\s\+/g, ' ').replace(/\(\?:/g, '('));
    }
  }
  return [...matches.values()];
}

function extractNumber(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function extractDistanceKm(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  if (!match?.[1] || !match?.[2]) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toLowerCase();
  if (unit.startsWith('km') || unit.startsWith('kilometer') || unit.startsWith('kilometre')) return value;
  if (unit.startsWith('mi') || unit.startsWith('mile')) return Number((value * 1.60934).toFixed(2));
  if (unit === 'ft' || unit === 'feet') return Number((value * 0.0003048).toFixed(4));
  return null;
}

function extractTextValue(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  const value = match?.[1]?.trim() || null;
  return value && /\d/.test(value) ? value : null;
}

function countTruthy(values: boolean[]) {
  return values.filter(Boolean).length;
}

function emptyFieldSignals(): BlueOriginFieldSignals {
  return {
    profileSignalCount: 0,
    timelineSignalCount: 0,
    recoverySignalCount: 0,
    visibilitySignalCount: 0,
    numericMissionFactCount: 0,
    matchedKeywords: [],
    numericFacts: {
      microgravityMinutes: null,
      lunarGravityMinutes: null,
      apogeeKm: null,
      altitudeKm: null,
      maxVelocity: null,
      gForce: null
    }
  };
}

function safeRate(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}
