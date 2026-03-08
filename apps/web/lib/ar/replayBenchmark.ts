import { azElFromEnu, ecefFromLatLon, enuFromEcef } from '@/lib/ar/ecef';
import { interpolateTrajectory, type TrajectoryAzElPoint } from '@/lib/ar/trajectory';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export type ReplayObserver = {
  latDeg: number;
  lonDeg: number;
  altMeters?: number;
};

export type ReplaySampleInput = {
  tPlusSec: number;
  azDeg?: number;
  elDeg?: number;
  ecef?: [number, number, number] | number[];
};

export type ReplayBenchmarkCaseInput = {
  id: string;
  observer?: ReplayObserver;
  predictedSamples: ReplaySampleInput[];
  referenceSamples: ReplaySampleInput[];
};

export type ReplayBenchmarkFixture = {
  schemaVersion: number;
  seed?: string;
  notes?: string;
  cases: ReplayBenchmarkCaseInput[];
};

export type ReplayBenchmarkCaseSummary = {
  id: string;
  sampleCount: number;
  meanErrorDeg: number;
  p50ErrorDeg: number;
  p90ErrorDeg: number;
  p95ErrorDeg: number;
  startMeanErrorDeg: number;
  endMeanErrorDeg: number;
  driftDeg: number;
  slopeDegPerMin: number;
};

export type ReplayBenchmarkSkippedCase = {
  id: string;
  reason: string;
};

export type ReplayBenchmarkReport = {
  generatedAt: string;
  fixtureSeed: string | null;
  fixtureCaseCount: number;
  evaluatedCaseCount: number;
  sampleCount: number;
  overall: {
    meanErrorDeg: number;
    p50ErrorDeg: number;
    p90ErrorDeg: number;
    p95ErrorDeg: number;
    startMeanErrorDeg: number;
    endMeanErrorDeg: number;
    driftDeg: number;
    slopeDegPerMin: number;
  } | null;
  cases: ReplayBenchmarkCaseSummary[];
  skippedCases: ReplayBenchmarkSkippedCase[];
};

type TimedError = { tPlusSec: number; errorDeg: number };
type EvaluatedCaseResult = {
  summary: ReplayBenchmarkCaseSummary;
  timedErrors: TimedError[];
};
type SkippedCaseResult = {
  skipped: ReplayBenchmarkSkippedCase;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeAzDeg(azDeg: number) {
  return ((azDeg % 360) + 360) % 360;
}

function toEcef(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const x = toFiniteNumber(value[0]);
  const y = toFiniteNumber(value[1]);
  const z = toFiniteNumber(value[2]);
  if (x == null || y == null || z == null) return null;
  return [x, y, z];
}

function toAzElPoint(
  sample: ReplaySampleInput,
  observer: ReplayObserver | undefined,
  userEcef: [number, number, number] | null
): TrajectoryAzElPoint | null {
  const tPlusSec = toFiniteNumber(sample.tPlusSec);
  if (tPlusSec == null) return null;

  const azDegDirect = toFiniteNumber(sample.azDeg);
  const elDegDirect = toFiniteNumber(sample.elDeg);
  if (azDegDirect != null && elDegDirect != null) {
    return {
      tPlusSec,
      azDeg: normalizeAzDeg(azDegDirect),
      elDeg: elDegDirect
    };
  }

  const ecef = toEcef(sample.ecef);
  if (!ecef || !observer || !userEcef) return null;

  const enu = enuFromEcef(observer.latDeg, observer.lonDeg, userEcef, ecef);
  const { azDeg, elDeg } = azElFromEnu(enu);
  return {
    tPlusSec,
    azDeg: normalizeAzDeg(azDeg),
    elDeg
  };
}

function normalizeSeries(
  samples: ReplaySampleInput[],
  observer: ReplayObserver | undefined
): TrajectoryAzElPoint[] {
  const userEcef =
    observer &&
    Number.isFinite(observer.latDeg) &&
    Number.isFinite(observer.lonDeg) &&
    Number.isFinite(observer.altMeters ?? 0)
      ? ecefFromLatLon(observer.latDeg, observer.lonDeg, observer.altMeters ?? 0)
      : null;

  const parsed = samples
    .map((sample) => toAzElPoint(sample, observer, userEcef))
    .filter((value): value is TrajectoryAzElPoint => Boolean(value))
    .sort((a, b) => a.tPlusSec - b.tPlusSec);

  if (!parsed.length) return [];

  const deduped: TrajectoryAzElPoint[] = [];
  for (const row of parsed) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.tPlusSec === row.tPlusSec) {
      deduped[deduped.length - 1] = row;
      continue;
    }
    deduped.push(row);
  }

  return deduped;
}

