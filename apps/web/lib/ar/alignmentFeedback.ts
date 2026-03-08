import type { TrajectoryAuthorityTier, TrajectoryQualityState } from '@/lib/server/trajectoryContract';

export type AlignmentStability = 'inactive' | 'settling' | 'stable' | 'drifting';
export type AlignmentBiasConfidence = 'low' | 'medium' | 'high';
export type AlignmentCorridorMode = 'tight' | 'normal' | 'wide';

export type AlignmentResidualSample = {
  yawDeg: number;
  pitchDeg: number;
  confidence: number;
};

export type AlignmentFeedback = {
  sampleCount: number;
  averageConfidence: number | null;
  yawMeanDeg: number | null;
  pitchMeanDeg: number | null;
  yawStdDeg: number | null;
  pitchStdDeg: number | null;
  residualMagnitudeDeg: number | null;
  stability: AlignmentStability;
  biasConfidence: AlignmentBiasConfidence;
  recommendedCorridorMode: AlignmentCorridorMode;
  readyForPrecision: boolean;
  correctionGain: number;
};

export type AlignmentFeedbackInput = {
  residuals: AlignmentResidualSample[];
  lockTracking: boolean;
  lockConfidence: number | null;
  autoAlignmentReady: boolean;
  degradationTier: 0 | 1 | 2 | 3;
  baseCorridorMode: AlignmentCorridorMode;
  authorityTier: TrajectoryAuthorityTier;
  authorityTrustScore?: number | null;
  azimuthAuthorityTier: TrajectoryAuthorityTier;
  azimuthTrustScore?: number | null;
  uncertaintyAuthorityTier: TrajectoryAuthorityTier;
  uncertaintyTrustScore?: number | null;
  qualityState: TrajectoryQualityState;
  safeModeActive: boolean;
  publishPadOnly: boolean;
};

export const DEFAULT_ALIGNMENT_FEEDBACK: AlignmentFeedback = Object.freeze({
  sampleCount: 0,
  averageConfidence: null,
  yawMeanDeg: null,
  pitchMeanDeg: null,
  yawStdDeg: null,
  pitchStdDeg: null,
  residualMagnitudeDeg: null,
  stability: 'inactive',
  biasConfidence: 'low',
  recommendedCorridorMode: 'wide',
  readyForPrecision: false,
  correctionGain: 0
});

function authorityScore(authorityTier: TrajectoryAuthorityTier) {
  if (authorityTier === 'partner_feed' || authorityTier === 'official_numeric') return 1;
  if (authorityTier === 'regulatory_constrained' || authorityTier === 'supplemental_ephemeris') return 0.82;
  if (authorityTier === 'public_metadata') return 0.6;
  return 0.35;
}

function resolveAuthorityTrust(authorityTier: TrajectoryAuthorityTier, trustScore?: number | null) {
  if (typeof trustScore === 'number' && Number.isFinite(trustScore)) {
    return Math.min(1, Math.max(0.15, trustScore));
  }
  return authorityScore(authorityTier);
}

function widerCorridorMode(mode: AlignmentCorridorMode): AlignmentCorridorMode {
  if (mode === 'tight') return 'normal';
  return 'wide';
}

function tighterCorridorMode(mode: AlignmentCorridorMode): AlignmentCorridorMode {
  if (mode === 'wide') return 'normal';
  return 'tight';
}

function mean(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], meanValue: number | null) {
  if (values.length === 0 || meanValue == null) return null;
  const variance = values.reduce((sum, value) => sum + (value - meanValue) * (value - meanValue), 0) / values.length;
  return Math.sqrt(variance);
}

