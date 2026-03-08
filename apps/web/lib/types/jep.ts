export type JepConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type JepCalibrationBand = 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' | 'UNKNOWN';
export const JEP_REPORT_MODE_VALUES = ['watchability', 'probability'] as const;
export type JepReportMode = (typeof JEP_REPORT_MODE_VALUES)[number];
export const JEP_OBSERVER_OUTCOME_VALUES = ['seen', 'not_seen', 'not_observable'] as const;
export type JepObserverOutcome = (typeof JEP_OBSERVER_OUTCOME_VALUES)[number];
export const JEP_OUTCOME_SOURCE_VALUES = ['curated_import', 'admin_manual'] as const;
export type JepOutcomeSource = (typeof JEP_OUTCOME_SOURCE_VALUES)[number];

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

export type JepReadinessReason =
  | 'public_release_disabled'
  | 'validation_incomplete'
  | 'model_card_unpublished'
  | 'labeled_outcome_threshold_unconfigured'
  | 'labeled_outcome_count_unreported'
  | 'insufficient_labeled_outcomes'
  | 'ece_threshold_unconfigured'
  | 'ece_unreported'
  | 'ece_above_threshold'
  | 'brier_threshold_unconfigured'
  | 'brier_unreported'
  | 'brier_above_threshold';

export type JepReadiness = {
  publicVisible: boolean;
  probabilityReady: boolean;
  probabilityPublicEligible: boolean;
  validationReady: boolean;
  modelCardPublished: boolean;
  labeledOutcomes: number | null;
  minLabeledOutcomes: number | null;
  currentEce: number | null;
  maxEce: number | null;
  currentBrier: number | null;
  maxBrier: number | null;
  reasons: JepReadinessReason[];
};

export type LaunchJepScore = {
  launchId: string;
  mode: 'watchability' | 'probability';
  readiness: JepReadiness;
  score: number;
  probability: number;
  calibrationBand: JepCalibrationBand;
  modelVersion: string;
  computedAt: string | null;
  expiresAt: string | null;
  isStale: boolean;
  isSnapshot: boolean;
  snapshotAt: string | null;
  sunlitMarginKm: number | null;
  losVisibleFraction: number | null;
  weatherFreshnessMinutes: number | null;
  factors: {
    illumination: number;
    darkness: number;
    lineOfSight: number;
    weather: number;
    solarDepressionDeg: number | null;
    cloudCoverPct: number | null;
    cloudCoverLowPct: number | null;
  };
  confidence: {
    time: JepConfidence;
    trajectory: JepConfidence;
    weather: JepConfidence;
  };
  source: {
    weather: string | null;
    azimuth: string | null;
    geometryOnlyFallback: boolean;
  };
  explainability: {
    reasonCodes: string[];
    weightedContributions: {
      illumination: number;
      darkness: number;
      lineOfSight: number;
      weather: number;
    };
    safeMode: boolean;
  };
  observer: {
    locationHash: string;
    latBucket: number | null;
    lonBucket: number | null;
    personalized: boolean;
    usingPadFallback: boolean;
  };
  bestWindow: JepBestWindow | null;
  directionBand: JepDirectionBand | null;
  elevationBand: JepElevationBand | null;
  scenarioWindows: JepScenarioWindow[];
  trajectory: {
    authorityTier:
      | 'partner_feed'
      | 'official_numeric'
      | 'regulatory_constrained'
      | 'supplemental_ephemeris'
      | 'public_metadata'
      | 'model_prior';
    qualityState: 'precision' | 'guided' | 'search' | 'pad_only';
    generatedAt: string | null;
    evidenceEpoch: string | null;
    confidenceTier: 'A' | 'B' | 'C' | 'D' | null;
    freshnessState: 'fresh' | 'stale' | 'unknown' | null;
    confidenceBadge: 'high' | 'medium' | 'low' | 'unknown';
    confidenceBadgeLabel: string;
    evidenceLabel: string;
    safeModeActive: boolean;
    lineageComplete: boolean;
    confidenceReasons: string[];
    publishPolicy: {
      precisionClaim: boolean;
      allowPrecision: boolean;
      enforcePadOnly: boolean;
      reasons: string[];
      missingFields: string[];
      blockingReasons: string[];
    } | null;
    sourceBlend: {
      sourceCode: string | null;
      sourceLabel: string | null;
      hasLicensedTrajectoryFeed: boolean;
      hasDirectionalConstraint: boolean;
      hasLandingDirectional: boolean;
      hasHazardDirectional: boolean;
      hasMissionNumericOrbit: boolean;
      hasSupgpConstraint: boolean;
    } | null;
    fieldProvenance: {
      azimuth: {
        authorityTier: string;
        summary: string;
        confidenceLabel: 'strong' | 'moderate' | 'limited' | 'modeled';
        trustScore: number;
        precisionEligible: boolean;
      };
      altitude: {
        authorityTier: string;
        summary: string;
        confidenceLabel: 'strong' | 'moderate' | 'limited' | 'modeled';
        trustScore: number;
        precisionEligible: boolean;
      };
      milestones: {
        authorityTier: string;
        summary: string;
        confidenceLabel: 'strong' | 'moderate' | 'limited' | 'modeled';
        trustScore: number;
        precisionEligible: boolean;
      };
      uncertainty: {
        authorityTier: string;
        summary: string;
        confidenceLabel: 'strong' | 'moderate' | 'limited' | 'modeled';
        trustScore: number;
        precisionEligible: boolean;
      };
    } | null;
  } | null;
};
