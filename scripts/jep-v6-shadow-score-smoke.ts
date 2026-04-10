const assert = require('node:assert/strict');
const { computeJepV6ShadowScore } = require('../apps/web/lib/jep/v6Score');
const { resolveJepV6VehiclePrior } = require('../apps/web/lib/jep/v6VehiclePriors');

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

const baseInput = {
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
} as const;

function scoreWith(overrides = {}) {
  return computeJepV6ShadowScore({
    ...baseInput,
    ...overrides
  });
}

function assertIncludes(values, expected, message) {
  assert.ok(Array.isArray(values) && values.includes(expected), message);
}

const strong = scoreWith();

assert.equal(strong.gateOpen, true);
assert.ok(strong.score > 50, 'expected a healthy twilight-visible candidate score');
assert.ok((strong.compatibility.illumination || 0) > 0.6, 'illumination compatibility should stay healthy');
assert.equal(strong.availability.backgroundMode, 'full_background');

const brighterTwilight = scoreWith({
  solarDepressionDeg: 2.5
});

assert.equal(brighterTwilight.gateOpen, true);
assert.ok(brighterTwilight.score < strong.score, 'a brighter observer sky should lower the watchability score');

const backgroundPenalty = scoreWith({
  background: {
    availability: 'ok',
    source: 'combined',
    sMoon: 0.34,
    sAnthro: 0.28,
    sBackground: 0.32
  }
});

assert.equal(backgroundPenalty.gateOpen, true);
assert.ok(backgroundPenalty.score < strong.score, 'worse background contrast should lower the candidate score');

const heavierClouds = scoreWith({
  weather: {
    cloudCoverLowPct: 78,
    cloudCoverMidPct: 72,
    cloudCoverHighPct: 66,
    obstructionFactor: 0.38
  }
});

assert.equal(heavierClouds.gateOpen, true);
assert.ok(heavierClouds.score < strong.score, 'heavier clouds and obstruction should lower the candidate score');

const notDarkEnough = scoreWith({
  solarDepressionDeg: -0.2
});

assert.equal(notDarkEnough.gateOpen, false);
assert.equal(notDarkEnough.score, 0);
assertIncludes(
  notDarkEnough.explainability.gateReasons,
  'observer_not_dark_enough',
  'daylight observers should be blocked explicitly'
);

const blockedByLocalHorizon = scoreWith({
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
  }
});

assert.equal(blockedByLocalHorizon.gateOpen, false);
assert.equal(blockedByLocalHorizon.score, 0);
assertIncludes(
  blockedByLocalHorizon.explainability.gateReasons,
  'plume_below_local_horizon',
  'local horizon blocking should explicitly close the gate'
);

const impossibleBroadGeometry = scoreWith({
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
  }
});

assert.equal(impossibleBroadGeometry.gateOpen, false);
assert.equal(impossibleBroadGeometry.score, 0);
assertIncludes(
  impossibleBroadGeometry.explainability.gateReasons,
  'no_visible_corridor',
  'cross-country or otherwise impossible broad geometry should close the gate'
);
assertIncludes(
  impossibleBroadGeometry.explainability.gateReasons,
  'plume_not_above_coarse_los',
  'broad geometry failures should stay explicit in gate reasons'
);

const neutralVehiclePrior = scoreWith({
  missionProfile: {
    availability: 'ok',
    source: 'vehicle_prior',
    familyKey: 'spacex_falcon9_fl',
    familyLabel: 'SpaceX Falcon 9 Florida',
    matchMode: 'family_key',
    missionProfileFactor: 1,
    analystConfidence: 'medium',
    sourceUrl: 'https://www.spacex.com/vehicles/falcon-9/',
    sourceTitle: 'SpaceX Falcon 9 vehicle page',
    sourceRevision: '2026-04-08',
    rationale: 'Neutral baseline family prior'
  }
});

assert.equal(neutralVehiclePrior.gateOpen, true);
assert.equal(neutralVehiclePrior.score, strong.score, 'a neutral vehicle prior should not change the score');

const vehiclePriorPenalty = scoreWith({
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
  }
});

assert.equal(vehiclePriorPenalty.gateOpen, true);
assert.ok(vehiclePriorPenalty.score < strong.score, 'vehicle prior penalty should lower the candidate score');
assert.equal(vehiclePriorPenalty.availability.missionProfile, 'ok');
assertIncludes(
  vehiclePriorPenalty.explainability.reasonCodes,
  'vehicle_prior_applied',
  'vehicle prior usage should be explicit in explainability'
);
assertIncludes(
  vehiclePriorPenalty.explainability.reasonCodes,
  'vehicle_prior_penalty',
  'penalty priors should be explicit in explainability'
);

const exactConfigRows = [
  {
    familyKey: 'spacex_falcon_heavy',
    familyLabel: 'SpaceX Falcon Heavy',
    ll2RocketConfigId: 161,
    providerKey: 'spacex',
    padState: null,
    rocketFullNamePattern: 'Falcon Heavy',
    rocketFamilyPattern: 'falcon heavy',
    missionProfileFactor: 1,
    analystConfidence: 'medium',
    sourceUrl: 'https://ll.thespacedevs.com/2.3.0/launcher_configurations/161/?format=api',
    sourceTitle: 'LL2 Falcon Heavy configuration',
    sourceRevision: '2026-04-08',
    rationale: 'Exact config-ID match should override weaker text-family normalization',
    activeFromDate: null,
    activeToDate: null,
    metadata: null
  }
];

const resolvedExactConfig = resolveJepV6VehiclePrior(exactConfigRows, {
  provider: 'SpaceX',
  padState: 'FL',
  rocketFullName: 'Falcon Heavy',
  rocketFamily: 'Falcon',
  ll2RocketConfigId: 161,
  net: '2026-06-01T00:00:00Z'
});

assert.equal(resolvedExactConfig.source, 'vehicle_prior');
assert.equal(resolvedExactConfig.matchMode, 'config_id');
assert.equal(resolvedExactConfig.familyKey, 'spacex_falcon_heavy');
