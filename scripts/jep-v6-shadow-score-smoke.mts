import assert from 'node:assert/strict';
import jepV6ScoreModule from '../apps/web/lib/jep/v6Score.ts';

const { computeJepV6ShadowScore } = jepV6ScoreModule;

const visibleCorridor = {
  mode: 'visible_path' as const,
  representativeTPlusSec: 240,
  representativeAzimuthDeg: 94,
  representativeElevationDeg: 16,
  representativeAltitudeM: 118_000,
  representativeDownrangeKm: 540,
  sampleCount: 14,
  corridorStartTPlusSec: 180,
  corridorEndTPlusSec: 320,
  azimuthSpreadDeg: 7
};

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
  weather: {
    cloudCoverLowPct: 14,
    cloudCoverMidPct: 9,
    cloudCoverHighPct: 6,
    obstructionFactor: 0.94
  }
});

assert.equal(backgroundPenalty.gateOpen, true);
assert.ok(backgroundPenalty.score < strong.score, 'worse background contrast should lower the candidate score');

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
