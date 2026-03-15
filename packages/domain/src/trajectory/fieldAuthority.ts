export type TrajectoryAuthorityTierValue =
  | 'partner_feed'
  | 'official_numeric'
  | 'regulatory_constrained'
  | 'supplemental_ephemeris'
  | 'public_metadata'
  | 'model_prior';

export type TrajectoryQualityStateValue = 'precision' | 'guided' | 'search' | 'pad_only';
export type TrajectoryFreshnessStateValue = 'fresh' | 'stale' | 'unknown' | null;
export type TrajectoryFieldAuthorityConfidence = 'strong' | 'moderate' | 'limited' | 'modeled';

export type TrajectoryFieldAuthorityProfile = {
  authorityTier: TrajectoryAuthorityTierValue;
  summary: string;
  confidenceLabel: TrajectoryFieldAuthorityConfidence;
  trustScore: number;
  precisionEligible: boolean;
};

export type DeriveTrajectoryFieldAuthorityProfileInput = {
  field: 'azimuth' | 'altitude' | 'milestones' | 'uncertainty';
  authorityTier: TrajectoryAuthorityTierValue;
  summary: string;
  qualityState: TrajectoryQualityStateValue;
  freshnessState: TrajectoryFreshnessStateValue;
  lineageComplete: boolean;
  safeModeActive: boolean;
  publishPadOnly: boolean;
  hasDirectionalConstraint?: boolean;
  hasLandingDirectional?: boolean;
  hasHazardDirectional?: boolean;
  hasMissionNumericOrbit?: boolean;
  hasSupgpConstraint?: boolean;
  timelineEventCount?: number;
  uncertaintySampleCount?: number;
  sigmaDegP95?: number | null;
};

export function scoreTrajectoryAuthorityTier(authorityTier: TrajectoryAuthorityTierValue) {
  if (authorityTier === 'partner_feed') return 1;
  if (authorityTier === 'official_numeric') return 0.95;
  if (authorityTier === 'regulatory_constrained') return 0.84;
  if (authorityTier === 'supplemental_ephemeris') return 0.76;
  if (authorityTier === 'public_metadata') return 0.58;
  return 0.34;
}

export function deriveTrajectoryFieldAuthorityProfile(
  input: DeriveTrajectoryFieldAuthorityProfileInput
): TrajectoryFieldAuthorityProfile {
  const {
    field,
    authorityTier,
    summary,
    qualityState,
    freshnessState,
    lineageComplete,
    safeModeActive,
    publishPadOnly,
    hasDirectionalConstraint = false,
    hasLandingDirectional = false,
    hasHazardDirectional = false,
    hasMissionNumericOrbit = false,
    hasSupgpConstraint = false,
    timelineEventCount = 0,
    uncertaintySampleCount = 0,
    sigmaDegP95 = null
  } = input;

  let trustScore = scoreTrajectoryAuthorityTier(authorityTier);

  if (freshnessState === 'stale') trustScore -= 0.12;
  else if (freshnessState === 'unknown') trustScore -= 0.05;

  if (!lineageComplete) trustScore -= 0.08;
  if (publishPadOnly) trustScore = Math.min(trustScore, 0.2);
  else if (safeModeActive && field !== 'milestones') trustScore -= 0.03;

  if (field === 'azimuth') {
    if (!hasDirectionalConstraint) trustScore = Math.min(trustScore, 0.28);
    if (hasHazardDirectional) trustScore += 0.04;
    if (hasMissionNumericOrbit) trustScore += 0.08;
    else if (hasSupgpConstraint) trustScore += 0.04;
    else if (hasLandingDirectional) trustScore -= 0.04;
  } else if (field === 'altitude') {
    if (hasMissionNumericOrbit || authorityTier === 'partner_feed') trustScore += 0.08;
    else if (hasSupgpConstraint) trustScore += 0.04;
    else trustScore -= 0.12;
  } else if (field === 'milestones') {
    if (timelineEventCount >= 3) trustScore += 0.12;
    else if (timelineEventCount > 0) trustScore += 0.06;
    else trustScore = Math.min(trustScore, 0.38);
  } else if (field === 'uncertainty') {
    if (uncertaintySampleCount <= 0) {
      trustScore = Math.min(trustScore, 0.32);
    } else if (sigmaDegP95 != null) {
      if (sigmaDegP95 <= 3) trustScore += 0.08;
      else if (sigmaDegP95 <= 6) trustScore += 0.04;
      else if (sigmaDegP95 >= 20) trustScore -= 0.14;
      else if (sigmaDegP95 >= 12) trustScore -= 0.08;
    }
    if (!hasDirectionalConstraint) trustScore -= 0.08;
  }

  trustScore = clamp(trustScore, 0.15, 1);

  const confidenceLabel =
    trustScore >= 0.82
      ? 'strong'
      : trustScore >= 0.62
        ? 'moderate'
        : trustScore >= 0.42
          ? 'limited'
          : 'modeled';

  return {
    authorityTier,
    summary,
    confidenceLabel,
    trustScore,
    precisionEligible:
      trustScore >= 0.78 && qualityState === 'precision' && !safeModeActive && !publishPadOnly
  };
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
