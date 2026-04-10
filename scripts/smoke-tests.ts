import assert from 'node:assert/strict';
import { buildIcsCalendar } from '@/lib/calendar/ics';
import { buildLaunchShare } from '@/lib/share';
import { parseWs45ForecastText } from '@/lib/server/ws45ForecastIngest';
import { computeCountdown, isDateOnlyNet } from '@/lib/time';
import { Launch } from '@/lib/types/launch';
import {
  AR_CLIENT_PROFILE_RELEASE_TARGETS,
  detectArClientProfile,
  getArClientProfilePolicy
} from '@/lib/ar/clientProfile';
import { summarizeArRuntimePolicies } from '@/lib/ar/runtimePolicyTelemetry';
import { deriveArTelemetryEntryState } from '@/lib/ar/sessionStatus';
import {
  buildArTelemetryMaterialKey,
  deriveArTelemetryUpdateCadenceMs,
  shouldSendArTelemetryUpdate
} from '@/lib/ar/telemetryCadence';
import { deriveTrajectoryEvidenceView } from '@/lib/ar/trajectoryEvidence';
import { bearingDegrees, getDeclinationDeg, normalizeAngleDelta } from '@/lib/ar/geo';
import { azElFromEnu, ecefFromLatLon, enuFromEcef } from '@/lib/ar/ecef';
import { wrapAngle360 } from '@/lib/ar/angles';
import { deriveAlignmentFeedback } from '@/lib/ar/alignmentFeedback';
import {
  interpolateTrajectory,
  normalizeTrajectoryCovariance,
  normalizeTrajectoryUncertainty,
  readTrajectoryPointCovariance,
  readTrajectoryPointSigmaDeg
} from '@/lib/ar/trajectory';
import {
  buildVisionCropRect,
  mapVisionNormPointFromCropRect,
  projectAzElToViewportNorm,
  viewportNormToAngleOffsetsDeg
} from '@/lib/ar/visionTrackerWindow';
import {
  advanceArPerformanceGovernor,
  classifyArPerformanceTier,
  getArPerformancePolicy
} from '@/lib/ar/performanceGovernor';
import {
  advanceVisionTrackerAdaptiveState,
  DEFAULT_VISION_TRACKER_ADAPTIVE_STATE,
  deriveAdaptiveVisionTrackerBudget
} from '@/lib/ar/visionTrackerBudget';
import { deriveArBottomGuidance } from '@/lib/ar/bottomGuidance';
import { VisionTrackerCore } from '@/lib/ar/visionTrackerCore';
import { shouldAutoStartWebXr } from '@/lib/ar/runtimeStartupPolicy';
import { selectArRuntime } from '@/lib/ar/runtimeSelector';
import { applyTrajectoryPublishPolicyToProduct, deriveTrajectoryPublishPolicy } from '@/lib/ar/trajectoryPublishPolicy';
import { runReplayBenchmark } from '@/lib/ar/replayBenchmark';
import { buildTrajectoryContract, buildTrajectoryPublicV2Response } from '@/lib/server/trajectoryContract';
import { deriveJepCalibrationBand, summarizeJepCalibration } from '@/lib/jep/calibration';
import { applyJepObserverGuidancePolicy, allowNwsFallbackForObserverSource } from '@/lib/jep/fallbackPolicy';
import { deriveJepGuidance } from '@/lib/jep/guidance';
import { deriveJepReadiness } from '@/lib/jep/readiness';
import { buildPartnerTrajectoryConstraintRow, normalizePartnerTrajectoryFeedInput } from '@/lib/trajectory/partnerFeedAdapter';
import { deriveTrajectoryFieldAuthorityProfile } from '@/lib/trajectory/fieldAuthority';
import { emptyHazardScanState, mergeHazardScanState, shouldSuppressHazardConstraintFromScanState } from '@/lib/trajectory/hazardFreshness';
import {
  applyTrajectoryMilestoneProjection,
  buildTrajectoryCompatibilityEvents,
  formatTrajectoryMilestoneOffsetLabel,
  resolveTrajectoryMilestones
} from '@/lib/trajectory/milestones';
import { buildSupgpSearchPlan, parsePublicOrbitData, scoreSupgpOrbitRowMatch } from '@/lib/trajectory/publicOrbitSignals';
import { dedupeTrajectoryReasonLabels } from '@/lib/trajectory/trajectoryEvidencePresentation';
import { normalizeImageUrl } from '@/lib/utils/imageUrl';
import { ORBIT_OMM_DUPLICATED_KEYS, compactOrbitElementRawOmm } from '../supabase/functions/_shared/celestrak';

const baseLaunch: Launch = {
  id: 'test-launch',
  ll2Id: 'test-launch',
  name: 'Test Launch',
  provider: 'Test Provider',
  vehicle: 'Test Vehicle',
  pad: {
    name: 'Test Pad',
    shortCode: 'TP',
    state: 'CA',
    timezone: 'UTC'
  },
  net: '2030-01-01T12:00:00Z',
  netPrecision: 'minute',
  image: {
    thumbnail: 'https://example.com/launch.png'
  },
  tier: 'routine',
  status: 'go',
  statusText: 'Go'
};

const ics = buildIcsCalendar([baseLaunch], { siteUrl: 'https://example.com' });
assert(ics.includes('BEGIN:VCALENDAR'));
assert(ics.includes('BEGIN:VEVENT'));
assert(ics.includes(`UID:${baseLaunch.id}@tminuszero.app`));
assert(ics.includes('SUMMARY:Test Launch'));

const icsWithAlarm = buildIcsCalendar([baseLaunch], { siteUrl: 'https://example.com', alarmMinutesBefore: 60 });
assert(icsWithAlarm.includes('BEGIN:VALARM'));
assert(icsWithAlarm.includes('TRIGGER:-PT60M'));

const dateOnlyLaunch: Launch = {
  ...baseLaunch,
  id: 'date-only',
  net: '2030-01-02T00:00:00Z',
  netPrecision: 'day'
};

const icsDateOnly = buildIcsCalendar([dateOnlyLaunch], { siteUrl: 'https://example.com' });
assert(icsDateOnly.includes('DTSTART;VALUE=DATE'));

const icsDateOnlyWithAlarm = buildIcsCalendar([dateOnlyLaunch], { siteUrl: 'https://example.com', alarmMinutesBefore: 60 });
assert(!icsDateOnlyWithAlarm.includes('BEGIN:VALARM'));

const share = buildLaunchShare(baseLaunch);
assert.equal(share.path, `/share/launch/${baseLaunch.id}`);
assert(share.text.includes(baseLaunch.provider));

assert.equal(
  normalizeImageUrl('http://spaceflightnow.com/wp-content/uploads/2025/11/2025111-New-Glenn-Adam.jpg'),
  'https://spaceflightnow.com/wp-content/uploads/2025/11/2025111-New-Glenn-Adam.jpg'
);
assert.equal(normalizeImageUrl('//cdn.example.com/path/image.png'), 'https://cdn.example.com/path/image.png');
assert.equal(normalizeImageUrl('/images/launch.jpg'), '/images/launch.jpg');

const countdown = computeCountdown(new Date(Date.now() + 60 * 60 * 1000).toISOString());
assert(countdown.diffSeconds >= 0);
assert(countdown.label.startsWith('T-'));

assert.equal(isDateOnlyNet('2030-01-01T00:00:00Z', 'day'), true);

const ws45SampleText = `
Launch Mission Execution Forecast
Mission : Falcon 9 Starlink 6 - 100
Issued : 16 Jan 202 6 / 10 3 0 L ( 15 3 0 Z )
Valid : 18 Jan 2026 / 17 0 4 - 210 4 L ( 1 8 /2 20 4 - 19/020 4 Z)
Forecast Discussion : Example discussion. Launch Day
Launch Day Probability of Violating Weather Constraints 1 40 → 1 0 %
Primary Concerns : Cumulus Cloud Rule , Thick Cloud Rule , Liftoff Winds Weather/Visibility : Scat . Showers / 7 mi. Clouds
Temp/Humidity : 56 °F / 85 %
Liftoff Winds (200') : 340 ° 20 - 2 8 mph
24 - Hour Delay Probability of Violating Weather Constraints <5 %
Primary Concerns : None Weather/Visibility : None / 7 mi.
Temp/Humidity : 53 °F / 50 %
Liftoff Winds (200') : 360 ° 1 5 - 20 mph
Notes
`;

