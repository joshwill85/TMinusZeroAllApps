import { AlphaBetaNormFilter } from '@/lib/ar/predictionFilter';
import { mapVisionNormPointFromCropRect } from '@/lib/ar/visionTrackerWindow';
import type {
  VisionFrameCropRect,
  VisionNormPoint,
  VisionPredictionPoint,
  VisionTrackerTrackMessage
} from '@/lib/ar/visionTrackerProtocol';

const predictionHorizonsSec = [1, 2, 5] as const;
const COMPONENT_MAX_CANDIDATES = 6;

type VisionCandidate = {
  point: VisionNormPoint;
  signal: number;
  compactness: number;
  peakStrength: number;
  areaFraction: number;
  edgeScore: number;
  source: 'bright' | 'motion';
};

type SelectedMeasurement = {
  point: VisionNormPoint;
  signal: number;
  score: number;
  ambiguity: number;
  source: 'bright' | 'motion';
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function distanceNorm(a: VisionNormPoint, b: VisionNormPoint) {
  return Math.hypot(a.xNorm - b.xNorm, a.yNorm - b.yNorm);
}

function candidateEdgeScore(xNorm: number, yNorm: number) {
  const margin = Math.min(xNorm, 1 - xNorm, yNorm, 1 - yNorm);
  return clamp(margin / 0.18, 0, 1);
}

function createDiffBuffer(gray: Uint8Array, prevGray: Uint8Array | null) {
  if (!prevGray || prevGray.length !== gray.length) return null;
  const diff = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    diff[i] = Math.abs((gray[i] ?? 0) - (prevGray[i] ?? 0));
  }
  return diff;
}

function collectConnectedCandidates(
  values: Uint8Array,
  width: number,
  height: number,
  options: {
    threshold: number;
    source: 'bright' | 'motion';
    signalDivisor: number;
  }
): VisionCandidate[] {
  const { threshold, source, signalDivisor } = options;
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const stack: number[] = [];
  const candidates: Array<VisionCandidate & { totalWeight: number }> = [];

  for (let start = 0; start < totalPixels; start += 1) {
    if (visited[start] === 1 || (values[start] ?? 0) < threshold) continue;

    visited[start] = 1;
    stack.push(start);

    let sumX = 0;
    let sumY = 0;
    let sumWeight = 0;
    let count = 0;
    let peak = threshold;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    while (stack.length > 0) {
      const idx = stack.pop()!;
      const y = Math.floor(idx / width);
      const x = idx - y * width;
      const value = values[idx] ?? 0;
      if (value < threshold) continue;

      const weight = value - threshold + 1;
      count += 1;
      sumWeight += weight;
      sumX += x * weight;
      sumY += y * weight;
      if (value > peak) peak = value;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const left = idx - 1;
      const right = idx + 1;
      const up = idx - width;
      const down = idx + width;

      if (x > 0 && visited[left] === 0 && (values[left] ?? 0) >= threshold) {
        visited[left] = 1;
        stack.push(left);
      }
      if (x + 1 < width && visited[right] === 0 && (values[right] ?? 0) >= threshold) {
        visited[right] = 1;
        stack.push(right);
      }
      if (y > 0 && visited[up] === 0 && (values[up] ?? 0) >= threshold) {
        visited[up] = 1;
        stack.push(up);
      }
      if (y + 1 < height && visited[down] === 0 && (values[down] ?? 0) >= threshold) {
        visited[down] = 1;
        stack.push(down);
      }
    }

    if (count <= 0 || sumWeight <= 0) continue;

    const bboxArea = Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
    const cx = sumX / sumWeight;
    const cy = sumY / sumWeight;
    const areaFraction = count / Math.max(1, totalPixels);
    if (areaFraction > 0.28) continue;

    candidates.push({
      point: {
        xNorm: clamp01((cx + 0.5) / width),
        yNorm: clamp01((cy + 0.5) / height)
      },
      signal: clamp(sumWeight / signalDivisor, 0, 1),
      compactness: clamp(count / bboxArea, 0, 1),
      peakStrength: clamp((peak - threshold + 1) / Math.max(1, 256 - threshold), 0, 1),
      areaFraction,
      edgeScore: candidateEdgeScore((cx + 0.5) / width, (cy + 0.5) / height),
      source,
      totalWeight: sumWeight
    });
  }

  candidates.sort((a, b) => b.totalWeight - a.totalWeight);
  return candidates.slice(0, COMPONENT_MAX_CANDIDATES).map(({ totalWeight: _ignored, ...candidate }) => candidate);
}

function detectBrightCandidates(gray: Uint8Array, width: number, height: number, avgLuma: number) {
  const threshold = clamp(Math.max(170, avgLuma + 55), 140, 245);
  return collectConnectedCandidates(gray, width, height, {
    threshold,
    source: 'bright',
    signalDivisor: width * height * 18
  });
}

