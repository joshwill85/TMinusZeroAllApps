import { computeJepV6BackgroundFactor } from './v6Background';
import { computeJepV6LocalHorizonFactor } from './v6Horizon';
import { type JepV6MissionProfileInput } from './v6VehiclePriors';

export const JEP_V6_SHADOW_SCORE_FAMILY = 'shadow_watchability_candidate';

export const JEP_V6_WATCHABILITY_WEIGHTS = {
  darkness: 18,
  shadowClearance: 14,
  overlap: 8,
  plumeElevation: 10,
  horizonClearance: 6,
  distance: 3,
  highCloud: 9,
  midCloud: 4,
  lowCloud: 4,
  haze: 3,
  missionProfile: 7,
  specialEvents: 5,
  windowTightness: 4,
  onTime: 2,
  background: 3
} as const;

export type JepV6RepresentativeCorridor = {
  mode: 'visible_path' | 'sunlit_path';
  representativeTPlusSec: number;
  representativeAzimuthDeg: number;
  representativeElevationDeg: number | null;
  representativeAltitudeM: number | null;
  representativeDownrangeKm: number | null;
  sampleCount: number;
  corridorStartTPlusSec: number;
  corridorEndTPlusSec: number;
  azimuthSpreadDeg: number | null;
};

export type JepV6BackgroundInput = {
  availability: string | null;
  source: 'combined' | 'moon_only' | 'neutral';
  sMoon: number | null;
  sAnthro: number | null;
  sBackground: number | null;
};

export type JepV6HorizonInput = {
  availability: string | null;
  source: 'local_mask' | 'neutral';
  terrainMaskElDeg: number | null;
  buildingMaskElDeg: number | null;
  totalMaskElDeg: number | null;
  clearanceDeg: number | null;
  factor: number | null;
  dominantSource: string | null;
  dominantDistanceM: number | null;
};

export type JepV6WeatherInput = {
  cloudCoverLowPct: number | null;
  cloudCoverMidPct: number | null;
  cloudCoverHighPct: number | null;
  obstructionFactor: number | null;
};

export type JepV6ShadowScoreInputs = {
  modelVersion: string;
  baselineModelVersion: string;
  baselineScore: number;
  solarDepressionDeg: number;
  illuminationFactor: number;
  sunlitMarginKm: number | null;
  losVisibleFraction: number;
  representativeCorridor: JepV6RepresentativeCorridor | null;
  background: JepV6BackgroundInput | null;
  horizon: JepV6HorizonInput | null;
  missionProfile: JepV6MissionProfileInput | null;
  weather: JepV6WeatherInput;
};

export type JepV6ShadowScoreResult = {
  modelVersion: string;
  gateOpen: boolean;
  rawScore: number;
  score: number;
  vismapModifier: number;
  factors: Record<string, unknown>;
  compatibility: Record<string, number>;
  availability: Record<string, unknown>;
  explainability: Record<string, unknown>;
};

