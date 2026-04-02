import { normalizeAngleDelta } from '@/lib/ar/geo';

export type FamilyMatrixWindow = {
  minAzDeg: number;
  maxAzDeg: number;
};

export type FamilyMatrixDirectionSource = 'flight_azimuth' | 'inclination_derived' | 'heuristic_only' | 'partner_feed';

export type FamilyMatrixSelection = {
  directionSource: FamilyMatrixDirectionSource;
  selectedAzimuthDeg: number;
  alternateAzimuthDeg?: number | null;
  preferredAzimuthDeg?: number | null;
  confidenceBadge?: string | null;
  qualityState?: string | null;
  guidanceSemantics?: string | null;
  authorityTier?: string | null;
};

export type FamilyMatrixTargetOrbit = {
  flightAzimuthDeg?: number | null;
  inclinationDeg?: number | null;
};

export type FamilyMatrixObserverSample = {
  tPlusSec: number;
  azDeg: number;
  elDeg: number;
};

export type FamilyMatrixObserver = {
  id: string;
  label?: string;
  padBearingDeg: number;
  samples: FamilyMatrixObserverSample[];
};

export type FamilyMatrixCase = {
  id: string;
  label: string;
  familyId: string;
  site: string;
  pad: {
    latDeg: number;
    lonDeg: number;
  };
  expectedWindow: FamilyMatrixWindow;
  familyCenterAzDeg?: number | null;
  eastboundFamily?: boolean;
  targetOrbit?: FamilyMatrixTargetOrbit | null;
  selection: FamilyMatrixSelection;
  observers: FamilyMatrixObserver[];
};

export type FamilyMatrixFixture = {
  schemaVersion: number;
  seed?: string;
  notes?: string;
  cases: FamilyMatrixCase[];
};

export type FamilyMatrixPolicy = {
  policyVersion: string;
  updatedAt: string;
  requiredObserverIds: string[];
  requiredTimeSamplesSec: number[];
  capeEastboundObserverIds: string[];
  capeEastboundEarlyTimeSamplesSec: number[];
  maxFlightAzimuthErrorDeg: number;
  maxInclinationBranchCenterOffsetDeg: number;
  maxCapeEastboundPadBearingDivergenceDeg: number;
  maxCrossSurfaceDivergenceDeg: number;
  topConfidenceBadges: string[];
};

export type FamilyMatrixCheck = {
  id: string;
  label: string;
  status: 'pass' | 'fail';
  value: number | string | null;
  threshold: string;
  details?: string;
};

export type FamilyMatrixReport = {
  generatedAt: string;
  fixtureSeed: string | null;
  fixtureCaseCount: number;
  policyVersion: string;
  pass: boolean;
  checks: FamilyMatrixCheck[];
  cases: Array<{
    id: string;
    label: string;
    pass: boolean;
    checks: FamilyMatrixCheck[];
  }>;
};

export type ObserverReplayRow = {
  caseId: string;
  caseLabel: string;
  familyId: string;
  observerId: string;
  observerLabel: string;
  tPlusSec: number;
  azDeg: number;
  elDeg: number;
  padBearingDeg: number;
  padDeltaDeg: number;
  exceedsEastboundGuard: boolean;
};

function wrapAzDeg(value: number) {
  return ((value % 360) + 360) % 360;
}

function angularDiffDeg(aDeg: number, bDeg: number) {
  return Math.abs(normalizeAngleDelta(aDeg - bDeg));
}

function withinAzWindow(azDeg: number, window: FamilyMatrixWindow) {
  const az = wrapAzDeg(azDeg);
  const min = wrapAzDeg(window.minAzDeg);
  const max = wrapAzDeg(window.maxAzDeg);
  if (min <= max) return az >= min && az <= max;
  return az >= min || az <= max;
}

