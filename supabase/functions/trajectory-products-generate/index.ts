import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting, readStringArraySetting } from '../_shared/settings.ts';
import {
  emptyHazardScanState,
  mergeHazardScanState,
  shouldSuppressHazardConstraintFromScanState
} from '../../../lib/trajectory/hazardFreshness.ts';
import {
  applyTrajectoryMilestoneProjection,
  buildTrajectoryCompatibilityEvents,
  buildTrajectoryMilestoneTrackWindows,
  resolveTrajectoryMilestones,
  type LaunchExternalResourceRowLike,
  type TrajectoryMilestoneDraft
} from '../../../lib/trajectory/milestones.ts';

const DEFAULTS = {
  enabled: true,
  eligibleLimit: 8,
  lookaheadLimit: 80,
  lookbackHours: 24,
  expiryHours: 3
};

const SETTINGS_KEYS = [
  'trajectory_products_job_enabled',
  'trajectory_products_eligible_limit',
  'trajectory_products_lookahead_limit',
  'trajectory_products_lookback_hours',
  'trajectory_products_expiry_hours',
  'trajectory_products_top3_ids',
  'trajectory_templates_v1'
];

type TrajectoryEvent = {
  key: string;
  tPlusSec: number;
  label: string;
  confidence?: 'low' | 'med' | 'high';
};

type TrajectoryConfidenceTier = 'A' | 'B' | 'C' | 'D';

type SourceContractEval = {
  confidenceTier: TrajectoryConfidenceTier;
  status: 'pass' | 'fail';
  sourceSufficiency: Record<string, unknown>;
  requiredFields: Record<string, unknown>;
  missingFields: string[];
  blockingReasons: string[];
  freshnessState: 'fresh' | 'stale' | 'unknown';
  lineageComplete: boolean;
};

type TrajectorySourceCheckKind = 'orbit' | 'landing' | 'hazard';

type LaunchSourceCheckState = {
  orbitCheckedAtMs: number | null;
  landingCheckedAtMs: number | null;
  hazardCheckedAtMs: number | null;
  navcenHazardScannedAtMs: number | null;
  navcenHazardMatchedAtMs: number | null;
  navcenHazardLatestScanMatched: boolean | null;
  faaHazardScannedAtMs: number | null;
  faaHazardMatchedAtMs: number | null;
  faaHazardLatestScanMatched: boolean | null;
};

type SourceFreshnessSnapshot = {
  basis: 'used_constraints' | 'all_constraints';
  basisConstraintTypes: string[];
  latestConstraintAt: string | null;
  latestSourceCheckAt: string | null;
  latestSignalAt: string | null;
  latestSignalAgeHours: number | null;
  orbitCheckedAt: string | null;
  landingCheckedAt: string | null;
  hazardCheckedAt: string | null;
};

type LaunchSite = 'cape' | 'vandenberg' | 'starbase' | 'unknown';
type MissionClass = 'SSO_POLAR' | 'GTO_GEO' | 'ISS_CREW' | 'LEO_GENERIC' | 'UNKNOWN';
type TrajectoryQualityLabel = 'pad_only' | 'landing_constrained' | 'estimate_corridor';

type LaunchRow = {
  launch_id: string;
  net: string | null;
  provider: string | null;
  status_name: string | null;
  timeline: Array<{ relative_time?: string | null }> | null;
  pad_latitude: number | null;
  pad_longitude: number | null;
  rocket_family: string | null;
  vehicle: string | null;
  mission_name: string | null;
  mission_orbit: string | null;
  pad_name: string | null;
  location_name: string | null;
};

type LaunchExternalResourceRow = LaunchExternalResourceRowLike & {
  launch_id: string;
};

type ConstraintRow = {
  id?: number | null;
  launch_id: string;
  source?: string | null;
  source_id?: string | null;
  constraint_type: string;
  data?: any;
  geometry?: any;
  confidence?: number | null;
  fetched_at?: string | null;
  source_hash?: string | null;
  parser_version?: string | null;
  parse_rule_id?: string | null;
  extracted_field_map?: any;
  license_class?: string | null;
};

type RankedTargetOrbitConstraint = {
  constraint: ConstraintRow;
  score: number;
  confidence: number;
  fetchedAtMs: number | null;
  ageHours: number | null;
  derived: boolean;
  sourceTier: 'truth' | 'fallback' | null;
  hasFlightAzimuth: boolean;
  hasInclination: boolean;
};

type LandingDirectionKind = 'rtls' | 'drone_ship' | 'splashdown' | 'land_pad' | 'unknown';

type LandingConstraintEvaluation = {
  constraint: ConstraintRow;
  sourceId: string | null;
  role: 'booster' | 'spacecraft' | 'unknown';
  kind: LandingDirectionKind;
  lat: number | null;
  lon: number | null;
  azDeg: number | null;
  hasCoordinates: boolean;
  downrangeKm: number | null;
  canUseDirection: boolean;
  canUseDownrange: boolean;
  directionWeight: number;
  directionSigmaDeg: number;
  confidence: number;
  fetchedAtMs: number;
  notes: string[];
};

type DirectionSignalKind = 'orbit' | 'hazard' | 'landing' | 'template' | 'heuristic';

type DirectionSignal = {
  kind: DirectionSignalKind;
  azDeg: number;
  sigmaDeg: number;
  weight: number;
  notes: string[];
  constraint?: ConstraintRow | null;
  role?: ProductConstraintRole | null;
  templateKey?: string | null;
  sourceId?: string | null;
  supportsPrecision: boolean;
  maxDistKm?: number | null;
};

type DirectionFusionResult = {
  azDeg: number;
  sigmaDeg: number;
  signals: DirectionSignal[];
  primary: DirectionSignal | null;
  notes: string[];
  landingCorroborated: boolean;
  templateKey: string | null;
  downrangeMaxM: number | null;
};

type TrajectoryProduct = {
  version: string;
  quality: number;
  qualityLabel: TrajectoryQualityLabel | string;
  generatedAt: string;
  assumptions: string[];
  samples: Array<{
    tPlusSec: number;
    ecef: [number, number, number];
    latDeg: number;
    lonDeg: number;
    altM: number;
    downrangeM: number;
    azimuthDeg: number;
    sigmaDeg: number;
    covariance?: { along_track: number; cross_track: number };
    uncertainty?: {
      sigmaDeg?: number;
      covariance?: { along_track: number; cross_track: number };
    };
  }>;
  events: TrajectoryEvent[];
  sourceSufficiency?: Record<string, unknown>;
  milestones?: unknown;
  tracks?: unknown;
  milestoneSummary?: Record<string, unknown>;
  trackSummary?: Record<string, unknown>;
};

const TRAJECTORY_ENVELOPE_IDS = {
  padOnly: 'tier0_pad_only_v1',
  landingConstraint: 'tier1_landing_azimuth_v1',
  tier2Corridor: 'tier2_corridor_v1'
} as const;

type EnvelopeProvenance = 'pad_only' | 'landing_constraint' | 'orbit_constraint' | 'hazard_area' | 'template_prior' | 'heuristic';

function normalizeEnvelopeFamily(rocketFamily?: string | null) {
  const value = typeof rocketFamily === 'string' ? rocketFamily.trim().toLowerCase() : '';
  return value ? value.replace(/\s+/g, '_') : 'unknown';
}

type EnvelopeProfile = {
  profileId: string;
  familyKey: string;
  landing: {
    durationS: number;
    stepS: number;
    altMaxM: number;
    downrangeMinM: number;
    downrangeMaxM: number;
    downrangeExponent: number;
    altRiseRate: number;
    sigmaClampMinDeg: number;
    sigmaClampMaxDeg: number;
    sigmaSpreadDeg: number;
    sigmaBaseDeg: number;
    nearPadFloorDeg: number;
    midRangeFloorDeg: number;
    alongTrackRatio: number;
  };
  tier2: {
    durationS: number;
    stepS: number;
    altDefaultM: number;
    altMinM: number;
    altMaxM: number;
    downrangeMaxM: number;
    downrangeExponent: number;
    altRiseRate: number;
    sigmaStartDeg: number;
    sigmaEndDeg: number;
    sigmaCurvePower: number;
    sigmaClampMinDeg: number;
    sigmaClampMaxDeg: number;
    alongTrackRatio: number;
  };
};

const BASE_ENVELOPE_PROFILE: Omit<EnvelopeProfile, 'profileId' | 'familyKey'> = {
  landing: {
    durationS: 600,
    stepS: 2,
    altMaxM: 130_000,
    downrangeMinM: 120_000,
    downrangeMaxM: 700_000,
    downrangeExponent: 2.0,
    altRiseRate: 4.0,
    sigmaClampMinDeg: 4,
    sigmaClampMaxDeg: 30,
    sigmaSpreadDeg: 8,
    sigmaBaseDeg: 10,
    nearPadFloorDeg: 18,
    midRangeFloorDeg: 14,
    alongTrackRatio: 0.75
  },
  tier2: {
    durationS: 600,
    stepS: 2,
    altDefaultM: 130_000,
    altMinM: 80_000,
    altMaxM: 250_000,
    downrangeMaxM: 700_000,
    downrangeExponent: 2.0,
    altRiseRate: 4.0,
    sigmaStartDeg: 8,
    sigmaEndDeg: 16,
    sigmaCurvePower: 0.5,
    sigmaClampMinDeg: 4,
    sigmaClampMaxDeg: 32,
    alongTrackRatio: 0.8
  }
};

function isEnvelopeFamily(familyKey: string, needles: string[]) {
  const normalized = familyKey.replace(/[^a-z0-9]+/g, '');
  return needles.some((needle) => normalized.includes(needle.replace(/[^a-z0-9]+/g, '')));
}

function resolveEnvelopeProfile(rocketFamily?: string | null): EnvelopeProfile {
  const familyKey = normalizeEnvelopeFamily(rocketFamily);
  const base = BASE_ENVELOPE_PROFILE;

  if (isEnvelopeFamily(familyKey, ['starship', 'superheavy'])) {
    return {
      profileId: 'profile_starship_v1',
      familyKey,
      landing: {
        ...base.landing,
        durationS: 840,
        altMaxM: 230_000,
        downrangeMinM: 180_000,
        downrangeMaxM: 1_250_000,
        downrangeExponent: 1.75,
        altRiseRate: 3.2,
        sigmaClampMinDeg: 6,
        sigmaClampMaxDeg: 36,
        sigmaSpreadDeg: 12,
        sigmaBaseDeg: 14,
        nearPadFloorDeg: 20,
        midRangeFloorDeg: 16,
        alongTrackRatio: 0.88
      },
      tier2: {
        ...base.tier2,
        durationS: 900,
        altDefaultM: 220_000,
        altMinM: 120_000,
        altMaxM: 320_000,
        downrangeMaxM: 1_200_000,
        downrangeExponent: 1.8,
        altRiseRate: 3.2,
        sigmaStartDeg: 12,
        sigmaEndDeg: 24,
        sigmaCurvePower: 0.6,
        sigmaClampMinDeg: 8,
        sigmaClampMaxDeg: 40,
        alongTrackRatio: 0.9
      }
    };
  }

  if (isEnvelopeFamily(familyKey, ['falconheavy', 'newglenn', 'sls'])) {
    return {
      profileId: 'profile_falcon_heavy_v1',
      familyKey,
      landing: {
        ...base.landing,
        durationS: 700,
        altMaxM: 155_000,
        downrangeMaxM: 900_000,
        downrangeExponent: 1.85,
        altRiseRate: 4.1,
        sigmaSpreadDeg: 9,
        sigmaBaseDeg: 11,
        nearPadFloorDeg: 17,
        midRangeFloorDeg: 14,
        alongTrackRatio: 0.7
      },
      tier2: {
        ...base.tier2,
        durationS: 700,
        altDefaultM: 160_000,
        altMaxM: 270_000,
        downrangeMaxM: 900_000,
        downrangeExponent: 1.9,
        altRiseRate: 4.1,
        sigmaStartDeg: 9,
        sigmaEndDeg: 18,
        sigmaCurvePower: 0.55,
        sigmaClampMinDeg: 6,
        sigmaClampMaxDeg: 30,
        alongTrackRatio: 0.76
      }
    };
  }

  if (
    isEnvelopeFamily(familyKey, [
      'falcon9',
      'falcon',
      'atlasv',
      'atlas',
      'vulcan',
      'ariane6',
      'ariane5',
      'soyuz',
      'h3',
      'longmarch',
      'cz',
      'antares'
    ])
  ) {
    return {
      profileId: 'profile_falcon_v1',
      familyKey,
      landing: {
        ...base.landing,
        durationS: 620,
        altMaxM: 145_000,
        downrangeMaxM: 760_000,
        downrangeExponent: 1.9,
        altRiseRate: 4.25,
        sigmaSpreadDeg: 7,
        sigmaBaseDeg: 9,
        nearPadFloorDeg: 16,
        midRangeFloorDeg: 13,
        alongTrackRatio: 0.72
      },
      tier2: {
        ...base.tier2,
        durationS: 620,
        altDefaultM: 145_000,
        altMaxM: 255_000,
        downrangeMaxM: 760_000,
        downrangeExponent: 1.95,
        altRiseRate: 4.2,
        sigmaStartDeg: 7,
        sigmaEndDeg: 14,
        sigmaCurvePower: 0.55,
        sigmaClampMinDeg: 5,
        sigmaClampMaxDeg: 26,
        alongTrackRatio: 0.78
      }
    };
  }

  if (isEnvelopeFamily(familyKey, ['electron', 'neutron', 'pslv', 'sslv', 'minotaur', 'fireflyalpha', 'alpha'])) {
    return {
      profileId: 'profile_small_lift_v1',
      familyKey,
      landing: {
        ...base.landing,
        durationS: 520,
        altMaxM: 110_000,
        downrangeMinM: 100_000,
        downrangeMaxM: 550_000,
        downrangeExponent: 2.15,
        altRiseRate: 4.5,
        sigmaClampMaxDeg: 28,
        sigmaSpreadDeg: 6,
        sigmaBaseDeg: 8,
        nearPadFloorDeg: 14,
        midRangeFloorDeg: 12,
        alongTrackRatio: 0.74
      },
      tier2: {
        ...base.tier2,
        durationS: 540,
        altDefaultM: 110_000,
        altMinM: 75_000,
        altMaxM: 200_000,
        downrangeMaxM: 560_000,
        downrangeExponent: 2.1,
        altRiseRate: 4.5,
        sigmaStartDeg: 7,
        sigmaEndDeg: 13,
        sigmaCurvePower: 0.5,
        sigmaClampMinDeg: 4,
        sigmaClampMaxDeg: 22,
        alongTrackRatio: 0.79
      }
    };
  }

  return {
    profileId: 'profile_generic_v1',
    familyKey,
    landing: { ...base.landing },
    tier2: { ...base.tier2 }
  };
}

function shapeEnvelopeProfile({
  profile,
  missionClass,
  altitudeMaxM,
  directionSigmaDeg,
  downrangeMaxM,
  landing
}: {
  profile: EnvelopeProfile;
  missionClass: MissionClass;
  altitudeMaxM?: number | null;
  directionSigmaDeg?: number | null;
  downrangeMaxM?: number | null;
  landing?: LandingConstraintEvaluation | null;
}): EnvelopeProfile {
  const altitudeBias =
    typeof altitudeMaxM === 'number' && Number.isFinite(altitudeMaxM)
      ? clamp((altitudeMaxM - profile.tier2.altDefaultM) / Math.max(40_000, profile.tier2.altMaxM - profile.tier2.altDefaultM), -0.2, 1)
      : missionClass === 'GTO_GEO'
        ? 0.5
        : missionClass === 'SSO_POLAR'
          ? 0.2
          : missionClass === 'ISS_CREW'
            ? -0.08
            : 0;

  const rangeBias =
    typeof downrangeMaxM === 'number' && Number.isFinite(downrangeMaxM)
      ? clamp(
          (downrangeMaxM - profile.landing.downrangeMinM) /
            Math.max(80_000, profile.tier2.downrangeMaxM - profile.landing.downrangeMinM),
          0,
          1
        )
      : landing?.kind === 'rtls'
        ? 0
        : 0.25;

  const certainty =
    typeof directionSigmaDeg === 'number' && Number.isFinite(directionSigmaDeg)
      ? clamp(1 - (directionSigmaDeg - 4) / 20, 0, 1)
      : 0.25;

  const durationBias = Math.max(rangeBias * 0.55, Math.max(0, altitudeBias) * 0.45);
  const landingDurationS = clampInt(
    profile.landing.durationS * (1 + durationBias * 0.28),
    profile.landing.durationS,
    profile.landing.durationS + 420
  );
  const tier2DurationS = clampInt(
    profile.tier2.durationS * (1 + durationBias * 0.35),
    profile.tier2.durationS,
    profile.tier2.durationS + 540
  );

  const landingAltMaxM =
    typeof altitudeMaxM === 'number' && Number.isFinite(altitudeMaxM)
      ? clamp(
          Math.max(profile.landing.altMaxM, altitudeMaxM * 0.78),
          profile.landing.altMaxM,
          profile.tier2.altMaxM
        )
      : profile.landing.altMaxM;

  const landingAltRiseRate = clamp(profile.landing.altRiseRate * (1 - durationBias * 0.14 + certainty * 0.04), 2.6, 5.2);
  const tier2AltRiseRate = clamp(profile.tier2.altRiseRate * (1 - durationBias * 0.16 + certainty * 0.05), 2.4, 5.4);

  const rtlsTightening = landing?.kind === 'rtls' ? 0.14 : 0;
  const landingDownrangeExponent = clamp(
    profile.landing.downrangeExponent - rangeBias * 0.24 + rtlsTightening,
    1.5,
    2.35
  );
  const tier2DownrangeExponent = clamp(profile.tier2.downrangeExponent - rangeBias * 0.28, 1.5, 2.4);
  const landingSigmaSpreadDeg = clamp(profile.landing.sigmaSpreadDeg + (1 - certainty) * 2.4 - certainty * 0.8, 6, 16);
  const tier2SigmaEndDeg = clamp(profile.tier2.sigmaEndDeg + (1 - certainty) * 2.2 - certainty * 0.9, 10, 28);

  return {
    ...profile,
    landing: {
      ...profile.landing,
      durationS: landingDurationS,
      altMaxM: landingAltMaxM,
      downrangeExponent: landingDownrangeExponent,
      altRiseRate: landingAltRiseRate,
      sigmaSpreadDeg: landingSigmaSpreadDeg
    },
    tier2: {
      ...profile.tier2,
      durationS: tier2DurationS,
      downrangeExponent: tier2DownrangeExponent,
      altRiseRate: tier2AltRiseRate,
      sigmaEndDeg: tier2SigmaEndDeg
    }
  };
}

function buildEnvelopeAssumptionLines({
  id,
  provenance,
  rocketFamily,
  templateKey
}: {
  id: string;
  provenance: EnvelopeProvenance;
  rocketFamily?: string | null;
  templateKey?: string | null;
}) {
  const lines = [`Envelope ID: ${id}`, `Envelope provenance: ${provenance}`, `Envelope family: ${normalizeEnvelopeFamily(rocketFamily)}`];
  if (typeof templateKey === 'string' && templateKey.trim().length > 0) {
    lines.push(`Envelope template key: ${templateKey.trim()}`);
  }
  return lines;
}

type ProductConstraintRole = 'landing_primary' | 'landing_downrange' | 'orbit_azimuth' | 'orbit_altitude' | 'hazard_azimuth';

type ProductConstraintUsage = {
  constraint: ConstraintRow;
  role: ProductConstraintRole;
  weightUsed: number;
};

