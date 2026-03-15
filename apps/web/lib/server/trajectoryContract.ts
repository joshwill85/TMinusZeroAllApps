import {
  deriveTrajectoryEvidenceView,
  type TrajectoryConfidenceBadge,
  type TrajectoryConfidenceTier
} from '@/lib/ar/trajectoryEvidence';
import { deriveTrajectoryFieldAuthorityProfile, type TrajectoryFieldAuthorityProfile } from '@/lib/trajectory/fieldAuthority';
import type {
  TrajectoryMilestonePhase,
  TrajectoryMilestoneProjectionReason,
  TrajectoryMilestoneSourceType
} from '@/lib/trajectory/milestones';
import {
  applyTrajectoryPublishPolicyToProduct,
  deriveTrajectoryPublishPolicy,
  type TrajectoryPublishPolicy
} from '@/lib/ar/trajectoryPublishPolicy';

export type TrajectoryFreshnessState = 'fresh' | 'stale' | 'unknown';
export type TrajectoryAuthorityTier =
  | 'partner_feed'
  | 'official_numeric'
  | 'regulatory_constrained'
  | 'supplemental_ephemeris'
  | 'public_metadata'
  | 'model_prior';
export type TrajectoryTrackKind = 'core_up' | 'booster_down';
export type TrajectoryMilestoneConfidence = 'low' | 'med' | 'high';
export type TrajectoryQualityState = 'precision' | 'guided' | 'search' | 'pad_only';

export type TrajectoryTrackSample = {
  tPlusSec: number;
  ecef: [number, number, number];
  sigmaDeg?: number;
  covariance?: {
    alongTrackDeg: number;
    crossTrackDeg: number;
  };
  uncertainty?: {
    sigmaDeg?: number;
    covariance?: {
      alongTrackDeg: number;
      crossTrackDeg: number;
    };
  };
};

export type TrajectoryTrackPayload = {
  trackKind: TrajectoryTrackKind;
  samples: TrajectoryTrackSample[];
};

export type TrajectoryMilestonePayload = {
  key: string;
  tPlusSec: number | null;
  label: string;
  description?: string | null;
  timeText?: string | null;
  sourceRefIds: string[];
  confidence?: TrajectoryMilestoneConfidence;
  phase: TrajectoryMilestonePhase;
  trackKind?: TrajectoryTrackKind;
  sourceType: TrajectoryMilestoneSourceType;
  estimated: boolean;
  projectable: boolean;
  projectionReason?: TrajectoryMilestoneProjectionReason;
};

export type TrajectoryUncertaintyEnvelope = {
  sampleCount: number;
  sigmaDegP50: number | null;
  sigmaDegP95: number | null;
  sigmaDegMax: number | null;
};

export type TrajectoryFieldProvenance = TrajectoryFieldAuthorityProfile;

export type TrajectoryContractRow = {
  launch_id: string;
  version: string;
  quality: number;
  generated_at: string;
  product: unknown;
  confidence_tier: unknown;
  source_sufficiency: unknown;
  freshness_state: unknown;
  lineage_complete: boolean | null;
};

export type TrajectoryContract = {
  launchId: string;
  version: string;
  modelVersion: string;
  quality: number;
  qualityState: TrajectoryQualityState;
  authorityTier: TrajectoryAuthorityTier;
  fieldProvenance: {
    azimuth: TrajectoryFieldProvenance;
    altitude: TrajectoryFieldProvenance;
    milestones: TrajectoryFieldProvenance;
    uncertainty: TrajectoryFieldProvenance;
  };
  runtimeHints: {
    defaultOverlayMode: 'precision' | 'guided' | 'search';
    trackCount: number;
    milestoneCount: number;
    prefersWideSearch: boolean;
    hasBoosterTrack: boolean;
  };
  uncertaintyEnvelope: TrajectoryUncertaintyEnvelope;
  sourceBlend: {
    sourceCode: string | null;
    sourceLabel: string | null;
    hasLicensedTrajectoryFeed: boolean;
    hasDirectionalConstraint: boolean;
    hasLandingDirectional: boolean;
    hasHazardDirectional: boolean;
    hasMissionNumericOrbit: boolean;
    hasSupgpConstraint: boolean;
  };
  confidenceReasons: string[];
  safeModeActive: boolean;
  generatedAt: string;
  evidenceEpoch: string;
  confidenceTier: TrajectoryConfidenceTier | null;
  sourceSufficiency: Record<string, unknown> | null;
  freshnessState: TrajectoryFreshnessState | null;
  lineageComplete: boolean;
  publishPolicy: TrajectoryPublishPolicy;
  confidenceBadge: TrajectoryConfidenceBadge;
  confidenceBadgeLabel: string;
  evidenceLabel: string;
  tracks: TrajectoryTrackPayload[];
  milestones: TrajectoryMilestonePayload[];
  product: Record<string, unknown>;
};