function angularSeparationDeg(
  a: { azDeg: number; elDeg: number },
  b: { azDeg: number; elDeg: number }
) {
  const azA = a.azDeg * DEG_TO_RAD;
  const azB = b.azDeg * DEG_TO_RAD;
  const elA = a.elDeg * DEG_TO_RAD;
  const elB = b.elDeg * DEG_TO_RAD;

  const cosSep =
    Math.sin(elA) * Math.sin(elB) +
    Math.cos(elA) * Math.cos(elB) * Math.cos(azA - azB);
  const clamped = clamp(cosSep, -1, 1);
  return Math.acos(clamped) * RAD_TO_DEG;
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp((sorted.length - 1) * p, 0, sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const f = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * f;
}

function regressionSlopeDegPerMin(points: TimedError[]) {
  if (points.length < 2) return 0;
  const baseT = points[0].tPlusSec;
  const xs = points.map((row) => (row.tPlusSec - baseT) / 60);
  const ys = points.map((row) => row.errorDeg);

  const meanX = mean(xs);
  const meanY = mean(ys);
  let num = 0;
  let den = 0;

  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - meanX;
    num += dx * (ys[i] - meanY);
    den += dx * dx;
  }

  if (!Number.isFinite(den) || den === 0) return 0;
  return num / den;
}

function summarizeTimedErrors(timedErrors: TimedError[]) {
  const sorted = [...timedErrors].sort((a, b) => a.tPlusSec - b.tPlusSec);
  const errors = sorted.map((row) => row.errorDeg);
  const chunkSize = Math.max(1, Math.floor(sorted.length / 3));

  const startErrors = sorted.slice(0, chunkSize).map((row) => row.errorDeg);
  const endErrors = sorted.slice(-chunkSize).map((row) => row.errorDeg);

  const startMeanErrorDeg = mean(startErrors);
  const endMeanErrorDeg = mean(endErrors);

  return {
    meanErrorDeg: mean(errors),
    p50ErrorDeg: percentile(errors, 0.5),
    p90ErrorDeg: percentile(errors, 0.9),
    p95ErrorDeg: percentile(errors, 0.95),
    startMeanErrorDeg,
    endMeanErrorDeg,
    driftDeg: endMeanErrorDeg - startMeanErrorDeg,
    slopeDegPerMin: regressionSlopeDegPerMin(sorted)
  };
}

function evaluateCase(row: ReplayBenchmarkCaseInput): EvaluatedCaseResult | SkippedCaseResult {
  const predicted = normalizeSeries(row.predictedSamples, row.observer);
  if (predicted.length < 2) {
    return { skipped: { id: row.id, reason: 'predicted_samples_insufficient' } };
  }

  const reference = normalizeSeries(row.referenceSamples, row.observer);
  if (!reference.length) {
    return { skipped: { id: row.id, reason: 'reference_samples_missing' } };
  }

  const timedErrors: TimedError[] = [];
  for (const ref of reference) {
    const predictedAtT = interpolateTrajectory(predicted, ref.tPlusSec);
    if (!predictedAtT) continue;
    const errorDeg = angularSeparationDeg(predictedAtT, ref);
    if (!Number.isFinite(errorDeg)) continue;
    timedErrors.push({ tPlusSec: ref.tPlusSec, errorDeg });
  }

  if (!timedErrors.length) {
    return { skipped: { id: row.id, reason: 'no_overlapping_samples' } };
  }

  const summary = summarizeTimedErrors(timedErrors);
  return {
    summary: {
      id: row.id,
      sampleCount: timedErrors.length,
      ...summary
    } satisfies ReplayBenchmarkCaseSummary,
    timedErrors
  };
}

export function runReplayBenchmark(fixture: ReplayBenchmarkFixture): ReplayBenchmarkReport {
  const cases = Array.isArray(fixture.cases) ? fixture.cases : [];
  const summaries: ReplayBenchmarkCaseSummary[] = [];
  const skippedCases: ReplayBenchmarkSkippedCase[] = [];
  const overallTimedErrors: TimedError[] = [];

  for (const row of cases) {
    const id = typeof row?.id === 'string' ? row.id.trim() : '';
    if (!id) {
      skippedCases.push({ id: '(unnamed)', reason: 'missing_case_id' });
      continue;
    }

    const result = evaluateCase({ ...row, id });
    if ('skipped' in result) {
      skippedCases.push(result.skipped);
      continue;
    }

    summaries.push(result.summary);
    overallTimedErrors.push(...result.timedErrors);
  }

  const overall = overallTimedErrors.length ? summarizeTimedErrors(overallTimedErrors) : null;

  return {
    generatedAt: new Date().toISOString(),
    fixtureSeed: typeof fixture.seed === 'string' ? fixture.seed : null,
    fixtureCaseCount: cases.length,
    evaluatedCaseCount: summaries.length,
    sampleCount: overallTimedErrors.length,
    overall,
    cases: summaries,
    skippedCases
  };
}