function scoreTargetOrbitConstraint(constraint: ConstraintRow, nowMs: number): RankedTargetOrbitConstraint {
  const confidence = typeof constraint.confidence === 'number' && Number.isFinite(constraint.confidence) ? constraint.confidence : 0;
  const fetchedAtMs = typeof constraint.fetched_at === 'string' ? Date.parse(constraint.fetched_at) : NaN;
  const fetchedAt = Number.isFinite(fetchedAtMs) ? fetchedAtMs : null;
  const ageHours = fetchedAt != null ? Math.max(0, (nowMs - fetchedAt) / (60 * 60 * 1000)) : null;

  const data = constraint.data && typeof constraint.data === 'object' ? (constraint.data as any) : null;
  const derived = Boolean(data?.derived);
  const sourceTierRaw = typeof data?.sourceTier === 'string' ? String(data.sourceTier) : null;
  const sourceTier = sourceTierRaw === 'truth' || sourceTierRaw === 'fallback' ? (sourceTierRaw as 'truth' | 'fallback') : null;

  const flightAz = data?.flight_azimuth_deg;
  const inc = data?.inclination_deg;
  const hasFlightAzimuth = typeof flightAz === 'number' && Number.isFinite(flightAz);
  const hasInclination = typeof inc === 'number' && Number.isFinite(inc);

  const tierBonus = sourceTier === 'truth' ? 30 : sourceTier === 'fallback' ? 0 : -10;
  const directionBonus = hasFlightAzimuth ? 18 : hasInclination ? 6 : 0;
  const derivedPenalty = derived ? 90 : 0;
  const recencyPenalty = ageHours != null ? ageHours * 2.0 : 48;

  const score = confidence * 1000 + tierBonus + directionBonus - derivedPenalty - recencyPenalty;

  return {
    constraint,
    score,
    confidence,
    fetchedAtMs: fetchedAt,
    ageHours,
    derived,
    sourceTier,
    hasFlightAzimuth,
    hasInclination
  };
}

function formatTargetOrbitPick(pick: RankedTargetOrbitConstraint) {
  const parts = [
    pick.constraint.source ? String(pick.constraint.source) : null,
    pick.constraint.source_id ? String(pick.constraint.source_id) : null,
    `conf=${pick.confidence.toFixed(2)}`,
    pick.sourceTier ? `tier=${pick.sourceTier}` : null,
    pick.derived ? 'derived' : null,
    pick.ageHours != null ? `age=${Math.round(pick.ageHours)}h` : null
  ].filter(Boolean);
  return parts.join(' ');
}

function inferTier2AltMaxMFromTargetOrbit({
  targetOrbit,
  profile
}: {
  targetOrbit: any;
  profile: EnvelopeProfile;
}): { altMaxM: number; notes: string[] } | null {
  if (!targetOrbit || typeof targetOrbit !== 'object') return null;

  const altKm = typeof targetOrbit.altitude_km === 'number' && Number.isFinite(targetOrbit.altitude_km) ? targetOrbit.altitude_km : null;
  const perigeeKm =
    typeof targetOrbit.perigee_km === 'number' && Number.isFinite(targetOrbit.perigee_km) ? targetOrbit.perigee_km : null;
  const apogeeKm = typeof targetOrbit.apogee_km === 'number' && Number.isFinite(targetOrbit.apogee_km) ? targetOrbit.apogee_km : null;

  const source =
    altKm != null ? { field: 'altitude_km', km: altKm } : perigeeKm != null ? { field: 'perigee_km', km: perigeeKm } : apogeeKm != null ? { field: 'apogee_km', km: apogeeKm } : null;
  if (!source) return null;
  if (!(source.km > 0)) return null;

  const rawAltMaxM = source.km * 1000;
  const minAltM = profile.tier2.altMinM;
  const maxAltM = profile.tier2.altMaxM;
  const altMaxM = clamp(rawAltMaxM, minAltM, maxAltM);
  const clamped = Math.abs(rawAltMaxM - altMaxM) > 1;
  const notes = [
    `Orbit ${source.field}: ${source.km.toFixed(0)} km`,
    `Tier-2 altitude max: ${(altMaxM / 1000).toFixed(0)} km${clamped ? ' (clamped to family envelope)' : ''}`
  ];
  return { altMaxM, notes };
}