export function deriveAlignmentFeedback(input: AlignmentFeedbackInput): AlignmentFeedback {
  const {
    residuals,
    lockTracking,
    lockConfidence,
    autoAlignmentReady,
    degradationTier,
    baseCorridorMode,
    authorityTier,
    authorityTrustScore,
    azimuthAuthorityTier,
    azimuthTrustScore,
    uncertaintyAuthorityTier,
    uncertaintyTrustScore,
    qualityState,
    safeModeActive,
    publishPadOnly
  } = input;

  const yawSamples = residuals.map((sample) => sample.yawDeg).filter((value) => Number.isFinite(value));
  const pitchSamples = residuals.map((sample) => sample.pitchDeg).filter((value) => Number.isFinite(value));
  const confidenceSamples = residuals
    .map((sample) => sample.confidence)
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  if (typeof lockConfidence === 'number' && Number.isFinite(lockConfidence) && lockConfidence >= 0 && lockConfidence <= 1) {
    confidenceSamples.push(lockConfidence);
  }

  const sampleCount = Math.min(yawSamples.length, pitchSamples.length);
  const yawMeanDeg = mean(yawSamples);
  const pitchMeanDeg = mean(pitchSamples);
  const yawStdDeg = standardDeviation(yawSamples, yawMeanDeg);
  const pitchStdDeg = standardDeviation(pitchSamples, pitchMeanDeg);
  const averageConfidence = mean(confidenceSamples);
  const residualMagnitudeDeg =
    yawMeanDeg != null && pitchMeanDeg != null ? Math.hypot(yawMeanDeg, pitchMeanDeg) : null;

  const authorityTrust = Math.min(
    resolveAuthorityTrust(authorityTier, authorityTrustScore),
    resolveAuthorityTrust(azimuthAuthorityTier, azimuthTrustScore),
    resolveAuthorityTrust(uncertaintyAuthorityTier, uncertaintyTrustScore)
  );
  const highTrust =
    authorityTrust >= 0.8 && qualityState === 'precision' && !safeModeActive && !publishPadOnly && degradationTier <= 1;
  const mediumTrust =
    authorityTrust >= 0.56 && qualityState !== 'pad_only' && !publishPadOnly && !safeModeActive;

  const stableYawStdThreshold = degradationTier >= 2 ? 1.7 : 1.35;
  const stablePitchStdThreshold = degradationTier >= 2 ? 1.45 : 1.15;
  const stableYawMeanThreshold = degradationTier >= 2 ? 4.1 : 3.25;
  const stablePitchMeanThreshold = degradationTier >= 2 ? 3.1 : 2.45;
  const driftYawStdThreshold = degradationTier >= 2 ? 2.6 : 2.1;
  const driftPitchStdThreshold = degradationTier >= 2 ? 2.2 : 1.8;
  const driftYawMeanThreshold = degradationTier >= 2 ? 7.5 : 6.2;
  const driftPitchMeanThreshold = degradationTier >= 2 ? 5.5 : 4.6;

  const stableResiduals =
    sampleCount >= 5 &&
    averageConfidence != null &&
    averageConfidence >= 0.78 &&
    yawStdDeg != null &&
    yawStdDeg <= stableYawStdThreshold &&
    pitchStdDeg != null &&
    pitchStdDeg <= stablePitchStdThreshold &&
    yawMeanDeg != null &&
    Math.abs(yawMeanDeg) <= stableYawMeanThreshold &&
    pitchMeanDeg != null &&
    Math.abs(pitchMeanDeg) <= stablePitchMeanThreshold;

  const driftingResiduals =
    sampleCount >= 4 &&
    ((averageConfidence != null && averageConfidence < 0.66) ||
      (yawStdDeg != null && yawStdDeg >= driftYawStdThreshold) ||
      (pitchStdDeg != null && pitchStdDeg >= driftPitchStdThreshold) ||
      (yawMeanDeg != null && Math.abs(yawMeanDeg) >= driftYawMeanThreshold) ||
      (pitchMeanDeg != null && Math.abs(pitchMeanDeg) >= driftPitchMeanThreshold));

  let stability: AlignmentStability = 'inactive';
  if (lockTracking) {
    if (stableResiduals && (highTrust || (mediumTrust && autoAlignmentReady))) stability = 'stable';
    else if (driftingResiduals) stability = 'drifting';
    else stability = 'settling';
  }

  let biasConfidence: AlignmentBiasConfidence = 'low';
  if (stability === 'stable' && (highTrust || mediumTrust)) biasConfidence = 'high';
  else if (stability === 'settling' && mediumTrust && averageConfidence != null && averageConfidence >= 0.72) {
    biasConfidence = 'medium';
  }

  let recommendedCorridorMode = baseCorridorMode;
  if (!lockTracking || publishPadOnly || safeModeActive || qualityState === 'pad_only') {
    recommendedCorridorMode = 'wide';
  } else if (stability === 'drifting') {
    recommendedCorridorMode = widerCorridorMode(widerCorridorMode(baseCorridorMode));
  } else if (stability === 'settling') {
    recommendedCorridorMode =
      qualityState === 'search' || degradationTier >= 2 ? widerCorridorMode(baseCorridorMode) : baseCorridorMode;
  } else if (stability === 'stable' && highTrust) {
    recommendedCorridorMode = tighterCorridorMode(baseCorridorMode);
  }

  const readyForPrecision = stability === 'stable' && highTrust;
  const correctionGain =
    stability === 'stable' ? 1 : stability === 'settling' ? (biasConfidence === 'medium' ? 0.7 : 0.5) : stability === 'drifting' ? 0.28 : 0;

  return {
    sampleCount,
    averageConfidence,
    yawMeanDeg,
    pitchMeanDeg,
    yawStdDeg,
    pitchStdDeg,
    residualMagnitudeDeg,
    stability,
    biasConfidence,
    recommendedCorridorMode,
    readyForPrecision,
    correctionGain
  };
}
