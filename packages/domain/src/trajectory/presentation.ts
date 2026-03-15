export function formatTrajectoryAuthorityTierLabel(value: string) {
  if (value === 'partner_feed') return 'Partner feed';
  if (value === 'official_numeric') return 'Official numeric';
  if (value === 'regulatory_constrained') return 'Regulatory constrained';
  if (value === 'supplemental_ephemeris') return 'Supplemental ephemeris';
  if (value === 'public_metadata') return 'Public metadata';
  return 'Model prior';
}

export function formatTrajectoryQualityStateLabel(value: string) {
  if (value === 'precision') return 'Precision';
  if (value === 'guided') return 'Guided';
  if (value === 'search') return 'Search';
  return 'Pad only';
}

export function formatTrajectoryFieldConfidenceLabel(value: string) {
  if (value === 'strong') return 'Strong';
  if (value === 'moderate') return 'Moderate';
  if (value === 'limited') return 'Limited';
  return 'Modeled';
}

export function formatTrajectoryReasonLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'source_contract_missing') return 'source contract missing';
  if (normalized === 'source_contract_unknown') return 'source contract status unknown';
  if (normalized === 'source_contract_failed') return 'source contract failed validation';
  if (normalized === 'sources_stale') return 'source evidence is stale';
  if (normalized === 'lineage_incomplete') return 'source lineage is incomplete';
  if (normalized === 'missing_required_fields') return 'required trajectory fields are missing';
  if (normalized === 'blocking_reasons_present') return 'blocking trajectory issues are present';
  if (normalized === 'directional_constraint') return 'directional constraint missing';
  if (normalized === 'launch_azimuth') return 'launch azimuth missing';
  if (normalized === 'target_orbit') return 'target orbit detail missing';
  if (normalized === 'landing_constraint') return 'landing constraint missing';
  if (normalized === 'hazard_area') return 'hazard area missing';
  if (normalized === 'supgp_constraint') return 'supplemental ephemeris missing';
  if (normalized === 'no_constraint_lineage') return 'constraint lineage unavailable';
  if (normalized === 'provider_conflict') return 'source providers disagree';
  if (normalized === 'stale_hazard_constraint') return 'hazard geometry is stale';
  if (normalized === 'stale_landing_constraint') return 'landing geometry is stale';
  return normalized.replace(/[_-]+/g, ' ');
}

export function dedupeTrajectoryReasonLabels(values: Array<string | null | undefined>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const label = formatTrajectoryReasonLabel(value);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}