serve(async (req: Request) => {
  const startedAt = Date.now();
  let supabase: ReturnType<typeof createSupabaseAdminClient>;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    return jsonResponse({ ok: false, stage: 'init', error: stringifyError(err) }, 500);
  }

  let authorized = false;
  try {
    authorized = await requireJobAuth(req, supabase);
  } catch (err) {
    return jsonResponse({ ok: false, stage: 'auth', error: stringifyError(err) }, 500);
  }
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const { runId } = await startIngestionRun(supabase, 'trajectory_products_generate');

  const stats: Record<string, unknown> = {
    eligibleIds: [] as string[],
    previousIds: [] as string[],
    addedEligibleIds: [] as string[],
    refreshedIds: [] as string[],
    changed: false,
    missingProducts: [] as string[],
    staleProducts: [] as string[],
    sourceRecheckRefreshes: [] as string[],
    hazardConstraintsSuppressed: 0,
    hazardConstraintsSuppressedByLaunch: {} as Record<string, number>,
    hazardsConsidered: 0,
    hazardsUsed: 0,
    hazardsConsideredByLaunch: {} as Record<string, number>,
    hazardsUsedByLaunch: {} as Record<string, boolean>,
    templatesUsed: 0,
    templatesUsedByLaunch: {} as Record<string, string>,
    confidenceTierByLaunch: {} as Record<string, TrajectoryConfidenceTier>,
    downgradedLaunches: [] as string[],
    upserted: 0,
    sourceContractsInserted: 0,
    lineageRowsInserted: 0
  };

  try {
    const settings = await getSettings(supabase, SETTINGS_KEYS);
    const enabled = readBooleanSetting(settings.trajectory_products_job_enabled, DEFAULTS.enabled);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const eligibleLimit = clampInt(readNumberSetting(settings.trajectory_products_eligible_limit, DEFAULTS.eligibleLimit), 1, 10);
    const lookaheadLimit = clampInt(
      readNumberSetting(settings.trajectory_products_lookahead_limit, DEFAULTS.lookaheadLimit),
      eligibleLimit,
      200
    );
    const lookbackHours = clampInt(readNumberSetting(settings.trajectory_products_lookback_hours, DEFAULTS.lookbackHours), 1, 168);
    const expiryHours = clampInt(readNumberSetting(settings.trajectory_products_expiry_hours, DEFAULTS.expiryHours), 1, 24);

    const nowMs = Date.now();
    const fromIso = new Date(nowMs - lookbackHours * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('launches_public_cache')
      .select(
        'launch_id, net, provider, status_name, timeline, pad_latitude, pad_longitude, rocket_family, vehicle, mission_name, mission_orbit, pad_name, location_name'
      )
      .gte('net', fromIso)
      .order('net', { ascending: true })
      .limit(lookaheadLimit);

    if (error || !data) {
      throw new Error(`Failed to load launches_public_cache: ${error?.message || 'unknown error'}`);
    }

    const eligible: LaunchRow[] = [];
    const expiryMs = expiryHours * 60 * 60 * 1000;
    for (const row of data as LaunchRow[]) {
      const netMs = row.net ? Date.parse(row.net) : NaN;
      if (!Number.isFinite(netMs)) continue;
      const ignoreTimeline = row.status_name === 'hold' || row.status_name === 'scrubbed';
      const maxOffsetMs = ignoreTimeline ? 0 : getMaxTimelineOffsetMs(row.timeline) ?? 0;
      const expiresAtMs = netMs + maxOffsetMs + expiryMs;
      if (expiresAtMs < nowMs) continue;
      eligible.push(row);
      if (eligible.length >= eligibleLimit) break;
    }

    const eligibleIds = eligible.map((row) => row.launch_id).filter(Boolean);
    stats.eligibleIds = eligibleIds;

    const previousIds = readStringArraySetting(settings.trajectory_products_top3_ids, []);
    stats.previousIds = previousIds;
    const changed = !arraysEqual(previousIds, eligibleIds);
    stats.changed = changed;
    const previousSet = new Set(previousIds);
    const addedEligibleIds = eligibleIds.filter((id) => !previousSet.has(id));
    stats.addedEligibleIds = addedEligibleIds;

    if (!eligibleIds.length) {
      await supabase
        .from('system_settings')
        .upsert({ key: 'trajectory_products_top3_ids', value: [], updated_at: new Date().toISOString() }, { onConflict: 'key' });
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'no_eligible' });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_eligible', elapsedMs: Date.now() - startedAt });
    }

    const { data: existingProducts, error: existingError } = await supabase
      .from('launch_trajectory_products')
      .select('launch_id, version, quality, generated_at, product, confidence_tier, freshness_state, lineage_complete')
      .in('launch_id', eligibleIds);

    if (existingError) throw existingError;
    const existingIds = new Set((existingProducts || []).map((row: { launch_id: string }) => row.launch_id));
    const missingProducts = eligibleIds.filter((id) => !existingIds.has(id));
    stats.missingProducts = missingProducts;

    const { data: constraints, error: constraintsError } = await supabase
      .from('launch_trajectory_constraints')
      .select(
        'id, launch_id, source, source_id, constraint_type, data, geometry, confidence, fetched_at, source_hash, parser_version, parse_rule_id, extracted_field_map, license_class'
      )
      .in('launch_id', eligibleIds);

    if (constraintsError) throw constraintsError;

    const constraintsByLaunch = new Map<string, ConstraintRow[]>();
    const latestConstraintFetchedAtMsByLaunch = new Map<string, number>();
    for (const constraint of (constraints || []) as ConstraintRow[]) {
      const list = constraintsByLaunch.get(constraint.launch_id) || [];
      list.push(constraint);
      constraintsByLaunch.set(constraint.launch_id, list);

      const fetchedAtMs = typeof constraint.fetched_at === 'string' ? Date.parse(constraint.fetched_at) : NaN;
      if (!Number.isFinite(fetchedAtMs)) continue;
      const prev = latestConstraintFetchedAtMsByLaunch.get(constraint.launch_id);
      if (prev == null || fetchedAtMs > prev) latestConstraintFetchedAtMsByLaunch.set(constraint.launch_id, fetchedAtMs);
    }

    const { data: externalResources, error: externalResourcesError } = await supabase
      .from('launch_external_resources')
      .select('launch_id, source, content_type, source_id, confidence, data, fetched_at')
      .in('launch_id', eligibleIds);

    if (externalResourcesError) throw externalResourcesError;

    const externalResourcesByLaunch = new Map<string, LaunchExternalResourceRow[]>();
    for (const resource of (externalResources || []) as LaunchExternalResourceRow[]) {
      const launchId = typeof resource?.launch_id === 'string' ? resource.launch_id : null;
      if (!launchId) continue;
      const list = externalResourcesByLaunch.get(launchId) || [];
      list.push(resource);
      externalResourcesByLaunch.set(launchId, list);
    }

    const sourceChecksByLaunch = await loadLaunchSourceChecksByLaunch({ supabase, eligibleIds });

    const productGeneratedAtMsByLaunch = new Map<string, number>();
    for (const product of (existingProducts || []) as Array<{ launch_id: string; generated_at?: string | null }>) {
      const generatedAtMs = typeof product?.generated_at === 'string' ? Date.parse(product.generated_at) : NaN;
      if (!Number.isFinite(generatedAtMs)) continue;
      productGeneratedAtMsByLaunch.set(product.launch_id, generatedAtMs);
    }
    const existingProductByLaunch = new Map<string, any>();
    for (const row of (existingProducts || []) as any[]) {
      const launchId = typeof row?.launch_id === 'string' ? row.launch_id : null;
      if (!launchId) continue;
      existingProductByLaunch.set(launchId, row);
    }

    const suppressedHazardConstraintCountByLaunch = new Map<string, number>();
    for (const launchId of eligibleIds) {
      const launchConstraints = constraintsByLaunch.get(launchId) || [];
      const sourceChecks = sourceChecksByLaunch.get(launchId) ?? null;
      const suppressedCount = launchConstraints.filter((constraint) => shouldSuppressHazardConstraint(constraint, sourceChecks)).length;
      if (suppressedCount > 0) {
        suppressedHazardConstraintCountByLaunch.set(launchId, suppressedCount);
      }
    }
    stats.hazardConstraintsSuppressed = Array.from(suppressedHazardConstraintCountByLaunch.values()).reduce(
      (sum, count) => sum + count,
      0
    );
    stats.hazardConstraintsSuppressedByLaunch = Object.fromEntries(suppressedHazardConstraintCountByLaunch.entries());

    const sourceRecheckRefreshes = eligibleIds.filter((launchId) => {
      const launchConstraints = constraintsByLaunch.get(launchId) || [];
      if (launchConstraints.length === 0) return false;

      const generatedMs = productGeneratedAtMsByLaunch.get(launchId);
      if (generatedMs == null) return false;

      const sourceChecks = sourceChecksByLaunch.get(launchId) ?? null;
      const sourceCheckMs = newestSourceCheckAtMs(sourceChecks);
      const hazardScanMs = newestHazardSourceScanAtMs(sourceChecks);
      const hasSuppressedHazards = (suppressedHazardConstraintCountByLaunch.get(launchId) ?? 0) > 0;
      const hasNewerSourceSignal =
        (sourceCheckMs != null && sourceCheckMs > generatedMs) ||
        (hasSuppressedHazards && hazardScanMs != null && hazardScanMs > generatedMs);
      if (!hasNewerSourceSignal) return false;

      const launch = eligible.find((row) => row.launch_id === launchId);
      const freshnessThresholdHours = getFreshnessThresholdHours({ netIso: launch?.net ?? null, nowMs });
      if (freshnessThresholdHours > 2) return false;

      const productAgeHours = Math.max(0, (nowMs - generatedMs) / (60 * 60 * 1000));
      return productAgeHours >= freshnessThresholdHours;
    });
    stats.sourceRecheckRefreshes = sourceRecheckRefreshes;

    const staleProducts = eligibleIds.filter((launchId) => {
      const latestConstraintMs = latestConstraintFetchedAtMsByLaunch.get(launchId);
      const generatedMs = productGeneratedAtMsByLaunch.get(launchId);
      return latestConstraintMs != null && generatedMs != null && latestConstraintMs > generatedMs;
    });
    stats.staleProducts = staleProducts;

    const refreshIdSet = new Set<string>([...missingProducts, ...staleProducts, ...sourceRecheckRefreshes, ...addedEligibleIds]);
    const refreshedIds = eligibleIds.filter((id) => refreshIdSet.has(id));
    stats.refreshedIds = refreshedIds;

    if (!refreshedIds.length) {
      if (changed) {
        await supabase
          .from('system_settings')
          .upsert({ key: 'trajectory_products_top3_ids', value: eligibleIds, updated_at: new Date().toISOString() }, { onConflict: 'key' });
        await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'eligible_changed_no_refresh' });
        return jsonResponse({
          ok: true,
          skipped: true,
          reason: 'eligible_changed_no_refresh',
          elapsedMs: Date.now() - startedAt,
          stats
        });
      }
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'no_change' });
      return jsonResponse({ ok: true, skipped: true, reason: 'no_change', elapsedMs: Date.now() - startedAt });
    }

    const generated = eligible.filter((row) => refreshIdSet.has(row.launch_id)).map((row) => {
      const rawLaunchConstraints = constraintsByLaunch.get(row.launch_id) || [];
      const sourceChecks = sourceChecksByLaunch.get(row.launch_id) ?? null;
      const launchConstraints = rawLaunchConstraints.filter((constraint) => !shouldSuppressHazardConstraint(constraint, sourceChecks));
      const usedConstraints: ProductConstraintUsage[] = [];
      const envelopeProfile = resolveEnvelopeProfile(row.rocket_family);
      const resolvedMilestones = resolveTrajectoryMilestones({
        ll2Timeline: row.timeline,
        providerResourceRows: externalResourcesByLaunch.get(row.launch_id) || [],
        rocketFamily: row.rocket_family,
        includeFamilyTemplate: true
      });
      const knownEventMaxSec = resolvedMilestones.reduce((max, milestone) => {
        if (
          milestone.trackKind !== 'core_up' ||
          !milestone.projectable ||
          typeof milestone.tPlusSec !== 'number' ||
          !Number.isFinite(milestone.tPlusSec) ||
          milestone.tPlusSec < 0
        ) {
          return max;
        }
        return Math.max(max, Math.round(milestone.tPlusSec));
      }, 0);

      const isSpaceX = isSpaceXLaunch(row);
      const targetOrbitConstraints = launchConstraints.filter((constraint) => constraint.constraint_type === 'target_orbit');
      const hasMissionNumericOrbit = targetOrbitConstraints.some(
        (constraint) => hasTargetOrbitNumerics(constraint) && !isDerivedConstraint(constraint)
      );
      const hasSupgpConstraint = targetOrbitConstraints.some((constraint) => isSupgpConstraint(constraint));
      let product = buildPadOnlyProduct({
        lat: row.pad_latitude,
        lon: row.pad_longitude,
        rocketFamily: row.rocket_family
      });

      if (typeof row.pad_latitude === 'number' && typeof row.pad_longitude === 'number') {
        const site = classifyLaunchSite({
          padLat: row.pad_latitude,
          padLon: row.pad_longitude,
          padName: row.pad_name,
          locationName: row.location_name
        });
        const missionClass = classifyMission({
          orbitName: row.mission_orbit,
          missionName: row.mission_name,
          vehicleName: row.vehicle
        });

        const rankedOrbitConstraints = targetOrbitConstraints
          .filter((c) => c.data && typeof c.data === 'object')
          .map((constraint) => scoreTargetOrbitConstraint(constraint, nowMs))
          .sort((a, b) => {
            const scoreDelta = b.score - a.score;
            if (scoreDelta) return scoreDelta;
            const azDelta = Number(b.hasFlightAzimuth) - Number(a.hasFlightAzimuth);
            if (azDelta) return azDelta;
            const confDelta = b.confidence - a.confidence;
            if (confDelta) return confDelta;
            const timeDelta = (b.fetchedAtMs || 0) - (a.fetchedAtMs || 0);
            if (timeDelta) return timeDelta;
            return String(b.constraint.source_id || '').localeCompare(String(a.constraint.source_id || ''));
          });

        let tier2AltPick: { altMaxM: number; notes: string[]; picked: RankedTargetOrbitConstraint } | null = null;
        for (const ranked of rankedOrbitConstraints) {
          const inferred = inferTier2AltMaxMFromTargetOrbit({
            targetOrbit: ranked.constraint.data,
            profile: envelopeProfile
          });
          if (!inferred) continue;
          tier2AltPick = { ...inferred, picked: ranked };
          break;
        }

        const landingPick = pickBestLandingConstraint({
          constraints: launchConstraints,
          padLat: row.pad_latitude,
          padLon: row.pad_longitude
        });

        const az = pickAzimuthEstimate({ site, missionClass, padName: row.pad_name, padLat: row.pad_latitude });

        const hazards = launchConstraints.filter(
          (c) => c.constraint_type === 'hazard_area' && c.geometry && typeof c.geometry === 'object'
        );
        (stats.hazardsConsideredByLaunch as Record<string, number>)[row.launch_id] = hazards.length;
        stats.hazardsConsidered = (stats.hazardsConsidered as number) + hazards.length;

        const hazardAz = pickAzimuthFromHazards({
          padLat: row.pad_latitude,
          padLon: row.pad_longitude,
          netIso: row.net,
          expectedAzDeg: az?.azDeg ?? null,
          clampMinDeg: az?.clampMin ?? null,
          clampMaxDeg: az?.clampMax ?? null,
          hazards
        });

        const templateAz = pickAzimuthFromTemplates({
          templatesSetting: settings.trajectory_templates_v1,
          site,
          missionClass,
          rocketFamily: row.rocket_family
        });

        const orbitAnchorSignals: DirectionSignal[] = [];
        if (landingPick?.canUseDirection && landingPick.azDeg != null) {
          orbitAnchorSignals.push({
            kind: 'landing',
            azDeg: landingPick.azDeg,
            sigmaDeg: landingPick.directionSigmaDeg,
            weight: landingPick.directionWeight,
            notes: landingPick.notes,
            constraint: landingPick.constraint,
            role: 'landing_primary',
            sourceId: landingPick.sourceId,
            supportsPrecision: false
          });
        }
        if (hazardAz) {
          orbitAnchorSignals.push({
            kind: 'hazard',
            azDeg: hazardAz.azDeg,
            sigmaDeg: hazardAz.sigmaDeg,
            weight: 1.1,
            notes: hazardAz.notes,
            constraint: hazardAz.constraint,
            role: 'hazard_azimuth',
            supportsPrecision: true,
            maxDistKm: hazardAz.maxDistKm
          });
        }
        if (templateAz) {
          orbitAnchorSignals.push({
            kind: 'template',
            azDeg: templateAz.azDeg,
            sigmaDeg: templateAz.sigmaDeg,
            weight: templateAz.samples != null ? clamp(templateAz.samples / 10, 0.35, 0.9) : 0.45,
            notes: templateAz.notes,
            templateKey: templateAz.templateKey,
            supportsPrecision: false
          });
        }
        if (az) {
          orbitAnchorSignals.push({
            kind: 'heuristic',
            azDeg: az.azDeg,
            sigmaDeg: 14 + az.sigmaBonusDeg,
            weight: 0.2,
            notes: az.notes,
            supportsPrecision: false
          });
        }

        const preferredAzForOrbit = weightedCircularMeanDeg(orbitAnchorSignals) ?? az?.azDeg ?? null;

        let orbitAzPick: { azDeg: number; sigmaDeg: number; notes: string[]; picked: RankedTargetOrbitConstraint } | null = null;
        for (const ranked of rankedOrbitConstraints) {
          const candidateAz = pickAzimuthFromTargetOrbit({
            padLat: row.pad_latitude,
            site,
            missionClass,
            padName: row.pad_name,
            targetOrbit: ranked.constraint.data,
            preferredAzDeg: preferredAzForOrbit
          });
          if (!candidateAz) continue;
          orbitAzPick = { ...candidateAz, picked: ranked };
          break;
        }

        const directionSignals: DirectionSignal[] = [];
        if (orbitAzPick) {
          directionSignals.push({
            kind: 'orbit',
            azDeg: orbitAzPick.azDeg,
            sigmaDeg: orbitAzPick.sigmaDeg,
            weight: orbitAzPick.picked.hasFlightAzimuth ? 1.8 : 1.35,
            notes: orbitAzPick.notes,
            constraint: orbitAzPick.picked.constraint,
            role: 'orbit_azimuth',
            supportsPrecision: true
          });
        }
        if (hazardAz) {
          directionSignals.push({
            kind: 'hazard',
            azDeg: hazardAz.azDeg,
            sigmaDeg: hazardAz.sigmaDeg,
            weight: 1.1,
            notes: hazardAz.notes,
            constraint: hazardAz.constraint,
            role: 'hazard_azimuth',
            supportsPrecision: true,
            maxDistKm: hazardAz.maxDistKm
          });
        }
        if (landingPick?.canUseDirection && landingPick.azDeg != null) {
          directionSignals.push({
            kind: 'landing',
            azDeg: landingPick.azDeg,
            sigmaDeg: landingPick.directionSigmaDeg,
            weight: landingPick.directionWeight,
            notes: landingPick.notes,
            constraint: landingPick.constraint,
            role: 'landing_primary',
            sourceId: landingPick.sourceId,
            supportsPrecision: false
          });
        }
        if (templateAz) {
          directionSignals.push({
            kind: 'template',
            azDeg: templateAz.azDeg,
            sigmaDeg: templateAz.sigmaDeg,
            weight: templateAz.samples != null ? clamp(templateAz.samples / 10, 0.35, 0.9) : 0.45,
            notes: templateAz.notes,
            templateKey: templateAz.templateKey,
            supportsPrecision: false
          });
        }
        if (az && !directionSignals.some((signal) => signal.kind === 'orbit' || signal.kind === 'hazard' || signal.kind === 'template')) {
          directionSignals.push({
            kind: 'heuristic',
            azDeg: az.azDeg,
            sigmaDeg: 14 + az.sigmaBonusDeg,
            weight: landingPick?.canUseDirection ? 0.18 : 0.28,
            notes: az.notes,
            supportsPrecision: false
          });
        }

        const fusedDirection = fuseDirectionalSignals({
          signals: directionSignals,
          landing: landingPick,
          profile: envelopeProfile,
          hazard: hazardAz ? { maxDistKm: hazardAz.maxDistKm } : null
        });

        if (fusedDirection) {
          const shapedProfile = shapeEnvelopeProfile({
            profile: envelopeProfile,
            missionClass,
            altitudeMaxM: tier2AltPick?.altMaxM ?? null,
            directionSigmaDeg: fusedDirection.sigmaDeg,
            downrangeMaxM: fusedDirection.downrangeMaxM,
            landing: landingPick
          });
          const shapedLandingDurationS =
            knownEventMaxSec > 0
              ? Math.max(
                  shapedProfile.landing.durationS,
                  clampInt(knownEventMaxSec + 30, shapedProfile.landing.durationS, shapedProfile.landing.durationS + 300)
                )
              : shapedProfile.landing.durationS;
          const shapedTier2DurationS =
            knownEventMaxSec > 0
              ? Math.max(
                  shapedProfile.tier2.durationS,
                  clampInt(knownEventMaxSec + 30, shapedProfile.tier2.durationS, shapedProfile.tier2.durationS + 300)
                )
              : shapedProfile.tier2.durationS;
          const orbitSignal = fusedDirection.signals.find((signal) => signal.kind === 'orbit') ?? null;
          const hazardSignal = fusedDirection.signals.find((signal) => signal.kind === 'hazard') ?? null;
          const landingSignal = fusedDirection.signals.find((signal) => signal.kind === 'landing') ?? null;
          const templateSignal = fusedDirection.signals.find((signal) => signal.kind === 'template') ?? null;

          if (orbitSignal?.constraint) {
            usedConstraints.push({
              constraint: orbitSignal.constraint,
              role: 'orbit_azimuth',
              weightUsed: orbitSignal.weight
            });
          }
          if (hazardSignal?.constraint) {
            usedConstraints.push({
              constraint: hazardSignal.constraint,
              role: 'hazard_azimuth',
              weightUsed: hazardSignal.weight
            });
            (stats.hazardsUsedByLaunch as Record<string, boolean>)[row.launch_id] = true;
            stats.hazardsUsed = (stats.hazardsUsed as number) + 1;
          }
          if (landingSignal?.constraint) {
            usedConstraints.push({
              constraint: landingSignal.constraint,
              role: 'landing_primary',
              weightUsed: landingSignal.weight
            });
          } else if (landingPick?.canUseDownrange) {
            usedConstraints.push({
              constraint: landingPick.constraint,
              role: 'landing_downrange',
              weightUsed: Math.max(0.25, landingPick.directionWeight * 0.5)
            });
          }
          if (tier2AltPick) {
            usedConstraints.push({
              constraint: tier2AltPick.picked.constraint,
              role: 'orbit_altitude',
              weightUsed: orbitSignal ? 0.7 : hazardSignal ? 0.55 : landingSignal ? 0.45 : 0.35
            });
          }

          if (templateSignal?.templateKey) {
            (stats.templatesUsedByLaunch as Record<string, string>)[row.launch_id] = templateSignal.templateKey;
            stats.templatesUsed = (stats.templatesUsed as number) + 1;
          }

          const primaryKind = fusedDirection.primary?.kind ?? 'heuristic';
          const primaryProvenance: EnvelopeProvenance =
            primaryKind === 'orbit'
              ? 'orbit_constraint'
              : primaryKind === 'hazard'
                ? 'hazard_area'
                : primaryKind === 'landing'
                  ? 'landing_constraint'
                  : primaryKind === 'template'
                    ? 'template_prior'
                    : 'heuristic';
          const primarySourceLabel =
            primaryKind === 'orbit'
              ? 'orbit constraint'
              : primaryKind === 'hazard'
                ? 'hazard constraint'
                : primaryKind === 'landing'
                  ? 'landing prior'
                  : primaryKind === 'template'
                    ? 'historical template'
                    : 'heuristic prior';
          const sharedAssumptions = [
            ...buildEnvelopeAssumptionLines({
              id: fusedDirection.landingCorroborated ? TRAJECTORY_ENVELOPE_IDS.landingConstraint : TRAJECTORY_ENVELOPE_IDS.tier2Corridor,
              provenance: primaryProvenance,
              rocketFamily: row.rocket_family,
              templateKey: fusedDirection.templateKey
            }),
            `Primary directional source: ${primarySourceLabel}`,
            ...fusedDirection.notes,
            orbitAzPick ? `Target orbit pick (azimuth): ${formatTargetOrbitPick(orbitAzPick.picked)}` : null,
            ...(orbitAzPick ? orbitAzPick.notes : []),
            tier2AltPick ? `Target orbit pick (altitude): ${formatTargetOrbitPick(tier2AltPick.picked)}` : null,
            ...(tier2AltPick ? tier2AltPick.notes : []),
            tier2AltPick || fusedDirection.downrangeMaxM != null ? 'Envelope shape tuned by altitude/downrange evidence.' : null,
            landingPick?.sourceId ? `Landing constraint: ${landingPick.sourceId}` : null,
            ...(landingPick ? landingPick.notes : []),
            ...(!landingPick && hazardAz ? ['Hazard-only directional corridor used.'] : [])
          ].filter(Boolean) as string[];

          const canBuildLandingPrecision =
            Boolean(landingPick?.hasCoordinates) &&
            landingPick?.lat != null &&
            landingPick?.lon != null &&
            fusedDirection.landingCorroborated;

          if (canBuildLandingPrecision) {
            const assumptions = [
              'Landing constraint used as downrange anchor; direction fused with corroborating signals',
              ...sharedAssumptions,
              'Family-envelope ascent profile'
            ];

            product = buildConstraintProduct({
              padLat: row.pad_latitude,
              padLon: row.pad_longitude,
              targetLat: landingPick.lat as number,
              targetLon: landingPick.lon as number,
              azDeg: fusedDirection.azDeg,
              sigmaDeg: fusedDirection.sigmaDeg,
              downrangeMaxM: fusedDirection.downrangeMaxM,
              durationS: shapedLandingDurationS,
              assumptions,
              rocketFamily: row.rocket_family,
              profile: shapedProfile
            });
          } else {
            const estimateLead =
              landingPick?.canUseDirection && landingSignal
                ? 'Estimate corridor (landing prior fused with stronger cues)'
                : orbitSignal
                  ? 'Estimate corridor (constraint fusion)'
                  : hazardSignal
                    ? 'Estimate corridor (hazard-backed fusion)'
                    : templateSignal
                      ? 'Estimate corridor (template prior)'
                      : 'Estimate corridor (heuristic fallback)';
            const sigmaBonusDeg = Math.max(0, fusedDirection.sigmaDeg - envelopeProfile.tier2.sigmaStartDeg);
            const assumptionsTier2 = [
              estimateLead,
              landingPick?.canUseDownrange && fusedDirection.downrangeMaxM != null
                ? 'Landing recovery data used to scale downrange horizon.'
                : null,
              ...sharedAssumptions,
              `Azimuth: ${fusedDirection.azDeg.toFixed(1)} deg (fused)`,
              orbitSignal ? null : 'Altitude: family-envelope exponential rise',
              'Downrange: family-envelope ease curve',
              'Earth model: WGS84 geodesic solve'
            ].filter(Boolean) as string[];

            product = buildTier2EstimateProduct({
              padLat: row.pad_latitude,
              padLon: row.pad_longitude,
              azDeg: fusedDirection.azDeg,
              sigmaBonusDeg,
              sigmaDeg: fusedDirection.sigmaDeg,
              altMaxM: tier2AltPick?.altMaxM ?? null,
              downrangeMaxM: fusedDirection.downrangeMaxM,
              durationS: shapedTier2DurationS,
              assumptions: assumptionsTier2,
              rocketFamily: row.rocket_family,
              profile: shapedProfile
            });
          }
        }
      }

      const applyEvents = (targetProduct: TrajectoryProduct) => {
        const trackWindows = buildTrajectoryMilestoneTrackWindows([{ trackKind: 'core_up', samples: targetProduct.samples }]);
        const projectedMilestones = applyTrajectoryMilestoneProjection({
          milestones: resolvedMilestones,
          trackWindows
        });
        targetProduct.events = buildTrajectoryCompatibilityEvents(projectedMilestones.milestones);
      };
      applyEvents(product);

      const prePublishContract = evaluateSourceContract({
        launch: row,
        product,
        usedConstraints,
        allConstraints: launchConstraints,
        sourceChecks: sourceChecksByLaunch.get(row.launch_id) ?? null,
        nowMs
      });

      let finalProduct = product;
      let finalContract = prePublishContract;
      let finalUsedConstraints = usedConstraints.slice();
      let downgraded = false;

      if (shouldDowngradeForPublish({ product, contract: prePublishContract })) {
        downgraded = true;

        const downgradedAzDeg = deriveProductAzimuthDeg(product.samples);
        const downgradedAltMaxM = maxSampleAltitudeM(product.samples);
        const downgradedDownrangeMaxM = maxSampleDownrangeM(product.samples);
        const downgradedSigmaDeg = baselineSampleSigmaDeg(product.samples);
        const downgradedProfile = shapeEnvelopeProfile({
          profile: envelopeProfile,
          missionClass,
          altitudeMaxM: downgradedAltMaxM,
          directionSigmaDeg: downgradedSigmaDeg,
          downrangeMaxM: downgradedDownrangeMaxM,
          landing: landingPick
        });
        if (
          typeof row.pad_latitude === 'number' &&
          Number.isFinite(row.pad_latitude) &&
          typeof row.pad_longitude === 'number' &&
          Number.isFinite(row.pad_longitude) &&
          typeof downgradedAzDeg === 'number' &&
          Number.isFinite(downgradedAzDeg)
        ) {
          const sigmaDeg =
            typeof downgradedSigmaDeg === 'number' && Number.isFinite(downgradedSigmaDeg)
              ? clamp(downgradedSigmaDeg + 5, downgradedProfile.tier2.sigmaClampMinDeg, downgradedProfile.tier2.sigmaClampMaxDeg)
              : 14;
          const assumptionsTier2 = [
            'Estimate corridor (downgraded from landing constrained)',
            'Precision claim removed: source contract failed',
            ...prePublishContract.blockingReasons.map((reason) => `Source contract: ${reason}`),
            ...buildEnvelopeAssumptionLines({
              id: TRAJECTORY_ENVELOPE_IDS.tier2Corridor,
              provenance: 'landing_constraint',
              rocketFamily: row.rocket_family
            }),
            `Azimuth: ${downgradedAzDeg.toFixed(1)} deg (fused track retained)`,
            'Sigma widened: source contract failed',
            'Altitude: family-envelope exponential rise',
            'Downrange: family-envelope ease curve',
            'Earth model: WGS84 geodesic solve'
          ].filter(Boolean) as string[];

          finalProduct = buildTier2EstimateProduct({
            padLat: row.pad_latitude,
            padLon: row.pad_longitude,
            azDeg: downgradedAzDeg,
            sigmaBonusDeg: 0,
            sigmaDeg,
            altMaxM: downgradedAltMaxM,
            downrangeMaxM: downgradedDownrangeMaxM,
            durationS: maxTPlusSec(product.samples),
            assumptions: assumptionsTier2,
            rocketFamily: row.rocket_family,
            profile: downgradedProfile
          });
          applyEvents(finalProduct);
          finalUsedConstraints = usedConstraints.slice();
          finalContract = evaluateSourceContract({
            launch: row,
            product: finalProduct,
            usedConstraints: finalUsedConstraints,
            allConstraints: launchConstraints,
            sourceChecks: sourceChecksByLaunch.get(row.launch_id) ?? null,
            nowMs
          });
        } else {
          finalProduct = buildPadOnlyProduct({
            lat: row.pad_latitude,
            lon: row.pad_longitude,
            rocketFamily: row.rocket_family
          });
          finalProduct.assumptions = [
            ...finalProduct.assumptions,
            'Precision claim removed: source contract failed',
            ...prePublishContract.blockingReasons.map((reason) => `Source contract: ${reason}`)
          ];
          applyEvents(finalProduct);
          finalUsedConstraints = [];
          finalContract = buildDowngradedContractEval(prePublishContract);
        }
      }

      finalProduct = attachProductMetadata({
        product: finalProduct,
        contract: finalContract,
        milestones: resolvedMilestones,
        usedConstraints: finalUsedConstraints,
        downgraded
      });

      const generatedAt = new Date().toISOString();

      return {
        launchId: row.launch_id,
        confidenceTier: finalContract.confidenceTier,
        downgraded,
        productRow: {
          launch_id: row.launch_id,
          version: finalProduct.version,
          quality: finalProduct.quality,
          generated_at: generatedAt,
          product: finalProduct,
          ingestion_run_id: runId,
          confidence_tier: finalContract.confidenceTier,
          source_sufficiency: finalContract.sourceSufficiency,
          freshness_state: finalContract.freshnessState,
          lineage_complete: finalContract.lineageComplete
        },
        sourceContractRow: {
          launch_id: row.launch_id,
          product_version: finalProduct.version,
          contract_version: 'source_contract_v2_3',
          confidence_tier: finalContract.confidenceTier,
          status: finalContract.status,
          source_sufficiency: finalContract.sourceSufficiency,
          required_fields: finalContract.requiredFields,
          missing_fields: finalContract.missingFields,
          blocking_reasons: finalContract.blockingReasons,
          freshness_state: finalContract.freshnessState,
          lineage_complete: finalContract.lineageComplete,
          evaluated_at: generatedAt,
          ingestion_run_id: runId
        },
        lineageRows: buildTrajectoryProductLineageRows({
          launchId: row.launch_id,
          productVersion: finalProduct.version,
          generatedAt,
          usedConstraints: finalUsedConstraints,
          ingestionRunId: runId
        })
      };
    });

    stats.confidenceTierByLaunch = Object.fromEntries(generated.map((entry) => [entry.launchId, entry.confidenceTier]));
    stats.downgradedLaunches = generated.filter((entry) => entry.downgraded).map((entry) => entry.launchId);
    const forcedRefreshLaunches = new Set<string>([...staleProducts, ...sourceRecheckRefreshes]);
    const materiallyChanged = generated.filter((entry) =>
      forcedRefreshLaunches.has(entry.launchId) ||
      isMaterialTrajectoryProductUpdate(existingProductByLaunch.get(entry.launchId), entry.productRow)
    );
    const materiallyChangedSet = new Set(materiallyChanged.map((entry) => entry.launchId));
    const unchangedLaunches = generated.filter((entry) => !materiallyChangedSet.has(entry.launchId)).map((entry) => entry.launchId);
    stats.forcedRefreshLaunches = Array.from(forcedRefreshLaunches.values()).filter((launchId) => materiallyChangedSet.has(launchId));
    stats.materiallyChangedLaunches = materiallyChanged.map((entry) => entry.launchId);
    stats.unchangedLaunches = unchangedLaunches;

    if (!materiallyChanged.length) {
      if (changed) {
        await supabase
          .from('system_settings')
          .upsert({ key: 'trajectory_products_top3_ids', value: eligibleIds, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      }
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'materially_unchanged' });
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: 'materially_unchanged',
        elapsedMs: Date.now() - startedAt,
        stats
      });
    }

    const rows = materiallyChanged.map((entry) => entry.productRow);
    const sourceContractRows = materiallyChanged.map((entry) => entry.sourceContractRow);
    const lineageRows = materiallyChanged.flatMap((entry) => entry.lineageRows);

    const { error: upsertError } = await supabase
      .from('launch_trajectory_products')
      .upsert(rows, { onConflict: 'launch_id' });

    if (upsertError) {
      throw new Error(`Failed to upsert launch_trajectory_products: ${upsertError.message}`);
    }

    if (sourceContractRows.length) {
      const { error: sourceContractError } = await supabase
        .from('trajectory_source_contracts')
        .insert(sourceContractRows);
      if (sourceContractError) {
        throw new Error(`Failed to insert trajectory_source_contracts: ${sourceContractError.message}`);
      }
    }

    if (lineageRows.length) {
      const { error: lineageError } = await supabase
        .from('trajectory_product_lineage')
        .upsert(lineageRows, { onConflict: 'launch_id,product_version,generated_at,source_ref_id' });
      if (lineageError) {
        throw new Error(`Failed to upsert trajectory_product_lineage: ${lineageError.message}`);
      }
    }

    stats.upserted = rows.length;
    stats.sourceContractsInserted = sourceContractRows.length;
    stats.lineageRowsInserted = lineageRows.length;

    if (changed) {
      await supabase
        .from('system_settings')
        .upsert({ key: 'trajectory_products_top3_ids', value: eligibleIds, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    }

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, stats, elapsedMs: Date.now() - startedAt }, 500);
  }
});