function detectMotionCandidates(gray: Uint8Array, prevGray: Uint8Array | null, width: number, height: number) {
  const diff = createDiffBuffer(gray, prevGray);
  if (!diff) return [];
  return collectConnectedCandidates(diff, width, height, {
    threshold: 24,
    source: 'motion',
    signalDivisor: width * height * 42
  });
}

function parseGrayscale(imageData: ImageData): { gray: Uint8Array; avgLuma: number } {
  const { data, width, height } = imageData;
  const gray = new Uint8Array(width * height);
  let sum = 0;
  let offset = 0;
  for (let i = 0; i < gray.length; i += 1) {
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    const luma = (77 * r + 150 * g + 29 * b) >> 8;
    gray[i] = luma;
    sum += luma;
    offset += 4;
  }
  return { gray, avgLuma: gray.length > 0 ? sum / gray.length : 0 };
}

function buildPredictions(filter: AlphaBetaNormFilter, confidence: number): VisionPredictionPoint[] {
  if (!filter.hasState()) return [];
  const points: VisionPredictionPoint[] = [];
  for (const dtSec of predictionHorizonsSec) {
    const next = filter.predict(dtSec);
    if (!next) continue;
    points.push({
      dtSec,
      xNorm: next.xNorm,
      yNorm: next.yNorm,
      confidence: clamp(confidence - dtSec * 0.12, 0, 1)
    });
  }
  return points;
}

