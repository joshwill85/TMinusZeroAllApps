import type { VisionFrameCropRect, VisionNormPoint, VisionSearchWindow } from '@/lib/ar/visionTrackerProtocol';
import { normalizeAngleDelta } from '@/lib/ar/geo';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

export function projectAzElToViewportNorm({
  targetAzDeg,
  targetElDeg,
  headingDeg,
  pitchDeg,
  rollDeg,
  fovXDeg,
  fovYDeg
}: {
  targetAzDeg: number;
  targetElDeg: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg?: number | null;
  fovXDeg: number;
  fovYDeg: number;
}): VisionNormPoint | null {
  if (
    !Number.isFinite(targetAzDeg) ||
    !Number.isFinite(targetElDeg) ||
    !Number.isFinite(headingDeg) ||
    !Number.isFinite(pitchDeg) ||
    !Number.isFinite(fovXDeg) ||
    !Number.isFinite(fovYDeg)
  ) {
    return null;
  }

  const halfFovXRad = (Math.max(1, fovXDeg) * Math.PI) / 180 / 2;
  const halfFovYRad = (Math.max(1, fovYDeg) * Math.PI) / 180 / 2;
  const yawRad = (normalizeAngleDelta(targetAzDeg - headingDeg) * Math.PI) / 180;
  const pitchRadDelta = ((targetElDeg - pitchDeg) * Math.PI) / 180;

  const tanHalfFovX = Math.tan(halfFovXRad);
  const tanHalfFovY = Math.tan(halfFovYRad);
  if (!Number.isFinite(tanHalfFovX) || !Number.isFinite(tanHalfFovY) || tanHalfFovX === 0 || tanHalfFovY === 0) {
    return null;
  }

  let xNorm = (Math.tan(yawRad) / tanHalfFovX + 1) / 2;
  let yNorm = (1 - Math.tan(pitchRadDelta) / tanHalfFovY) / 2;
  if (!Number.isFinite(xNorm) || !Number.isFinite(yNorm)) return null;

  if (rollDeg != null && Number.isFinite(rollDeg) && Math.abs(rollDeg) > 0.01) {
    const rollRad = (rollDeg * Math.PI) / 180;
    const dx = xNorm - 0.5;
    const dy = yNorm - 0.5;
    const cos = Math.cos(-rollRad);
    const sin = Math.sin(-rollRad);
    xNorm = 0.5 + dx * cos - dy * sin;
    yNorm = 0.5 + dx * sin + dy * cos;
  }

  if (!Number.isFinite(xNorm) || !Number.isFinite(yNorm)) return null;
  return {
    xNorm: clamp01(xNorm),
    yNorm: clamp01(yNorm)
  };
}

export function viewportNormToAngleOffsetsDeg({
  point,
  rollDeg,
  fovXDeg,
  fovYDeg
}: {
  point: VisionNormPoint;
  rollDeg?: number | null;
  fovXDeg: number;
  fovYDeg: number;
}) {
  if (
    !Number.isFinite(point.xNorm) ||
    !Number.isFinite(point.yNorm) ||
    !Number.isFinite(fovXDeg) ||
    !Number.isFinite(fovYDeg)
  ) {
    return null;
  }

  let xNorm = clamp01(point.xNorm);
  let yNorm = clamp01(point.yNorm);
  if (rollDeg != null && Number.isFinite(rollDeg) && Math.abs(rollDeg) > 0.01) {
    const rollRad = (rollDeg * Math.PI) / 180;
    const dx = xNorm - 0.5;
    const dy = yNorm - 0.5;
    const cos = Math.cos(rollRad);
    const sin = Math.sin(rollRad);
    xNorm = 0.5 + dx * cos - dy * sin;
    yNorm = 0.5 + dx * sin + dy * cos;
  }

  const halfFovXRad = (Math.max(1, fovXDeg) * Math.PI) / 180 / 2;
  const halfFovYRad = (Math.max(1, fovYDeg) * Math.PI) / 180 / 2;
  const tanHalfFovX = Math.tan(halfFovXRad);
  const tanHalfFovY = Math.tan(halfFovYRad);
  if (!Number.isFinite(tanHalfFovX) || !Number.isFinite(tanHalfFovY) || tanHalfFovX === 0 || tanHalfFovY === 0) {
    return null;
  }

  const yawRad = Math.atan((xNorm * 2 - 1) * tanHalfFovX);
  const pitchRad = Math.atan((1 - yNorm * 2) * tanHalfFovY);
  return {
    yawDeg: (yawRad * 180) / Math.PI,
    pitchDeg: (pitchRad * 180) / Math.PI
  };
}

