import type { VisionTrackerBackend } from '@/lib/ar/visionTrackerClient';

export type VisionTrackerBudgetShape = {
  targetFps: number;
  captureWidth: number;
  maxFramesInFlight: number;
};

export type VisionTrackerAdaptiveState = {
  loadTier: 0 | 1 | 2 | 3;
  recoveryStreak: number;
  pressureStreak: number;
  latencyMsEma: number | null;
  processingMsEma: number | null;
  lastTrackStatus: 'searching' | 'tracking' | 'lost';
  lastTrackConfidence: number;
};

export type VisionTrackerAdaptiveSample = {
  backend: VisionTrackerBackend;
  baseBudget: VisionTrackerBudgetShape;
  state: VisionTrackerAdaptiveState;
  saturated?: boolean;
  latencyMs?: number | null;
  processingMs?: number | null;
  trackStatus?: 'searching' | 'tracking' | 'lost';
  trackConfidence?: number | null;
};

export const DEFAULT_VISION_TRACKER_ADAPTIVE_STATE: VisionTrackerAdaptiveState = Object.freeze({
  loadTier: 0,
  recoveryStreak: 0,
  pressureStreak: 0,
  latencyMsEma: null,
  processingMsEma: null,
  lastTrackStatus: 'lost',
  lastTrackConfidence: 0
});

export function deriveAdaptiveVisionTrackerBudget({
  backend,
  baseBudget,
  state
}: {
  backend: VisionTrackerBackend;
  baseBudget: VisionTrackerBudgetShape;
  state: VisionTrackerAdaptiveState;
}): VisionTrackerBudgetShape {
  let targetFps = baseBudget.targetFps;
  let captureWidth = baseBudget.captureWidth;
  let maxFramesInFlight = baseBudget.maxFramesInFlight;

  if (state.lastTrackStatus === 'tracking' && state.lastTrackConfidence >= 0.78) {
    targetFps -= backend === 'main_thread_roi' ? 2 : 1;
    captureWidth -= backend === 'main_thread_roi' ? 32 : 20;
  } else if (state.lastTrackStatus === 'searching' && state.lastTrackConfidence >= 0.4) {
    captureWidth -= backend === 'main_thread_roi' ? 12 : 8;
  }

  if (backend === 'main_thread_roi') {
    if (state.loadTier >= 1) {
      targetFps -= 2;
      captureWidth -= 28;
      maxFramesInFlight = 1;
    }
    if (state.loadTier >= 2) {
      targetFps -= 2;
      captureWidth -= 28;
    }
    if (state.loadTier >= 3) {
      targetFps -= 2;
      captureWidth -= 32;
    }
  } else {
    if (state.loadTier >= 1) {
      targetFps -= 2;
      captureWidth -= 16;
    }
    if (state.loadTier >= 2) {
      targetFps -= 2;
      captureWidth -= 20;
      maxFramesInFlight = 1;
    }
    if (state.loadTier >= 3) {
      targetFps -= 2;
      captureWidth -= 20;
    }
  }

  return {
    targetFps: clamp(Math.round(targetFps), 6, 30),
    captureWidth: clamp(Math.round(captureWidth), 160, 480),
    maxFramesInFlight: clamp(Math.round(maxFramesInFlight), 1, 4)
  };
}

export function advanceVisionTrackerAdaptiveState(sample: VisionTrackerAdaptiveSample): VisionTrackerAdaptiveState {
  const latencyMsEma = updateEma(sample.state.latencyMsEma, sample.latencyMs ?? null, 0.22);
  const processingMsEma = updateEma(sample.state.processingMsEma, sample.processingMs ?? null, 0.24);
  const lastTrackStatus = sample.trackStatus ?? sample.state.lastTrackStatus;
  const lastTrackConfidence =
    typeof sample.trackConfidence === 'number' && Number.isFinite(sample.trackConfidence)
      ? clamp(sample.trackConfidence, 0, 1)
      : sample.state.lastTrackConfidence;

  const frameIntervalMs = 1000 / Math.max(6, sample.baseBudget.targetFps);
  const latencyLimitMs =
    sample.backend === 'main_thread_roi' ? Math.max(15, frameIntervalMs * 0.92) : Math.max(24, frameIntervalMs * 1.65);
  const processingLimitMs = Math.max(10, Math.min(16, frameIntervalMs * 0.55));
  const pressure =
    Boolean(sample.saturated) ||
    (sample.backend === 'worker_roi' && latencyMsEma != null && latencyMsEma > latencyLimitMs) ||
    (sample.backend === 'main_thread_roi' && processingMsEma != null && processingMsEma > processingLimitMs);

  const stableTracking = lastTrackStatus === 'tracking' && lastTrackConfidence >= 0.78;
  let loadTier = sample.state.loadTier;
  let pressureStreak = pressure ? sample.state.pressureStreak + 1 : 0;
  let recoveryStreak = !pressure ? sample.state.recoveryStreak + 1 : 0;

  const promoteAfter = sample.backend === 'main_thread_roi' ? 2 : 3;
  const recoverAfter = stableTracking ? (sample.backend === 'main_thread_roi' ? 8 : 10) : 16;

  if (pressureStreak >= promoteAfter) {
    loadTier = clamp(loadTier + 1, 0, 3) as 0 | 1 | 2 | 3;
    pressureStreak = 0;
    recoveryStreak = 0;
  } else if (recoveryStreak >= recoverAfter && loadTier > 0) {
    loadTier = clamp(loadTier - 1, 0, 3) as 0 | 1 | 2 | 3;
    recoveryStreak = 0;
  }

  return {
    loadTier,
    recoveryStreak,
    pressureStreak,
    latencyMsEma,
    processingMsEma,
    lastTrackStatus,
    lastTrackConfidence
  };
}

function updateEma(previous: number | null, next: number | null, alpha: number) {
  if (next == null || !Number.isFinite(next) || next < 0) return previous;
  if (previous == null || !Number.isFinite(previous)) return next;
  return previous + (next - previous) * alpha;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
