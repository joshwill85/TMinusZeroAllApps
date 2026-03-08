import {
  AR_CLIENT_PROFILE_RELEASE_TARGETS,
  getArClientProfilePolicy,
  type ArClientProfile
} from '@/lib/ar/clientProfile';
import type { ArRuntimePoseMode } from '@/lib/ar/runtimeSelector';

export type ArRuntimePolicyTelemetryRow = {
  client_profile: string | null;
  client_env: string | null;
  screen_bucket: string | null;
  pose_mode: string | null;
  xr_supported: boolean | null;
  xr_used: boolean | null;
  xr_error_bucket: string | null;
  fallback_reason: string | null;
  mode_entered: string | null;
  time_to_lock_bucket: string | null;
  lock_on_attempted: boolean | null;
  lock_on_acquired: boolean | null;
  lock_loss_count: number | null;
  vision_backend: string | null;
  runtime_degradation_tier: number | null;
  loop_restart_count: number | null;
  render_tier: string | null;
  dropped_frame_bucket: string | null;
};

export type ArRuntimePolicyRecommendationConfidence = 'low' | 'medium' | 'high';

export type ArRuntimePolicyProfileSummary = {
  profile: ArClientProfile;
  defaultPoseMode: ArRuntimePoseMode;
  recommendedPoseMode: ArRuntimePoseMode | null;
  applyInRuntime: boolean;
  confidence: ArRuntimePolicyRecommendationConfidence;
  fieldReady: boolean;
  sampleCount: number;
  arEnteredSessions: number;
  fallbackSessions: number;
  xrEligibleSessions: number;
  xrUsedSessions: number;
  xrHealthySessions: number;
  smoothSessions: number;
  lowDegradationSessions: number;
  restartFreeArSessions: number;
  lockAttemptedSessions: number;
  lockAcquiredSessions: number;
  lockUsefulSessions: number;
  fastLockSessions: number;
  supportGroupCount: number;
  qualifiedSupportGroupCount: number;
  xrQualifiedSupportGroupCount: number;
  supportGroups: Array<{
    key: string;
    clientEnv: string | null;
    screenBucket: string | null;
    sampleCount: number;
    xrUsedSessions: number;
    xrHealthySessions: number;
    smoothSessions: number;
    lockUsefulSessions: number;
  }>;
  metrics: {
    arEntryRate: number | null;
    fallbackRate: number | null;
    xrHealthyRate: number | null;
    smoothSessionRate: number | null;
    lowDegradationRate: number | null;
    restartFreeArRate: number | null;
    lockAcquireRate: number | null;
    lockUsefulRate: number | null;
    fastLockRate: number | null;
  };
  reasons: string[];
};

export type ArRuntimePolicySummary = {
  sampledSessions: number;
  sampleLimit: number;
  truncated: boolean;
  profiles: ArRuntimePolicyProfileSummary[];
  overrides: Array<{
    profile: ArClientProfile;
    poseMode: ArRuntimePoseMode;
    confidence: ArRuntimePolicyRecommendationConfidence;
    reasons: string[];
  }>;
};

type RuntimePolicyCounters = {
  sampleCount: number;
  arEnteredSessions: number;
  fallbackSessions: number;
  xrEligibleSessions: number;
  xrUsedSessions: number;
  xrHealthySessions: number;
  smoothSessions: number;
  lowDegradationSessions: number;
  restartFreeArSessions: number;
  lockAttemptedSessions: number;
  lockAcquiredSessions: number;
  lockUsefulSessions: number;
  fastLockSessions: number;
};

type SupportGroupSummary = {
  key: string;
  clientEnv: string | null;
  screenBucket: string | null;
  sampleCount: number;
  xrUsedSessions: number;
  xrHealthySessions: number;
  smoothSessions: number;
  lockUsefulSessions: number;
};

function asClientProfile(value: string | null): ArClientProfile | null {
  if (!value) return null;
  return AR_CLIENT_PROFILE_RELEASE_TARGETS.includes(value as ArClientProfile) ? (value as ArClientProfile) : null;
}