export function computeJepV6ShadowScore(input: JepV6ShadowScoreInputs): JepV6ShadowScoreResult {
  const representativeCorridor = input.representativeCorridor;
  const corridorDurationSec = representativeCorridor
    ? Math.max(0, representativeCorridor.corridorEndTPlusSec - representativeCorridor.corridorStartTPlusSec)
    : 0;

  const sDarkness = computeContinuousDarknessFactor(input.solarDepressionDeg);
  const sShadowClearance = computeShadowClearanceFactor(input.sunlitMarginKm);
  const sOverlap =
    representativeCorridor?.mode === 'visible_path'
      ? weightedGeoNormalized([
          { factor: clamp(input.illuminationFactor, 0, 1), weight: 0.55 },
          { factor: computeCorridorDurationFactor(corridorDurationSec), weight: 0.45 }
        ])
      : 0;
  const sPlumeElevation = computePlumeElevationFactor(representativeCorridor?.representativeElevationDeg ?? null);
  const horizon = normalizeHorizonInput(input.horizon);
  const sHorizonClearance =
    representativeCorridor?.mode === 'visible_path' ? (horizon.usable && horizon.factor != null ? horizon.factor : 1) : 0;
  const sDistance = computeDistanceFactor(representativeCorridor?.representativeDownrangeKm ?? null);

  const highCloudFactor = computeHighCloudFactor(input.weather.cloudCoverHighPct);
  const midCloudFactor = computeMidCloudFactor(input.weather.cloudCoverMidPct);
  const lowCloudBaseFactor = computeLowCloudFactor(input.weather.cloudCoverLowPct);
  const obstructionFactor =
    input.weather.obstructionFactor != null && Number.isFinite(input.weather.obstructionFactor)
      ? clamp(input.weather.obstructionFactor, 0.08, 1)
      : 1;
  const lowCloudFactor = Math.min(lowCloudBaseFactor, obstructionFactor);
  const hazeFactor = 1;

  const background = normalizeBackgroundInput(input.background);
  const backgroundFactor =
    background.sBackground ??
    (background.sMoon != null ? computeJepV6BackgroundFactor({ sMoon: background.sMoon, sAnthro: background.sAnthro ?? 1 }) : 1) ??
    1;
  const missionProfile = normalizeMissionProfileInput(input.missionProfile);

  const gateReasons = deriveGateReasons({
    darknessFactor: sDarkness,
    shadowClearanceFactor: sShadowClearance,
    losVisibleFraction: input.losVisibleFraction,
    representativeCorridor,
    horizon
  });
  const gateOpen = gateReasons.length === 0;
  const vismapModifier = 1;

  const neutralPending = 1;
  const mainFactors = {
    darkness: sDarkness,
    shadowClearance: sShadowClearance,
    overlap: sOverlap,
    plumeElevation: sPlumeElevation,
    horizonClearance: sHorizonClearance,
    distance: sDistance,
    highCloud: highCloudFactor,
    midCloud: midCloudFactor,
    lowCloud: lowCloudFactor,
    haze: hazeFactor,
    missionProfile: missionProfile.factor,
    specialEvents: neutralPending,
    windowTightness: neutralPending,
    onTime: neutralPending,
    background: clamp(backgroundFactor, 0, 1)
  } as const;

  const rawScore = gateOpen
    ? round(
        100 *
          weightedGeoNormalized([
            { factor: mainFactors.darkness, weight: JEP_V6_WATCHABILITY_WEIGHTS.darkness },
            { factor: mainFactors.shadowClearance, weight: JEP_V6_WATCHABILITY_WEIGHTS.shadowClearance },
            { factor: mainFactors.overlap, weight: JEP_V6_WATCHABILITY_WEIGHTS.overlap },
            { factor: mainFactors.plumeElevation, weight: JEP_V6_WATCHABILITY_WEIGHTS.plumeElevation },
            { factor: mainFactors.horizonClearance, weight: JEP_V6_WATCHABILITY_WEIGHTS.horizonClearance },
            { factor: mainFactors.distance, weight: JEP_V6_WATCHABILITY_WEIGHTS.distance },
            { factor: mainFactors.highCloud, weight: JEP_V6_WATCHABILITY_WEIGHTS.highCloud },
            { factor: mainFactors.midCloud, weight: JEP_V6_WATCHABILITY_WEIGHTS.midCloud },
            { factor: mainFactors.lowCloud, weight: JEP_V6_WATCHABILITY_WEIGHTS.lowCloud },
            { factor: mainFactors.haze, weight: JEP_V6_WATCHABILITY_WEIGHTS.haze },
            { factor: mainFactors.missionProfile, weight: JEP_V6_WATCHABILITY_WEIGHTS.missionProfile },
            { factor: mainFactors.specialEvents, weight: JEP_V6_WATCHABILITY_WEIGHTS.specialEvents },
            { factor: mainFactors.windowTightness, weight: JEP_V6_WATCHABILITY_WEIGHTS.windowTightness },
            { factor: mainFactors.onTime, weight: JEP_V6_WATCHABILITY_WEIGHTS.onTime },
            { factor: mainFactors.background, weight: JEP_V6_WATCHABILITY_WEIGHTS.background }
          ]),
        3
      )
    : 0;
  const score = gateOpen ? clampInt(Math.round(rawScore * vismapModifier), 0, 100) : 0;

  const compatibility = {
    illumination: round(
      weightedGeoNormalized([
        { factor: mainFactors.shadowClearance, weight: JEP_V6_WATCHABILITY_WEIGHTS.shadowClearance },
        { factor: mainFactors.overlap, weight: JEP_V6_WATCHABILITY_WEIGHTS.overlap }
      ]),
      3
    ),
    darkness: round(
      weightedGeoNormalized([
        { factor: mainFactors.darkness, weight: JEP_V6_WATCHABILITY_WEIGHTS.darkness },
        { factor: mainFactors.background, weight: JEP_V6_WATCHABILITY_WEIGHTS.background }
      ]),
      3
    ),
    lineOfSight: round(
      weightedGeoNormalized([
        { factor: mainFactors.plumeElevation, weight: JEP_V6_WATCHABILITY_WEIGHTS.plumeElevation },
        { factor: mainFactors.horizonClearance, weight: JEP_V6_WATCHABILITY_WEIGHTS.horizonClearance },
        { factor: mainFactors.distance, weight: JEP_V6_WATCHABILITY_WEIGHTS.distance }
      ]),
      3
    ),
    weather: round(
      weightedGeoNormalized([
        { factor: mainFactors.highCloud, weight: JEP_V6_WATCHABILITY_WEIGHTS.highCloud },
        { factor: mainFactors.midCloud, weight: JEP_V6_WATCHABILITY_WEIGHTS.midCloud },
        { factor: mainFactors.lowCloud, weight: JEP_V6_WATCHABILITY_WEIGHTS.lowCloud },
        { factor: mainFactors.haze, weight: JEP_V6_WATCHABILITY_WEIGHTS.haze }
      ]),
      3
    )
  };

  const backgroundMode =
    background.source === 'combined'
      ? 'full_background'
      : background.source === 'moon_only'
        ? 'moon_only_partial'
        : 'neutral_missing';

  const availability = {
    gateMode: horizon.usable ? 'visible_path_and_local_horizon_required' : 'coarse_los_visible_path_required',
    shadowModel: 'shadow_height_approximation',
    background: background.availability ?? backgroundMode,
    backgroundMode,
    horizon: representativeCorridor?.mode === 'visible_path' ? horizon.availability : 'gate_closed_no_visible_corridor',
    haze: 'neutral_pending_haze_source',
    missionProfile: missionProfile.availability,
    specialEvents: 'neutral_pending_special_event_model',
    windowTightness: 'neutral_pending_window_model',
    onTime: 'neutral_pending_schedule_model',
    vismap: 'neutral_no_official_map',
    weatherLayers:
      input.weather.cloudCoverMidPct != null || input.weather.cloudCoverHighPct != null
        ? 'observer_layers_available'
        : 'observer_low_total_only'
  };

  const explainability = {
    reasonCodes: [
      'shadow_candidate_watchability',
      'coarse_los_gate',
      'interim_shadow_height_model',
      ...(horizon.usable ? ['local_horizon_mask_applied'] : []),
      ...(missionProfile.source === 'vehicle_prior' ? ['vehicle_prior_applied'] : []),
      ...(missionProfile.source === 'vehicle_prior' && missionProfile.factor < 1 ? ['vehicle_prior_penalty'] : []),
      ...(background.source === 'moon_only' ? ['background_moon_only_partial'] : []),
      ...(gateOpen ? [] : gateReasons)
    ],
    gateReasons,
    baselineScore: clampInt(input.baselineScore, 0, 100),
    scoreDelta: score - clampInt(input.baselineScore, 0, 100),
    pendingFamilies: [
      ...(horizon.usable ? [] : ['horizon']),
      'haze',
      ...(missionProfile.source === 'vehicle_prior' ? [] : ['mission_profile']),
      'special_events',
      'window_tightness',
      'on_time',
      'vismap'
    ],
    missionProfile: missionProfile.source === 'vehicle_prior'
      ? {
          availability: missionProfile.availability,
          familyKey: missionProfile.familyKey,
          familyLabel: missionProfile.familyLabel,
          matchMode: missionProfile.matchMode,
          factor: missionProfile.factor,
          analystConfidence: missionProfile.analystConfidence,
          sourceTitle: missionProfile.sourceTitle,
          sourceRevision: missionProfile.sourceRevision
        }
      : null,
    localHorizon:
      representativeCorridor?.mode === 'visible_path'
        ? {
            availability: horizon.availability,
            terrainMaskElDeg: horizon.terrainMaskElDeg,
            buildingMaskElDeg: horizon.buildingMaskElDeg,
            totalMaskElDeg: horizon.totalMaskElDeg,
            clearanceDeg: horizon.clearanceDeg,
            dominantSource: horizon.dominantSource,
            dominantDistanceM:
              horizon.dominantDistanceM != null ? round(horizon.dominantDistanceM, 1) : null
          }
        : null,
    representativeCorridor: representativeCorridor
      ? {
          mode: representativeCorridor.mode,
          durationSec: corridorDurationSec,
          representativeTPlusSec: round(representativeCorridor.representativeTPlusSec, 3),
          representativeElevationDeg:
            representativeCorridor.representativeElevationDeg != null
              ? round(representativeCorridor.representativeElevationDeg, 3)
              : null,
          representativeDownrangeKm:
            representativeCorridor.representativeDownrangeKm != null
              ? round(representativeCorridor.representativeDownrangeKm, 3)
              : null
        }
      : null
  };

  return {
    modelVersion: input.modelVersion,
    gateOpen,
    rawScore,
    score,
    vismapModifier,
    factors: {
      ...mainFactors,
      weights: JEP_V6_WATCHABILITY_WEIGHTS
    },
    compatibility,
    availability,
    explainability
  };
}

