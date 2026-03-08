export type JepObserverGuidanceSummary = {
  bestWindow:
    | {
        startTPlusSec: number;
        endTPlusSec: number;
        label: string;
        reason: string;
      }
    | null;
  directionBand:
    | {
        fromAzDeg: number;
        toAzDeg: number;
        label: string;
      }
    | null;
  elevationBand:
    | {
        minDeg: number;
        maxDeg: number;
        label: string;
      }
    | null;
  scenarioWindows: Array<{
    offsetMinutes: number;
    score: number;
    delta: number;
    trend: 'better' | 'similar' | 'worse';
    label: string;
  }>;
};

export function applyJepObserverGuidancePolicy(
  guidance: JepObserverGuidanceSummary,
  {
    allowObserverGuidance
  }: {
    allowObserverGuidance: boolean;
  }
): JepObserverGuidanceSummary {
  if (allowObserverGuidance) return guidance;
  return {
    bestWindow: null,
    directionBand: null,
    elevationBand: null,
    scenarioWindows: []
  };
}

export function allowNwsFallbackForObserverSource(source: 'pad' | 'observer_registry') {
  return source === 'pad';
}
