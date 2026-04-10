import { parsePublicOrbitData } from '../apps/web/lib/trajectory/publicOrbitSignals';
import { evaluateRocketLabPageSignals, stripHtml, type FetchTextResult } from './rocket-lab-source-audit-lib';

export type FieldAuditLaunchInput = {
  launchId: string;
  name: string | null;
  missionName: string | null;
  net: string | null;
  vehicle: string | null;
  statusName: string | null;
  matchStatus: 'deterministic' | 'probable' | 'ambiguous' | 'none';
  bestMatchUrl: string | null;
  bestMatchScore: number | null;
  matchedAlias: string | null;
};

export type FieldAuditLaunchReport = {
  launchId: string;
  name: string | null;
  missionName: string | null;
  net: string | null;
  vehicle: string | null;
  statusName: string | null;
  matchStatus: 'deterministic' | 'probable';
  bestMatchUrl: string;
  bestMatchScore: number | null;
  matchedAlias: string | null;
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
  signals: {
    hasTrajectorySignals: boolean;
    orbitSignalCount: number;
    milestoneSignalCount: number;
    recoverySignalCount: number;
    numericOrbitSignalCount: number;
    matchedKeywords: string[];
  };
  hasAuthorityFieldBundle: boolean;
};

export type FieldAuditSummary = {
  launchesEligibleFromJoinAudit: number;
  launchesAudited: number;
  launchesFetchedSuccessfully: number;
  launchesWithInclination: number;
  launchesWithFlightAzimuth: number;
  launchesWithAltitude: number;
  launchesWithApogee: number;
  launchesWithPerigee: number;
  launchesWithOrbitClass: number;
  launchesWithAnyNumericOrbitField: number;
  launchesWithMilestoneSignals: number;
  launchesWithRecoverySignals: number;
  launchesWithNumericOrbitSignals: number;
  launchesWithAuthorityFieldBundle: number;
};

export type FieldAuditSignal = 'yes' | 'partial' | 'no';
export type FieldAuditDecision = 'pass' | 'defer' | 'reject';

export type FieldAuditReport = {
  generatedAt: string;
  mode: 'fixture' | 'live';
  fixtureJsonPath: string | null;
  joinAuditJsonPath: string | null;
  decision: FieldAuditDecision;
  availability: FieldAuditSignal;
  joinability: FieldAuditSignal;
  usableCoverage: FieldAuditSignal;
  summary: FieldAuditSummary;
  reasons: string[];
  launches: FieldAuditLaunchReport[];
};