const ws45Parsed = parseWs45ForecastText(ws45SampleText);
assert.equal(ws45Parsed.missionName, 'Falcon 9 Starlink 6 - 100');
assert.equal(ws45Parsed.issuedAtUtc, '2026-01-16T15:30:00.000Z');
assert.equal(ws45Parsed.validStartUtc, '2026-01-18T22:04:00.000Z');
assert.equal(ws45Parsed.validEndUtc, '2026-01-19T02:04:00.000Z');
assert.equal(ws45Parsed.launchDayPovPercent, 40);
assert.equal(ws45Parsed.launchDay?.liftoffWinds?.directionDeg, 340);
assert.equal(ws45Parsed.launchDay?.liftoffWinds?.speedMphMin, 20);
assert.equal(ws45Parsed.launchDay?.liftoffWinds?.speedMphMax, 28);

const ws45SampleTextWithLocalDayRollover = `
Launch Mission Execution Forecast
Mission : Falcon 9 GPS III-9
Issued : 26 Jan 2026 / 1245 L ( 1745 Z )
Valid : 27 Jan 2026 / 2330 - 28/0005 L ( 28/0430 - 0505 Z )
Forecast Discussion : Example discussion. Launch Day
Launch Day Probability of Violating Weather Constraints <5 %
Primary Concerns : None Weather/Visibility : None / 7 mi.
Temp/Humidity : 47 °F / 65 %
Liftoff Winds (200') : 330 ° 12 - 17 mph
24 - Hour Delay Probability of Violating Weather Constraints <5 %
Primary Concerns : None Weather/Visibility : None / 7 mi.
Temp/Humidity : 48 °F / 60 %
Liftoff Winds (200') : 310 ° 12 - 17 mph
Notes
`;

const ws45ParsedWithLocalDayRollover = parseWs45ForecastText(ws45SampleTextWithLocalDayRollover);
assert.equal(ws45ParsedWithLocalDayRollover.missionName, 'Falcon 9 GPS III-9');
assert.equal(ws45ParsedWithLocalDayRollover.issuedAtUtc, '2026-01-26T17:45:00.000Z');
assert.equal(ws45ParsedWithLocalDayRollover.validStartUtc, '2026-01-28T04:30:00.000Z');
assert.equal(ws45ParsedWithLocalDayRollover.validEndUtc, '2026-01-28T05:05:00.000Z');

const ws45CrewStyleText = `
Launch Mission Execution Forecast
Mission : Falcon 9 NASA Crew - 12
Issued : 12 Feb 2026 / 0745 L ( 1245 Z )
Valid : 13 Feb 2026 / 0506 - 0526 L ( 13/1006 - 1026 Z )
Forecast Discussion : Example discussion. Launch Day
Probability of Violating Weather Constraints 1
Launch Day
10% Primary Concerns: Cumulus Cloud Rule, Flight Through Precipitation
Weather Conditions Additional Risk Criteria 2
Weather: Mist Clouds Type Coverage Base (ft) Tops (ft)
Visibility: 5 miles Stratus Scattered 800 1,200
Temp/Humidity: 59°F / 95% Cumulus Scattered 3,000 8,000
Liftoff Winds (200’): 350° 7 - 12 mph Solar Activity: Low
Probability of Violating Weather Constraints
48-Hour Delay
20% Primary Concerns: Cumulus Cloud Rule, Thick Cloud Layers Rule, Flight Through Precipitation
Weather Conditions Additional Risk Criteria
Weather: Isold Showers Clouds Type Coverage Base (ft) Tops (ft)
Visibility: 7 miles Cumulus Scattered 3,000 10,000
Temp/Humidity: 64°F / 85% Cirrostratus Br25,000 30,000
Liftoff Winds (200’): 150° 12 - 17 mph Solar Activity: Low
Probability of Violating Weather Constraints
72-Hour Delay
55% Primary Concerns: Cumulus Cloud Rule, Surface Electric Fields, Flight Through Precipitation
Weather Conditions Additional Risk Criteria
Weather: Sct Showers Clouds Type Coverage Base (ft) Tops (ft)
Visibility: 7 miles Cumulus Scattered 3,000 15,000
Temp/Humidity: 63°F / 95% Cirrostratus Broken 26,000 32,000
Liftoff Winds (200’): 220° 16 - 24 mph Solar Activity: Low
Notes
`;

const ws45CrewStyleParsed = parseWs45ForecastText(ws45CrewStyleText);
assert.equal(ws45CrewStyleParsed.launchDayPovPercent, 10);
assert.equal(ws45CrewStyleParsed.launchDay?.weatherVisibility, 'Mist • 5 miles');
assert.equal(ws45CrewStyleParsed.launchDay?.clouds?.length, 2);
assert.equal(ws45CrewStyleParsed.delay24hPovPercent, 20);
assert.equal(ws45CrewStyleParsed.delay24h?.label, '48-Hour Delay');
assert.equal(ws45CrewStyleParsed.delay24h?.clouds?.[1]?.type, 'Cirrostratus');
assert.equal(ws45CrewStyleParsed.delay24h?.clouds?.[1]?.coverage, 'Broken');
assert.equal(ws45CrewStyleParsed.delay24h?.clouds?.[1]?.baseFt, 25000);

const jepReadinessHeld = deriveJepReadiness({
  publicEnabled: true,
  validationReady: false,
  modelCardPublished: false,
  labeledOutcomes: 124,
  minLabeledOutcomes: 500,
  currentEce: 0.08,
  maxEce: 0.05,
  currentBrier: null,
  maxBrier: 0.16
});
assert.equal(jepReadinessHeld.publicVisible, true);
assert.equal(jepReadinessHeld.probabilityReady, false);
assert(jepReadinessHeld.reasons.includes('validation_incomplete'));
assert(jepReadinessHeld.reasons.includes('model_card_unpublished'));
assert(jepReadinessHeld.reasons.includes('insufficient_labeled_outcomes'));
assert(jepReadinessHeld.reasons.includes('ece_above_threshold'));
assert(jepReadinessHeld.reasons.includes('brier_unreported'));

const jepReadinessReady = deriveJepReadiness({
  publicEnabled: true,
  validationReady: true,
  modelCardPublished: true,
  labeledOutcomes: 620,
  minLabeledOutcomes: 500,
  currentEce: 0.04,
  maxEce: 0.05,
  currentBrier: 0.11,
  maxBrier: 0.16
});
assert.equal(jepReadinessReady.publicVisible, true);
assert.equal(jepReadinessReady.probabilityReady, true);
assert.equal(jepReadinessReady.probabilityPublicEligible, true);
assert.deepEqual(jepReadinessReady.reasons, []);

assert.equal(deriveJepCalibrationBand(0.12), 'VERY_LOW');
assert.equal(deriveJepCalibrationBand(0.51), 'MEDIUM');
assert.equal(deriveJepCalibrationBand(0.91), 'VERY_HIGH');

const jepCalibrationSummary = summarizeJepCalibration([
  { probability: 0.8, outcome: 'seen', reportMode: 'watchability', calibrationBand: 'HIGH' },
  { probability: 0.7, outcome: 'seen', reportMode: 'watchability', calibrationBand: 'HIGH' },
  { probability: 0.2, outcome: 'not_seen', reportMode: 'watchability', calibrationBand: 'LOW' },
  { probability: 0.1, outcome: 'not_observable', reportMode: 'watchability', calibrationBand: 'VERY_LOW' }
]);
assert.equal(jepCalibrationSummary.totalSamples, 4);
assert.equal(jepCalibrationSummary.labeledSamples, 3);
assert.equal(jepCalibrationSummary.positiveSamples, 2);
assert.equal(jepCalibrationSummary.negativeSamples, 1);
assert.equal(jepCalibrationSummary.skippedSamples, 1);
assert(jepCalibrationSummary.brierScore != null && jepCalibrationSummary.brierScore >= 0);
assert(jepCalibrationSummary.expectedCalibrationError != null && jepCalibrationSummary.expectedCalibrationError >= 0);

const parsedCircularOrbit = parsePublicOrbitData('Injected into a circular orbit at 470 km and 97.6-degree inclination.');
assert.equal(parsedCircularOrbit.altitude_km, 470);
assert.equal(parsedCircularOrbit.inclination_deg, 97.6);

const parsedEllipticalOrbit = parsePublicOrbitData('Target orbit: 470 x 500 km, 53.2-degree inclination.');
assert.equal(parsedEllipticalOrbit.perigee_km, 470);
assert.equal(parsedEllipticalOrbit.apogee_km, 500);
assert.equal(parsedEllipticalOrbit.inclination_deg, 53.2);