function evaluateSourceContract({
  launch,
  product,
  usedConstraints,
  allConstraints,
  sourceChecks,
  nowMs
}: {
  launch: LaunchRow;
  product: TrajectoryProduct;
  usedConstraints: ProductConstraintUsage[];
  allConstraints: ConstraintRow[];
  sourceChecks: LaunchSourceCheckState | null;
  nowMs: number;
}): SourceContractEval {
  const qualityLabel = String(product.qualityLabel || 'pad_only');
  // `estimate_corridor` is explicitly a best-effort template with widened uncertainty; only
  // `landing_constrained` should be treated as a strict precision claim for publish gating.
  const precisionClaim = qualityLabel === 'landing_constrained';
  const minimumTier = minimumTierForQualityLabel(qualityLabel);
  const isSpaceX = isSpaceXLaunch(launch);

  const hasPadLat = typeof launch.pad_latitude === 'number' && Number.isFinite(launch.pad_latitude);
  const hasPadLon = typeof launch.pad_longitude === 'number' && Number.isFinite(launch.pad_longitude);
  const hasPad = hasPadLat && hasPadLon;

  const directionalUsages = usedConstraints.filter((usage) => isDirectionalRole(usage.role));
  const hasDirectionalConstraint = directionalUsages.length > 0;
  const hasLandingDirectional = directionalUsages.some(
    (usage) => usage.role === 'landing_primary' && hasLandingCoordinates(usage.constraint)
  );
  const hasHazardDirectional = directionalUsages.some((usage) => usage.role === 'hazard_azimuth');
  const hasOrbitDirectional = directionalUsages.some((usage) => usage.role === 'orbit_azimuth');

  const uniqueUsedConstraints = dedupeConstraintUsage(usedConstraints);
  const targetOrbitConstraints = allConstraints.filter((constraint) => constraint.constraint_type === 'target_orbit');
  const hasMissionNumericOrbit = targetOrbitConstraints.some((constraint) => hasTargetOrbitNumerics(constraint) && !isDerivedConstraint(constraint));
  const hasSupgpConstraint = targetOrbitConstraints.some((constraint) => isSupgpConstraint(constraint));
  const hasLicensedTrajectoryFeed = targetOrbitConstraints.some((constraint) => isLicensedTrajectoryConstraint(constraint));
  const landingPrecisionCorroborated =
    hasLandingDirectional && (hasOrbitDirectional || hasHazardDirectional || hasMissionNumericOrbit || hasSupgpConstraint || hasLicensedTrajectoryFeed);

  const spaceXCompletenessState = isSpaceX
    ? hasLicensedTrajectoryFeed
      ? 'licensed'
      : hasSupgpConstraint
        ? 'supgp'
        : hasHazardDirectional
          ? 'hazard'
          : 'baseline'
    : null;
  const spaceXP95EnvelopeDeg =
    spaceXCompletenessState === 'licensed'
      ? '2-6'
      : spaceXCompletenessState === 'supgp'
        ? '4-9'
        : spaceXCompletenessState === 'hazard'
          ? '7-16'
          : spaceXCompletenessState === 'baseline'
            ? '20-35'
            : null;

  const freshnessBasisConstraints = uniqueUsedConstraints.length ? uniqueUsedConstraints : allConstraints;
  const sourceFreshness = deriveSourceFreshnessSnapshot({
    constraints: freshnessBasisConstraints,
    sourceChecks,
    nowMs,
    basis: uniqueUsedConstraints.length ? 'used_constraints' : 'all_constraints'
  });
  const freshnessThresholdHours = getFreshnessThresholdHours({
    netIso: launch.net,
    nowMs
  });
  const newestConstraintAgeHours = sourceFreshness.latestSignalAgeHours;
  const freshnessState: 'fresh' | 'stale' | 'unknown' =
    newestConstraintAgeHours == null ? 'unknown' : newestConstraintAgeHours <= freshnessThresholdHours ? 'fresh' : 'stale';

  const nonDerivedDirectionalCount = directionalUsages.filter((usage) => !isDerivedConstraint(usage.constraint)).length;
  const highConfidenceDirectional = directionalUsages.some(
    (usage) => typeof usage.constraint.confidence === 'number' && Number.isFinite(usage.constraint.confidence) && usage.constraint.confidence >= 0.85
  );

  const lineageComplete = precisionClaim
    ? uniqueUsedConstraints.length > 0 && uniqueUsedConstraints.every((constraint) => hasDeterministicConstraintIdentity(constraint))
    : uniqueUsedConstraints.every((constraint) => hasDeterministicConstraintIdentity(constraint));

  const missingFields: string[] = [];
  if (!hasPadLat) missingFields.push('pad_latitude');
  if (!hasPadLon) missingFields.push('pad_longitude');
  if (precisionClaim && !hasDirectionalConstraint) missingFields.push('directional_constraint');
  if (qualityLabel === 'landing_constrained' && !hasLandingDirectional) missingFields.push('landing_location');
  if (qualityLabel === 'landing_constrained' && !landingPrecisionCorroborated) missingFields.push('corroborating_directional_constraint');
  if (precisionClaim && !lineageComplete) missingFields.push('lineage_identity');
  if (isSpaceX && precisionClaim && !hasMissionNumericOrbit && !hasSupgpConstraint && !hasHazardDirectional) {
    missingFields.push('spacex_orbit_constraint');
  }

  const blockingReasons: string[] = [];
  if (missingFields.length) blockingReasons.push(`missing_required_fields:${missingFields.join(',')}`);
  if (precisionClaim && freshnessState === 'stale') blockingReasons.push('sources_stale_for_precision_claim');
  if (precisionClaim && !hasDirectionalConstraint) blockingReasons.push('no_constraint_backed_track');
  if (precisionClaim && uniqueUsedConstraints.length === 0) blockingReasons.push('no_constraint_lineage');
  if (precisionClaim && !lineageComplete) blockingReasons.push('lineage_incomplete');
  if (qualityLabel === 'landing_constrained' && !landingPrecisionCorroborated) {
    blockingReasons.push('landing_precision_requires_corroboration');
  }
  if (isSpaceX && precisionClaim && spaceXCompletenessState === 'baseline') {
    blockingReasons.push('spacex_baseline_only_precision_blocked');
  }
  if (isSpaceX && precisionClaim && !hasMissionNumericOrbit && !hasSupgpConstraint) {
    blockingReasons.push('spacex_missing_numeric_orbit_prelaunch');
  }

  let confidenceTier: TrajectoryConfidenceTier = 'D';
  if (!hasPad) {
    confidenceTier = 'D';
  } else if (hasDirectionalConstraint && freshnessState === 'fresh' && nonDerivedDirectionalCount > 0 && highConfidenceDirectional && lineageComplete) {
    confidenceTier = 'A';
  } else if (hasDirectionalConstraint && freshnessState !== 'stale' && lineageComplete) {
    confidenceTier = 'B';
  } else if (hasPad && (hasDirectionalConstraint || uniqueUsedConstraints.length > 0 || !precisionClaim)) {
    confidenceTier = 'C';
  } else {
    confidenceTier = 'D';
  }
  if (isSpaceX && !hasMissionNumericOrbit && !hasSupgpConstraint && confidenceTier === 'A') {
    confidenceTier = 'B';
  }
  if (isSpaceX && precisionClaim && spaceXCompletenessState === 'baseline') {
    confidenceTier = 'D';
  }

  const dedupedMissingFields = [...new Set(missingFields)];
  const dedupedBlockingReasons = [...new Set(blockingReasons)];

  const tierPass = confidenceTierRank(confidenceTier) >= confidenceTierRank(minimumTier);
  const freshnessPass = !precisionClaim || freshnessState !== 'stale';
  const missingPass = dedupedMissingFields.length === 0;
  const status: 'pass' | 'fail' = tierPass && freshnessPass && missingPass ? 'pass' : 'fail';

  const netMs = typeof launch.net === 'string' ? Date.parse(launch.net) : NaN;
  const hoursToNet = Number.isFinite(netMs) ? (netMs - nowMs) / (60 * 60 * 1000) : null;
  const sourceSummary = buildSourceSummary({
    qualityLabel,
    hasLicensedTrajectoryFeed,
    hasDirectionalConstraint,
    hasLandingDirectional,
    landingPrecisionCorroborated,
    hasMissionNumericOrbit,
    hasSupgpConstraint,
    hasHazardDirectional
  });

  return {
    confidenceTier,
    status,
    sourceSufficiency: {
      contractVersion: 'source_contract_v2_3',
      sourceFreshness,
      qualityLabel,
      sourceSummary,
      precisionClaim,
      minimumTier,
      freshnessThresholdHours,
      newestConstraintAgeHours,
      hoursToNet,
      signalSummary: {
        hasPad,
        hasDirectionalConstraint,
        hasLandingDirectional,
        landingPrecisionCorroborated,
        hasHazardDirectional,
        hasMissionNumericOrbit,
        hasSupgpConstraint,
        hasLicensedTrajectoryFeed,
        nonDerivedDirectionalCount,
        highConfidenceDirectional,
        usedConstraintCount: uniqueUsedConstraints.length
      },
      ...(isSpaceX
        ? {
            spaceX: {
              completenessState: spaceXCompletenessState,
              expectedAngularErrorP95Deg: spaceXP95EnvelopeDeg,
              missionNumericOrbitPresent: hasMissionNumericOrbit,
              supgpPresent: hasSupgpConstraint,
              hazardPresent: hasHazardDirectional
            }
          }
        : {})
    },
    requiredFields: {
      pad_latitude: true,
      pad_longitude: true,
      directional_constraint: precisionClaim,
      landing_location: qualityLabel === 'landing_constrained',
      corroborating_directional_constraint: qualityLabel === 'landing_constrained',
      freshness_threshold_hours: freshnessThresholdHours,
      minimum_tier: minimumTier,
      spacex_orbit_constraint: isSpaceX && precisionClaim
    },
    missingFields: dedupedMissingFields,
    blockingReasons: dedupedBlockingReasons,
    freshnessState,
    lineageComplete
  };
}

function shouldDowngradeForPublish({
  product,
  contract
}: {
  product: TrajectoryProduct;
  contract: SourceContractEval;
}) {
  const qualityLabel = String(product.qualityLabel || '');
  const hasPrecisionClaim = qualityLabel === 'landing_constrained';
  return hasPrecisionClaim && contract.status === 'fail';
}

function buildDowngradedContractEval(contract: SourceContractEval): SourceContractEval {
  const blockingReasons = [...contract.blockingReasons];
  if (!blockingReasons.includes('precision_claim_downgraded_to_pad_only')) {
    blockingReasons.push('precision_claim_downgraded_to_pad_only');
  }
  return {
    ...contract,
    confidenceTier: 'D',
    status: 'fail',
    blockingReasons,
    lineageComplete: false,
    sourceSufficiency: {
      ...contract.sourceSufficiency,
      downgradedToPadOnly: true,
      preDowngradeTier: contract.confidenceTier
    }
  };
}

function attachProductMetadata({
  product,
  contract,
  milestones,
  usedConstraints,
  downgraded
}: {
  product: TrajectoryProduct;
  contract: SourceContractEval;
  milestones: TrajectoryMilestoneDraft[];
  usedConstraints: ProductConstraintUsage[];
  downgraded: boolean;
}): TrajectoryProduct {
  const sourceRefIds = dedupeConstraintUsage(usedConstraints).map((constraint) => buildDeterministicSourceRefId(constraint));
  const coreTrack = {
    trackKind: 'core_up',
    samples: product.samples
  };
  const tracks = [coreTrack];
  const trackWindows = buildTrajectoryMilestoneTrackWindows(tracks);
  const projectedMilestones = applyTrajectoryMilestoneProjection({
    milestones,
    trackWindows
  });
  const compatibilityEvents = buildTrajectoryCompatibilityEvents(projectedMilestones.milestones);

  return {
    ...product,
    events: compatibilityEvents,
    sourceSufficiency: {
      confidenceTier: contract.confidenceTier,
      status: contract.status,
      freshnessState: contract.freshnessState,
      lineageComplete: contract.lineageComplete,
      requiredFields: contract.requiredFields,
      missingFields: contract.missingFields,
      blockingReasons: contract.blockingReasons,
      ...contract.sourceSufficiency
    },
    milestones: projectedMilestones.milestones,
    milestoneSummary: projectedMilestones.summary,
    tracks,
    trackSummary: {
      quality: product.quality,
      qualityLabel: product.qualityLabel,
      confidenceTier: contract.confidenceTier,
      freshnessState: contract.freshnessState,
      precisionClaim: product.quality > 0 && contract.confidenceTier !== 'D',
      sourceCount: sourceRefIds.length,
      sourceRefIds,
      trackCount: tracks.length,
      downgraded
    }
  };
}

function buildTrajectoryProductLineageRows({
  launchId,
  productVersion,
  generatedAt,
  usedConstraints,
  ingestionRunId
}: {
  launchId: string;
  productVersion: string;
  generatedAt: string;
  usedConstraints: ProductConstraintUsage[];
  ingestionRunId: number | null;
}) {
  if (!usedConstraints.length) return [] as Array<Record<string, unknown>>;

  const rowsByRef = new Map<
    string,
    {
      row: Record<string, unknown>;
      roles: Set<string>;
    }
  >();

  for (const usage of usedConstraints) {
    const constraint = usage.constraint;
    const sourceRefId = buildDeterministicSourceRefId(constraint);
    const confidence =
      typeof constraint.confidence === 'number' && Number.isFinite(constraint.confidence) ? constraint.confidence : null;

    let entry = rowsByRef.get(sourceRefId);
    if (!entry) {
      const extractedFieldMap =
        constraint.extracted_field_map && typeof constraint.extracted_field_map === 'object'
          ? { ...(constraint.extracted_field_map as Record<string, unknown>) }
          : {};

      entry = {
        row: {
          launch_id: launchId,
          product_version: productVersion,
          generated_at: generatedAt,
          source_ref_id: sourceRefId,
          source: String(constraint.source || 'unknown'),
          source_id: constraint.source_id ?? null,
          source_kind: constraint.constraint_type || null,
          license_class: constraint.license_class ?? null,
          constraint_id: typeof constraint.id === 'number' && Number.isFinite(constraint.id) ? Math.trunc(constraint.id) : null,
          source_document_id: extractSourceDocumentId(constraint),
          source_url: extractSourceUrl(constraint),
          source_hash: constraint.source_hash ?? extractDocumentHash(constraint),
          parser_version: constraint.parser_version ?? extractParserVersion(constraint),
          parse_rule_id: constraint.parse_rule_id ?? null,
          extracted_field_map: extractedFieldMap,
          fetched_at: constraint.fetched_at ?? null,
          weight_used: usage.weightUsed,
          confidence,
          ingestion_run_id: ingestionRunId
        },
        roles: new Set<string>()
      };
      rowsByRef.set(sourceRefId, entry);
    } else {
      const previousWeight =
        typeof entry.row.weight_used === 'number' && Number.isFinite(entry.row.weight_used) ? entry.row.weight_used : 0;
      if (usage.weightUsed > previousWeight) entry.row.weight_used = usage.weightUsed;
      const previousConfidence =
        typeof entry.row.confidence === 'number' && Number.isFinite(entry.row.confidence) ? entry.row.confidence : null;
      if (confidence != null && (previousConfidence == null || confidence > previousConfidence)) {
        entry.row.confidence = confidence;
      }
    }

    entry.roles.add(usage.role);
  }

  return [...rowsByRef.values()].map((entry) => {
    const baseMap =
      entry.row.extracted_field_map && typeof entry.row.extracted_field_map === 'object'
        ? (entry.row.extracted_field_map as Record<string, unknown>)
        : {};
    entry.row.extracted_field_map = {
      ...baseMap,
      lineage_roles: [...entry.roles].sort()
    };
    return entry.row;
  });
}

function dedupeConstraintUsage(usedConstraints: ProductConstraintUsage[]) {
  const byKey = new Map<string, ConstraintRow>();
  for (const usage of usedConstraints) {
    const key = buildConstraintIdentityKey(usage.constraint);
    if (!byKey.has(key)) byKey.set(key, usage.constraint);
  }
  return [...byKey.values()];
}

function buildConstraintIdentityKey(constraint: ConstraintRow) {
  const idPart = typeof constraint.id === 'number' && Number.isFinite(constraint.id) ? `id:${Math.trunc(constraint.id)}` : null;
  if (idPart) return idPart;
  return [
    `type:${normalizeRefPart(constraint.constraint_type || 'unknown')}`,
    `src:${normalizeRefPart(constraint.source || 'unknown')}`,
    `sid:${normalizeRefPart(constraint.source_id || '')}`,
    `hash:${normalizeRefPart(constraint.source_hash || '')}`,
    `fetch:${normalizeRefPart(constraint.fetched_at || '')}`
  ].join('|');
}

function buildDeterministicSourceRefId(constraint: ConstraintRow) {
  const type = normalizeRefPart(constraint.constraint_type || 'unknown');
  if (typeof constraint.id === 'number' && Number.isFinite(constraint.id)) {
    return `${type}:cid:${Math.trunc(constraint.id)}`;
  }
  const source = normalizeRefPart(constraint.source || 'unknown');
  const sourceId = normalizeRefPart(constraint.source_id || '');
  if (sourceId) return `${type}:${source}:sid:${sourceId}`;
  const sourceHash = normalizeRefPart(constraint.source_hash || extractDocumentHash(constraint) || '');
  if (sourceHash) return `${type}:${source}:hash:${sourceHash}`;
  const fetched = normalizeRefPart(constraint.fetched_at || '');
  if (fetched) return `${type}:${source}:fetched:${fetched}`;
  return `${type}:${source}:anonymous`;
}

function normalizeRefPart(value: unknown) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.replace(/[^a-z0-9._:-]+/g, '_').replace(/_+/g, '_').slice(0, 128);
}

function extractSourceDocumentId(constraint: ConstraintRow) {
  const data = constraint.data && typeof constraint.data === 'object' ? (constraint.data as any) : null;
  const fromData = parseUuidLike(data?.documentId ?? null);
  if (fromData) return fromData;
  if (constraint.source === 'presskit_auto') return parseUuidLike(constraint.source_id ?? null);
  return null;
}

function extractSourceUrl(constraint: ConstraintRow) {
  const data = constraint.data && typeof constraint.data === 'object' ? (constraint.data as any) : null;
  const value = typeof data?.sourceUrl === 'string' ? data.sourceUrl.trim() : '';
  return value || null;
}

function extractDocumentHash(constraint: ConstraintRow) {
  const data = constraint.data && typeof constraint.data === 'object' ? (constraint.data as any) : null;
  const value = typeof data?.documentHash === 'string' ? data.documentHash.trim() : '';
  return value || null;
}

function extractParserVersion(constraint: ConstraintRow) {
  const data = constraint.data && typeof constraint.data === 'object' ? (constraint.data as any) : null;
  const value = typeof data?.parserVersion === 'string' ? data.parserVersion.trim() : '';
  return value || null;
}

function parseUuidLike(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
}

