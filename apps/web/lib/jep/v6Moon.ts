export const JEP_V6_MOON_FEATURE_FAMILY = 'background_contrast_moon';

export type JepV6MoonFactorResult = {
  factor: number | null;
  azimuthSeparationDeg: number | null;
  moonVisible: number | null;
  illuminationTerm: number | null;
  separationTerm: number | null;
  penalty: number | null;
};

export function computeJepV6MoonFactor({
  moonAzDeg,
  moonElDeg,
  moonIllumFrac,
  plumeAzimuthDeg
}: {
  moonAzDeg: number | null;
  moonElDeg: number | null;
  moonIllumFrac: number | null;
  plumeAzimuthDeg: number | null;
}): JepV6MoonFactorResult {
  if (
    !Number.isFinite(moonAzDeg) ||
    !Number.isFinite(moonElDeg) ||
    !Number.isFinite(moonIllumFrac) ||
    !Number.isFinite(plumeAzimuthDeg)
  ) {
    return {
      factor: null,
      azimuthSeparationDeg: null,
      moonVisible: null,
      illuminationTerm: null,
      separationTerm: null,
      penalty: null
    };
  }

  const normalizedIllumFrac = clamp(Number(moonIllumFrac), 0, 1);
  const azimuthSeparationDeg = angularSeparationDeg(Number(moonAzDeg), Number(plumeAzimuthDeg));
  const moonVisible = clamp(Math.sin((Math.max(0, Number(moonElDeg)) * Math.PI) / 180), 0, 1);
  const illuminationTerm = clamp(Math.sqrt(normalizedIllumFrac), 0, 1);
  const separationTerm = deriveMoonSeparationTerm(azimuthSeparationDeg);
  const penalty = clamp(0.85 * moonVisible * illuminationTerm * separationTerm, 0, 1);

  return {
    factor: clamp(1 - penalty, 0.15, 1),
    azimuthSeparationDeg,
    moonVisible,
    illuminationTerm,
    separationTerm,
    penalty
  };
}

export function circularMeanDeg(entries: Array<{ deg: number; weight?: number }>): number | null {
  let sinSum = 0;
  let cosSum = 0;
  let totalWeight = 0;

  for (const entry of entries) {
    const deg = Number(entry.deg);
    const weight = Number.isFinite(entry.weight) ? Number(entry.weight) : 1;
    if (!Number.isFinite(deg) || !Number.isFinite(weight) || weight <= 0) continue;
    const radians = (deg * Math.PI) / 180;
    sinSum += Math.sin(radians) * weight;
    cosSum += Math.cos(radians) * weight;
    totalWeight += weight;
  }

  if (!totalWeight) return null;
  const radians = Math.atan2(sinSum / totalWeight, cosSum / totalWeight);
  return normalizeAngleDeg((radians * 180) / Math.PI);
}

export function angularSeparationDeg(leftDeg: number, rightDeg: number) {
  const left = normalizeAngleDeg(leftDeg);
  const right = normalizeAngleDeg(rightDeg);
  const diff = Math.abs(left - right) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function deriveMoonSeparationTerm(separationDeg: number) {
  if (!Number.isFinite(separationDeg)) return 0.2;
  if (separationDeg < 20) return 1;
  if (separationDeg < 45) return 0.75;
  if (separationDeg < 90) return 0.45;
  return 0.2;
}

function normalizeAngleDeg(value: number) {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