function selectMeasurement({
  brightCandidates,
  motionCandidates,
  predictedPoint,
  cropRect,
  trackConfidence,
  useBrightMode
}: {
  brightCandidates: VisionCandidate[];
  motionCandidates: VisionCandidate[];
  predictedPoint: VisionNormPoint | null;
  cropRect?: VisionFrameCropRect | null;
  trackConfidence: number;
  useBrightMode: boolean;
}): SelectedMeasurement | null {
  const cropCenter =
    cropRect != null
      ? mapVisionNormPointFromCropRect(
          {
            xNorm: 0.5,
            yNorm: 0.5
          },
          cropRect
        ) ?? { xNorm: 0.5, yNorm: 0.5 }
      : { xNorm: 0.5, yNorm: 0.5 };
  const anchor = predictedPoint ?? cropCenter;
  const expectedRadius = predictedPoint
    ? clamp(0.08 + (1 - trackConfidence) * 0.18, 0.08, 0.28)
    : cropRect != null
      ? 0.28
      : 0.42;
  const candidates = [...brightCandidates, ...motionCandidates]
    .map((candidate) => {
      const globalPoint = mapVisionNormPointFromCropRect(candidate.point, cropRect ?? null) ?? candidate.point;
      const distanceToAnchor = distanceNorm(globalPoint, anchor);
      const distanceToCropCenter = distanceNorm(globalPoint, cropCenter);
      const spatialScore = clamp(1 - distanceToAnchor / expectedRadius, 0, 1);
      const centerScore = clamp(1 - distanceToCropCenter / 0.42, 0, 1);
      const sourceBias =
        candidate.source === 'bright'
          ? useBrightMode
            ? 0.08
            : 0.03
          : useBrightMode
            ? -0.05
            : 0.06;
      const compactnessScore = clamp(candidate.compactness * 0.7 + candidate.peakStrength * 0.3, 0, 1);
      const areaPenalty =
        candidate.areaFraction > 0.12 ? clamp((candidate.areaFraction - 0.12) / 0.16, 0, 0.45) : 0;
      const jumpPenalty =
        predictedPoint != null && trackConfidence >= 0.56 && distanceToAnchor > expectedRadius * 1.55
          ? clamp((distanceToAnchor - expectedRadius * 1.55) / 0.2, 0, 0.55)
          : 0;
      const score = clamp(
        candidate.signal * 0.4 +
          spatialScore * 0.24 +
          centerScore * 0.08 +
          compactnessScore * 0.16 +
          candidate.edgeScore * 0.12 +
          sourceBias -
          areaPenalty -
          jumpPenalty,
        0,
        1
      );
      return {
        ...candidate,
        point: globalPoint,
        score
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best) return null;
  const second = candidates[1];
  const ambiguity = second ? clamp(1 - (best.score - second.score) / 0.18, 0, 1) : 0;
  const acceptThreshold = predictedPoint != null && trackConfidence >= 0.5 ? 0.34 : 0.28;
  const signal = clamp(best.signal * 0.58 + best.score * 0.42 - ambiguity * 0.18, 0, 1);

  if (best.score < acceptThreshold) return null;
  if (ambiguity >= 0.78 && signal < 0.58) return null;
  if (best.areaFraction > 0.2) return null;

  return {
    point: best.point,
    signal,
    score: best.score,
    ambiguity,
    source: best.source
  };
}

export class VisionTrackerCore {
  private prevGray: Uint8Array | null = null;

  private lastFrameTsMs: number | null = null;

  private trackConfidence = 0;

  private consecutiveAcceptedFrames = 0;

  private consecutiveStrongFrames = 0;

  private consecutiveMisses = 0;

  private readonly filter = new AlphaBetaNormFilter();

  private lastCropRect: VisionFrameCropRect | null = null;

  reset() {
    this.prevGray = null;
    this.lastFrameTsMs = null;
    this.trackConfidence = 0;
    this.consecutiveAcceptedFrames = 0;
    this.consecutiveStrongFrames = 0;
    this.consecutiveMisses = 0;
    this.filter.reset();
    this.lastCropRect = null;
  }

  processFrame(id: number, tsMs: number, imageData: ImageData, cropRect?: VisionFrameCropRect | null): VisionTrackerTrackMessage {
    if (shouldResetMotionReference(this.lastCropRect, cropRect ?? null)) {
      this.prevGray = null;
      this.consecutiveStrongFrames = 0;
      this.consecutiveAcceptedFrames = 0;
      this.consecutiveMisses = 0;
    }
    this.lastCropRect = cropRect ?? null;

    const { gray, avgLuma } = parseGrayscale(imageData);
    const useBrightMode = avgLuma < 92;
    const brightCandidates = detectBrightCandidates(gray, imageData.width, imageData.height, avgLuma);
    const motionCandidates = useBrightMode
      ? []
      : detectMotionCandidates(gray, this.prevGray, imageData.width, imageData.height);
    const predictedPoint = this.filter.predict(0);

    const measurement = selectMeasurement({
      brightCandidates,
      motionCandidates,
      predictedPoint,
      cropRect: cropRect ?? null,
      trackConfidence: this.trackConfidence,
      useBrightMode
    });

    const dtSec =
      this.lastFrameTsMs != null && Number.isFinite(this.lastFrameTsMs)
        ? clamp((tsMs - this.lastFrameTsMs) / 1000, 1 / 120, 0.5)
        : 1 / 30;
    this.lastFrameTsMs = tsMs;

    if (measurement) {
      const spatialConsistency = predictedPoint ? clamp(1 - distanceNorm(measurement.point, predictedPoint) / 0.26, 0, 1) : 0.62;
      this.consecutiveAcceptedFrames += 1;
      this.consecutiveMisses = 0;
      if (measurement.score >= 0.54 && measurement.signal >= 0.5 && measurement.ambiguity <= 0.46) {
        this.consecutiveStrongFrames += 1;
      } else {
        this.consecutiveStrongFrames = Math.max(0, this.consecutiveStrongFrames - 1);
      }

      const sourcePenalty = measurement.source === 'motion' && useBrightMode ? 0.04 : 0;
      this.trackConfidence = clamp(
        this.trackConfidence +
          0.04 +
          measurement.signal * 0.17 +
          spatialConsistency * 0.12 +
          Math.min(0.08, this.consecutiveAcceptedFrames * 0.015) -
          measurement.ambiguity * 0.16 -
          sourcePenalty,
        0,
        1
      );
    } else {
      this.consecutiveAcceptedFrames = 0;
      this.consecutiveStrongFrames = 0;
      this.consecutiveMisses += 1;
      this.trackConfidence = clamp(
        this.trackConfidence - (predictedPoint ? 0.18 : 0.12) - Math.min(0.06, this.consecutiveMisses * 0.02),
        0,
        1
      );
    }

    const filtered = this.filter.update(measurement?.point ?? null, dtSec);
    if (!measurement && this.trackConfidence < 0.05) {
      this.filter.reset();
    }

    this.prevGray = gray;

    const centerNorm = filtered ? { xNorm: filtered.xNorm, yNorm: filtered.yNorm } : null;
    const predictions = buildPredictions(this.filter, this.trackConfidence);
    const status: 'searching' | 'tracking' | 'lost' =
      centerNorm == null || (this.trackConfidence < 0.16 && this.consecutiveMisses >= 2)
        ? 'lost'
        : this.trackConfidence >= 0.62 && this.consecutiveStrongFrames >= 2
          ? 'tracking'
          : 'searching';

    return {
      type: 'track',
      id,
      tsMs,
      status,
      confidence: this.trackConfidence,
      centerNorm,
      predictions
    };
  }
}

function shouldResetMotionReference(previous: VisionFrameCropRect | null, next: VisionFrameCropRect | null) {
  if (!previous && !next) return false;
  if (!previous || !next) return true;
  if (previous.widthPx !== next.widthPx || previous.heightPx !== next.heightPx) return true;
  return Math.abs(previous.xPx - next.xPx) > 8 || Math.abs(previous.yPx - next.yPx) > 8;
}
