export type JepConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type JepCalibrationBand = 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' | 'UNKNOWN';
export type JepVisibilityCall = 'not_expected' | 'possible' | 'favorable' | 'highly_favorable';
export type JepViewpoint = 'personal' | 'launch_site_reference';
export type JepConfidenceLabel = 'low' | 'medium' | 'high';
export type JepForecastPhase = 'week_ahead' | 'day_ahead' | 'same_day' | 'near_launch' | 'post_launch';
export type JepForecastConfidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type JepWeatherSourceKey = 'nbm_ndfd' | 'hrrr' | 'goes_nowcast' | 'open_meteo_fallback';
export type JepWeatherSamplingMode = 'visible_path' | 'sunlit_path' | 'modeled_path' | 'observer_only';
export type JepWeatherObstructionLevel = 'clear' | 'partly_obstructed' | 'likely_blocked' | 'unknown';
export type JepWeatherPointRole = 'observer' | 'path_start' | 'path_mid' | 'path_end' | 'pad';
export type JepWeatherPointSource = 'nws' | 'open_meteo' | 'mixed' | 'none';
export type JepWeatherMainBlocker =
  | 'observer_low_ceiling'
  | 'observer_sky_cover'
  | 'path_low_ceiling'
  | 'path_sky_cover'
  | 'observer_low_clouds'
  | 'observer_mid_clouds'
  | 'observer_high_clouds'
  | 'mixed'
  | 'unknown';
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

export type JepSolarWindowRange = {
  netDeg: number | null;
  windowStartDeg: number | null;
  windowEndDeg: number | null;
  minDeg: number | null;
  maxDeg: number | null;
  crossesTwilightSweetSpot: boolean;
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

export type JepWeatherPointSummary = {
  role: JepWeatherPointRole;
  source: JepWeatherPointSource;
  totalCloudPct: number | null;
  lowCloudPct: number | null;
  midCloudPct: number | null;
  highCloudPct: number | null;
  skyCoverPct: number | null;
  ceilingFt: number | null;
  obstructionLevel: JepWeatherObstructionLevel;
  note: string | null;
};

export type JepWeatherPathSummary = {
  source: JepWeatherPointSource;
  samplesConsidered: number;
  worstRole: Exclude<JepWeatherPointRole, 'observer' | 'pad'> | null;
  skyCoverPct: number | null;
  ceilingFt: number | null;
  obstructionLevel: JepWeatherObstructionLevel;
  note: string | null;
};

export type JepWeatherDetails = {
  sourceUsed: string | null;
  mainBlocker: JepWeatherMainBlocker;
  obstructionFactor: number | null;
  contrastFactor: number | null;
  samplingMode: JepWeatherSamplingMode;
  samplingNote: string | null;
  observer: JepWeatherPointSummary | null;
  alongPath: JepWeatherPathSummary | null;
  pad: JepWeatherPointSummary | null;
};

export type JepPlanning = {
  hoursToNet: number | null;
  phase: JepForecastPhase;
  confidence: JepForecastConfidence;
  label: string;
  note: string;
  sourcePlan: JepWeatherSourceKey[];
  sourceUsed: string | null;
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
  visibilityCall: JepVisibilityCall;
  viewpoint: JepViewpoint;
  confidenceLabel: JepConfidenceLabel;
  factors: {
    illumination: number;
    darkness: number;
    lineOfSight: number;
    weather: number;
    solarDepressionDeg: number | null;
    cloudCoverPct: number | null;
    cloudCoverLowPct: number | null;
    cloudCoverMidPct: number | null;
    cloudCoverHighPct: number | null;
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
  planning: JepPlanning;
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
  weatherDetails: JepWeatherDetails | null;
  observer: {
    locationHash: string;
    latBucket: number | null;
    lonBucket: number | null;
    personalized: boolean;
    usingPadFallback: boolean;
  };
  solarWindowRange: JepSolarWindowRange | null;
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
