import type { ArClientProfile } from '@/lib/ar/clientProfile';
import type { VisionTrackerBackend } from '@/lib/ar/visionTrackerClient';

export type ArRuntimePoseMode = 'webxr' | 'sensor_fused';
export type ArRuntimeXrLaunchState = 'idle' | 'starting' | 'healthy' | 'blocked';

export type ArRuntimeDecision = {
  poseMode: ArRuntimePoseMode;
  visionBackend: VisionTrackerBackend | 'none';
  degradationTier: 0 | 1 | 2 | 3;
  reasons: string[];
};

type SelectArRuntimeOptions = {
  profile: ArClientProfile;
  xrSupport: 'unknown' | 'supported' | 'unsupported';
  xrActive: boolean;
  xrLaunchState: ArRuntimeXrLaunchState;
  cameraActive: boolean;
  cameraError: string | null;
  motionPermission: 'unknown' | 'granted' | 'denied';
  workerVisionSupported: boolean;
  mainThreadVisionSupported: boolean;
  telemetryRecommendedPoseMode?: ArRuntimePoseMode | null;
};

function defaultWebXrPreference(profile: ArClientProfile) {
  return profile === 'android_chrome' || profile === 'desktop_debug';
}

export function selectArRuntime({
  profile,
  xrSupport,
  xrActive,
  xrLaunchState,
  cameraActive,
  cameraError,
  motionPermission,
  workerVisionSupported,
  mainThreadVisionSupported,
  telemetryRecommendedPoseMode
}: SelectArRuntimeOptions): ArRuntimeDecision {
  const reasons: string[] = [];
  const preferWebXr =
    telemetryRecommendedPoseMode != null ? telemetryRecommendedPoseMode === 'webxr' : defaultWebXrPreference(profile);

  let poseMode: ArRuntimePoseMode = 'sensor_fused';
  if (xrActive) {
    poseMode = 'webxr';
    reasons.push('webxr session active');
  } else if (xrLaunchState === 'blocked') {
    reasons.push('webxr startup blocked after failed health probe');
  } else if (preferWebXr && xrSupport === 'supported' && cameraActive && !cameraError) {
    poseMode = 'webxr';
    if (telemetryRecommendedPoseMode === 'webxr' && !defaultWebXrPreference(profile)) {
      reasons.push('telemetry promoted this profile to webxr-first');
    } else {
      reasons.push(
        xrLaunchState === 'starting'
          ? 'webxr startup in progress'
          : 'webxr-preferred profile with immersive-ar support and camera ready'
      );
    }
  } else if (preferWebXr && xrSupport === 'supported') {
    reasons.push(cameraError ? 'webxr supported but camera is unavailable' : 'webxr supported but waiting for camera readiness');
  } else if (telemetryRecommendedPoseMode === 'sensor_fused' && defaultWebXrPreference(profile)) {
    reasons.push('telemetry demoted this profile to sensor-first');
  } else if (defaultWebXrPreference(profile) && xrSupport === 'supported') {
    reasons.push('webxr supported but profile still gated to sensor path');
  } else if (profile === 'android_samsung_internet') {
    reasons.push('samsung internet remains sensor-first until promoted by field evidence');
  } else if (profile === 'ios_webkit') {
    reasons.push('ios webkit uses sensor-fused path');
  } else {
    reasons.push('sensor-fused path selected');
  }

  let visionBackend: VisionTrackerBackend | 'none' = 'none';
  if (!cameraActive) {
    reasons.push('camera not active');
  } else if (cameraError) {
    reasons.push('camera error present');
  } else if (motionPermission !== 'granted') {
    reasons.push('motion permission not granted');
  } else if (workerVisionSupported) {
    visionBackend = 'worker_roi';
    reasons.push('worker ROI tracker available');
  } else if (mainThreadVisionSupported) {
    visionBackend = 'main_thread_roi';
    reasons.push('main-thread ROI tracker fallback available');
  } else {
    reasons.push('vision tracker unavailable');
  }

  let degradationTier: 0 | 1 | 2 | 3 = 0;
  if (visionBackend === 'main_thread_roi') degradationTier = 1;
  if (visionBackend === 'none') degradationTier = 2;
  if (cameraError || motionPermission === 'denied') degradationTier = 3;

  return {
    poseMode,
    visionBackend,
    degradationTier,
    reasons
  };
}
