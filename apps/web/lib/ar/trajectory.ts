import { normalizeAngleDelta } from '@/lib/ar/geo';

export type TrajectoryCovarianceDeg = {
  alongTrackDeg: number;
  crossTrackDeg: number;
};

export type TrajectoryUncertainty = {
  sigmaDeg?: number;
  covariance?: TrajectoryCovarianceDeg;
};

export type TrajectoryAzElPoint = {
  tPlusSec: number;
  azDeg: number;
  elDeg: number;
  sigmaDeg?: number;
  covariance?: TrajectoryCovarianceDeg;
  uncertainty?: TrajectoryUncertainty;
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function lerpAngleDeg(fromDeg: number, toDeg: number, f: number) {
  const delta = normalizeAngleDelta(toDeg - fromDeg);
  return (fromDeg + delta * f + 360) % 360;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function lerpMaybeNumber(a: number | null, b: number | null, f: number) {
  if (a != null && b != null) return a + (b - a) * f;
  if (a != null) return a;
  if (b != null) return b;
  return undefined;
}

export function normalizeTrajectoryCovariance(value: unknown): TrajectoryCovarianceDeg | undefined {
  const raw = asObject(value);
  if (!raw) return undefined;
  const alongRaw = raw.alongTrackDeg ?? raw.along_track;
  const crossRaw = raw.crossTrackDeg ?? raw.cross_track;
  const alongTrackDeg = Number(alongRaw);
  const crossTrackDeg = Number(crossRaw);
  if (!Number.isFinite(alongTrackDeg) || !Number.isFinite(crossTrackDeg)) return undefined;
  return { alongTrackDeg, crossTrackDeg };
}

export function normalizeTrajectoryUncertainty(value: unknown): TrajectoryUncertainty | undefined {
  const raw = asObject(value);
  if (!raw) return undefined;
  const sigmaRaw = raw.sigmaDeg;
  const sigmaDeg = typeof sigmaRaw === 'number' && Number.isFinite(sigmaRaw) ? sigmaRaw : undefined;
  const covariance = normalizeTrajectoryCovariance(raw.covariance);
  if (sigmaDeg == null && covariance == null) return undefined;
  return { sigmaDeg, covariance };
}

export function readTrajectoryPointSigmaDeg(point?: TrajectoryAzElPoint | null) {
  if (!point) return undefined;
  if (typeof point.sigmaDeg === 'number' && Number.isFinite(point.sigmaDeg)) return point.sigmaDeg;
  const sigmaFromUncertainty = point.uncertainty?.sigmaDeg;
  if (typeof sigmaFromUncertainty === 'number' && Number.isFinite(sigmaFromUncertainty)) return sigmaFromUncertainty;
  return undefined;
}

export function readTrajectoryPointCovariance(point?: TrajectoryAzElPoint | null): TrajectoryCovarianceDeg | undefined {
  if (!point) return undefined;
  return (
    normalizeTrajectoryCovariance(point.covariance) ??
    normalizeTrajectoryCovariance(point.uncertainty?.covariance)
  );
}

function withNormalizedUncertainty(point: TrajectoryAzElPoint): TrajectoryAzElPoint {
  const sigmaDeg = readTrajectoryPointSigmaDeg(point);
  const covariance = readTrajectoryPointCovariance(point);
  const uncertainty = sigmaDeg != null || covariance != null ? { sigmaDeg, covariance } : undefined;
  return {
    ...point,
    sigmaDeg,
    covariance,
    uncertainty
  };
}

export function interpolateTrajectory(points: TrajectoryAzElPoint[], tPlusSec: number): TrajectoryAzElPoint | null {
  if (!points.length) return null;
  const t = Math.max(0, tPlusSec);
  if (t <= points[0].tPlusSec) return withNormalizedUncertainty(points[0]);
  const last = points[points.length - 1];
  if (t >= last.tPlusSec) return withNormalizedUncertainty(last);

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (t < a.tPlusSec || t > b.tPlusSec) continue;
    const span = b.tPlusSec - a.tPlusSec;
    const f = span > 0 ? (t - a.tPlusSec) / span : 0;
    const sigmaA = readTrajectoryPointSigmaDeg(a) ?? null;
    const sigmaB = readTrajectoryPointSigmaDeg(b) ?? null;
    const sigmaDeg = lerpMaybeNumber(sigmaA, sigmaB, f);

    const covA = readTrajectoryPointCovariance(a);
    const covB = readTrajectoryPointCovariance(b);
    const alongTrackDeg = lerpMaybeNumber(covA?.alongTrackDeg ?? null, covB?.alongTrackDeg ?? null, f);
    const crossTrackDeg = lerpMaybeNumber(covA?.crossTrackDeg ?? null, covB?.crossTrackDeg ?? null, f);
    const covariance =
      alongTrackDeg != null && crossTrackDeg != null ? { alongTrackDeg, crossTrackDeg } : undefined;
    const uncertainty = sigmaDeg != null || covariance != null ? { sigmaDeg, covariance } : undefined;

    return {
      tPlusSec: t,
      azDeg: lerpAngleDeg(a.azDeg, b.azDeg, f),
      elDeg: a.elDeg + (b.elDeg - a.elDeg) * f,
      sigmaDeg,
      covariance,
      uncertainty
    };
  }

  return withNormalizedUncertainty(last);
}