function azWindowCenterDeg(window: FamilyMatrixWindow) {
  const span = normalizeAngleDelta(window.maxAzDeg - window.minAzDeg);
  return wrapAzDeg(window.minAzDeg + span / 2);
}

export function deriveInclinationAzimuthCandidates(inclinationDeg: number, padLatDeg: number) {
  if (!Number.isFinite(inclinationDeg) || !Number.isFinite(padLatDeg) || inclinationDeg <= 0 || inclinationDeg >= 180) {
    return null;
  }
  const ratio = Math.cos((inclinationDeg * Math.PI) / 180) / Math.cos((padLatDeg * Math.PI) / 180);
  if (!Number.isFinite(ratio) || Math.abs(ratio) > 1) return null;
  const primary = (Math.asin(Math.max(-1, Math.min(1, ratio))) * 180) / Math.PI;
  const candidateA = wrapAzDeg(primary);
  const candidateB = wrapAzDeg(180 - primary);
  return [candidateA, candidateB] as const;
}

function buildCheck({
  id,
  label,
  pass,
  value,
  threshold,
  details
}: {
  id: string;
  label: string;
  pass: boolean;
  value: number | string | null;
  threshold: string;
  details?: string;
}): FamilyMatrixCheck {
  return {
    id,
    label,
    status: pass ? 'pass' : 'fail',
    value,
    threshold,
    details
  };
}

function findObserver(caseRow: FamilyMatrixCase, observerId: string) {
  return caseRow.observers.find((observer) => observer.id === observerId) ?? null;
}

function findSample(observer: FamilyMatrixObserver, tPlusSec: number) {
  return observer.samples.find((sample) => sample.tPlusSec === tPlusSec) ?? null;
}

export function buildObserverReplayRows(
  fixture: FamilyMatrixFixture,
  policy: Pick<FamilyMatrixPolicy, 'capeEastboundEarlyTimeSamplesSec' | 'maxCapeEastboundPadBearingDivergenceDeg'>
): ObserverReplayRow[] {
  const rows: ObserverReplayRow[] = [];
  const cases = Array.isArray(fixture.cases) ? fixture.cases : [];

  for (const caseRow of cases) {
    const eastboundFamily = caseRow.eastboundFamily === true;
    for (const observer of caseRow.observers) {
      for (const sample of observer.samples) {
        const padDeltaDeg = angularDiffDeg(sample.azDeg, observer.padBearingDeg);
        const exceedsEastboundGuard =
          eastboundFamily &&
          policy.capeEastboundEarlyTimeSamplesSec.includes(sample.tPlusSec) &&
          padDeltaDeg > policy.maxCapeEastboundPadBearingDivergenceDeg;
        rows.push({
          caseId: caseRow.id,
          caseLabel: caseRow.label,
          familyId: caseRow.familyId,
          observerId: observer.id,
          observerLabel: observer.label ?? observer.id,
          tPlusSec: sample.tPlusSec,
          azDeg: sample.azDeg,
          elDeg: sample.elDeg,
          padBearingDeg: observer.padBearingDeg,
          padDeltaDeg,
          exceedsEastboundGuard
        });
      }
    }
  }

  return rows.sort((a, b) => {
    if (a.caseId !== b.caseId) return a.caseId.localeCompare(b.caseId);
    if (a.observerId !== b.observerId) return a.observerId.localeCompare(b.observerId);
    return a.tPlusSec - b.tPlusSec;
  });
}

