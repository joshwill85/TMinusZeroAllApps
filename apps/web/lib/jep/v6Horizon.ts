export const JEP_V6_HORIZON_FEATURE_FAMILY = 'local_horizon';
export const DEFAULT_JEP_V6_HORIZON_CORRIDOR_HALF_WIDTH_DEG = 2.5;

export type JepV6HorizonMaskProfiles = {
  azimuthStepDeg: number | null;
  terrainMaskProfile: Array<number | null>;
  buildingMaskProfile: Array<number | null>;
  totalMaskProfile: Array<number | null>;
  dominantSourceProfile: Array<string | null>;
  dominantDistanceMProfile: Array<number | null>;
};

export type JepV6HorizonCorridorMask = {
  corridorStartAzimuthDeg: number;
  corridorEndAzimuthDeg: number;
  corridorHalfWidthDeg: number;
  terrainMaskElDeg: number | null;
  buildingMaskElDeg: number | null;
  totalMaskElDeg: number | null;
  dominantSource: string | null;
  dominantDistanceM: number | null;
  samplesConsidered: number;
};

export function computeJepV6LocalHorizonFactor(clearanceDeg: number | null) {
  const value = sanitizeNumber(clearanceDeg);
  if (value == null) return null;
  return interpolateFromStops(value, [
    [0, 0],
    [1, 0.2],
    [3, 0.6],
    [8, 1]
  ]);
}

export function summarizeJepV6HorizonCorridor({
  representativeAzimuthDeg,
  azimuthSpreadDeg,
  corridorHalfWidthDeg = DEFAULT_JEP_V6_HORIZON_CORRIDOR_HALF_WIDTH_DEG,
  profiles
}: {
  representativeAzimuthDeg: number | null;
  azimuthSpreadDeg?: number | null;
  corridorHalfWidthDeg?: number;
  profiles: JepV6HorizonMaskProfiles;
}): JepV6HorizonCorridorMask | null {
  const azimuth = sanitizeNumber(representativeAzimuthDeg);
  const stepDeg = sanitizeNumber(profiles.azimuthStepDeg);
  if (azimuth == null || stepDeg == null || stepDeg <= 0) return null;

  const profileLength = maxProfileLength([
    profiles.terrainMaskProfile,
    profiles.buildingMaskProfile,
    profiles.totalMaskProfile,
    profiles.dominantSourceProfile,
    profiles.dominantDistanceMProfile
  ]);
  if (profileLength <= 0) return null;

  const effectiveHalfWidth = clamp(
    Math.max(sanitizeNumber(azimuthSpreadDeg) ?? 0, corridorHalfWidthDeg),
    stepDeg / 2,
    45
  );
  const startAzimuth = normalizeAzimuthDeg(azimuth - effectiveHalfWidth);
  const endAzimuth = normalizeAzimuthDeg(azimuth + effectiveHalfWidth);

  let terrainMaskElDeg: number | null = null;
  let buildingMaskElDeg: number | null = null;
  let totalMaskElDeg: number | null = null;
  let dominantSource: string | null = null;
  let dominantDistanceM: number | null = null;
  let samplesConsidered = 0;

  for (let index = 0; index < profileLength; index += 1) {
    const binAzimuth = normalizeAzimuthDeg(index * stepDeg);
    if (!isAzimuthInWrappedRange(binAzimuth, startAzimuth, endAzimuth)) continue;
    samplesConsidered += 1;

    const terrainValue = valueAt(profiles.terrainMaskProfile, index);
    const buildingValue = valueAt(profiles.buildingMaskProfile, index);
    const totalValue = valueAt(profiles.totalMaskProfile, index);
    const sourceValue = stringAt(profiles.dominantSourceProfile, index);
    const distanceValue = valueAt(profiles.dominantDistanceMProfile, index);

    terrainMaskElDeg = maxNullable(terrainMaskElDeg, terrainValue);
    buildingMaskElDeg = maxNullable(buildingMaskElDeg, buildingValue);
    if (totalMaskElDeg == null || (totalValue != null && totalValue > totalMaskElDeg)) {
      totalMaskElDeg = totalValue;
      dominantSource = sourceValue;
      dominantDistanceM = distanceValue;
    }
  }

  if (!samplesConsidered) return null;

  return {
    corridorStartAzimuthDeg: startAzimuth,
    corridorEndAzimuthDeg: endAzimuth,
    corridorHalfWidthDeg: effectiveHalfWidth,
    terrainMaskElDeg,
    buildingMaskElDeg,
    totalMaskElDeg,
    dominantSource,
    dominantDistanceM,
    samplesConsidered
  };
}

export function normalizeJepV6HorizonProfiles(input: {
  azimuthStepDeg: number | null;
  terrainMaskProfile: unknown;
  buildingMaskProfile: unknown;
  totalMaskProfile: unknown;
  dominantSourceProfile: unknown;
  dominantDistanceMProfile: unknown;
}): JepV6HorizonMaskProfiles {
  return {
    azimuthStepDeg: sanitizeNumber(input.azimuthStepDeg),
    terrainMaskProfile: numberArray(input.terrainMaskProfile),
    buildingMaskProfile: numberArray(input.buildingMaskProfile),
    totalMaskProfile: numberArray(input.totalMaskProfile),
    dominantSourceProfile: stringArray(input.dominantSourceProfile),
    dominantDistanceMProfile: numberArray(input.dominantDistanceMProfile)
  };
}

function maxProfileLength(profiles: unknown[]) {
  return profiles.reduce<number>((max, profile) => {
    const length = Array.isArray(profile) ? profile.length : 0;
    return Math.max(max, length);
  }, 0);
}

function numberArray(value: unknown) {
  return Array.isArray(value) ? value.map((entry) => sanitizeNumber(entry)) : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => {
        const normalized = typeof entry === 'string' ? entry.trim() : '';
        return normalized || null;
      })
    : [];
}

function valueAt(values: Array<number | null>, index: number) {
  return index >= 0 && index < values.length ? values[index] ?? null : null;
}

function stringAt(values: Array<string | null>, index: number) {
  return index >= 0 && index < values.length ? values[index] ?? null : null;
}

function interpolateFromStops(value: number, stops: Array<[number, number]>) {
  if (!stops.length) return null;
  if (value <= stops[0]![0]) return clamp(stops[0]![1], 0, 1);
  for (let index = 1; index < stops.length; index += 1) {
    const left = stops[index - 1]!;
    const right = stops[index]!;
    if (value <= right[0]) {
      return clamp(interpolate(value, left[0], right[0], left[1], right[1]), 0, 1);
    }
  }
  return clamp(stops[stops.length - 1]![1], 0, 1);
}

function interpolate(value: number, startX: number, endX: number, startY: number, endY: number) {
  if (value <= startX) return startY;
  if (value >= endX) return endY;
  if (endX <= startX) return endY;
  const t = (value - startX) / (endX - startX);
  return startY + (endY - startY) * t;
}

function sanitizeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim() && Number.isFinite(Number(value))
      ? Number(value)
      : null;
}

function maxNullable(left: number | null, right: number | null) {
  if (left == null) return right;
  if (right == null) return left;
  return Math.max(left, right);
}

function normalizeAzimuthDeg(value: number) {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function isAzimuthInWrappedRange(value: number, start: number, end: number) {
  if (start <= end) return value >= start && value <= end;
  return value >= start || value <= end;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