function safeRate(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function isSmoothDroppedFrameBucket(bucket: string | null) {
  return bucket === '0..1' || bucket === '1..5' || bucket === '5..15';
}

function isSmoothSession(row: ArRuntimePolicyTelemetryRow) {
  if (row.render_tier === 'high' || row.render_tier === 'medium') return true;
  return isSmoothDroppedFrameBucket(row.dropped_frame_bucket);
}

function isLowDegradationSession(row: ArRuntimePolicyTelemetryRow) {
  if (typeof row.runtime_degradation_tier === 'number' && Number.isFinite(row.runtime_degradation_tier)) {
    return row.runtime_degradation_tier <= 1;
  }
  return isSmoothSession(row);
}

function didUseXr(row: ArRuntimePolicyTelemetryRow) {
  return row.xr_used === true;
}

function isHealthyXrSession(row: ArRuntimePolicyTelemetryRow) {
  if (!didUseXr(row)) return false;
  if (row.xr_error_bucket) return false;
  if (row.mode_entered !== 'ar') return false;
  if (row.fallback_reason) return false;
  if (!isSmoothSession(row)) return false;
  if (!isLowDegradationSession(row)) return false;
  if (typeof row.loop_restart_count === 'number' && Number.isFinite(row.loop_restart_count) && row.loop_restart_count > 1) return false;
  return true;
}

function isFastLockBucket(value: string | null) {
  return value === '<2s' || value === '2..5s';
}

function isRestartFreeArSession(row: ArRuntimePolicyTelemetryRow) {
  if (row.mode_entered !== 'ar') return false;
  if (typeof row.loop_restart_count !== 'number' || !Number.isFinite(row.loop_restart_count)) return true;
  return row.loop_restart_count <= 0;
}

function supportGroupKey(row: ArRuntimePolicyTelemetryRow) {
  return `${row.client_env ?? 'unknown'}|${row.screen_bucket ?? 'unknown'}`;
}

function emptyCounters(): RuntimePolicyCounters {
  return {
    sampleCount: 0,
    arEnteredSessions: 0,
    fallbackSessions: 0,
    xrEligibleSessions: 0,
    xrUsedSessions: 0,
    xrHealthySessions: 0,
    smoothSessions: 0,
    lowDegradationSessions: 0,
    restartFreeArSessions: 0,
    lockAttemptedSessions: 0,
    lockAcquiredSessions: 0,
    lockUsefulSessions: 0,
    fastLockSessions: 0
  };
}

function summarizeRows(rows: ArRuntimePolicyTelemetryRow[]) {
  const counters = emptyCounters();
  const supportGroups = new Map<string, SupportGroupSummary>();
  for (const row of rows) {
    counters.sampleCount += 1;
    if (row.mode_entered === 'ar') counters.arEnteredSessions += 1;
    if (row.fallback_reason || row.mode_entered === 'sky_compass') counters.fallbackSessions += 1;
    if (row.xr_supported === true) counters.xrEligibleSessions += 1;
    if (didUseXr(row)) counters.xrUsedSessions += 1;
    if (isHealthyXrSession(row)) counters.xrHealthySessions += 1;
    if (isSmoothSession(row)) counters.smoothSessions += 1;
    if (isLowDegradationSession(row)) counters.lowDegradationSessions += 1;
    if (isRestartFreeArSession(row)) counters.restartFreeArSessions += 1;

    const attempted = row.lock_on_attempted === true;
    const acquired = attempted && row.lock_on_acquired === true;
    if (attempted) counters.lockAttemptedSessions += 1;
    if (acquired) {
      counters.lockAcquiredSessions += 1;
      if (isFastLockBucket(row.time_to_lock_bucket)) counters.fastLockSessions += 1;
      if (typeof row.lock_loss_count !== 'number' || !Number.isFinite(row.lock_loss_count) || row.lock_loss_count <= 1) {
        counters.lockUsefulSessions += 1;
      }
    }

    const key = supportGroupKey(row);
    const supportGroup =
      supportGroups.get(key) ??
      ({
        key,
        clientEnv: row.client_env ?? null,
        screenBucket: row.screen_bucket ?? null,
        sampleCount: 0,
        xrUsedSessions: 0,
        xrHealthySessions: 0,
        smoothSessions: 0,
        lockUsefulSessions: 0
      } satisfies SupportGroupSummary);
    supportGroup.sampleCount += 1;
    if (didUseXr(row)) supportGroup.xrUsedSessions += 1;
    if (isHealthyXrSession(row)) supportGroup.xrHealthySessions += 1;
    if (isSmoothSession(row)) supportGroup.smoothSessions += 1;
    if (attempted && acquired && (typeof row.lock_loss_count !== 'number' || !Number.isFinite(row.lock_loss_count) || row.lock_loss_count <= 1)) {
      supportGroup.lockUsefulSessions += 1;
    }
    supportGroups.set(key, supportGroup);
  }
  return {
    counters,
    supportGroups: Array.from(supportGroups.values()).sort((a, b) => b.sampleCount - a.sampleCount)
  };
}

function hasQualifiedFieldCoverage(profile: ArClientProfile, counters: RuntimePolicyCounters, supportGroups: SupportGroupSummary[]) {
  const qualifiedSupportGroupCount = supportGroups.filter((group) => group.sampleCount >= 6).length;
  const xrQualifiedSupportGroupCount = supportGroups.filter((group) => group.xrUsedSessions >= 4).length;
  if (profile === 'android_chrome') {
    return qualifiedSupportGroupCount >= 2 && xrQualifiedSupportGroupCount >= 1 && counters.sampleCount >= 24;
  }
  if (profile === 'android_samsung_internet') {
    return qualifiedSupportGroupCount >= 2 && xrQualifiedSupportGroupCount >= 2 && counters.arEnteredSessions >= 24;
  }
  return qualifiedSupportGroupCount >= 1;
}

function recommendProfilePolicy(
  profile: ArClientProfile,
  counters: RuntimePolicyCounters,
  supportGroups: SupportGroupSummary[]
): ArRuntimePolicyProfileSummary {
  const policy = getArClientProfilePolicy(profile);
  const defaultPoseMode: ArRuntimePoseMode = policy.preferWebXr ? 'webxr' : 'sensor_fused';
  const qualifiedSupportGroupCount = supportGroups.filter((group) => group.sampleCount >= 6).length;
  const xrQualifiedSupportGroupCount = supportGroups.filter((group) => group.xrUsedSessions >= 4).length;
  const fieldReady = hasQualifiedFieldCoverage(profile, counters, supportGroups);
  const metrics = {
    arEntryRate: safeRate(counters.arEnteredSessions, counters.sampleCount),
    fallbackRate: safeRate(counters.fallbackSessions, counters.sampleCount),
    xrHealthyRate: safeRate(counters.xrHealthySessions, counters.xrUsedSessions),
    smoothSessionRate: safeRate(counters.smoothSessions, counters.sampleCount),
    lowDegradationRate: safeRate(counters.lowDegradationSessions, counters.sampleCount),
    restartFreeArRate: safeRate(counters.restartFreeArSessions, counters.arEnteredSessions),
    lockAcquireRate: safeRate(counters.lockAcquiredSessions, counters.lockAttemptedSessions),
    lockUsefulRate: safeRate(counters.lockUsefulSessions, counters.lockAttemptedSessions),
    fastLockRate: safeRate(counters.fastLockSessions, counters.lockAttemptedSessions)
  };

  const reasons: string[] = [];
  let recommendedPoseMode: ArRuntimePoseMode | null = null;
  let confidence: ArRuntimePolicyRecommendationConfidence = 'low';

  if (profile === 'ios_webkit' || profile === 'android_fallback') {
    reasons.push('sensor path remains primary for this profile');
    return {
      profile,
      defaultPoseMode,
      recommendedPoseMode,
      applyInRuntime: false,
      confidence,
      fieldReady,
      ...counters,
      supportGroupCount: supportGroups.length,
      qualifiedSupportGroupCount,
      xrQualifiedSupportGroupCount,
      supportGroups: supportGroups.slice(0, 4),
      metrics,
      reasons
    };
  }

  if (profile === 'android_chrome') {
    if (counters.sampleCount < 24 || counters.xrUsedSessions < 10 || counters.lockAttemptedSessions < 8) {
      reasons.push('insufficient XR telemetry to override default');
      return {
        profile,
        defaultPoseMode,
        recommendedPoseMode,
        applyInRuntime: false,
        confidence,
        fieldReady,
        ...counters,
        supportGroupCount: supportGroups.length,
        qualifiedSupportGroupCount,
        xrQualifiedSupportGroupCount,
        supportGroups: supportGroups.slice(0, 4),
        metrics,
        reasons
      };
    }

    const xrHealthyRate = metrics.xrHealthyRate ?? 0;
    const fallbackRate = metrics.fallbackRate ?? 1;
    const smoothRate = metrics.smoothSessionRate ?? 0;
    const lockUsefulRate = metrics.lockUsefulRate ?? 0;
    const lowDegradationRate = metrics.lowDegradationRate ?? 0;
    const restartFreeArRate = metrics.restartFreeArRate ?? 0;

    if (fieldReady && xrHealthyRate >= 0.84 && fallbackRate <= 0.22 && smoothRate >= 0.68 && lockUsefulRate >= 0.45 && lowDegradationRate >= 0.62 && restartFreeArRate >= 0.78) {
      confidence = counters.sampleCount >= 36 && counters.xrUsedSessions >= 16 ? 'high' : 'medium';
      reasons.push('XR sessions are healthy across enough field support groups');
      return {
        profile,
        defaultPoseMode,
        recommendedPoseMode,
        applyInRuntime: false,
        confidence,
        fieldReady,
        ...counters,
        supportGroupCount: supportGroups.length,
        qualifiedSupportGroupCount,
        xrQualifiedSupportGroupCount,
        supportGroups: supportGroups.slice(0, 4),
        metrics,
        reasons
      };
    }

    const catastrophicXr =
      xrHealthyRate <= 0.55 || fallbackRate >= 0.45 || smoothRate <= 0.45 || lowDegradationRate <= 0.45;
    if (xrHealthyRate <= 0.68 || fallbackRate >= 0.35 || smoothRate <= 0.5 || lowDegradationRate <= 0.55 || restartFreeArRate <= 0.72) {
      recommendedPoseMode = 'sensor_fused';
      confidence =
        fieldReady && counters.sampleCount >= 36 && counters.xrUsedSessions >= 16
          ? 'high'
          : catastrophicXr
            ? 'medium'
            : 'low';
      reasons.push('XR sessions are failing field health or stability thresholds');
      if (!fieldReady) reasons.push('support-group coverage is still narrow, so demotion confidence is capped');
      return {
        profile,
        defaultPoseMode,
        recommendedPoseMode,
        applyInRuntime: fieldReady || catastrophicXr,
        confidence,
        fieldReady,
        ...counters,
        supportGroupCount: supportGroups.length,
        qualifiedSupportGroupCount,
        xrQualifiedSupportGroupCount,
        supportGroups: supportGroups.slice(0, 4),
        metrics,
        reasons
      };
    }

    reasons.push(fieldReady ? 'XR telemetry is mixed; keep default until more evidence lands' : 'support-group coverage is not broad enough yet');
    return {
      profile,
      defaultPoseMode,
      recommendedPoseMode,
      applyInRuntime: false,
      confidence: 'medium',
      fieldReady,
      ...counters,
      supportGroupCount: supportGroups.length,
      qualifiedSupportGroupCount,
      xrQualifiedSupportGroupCount,
      supportGroups: supportGroups.slice(0, 4),
      metrics,
      reasons
    };
  }

  if (profile === 'android_samsung_internet') {
    if (counters.sampleCount < 40 || counters.xrUsedSessions < 16 || counters.lockAttemptedSessions < 12) {
      reasons.push('insufficient Samsung XR telemetry to promote WebXR');
      return {
        profile,
        defaultPoseMode,
        recommendedPoseMode,
        applyInRuntime: false,
        confidence,
        fieldReady,
        ...counters,
        supportGroupCount: supportGroups.length,
        qualifiedSupportGroupCount,
        xrQualifiedSupportGroupCount,
        supportGroups: supportGroups.slice(0, 4),
        metrics,
        reasons
      };
    }

    const xrHealthyRate = metrics.xrHealthyRate ?? 0;
    const fallbackRate = metrics.fallbackRate ?? 1;
    const smoothRate = metrics.smoothSessionRate ?? 0;
    const lockUsefulRate = metrics.lockUsefulRate ?? 0;
    const lowDegradationRate = metrics.lowDegradationRate ?? 0;
    const fastLockRate = metrics.fastLockRate ?? 0;
    const restartFreeArRate = metrics.restartFreeArRate ?? 0;

    if (fieldReady && xrHealthyRate >= 0.9 && fallbackRate <= 0.15 && smoothRate >= 0.78 && lockUsefulRate >= 0.55 && lowDegradationRate >= 0.72 && fastLockRate >= 0.45 && restartFreeArRate >= 0.82) {
      recommendedPoseMode = 'webxr';
      confidence =
        counters.sampleCount >= 60 && counters.xrUsedSessions >= 24 && xrQualifiedSupportGroupCount >= 3 ? 'high' : 'medium';
      reasons.push('Samsung XR sessions exceed promotion thresholds across field support groups');
      return {
        profile,
        defaultPoseMode,
        recommendedPoseMode,
        applyInRuntime: confidence === 'high',
        confidence,
        fieldReady,
        ...counters,
        supportGroupCount: supportGroups.length,
        qualifiedSupportGroupCount,
        xrQualifiedSupportGroupCount,
        supportGroups: supportGroups.slice(0, 4),
        metrics,
        reasons
      };
    }

    reasons.push(
      fieldReady
        ? 'Samsung stays sensor-first until XR telemetry clears promotion thresholds'
        : 'Samsung stays sensor-first until support-group coverage is broad enough'
    );
    return {
      profile,
      defaultPoseMode,
      recommendedPoseMode,
      applyInRuntime: false,
      confidence: 'medium',
      fieldReady,
      ...counters,
      supportGroupCount: supportGroups.length,
      qualifiedSupportGroupCount,
      xrQualifiedSupportGroupCount,
      supportGroups: supportGroups.slice(0, 4),
      metrics,
      reasons
    };
  }

  reasons.push('no telemetry policy available for this profile');
  return {
    profile,
    defaultPoseMode,
    recommendedPoseMode,
    applyInRuntime: false,
    confidence,
    fieldReady,
    ...counters,
    supportGroupCount: supportGroups.length,
    qualifiedSupportGroupCount,
    xrQualifiedSupportGroupCount,
    supportGroups: supportGroups.slice(0, 4),
    metrics,
    reasons
  };
}

export function summarizeArRuntimePolicies(
  rows: ArRuntimePolicyTelemetryRow[],
  { sampleLimit }: { sampleLimit: number }
): ArRuntimePolicySummary {
  const rowsByProfile = new Map<ArClientProfile, ArRuntimePolicyTelemetryRow[]>();
  for (const profile of AR_CLIENT_PROFILE_RELEASE_TARGETS) {
    rowsByProfile.set(profile, []);
  }

  for (const row of rows) {
    const profile = asClientProfile(row.client_profile);
    if (!profile) continue;
    rowsByProfile.get(profile)?.push(row);
  }

  const profiles = AR_CLIENT_PROFILE_RELEASE_TARGETS.map((profile) => {
    const summary = summarizeRows(rowsByProfile.get(profile) ?? []);
    return recommendProfilePolicy(profile, summary.counters, summary.supportGroups);
  });

  return {
    sampledSessions: rows.length,
    sampleLimit,
    truncated: rows.length >= sampleLimit,
    profiles,
    overrides: profiles
      .filter((profile) => profile.applyInRuntime && profile.recommendedPoseMode && profile.recommendedPoseMode !== profile.defaultPoseMode)
      .map((profile) => ({
        profile: profile.profile,
        poseMode: profile.recommendedPoseMode as ArRuntimePoseMode,
        confidence: profile.confidence,
        reasons: profile.reasons
      }))
  };
}