function hasLandingCoordinates(constraint: ConstraintRow) {
  if (constraint.constraint_type !== 'landing') return false;
  const landingLocation = constraint?.data?.landing_location;
  return (
    typeof landingLocation?.latitude === 'number' &&
    Number.isFinite(landingLocation.latitude) &&
    typeof landingLocation?.longitude === 'number' &&
    Number.isFinite(landingLocation.longitude)
  );
}

function isDirectionalRole(role: ProductConstraintRole) {
  return role === 'landing_primary' || role === 'orbit_azimuth' || role === 'hazard_azimuth';
}

function isDerivedConstraint(constraint: ConstraintRow) {
  return Boolean(constraint?.data?.derived);
}

function isSupgpConstraint(constraint: ConstraintRow) {
  if (String(constraint.source || '').toLowerCase() === 'celestrak_supgp') return true;
  const orbitType = String(constraint?.data?.orbitType || '').toLowerCase();
  if (orbitType.includes('supgp')) return true;
  const sourceId = String(constraint.source_id || '').toLowerCase();
  return sourceId.startsWith('supgp:');
}

function isLicensedTrajectoryConstraint(constraint: ConstraintRow) {
  const license = String(constraint.license_class || '').toLowerCase();
  if (!license) return false;
  return license.includes('licensed') || license.includes('partner') || license.includes('operator');
}

function hasTargetOrbitNumerics(constraint: ConstraintRow) {
  if (constraint.constraint_type !== 'target_orbit') return false;
  const data = constraint.data && typeof constraint.data === 'object' ? (constraint.data as any) : null;
  if (!data) return false;
  const hasDirection =
    typeof data.flight_azimuth_deg === 'number' ||
    typeof data.inclination_deg === 'number';
  const hasOrbitShape =
    typeof data.altitude_km === 'number' ||
    typeof data.apogee_km === 'number' ||
    typeof data.perigee_km === 'number';
  return hasDirection || hasOrbitShape;
}

function isSpaceXLaunch(launch: LaunchRow) {
  const provider = String(launch.provider || '').toLowerCase();
  const vehicle = String(launch.vehicle || '').toLowerCase();
  const mission = String(launch.mission_name || '').toLowerCase();
  return (
    provider.includes('spacex') ||
    vehicle.includes('falcon') ||
    vehicle.includes('starship') ||
    mission.includes('spacex') ||
    mission.includes('starlink')
  );
}

function hasDeterministicConstraintIdentity(constraint: ConstraintRow) {
  if (typeof constraint.id === 'number' && Number.isFinite(constraint.id)) return true;
  if (normalizeRefPart(constraint.source_id || '')) return true;
  if (normalizeRefPart(constraint.source_hash || '')) return true;
  if (parseUuidLike((constraint?.data as any)?.documentId || null)) return true;
  return false;
}

function newestConstraintAgeHoursFromRows(constraints: ConstraintRow[], nowMs: number) {
  let newestMs = Number.NEGATIVE_INFINITY;
  for (const constraint of constraints) {
    const fetchedAtMs = typeof constraint.fetched_at === 'string' ? Date.parse(constraint.fetched_at) : NaN;
    if (!Number.isFinite(fetchedAtMs)) continue;
    if (fetchedAtMs > newestMs) newestMs = fetchedAtMs;
  }
  if (newestMs === Number.NEGATIVE_INFINITY) return null;
  return Math.max(0, (nowMs - newestMs) / (60 * 60 * 1000));
}

function emptyLaunchSourceCheckState(): LaunchSourceCheckState {
  const emptyHazardState = emptyHazardScanState();
  return {
    orbitCheckedAtMs: null,
    landingCheckedAtMs: null,
    hazardCheckedAtMs: null,
    navcenHazardScannedAtMs: emptyHazardState.scannedAtMs,
    navcenHazardMatchedAtMs: emptyHazardState.matchedAtMs,
    navcenHazardLatestScanMatched: emptyHazardState.latestScanMatched,
    faaHazardScannedAtMs: emptyHazardState.scannedAtMs,
    faaHazardMatchedAtMs: emptyHazardState.matchedAtMs,
    faaHazardLatestScanMatched: emptyHazardState.latestScanMatched
  };
}

function newestSourceCheckAtMs(state: LaunchSourceCheckState | null) {
  if (!state) return null;
  const values = [state.orbitCheckedAtMs, state.landingCheckedAtMs, state.hazardCheckedAtMs].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );
  if (!values.length) return null;
  return Math.max(...values);
}

function isoFromMs(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Date(value).toISOString();
}

function sourceCheckKindForConstraintType(constraintType: string | null): TrajectorySourceCheckKind | null {
  if (constraintType === 'target_orbit') return 'orbit';
  if (constraintType === 'landing') return 'landing';
  if (constraintType === 'hazard_area') return 'hazard';
  return null;
}

function getSourceCheckMsForKind(state: LaunchSourceCheckState | null, kind: TrajectorySourceCheckKind | null) {
  if (!state || !kind) return null;
  if (kind === 'orbit') return state.orbitCheckedAtMs;
  if (kind === 'landing') return state.landingCheckedAtMs;
  return state.hazardCheckedAtMs;
}

function newestHazardSourceScanAtMs(state: LaunchSourceCheckState | null) {
  if (!state) return null;
  const values = [state.navcenHazardScannedAtMs, state.faaHazardScannedAtMs].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );
  if (!values.length) return null;
  return Math.max(...values);
}

function hasPositiveHazardCoverageEntry(row: unknown) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const value = row as Record<string, unknown>;
  const hazardAreasMatched = Number(value.hazardAreasMatched);
  const constraintsUpserted = Number(value.constraintsUpserted);
  return (
    (Number.isFinite(hazardAreasMatched) && hazardAreasMatched > 0) ||
    (Number.isFinite(constraintsUpserted) && constraintsUpserted > 0)
  );
}

function getHazardSourceStateForConstraint(state: LaunchSourceCheckState | null, constraint: ConstraintRow) {
  if (!state) return null;
  const source = String(constraint.source || '').toLowerCase();
  if (source === 'navcen_bnm') {
    return {
      scannedAtMs: state.navcenHazardScannedAtMs,
      matchedAtMs: state.navcenHazardMatchedAtMs,
      latestScanMatched: state.navcenHazardLatestScanMatched
    };
  }
  if (source === 'faa_tfr') {
    return {
      scannedAtMs: state.faaHazardScannedAtMs,
      matchedAtMs: state.faaHazardMatchedAtMs,
      latestScanMatched: state.faaHazardLatestScanMatched
    };
  }
  return null;
}

function shouldSuppressHazardConstraint(constraint: ConstraintRow, sourceChecks: LaunchSourceCheckState | null) {
  if (constraint.constraint_type !== 'hazard_area') return false;
  const sourceState = getHazardSourceStateForConstraint(sourceChecks, constraint);
  if (!sourceState) return false;

  const fetchedAtMs = typeof constraint.fetched_at === 'string' ? Date.parse(constraint.fetched_at) : NaN;
  if (!Number.isFinite(fetchedAtMs)) return false;

  return shouldSuppressHazardConstraintFromScanState({
    fetchedAtMs,
    sourceState: {
      scannedAtMs:
        typeof sourceState.scannedAtMs === 'number' && Number.isFinite(sourceState.scannedAtMs) ? sourceState.scannedAtMs : null,
      matchedAtMs:
        typeof sourceState.matchedAtMs === 'number' && Number.isFinite(sourceState.matchedAtMs) ? sourceState.matchedAtMs : null,
      latestScanMatched: sourceState.latestScanMatched === true ? true : sourceState.latestScanMatched === false ? false : null
    }
  });
}

function deriveSourceFreshnessSnapshot({
  constraints,
  sourceChecks,
  nowMs,
  basis
}: {
  constraints: ConstraintRow[];
  sourceChecks: LaunchSourceCheckState | null;
  nowMs: number;
  basis: SourceFreshnessSnapshot['basis'];
}): SourceFreshnessSnapshot {
  let latestConstraintMs = Number.NEGATIVE_INFINITY;
  let latestSourceCheckMs = Number.NEGATIVE_INFINITY;
  const basisConstraintTypes = new Set<string>();

  for (const constraint of constraints) {
    basisConstraintTypes.add(constraint.constraint_type);

    const fetchedAtMs = typeof constraint.fetched_at === 'string' ? Date.parse(constraint.fetched_at) : NaN;
    if (Number.isFinite(fetchedAtMs) && fetchedAtMs > latestConstraintMs) {
      latestConstraintMs = fetchedAtMs;
    }

    const sourceCheckMs = getSourceCheckMsForKind(sourceChecks, sourceCheckKindForConstraintType(constraint.constraint_type));
    if (typeof sourceCheckMs === 'number' && Number.isFinite(sourceCheckMs) && sourceCheckMs > latestSourceCheckMs) {
      latestSourceCheckMs = sourceCheckMs;
    }
  }

  const latestSignalMs = Math.max(latestConstraintMs, latestSourceCheckMs);
  const latestSignalAgeHours =
    latestSignalMs === Number.NEGATIVE_INFINITY ? null : Math.max(0, (nowMs - latestSignalMs) / (60 * 60 * 1000));

  return {
    basis,
    basisConstraintTypes: Array.from(basisConstraintTypes.values()).sort(),
    latestConstraintAt: latestConstraintMs === Number.NEGATIVE_INFINITY ? null : new Date(latestConstraintMs).toISOString(),
    latestSourceCheckAt: latestSourceCheckMs === Number.NEGATIVE_INFINITY ? null : new Date(latestSourceCheckMs).toISOString(),
    latestSignalAt: latestSignalMs === Number.NEGATIVE_INFINITY ? null : new Date(latestSignalMs).toISOString(),
    latestSignalAgeHours,
    orbitCheckedAt: isoFromMs(sourceChecks?.orbitCheckedAtMs ?? null),
    landingCheckedAt: isoFromMs(sourceChecks?.landingCheckedAtMs ?? null),
    hazardCheckedAt: isoFromMs(sourceChecks?.hazardCheckedAtMs ?? null)
  };
}

function getFreshnessThresholdHours({
  netIso,
  nowMs
}: {
  netIso: string | null;
  nowMs: number;
}) {
  const netMs = typeof netIso === 'string' ? Date.parse(netIso) : NaN;
  if (!Number.isFinite(netMs)) return 24;
  const hoursToLaunch = (netMs - nowMs) / (60 * 60 * 1000);
  // Keep thresholds tight enough for near-launch relevance, but aligned with hourly ingest cadence.
  if (hoursToLaunch <= 2 && hoursToLaunch >= -1) return 1; // T-2h..T+1h
  if (hoursToLaunch < -1 && hoursToLaunch >= -24) return 2; // T+1h..T+24h reconciliation
  if (hoursToLaunch <= 24 && hoursToLaunch > 2) return 2; // T-24h..T-2h
  if (hoursToLaunch <= 168 && hoursToLaunch > 24) return 4; // T-7d..T-24h
  if (hoursToLaunch <= 720 && hoursToLaunch > 168) return 8; // T-30d..T-7d
  return 24;
}

async function loadLaunchSourceChecksByLaunch({
  supabase,
  eligibleIds
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  eligibleIds: string[];
}) {
  const out = new Map<string, LaunchSourceCheckState>();
  for (const launchId of eligibleIds) out.set(launchId, emptyLaunchSourceCheckState());
  if (!eligibleIds.length) return out;

  const { data, error } = await supabase
    .from('ingestion_runs')
    .select('job_name, started_at, ended_at, success, stats')
    .in('job_name', ['trajectory_orbit_ingest', 'trajectory_constraints_ingest', 'navcen_bnm_ingest', 'faa_trajectory_hazard_ingest'])
    .eq('success', true)
    .order('started_at', { ascending: false })
    .limit(96);

  if (error) throw error;

  for (const rawRun of (data || []) as Array<Record<string, unknown>>) {
    const jobName = typeof rawRun?.job_name === 'string' ? rawRun.job_name : null;
    if (!jobName) continue;

    const endedAtMs = typeof rawRun?.ended_at === 'string' ? Date.parse(rawRun.ended_at) : NaN;
    const startedAtMs = typeof rawRun?.started_at === 'string' ? Date.parse(rawRun.started_at) : NaN;
    const signalAtMs = Number.isFinite(endedAtMs) ? endedAtMs : startedAtMs;
    if (!Number.isFinite(signalAtMs)) continue;

    const stats = rawRun?.stats && typeof rawRun.stats === 'object' ? (rawRun.stats as Record<string, unknown>) : null;
    const launchCoverage = stats?.launchCoverage;

    if (jobName === 'trajectory_orbit_ingest' || jobName === 'trajectory_constraints_ingest') {
      if (!Array.isArray(launchCoverage)) continue;
      for (const row of launchCoverage) {
        const launchId = typeof (row as any)?.launchId === 'string' ? (row as any).launchId : null;
        if (!launchId) continue;
        const entry = out.get(launchId);
        if (!entry) continue;
        if (jobName === 'trajectory_orbit_ingest') {
          entry.orbitCheckedAtMs = Math.max(entry.orbitCheckedAtMs ?? Number.NEGATIVE_INFINITY, signalAtMs);
        } else {
          entry.landingCheckedAtMs = Math.max(entry.landingCheckedAtMs ?? Number.NEGATIVE_INFINITY, signalAtMs);
        }
      }
      continue;
    }

    if (
      (jobName === 'navcen_bnm_ingest' || jobName === 'faa_trajectory_hazard_ingest') &&
      launchCoverage &&
      typeof launchCoverage === 'object' &&
      !Array.isArray(launchCoverage)
    ) {
      for (const [launchId, row] of Object.entries(launchCoverage as Record<string, unknown>)) {
        const entry = out.get(launchId);
        if (!entry) continue;
        const matched = hasPositiveHazardCoverageEntry(row);
        entry.hazardCheckedAtMs = Math.max(entry.hazardCheckedAtMs ?? Number.NEGATIVE_INFINITY, signalAtMs);

        if (jobName === 'navcen_bnm_ingest') {
          const nextState = mergeHazardScanState(
            {
              scannedAtMs: entry.navcenHazardScannedAtMs,
              matchedAtMs: entry.navcenHazardMatchedAtMs,
              latestScanMatched: entry.navcenHazardLatestScanMatched
            },
            { signalAtMs, matched }
          );
          entry.navcenHazardScannedAtMs = nextState.scannedAtMs;
          entry.navcenHazardMatchedAtMs = nextState.matchedAtMs;
          entry.navcenHazardLatestScanMatched = nextState.latestScanMatched;
        } else {
          const nextState = mergeHazardScanState(
            {
              scannedAtMs: entry.faaHazardScannedAtMs,
              matchedAtMs: entry.faaHazardMatchedAtMs,
              latestScanMatched: entry.faaHazardLatestScanMatched
            },
            { signalAtMs, matched }
          );
          entry.faaHazardScannedAtMs = nextState.scannedAtMs;
          entry.faaHazardMatchedAtMs = nextState.matchedAtMs;
          entry.faaHazardLatestScanMatched = nextState.latestScanMatched;
        }
      }
    }
  }

  return out;
}

function minimumTierForQualityLabel(qualityLabel: string): TrajectoryConfidenceTier {
  if (qualityLabel === 'landing_constrained') return 'B';
  if (qualityLabel === 'estimate_corridor') return 'C';
  return 'D';
}

function buildSourceSummary({
  qualityLabel,
  hasLicensedTrajectoryFeed,
  hasDirectionalConstraint,
  hasLandingDirectional,
  landingPrecisionCorroborated,
  hasMissionNumericOrbit,
  hasSupgpConstraint,
  hasHazardDirectional
}: {
  qualityLabel: string;
  hasLicensedTrajectoryFeed: boolean;
  hasDirectionalConstraint: boolean;
  hasLandingDirectional: boolean;
  landingPrecisionCorroborated: boolean;
  hasMissionNumericOrbit: boolean;
  hasSupgpConstraint: boolean;
  hasHazardDirectional: boolean;
}) {
  if (hasLicensedTrajectoryFeed) {
    return {
      code: 'partner_feed',
      label: 'Partner feed'
    };
  }
  if (qualityLabel === 'landing_constrained' && hasLandingDirectional && landingPrecisionCorroborated) {
    return {
      code: 'corroborated_landing',
      label: 'Constraint-backed (corroborated landing)'
    };
  }
  if (hasMissionNumericOrbit) {
    return {
      code: 'constraint_backed',
      label: 'Constraint-backed (official numeric)'
    };
  }
  if (hasSupgpConstraint) {
    return {
      code: 'constraint_backed',
      label: 'Constraint-backed (SupGP)'
    };
  }
  if (hasHazardDirectional) {
    return {
      code: 'constraint_backed',
      label: 'Constraint-backed (hazard)'
    };
  }
  if (hasLandingDirectional) {
    return {
      code: 'landing_prior',
      label: 'Landing prior'
    };
  }
  if (hasDirectionalConstraint) {
    return {
      code: 'constraint_backed',
      label: 'Constraint-backed'
    };
  }
  if (qualityLabel === 'estimate_corridor') {
    return {
      code: 'template_estimate',
      label: 'Template estimate'
    };
  }
  return {
    code: 'pad_only',
    label: 'Pad-only'
  };
}

function confidenceTierRank(tier: TrajectoryConfidenceTier) {
  if (tier === 'A') return 4;
  if (tier === 'B') return 3;
  if (tier === 'C') return 2;
  return 1;
}

function buildPadOnlyProduct({
  lat,
  lon,
  rocketFamily
}: {
  lat: number | null;
  lon: number | null;
  rocketFamily?: string | null;
}): TrajectoryProduct {
  const samples = [];
  if (typeof lat === 'number' && typeof lon === 'number') {
    const ecef = ecefFromLatLon(lat, lon, 0);
    samples.push({
      tPlusSec: 0,
      ecef,
      latDeg: lat,
      lonDeg: lon,
      altM: 0,
      downrangeM: 0,
      azimuthDeg: 0,
      sigmaDeg: 20,
      covariance: { along_track: 15, cross_track: 20 },
      uncertainty: { sigmaDeg: 20, covariance: { along_track: 15, cross_track: 20 } }
    });
  }
  return {
    version: 'traj_v1',
    quality: 0,
    qualityLabel: 'pad_only',
    generatedAt: new Date().toISOString(),
    assumptions: [
      'Pad-only position at T+0',
      ...buildEnvelopeAssumptionLines({
        id: TRAJECTORY_ENVELOPE_IDS.padOnly,
        provenance: 'pad_only',
        rocketFamily
      }),
      'No ascent model applied'
    ],
    samples,
    events: [] as TrajectoryEvent[]
  };
}