const parsedOrbitByClass = parsePublicOrbitData('The payload will be deployed into a 97.6-degree sun-synchronous orbit at 470 km.');
assert.equal(parsedOrbitByClass.inclination_deg, 97.6);
assert.equal(parsedOrbitByClass.altitude_km, 470);
assert.equal(parsedOrbitByClass.orbit_class, 'SSO');

const parsedInclAbbrev = parsePublicOrbitData('Target orbit: 470 km circular, incl. 53.2 deg.');
assert.equal(parsedInclAbbrev.altitude_km, 470);
assert.equal(parsedInclAbbrev.inclination_deg, 53.2);

const starlinkSupgpPlan = buildSupgpSearchPlan({
  provider: 'SpaceX',
  vehicle: 'Falcon 9',
  missionName: 'Starlink 6-44',
  name: 'Falcon 9 | Starlink 6-44'
});
assert(starlinkSupgpPlan.queryTerms.includes('spacex'));
assert(starlinkSupgpPlan.familyAliases.includes('starlink'));

const compactedStarlinkRawOmm = compactOrbitElementRawOmm({
  OBJECT_NAME: 'STARLINK G6-44',
  OBJECT_ID: '2026-044A',
  CLASSIFICATION_TYPE: 'U',
  NORAD_CAT_ID: 99999,
  EPOCH: '2026-02-13T00:00:00',
  INCLINATION: 53.2,
  RA_OF_ASC_NODE: 221.4,
  ECCENTRICITY: 0.00012,
  ARG_OF_PERICENTER: 14.8,
  MEAN_ANOMALY: 45.1,
  MEAN_MOTION: 15.23,
  BSTAR: 0.000012
});
assert.equal(compactedStarlinkRawOmm.OBJECT_NAME, 'STARLINK G6-44');
assert.equal(compactedStarlinkRawOmm.OBJECT_ID, '2026-044A');
assert.equal(compactedStarlinkRawOmm.CLASSIFICATION_TYPE, 'U');
for (const key of ORBIT_OMM_DUPLICATED_KEYS) {
  assert.equal(Object.prototype.hasOwnProperty.call(compactedStarlinkRawOmm, key), false);
}

const starlinkSupgpMatch = scoreSupgpOrbitRowMatch(starlinkSupgpPlan, {
  group_or_source: 'SpaceX-E',
  raw_omm: {
    OBJECT_NAME: 'STARLINK G6-44',
    OBJECT_ID: '2026-044A'
  }
});
assert(starlinkSupgpMatch != null);
assert.equal(starlinkSupgpMatch?.quality, 'exact');

const starlinkSupgpCompactedMatch = scoreSupgpOrbitRowMatch(starlinkSupgpPlan, {
  group_or_source: 'SpaceX-E',
  raw_omm: compactedStarlinkRawOmm
});
assert(starlinkSupgpCompactedMatch != null);
assert.equal(starlinkSupgpCompactedMatch?.quality, 'exact');

const starlinkSupgpFalsePositive = scoreSupgpOrbitRowMatch(starlinkSupgpPlan, {
  group_or_source: 'SpaceX-E',
  raw_omm: {
    OBJECT_NAME: 'TRANSPORTER-13 RIDESHARE',
    OBJECT_ID: '2026-044A'
  }
});
assert.equal(starlinkSupgpFalsePositive, null);

const onewebSupgpPlan = buildSupgpSearchPlan({
  provider: 'SpaceX',
  vehicle: 'Falcon 9',
  missionName: 'OneWeb 21'
});
const onewebSupgpMatch = scoreSupgpOrbitRowMatch(onewebSupgpPlan, {
  group_or_source: 'SpaceX-E',
  raw_omm: {
    OBJECT_NAME: 'ONEWEB-0421',
    OBJECT_ID: '2026-021A'
  }
});
assert(onewebSupgpMatch != null);
assert.equal(onewebSupgpMatch?.quality, 'family');

const stableTelemetryCadenceMs = deriveArTelemetryUpdateCadenceMs({
  cameraStatus: 'granted',
  motionStatus: 'granted',
  headingStatus: 'ok',
  headingSource: 'webkit_compass',
  poseMode: 'sensor_fused',
  overlayMode: 'precision',
  visionBackend: 'main_thread_roi',
  degradationTier: 0,
  xrUsed: false,
  xrErrorBucket: undefined,
  modeEntered: 'ar',
  fallbackReason: null,
  corridorMode: 'tight',
  lockOnAttempted: true,
  lockOnAcquired: true,
  timeToLockBucket: '<2s',
  lockLossCount: 0,
  trajectoryAuthorityTier: 'official_numeric',
  trajectoryQualityState: 'precision',
  renderTier: 'high',
  droppedFrameBucket: '0..1'
});
assert.equal(stableTelemetryCadenceMs, 6000);

const fallbackTelemetryCadenceMs = deriveArTelemetryUpdateCadenceMs({
  cameraStatus: 'granted',
  motionStatus: 'denied',
  headingStatus: 'unavailable',
  headingSource: 'unknown',
  poseMode: 'sensor_fused',
  overlayMode: 'search',
  visionBackend: 'none',
  degradationTier: 2,
  xrUsed: false,
  xrErrorBucket: 'permission',
  modeEntered: 'sky_compass',
  fallbackReason: 'motion_denied',
  corridorMode: 'wide',
  lockOnAttempted: false,
  lockOnAcquired: false,
  timeToLockBucket: undefined,
  lockLossCount: 0,
  trajectoryAuthorityTier: 'model_prior',
  trajectoryQualityState: 'search',
  renderTier: 'low',
  droppedFrameBucket: '30+'
});
assert.equal(fallbackTelemetryCadenceMs, 2000);

const stableTelemetryKey = buildArTelemetryMaterialKey({
  cameraStatus: 'granted',
  motionStatus: 'granted',
  headingStatus: 'ok',
  headingSource: 'webkit_compass',
  poseMode: 'sensor_fused',
  overlayMode: 'precision',
  visionBackend: 'main_thread_roi',
  degradationTier: 0,
  xrUsed: false,
  xrErrorBucket: undefined,
  modeEntered: 'ar',
  fallbackReason: null,
  corridorMode: 'tight',
  lockOnAttempted: true,
  lockOnAcquired: true,
  timeToLockBucket: '<2s',
  lockLossCount: 0,
  trajectoryAuthorityTier: 'official_numeric',
  trajectoryQualityState: 'precision',
  renderTier: 'high',
  droppedFrameBucket: '0..1'
});
assert.equal(
  shouldSendArTelemetryUpdate({
    nowMs: 5000,
    lastSentAtMs: 1000,
    lastMaterialKey: stableTelemetryKey,
    nextMaterialKey: stableTelemetryKey,
    cadenceMs: stableTelemetryCadenceMs
  }),
  false
);
assert.equal(
  shouldSendArTelemetryUpdate({
    nowMs: 5000,
    lastSentAtMs: 1000,
    lastMaterialKey: stableTelemetryKey,
    nextMaterialKey: `${stableTelemetryKey}:changed`,
    cadenceMs: stableTelemetryCadenceMs
  }),
  true
);

const strongAzimuthAuthority = deriveTrajectoryFieldAuthorityProfile({
  field: 'azimuth',
  authorityTier: 'official_numeric',
  summary: 'mission numerics constrain direction',
  qualityState: 'precision',
  freshnessState: 'fresh',
  lineageComplete: true,
  safeModeActive: false,
  publishPadOnly: false,
  hasDirectionalConstraint: true,
  hasMissionNumericOrbit: true
});
assert.equal(strongAzimuthAuthority.confidenceLabel, 'strong');
assert.equal(strongAzimuthAuthority.precisionEligible, true);
assert(strongAzimuthAuthority.trustScore >= 0.9);

const modeledUncertaintyAuthority = deriveTrajectoryFieldAuthorityProfile({
  field: 'uncertainty',
  authorityTier: 'public_metadata',
  summary: 'model prior uncertainty envelope',
  qualityState: 'search',
  freshnessState: 'unknown',
  lineageComplete: false,
  safeModeActive: true,
  publishPadOnly: false,
  hasDirectionalConstraint: false,
  uncertaintySampleCount: 0,
  sigmaDegP95: null
});
assert.equal(modeledUncertaintyAuthority.confidenceLabel, 'modeled');
assert.equal(modeledUncertaintyAuthority.precisionEligible, false);
assert(modeledUncertaintyAuthority.trustScore <= 0.35);

