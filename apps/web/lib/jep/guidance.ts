import type { TrajectoryContract } from '@/lib/server/trajectoryContract';

const JEP_GUIDANCE_START_T_PLUS_SEC = 60;
const JEP_GUIDANCE_DEFAULT_END_T_PLUS_SEC = 600;
export const JEP_LOS_ELEVATION_THRESHOLD_DEG = 5;
export const JEP_TWILIGHT_SWEET_SPOT_MIN_DEG = 6;
export const JEP_TWILIGHT_SWEET_SPOT_MAX_DEG = 12;
const EARTH_RADIUS_KM = 6371;
const EARTH_RADIUS_M = 6378137;
const EARTH_FLATTENING = 1 / 298.257223563;
const SHADOW_H0_KM = 12;

export type JepGuidanceObserver = {
  latDeg: number;
  lonDeg: number;
};

export type JepBestWindow = {
  startTPlusSec: number;
  endTPlusSec: number;
  label: string;
  reason: string;
};

export type JepDirectionBand = {
  fromAzDeg: number;
  toAzDeg: number;
  label: string;
};

export type JepElevationBand = {
  minDeg: number;
  maxDeg: number;
  label: string;
};

export type JepScenarioWindow = {
  offsetMinutes: number;
  score: number;
  delta: number;
  trend: 'better' | 'similar' | 'worse';
  label: string;
};

export type JepSolarWindowRange = {
  netDeg: number | null;
  windowStartDeg: number | null;
  windowEndDeg: number | null;
  minDeg: number | null;
  maxDeg: number | null;
  crossesTwilightSweetSpot: boolean;
};

type GuidanceSample = {
  tPlusSec: number;
  latDeg: number;
  lonDeg: number;
  altM: number;
  azDeg: number;
  elDeg: number;
  visible: boolean;
  sunlit: boolean;
};

export type JepGuidanceTrackSample = GuidanceSample;

export function deriveJepGuidanceTrackSamples({
  trajectory,
  observer,
  launchNetIso
}: {
  trajectory: TrajectoryContract | null;
  observer: JepGuidanceObserver | null;
  launchNetIso: string | null;
}): JepGuidanceTrackSample[] {
  if (!trajectory || !observer) return [];

  const coreTrack = trajectory.tracks.find((track) => track.trackKind === 'core_up') ?? trajectory.tracks[0] ?? null;
  if (!coreTrack || coreTrack.samples.length === 0) return [];

  const launchDate = launchNetIso ? new Date(launchNetIso) : null;
  const solarDepressionDeg = launchDate ? solarDepressionDegrees(observer.latDeg, observer.lonDeg, launchDate) : null;
  const shadowHeightKm = solarDepressionDeg != null ? computeShadowHeightKm(solarDepressionDeg) : null;
  const endTPlusSec = resolveJellyfishEndSeconds(coreTrack.samples, trajectory.milestones);

  return coreTrack.samples
    .map((sample) => {
      const position = ecefToGeodetic(sample.ecef[0], sample.ecef[1], sample.ecef[2]);
      const elevationDeg = elevationFromObserverDeg({
        observerLatDeg: observer.latDeg,
        observerLonDeg: observer.lonDeg,
        targetLatDeg: position.latDeg,
        targetLonDeg: position.lonDeg,
        targetAltM: position.altM
      });
      const azimuthDeg = bearingDeg(observer.latDeg, observer.lonDeg, position.latDeg, position.lonDeg);
      const altKm = position.altM / 1000;
      const sunlit = shadowHeightKm != null ? altKm > shadowHeightKm : false;
      const visible = sunlit && Number.isFinite(elevationDeg) && elevationDeg >= JEP_LOS_ELEVATION_THRESHOLD_DEG;
      return {
        tPlusSec: sample.tPlusSec,
        latDeg: position.latDeg,
        lonDeg: position.lonDeg,
        altM: position.altM,
        azDeg: azimuthDeg,
        elDeg: elevationDeg,
        visible,
        sunlit
      } satisfies GuidanceSample;
    })
    .filter((sample) => sample.tPlusSec >= JEP_GUIDANCE_START_T_PLUS_SEC && sample.tPlusSec <= endTPlusSec);
}