function deriveGateReasons({
  darknessFactor,
  shadowClearanceFactor,
  losVisibleFraction,
  representativeCorridor,
  horizon
}: {
  darknessFactor: number;
  shadowClearanceFactor: number;
  losVisibleFraction: number;
  representativeCorridor: JepV6RepresentativeCorridor | null;
  horizon: ReturnType<typeof normalizeHorizonInput>;
}) {
  const reasons: string[] = [];
  if (darknessFactor <= 0) reasons.push('observer_not_dark_enough');
  if (!representativeCorridor) reasons.push('no_candidate_corridor');
  if (representativeCorridor && representativeCorridor.mode !== 'visible_path') reasons.push('no_visible_corridor');
  if (shadowClearanceFactor <= 0) reasons.push('plume_not_sunlit_above_shadow');
  if (losVisibleFraction <= 0) reasons.push('plume_not_above_coarse_los');
  if (representativeCorridor?.mode === 'visible_path' && horizon.usable && (horizon.factor ?? 0) <= 0) {
    reasons.push('plume_below_local_horizon');
  }
  return reasons;
}

function normalizeBackgroundInput(input: JepV6BackgroundInput | null) {
  if (!input) {
    return {
      availability: 'neutral_missing_background',
      source: 'neutral' as const,
      sMoon: null,
      sAnthro: null,
      sBackground: 1
    };
  }

  return {
    availability: input.availability,
    source: input.source,
    sMoon: sanitizeFactor(input.sMoon),
    sAnthro: sanitizeFactor(input.sAnthro),
    sBackground: sanitizeFactor(input.sBackground)
  };
}