export function angularSpanNormForFov(angleDeg: number, fovDeg: number) {
  if (!Number.isFinite(angleDeg) || !Number.isFinite(fovDeg) || angleDeg <= 0 || fovDeg <= 0) return 0;
  const halfFovRad = (Math.max(1, fovDeg) * Math.PI) / 180 / 2;
  const tanHalfFov = Math.tan(halfFovRad);
  if (!Number.isFinite(tanHalfFov) || tanHalfFov === 0) return 0;
  const ratio = Math.tan((angleDeg * Math.PI) / 180) / tanHalfFov;
  if (!Number.isFinite(ratio)) return 1;
  return clamp(Math.abs(ratio), 0, 1);
}

export function normalizeVisionSearchWindow(window: VisionSearchWindow | null | undefined): VisionSearchWindow | null {
  if (!window) return null;
  const centerXNorm = clamp01(window.centerXNorm);
  const centerYNorm = clamp01(window.centerYNorm);
  const widthNorm = clamp(window.widthNorm, 0.08, 1);
  const heightNorm = clamp(window.heightNorm, 0.08, 1);
  if (!Number.isFinite(centerXNorm) || !Number.isFinite(centerYNorm)) return null;
  return { centerXNorm, centerYNorm, widthNorm, heightNorm };
}

export function buildVisionCropRect(
  fullWidthPx: number,
  fullHeightPx: number,
  window: VisionSearchWindow | null | undefined
): VisionFrameCropRect | null {
  const normalized = normalizeVisionSearchWindow(window);
  const width = Math.max(1, Math.floor(fullWidthPx || 0));
  const height = Math.max(1, Math.floor(fullHeightPx || 0));
  if (!normalized || width <= 0 || height <= 0) return null;

  const cropWidthPx = clamp(Math.round(width * normalized.widthNorm), 48, width);
  const cropHeightPx = clamp(Math.round(height * normalized.heightNorm), 48, height);
  const centerXPx = normalized.centerXNorm * width;
  const centerYPx = normalized.centerYNorm * height;
  const xPx = clamp(Math.round(centerXPx - cropWidthPx / 2), 0, Math.max(0, width - cropWidthPx));
  const yPx = clamp(Math.round(centerYPx - cropHeightPx / 2), 0, Math.max(0, height - cropHeightPx));

  return {
    xPx,
    yPx,
    widthPx: cropWidthPx,
    heightPx: cropHeightPx,
    fullWidthPx: width,
    fullHeightPx: height
  };
}

export function mapVisionNormPointFromCropRect(
  point: VisionNormPoint | null,
  cropRect: VisionFrameCropRect | null | undefined
): VisionNormPoint | null {
  if (!point) return null;
  if (!cropRect) {
    return {
      xNorm: clamp01(point.xNorm),
      yNorm: clamp01(point.yNorm)
    };
  }

  const xPx = cropRect.xPx + clamp01(point.xNorm) * cropRect.widthPx;
  const yPx = cropRect.yPx + clamp01(point.yNorm) * cropRect.heightPx;
  return {
    xNorm: clamp01(xPx / cropRect.fullWidthPx),
    yNorm: clamp01(yPx / cropRect.fullHeightPx)
  };
}
