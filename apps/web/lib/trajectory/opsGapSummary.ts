import { deriveTrajectoryEvidenceView, type TrajectoryConfidenceTier } from '@/lib/ar/trajectoryEvidence';

const RELEVANT_PRODUCT_CONSTRAINT_TYPES = new Set(['landing', 'target_orbit', 'hazard_area']);
const HAZARD_NET_BUFFER_MS = 12 * 60 * 60 * 1000;

export type TrajectoryOpsConstraintRow = {
  constraint_type: string;
  data?: any;
  geometry?: any;
  fetched_at?: string | null;
};

export type TrajectoryOpsProductRow = {
  generated_at?: string | null;
  quality?: number | null;
  confidence_tier?: unknown;
  source_sufficiency?: unknown;
  freshness_state?: unknown;
  lineage_complete?: boolean | null;
  product?: unknown;
};

export type TrajectoryOpsDirectionalSourceCode =
  | 'partner_feed'
  | 'official_numeric_orbit'
  | 'supplemental_ephemeris'
  | 'hazard_area'
  | 'landing'
  | 'constraint_backed'
  | 'template_prior'
  | 'pad_only'
  | 'unknown';

export type TrajectoryOpsGapReasonCode =
  | 'product_missing'
  | 'product_stale'
  | 'no_external_directional_constraint'
  | 'orbit_derived_only'
  | 'orbit_truth_tier_missing'
  | 'orbit_azimuth_missing'
  | 'orbit_altitude_missing'
  | 'landing_coordinates_missing'
  | 'hazard_geometry_missing'
  | 'hazard_window_not_near_net'
  | 'product_using_template_prior'
  | 'product_estimate_corridor'
  | 'product_pad_only';

export type TrajectoryOpsGapReason = {
  code: TrajectoryOpsGapReasonCode;
  label: string;
};