function normalizeHorizonInput(input: JepV6HorizonInput | null) {
  const factor =
    input?.factor != null ? sanitizeFactor(input.factor) : computeJepV6LocalHorizonFactor(input?.clearanceDeg ?? null);
  const usable = input?.source === 'local_mask' && input?.availability === 'ok' && factor != null;

  return {
    availability: input?.availability ?? 'neutral_pending_horizon_masks',
    source: input?.source ?? ('neutral' as const),
    terrainMaskElDeg: sanitizeNumber(input?.terrainMaskElDeg ?? null),
    buildingMaskElDeg: sanitizeNumber(input?.buildingMaskElDeg ?? null),
    totalMaskElDeg: sanitizeNumber(input?.totalMaskElDeg ?? null),
    clearanceDeg: sanitizeNumber(input?.clearanceDeg ?? null),
    factor,
    dominantSource: typeof input?.dominantSource === 'string' && input.dominantSource.trim() ? input.dominantSource : null,
    dominantDistanceM: sanitizeNumber(input?.dominantDistanceM ?? null),
    usable
  };
}

function normalizeMissionProfileInput(input: JepV6MissionProfileInput | null) {
  const factor = sanitizeFactor(input?.missionProfileFactor ?? null);
  return {
    availability: input?.availability ?? 'neutral_pending_vehicle_priors',
    source: input?.source ?? ('neutral' as const),
    familyKey: typeof input?.familyKey === 'string' && input.familyKey.trim() ? input.familyKey : null,
    familyLabel: typeof input?.familyLabel === 'string' && input.familyLabel.trim() ? input.familyLabel : null,
    matchMode: input?.matchMode ?? ('none' as const),
    factor: factor ?? 1,
    analystConfidence:
      typeof input?.analystConfidence === 'string' && input.analystConfidence.trim() ? input.analystConfidence : null,
    sourceUrl: typeof input?.sourceUrl === 'string' && input.sourceUrl.trim() ? input.sourceUrl : null,
    sourceTitle: typeof input?.sourceTitle === 'string' && input.sourceTitle.trim() ? input.sourceTitle : null,
    sourceRevision:
      typeof input?.sourceRevision === 'string' && input.sourceRevision.trim() ? input.sourceRevision : null,
    rationale: typeof input?.rationale === 'string' && input.rationale.trim() ? input.rationale : null
  };
}

