import type { ArClientProfile } from '@/lib/ar/clientProfile';

export type TelemetrySessionType = 'start' | 'update' | 'end';
export type TimeToLockBucket = '<2s' | '2..5s' | '5..10s' | '10..20s' | '20..60s' | '60s+';
export type LockOnMode = 'auto' | 'manual_debug';

export type CameraGuideTelemetryPayload = {
  sessionId: string;
  launchId: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  runtimeFamily?: 'web' | 'ios_native' | 'android_native';
  clientEnv?:
    | 'ios_safari'
    | 'ios_chrome'
    | 'ios_firefox'
    | 'android_chrome'
    | 'android_firefox'
    | 'android_other'
    | 'desktop_chrome'
    | 'desktop_safari'
    | 'desktop_firefox'
    | 'desktop_edge'
    | 'desktop_other'
    | 'unknown';
  clientProfile?: ArClientProfile;
  screenBucket?: 'xs' | 'sm' | 'md' | 'lg' | 'unknown';
  cameraStatus?: 'granted' | 'denied' | 'prompt' | 'error';
  motionStatus?: 'granted' | 'denied' | 'prompt' | 'error';
  headingStatus?: 'ok' | 'unavailable' | 'noisy' | 'unknown';
  headingSource?:
    | 'webxr'
    | 'webkit_compass'
    | 'deviceorientation_absolute'
    | 'deviceorientation_tilt_comp'
    | 'deviceorientation_relative'
    | 'unknown';
  declinationApplied?: boolean;
  declinationSource?: 'wmm' | 'approx' | 'none';
  declinationMagBucket?: string;
  fusionEnabled?: boolean;
  fusionUsed?: boolean;
  fusionFallbackReason?: 'no_gyro' | 'no_gravity' | 'gravity_unreliable' | 'not_initialized' | null;
  poseSource?: 'webxr' | 'deviceorientation' | 'deviceorientationabsolute' | 'sky_compass';
  poseMode?: 'webxr' | 'sensor_fused';
  overlayMode?: 'precision' | 'guided' | 'search' | 'recover';
  visionBackend?: 'worker_roi' | 'main_thread_roi' | 'none';
  degradationTier?: 0 | 1 | 2 | 3;
  xrSupported?: boolean;
  xrUsed?: boolean;
  xrErrorBucket?: 'not_available' | 'unsupported' | 'webgl' | 'permission' | 'session_error' | 'unknown';
  renderLoopRunning?: boolean;
  canvasHidden?: boolean;
  poseUpdateRateBucket?: string;
  arLoopActiveMs?: number;
  skyCompassLoopActiveMs?: number;
  loopRestartCount?: number;
  modeEntered?: 'ar' | 'sky_compass';
  fallbackReason?: 'camera_denied' | 'motion_denied' | 'no_heading' | 'camera_error' | null;
  retryCount?: number;
  usedScrub?: boolean;
  scrubSecondsTotal?: number;
  eventTapCount?: number;
  lensPreset?: '0.5x' | '1x' | '2x' | '3x' | 'custom';
  corridorMode?: 'tight' | 'normal' | 'wide';
  lockOnMode?: LockOnMode;
  lockOnAttempted?: boolean;
  lockOnAcquired?: boolean;
  timeToLockBucket?: TimeToLockBucket;
  lockLossCount?: number;
  yawOffsetBucket?: string;
  pitchLevelBucket?: string;
  hfovBucket?: string;
  vfovBucket?: string;
  fovSource?: 'xr' | 'preset' | 'saved' | 'inferred' | 'default' | 'unknown';
  zoomSupported?: boolean;
  zoomRatioBucket?: string;
  zoomControlPath?: 'native_camera' | 'track_constraints' | 'preset_fallback' | 'unsupported';
  zoomApplyLatencyBucket?: string;
  zoomProjectionSyncLatencyBucket?: string;
  projectionSource?: 'intrinsics_frame' | 'projection_matrix' | 'inferred_fov' | 'preset';
  tier?: 0 | 1 | 2 | 3;
  trajectoryVersion?: string;
  durationS?: number;
  stepS?: number;
  avgSigmaDeg?: number;
  confidenceTierSeen?: 'A' | 'B' | 'C' | 'D';
  contractTier?: 'A' | 'B' | 'C' | 'D';
  trajectoryAuthorityTier?:
    | 'partner_feed'
    | 'official_numeric'
    | 'regulatory_constrained'
    | 'supplemental_ephemeris'
    | 'public_metadata'
    | 'model_prior';
  trajectoryQualityState?: 'precision' | 'guided' | 'search' | 'pad_only';
  renderTier?: 'high' | 'medium' | 'low' | 'unknown';
  droppedFrameBucket?: string;
};

export function newSessionId() {
  const cryptoObj = (globalThis as any).crypto as Crypto | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `sess_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export async function telemetryPost(type: TelemetrySessionType, payload: CameraGuideTelemetryPayload) {
  await fetch('/api/public/ar/telemetry/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, payload })
  }).catch(() => {});
}

export function telemetryPostBeacon(type: TelemetrySessionType, payload: CameraGuideTelemetryPayload) {
  const body = JSON.stringify({ type, payload });
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon('/api/public/ar/telemetry/session', body);
    return;
  }
  fetch('/api/public/ar/telemetry/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true
  }).catch(() => {});
}
