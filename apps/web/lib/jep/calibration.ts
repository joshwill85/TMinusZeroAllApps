import type { JepCalibrationBand, JepObserverOutcome, JepReportMode } from '@/lib/types/jep';

export type JepCalibrationSample = {
  probability: number | null | undefined;
  outcome: JepObserverOutcome | null | undefined;
  reportMode?: JepReportMode | null;
  calibrationBand?: JepCalibrationBand | null;
  authorityTier?: string | null;
  observerPersonalized?: boolean | null;
};

export type JepCalibrationBin = {
  start: number;
  end: number;
  count: number;
  averageProbability: number | null;
  empiricalRate: number | null;
  absoluteGap: number | null;
};

export type JepCalibrationSummary = {
  totalSamples: number;
  labeledSamples: number;
  positiveSamples: number;
  negativeSamples: number;
  skippedSamples: number;
  meanProbability: number | null;
  observedRate: number | null;
  brierScore: number | null;
  expectedCalibrationError: number | null;
  bins: JepCalibrationBin[];
};

export function deriveJepCalibrationBand(probability: number): JepCalibrationBand {
  if (probability < 0.15) return 'VERY_LOW';
  if (probability < 0.35) return 'LOW';
  if (probability < 0.6) return 'MEDIUM';
  if (probability < 0.82) return 'HIGH';
  return 'VERY_HIGH';
}

export function isJepLabeledOutcome(outcome: JepObserverOutcome | null | undefined): outcome is 'seen' | 'not_seen' {
  return outcome === 'seen' || outcome === 'not_seen';
}

export function toJepOutcomeTarget(outcome: JepObserverOutcome | null | undefined): 0 | 1 | null {
  if (outcome === 'seen') return 1;
  if (outcome === 'not_seen') return 0;
  return null;
}

export function summarizeJepCalibration(
  samples: JepCalibrationSample[],
  options: { binCount?: number } = {}
): JepCalibrationSummary {
  const binCount = clampBinCount(options.binCount ?? 10);
  const bins = Array.from({ length: binCount }, (_, index) => ({
    start: index / binCount,
    end: (index + 1) / binCount,
    count: 0,
    probabilityTotal: 0,
    outcomeTotal: 0
  }));

  let labeledSamples = 0;
  let positiveSamples = 0;
  let negativeSamples = 0;
  let probabilityTotal = 0;
  let outcomeTotal = 0;
  let brierTotal = 0;

  for (const sample of samples) {
    const probability = normalizeProbability(sample.probability);
    const target = toJepOutcomeTarget(sample.outcome);
    if (probability == null || target == null) continue;

    labeledSamples += 1;
    probabilityTotal += probability;
    outcomeTotal += target;
    brierTotal += (probability - target) ** 2;
    if (target === 1) positiveSamples += 1;
    else negativeSamples += 1;

    const binIndex = Math.min(binCount - 1, Math.floor(probability * binCount));
    const bin = bins[Math.max(0, binIndex)]!;
    bin.count += 1;
    bin.probabilityTotal += probability;
    bin.outcomeTotal += target;
  }

  const expectedCalibrationError =
    labeledSamples > 0
      ? bins.reduce((sum, bin) => {
          if (bin.count === 0) return sum;
          const meanProbability = bin.probabilityTotal / bin.count;
          const empiricalRate = bin.outcomeTotal / bin.count;
          return sum + Math.abs(meanProbability - empiricalRate) * (bin.count / labeledSamples);
        }, 0)
      : null;

  return {
    totalSamples: samples.length,
    labeledSamples,
    positiveSamples,
    negativeSamples,
    skippedSamples: Math.max(0, samples.length - labeledSamples),
    meanProbability: labeledSamples > 0 ? probabilityTotal / labeledSamples : null,
    observedRate: labeledSamples > 0 ? outcomeTotal / labeledSamples : null,
    brierScore: labeledSamples > 0 ? brierTotal / labeledSamples : null,
    expectedCalibrationError,
    bins: bins.map((bin) => ({
      start: bin.start,
      end: bin.end,
      count: bin.count,
      averageProbability: bin.count > 0 ? bin.probabilityTotal / bin.count : null,
      empiricalRate: bin.count > 0 ? bin.outcomeTotal / bin.count : null,
      absoluteGap:
        bin.count > 0 ? Math.abs(bin.probabilityTotal / bin.count - bin.outcomeTotal / bin.count) : null
    }))
  };
}

function normalizeProbability(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return value;
}

function clampBinCount(value: number) {
  if (!Number.isFinite(value)) return 10;
  return Math.max(2, Math.min(50, Math.floor(value)));
}