const adaptiveBaseBudget = { targetFps: 14, captureWidth: 288, maxFramesInFlight: 2 };
let adaptiveVisionState = { ...DEFAULT_VISION_TRACKER_ADAPTIVE_STATE };
adaptiveVisionState = advanceVisionTrackerAdaptiveState({
  backend: 'main_thread_roi',
  baseBudget: adaptiveBaseBudget,
  state: adaptiveVisionState,
  processingMs: 18,
  trackStatus: 'tracking',
  trackConfidence: 0.82
});
adaptiveVisionState = advanceVisionTrackerAdaptiveState({
  backend: 'main_thread_roi',
  baseBudget: adaptiveBaseBudget,
  state: adaptiveVisionState,
  processingMs: 19,
  trackStatus: 'tracking',
  trackConfidence: 0.85
});
assert.equal(adaptiveVisionState.loadTier, 1);
const degradedAdaptiveBudget = deriveAdaptiveVisionTrackerBudget({
  backend: 'main_thread_roi',
  baseBudget: adaptiveBaseBudget,
  state: adaptiveVisionState
});
assert(degradedAdaptiveBudget.captureWidth < adaptiveBaseBudget.captureWidth);
assert(degradedAdaptiveBudget.targetFps < adaptiveBaseBudget.targetFps);
assert.equal(degradedAdaptiveBudget.maxFramesInFlight, 1);

let recoveredAdaptiveState = adaptiveVisionState;
for (let i = 0; i < 8; i += 1) {
  recoveredAdaptiveState = advanceVisionTrackerAdaptiveState({
    backend: 'main_thread_roi',
    baseBudget: adaptiveBaseBudget,
    state: recoveredAdaptiveState,
    processingMs: 7,
    trackStatus: 'tracking',
    trackConfidence: 0.9
  });
}
assert.equal(recoveredAdaptiveState.loadTier, 0);
const efficientTrackingBudget = deriveAdaptiveVisionTrackerBudget({
  backend: 'worker_roi',
  baseBudget: { targetFps: 18, captureWidth: 320, maxFramesInFlight: 2 },
  state: {
    ...DEFAULT_VISION_TRACKER_ADAPTIVE_STATE,
    lastTrackStatus: 'tracking',
    lastTrackConfidence: 0.86
  }
});
assert(efficientTrackingBudget.captureWidth < 320);
assert(efficientTrackingBudget.targetFps <= 17);

const syntheticTracker = new VisionTrackerCore();
let syntheticTrack = syntheticTracker.processFrame(
  1,
  0,
  createSyntheticVisionFrame(64, 64, [{ cx: 32, cy: 30, radius: 2, luma: 232 }]),
  null
);
assert(syntheticTrack.centerNorm != null);
assert.notEqual(syntheticTrack.status, 'tracking');
syntheticTrack = syntheticTracker.processFrame(
  2,
  33,
  createSyntheticVisionFrame(64, 64, [{ cx: 33, cy: 31, radius: 2, luma: 234 }]),
  null
);
syntheticTrack = syntheticTracker.processFrame(
  3,
  66,
  createSyntheticVisionFrame(64, 64, [
    { cx: 34, cy: 31, radius: 2, luma: 236 },
    { cx: 58, cy: 8, radius: 3, luma: 255 }
  ]),
  null
);
assert(syntheticTrack.centerNorm != null);
assert(syntheticTrack.centerNorm!.xNorm < 0.7);
assert(Math.abs(syntheticTrack.centerNorm!.xNorm - 34 / 64) < 0.2);

const diffuseTracker = new VisionTrackerCore();
const diffuseTrack = diffuseTracker.processFrame(
  1,
  0,
  createSyntheticVisionFrame(64, 64, [{ cx: 32, cy: 32, radius: 16, luma: 224 }], 46),
  null
);
assert.notEqual(diffuseTrack.status, 'tracking');
assert(diffuseTrack.confidence < 0.6);

assert.deepEqual(AR_CLIENT_PROFILE_RELEASE_TARGETS, [
  'android_chrome',
  'android_samsung_internet',
  'ios_webkit',
  'android_fallback'
]);
assert.equal(
  detectArClientProfile(
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Mobile Safari/537.36'
  ),
  'android_chrome'
);
assert.equal(
  detectArClientProfile(
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/123.0 Mobile Safari/537.36'
  ),
  'android_samsung_internet'
);
assert.equal(
  detectArClientProfile(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  ),
  'ios_webkit'
);

const iosPolicy = getArClientProfilePolicy('ios_webkit');
assert.equal(iosPolicy.fallbackFirst, true);
assert.equal(iosPolicy.preferWebXr, false);
assert.equal(iosPolicy.motionPermissionPreflight, true);
const androidChromePolicy = getArClientProfilePolicy('android_chrome');
assert.equal(androidChromePolicy.fallbackFirst, false);
assert.equal(androidChromePolicy.preferWebXr, true);
assert.equal(androidChromePolicy.motionPermissionPreflight, false);
assert.deepEqual(
  deriveArTelemetryEntryState({
    cameraError: null,
    motionPermission: 'denied',
    adjustedHeading: 182,
    showSensorAssistOverlay: true
  }),
  {
    modeEntered: 'sky_compass',
    fallbackReason: 'motion_denied'
  }
);
assert.deepEqual(
  deriveArTelemetryEntryState({
    cameraError: null,
    motionPermission: 'granted',
    adjustedHeading: null,
    showSensorAssistOverlay: true
  }),
  {
    modeEntered: 'sky_compass',
    fallbackReason: 'no_heading'
  }
);
const runtimePolicySummary = summarizeArRuntimePolicies(
  [
    ...Array.from({ length: 10 }, () => ({
      client_profile: 'android_chrome',
      client_env: 'android_chrome',
      screen_bucket: 'md',
      pose_mode: 'webxr',
      xr_supported: true,
      xr_used: true,
      xr_error_bucket: 'session_error',
      fallback_reason: 'camera_error',
      mode_entered: 'sky_compass',
      time_to_lock_bucket: null,
      lock_on_attempted: true,
      lock_on_acquired: false,
      lock_loss_count: 0,
      vision_backend: 'worker_roi',
      runtime_degradation_tier: 3,
      loop_restart_count: 2,
      render_tier: 'low',
      dropped_frame_bucket: '30+'
    })),
    ...Array.from({ length: 14 }, () => ({
      client_profile: 'android_chrome',
      client_env: 'android_chrome',
      screen_bucket: 'lg',
      pose_mode: 'webxr',
      xr_supported: true,
      xr_used: true,
      xr_error_bucket: 'session_error',
      fallback_reason: 'camera_error',
      mode_entered: 'sky_compass',
      time_to_lock_bucket: null,
      lock_on_attempted: true,
      lock_on_acquired: false,
      lock_loss_count: 0,
      vision_backend: 'worker_roi',
      runtime_degradation_tier: 2,
      loop_restart_count: 1,
      render_tier: 'low',
      dropped_frame_bucket: '30+'
    })),
    ...Array.from({ length: 24 }, () => ({
      client_profile: 'android_samsung_internet',
      client_env: 'android_other',
      screen_bucket: 'md',
      pose_mode: 'webxr',
      xr_supported: true,
      xr_used: true,
      xr_error_bucket: null,
      fallback_reason: null,
      mode_entered: 'ar',
      time_to_lock_bucket: '<2s',
      lock_on_attempted: true,
      lock_on_acquired: true,
      lock_loss_count: 0,
      vision_backend: 'worker_roi',
      runtime_degradation_tier: 0,
      loop_restart_count: 0,
      render_tier: 'high',
      dropped_frame_bucket: '0..1'
    })),
    ...Array.from({ length: 24 }, () => ({
      client_profile: 'android_samsung_internet',
      client_env: 'android_other',
      screen_bucket: 'lg',
      pose_mode: 'webxr',
      xr_supported: true,
      xr_used: true,
      xr_error_bucket: null,
      fallback_reason: null,
      mode_entered: 'ar',
      time_to_lock_bucket: '2..5s',
      lock_on_attempted: true,
      lock_on_acquired: true,
      lock_loss_count: 0,
      vision_backend: 'worker_roi',
      runtime_degradation_tier: 0,
      loop_restart_count: 0,
      render_tier: 'high',
      dropped_frame_bucket: '0..1'
    })),
    ...Array.from({ length: 20 }, () => ({
      client_profile: 'android_samsung_internet',
      client_env: 'android_other',
      screen_bucket: 'sm',
      pose_mode: 'webxr',
      xr_supported: true,
      xr_used: true,
      xr_error_bucket: null,
      fallback_reason: null,
      mode_entered: 'ar',
      time_to_lock_bucket: '<2s',
      lock_on_attempted: true,
      lock_on_acquired: true,
      lock_loss_count: 0,
      vision_backend: 'worker_roi',
      runtime_degradation_tier: 0,
      loop_restart_count: 0,
      render_tier: 'high',
      dropped_frame_bucket: '0..1'
    }))
  ],
  { sampleLimit: 100 }
);
const chromeRuntimePolicy = runtimePolicySummary.profiles.find((entry) => entry.profile === 'android_chrome');
assert.equal(chromeRuntimePolicy?.recommendedPoseMode, 'sensor_fused');
assert.equal(chromeRuntimePolicy?.applyInRuntime, true);
assert.equal(chromeRuntimePolicy?.fieldReady, true);
const samsungRuntimePolicy = runtimePolicySummary.profiles.find((entry) => entry.profile === 'android_samsung_internet');
assert.equal(samsungRuntimePolicy?.recommendedPoseMode, 'webxr');
assert.equal(samsungRuntimePolicy?.applyInRuntime, true);
assert.equal(samsungRuntimePolicy?.fieldReady, true);
const plannedOnlyRuntimeSummary = summarizeArRuntimePolicies(
  [
    {
      client_profile: 'android_chrome',
      client_env: 'android_chrome',
      screen_bucket: 'md',
      pose_mode: 'webxr',
      xr_supported: true,
      xr_used: false,
      xr_error_bucket: null,
      fallback_reason: null,
      mode_entered: 'ar',
      time_to_lock_bucket: null,
      lock_on_attempted: false,
      lock_on_acquired: false,
      lock_loss_count: 0,
      vision_backend: 'worker_roi',
      runtime_degradation_tier: 0,
      loop_restart_count: 0,
      render_tier: 'high',
      dropped_frame_bucket: '0..1'
    }
  ],
  { sampleLimit: 10 }
);
const plannedOnlyRuntimeProfile = plannedOnlyRuntimeSummary.profiles.find((entry) => entry.profile === 'android_chrome');
assert.equal(plannedOnlyRuntimeProfile?.xrUsedSessions, 0);
assert.equal(plannedOnlyRuntimeProfile?.xrHealthySessions, 0);
const demotedRuntime = selectArRuntime({
  profile: 'android_chrome',
  xrSupport: 'supported',
  xrActive: false,
  xrLaunchState: 'idle',
  cameraActive: true,
  cameraError: null,
  motionPermission: 'granted',
  workerVisionSupported: true,
  mainThreadVisionSupported: true,
  telemetryRecommendedPoseMode: 'sensor_fused'
});
assert.equal(demotedRuntime.poseMode, 'sensor_fused');
const promotedSamsungRuntime = selectArRuntime({
  profile: 'android_samsung_internet',
  xrSupport: 'supported',
  xrActive: false,
  xrLaunchState: 'idle',
  cameraActive: true,
  cameraError: null,
  motionPermission: 'granted',
  workerVisionSupported: true,
  mainThreadVisionSupported: true,
  telemetryRecommendedPoseMode: 'webxr'
});
assert.equal(promotedSamsungRuntime.poseMode, 'webxr');
assert.equal(
  shouldAutoStartWebXr({
    profile: 'android_chrome',
    policyHydrated: true,
    poseMode: demotedRuntime.poseMode,
    xrSupport: 'supported',
    xrActive: false,
    xrLaunchState: 'idle',
    autoStartAttempted: false
  }),
  false
);
assert.equal(
  shouldAutoStartWebXr({
    profile: 'android_samsung_internet',
    policyHydrated: true,
    poseMode: promotedSamsungRuntime.poseMode,
    xrSupport: 'supported',
    xrActive: false,
    xrLaunchState: 'idle',
    autoStartAttempted: false
  }),
  true
);
assert.equal(
  shouldAutoStartWebXr({
    profile: 'android_chrome',
    policyHydrated: true,
    poseMode: 'webxr',
    xrSupport: 'supported',
    xrActive: false,
    xrLaunchState: 'starting',
    autoStartAttempted: false
  }),
  false
);
assert.equal(
  shouldAutoStartWebXr({
    profile: 'android_chrome',
    policyHydrated: false,
    poseMode: 'webxr',
    xrSupport: 'supported',
    xrActive: false,
    xrLaunchState: 'idle',
    autoStartAttempted: false
  }),
  false
);