export function deriveJepSolarWindowRange({
  observer,
  launchNetIso,
  launchWindowStartIso,
  launchWindowEndIso
}: {
  observer: JepGuidanceObserver | null;
  launchNetIso: string | null;
  launchWindowStartIso: string | null;
  launchWindowEndIso: string | null;
}): JepSolarWindowRange | null {
  if (!observer) return null;

  const netDeg = resolveSolarDepressionForIso(observer, launchNetIso);
  const windowStartDeg = resolveSolarDepressionForIso(observer, launchWindowStartIso ?? launchNetIso);
  const windowEndDeg = resolveSolarDepressionForIso(observer, launchWindowEndIso ?? launchWindowStartIso ?? launchNetIso);
  const finiteValues = [windowStartDeg, windowEndDeg, netDeg].filter((value): value is number => Number.isFinite(value));

  if (finiteValues.length === 0) return null;

  const minDeg = round(Math.min(...finiteValues), 1);
  const maxDeg = round(Math.max(...finiteValues), 1);
  return {
    netDeg: netDeg != null ? round(netDeg, 1) : null,
    windowStartDeg: windowStartDeg != null ? round(windowStartDeg, 1) : null,
    windowEndDeg: windowEndDeg != null ? round(windowEndDeg, 1) : null,
    minDeg,
    maxDeg,
    crossesTwilightSweetSpot: minDeg <= JEP_TWILIGHT_SWEET_SPOT_MAX_DEG && maxDeg >= JEP_TWILIGHT_SWEET_SPOT_MIN_DEG
  };
}

export function deriveJepGuidance({
  trajectory,
  observer,
  launchNetIso,
  currentScore,
  lineOfSightFactor,
  weatherFactor
}: {
  trajectory: TrajectoryContract | null;
  observer: JepGuidanceObserver | null;
  launchNetIso: string | null;
  currentScore: number;
  lineOfSightFactor: number;
  weatherFactor: number;
}): {
  bestWindow: JepBestWindow | null;
  directionBand: JepDirectionBand | null;
  elevationBand: JepElevationBand | null;
  scenarioWindows: JepScenarioWindow[];
} {
  if (!trajectory || !observer) {
    return {
      bestWindow: null,
      directionBand: null,
      elevationBand: null,
      scenarioWindows: []
    };
  }

  const samples = deriveJepGuidanceTrackSamples({
    trajectory,
    observer,
    launchNetIso
  });
  if (samples.length === 0) {
    return {
      bestWindow: null,
      directionBand: null,
      elevationBand: null,
      scenarioWindows: []
    };
  }

  const launchDate = launchNetIso ? new Date(launchNetIso) : null;
  const visibleSamples = samples.filter((sample) => sample.visible);
  const sunlitSamples = samples.filter((sample) => sample.sunlit);
  const bandSamples = visibleSamples.length > 0 ? visibleSamples : sunlitSamples.length > 0 ? sunlitSamples : samples;
  const bestWindow = deriveBestWindow(visibleSamples, samples);
  const directionBand = deriveDirectionBand(bandSamples);
  const elevationBand = deriveElevationBand(bandSamples);
  const scenarioWindows =
    launchDate == null
      ? []
      : [15, 30, 45].map((offsetMinutes) =>
          deriveScenarioWindow({
            baseDate: launchDate,
            offsetMinutes,
            observer,
            samples,
            currentScore,
            lineOfSightFactor,
            weatherFactor
          })
        );

  return {
    bestWindow,
    directionBand,
    elevationBand,
    scenarioWindows
  };
}

