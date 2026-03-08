import type { VisionNormPoint } from '@/lib/ar/visionTrackerProtocol';

type FilterState = {
  xNorm: number;
  yNorm: number;
  vxNormPerSec: number;
  vyNormPerSec: number;
};

type FilterParams = {
  alpha: number;
  beta: number;
  maxSpeedNormPerSec: number;
};

const DEFAULT_PARAMS: FilterParams = {
  alpha: 0.62,
  beta: 0.18,
  maxSpeedNormPerSec: 1.8
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

export class AlphaBetaNormFilter {
  private state: FilterState | null = null;

  private readonly params: FilterParams;

  constructor(params?: Partial<FilterParams>) {
    this.params = { ...DEFAULT_PARAMS, ...(params || {}) };
  }

  reset() {
    this.state = null;
  }

  hasState() {
    return this.state != null;
  }

  getState() {
    return this.state;
  }

  update(measurement: VisionNormPoint | null, dtSecRaw: number) {
    const dtSec = clamp(Number.isFinite(dtSecRaw) ? dtSecRaw : 1 / 30, 1 / 120, 0.5);

    if (this.state == null) {
      if (measurement) {
        this.state = {
          xNorm: clamp01(measurement.xNorm),
          yNorm: clamp01(measurement.yNorm),
          vxNormPerSec: 0,
          vyNormPerSec: 0
        };
      }
      return this.state;
    }

    const predictedX = clamp01(this.state.xNorm + this.state.vxNormPerSec * dtSec);
    const predictedY = clamp01(this.state.yNorm + this.state.vyNormPerSec * dtSec);
    let predictedVx = this.state.vxNormPerSec;
    let predictedVy = this.state.vyNormPerSec;

    if (measurement) {
      const mx = clamp01(measurement.xNorm);
      const my = clamp01(measurement.yNorm);
      const residualX = mx - predictedX;
      const residualY = my - predictedY;
      const alpha = clamp(this.params.alpha, 0.01, 1);
      const beta = clamp(this.params.beta, 0.01, 1);

      const correctedX = clamp01(predictedX + alpha * residualX);
      const correctedY = clamp01(predictedY + alpha * residualY);
      predictedVx = clamp(
        predictedVx + (beta * residualX) / dtSec,
        -this.params.maxSpeedNormPerSec,
        this.params.maxSpeedNormPerSec
      );
      predictedVy = clamp(
        predictedVy + (beta * residualY) / dtSec,
        -this.params.maxSpeedNormPerSec,
        this.params.maxSpeedNormPerSec
      );

      this.state = {
        xNorm: correctedX,
        yNorm: correctedY,
        vxNormPerSec: predictedVx,
        vyNormPerSec: predictedVy
      };
      return this.state;
    }

    this.state = {
      xNorm: predictedX,
      yNorm: predictedY,
      vxNormPerSec: predictedVx,
      vyNormPerSec: predictedVy
    };
    return this.state;
  }

  predict(dtSecRaw: number): VisionNormPoint | null {
    if (!this.state) return null;
    const dtSec = clamp(Number.isFinite(dtSecRaw) ? dtSecRaw : 0, 0, 10);
    return {
      xNorm: clamp01(this.state.xNorm + this.state.vxNormPerSec * dtSec),
      yNorm: clamp01(this.state.yNorm + this.state.vyNormPerSec * dtSec)
    };
  }
}