export function buildRocketLabFieldAuditReport(input: {
  mode: 'fixture' | 'live';
  fixtureJsonPath: string | null;
  joinAuditJsonPath: string | null;
  launches: FieldAuditLaunchInput[];
  fetchedPages: Map<string, FetchTextResult>;
}) {
  const eligibleLaunches = input.launches.filter(
    (launch): launch is FieldAuditLaunchInput & { bestMatchUrl: string; matchStatus: 'deterministic' | 'probable' } =>
      (launch.matchStatus === 'deterministic' || launch.matchStatus === 'probable') && typeof launch.bestMatchUrl === 'string' && launch.bestMatchUrl.length > 0
  );

  const launches: FieldAuditLaunchReport[] = eligibleLaunches.map((launch) => {
    const fetch = input.fetchedPages.get(launch.bestMatchUrl);
    const ok = Boolean(fetch?.ok);
    const text = ok ? stripHtml(fetch?.text || '') : '';
    const orbit = parsePublicOrbitData(text);
    const signals = ok
      ? evaluateRocketLabPageSignals(launch.bestMatchUrl, fetch?.text || '')
      : {
          slug: null,
          hasTrajectorySignals: false,
          orbitSignalCount: 0,
          milestoneSignalCount: 0,
          recoverySignalCount: 0,
          numericOrbitSignalCount: 0,
          matchedKeywords: []
        };
    const anyNumericOrbitField =
      orbit.inclination_deg != null ||
      orbit.flight_azimuth_deg != null ||
      orbit.altitude_km != null ||
      orbit.apogee_km != null ||
      orbit.perigee_km != null;
    const hasAuthorityFieldBundle = anyNumericOrbitField && signals.milestoneSignalCount > 0;

    return {
      launchId: launch.launchId,
      name: launch.name,
      missionName: launch.missionName,
      net: launch.net,
      vehicle: launch.vehicle,
      statusName: launch.statusName,
      matchStatus: launch.matchStatus,
      bestMatchUrl: launch.bestMatchUrl,
      bestMatchScore: launch.bestMatchScore,
      matchedAlias: launch.matchedAlias,
      pageFetched: ok,
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
      signals: {
        hasTrajectorySignals: signals.hasTrajectorySignals,
        orbitSignalCount: signals.orbitSignalCount,
        milestoneSignalCount: signals.milestoneSignalCount,
        recoverySignalCount: signals.recoverySignalCount,
        numericOrbitSignalCount: signals.numericOrbitSignalCount,
        matchedKeywords: signals.matchedKeywords
      },
      hasAuthorityFieldBundle
    };
  });

  const summary: FieldAuditSummary = {
    launchesEligibleFromJoinAudit: eligibleLaunches.length,
    launchesAudited: launches.length,
    launchesFetchedSuccessfully: launches.filter((launch) => launch.pageFetched).length,
    launchesWithInclination: launches.filter((launch) => launch.orbit.inclinationDeg != null).length,
    launchesWithFlightAzimuth: launches.filter((launch) => launch.orbit.flightAzimuthDeg != null).length,
    launchesWithAltitude: launches.filter((launch) => launch.orbit.altitudeKm != null).length,
    launchesWithApogee: launches.filter((launch) => launch.orbit.apogeeKm != null).length,
    launchesWithPerigee: launches.filter((launch) => launch.orbit.perigeeKm != null).length,
    launchesWithOrbitClass: launches.filter((launch) => Boolean(launch.orbit.orbitClass)).length,
    launchesWithAnyNumericOrbitField: launches.filter((launch) => launch.orbit.anyNumericOrbitField).length,
    launchesWithMilestoneSignals: launches.filter((launch) => launch.signals.milestoneSignalCount > 0).length,
    launchesWithRecoverySignals: launches.filter((launch) => launch.signals.recoverySignalCount > 0).length,
    launchesWithNumericOrbitSignals: launches.filter((launch) => launch.signals.numericOrbitSignalCount > 0).length,
    launchesWithAuthorityFieldBundle: launches.filter((launch) => launch.hasAuthorityFieldBundle).length
  };

  const availability: FieldAuditSignal = summary.launchesEligibleFromJoinAudit > 0 ? 'yes' : 'no';
  const joinability: FieldAuditSignal = availability === 'yes' ? 'partial' : 'no';
  const bundleCoverage = safeRate(summary.launchesWithAuthorityFieldBundle, summary.launchesAudited);
  const usableCoverage: FieldAuditSignal =
    typeof bundleCoverage === 'number' && bundleCoverage >= 0.6
      ? 'yes'
      : 'no';
  const decision: FieldAuditDecision = availability === 'no' ? 'reject' : 'defer';

  const reasons: string[] = [];
  reasons.push(
    `Field audit evaluated ${summary.launchesAudited}/${summary.launchesEligibleFromJoinAudit} deterministic-or-probable Rocket Lab joins from the join audit.`
  );
  reasons.push(
    `Numeric orbit-like values were present on ${summary.launchesWithAnyNumericOrbitField}/${summary.launchesAudited} matched launches, orbit class on ${summary.launchesWithOrbitClass}/${summary.launchesAudited}, milestone signals on ${summary.launchesWithMilestoneSignals}/${summary.launchesAudited}, and recovery signals on ${summary.launchesWithRecoverySignals}/${summary.launchesAudited}.`
  );
  reasons.push(
    `Only ${summary.launchesWithAuthorityFieldBundle}/${summary.launchesAudited} matched launches carried both a numeric orbit-like field and milestone signals, so usable coverage remains "${usableCoverage}".`
  );

  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    fixtureJsonPath: input.fixtureJsonPath,
    joinAuditJsonPath: input.joinAuditJsonPath,
    decision,
    availability,
    joinability,
    usableCoverage,
    summary,
    reasons,
    launches
  } satisfies FieldAuditReport;
}

function safeRate(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}