function deriveBestWindow(visibleSamples: GuidanceSample[], allSamples: GuidanceSample[]): JepBestWindow | null {
  if (visibleSamples.length === 0) {
    if (allSamples.length === 0) return null;
    const peakIndex = allSamples.reduce((bestIndex, sample, index, items) => {
      const best = items[bestIndex];
      return sample.elDeg > (best?.elDeg ?? Number.NEGATIVE_INFINITY) ? index : bestIndex;
    }, 0);
    const start = allSamples[Math.max(0, peakIndex - 1)] ?? allSamples[peakIndex]!;
    const end = allSamples[Math.min(allSamples.length - 1, peakIndex + 1)] ?? allSamples[peakIndex]!;
    return {
      startTPlusSec: Math.round(start.tPlusSec),
      endTPlusSec: Math.round(end.tPlusSec),
      label: formatTPlusRange(Math.round(start.tPlusSec), Math.round(end.tPlusSec)),
      reason: 'Best modeled look angle from your observer. Visibility may still be limited by low elevation or twilight timing.'
    };
  }

  const samples = visibleSamples;
  const groups: GuidanceSample[][] = [];
  let current: GuidanceSample[] = [];
  for (const sample of samples) {
    const previous = current[current.length - 1];
    if (previous && sample.tPlusSec - previous.tPlusSec > 45) {
      groups.push(current);
      current = [];
    }
    current.push(sample);
  }
  if (current.length > 0) groups.push(current);

  const bestGroup = groups.slice(1).reduce((best, group) => {
    const bestPeak = Math.max(...best.map((sample) => sample.elDeg));
    const groupPeak = Math.max(...group.map((sample) => sample.elDeg));
    const bestSpan = (best[best.length - 1]?.tPlusSec ?? 0) - (best[0]?.tPlusSec ?? 0);
    const groupSpan = (group[group.length - 1]?.tPlusSec ?? 0) - (group[0]?.tPlusSec ?? 0);
    if (groupPeak > bestPeak + 1) return group;
    if (Math.abs(groupPeak - bestPeak) <= 1 && groupSpan > bestSpan) return group;
    return best;
  }, groups[0]!);

  const startTPlusSec = Math.round(bestGroup[0]?.tPlusSec ?? 0);
  const endTPlusSec = Math.round(bestGroup[bestGroup.length - 1]?.tPlusSec ?? startTPlusSec);
  const peakElevation = Math.max(...bestGroup.map((sample) => sample.elDeg));
  return {
    startTPlusSec,
    endTPlusSec,
    label: formatTPlusRange(startTPlusSec, endTPlusSec),
    reason:
      peakElevation >= 20
        ? 'Best overlap of sunlit plume and strong above-horizon geometry.'
        : 'Best overlap of sunlit plume and limited above-horizon geometry.'
  };
}

function deriveDirectionBand(samples: GuidanceSample[]): JepDirectionBand | null {
  if (samples.length === 0) return null;
  const arc = shortestCircularArc(samples.map((sample) => sample.azDeg));
  return {
    fromAzDeg: round(arc.startDeg, 1),
    toAzDeg: round(arc.endDeg, 1),
    label:
      Math.abs(normalizeAngleDelta(arc.endDeg - arc.startDeg)) < 6
        ? azimuthToCardinal(arc.startDeg)
        : `${azimuthToCardinal(arc.startDeg)} to ${azimuthToCardinal(arc.endDeg)}`
  };
}

function deriveElevationBand(samples: GuidanceSample[]): JepElevationBand | null {
  if (samples.length === 0) return null;
  const finiteElevations = samples.map((sample) => sample.elDeg).filter((value) => Number.isFinite(value));
  if (finiteElevations.length === 0) return null;
  const minDeg = round(Math.max(0, Math.min(...finiteElevations)), 1);
  const maxDeg = round(Math.max(minDeg, Math.max(...finiteElevations)), 1);
  return {
    minDeg,
    maxDeg,
    label: `${formatAngle(minDeg)} to ${formatAngle(maxDeg)}`
  };
}

function deriveScenarioWindow({
  baseDate,
  offsetMinutes,
  observer,
  samples,
  currentScore,
  lineOfSightFactor,
  weatherFactor
}: {
  baseDate: Date;
  offsetMinutes: number;
  observer: JepGuidanceObserver;
  samples: GuidanceSample[];
  currentScore: number;
  lineOfSightFactor: number;
  weatherFactor: number;
}): JepScenarioWindow {
  const shiftedDate = new Date(baseDate.getTime() + offsetMinutes * 60_000);
  const solarDepressionDeg = solarDepressionDegrees(observer.latDeg, observer.lonDeg, shiftedDate);
  const illuminationFactor = computeIlluminationFactor(samples, solarDepressionDeg);
  const darknessFactor = computeDarknessFactor(solarDepressionDeg);
  const score = clampInt(Math.round(illuminationFactor * darknessFactor * lineOfSightFactor * weatherFactor * 100), 0, 100);
  const delta = score - currentScore;
  const trend: JepScenarioWindow['trend'] = delta >= 8 ? 'better' : delta <= -8 ? 'worse' : 'similar';
  return {
    offsetMinutes,
    score,
    delta,
    trend,
    label: `${offsetMinutes > 0 ? '+' : ''}${offsetMinutes} min`
  };
}