function buildConstraintProduct({
  padLat,
  padLon,
  targetLat,
  targetLon,
  azDeg,
  sigmaDeg,
  downrangeMaxM,
  durationS,
  assumptions,
  rocketFamily,
  profile
}: {
  padLat: number;
  padLon: number;
  targetLat: number;
  targetLon: number;
  azDeg?: number | null;
  sigmaDeg?: number | null;
  downrangeMaxM?: number | null;
  durationS?: number | null;
  assumptions: string[];
  rocketFamily?: string | null;
  profile?: EnvelopeProfile;
}): TrajectoryProduct {
  const resolvedProfile = profile ?? resolveEnvelopeProfile(rocketFamily);
  const durationLimit = typeof durationS === 'number' && Number.isFinite(durationS) ? Math.max(resolvedProfile.landing.stepS, Math.round(durationS)) : resolvedProfile.landing.durationS;
  const stepS = resolvedProfile.landing.stepS;
  const altMaxM = resolvedProfile.landing.altMaxM;

  const landingDistKm = haversineKm(padLat, padLon, targetLat, targetLon);
  const launchAzDeg =
    typeof azDeg === 'number' && Number.isFinite(azDeg) ? wrapAzDeg(azDeg) : bearingDeg(padLat, padLon, targetLat, targetLon);

  // Use the landing location as a *directional constraint* (azimuth), not as an endpoint.
  // Scale downrange horizon by landing distance, but keep a sane minimum so the curve is visible.
  const launchDownrangeMaxM = clamp(
    typeof downrangeMaxM === 'number' && Number.isFinite(downrangeMaxM) ? downrangeMaxM : landingDistKm * 1000,
    resolvedProfile.landing.downrangeMinM,
    resolvedProfile.landing.downrangeMaxM
  );

  // Widen uncertainty when landing is near the pad (RTLS or ambiguous landing types).
  const baseSigmaDeg =
    typeof sigmaDeg === 'number' && Number.isFinite(sigmaDeg) ? sigmaDeg : resolvedProfile.landing.sigmaBaseDeg;
  let sigmaStartDeg = clamp(baseSigmaDeg, resolvedProfile.landing.sigmaClampMinDeg, resolvedProfile.landing.sigmaClampMaxDeg);
  if (Number.isFinite(landingDistKm)) {
    if (landingDistKm < 30) sigmaStartDeg = Math.max(sigmaStartDeg, resolvedProfile.landing.nearPadFloorDeg);
    else if (landingDistKm < 80) sigmaStartDeg = Math.max(sigmaStartDeg, resolvedProfile.landing.midRangeFloorDeg);
  }
  const sigmaEndDeg = clamp(
    sigmaStartDeg + resolvedProfile.landing.sigmaSpreadDeg,
    sigmaStartDeg,
    resolvedProfile.landing.sigmaClampMaxDeg * 2
  );

  const samples: Array<{
    tPlusSec: number;
    ecef: [number, number, number];
    latDeg: number;
    lonDeg: number;
    altM: number;
    downrangeM: number;
    azimuthDeg: number;
    sigmaDeg: number;
    covariance: { along_track: number; cross_track: number };
    uncertainty: {
      sigmaDeg: number;
      covariance: { along_track: number; cross_track: number };
    };
  }> = [];

  for (let t = 0; t <= durationLimit; t += stepS) {
    const u = clamp(t / durationLimit, 0, 1);
    const alt = altMaxM * (1 - Math.exp(-resolvedProfile.landing.altRiseRate * u));
    const dr = launchDownrangeMaxM * Math.pow(u, resolvedProfile.landing.downrangeExponent);
    const pos = directWgs84({ lat1Deg: padLat, lon1Deg: padLon, azDeg: launchAzDeg, distM: dr });
    const sigma = sigmaStartDeg + (sigmaEndDeg - sigmaStartDeg) * Math.sqrt(u);
    const alongTrack = clamp(sigma * resolvedProfile.landing.alongTrackRatio, 0, 90);
    const crossTrack = clamp(sigma, 0, 90);
    samples.push({
      tPlusSec: t,
      ecef: ecefFromLatLon(pos.latDeg, pos.lonDeg, alt),
      latDeg: pos.latDeg,
      lonDeg: pos.lonDeg,
      altM: alt,
      downrangeM: dr,
      azimuthDeg: launchAzDeg,
      sigmaDeg: sigma,
      covariance: { along_track: alongTrack, cross_track: crossTrack },
      uncertainty: {
        sigmaDeg: sigma,
        covariance: { along_track: alongTrack, cross_track: crossTrack }
      }
    });
  }

  return {
    version: 'traj_v1',
    quality: 1,
    qualityLabel: 'landing_constrained',
    generatedAt: new Date().toISOString(),
    assumptions: [
      ...assumptions,
      `Envelope profile: ${resolvedProfile.profileId}`,
      `Landing azimuth: ${launchAzDeg.toFixed(1)} deg`,
      Number.isFinite(landingDistKm) ? `Landing distance: ${Math.round(landingDistKm)} km` : null,
      typeof downrangeMaxM === 'number' && Number.isFinite(downrangeMaxM)
        ? `Downrange horizon: ${Math.round(launchDownrangeMaxM / 1000)} km`
        : null,
      `Landing sigma baseline: ${baseSigmaDeg.toFixed(1)} deg`,
      `Altitude rise rate: ${resolvedProfile.landing.altRiseRate.toFixed(2)} (family envelope)`,
      `Downrange exponent: ${resolvedProfile.landing.downrangeExponent.toFixed(2)} (family envelope)`,
      'Earth model: WGS84 geodesic solve'
    ].filter(Boolean) as string[],
    samples,
    events: [] as TrajectoryEvent[]
  };
}

function buildTier2EstimateProduct({
  padLat,
  padLon,
  azDeg,
  sigmaBonusDeg,
  sigmaDeg,
  altMaxM,
  downrangeMaxM,
  durationS,
  assumptions,
  rocketFamily,
  profile
}: {
  padLat: number;
  padLon: number;
  azDeg: number;
  sigmaBonusDeg: number;
  sigmaDeg?: number | null;
  altMaxM?: number | null;
  downrangeMaxM?: number | null;
  durationS?: number | null;
  assumptions: string[];
  rocketFamily?: string | null;
  profile?: EnvelopeProfile;
}): TrajectoryProduct {
  const resolvedProfile = profile ?? resolveEnvelopeProfile(rocketFamily);
  const durationLimit = typeof durationS === 'number' && Number.isFinite(durationS) ? Math.max(resolvedProfile.tier2.stepS, Math.round(durationS)) : resolvedProfile.tier2.durationS;
  const stepS = resolvedProfile.tier2.stepS;
  const altMaxMeters = typeof altMaxM === 'number' && Number.isFinite(altMaxM) ? altMaxM : resolvedProfile.tier2.altDefaultM;
  const altMax = clamp(altMaxMeters, resolvedProfile.tier2.altMinM, resolvedProfile.tier2.altMaxM);
  const downrangeLimitM = clamp(
    typeof downrangeMaxM === 'number' && Number.isFinite(downrangeMaxM) ? downrangeMaxM : resolvedProfile.tier2.downrangeMaxM,
    resolvedProfile.landing.downrangeMinM,
    resolvedProfile.tier2.downrangeMaxM
  );
  const sigmaStartDeg = typeof sigmaDeg === 'number' && Number.isFinite(sigmaDeg)
    ? clamp(sigmaDeg, resolvedProfile.tier2.sigmaClampMinDeg, resolvedProfile.tier2.sigmaClampMaxDeg)
    : resolvedProfile.tier2.sigmaStartDeg;
  const sigmaEndDeg = typeof sigmaDeg === 'number' && Number.isFinite(sigmaDeg)
    ? clamp(Math.max(sigmaDeg + 2, sigmaDeg * 1.15), sigmaStartDeg, resolvedProfile.tier2.sigmaClampMaxDeg)
    : resolvedProfile.tier2.sigmaEndDeg;

  const samples: Array<{
    tPlusSec: number;
    ecef: [number, number, number];
    latDeg: number;
    lonDeg: number;
    altM: number;
    downrangeM: number;
    azimuthDeg: number;
    sigmaDeg: number;
    covariance: { along_track: number; cross_track: number };
    uncertainty: {
      sigmaDeg: number;
      covariance: { along_track: number; cross_track: number };
    };
  }> = [];

  for (let t = 0; t <= durationLimit; t += stepS) {
    const u = clamp(t / durationLimit, 0, 1);
    const alt = altMax * (1 - Math.exp(-resolvedProfile.tier2.altRiseRate * u));
    const dr = downrangeLimitM * Math.pow(u, resolvedProfile.tier2.downrangeExponent);
    const pos = directWgs84({ lat1Deg: padLat, lon1Deg: padLon, azDeg, distM: dr });
    const sigmaRaw = sigmaStartDeg + (sigmaEndDeg - sigmaStartDeg) * Math.pow(u, resolvedProfile.tier2.sigmaCurvePower) + sigmaBonusDeg;
    const sigma = clamp(sigmaRaw, resolvedProfile.tier2.sigmaClampMinDeg, resolvedProfile.tier2.sigmaClampMaxDeg);
    const alongTrack = clamp(sigma * resolvedProfile.tier2.alongTrackRatio, 0, 90);
    const crossTrack = clamp(sigma, 0, 90);
    samples.push({
      tPlusSec: t,
      ecef: ecefFromLatLon(pos.latDeg, pos.lonDeg, alt),
      latDeg: pos.latDeg,
      lonDeg: pos.lonDeg,
      altM: alt,
      downrangeM: dr,
      azimuthDeg: azDeg,
      sigmaDeg: sigma,
      covariance: { along_track: alongTrack, cross_track: crossTrack },
      uncertainty: {
        sigmaDeg: sigma,
        covariance: { along_track: alongTrack, cross_track: crossTrack }
      }
    });
  }

  return {
    version: 'traj_v1',
    quality: 2,
    qualityLabel: 'estimate_corridor',
    generatedAt: new Date().toISOString(),
    assumptions: [
      ...assumptions,
      `Envelope profile: ${resolvedProfile.profileId}`,
      typeof downrangeMaxM === 'number' && Number.isFinite(downrangeMaxM)
        ? `Downrange horizon: ${Math.round(downrangeLimitM / 1000)} km`
        : null,
      typeof sigmaDeg === 'number' && Number.isFinite(sigmaDeg) ? `Sigma baseline: ${sigmaStartDeg.toFixed(1)} deg` : null,
      `Tier-2 sigma clamp: ${resolvedProfile.tier2.sigmaClampMinDeg.toFixed(1)}-${resolvedProfile.tier2.sigmaClampMaxDeg.toFixed(1)} deg`,
      `Altitude rise rate: ${resolvedProfile.tier2.altRiseRate.toFixed(2)} (family envelope)`,
      `Downrange exponent: ${resolvedProfile.tier2.downrangeExponent.toFixed(2)} (family envelope)`
    ],
    samples,
    events: [] as TrajectoryEvent[]
  };
}

function maxSampleAltitudeM(samples: Array<{ altM?: number }>) {
  let max = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    const alt = typeof sample?.altM === 'number' ? sample.altM : NaN;
    if (Number.isFinite(alt) && alt > max) max = alt;
  }
  return max === Number.NEGATIVE_INFINITY ? null : max;
}

function maxSampleDownrangeM(samples: Array<{ downrangeM?: number }>) {
  let max = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    const downrange = typeof sample?.downrangeM === 'number' ? sample.downrangeM : NaN;
    if (Number.isFinite(downrange) && downrange > max) max = downrange;
  }
  return max === Number.NEGATIVE_INFINITY ? null : max;
}

function baselineSampleSigmaDeg(samples: Array<{ sigmaDeg?: number }>) {
  for (const sample of samples) {
    const sigma = typeof sample?.sigmaDeg === 'number' ? sample.sigmaDeg : NaN;
    if (Number.isFinite(sigma) && sigma > 0) return sigma;
  }
  return null;
}

function deriveProductAzimuthDeg(samples: Array<{ latDeg?: number; lonDeg?: number; downrangeM?: number }>) {
  let anchor: { latDeg: number; lonDeg: number } | null = null;
  for (const sample of samples) {
    const latDeg = typeof sample?.latDeg === 'number' ? sample.latDeg : NaN;
    const lonDeg = typeof sample?.lonDeg === 'number' ? sample.lonDeg : NaN;
    const downrangeM = typeof sample?.downrangeM === 'number' ? sample.downrangeM : NaN;
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) continue;
    if (!Number.isFinite(downrangeM) || downrangeM < 1_000) continue;
    if (!anchor) {
      anchor = { latDeg, lonDeg };
      continue;
    }
    return bearingDeg(anchor.latDeg, anchor.lonDeg, latDeg, lonDeg);
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const firstLat = typeof first?.latDeg === 'number' ? first.latDeg : NaN;
  const firstLon = typeof first?.lonDeg === 'number' ? first.lonDeg : NaN;
  const lastLat = typeof last?.latDeg === 'number' ? last.latDeg : NaN;
  const lastLon = typeof last?.lonDeg === 'number' ? last.lonDeg : NaN;
  if ([firstLat, firstLon, lastLat, lastLon].every(Number.isFinite)) {
    return bearingDeg(firstLat, firstLon, lastLat, lastLon);
  }
  return null;
}

function getMaxTimelineOffsetMs(timeline?: Array<{ relative_time?: string | null }> | null) {
  if (!Array.isArray(timeline) || timeline.length === 0) return null;
  let max = Number.NEGATIVE_INFINITY;
  for (const event of timeline) {
    const relative = typeof event?.relative_time === 'string' ? event.relative_time : null;
    const offsetMs = relative ? parseIsoDurationToMs(relative) : null;
    if (offsetMs == null) continue;
    if (offsetMs > max) max = offsetMs;
  }
  return max === Number.NEGATIVE_INFINITY ? null : max;
}

function parseIsoDurationToMs(value?: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const negative = trimmed.startsWith('-');
  const normalized = negative ? trimmed.slice(1) : trimmed;
  const match = normalized.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!match) return null;
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  if (![days, hours, minutes, seconds].every(Number.isFinite)) return null;
  const totalSeconds = ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
  const ms = totalSeconds * 1000;
  return negative ? -ms : ms;
}

function maxTPlusSec(samples: Array<{ tPlusSec: number }>) {
  let max = 0;
  for (const sample of samples) {
    if (typeof sample?.tPlusSec === 'number' && Number.isFinite(sample.tPlusSec) && sample.tPlusSec > max) {
      max = sample.tPlusSec;
    }
  }
  return Math.max(0, Math.round(max));
}

function buildTimelineEvents(rawTimeline: unknown): TrajectoryEvent[] {
  if (!Array.isArray(rawTimeline)) return [];
  const events: TrajectoryEvent[] = [];
  for (const raw of rawTimeline) {
    const event = raw as any;
    const relative = typeof event?.relative_time === 'string' ? event.relative_time : null;
    const offsetMs = relative ? parseIsoDurationToMs(relative) : null;
    if (offsetMs == null || offsetMs < 0) continue;
    const tPlusSec = Math.round(offsetMs / 1000);
    const typeAbbrev = typeof event?.type?.abbrev === 'string' ? event.type.abbrev : null;
    const typeName = typeof event?.type?.name === 'string' ? event.type.name : null;
    const labelRaw = typeAbbrev || typeName || (typeof event?.name === 'string' ? event.name : null);
    if (!labelRaw) continue;
    const label = String(labelRaw).trim().slice(0, 32);
    if (!label) continue;
    events.push({
      key: `${label}:${tPlusSec}`,
      tPlusSec,
      label,
      confidence: 'med'
    });
  }

  const seen = new Set<string>();
  return events
    .sort((a, b) => a.tPlusSec - b.tPlusSec)
    .filter((e) => {
      if (seen.has(e.key)) return false;
      seen.add(e.key);
      return true;
    });
}

function buildDefaultEvents(rocketFamily: string | null | undefined): TrajectoryEvent[] {
  const family = (rocketFamily || '').toLowerCase();
  if (family.includes('falcon 9') || family.includes('falcon heavy')) {
    return [
      { key: 'MAXQ', tPlusSec: 70, label: 'Max-Q', confidence: 'low' },
      { key: 'MECO', tPlusSec: 150, label: 'MECO', confidence: 'low' },
      { key: 'STAGESEP', tPlusSec: 155, label: 'Stage Sep', confidence: 'low' }
    ];
  }

  return [
    { key: 'MAXQ', tPlusSec: 70, label: 'Max-Q', confidence: 'low' },
    { key: 'MECO', tPlusSec: 150, label: 'MECO', confidence: 'low' }
  ];
}

