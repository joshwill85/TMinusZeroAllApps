export type ArPerformanceTier = 0 | 1 | 2 | 3;
export type ArMilestoneDensity = 'full' | 'major' | 'off';

export type ArPerformanceSample = {
  frameCount: number;
  avgFrameMs: number | null;
  slowFrameRatio: number;
  severeFrameRatio: number;
};

export type ArPerformanceGovernorState = {
  tier: ArPerformanceTier;
  recoveryStreak: number;
};

export type ArPerformancePolicy = {
  reducedEffects: boolean;
  milestoneDensity: ArMilestoneDensity;
  lockPredictionDepth: 0 | 1 | 2 | 3;
  showRollAssist: boolean;
  dprCap: number;
};

export function classifyArPerformanceTier(sample: ArPerformanceSample): ArPerformanceTier {
  if (sample.frameCount < 12 || sample.avgFrameMs == null || !Number.isFinite(sample.avgFrameMs)) return 0;
  if (sample.avgFrameMs >= 38 || sample.severeFrameRatio >= 0.16 || sample.slowFrameRatio >= 0.48) return 3;
  if (sample.avgFrameMs >= 28 || sample.severeFrameRatio >= 0.08 || sample.slowFrameRatio >= 0.32) return 2;
  if (sample.avgFrameMs >= 20 || sample.slowFrameRatio >= 0.18) return 1;
  return 0;
}

export function advanceArPerformanceGovernor(
  state: ArPerformanceGovernorState,
  sample: ArPerformanceSample
): ArPerformanceGovernorState {
  const targetTier = classifyArPerformanceTier(sample);
  if (targetTier > state.tier) {
    return {
      tier: targetTier,
      recoveryStreak: 0
    };
  }

  if (targetTier < state.tier) {
    const recoveryStreak = state.recoveryStreak + 1;
    if (recoveryStreak >= 3) {
      return {
        tier: (state.tier - 1) as ArPerformanceTier,
        recoveryStreak: 0
      };
    }
    return {
      tier: state.tier,
      recoveryStreak
    };
  }

  return {
    tier: state.tier,
    recoveryStreak: 0
  };
}

export function getArPerformancePolicy(tier: ArPerformanceTier): ArPerformancePolicy {
  if (tier === 0) {
    return {
      reducedEffects: false,
      milestoneDensity: 'full',
      lockPredictionDepth: 3,
      showRollAssist: true,
      dprCap: 2
    };
  }

  if (tier === 1) {
    return {
      reducedEffects: true,
      milestoneDensity: 'full',
      lockPredictionDepth: 2,
      showRollAssist: true,
      dprCap: 2
    };
  }

  if (tier === 2) {
    return {
      reducedEffects: true,
      milestoneDensity: 'major',
      lockPredictionDepth: 1,
      showRollAssist: false,
      dprCap: 2
    };
  }

  return {
    reducedEffects: true,
    milestoneDensity: 'off',
    lockPredictionDepth: 0,
    showRollAssist: false,
    dprCap: 1.35
  };
}