function resolveSolarDepressionForIso(observer: JepGuidanceObserver, isoValue: string | null) {
  if (!isoValue) return null;
  const date = new Date(isoValue);
  if (!Number.isFinite(date.getTime())) return null;
  return solarDepressionDegrees(observer.latDeg, observer.lonDeg, date);
}

function computeIlluminationFactor(samples: GuidanceSample[], solarDepressionDeg: number) {
  const shadowHeightKm = computeShadowHeightKm(solarDepressionDeg);
  let litWeight = 0;
  let totalWeight = 0;
  for (const sample of samples) {
    const weight = sample.tPlusSec >= 150 && sample.tPlusSec <= 300 ? 2 : 1;
    totalWeight += weight;
    if (sample.altM / 1000 > shadowHeightKm) litWeight += weight;
  }
  if (totalWeight <= 0) return 0;
  return clamp(litWeight / totalWeight, 0, 1);
}

function computeDarknessFactor(depressionDeg: number) {
  if (depressionDeg > 18) return 0.1;
  if (depressionDeg >= 12 && depressionDeg <= 18) return 0.6;
  if (depressionDeg >= JEP_TWILIGHT_SWEET_SPOT_MIN_DEG && depressionDeg < JEP_TWILIGHT_SWEET_SPOT_MAX_DEG) return 1;
  if (depressionDeg >= 3 && depressionDeg < 6) return 0.8;
  if (depressionDeg >= 0 && depressionDeg < 3) return 0.3;
  return 0;
}

function resolveJellyfishEndSeconds(
  samples: TrajectoryContract['tracks'][number]['samples'],
  milestones: TrajectoryContract['milestones']
) {
  const seco = milestones.find((milestone) => {
    const label = `${milestone.key} ${milestone.label}`.toLowerCase();
    return label.includes('seco') && typeof milestone.tPlusSec === 'number' && Number.isFinite(milestone.tPlusSec);
  });
  if (seco && typeof seco.tPlusSec === 'number') return clampInt(seco.tPlusSec, 120, 1200);
  const maxTPlusSec = samples.reduce((max, sample) => Math.max(max, sample.tPlusSec), JEP_GUIDANCE_DEFAULT_END_T_PLUS_SEC);
  return clampInt(maxTPlusSec, 180, 1200);
}

function computeShadowHeightKm(solarDepressionDeg: number) {
  const gammaDeg = Math.max(0, solarDepressionDeg);
  const gammaRad = (gammaDeg * Math.PI) / 180;
  const cosGamma = Math.cos(gammaRad);
  if (!Number.isFinite(cosGamma) || Math.abs(cosGamma) < 1e-6) return Number.POSITIVE_INFINITY;
  return (EARTH_RADIUS_KM + SHADOW_H0_KM) / cosGamma - EARTH_RADIUS_KM;
}

function solarDepressionDegrees(latDeg: number, lonDeg: number, date: Date) {
  const dayOfYear = getDayOfYearUtc(date);
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (hours - 12) / 24);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const trueSolarMinutes =
    date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60 + (eqTime + 4 * lonDeg);
  const hourAngleRad = ((trueSolarMinutes / 4 - 180) * Math.PI) / 180;
  const latRad = (latDeg * Math.PI) / 180;
  const cosZenith = clamp(
    Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngleRad),
    -1,
    1
  );
  const zenithDeg = (Math.acos(cosZenith) * 180) / Math.PI;
  return -(90 - zenithDeg);
}

function getDayOfYearUtc(date: Date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const now = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((now - start) / 86_400_000) + 1;
}

function ecefToGeodetic(x: number, y: number, z: number) {
  const eccentricitySq = EARTH_FLATTENING * (2 - EARTH_FLATTENING);
  const polarRadiusM = EARTH_RADIUS_M * (1 - EARTH_FLATTENING);
  const secondaryEccentricitySq =
    (EARTH_RADIUS_M * EARTH_RADIUS_M - polarRadiusM * polarRadiusM) / (polarRadiusM * polarRadiusM);
  const p = Math.sqrt(x * x + y * y);
  const theta = Math.atan2(z * EARTH_RADIUS_M, p * polarRadiusM);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);
  const lon = Math.atan2(y, x);
  const lat = Math.atan2(
    z + secondaryEccentricitySq * polarRadiusM * sinTheta * sinTheta * sinTheta,
    p - eccentricitySq * EARTH_RADIUS_M * cosTheta * cosTheta * cosTheta
  );
  const sinLat = Math.sin(lat);
  const radiusOfCurvature = EARTH_RADIUS_M / Math.sqrt(1 - eccentricitySq * sinLat * sinLat);
  const altM = p / Math.cos(lat) - radiusOfCurvature;
  return {
    latDeg: (lat * 180) / Math.PI,
    lonDeg: wrapLon((lon * 180) / Math.PI),
    altM
  };
}