export type TrajectoryOpsGapSummary = {
  counts: {
    landing: number;
    orbit: number;
    hazard: number;
    missionInfographic: number;
    orbitTruth: number;
    orbitDerived: number;
    hazardWithGeometry: number;
    hazardNearNet: number;
  };
  signals: {
    hasLandingLatLon: boolean;
    hasOrbitFlightAzimuth: boolean;
    hasOrbitInclination: boolean;
    hasOrbitAltitude: boolean;
    hasTruthTierOrbit: boolean;
    hasDerivedOnlyOrbit: boolean;
    hasHazardGeometry: boolean;
    hasHazardWindowNearNet: boolean;
    hasDirectionalConstraint: boolean;
    hasConstraintBackedDirectionalSource: boolean;
  };
  freshness: {
    missingProduct: boolean;
    productStale: boolean;
  };
  product: {
    qualityLabel: string | null;
    confidenceTier: TrajectoryConfidenceTier | null;
    freshnessState: string | null;
    lineageComplete: boolean | null;
    sourceSummaryCode: string | null;
    sourceSummaryLabel: string | null;
    directionalSourceCode: TrajectoryOpsDirectionalSourceCode;
    directionalSourceLabel: string;
    usedConstraintCount: number | null;
  };
  gapReasons: TrajectoryOpsGapReason[];
  primaryGap: TrajectoryOpsGapReason | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asConfidenceTier(value: unknown): TrajectoryConfidenceTier | null {
  if (value === 'A' || value === 'B' || value === 'C' || value === 'D') return value;
  return null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function anyConstraintNewerThan(constraints: TrajectoryOpsConstraintRow[], iso: string | null | undefined) {
  if (!iso) return false;
  const productMs = Date.parse(iso);
  if (!Number.isFinite(productMs)) return false;
  for (const row of constraints) {
    const fetchedMs = typeof row?.fetched_at === 'string' ? Date.parse(row.fetched_at) : NaN;
    if (!Number.isFinite(fetchedMs)) continue;
    if (fetchedMs > productMs + 10_000) return true;
  }
  return false;
}

export function formatTrajectoryOpsGapReason(code: TrajectoryOpsGapReasonCode) {
  if (code === 'product_missing') return 'Product missing';
  if (code === 'product_stale') return 'Product older than newest constraint';
  if (code === 'no_external_directional_constraint') return 'No external directional constraint';
  if (code === 'orbit_derived_only') return 'Orbit is derived-only';
  if (code === 'orbit_truth_tier_missing') return 'Truth-tier orbit missing';
  if (code === 'orbit_azimuth_missing') return 'Orbit numeric lacks flight azimuth';
  if (code === 'orbit_altitude_missing') return 'Orbit numeric lacks altitude envelope';
  if (code === 'landing_coordinates_missing') return 'Landing metadata lacks coordinates';
  if (code === 'hazard_geometry_missing') return 'Hazard constraints lack geometry';
  if (code === 'hazard_window_not_near_net') return 'Hazard window does not bracket NET';
  if (code === 'product_using_template_prior') return 'Product falls back to template prior';
  if (code === 'product_estimate_corridor') return 'Product quality is estimate corridor';
  return 'Product quality is pad-only';
}

function formatDirectionalSourceLabel(code: TrajectoryOpsDirectionalSourceCode) {
  if (code === 'partner_feed') return 'Partner feed';
  if (code === 'official_numeric_orbit') return 'Official numeric orbit';
  if (code === 'supplemental_ephemeris') return 'Supplemental ephemeris';
  if (code === 'hazard_area') return 'Hazard area';
  if (code === 'landing') return 'Landing metadata';
  if (code === 'constraint_backed') return 'Constraint-backed';
  if (code === 'template_prior') return 'Template prior';
  if (code === 'pad_only') return 'Pad-only';
  return 'Unknown';
}

function deriveDirectionalSource({
  signalSummary,
  sourceSummaryCode,
  qualityLabel
}: {
  signalSummary: Record<string, unknown> | null;
  sourceSummaryCode: string | null;
  qualityLabel: string | null;
}): TrajectoryOpsDirectionalSourceCode {
  if (Boolean(signalSummary?.hasLicensedTrajectoryFeed)) return 'partner_feed';
  if (Boolean(signalSummary?.hasMissionNumericOrbit)) return 'official_numeric_orbit';
  if (Boolean(signalSummary?.hasSupgpConstraint)) return 'supplemental_ephemeris';
  if (Boolean(signalSummary?.hasHazardDirectional)) return 'hazard_area';
  if (Boolean(signalSummary?.hasLandingDirectional)) return 'landing';
  if (sourceSummaryCode === 'corroborated_landing' || sourceSummaryCode === 'landing_prior' || sourceSummaryCode === 'constraint_doc_plus_landing') {
    return 'landing';
  }
  if (Boolean(signalSummary?.hasDirectionalConstraint)) return 'constraint_backed';
  if (sourceSummaryCode === 'template_estimate' || qualityLabel === 'estimate_corridor') return 'template_prior';
  if (sourceSummaryCode === 'pad_only' || qualityLabel === 'pad_only') return 'pad_only';
  return 'unknown';
}

function pushGapReason(reasons: TrajectoryOpsGapReason[], code: TrajectoryOpsGapReasonCode) {
  if (reasons.some((reason) => reason.code === code)) return;
  reasons.push({ code, label: formatTrajectoryOpsGapReason(code) });
}

export function summarizeTrajectoryOpsGaps({
  constraints,
  productRow,
  net
}: {
  constraints: TrajectoryOpsConstraintRow[];
  productRow?: TrajectoryOpsProductRow | null;
  net?: string | null;
}): TrajectoryOpsGapSummary {
  const landing = constraints.filter((row) => row.constraint_type === 'landing');
  const orbit = constraints.filter((row) => row.constraint_type === 'target_orbit');
  const hazards = constraints.filter((row) => row.constraint_type === 'hazard_area');
  const missionInfographic = constraints.filter((row) => row.constraint_type === 'mission_infographic');
  const relevantConstraints = constraints.filter((row) => RELEVANT_PRODUCT_CONSTRAINT_TYPES.has(row.constraint_type));

  const hasLandingLatLon = landing.some((row) => {
    const loc = row?.data?.landing_location;
    return isFiniteNumber(loc?.latitude) && isFiniteNumber(loc?.longitude);
  });
  const hasOrbitFlightAzimuth = orbit.some((row) => isFiniteNumber(row?.data?.flight_azimuth_deg));
  const hasOrbitInclination = orbit.some((row) => isFiniteNumber(row?.data?.inclination_deg));
  const hasOrbitAltitude = orbit.some(
    (row) =>
      isFiniteNumber(row?.data?.altitude_km) ||
      isFiniteNumber(row?.data?.perigee_km) ||
      isFiniteNumber(row?.data?.apogee_km)
  );
  const orbitTruth = orbit.filter((row) => row?.data?.sourceTier === 'truth').length;
  const orbitDerived = orbit.filter((row) => row?.data?.derived === true).length;
  const hazardWithGeometry = hazards.filter((row) => row.geometry && typeof row.geometry === 'object').length;

  const netMs = typeof net === 'string' ? Date.parse(net) : NaN;
  const hazardNearNet = hazards.filter((row) => {
    if (!Number.isFinite(netMs)) return false;
    const startMs = row?.data?.validStartUtc ? Date.parse(String(row.data.validStartUtc)) : NaN;
    const endMs = row?.data?.validEndUtc ? Date.parse(String(row.data.validEndUtc)) : NaN;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return false;
    return netMs >= startMs - HAZARD_NET_BUFFER_MS && netMs <= endMs + HAZARD_NET_BUFFER_MS;
  }).length;

  const hasTruthTierOrbit = orbitTruth > 0;
  const hasDerivedOnlyOrbit = orbitTruth === 0 && orbitDerived > 0;
  const hasHazardGeometry = hazardWithGeometry > 0;
  const hasHazardWindowNearNet = hazardNearNet > 0;
  const hasDirectionalConstraint = hasLandingLatLon || hasOrbitFlightAzimuth || hasOrbitInclination || hasHazardGeometry;

  const productObj = asObject(productRow?.product);
  const qualityLabel = typeof productObj?.qualityLabel === 'string' ? productObj.qualityLabel : null;
  const sourceSufficiency = asObject(productRow?.source_sufficiency);
  const sourceSummary = asObject(sourceSufficiency?.sourceSummary);
  const signalSummary = asObject(sourceSufficiency?.signalSummary);
  const evidenceView = deriveTrajectoryEvidenceView({
    confidenceTier: productRow?.confidence_tier,
    sourceSufficiency,
    lineageComplete: typeof productRow?.lineage_complete === 'boolean' ? productRow.lineage_complete : null,
    qualityLabel
  });
  const sourceSummaryCode = evidenceView.sourceSummaryCode === 'unknown' ? null : evidenceView.sourceSummaryCode;
  const sourceSummaryLabel =
    typeof sourceSummary?.label === 'string'
      ? sourceSummary.label
      : evidenceView.sourceSummaryCode === 'unknown'
        ? null
        : evidenceView.evidenceLabel;
  const directionalSourceCode = deriveDirectionalSource({ signalSummary, sourceSummaryCode, qualityLabel });
  const directionalSourceLabel = formatDirectionalSourceLabel(directionalSourceCode);
  const usedConstraintCountRaw = signalSummary?.usedConstraintCount;
  const usedConstraintCount =
    typeof usedConstraintCountRaw === 'number' && Number.isFinite(usedConstraintCountRaw)
      ? usedConstraintCountRaw
      : null;

  const missingProduct = !productRow;
  const productStale = productRow ? anyConstraintNewerThan(relevantConstraints, productRow.generated_at) : false;
  const hasConstraintBackedDirectionalSource =
    directionalSourceCode !== 'template_prior' && directionalSourceCode !== 'pad_only' && directionalSourceCode !== 'unknown';

  const gapReasons: TrajectoryOpsGapReason[] = [];
  if (missingProduct) pushGapReason(gapReasons, 'product_missing');
  else if (productStale) pushGapReason(gapReasons, 'product_stale');

  if (!hasDirectionalConstraint) pushGapReason(gapReasons, 'no_external_directional_constraint');
  if (!hasLandingLatLon && hasDerivedOnlyOrbit) pushGapReason(gapReasons, 'orbit_derived_only');
  if (orbit.length > 0 && !hasTruthTierOrbit) pushGapReason(gapReasons, 'orbit_truth_tier_missing');
  if (orbit.length > 0 && hasOrbitInclination && !hasOrbitFlightAzimuth) pushGapReason(gapReasons, 'orbit_azimuth_missing');
  if (orbit.length > 0 && !hasOrbitAltitude) pushGapReason(gapReasons, 'orbit_altitude_missing');
  if (landing.length > 0 && !hasLandingLatLon) pushGapReason(gapReasons, 'landing_coordinates_missing');
  if (hazards.length > 0 && !hasHazardGeometry) pushGapReason(gapReasons, 'hazard_geometry_missing');
  if (hazardWithGeometry > 0 && Number.isFinite(netMs) && !hasHazardWindowNearNet) {
    pushGapReason(gapReasons, 'hazard_window_not_near_net');
  }
  if (!missingProduct && directionalSourceCode === 'template_prior') {
    pushGapReason(gapReasons, 'product_using_template_prior');
  }
  if (!missingProduct && qualityLabel === 'estimate_corridor') {
    pushGapReason(gapReasons, 'product_estimate_corridor');
  }
  if (!missingProduct && qualityLabel === 'pad_only') {
    pushGapReason(gapReasons, 'product_pad_only');
  }

  return {
    counts: {
      landing: landing.length,
      orbit: orbit.length,
      hazard: hazards.length,
      missionInfographic: missionInfographic.length,
      orbitTruth,
      orbitDerived,
      hazardWithGeometry,
      hazardNearNet
    },
    signals: {
      hasLandingLatLon,
      hasOrbitFlightAzimuth,
      hasOrbitInclination,
      hasOrbitAltitude,
      hasTruthTierOrbit,
      hasDerivedOnlyOrbit,
      hasHazardGeometry,
      hasHazardWindowNearNet,
      hasDirectionalConstraint,
      hasConstraintBackedDirectionalSource
    },
    freshness: {
      missingProduct,
      productStale
    },
    product: {
      qualityLabel,
      confidenceTier: asConfidenceTier(productRow?.confidence_tier),
      freshnessState: typeof productRow?.freshness_state === 'string' ? productRow.freshness_state : null,
      lineageComplete: typeof productRow?.lineage_complete === 'boolean' ? productRow.lineage_complete : null,
      sourceSummaryCode,
      sourceSummaryLabel,
      directionalSourceCode,
      directionalSourceLabel,
      usedConstraintCount
    },
    gapReasons,
    primaryGap: gapReasons[0] ?? null
  };
}