const blockingBottomGuidance = deriveArBottomGuidance({
  headingHint: 'Enable motion',
  pitchHint: 'Tilt up/down',
  rollHint: 'Level phone'
});
assert.equal(blockingBottomGuidance.primaryGuidance, 'Enable motion');
assert.deepEqual(blockingBottomGuidance.secondaryGuidance, []);

const startupBottomGuidance = deriveArBottomGuidance({
  headingHint: 'Turn left/right',
  pitchHint: 'Tilt up/down',
  rollHint: 'Level phone'
});
assert.equal(startupBottomGuidance.primaryGuidance, 'Turn left/right');
assert.deepEqual(startupBottomGuidance.secondaryGuidance, ['Tilt up/down', 'Level phone']);

const settlingBottomGuidance = deriveArBottomGuidance({
  headingHint: 'Tracking settling',
  pitchHint: 'Tilt up/down',
  rollHint: 'Level phone'
});
assert.equal(settlingBottomGuidance.primaryGuidance, 'Tracking settling');
assert.deepEqual(settlingBottomGuidance.secondaryGuidance, []);

const alignedBottomGuidance = deriveArBottomGuidance({
  headingHint: 'Aligned',
  pitchHint: 'Level',
  rollHint: 'Phone level'
});
assert.equal(alignedBottomGuidance.primaryGuidance, 'On track');
assert.deepEqual(alignedBottomGuidance.secondaryGuidance, []);

const evidenceWithFullLineage = deriveTrajectoryEvidenceView({
  confidenceTier: 'A',
  sourceSufficiency: { sourceSummary: { code: 'corroborated_landing' } },
  lineageComplete: true
});
assert.equal(evidenceWithFullLineage.evidenceLabel, 'Constraint-backed (corroborated landing)');
assert.equal(evidenceWithFullLineage.confidenceBadge, 'high');
assert.equal(evidenceWithFullLineage.confidenceBadgeLabel, 'High confidence');

const evidenceWithPartialLineage = deriveTrajectoryEvidenceView({
  confidenceTier: 'A',
  sourceSufficiency: { sourceSummary: { code: 'corroborated_landing' } },
  lineageComplete: false
});
assert.equal(evidenceWithPartialLineage.confidenceBadge, 'medium');
assert.equal(evidenceWithPartialLineage.confidenceBadgeLabel, 'Confidence limited (lineage partial)');

const landingPriorEvidence = deriveTrajectoryEvidenceView({
  confidenceTier: 'C',
  sourceSufficiency: { sourceSummary: { code: 'landing_prior' } },
  lineageComplete: true
});
assert.equal(landingPriorEvidence.evidenceLabel, 'Landing prior');

const padOnlyEvidence = deriveTrajectoryEvidenceView({
  confidenceTier: 'D',
  qualityLabel: 'pad_only'
});
assert.equal(padOnlyEvidence.evidenceLabel, 'Pad-only');

const publishPolicyPass = deriveTrajectoryPublishPolicy({
  quality: 1,
  qualityLabel: 'landing_constrained',
  sourceSufficiency: {
    status: 'pass',
    missingFields: [],
    blockingReasons: []
  },
  freshnessState: 'fresh',
  lineageComplete: true
});
assert.equal(publishPolicyPass.precisionClaim, true);
assert.equal(publishPolicyPass.enforcePadOnly, false);
assert.equal(publishPolicyPass.reasons.length, 0);

const publishPolicyEstimate = deriveTrajectoryPublishPolicy({
  quality: 2,
  qualityLabel: 'estimate_corridor',
  sourceSufficiency: {
    status: 'fail',
    missingFields: ['directional_constraint'],
    blockingReasons: ['no_constraint_lineage']
  },
  freshnessState: 'stale',
  lineageComplete: false
});
assert.equal(publishPolicyEstimate.precisionClaim, false);
assert.equal(publishPolicyEstimate.enforcePadOnly, false);
assert.equal(publishPolicyEstimate.reasons.length, 0);

const publishPolicyLandingFail = deriveTrajectoryPublishPolicy({
  quality: 1,
  qualityLabel: 'landing_constrained',
  sourceSufficiency: {
    status: 'fail',
    missingFields: ['directional_constraint'],
    blockingReasons: ['no_constraint_lineage']
  },
  freshnessState: 'stale',
  lineageComplete: false
});
assert.equal(publishPolicyLandingFail.enforcePadOnly, true);
assert(publishPolicyLandingFail.reasons.includes('source_contract_failed'));
assert(publishPolicyLandingFail.reasons.includes('sources_stale'));
assert(publishPolicyLandingFail.reasons.includes('lineage_incomplete'));
assert(publishPolicyLandingFail.reasons.includes('missing_required_fields'));
assert(publishPolicyLandingFail.reasons.includes('blocking_reasons_present'));

