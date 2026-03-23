import type { CameraGuideTelemetryPayload } from '@/lib/ar/telemetryClient';

type MaterialTelemetryFields = Pick<
  CameraGuideTelemetryPayload,
  | 'cameraStatus'
  | 'motionStatus'
  | 'headingStatus'
  | 'headingSource'
  | 'poseMode'
  | 'overlayMode'
  | 'visionBackend'
  | 'degradationTier'
  | 'xrUsed'
  | 'xrErrorBucket'
  | 'modeEntered'
  | 'fallbackReason'
  | 'corridorMode'
  | 'lockOnAttempted'
  | 'lockOnAcquired'
  | 'timeToLockBucket'
  | 'lockLossCount'
  | 'trajectoryAuthorityTier'
  | 'trajectoryQualityState'
  | 'renderTier'
  | 'droppedFrameBucket'
  | 'zoomControlPath'
  | 'zoomRatioBucket'
>;

export function deriveArTelemetryUpdateCadenceMs(input: MaterialTelemetryFields) {
  if (input.modeEntered === 'sky_compass' || input.fallbackReason) return 2000;
  if (input.xrErrorBucket) return 2000;
  if (input.overlayMode === 'search' || input.overlayMode === 'recover') return 2000;
  if (typeof input.degradationTier === 'number' && input.degradationTier >= 2) return 2000;
  if (!input.lockOnAcquired) return 3000;
  if (input.overlayMode === 'guided') return 4000;
  if (typeof input.degradationTier === 'number' && input.degradationTier === 1) return 4000;
  if (input.renderTier === 'low') return 4000;
  return 6000;
}

export function buildArTelemetryMaterialKey(input: MaterialTelemetryFields) {
  return JSON.stringify([
    input.cameraStatus ?? '',
    input.motionStatus ?? '',
    input.headingStatus ?? '',
    input.headingSource ?? '',
    input.poseMode ?? '',
    input.overlayMode ?? '',
    input.visionBackend ?? '',
    input.degradationTier ?? '',
    input.xrUsed ?? '',
    input.xrErrorBucket ?? '',
    input.modeEntered ?? '',
    input.fallbackReason ?? '',
    input.corridorMode ?? '',
    input.lockOnAttempted ?? '',
    input.lockOnAcquired ?? '',
    input.timeToLockBucket ?? '',
    input.lockLossCount ?? '',
    input.trajectoryAuthorityTier ?? '',
    input.trajectoryQualityState ?? '',
    input.renderTier ?? '',
    input.droppedFrameBucket ?? '',
    input.zoomControlPath ?? '',
    input.zoomRatioBucket ?? ''
  ]);
}

export function shouldSendArTelemetryUpdate({
  nowMs,
  lastSentAtMs,
  lastMaterialKey,
  nextMaterialKey,
  cadenceMs
}: {
  nowMs: number;
  lastSentAtMs: number | null;
  lastMaterialKey: string | null;
  nextMaterialKey: string;
  cadenceMs: number;
}) {
  if (!Number.isFinite(nowMs)) return true;
  if (lastSentAtMs == null || !Number.isFinite(lastSentAtMs)) return true;
  if (!lastMaterialKey || lastMaterialKey !== nextMaterialKey) return true;
  return nowMs - lastSentAtMs >= cadenceMs;
}