function computeContinuousDarknessFactor(solarDepressionDeg: number | null) {
  const value = sanitizeNumber(solarDepressionDeg);
  if (value == null) return 0;
  return interpolateFromStops(value, [
    [0, 0],
    [2, 0.18],
    [6, 0.68],
    [10, 0.92],
    [14, 1],
    [24, 1]
  ]);
}

function computeShadowClearanceFactor(sunlitMarginKm: number | null) {
  const value = sanitizeNumber(sunlitMarginKm);
  if (value == null) return 0;
  return interpolateFromStops(value, [
    [0, 0],
    [10, 0.2],
    [30, 0.45],
    [60, 0.7],
    [100, 0.88],
    [160, 1]
  ]);
}

function computeCorridorDurationFactor(durationSec: number | null) {
  const value = sanitizeNumber(durationSec);
  if (value == null) return 0;
  return interpolateFromStops(value, [
    [0, 0],
    [20, 0.2],
    [45, 0.55],
    [90, 0.82],
    [180, 1]
  ]);
}

function computePlumeElevationFactor(elevationDeg: number | null) {
  const value = sanitizeNumber(elevationDeg);
  if (value == null) return 0;
  return interpolateFromStops(value, [
    [0, 0],
    [2, 0.15],
    [5, 0.4],
    [10, 0.72],
    [20, 1]
  ]);
}

function computeDistanceFactor(distanceKm: number | null) {
  const value = sanitizeNumber(distanceKm);
  if (value == null) return 1;
  if (value <= 20) return 0.25;
  if (value <= 100) return interpolate(value, 20, 100, 0.25, 0.75);
  if (value <= 300) return interpolate(value, 100, 300, 0.75, 1);
  if (value <= 900) return 1;
  if (value <= 1500) return interpolate(value, 900, 1500, 1, 0.82);
  if (value <= 2200) return interpolate(value, 1500, 2200, 0.82, 0.45);
  return 0.35;
}

function computeHighCloudFactor(cloudPct: number | null) {
  const value = sanitizeNumber(cloudPct);
  if (value == null) return 1;
  return interpolateFromStops(value, [
    [0, 1],
    [25, 1],
    [60, 0.72],
    [85, 0.42],
    [100, 0.18]
  ]);
}

function computeMidCloudFactor(cloudPct: number | null) {
  const value = sanitizeNumber(cloudPct);
  if (value == null) return 1;
  return interpolateFromStops(value, [
    [0, 1],
    [20, 1],
    [50, 0.72],
    [80, 0.38],
    [100, 0.15]
  ]);
}

function computeLowCloudFactor(cloudPct: number | null) {
  const value = sanitizeNumber(cloudPct);
  if (value == null) return 1;
  return interpolateFromStops(value, [
    [0, 1],
    [10, 1],
    [30, 0.82],
    [60, 0.42],
    [100, 0.12]
  ]);
}

function weightedGeoNormalized(entries: Array<{ factor: number; weight: number }>) {
  const filtered = entries.filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0);
  const totalWeight = filtered.reduce((sum, entry) => sum + entry.weight, 0);
  if (!totalWeight) return 1;

  let exponentSum = 0;
  for (const entry of filtered) {
    const factor = clamp(entry.factor, 0, 1);
    if (factor <= 0) return 0;
    exponentSum += (entry.weight / totalWeight) * Math.log(factor);
  }
  return clamp(Math.exp(exponentSum), 0, 1);
}

function interpolateFromStops(value: number, stops: Array<[number, number]>) {
  if (!stops.length) return 0;
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

function sanitizeFactor(value: number | null) {
  const numberValue = sanitizeNumber(value);
  if (numberValue == null) return null;
  return clamp(numberValue, 0, 1);
}

function sanitizeNumber(value: number | null) {
  return value != null && Number.isFinite(value) ? value : null;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
