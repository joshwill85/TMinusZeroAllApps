export type SurfaceEvidenceSurface = 'web' | 'ios' | 'android';
export type SurfaceEvidenceStatus = 'pass' | 'warn' | 'fail';

export type SurfaceEvidenceRun = {
  surface: SurfaceEvidenceSurface;
  profile: string;
  status: SurfaceEvidenceStatus;
  sessionId?: string;
  runtimeFamily?: string | null;
  clientProfile?: string | null;
  clientEnv?: string | null;
  timeToUsableSeconds?: number | null;
  canClaimPrecision?: boolean | null;
  precisionClaimAllowed?: boolean | null;
  relocalizationCount?: number | null;
  trackingResetCount?: number | null;
  notes?: string | null;
};

export type SurfaceEvidenceComparison = {
  fixtureId: string;
  observerId: string;
  tPlusSec: number;
  divergenceDeg: number;
  degraded?: boolean;
};

export type SurfaceEvidenceManifest = {
  generatedAt: string;
  runs: SurfaceEvidenceRun[];
  comparisons?: SurfaceEvidenceComparison[];
};

export type SurfaceEvidenceSessionRow = {
  id: string | null;
  created_at?: string | null;
  runtime_family: string | null;
  client_profile?: string | null;
  client_env?: string | null;
  release_profile?: string | null;
  location_permission?: string | null;
  location_accuracy?: string | null;
  location_fix_state?: string | null;
  alignment_ready?: boolean | null;
  heading_status?: string | null;
  pose_mode?: string | null;
  overlay_mode?: string | null;
  trajectory_quality_state?: string | null;
  time_to_usable_ms?: number | null;
  time_to_lock_bucket?: string | null;
  tracking_state?: string | null;
  world_alignment?: string | null;
  geo_tracking_state?: string | null;
  fallback_reason?: string | null;
  mode_entered?: string | null;
  relocalization_count?: number | null;
  loop_restart_count?: number | null;
};

export type SurfaceEvidenceRunOverrides = {
  status?: SurfaceEvidenceStatus;
  timeToUsableSeconds?: number | null;
  canClaimPrecision?: boolean | null;
  precisionClaimAllowed?: boolean | null;
  relocalizationCount?: number | null;
  trackingResetCount?: number | null;
  notes?: string | null;
};

export type SurfaceEvidenceInputRun = {
  surface: SurfaceEvidenceSurface;
  profile?: string;
  releaseProfile?: string;
  sessionId?: string;
  overrides?: SurfaceEvidenceRunOverrides;
};

export type SurfaceEvidenceInputSource = { type: 'file'; path: string } | { type: 'supabase' };

export type SurfaceEvidenceInputSpec = {
  generatedAt?: string;
  source: SurfaceEvidenceInputSource;
  runs: SurfaceEvidenceInputRun[];
  comparisons?: SurfaceEvidenceComparison[];
};

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isHeadingReady(status: string | null | undefined) {
  return status === 'ok' || status === 'noisy';
}

export function surfaceFromRuntimeFamily(runtimeFamily: string | null | undefined): SurfaceEvidenceSurface | null {
  if (runtimeFamily === 'web') return 'web';
  if (runtimeFamily === 'ios_native') return 'ios';
  if (runtimeFamily === 'android_native') return 'android';
  return null;
}

export function timeToUsableSecondsFromBucket(value: string | null | undefined): number | null {
  switch (value) {
    case '<2s':
      return 2;
    case '2..5s':
      return 5;
    case '5..10s':
      return 10;
    case '10..20s':
      return 20;
    case '20..60s':
      return 60;
    case '60s+':
      return 61;
    default:
      return null;
  }
}

export function deriveSurfaceEvidencePrecisionClaim(row: SurfaceEvidenceSessionRow) {
  return row.overlay_mode === 'precision' || row.trajectory_quality_state === 'precision';
}

export function deriveSurfaceEvidencePrecisionAllowance(surface: SurfaceEvidenceSurface, row: SurfaceEvidenceSessionRow) {
  const headingReady = isHeadingReady(row.heading_status);
  if (surface === 'web') {
    if (row.mode_entered !== 'ar') return false;
    if (row.fallback_reason) return false;
    if (!headingReady) return false;
    return row.pose_mode === 'webxr' || row.pose_mode === 'sensor_fused';
  }

  if (surface === 'ios') {
    if (row.tracking_state !== 'normal') return false;
    if (!headingReady) return false;
    if (row.pose_mode !== 'arkit_world_tracking') return false;
    if (row.location_fix_state !== 'ready') return false;
    if (row.alignment_ready !== true) return false;
    if (row.world_alignment && row.world_alignment !== 'gravity_and_heading' && row.world_alignment !== 'camera') return false;
    if (row.geo_tracking_state === 'initializing') return false;
    return true;
  }

  if (row.tracking_state !== 'normal') return false;
  if (!headingReady) return false;
  if (row.fallback_reason) return false;
  return row.pose_mode === 'sensor_fused' || row.pose_mode === 'arkit_world_tracking';
}