export type TrajectoryPublicV2QualityState = 'precision' | 'safe_corridor' | 'pad_only';

export type TrajectoryPublicV2Response = {
  launchId: string;
  version: string;
  modelVersion: string;
  quality: number;
  qualityState: TrajectoryPublicV2QualityState;
  uncertaintyEnvelope: TrajectoryUncertaintyEnvelope;
  sourceBlend: {
    sourceCode: string | null;
    sourceLabel: string | null;
    hasDirectionalConstraint: boolean;
    hasLandingDirectional: boolean;
    hasHazardDirectional: boolean;
    hasMissionNumericOrbit: boolean;
    hasSupgpConstraint: boolean;
  };
  confidenceReasons: string[];
  safeModeActive: boolean;
  generatedAt: string;
  confidenceTier: TrajectoryConfidenceTier | null;
  sourceSufficiency: Record<string, unknown> | null;
  freshnessState: TrajectoryFreshnessState | null;
  lineageComplete: boolean;
  publishPolicy: TrajectoryPublishPolicy;
  confidenceBadge: TrajectoryConfidenceBadge;
  evidenceLabel: string;
  tracks: TrajectoryTrackPayload[];
  milestones: TrajectoryMilestonePayload[];
  product: Record<string, unknown> | null;
};

export const TRAJECTORY_CONTRACT_COLUMNS =
  'launch_id, version, quality, generated_at, product, confidence_tier, source_sufficiency, freshness_state, lineage_complete';

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asConfidenceTier(value: unknown): TrajectoryConfidenceTier | null {
  if (value === 'A' || value === 'B' || value === 'C' || value === 'D') return value;
  return null;
}

function asFreshnessState(value: unknown): TrajectoryFreshnessState | null {
  if (value === 'fresh' || value === 'stale' || value === 'unknown') return value;
  return null;
}

function asMilestoneConfidence(value: unknown): TrajectoryMilestoneConfidence | undefined {
  if (value === 'low' || value === 'med' || value === 'high') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0.85) return 'high';
    if (value >= 0.45) return 'med';
    if (value >= 0) return 'low';
  }
  return undefined;
}

function normalizeTrackKind(raw: unknown): TrajectoryTrackKind {
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (value === 'booster_down' || value === 'booster-down' || value === 'boosterdown') return 'booster_down';
    if (value === 'core_up' || value === 'core-up' || value === 'coreup') return 'core_up';
    if (value.includes('booster') && value.includes('down')) return 'booster_down';
  }
  return 'core_up';
}

function normalizeMilestonePhase(raw: unknown): TrajectoryMilestonePhase | null {
  if (raw === 'prelaunch' || raw === 'core_ascent' || raw === 'upper_stage' || raw === 'booster_return' || raw === 'landing' || raw === 'unknown') {
    return raw;
  }
  return null;
}

function normalizeMilestoneSourceType(raw: unknown): TrajectoryMilestoneSourceType | null {
  if (raw === 'provider_timeline' || raw === 'll2_timeline' || raw === 'family_template') return raw;
  return null;
}

function normalizeMilestoneProjectionReason(raw: unknown): TrajectoryMilestoneProjectionReason | undefined {
  if (raw === 'phase_not_projectable' || raw === 'missing_track' || raw === 'outside_track_horizon' || raw === 'unresolved_time') {
    return raw;
  }
  return undefined;
}

function inferLegacyMilestonePhase(key: string, label: string): TrajectoryMilestonePhase {
  const raw = `${key} ${label}`.toLowerCase();
  if (raw.includes('seco')) return 'upper_stage';
  if (raw.includes('boostback') || raw.includes('entry')) return 'booster_return';
  if (raw.includes('landing')) return 'landing';
  if (raw.includes('liftoff') || raw.includes('maxq') || raw.includes('max-q') || raw.includes('meco') || raw.includes('stage')) {
    return 'core_ascent';
  }
  return 'unknown';
}

