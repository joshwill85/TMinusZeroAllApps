const assert = require('node:assert/strict');
const { computeJepV6ShadowScore } = require('../apps/web/lib/jep/v6Score');

const visibleCorridor = {
  mode: 'visible_path',
  representativeTPlusSec: 240,
  representativeAzimuthDeg: 94,
  representativeElevationDeg: 16,
  representativeAltitudeM: 118_000,
  representativeDownrangeKm: 540,
  sampleCount: 14,
  corridorStartTPlusSec: 180,
  corridorEndTPlusSec: 320,
  azimuthSpreadDeg: 7
} as const;

const strong = computeJepV6ShadowScore({
  modelVersion: 'jep_v6',
  baselineModelVersion: 'jep_v5',
  baselineScore: 62,
  solarDepressionDeg: 8.4,
  illuminationFactor: 0.68,
  sunlitMarginKm: 120,
  losVisibleFraction: 0.74,
  representativeCorridor: visibleCorridor,
  background: {
    availability: 'ok',
    source: 'combined',
    sMoon: 0.83,
    sAnthro: 0.79,
    sBackground: 0.817
  },
  horizon: null,
  missionProfile: null,
  weather: {
    cloudCoverLowPct: 14,
    cloudCoverMidPct: 9,
    cloudCoverHighPct: 6,
    obstructionFactor: 0.94
  }
});

assert.equal(strong.gateOpen, true);
assert.ok(strong.score > 50, 'expected a healthy twilight-visible candidate score');
assert.ok((strong.compatibility.illumination || 0) > 0.6, 'illumination compatibility should stay healthy');
assert.equal(strong.availability.backgroundMode, 'full_background');

const backgroundPenalty = computeJepV6ShadowScore({
  modelVersion: 'jep_v6',
  baselineModelVersion: 'jep_v5',
  baselineScore: 62,
  solarDepressionDeg: 8.4,
  illuminationFactor: 0.68,
  sunlitMarginKm: 120,
  losVisibleFraction: 0.74,
  representativeCorridor: visibleCorridor,
  background: {
    availability: 'ok',
    source: 'combined',
    sMoon: 0.34,
    sAnthro: 0.28,
    sBackground: 0.32
  },
  horizon: null,
  missionProfile: null,
  weather: {
    cloudCoverLowPct: 14,
    cloudCoverMidPct: 9,
    cloudCoverHighPct: 6,
    obstructionFactor: 0.94
  }
});

assert.equal(backgroundPenalty.gateOpen, true);
assert.ok(backgroundPenalty.score < strong.score, 'worse background contrast should lower the candidate score');

const blockedByLocalHorizon = computeJepV6ShadowScore({
  modelVersion: 'jep_v6',
  baselineModelVersion: 'jep_v5',
  baselineScore: 62,
  solarDepressionDeg: 8.4,
  illuminationFactor: 0.68,
  sunlitMarginKm: 120,
  losVisibleFraction: 0.74,
  representativeCorridor: visibleCorridor,
  background: {
    availability: 'ok',
    source: 'combined',
    sMoon: 0.83,
    sAnthro: 0.79,
    sBackground: 0.817
  },
  horizon: {
    availability: 'ok',
    source: 'local_mask',
    terrainMaskElDeg: 11.8,
    buildingMaskElDeg: 17.1,
    totalMaskElDeg: 17.1,
    clearanceDeg: -1.1,
    factor: 0,
    dominantSource: 'building',
    dominantDistanceM: 820
  },
  missionProfile: null,
  weather: {
    cloudCoverLowPct: 14,
    cloudCoverMidPct: 9,
    cloudCoverHighPct: 6,
    obstructionFactor: 0.94
  }
});

assert.equal(blockedByLocalHorizon.gateOpen, false);
assert.equal(blockedByLocalHorizon.score, 0);
assert.ok(
  Array.isArray(blockedByLocalHorizon.explainability.gateReasons) &&
    blockedByLocalHorizon.explainability.gateReasons.includes('plume_below_local_horizon'),
  'local horizon blocking should explicitly close the gate'
);

const noVisibleCorridor = computeJepV6ShadowScore({
  modelVersion: 'jep_v6',
  baselineModelVersion: 'jep_v5',
  baselineScore: 20,
  solarDepressionDeg: 12,
  illuminationFactor: 0.44,
  sunlitMarginKm: 55,
  losVisibleFraction: 0,
  representativeCorridor: {
    ...visibleCorridor,
    mode: 'sunlit_path',
    representativeElevationDeg: 3
  },
  background: {
    availability: 'missing_moon_ephemeris',
    source: 'neutral',
    sMoon: null,
    sAnthro: null,
    sBackground: null
  },
  horizon: null,
  missionProfile: null,
  weather: {
    cloudCoverLowPct: 10,
    cloudCoverMidPct: 8,
    cloudCoverHighPct: 5,
    obstructionFactor: 0.96
  }
});

assert.equal(noVisibleCorridor.gateOpen, false);
assert.equal(noVisibleCorridor.score, 0);
assert.ok(
  Array.isArray(noVisibleCorridor.explainability.gateReasons) &&
    noVisibleCorridor.explainability.gateReasons.includes('no_visible_corridor'),
  'gate reasons should explain why the candidate stayed closed'
);

const vehiclePriorPenalty = computeJepV6ShadowScore({
  modelVersion: 'jep_v6',
  baselineModelVersion: 'jep_v5',
  baselineScore: 62,
  solarDepressionDeg: 8.4,
  illuminationFactor: 0.68,
  sunlitMarginKm: 120,
  losVisibleFraction: 0.74,
  representativeCorridor: visibleCorridor,
  background: {
    availability: 'ok',
    source: 'combined',
    sMoon: 0.83,
    sAnthro: 0.79,
    sBackground: 0.817
  },
  horizon: null,
  missionProfile: {
    availability: 'ok',
    source: 'vehicle_prior',
    familyKey: 'spacex_starship_tx',
    familyLabel: 'SpaceX Starship Texas',
    matchMode: 'family_key',
    missionProfileFactor: 0.9,
    analystConfidence: 'low',
    sourceUrl: 'https://www.spacex.com/vehicles/starship/',
    sourceTitle: 'SpaceX Starship vehicle page',
    sourceRevision: '2026-04-08',
    rationale: 'Conservative initial family prior'
  },
  weather: {
    cloudCoverLowPct: 14,
    cloudCoverMidPct: 9,
    cloudCoverHighPct: 6,
    obstructionFactor: 0.94
  }
});

assert.equal(vehiclePriorPenalty.gateOpen, true);
assert.ok(vehiclePriorPenalty.score < strong.score, 'vehicle prior penalty should lower the candidate score');
assert.equal(vehiclePriorPenalty.availability.missionProfile, 'ok');
assert.ok(
  Array.isArray(vehiclePriorPenalty.explainability.reasonCodes) &&
    vehiclePriorPenalty.explainability.reasonCodes.includes('vehicle_prior_applied'),
  'vehicle prior usage should be explicit in explainability'
);