export function deriveSurfaceEvidenceStatus(
  surface: SurfaceEvidenceSurface,
  row: SurfaceEvidenceSessionRow,
  canClaimPrecision: boolean,
  precisionClaimAllowed: boolean
): SurfaceEvidenceStatus {
  const runtimeSurface = surfaceFromRuntimeFamily(row.runtime_family);
  if (runtimeSurface && runtimeSurface !== surface) return 'fail';
  if (canClaimPrecision && !precisionClaimAllowed) return 'fail';
  if (row.fallback_reason || row.mode_entered === 'sky_compass') return 'warn';
  if (surface !== 'web' && row.tracking_state && row.tracking_state !== 'normal') return 'warn';
  return 'pass';
}

export function buildSurfaceEvidenceRun(
  input: SurfaceEvidenceInputRun,
  row: SurfaceEvidenceSessionRow
): SurfaceEvidenceRun {
  const derivedTimeToUsableSeconds =
    isNumber(row.time_to_usable_ms) ? Number((row.time_to_usable_ms / 1000).toFixed(3)) : timeToUsableSecondsFromBucket(row.time_to_lock_bucket);
  const derivedCanClaimPrecision = deriveSurfaceEvidencePrecisionClaim(row);
  const derivedPrecisionClaimAllowed = deriveSurfaceEvidencePrecisionAllowance(input.surface, row);
  const derivedRelocalizationCount = isNumber(row.relocalization_count) ? row.relocalization_count : null;
  const derivedTrackingResetCount = input.surface === 'android' && isNumber(row.loop_restart_count) ? row.loop_restart_count : null;
  const resolvedProfile = input.profile ?? input.releaseProfile ?? row.release_profile ?? input.sessionId ?? 'unknown';

  const timeToUsableSeconds = input.overrides?.timeToUsableSeconds ?? derivedTimeToUsableSeconds;
  const canClaimPrecision = input.overrides?.canClaimPrecision ?? derivedCanClaimPrecision;
  const precisionClaimAllowed = input.overrides?.precisionClaimAllowed ?? derivedPrecisionClaimAllowed;
  const relocalizationCount = input.overrides?.relocalizationCount ?? derivedRelocalizationCount;
  const trackingResetCount = input.overrides?.trackingResetCount ?? derivedTrackingResetCount;
  const status =
    input.overrides?.status ?? deriveSurfaceEvidenceStatus(input.surface, row, Boolean(canClaimPrecision), Boolean(precisionClaimAllowed));

  return {
    surface: input.surface,
    profile: resolvedProfile,
    status,
    sessionId: row.id ?? input.sessionId,
    runtimeFamily: row.runtime_family ?? null,
    clientProfile: row.client_profile ?? null,
    clientEnv: row.client_env ?? null,
    timeToUsableSeconds,
    canClaimPrecision,
    precisionClaimAllowed,
    relocalizationCount,
    trackingResetCount,
    notes: input.overrides?.notes ?? null
  };
}

function parseCreatedAtMs(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function resolveRunRow(input: SurfaceEvidenceInputRun, rows: SurfaceEvidenceSessionRow[]) {
  if (input.sessionId) {
    return rows.find((row) => row.id === input.sessionId) ?? null;
  }

  const releaseProfile = input.releaseProfile ?? input.profile;
  if (!releaseProfile) return null;

  return rows
    .filter((row) => row.release_profile === releaseProfile)
    .sort((a, b) => parseCreatedAtMs(b.created_at) - parseCreatedAtMs(a.created_at))[0] ?? null;
}

export function buildSurfaceEvidenceManifest(spec: SurfaceEvidenceInputSpec, rows: SurfaceEvidenceSessionRow[]): SurfaceEvidenceManifest {
  const runs = spec.runs.map((input) => {
    const row = resolveRunRow(input, rows);
    if (!row) {
      const matchLabel = input.sessionId ? `${input.sessionId}` : input.releaseProfile ?? input.profile ?? 'unknown';
      throw new Error(`Missing telemetry session row for ${matchLabel}.`);
    }
    return buildSurfaceEvidenceRun(input, row);
  });

  return {
    generatedAt: spec.generatedAt ?? new Date().toISOString(),
    runs,
    comparisons: spec.comparisons ?? []
  };
}