export function evaluateFamilyMatrix(fixture: FamilyMatrixFixture, policy: FamilyMatrixPolicy): FamilyMatrixReport {
  const globalChecks: FamilyMatrixCheck[] = [];
  const caseReports: FamilyMatrixReport['cases'] = [];
  const cases = Array.isArray(fixture.cases) ? fixture.cases : [];

  for (const caseRow of cases) {
    const checks: FamilyMatrixCheck[] = [];
    const casePrefix = `case.${caseRow.id}`;
    const targetOrbit = caseRow.targetOrbit ?? {};
    const selectedAzimuthDeg = wrapAzDeg(caseRow.selection.selectedAzimuthDeg);
    const familyCenterAzDeg =
      typeof caseRow.familyCenterAzDeg === 'number' && Number.isFinite(caseRow.familyCenterAzDeg)
        ? wrapAzDeg(caseRow.familyCenterAzDeg)
        : azWindowCenterDeg(caseRow.expectedWindow);

    checks.push(
      buildCheck({
        id: `${casePrefix}.window`,
        label: `${caseRow.label} selected azimuth inside family window`,
        pass: withinAzWindow(selectedAzimuthDeg, caseRow.expectedWindow),
        value: selectedAzimuthDeg,
        threshold: `${caseRow.expectedWindow.minAzDeg}-${caseRow.expectedWindow.maxAzDeg}`
      })
    );

    if (typeof targetOrbit.flightAzimuthDeg === 'number' && Number.isFinite(targetOrbit.flightAzimuthDeg)) {
      const errorDeg = angularDiffDeg(selectedAzimuthDeg, targetOrbit.flightAzimuthDeg);
      checks.push(
        buildCheck({
          id: `${casePrefix}.flight_azimuth`,
          label: `${caseRow.label} selected azimuth matches flight azimuth`,
          pass: errorDeg <= policy.maxFlightAzimuthErrorDeg,
          value: errorDeg,
          threshold: `<= ${policy.maxFlightAzimuthErrorDeg}`
        })
      );
    }

    if (
      caseRow.selection.directionSource === 'inclination_derived' &&
      typeof targetOrbit.inclinationDeg === 'number' &&
      Number.isFinite(targetOrbit.inclinationDeg)
    ) {
      const candidates = deriveInclinationAzimuthCandidates(targetOrbit.inclinationDeg, caseRow.pad.latDeg);
      if (!candidates) {
        checks.push(
          buildCheck({
            id: `${casePrefix}.inclination_candidates`,
            label: `${caseRow.label} inclination candidates available`,
            pass: false,
            value: 'missing',
            threshold: 'computed'
          })
        );
      } else {
        const [candidateA, candidateB] = candidates;
        const selectedCandidate =
          angularDiffDeg(selectedAzimuthDeg, candidateA) <= angularDiffDeg(selectedAzimuthDeg, candidateB) ? candidateA : candidateB;
        const alternateCandidate = selectedCandidate === candidateA ? candidateB : candidateA;
        const selectedErrorDeg = angularDiffDeg(selectedAzimuthDeg, selectedCandidate);
        checks.push(
          buildCheck({
            id: `${casePrefix}.inclination_branch`,
            label: `${caseRow.label} selected azimuth matches a derived branch`,
            pass: selectedErrorDeg <= policy.maxFlightAzimuthErrorDeg,
            value: selectedErrorDeg,
            threshold: `<= ${policy.maxFlightAzimuthErrorDeg}`,
            details: `candidates=${candidateA.toFixed(1)}, ${candidateB.toFixed(1)}`
          })
        );

        if (typeof caseRow.selection.alternateAzimuthDeg === 'number' && Number.isFinite(caseRow.selection.alternateAzimuthDeg)) {
          const alternateErrorDeg = angularDiffDeg(caseRow.selection.alternateAzimuthDeg, alternateCandidate);
          checks.push(
            buildCheck({
              id: `${casePrefix}.inclination_alternate`,
              label: `${caseRow.label} alternate branch matches the non-selected candidate`,
              pass: alternateErrorDeg <= policy.maxFlightAzimuthErrorDeg,
              value: alternateErrorDeg,
              threshold: `<= ${policy.maxFlightAzimuthErrorDeg}`
            })
          );
        }

        const centerErrorDeg = angularDiffDeg(selectedAzimuthDeg, familyCenterAzDeg);
        checks.push(
          buildCheck({
            id: `${casePrefix}.family_center`,
            label: `${caseRow.label} selected azimuth stays near family center`,
            pass: centerErrorDeg <= policy.maxInclinationBranchCenterOffsetDeg,
            value: centerErrorDeg,
            threshold: `<= ${policy.maxInclinationBranchCenterOffsetDeg}`
          })
        );
      }
    }

    for (const observerId of policy.requiredObserverIds) {
      const observer = findObserver(caseRow, observerId);
      checks.push(
        buildCheck({
          id: `${casePrefix}.observer.${observerId}.present`,
          label: `${caseRow.label} observer ${observerId} present`,
          pass: Boolean(observer),
          value: observer ? 'yes' : 'no',
          threshold: 'yes'
        })
      );
      if (!observer) continue;

      for (const tPlusSec of policy.requiredTimeSamplesSec) {
        const sample = findSample(observer, tPlusSec);
        checks.push(
          buildCheck({
            id: `${casePrefix}.observer.${observerId}.t${tPlusSec}`,
            label: `${caseRow.label} observer ${observerId} sample at T${tPlusSec >= 0 ? '+' : ''}${tPlusSec}`,
            pass: Boolean(sample),
            value: sample ? 'yes' : 'no',
            threshold: 'yes'
          })
        );
      }
    }

    if (caseRow.eastboundFamily === true) {
      for (const observerId of policy.capeEastboundObserverIds) {
        const observer = findObserver(caseRow, observerId);
        if (!observer) continue;

        for (const tPlusSec of policy.capeEastboundEarlyTimeSamplesSec) {
          const sample = findSample(observer, tPlusSec);
          if (!sample) continue;
          const padDeltaDeg = angularDiffDeg(sample.azDeg, observer.padBearingDeg);
          checks.push(
            buildCheck({
              id: `${casePrefix}.observer.${observerId}.pad_delta_t${tPlusSec}`,
              label: `${caseRow.label} observer ${observerId} early ascent stays in plausible sector`,
              pass: padDeltaDeg <= policy.maxCapeEastboundPadBearingDivergenceDeg,
              value: padDeltaDeg,
              threshold: `<= ${policy.maxCapeEastboundPadBearingDivergenceDeg}`
            })
          );
        }
      }
    }

    if (caseRow.selection.directionSource === 'heuristic_only') {
      const badge = String(caseRow.selection.confidenceBadge ?? '').trim().toUpperCase();
      const qualityState = String(caseRow.selection.qualityState ?? '').trim().toLowerCase();
      const allowedQuality = qualityState === 'safe_corridor' || qualityState === 'pad_only';
      const allowedBadge = !policy.topConfidenceBadges.includes(badge);
      checks.push(
        buildCheck({
          id: `${casePrefix}.heuristic_quality`,
          label: `${caseRow.label} heuristic-only case avoids precision mode`,
          pass: allowedQuality,
          value: qualityState || 'missing',
          threshold: 'safe_corridor|pad_only'
        })
      );
      checks.push(
        buildCheck({
          id: `${casePrefix}.heuristic_badge`,
          label: `${caseRow.label} heuristic-only case avoids top confidence badge`,
          pass: allowedBadge,
          value: badge || 'missing',
          threshold: `not ${policy.topConfidenceBadges.join('|')}`
        })
      );
    }

    const casePass = checks.every((row) => row.status !== 'fail');
    caseReports.push({
      id: caseRow.id,
      label: caseRow.label,
      pass: casePass,
      checks
    });
    globalChecks.push(...checks);
  }

  const pass = globalChecks.every((row) => row.status !== 'fail');
  return {
    generatedAt: new Date().toISOString(),
    fixtureSeed: typeof fixture.seed === 'string' ? fixture.seed : null,
    fixtureCaseCount: cases.length,
    policyVersion: policy.policyVersion,
    pass,
    checks: globalChecks,
    cases: caseReports
  };
}