const guardedProduct = applyTrajectoryPublishPolicyToProduct(
  {
    qualityLabel: 'landing_constrained',
    samples: [{ tPlusSec: 0, ecef: [0, 0, 0] }],
    events: [{ key: 'LIFTOFF', tPlusSec: 0, label: 'Liftoff' }],
    milestones: [
      {
        key: 'LIFTOFF',
        tPlusSec: 0,
        label: 'Liftoff',
        phase: 'core_ascent',
        trackKind: 'core_up',
        sourceType: 'll2_timeline',
        sourceRefIds: ['ll2:timeline:liftoff'],
        estimated: false,
        projectable: true
      }
    ]
  },
  publishPolicyLandingFail
);
assert.equal(guardedProduct?.qualityLabel, 'pad_only');
assert.deepEqual(guardedProduct?.samples, []);
assert.deepEqual(guardedProduct?.events, []);
assert.equal(Array.isArray(guardedProduct?.milestones), true);
assert.equal((guardedProduct?.milestones as Array<unknown>).length, 1);

const resolvedMilestones = resolveTrajectoryMilestones({
  ll2Timeline: [
    { relative_time: '-PT45S', type: { description: 'GO for Launch' } },
    { relative_time: '-PT10M', type: { description: 'Startup' } },
    { relative_time: 'PT2M30S', type: { abbrev: 'MECO', description: 'Main Engine Cutoff' } },
    { relative_time: 'PT2M35S', type: { description: 'Stage 2 Separation' } },
    { relative_time: 'PT2M58S', type: { description: 'Fairing Separation' } },
    { relative_time: 'PT8M40S', type: { description: 'SES-1' } }
  ],
  providerExternalContent: [
    {
      source: 'spacex_content',
      contentType: 'resource_bundle',
      sourceId: 'mission-1',
      confidence: 0.92,
      fetchedAt: '2026-03-05T11:55:00.000Z',
      timelineEvents: [
        { label: 'Landing burn', time: 'T+08:10', phase: 'postlaunch' },
        { label: 'Landing', time: 'T+08:35', phase: 'postlaunch' }
      ]
    }
  ],
  rocketFamily: 'Falcon 9',
  includeFamilyTemplate: true
});
assert.equal(formatTrajectoryMilestoneOffsetLabel(-90), 'T-1:30');
assert.equal(resolvedMilestones.find((milestone) => milestone.key === 'MECO')?.sourceType, 'll2_timeline');
assert.equal(resolvedMilestones.find((milestone) => milestone.key === 'LANDING')?.sourceType, 'provider_timeline');
assert.equal(resolvedMilestones.find((milestone) => milestone.phase === 'prelaunch')?.projectable, false);
assert.equal(resolvedMilestones.find((milestone) => milestone.phase === 'prelaunch')?.projectionReason, 'phase_not_projectable');
assert.equal(resolvedMilestones.find((milestone) => milestone.label === 'GO for Launch')?.phase, 'prelaunch');
assert.equal(resolvedMilestones.find((milestone) => milestone.label === 'Stage 2 Separation')?.phase, 'core_ascent');
assert.equal(resolvedMilestones.find((milestone) => milestone.label === 'Fairing Separation')?.trackKind, 'core_up');
assert.equal(resolvedMilestones.find((milestone) => milestone.label === 'SES-1')?.phase, 'upper_stage');
assert.equal(resolvedMilestones.find((milestone) => milestone.label === 'SES-1')?.trackKind, 'upper_stage_up');

const projectedMilestones = applyTrajectoryMilestoneProjection({
  milestones: resolvedMilestones,
  trackWindows: [{ trackKind: 'core_up', minTPlusSec: 0, maxTPlusSec: 540 }]
});
assert.equal(projectedMilestones.milestones.find((milestone) => milestone.key === 'LANDING_BURN')?.projectionReason, 'missing_track');
assert.equal(projectedMilestones.milestones.find((milestone) => milestone.key === 'LANDING')?.projectionReason, 'missing_track');
assert.equal(projectedMilestones.summary.missingTrackCount >= 2, true);

const compatibilityMilestones = buildTrajectoryCompatibilityEvents(projectedMilestones.milestones);
assert.equal(compatibilityMilestones.some((milestone) => milestone.key === 'MECO'), true);
assert.equal(compatibilityMilestones.some((milestone) => milestone.key === 'LANDING'), false);

const trajectorySmokeRow = {
  launch_id: 'trajectory-smoke',
  version: 'trajectory_v1',
  quality: 2,
  generated_at: '2026-03-05T12:00:00.000Z',
  product: {
    version: 'trajectory_v1',
    qualityLabel: 'estimate_corridor',
    samples: [{ tPlusSec: 0, ecef: [1, 2, 3], sigmaDeg: 12 }],
    events: [{ key: 'LIFTOFF', tPlusSec: 0, label: 'Liftoff' }]
  },
  confidence_tier: 'B',
  source_sufficiency: {
    status: 'pass',
    missingFields: [],
    blockingReasons: [],
    sourceSummary: { code: 'constraint_backed' },
    sourceFreshness: {
      latestSignalAt: '2026-03-05T11:37:00.000Z'
    }
  },
  freshness_state: 'fresh',
  lineage_complete: true
};
const trajectoryContract = buildTrajectoryContract(trajectorySmokeRow);
assert.equal(trajectoryContract?.evidenceEpoch, '2026-03-05T11:37:00.000Z');
const trajectoryPublicV2 = buildTrajectoryPublicV2Response(trajectorySmokeRow);
assert.equal(trajectoryContract?.qualityState, 'guided');
assert.equal(trajectoryPublicV2?.qualityState, 'safe_corridor');
assert.equal(trajectoryPublicV2?.modelVersion, 'trajectory_v1');
assert.equal(trajectoryPublicV2?.tracks.length, 1);
assert.equal(trajectoryPublicV2?.guidanceSemantics, 'modeled');
assert.deepEqual(trajectoryPublicV2?.trackTopology, {
  hasStageSplit: false,
  hasUpperStageTrack: false,
  hasBoosterTrack: false
});

const milestoneAwareContract = buildTrajectoryContract({
  launch_id: 'trajectory-milestones',
  version: 'trajectory_v2',
  quality: 2,
  generated_at: '2026-03-05T12:00:00.000Z',
  product: {
    version: 'trajectory_v2',
    qualityLabel: 'estimate_corridor',
    tracks: [
      {
        trackKind: 'core_up',
        samples: [
          { tPlusSec: 0, ecef: ecefFromLatLon(28.57, -81.3, 0), sigmaDeg: 12 },
          { tPlusSec: 540, ecef: ecefFromLatLon(28.8, -80.7, 250_000), sigmaDeg: 8 }
        ]
      }
    ],
    milestones: projectedMilestones.milestones
  },
  confidence_tier: 'B',
  source_sufficiency: {
    status: 'pass',
    missingFields: [],
    blockingReasons: [],
    sourceSummary: { code: 'constraint_backed' },
    signalSummary: {
      hasPad: true,
      hasDirectionalConstraint: true,
      hasLandingDirectional: false,
      hasHazardDirectional: false,
      hasMissionNumericOrbit: false,
      hasSupgpConstraint: false,
      hasLicensedTrajectoryFeed: false
    }
  },
  freshness_state: 'fresh',
  lineage_complete: true
});
assert.equal(milestoneAwareContract?.milestones.find((milestone) => milestone.phase === 'prelaunch')?.tPlusSec, -600);
assert.equal(milestoneAwareContract?.milestones.find((milestone) => milestone.key === 'LANDING')?.projectable, false);
assert.equal(milestoneAwareContract?.milestones.find((milestone) => milestone.key === 'LANDING')?.projectionReason, 'missing_track');
assert.equal(milestoneAwareContract?.milestones.find((milestone) => milestone.key === 'LANDING')?.sourceType, 'provider_timeline');

