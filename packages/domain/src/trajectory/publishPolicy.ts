type ContractStatus = 'pass' | 'fail' | 'unknown';
type FreshnessState = 'fresh' | 'stale' | 'unknown';

export type TrajectoryPublishPolicyReason =
  | 'source_contract_missing'
  | 'source_contract_unknown'
  | 'source_contract_failed'
  | 'sources_stale'
  | 'lineage_incomplete'
  | 'missing_required_fields'
  | 'blocking_reasons_present';

export type TrajectoryPublishPolicy = {
  precisionClaim: boolean;
  allowPrecision: boolean;
  enforcePadOnly: boolean;
  contractStatus: ContractStatus;
  missingFields: string[];
  blockingReasons: string[];
  reasons: TrajectoryPublishPolicyReason[];
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
  return Array.from(new Set(items));
}

function asContractStatus(value: unknown): ContractStatus {
  if (value === 'pass' || value === 'fail' || value === 'unknown') return value;
  return 'unknown';
}

function asFreshnessState(value: unknown): FreshnessState {
  if (value === 'fresh' || value === 'stale' || value === 'unknown') return value;
  return 'unknown';
}

function isPrecisionQualityLabel(value: unknown) {
  return value === 'landing_constrained';
}

function uniqueReasons(reasons: TrajectoryPublishPolicyReason[]) {
  return Array.from(new Set(reasons));
}

export function deriveTrajectoryPublishPolicy({
  quality,
  qualityLabel,
  sourceSufficiency,
  freshnessState,
  lineageComplete
}: {
  quality: unknown;
  qualityLabel?: unknown;
  sourceSufficiency?: unknown;
  freshnessState?: unknown;
  lineageComplete?: unknown;
}): TrajectoryPublishPolicy {
  const source = asObject(sourceSufficiency);
  const sourceQualityLabel = typeof source?.qualityLabel === 'string' ? source.qualityLabel : null;
  const numericQuality = typeof quality === 'number' && Number.isFinite(quality) ? quality : null;
  const labelPrecisionClaim =
    isPrecisionQualityLabel(qualityLabel) || isPrecisionQualityLabel(sourceQualityLabel) || source?.precisionClaim === true;
  const precisionClaim =
    labelPrecisionClaim ||
    (numericQuality != null && numericQuality > 0 && qualityLabel == null && sourceQualityLabel == null && source?.precisionClaim == null);

  if (!precisionClaim) {
    return {
      precisionClaim: false,
      allowPrecision: false,
      enforcePadOnly: false,
      contractStatus: 'unknown',
      missingFields: [],
      blockingReasons: [],
      reasons: []
    };
  }

  const missingFields = asStringArray(source?.missingFields);
  const blockingReasons = asStringArray(source?.blockingReasons);
  const sourceLineage = typeof source?.lineageComplete === 'boolean' ? source.lineageComplete : null;
  const effectiveLineage = typeof lineageComplete === 'boolean' ? lineageComplete : sourceLineage;
  const contractStatus = asContractStatus(source?.status ?? source?.contractStatus);
  const effectiveFreshness = asFreshnessState(
    freshnessState ?? source?.freshnessState ?? source?.freshness_state ?? source?.sourceFreshnessState
  );

  const reasons: TrajectoryPublishPolicyReason[] = [];
  if (!source) reasons.push('source_contract_missing');
  if (contractStatus === 'unknown') reasons.push('source_contract_unknown');
  if (contractStatus === 'fail') reasons.push('source_contract_failed');
  if (effectiveFreshness === 'stale') reasons.push('sources_stale');
  if (effectiveLineage === false) reasons.push('lineage_incomplete');
  if (missingFields.length) reasons.push('missing_required_fields');
  if (blockingReasons.length) reasons.push('blocking_reasons_present');

  const dedupedReasons = uniqueReasons(reasons);
  const allowPrecision = dedupedReasons.length === 0;

  return {
    precisionClaim: true,
    allowPrecision,
    enforcePadOnly: !allowPrecision,
    contractStatus,
    missingFields,
    blockingReasons,
    reasons: dedupedReasons
  };
}

export function applyTrajectoryPublishPolicyToProduct(
  product: Record<string, unknown> | null,
  policy: TrajectoryPublishPolicy
): Record<string, unknown> | null {
  if (!policy.enforcePadOnly) return product;

  const base = product ? { ...product } : {};
  const assumptions = asStringArray(base.assumptions);
  for (const reason of policy.reasons) {
    assumptions.push(`Publish guard: ${reason}`);
  }

  const trackSummary = asObject(base.trackSummary);

  return {
    ...base,
    qualityLabel: 'pad_only',
    samples: [],
    events: [],
    tracks: [],
    milestones: Array.isArray(base.milestones) ? base.milestones : [],
    assumptions: Array.from(new Set(assumptions)),
    trackSummary: {
      ...(trackSummary || {}),
      quality: 0,
      qualityLabel: 'pad_only',
      precisionClaim: false,
      downgraded: true
    }
  };
}