function deriveTrackKindForPhase(phase: TrajectoryMilestonePhase): TrajectoryTrackKind | undefined {
  if (phase === 'core_ascent' || phase === 'upper_stage') return 'core_up';
  if (phase === 'booster_return' || phase === 'landing') return 'booster_down';
  return undefined;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  return null;
}

function normalizeEcef(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  const z = Number(value[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

function normalizeCovariance(raw: unknown): TrajectoryTrackSample['covariance'] | undefined {
  const value = asObject(raw);
  if (!value) return undefined;
  const alongRaw = value.along_track ?? value.alongTrackDeg;
  const crossRaw = value.cross_track ?? value.crossTrackDeg;
  const alongTrackDeg = Number(alongRaw);
  const crossTrackDeg = Number(crossRaw);
  if (!Number.isFinite(alongTrackDeg) || !Number.isFinite(crossTrackDeg)) return undefined;
  return { alongTrackDeg, crossTrackDeg };
}

function normalizeUncertainty(raw: unknown): TrajectoryTrackSample['uncertainty'] | undefined {
  const value = asObject(raw);
  if (!value) return undefined;
  const sigmaRaw = value.sigmaDeg;
  const sigmaDeg = typeof sigmaRaw === 'number' && Number.isFinite(sigmaRaw) ? sigmaRaw : undefined;
  const covariance = normalizeCovariance(value.covariance);
  if (sigmaDeg == null && !covariance) return undefined;
  return { sigmaDeg, covariance };
}

function normalizeSample(raw: unknown): TrajectoryTrackSample | null {
  const sample = asObject(raw);
  if (!sample) return null;
  const tPlusSec = Number(sample.tPlusSec);
  const ecef = normalizeEcef(sample.ecef);
  if (!Number.isFinite(tPlusSec) || tPlusSec < 0 || !ecef) return null;

  const sigmaRaw = sample.sigmaDeg;
  const sigmaDeg = typeof sigmaRaw === 'number' && Number.isFinite(sigmaRaw) ? sigmaRaw : undefined;
  const covariance = normalizeCovariance(sample.covariance) ?? normalizeUncertainty(sample.uncertainty)?.covariance;
  const uncertaintyFromPayload = normalizeUncertainty(sample.uncertainty);
  const uncertainty =
    uncertaintyFromPayload ??
    (sigmaDeg != null || covariance != null ? { sigmaDeg, covariance } : undefined);

  return {
    tPlusSec,
    ecef,
    sigmaDeg,
    covariance,
    uncertainty
  };
}

function normalizeSamples(rawSamples: unknown): TrajectoryTrackSample[] {
  if (!Array.isArray(rawSamples)) return [];
  return rawSamples
    .map((sample) => normalizeSample(sample))
    .filter((sample): sample is TrajectoryTrackSample => sample != null)
    .sort((a, b) => a.tPlusSec - b.tPlusSec);
}

function normalizeSourceRefIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const refs = raw
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
  return Array.from(new Set(refs));
}

function normalizeTracks(product: Record<string, unknown> | null): TrajectoryTrackPayload[] {
  if (!product) return [];

  const rawTracks = product.tracks;
  if (Array.isArray(rawTracks)) {
    const tracks = rawTracks
      .map((rawTrack) => {
        const track = asObject(rawTrack);
        if (!track) return null;
        const samples = normalizeSamples(track.samples);
        if (samples.length === 0) return null;
        return {
          trackKind: normalizeTrackKind(track.trackKind ?? track.track_kind),
          samples
        } satisfies TrajectoryTrackPayload;
      })
      .filter((track): track is TrajectoryTrackPayload => track != null);

    if (tracks.length > 0) return tracks;
  }

  const fallbackSamples = normalizeSamples(product.samples);
  if (fallbackSamples.length === 0) return [];
  return [{ trackKind: 'core_up', samples: fallbackSamples }];
}

function normalizeMilestones(product: Record<string, unknown> | null): TrajectoryMilestonePayload[] {
  if (!product) return [];

  const milestoneSource = Array.isArray(product.milestones) ? product.milestones : product.events;
  if (!Array.isArray(milestoneSource)) return [];

  const milestones: TrajectoryMilestonePayload[] = [];
  for (let index = 0; index < milestoneSource.length; index += 1) {
    const rawMilestone = milestoneSource[index];
    const milestone = asObject(rawMilestone);
    if (!milestone) continue;
    const tPlusSecRaw = Number(milestone.tPlusSec);
    const tPlusSec = Number.isFinite(tPlusSecRaw) ? tPlusSecRaw : null;

    const keyRaw = typeof milestone.key === 'string' ? milestone.key.trim() : '';
    const labelRaw = typeof milestone.label === 'string' ? milestone.label.trim() : '';
    const key = keyRaw || labelRaw || `milestone_${index}`;
    const label = labelRaw || key;
    const phase = normalizeMilestonePhase(milestone.phase) ?? inferLegacyMilestonePhase(key, label);
    const trackKind = milestone.trackKind != null ? normalizeTrackKind(milestone.trackKind) : deriveTrackKindForPhase(phase);
    const sourceType = normalizeMilestoneSourceType(milestone.sourceType) ?? 'family_template';
    const estimated = asBoolean(milestone.estimated) ?? sourceType === 'family_template';
    const baseProjectable = Boolean(trackKind) && tPlusSec != null && phase !== 'prelaunch' && phase !== 'unknown';
    const projectable = asBoolean(milestone.projectable) ?? baseProjectable;
    const projectionReason =
      normalizeMilestoneProjectionReason(milestone.projectionReason) ??
      (!projectable ? (tPlusSec == null ? 'unresolved_time' : phase === 'prelaunch' || phase === 'unknown' ? 'phase_not_projectable' : undefined) : undefined);

    milestones.push({
      key,
      tPlusSec,
      label,
      description: typeof milestone.description === 'string' ? milestone.description.trim() : null,
      timeText: typeof milestone.timeText === 'string' ? milestone.timeText.trim() : null,
      sourceRefIds: normalizeSourceRefIds(milestone.sourceRefIds ?? milestone.source_ref_ids),
      confidence: asMilestoneConfidence(milestone.confidence),
      phase,
      trackKind,
      sourceType,
      estimated,
      projectable,
      projectionReason
    });
  }

  milestones.sort((a, b) => {
    const left = typeof a.tPlusSec === 'number' ? a.tPlusSec : Number.POSITIVE_INFINITY;
    const right = typeof b.tPlusSec === 'number' ? b.tPlusSec : Number.POSITIVE_INFINITY;
    if (left !== right) return left - right;
    return a.label.localeCompare(b.label);
  });

  const seen = new Set<string>();
  return milestones.filter((milestone) => {
    const key = `${milestone.key}:${milestone.tPlusSec ?? 'na'}:${milestone.timeText ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectTrackSigmas(tracks: TrajectoryTrackPayload[]) {
  const values: number[] = [];
  for (const track of tracks) {
    for (const sample of track.samples) {
      const sigma = sample.uncertainty?.sigmaDeg ?? sample.sigmaDeg;
      if (typeof sigma === 'number' && Number.isFinite(sigma) && sigma >= 0) {
        values.push(sigma);
      }
    }
  }
  values.sort((a, b) => a - b);
  return values;
}

function quantile(sortedValues: number[], q: number) {
  if (!sortedValues.length) return null;
  const clampedQ = Math.max(0, Math.min(1, q));
  const idx = Math.floor((sortedValues.length - 1) * clampedQ);
  return sortedValues[idx] ?? null;
}

function deriveUncertaintyEnvelope(tracks: TrajectoryTrackPayload[]): TrajectoryUncertaintyEnvelope {
  const sigmas = collectTrackSigmas(tracks);
  return {
    sampleCount: sigmas.length,
    sigmaDegP50: quantile(sigmas, 0.5),
    sigmaDegP95: quantile(sigmas, 0.95),
    sigmaDegMax: sigmas.length ? sigmas[sigmas.length - 1] : null
  };
}

function deriveQualityState({
  qualityLabel,
  publishPolicyEnforced,
  confidenceTier
}: {
  qualityLabel: string | null;
  publishPolicyEnforced: boolean;
  confidenceTier: TrajectoryConfidenceTier | null;
}): TrajectoryQualityState {
  if (publishPolicyEnforced) return 'pad_only';
  if (qualityLabel === 'landing_constrained') return 'precision';
  if (qualityLabel === 'estimate_corridor') {
    return confidenceTier === 'A' || confidenceTier === 'B' ? 'guided' : 'search';
  }
  return 'pad_only';
}

function derivePublicV2QualityState({
  qualityLabel,
  publishPolicyEnforced
}: {
  qualityLabel: string | null;
  publishPolicyEnforced: boolean;
}): TrajectoryPublicV2QualityState {
  if (publishPolicyEnforced) return 'pad_only';
  if (qualityLabel === 'landing_constrained') return 'precision';
  if (qualityLabel === 'estimate_corridor') return 'safe_corridor';
  return 'pad_only';
}

function deriveSourceBlend(sourceSufficiency: Record<string, unknown> | null) {
  const sourceSummary = asObject(sourceSufficiency?.sourceSummary);
  const signalSummary = asObject(sourceSufficiency?.signalSummary);
  return {
    sourceCode: typeof sourceSummary?.code === 'string' ? sourceSummary.code : null,
    sourceLabel: typeof sourceSummary?.label === 'string' ? sourceSummary.label : null,
    hasLicensedTrajectoryFeed: Boolean(signalSummary?.hasLicensedTrajectoryFeed),
    hasDirectionalConstraint: Boolean(signalSummary?.hasDirectionalConstraint),
    hasLandingDirectional: Boolean(signalSummary?.hasLandingDirectional),
    hasHazardDirectional: Boolean(signalSummary?.hasHazardDirectional),
    hasMissionNumericOrbit: Boolean(signalSummary?.hasMissionNumericOrbit),
    hasSupgpConstraint: Boolean(signalSummary?.hasSupgpConstraint)
  };
}

function deriveAuthorityTier(sourceSufficiency: Record<string, unknown> | null): TrajectoryAuthorityTier {
  const signalSummary = asObject(sourceSufficiency?.signalSummary);
  const sourceSummary = asObject(sourceSufficiency?.sourceSummary);
  if (Boolean(signalSummary?.hasLicensedTrajectoryFeed)) return 'partner_feed';
  if (Boolean(signalSummary?.hasMissionNumericOrbit)) return 'official_numeric';
  if (Boolean(signalSummary?.hasHazardDirectional)) return 'regulatory_constrained';
  if (Boolean(signalSummary?.hasSupgpConstraint)) return 'supplemental_ephemeris';
  if (Boolean(signalSummary?.hasLandingDirectional) || Boolean(signalSummary?.hasPad)) return 'public_metadata';
  if (sourceSummary?.code === 'template_estimate') return 'model_prior';
  return 'model_prior';
}

function deriveFieldProvenance({
  authorityTier,
  sourceBlend,
  product,
  qualityState,
  freshnessState,
  lineageComplete,
  publishPadOnly,
  uncertaintyEnvelope
}: {
  authorityTier: TrajectoryAuthorityTier;
  sourceBlend: ReturnType<typeof deriveSourceBlend>;
  product: Record<string, unknown>;
  qualityState: TrajectoryQualityState;
  freshnessState: TrajectoryFreshnessState | null;
  lineageComplete: boolean;
  publishPadOnly: boolean;
  uncertaintyEnvelope: TrajectoryUncertaintyEnvelope;
}) {
  const milestoneSummary = asObject(product.milestoneSummary);
  const milestoneSourceCounts = asObject(milestoneSummary?.sourceCounts);
  const fromTimeline = Number(milestoneSummary?.fromTimeline);
  const providerTimelineCount = Number(milestoneSourceCounts?.provider_timeline);
  const ll2TimelineCount = Number(milestoneSourceCounts?.ll2_timeline);
  const safeModeActive = qualityState !== 'precision';

  const azimuthAuthorityTier: TrajectoryAuthorityTier = sourceBlend.hasDirectionalConstraint ? authorityTier : 'model_prior';
  const altitudeAuthorityTier: TrajectoryAuthorityTier =
    sourceBlend.hasMissionNumericOrbit || authorityTier === 'partner_feed' || authorityTier === 'supplemental_ephemeris'
      ? authorityTier
      : 'model_prior';
  const milestoneAuthorityTier: TrajectoryAuthorityTier =
    Number.isFinite(fromTimeline) && fromTimeline > 0 ? 'public_metadata' : 'model_prior';
  const uncertaintyAuthorityTier: TrajectoryAuthorityTier =
    sourceBlend.hasDirectionalConstraint || uncertaintyEnvelope.sampleCount > 0 ? authorityTier : 'model_prior';

  return {
    azimuth: deriveTrajectoryFieldAuthorityProfile({
      field: 'azimuth',
      authorityTier: azimuthAuthorityTier,
      summary: authorityTier === 'partner_feed'
        ? 'licensed trajectory feed constrains direction'
        : sourceBlend.hasMissionNumericOrbit
        ? 'mission numerics constrain direction'
        : sourceBlend.hasHazardDirectional
          ? 'regulatory hazard corridor constrains direction'
          : sourceBlend.hasSupgpConstraint
            ? 'supplemental ephemeris informs direction'
            : sourceBlend.hasLandingDirectional
              ? 'landing metadata provides a directional prior'
              : sourceBlend.hasDirectionalConstraint
                ? 'directional constraint available'
                : 'template prior only',
      qualityState,
      freshnessState,
      lineageComplete,
      safeModeActive,
      publishPadOnly,
      hasDirectionalConstraint: sourceBlend.hasDirectionalConstraint,
      hasLandingDirectional: sourceBlend.hasLandingDirectional,
      hasHazardDirectional: sourceBlend.hasHazardDirectional,
      hasMissionNumericOrbit: sourceBlend.hasMissionNumericOrbit,
      hasSupgpConstraint: sourceBlend.hasSupgpConstraint
    }),
    altitude: deriveTrajectoryFieldAuthorityProfile({
      field: 'altitude',
      authorityTier: altitudeAuthorityTier,
      summary: sourceBlend.hasMissionNumericOrbit || authorityTier === 'partner_feed'
        ? 'numeric orbit or feed-backed altitude'
        : authorityTier === 'supplemental_ephemeris'
          ? 'supplemental ephemeris altitude envelope'
          : 'modeled altitude envelope',
      qualityState,
      freshnessState,
      lineageComplete,
      safeModeActive,
      publishPadOnly,
      hasMissionNumericOrbit: sourceBlend.hasMissionNumericOrbit,
      hasSupgpConstraint: sourceBlend.hasSupgpConstraint
    }),
    milestones: deriveTrajectoryFieldAuthorityProfile({
      field: 'milestones',
      authorityTier: milestoneAuthorityTier,
      summary:
        Number.isFinite(providerTimelineCount) && providerTimelineCount > 0
          ? 'provider or press-kit timeline-backed milestones'
          : Number.isFinite(ll2TimelineCount) && ll2TimelineCount > 0
            ? 'LL2 timeline-backed milestone labels'
            : Number.isFinite(fromTimeline) && fromTimeline > 0
              ? 'timeline-backed milestone labels'
              : 'modeled milestone timings',
      qualityState,
      freshnessState,
      lineageComplete,
      safeModeActive,
      publishPadOnly,
      timelineEventCount: Number.isFinite(fromTimeline) ? fromTimeline : 0
    }),
    uncertainty: deriveTrajectoryFieldAuthorityProfile({
      field: 'uncertainty',
      authorityTier: uncertaintyAuthorityTier,
      summary:
        uncertaintyEnvelope.sigmaDegP95 != null
          ? sourceBlend.hasDirectionalConstraint
            ? `constraint-weighted uncertainty envelope (p95 ${formatSigmaLabel(uncertaintyEnvelope.sigmaDegP95)})`
            : `modeled uncertainty envelope (p95 ${formatSigmaLabel(uncertaintyEnvelope.sigmaDegP95)})`
          : sourceBlend.hasDirectionalConstraint
            ? 'constraint-weighted uncertainty envelope'
            : 'model prior uncertainty envelope',
      qualityState,
      freshnessState,
      lineageComplete,
      safeModeActive,
      publishPadOnly,
      hasDirectionalConstraint: sourceBlend.hasDirectionalConstraint,
      uncertaintySampleCount: uncertaintyEnvelope.sampleCount,
      sigmaDegP95: uncertaintyEnvelope.sigmaDegP95
    })
  };
}

function deriveRuntimeHints({
  qualityState,
  tracks,
  milestones
}: {
  qualityState: TrajectoryQualityState;
  tracks: TrajectoryTrackPayload[];
  milestones: TrajectoryMilestonePayload[];
}) {
  return {
    defaultOverlayMode: qualityState === 'precision' ? 'precision' : qualityState === 'guided' ? 'guided' : 'search',
    trackCount: tracks.length,
    milestoneCount: milestones.length,
    prefersWideSearch: qualityState === 'search' || qualityState === 'pad_only',
    hasBoosterTrack: tracks.some((track) => track.trackKind === 'booster_down')
  } satisfies TrajectoryContract['runtimeHints'];
}

function deriveConfidenceReasons({
  publishReasons,
  sourceSufficiency
}: {
  publishReasons: string[];
  sourceSufficiency: Record<string, unknown> | null;
}) {
  const missingFieldsRaw = Array.isArray(sourceSufficiency?.missingFields) ? sourceSufficiency.missingFields : [];
  const missingFields = missingFieldsRaw
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
  const blockingRaw = Array.isArray(sourceSufficiency?.blockingReasons) ? sourceSufficiency.blockingReasons : [];
  const blockingReasons = blockingRaw
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
  return Array.from(new Set([...publishReasons, ...missingFields, ...blockingReasons]));
}

export function buildTrajectoryContract(row: TrajectoryContractRow | null): TrajectoryContract | null {
  if (!row) return null;

  const product = asObject(row.product);
  const sourceSufficiency = asObject(row.source_sufficiency);
  const lineageComplete = typeof row.lineage_complete === 'boolean' ? row.lineage_complete : null;
  const publishPolicy = deriveTrajectoryPublishPolicy({
    quality: row.quality,
    qualityLabel: product?.qualityLabel,
    sourceSufficiency,
    freshnessState: row.freshness_state,
    lineageComplete
  });
  const effectiveProduct =
    applyTrajectoryPublishPolicyToProduct(product, publishPolicy) ??
    ({
      qualityLabel: 'pad_only',
      assumptions: ['Trajectory product unavailable'],
      samples: [],
      events: []
    } as Record<string, unknown>);
  const effectiveSourceSufficiency =
    sourceSufficiency && publishPolicy.enforcePadOnly
      ? {
          ...sourceSufficiency,
          sourceSummary: { code: 'pad_only' },
          publishPolicy: {
            enforcePadOnly: true,
            reasons: publishPolicy.reasons
          }
        }
      : sourceSufficiency;
  const effectiveLineageComplete = publishPolicy.enforcePadOnly ? false : Boolean(lineageComplete);
  const effectiveQuality = publishPolicy.enforcePadOnly ? 0 : row.quality;
  const effectiveConfidenceTier = publishPolicy.enforcePadOnly ? 'D' : asConfidenceTier(row.confidence_tier);
  const effectiveFreshnessState = publishPolicy.enforcePadOnly ? 'unknown' : asFreshnessState(row.freshness_state);
  const tracks = normalizeTracks(effectiveProduct);
  const milestones = normalizeMilestones(effectiveProduct);
  const uncertaintyEnvelope = deriveUncertaintyEnvelope(tracks);
  const qualityState = deriveQualityState({
    qualityLabel: typeof effectiveProduct.qualityLabel === 'string' ? effectiveProduct.qualityLabel : null,
    publishPolicyEnforced: publishPolicy.enforcePadOnly,
    confidenceTier: effectiveConfidenceTier
  });
  const evidence = deriveTrajectoryEvidenceView({
    confidenceTier: effectiveConfidenceTier,
    sourceSufficiency: effectiveSourceSufficiency,
    lineageComplete: effectiveLineageComplete,
    qualityLabel: effectiveProduct.qualityLabel
  });
  const sourceBlend = deriveSourceBlend(effectiveSourceSufficiency);
  const authorityTier = deriveAuthorityTier(effectiveSourceSufficiency);
  const confidenceReasons = deriveConfidenceReasons({
    publishReasons: publishPolicy.reasons,
    sourceSufficiency: effectiveSourceSufficiency
  });
  const sourceFreshness =
    effectiveSourceSufficiency?.sourceFreshness &&
    typeof effectiveSourceSufficiency.sourceFreshness === 'object' &&
    !Array.isArray(effectiveSourceSufficiency.sourceFreshness)
      ? (effectiveSourceSufficiency.sourceFreshness as Record<string, unknown>)
      : null;
  const evidenceEpoch =
    typeof sourceFreshness?.latestSignalAt === 'string' && sourceFreshness.latestSignalAt.trim().length > 0
      ? sourceFreshness.latestSignalAt
      : row.generated_at;

  return {
    launchId: row.launch_id,
    version: row.version,
    modelVersion: typeof effectiveProduct.version === 'string' ? effectiveProduct.version : row.version,
    quality: effectiveQuality,
    qualityState,
    authorityTier,
    fieldProvenance: deriveFieldProvenance({
      authorityTier,
      sourceBlend,
      product: effectiveProduct,
      qualityState,
      freshnessState: effectiveFreshnessState,
      lineageComplete: effectiveLineageComplete,
      publishPadOnly: publishPolicy.enforcePadOnly,
      uncertaintyEnvelope
    }),
    runtimeHints: deriveRuntimeHints({ qualityState, tracks, milestones }),
    uncertaintyEnvelope,
    sourceBlend,
    confidenceReasons,
    safeModeActive: qualityState !== 'precision',
    generatedAt: row.generated_at,
    evidenceEpoch,
    confidenceTier: effectiveConfidenceTier,
    sourceSufficiency: effectiveSourceSufficiency,
    freshnessState: effectiveFreshnessState,
    lineageComplete: effectiveLineageComplete,
    publishPolicy,
    confidenceBadge: evidence.confidenceBadge,
    confidenceBadgeLabel: evidence.confidenceBadgeLabel,
    evidenceLabel: evidence.evidenceLabel,
    tracks,
    milestones,
    product: effectiveProduct
  };
}

export function buildTrajectoryPublicV2Response(row: TrajectoryContractRow | null): TrajectoryPublicV2Response | null {
  if (!row) return null;

  const product = asObject(row.product);
  const sourceSufficiency = asObject(row.source_sufficiency);
  const lineageComplete = typeof row.lineage_complete === 'boolean' ? row.lineage_complete : null;
  const publishPolicy = deriveTrajectoryPublishPolicy({
    quality: row.quality,
    qualityLabel: product?.qualityLabel,
    sourceSufficiency,
    freshnessState: row.freshness_state,
    lineageComplete
  });
  const effectiveProduct = applyTrajectoryPublishPolicyToProduct(product, publishPolicy);
  const effectiveSourceSufficiency =
    sourceSufficiency && publishPolicy.enforcePadOnly
      ? {
          ...sourceSufficiency,
          sourceSummary: { code: 'pad_only' },
          publishPolicy: {
            enforcePadOnly: true,
            reasons: publishPolicy.reasons
          }
        }
      : sourceSufficiency;
  const tracks = normalizeTracks(effectiveProduct);
  const milestones = normalizeMilestones(effectiveProduct);
  const effectiveLineageComplete = publishPolicy.enforcePadOnly ? false : Boolean(lineageComplete);
  const effectiveQuality = publishPolicy.enforcePadOnly ? 0 : row.quality;
  const effectiveConfidenceTier = publishPolicy.enforcePadOnly ? 'D' : asConfidenceTier(row.confidence_tier);
  const effectiveFreshnessState = publishPolicy.enforcePadOnly ? 'unknown' : asFreshnessState(row.freshness_state);
  const evidence = deriveTrajectoryEvidenceView({
    confidenceTier: effectiveConfidenceTier,
    sourceSufficiency: effectiveSourceSufficiency,
    lineageComplete: effectiveLineageComplete,
    qualityLabel: effectiveProduct?.qualityLabel
  });
  const uncertaintyEnvelope = deriveUncertaintyEnvelope(tracks);
  const qualityState = derivePublicV2QualityState({
    qualityLabel: typeof effectiveProduct?.qualityLabel === 'string' ? effectiveProduct.qualityLabel : null,
    publishPolicyEnforced: publishPolicy.enforcePadOnly
  });
  const sourceBlend = deriveSourceBlend(effectiveSourceSufficiency);
  const confidenceReasons = deriveConfidenceReasons({
    publishReasons: publishPolicy.reasons,
    sourceSufficiency: effectiveSourceSufficiency
  });

  return {
    launchId: row.launch_id,
    version: row.version,
    modelVersion: typeof effectiveProduct?.version === 'string' ? effectiveProduct.version : row.version,
    quality: effectiveQuality,
    qualityState,
    uncertaintyEnvelope,
    sourceBlend: {
      sourceCode: sourceBlend.sourceCode,
      sourceLabel: sourceBlend.sourceLabel,
      hasDirectionalConstraint: sourceBlend.hasDirectionalConstraint,
      hasLandingDirectional: sourceBlend.hasLandingDirectional,
      hasHazardDirectional: sourceBlend.hasHazardDirectional,
      hasMissionNumericOrbit: sourceBlend.hasMissionNumericOrbit,
      hasSupgpConstraint: sourceBlend.hasSupgpConstraint
    },
    confidenceReasons,
    safeModeActive: qualityState !== 'precision',
    generatedAt: row.generated_at,
    confidenceTier: effectiveConfidenceTier,
    sourceSufficiency: effectiveSourceSufficiency,
    freshnessState: effectiveFreshnessState,
    lineageComplete: effectiveLineageComplete,
    publishPolicy,
    confidenceBadge: evidence.confidenceBadge,
    evidenceLabel: evidence.evidenceLabel,
    tracks,
    milestones,
    product: effectiveProduct
  };
}

function formatSigmaLabel(value: number) {
  if (!Number.isFinite(value)) return 'n/a';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toFixed(1).replace(/\.0$/, '')} deg`;
}