function mergeEvents(events: TrajectoryEvent[], maxSec: number): TrajectoryEvent[] {
  const seen = new Set<string>();
  const merged = events
    .filter((e) => typeof e?.tPlusSec === 'number' && Number.isFinite(e.tPlusSec) && e.tPlusSec >= 0 && e.tPlusSec <= maxSec)
    .sort((a, b) => a.tPlusSec - b.tPlusSec)
    .filter((e) => {
      const key = `${String(e.label || '').trim().toLowerCase()}:${e.tPlusSec}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return merged;
}

function interpolateGreatCircle(lat1: number, lon1: number, lat2: number, lon2: number, f: number) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;

  const phi1 = lat1 * toRad;
  const lambda1 = lon1 * toRad;
  const phi2 = lat2 * toRad;
  const lambda2 = lon2 * toRad;

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const sinPhi2 = Math.sin(phi2);
  const cosPhi2 = Math.cos(phi2);

  const deltaLambda = lambda2 - lambda1;
  const sinDeltaLambda = Math.sin(deltaLambda);
  const cosDeltaLambda = Math.cos(deltaLambda);

  const d = Math.acos(Math.min(1, Math.max(-1, sinPhi1 * sinPhi2 + cosPhi1 * cosPhi2 * cosDeltaLambda)));
  if (!Number.isFinite(d) || d === 0) {
    return { lat: lat1, lon: lon1 };
  }

  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);

  const x = A * cosPhi1 * Math.cos(lambda1) + B * cosPhi2 * Math.cos(lambda2);
  const y = A * cosPhi1 * Math.sin(lambda1) + B * cosPhi2 * Math.sin(lambda2);
  const z = A * sinPhi1 + B * sinPhi2;

  const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * toDeg;
  const lon = Math.atan2(y, x) * toDeg;
  return { lat, lon };
}

function pickAzimuthFromTargetOrbit({
  padLat,
  site,
  missionClass,
  padName,
  targetOrbit,
  preferredAzDeg
}: {
  padLat: number;
  site: LaunchSite;
  missionClass: MissionClass;
  padName?: string | null;
  targetOrbit: any;
  preferredAzDeg?: number | null;
}): { azDeg: number; sigmaDeg: number; notes: string[] } | null {
  const flightAz = typeof targetOrbit?.flight_azimuth_deg === 'number' ? targetOrbit.flight_azimuth_deg : null;
  if (flightAz != null && Number.isFinite(flightAz)) {
    const azDeg = wrapAzDeg(flightAz);
    const notes = [
      'Target orbit constraint: flight azimuth',
      `Flight azimuth: ${azDeg.toFixed(1)} deg`,
      targetOrbit?.orbitType ? `Orbit type: ${String(targetOrbit.orbitType)}` : null,
      ...(Array.isArray(targetOrbit?.derivedNotes) ? targetOrbit.derivedNotes.map((n: any) => String(n)) : []),
      targetOrbit?.sourceUrl ? `Orbit source: ${String(targetOrbit.sourceUrl)}` : null
    ].filter(Boolean) as string[];
    return { azDeg, sigmaDeg: 3, notes };
  }

  const incDeg = typeof targetOrbit?.inclination_deg === 'number' ? targetOrbit.inclination_deg : null;
  if (incDeg == null || !Number.isFinite(incDeg) || incDeg <= 0 || incDeg >= 180) return null;

  const toRad = Math.PI / 180;
  const ratio = Math.cos(incDeg * toRad) / Math.cos(padLat * toRad);
  if (!Number.isFinite(ratio) || Math.abs(ratio) > 1) return null;

  const aDeg = (Math.asin(clamp(ratio, -1, 1)) * 180) / Math.PI;
  const candidates = [wrapAzDeg(aDeg), wrapAzDeg(180 - aDeg)];

  const heuristic = pickAzimuthEstimate({ site, missionClass, padName, padLat });
  const clampMin = heuristic?.clampMin ?? (site === 'cape' ? 35 : site === 'vandenberg' ? 160 : site === 'starbase' ? 60 : 0);
  const clampMax = heuristic?.clampMax ?? (site === 'cape' ? 125 : site === 'vandenberg' ? 210 : site === 'starbase' ? 150 : 360);
  const preferred =
    typeof preferredAzDeg === 'number' && Number.isFinite(preferredAzDeg)
      ? wrapAzDeg(preferredAzDeg)
      : heuristic?.azDeg ?? (site === 'vandenberg' ? 188 : site === 'cape' ? 90 : 110);

  const inRange = (az: number) => az >= clampMin && az <= clampMax;
  const viable = candidates.filter(inRange);

  const chosen = (viable.length ? viable : candidates).sort(
    (a, b) => angularDiffDeg(a, preferred) - angularDiffDeg(b, preferred)
  )[0];

  const sigmaDeg = viable.length ? 8 : 12;
  const notes = [
    'Target orbit constraint: inclination-derived azimuth',
    `Inclination: ${incDeg.toFixed(1)} deg`,
    targetOrbit?.orbitType ? `Orbit type: ${String(targetOrbit.orbitType)}` : null,
    `Az candidates: ${candidates.map((c) => c.toFixed(1)).join(' deg, ')} deg`,
    `Selected azimuth: ${chosen.toFixed(1)} deg`,
    typeof preferredAzDeg === 'number' && Number.isFinite(preferredAzDeg) ? `Preferred azimuth: ${preferred.toFixed(1)} deg` : null,
    viable.length ? null : `Selection outside typical clamp (${clampMin}-${clampMax})`,
    ...(Array.isArray(targetOrbit?.derivedNotes) ? targetOrbit.derivedNotes.map((n: any) => String(n)) : []),
    targetOrbit?.sourceUrl ? `Orbit source: ${String(targetOrbit.sourceUrl)}` : null
  ].filter(Boolean) as string[];

  return { azDeg: chosen, sigmaDeg, notes };
}

function pickAzimuthFromHazards({
  padLat,
  padLon,
  hazards,
  netIso,
  expectedAzDeg,
  clampMinDeg,
  clampMaxDeg
}: {
  padLat: number;
  padLon: number;
  hazards: ConstraintRow[];
  netIso?: string | null;
  expectedAzDeg?: number | null;
  clampMinDeg?: number | null;
  clampMaxDeg?: number | null;
}): { azDeg: number; sigmaDeg: number; notes: string[]; constraint: ConstraintRow; maxDistKm: number } | null {
  const netMs = typeof netIso === 'string' ? Date.parse(netIso) : NaN;

  const candidates: Array<{
    azDeg: number;
    maxDistKm: number;
    sigmaBonusDeg: number;
    score: number;
    notes: string[];
    constraint: ConstraintRow;
  }> = [];

  const pushRing = (ring: unknown, sink: Array<{ lat: number; lon: number }>) => {
    if (!Array.isArray(ring) || ring.length < 2) return;
    const maxPoints = 96;
    const stride = Math.max(1, Math.ceil(ring.length / maxPoints));
    for (let i = 0; i < ring.length; i += stride) {
      const p = (ring as any)[i] as any;
      if (!Array.isArray(p) || p.length < 2) continue;
      const lon = Number(p[0]);
      const lat = Number(p[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      sink.push({ lat, lon: wrapLonDeg(lon) });
    }
  };

  for (const hazard of hazards) {
    const points: Array<{ lat: number; lon: number }> = [];

    const geom = hazard.geometry as any;
    const type = typeof geom?.type === 'string' ? geom.type : null;
    const coords = geom?.coordinates;
    if (type === 'Polygon') {
      const rings = Array.isArray(coords) ? coords : [];
      const outer = rings[0];
      pushRing(outer, points);
    } else if (type === 'MultiPolygon') {
      for (const poly of Array.isArray(coords) ? coords : []) {
        const rings = Array.isArray(poly) ? poly : [];
        const outer = rings[0];
        pushRing(outer, points);
      }
    }

    // Fallback: if geometry parsing failed, use centroid as a single representative point.
    if (!points.length) {
      const centroid = centroidFromGeoJson(hazard.geometry);
      if (centroid) points.push(centroid);
    }

    const samples: Array<{ bearingDeg: number; distKm: number }> = [];
    let maxDistKm = 0;

    for (const p of points) {
      const distKm = haversineKm(padLat, padLon, p.lat, p.lon);
      if (!Number.isFinite(distKm) || distKm < 10) continue;
      const azDeg = bearingDeg(padLat, padLon, p.lat, p.lon);
      samples.push({ bearingDeg: azDeg, distKm });
      if (distKm > maxDistKm) maxDistKm = distKm;
    }

    if (!samples.length || !Number.isFinite(maxDistKm)) continue;

    let sumSin = 0;
    let sumCos = 0;
    let sumW = 0;
    for (const s of samples) {
      const w = Math.max(1, s.distKm * s.distKm);
      const rad = (wrapAzDeg(s.bearingDeg) * Math.PI) / 180;
      sumSin += Math.sin(rad) * w;
      sumCos += Math.cos(rad) * w;
      sumW += w;
    }
    if (!sumW) continue;
    const meanRad = Math.atan2(sumSin, sumCos);
    const meanAzDeg = wrapAzDeg((meanRad * 180) / Math.PI);

    const deviations = samples.map((s) => angularDiffDeg(s.bearingDeg, meanAzDeg)).filter((d) => Number.isFinite(d));
    deviations.sort((a, b) => a - b);
    const p80 = deviations.length ? deviations[Math.min(deviations.length - 1, Math.floor(0.8 * (deviations.length - 1)))] : 0;
    const sigmaDeg = clamp(Math.max(6, p80 + 4), 6, 18);

    const sourceCode = typeof hazard?.source === 'string' ? hazard.source.toLowerCase() : 'unknown';
    const navcenGuid = hazard?.data?.navcenGuid ? String(hazard.data.navcenGuid) : null;
    const faaNotamId = hazard?.data?.notamId ? String(hazard.data.notamId) : null;
    const faaRecordId = hazard?.data?.faaTfrRecordId ? String(hazard.data.faaTfrRecordId) : null;
    const sourceUrl = hazard?.data?.sourceUrl ? String(hazard.data.sourceUrl) : null;
    const startMs = hazard?.data?.validStartUtc ? Date.parse(String(hazard.data.validStartUtc)) : NaN;
    const endMs = hazard?.data?.validEndUtc ? Date.parse(String(hazard.data.validEndUtc)) : NaN;

    let timeScore = 0;
    let timeNote: string | null = null;
    let timeRejected = false;
    if (Number.isFinite(netMs) && Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      const bufferMs = 12 * 60 * 60 * 1000;
      if (netMs >= startMs && netMs <= endMs) {
        timeScore = 80;
        timeNote = 'Hazard window: covers NET';
      } else if (netMs >= startMs - bufferMs && netMs <= endMs + bufferMs) {
        timeScore = 40;
        timeNote = 'Hazard window: near NET';
      } else {
        timeRejected = true;
        timeNote = 'Hazard window: does not cover NET (skipped)';
      }
    } else if (Number.isFinite(netMs)) {
      timeScore = -10;
      timeNote = 'Hazard window: unknown';
    }

    if (timeRejected) continue;

    const expected = typeof expectedAzDeg === 'number' && Number.isFinite(expectedAzDeg) ? wrapAzDeg(expectedAzDeg) : null;
    const diffPenalty = expected != null ? angularDiffDeg(meanAzDeg, expected) * 2 : 0;

    const inClamp =
      typeof clampMinDeg === 'number' &&
      Number.isFinite(clampMinDeg) &&
      typeof clampMaxDeg === 'number' &&
      Number.isFinite(clampMaxDeg)
        ? meanAzDeg >= clampMinDeg && meanAzDeg <= clampMaxDeg
        : true;
    const clampPenalty = inClamp ? 0 : 250;
    const sourceScore = sourceCode === 'faa_tfr' ? 24 : sourceCode === 'navcen_bnm' ? 20 : 10;

    const score = maxDistKm + sourceScore + timeScore - diffPenalty - clampPenalty;

    const notes = [
      `Hazard source code: ${sourceCode}`,
      navcenGuid ? `NAVCEN guid: ${navcenGuid}` : null,
      faaNotamId ? `FAA NOTAM: ${faaNotamId}` : null,
      faaRecordId ? `FAA record: ${faaRecordId}` : null,
      sourceUrl ? `Hazard source: ${sourceUrl}` : null,
      timeNote,
      `Hazard max distance: ${Math.round(maxDistKm)} km`,
      `Hazard bearing p80: ${p80.toFixed(1)} deg`,
      `Source score: ${sourceScore}`,
      expected != null ? `Expected azimuth: ${expected.toFixed(1)} deg` : null,
      !inClamp && clampPenalty ? `Outside typical clamp (${clampMinDeg}-${clampMaxDeg})` : null
    ].filter(Boolean) as string[];

    candidates.push({ azDeg: meanAzDeg, maxDistKm, sigmaBonusDeg: sigmaDeg, score, notes, constraint: hazard });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] ?? null;
  if (!best) return null;
  return { azDeg: best.azDeg, sigmaDeg: best.sigmaBonusDeg, notes: best.notes, constraint: best.constraint, maxDistKm: best.maxDistKm };
}

function classifyLaunchSite({
  padLat,
  padLon,
  padName,
  locationName
}: {
  padLat: number;
  padLon: number;
  padName?: string | null;
  locationName?: string | null;
}): LaunchSite {
  const name = `${padName || ''} ${locationName || ''}`.toLowerCase();

  if (
    (padLat >= 25.5 && padLat <= 26.6 && padLon >= -98.2 && padLon <= -96.4) ||
    name.includes('starbase') ||
    name.includes('boca chica')
  ) {
    return 'starbase';
  }

  if (
    (padLat >= 27.0 && padLat <= 29.6 && padLon >= -82.5 && padLon <= -79.0) ||
    name.includes('cape canaveral') ||
    name.includes('kennedy') ||
    name.includes('ksc')
  ) {
    return 'cape';
  }

  if (
    (padLat >= 33.0 && padLat <= 35.8 && padLon >= -121.9 && padLon <= -119.0) ||
    name.includes('vandenberg')
  ) {
    return 'vandenberg';
  }

  return 'unknown';
}

function classifyMission({
  orbitName,
  missionName,
  vehicleName
}: {
  orbitName?: string | null;
  missionName?: string | null;
  vehicleName?: string | null;
}): MissionClass {
  const orbit = (orbitName || '').toLowerCase();
  const mission = (missionName || '').toLowerCase();
  const vehicle = (vehicleName || '').toLowerCase();

  const hasAny = (haystack: string, needles: string[]) => needles.some((n) => haystack.includes(n));

  if (hasAny(orbit, ['sso', 'sun-synchronous', 'sun synchronous', 'sun sync', 'polar']) || hasAny(mission, ['sso', 'sun-synchronous', 'sun synchronous', 'sun sync', 'polar'])) {
    return 'SSO_POLAR';
  }
  if (hasAny(orbit, ['gto', 'geo', 'geostationary'])) return 'GTO_GEO';
  if (hasAny(mission, ['iss', 'crew', 'dragon', 'crs']) || (hasAny(vehicle, ['falcon 9']) && hasAny(mission, ['starlink']))) {
    return 'ISS_CREW';
  }
  if (hasAny(orbit, ['leo', 'low earth'])) return 'LEO_GENERIC';

  return 'UNKNOWN';
}

function pickAzimuthEstimate({
  site,
  missionClass,
  padName,
  padLat
}: {
  site: LaunchSite;
  missionClass: MissionClass;
  padName?: string | null;
  padLat?: number | null;
}): { azDeg: number; sigmaBonusDeg: number; clampMin: number; clampMax: number; notes: string[] } | null {
  if (site === 'cape') {
    if (missionClass === 'ISS_CREW' || missionClass === 'LEO_GENERIC') {
      return { azDeg: 50, sigmaBonusDeg: 0, clampMin: 35, clampMax: 75, notes: ['Cape LEO/ISS corridor default'] };
    }
    if (missionClass === 'GTO_GEO') {
      return { azDeg: 100, sigmaBonusDeg: 0, clampMin: 80, clampMax: 125, notes: ['Cape GTO/GEO corridor default'] };
    }
    if (missionClass === 'SSO_POLAR') {
      return { azDeg: 155, sigmaBonusDeg: 5, clampMin: 130, clampMax: 170, notes: ['Cape polar-ish corridor (estimate)'] };
    }
    return { azDeg: 90, sigmaBonusDeg: 7, clampMin: 35, clampMax: 125, notes: ['Cape fallback corridor (unknown mission)'] };
  }

  if (site === 'vandenberg') {
    const pad = (padName || '').toLowerCase();
    const padAz = pad.includes('slc-2') ? 200 : pad.includes('slc-6') ? 190 : 188;
    if (missionClass === 'SSO_POLAR') {
      return {
        azDeg: padAz,
        sigmaBonusDeg: 0,
        clampMin: 160,
        clampMax: 210,
        notes: ['Vandenberg SSO/polar corridor default', pad.includes('slc-') ? `Pad hint: ${padName}` : '']
          .filter(Boolean)
          .map(String)
      };
    }
    return {
      azDeg: padAz,
      sigmaBonusDeg: 6,
      clampMin: 160,
      clampMax: 210,
      notes: ['Vandenberg fallback corridor (unknown mission)', pad.includes('slc-') ? `Pad hint: ${padName}` : '']
        .filter(Boolean)
        .map(String)
    };
  }

  if (site === 'starbase') {
    return {
      azDeg: 110,
      sigmaBonusDeg: 10,
      clampMin: 60,
      clampMax: 150,
      notes: ['Starbase corridor (very wide estimate)']
    };
  }

  const hemisphere = typeof padLat === 'number' && Number.isFinite(padLat) ? (padLat >= 0 ? 'north' : 'south') : null;
  const fallbackAzDeg =
    missionClass === 'SSO_POLAR'
      ? hemisphere === 'south'
        ? 0
        : 180
      : 90;

  return {
    azDeg: fallbackAzDeg,
    sigmaBonusDeg: 14,
    clampMin: 0,
    clampMax: 360,
    notes: [
      'Global fallback corridor (unknown site)',
      hemisphere ? `Hemisphere: ${hemisphere}` : null,
      `Mission class: ${missionClass}`
    ].filter(Boolean) as string[]
  };
}

function pickAzimuthFromTemplates({
  templatesSetting,
  site,
  missionClass,
  rocketFamily
}: {
  templatesSetting: unknown;
  site: LaunchSite;
  missionClass: MissionClass;
  rocketFamily?: string | null;
}): { azDeg: number; sigmaDeg: number; notes: string[]; templateKey: string; samples: number | null } | null {
  const root = templatesSetting && typeof templatesSetting === 'object' ? (templatesSetting as any) : null;
  const templates = root?.templates && typeof root.templates === 'object' ? (root.templates as Record<string, any>) : null;
  if (!templates) return null;

  const family = (rocketFamily || 'unknown').toLowerCase().trim() || 'unknown';

  const keys = [
    `${site}|${family}|${missionClass}`,
    `${site}|${family}|UNKNOWN`,
    `${site}|unknown|${missionClass}`,
    `${site}|unknown|UNKNOWN`
  ];

  for (const key of keys) {
    const entry = templates[key];
    const azDegRaw = entry?.azDeg;
    if (typeof azDegRaw !== 'number' || !Number.isFinite(azDegRaw)) continue;
    const azDeg = wrapAzDeg(azDegRaw);
    const sigmaBonusRaw = typeof entry?.sigmaBonusDeg === 'number' && Number.isFinite(entry.sigmaBonusDeg) ? entry.sigmaBonusDeg : 0;
    const sigmaDeg = clamp(8 + sigmaBonusRaw, 8, 22);
    const samples = typeof entry?.samples === 'number' && Number.isFinite(entry.samples) ? Math.round(entry.samples) : null;
    const p80 = typeof entry?.p80Deg === 'number' && Number.isFinite(entry.p80Deg) ? entry.p80Deg : null;
    const sourceMix = entry?.sourceMix && typeof entry.sourceMix === 'object' ? (entry.sourceMix as Record<string, unknown>) : null;

    const notes = [
      'Azimuth template used (historical prior)',
      `Template key: ${key}`,
      samples != null ? `Template samples: ${samples}` : null,
      p80 != null ? `Template p80: ${p80.toFixed(1)} deg` : null,
      sourceMix ? `Template source mix: ${Object.entries(sourceMix).map(([name, count]) => `${name}=${count}`).join(', ')}` : null,
      `Azimuth: ${azDeg.toFixed(1)} deg (template-derived)`
    ].filter(Boolean) as string[];

    return { azDeg, sigmaDeg, notes, templateKey: key, samples };
  }

  return null;
}

function ecefFromLatLon(latDeg: number, lonDeg: number, altMeters = 0) {
  const DEG_TO_RAD = Math.PI / 180;
  const WGS84_A = 6378137.0;
  const WGS84_E2 = 6.69437999014e-3;
  const lat = latDeg * DEG_TO_RAD;
  const lon = lonDeg * DEG_TO_RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const x = (N + altMeters) * cosLat * cosLon;
  const y = (N + altMeters) * cosLat * sinLon;
  const z = (N * (1 - WGS84_E2) + altMeters) * sinLat;
  return [x, y, z] as [number, number, number];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function wrapLonDeg(lon: number) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function wrapAzDeg(az: number) {
  return ((az % 360) + 360) % 360;
}

function angularDiffDeg(a: number, b: number) {
  const da = wrapAzDeg(a);
  const db = wrapAzDeg(b);
  const d = Math.abs(da - db);
  return Math.min(d, 360 - d);
}

function directWgs84({
  lat1Deg,
  lon1Deg,
  azDeg,
  distM
}: {
  lat1Deg: number;
  lon1Deg: number;
  azDeg: number;
  distM: number;
}) {
  if (!Number.isFinite(distM) || distM <= 0) {
    return { latDeg: lat1Deg, lonDeg: wrapLonDeg(lon1Deg) };
  }

  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const b = (1 - f) * a;

  const phi1 = (lat1Deg * Math.PI) / 180;
  const alpha1 = (wrapAzDeg(azDeg) * Math.PI) / 180;
  const sinAlpha1 = Math.sin(alpha1);
  const cosAlpha1 = Math.cos(alpha1);

  const tanU1 = (1 - f) * Math.tan(phi1);
  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
  const sinU1 = tanU1 * cosU1;

  const sigma1 = Math.atan2(tanU1, cosAlpha1);
  const sinAlpha = cosU1 * sinAlpha1;
  const cosSqAlpha = 1 - sinAlpha * sinAlpha;
  const uSq = (cosSqAlpha * (a * a - b * b)) / (b * b);
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));

  let sigma = distM / (b * A);
  let sigmaPrev = Number.NaN;
  let iter = 0;
  let cos2SigmaM = 0;
  let sinSigma = 0;
  let cosSigma = 0;

  while ((!Number.isFinite(sigmaPrev) || Math.abs(sigma - sigmaPrev) > 1e-12) && iter < 100) {
    cos2SigmaM = Math.cos(2 * sigma1 + sigma);
    sinSigma = Math.sin(sigma);
    cosSigma = Math.cos(sigma);
    const deltaSigma =
      B *
      sinSigma *
      (cos2SigmaM +
        (B / 4) *
          (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
            (B / 6) *
              cos2SigmaM *
              (-3 + 4 * sinSigma * sinSigma) *
              (-3 + 4 * cos2SigmaM * cos2SigmaM)));
    sigmaPrev = sigma;
    sigma = distM / (b * A) + deltaSigma;
    iter += 1;
  }

  if (!Number.isFinite(sigma) || iter >= 100) {
    // Fallback for rare numerical instability near antipodal configurations.
    const R = 6_371_000;
    const az = (azDeg * Math.PI) / 180;
    const lambda1 = (lon1Deg * Math.PI) / 180;
    const delta = distM / R;
    const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(az);
    const phi2 = Math.asin(clamp(sinPhi2, -1, 1));
    const y = Math.sin(az) * Math.sin(delta) * Math.cos(phi1);
    const x = Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2);
    const lambda2 = lambda1 + Math.atan2(y, x);
    return {
      latDeg: (phi2 * 180) / Math.PI,
      lonDeg: wrapLonDeg((lambda2 * 180) / Math.PI)
    };
  }

  const tmp = sinU1 * sinSigma - cosU1 * cosSigma * cosAlpha1;
  const phi2 = Math.atan2(
    sinU1 * cosSigma + cosU1 * sinSigma * cosAlpha1,
    (1 - f) * Math.sqrt(sinAlpha * sinAlpha + tmp * tmp)
  );
  const lambda = Math.atan2(
    sinSigma * sinAlpha1,
    cosU1 * cosSigma - sinU1 * sinSigma * cosAlpha1
  );
  const C = (f / 16) * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
  const L =
    lambda -
    (1 - C) *
      f *
      sinAlpha *
      (sigma +
        C *
          sinSigma *
          (cos2SigmaM +
            C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  const lambda1 = (lon1Deg * Math.PI) / 180;
  const lambda2 = lambda1 + L;

  return {
    latDeg: (phi2 * 180) / Math.PI,
    lonDeg: wrapLonDeg((lambda2 * 180) / Math.PI)
  };
}

function bearingDeg(lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const phi1 = lat1Deg * toRad;
  const phi2 = lat2Deg * toRad;
  const dLambda = (lon2Deg - lon1Deg) * toRad;

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const theta = Math.atan2(y, x);
  return (theta * toDeg + 360) % 360;
}

function haversineKm(lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number) {
  const toRad = Math.PI / 180;
  const R = 6371;
  const dLat = (lat2Deg - lat1Deg) * toRad;
  const dLon = (lon2Deg - lon1Deg) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1Deg * toRad) * Math.cos(lat2Deg * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function centroidFromGeoJson(geometry: unknown): { lat: number; lon: number } | null {
  const geom = geometry as any;
  const type = typeof geom?.type === 'string' ? geom.type : null;
  const coords = geom?.coordinates;
  if (!type || !coords) return null;

  let sumLat = 0;
  let sumLon = 0;
  let count = 0;

  const push = (p: any) => {
    if (!Array.isArray(p) || p.length < 2) return;
    const lon = Number(p[0]);
    const lat = Number(p[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    sumLat += lat;
    sumLon += lon;
    count += 1;
  };

  if (type === 'Polygon') {
    for (const ring of Array.isArray(coords) ? coords : []) {
      for (const p of Array.isArray(ring) ? ring : []) push(p);
    }
  } else if (type === 'MultiPolygon') {
    for (const poly of Array.isArray(coords) ? coords : []) {
      for (const ring of Array.isArray(poly) ? poly : []) {
        for (const p of Array.isArray(ring) ? ring : []) push(p);
      }
    }
  } else {
    return null;
  }

  if (!count) return null;
  return { lat: sumLat / count, lon: wrapLonDeg(sumLon / count) };
}

function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isMaterialTrajectoryProductUpdate(existingRow: any, nextRow: Record<string, unknown>) {
  if (!existingRow || typeof existingRow !== 'object') return true;
  return stableStringify(projectMaterialProductRow(existingRow)) !== stableStringify(projectMaterialProductRow(nextRow));
}

function projectMaterialProductRow(row: any) {
  const product = row?.product && typeof row.product === 'object' ? row.product : {};
  const trackSummary = product?.trackSummary && typeof product.trackSummary === 'object' ? product.trackSummary : {};
  const sourceSufficiency =
    row?.source_sufficiency && typeof row.source_sufficiency === 'object' ? row.source_sufficiency : {};
  const sourceFreshness =
    sourceSufficiency?.sourceFreshness && typeof sourceSufficiency.sourceFreshness === 'object'
      ? sourceSufficiency.sourceFreshness
      : {};
  return {
    version: typeof row?.version === 'string' ? row.version : null,
    quality: typeof row?.quality === 'number' && Number.isFinite(row.quality) ? row.quality : null,
    confidence_tier: typeof row?.confidence_tier === 'string' ? row.confidence_tier : null,
    freshness_state: typeof row?.freshness_state === 'string' ? row.freshness_state : null,
    lineage_complete: Boolean(row?.lineage_complete),
    qualityLabel: typeof product?.qualityLabel === 'string' ? product.qualityLabel : null,
    assumptions: Array.isArray(product?.assumptions) ? product.assumptions : [],
    samples: Array.isArray(product?.samples) ? product.samples : [],
    events: Array.isArray(product?.events) ? product.events : [],
    sourceRefIds: Array.isArray(trackSummary?.sourceRefIds) ? [...trackSummary.sourceRefIds].map(String).sort() : [],
    sourceFreshness: {
      latestConstraintAt: typeof sourceFreshness?.latestConstraintAt === 'string' ? sourceFreshness.latestConstraintAt : null,
      latestSourceCheckAt: typeof sourceFreshness?.latestSourceCheckAt === 'string' ? sourceFreshness.latestSourceCheckAt : null,
      latestSignalAt: typeof sourceFreshness?.latestSignalAt === 'string' ? sourceFreshness.latestSignalAt : null
    }
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sortJson(entry));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const key of keys) {
      out[key] = sortJson((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function landingTypeText(value: unknown) {
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const obj = value as Record<string, unknown>;
  return [obj.abbrev, obj.name, obj.description]
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
    .filter(Boolean)
    .join(' ');
}

function classifyLandingDirectionKind(value: unknown): LandingDirectionKind {
  const text = landingTypeText(value);
  if (!text) return 'unknown';
  if (text.includes('rtls')) return 'rtls';
  if (text.includes('drone') || text.includes('ship') || text.includes('asds') || text.includes('barge')) return 'drone_ship';
  if (text.includes('splash') || text.includes('ocean') || text.includes('sea') || text.includes('water')) return 'splashdown';
  if (text.includes('land') || text.includes('lz')) return 'land_pad';
  return 'unknown';
}

function evaluateLandingConstraint({
  constraint,
  padLat,
  padLon
}: {
  constraint: ConstraintRow;
  padLat: number;
  padLon: number;
}): LandingConstraintEvaluation | null {
  if (constraint.constraint_type !== 'landing') return null;

  const landingLocation = constraint?.data?.landing_location;
  const lat = typeof landingLocation?.latitude === 'number' ? landingLocation.latitude : NaN;
  const lon = typeof landingLocation?.longitude === 'number' ? landingLocation.longitude : NaN;
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lon);
  const azDeg = hasCoordinates ? bearingDeg(padLat, padLon, lat, lon) : null;

  const landingRoleRaw = typeof constraint?.data?.landing_role === 'string' ? String(constraint.data.landing_role).trim() : '';
  const role = landingRoleRaw === 'booster' || landingRoleRaw === 'spacecraft' ? landingRoleRaw : 'unknown';
  const kind = classifyLandingDirectionKind(constraint?.data?.landing_type);
  const explicitDownrangeKm =
    typeof constraint?.data?.downrange_distance_km === 'number' && Number.isFinite(constraint.data.downrange_distance_km)
      ? constraint.data.downrange_distance_km
      : null;
  const inferredDownrangeKm = hasCoordinates ? haversineKm(padLat, padLon, lat, lon) : null;
  const downrangeKm = explicitDownrangeKm ?? inferredDownrangeKm ?? null;
  const attempt = typeof constraint?.data?.attempt === 'boolean' ? constraint.data.attempt : null;
  const success = typeof constraint?.data?.success === 'boolean' ? constraint.data.success : null;

  let canUseDirection = hasCoordinates;
  let canUseDownrange = downrangeKm != null && downrangeKm > 0;
  let directionWeight = role === 'booster' ? 1.25 : role === 'unknown' ? 0.85 : 0.35;
  let directionSigmaDeg = role === 'booster' ? 9 : role === 'unknown' ? 12 : 18;
  const notes: string[] = [];

  if (!hasCoordinates) {
    canUseDirection = false;
    notes.push('Landing coordinates missing: direction disabled; downrange-only support.');
  }

  if (role === 'spacecraft') {
    if (downrangeKm == null || downrangeKm > 250) {
      canUseDirection = false;
      canUseDownrange = false;
      notes.push('Spacecraft recovery treated as non-directional for ascent shaping.');
    } else {
      directionWeight *= 0.55;
      directionSigmaDeg = Math.max(directionSigmaDeg, 16);
      notes.push('Short-range spacecraft recovery retained as a weak directional prior.');
    }
  }

  if (kind === 'drone_ship') {
    directionWeight += 0.2;
    directionSigmaDeg = Math.max(7, directionSigmaDeg - 1);
    notes.push('Drone-ship recovery strengthens downrange direction prior.');
  } else if (kind === 'rtls') {
    directionWeight *= 0.45;
    directionSigmaDeg = Math.max(directionSigmaDeg, 20);
    notes.push('RTLS recovery is near-pad and yields a wide directional corridor.');
  } else if (kind === 'splashdown') {
    directionWeight *= role === 'booster' ? 0.75 : 0.4;
    directionSigmaDeg = Math.max(directionSigmaDeg, 16);
    notes.push('Splashdown recovery treated as a softer directional prior.');
  } else if (kind === 'land_pad') {
    directionWeight *= 0.8;
  }

  if (attempt === false) {
    canUseDirection = false;
    canUseDownrange = false;
    notes.push('Landing attempt false: excluded from trajectory shaping.');
  }
  if (success === false) {
    directionWeight *= 0.9;
    notes.push('Landing success false: retained only as a planned recovery prior.');
  }

  if (downrangeKm != null) {
    if (downrangeKm < 30) {
      directionWeight *= 0.35;
      directionSigmaDeg = Math.max(directionSigmaDeg, 20);
      notes.push('Very short downrange distance widens uncertainty near the pad.');
    } else if (downrangeKm < 80) {
      directionWeight *= 0.7;
      directionSigmaDeg = Math.max(directionSigmaDeg, 15);
    } else if (downrangeKm > 900) {
      directionSigmaDeg += 2;
    }
  }

  const confidence = typeof constraint.confidence === 'number' && Number.isFinite(constraint.confidence) ? constraint.confidence : 0.7;
  directionWeight *= clamp(0.55 + confidence * 0.45, 0.45, 1);
  directionSigmaDeg = clamp(directionSigmaDeg, 8, 24);

  const fetchedAtMs = typeof constraint.fetched_at === 'string' ? Date.parse(constraint.fetched_at) : NaN;
  const source = (constraint.source || '').trim();
  const sourceIdRaw = (constraint.source_id || '').trim();
  const sourceId = source && sourceIdRaw ? `${source}:${sourceIdRaw}` : sourceIdRaw || null;

  return {
    constraint,
    sourceId,
    role,
    kind,
    lat: hasCoordinates ? lat : null,
    lon: hasCoordinates ? lon : null,
    azDeg,
    hasCoordinates,
    downrangeKm,
    canUseDirection,
    canUseDownrange,
    directionWeight: clamp(directionWeight, 0.05, 2.4),
    directionSigmaDeg,
    confidence,
    fetchedAtMs: Number.isFinite(fetchedAtMs) ? fetchedAtMs : 0,
    notes
  };
}

function pickBestLandingConstraint({
  constraints,
  padLat,
  padLon
}: {
  constraints: ConstraintRow[];
  padLat: number;
  padLon: number;
}): LandingConstraintEvaluation | null {
  const candidates = constraints
    .map((constraint) => evaluateLandingConstraint({ constraint, padLat, padLon }))
    .filter((candidate): candidate is LandingConstraintEvaluation => candidate != null);

  candidates.sort((a, b) => {
    const directionDelta = Number(b.canUseDirection) - Number(a.canUseDirection);
    if (directionDelta) return directionDelta;
    const downrangeDelta = Number(b.canUseDownrange) - Number(a.canUseDownrange);
    if (downrangeDelta) return downrangeDelta;
    const roleDelta =
      (b.role === 'booster' ? 2 : b.role === 'unknown' ? 1 : 0) - (a.role === 'booster' ? 2 : a.role === 'unknown' ? 1 : 0);
    if (roleDelta) return roleDelta;
    const kindDelta =
      (b.kind === 'drone_ship' ? 2 : b.kind === 'land_pad' ? 1 : 0) -
      (a.kind === 'drone_ship' ? 2 : a.kind === 'land_pad' ? 1 : 0);
    if (kindDelta) return kindDelta;
    const weightDelta = b.directionWeight - a.directionWeight;
    if (weightDelta) return weightDelta;
    const timeDelta = b.fetchedAtMs - a.fetchedAtMs;
    if (timeDelta) return timeDelta;
    const confDelta = b.confidence - a.confidence;
    if (confDelta) return confDelta;
    const distDelta = (b.downrangeKm || 0) - (a.downrangeKm || 0);
    if (distDelta) return distDelta;
    return String(a.sourceId || '').localeCompare(String(b.sourceId || ''));
  });

  return candidates[0] ?? null;
}

function directionSignalAuthorityRank(kind: DirectionSignalKind) {
  if (kind === 'orbit') return 5;
  if (kind === 'hazard') return 4;
  if (kind === 'landing') return 3;
  if (kind === 'template') return 2;
  return 1;
}

function directionSignalVectorWeight(signal: DirectionSignal) {
  if (!(signal.weight > 0) || !(signal.sigmaDeg > 0)) return 0;
  return signal.weight / Math.max(4, signal.sigmaDeg * signal.sigmaDeg);
}

function weightedCircularMeanDeg(signals: DirectionSignal[]) {
  let sumSin = 0;
  let sumCos = 0;
  let totalWeight = 0;
  for (const signal of signals) {
    const weight = directionSignalVectorWeight(signal);
    if (!(weight > 0)) continue;
    const rad = (wrapAzDeg(signal.azDeg) * Math.PI) / 180;
    sumSin += Math.sin(rad) * weight;
    sumCos += Math.cos(rad) * weight;
    totalWeight += weight;
  }
  if (!(totalWeight > 0)) return null;
  return wrapAzDeg((Math.atan2(sumSin, sumCos) * 180) / Math.PI);
}

function weightedAngularRmsDeg(signals: DirectionSignal[], centerAzDeg: number) {
  let totalWeight = 0;
  let totalSquared = 0;
  for (const signal of signals) {
    const weight = directionSignalVectorWeight(signal);
    if (!(weight > 0)) continue;
    const diff = angularDiffDeg(signal.azDeg, centerAzDeg);
    totalSquared += diff * diff * weight;
    totalWeight += weight;
  }
  if (!(totalWeight > 0)) return null;
  return Math.sqrt(totalSquared / totalWeight);
}

function inferDirectionalDownrangeMaxM({
  landing,
  hazard,
  profile
}: {
  landing: LandingConstraintEvaluation | null;
  hazard: { maxDistKm: number } | null;
  profile: EnvelopeProfile;
}) {
  const landingM =
    landing?.canUseDownrange && typeof landing.downrangeKm === 'number' && Number.isFinite(landing.downrangeKm)
      ? landing.downrangeKm * 1000
      : null;
  const hazardM = hazard && Number.isFinite(hazard.maxDistKm) && hazard.maxDistKm > 0 ? hazard.maxDistKm * 1000 : null;
  if (landingM == null && hazardM == null) return null;

  let raw = landingM ?? hazardM ?? 0;
  if (landingM != null && hazardM != null) {
    const landingWeight = landing?.kind === 'rtls' ? 0.35 : landing?.canUseDirection ? Math.max(0.5, landing.directionWeight) : 0.45;
    const hazardWeight = 0.95;
    raw = (landingM * landingWeight + hazardM * hazardWeight) / (landingWeight + hazardWeight);
  }

  const minM = Math.min(profile.landing.downrangeMinM, profile.tier2.downrangeMaxM);
  const maxM = Math.max(profile.landing.downrangeMaxM, profile.tier2.downrangeMaxM);
  return clamp(raw, minM, maxM);
}

function fuseDirectionalSignals({
  signals,
  landing,
  profile,
  hazard
}: {
  signals: DirectionSignal[];
  landing: LandingConstraintEvaluation | null;
  profile: EnvelopeProfile;
  hazard: { maxDistKm: number } | null;
}): DirectionFusionResult | null {
  const usableSignals = signals.filter(
    (signal) =>
      Number.isFinite(signal.azDeg) &&
      Number.isFinite(signal.sigmaDeg) &&
      signal.sigmaDeg > 0 &&
      Number.isFinite(signal.weight) &&
      signal.weight > 0
  );
  if (!usableSignals.length) return null;

  const rankedSignals = [...usableSignals].sort((a, b) => {
    const kindDelta = directionSignalAuthorityRank(b.kind) - directionSignalAuthorityRank(a.kind);
    if (kindDelta) return kindDelta;
    const weightDelta = directionSignalVectorWeight(b) - directionSignalVectorWeight(a);
    if (weightDelta) return weightDelta;
    return b.weight - a.weight;
  });
  const primary = rankedSignals[0] ?? null;
  const hasAuthoritativeDirectional = rankedSignals.some((signal) => directionSignalAuthorityRank(signal.kind) >= 4);
  const anchorAzDeg = primary?.azDeg ?? 0;
  const consensusSignals = hasAuthoritativeDirectional
    ? rankedSignals.filter((signal) => {
        if (signal === primary) return true;
        if (directionSignalAuthorityRank(signal.kind) >= 4) return true;
        const toleranceDeg = clamp(primary!.sigmaDeg * 2.25 + signal.sigmaDeg, 14, signal.kind === 'heuristic' ? 28 : 36);
        return angularDiffDeg(signal.azDeg, anchorAzDeg) <= toleranceDeg;
      })
    : rankedSignals;
  const ignoredSignalKinds = rankedSignals
    .filter((signal) => !consensusSignals.includes(signal))
    .map((signal) => signal.kind);

  const azDeg = weightedCircularMeanDeg(consensusSignals);
  if (azDeg == null) return null;

  const dispersionDeg = weightedAngularRmsDeg(consensusSignals, azDeg);
  const tightestSigmaDeg = consensusSignals.reduce((min, signal) => Math.min(min, signal.sigmaDeg), Number.POSITIVE_INFINITY);
  const strongerSignals = consensusSignals.filter((signal) => signal.kind === 'orbit' || signal.kind === 'hazard');
  const landingSignal = consensusSignals.find((signal) => signal.kind === 'landing') ?? null;
  const landingCorroborated =
    Boolean(landing?.canUseDirection) &&
    landingSignal != null &&
    strongerSignals.some((signal) => angularDiffDeg(signal.azDeg, landingSignal.azDeg) <= Math.max(12, signal.sigmaDeg + (landing?.directionSigmaDeg ?? 12)));

  const sigmaDeg = clamp(
    Math.max(
      tightestSigmaDeg * (consensusSignals.length >= 2 ? 0.9 : 1.05),
      dispersionDeg != null ? dispersionDeg * 1.35 : 0,
      landingCorroborated ? 5 : 7
    ),
    4,
    24
  );

  const templateKey = consensusSignals.find((signal) => signal.kind === 'template')?.templateKey ?? null;
  const signalKinds = Array.from(new Set(consensusSignals.map((signal) => signal.kind)));
  const notes = [
    `Direction fusion: ${signalKinds.join(' + ')}`,
    `Fused azimuth: ${azDeg.toFixed(1)} deg`,
    `Fused sigma baseline: ${sigmaDeg.toFixed(1)} deg`,
    ignoredSignalKinds.length ? `Outlier priors ignored: ${Array.from(new Set(ignoredSignalKinds)).join(', ')}` : null,
    landingCorroborated ? 'Landing direction corroborated by higher-authority directional signal.' : null
  ].filter(Boolean) as string[];

  return {
    azDeg,
    sigmaDeg,
    signals: consensusSignals,
    primary,
    notes,
    landingCorroborated,
    templateKey,
    downrangeMaxM: inferDirectionalDownrangeMaxM({ landing, hazard, profile })
  };
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'unknown_error';
  }
}

async function startIngestionRun(supabase: ReturnType<typeof createSupabaseAdminClient>, jobName: string) {
  const { data, error } = await supabase.from('ingestion_runs').insert({ job_name: jobName }).select('id').single();
  if (error || !data) {
    console.warn('Failed to start ingestion_runs record', { jobName, error: error?.message });
    return { runId: null as number | null };
  }
  return { runId: data.id as number };
}

async function finishIngestionRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: number | null,
  success: boolean,
  stats?: Record<string, unknown>,
  error?: string
) {
  if (runId == null) return;
  const { error: updateError } = await supabase
    .from('ingestion_runs')
    .update({
      ended_at: new Date().toISOString(),
      success,
      stats: stats ?? null,
      error: error ?? null
    })
    .eq('id', runId);
  if (updateError) {
    console.warn('Failed to update ingestion_runs record', { runId, updateError: updateError.message });
  }
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