const partnerTrajectoryContract = buildTrajectoryContract({
  launch_id: 'trajectory-partner',
  version: 'trajectory_v1',
  quality: 2,
  generated_at: '2026-03-05T12:00:00.000Z',
  product: {
    version: 'trajectory_v1',
    qualityLabel: 'landing_constrained',
    samples: [{ tPlusSec: 0, ecef: [1, 2, 3], sigmaDeg: 3 }],
    events: [{ key: 'LIFTOFF', tPlusSec: 0, label: 'Liftoff' }]
  },
  confidence_tier: 'A',
  source_sufficiency: {
    status: 'pass',
    missingFields: [],
    blockingReasons: [],
    sourceSummary: { code: 'partner_feed', label: 'Partner feed' },
    signalSummary: {
      hasPad: true,
      hasDirectionalConstraint: true,
      hasLandingDirectional: false,
      hasHazardDirectional: false,
      hasMissionNumericOrbit: false,
      hasSupgpConstraint: false,
      hasLicensedTrajectoryFeed: true
    }
  },
  freshness_state: 'fresh',
  lineage_complete: true
});
assert.equal(partnerTrajectoryContract?.authorityTier, 'partner_feed');
assert.equal(partnerTrajectoryContract?.sourceBlend.hasLicensedTrajectoryFeed, true);
assert.equal(partnerTrajectoryContract?.evidenceLabel, 'Partner feed');

const normalizedPartnerFeed = normalizePartnerTrajectoryFeedInput({
  launch_id: '11111111-1111-4111-8111-111111111111',
  feed_id: 'feed-1',
  flight_azimuth_deg: 91.5,
  altitude_km: 540,
  source_url: 'https://partner.example/feed/1'
});
assert(normalizedPartnerFeed);
const partnerConstraintRow = buildPartnerTrajectoryConstraintRow(normalizedPartnerFeed!);
assert.equal(partnerConstraintRow.source, 'partner_feed');
assert.equal(partnerConstraintRow.license_class, 'licensed_partner');
assert.equal(partnerConstraintRow.data.partnerFeed, true);
assert.equal(partnerConstraintRow.data.sourceTier, 'truth');
const guidanceTrajectoryContract = buildTrajectoryContract({
  launch_id: 'trajectory-guidance',
  version: 'trajectory_v2',
  quality: 1,
  generated_at: '2026-03-05T12:00:00.000Z',
  product: {
    version: 'trajectory_v2',
    tracks: [
      {
        trackKind: 'core_up',
        samples: [
          { tPlusSec: 60, ecef: ecefFromLatLon(28.57, -81.3, 130_000), sigmaDeg: 6 },
          { tPlusSec: 120, ecef: ecefFromLatLon(28.6, -81.22, 170_000), sigmaDeg: 5 },
          { tPlusSec: 180, ecef: ecefFromLatLon(28.64, -81.12, 210_000), sigmaDeg: 5 },
          { tPlusSec: 240, ecef: ecefFromLatLon(28.69, -81.0, 230_000), sigmaDeg: 6 }
        ]
      }
    ],
    milestones: [{ key: 'MECO', tPlusSec: 210, label: 'MECO' }]
  },
  confidence_tier: 'B',
  source_sufficiency: {
    status: 'pass',
    missingFields: [],
    blockingReasons: [],
    sourceSummary: { code: 'constraint_backed' },
    sourceFreshness: {
      latestSignalAt: '2026-03-05T11:37:00.000Z'
    }
  },
  freshness_state: 'fresh',
  lineage_complete: true
});
const guidance = deriveJepGuidance({
  trajectory: guidanceTrajectoryContract,
  observer: { latDeg: 28.538336, lonDeg: -81.379234 },
  launchNetIso: '2026-01-18T10:50:00.000Z',
  currentScore: 58,
  lineOfSightFactor: 0.75,
  weatherFactor: 0.82
});
assert.equal(guidance.scenarioWindows.length, 3);
assert(guidance.bestWindow != null);
assert(guidance.directionBand != null);
assert(guidance.elevationBand != null);
assert((guidance.elevationBand?.maxDeg ?? 0) > 0);
assert.deepEqual(
  applyJepObserverGuidancePolicy(guidance, { allowObserverGuidance: false }),
  {
    bestWindow: null,
    directionBand: null,
    elevationBand: null,
    scenarioWindows: []
  }
);
assert.equal(allowNwsFallbackForObserverSource('pad'), true);
assert.equal(allowNwsFallbackForObserverSource('observer_registry'), false);
const positiveHazardRescan = mergeHazardScanState(emptyHazardScanState(), {
  signalAtMs: Date.parse('2026-03-05T12:30:00.000Z'),
  matched: true
});
assert.equal(
  shouldSuppressHazardConstraintFromScanState({
    fetchedAtMs: Date.parse('2026-03-05T12:00:00.000Z'),
    sourceState: positiveHazardRescan
  }),
  false
);
const negativeHazardRescan = mergeHazardScanState(positiveHazardRescan, {
  signalAtMs: Date.parse('2026-03-05T13:00:00.000Z'),
  matched: false
});
assert.equal(negativeHazardRescan.matchedAtMs, Date.parse('2026-03-05T12:30:00.000Z'));
assert.equal(
  shouldSuppressHazardConstraintFromScanState({
    fetchedAtMs: Date.parse('2026-03-05T12:00:00.000Z'),
    sourceState: negativeHazardRescan
  }),
  true
);
assert.deepEqual(
  dedupeTrajectoryReasonLabels(['sources_stale', 'missing_required_fields', 'directional_constraint', 'sources_stale']),
  ['source evidence is stale', 'required trajectory fields are missing', 'directional constraint missing']
);
assert.deepEqual(buildVisionCropRect(320, 180, { centerXNorm: 0.5, centerYNorm: 0.5, widthNorm: 0.5, heightNorm: 0.5 }), {
  xPx: 80,
  yPx: 45,
  widthPx: 160,
  heightPx: 90,
  fullWidthPx: 320,
  fullHeightPx: 180
});
assert.deepEqual(
  mapVisionNormPointFromCropRect(
    { xNorm: 0.5, yNorm: 0.5 },
    { xPx: 80, yPx: 45, widthPx: 160, heightPx: 90, fullWidthPx: 320, fullHeightPx: 180 }
  ),
  { xNorm: 0.5, yNorm: 0.5 }
);
const projectedCenter = projectAzElToViewportNorm({
  targetAzDeg: 100,
  targetElDeg: 20,
  headingDeg: 100,
  pitchDeg: 20,
  rollDeg: 0,
  fovXDeg: 70,
  fovYDeg: 45
});
assert.deepEqual(projectedCenter, { xNorm: 0.5, yNorm: 0.5 });
assert.deepEqual(
  viewportNormToAngleOffsetsDeg({
    point: { xNorm: 0.5, yNorm: 0.5 },
    rollDeg: 0,
    fovXDeg: 70,
    fovYDeg: 45
  }),
  { yawDeg: 0, pitchDeg: 0 }
);
const stableAlignment = deriveAlignmentFeedback({
  residuals: [
    { yawDeg: 1.1, pitchDeg: 0.8, confidence: 0.84 },
    { yawDeg: 0.7, pitchDeg: 0.6, confidence: 0.86 },
    { yawDeg: 0.9, pitchDeg: 0.7, confidence: 0.85 },
    { yawDeg: 0.8, pitchDeg: 0.5, confidence: 0.87 },
    { yawDeg: 1.0, pitchDeg: 0.6, confidence: 0.83 }
  ],
  lockTracking: true,
  lockConfidence: 0.88,
  autoAlignmentReady: true,
  degradationTier: 0,
  baseCorridorMode: 'normal',
  authorityTier: 'official_numeric',
  azimuthAuthorityTier: 'official_numeric',
  uncertaintyAuthorityTier: 'supplemental_ephemeris',
  qualityState: 'precision',
  safeModeActive: false,
  publishPadOnly: false
});
assert.equal(stableAlignment.stability, 'stable');
assert.equal(stableAlignment.biasConfidence, 'high');
assert.equal(stableAlignment.readyForPrecision, true);
assert.equal(stableAlignment.recommendedCorridorMode, 'tight');
const driftingAlignment = deriveAlignmentFeedback({
  residuals: [
    { yawDeg: 7.2, pitchDeg: 4.9, confidence: 0.73 },
    { yawDeg: 6.8, pitchDeg: 5.3, confidence: 0.68 },
    { yawDeg: 8.1, pitchDeg: 4.7, confidence: 0.7 },
    { yawDeg: 7.6, pitchDeg: 5.5, confidence: 0.66 }
  ],
  lockTracking: true,
  lockConfidence: 0.7,
  autoAlignmentReady: true,
  degradationTier: 1,
  baseCorridorMode: 'tight',
  authorityTier: 'public_metadata',
  azimuthAuthorityTier: 'public_metadata',
  uncertaintyAuthorityTier: 'public_metadata',
  qualityState: 'guided',
  safeModeActive: false,
  publishPadOnly: false
});
assert.equal(driftingAlignment.stability, 'drifting');
assert.equal(driftingAlignment.recommendedCorridorMode, 'wide');
const safeModeAlignment = deriveAlignmentFeedback({
  residuals: [
    { yawDeg: 1, pitchDeg: 0.8, confidence: 0.82 },
    { yawDeg: 1.2, pitchDeg: 0.7, confidence: 0.84 },
    { yawDeg: 0.9, pitchDeg: 0.6, confidence: 0.83 },
    { yawDeg: 1.1, pitchDeg: 0.9, confidence: 0.81 }
  ],
  lockTracking: true,
  lockConfidence: 0.82,
  autoAlignmentReady: true,
  degradationTier: 0,
  baseCorridorMode: 'tight',
  authorityTier: 'regulatory_constrained',
  azimuthAuthorityTier: 'regulatory_constrained',
  uncertaintyAuthorityTier: 'regulatory_constrained',
  qualityState: 'guided',
  safeModeActive: true,
  publishPadOnly: false
});
assert.equal(safeModeAlignment.recommendedCorridorMode, 'wide');
assert.equal(
  classifyArPerformanceTier({
    frameCount: 48,
    avgFrameMs: 18,
    slowFrameRatio: 0.08,
    severeFrameRatio: 0.01
  }),
  0
);
assert.equal(
  classifyArPerformanceTier({
    frameCount: 48,
    avgFrameMs: 31,
    slowFrameRatio: 0.36,
    severeFrameRatio: 0.1
  }),
  2
);
assert.deepEqual(getArPerformancePolicy(3), {
  reducedEffects: true,
  milestoneDensity: 'off',
  lockPredictionDepth: 0,
  showRollAssist: false,
  dprCap: 1.35
});
assert.deepEqual(
  advanceArPerformanceGovernor(
    { tier: 2, recoveryStreak: 2 },
    {
      frameCount: 48,
      avgFrameMs: 17,
      slowFrameRatio: 0.05,
      severeFrameRatio: 0
    }
  ),
  { tier: 1, recoveryStreak: 0 }
);

