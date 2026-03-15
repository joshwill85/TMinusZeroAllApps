export type TrajectoryConfidenceTier = 'A' | 'B' | 'C' | 'D';
export type TrajectoryConfidenceBadge = 'high' | 'medium' | 'low' | 'unknown';
export type TrajectorySourceSummaryCode =
  | 'partner_feed'
  | 'corroborated_landing'
  | 'landing_prior'
  | 'constraint_doc_plus_landing'
  | 'constraint_backed'
  | 'template_estimate'
  | 'pad_only'
  | 'unknown';

export type TrajectoryEvidenceView = {
  confidenceBadge: TrajectoryConfidenceBadge;
  confidenceBadgeLabel: string;
  evidenceLabel: string;
  sourceSummaryCode: TrajectorySourceSummaryCode;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asConfidenceTier(value: unknown): TrajectoryConfidenceTier | null {
  if (value === 'A' || value === 'B' || value === 'C' || value === 'D') return value;
  return null;
}

function asSourceSummaryCode(value: unknown): TrajectorySourceSummaryCode | null {
  if (
    value === 'partner_feed' ||
    value === 'corroborated_landing' ||
    value === 'landing_prior' ||
    value === 'constraint_doc_plus_landing' ||
    value === 'constraint_backed' ||
    value === 'template_estimate' ||
    value === 'pad_only'
  ) {
    return value;
  }

  const obj = asObject(value);
  if (!obj) return null;
  const code = obj.code;
  if (
    code === 'partner_feed' ||
    code === 'corroborated_landing' ||
    code === 'landing_prior' ||
    code === 'constraint_doc_plus_landing' ||
    code === 'constraint_backed' ||
    code === 'template_estimate' ||
    code === 'pad_only'
  ) {
    return code;
  }
  return null;
}

function sourceSummaryFromQualityLabel(value: unknown): TrajectorySourceSummaryCode | null {
  if (value === 'landing_constrained') return 'corroborated_landing';
  if (value === 'estimate_corridor') return 'template_estimate';
  if (value === 'pad_only') return 'pad_only';
  return null;
}

function evidenceLabelForSourceSummary(sourceSummaryCode: TrajectorySourceSummaryCode): string {
  if (sourceSummaryCode === 'partner_feed') return 'Partner feed';
  if (sourceSummaryCode === 'corroborated_landing') return 'Constraint-backed (corroborated landing)';
  if (sourceSummaryCode === 'landing_prior') return 'Landing prior';
  if (sourceSummaryCode === 'constraint_doc_plus_landing') return 'Constraint-backed (doc + landing)';
  if (sourceSummaryCode === 'constraint_backed') return 'Constraint-backed';
  if (sourceSummaryCode === 'template_estimate') return 'Template estimate';
  if (sourceSummaryCode === 'pad_only') return 'Pad-only';
  return 'Trajectory estimate';
}

function confidenceBadgeFromTier(tier: TrajectoryConfidenceTier | null): TrajectoryConfidenceBadge {
  if (tier === 'A') return 'high';
  if (tier === 'B') return 'medium';
  if (tier === 'C' || tier === 'D') return 'low';
  return 'unknown';
}

function confidenceBadgeLabel(badge: TrajectoryConfidenceBadge, lineageComplete: boolean | null): string {
  if (badge === 'high') return 'High confidence';
  if (badge === 'medium') return lineageComplete === false ? 'Confidence limited (lineage partial)' : 'Moderate confidence';
  if (badge === 'low') return 'Low confidence';
  return 'Confidence unknown';
}

export function deriveTrajectoryEvidenceView({
  confidenceTier,
  sourceSufficiency,
  lineageComplete,
  qualityLabel
}: {
  confidenceTier?: unknown;
  sourceSufficiency?: unknown;
  lineageComplete?: boolean | null;
  qualityLabel?: unknown;
}): TrajectoryEvidenceView {
  const tier = asConfidenceTier(confidenceTier);
  const sourceSufficiencyObj = asObject(sourceSufficiency);
  const sourceSummaryCode =
    asSourceSummaryCode(sourceSufficiencyObj?.sourceSummary) ??
    sourceSummaryFromQualityLabel(sourceSufficiencyObj?.qualityLabel) ??
    sourceSummaryFromQualityLabel(qualityLabel) ??
    'unknown';

  let confidenceBadge = confidenceBadgeFromTier(tier);
  if (lineageComplete === false && confidenceBadge === 'high') {
    confidenceBadge = 'medium';
  }

  return {
    confidenceBadge,
    confidenceBadgeLabel: confidenceBadgeLabel(confidenceBadge, lineageComplete ?? null),
    evidenceLabel: evidenceLabelForSourceSummary(sourceSummaryCode),
    sourceSummaryCode
  };
}