function ecefFromLatLon(latDeg: number, lonDeg: number, altMeters = 0) {
  const eccentricitySq = EARTH_FLATTENING * (2 - EARTH_FLATTENING);
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const n = EARTH_RADIUS_M / Math.sqrt(1 - eccentricitySq * sinLat * sinLat);
  return [
    (n + altMeters) * cosLat * cosLon,
    (n + altMeters) * cosLat * sinLon,
    (n * (1 - eccentricitySq) + altMeters) * sinLat
  ] as const;
}

function elevationFromObserverDeg({
  observerLatDeg,
  observerLonDeg,
  targetLatDeg,
  targetLonDeg,
  targetAltM
}: {
  observerLatDeg: number;
  observerLonDeg: number;
  targetLatDeg: number;
  targetLonDeg: number;
  targetAltM: number;
}) {
  const [ox, oy, oz] = ecefFromLatLon(observerLatDeg, observerLonDeg, 0);
  const [tx, ty, tz] = ecefFromLatLon(targetLatDeg, targetLonDeg, targetAltM);
  const dx = tx - ox;
  const dy = ty - oy;
  const dz = tz - oz;
  const lat = (observerLatDeg * Math.PI) / 180;
  const lon = (observerLonDeg * Math.PI) / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const east = -sinLon * dx + cosLon * dy;
  const north = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
  const up = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;
  return (Math.atan2(up, Math.sqrt(east * east + north * north)) * 180) / Math.PI;
}

function bearingDeg(fromLatDeg: number, fromLonDeg: number, toLatDeg: number, toLonDeg: number) {
  const lat1 = (fromLatDeg * Math.PI) / 180;
  const lat2 = (toLatDeg * Math.PI) / 180;
  const dLon = ((toLonDeg - fromLonDeg) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return wrap360((Math.atan2(y, x) * 180) / Math.PI);
}

function shortestCircularArc(anglesDeg: number[]) {
  const sorted = anglesDeg.map((value) => wrap360(value)).sort((a, b) => a - b);
  if (sorted.length === 1) {
    return { startDeg: sorted[0] ?? 0, endDeg: sorted[0] ?? 0 };
  }

  let largestGap = -1;
  let largestGapIndex = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index] ?? 0;
    const next = index === sorted.length - 1 ? (sorted[0] ?? 0) + 360 : (sorted[index + 1] ?? 0);
    const gap = next - current;
    if (gap > largestGap) {
      largestGap = gap;
      largestGapIndex = index;
    }
  }

  const startDeg = sorted[(largestGapIndex + 1) % sorted.length] ?? 0;
  const endDeg = sorted[largestGapIndex] ?? startDeg;
  return { startDeg, endDeg };
}

function azimuthToCardinal(azDeg: number) {
  const labels = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(wrap360(azDeg) / 22.5) % labels.length;
  return labels[index] ?? 'N';
}

function normalizeAngleDelta(deg: number) {
  let value = ((deg + 180) % 360 + 360) % 360 - 180;
  if (value === -180) value = 180;
  return value;
}

function formatTPlusRange(startTPlusSec: number, endTPlusSec: number) {
  const start = Math.round(startTPlusSec);
  const end = Math.round(endTPlusSec);
  if (Math.abs(end - start) <= 5) return `T+${start}s`;
  return `T+${start}s to T+${end}s`;
}

function formatAngle(value: number) {
  return `${Math.round(value)}°`;
}

function wrap360(value: number) {
  return ((value % 360) + 360) % 360;
}

function wrapLon(value: number) {
  let lon = ((value + 180) % 360 + 360) % 360 - 180;
  if (lon === -180) lon = 180;
  return lon;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number) {
  return Math.round(clamp(value, min, max));
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