const capeDeclination = getDeclinationDeg({
  lat: 28.573255,
  lon: -80.646895,
  atDate: new Date('2026-02-01T00:00:00.000Z')
});
assert(Number.isFinite(capeDeclination.declinationDeg));
assert(Math.abs(capeDeclination.declinationDeg) <= 40);
assert(capeDeclination.source === 'wmm' || capeDeclination.source === 'approx');

// Geo sanity: bearingDegrees must agree with ENU azimuth (independent implementation).
const orlando = { lat: 28.538336, lon: -81.379234 };
const slc41 = { lat: 28.58341025, lon: -80.58303644 };
const bearingToSlc41 = bearingDegrees(orlando.lat, orlando.lon, slc41.lat, slc41.lon);
const userEcef = ecefFromLatLon(orlando.lat, orlando.lon, 0);
const padEcef = ecefFromLatLon(slc41.lat, slc41.lon, 0);
const enu = enuFromEcef(orlando.lat, orlando.lon, userEcef, padEcef);
const az = azElFromEnu(enu).azDeg;
assert(Math.abs(normalizeAngleDelta(bearingToSlc41 - az)) < 0.15);
const horizKm = Math.sqrt(enu[0] * enu[0] + enu[1] * enu[1]) / 1000;
assert(horizKm > 40 && horizKm < 140);
const screenAngleDeg = 270 as const;
const screenAngleSignedDeg = screenAngleDeg > 180 ? screenAngleDeg - 360 : screenAngleDeg;
assert.equal(screenAngleSignedDeg, -90);
assert.equal(wrapAngle360(10 + screenAngleSignedDeg), 280);
assert.equal(wrapAngle360(10 + 90), 100);

const invalidDeclination = getDeclinationDeg({ lat: Number.NaN, lon: 0 });
assert.equal(invalidDeclination.source, 'none');
assert.equal(invalidDeclination.declinationDeg, 0);

assert.deepEqual(normalizeTrajectoryCovariance({ along_track: 7, cross_track: 11 }), {
  alongTrackDeg: 7,
  crossTrackDeg: 11
});
assert.deepEqual(normalizeTrajectoryCovariance({ alongTrackDeg: 5, crossTrackDeg: 9 }), {
  alongTrackDeg: 5,
  crossTrackDeg: 9
});
assert.deepEqual(
  normalizeTrajectoryUncertainty({
    sigmaDeg: 12,
    covariance: { along_track: 6, cross_track: 12 }
  }),
  {
    sigmaDeg: 12,
    covariance: { alongTrackDeg: 6, crossTrackDeg: 12 }
  }
);

const mixedUncertaintyPoints = [
  { tPlusSec: 0, azDeg: 90, elDeg: 15, sigmaDeg: 10 },
  {
    tPlusSec: 10,
    azDeg: 110,
    elDeg: 25,
    uncertainty: { sigmaDeg: 14, covariance: { alongTrackDeg: 9, crossTrackDeg: 14 } }
  }
];
const mixedInterpolated = interpolateTrajectory(mixedUncertaintyPoints, 5);
assert(mixedInterpolated != null);
assert.equal(readTrajectoryPointSigmaDeg(mixedInterpolated), 12);
assert.deepEqual(readTrajectoryPointCovariance(mixedInterpolated), {
  alongTrackDeg: 9,
  crossTrackDeg: 14
});

const covarianceOnlyPoints = [
  {
    tPlusSec: 0,
    azDeg: 60,
    elDeg: 10,
    uncertainty: { sigmaDeg: 8, covariance: { alongTrackDeg: 5, crossTrackDeg: 8 } }
  },
  {
    tPlusSec: 10,
    azDeg: 72,
    elDeg: 18,
    uncertainty: { sigmaDeg: 12, covariance: { alongTrackDeg: 9, crossTrackDeg: 12 } }
  }
];
const covarianceInterpolated = interpolateTrajectory(covarianceOnlyPoints, 5);
assert(covarianceInterpolated != null);
assert.equal(readTrajectoryPointSigmaDeg(covarianceInterpolated), 10);
assert.deepEqual(readTrajectoryPointCovariance(covarianceInterpolated), {
  alongTrackDeg: 7,
  crossTrackDeg: 10
});

const replayReport = runReplayBenchmark({
  schemaVersion: 1,
  seed: 'smoke-seed-v1',
  cases: [
    {
      id: 'smoke-valid',
      predictedSamples: [
        { tPlusSec: 0, azDeg: 100.0, elDeg: 20.0 },
        { tPlusSec: 10, azDeg: 102.0, elDeg: 20.8 },
        { tPlusSec: 20, azDeg: 104.2, elDeg: 21.5 }
      ],
      referenceSamples: [
        { tPlusSec: 0, azDeg: 100.5, elDeg: 20.1 },
        { tPlusSec: 10, azDeg: 102.7, elDeg: 21.0 },
        { tPlusSec: 20, azDeg: 105.1, elDeg: 21.9 }
      ]
    },
    {
      id: 'smoke-skipped',
      predictedSamples: [{ tPlusSec: 0, azDeg: 0, elDeg: 0 }],
      referenceSamples: [{ tPlusSec: 0, azDeg: 0, elDeg: 0 }]
    }
  ]
});

assert.equal(replayReport.fixtureCaseCount, 2);
assert.equal(replayReport.evaluatedCaseCount, 1);
assert.equal(replayReport.sampleCount, 3);
assert.equal(replayReport.skippedCases.length, 1);
assert(replayReport.overall != null);
assert(replayReport.overall.p50ErrorDeg > 0);
assert(replayReport.overall.p95ErrorDeg < 2);
assert(Number.isFinite(replayReport.overall.slopeDegPerMin));

console.log('Smoke tests passed.');

function createSyntheticVisionFrame(
  width: number,
  height: number,
  spots: Array<{ cx: number; cy: number; radius: number; luma: number }>,
  backgroundLuma = 12
) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let luma = backgroundLuma;
      for (const spot of spots) {
        const dist = Math.hypot(x - spot.cx, y - spot.cy);
        if (dist <= spot.radius) {
          const falloff = clampTestValue(1 - dist / Math.max(1, spot.radius + 0.25), 0.25, 1);
          luma = Math.max(luma, Math.round(spot.luma * falloff));
        }
      }
      const idx = (y * width + x) * 4;
      data[idx] = luma;
      data[idx + 1] = luma;
      data[idx + 2] = luma;
      data[idx + 3] = 255;
    }
  }
  return {
    width,
    height,
    data,
    colorSpace: 'srgb'
  } as unknown as ImageData;
}

function clampTestValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
