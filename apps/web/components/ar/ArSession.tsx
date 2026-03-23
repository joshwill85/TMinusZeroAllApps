"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { bearingDegrees, getDeclinationDeg, normalizeAngleDelta, type DeclinationSource } from '@/lib/ar/geo';
import { azElFromEnu, ecefFromLatLon, enuFromEcef } from '@/lib/ar/ecef';
import { wrapAngle360 } from '@/lib/ar/angles';
import {
  DEFAULT_ALIGNMENT_FEEDBACK,
  deriveAlignmentFeedback,
  type AlignmentFeedback
} from '@/lib/ar/alignmentFeedback';
import {
  TrajectoryAzElPoint,
  clamp,
  interpolateTrajectory,
  normalizeTrajectoryCovariance,
  normalizeTrajectoryUncertainty,
  readTrajectoryPointCovariance,
  readTrajectoryPointSigmaDeg
} from '@/lib/ar/trajectory';
import { detectArClientProfile, getArClientProfilePolicy, type ArClientProfile } from '@/lib/ar/clientProfile';
import {
  newSessionId,
  telemetryPost,
  telemetryPostBeacon,
  type LockOnMode,
  type TimeToLockBucket
} from '@/lib/ar/telemetryClient';
import {
  buildArTelemetryMaterialKey,
  deriveArTelemetryUpdateCadenceMs,
  shouldSendArTelemetryUpdate
} from '@/lib/ar/telemetryCadence';
import {
  createVisionTrackerClient,
  isMainThreadVisionTrackerSupported,
  isWorkerVisionTrackerSupported,
  type VisionTrackerClient,
  type VisionTrackerBackend,
  type VisionTrackerRuntimeBudget
} from '@/lib/ar/visionTrackerClient';
import type { VisionNormPoint, VisionPredictionPoint, VisionSearchWindow } from '@/lib/ar/visionTrackerProtocol';
import {
  angularSpanNormForFov,
  projectAzElToViewportNorm,
  viewportNormToAngleOffsetsDeg
} from '@/lib/ar/visionTrackerWindow';
import {
  advanceArPerformanceGovernor,
  getArPerformancePolicy,
  type ArMilestoneDensity,
  type ArPerformanceTier
} from '@/lib/ar/performanceGovernor';
import { fetchArRuntimePolicyOverride, readCachedArRuntimePolicyOverride } from '@/lib/ar/runtimePolicyClient';
import { shouldAutoStartWebXr } from '@/lib/ar/runtimeStartupPolicy';
import { deriveArSessionStatusView, deriveArTelemetryEntryState } from '@/lib/ar/sessionStatus';
import { selectArRuntime, type ArRuntimeXrLaunchState } from '@/lib/ar/runtimeSelector';
import {
  dedupeTrajectoryReasonLabels,
  formatTrajectoryAuthorityTierLabel,
  formatTrajectoryFieldConfidenceLabel,
  formatTrajectoryMilestoneOffsetLabel,
  formatTrajectoryQualityStateLabel,
  TrajectoryAuthorityTier,
  TrajectoryContract,
  TrajectoryMilestonePayload,
  TrajectoryQualityState,
  TrajectoryTrackKind
} from '@tminuszero/domain';
import { ArBottomPanel } from '@/components/ar/ArBottomPanel';
import { SkyCompass } from '@/components/ar/SkyCompass';
import { formatTMinus, formatTPlus, useTrajectoryTime } from '@/components/ar/useTrajectoryTime';

type ArPad = {
  name: string;
  latitude?: number;
  longitude?: number;
  source?: 'public_cache' | 'll2_pad';
  canonicalDeltaKm?: number | null;
};

type ArSessionProps = {
  launchId: string;
  launchName: string;
  pad: ArPad;
  net?: string;
  backHref: string;
  trajectory?: TrajectoryContract | null;
};

type ArTrajectoryTrackPointMap = Partial<Record<TrajectoryTrackKind, TrajectoryAzElPoint[]>>;

type MotionPermissionState = 'unknown' | 'granted' | 'denied';
type PoseSource = 'webxr' | 'deviceorientation' | 'deviceorientationabsolute' | 'sky_compass';
type HeadingSource =
  | 'webxr'
  | 'webkit_compass'
  | 'deviceorientation_absolute'
  | 'deviceorientation_tilt_comp'
  | 'deviceorientation_relative'
  | 'unknown';
type FovSource = 'xr' | 'preset' | 'saved' | 'inferred' | 'default' | 'unknown';
type ZoomControlPath = 'native_camera' | 'track_constraints' | 'preset_fallback' | 'unsupported';
type ProjectionSource = 'intrinsics_frame' | 'projection_matrix' | 'inferred_fov' | 'preset';
type XrErrorBucket = 'not_available' | 'unsupported' | 'webgl' | 'permission' | 'session_error' | 'unknown';
type FusionFallbackReason = 'disabled' | 'no_gyro' | 'no_gravity' | 'gravity_unreliable' | 'not_initialized';
type TrajectoryConfidenceTier = 'A' | 'B' | 'C' | 'D';
type RenderTier = 'high' | 'medium' | 'low' | 'unknown';
type PitchSource = 'deviceorientation' | 'devicemotion_gravity' | 'unknown';
type OverlayMode = 'precision' | 'guided' | 'search' | 'recover';
type FrameStats = {
  lastFrameAtMs: number | null;
  frames: number;
  dropped: number;
};

type RenderPerformanceWindow = {
  frameCount: number;
  dtTotalMs: number;
  slowFrameCount: number;
  severeFrameCount: number;
};

type LockOnOverlayState = {
  centerNorm: VisionNormPoint | null;
  predictions: VisionPredictionPoint[];
  confidence: number;
  status: 'searching' | 'tracking' | 'lost';
  updatedAtMs: number | null;
};

const AR_MOTION_PERMISSION_SESSION_KEY = 'ar:motionPermission';
const AR_LOCK_ON_FLAG_ENABLED = process.env.NEXT_PUBLIC_AR_LOCK_ON_V1 === '1';
const AR_LOCK_ON_MANUAL_DEBUG_ENABLED = process.env.NEXT_PUBLIC_AR_LOCK_ON_MANUAL_DEBUG === '1';
const AR_DEBUG_PANELS_ENABLED = process.env.NEXT_PUBLIC_AR_DEBUG_PANELS === '1';
const AR_MANUAL_CALIBRATION_UI_ENABLED = process.env.NEXT_PUBLIC_AR_MANUAL_CALIBRATION_DEBUG === '1';
const AR_LEGACY_CALIBRATION_FLOW_ENABLED = AR_MANUAL_CALIBRATION_UI_ENABLED;
const AR_DEBUG_CALIBRATION_STORAGE_ENABLED = AR_MANUAL_CALIBRATION_UI_ENABLED || AR_DEBUG_PANELS_ENABLED;
const LOCK_ON_ACQUIRE_CONFIDENCE = 0.62;
const LOCK_ON_LOST_CONFIDENCE = 0.2;
const LOCK_ON_DRAW_CONFIDENCE = 0.3;
const AUTO_CALIBRATION_ARM_MS = 1200;
const AUTO_CALIBRATION_MAX_ATTEMPTS = 2;
const AUTO_ALIGNMENT_INTERVAL_MS = 250;
const AUTO_ALIGNMENT_MIN_CONFIDENCE = 0.72;
const AUTO_ALIGNMENT_MAX_YAW_BIAS_DEG = 12;
const AUTO_ALIGNMENT_MAX_PITCH_BIAS_DEG = 8;
const AUTO_ALIGNMENT_READY_SCORE = 6;
const WEB_ZOOM_MIN_GLOBAL = 0.5;
const WEB_ZOOM_MAX_GLOBAL = 3.0;
const WEB_PINCH_ZOOM_STEP = 0.1;

function roundedMetric(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 4) / 4;
}

function sameAlignmentFeedback(prev: AlignmentFeedback, next: AlignmentFeedback) {
  return (
    prev.stability === next.stability &&
    prev.biasConfidence === next.biasConfidence &&
    prev.recommendedCorridorMode === next.recommendedCorridorMode &&
    prev.readyForPrecision === next.readyForPrecision &&
    roundedMetric(prev.averageConfidence) === roundedMetric(next.averageConfidence) &&
    roundedMetric(prev.yawMeanDeg) === roundedMetric(next.yawMeanDeg) &&
    roundedMetric(prev.pitchMeanDeg) === roundedMetric(next.pitchMeanDeg) &&
    roundedMetric(prev.yawStdDeg) === roundedMetric(next.yawStdDeg) &&
    roundedMetric(prev.pitchStdDeg) === roundedMetric(next.pitchStdDeg)
  );
}

function statusCardToneClasses(tone: 'neutral' | 'warning' | 'danger') {
  if (tone === 'danger') {
    return {
      border: 'border-red-400/30',
      bg: 'bg-red-500/10',
      eyebrow: 'text-red-100/70',
      title: 'text-red-50',
      body: 'text-red-100/85',
      footnote: 'text-red-100/60'
    };
  }
  if (tone === 'warning') {
    return {
      border: 'border-amber-400/30',
      bg: 'bg-amber-500/10',
      eyebrow: 'text-amber-100/70',
      title: 'text-amber-50',
      body: 'text-amber-100/85',
      footnote: 'text-amber-100/60'
    };
  }
  return {
    border: 'border-white/15',
    bg: 'bg-black/55',
    eyebrow: 'text-white/55',
    title: 'text-white/92',
    body: 'text-white/75',
    footnote: 'text-white/50'
  };
}

function bucketDegrees(value: number, bucketSize: number, min: number, max: number) {
  const v = Math.min(max, Math.max(min, value));
  const start = Math.floor(v / bucketSize) * bucketSize;
  const end = start + bucketSize;
  return `${start}..${end}`;
}

function bucketPoseUpdateHz(hz: number) {
  if (!Number.isFinite(hz) || hz <= 0) return '0';
  if (hz < 5) return '0..5';
  if (hz < 15) return '5..15';
  if (hz < 30) return '15..30';
  if (hz < 60) return '30..60';
  return '60+';
}

function bucketDroppedFrameRatio(ratio: number) {
  if (!Number.isFinite(ratio) || ratio < 0) return 'unknown';
  if (ratio < 0.01) return '0..1';
  if (ratio < 0.05) return '1..5';
  if (ratio < 0.15) return '5..15';
  if (ratio < 0.3) return '15..30';
  return '30+';
}

function bucketZoomRatio(value: number | null, supported: boolean) {
  if (!supported || value == null || !Number.isFinite(value) || value <= 0) return 'unsupported';
  if (value < 0.75) return '0.5..0.75';
  if (value < 1.0) return '0.75..1.0';
  if (value < 1.5) return '1.0..1.5';
  if (value < 2.0) return '1.5..2.0';
  if (value < 2.5) return '2.0..2.5';
  if (value < 3.0) return '2.5..3.0';
  return '3.0+';
}

function bucketLatencyMs(value: number | null) {
  if (value == null || !Number.isFinite(value) || value < 0) return 'unknown';
  if (value < 16) return '<16ms';
  if (value < 33) return '16..33ms';
  if (value < 50) return '33..50ms';
  if (value < 100) return '50..100ms';
  return '100ms+';
}

function bucketTimeToLockMs(durationMs: number | null): TimeToLockBucket | undefined {
  if (!Number.isFinite(durationMs) || durationMs == null || durationMs < 0) return undefined;
  const sec = durationMs / 1000;
  if (sec < 2) return '<2s';
  if (sec < 5) return '2..5s';
  if (sec < 10) return '5..10s';
  if (sec < 20) return '10..20s';
  if (sec < 60) return '20..60s';
  return '60s+';
}

function droppedFrameRatioFromStats(stats: FrameStats) {
  const total = stats.frames + stats.dropped;
  if (total <= 0) return Number.NaN;
  return stats.dropped / total;
}

function inferRenderTier({
  poseSource,
  cameraStatus,
  motionStatus,
  headingStatus,
  renderLoopRunning,
  droppedFrameRatio
}: {
  poseSource: PoseSource;
  cameraStatus: 'granted' | 'denied' | 'prompt' | 'error';
  motionStatus: 'granted' | 'denied' | 'prompt' | 'error';
  headingStatus: 'ok' | 'unavailable' | 'noisy' | 'unknown';
  renderLoopRunning: boolean;
  droppedFrameRatio: number;
}): RenderTier {
  if (!renderLoopRunning) return 'unknown';
  if (poseSource === 'sky_compass') return 'low';
  if (poseSource === 'webxr') {
    if (!Number.isFinite(droppedFrameRatio) || droppedFrameRatio <= 0.05) return 'high';
    if (droppedFrameRatio <= 0.2) return 'medium';
    return 'low';
  }

  if (cameraStatus !== 'granted' || motionStatus !== 'granted') return 'low';
  if (headingStatus === 'noisy' || headingStatus === 'unavailable') return 'low';
  if (!Number.isFinite(droppedFrameRatio)) return headingStatus === 'ok' ? 'medium' : 'unknown';
  if (droppedFrameRatio <= 0.1) return 'medium';
  return 'low';
}

function bucketXrError(message: string | null): XrErrorBucket | undefined {
  if (!message) return undefined;
  const m = message.toLowerCase();
  if (m.includes('not available')) return 'not_available';
  if (m.includes('not supported') || m.includes('unsupported')) return 'unsupported';
  if (m.includes('webgl')) return 'webgl';
  if (m.includes('denied') || m.includes('notallowed') || m.includes('not allowed') || m.includes('permission') || m.includes('security')) {
    return 'permission';
  }
  if (m.includes('failed') || m.includes('session')) return 'session_error';
  return 'unknown';
}

function detectClientEnv(ua: string) {
  const u = (ua || '').toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(u);
  const isAndroid = /android/.test(u);

  if (isIos) {
    if (u.includes('crios')) return 'ios_chrome' as const;
    if (u.includes('fxios')) return 'ios_firefox' as const;
    if (u.includes('safari')) return 'ios_safari' as const;
    return 'unknown' as const;
  }

  if (isAndroid) {
    if (u.includes('firefox')) return 'android_firefox' as const;
    if (u.includes('samsungbrowser')) return 'android_other' as const;
    if (u.includes('chrome') || u.includes('chromium') || u.includes('edga')) return 'android_chrome' as const;
    return 'android_other' as const;
  }

  if (u.includes('edg/')) return 'desktop_edge' as const;
  if (u.includes('firefox')) return 'desktop_firefox' as const;
  if (u.includes('chrome') && !u.includes('edg/')) return 'desktop_chrome' as const;
  if (u.includes('safari') && !u.includes('chrome')) return 'desktop_safari' as const;
  if (u) return 'desktop_other' as const;
  return 'unknown' as const;
}

function detectScreenBucket() {
  if (typeof window === 'undefined') return 'unknown' as const;
  const w = Number(window.screen?.width ?? window.innerWidth);
  const h = Number(window.screen?.height ?? window.innerHeight);
  const minDim = Math.min(w || 0, h || 0);
  if (!Number.isFinite(minDim) || minDim <= 0) return 'unknown' as const;
  if (minDim < 360) return 'xs' as const;
  if (minDim < 400) return 'sm' as const;
  if (minDim < 480) return 'md' as const;
  return 'lg' as const;
}

function corridorModeForQuality(defaultOverlayMode: 'precision' | 'guided' | 'search'): 'tight' | 'normal' | 'wide' {
  if (defaultOverlayMode === 'precision') return 'tight';
  if (defaultOverlayMode === 'guided') return 'normal';
  return 'wide';
}

function resolveAuthorityTrustScore(authorityTier: TrajectoryAuthorityTier, trustScore?: number | null) {
  if (typeof trustScore === 'number' && Number.isFinite(trustScore)) {
    return clamp(trustScore, 0.15, 1);
  }
  if (authorityTier === 'partner_feed' || authorityTier === 'official_numeric') return 1;
  if (authorityTier === 'regulatory_constrained' || authorityTier === 'supplemental_ephemeris') return 0.82;
  if (authorityTier === 'public_metadata') return 0.6;
  return 0.35;
}

function authorityWindowMultiplier(authorityTier: TrajectoryAuthorityTier, trustScore?: number | null) {
  const resolved = resolveAuthorityTrustScore(authorityTier, trustScore);
  if (resolved >= 0.88) return 0.9;
  if (resolved >= 0.72) return 1.02;
  if (resolved >= 0.56) return 1.18;
  if (resolved >= 0.4) return 1.34;
  return 1.5;
}

function corridorScaleForMode(mode: 'tight' | 'normal' | 'wide') {
  if (mode === 'tight') return 0.6;
  if (mode === 'wide') return 1.6;
  return 1;
}

function buildVisionRuntimeBudget(
  backend: VisionTrackerBackend | 'none',
  degradationTier: ArPerformanceTier
): VisionTrackerRuntimeBudget {
  if (backend === 'main_thread_roi') {
    if (degradationTier >= 3) return { targetFps: 8, captureWidth: 192, maxFramesInFlight: 1 };
    if (degradationTier === 2) return { targetFps: 10, captureWidth: 224, maxFramesInFlight: 1 };
    if (degradationTier === 1) return { targetFps: 12, captureWidth: 256, maxFramesInFlight: 1 };
    return { targetFps: 14, captureWidth: 288, maxFramesInFlight: 2 };
  }

  if (backend === 'worker_roi') {
    if (degradationTier >= 3) return { targetFps: 8, captureWidth: 224, maxFramesInFlight: 1 };
    if (degradationTier === 2) return { targetFps: 12, captureWidth: 256, maxFramesInFlight: 1 };
    if (degradationTier === 1) return { targetFps: 16, captureWidth: 288, maxFramesInFlight: 2 };
    return { targetFps: 18, captureWidth: 320, maxFramesInFlight: 2 };
  }

  return { targetFps: 8, captureWidth: 192, maxFramesInFlight: 1 };
}

function confidenceCorrectionWeight(tier: TrajectoryConfidenceTier | null | undefined) {
  if (tier === 'A') return 1;
  if (tier === 'B') return 0.78;
  if (tier === 'C') return 0.52;
  return 0.35;
}

function authorityCorrectionWeight(authorityTier: TrajectoryAuthorityTier, trustScore?: number | null) {
  return resolveAuthorityTrustScore(authorityTier, trustScore);
}

type OneEuroFilterState = {
  xHat: number | null;
  dxHat: number | null;
};

type FusionState = {
  enabled: boolean;
  used: boolean;
  fallbackReason: FusionFallbackReason | null;
  yawSign: 1 | -1;
  headingUnwrapped: number | null;
  headingAtLastMeasurementUnwrapped: number | null;
  lastMeasurementHeading: number | null;
  lastMeasurementAtMs: number | null;
  lastMotionAtMs: number | null;
  lastOutputAtMs: number | null;
  gyroAtMs: number | null;
  gravityAtMs: number | null;
  gravity: { x: number; y: number; z: number } | null;
};

function tiltCompensatedHeadingDegrees(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenAngleSignedDeg: number
): { headingDeg: number; mag: number } | null {
  if (!Number.isFinite(alphaDeg) || !Number.isFinite(betaDeg) || !Number.isFinite(gammaDeg)) return null;
  const alpha = (alphaDeg * Math.PI) / 180;
  const beta = (betaDeg * Math.PI) / 180;
  const gamma = (gammaDeg * Math.PI) / 180;

  const cX = Math.cos(beta);
  const sX = Math.sin(beta);
  const cY = Math.cos(gamma);
  const sY = Math.sin(gamma);
  const cZ = Math.cos(alpha);
  const sZ = Math.sin(alpha);

  const vX = -cZ * sY - sZ * sX * cY;
  const vY = -sZ * sY + cZ * sX * cY;
  const mag = Math.hypot(vX, vY);
  if (!(mag > 1e-6)) return null;

  const headingDeg = Math.atan2(vX, vY) * (180 / Math.PI);
  return { headingDeg: wrapAngle360(headingDeg + screenAngleSignedDeg), mag };
}

function lowPassAlpha(cutoffHz: number, dtSec: number) {
  if (!(cutoffHz > 0) || !(dtSec > 0)) return 1;
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

function oneEuroUpdate(
  state: OneEuroFilterState,
  x: number,
  dtSecRaw: number,
  params: { minCutoff: number; beta: number; dCutoff: number }
) {
  if (!Number.isFinite(x)) return state.xHat ?? x;
  const dtSec = clamp(dtSecRaw, 0.004, 0.25);
  if (state.xHat == null) {
    state.xHat = x;
    state.dxHat = 0;
    return x;
  }
  const dx = (x - state.xHat) / dtSec;
  const aD = lowPassAlpha(params.dCutoff, dtSec);
  state.dxHat = state.dxHat == null ? dx : aD * dx + (1 - aD) * state.dxHat;
  const cutoff = Math.max(0.01, params.minCutoff + params.beta * Math.abs(state.dxHat));
  const a = lowPassAlpha(cutoff, dtSec);
  state.xHat = a * x + (1 - a) * state.xHat;
  return state.xHat;
}

function haversineKm(lat1Deg: number, lon1Deg: number, lat2Deg: number, lon2Deg: number) {
  const toRad = Math.PI / 180;
  const lat1 = lat1Deg * toRad;
  const lon1 = lon1Deg * toRad;
  const lat2 = lat2Deg * toRad;
  const lon2 = lon2Deg * toRad;
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLon = Math.sin(dLon / 2);
  const a = sinHalfLat * sinHalfLat + Math.cos(lat1) * Math.cos(lat2) * sinHalfLon * sinHalfLon;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(1 - a, 0)));
  return 6371 * c;
}

export function ArSession({ launchId, launchName, pad, net, backHref, trajectory }: ArSessionProps) {
  const detectedClientProfile = detectArClientProfile(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const initialRuntimePolicy = readCachedArRuntimePolicyOverride(detectedClientProfile);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const xrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationAttempt, setLocationAttempt] = useState(0);
  const [location, setLocation] = useState<{
    lat: number;
    lon: number;
    accuracy?: number;
    altMeters?: number | null;
    altAccuracy?: number | null;
  } | null>(null);
  const locationLatestRef = useRef<typeof location>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [pitch, setPitch] = useState<number | null>(null);
  const [roll, setRoll] = useState<number | null>(null);
  const [yawOffset, setYawOffset] = useState<number>(0);
  const [pitchOffset, setPitchOffset] = useState<number>(0);
  const [autoYawBias, setAutoYawBias] = useState<number>(0);
  const [autoPitchBias, setAutoPitchBias] = useState<number>(0);
  const [fovX, setFovX] = useState<number>(70);
  const [fovY, setFovY] = useState<number>(45);
  const [lensPreset, setLensPreset] = useState<'0.5x' | '1x' | '2x' | '3x' | 'custom'>('custom');
  const [zoomTrayOpen, setZoomTrayOpen] = useState(false);
  const [zoomSupported, setZoomSupported] = useState(false);
  const [zoomRatio, setZoomRatio] = useState(1);
  const [zoomRangeMin, setZoomRangeMin] = useState(1);
  const [zoomRangeMax, setZoomRangeMax] = useState(1);
  const [zoomControlPath, setZoomControlPath] = useState<ZoomControlPath>('unsupported');
  const [zoomInputToApplyMs, setZoomInputToApplyMs] = useState<number | null>(null);
  const [zoomApplyToProjectionSyncMs, setZoomApplyToProjectionSyncMs] = useState<number | null>(null);
  const [projectionSource, setProjectionSource] = useState<ProjectionSource>('preset');
  const [corridorMode, setCorridorMode] = useState<'tight' | 'normal' | 'wide'>('tight');
  const [highContrast] = useState<boolean>(true);
  const [showCalibration, setShowCalibration] = useState(false);
  const [showWizard, setShowWizard] = useState(AR_LEGACY_CALIBRATION_FLOW_ENABLED);
  const [calibrationNotice, setCalibrationNotice] = useState<string | null>(null);
	  const [showQualityHelp, setShowQualityHelp] = useState(false);
		const [showConfidenceInfo, setShowConfidenceInfo] = useState(false);
	  const [showMilestones, setShowMilestones] = useState(true);
	  const [advancedFusionEnabled, setAdvancedFusionEnabled] = useState(false);
    const [traceRecording, setTraceRecording] = useState(false);
	  const [lockOnEnabled, setLockOnEnabled] = useState(!AR_LOCK_ON_MANUAL_DEBUG_ENABLED);
	  const [lockOnAttempted, setLockOnAttempted] = useState(false);
	  const [lockOnAcquired, setLockOnAcquired] = useState(false);
	  const [lockOnTimeToLockBucket, setLockOnTimeToLockBucket] = useState<TimeToLockBucket | null>(null);
	  const [lockOnLossCount, setLockOnLossCount] = useState(0);
	  const [reducedEffects, setReducedEffects] = useState(false);
  const [performanceTier, setPerformanceTier] = useState<ArPerformanceTier>(0);
  const [xrSupport, setXrSupport] = useState<'unknown' | 'supported' | 'unsupported'>('unknown');
	  const [xrActive, setXrActive] = useState(false);
	  const [xrError, setXrError] = useState<string | null>(null);
  const [xrLaunchState, setXrLaunchState] = useState<ArRuntimeXrLaunchState>('idle');
  const [runtimePolicyPoseOverride, setRuntimePolicyPoseOverride] = useState<'webxr' | 'sensor_fused' | null>(
    initialRuntimePolicy.override?.poseMode ?? null
  );
  const [runtimePolicyHydrated, setRuntimePolicyHydrated] = useState(initialRuntimePolicy.resolved);
  const [poseSource, setPoseSource] = useState<PoseSource>('sky_compass');
  const [headingStability, setHeadingStability] = useState<'good' | 'fair' | 'poor' | null>(null);
  const [motionPermission, setMotionPermission] = useState<MotionPermissionState>('unknown');
  const [retryCount, setRetryCount] = useState(0);
  const [autoAlignmentReady, setAutoAlignmentReady] = useState(false);
  const [alignmentFeedback, setAlignmentFeedback] = useState<AlignmentFeedback>(DEFAULT_ALIGNMENT_FEEDBACK);
  const [calibrationReady, setCalibrationReady] = useState(false);
  const [corridorModeInitialized, setCorridorModeInitialized] = useState(false);
  const [isCalibratingYaw, setIsCalibratingYaw] = useState(false);
  const calibrationLoadedRef = useRef(false);
  const calibrationKeyRef = useRef<string>('arCalibration');
  const skipFirstCalibrationSaveRef = useRef(true);
  const traceRef = useRef<{
    schemaVersion: 1;
    startedAtIso: string;
    launchId: string;
    launchName: string;
    net: string | null;
    pad: { name: string; latitude: number | null; longitude: number | null };
    intervalMs: number;
    maxSamples: number;
    samples: Array<Record<string, unknown>>;
  } | null>(null);
  const traceIntervalIdRef = useRef<number | null>(null);
	  const corridorModeLoadedRef = useRef(false);
	  const corridorModeDefaultedRef = useRef(false);
	  const hasCalibratedRef = useRef(false);
	  const fovAutoInferredRef = useRef(false);
	  const zoomBaselineFovRef = useRef<{ fovXAt1x: number; fovYAt1x: number } | null>(null);
	  const zoomApplyStateRef = useRef<{
	    inFlight: boolean;
	    queuedTarget: number | null;
	    lastApplyAtMs: number;
	    syncStartedAtMs: number | null;
	  }>({
	    inFlight: false,
	    queuedTarget: null,
	    lastApplyAtMs: 0,
	    syncStartedAtMs: null
	  });
	  const pinchZoomRef = useRef<{
	    active: boolean;
	    startDistance: number;
	    startZoom: number;
	  }>({
	    active: false,
	    startDistance: 0,
	    startZoom: 1
	  });
	  const yawCalIntervalRef = useRef<number | null>(null);
  const autoCalibrateArmedAtMsRef = useRef<number | null>(null);
  const autoCalibrateAttemptCountRef = useRef(0);
  const autoAlignmentScoreRef = useRef(0);
  const autoAlignmentResidualsRef = useRef<Array<{ yawDeg: number; pitchDeg: number; confidence: number }>>([]);
  const alignmentFeedbackRef = useRef<AlignmentFeedback>(DEFAULT_ALIGNMENT_FEEDBACK);
  const performanceGovernorRef = useRef<{ tier: ArPerformanceTier; recoveryStreak: number }>({
    tier: 0,
    recoveryStreak: 0
  });
  const renderPerformanceWindowRef = useRef<RenderPerformanceWindow>({
    frameCount: 0,
    dtTotalMs: 0,
    slowFrameCount: 0,
    severeFrameCount: 0
  });
	  const xrSessionRef = useRef<any>(null);
	  const xrRefSpaceRef = useRef<any>(null);
	  const xrGlRef = useRef<any>(null);
  const xrFovRef = useRef<{ fovX: number; fovY: number } | null>(null);
  const xrAutoStartAttemptedRef = useRef(false);
  const xrStartupProbeRef = useRef<{
    timeoutId: number | null;
    startedAtMs: number | null;
    firstPoseAtMs: number | null;
    frameStats: FrameStats;
  }>({
    timeoutId: null,
    startedAtMs: null,
    firstPoseAtMs: null,
    frameStats: {
      lastFrameAtMs: null,
      frames: 0,
      dropped: 0
    }
  });
  const headingDeltasRef = useRef<number[]>([]);
  const lastHeadingRef = useRef<number | null>(null);
  const headingStabilityRef = useRef<'good' | 'fair' | 'poor' | null>(null);
	  const drawStateRef = useRef({
	    trajectoryPoints: [] as TrajectoryAzElPoint[],
	    trajectoryTrackPointsByKind: {} as ArTrajectoryTrackPointMap,
	    trajectoryMilestones: [] as TrajectoryMilestonePayload[],
	    trajectoryRenderable: true,
      trajectoryQualityState: 'search' as TrajectoryQualityState,
      trajectoryAuthorityTier: 'model_prior' as TrajectoryAuthorityTier,
      trajectorySafeModeActive: true,
      trajectoryPublishPadOnly: false,
      trajectoryAuthorityTrustScore: null as number | null,
      trajectoryAzimuthAuthority: 'model_prior' as TrajectoryAuthorityTier,
      trajectoryAzimuthTrustScore: null as number | null,
      trajectoryUncertaintyAuthority: 'model_prior' as TrajectoryAuthorityTier,
      trajectoryUncertaintyTrustScore: null as number | null,
      trajectorySigmaDegP95: null as number | null,
	    showMilestones: true,
	    reducedEffects: false,
	    adjustedHeading: null as number | null,
	    adjustedPitch: null as number | null,
	    roll: null as number | null,
	    fovX: 70,
	    fovY: 45,
	    padBearing: null as number | null,
	    padElevation: null as number | null,
	    showPadGuide: false,
      timeMode: 'LIVE' as 'LIVE' | 'SCRUB',
      isBeforeLiftoff: false,
      liftoffAtMs: null as number | null,
      durationSec: 0,
      yawOffset: 0,
      pitchOffset: 0,
	    tSelectedSec: 0,
	    highContrast: true,
	    corridorMode: 'tight' as 'tight' | 'normal' | 'wide',
      lockOnRenderEnabled: false,
      performanceTier: 0 as ArPerformanceTier,
      milestoneDensity: 'full' as ArMilestoneDensity,
      lockPredictionDepth: 3 as 0 | 1 | 2 | 3,
      showRollAssist: true,
      dprCap: 2
	  });
	  const geoWatchIdRef = useRef<number | null>(null);
	  const locationFilterRef = useRef<{
	    lastAtMs: number | null;
	    lat: number | null;
	    lon: number | null;
	    altMeters: number | null;
	  }>({ lastAtMs: null, lat: null, lon: null, altMeters: null });
	  const declinationBucketRef = useRef<string | null>(null);
	  const declinationDegRef = useRef<number>(0);
  const declinationSourceRef = useRef<DeclinationSource>('none');
	  const headingSourceRef = useRef<HeadingSource>('unknown');
	  const declinationAppliedRef = useRef<boolean>(false);
	  const pendingYawOffsetMagneticRef = useRef<number | null>(null);
	  const yawOffsetMigratedRef = useRef(false);
		  const fovLoadedFromStorageRef = useRef(false);
			  const poseFilterRef = useRef<{
		    lastAtMs: number | null;
		    heading: number | null;
		    headingUnwrapped: number | null;
		    headingFilter: OneEuroFilterState;
		    pitch: number | null;
	    pitchFilter: OneEuroFilterState;
	    roll: number | null;
	    rollFilter: OneEuroFilterState;
	      debug?: {
	        screenAngleDeg: 0 | 90 | 180 | 270;
            screenAngleReportedDeg?: 0 | 90 | 180 | 270;
	        alpha: number | null;
	        beta: number | null;
	        gamma: number | null;
            alphaHeadingDeg?: number | null;
            tiltHeadingDeg?: number | null;
            tiltHeadingMag?: number | null;
			      tiltFrontBackDeg: number | null;
            pitchSource?: PitchSource;
            pitchRawDeg?: number | null;
            pitchSuppressedJump?: boolean;
	        rollDeg: number | null;
	        headingMagneticDeg: number | null;
            webkitCompassHeadingDeg?: number | null;
            webkitCompassHeadingViewportDeg?: number | null;
            webkitCompassHeld?: boolean;
            webkitCompassAccuracyDeg?: number | null;
            headingDeltaFromPoseDeg?: number | null;
            rotRateMagDegPerSec?: number | null;
            headingRejected?: boolean;
	        declinationDeg: number | null;
            declinationSource?: DeclinationSource;
	        headingDeg: number | null;
	        absolute?: boolean | null;
	      };
		  }>({
	    lastAtMs: null,
	    heading: null,
	    headingUnwrapped: null,
	    headingFilter: { xHat: null, dxHat: null },
	    pitch: null,
	    pitchFilter: { xHat: null, dxHat: null },
	    roll: null,
	    rollFilter: { xHat: null, dxHat: null }
	  });
  const motionStatsRef = useRef({
    lastAtMs: null as number | null,
    rotRateMagDegPerSec: 0,
    accelMagMps2: 0
  });
  const fusionRef = useRef<FusionState>({
    enabled: false,
    used: false,
    fallbackReason: 'disabled',
    yawSign: 1,
    headingUnwrapped: null,
    headingAtLastMeasurementUnwrapped: null,
    lastMeasurementHeading: null,
    lastMeasurementAtMs: null,
    lastMotionAtMs: null,
    lastOutputAtMs: null,
    gyroAtMs: null,
    gravityAtMs: null,
    gravity: null
  });
  const telemetrySessionIdRef = useRef<string | null>(null);
  const telemetryStartedAtRef = useRef<string>('');
  const telemetryStartedRef = useRef(false);
  const telemetryEndedRef = useRef(false);
  const telemetryEnteredArRef = useRef(false);
  const telemetryUsedScrubRef = useRef(false);
  const telemetryScrubMsRef = useRef(0);
  const telemetryScrubStartMsRef = useRef<number | null>(null);
  const telemetryEventTapCountRef = useRef(0);
  const telemetryClientEnvRef = useRef<ReturnType<typeof detectClientEnv> | null>(null);
  const telemetryClientProfileRef = useRef<ArClientProfile | null>(null);
  const telemetryScreenBucketRef = useRef<ReturnType<typeof detectScreenBucket> | null>(null);
  const telemetryXrUsedRef = useRef(false);
  const lastNonSkyPoseSourceRef = useRef<Exclude<PoseSource, 'sky_compass' | 'webxr'>>('deviceorientation');
  const telemetryRenderLoopRunningRef = useRef(false);
  const telemetryCanvasHiddenRef = useRef(false);
  const lockOnAttemptedRef = useRef(false);
  const lockOnAcquiredRef = useRef(false);
  const lockOnAttemptStartedAtMsRef = useRef<number | null>(null);
  const lockOnFirstAcquiredAtMsRef = useRef<number | null>(null);
  const lockOnTimeToLockBucketRef = useRef<TimeToLockBucket | undefined>(undefined);
  const lockOnLossCountRef = useRef(0);
  const lockOnTrackerClientRef = useRef<VisionTrackerClient | null>(null);
  const lockOnOverlayRef = useRef<LockOnOverlayState>({
    centerNorm: null,
    predictions: [],
    confidence: 0,
    status: 'lost',
    updatedAtMs: null
  });
  const visionRuntimeBudgetRef = useRef<VisionTrackerRuntimeBudget>({
    targetFps: 18,
    captureWidth: 320,
    maxFramesInFlight: 2
  });
  const telemetryFrameStatsRef = useRef<FrameStats>({
    lastFrameAtMs: null,
    frames: 0,
    dropped: 0
  });
  const telemetryLoopTimingRef = useRef({
    arLoopActiveMs: 0,
    arLoopActiveSinceMs: null as number | null,
    skyCompassLoopActiveMs: 0,
    skyCompassLoopActiveSinceMs: null as number | null,
    arLoopStartCount: 0,
    loopRestartCount: 0
  });
  const arLoopEpochRef = useRef(0);
  const poseUpdateStatsRef = useRef({
    count: 0,
    firstAtMs: null as number | null,
    lastAtMs: null as number | null
  });
  const telemetrySnapshotRef = useRef({
    cameraError: null as string | null,
    motionPermission: 'unknown' as MotionPermissionState,
    adjustedHeading: null as number | null,
    showSensorAssistOverlay: true,
    cameraStatus: 'prompt' as 'granted' | 'denied' | 'prompt' | 'error',
    motionStatus: 'prompt' as 'granted' | 'denied' | 'prompt' | 'error',
	    headingStatus: 'unknown' as 'ok' | 'unavailable' | 'noisy' | 'unknown',
	    headingSource: 'unknown' as HeadingSource,
	    declinationApplied: false,
      declinationSource: 'none' as DeclinationSource,
	    fusionEnabled: false,
	    fusionUsed: false,
	    fusionFallbackReason: null as Exclude<FusionFallbackReason, 'disabled'> | null,
	    poseSource: 'sky_compass' as PoseSource,
	    xrSupported: undefined as boolean | undefined,
	    xrUsed: false,
    xrErrorBucket: undefined as XrErrorBucket | undefined,
    poseMode: 'sensor_fused' as 'webxr' | 'sensor_fused',
    overlayMode: 'search' as OverlayMode,
    visionBackend: 'none' as 'worker_roi' | 'main_thread_roi' | 'none',
    degradationTier: 0 as 0 | 1 | 2 | 3,
    lensPreset: 'custom' as '0.5x' | '1x' | '2x' | '3x' | 'custom',
    corridorMode: 'tight' as 'tight' | 'normal' | 'wide',
    lockOnEnabled: false,
    lockOnMode: 'auto' as LockOnMode,
    lockOnAttempted: false,
    lockOnAcquired: false,
    timeToLockBucket: undefined as TimeToLockBucket | undefined,
    lockLossCount: 0,
    retryCount: 0,
    yawOffset: 0,
    pitchOffset: 0,
    fovX: 70,
    fovY: 45,
    fovSource: 'unknown' as FovSource,
    zoomSupported: false,
    zoomRatio: 1,
    zoomControlPath: 'unsupported' as ZoomControlPath,
    zoomInputToApplyMs: null as number | null,
    zoomApplyToProjectionSyncMs: null as number | null,
    projectionSource: 'preset' as ProjectionSource,
    tier: 0 as 0 | 1 | 2 | 3,
    trajectoryVersion: undefined as string | undefined,
    durationSec: 0,
    stepS: undefined as number | undefined,
    avgSigmaDeg: undefined as number | undefined,
    confidenceTierSeen: undefined as TrajectoryConfidenceTier | undefined,
    contractTier: undefined as TrajectoryConfidenceTier | undefined,
    authorityTier: undefined as TrajectoryAuthorityTier | undefined,
    qualityState: undefined as TrajectoryQualityState | undefined,
    renderTier: 'unknown' as RenderTier,
    droppedFrameBucket: undefined as string | undefined
  });
  const telemetryUpdateStateRef = useRef<{
    lastSentAtMs: number | null;
    lastMaterialKey: string | null;
  }>({
    lastSentAtMs: null,
    lastMaterialKey: null
  });

  const markArLoopActive = useCallback((active: boolean) => {
    const now = Date.now();
    const timing = telemetryLoopTimingRef.current;
    if (active) {
      if (timing.arLoopActiveSinceMs != null) return;
      if (timing.arLoopStartCount > 0) timing.loopRestartCount += 1;
      timing.arLoopStartCount += 1;
      timing.arLoopActiveSinceMs = now;
      return;
    }
    if (timing.arLoopActiveSinceMs == null) return;
    timing.arLoopActiveMs += Math.max(0, now - timing.arLoopActiveSinceMs);
    timing.arLoopActiveSinceMs = null;
  }, []);

  const markSkyCompassLoopActive = useCallback((active: boolean) => {
    const now = Date.now();
    const timing = telemetryLoopTimingRef.current;
    if (active) {
      if (timing.skyCompassLoopActiveSinceMs != null) return;
      timing.skyCompassLoopActiveSinceMs = now;
      return;
    }
    if (timing.skyCompassLoopActiveSinceMs == null) return;
    timing.skyCompassLoopActiveMs += Math.max(0, now - timing.skyCompassLoopActiveSinceMs);
    timing.skyCompassLoopActiveSinceMs = null;
  }, []);

  const snapshotLoopTiming = useCallback(() => {
    const now = Date.now();
    const timing = telemetryLoopTimingRef.current;
    const arLoopActiveMs =
      timing.arLoopActiveMs + (timing.arLoopActiveSinceMs != null ? Math.max(0, now - timing.arLoopActiveSinceMs) : 0);
    const skyCompassLoopActiveMs =
      timing.skyCompassLoopActiveMs +
      (timing.skyCompassLoopActiveSinceMs != null ? Math.max(0, now - timing.skyCompassLoopActiveSinceMs) : 0);
    return {
      arLoopActiveMs,
      skyCompassLoopActiveMs,
      loopRestartCount: timing.loopRestartCount
    };
  }, []);

  const clientProfileForUi = detectedClientProfile;
  const clientProfilePolicy = useMemo(() => getArClientProfilePolicy(clientProfileForUi), [clientProfileForUi]);
  const workerVisionSupported = useMemo(() => isWorkerVisionTrackerSupported(), []);
  const mainThreadVisionSupported = useMemo(() => isMainThreadVisionTrackerSupported(), []);

  useEffect(() => {
    let cancelled = false;
    if (clientProfileForUi !== 'android_chrome' && clientProfileForUi !== 'android_samsung_internet') {
      setRuntimePolicyPoseOverride(null);
      setRuntimePolicyHydrated(true);
      return;
    }

    const cachedPolicy = readCachedArRuntimePolicyOverride(clientProfileForUi);
    setRuntimePolicyPoseOverride(cachedPolicy.override?.poseMode ?? null);
    setRuntimePolicyHydrated(cachedPolicy.resolved);
    if (cachedPolicy.resolved) return;

    void fetchArRuntimePolicyOverride(clientProfileForUi).then((override) => {
      if (cancelled) return;
      setRuntimePolicyPoseOverride(override?.poseMode ?? null);
      setRuntimePolicyHydrated(true);
    }).catch(() => {
      if (cancelled) return;
      setRuntimePolicyHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, [clientProfileForUi]);

  const runtimeDecision = useMemo(
    () =>
      selectArRuntime({
        profile: clientProfileForUi,
        xrSupport,
        xrActive,
        xrLaunchState,
        cameraActive,
        cameraError,
        motionPermission,
        workerVisionSupported,
        mainThreadVisionSupported,
        telemetryRecommendedPoseMode: runtimePolicyPoseOverride
      }),
    [
      cameraActive,
      cameraError,
      clientProfileForUi,
      mainThreadVisionSupported,
      motionPermission,
      runtimePolicyPoseOverride,
      workerVisionSupported,
      xrActive,
      xrLaunchState,
      xrSupport
    ]
  );
  const lockOnMode: LockOnMode = AR_LOCK_ON_MANUAL_DEBUG_ENABLED ? 'manual_debug' : 'auto';
  const lockOnFeatureEnabled = useMemo(() => {
    if (!AR_LOCK_ON_FLAG_ENABLED) return false;
    return runtimeDecision.visionBackend !== 'none';
  }, [runtimeDecision.visionBackend]);
  const effectiveDegradationTier = useMemo<ArPerformanceTier>(
    () => Math.max(runtimeDecision.degradationTier, performanceTier) as ArPerformanceTier,
    [performanceTier, runtimeDecision.degradationTier]
  );
  const performancePolicy = useMemo(() => getArPerformancePolicy(effectiveDegradationTier), [effectiveDegradationTier]);
  const effectiveReducedEffects = reducedEffects || performancePolicy.reducedEffects;
  const effectiveShowMilestones = showMilestones && performancePolicy.milestoneDensity !== 'off';
  const shouldRunArLoop = xrActive || cameraActive;
  const zoomRange = useMemo(() => {
    const min = clamp(zoomRangeMin, WEB_ZOOM_MIN_GLOBAL, WEB_ZOOM_MAX_GLOBAL);
    const max = clamp(zoomRangeMax, min, WEB_ZOOM_MAX_GLOBAL);
    return { min, max };
  }, [zoomRangeMax, zoomRangeMin]);
  const quickZoomLevels = useMemo(
    () => [0.5, 1, 2, 3].filter((candidate) => candidate >= zoomRange.min - 0.01 && candidate <= zoomRange.max + 0.01),
    [zoomRange.max, zoomRange.min]
  );
  const clampZoomTarget = useCallback((value: number) => clamp(value, zoomRange.min, zoomRange.max), [zoomRange.max, zoomRange.min]);
  const syncFovFromZoom = useCallback(
    (effectiveZoom: number, source: ProjectionSource) => {
      if (!(effectiveZoom > 0) || !Number.isFinite(effectiveZoom)) return;
      const baseline =
        zoomBaselineFovRef.current ?? {
          fovXAt1x: clamp(fovX * effectiveZoom, 40, 120),
          fovYAt1x: clamp(fovY * effectiveZoom, 30, 90)
        };
      if (zoomBaselineFovRef.current == null) {
        zoomBaselineFovRef.current = baseline;
      }
      const nextFovX = clamp(baseline.fovXAt1x / effectiveZoom, 40, 120);
      const nextFovY = clamp(baseline.fovYAt1x / effectiveZoom, 30, 90);
      setProjectionSource(source);
      if (Math.abs(nextFovX - fovX) > 0.2) setFovX(nextFovX);
      if (Math.abs(nextFovY - fovY) > 0.2) setFovY(nextFovY);
      setLensPreset('custom');
      const syncStartedAtMs = zoomApplyStateRef.current.syncStartedAtMs;
      if (syncStartedAtMs != null) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        setZoomApplyToProjectionSyncMs(Math.max(0, now - syncStartedAtMs));
        zoomApplyStateRef.current.syncStartedAtMs = null;
      }
    },
    [fovX, fovY]
  );
  const applyZoomTarget = useCallback(
    async (targetValue: number, source: 'pinch' | 'chip' | 'step') => {
      const target = clampZoomTarget(targetValue);
      if (!zoomSupported || xrActive) {
        setZoomControlPath('preset_fallback');
        setZoomRatio(target);
        setZoomInputToApplyMs(0);
        syncFovFromZoom(target, 'preset');
        return;
      }

      const state = zoomApplyStateRef.current;
      if (state.inFlight) {
        state.queuedTarget = target;
        return;
      }
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (source === 'pinch' && now - state.lastApplyAtMs < 28) {
        state.queuedTarget = target;
        return;
      }

      const stream = streamRef.current;
      const track = stream?.getVideoTracks?.()[0];
      if (!track || typeof track.applyConstraints !== 'function') {
        setZoomSupported(false);
        setZoomControlPath('unsupported');
        return;
      }

      state.inFlight = true;
      state.lastApplyAtMs = now;
      const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      try {
        await track.applyConstraints({ advanced: [{ zoom: target }] as any });
        const settings: any = typeof track.getSettings === 'function' ? track.getSettings() : null;
        const effectiveZoomRaw = settings?.zoom;
        const effectiveZoom =
          typeof effectiveZoomRaw === 'number' && Number.isFinite(effectiveZoomRaw) ? clampZoomTarget(effectiveZoomRaw) : target;
        const doneAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        setZoomRatio(effectiveZoom);
        setZoomControlPath('track_constraints');
        setZoomInputToApplyMs(Math.max(0, doneAt - startedAt));
        state.syncStartedAtMs = doneAt;
        syncFovFromZoom(effectiveZoom, 'inferred_fov');
      } catch {
        setZoomControlPath('preset_fallback');
        setZoomRatio(target);
        setZoomInputToApplyMs(null);
        syncFovFromZoom(target, 'preset');
      } finally {
        state.inFlight = false;
        if (state.queuedTarget != null) {
          const queued = state.queuedTarget;
          state.queuedTarget = null;
          void applyZoomTarget(queued, 'pinch');
        }
      }
    },
    [clampZoomTarget, syncFovFromZoom, xrActive, zoomSupported]
  );
  const handleZoomStep = useCallback(
    (delta: number) => {
      void applyZoomTarget(zoomRatio + delta, 'step');
    },
    [applyZoomTarget, zoomRatio]
  );
  const handleZoomPreset = useCallback(
    (value: number) => {
      void applyZoomTarget(value, 'chip');
    },
    [applyZoomTarget]
  );
  const zoomProgressPercent = useMemo(() => {
    if (!zoomSupported) return 0;
    const denom = Math.max(0.0001, zoomRange.max - zoomRange.min);
    return clamp(((zoomRatio - zoomRange.min) / denom) * 100, 0, 100);
  }, [zoomRange.max, zoomRange.min, zoomRatio, zoomSupported]);

  useEffect(() => {
    performanceGovernorRef.current.tier = performanceTier;
  }, [performanceTier]);

  useEffect(() => {
    visionRuntimeBudgetRef.current = buildVisionRuntimeBudget(runtimeDecision.visionBackend, effectiveDegradationTier);
  }, [effectiveDegradationTier, runtimeDecision.visionBackend]);

  useEffect(() => {
    const zeroWindow = () => {
      const window = renderPerformanceWindowRef.current;
      window.frameCount = 0;
      window.dtTotalMs = 0;
      window.slowFrameCount = 0;
      window.severeFrameCount = 0;
    };

    if (!shouldRunArLoop) {
      zeroWindow();
      performanceGovernorRef.current = {
        tier: 0,
        recoveryStreak: 0
      };
      setPerformanceTier(0);
      return;
    }

    const interval = window.setInterval(() => {
      if (!telemetryRenderLoopRunningRef.current) {
        zeroWindow();
        return;
      }

      const windowSample = renderPerformanceWindowRef.current;
      const sample = {
        frameCount: windowSample.frameCount,
        avgFrameMs: windowSample.frameCount > 0 ? windowSample.dtTotalMs / windowSample.frameCount : null,
        slowFrameRatio: windowSample.frameCount > 0 ? windowSample.slowFrameCount / windowSample.frameCount : 0,
        severeFrameRatio: windowSample.frameCount > 0 ? windowSample.severeFrameCount / windowSample.frameCount : 0
      };
      zeroWindow();

      const nextState = advanceArPerformanceGovernor(performanceGovernorRef.current, sample);
      const currentState = performanceGovernorRef.current;
      if (
        nextState.tier === currentState.tier &&
        nextState.recoveryStreak === currentState.recoveryStreak
      ) {
        return;
      }

      performanceGovernorRef.current = nextState;
      setPerformanceTier((prev) => (prev === nextState.tier ? prev : nextState.tier));
    }, 1250);

    return () => {
      window.clearInterval(interval);
      zeroWindow();
    };
  }, [shouldRunArLoop]);

  const getVisionSearchWindow = useCallback((): VisionSearchWindow | null => {
    const state = drawStateRef.current;
    if (
      state.adjustedHeading == null ||
      state.adjustedPitch == null ||
      !Number.isFinite(state.adjustedHeading) ||
      !Number.isFinite(state.adjustedPitch)
    ) {
      return null;
    }

    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const lockOverlay = lockOnOverlayRef.current;
    const lockOverlayFresh = lockOverlay.updatedAtMs != null && nowMs - lockOverlay.updatedAtMs <= 1200;
    const canRenderTrajectory = state.trajectoryRenderable && state.trajectoryPoints.length > 0;
    const tSelectedSec =
      state.timeMode === 'LIVE' && state.liftoffAtMs != null && !state.isBeforeLiftoff && state.durationSec > 0
        ? clamp((Date.now() - state.liftoffAtMs) / 1000, 0, state.durationSec)
        : state.tSelectedSec;
    const aim = canRenderTrajectory ? interpolateTrajectory(state.trajectoryPoints, tSelectedSec) : null;

    const projectedAim =
      aim &&
      projectAzElToViewportNorm({
        targetAzDeg: aim.azDeg,
        targetElDeg: aim.elDeg,
        headingDeg: state.adjustedHeading,
        pitchDeg: state.adjustedPitch,
        rollDeg: state.roll,
        fovXDeg: state.fovX,
        fovYDeg: state.fovY
      });
    const center =
      lockOverlayFresh && lockOverlay.centerNorm && lockOverlay.confidence >= LOCK_ON_DRAW_CONFIDENCE
        ? lockOverlay.centerNorm
        : projectedAim;
    if (!center) return null;

    const sigmaDegBase =
      readTrajectoryPointSigmaDeg(aim) ??
      readTrajectoryPointSigmaDeg(state.trajectoryPoints[0]) ??
      state.trajectorySigmaDegP95 ??
      12;
    const covariance = readTrajectoryPointCovariance(aim) ?? readTrajectoryPointCovariance(state.trajectoryPoints[0]) ?? null;
    const crossTrackSigmaDeg = covariance?.crossTrackDeg ?? sigmaDegBase;
    const alongTrackSigmaDeg = covariance?.alongTrackDeg ?? sigmaDegBase;
    const corridorScale = corridorScaleForMode(state.corridorMode);
    const authorityScale = Math.max(
      authorityWindowMultiplier(state.trajectoryAuthorityTier, state.trajectoryAuthorityTrustScore),
      authorityWindowMultiplier(state.trajectoryAzimuthAuthority, state.trajectoryAzimuthTrustScore),
      authorityWindowMultiplier(state.trajectoryUncertaintyAuthority, state.trajectoryUncertaintyTrustScore)
    );
    const qualityScale =
      state.trajectoryQualityState === 'precision'
        ? 0.95
        : state.trajectoryQualityState === 'guided'
          ? 1.15
          : state.trajectoryQualityState === 'search'
            ? 1.5
            : 1.9;
    const trackingScale =
      lockOverlayFresh && lockOverlay.confidence >= LOCK_ON_ACQUIRE_CONFIDENCE && lockOverlay.status === 'tracking'
        ? 0.75
        : 1.15;
    const safetyScale = state.trajectorySafeModeActive || state.trajectoryPublishPadOnly ? 1.2 : 1;
    const marginNorm =
      lockOverlayFresh && lockOverlay.confidence >= LOCK_ON_ACQUIRE_CONFIDENCE && lockOverlay.status === 'tracking'
        ? 0.08
        : 0.14;

    const widthNorm = clamp(
      angularSpanNormForFov(
        crossTrackSigmaDeg * corridorScale * authorityScale * qualityScale * trackingScale * safetyScale,
        state.fovX
      ) *
        2 +
        marginNorm,
      0.16,
      1
    );
    const heightNorm = clamp(
      angularSpanNormForFov(
        alongTrackSigmaDeg * corridorScale * authorityScale * qualityScale * trackingScale * safetyScale,
        state.fovY
      ) *
        2 +
        marginNorm,
      0.18,
      1
    );

    return {
      centerXNorm: center.xNorm,
      centerYNorm: center.yNorm,
      widthNorm,
      heightNorm
    };
  }, []);

  const publishAlignmentFeedback = useCallback((next: AlignmentFeedback) => {
    const prev = alignmentFeedbackRef.current;
    alignmentFeedbackRef.current = next;
    setAlignmentFeedback((current) => {
      const baseline = current ?? prev;
      return sameAlignmentFeedback(baseline, next) ? baseline : next;
    });
  }, []);

  const decayAutoAlignment = useCallback(
    (hardReset: boolean) => {
      if (hardReset) autoAlignmentResidualsRef.current = [];
      else if (autoAlignmentResidualsRef.current.length > 0) autoAlignmentResidualsRef.current.shift();
      if (!autoAlignmentReady) {
        autoAlignmentScoreRef.current = Math.max(0, autoAlignmentScoreRef.current - (hardReset ? 2 : 1));
      }
    },
    [autoAlignmentReady]
  );

  const markLockOnAttempted = useCallback(() => {
    if (lockOnAttemptedRef.current) return;
    lockOnAttemptedRef.current = true;
    lockOnAttemptStartedAtMsRef.current = Date.now();
    setLockOnAttempted(true);
  }, []);

  const markLockOnAcquired = useCallback(() => {
    if (lockOnAcquiredRef.current) return;
    markLockOnAttempted();
    lockOnAcquiredRef.current = true;
    setLockOnAcquired(true);
    if (lockOnFirstAcquiredAtMsRef.current == null) {
      lockOnFirstAcquiredAtMsRef.current = Date.now();
      const startedAtMs = lockOnAttemptStartedAtMsRef.current;
      const acquiredAtMs = lockOnFirstAcquiredAtMsRef.current;
      const bucket = bucketTimeToLockMs(startedAtMs != null ? acquiredAtMs - startedAtMs : null);
      lockOnTimeToLockBucketRef.current = bucket;
      setLockOnTimeToLockBucket(bucket ?? null);
    }
  }, [markLockOnAttempted]);

  const markLockOnLost = useCallback(() => {
    if (!lockOnAcquiredRef.current) return;
    lockOnAcquiredRef.current = false;
    lockOnLossCountRef.current += 1;
    setLockOnAcquired(false);
    setLockOnLossCount(lockOnLossCountRef.current);
  }, []);

  useEffect(() => {
    if (!lockOnFeatureEnabled) {
      if (lockOnEnabled) setLockOnEnabled(false);
      markLockOnLost();
      return;
    }
    if (!AR_LOCK_ON_MANUAL_DEBUG_ENABLED && !lockOnEnabled) {
      setLockOnEnabled(true);
    }
  }, [lockOnEnabled, lockOnFeatureEnabled, markLockOnLost]);

  useEffect(() => {
    if (!lockOnFeatureEnabled || !lockOnEnabled) {
      markLockOnLost();
      return;
    }

    const canAttempt = cameraActive && cameraError == null && motionPermission === 'granted';
    if (canAttempt) {
      markLockOnAttempted();
      return;
    }
    markLockOnLost();
  }, [cameraActive, cameraError, motionPermission, lockOnEnabled, lockOnFeatureEnabled, markLockOnAttempted, markLockOnLost]);

  useEffect(() => {
    const canTrack =
      lockOnFeatureEnabled &&
      lockOnEnabled &&
      cameraActive &&
      cameraError == null &&
      motionPermission === 'granted';

    if (!canTrack) {
      lockOnTrackerClientRef.current?.stop();
      lockOnTrackerClientRef.current = null;
      lockOnOverlayRef.current = {
        centerNorm: null,
        predictions: [],
        confidence: 0,
        status: 'lost',
        updatedAtMs: typeof performance !== 'undefined' ? performance.now() : Date.now()
      };
      return;
    }

    const video = videoRef.current;
    const visionBackend = runtimeDecision.visionBackend;
    if (!video || visionBackend === 'none') {
      return;
    }

    const client =
      lockOnTrackerClientRef.current ??
      createVisionTrackerClient({
        backend: visionBackend,
        video,
        getViewportSize: () => {
          const vv = typeof window !== 'undefined' ? window.visualViewport : null;
          const widthRaw = vv && typeof vv.width === 'number' ? vv.width : window.innerWidth;
          const heightRaw = vv && typeof vv.height === 'number' ? vv.height : window.innerHeight;
          return {
            width: Math.max(1, Math.floor(Number(widthRaw) || 0)),
            height: Math.max(1, Math.floor(Number(heightRaw) || 0))
          };
        },
        getSearchWindow: getVisionSearchWindow,
        getRuntimeBudget: () => visionRuntimeBudgetRef.current,
        onTrack: (message) => {
          lockOnOverlayRef.current = {
            centerNorm: message.centerNorm,
            predictions: message.predictions,
            confidence: message.confidence,
            status: message.status,
            updatedAtMs: message.tsMs
          };

          if (message.status === 'tracking' && message.confidence >= LOCK_ON_ACQUIRE_CONFIDENCE) {
            markLockOnAcquired();
            return;
          }
          if (message.status === 'lost' || message.confidence <= LOCK_ON_LOST_CONFIDENCE) {
            markLockOnLost();
          }
        },
        onError: () => {
          lockOnOverlayRef.current = {
            centerNorm: null,
            predictions: [],
            confidence: 0,
            status: 'lost',
            updatedAtMs: typeof performance !== 'undefined' ? performance.now() : Date.now()
          };
          markLockOnLost();
        }
      });

    if (!lockOnTrackerClientRef.current) {
      const started = client.start();
      if (!started) {
        lockOnOverlayRef.current = {
          centerNorm: null,
          predictions: [],
          confidence: 0,
          status: 'lost',
          updatedAtMs: typeof performance !== 'undefined' ? performance.now() : Date.now()
        };
        return;
      }
      lockOnTrackerClientRef.current = client;
    }

    return () => {
      lockOnTrackerClientRef.current?.stop();
      lockOnTrackerClientRef.current = null;
    };
  }, [
    cameraActive,
    cameraError,
    lockOnEnabled,
    lockOnFeatureEnabled,
    markLockOnAcquired,
    markLockOnLost,
    motionPermission,
    runtimeDecision.visionBackend,
    getVisionSearchWindow
  ]);

	  useEffect(() => {
	    headingStabilityRef.current = headingStability;
	  }, [headingStability]);

		  useEffect(() => {
		    const fusion = fusionRef.current;
		    fusion.enabled = advancedFusionEnabled;
		    fusion.used = false;
		    fusion.fallbackReason = advancedFusionEnabled ? 'not_initialized' : 'disabled';
		    fusion.yawSign = 1;
	    fusion.headingUnwrapped = null;
	    fusion.headingAtLastMeasurementUnwrapped = null;
	    fusion.lastMeasurementHeading = null;
	    fusion.lastMeasurementAtMs = null;
	    fusion.lastMotionAtMs = null;
	    fusion.lastOutputAtMs = null;
		    fusion.gyroAtMs = null;
		    fusion.gravityAtMs = null;
		    fusion.gravity = null;

		    telemetrySnapshotRef.current.fusionEnabled = advancedFusionEnabled;
		    telemetrySnapshotRef.current.fusionUsed = false;
		    telemetrySnapshotRef.current.fusionFallbackReason = advancedFusionEnabled ? 'not_initialized' : null;
		  }, [advancedFusionEnabled]);

	  useEffect(() => {
	    telemetryClientEnvRef.current = detectClientEnv(typeof navigator !== 'undefined' ? navigator.userAgent : '');
    telemetryClientProfileRef.current = detectArClientProfile(typeof navigator !== 'undefined' ? navigator.userAgent : '');
	    telemetryScreenBucketRef.current = detectScreenBucket();
	  }, []);

  useEffect(() => {
    if (xrActive) {
      telemetryXrUsedRef.current = true;
      headingSourceRef.current = 'webxr';
      declinationAppliedRef.current = false;
      declinationSourceRef.current = 'none';
      telemetrySnapshotRef.current.declinationSource = 'none';
    }
  }, [xrActive]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedEffects(Boolean(media.matches));
    update();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    const legacy = media as any;
    if (typeof legacy.addListener === 'function') {
      legacy.addListener(update);
      return () => legacy.removeListener(update);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const xr = (typeof navigator !== 'undefined' ? (navigator as any).xr : null) as any;
    if (!xr || typeof xr.isSessionSupported !== 'function') {
      setXrSupport('unsupported');
      return;
    }
    (async () => {
      try {
        const supported = await xr.isSessionSupported('immersive-ar');
        if (active) setXrSupport(supported ? 'supported' : 'unsupported');
      } catch {
        if (active) setXrSupport('unsupported');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const value = window.sessionStorage.getItem(AR_MOTION_PERMISSION_SESSION_KEY);
      if (!value) return;
      window.sessionStorage.removeItem(AR_MOTION_PERMISSION_SESSION_KEY);
      if (value === 'granted') setMotionPermission('granted');
      else if (value === 'denied') setMotionPermission('denied');
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!telemetryStartedAtRef.current) telemetryStartedAtRef.current = new Date().toISOString();
    if (telemetrySessionIdRef.current == null) telemetrySessionIdRef.current = newSessionId();
  }, []);

  const updateHeadingQuality = useCallback(
    (nextHeading: number) => {
      const last = lastHeadingRef.current;
      if (typeof last === 'number') {
        const delta = Math.abs(normalizeAngleDelta(nextHeading - last));
        const samples = headingDeltasRef.current;
        samples.push(delta);
        if (samples.length > 12) samples.shift();
        const avg = samples.reduce((sum, value) => sum + value, 0) / samples.length;
        if (Number.isFinite(avg)) {
          if (avg <= 1.5) setHeadingStability('good');
          else if (avg <= 4) setHeadingStability('fair');
          else setHeadingStability('poor');
        }
      }
      lastHeadingRef.current = nextHeading;
    },
    []
  );

  const defaultCorridorMode = useMemo(
    () => corridorModeForQuality(trajectory?.runtimeHints.defaultOverlayMode ?? 'search'),
    [trajectory?.runtimeHints.defaultOverlayMode]
  );

  useEffect(() => {
    locationLatestRef.current = location;
  }, [location]);

	  useEffect(() => {
	    let active = true;
	    if (xrActive) {
	      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setCameraError(null);
      setCameraActive(false);
      return () => {
        active = false;
      };
    }
    const mediaDevices = (navigator as Navigator & { mediaDevices?: MediaDevices }).mediaDevices;
    async function startCamera(devices: MediaDevices) {
      try {
        setCameraError(null);
        setCameraActive(false);
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
        const stream = await devices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!active) return;
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if (!active) return;
        setCameraActive(true);
      } catch (err: any) {
        if (!active) return;
        setCameraError(err?.message || 'Camera permission denied.');
        setCameraActive(false);
      }
    }

    if (mediaDevices) {
      startCamera(mediaDevices);
    } else {
      setCameraError('Camera not supported in this browser.');
      setCameraActive(false);
    }

	    return () => {
	      active = false;
	      if (streamRef.current) {
	        streamRef.current.getTracks().forEach((track) => track.stop());
	        streamRef.current = null;
	      }
	      setCameraActive(false);
	    };
	  }, [cameraAttempt, xrActive]);

  useEffect(() => {
    if (!cameraActive || xrActive) {
      setZoomSupported(false);
      setZoomRangeMin(1);
      setZoomRangeMax(1);
      setZoomRatio(1);
      setZoomControlPath('unsupported');
      setZoomTrayOpen(false);
      return;
    }

    const stream = streamRef.current;
    const track = stream?.getVideoTracks?.()[0];
    if (!track) {
      setZoomSupported(false);
      setZoomControlPath('unsupported');
      return;
    }

    const settings: any = typeof track.getSettings === 'function' ? track.getSettings() : null;
    const capabilities: any = typeof track.getCapabilities === 'function' ? track.getCapabilities() : null;
    const minRaw = typeof capabilities?.zoom?.min === 'number' ? capabilities.zoom.min : null;
    const maxRaw = typeof capabilities?.zoom?.max === 'number' ? capabilities.zoom.max : null;
    const stepRaw = typeof capabilities?.zoom?.step === 'number' ? capabilities.zoom.step : null;
    const currentRaw = typeof settings?.zoom === 'number' ? settings.zoom : 1;
    if (minRaw == null || maxRaw == null || !(maxRaw > minRaw + 0.01)) {
      setZoomSupported(false);
      setZoomRangeMin(1);
      setZoomRangeMax(1);
      setZoomRatio(1);
      setZoomControlPath('preset_fallback');
      setProjectionSource('preset');
      return;
    }

    const min = clamp(minRaw, WEB_ZOOM_MIN_GLOBAL, WEB_ZOOM_MAX_GLOBAL);
    const max = clamp(maxRaw, min, WEB_ZOOM_MAX_GLOBAL);
    const current = clamp(currentRaw, min, max);
    const supportsZoom = max > min + Math.max(0.01, stepRaw ?? 0);
    setZoomSupported(supportsZoom);
    setZoomRangeMin(min);
    setZoomRangeMax(max);
    setZoomRatio(current);
    setZoomControlPath(supportsZoom ? 'track_constraints' : 'preset_fallback');
    setProjectionSource(supportsZoom ? 'inferred_fov' : 'preset');
    zoomBaselineFovRef.current = {
      fovXAt1x: clamp(fovX * current, 40, 120),
      fovYAt1x: clamp(fovY * current, 30, 90)
    };
  }, [cameraActive, fovX, fovY, xrActive]);

  useEffect(() => {
    if (!cameraActive || xrActive) return;
    const root = rootRef.current;
    if (!root) return;
    const isUiElement = (target: EventTarget | null) =>
      target instanceof Element && target.closest('[data-ar-ui-control="1"]') != null;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length < 2) return;
      if (isUiElement(event.target)) return;
      const a = event.touches[0];
      const b = event.touches[1];
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;
      const distance = Math.hypot(dx, dy);
      if (!(distance > 0)) return;
      pinchZoomRef.current.active = true;
      pinchZoomRef.current.startDistance = distance;
      pinchZoomRef.current.startZoom = zoomRatio;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!pinchZoomRef.current.active) return;
      if (event.touches.length < 2) return;
      const a = event.touches[0];
      const b = event.touches[1];
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;
      const distance = Math.hypot(dx, dy);
      if (!(distance > 0)) return;
      const scale = distance / Math.max(1, pinchZoomRef.current.startDistance);
      const target = clampZoomTarget(pinchZoomRef.current.startZoom * scale);
      void applyZoomTarget(target, 'pinch');
      event.preventDefault();
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length >= 2) return;
      pinchZoomRef.current.active = false;
      pinchZoomRef.current.startDistance = 0;
      pinchZoomRef.current.startZoom = zoomRatio;
    };

    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    root.addEventListener('touchend', onTouchEnd, { passive: true });
    root.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchmove', onTouchMove);
      root.removeEventListener('touchend', onTouchEnd);
      root.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [applyZoomTarget, cameraActive, clampZoomTarget, xrActive, zoomRatio]);

	  useEffect(() => {
	    if (!cameraActive) return;
	    if (!calibrationReady) return;
	    if (fovAutoInferredRef.current) return;
	    if (fovLoadedFromStorageRef.current) return;
	    if (lensPreset !== 'custom') return;
	    if (fovX !== 70 || fovY !== 45) return;
	    const stream = streamRef.current;
	    const track = stream?.getVideoTracks?.()[0];
	    if (!track) return;

	    const settings: any = typeof track.getSettings === 'function' ? track.getSettings() : null;
	    const capabilities: any = typeof track.getCapabilities === 'function' ? track.getCapabilities() : null;

	    const parseDeg = (value: unknown) => {
	      if (typeof value === 'number' && Number.isFinite(value)) return value;
	      if (typeof value === 'string') {
	        const n = Number(value);
	        if (Number.isFinite(n)) return n;
	      }
	      return null;
	    };

	    const readFov = (obj: any) => {
	      if (!obj || typeof obj !== 'object') return { fovX: null as number | null, fovY: null as number | null };
	      const fieldOfView = obj.fieldOfView;
	      if (fieldOfView && typeof fieldOfView === 'object') {
	        const x = parseDeg(fieldOfView.horizontal ?? fieldOfView.hfov ?? fieldOfView.hFov);
	        const y = parseDeg(fieldOfView.vertical ?? fieldOfView.vfov ?? fieldOfView.vFov);
	        return { fovX: x, fovY: y };
	      }
	      const x =
	        parseDeg(obj.horizontalFieldOfView) ??
	        parseDeg(obj.hfov) ??
	        parseDeg(obj.hFov) ??
	        parseDeg(obj.fovX) ??
	        parseDeg(obj.horizontalFov) ??
	        parseDeg(obj.horizontalFOV);
	      const y =
	        parseDeg(obj.verticalFieldOfView) ??
	        parseDeg(obj.vfov) ??
	        parseDeg(obj.vFov) ??
	        parseDeg(obj.fovY) ??
	        parseDeg(obj.verticalFov) ??
	        parseDeg(obj.verticalFOV);
	      return { fovX: x, fovY: y };
	    };

	    const candidateSettings = readFov(settings);
	    const candidateCaps = readFov(capabilities);
	    let inferredX = candidateSettings.fovX ?? candidateCaps.fovX;
	    let inferredY = candidateSettings.fovY ?? candidateCaps.fovY;
	    if (inferredX == null && inferredY == null) return;

	    const video = videoRef.current;
	    const aspectFromVideo =
	      video && video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : null;
	    const aspectFromSettings = parseDeg(settings?.aspectRatio);
	    const aspect = aspectFromVideo ?? (aspectFromSettings && aspectFromSettings > 0 ? aspectFromSettings : null);

	    const toRad = (deg: number) => (deg * Math.PI) / 180;
	    const toDeg = (rad: number) => (rad * 180) / Math.PI;
	    if (aspect && inferredX != null && inferredY == null) {
	      const hfov = toRad(inferredX);
	      const vfov = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
	      inferredY = toDeg(vfov);
	    } else if (aspect && inferredY != null && inferredX == null) {
	      const vfov = toRad(inferredY);
	      const hfov = 2 * Math.atan(aspect * Math.tan(vfov / 2));
	      inferredX = toDeg(hfov);
	    }

	    if (inferredX == null || inferredY == null) return;
	    if (!Number.isFinite(inferredX) || !Number.isFinite(inferredY)) return;
	    inferredX = clamp(inferredX, 40, 120);
	    inferredY = clamp(inferredY, 30, 90);

	    fovAutoInferredRef.current = true;
	    setFovX(inferredX);
	    setFovY(inferredY);
	    setLensPreset('custom');
      setProjectionSource('inferred_fov');
      if (zoomRatio > 0) {
        zoomBaselineFovRef.current = {
          fovXAt1x: clamp(inferredX * zoomRatio, 40, 120),
          fovYAt1x: clamp(inferredY * zoomRatio, 30, 90)
        };
      }
	  }, [cameraActive, calibrationReady, fovX, fovY, lensPreset, zoomRatio]);

  useEffect(() => {
    if (!AR_DEBUG_CALIBRATION_STORAGE_ENABLED) {
      calibrationLoadedRef.current = true;
      setCalibrationReady(true);
      return;
    }
    if (typeof window === 'undefined') return;
    const keyMaterial = `${navigator.userAgent}|${window.screen?.width ?? window.innerWidth}x${window.screen?.height ?? window.innerHeight}|${window.devicePixelRatio ?? 1}`;
    let hash = 2166136261;
    for (let i = 0; i < keyMaterial.length; i += 1) {
      hash ^= keyMaterial.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const deviceHash = (hash >>> 0).toString(36);
	    const deviceKey = `arCalibration:v8:${deviceHash}`;
      const legacyV7Key = `arCalibration:v7:${deviceHash}`;
	    const legacyV6Key = `arCalibration:v6:${deviceHash}`;
	    const legacyV5Key = `arCalibration:v5:${deviceHash}`;
	    const legacyV4Key = `arCalibration:v4:${deviceHash}`;
	    const legacyV3Key = `arCalibration:v3:${deviceHash}`;
	    const legacyV2Key = `arCalibration:v2:${deviceHash}`;
	    calibrationKeyRef.current = deviceKey;

	    const rawV8 = window.localStorage.getItem(deviceKey);
	    const rawLegacy =
        window.localStorage.getItem(legacyV7Key) ??
	      window.localStorage.getItem(legacyV6Key) ??
	      window.localStorage.getItem(legacyV5Key) ??
	      window.localStorage.getItem(legacyV4Key) ??
	      window.localStorage.getItem(legacyV3Key) ??
	      window.localStorage.getItem(legacyV2Key) ??
	      window.localStorage.getItem('arCalibration');
	    const raw = rawV8 ?? rawLegacy;
	    if (!raw) {
	      calibrationLoadedRef.current = true;
	      setCalibrationReady(true);
	      return;
	    }
	    try {
		      const parsed = JSON.parse(raw) as {
		        yawOffset?: number;
            didCalibrateYaw?: boolean;
		        pitchOffset?: number;
		        fovX?: number;
		        fovY?: number;
		        lensPreset?: '0.5x' | '1x' | '2x' | '3x' | 'custom';
		        headingReference?: 'magnetic' | 'true';
		        advancedFusionEnabled?: boolean;
            wizardDismissed?: boolean;
		      };
	          const isCurrent = rawV8 != null;
          const yawOffsetSaved = typeof parsed.yawOffset === 'number' && Number.isFinite(parsed.yawOffset) ? parsed.yawOffset : null;
          const wizardDismissed = typeof parsed.wizardDismissed === 'boolean' ? parsed.wizardDismissed : true;
          let nextShowWizard = AR_LEGACY_CALIBRATION_FLOW_ENABLED ? !wizardDismissed : false;

          // Yaw calibration semantics can change alongside the heading/orientation model.
          // Do not trust legacy yaw offsets; force a re-calibration instead.
          if (AR_LEGACY_CALIBRATION_FLOW_ENABLED && isCurrent && parsed.didCalibrateYaw && yawOffsetSaved != null) {
            setYawOffset(yawOffsetSaved);
            hasCalibratedRef.current = true;
            if (parsed.headingReference !== 'true') {
              pendingYawOffsetMagneticRef.current = yawOffsetSaved;
              yawOffsetMigratedRef.current = false;
            }
          } else if (AR_LEGACY_CALIBRATION_FLOW_ENABLED && !isCurrent && yawOffsetSaved != null && Math.abs(yawOffsetSaved) > 1) {
            setCalibrationNotice('Saved heading calibration was reset after an update. Please re-calibrate.');
            nextShowWizard = true;
          }

		      // Pitch semantics depend on our orientation model; don't trust legacy pitch offsets.
		      if (AR_DEBUG_PANELS_ENABLED && rawV8 && typeof parsed.pitchOffset === 'number') setPitchOffset(parsed.pitchOffset);
	      if (AR_DEBUG_PANELS_ENABLED && typeof parsed.fovX === 'number') {
	        setFovX(parsed.fovX);
	        fovLoadedFromStorageRef.current = true;
	      }
		      if (AR_DEBUG_PANELS_ENABLED && typeof parsed.fovY === 'number') {
		        setFovY(parsed.fovY);
		        fovLoadedFromStorageRef.current = true;
		      }
		      if (AR_DEBUG_PANELS_ENABLED && parsed.lensPreset) setLensPreset(parsed.lensPreset);
			      if (AR_DEBUG_PANELS_ENABLED && isCurrent && typeof parsed.advancedFusionEnabled === 'boolean') {
              setAdvancedFusionEnabled(parsed.advancedFusionEnabled);
            }
			      setShowWizard(nextShowWizard);
			    } catch {
		      // ignore
		    }
    calibrationLoadedRef.current = true;
    setCalibrationReady(true);
  }, []);

  useEffect(() => {
    if (!calibrationReady) return;
    if (corridorModeLoadedRef.current) return;
    if (corridorModeDefaultedRef.current) return;
    corridorModeDefaultedRef.current = true;
    setCorridorMode(defaultCorridorMode);
    setCorridorModeInitialized(true);
  }, [calibrationReady, defaultCorridorMode]);

  useEffect(() => {
    if (!AR_DEBUG_CALIBRATION_STORAGE_ENABLED) return;
    if (typeof window === 'undefined') return;
    if (!calibrationLoadedRef.current) return;
		    if (skipFirstCalibrationSaveRef.current) {
		      skipFirstCalibrationSaveRef.current = false;
		      return;
		    }
			    const payload = JSON.stringify({
            savedAt: new Date().toISOString(),
            didCalibrateYaw: AR_LEGACY_CALIBRATION_FLOW_ENABLED ? hasCalibratedRef.current : false,
            screenAngleDegAtSave: poseFilterRef.current.debug?.screenAngleDeg ?? null,
            headingSourceAtSave: headingSourceRef.current,
            declinationSourceAtSave: declinationSourceRef.current,
            declinationAppliedAtSave: declinationAppliedRef.current,
            locationTileAtSave:
              typeof locationFilterRef.current.lat === 'number' &&
              Number.isFinite(locationFilterRef.current.lat) &&
              typeof locationFilterRef.current.lon === 'number' &&
              Number.isFinite(locationFilterRef.current.lon)
                ? {
                    lat: Math.round(locationFilterRef.current.lat * 10) / 10,
                    lon: Math.round(locationFilterRef.current.lon * 10) / 10
                  }
                : null,
			      yawOffset: AR_LEGACY_CALIBRATION_FLOW_ENABLED ? yawOffset : 0,
			      pitchOffset: AR_DEBUG_PANELS_ENABLED ? pitchOffset : 0,
			      fovX: AR_DEBUG_PANELS_ENABLED ? fovX : 70,
			      fovY: AR_DEBUG_PANELS_ENABLED ? fovY : 45,
			      lensPreset: AR_DEBUG_PANELS_ENABLED ? lensPreset : 'custom',
			      advancedFusionEnabled: AR_DEBUG_PANELS_ENABLED ? advancedFusionEnabled : false,
			      headingReference: 'true' as const,
			      wizardDismissed: AR_LEGACY_CALIBRATION_FLOW_ENABLED ? !showWizard : true
			    });
			    window.localStorage.setItem(calibrationKeyRef.current, payload);
			  }, [yawOffset, pitchOffset, fovX, fovY, lensPreset, advancedFusionEnabled, showWizard, calibrationReady]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError('Location not supported in this browser.');
      return;
    }
    setLocationError(null);
    if (geoWatchIdRef.current != null) {
      navigator.geolocation.clearWatch(geoWatchIdRef.current);
      geoWatchIdRef.current = null;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const dtSecRaw =
          locationFilterRef.current.lastAtMs != null ? (now - locationFilterRef.current.lastAtMs) / 1000 : 0.5;
        const dtSec = clamp(dtSecRaw, 0.05, 5);
        locationFilterRef.current.lastAtMs = now;

        const latRaw = pos.coords.latitude;
        const lonRaw = pos.coords.longitude;
        const accuracyRaw = pos.coords.accuracy;
        const altRaw = typeof pos.coords.altitude === 'number' && Number.isFinite(pos.coords.altitude) ? pos.coords.altitude : null;
        const altAccRaw =
          typeof pos.coords.altitudeAccuracy === 'number' && Number.isFinite(pos.coords.altitudeAccuracy) ? pos.coords.altitudeAccuracy : null;

        const accuracy = typeof accuracyRaw === 'number' && Number.isFinite(accuracyRaw) ? accuracyRaw : 999;
        const accuracyFactor = clamp(accuracy / 10, 0.8, 6);
        const tauSec = 0.8 * accuracyFactor;
        const alpha = 1 - Math.exp(-dtSec / Math.max(0.05, tauSec));

        if (typeof latRaw === 'number' && typeof lonRaw === 'number') {
          if (locationFilterRef.current.lat == null || locationFilterRef.current.lon == null) {
            locationFilterRef.current.lat = latRaw;
            locationFilterRef.current.lon = lonRaw;
          } else {
            locationFilterRef.current.lat = locationFilterRef.current.lat + (latRaw - locationFilterRef.current.lat) * alpha;
            locationFilterRef.current.lon = locationFilterRef.current.lon + (lonRaw - locationFilterRef.current.lon) * alpha;
          }
        }

        if (altRaw != null) {
          if (locationFilterRef.current.altMeters == null) locationFilterRef.current.altMeters = altRaw;
          else locationFilterRef.current.altMeters = locationFilterRef.current.altMeters + (altRaw - locationFilterRef.current.altMeters) * alpha;
        }

        const nextLat = locationFilterRef.current.lat;
        const nextLon = locationFilterRef.current.lon;
        if (typeof nextLat === 'number' && Number.isFinite(nextLat) && typeof nextLon === 'number' && Number.isFinite(nextLon)) {
          setLocation({
            lat: nextLat,
            lon: nextLon,
            accuracy: accuracyRaw,
            altMeters: locationFilterRef.current.altMeters,
            altAccuracy: altAccRaw
          });
        } else {
          setLocation({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: accuracyRaw,
            altMeters: altRaw,
            altAccuracy: altAccRaw
          });
        }
      },
      (err) => {
        setLocationError(err?.message || 'Location permission denied.');
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
    geoWatchIdRef.current = watchId;
    return () => {
      navigator.geolocation.clearWatch(watchId);
      if (geoWatchIdRef.current === watchId) {
        geoWatchIdRef.current = null;
      }
    };
	  }, [locationAttempt]);

	  useEffect(() => {
	    if (typeof window === 'undefined') return;
	    if (!location) return;
	    const latRaw = location.lat;
	    const lonRaw = location.lon;
	    if (!Number.isFinite(latRaw) || !Number.isFinite(lonRaw)) return;
      const bucketLat = Math.round(latRaw * 2) / 2;
      const bucketLon = Math.round(lonRaw * 2) / 2;
      const nowDate = new Date();
      const monthBucket = `${nowDate.getUTCFullYear()}-${String(nowDate.getUTCMonth() + 1).padStart(2, '0')}`;
      const monthSampleDate = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 15));
      const bucketKey = `${bucketLat.toFixed(1)},${bucketLon.toFixed(1)},${monthBucket}`;
	    if (declinationBucketRef.current !== bucketKey) {
	      declinationBucketRef.current = bucketKey;
        const declination = getDeclinationDeg({
          lat: bucketLat,
          lon: bucketLon,
          atDate: monthSampleDate
        });
	      declinationDegRef.current = declination.declinationDeg;
        declinationSourceRef.current = declination.source;
        telemetrySnapshotRef.current.declinationSource = declination.source;
	    }

      if (!AR_LEGACY_CALIBRATION_FLOW_ENABLED) return;
	    if (pendingYawOffsetMagneticRef.current == null) return;
	    if (yawOffsetMigratedRef.current) return;
	    if (hasCalibratedRef.current) return;
	    const declinationDeg = declinationDegRef.current;
	    const nextYawOffset = normalizeAngleDelta(pendingYawOffsetMagneticRef.current - declinationDeg);
	    pendingYawOffsetMagneticRef.current = null;
	    yawOffsetMigratedRef.current = true;
	    setYawOffset(nextYawOffset);
	    try {
	      const key = calibrationKeyRef.current;
	      const raw = window.localStorage.getItem(key);
	      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
	      const existing = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
	      window.localStorage.setItem(key, JSON.stringify({ ...existing, yawOffset: nextYawOffset, headingReference: 'true' }));
	    } catch {
	      // ignore
	    }
	  }, [location]);

	  useEffect(() => {
		    if (motionPermission !== 'granted') return;
	    if (xrActive) return;
		    let absoluteStreamHealthy = false;
	    let lastAbsoluteAtMs = 0;
      let screenAngleStableDeg: 0 | 90 | 180 | 270 = 0;
      let screenAngleCandidateDeg: 0 | 90 | 180 | 270 = 0;
      let screenAngleCandidateSinceMs: number | null = null;
      let tiltHeadingActive = false;
      let lastWebkitCompassHeadingViewportDeg: number | null = null;
      let lastWebkitCompassAtMs: number | null = null;

      const MAX_JUMP_DEG = 12;
      const MAX_PITCH_JUMP_DEG = 8;
      const MAX_YAW_RATE_DEG_PER_SEC = 720;
      const MAX_PITCH_RATE_DEG_PER_SEC = 110;
      const MAX_ROLL_RATE_DEG_PER_SEC = 360;
      const SCREEN_ANGLE_SWITCH_HOLD_MS = 320;
      const TILT_HEADING_MAG_ON = 0.25;
      const TILT_HEADING_MAG_OFF = 0.18;
      const WEBKIT_COMPASS_HOLD_MS = 2000;
      const YAW_FILTER = { minCutoff: 0.6, beta: 0.03, dCutoff: 1.0 };
      const PITCH_FILTER = { minCutoff: 0.65, beta: 0.01, dCutoff: 1.0 };
      const ROLL_FILTER = { minCutoff: 0.7, beta: 0.01, dCutoff: 1.0 };
      const FUSION_SENSOR_MAX_AGE_MS = 1500;
      const FUSION_GRAVITY_MAX_AGE_MS = 750;
      const FUSION_GRAVITY_CUTOFF_HZ = 2.0;

      const readReportedScreenAngle = () => {
        const screenAngleRaw =
          typeof window !== 'undefined'
            ? typeof window.screen?.orientation?.angle === 'number'
              ? window.screen.orientation.angle
              : typeof (window as any).orientation === 'number'
                ? Number((window as any).orientation)
                : 0
            : 0;
        const screenAngleNorm = ((screenAngleRaw % 360) + 360) % 360;
        const screenAngleRounded = (Math.round(screenAngleNorm / 90) * 90) % 360;
        const normalized = (screenAngleRounded === 0 || screenAngleRounded === 90 || screenAngleRounded === 180 || screenAngleRounded === 270
          ? screenAngleRounded
          : 0) as 0 | 90 | 180 | 270;

        // Some iOS WebKit builds can report a landscape `screen.orientation.angle` while the viewport is clearly portrait.
        // That produces a consistent ~90° yaw error. Clamp to portrait in that situation.
        const vv = typeof window !== 'undefined' ? window.visualViewport : null;
        const w = Number((vv?.width ?? window.innerWidth) || 0);
        const h = Number((vv?.height ?? window.innerHeight) || 0);
        const isPortraitViewport = Number.isFinite(w) && Number.isFinite(h) ? h >= w : true;
        if (isPortraitViewport && (normalized === 90 || normalized === 270)) return 0;

        return normalized;
      };

      const applyPitchEstimate = (nextPitchRaw: number, dtSec: number, source: PitchSource) => {
        const nextPitch = clamp(nextPitchRaw, -90, 90);
        const prev = poseFilterRef.current.pitch;
        if (prev == null) {
          poseFilterRef.current.pitchFilter = { xHat: nextPitch, dxHat: 0 };
          poseFilterRef.current.pitch = nextPitch;
          if (poseFilterRef.current.debug) poseFilterRef.current.debug.pitchSource = source;
          return { suppressedJump: false };
        }

        const rawDelta = nextPitch - prev;
        const motionRate = motionStatsRef.current.rotRateMagDegPerSec;
        const motionLimitedDelta = Math.max(1.4, motionRate * dtSec * 1.2);
        const maxDelta = Math.min(MAX_PITCH_JUMP_DEG, MAX_PITCH_RATE_DEG_PER_SEC * dtSec, motionLimitedDelta);
        const clampedDelta = clamp(rawDelta, -maxDelta, maxDelta);
        const stepped = prev + clampedDelta;
        poseFilterRef.current.pitch = clamp(oneEuroUpdate(poseFilterRef.current.pitchFilter, stepped, dtSec, PITCH_FILTER), -90, 90);
        if (poseFilterRef.current.debug) poseFilterRef.current.debug.pitchSource = source;
        return { suppressedJump: Math.abs(rawDelta - clampedDelta) > 0.05 };
      };

      const applyOneEuroHeading = (rawHeading: number, dtSec: number) => {
        const prevUnwrapped = poseFilterRef.current.headingUnwrapped;
        if (prevUnwrapped == null) {
          poseFilterRef.current.headingUnwrapped = rawHeading;
          poseFilterRef.current.headingFilter = { xHat: rawHeading, dxHat: 0 };
          poseFilterRef.current.heading = rawHeading;
          return;
        }
        const prevWrapped = wrapAngle360(prevUnwrapped);
        const delta = normalizeAngleDelta(rawHeading - prevWrapped);
        const maxDelta = Math.min(MAX_JUMP_DEG, MAX_YAW_RATE_DEG_PER_SEC * dtSec);
        const clampedDelta = clamp(delta, -maxDelta, maxDelta);
        const nextUnwrapped = prevUnwrapped + clampedDelta;
        poseFilterRef.current.headingUnwrapped = nextUnwrapped;

        const filteredUnwrapped = oneEuroUpdate(poseFilterRef.current.headingFilter, nextUnwrapped, dtSec, YAW_FILTER);
        poseFilterRef.current.heading = wrapAngle360(filteredUnwrapped);
      };

	      const applyFusionHeadingOutput = (now: number, headingUnwrapped: number, dtSec: number) => {
	        const fusion = fusionRef.current;
	        const dtOutRaw = fusion.lastOutputAtMs != null ? (now - fusion.lastOutputAtMs) / 1000 : dtSec;
	        const dtOut = clamp(dtOutRaw, 0.004, 0.25);
	        fusion.lastOutputAtMs = now;

        poseFilterRef.current.headingUnwrapped = headingUnwrapped;
        if (poseFilterRef.current.headingFilter.xHat == null) {
          poseFilterRef.current.headingFilter = { xHat: headingUnwrapped, dxHat: 0 };
        }
	        const filteredUnwrapped = oneEuroUpdate(poseFilterRef.current.headingFilter, headingUnwrapped, dtOut, YAW_FILTER);
	        poseFilterRef.current.heading = wrapAngle360(filteredUnwrapped);
	      };

	      const syncFusionTelemetry = () => {
	        const fusion = fusionRef.current;
	        telemetrySnapshotRef.current.fusionEnabled = fusion.enabled;
	        telemetrySnapshotRef.current.fusionUsed = fusion.used;
	        telemetrySnapshotRef.current.fusionFallbackReason =
	          fusion.enabled && fusion.fallbackReason && fusion.fallbackReason !== 'disabled'
	            ? (fusion.fallbackReason as Exclude<FusionFallbackReason, 'disabled'>)
	            : null;
	      };

		    function handleOrientation(event: DeviceOrientationEvent) {
	      const eventType = (event as any).type;
	      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
	      if (eventType === 'deviceorientation' && absoluteStreamHealthy && now - lastAbsoluteAtMs < 1500) return;
	      const lastAtMs = poseFilterRef.current.lastAtMs;
	      const dtSec = lastAtMs != null ? Math.min(0.25, Math.max(0.01, (now - lastAtMs) / 1000)) : 0.016;
	      poseFilterRef.current.lastAtMs = now;

        const screenAngleReportedDeg = readReportedScreenAngle();
        if (screenAngleReportedDeg !== screenAngleStableDeg) {
          if (screenAngleReportedDeg !== screenAngleCandidateDeg) {
            screenAngleCandidateDeg = screenAngleReportedDeg;
            screenAngleCandidateSinceMs = now;
          } else if (screenAngleCandidateSinceMs != null && now - screenAngleCandidateSinceMs >= SCREEN_ANGLE_SWITCH_HOLD_MS) {
            screenAngleStableDeg = screenAngleCandidateDeg;
            screenAngleCandidateSinceMs = null;
          }
        } else {
          screenAngleCandidateSinceMs = null;
        }
        const screenAngleDeg = screenAngleStableDeg;
        const screenAngleSignedDeg = screenAngleDeg > 180 ? screenAngleDeg - 360 : screenAngleDeg;

	      const alpha = typeof event.alpha === 'number' && Number.isFinite(event.alpha) ? event.alpha : null;
	      const beta = typeof event.beta === 'number' && Number.isFinite(event.beta) ? event.beta : null;
	      const gamma = typeof event.gamma === 'number' && Number.isFinite(event.gamma) ? event.gamma : null;
	      const absolute = typeof event.absolute === 'boolean' ? event.absolute : null;
	      const webkitHeading = (event as any).webkitCompassHeading;
        const webkitAccuracyRaw = (event as any).webkitCompassAccuracy;

	      const alphaHeadingDeg =
	        alpha != null ? wrapAngle360(360 - alpha + screenAngleSignedDeg) : null;
	      const tiltHeading =
	        alpha != null && beta != null && gamma != null ? tiltCompensatedHeadingDegrees(alpha, beta, gamma, screenAngleSignedDeg) : null;
        const tiltHeadingDeg = tiltHeading?.headingDeg ?? null;
        const tiltHeadingMag = tiltHeading?.mag ?? null;
	      const webkitCompassHeadingDeg =
	        typeof webkitHeading === 'number' && Number.isFinite(webkitHeading) ? ((webkitHeading % 360) + 360) % 360 : null;
        let webkitCompassHeadingViewportDeg =
          webkitCompassHeadingDeg != null ? wrapAngle360(webkitCompassHeadingDeg + screenAngleSignedDeg) : null;
        let webkitCompassHeld = false;
        if (webkitCompassHeadingViewportDeg != null) {
          lastWebkitCompassHeadingViewportDeg = webkitCompassHeadingViewportDeg;
          lastWebkitCompassAtMs = now;
        } else if (
          lastWebkitCompassHeadingViewportDeg != null &&
          lastWebkitCompassAtMs != null &&
          now - lastWebkitCompassAtMs < WEBKIT_COMPASS_HOLD_MS
        ) {
          webkitCompassHeadingViewportDeg = lastWebkitCompassHeadingViewportDeg;
          webkitCompassHeld = true;
        }
        const webkitCompassAccuracyDeg =
          typeof webkitAccuracyRaw === 'number' && Number.isFinite(webkitAccuracyRaw) ? Math.max(0, webkitAccuracyRaw) : null;
	      const isAbsoluteEvent = eventType === 'deviceorientationabsolute' || absolute === true || webkitCompassHeadingViewportDeg != null;
	      const headingMagneticDeg =
	        webkitCompassHeadingViewportDeg != null
	          ? webkitCompassHeadingViewportDeg
	          : (() => {
                if (tiltHeadingDeg == null || tiltHeadingMag == null) {
                  tiltHeadingActive = false;
                  return alphaHeadingDeg;
                }
                if (!tiltHeadingActive && tiltHeadingMag >= TILT_HEADING_MAG_ON) tiltHeadingActive = true;
                else if (tiltHeadingActive && tiltHeadingMag <= TILT_HEADING_MAG_OFF) tiltHeadingActive = false;
                return tiltHeadingActive ? tiltHeadingDeg : alphaHeadingDeg;
              })();
	      const nextHeadingSource: HeadingSource =
	        webkitCompassHeadingViewportDeg != null
	          ? 'webkit_compass'
	          : tiltHeadingActive && tiltHeadingDeg != null
	            ? 'deviceorientation_tilt_comp'
	            : alphaHeadingDeg != null
	              ? isAbsoluteEvent
	                ? 'deviceorientation_absolute'
	                : 'deviceorientation_relative'
	              : 'unknown';
		      headingSourceRef.current = nextHeadingSource;
          const canApplyDeclination =
            isAbsoluteEvent && declinationBucketRef.current != null && declinationSourceRef.current !== 'none';
		      declinationAppliedRef.current = canApplyDeclination;
		      const declinationDeg = canApplyDeclination ? declinationDegRef.current : 0;
		      let headingRejected = false;
		      let headingDeltaFromPoseDeg: number | null = null;
		      let rotRateMagDegPerSec: number | null = null;
		      const rawHeading = headingMagneticDeg != null ? wrapAngle360(headingMagneticDeg + declinationDeg) : null;

		      if (rawHeading != null) {
		        if (nextHeadingSource === 'webkit_compass') {
		          const prevPoseHeading = poseFilterRef.current.heading;
		          if (typeof prevPoseHeading === 'number' && Number.isFinite(prevPoseHeading)) {
		            headingDeltaFromPoseDeg = Math.abs(normalizeAngleDelta(rawHeading - prevPoseHeading));
		          }
		          const stats = motionStatsRef.current;
		          const rotRateFresh = stats.lastAtMs != null && now - stats.lastAtMs < 250;
		          rotRateMagDegPerSec = rotRateFresh ? stats.rotRateMagDegPerSec : null;
		          // Large jump + basically no rotation => likely compass glitch (often an ~180 deg flip).
		          if (headingDeltaFromPoseDeg != null && rotRateMagDegPerSec != null) {
		            if (headingDeltaFromPoseDeg > 90 && rotRateMagDegPerSec < 20) headingRejected = true;
		          }
		        }

		        if (!headingRejected) {
		        updateHeadingQuality(rawHeading);
		        const fusion = fusionRef.current;
		        const fusionEnabled = fusion.enabled;
		        const gyroFresh = fusion.gyroAtMs != null && now - fusion.gyroAtMs < FUSION_SENSOR_MAX_AGE_MS;
		        const gravityFresh =
		          fusion.gravityAtMs != null && fusion.gravity != null && now - fusion.gravityAtMs < FUSION_GRAVITY_MAX_AGE_MS;
		        const useFusion = fusionEnabled && gyroFresh && gravityFresh;

		        if (!useFusion) {
		          applyOneEuroHeading(rawHeading, dtSec);

		          if (fusionEnabled) {
		            fusion.lastMeasurementHeading = rawHeading;
		            fusion.lastMeasurementAtMs = now;
		            const seed = poseFilterRef.current.headingUnwrapped ?? rawHeading;
		            fusion.headingUnwrapped = seed;
		            fusion.headingAtLastMeasurementUnwrapped = seed;
		            fusion.lastOutputAtMs = now;

			            if (!gyroFresh) fusion.fallbackReason = 'no_gyro';
			            else if (fusion.gravityAtMs == null || fusion.gravity == null) fusion.fallbackReason = 'no_gravity';
			            else if (now - fusion.gravityAtMs > FUSION_GRAVITY_MAX_AGE_MS) fusion.fallbackReason = 'gravity_unreliable';
			            else fusion.fallbackReason = fusion.headingUnwrapped == null ? 'not_initialized' : null;
			            syncFusionTelemetry();
			          }
			        } else {
		          const prevMeasurementHeading = fusion.lastMeasurementHeading;
		          const prevMeasurementAtMs = fusion.lastMeasurementAtMs;
		          const prevHeadingAtMeas = fusion.headingAtLastMeasurementUnwrapped;

		          fusion.lastMeasurementHeading = rawHeading;
		          fusion.lastMeasurementAtMs = now;

		          if (fusion.headingUnwrapped == null) {
		            const seed = poseFilterRef.current.headingUnwrapped ?? rawHeading;
		            fusion.headingUnwrapped = seed;
		            fusion.headingAtLastMeasurementUnwrapped = seed;
		            fusion.lastOutputAtMs = now;
		            poseFilterRef.current.headingFilter = { xHat: seed, dxHat: 0 };
		          }

		          if (fusion.headingUnwrapped != null) {
		            let didFlipSign = false;
		            if (prevMeasurementHeading != null && prevHeadingAtMeas != null) {
		              const measurementDelta = normalizeAngleDelta(rawHeading - prevMeasurementHeading);
		              const predictedDelta = normalizeAngleDelta(
		                wrapAngle360(fusion.headingUnwrapped) - wrapAngle360(prevHeadingAtMeas)
		              );
		              if (Math.abs(measurementDelta) > 12 && Math.abs(predictedDelta) > 12 && measurementDelta * predictedDelta < 0) {
		                fusion.yawSign = fusion.yawSign === 1 ? -1 : 1;
		                fusion.headingUnwrapped = rawHeading;
		                fusion.headingAtLastMeasurementUnwrapped = rawHeading;
		                poseFilterRef.current.headingFilter = { xHat: rawHeading, dxHat: 0 };
		                didFlipSign = true;
		              }
		            }

		            if (!didFlipSign) {
		              const estimateWrapped = wrapAngle360(fusion.headingUnwrapped);
		              const error = normalizeAngleDelta(rawHeading - estimateWrapped);
		              const dtMeasSecRaw = prevMeasurementAtMs != null ? (now - prevMeasurementAtMs) / 1000 : dtSec;
		              const dtMeasSec = clamp(dtMeasSecRaw, 0.004, 0.25);
		              const stability = headingStabilityRef.current;
		              const tauSec = stability === 'good' ? 1.0 : stability === 'fair' ? 2.0 : stability === 'poor' ? 6.0 : 3.0;
		              const gain = 1 - Math.exp(-dtMeasSec / Math.max(0.1, tauSec));
		              fusion.headingUnwrapped += error * gain;
		              fusion.headingAtLastMeasurementUnwrapped = fusion.headingUnwrapped;
		            }

			            applyFusionHeadingOutput(now, fusion.headingUnwrapped, dtSec);
			            fusion.fallbackReason = null;
			            syncFusionTelemetry();
			          }
			        }
		        }
			      }

	      const hasValues = rawHeading != null || beta != null || gamma != null;
	      if (hasValues) {
	        const stats = poseUpdateStatsRef.current;
	        stats.count += 1;
	        if (stats.firstAtMs == null) stats.firstAtMs = now;
	        stats.lastAtMs = now;
	      }
		      // Only treat a separate `deviceorientationabsolute` stream as grounds to ignore the regular
		      // `deviceorientation` events. On iOS Safari we only get `deviceorientation` (often with
		      // `webkitCompassHeading`), and filtering those out makes pose updates appear ~1.5s behind.
	      if (eventType === 'deviceorientationabsolute' && hasValues) {
	        absoluteStreamHealthy = true;
	        lastAbsoluteAtMs = now;
	      }
      const nextPoseSource = (isAbsoluteEvent ? 'deviceorientationabsolute' : 'deviceorientation') satisfies Exclude<
        PoseSource,
        'webxr' | 'sky_compass'
      >;
      if (lastNonSkyPoseSourceRef.current !== nextPoseSource) {
        lastNonSkyPoseSourceRef.current = nextPoseSource;
        setPoseSource((prev) => {
          if (prev === 'sky_compass' || prev === 'webxr') return prev;
          return nextPoseSource;
        });
      }

	      // Convert DeviceOrientation beta/gamma into a stable "look elevation" pitch.
	      // Use screen-angle aware blending plus hysteresis to avoid axis flip jumps.
	      let tiltFrontBackDeg: number | null = null;
	      let rollDeg: number | null = null;
        const screenAngleRad = (screenAngleDeg * Math.PI) / 180;
	      if (beta != null && gamma != null) {
          tiltFrontBackDeg = beta * Math.cos(screenAngleRad) + gamma * Math.sin(screenAngleRad);
          rollDeg = gamma * Math.cos(screenAngleRad) - beta * Math.sin(screenAngleRad);
	      } else if (beta != null) {
	        tiltFrontBackDeg = beta;
	      } else if (gamma != null) {
	        tiltFrontBackDeg = gamma;
	      }

        let pitchRawDeg: number | null = null;
        let pitchSuppressedJump = false;
	      if (tiltFrontBackDeg != null) {
	        // 0° = horizon, +90° = straight up, -90° = straight down.
	        pitchRawDeg = clamp(tiltFrontBackDeg - 90, -90, 90);
          const applied = applyPitchEstimate(pitchRawDeg, dtSec, 'deviceorientation');
          pitchSuppressedJump = applied.suppressedJump;
	      }
		      if (rollDeg != null) rollDeg = clamp(rollDeg, -90, 90);
		      if (rollDeg != null && Math.abs(rollDeg) < 2) rollDeg = 0;
			      poseFilterRef.current.debug = {
		        screenAngleDeg,
            screenAngleReportedDeg,
		        alpha,
			        beta,
			        gamma,
            alphaHeadingDeg,
            tiltHeadingDeg,
            tiltHeadingMag,
		        tiltFrontBackDeg,
            pitchSource: pitchRawDeg != null ? 'deviceorientation' : 'unknown',
            pitchRawDeg,
            pitchSuppressedJump,
		        rollDeg,
			        headingMagneticDeg,
              webkitCompassHeadingDeg,
              webkitCompassHeadingViewportDeg,
              webkitCompassHeld,
              webkitCompassAccuracyDeg,
              headingDeltaFromPoseDeg,
              rotRateMagDegPerSec,
              headingRejected,
			        declinationDeg: canApplyDeclination ? declinationDeg : null,
	            declinationSource: canApplyDeclination ? declinationSourceRef.current : 'none',
			        headingDeg: rawHeading,
			        absolute
			      };

	      if (rollDeg != null) {
	        const prev = poseFilterRef.current.roll;
        if (prev == null) {
          poseFilterRef.current.rollFilter = { xHat: rollDeg, dxHat: 0 };
          poseFilterRef.current.roll = rollDeg;
        } else {
          const delta = rollDeg - prev;
          const maxDelta = Math.min(MAX_JUMP_DEG, MAX_ROLL_RATE_DEG_PER_SEC * dtSec);
          const clampedDelta = clamp(delta, -maxDelta, maxDelta);
          const stepped = prev + clampedDelta;
          poseFilterRef.current.roll = clamp(oneEuroUpdate(poseFilterRef.current.rollFilter, stepped, dtSec, ROLL_FILTER), -90, 90);
        }
      }

    }
	    window.addEventListener('deviceorientationabsolute' as any, handleOrientation as any, true);
	    window.addEventListener('deviceorientation', handleOrientation, true);
	    const handleMotion = (event: DeviceMotionEvent) => {
	      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
	      motionStatsRef.current.lastAtMs = now;
	      const rr = event.rotationRate;
	      const alpha = typeof rr?.alpha === 'number' && Number.isFinite(rr.alpha) ? rr.alpha : null;
	      const beta = typeof rr?.beta === 'number' && Number.isFinite(rr.beta) ? rr.beta : null;
	      const gamma = typeof rr?.gamma === 'number' && Number.isFinite(rr.gamma) ? rr.gamma : null;
	      const alpha0 = alpha ?? 0;
	      const beta0 = beta ?? 0;
	      const gamma0 = gamma ?? 0;
	      motionStatsRef.current.rotRateMagDegPerSec = Math.sqrt(alpha0 * alpha0 + beta0 * beta0 + gamma0 * gamma0);

	      const a = event.accelerationIncludingGravity;
	      const ax = typeof a?.x === 'number' && Number.isFinite(a.x) ? a.x : null;
	      const ay = typeof a?.y === 'number' && Number.isFinite(a.y) ? a.y : null;
	      const az = typeof a?.z === 'number' && Number.isFinite(a.z) ? a.z : null;
	      const ax0 = ax ?? 0;
	      const ay0 = ay ?? 0;
	      const az0 = az ?? 0;
	      motionStatsRef.current.accelMagMps2 = Math.sqrt(ax0 * ax0 + ay0 * ay0 + az0 * az0);

	      const fusion = fusionRef.current;
	      const dtSecRaw = fusion.lastMotionAtMs != null ? (now - fusion.lastMotionAtMs) / 1000 : 0.016;
	      const dtSec = clamp(dtSecRaw, 0.004, 0.05);
	      fusion.lastMotionAtMs = now;

	      const hasGyroSample = alpha != null || beta != null || gamma != null;
	      if (hasGyroSample) fusion.gyroAtMs = now;

	      const hasGravitySample = ax != null || ay != null || az != null;
	      if (hasGravitySample) {
	        const gMag = Math.sqrt(ax0 * ax0 + ay0 * ay0 + az0 * az0);
	        const gLooksLikeG = gMag > 0.5 && gMag < 2.0;
	        const gLooksLikeMps2 = gMag > 5.0 && gMag < 15.0;
	        if (gLooksLikeG || gLooksLikeMps2) {
	          const aG = lowPassAlpha(FUSION_GRAVITY_CUTOFF_HZ, dtSec);
	          if (fusion.gravity == null) fusion.gravity = { x: ax0, y: ay0, z: az0 };
	          else {
	            fusion.gravity.x = aG * ax0 + (1 - aG) * fusion.gravity.x;
	            fusion.gravity.y = aG * ay0 + (1 - aG) * fusion.gravity.y;
	            fusion.gravity.z = aG * az0 + (1 - aG) * fusion.gravity.z;
	          }
	          fusion.gravityAtMs = now;
	        }
	      }

		      if (!fusion.enabled) {
		        fusion.fallbackReason = 'disabled';
		        syncFusionTelemetry();
		        return;
		      }

		      // Skip large discontinuities (tab hidden / sensor paused).
		      if (dtSecRaw <= 0 || dtSecRaw > 0.25) {
		        fusion.lastOutputAtMs = now;
		        syncFusionTelemetry();
		        return;
		      }

		      if (!hasGyroSample || fusion.gyroAtMs == null || now - fusion.gyroAtMs > FUSION_SENSOR_MAX_AGE_MS) {
		        fusion.fallbackReason = 'no_gyro';
		        syncFusionTelemetry();
		        return;
		      }

		      if (fusion.gravityAtMs == null || fusion.gravity == null) {
		        fusion.fallbackReason = 'no_gravity';
		        syncFusionTelemetry();
		        return;
		      }
		      if (now - fusion.gravityAtMs > FUSION_GRAVITY_MAX_AGE_MS) {
		        fusion.fallbackReason = 'gravity_unreliable';
		        syncFusionTelemetry();
		        return;
		      }

		      if (fusion.headingUnwrapped == null) {
		        fusion.fallbackReason = 'not_initialized';
		        syncFusionTelemetry();
		        return;
		      }

	      const g = fusion.gravity;
		      const gMag = Math.sqrt(g.x * g.x + g.y * g.y + g.z * g.z);
		      if (!(gMag > 1e-3)) {
		        fusion.fallbackReason = 'gravity_unreliable';
		        syncFusionTelemetry();
		        return;
		      }
	      const ux = g.x / gMag;
	      const uy = g.y / gMag;
	      const uz = g.z / gMag;

	      // DeviceMotion rotationRate is in device axes: beta=x, gamma=y, alpha=z.
	      const omegaX = beta0;
	      const omegaY = gamma0;
	      const omegaZ = alpha0;
	      const yawRate = fusion.yawSign * (omegaX * ux + omegaY * uy + omegaZ * uz);
	      const yawRateClamped = clamp(yawRate, -MAX_YAW_RATE_DEG_PER_SEC, MAX_YAW_RATE_DEG_PER_SEC);
	      fusion.headingUnwrapped += yawRateClamped * dtSec;

		      applyFusionHeadingOutput(now, fusion.headingUnwrapped, dtSec);
		      fusion.used = true;
		      fusion.fallbackReason = null;
		      syncFusionTelemetry();
		    };
    window.addEventListener('devicemotion', handleMotion, true);
    return () => {
      window.removeEventListener('deviceorientationabsolute' as any, handleOrientation as any, true);
      window.removeEventListener('deviceorientation', handleOrientation, true);
      window.removeEventListener('devicemotion', handleMotion, true);
    };
  }, [motionPermission, updateHeadingQuality, xrActive]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let lastHeading: number | null = null;
    let lastPitch: number | null = null;
    let lastRoll: number | null = null;

    const publish = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const rawHeading = poseFilterRef.current.heading;
      const rawPitch = poseFilterRef.current.pitch;
      const rawRoll = poseFilterRef.current.roll;

      const nextHeading = typeof rawHeading === 'number' && Number.isFinite(rawHeading) ? rawHeading : null;
      const nextPitch = typeof rawPitch === 'number' && Number.isFinite(rawPitch) ? rawPitch : null;
      const nextRoll = typeof rawRoll === 'number' && Number.isFinite(rawRoll) ? rawRoll : null;

      const headingChanged =
        lastHeading == null
          ? nextHeading != null
          : nextHeading == null
            ? true
            : Math.abs(normalizeAngleDelta(nextHeading - lastHeading)) > 0.5;
      const pitchChanged =
        lastPitch == null ? nextPitch != null : nextPitch == null ? true : Math.abs(nextPitch - lastPitch) > 0.3;
      const rollChanged = lastRoll == null ? nextRoll != null : nextRoll == null ? true : Math.abs(nextRoll - lastRoll) > 0.3;

      if (headingChanged) {
        lastHeading = nextHeading;
        setHeading(nextHeading);
      }
      if (pitchChanged) {
        lastPitch = nextPitch;
        setPitch(nextPitch);
      }
      if (rollChanged) {
        lastRoll = nextRoll;
        setRoll(nextRoll);
      }
    };

    publish();
    const id = window.setInterval(publish, 50);
    return () => window.clearInterval(id);
  }, []);

  const padBearing = useMemo(() => {
    if (!location || pad.latitude == null || pad.longitude == null) return null;
    return bearingDegrees(location.lat, location.lon, pad.latitude, pad.longitude);
  }, [location, pad.latitude, pad.longitude]);

  const durationSec = useMemo(() => {
    const tracks = Array.isArray(trajectory?.tracks) ? trajectory.tracks : [];
    if (tracks.length === 0) return 0;
    let max = 0;
    for (const track of tracks) {
      const samples = Array.isArray(track?.samples) ? track.samples : [];
      for (const sample of samples) {
        if (typeof sample?.tPlusSec === 'number' && Number.isFinite(sample.tPlusSec)) {
          if (sample.tPlusSec > max) max = sample.tPlusSec;
        }
      }
    }
    return Math.max(0, Math.floor(max));
  }, [trajectory]);

  const netDisplay = useMemo(() => {
    if (!net) return null;
    try {
      return new Date(net).toLocaleString();
    } catch {
      return net;
    }
  }, [net]);

  const liftoffAtMs = useMemo(() => {
    if (!net) return null;
    const parsed = Date.parse(net);
    return Number.isFinite(parsed) ? parsed : null;
  }, [net]);

  const time = useTrajectoryTime({ netIso: net, durationSec });

  const displayTSec = useMemo(() => {
    if (time.mode !== 'LIVE') return time.tSelectedSec;
    if (!time.isBeforeLiftoff) return time.tSelectedSec;
    if (showWizard) return time.tSelectedSec;
    if (!(durationSec > 0)) return time.tSelectedSec;
    return Math.min(durationSec, 60);
  }, [durationSec, showWizard, time.isBeforeLiftoff, time.mode, time.tSelectedSec]);

  const effectiveYawOffset = useMemo(() => normalizeAngleDelta(yawOffset + autoYawBias), [yawOffset, autoYawBias]);
  const effectivePitchOffset = useMemo(() => pitchOffset + autoPitchBias, [pitchOffset, autoPitchBias]);

  const adjustedHeading = useMemo(() => {
    if (heading == null) return null;
    const next = (heading + effectiveYawOffset + 360) % 360;
    return next;
  }, [effectiveYawOffset, heading]);

  const adjustedPitch = useMemo(() => {
    if (pitch == null) return null;
    return pitch - effectivePitchOffset;
  }, [effectivePitchOffset, pitch]);

  const padElevation = useMemo(() => {
    if (!location || pad.latitude == null || pad.longitude == null) return null;
    const userAlt = typeof location.altMeters === 'number' && Number.isFinite(location.altMeters) ? location.altMeters : 0;
    const userEcef = ecefFromLatLon(location.lat, location.lon, userAlt);
    const padEcef = ecefFromLatLon(pad.latitude, pad.longitude, 0);
    const enu = enuFromEcef(location.lat, location.lon, userEcef, padEcef);
    return azElFromEnu(enu).elDeg;
  }, [location, pad.latitude, pad.longitude]);

  const padRangeKm = useMemo(() => {
    if (!location || pad.latitude == null || pad.longitude == null) return null;
    if (!Number.isFinite(location.lat) || !Number.isFinite(location.lon)) return null;
    return haversineKm(location.lat, location.lon, pad.latitude, pad.longitude);
  }, [location, pad.latitude, pad.longitude]);

  const handleMotionPermission = useCallback(async () => {
    if (typeof DeviceOrientationEvent === 'undefined') {
      setMotionPermission('denied');
      return;
    }
    const requestOrientationPermission = (DeviceOrientationEvent as any).requestPermission;
    const requestMotionPermission =
      typeof DeviceMotionEvent !== 'undefined' ? (DeviceMotionEvent as any).requestPermission : undefined;
    if (typeof requestOrientationPermission === 'function' || typeof requestMotionPermission === 'function') {
      try {
        const orientationResult =
          typeof requestOrientationPermission === 'function' ? await requestOrientationPermission() : 'granted';
        const motionResult = typeof requestMotionPermission === 'function' ? await requestMotionPermission() : 'granted';
        setMotionPermission(orientationResult === 'granted' && motionResult === 'granted' ? 'granted' : 'denied');
      } catch {
        setMotionPermission('denied');
      }
    } else {
      setMotionPermission('granted');
    }
  }, []);

  const persistWizardDismissed = useCallback(() => {
    if (!AR_LEGACY_CALIBRATION_FLOW_ENABLED) return;
    if (typeof window === 'undefined') return;
    try {
      const key = calibrationKeyRef.current;
      const raw = window.localStorage.getItem(key);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      const existing = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      window.localStorage.setItem(key, JSON.stringify({ ...existing, wizardDismissed: true }));
    } catch {
      // ignore
    }
  }, []);

  const stopWebXr = useCallback(async () => {
    const session = xrSessionRef.current;
    if (!session) return;
    try {
      await session.end();
    } catch {
      // ignore
    }
  }, []);

  const startWebXr = useCallback(async (source: 'auto' | 'manual' = 'manual') => {
    if (xrActive) return;
    setXrError(null);
    setXrLaunchState('starting');
    const startupProbe = xrStartupProbeRef.current;
    if (startupProbe.timeoutId != null) {
      window.clearTimeout(startupProbe.timeoutId);
      startupProbe.timeoutId = null;
    }
    startupProbe.startedAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    startupProbe.firstPoseAtMs = null;
    startupProbe.frameStats = {
      lastFrameAtMs: null,
      frames: 0,
      dropped: 0
    };

    const xr = (typeof navigator !== 'undefined' ? (navigator as any).xr : null) as any;
    if (!xr || typeof xr.requestSession !== 'function') {
      setXrError('WebXR not available in this browser.');
      setXrSupport('unsupported');
      setXrLaunchState(source === 'auto' ? 'blocked' : 'idle');
      return;
    }

    try {
      const root = rootRef.current ?? document.body;
      const session = await xr.requestSession('immersive-ar', {
        requiredFeatures: ['local'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root }
      });
      xrSessionRef.current = session;
      setXrActive(true);

      // Stop our getUserMedia camera; WebXR will provide the camera background.
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setCameraActive(false);
      setCameraError(null);

      const glCanvas = xrCanvasRef.current ?? document.createElement('canvas');
      const gl = (glCanvas.getContext('webgl', { xrCompatible: true, alpha: true, antialias: true }) ??
        glCanvas.getContext('webgl2', { xrCompatible: true, alpha: true, antialias: true })) as any;
      if (!gl) throw new Error('WebGL not available (required for WebXR).');
      if (typeof gl.makeXRCompatible === 'function') await gl.makeXRCompatible();
      xrGlRef.current = gl;

      const baseLayer = new (window as any).XRWebGLLayer(session, gl);
      session.updateRenderState({ baseLayer });
      const refSpace = await session.requestReferenceSpace('local');
      xrRefSpaceRef.current = refSpace;

      const rotateVec = (q: { x: number; y: number; z: number; w: number }, v: [number, number, number]) => {
        const { x, y, z, w } = q;
        const vx = v[0];
        const vy = v[1];
        const vz = v[2];

        const tx = 2 * (y * vz - z * vy);
        const ty = 2 * (z * vx - x * vz);
        const tz = 2 * (x * vy - y * vx);

        return [
          vx + w * tx + (y * tz - z * ty),
          vy + w * ty + (z * tx - x * tz),
          vz + w * tz + (x * ty - y * tx)
        ] as [number, number, number];
      };

      const normalizeVec = (v: [number, number, number]) => {
        const m = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        if (!m) return v;
        return [v[0] / m, v[1] / m, v[2] / m] as [number, number, number];
      };

      const dot = (a: [number, number, number], b: [number, number, number]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const cross = (a: [number, number, number], b: [number, number, number]) =>
        [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] as [number, number, number];

      let lastPoseAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const evaluateStartupHealth = () => {
        const probe = xrStartupProbeRef.current;
        const startedAtMs = probe.startedAtMs;
        if (xrSessionRef.current !== session || startedAtMs == null) return;
        const firstPoseDelayMs =
          probe.firstPoseAtMs != null ? Math.max(0, probe.firstPoseAtMs - startedAtMs) : Number.POSITIVE_INFINITY;
        const stats = probe.frameStats;
        const totalFrames = stats.frames + stats.dropped;
        const droppedFrameRatio = totalFrames > 0 ? stats.dropped / totalFrames : 1;
        const healthy = firstPoseDelayMs <= 1000 && stats.frames >= 12 && droppedFrameRatio <= 0.35;
        if (healthy) {
          setXrLaunchState('healthy');
          return;
        }
        setXrLaunchState('blocked');
        setXrError('WebXR startup was unstable. Falling back to the camera overlay.');
        void session.end().catch(() => {});
      };

      const onFrame = (_t: number, frame: any) => {
        if (xrSessionRef.current !== session) return;
        const probe = xrStartupProbeRef.current;
        const frameNowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const frameStats = probe.frameStats;
        if (frameStats.lastFrameAtMs != null) {
          const frameDtMs = frameNowMs - frameStats.lastFrameAtMs;
          if (frameDtMs > 4 && frameDtMs < 250) {
            frameStats.dropped += Math.max(0, Math.round(frameDtMs / 16.67) - 1);
            frameStats.frames += 1;
          } else if (frameDtMs >= 250) {
            frameStats.frames += 1;
          }
        } else {
          frameStats.frames += 1;
        }
        frameStats.lastFrameAtMs = frameNowMs;
        const pose = frame.getViewerPose(refSpace);
        if (pose && pose.views && pose.views.length) {
          if (probe.firstPoseAtMs == null) {
            probe.firstPoseAtMs = frameNowMs;
          }
          const view = pose.views[0];
          const pm = view.projectionMatrix as Float32Array | number[] | undefined;
          if (pm && pm.length >= 16) {
            const m0 = Number(pm[0]);
            const m5 = Number(pm[5]);
            if (Number.isFinite(m0) && Number.isFinite(m5) && m0 !== 0 && m5 !== 0) {
              const nextFovX = (2 * Math.atan(1 / m0) * 180) / Math.PI;
              const nextFovY = (2 * Math.atan(1 / m5) * 180) / Math.PI;
              const prev = xrFovRef.current;
              if (!prev || Math.abs(prev.fovX - nextFovX) > 0.5 || Math.abs(prev.fovY - nextFovY) > 0.5) {
                xrFovRef.current = { fovX: nextFovX, fovY: nextFovY };
                setFovX(nextFovX);
                setFovY(nextFovY);
                setLensPreset('custom');
                setProjectionSource('projection_matrix');
              }
            }
          }

          const o = view.transform.orientation as { x: number; y: number; z: number; w: number } | undefined;
          if (o && Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.z) && Number.isFinite(o.w)) {
            const q = { x: o.x, y: o.y, z: o.z, w: o.w };
            const forward = normalizeVec(rotateVec(q, [0, 0, -1]));
            const up = normalizeVec(rotateVec(q, [0, 1, 0]));
            const worldUp: [number, number, number] = [0, 1, 0];

            const yawRad = Math.atan2(forward[0], -forward[2]);
            const pitchRad = Math.asin(clamp(forward[1], -1, 1));

            const projWorldUp = normalizeVec([
              worldUp[0] - forward[0] * dot(worldUp, forward),
              worldUp[1] - forward[1] * dot(worldUp, forward),
              worldUp[2] - forward[2] * dot(worldUp, forward)
            ]);
            const projUp = normalizeVec([
              up[0] - forward[0] * dot(up, forward),
              up[1] - forward[1] * dot(up, forward),
              up[2] - forward[2] * dot(up, forward)
            ]);
            const rollRad = Math.atan2(dot(cross(projWorldUp, projUp), forward), dot(projWorldUp, projUp));

            const yawDeg = ((yawRad * 180) / Math.PI + 360) % 360;
            const pitchDeg = (pitchRad * 180) / Math.PI;
            const rollDeg = (rollRad * 180) / Math.PI;

            const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
            const dtSec = Math.max(0.01, Math.min(0.25, (now - lastPoseAtMs) / 1000));
            lastPoseAtMs = now;
            const tau = 0.12;
            const a = 1 - Math.exp(-dtSec / tau);

            const prevHeading = poseFilterRef.current.heading;
            const nextHeading =
              typeof prevHeading === 'number' && Number.isFinite(prevHeading)
                ? (prevHeading + normalizeAngleDelta(yawDeg - prevHeading) * a + 360) % 360
                : yawDeg;
            const prevPitch = poseFilterRef.current.pitch;
            const nextPitch =
              typeof prevPitch === 'number' && Number.isFinite(prevPitch) ? prevPitch + (pitchDeg - prevPitch) * a : pitchDeg;
            const prevRoll = poseFilterRef.current.roll;
            const nextRoll =
              typeof prevRoll === 'number' && Number.isFinite(prevRoll) ? prevRoll + (rollDeg - prevRoll) * a : rollDeg;

            poseFilterRef.current.lastAtMs = now;
            poseFilterRef.current.heading = nextHeading;
            poseFilterRef.current.headingUnwrapped = nextHeading;
            poseFilterRef.current.pitch = nextPitch;
            poseFilterRef.current.roll = nextRoll;
          }
        }

        const layer = session.renderState.baseLayer;
        if (layer && gl) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
          gl.viewport(0, 0, layer.framebufferWidth, layer.framebufferHeight);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        }

        session.requestAnimationFrame(onFrame);
      };

      startupProbe.timeoutId = window.setTimeout(evaluateStartupHealth, 2000);

      session.addEventListener('end', () => {
        const probe = xrStartupProbeRef.current;
        if (probe.timeoutId != null) {
          window.clearTimeout(probe.timeoutId);
          probe.timeoutId = null;
        }
        probe.startedAtMs = null;
        probe.firstPoseAtMs = null;
        probe.frameStats = {
          lastFrameAtMs: null,
          frames: 0,
          dropped: 0
        };
        xrSessionRef.current = null;
        xrRefSpaceRef.current = null;
        xrGlRef.current = null;
        xrFovRef.current = null;
        setXrActive(false);
        setXrLaunchState((prev) => (prev === 'blocked' ? 'blocked' : 'idle'));
        // Restart our getUserMedia camera when exiting WebXR.
        setCameraAttempt((prev) => prev + 1);
      });

      session.requestAnimationFrame(onFrame);
    } catch (err: any) {
      const probe = xrStartupProbeRef.current;
      if (probe.timeoutId != null) {
        window.clearTimeout(probe.timeoutId);
        probe.timeoutId = null;
      }
      probe.startedAtMs = null;
      probe.firstPoseAtMs = null;
      setXrError(err?.message || 'Failed to start WebXR AR session.');
      xrSessionRef.current = null;
      xrRefSpaceRef.current = null;
      xrGlRef.current = null;
      xrFovRef.current = null;
      setXrActive(false);
      setXrLaunchState(source === 'auto' ? 'blocked' : 'idle');
    }
  }, [xrActive]);

  const handleRetrySensors = useCallback(async () => {
    setRetryCount((prev) => prev + 1);
    setCameraAttempt((prev) => prev + 1);
    setLocationAttempt((prev) => prev + 1);
    setXrError(null);
    setXrLaunchState('idle');
    xrAutoStartAttemptedRef.current = false;
    setHeading(null);
    setPitch(null);
    setRoll(null);
    setHeadingStability(null);
    headingDeltasRef.current = [];
    lastHeadingRef.current = null;
	    poseFilterRef.current = {
	      lastAtMs: null,
	      heading: null,
	      headingUnwrapped: null,
	      headingFilter: { xHat: null, dxHat: null },
	      pitch: null,
	      pitchFilter: { xHat: null, dxHat: null },
	      roll: null,
	      rollFilter: { xHat: null, dxHat: null }
	    };
    motionStatsRef.current = { lastAtMs: null, rotRateMagDegPerSec: 0, accelMagMps2: 0 };
    locationFilterRef.current = { lastAtMs: null, lat: null, lon: null, altMeters: null };
    if (yawCalIntervalRef.current != null) {
      window.clearInterval(yawCalIntervalRef.current);
      yawCalIntervalRef.current = null;
    }
    autoCalibrateArmedAtMsRef.current = null;
    autoCalibrateAttemptCountRef.current = 0;
    autoAlignmentScoreRef.current = 0;
    autoAlignmentResidualsRef.current = [];
    setAutoAlignmentReady(false);
    alignmentFeedbackRef.current = DEFAULT_ALIGNMENT_FEEDBACK;
    setAlignmentFeedback(DEFAULT_ALIGNMENT_FEEDBACK);
    setAutoYawBias(0);
    setAutoPitchBias(0);
    setIsCalibratingYaw(false);
    setMotionPermission('unknown');
    await handleMotionPermission();
  }, [handleMotionPermission]);

  useEffect(() => {
    const startupProbe = xrStartupProbeRef.current;
    return () => {
      if (startupProbe.timeoutId != null) {
        window.clearTimeout(startupProbe.timeoutId);
        startupProbe.timeoutId = null;
      }
      if (yawCalIntervalRef.current != null) {
        window.clearInterval(yawCalIntervalRef.current);
        yawCalIntervalRef.current = null;
      }
      if (xrSessionRef.current) {
        try {
          xrSessionRef.current.end();
        } catch {
          // ignore
        }
        xrSessionRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!AR_LEGACY_CALIBRATION_FLOW_ENABLED) return;
    if (typeof window === 'undefined') return;
    const id = window.setInterval(() => {
      if (!hasCalibratedRef.current) return;
      if (autoAlignmentReady || Math.abs(autoYawBias) > 0.01) return;
      if (isCalibratingYaw) return;
      if (padBearing == null) return;
      if (headingSourceRef.current === 'webkit_compass') return;
      if (headingStability === 'poor') return;
      if (motionStatsRef.current.rotRateMagDegPerSec > 60) return;

      setYawOffset((prev) => {
        const h = poseFilterRef.current.heading;
        if (typeof h !== 'number' || !Number.isFinite(h)) return prev;
        const adjusted = (h + prev + 360) % 360;
        const padErr = normalizeAngleDelta(padBearing - adjusted);
        if (Math.abs(padErr) > 1.2) return prev;
        const target = normalizeAngleDelta(padBearing - h);
        const delta = normalizeAngleDelta(target - prev);
        const next = prev + clamp(delta, -0.6, 0.6) * 0.08;
        return normalizeAngleDelta(next);
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [autoAlignmentReady, autoYawBias, headingStability, isCalibratingYaw, padBearing]);

  useEffect(() => {
    if (motionPermission !== 'unknown') return;
    if (xrActive) return;
    if (typeof DeviceOrientationEvent === 'undefined') {
      setMotionPermission('denied');
      return;
    }
    const requestPermission = (DeviceOrientationEvent as any).requestPermission;
    if (typeof requestPermission !== 'function') {
      setMotionPermission('granted');
      return;
    }

    const probeOrientation = (event: DeviceOrientationEvent) => {
      const webkitHeading = (event as any).webkitCompassHeading;
      const hasValues =
        (typeof webkitHeading === 'number' && Number.isFinite(webkitHeading)) ||
        (typeof event.alpha === 'number' && Number.isFinite(event.alpha)) ||
        (typeof event.beta === 'number' && Number.isFinite(event.beta)) ||
        (typeof event.gamma === 'number' && Number.isFinite(event.gamma));
      if (hasValues) setMotionPermission('granted');
    };

    const handleFirstTap = () => handleMotionPermission();

    window.addEventListener('deviceorientationabsolute' as any, probeOrientation as any, true);
    window.addEventListener('deviceorientation', probeOrientation, true);
    window.addEventListener('pointerdown', handleFirstTap, { once: true });
    return () => {
      window.removeEventListener('deviceorientationabsolute' as any, probeOrientation as any, true);
      window.removeEventListener('deviceorientation', probeOrientation, true);
      window.removeEventListener('pointerdown', handleFirstTap);
    };
  }, [motionPermission, handleMotionPermission, xrActive]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (
      !shouldAutoStartWebXr({
        profile: clientProfileForUi,
        policyHydrated: runtimePolicyHydrated,
        poseMode: runtimeDecision.poseMode,
        xrSupport,
        xrActive,
        xrLaunchState,
        autoStartAttempted: xrAutoStartAttemptedRef.current
      })
    ) {
      return;
    }

    const handleAutoStart = () => {
      if (xrActive || xrAutoStartAttemptedRef.current) return;
      xrAutoStartAttemptedRef.current = true;
      void startWebXr('auto');
    };

    window.addEventListener('pointerdown', handleAutoStart, { once: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', handleAutoStart);
    };
  }, [
    clientProfileForUi,
    runtimeDecision.poseMode,
    runtimePolicyHydrated,
    startWebXr,
    xrActive,
    xrLaunchState,
    xrSupport
  ]);


  const readCalibrationAimState = useCallback(() => {
    const padBearingDeg = padBearing;
    const yawTolDeg = clamp(fovX / 6, 4, 12);
    const pitchTolDeg = clamp(fovY / 6, 4, 12);

    if (padBearingDeg == null) {
      return {
        ok: false,
        stable: false,
        aimed: false,
        yawTolDeg,
        pitchTolDeg
      };
    }

    const h = poseFilterRef.current.heading ?? heading;
    if (typeof h !== 'number' || !Number.isFinite(h)) {
      return {
        ok: false,
        stable: false,
        aimed: false,
        yawTolDeg,
        pitchTolDeg
      };
    }

    const p = poseFilterRef.current.pitch ?? pitch;
    if (padElevation != null && (typeof p !== 'number' || !Number.isFinite(p))) {
      return {
        ok: false,
        stable: false,
        aimed: false,
        yawTolDeg,
        pitchTolDeg
      };
    }

    const adjustedH = wrapAngle360(h + effectiveYawOffset);
    const adjustedP = typeof p === 'number' && Number.isFinite(p) ? p - effectivePitchOffset : null;
    const yawErrDeg = normalizeAngleDelta(padBearingDeg - adjustedH);
    const pitchErrDeg = padElevation != null && adjustedP != null ? padElevation - adjustedP : null;
    const stable = headingStability !== 'poor' && motionStatsRef.current.rotRateMagDegPerSec <= 60 && !isCalibratingYaw;
    const aimed = Math.abs(yawErrDeg) <= yawTolDeg && (pitchErrDeg == null || Math.abs(pitchErrDeg) <= pitchTolDeg);

    return {
      ok: stable && aimed,
      stable,
      aimed,
      yawTolDeg,
      pitchTolDeg
    };
  }, [
    effectivePitchOffset,
    effectiveYawOffset,
    fovX,
    fovY,
    heading,
    headingStability,
    isCalibratingYaw,
    padBearing,
    padElevation,
    pitch
  ]);

  const startYawCalibration = useCallback(
    (source: 'manual' | 'auto') => {
      if (!AR_LEGACY_CALIBRATION_FLOW_ENABLED) return false;
      const MAX_APPLY_DELTA_DEG = 15;
      const padBearingDeg = padBearing;
      if (padBearingDeg == null) return false;
      if (!readCalibrationAimState().ok) return false;

      if (yawCalIntervalRef.current != null) {
        window.clearInterval(yawCalIntervalRef.current);
        yawCalIntervalRef.current = null;
      }
      autoCalibrateArmedAtMsRef.current = null;
      setIsCalibratingYaw(true);

      const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const samples: number[] = [];

      const finish = () => {
        if (yawCalIntervalRef.current != null) {
          window.clearInterval(yawCalIntervalRef.current);
          yawCalIntervalRef.current = null;
        }
        if (!samples.length) {
          setIsCalibratingYaw(false);
          return;
        }
        let sumSin = 0;
        let sumCos = 0;
        for (const deg of samples) {
          const rad = (deg * Math.PI) / 180;
          sumSin += Math.sin(rad);
          sumCos += Math.cos(rad);
        }
        const meanRad = Math.atan2(sumSin, sumCos);
        const meanDeg = (meanRad * 180) / Math.PI;
        const delta = normalizeAngleDelta(meanDeg - yawOffset);
        if (Math.abs(delta) > MAX_APPLY_DELTA_DEG) {
          setIsCalibratingYaw(false);
          return;
        }
        setYawOffset(meanDeg);
        setCalibrationNotice(null);
        setIsCalibratingYaw(false);
        hasCalibratedRef.current = true;
        autoCalibrateArmedAtMsRef.current = null;
        if (source === 'auto') autoCalibrateAttemptCountRef.current = AUTO_CALIBRATION_MAX_ATTEMPTS;
        setShowWizard(false);
        persistWizardDismissed();
      };

      const sample = () => {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (!readCalibrationAimState().ok) {
          if (yawCalIntervalRef.current != null) {
            window.clearInterval(yawCalIntervalRef.current);
            yawCalIntervalRef.current = null;
          }
          setIsCalibratingYaw(false);
          return;
        }
        const h = poseFilterRef.current.heading ?? heading;
        if (typeof h === 'number' && Number.isFinite(h)) {
          samples.push(normalizeAngleDelta(padBearingDeg - h));
          if (samples.length > 30) samples.shift();
        }
        if (now - startedAt >= 900) finish();
      };

      sample();
      yawCalIntervalRef.current = window.setInterval(sample, 50);
      return true;
    },
    [heading, padBearing, persistWizardDismissed, readCalibrationAimState, yawOffset]
  );

  const handleCalibrate = useCallback(() => {
    startYawCalibration('manual');
  }, [startYawCalibration]);

  useEffect(() => {
    if (!AR_LEGACY_CALIBRATION_FLOW_ENABLED) return;
    if (typeof window === 'undefined') return;
    const id = window.setInterval(() => {
      if (!showWizard) return;
      if (autoAlignmentReady) return;
      if (hasCalibratedRef.current || isCalibratingYaw) return;
      if (autoCalibrateAttemptCountRef.current >= AUTO_CALIBRATION_MAX_ATTEMPTS) return;
      if (motionPermission !== 'granted') {
        autoCalibrateArmedAtMsRef.current = null;
        return;
      }
      if (!cameraActive || cameraError != null || locationError != null) {
        autoCalibrateArmedAtMsRef.current = null;
        return;
      }

      const aimState = readCalibrationAimState();
      if (!aimState.ok) {
        autoCalibrateArmedAtMsRef.current = null;
        return;
      }

      const now = Date.now();
      if (autoCalibrateArmedAtMsRef.current == null) {
        autoCalibrateArmedAtMsRef.current = now;
        return;
      }
      if (now - autoCalibrateArmedAtMsRef.current < AUTO_CALIBRATION_ARM_MS) return;

      autoCalibrateArmedAtMsRef.current = null;
      const started = startYawCalibration('auto');
      if (started) autoCalibrateAttemptCountRef.current += 1;
    }, 250);

    return () => window.clearInterval(id);
  }, [
    autoAlignmentReady,
    cameraActive,
    cameraError,
    isCalibratingYaw,
    locationError,
    motionPermission,
    readCalibrationAimState,
    showWizard,
    startYawCalibration
  ]);

  const handleResetCalibration = () => {
    if (yawCalIntervalRef.current != null) {
      window.clearInterval(yawCalIntervalRef.current);
      yawCalIntervalRef.current = null;
    }
    autoCalibrateArmedAtMsRef.current = null;
    autoCalibrateAttemptCountRef.current = 0;
    autoAlignmentScoreRef.current = 0;
    autoAlignmentResidualsRef.current = [];
    setAutoAlignmentReady(false);
    alignmentFeedbackRef.current = DEFAULT_ALIGNMENT_FEEDBACK;
    setAlignmentFeedback(DEFAULT_ALIGNMENT_FEEDBACK);
    setAutoYawBias(0);
    setAutoPitchBias(0);
    setIsCalibratingYaw(false);
    hasCalibratedRef.current = false;
    setYawOffset(0);
    setCalibrationNotice(null);
    setPitchOffset(0);
    setFovX(70);
    setFovY(45);
    setLensPreset('1x');
    setCorridorMode(defaultCorridorMode);
  };

  const downloadJsonFile = useCallback((filename: string, value: unknown) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    try {
      const json = JSON.stringify(value, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch {
      // ignore
    }
  }, []);

  const buildDiagnosticsSample = useCallback(() => {
    const nowMs = Date.now();
    const perfNowMs = typeof performance !== 'undefined' ? performance.now() : null;
    const loc = locationLatestRef.current;
    const debug = poseFilterRef.current.debug;
    const padBearingDeg = drawStateRef.current.padBearing;
    const padElevationDeg = drawStateRef.current.padElevation;
    const yawOffsetDeg = drawStateRef.current.yawOffset;
    const poseHeadingDeg = poseFilterRef.current.heading;
    const adjustedHeadingDeg =
      typeof poseHeadingDeg === 'number' && Number.isFinite(poseHeadingDeg) ? wrapAngle360(poseHeadingDeg + yawOffsetDeg) : null;
    const yawErrorDeg =
      padBearingDeg != null && adjustedHeadingDeg != null ? normalizeAngleDelta(padBearingDeg - adjustedHeadingDeg) : null;

    return {
      tMs: nowMs,
      perfMs: perfNowMs,
      location: loc
        ? {
            lat: loc.lat,
            lon: loc.lon,
            accuracy: typeof loc.accuracy === 'number' && Number.isFinite(loc.accuracy) ? loc.accuracy : null,
            altMeters: typeof loc.altMeters === 'number' && Number.isFinite(loc.altMeters) ? loc.altMeters : null,
            altAccuracy: typeof loc.altAccuracy === 'number' && Number.isFinite(loc.altAccuracy) ? loc.altAccuracy : null
          }
        : null,
      computed: {
        padBearingDeg,
        padElevationDeg,
        poseHeadingDeg: typeof poseHeadingDeg === 'number' && Number.isFinite(poseHeadingDeg) ? poseHeadingDeg : null,
        adjustedHeadingDeg,
        yawOffsetDeg,
        yawErrorDeg
      },
      alignment: {
        ready: autoAlignmentReady,
        stability: alignmentFeedbackRef.current.stability,
        biasConfidence: alignmentFeedbackRef.current.biasConfidence,
        corridorMode: alignmentFeedbackRef.current.recommendedCorridorMode,
        autoYawBiasDeg: autoYawBias,
        autoPitchBiasDeg: autoPitchBias,
        yawMeanDeg: alignmentFeedbackRef.current.yawMeanDeg,
        pitchMeanDeg: alignmentFeedbackRef.current.pitchMeanDeg
      },
      sensors: {
        headingSource: headingSourceRef.current,
        declinationApplied: declinationAppliedRef.current,
        declinationSource: declinationSourceRef.current
      },
      debug
    } satisfies Record<string, unknown>;
  }, [autoAlignmentReady, autoPitchBias, autoYawBias]);

  const stopAndDownloadTrace = useCallback(() => {
    const payload = traceRef.current;
    traceRef.current = null;
    if (traceIntervalIdRef.current != null) {
      window.clearInterval(traceIntervalIdRef.current);
      traceIntervalIdRef.current = null;
    }
    setTraceRecording(false);
    if (!payload) return;
    const suffix = `${Date.now()}`.slice(-6);
    downloadJsonFile(`ar-trace-${payload.launchId.slice(0, 8)}-${suffix}.json`, payload);
  }, [downloadJsonFile]);

  useEffect(() => {
    if (!traceRecording) return;
    if (typeof window === 'undefined') return;

    if (traceIntervalIdRef.current != null) {
      window.clearInterval(traceIntervalIdRef.current);
      traceIntervalIdRef.current = null;
    }

    const intervalMs = 200;
    const maxSamples = Math.max(10, Math.round(60_000 / intervalMs));
    traceRef.current = {
      schemaVersion: 1,
      startedAtIso: new Date().toISOString(),
      launchId,
      launchName,
      net: typeof net === 'string' ? net : null,
      pad: {
        name: pad.name,
        latitude: typeof pad.latitude === 'number' && Number.isFinite(pad.latitude) ? pad.latitude : null,
        longitude: typeof pad.longitude === 'number' && Number.isFinite(pad.longitude) ? pad.longitude : null
      },
      intervalMs,
      maxSamples,
      samples: []
    };

    const tick = () => {
      const payload = traceRef.current;
      if (!payload) return;
      payload.samples.push(buildDiagnosticsSample());
      if (payload.samples.length >= payload.maxSamples) {
        stopAndDownloadTrace();
      }
    };

    tick();
    traceIntervalIdRef.current = window.setInterval(tick, intervalMs);
    return () => {
      if (traceIntervalIdRef.current != null) {
        window.clearInterval(traceIntervalIdRef.current);
        traceIntervalIdRef.current = null;
      }
    };
  }, [buildDiagnosticsSample, launchId, launchName, net, pad.latitude, pad.longitude, pad.name, stopAndDownloadTrace, traceRecording]);

  const handleLevel = () => {
    const next = poseFilterRef.current.pitch ?? pitch;
    if (typeof next !== 'number' || !Number.isFinite(next)) return;
    setPitchOffset(next);
  };

  const calibrationAimState = readCalibrationAimState();
  const autoCalibrationPending =
    showWizard &&
    !autoAlignmentReady &&
    !hasCalibratedRef.current &&
    motionPermission === 'granted' &&
    autoCalibrateAttemptCountRef.current < AUTO_CALIBRATION_MAX_ATTEMPTS &&
    calibrationAimState.ok;

  const trajectoryTracks = useMemo(() => (Array.isArray(trajectory?.tracks) ? trajectory.tracks : []), [trajectory]);

  const primaryTrajectoryTrack = useMemo(() => {
    if (trajectoryTracks.length === 0) return null;
    return trajectoryTracks.find((track) => track.trackKind === 'core_up') ?? trajectoryTracks[0] ?? null;
  }, [trajectoryTracks]);

  const primaryTrajectoryTrackSamples = useMemo(() => primaryTrajectoryTrack?.samples ?? [], [primaryTrajectoryTrack]);

  const trajectoryTrackPointsByKind = useMemo<ArTrajectoryTrackPointMap>(() => {
    const pointsByKind: ArTrajectoryTrackPointMap = {};
    if (!location || trajectoryTracks.length === 0) return pointsByKind;
    const userAlt = typeof location.altMeters === 'number' && Number.isFinite(location.altMeters) ? location.altMeters : 0;
    const userEcef = ecefFromLatLon(location.lat, location.lon, userAlt);
    for (const track of trajectoryTracks) {
      const trackKind = track.trackKind;
      const points = (Array.isArray(track.samples) ? track.samples : [])
        .filter((sample) => typeof sample?.tPlusSec === 'number' && Number.isFinite(sample.tPlusSec))
        .map((sample) => {
          const enu = enuFromEcef(location.lat, location.lon, userEcef, sample.ecef);
          const { azDeg, elDeg } = azElFromEnu(enu);
          const sigmaDeg =
            typeof sample.sigmaDeg === 'number' && Number.isFinite(sample.sigmaDeg)
              ? sample.sigmaDeg
              : normalizeTrajectoryUncertainty(sample.uncertainty)?.sigmaDeg;
          const covariance =
            normalizeTrajectoryCovariance(sample.covariance) ??
            normalizeTrajectoryUncertainty(sample.uncertainty)?.covariance;
          const uncertainty =
            normalizeTrajectoryUncertainty(sample.uncertainty) ??
            (sigmaDeg != null || covariance != null ? { sigmaDeg, covariance } : undefined);
          return { azDeg, elDeg, tPlusSec: sample.tPlusSec, sigmaDeg, covariance, uncertainty };
        })
        .sort((a, b) => a.tPlusSec - b.tPlusSec);
      if (points.length > 0) pointsByKind[trackKind] = points;
    }
    return pointsByKind;
  }, [location, trajectoryTracks]);

  const trajectoryPoints = useMemo<TrajectoryAzElPoint[]>(() => {
    const trackKind = primaryTrajectoryTrack?.trackKind;
    if (!trackKind) return [];
    return trajectoryTrackPointsByKind[trackKind] ?? [];
  }, [primaryTrajectoryTrack, trajectoryTrackPointsByKind]);

  const trajectoryMaxElevation = useMemo(() => {
    if (!trajectoryPoints.length) return null;
    let max = Number.NEGATIVE_INFINITY;
    for (const point of trajectoryPoints) {
      if (typeof point?.elDeg === 'number' && Number.isFinite(point.elDeg)) {
        if (point.elDeg > max) max = point.elDeg;
      }
    }
    return Number.isFinite(max) ? max : null;
  }, [trajectoryPoints]);

  const trajectoryBelowHorizon = trajectoryMaxElevation != null && trajectoryMaxElevation < 0;
  const trajectorySampleCount = primaryTrajectoryTrackSamples.length;
  const hasTrajectoryLine = trajectorySampleCount >= 2;
  const trajectoryRenderable = hasTrajectoryLine && !trajectoryBelowHorizon;

  const trajectoryStatusLabel = useMemo(() => {
    if (!trajectory) return 'No guidance';
    if (!hasTrajectoryLine || trajectory.qualityState === 'pad_only' || trajectory.quality === 0) {
      return 'Pad marker only';
    }
    if (trajectoryBelowHorizon) return 'Below your horizon';
    if (trajectory.qualityState === 'precision') return 'Precision guidance';
    if (trajectory.qualityState === 'guided') return 'Guided corridor';
    return 'Search corridor';
  }, [trajectory, hasTrajectoryLine, trajectoryBelowHorizon]);

  const trajectoryEvidenceView = useMemo(() => {
    if (!trajectory) return null;
    return {
      confidenceBadge: trajectory.confidenceBadge,
      confidenceBadgeLabel: trajectory.confidenceBadgeLabel,
      evidenceLabel: trajectory.evidenceLabel
    };
  }, [trajectory]);

  const trajectoryCaveatLabels = useMemo(() => {
    if (!trajectory) return [];
    return dedupeTrajectoryReasonLabels([
      ...trajectory.publishPolicy.reasons,
      ...trajectory.publishPolicy.missingFields,
      ...trajectory.publishPolicy.blockingReasons,
      ...trajectory.confidenceReasons
    ]);
  }, [trajectory]);

  const trajectoryMilestones = useMemo(() => {
    const raw = trajectory?.milestones;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((event) => ({
        key: String(event.key || event.label || 'event'),
        tPlusSec: typeof event.tPlusSec === 'number' && Number.isFinite(event.tPlusSec) ? event.tPlusSec : null,
        label: String(event.label || event.key || 'Event').trim(),
        description: typeof event.description === 'string' ? event.description.trim() : null,
        timeText: typeof event.timeText === 'string' ? event.timeText.trim() : null,
        confidence: event.confidence,
        phase: event.phase,
        trackKind: event.trackKind,
        sourceType: event.sourceType,
        estimated: event.estimated === true,
        projectable: event.projectable === true,
        projectionReason: event.projectionReason,
        sourceRefIds: Array.isArray(event.sourceRefIds) ? event.sourceRefIds : []
      } satisfies TrajectoryMilestonePayload))
      .sort((left, right) => {
        const leftTime = typeof left.tPlusSec === 'number' ? left.tPlusSec : Number.POSITIVE_INFINITY;
        const rightTime = typeof right.tPlusSec === 'number' ? right.tPlusSec : Number.POSITIVE_INFINITY;
        if (leftTime !== rightTime) return leftTime - rightTime;
        return left.label.localeCompare(right.label);
      });
  }, [trajectory]);

  const trajectoryProjectedMilestones = useMemo(
    () =>
      trajectoryMilestones.filter(
        (milestone) =>
          milestone.projectable &&
          typeof milestone.tPlusSec === 'number' &&
          Number.isFinite(milestone.tPlusSec) &&
          Boolean(milestone.trackKind)
      ),
    [trajectoryMilestones]
  );

  const trajectoryFlightPlanMilestones = useMemo(
    () => trajectoryMilestones.filter((milestone) => !milestone.projectable),
    [trajectoryMilestones]
  );

  const aimTarget = useMemo(() => {
    if (trajectoryRenderable && trajectoryPoints.length) {
      return interpolateTrajectory(trajectoryPoints, displayTSec);
    }
    if (padBearing != null && padElevation != null) {
      return { tPlusSec: 0, azDeg: padBearing, elDeg: padElevation } satisfies TrajectoryAzElPoint;
    }
    return null;
  }, [trajectoryRenderable, trajectoryPoints, displayTSec, padBearing, padElevation]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = window.setInterval(() => {
      const nextAlignmentFeedback = (lockTracking: boolean, lockConfidence: number | null) =>
        deriveAlignmentFeedback({
          residuals: autoAlignmentResidualsRef.current,
          lockTracking,
          lockConfidence,
          autoAlignmentReady,
          degradationTier: effectiveDegradationTier,
          baseCorridorMode: corridorMode,
          authorityTier: trajectory?.authorityTier ?? 'model_prior',
          authorityTrustScore: trajectory?.fieldProvenance.azimuth.trustScore ?? null,
          azimuthAuthorityTier: trajectory?.fieldProvenance.azimuth.authorityTier ?? 'model_prior',
          azimuthTrustScore: trajectory?.fieldProvenance.azimuth.trustScore ?? null,
          uncertaintyAuthorityTier: trajectory?.fieldProvenance.uncertainty.authorityTier ?? 'model_prior',
          uncertaintyTrustScore: trajectory?.fieldProvenance.uncertainty.trustScore ?? null,
          qualityState: trajectory?.qualityState ?? 'pad_only',
          safeModeActive: trajectory?.safeModeActive ?? true,
          publishPadOnly: trajectory?.publishPolicy.enforcePadOnly ?? true
        });

      if (!lockOnFeatureEnabled || !lockOnEnabled) {
        decayAutoAlignment(true);
        publishAlignmentFeedback(nextAlignmentFeedback(false, null));
        return;
      }
      if (!cameraActive || cameraError != null || motionPermission !== 'granted') {
        decayAutoAlignment(true);
        publishAlignmentFeedback(nextAlignmentFeedback(false, null));
        return;
      }
      if (headingStability === 'poor' || motionStatsRef.current.rotRateMagDegPerSec > 42) {
        decayAutoAlignment(false);
        publishAlignmentFeedback(nextAlignmentFeedback(false, null));
        return;
      }
      if (!trajectory || trajectory.publishPolicy.enforcePadOnly || trajectory.qualityState === 'pad_only') {
        decayAutoAlignment(true);
        publishAlignmentFeedback(nextAlignmentFeedback(false, null));
        return;
      }
      if (adjustedHeading == null || adjustedPitch == null || fovX <= 0 || fovY <= 0) {
        decayAutoAlignment(false);
        publishAlignmentFeedback(nextAlignmentFeedback(false, null));
        return;
      }

      const lock = lockOnOverlayRef.current;
      const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const lockFresh = lock.updatedAtMs != null && nowMs - lock.updatedAtMs <= 900;
      if (!lockFresh || lock.status !== 'tracking' || lock.confidence < AUTO_ALIGNMENT_MIN_CONFIDENCE || !lock.centerNorm) {
        decayAutoAlignment(false);
        publishAlignmentFeedback(nextAlignmentFeedback(false, lock.confidence));
        return;
      }

      if (!aimTarget) {
        decayAutoAlignment(false);
        publishAlignmentFeedback(nextAlignmentFeedback(false, lock.confidence));
        return;
      }
      const predictedPoint = projectAzElToViewportNorm({
        targetAzDeg: aimTarget.azDeg,
        targetElDeg: aimTarget.elDeg,
        headingDeg: adjustedHeading,
        pitchDeg: adjustedPitch,
        rollDeg: roll,
        fovXDeg: fovX,
        fovYDeg: fovY
      });
      if (!predictedPoint) {
        decayAutoAlignment(false);
        publishAlignmentFeedback(nextAlignmentFeedback(false, lock.confidence));
        return;
      }

      const predictedAngles = viewportNormToAngleOffsetsDeg({
        point: predictedPoint,
        rollDeg: roll,
        fovXDeg: fovX,
        fovYDeg: fovY
      });
      const observedAngles = viewportNormToAngleOffsetsDeg({
        point: lock.centerNorm,
        rollDeg: roll,
        fovXDeg: fovX,
        fovYDeg: fovY
      });
      if (!predictedAngles || !observedAngles) {
        decayAutoAlignment(false);
        publishAlignmentFeedback(nextAlignmentFeedback(false, lock.confidence));
        return;
      }

      const yawCorrectionAllowed =
        trajectory.fieldProvenance.azimuth.precisionEligible ||
        (trajectory.fieldProvenance.azimuth.trustScore >= 0.56 &&
          trajectory.fieldProvenance.azimuth.authorityTier !== 'model_prior' &&
          trajectory.authorityTier !== 'model_prior');
      const pitchCorrectionAllowed =
        trajectory.fieldProvenance.altitude.trustScore >= 0.56 &&
        trajectory.fieldProvenance.altitude.authorityTier !== 'model_prior' &&
        (trajectory.qualityState === 'precision' || trajectory.qualityState === 'guided');
      if (!yawCorrectionAllowed && !pitchCorrectionAllowed) {
        decayAutoAlignment(true);
        publishAlignmentFeedback(nextAlignmentFeedback(false, lock.confidence));
        return;
      }

      const residuals = autoAlignmentResidualsRef.current;
      residuals.push({
        yawDeg: observedAngles.yawDeg - predictedAngles.yawDeg,
        pitchDeg: observedAngles.pitchDeg - predictedAngles.pitchDeg,
        confidence: lock.confidence
      });
      while (residuals.length > 8) residuals.shift();
      const feedback = nextAlignmentFeedback(true, lock.confidence);
      publishAlignmentFeedback(feedback);

      autoAlignmentScoreRef.current =
        feedback.stability === 'stable'
          ? Math.min(AUTO_ALIGNMENT_READY_SCORE, autoAlignmentScoreRef.current + 1)
          : feedback.stability === 'settling'
            ? Math.max(0, autoAlignmentScoreRef.current - 1)
            : Math.max(0, autoAlignmentScoreRef.current - 2);
      if (!autoAlignmentReady && autoAlignmentScoreRef.current >= AUTO_ALIGNMENT_READY_SCORE) {
        setAutoAlignmentReady(true);
      }
      if (feedback.correctionGain <= 0) return;

      const yawMean = feedback.yawMeanDeg ?? 0;
      const pitchMean = feedback.pitchMeanDeg ?? 0;

      const baseCorrectionWeight =
        confidenceCorrectionWeight(trajectory.confidenceTier) *
        authorityCorrectionWeight(trajectory.authorityTier) *
        clamp(lock.confidence, 0.72, 0.95) *
        feedback.correctionGain;

      if (yawCorrectionAllowed) {
        const yawCorrectionWeight =
          baseCorrectionWeight *
          authorityCorrectionWeight(
            trajectory.fieldProvenance.azimuth.authorityTier,
            trajectory.fieldProvenance.azimuth.trustScore
          ) *
          authorityCorrectionWeight(
            trajectory.fieldProvenance.uncertainty.authorityTier,
            trajectory.fieldProvenance.uncertainty.trustScore
          );
        const nextYawDelta = clamp(-yawMean * 0.16 * yawCorrectionWeight, -0.32, 0.32);
        if (Math.abs(nextYawDelta) >= 0.02) {
          setAutoYawBias((prev) =>
            clamp(prev + nextYawDelta, -AUTO_ALIGNMENT_MAX_YAW_BIAS_DEG, AUTO_ALIGNMENT_MAX_YAW_BIAS_DEG)
          );
        }
      }

      if (pitchCorrectionAllowed) {
        const pitchCorrectionWeight =
          baseCorrectionWeight *
          authorityCorrectionWeight(
            trajectory.fieldProvenance.altitude.authorityTier,
            trajectory.fieldProvenance.altitude.trustScore
          );
        const nextPitchDelta = clamp(pitchMean * 0.12 * pitchCorrectionWeight, -0.24, 0.24);
        if (Math.abs(nextPitchDelta) >= 0.02) {
          setAutoPitchBias((prev) =>
            clamp(prev + nextPitchDelta, -AUTO_ALIGNMENT_MAX_PITCH_BIAS_DEG, AUTO_ALIGNMENT_MAX_PITCH_BIAS_DEG)
          );
        }
      }
    }, AUTO_ALIGNMENT_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [
    adjustedHeading,
    adjustedPitch,
    aimTarget,
    autoAlignmentReady,
    cameraActive,
    cameraError,
    corridorMode,
    decayAutoAlignment,
    effectiveDegradationTier,
    fovX,
    fovY,
    headingStability,
    lockOnEnabled,
    lockOnFeatureEnabled,
    motionPermission,
    publishAlignmentFeedback,
    roll,
    trajectory
  ]);

  const headingDelta = useMemo(() => {
    if (!aimTarget || adjustedHeading == null) return null;
    return normalizeAngleDelta(aimTarget.azDeg - adjustedHeading);
  }, [aimTarget, adjustedHeading]);

  const headingHint = useMemo(() => {
    if (headingDelta == null) return null;
    const abs = Math.abs(headingDelta);
    if (abs < 3) return 'Aligned';
    return headingDelta > 0 ? `Turn right ${abs.toFixed(0)}°` : `Turn left ${abs.toFixed(0)}°`;
  }, [headingDelta]);

  const pitchDelta = useMemo(() => {
    if (!aimTarget || adjustedPitch == null) return null;
    return aimTarget.elDeg - adjustedPitch;
  }, [aimTarget, adjustedPitch]);

  const pitchHint = useMemo(() => {
    if (pitchDelta == null) return null;
    const abs = Math.abs(pitchDelta);
    if (abs < 3) return 'Level';
    return pitchDelta > 0 ? `Tilt up ${abs.toFixed(0)}°` : `Tilt down ${abs.toFixed(0)}°`;
  }, [pitchDelta]);

  const rollHint = useMemo(() => {
    if (roll == null) return null;
    const abs = Math.abs(roll);
    if (abs < 3) return 'Phone level';
    return roll > 0 ? `Tilt left ${abs.toFixed(0)}°` : `Tilt right ${abs.toFixed(0)}°`;
  }, [roll]);

  const headingUntrusted = poseSource === 'deviceorientation' && !hasCalibratedRef.current && !autoAlignmentReady;
  const showManualCalibrationUi = AR_MANUAL_CALIBRATION_UI_ENABLED && showWizard;
  const showSettingsPanel = AR_DEBUG_PANELS_ENABLED && showCalibration;
  const showSensorAssistOverlay = !xrActive && (motionPermission !== 'granted' || adjustedHeading == null);
  const showSkyCompass = !xrActive && !cameraActive && (cameraError != null || showSensorAssistOverlay);
  const telemetryEntryState = useMemo(
    () =>
      deriveArTelemetryEntryState({
        cameraError,
        motionPermission,
        adjustedHeading,
        showSensorAssistOverlay
      }),
    [adjustedHeading, cameraError, motionPermission, showSensorAssistOverlay]
  );

  const effectiveCorridorMode = useMemo(() => {
    if (showSensorAssistOverlay || !trajectoryRenderable) return 'wide' as const;
    return alignmentFeedback.recommendedCorridorMode;
  }, [alignmentFeedback.recommendedCorridorMode, showSensorAssistOverlay, trajectoryRenderable]);

  const alignmentGuidanceLabel = useMemo(() => {
    if (!lockOnFeatureEnabled || !lockOnEnabled || !lockOnAttempted) return null;
    if (lockOnAcquired) {
      if (alignmentFeedback.stability === 'stable') return 'Locked on';
      if (alignmentFeedback.stability === 'settling') return 'Tracking settling';
      if (alignmentFeedback.stability === 'drifting') return 'Re-centering track';
    }
    if (lockOnLossCount > 0 && alignmentFeedback.stability === 'drifting') return 'Reacquiring';
    return null;
  }, [
    alignmentFeedback.stability,
    lockOnAcquired,
    lockOnAttempted,
    lockOnEnabled,
    lockOnFeatureEnabled,
    lockOnLossCount
  ]);

  const headingHintLabel = useMemo(() => {
    if (motionPermission !== 'granted') return 'Enable motion';
    if (!aimTarget) return 'Waiting for GPS';
    if (adjustedHeading == null) return 'Heading unavailable';
    if (headingUntrusted) return 'Hold steady for heading lock';
    if (alignmentGuidanceLabel) return alignmentGuidanceLabel;
    if (headingHint) return headingHint;
    return 'Turn left/right';
  }, [adjustedHeading, aimTarget, alignmentGuidanceLabel, headingHint, headingUntrusted, motionPermission]);

  const pitchHintLabel = useMemo(() => {
    if (pitchHint) return pitchHint;
    if (motionPermission !== 'granted') return 'Enable motion';
    if (adjustedPitch == null) return 'Hold phone upright';
    return 'Tilt up/down';
  }, [adjustedPitch, motionPermission, pitchHint]);

  const rollHintLabel = useMemo(() => {
    if (rollHint) return rollHint;
    if (motionPermission !== 'granted') return 'Enable motion';
    return 'Level phone';
  }, [motionPermission, rollHint]);
  const overlayMode = useMemo<OverlayMode>(() => {
    if (showSensorAssistOverlay || effectiveDegradationTier >= 3 || !trajectoryRenderable) return 'search';
    if (alignmentFeedback.stability === 'drifting') return lockOnAttempted ? 'recover' : 'search';
    if (lockOnAttempted && !lockOnAcquired && lockOnLossCount > 0) return 'recover';
    if (
      trajectory?.qualityState === 'precision' &&
      lockOnAcquired &&
      effectiveDegradationTier <= 1 &&
      alignmentFeedback.readyForPrecision
    ) {
      return 'precision';
    }
    if (trajectory?.qualityState === 'precision' || trajectory?.qualityState === 'guided') return 'guided';
    return 'search';
  }, [
    alignmentFeedback.readyForPrecision,
    alignmentFeedback.stability,
    effectiveDegradationTier,
    lockOnAcquired,
    lockOnAttempted,
    lockOnLossCount,
    showSensorAssistOverlay,
    trajectory?.qualityState,
    trajectoryRenderable
  ]);

  useEffect(() => {
    if (xrActive) {
      setPoseSource('webxr');
      return;
    }
    if (showSkyCompass) {
      setPoseSource('sky_compass');
      return;
    }
    setPoseSource(lastNonSkyPoseSourceRef.current);
  }, [showSkyCompass, xrActive]);

  useEffect(() => {
    if (telemetryEntryState.modeEntered === 'ar') telemetryEnteredArRef.current = true;
  }, [telemetryEntryState.modeEntered]);

  useEffect(() => {
    if (time.mode === 'SCRUB') {
      telemetryUsedScrubRef.current = true;
      if (telemetryScrubStartMsRef.current == null) telemetryScrubStartMsRef.current = Date.now();
      return;
    }
    if (telemetryScrubStartMsRef.current != null) {
      telemetryScrubMsRef.current += Math.max(0, Date.now() - telemetryScrubStartMsRef.current);
      telemetryScrubStartMsRef.current = null;
    }
  }, [time.mode]);

  const cameraErrorInfo = useMemo(() => {
    if (!cameraError) return null;
    const raw = String(cameraError || '').trim();
    const e = raw.toLowerCase();

    const isPermission =
      e.includes('notallowed') || e.includes('permission') || e.includes('denied') || e.includes('security');
    const isNotFound = e.includes('notfound') || e.includes('overconstrained') || e.includes('devices not found');
    const isInUse = e.includes('notreadable') || e.includes('trackstart') || e.includes('in use');
    const isUnsupported = e.includes('not supported') || e.includes('unsupported');

    let title = 'Camera error';
    let hint = 'Tap Retry sensors. If it keeps failing, check camera permissions and reload.';

    if (isUnsupported) {
      title = 'Camera not supported';
      hint = 'Try a modern mobile browser (iOS Safari / Android Chrome).';
    } else if (isNotFound) {
      title = 'No camera found';
      hint = 'This device/browser did not expose a camera. Try another device or browser.';
    } else if (isInUse) {
      title = 'Camera in use';
      hint = 'Close other apps using the camera, then tap Retry sensors.';
	    } else if (isPermission) {
	      title = 'Camera access blocked';
      hint = clientProfilePolicy.cameraBlockedHint;
	    }

    hint = `${hint} Showing Sky Compass for now.`;

    const detail = raw.length > 160 ? `${raw.slice(0, 160)}…` : raw;
    return { title, hint, detail };
  }, [cameraError, clientProfilePolicy.cameraBlockedHint]);

  const sensorAssistView = useMemo(() => {
    if (motionPermission === 'denied') {
      return {
        title: 'Motion access needed',
        body: cameraActive
          ? 'Allow Motion & Orientation Access to keep the live overlay aligned.'
          : 'Allow Motion & Orientation Access to leave compass fallback and start live guidance.',
        footnote: clientProfilePolicy.motionDeniedHint
      };
    }

    if (motionPermission !== 'granted') {
      return {
        title: 'Enable motion',
        body: cameraActive
          ? 'Allow motion access, then point the phone near the launch path.'
          : 'Allow motion access to start live camera guidance.',
        footnote: null as string | null
      };
    }

    if (cameraActive) {
      return {
        title: 'Finding heading',
        body: 'Hold steady for heading lock.',
        footnote:
          effectiveDegradationTier >= 2
            ? 'Overlay detail is reduced automatically on this device to keep motion responsive.'
            : null
      };
    }

    return {
      title: 'Heading unavailable',
      body: 'Showing compass fallback until camera and motion are ready.',
      footnote: null as string | null
    };
  }, [cameraActive, clientProfilePolicy.motionDeniedHint, effectiveDegradationTier, motionPermission]);

  const sessionStatusView = useMemo(
    () =>
      deriveArSessionStatusView({
        cameraErrorInfo,
        locationError,
        showSensorAssistOverlay,
        sensorAssistView,
        motionPermission,
        trajectoryBelowHorizon
      }),
    [cameraErrorInfo, locationError, motionPermission, sensorAssistView, showSensorAssistOverlay, trajectoryBelowHorizon]
  );
  const sessionStatusTone = useMemo(
    () => (sessionStatusView ? statusCardToneClasses(sessionStatusView.tone) : null),
    [sessionStatusView]
  );

  const cameraStatus = useMemo<'granted' | 'denied' | 'prompt' | 'error'>(() => {
    if (cameraError) return 'denied';
    if (cameraActive) return 'granted';
    return 'prompt';
  }, [cameraActive, cameraError]);

  const motionStatus = useMemo<'granted' | 'denied' | 'prompt' | 'error'>(() => {
    if (motionPermission === 'granted') return 'granted';
    if (motionPermission === 'denied') return 'denied';
    return 'prompt';
  }, [motionPermission]);

  const headingStatus = useMemo<'ok' | 'unavailable' | 'noisy' | 'unknown'>(() => {
    if (adjustedHeading == null) return 'unavailable';
    if (poseSource === 'webxr') return 'ok';
    if (headingStability === 'poor') return 'noisy';
    if (headingStability === 'good' || headingStability === 'fair') return 'ok';
    return 'unknown';
  }, [adjustedHeading, headingStability, poseSource]);

  const avgSigmaDeg = useMemo(() => {
    if (!trajectoryPoints.length) return null;
    const values = trajectoryPoints.map((p) => p.sigmaDeg).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!values.length) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }, [trajectoryPoints]);

  const trajectoryStepS = useMemo(() => {
    if (primaryTrajectoryTrackSamples.length < 2) return null;
    const a = primaryTrajectoryTrackSamples[0]?.tPlusSec;
    const b = primaryTrajectoryTrackSamples[1]?.tPlusSec;
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.max(0, Math.round(b - a));
  }, [primaryTrajectoryTrackSamples]);

  useEffect(() => {
    const droppedFrameRatio = droppedFrameRatioFromStats(telemetryFrameStatsRef.current);
    const droppedFrameBucket = bucketDroppedFrameRatio(droppedFrameRatio);
    const renderTier = inferRenderTier({
      poseSource,
      cameraStatus,
      motionStatus,
      headingStatus,
      renderLoopRunning: telemetryRenderLoopRunningRef.current,
      droppedFrameRatio
    });

    telemetrySnapshotRef.current.cameraError = cameraError;
    telemetrySnapshotRef.current.motionPermission = motionPermission;
    telemetrySnapshotRef.current.adjustedHeading = adjustedHeading;
    telemetrySnapshotRef.current.showSensorAssistOverlay = showSensorAssistOverlay;
    telemetrySnapshotRef.current.cameraStatus = cameraStatus;
    telemetrySnapshotRef.current.motionStatus = motionStatus;
	    telemetrySnapshotRef.current.headingStatus = headingStatus;
	    telemetrySnapshotRef.current.headingSource = headingSourceRef.current;
	    telemetrySnapshotRef.current.declinationApplied = declinationAppliedRef.current;
      telemetrySnapshotRef.current.declinationSource = declinationSourceRef.current;
    telemetrySnapshotRef.current.poseSource = poseSource;
    telemetrySnapshotRef.current.xrSupported =
      xrSupport === 'supported' ? true : xrSupport === 'unsupported' ? false : undefined;
    telemetrySnapshotRef.current.xrUsed = telemetryXrUsedRef.current;
    telemetrySnapshotRef.current.xrErrorBucket = bucketXrError(xrError);
    telemetrySnapshotRef.current.poseMode = runtimeDecision.poseMode;
    telemetrySnapshotRef.current.overlayMode = overlayMode;
    telemetrySnapshotRef.current.visionBackend = runtimeDecision.visionBackend;
    telemetrySnapshotRef.current.degradationTier = effectiveDegradationTier;
    telemetrySnapshotRef.current.lensPreset = lensPreset;
    telemetrySnapshotRef.current.corridorMode = effectiveCorridorMode;
    telemetrySnapshotRef.current.lockOnEnabled = lockOnEnabled;
    telemetrySnapshotRef.current.lockOnMode = lockOnMode;
    telemetrySnapshotRef.current.lockOnAttempted = lockOnAttemptedRef.current;
    telemetrySnapshotRef.current.lockOnAcquired = lockOnAcquiredRef.current;
    telemetrySnapshotRef.current.timeToLockBucket = lockOnTimeToLockBucketRef.current ?? lockOnTimeToLockBucket ?? undefined;
    telemetrySnapshotRef.current.lockLossCount = lockOnLossCountRef.current;
    telemetrySnapshotRef.current.retryCount = retryCount;
    telemetrySnapshotRef.current.yawOffset = effectiveYawOffset;
    telemetrySnapshotRef.current.pitchOffset = effectivePitchOffset;
    telemetrySnapshotRef.current.fovX = fovX;
    telemetrySnapshotRef.current.fovY = fovY;
    telemetrySnapshotRef.current.fovSource =
      xrActive
        ? 'xr'
        : lensPreset !== 'custom'
          ? 'preset'
          : fovAutoInferredRef.current
            ? 'inferred'
            : fovLoadedFromStorageRef.current
              ? 'saved'
              : 'default';
    telemetrySnapshotRef.current.zoomSupported = zoomSupported;
    telemetrySnapshotRef.current.zoomRatio = zoomRatio;
    telemetrySnapshotRef.current.zoomControlPath = zoomControlPath;
    telemetrySnapshotRef.current.zoomInputToApplyMs = zoomInputToApplyMs;
    telemetrySnapshotRef.current.zoomApplyToProjectionSyncMs = zoomApplyToProjectionSyncMs;
    telemetrySnapshotRef.current.projectionSource = projectionSource;
    telemetrySnapshotRef.current.tier = (trajectory?.quality ?? 0) as 0 | 1 | 2 | 3;
    telemetrySnapshotRef.current.trajectoryVersion = trajectory?.version ?? undefined;
    telemetrySnapshotRef.current.durationSec = durationSec;
    telemetrySnapshotRef.current.stepS = trajectoryStepS ?? undefined;
    telemetrySnapshotRef.current.avgSigmaDeg = avgSigmaDeg ?? undefined;
    telemetrySnapshotRef.current.confidenceTierSeen = trajectory?.confidenceTier ?? undefined;
    telemetrySnapshotRef.current.contractTier = trajectory?.confidenceTier ?? undefined;
    telemetrySnapshotRef.current.authorityTier = trajectory?.authorityTier ?? undefined;
    telemetrySnapshotRef.current.qualityState = trajectory?.qualityState ?? undefined;
    telemetrySnapshotRef.current.renderTier = renderTier;
    telemetrySnapshotRef.current.droppedFrameBucket = droppedFrameBucket;
  }, [
    adjustedHeading,
    avgSigmaDeg,
    cameraError,
    cameraStatus,
    effectiveCorridorMode,
    lockOnAcquired,
    lockOnAttempted,
    lockOnEnabled,
    lockOnMode,
    lockOnLossCount,
    lockOnTimeToLockBucket,
    durationSec,
    fovX,
    fovY,
    headingStatus,
    lensPreset,
    projectionSource,
    motionPermission,
    motionStatus,
    overlayMode,
    effectivePitchOffset,
    poseSource,
    retryCount,
    effectiveDegradationTier,
    runtimeDecision.poseMode,
    runtimeDecision.visionBackend,
    showSensorAssistOverlay,
    trajectory?.authorityTier,
    trajectory?.quality,
    trajectory?.confidenceTier,
    trajectory?.qualityState,
    trajectory?.version,
    trajectoryStepS,
    zoomApplyToProjectionSyncMs,
    zoomControlPath,
    zoomInputToApplyMs,
    zoomRatio,
    zoomSupported,
    xrActive,
    xrError,
    xrSupport,
    effectiveYawOffset
  ]);

  useEffect(() => {
    if (!corridorModeInitialized) return;
    if (telemetryStartedRef.current) return;
    telemetryStartedRef.current = true;

    if (!telemetryStartedAtRef.current) telemetryStartedAtRef.current = new Date().toISOString();
    if (telemetrySessionIdRef.current == null) telemetrySessionIdRef.current = newSessionId();
    const sessionId = telemetrySessionIdRef.current;
    if (!sessionId) return;

	    const declinationMagBucket =
	      poseSource === 'webxr' || declinationBucketRef.current == null || declinationSourceRef.current === 'none'
	        ? undefined
	        : bucketDegrees(Math.abs(declinationDegRef.current), 2, 0, 30);
    const poseUpdateRateBucket =
      poseSource === 'webxr'
        ? 'webxr'
        : poseSource === 'sky_compass'
          ? 'none'
          : (() => {
              const stats = poseUpdateStatsRef.current;
              const elapsedMs =
                stats.firstAtMs != null && stats.lastAtMs != null ? Math.max(0, stats.lastAtMs - stats.firstAtMs) : 0;
              if (stats.count < 5 || elapsedMs < 250) return undefined;
              const hz = stats.count / (elapsedMs / 1000);
              return bucketPoseUpdateHz(hz);
            })();
    const droppedFrameRatio = droppedFrameRatioFromStats(telemetryFrameStatsRef.current);
    const droppedFrameBucket = bucketDroppedFrameRatio(droppedFrameRatio);
    const renderTier = inferRenderTier({
      poseSource,
      cameraStatus,
      motionStatus,
      headingStatus,
      renderLoopRunning: telemetryRenderLoopRunningRef.current,
      droppedFrameRatio
    });
    const loopTiming = snapshotLoopTiming();
    const modeEntered: 'ar' | 'sky_compass' = telemetryEnteredArRef.current ? 'ar' : telemetryEntryState.modeEntered;
    const fallbackReason = modeEntered === 'ar' ? null : telemetryEntryState.fallbackReason;

    telemetryPost('start', {
      sessionId,
      launchId,
      runtimeFamily: 'web',
		    startedAt: telemetryStartedAtRef.current,
	      clientEnv: telemetryClientEnvRef.current ?? 'unknown',
        clientProfile: telemetryClientProfileRef.current ?? 'unknown',
	      screenBucket: telemetryScreenBucketRef.current ?? 'unknown',
      cameraStatus,
      motionStatus,
	      headingStatus,
	      headingSource: poseSource === 'webxr' ? 'webxr' : headingSourceRef.current,
	      declinationApplied: poseSource === 'webxr' ? false : declinationAppliedRef.current,
        declinationSource: poseSource === 'webxr' ? 'none' : declinationSourceRef.current,
	      declinationMagBucket,
      fusionEnabled: telemetrySnapshotRef.current.fusionEnabled,
      fusionUsed: telemetrySnapshotRef.current.fusionUsed,
      fusionFallbackReason: telemetrySnapshotRef.current.fusionFallbackReason,
      poseSource,
      poseMode: runtimeDecision.poseMode,
      overlayMode,
      visionBackend: runtimeDecision.visionBackend,
      degradationTier: effectiveDegradationTier,
      xrSupported: xrSupport === 'supported' ? true : xrSupport === 'unsupported' ? false : undefined,
      xrUsed: telemetryXrUsedRef.current,
      xrErrorBucket: bucketXrError(xrError),
		      renderLoopRunning: telemetryRenderLoopRunningRef.current,
		      canvasHidden: telemetryCanvasHiddenRef.current,
		      poseUpdateRateBucket,
      arLoopActiveMs: Math.round(loopTiming.arLoopActiveMs),
      skyCompassLoopActiveMs: Math.round(loopTiming.skyCompassLoopActiveMs),
      loopRestartCount: loopTiming.loopRestartCount,
      modeEntered,
      fallbackReason,
      lensPreset,
      corridorMode: effectiveCorridorMode,
      lockOnMode,
      lockOnAttempted: lockOnAttemptedRef.current,
      lockOnAcquired: lockOnAcquiredRef.current,
      timeToLockBucket: lockOnTimeToLockBucketRef.current ?? lockOnTimeToLockBucket ?? undefined,
      lockLossCount: lockOnLossCountRef.current,
      yawOffsetBucket: bucketDegrees(yawOffset, 10, -90, 90),
      pitchLevelBucket: bucketDegrees(pitchOffset, 10, -90, 90),
      hfovBucket: bucketDegrees(fovX, 10, 30, 140),
      vfovBucket: bucketDegrees(fovY, 10, 20, 120),
      fovSource:
        poseSource === 'webxr'
          ? 'xr'
          : lensPreset !== 'custom'
            ? 'preset'
            : fovAutoInferredRef.current
              ? 'inferred'
              : fovLoadedFromStorageRef.current
                ? 'saved'
                : 'default',
      zoomSupported,
      zoomRatioBucket: bucketZoomRatio(zoomRatio, zoomSupported),
      zoomControlPath,
      zoomApplyLatencyBucket: bucketLatencyMs(zoomInputToApplyMs),
      zoomProjectionSyncLatencyBucket: bucketLatencyMs(zoomApplyToProjectionSyncMs),
      projectionSource,
      tier: (trajectory?.quality ?? 0) as 0 | 1 | 2 | 3,
      trajectoryVersion: trajectory?.version,
      durationS: durationSec,
      stepS: trajectoryStepS ?? undefined,
      avgSigmaDeg: avgSigmaDeg ?? undefined,
      confidenceTierSeen: telemetrySnapshotRef.current.confidenceTierSeen,
      contractTier: telemetrySnapshotRef.current.contractTier,
      trajectoryAuthorityTier: telemetrySnapshotRef.current.authorityTier,
      trajectoryQualityState: telemetrySnapshotRef.current.qualityState,
      renderTier,
      droppedFrameBucket
    });
    telemetryUpdateStateRef.current = {
      lastSentAtMs: Date.now(),
      lastMaterialKey: buildArTelemetryMaterialKey({
        cameraStatus,
        motionStatus,
        headingStatus,
        headingSource: poseSource === 'webxr' ? 'webxr' : headingSourceRef.current,
        poseMode: runtimeDecision.poseMode,
        overlayMode,
        visionBackend: runtimeDecision.visionBackend,
        degradationTier: effectiveDegradationTier,
        xrUsed: telemetryXrUsedRef.current,
        xrErrorBucket: bucketXrError(xrError),
        modeEntered,
        fallbackReason,
        corridorMode: effectiveCorridorMode,
        lockOnAttempted: lockOnAttemptedRef.current,
        lockOnAcquired: lockOnAcquiredRef.current,
        timeToLockBucket: lockOnTimeToLockBucketRef.current ?? lockOnTimeToLockBucket ?? undefined,
        lockLossCount: lockOnLossCountRef.current,
        trajectoryAuthorityTier: telemetrySnapshotRef.current.authorityTier,
        trajectoryQualityState: telemetrySnapshotRef.current.qualityState,
        renderTier,
        droppedFrameBucket,
        zoomControlPath,
        zoomRatioBucket: bucketZoomRatio(zoomRatio, zoomSupported)
      })
    };
  }, [
    avgSigmaDeg,
    cameraStatus,
    effectiveCorridorMode,
    lockOnMode,
    durationSec,
    fovX,
    fovY,
    headingStatus,
    launchId,
    lensPreset,
    motionStatus,
    overlayMode,
    poseSource,
    pitchOffset,
    effectiveDegradationTier,
    runtimeDecision.poseMode,
    runtimeDecision.visionBackend,
    telemetryEntryState.fallbackReason,
    telemetryEntryState.modeEntered,
    trajectory?.quality,
    trajectory?.version,
    trajectoryStepS,
    lockOnTimeToLockBucket,
    xrError,
    xrSupport,
    yawOffset,
    zoomApplyToProjectionSyncMs,
    zoomControlPath,
    zoomInputToApplyMs,
    zoomRatio,
    zoomSupported,
    projectionSource,
    corridorModeInitialized,
    snapshotLoopTiming
  ]);

  useEffect(() => {
    if (!corridorModeInitialized) return;
    if (!telemetryStartedRef.current || telemetryEndedRef.current) return;

    const pushUpdate = () => {
      if (telemetryEndedRef.current) return;
      const sessionId = telemetrySessionIdRef.current;
      const startedAt = telemetryStartedAtRef.current;
      if (!sessionId || !startedAt) return;

      const snapshot = telemetrySnapshotRef.current;
      const declinationMagBucket =
        snapshot.poseSource === 'webxr' ||
        declinationBucketRef.current == null ||
        snapshot.declinationSource === 'none'
          ? undefined
          : bucketDegrees(Math.abs(declinationDegRef.current), 2, 0, 30);
      const poseUpdateRateBucket =
        snapshot.poseSource === 'webxr'
          ? 'webxr'
          : snapshot.poseSource === 'sky_compass'
            ? 'none'
            : (() => {
                const stats = poseUpdateStatsRef.current;
                const elapsedMs =
                  stats.firstAtMs != null && stats.lastAtMs != null ? Math.max(0, stats.lastAtMs - stats.firstAtMs) : 0;
                if (stats.count < 5 || elapsedMs < 250) return undefined;
                const hz = stats.count / (elapsedMs / 1000);
                return bucketPoseUpdateHz(hz);
              })();
      const droppedFrameRatio = droppedFrameRatioFromStats(telemetryFrameStatsRef.current);
      const droppedFrameBucket = bucketDroppedFrameRatio(droppedFrameRatio);
      const renderTier = inferRenderTier({
        poseSource: snapshot.poseSource,
        cameraStatus: snapshot.cameraStatus,
        motionStatus: snapshot.motionStatus,
        headingStatus: snapshot.headingStatus,
        renderLoopRunning: telemetryRenderLoopRunningRef.current,
        droppedFrameRatio
      });
      const loopTiming = snapshotLoopTiming();
      const startedAtMs = Date.parse(startedAt);
      const durationMs = Number.isFinite(startedAtMs) ? Math.max(0, Date.now() - startedAtMs) : undefined;
      const snapshotTelemetryEntryState = deriveArTelemetryEntryState({
        cameraError: snapshot.cameraError,
        motionPermission: snapshot.motionPermission,
        adjustedHeading: snapshot.adjustedHeading,
        showSensorAssistOverlay: snapshot.showSensorAssistOverlay
      });
      const modeEntered: 'ar' | 'sky_compass' =
        telemetryEnteredArRef.current ? 'ar' : snapshotTelemetryEntryState.modeEntered;
      const fallbackReason = modeEntered === 'ar' ? null : snapshotTelemetryEntryState.fallbackReason;
      const materialKey = buildArTelemetryMaterialKey({
        cameraStatus: snapshot.cameraStatus,
        motionStatus: snapshot.motionStatus,
        headingStatus: snapshot.headingStatus,
        headingSource: snapshot.headingSource,
        poseMode: snapshot.poseMode,
        overlayMode: snapshot.overlayMode,
        visionBackend: snapshot.visionBackend,
        degradationTier: snapshot.degradationTier,
        xrUsed: snapshot.xrUsed,
        xrErrorBucket: snapshot.xrErrorBucket,
        modeEntered,
        fallbackReason,
        corridorMode: snapshot.corridorMode,
        lockOnAttempted: snapshot.lockOnAttempted,
        lockOnAcquired: snapshot.lockOnAcquired,
        timeToLockBucket: snapshot.timeToLockBucket,
        lockLossCount: snapshot.lockLossCount,
        trajectoryAuthorityTier: snapshot.authorityTier,
        trajectoryQualityState: snapshot.qualityState,
        renderTier,
        droppedFrameBucket,
        zoomControlPath: snapshot.zoomControlPath,
        zoomRatioBucket: bucketZoomRatio(snapshot.zoomRatio, snapshot.zoomSupported)
      });
      const cadenceMs = deriveArTelemetryUpdateCadenceMs({
        cameraStatus: snapshot.cameraStatus,
        motionStatus: snapshot.motionStatus,
        headingStatus: snapshot.headingStatus,
        headingSource: snapshot.headingSource,
        poseMode: snapshot.poseMode,
        overlayMode: snapshot.overlayMode,
        visionBackend: snapshot.visionBackend,
        degradationTier: snapshot.degradationTier,
        xrUsed: snapshot.xrUsed,
        xrErrorBucket: snapshot.xrErrorBucket,
        modeEntered,
        fallbackReason,
        corridorMode: snapshot.corridorMode,
        lockOnAttempted: snapshot.lockOnAttempted,
        lockOnAcquired: snapshot.lockOnAcquired,
        timeToLockBucket: snapshot.timeToLockBucket,
        lockLossCount: snapshot.lockLossCount,
        trajectoryAuthorityTier: snapshot.authorityTier,
        trajectoryQualityState: snapshot.qualityState,
        renderTier,
        droppedFrameBucket,
        zoomControlPath: snapshot.zoomControlPath,
        zoomRatioBucket: bucketZoomRatio(snapshot.zoomRatio, snapshot.zoomSupported)
      });
      if (
        !shouldSendArTelemetryUpdate({
          nowMs: Date.now(),
          lastSentAtMs: telemetryUpdateStateRef.current.lastSentAtMs,
          lastMaterialKey: telemetryUpdateStateRef.current.lastMaterialKey,
          nextMaterialKey: materialKey,
          cadenceMs
        })
      ) {
        return;
      }

      telemetryPost('update', {
        sessionId,
        launchId,
        runtimeFamily: 'web',
        startedAt,
        durationMs,
        clientEnv: telemetryClientEnvRef.current ?? 'unknown',
        clientProfile: telemetryClientProfileRef.current ?? 'unknown',
        screenBucket: telemetryScreenBucketRef.current ?? 'unknown',
        cameraStatus: snapshot.cameraStatus,
        motionStatus: snapshot.motionStatus,
        headingStatus: snapshot.headingStatus,
        headingSource: snapshot.headingSource,
        declinationApplied: snapshot.declinationApplied,
        declinationSource: snapshot.declinationSource,
        declinationMagBucket,
        fusionEnabled: snapshot.fusionEnabled,
        fusionUsed: snapshot.fusionUsed,
        fusionFallbackReason: snapshot.fusionFallbackReason,
        poseSource: snapshot.poseSource,
        poseMode: snapshot.poseMode,
        overlayMode: snapshot.overlayMode,
        visionBackend: snapshot.visionBackend,
        degradationTier: snapshot.degradationTier,
        xrSupported: snapshot.xrSupported,
        xrUsed: snapshot.xrUsed,
        xrErrorBucket: snapshot.xrErrorBucket,
        renderLoopRunning: telemetryRenderLoopRunningRef.current,
        canvasHidden: telemetryCanvasHiddenRef.current,
        poseUpdateRateBucket,
        arLoopActiveMs: Math.round(loopTiming.arLoopActiveMs),
        skyCompassLoopActiveMs: Math.round(loopTiming.skyCompassLoopActiveMs),
        loopRestartCount: loopTiming.loopRestartCount,
        modeEntered,
        fallbackReason,
        retryCount: snapshot.retryCount,
        usedScrub: telemetryUsedScrubRef.current,
        scrubSecondsTotal: Math.round(telemetryScrubMsRef.current / 1000),
        eventTapCount: telemetryEventTapCountRef.current,
        lensPreset: snapshot.lensPreset,
        corridorMode: snapshot.corridorMode,
        lockOnMode: snapshot.lockOnMode,
        lockOnAttempted: snapshot.lockOnAttempted,
        lockOnAcquired: snapshot.lockOnAcquired,
        timeToLockBucket: snapshot.timeToLockBucket,
        lockLossCount: snapshot.lockLossCount,
        yawOffsetBucket: bucketDegrees(snapshot.yawOffset, 10, -90, 90),
        pitchLevelBucket: bucketDegrees(snapshot.pitchOffset, 10, -90, 90),
        hfovBucket: bucketDegrees(snapshot.fovX, 10, 30, 140),
        vfovBucket: bucketDegrees(snapshot.fovY, 10, 20, 120),
        fovSource: snapshot.fovSource,
        zoomSupported: snapshot.zoomSupported,
        zoomRatioBucket: bucketZoomRatio(snapshot.zoomRatio, snapshot.zoomSupported),
        zoomControlPath: snapshot.zoomControlPath,
        zoomApplyLatencyBucket: bucketLatencyMs(snapshot.zoomInputToApplyMs),
        zoomProjectionSyncLatencyBucket: bucketLatencyMs(snapshot.zoomApplyToProjectionSyncMs),
        projectionSource: snapshot.projectionSource,
        tier: snapshot.tier,
        trajectoryVersion: snapshot.trajectoryVersion,
        durationS: snapshot.durationSec,
        stepS: snapshot.stepS,
        avgSigmaDeg: snapshot.avgSigmaDeg,
        confidenceTierSeen: snapshot.confidenceTierSeen,
        contractTier: snapshot.contractTier,
        trajectoryAuthorityTier: snapshot.authorityTier,
        trajectoryQualityState: snapshot.qualityState,
        renderTier,
        droppedFrameBucket
      });
      telemetryUpdateStateRef.current = {
        lastSentAtMs: Date.now(),
        lastMaterialKey: materialKey
      };
    };

    const id = window.setInterval(pushUpdate, 2000);
    return () => window.clearInterval(id);
  }, [corridorModeInitialized, launchId, snapshotLoopTiming]);

  useEffect(() => {
    const flush = () => {
      if (telemetryEndedRef.current) return;
      telemetryEndedRef.current = true;

      if (!telemetryStartedAtRef.current) telemetryStartedAtRef.current = new Date().toISOString();
      if (telemetrySessionIdRef.current == null) telemetrySessionIdRef.current = newSessionId();
      const sessionId = telemetrySessionIdRef.current;
      if (!sessionId) return;

      const endedAtIso = new Date().toISOString();
      const startedAtIso = telemetryStartedAtRef.current;
      const startedAtMs = Date.parse(startedAtIso);
      const endedAtMs = Date.parse(endedAtIso);
      const durationMs = Number.isFinite(startedAtMs) && Number.isFinite(endedAtMs) ? Math.max(0, endedAtMs - startedAtMs) : undefined;

      if (telemetryScrubStartMsRef.current != null) {
        telemetryScrubMsRef.current += Math.max(0, Date.now() - telemetryScrubStartMsRef.current);
        telemetryScrubStartMsRef.current = null;
      }

      const usedScrub = telemetryUsedScrubRef.current;
      const scrubSecondsTotal = usedScrub ? Math.round(telemetryScrubMsRef.current / 1000) : 0;

      const snapshot = telemetrySnapshotRef.current;
      const snapshotTelemetryEntryState = deriveArTelemetryEntryState({
        cameraError: snapshot.cameraError,
        motionPermission: snapshot.motionPermission,
        adjustedHeading: snapshot.adjustedHeading,
        showSensorAssistOverlay: snapshot.showSensorAssistOverlay
      });
      const modeEntered: 'ar' | 'sky_compass' =
        telemetryEnteredArRef.current ? 'ar' : snapshotTelemetryEntryState.modeEntered;
      const fallbackReason = modeEntered === 'ar' ? null : snapshotTelemetryEntryState.fallbackReason;

	      const declinationMagBucket =
	        snapshot.poseSource === 'webxr' ||
          declinationBucketRef.current == null ||
          snapshot.declinationSource === 'none'
	          ? undefined
	          : bucketDegrees(Math.abs(declinationDegRef.current), 2, 0, 30);
      const poseUpdateRateBucket =
        snapshot.poseSource === 'webxr'
          ? 'webxr'
          : snapshot.poseSource === 'sky_compass'
            ? 'none'
            : (() => {
                const stats = poseUpdateStatsRef.current;
                const elapsedMs =
                  stats.firstAtMs != null && stats.lastAtMs != null ? Math.max(0, stats.lastAtMs - stats.firstAtMs) : 0;
                if (stats.count < 5 || elapsedMs < 250) return undefined;
                const hz = stats.count / (elapsedMs / 1000);
                return bucketPoseUpdateHz(hz);
              })();
      const droppedFrameRatio = droppedFrameRatioFromStats(telemetryFrameStatsRef.current);
      const droppedFrameBucket = bucketDroppedFrameRatio(droppedFrameRatio);
      const renderTier = inferRenderTier({
        poseSource: snapshot.poseSource,
        cameraStatus: snapshot.cameraStatus,
        motionStatus: snapshot.motionStatus,
        headingStatus: snapshot.headingStatus,
        renderLoopRunning: telemetryRenderLoopRunningRef.current,
        droppedFrameRatio
      });
      const loopTiming = snapshotLoopTiming();

      telemetryPostBeacon('end', {
        sessionId,
        launchId,
        runtimeFamily: 'web',
        startedAt: startedAtIso,
        endedAt: endedAtIso,
	        durationMs,
	        clientEnv: telemetryClientEnvRef.current ?? 'unknown',
          clientProfile: telemetryClientProfileRef.current ?? 'unknown',
	        screenBucket: telemetryScreenBucketRef.current ?? 'unknown',
        cameraStatus: snapshot.cameraStatus,
        motionStatus: snapshot.motionStatus,
	        headingStatus: snapshot.headingStatus,
	        headingSource: snapshot.headingSource,
	        declinationApplied: snapshot.declinationApplied,
          declinationSource: snapshot.declinationSource,
	        declinationMagBucket,
	        fusionEnabled: snapshot.fusionEnabled,
	        fusionUsed: snapshot.fusionUsed,
	        fusionFallbackReason: snapshot.fusionFallbackReason,
	        poseSource: snapshot.poseSource,
          poseMode: snapshot.poseMode,
          overlayMode: snapshot.overlayMode,
          visionBackend: snapshot.visionBackend,
          degradationTier: snapshot.degradationTier,
	        xrSupported: snapshot.xrSupported,
	        xrUsed: snapshot.xrUsed,
	        xrErrorBucket: snapshot.xrErrorBucket,
	        renderLoopRunning: telemetryRenderLoopRunningRef.current,
	        canvasHidden: telemetryCanvasHiddenRef.current,
	        poseUpdateRateBucket,
        arLoopActiveMs: Math.round(loopTiming.arLoopActiveMs),
        skyCompassLoopActiveMs: Math.round(loopTiming.skyCompassLoopActiveMs),
        loopRestartCount: loopTiming.loopRestartCount,
        modeEntered,
        fallbackReason,
        retryCount: snapshot.retryCount,
        usedScrub,
        scrubSecondsTotal,
        eventTapCount: telemetryEventTapCountRef.current,
        lensPreset: snapshot.lensPreset,
        corridorMode: snapshot.corridorMode,
        lockOnMode,
        lockOnAttempted: lockOnAttemptedRef.current,
        lockOnAcquired: lockOnAcquiredRef.current,
        timeToLockBucket: lockOnTimeToLockBucketRef.current ?? snapshot.timeToLockBucket,
        lockLossCount: lockOnLossCountRef.current,
        yawOffsetBucket: bucketDegrees(snapshot.yawOffset, 10, -90, 90),
        pitchLevelBucket: bucketDegrees(snapshot.pitchOffset, 10, -90, 90),
        hfovBucket: bucketDegrees(snapshot.fovX, 10, 30, 140),
        vfovBucket: bucketDegrees(snapshot.fovY, 10, 20, 120),
        fovSource: snapshot.fovSource,
        zoomSupported: snapshot.zoomSupported,
        zoomRatioBucket: bucketZoomRatio(snapshot.zoomRatio, snapshot.zoomSupported),
        zoomControlPath: snapshot.zoomControlPath,
        zoomApplyLatencyBucket: bucketLatencyMs(snapshot.zoomInputToApplyMs),
        zoomProjectionSyncLatencyBucket: bucketLatencyMs(snapshot.zoomApplyToProjectionSyncMs),
        projectionSource: snapshot.projectionSource,
        tier: snapshot.tier,
        trajectoryVersion: snapshot.trajectoryVersion,
        durationS: snapshot.durationSec,
        stepS: snapshot.stepS,
        avgSigmaDeg: snapshot.avgSigmaDeg,
        confidenceTierSeen: snapshot.confidenceTierSeen,
        contractTier: snapshot.contractTier,
        trajectoryAuthorityTier: snapshot.authorityTier,
        trajectoryQualityState: snapshot.qualityState,
        renderTier,
        droppedFrameBucket
      });
    };

    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [launchId, lockOnMode, snapshotLoopTiming]);

	  useEffect(() => {
	    drawStateRef.current.trajectoryPoints = trajectoryPoints;
	    drawStateRef.current.trajectoryTrackPointsByKind = trajectoryTrackPointsByKind;
	    drawStateRef.current.trajectoryMilestones = trajectoryProjectedMilestones;
	    drawStateRef.current.trajectoryRenderable = trajectoryRenderable;
      drawStateRef.current.trajectoryQualityState = trajectory?.qualityState ?? 'search';
      drawStateRef.current.trajectoryAuthorityTier = trajectory?.authorityTier ?? 'model_prior';
      drawStateRef.current.trajectorySafeModeActive = trajectory?.safeModeActive ?? true;
      drawStateRef.current.trajectoryPublishPadOnly = trajectory?.publishPolicy.enforcePadOnly ?? false;
      drawStateRef.current.trajectoryAuthorityTrustScore = trajectory?.fieldProvenance.azimuth.trustScore ?? null;
      drawStateRef.current.trajectoryAzimuthAuthority = trajectory?.fieldProvenance.azimuth.authorityTier ?? 'model_prior';
      drawStateRef.current.trajectoryAzimuthTrustScore = trajectory?.fieldProvenance.azimuth.trustScore ?? null;
      drawStateRef.current.trajectoryUncertaintyAuthority = trajectory?.fieldProvenance.uncertainty.authorityTier ?? 'model_prior';
      drawStateRef.current.trajectoryUncertaintyTrustScore = trajectory?.fieldProvenance.uncertainty.trustScore ?? null;
      drawStateRef.current.trajectorySigmaDegP95 = trajectory?.uncertaintyEnvelope.sigmaDegP95 ?? null;
	    drawStateRef.current.showMilestones = effectiveShowMilestones;
	    drawStateRef.current.reducedEffects = effectiveReducedEffects;
	    drawStateRef.current.adjustedHeading = adjustedHeading;
      drawStateRef.current.adjustedPitch = adjustedPitch;
      drawStateRef.current.roll = roll;
      drawStateRef.current.fovX = fovX;
      drawStateRef.current.fovY = fovY;
      drawStateRef.current.padBearing = padBearing;
      drawStateRef.current.padElevation = padElevation;
      drawStateRef.current.showPadGuide = showWizard || showSettingsPanel;
      drawStateRef.current.timeMode = time.mode;
      drawStateRef.current.isBeforeLiftoff = time.isBeforeLiftoff;
      drawStateRef.current.liftoffAtMs = liftoffAtMs;
      drawStateRef.current.durationSec = durationSec;
      drawStateRef.current.yawOffset = effectiveYawOffset;
      drawStateRef.current.pitchOffset = effectivePitchOffset;
	    drawStateRef.current.tSelectedSec = displayTSec;
	    drawStateRef.current.highContrast = highContrast;
	    drawStateRef.current.corridorMode = effectiveCorridorMode;
      drawStateRef.current.lockOnRenderEnabled = lockOnFeatureEnabled && lockOnEnabled;
      drawStateRef.current.performanceTier = effectiveDegradationTier;
      drawStateRef.current.milestoneDensity = performancePolicy.milestoneDensity;
      drawStateRef.current.lockPredictionDepth = performancePolicy.lockPredictionDepth;
      drawStateRef.current.showRollAssist = performancePolicy.showRollAssist;
      drawStateRef.current.dprCap = performancePolicy.dprCap;
	  }, [
	    trajectoryPoints,
	    trajectoryTrackPointsByKind,
	    trajectoryProjectedMilestones,
	    trajectoryRenderable,
      trajectory?.qualityState,
      trajectory?.authorityTier,
      trajectory?.safeModeActive,
      trajectory?.publishPolicy.enforcePadOnly,
      trajectory?.fieldProvenance.azimuth.trustScore,
      trajectory?.fieldProvenance.azimuth.authorityTier,
      trajectory?.fieldProvenance.uncertainty.trustScore,
      trajectory?.fieldProvenance.uncertainty.authorityTier,
      trajectory?.uncertaintyEnvelope.sigmaDegP95,
	    effectiveShowMilestones,
	    effectiveReducedEffects,
	    adjustedHeading,
	    adjustedPitch,
	    roll,
	    fovX,
	    fovY,
	    padBearing,
	    padElevation,
	    showWizard,
      showSettingsPanel,
      displayTSec,
      highContrast,
	    effectiveCorridorMode,
      lockOnEnabled,
      lockOnFeatureEnabled,
      effectiveDegradationTier,
      performancePolicy.dprCap,
      performancePolicy.lockPredictionDepth,
      performancePolicy.milestoneDensity,
      performancePolicy.showRollAssist,
      durationSec,
      liftoffAtMs,
      effectivePitchOffset,
      time.isBeforeLiftoff,
      time.mode,
      effectiveYawOffset
	  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!shouldRunArLoop) {
      telemetryRenderLoopRunningRef.current = false;
      markArLoopActive(false);
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const loopEpoch = arLoopEpochRef.current + 1;
    arLoopEpochRef.current = loopEpoch;
    const viewport = {
      width: 0,
      height: 0,
      dpr: 1,
      backingWidth: 0,
      backingHeight: 0
    };
	    const stabilizedPose = {
	      lastAtMs: null as number | null,
	      headingDeg: null as number | null,
	      pitchDeg: null as number | null
	    };
    const padMarkerStabilizer = {
      y: null as number | null,
      lastAtMs: null as number | null
    };

    const drawPath = (ctx: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>) => {
      let started = false;
      for (const point of points) {
        if (!started) {
          ctx.moveTo(point.x, point.y);
          started = true;
        } else {
          ctx.lineTo(point.x, point.y);
        }
      }
      return started;
    };

    const drawRoundedRectPath = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      w: number,
      h: number,
      r: number
    ) => {
      const radius = Math.max(0, Math.min(r, w / 2, h / 2));
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + w, y, x + w, y + h, radius);
      ctx.arcTo(x + w, y + h, x, y + h, radius);
      ctx.arcTo(x, y + h, x, y, radius);
      ctx.arcTo(x, y, x + w, y, radius);
      ctx.closePath();
    };

    const rectsOverlap = (
      a: { x: number; y: number; w: number; h: number },
      b: { x: number; y: number; w: number; h: number },
      padding = 0
    ) =>
      a.x < b.x + b.w + padding &&
      a.x + a.w + padding > b.x &&
      a.y < b.y + b.h + padding &&
      a.y + a.h + padding > b.y;

    const drawHudBrackets = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      {
        size,
        scale,
        color,
        lineWidth
      }: {
        size: number;
        scale: number;
        color: string;
        lineWidth: number;
      }
    ) => {
      const s = size * scale;
      const half = s / 2;
      const gap = s * 0.55;
      const tick = s * 0.28;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Left bracket [
      ctx.beginPath();
      ctx.moveTo(x - gap, y - half);
      ctx.lineTo(x - gap + tick, y - half);
      ctx.moveTo(x - gap, y - half);
      ctx.lineTo(x - gap, y + half);
      ctx.moveTo(x - gap, y + half);
      ctx.lineTo(x - gap + tick, y + half);
      // Right bracket ]
      ctx.moveTo(x + gap, y - half);
      ctx.lineTo(x + gap - tick, y - half);
      ctx.moveTo(x + gap, y - half);
      ctx.lineTo(x + gap, y + half);
      ctx.moveTo(x + gap, y + half);
      ctx.lineTo(x + gap - tick, y + half);
      ctx.stroke();
      ctx.restore();
    };

    const isMajorEvent = (key: string, label: string) => {
      const k = `${key || ''} ${label || ''}`.toLowerCase();
      return (
        k.includes('meco') ||
        k.includes('seco') ||
        k.includes('stage') ||
        k.includes('sep') ||
        k.includes('landing') ||
        k.includes('entry') ||
        k.includes('boost') ||
        k.includes('maxq') ||
        k.includes('max-q')
      );
    };

    const readViewport = () => {
      const vv = typeof window !== 'undefined' ? window.visualViewport : null;
      const widthRaw = vv && typeof vv.width === 'number' ? vv.width : window.innerWidth;
      const heightRaw = vv && typeof vv.height === 'number' ? vv.height : window.innerHeight;
      const width = Math.max(1, Math.floor(Number(widthRaw) || 0));
      const height = Math.max(1, Math.floor(Number(heightRaw) || 0));
      const dprRaw =
        typeof window.devicePixelRatio === 'number' && Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1;
      const dprCap = clamp(drawStateRef.current.dprCap || 2, 1, 2);
      const dpr = clamp(dprRaw, 1, dprCap);
      return { width, height, dpr };
    };

    const syncViewport = () => {
      const { width, height, dpr } = readViewport();
      const backingWidth = Math.max(1, Math.floor(width * dpr));
      const backingHeight = Math.max(1, Math.floor(height * dpr));

      const changed = width !== viewport.width || height !== viewport.height || dpr !== viewport.dpr;
      viewport.width = width;
      viewport.height = height;
      viewport.dpr = dpr;
      viewport.backingWidth = backingWidth;
      viewport.backingHeight = backingHeight;

      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
      }

      return changed;
    };

    syncViewport();

    const draw = () => {
      if (arLoopEpochRef.current !== loopEpoch) return;
      const width = viewport.width || 1;
      const height = viewport.height || 1;
      const dpr = viewport.dpr || 1;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const state = drawStateRef.current;
      const pose = poseFilterRef.current;
      const rawHeadingDeg = pose.heading;
      const rawPitchDeg = pose.pitch;
      const rawRollDeg = pose.roll;
      const adjustedHeadingTarget =
        typeof rawHeadingDeg === 'number' && Number.isFinite(rawHeadingDeg)
          ? (rawHeadingDeg + state.yawOffset + 360) % 360
          : null;
      const adjustedPitchTarget =
        typeof rawPitchDeg === 'number' && Number.isFinite(rawPitchDeg) ? rawPitchDeg - state.pitchOffset : null;
      const tNowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const frameStats = telemetryFrameStatsRef.current;
      if (frameStats.lastFrameAtMs != null) {
        const frameDtMs = tNowMs - frameStats.lastFrameAtMs;
        // Ignore large resume gaps so background tabs do not overcount dropped frames.
        if (frameDtMs > 4 && frameDtMs < 250) {
          const estimatedDropped = Math.max(0, Math.round(frameDtMs / 16.67) - 1);
          frameStats.dropped += estimatedDropped;
          frameStats.frames += 1;
          const perfWindow = renderPerformanceWindowRef.current;
          perfWindow.frameCount += 1;
          perfWindow.dtTotalMs += frameDtMs;
          if (frameDtMs >= 22) perfWindow.slowFrameCount += 1;
          if (frameDtMs >= 33) perfWindow.severeFrameCount += 1;
        } else if (frameDtMs >= 250) {
          frameStats.frames += 1;
        }
      } else {
        frameStats.frames += 1;
      }
      frameStats.lastFrameAtMs = tNowMs;
      const dtSecRaw =
        stabilizedPose.lastAtMs != null ? (tNowMs - stabilizedPose.lastAtMs) / 1000 : 0.016;
      const dtSec = clamp(dtSecRaw, 0.004, 0.08);
      stabilizedPose.lastAtMs = tNowMs;

	      stabilizedPose.headingDeg = adjustedHeadingTarget;
        if (adjustedPitchTarget == null) {
          stabilizedPose.pitchDeg = null;
        } else {
          const prevPitch = stabilizedPose.pitchDeg;
          if (prevPitch == null || !Number.isFinite(prevPitch)) {
            stabilizedPose.pitchDeg = adjustedPitchTarget;
          } else {
            const stats = motionStatsRef.current;
            const rotRateFresh = stats.lastAtMs != null && tNowMs - stats.lastAtMs < 250;
            const rotRateMagDegPerSec = rotRateFresh ? stats.rotRateMagDegPerSec : 0;
            const motionBoost = clamp(rotRateMagDegPerSec / 40, 0, 1);
            const pitchRateLimit = 32 + motionBoost * 88;
            const maxPitchDelta = Math.max(0.5, dtSec * pitchRateLimit);
            const clampedTarget = prevPitch + clamp(adjustedPitchTarget - prevPitch, -maxPitchDelta, maxPitchDelta);
            const tauSec = 0.14 - motionBoost * 0.08;
            const alpha = 1 - Math.exp(-dtSec / Math.max(0.04, tauSec));
            stabilizedPose.pitchDeg = prevPitch + (clampedTarget - prevPitch) * alpha;
          }
        }

      const headingDeg = stabilizedPose.headingDeg;
      const pitchDeg = stabilizedPose.pitchDeg ?? 0;
      const fovXValue = state.fovX;
      const fovYValue = state.fovY;
      const highContrastEnabled = state.highContrast;
      const reducedEffectsEnabled = state.reducedEffects;
      const performanceTier = state.performanceTier;
      const milestoneDensity = state.milestoneDensity;
      const lockPredictionDepth = state.lockPredictionDepth;
      const showRollAssist = state.showRollAssist;
      const corridorScale = state.corridorMode === 'tight' ? 0.6 : state.corridorMode === 'wide' ? 1.6 : 1.0;

      // Roll is intentionally ignored for rendering to keep the trajectory "level" (more stable on web sensors).
      const rollDegRaw = typeof rawRollDeg === 'number' && Number.isFinite(rawRollDeg) ? rawRollDeg : 0;
      const rollRad = 0;
      const halfFovYRad = (Math.max(1, fovYValue) * Math.PI) / 180 / 2;
      const pitchRad = (pitchDeg * Math.PI) / 180;
      const horizonOffsetRaw = (Math.tan(pitchRad) / Math.tan(halfFovYRad)) * (height / 2);
      const horizonOffset = clamp(horizonOffsetRaw, -height * 2, height * 2);

      ctx.save();
      ctx.translate(width / 2, height / 2 + horizonOffset);
      ctx.rotate(-rollRad);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-width, 0);
      ctx.lineTo(width, 0);
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(width / 2 - 12, height / 2);
      ctx.lineTo(width / 2 + 12, height / 2);
      ctx.moveTo(width / 2, height / 2 - 12);
      ctx.lineTo(width / 2, height / 2 + 12);
      ctx.stroke();

      if (showRollAssist && typeof rawRollDeg === 'number' && Number.isFinite(rawRollDeg)) {
        const isLevel = Math.abs(rollDegRaw) < 3;
        const levelMaxDeg = 12;
        const barW = 140;
        const barH = 14;
        const cx = width / 2;
        const cy = Math.max(64, Math.round(height * 0.12));
        const x = cx - barW / 2;
        const y = cy - barH / 2;

        const t = clamp(rollDegRaw / levelMaxDeg, -1, 1);
        const dotX = cx + t * (barW / 2 - 12);
        const dotY = cy;

        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 12;
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        drawRoundedRectPath(ctx, x, y, barW, barH, 7);
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.moveTo(cx, y + 3);
        ctx.lineTo(cx, y + barH - 3);
        ctx.stroke();

        ctx.fillStyle = isLevel ? 'rgba(34,197,94,0.95)' : 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(dotX, dotY, 4.25, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.65)';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        const label = isLevel ? 'LEVEL' : `ROLL ${Math.round(rollDegRaw)}°`;
        ctx.strokeText(label, cx, y - 4);
        ctx.fillText(label, cx, y - 4);

        ctx.restore();
      }

      const project = (azDeg: number, elDeg: number) => {
        if (headingDeg == null) return null;
        const yawDelta = normalizeAngleDelta(azDeg - headingDeg);
        const pitchDeltaValue = elDeg - pitchDeg;
        const halfFovXRad = (Math.max(1, fovXValue) * Math.PI) / 180 / 2;
        const halfFovYRad = (Math.max(1, fovYValue) * Math.PI) / 180 / 2;
        const yawRad = (yawDelta * Math.PI) / 180;
        const pitchRadDelta = (pitchDeltaValue * Math.PI) / 180;
        if (Math.abs(yawRad) > halfFovXRad || Math.abs(pitchRadDelta) > halfFovYRad) {
          return null;
        }
        const nx = Math.tan(yawRad) / Math.tan(halfFovXRad);
        const ny = Math.tan(pitchRadDelta) / Math.tan(halfFovYRad);
        let x = width / 2 + nx * (width / 2);
        let y = height / 2 - ny * (height / 2);
        if (rollRad) {
          const cx = width / 2;
          const cy = height / 2;
          const dx = x - cx;
          const dy = y - cy;
          const cos = Math.cos(-rollRad);
          const sin = Math.sin(-rollRad);
          x = cx + dx * cos - dy * sin;
          y = cy + dx * sin + dy * cos;
        }
        return {
          x,
          y
        };
      };

      const points = state.trajectoryPoints;
      const canRenderTrajectory = state.trajectoryRenderable && points.length >= 2;
      const tSelectedSec =
        state.timeMode === 'LIVE' && state.liftoffAtMs != null && !state.isBeforeLiftoff && state.durationSec > 0
          ? clamp((Date.now() - state.liftoffAtMs) / 1000, 0, state.durationSec)
          : state.tSelectedSec;
      const aim = canRenderTrajectory ? interpolateTrajectory(points, tSelectedSec) : null;

      const aimProjected = aim ? project(aim.azDeg, aim.elDeg) : null;
      const sigmaDegBase = readTrajectoryPointSigmaDeg(aim) ?? readTrajectoryPointSigmaDeg(points[0]) ?? 12;
      const covariance = readTrajectoryPointCovariance(aim) ?? readTrajectoryPointCovariance(points[0]) ?? null;
      const crossTrackSigmaDeg = covariance?.crossTrackDeg ?? sigmaDegBase;
      const alongTrackSigmaDeg = covariance?.alongTrackDeg ?? sigmaDegBase;
      const crossTrackSigmaDegScaled = crossTrackSigmaDeg * corridorScale;
      const alongTrackSigmaDegScaled = alongTrackSigmaDeg * corridorScale;
      const guidanceSigmaDegScaled = Math.max(crossTrackSigmaDegScaled, alongTrackSigmaDegScaled);
      const anisotropyRatio = clamp(alongTrackSigmaDeg / Math.max(1, crossTrackSigmaDeg), 0.65, 2.4);

      const projectedAll: Array<{ x: number; y: number; t: number }> = [];
      if (canRenderTrajectory) {
        for (const point of points) {
          const projected = project(point.azDeg, point.elDeg);
          if (!projected) continue;
          projectedAll.push({ x: projected.x, y: projected.y, t: point.tPlusSec });
        }
      }

      if (projectedAll.length >= 2) {
        const inLaunchPhase = tSelectedSec < 90;
        const coreColor = inLaunchPhase ? 'rgba(255, 186, 120, 0.9)' : 'rgba(140, 240, 255, 0.9)';
        const dimColor = 'rgba(255,255,255,0.22)';

        const halfFovXRad = (Math.max(1, fovXValue) * Math.PI) / 180 / 2;
        const halfFovYRad = (Math.max(1, fovYValue) * Math.PI) / 180 / 2;
        const pxPerDegX = (width / 2) * ((Math.PI / 180) / Math.tan(halfFovXRad));
        const pxPerDegY = (height / 2) * ((Math.PI / 180) / Math.tan(halfFovYRad));
        const pxPerDeg = Math.max(pxPerDegX, pxPerDegY);
        const radiusPx = clamp(crossTrackSigmaDegScaled * pxPerDeg, 2, Math.min(width, height) * 0.45);
        const corridorWidth = clamp(radiusPx * 2, 10, Math.min(width, height) * 0.9);
        const futureLineWidth = clamp(2.8 + (anisotropyRatio - 1) * 0.8, 2.3, 4.7);
        const pastLineWidth = clamp(1.8 + (anisotropyRatio - 1) * 0.4, 1.4, 3.2);

        const splitIndex = projectedAll.findIndex((p) => p.t > tSelectedSec);
        const past = splitIndex === -1 ? projectedAll : projectedAll.slice(0, splitIndex);
        const future = splitIndex === -1 ? [] : projectedAll.slice(splitIndex);

        if (aimProjected) {
          past.push({ x: aimProjected.x, y: aimProjected.y, t: tSelectedSec });
          future.unshift({ x: aimProjected.x, y: aimProjected.y, t: tSelectedSec });
        }

        // Corridor (uncertainty band)
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = inLaunchPhase ? 'rgba(255, 170, 90, 0.08)' : 'rgba(90, 210, 255, 0.08)';
        ctx.lineWidth = corridorWidth;
        ctx.beginPath();
        drawPath(ctx, projectedAll);
        ctx.stroke();
        ctx.restore();

        // Spine (past, dim)
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = dimColor;
        ctx.lineWidth = pastLineWidth;
        ctx.beginPath();
        if (drawPath(ctx, past)) ctx.stroke();
        ctx.restore();

        // Spine (future, bright)
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = coreColor;
        ctx.lineWidth = futureLineWidth;
        ctx.shadowBlur = 0;
        ctx.setLineDash(!reducedEffectsEnabled && performanceTier < 2 && anisotropyRatio >= 1.35 ? [8, 6] : []);
        ctx.beginPath();
        if (drawPath(ctx, future)) ctx.stroke();
        ctx.restore();
	      } else if (projectedAll.length === 1) {
	        const dot = projectedAll[0];
	        ctx.save();
	        ctx.fillStyle = 'rgba(255,255,255,0.75)';
	        ctx.beginPath();
	        ctx.arc(dot.x, dot.y, 5, 0, Math.PI * 2);
	        ctx.fill();
	        ctx.restore();
	      }

	      if (milestoneDensity !== 'off' && state.showMilestones && canRenderTrajectory && state.trajectoryMilestones.length > 0) {
	        const inLaunchPhase = tSelectedSec < 90;
	        const coreColor = inLaunchPhase ? 'rgba(255, 186, 120, 0.95)' : 'rgba(140, 240, 255, 0.95)';
	        const glowColor = inLaunchPhase ? 'rgba(255, 120, 60, 0.85)' : 'rgba(0, 220, 255, 0.8)';
	        const successColor = 'rgba(34, 197, 94, 0.95)';
	        const estimatedColor = 'rgba(250, 204, 21, 0.95)';

        const halfFovXRad = (Math.max(1, fovXValue) * Math.PI) / 180 / 2;
        const halfFovYRad = (Math.max(1, fovYValue) * Math.PI) / 180 / 2;
        const pxPerDegX = (width / 2) * ((Math.PI / 180) / Math.tan(halfFovXRad));
        const pxPerDegY = (height / 2) * ((Math.PI / 180) / Math.tan(halfFovYRad));
        const pxPerDeg = Math.max(pxPerDegX, pxPerDegY);

        const candidates = state.trajectoryMilestones
          .map((event, index) => {
            if (typeof event.tPlusSec !== 'number' || !Number.isFinite(event.tPlusSec) || !event.trackKind) return null;
            const eventPoints = state.trajectoryTrackPointsByKind[event.trackKind] ?? [];
            if (eventPoints.length < 2) return null;
            const tMin = eventPoints[0].tPlusSec;
            const tMax = eventPoints[eventPoints.length - 1].tPlusSec;
            if (event.tPlusSec < tMin || event.tPlusSec > tMax) return null;

            const locationAtEvent = interpolateTrajectory(eventPoints, event.tPlusSec);
            if (!locationAtEvent) return null;
            const projected = project(locationAtEvent.azDeg, locationAtEvent.elDeg);
            if (!projected) return null;

            const text = event.label.slice(0, 32);
            const major = isMajorEvent(event.key, text);
            const eventCovariance = readTrajectoryPointCovariance(locationAtEvent);
            const sigmaAt =
              eventCovariance?.crossTrackDeg ??
              readTrajectoryPointSigmaDeg(locationAtEvent) ??
              crossTrackSigmaDeg;
            const gateR = clamp(sigmaAt * corridorScale * pxPerDeg * 0.55, 22, Math.min(width, height) * 0.35);

            ctx.font = '11px sans-serif';
            const textW = Math.ceil(ctx.measureText(text).width);
            const padX = 8;
            const boxH = 22;
            const boxW = Math.max(56, textW + padX * 2);
            const prefersRight = projected.x < width * 0.5 ? true : projected.x > width * 0.5 ? false : index % 2 === 0;
            const side = prefersRight ? ('right' as const) : ('left' as const);
            const gap = 14;
            const boxXRaw = side === 'right' ? projected.x + gap : projected.x - gap - boxW;
            const marginX = 14;
            const boxX = clamp(boxXRaw, marginX, width - marginX - boxW);
            return {
              key: `${event.key}:${event.tPlusSec}`,
              tPlusSec: event.tPlusSec,
              label: text,
              major,
              estimated: event.estimated === true,
              gateR,
              dotX: projected.x,
              dotY: projected.y,
              side,
              boxX,
              boxY: 0,
              boxW,
              boxH,
              padX
            };
          })
          .filter((item): item is NonNullable<typeof item> => item != null)
          .filter((item) => milestoneDensity !== 'major' || item.major)
          .sort((a, b) => Math.abs(a.tPlusSec - tSelectedSec) - Math.abs(b.tPlusSec - tSelectedSec))
          .slice(0, milestoneDensity === 'major' ? 4 : reducedEffectsEnabled ? 6 : 10)
          .sort((a, b) => a.dotY - b.dotY);

        if (candidates.length > 0) {
          ctx.save();
          ctx.font = '11px sans-serif';
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';

          const topMargin = 72;
          let bottomMargin = Math.min(240, Math.max(120, Math.round(height * 0.32)));
          bottomMargin = Math.min(bottomMargin, Math.max(0, height - topMargin - 40));
          const maxLabelY = Math.max(topMargin, height - bottomMargin);

          const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
          const overlapPadding = 8;
          const offsets = [0, 22, -22, 44, -44, 66, -66, 88, -88];

          for (const item of candidates) {
            const yBase = clamp(item.dotY - item.boxH / 2, topMargin, maxLabelY - item.boxH);
            let y = yBase;

            for (const off of offsets) {
              const yTry = clamp(yBase + off, topMargin, maxLabelY - item.boxH);
              const rect = { x: item.boxX, y: yTry, w: item.boxW, h: item.boxH };
              if (!placed.some((p) => rectsOverlap(rect, p, overlapPadding))) {
                y = yTry;
                break;
              }
            }

            item.boxY = y;
            placed.push({ x: item.boxX, y, w: item.boxW, h: item.boxH });
          }

          for (const item of candidates) {
            const met = tSelectedSec >= item.tPlusSec;
            const elapsed = tSelectedSec - item.tPlusSec;
            const justMet = elapsed >= 0 && elapsed < 2.2;
            const justMetT = justMet ? elapsed / 2.2 : 0;
            const highlight = justMet ? 1 - justMetT : 0;

            const anchorX = item.side === 'right' ? item.boxX : item.boxX + item.boxW;
            const anchorY = item.boxY + item.boxH / 2;

            // Leader line
            ctx.save();
            ctx.strokeStyle = met
              ? `rgba(255,255,255,${0.22 + highlight * 0.25})`
              : item.estimated
                ? 'rgba(250, 204, 21, 0.22)'
                : item.major
                  ? `rgba(90, 210, 255, ${0.18})`
                : 'rgba(255,255,255,0.14)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(item.dotX, item.dotY);
            ctx.lineTo(anchorX, anchorY);
            ctx.stroke();
            ctx.restore();

            // Marker (gate or brackets)
            if (item.major) {
              const scale = 1 + 0.12 * highlight;
              const bracketColor = met ? successColor : item.estimated ? estimatedColor : coreColor;
              ctx.save();
              ctx.shadowColor = met || justMet ? successColor : item.estimated ? estimatedColor : 'rgba(0,0,0,0)';
              ctx.shadowBlur = reducedEffectsEnabled ? 0 : met || justMet ? (highContrastEnabled ? 12 : 8) : 0;
              drawHudBrackets(ctx, item.dotX, item.dotY, {
                size: 18,
                scale,
                color: bracketColor,
                lineWidth: met ? 2.5 : 2
              });
              ctx.restore();
            } else {
              const scale = 1 + 0.18 * highlight;
              const bracketColor = met ? successColor : item.estimated ? estimatedColor : 'rgba(255,255,255,0.75)';
              ctx.save();
              ctx.shadowColor = met || justMet ? successColor : item.estimated ? estimatedColor : 'rgba(0,0,0,0)';
              ctx.shadowBlur = reducedEffectsEnabled ? 0 : met || justMet ? (highContrastEnabled ? 14 : 10) : 0;
              drawHudBrackets(ctx, item.dotX, item.dotY, {
                size: 14,
                scale,
                color: bracketColor,
                lineWidth: met ? 2.25 : 1.75
              });
              ctx.restore();
            }

            // Label box
            ctx.save();
            ctx.shadowColor = item.major ? glowColor : justMet ? successColor : 'rgba(0,0,0,0)';
            ctx.shadowBlur = reducedEffectsEnabled ? 0 : item.major ? 14 : justMet ? 14 : 0;

            const stroke =
              met
                ? `rgba(34, 197, 94, ${0.25 + highlight * 0.45})`
                : item.estimated
                  ? 'rgba(250, 204, 21, 0.28)'
                  : item.major
                    ? 'rgba(90, 210, 255, 0.2)'
                    : 'rgba(255,255,255,0.14)';
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1;
            ctx.beginPath();
            drawRoundedRectPath(ctx, item.boxX, item.boxY, item.boxW, item.boxH, 8);
            ctx.fill();
            ctx.stroke();

            const textColor = met ? `rgba(255,255,255,${0.9 + 0.1 * highlight})` : 'rgba(255,255,255,0.84)';
            ctx.fillStyle = textColor;
            ctx.fillText(item.label, item.boxX + item.padX, item.boxY + item.boxH / 2);
            ctx.restore();
          }

          ctx.restore();
        }
	      }

      if (aimProjected) {
        const inLaunchPhase = tSelectedSec < 90;
        const headColor = inLaunchPhase ? 'rgba(255, 186, 120, 0.95)' : 'rgba(140, 240, 255, 0.95)';
        const glowColor = inLaunchPhase ? 'rgba(255, 120, 60, 0.85)' : 'rgba(0, 220, 255, 0.8)';

	        ctx.save();
	        ctx.fillStyle = headColor;
	        ctx.shadowColor = glowColor;
	        ctx.shadowBlur = reducedEffectsEnabled ? 0 : highContrastEnabled ? 18 : 10;
	        ctx.beginPath();
	        ctx.arc(aimProjected.x, aimProjected.y, 4, 0, Math.PI * 2);
	        ctx.fill();
	        ctx.restore();

        if (performanceTier < 3) {
          ctx.font = '11px sans-serif';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          const label = `T+${Math.round(tSelectedSec)}s`;
          ctx.strokeText(label, aimProjected.x + 12, aimProjected.y + 4);
          ctx.fillText(label, aimProjected.x + 12, aimProjected.y + 4);
        }
      }

      const lockOnOverlay = lockOnOverlayRef.current;
      const lockOnOverlayFresh =
        lockOnOverlay.updatedAtMs != null && tNowMs - lockOnOverlay.updatedAtMs <= 2500;
      if (state.lockOnRenderEnabled && lockOnOverlayFresh && lockOnOverlay.confidence >= LOCK_ON_DRAW_CONFIDENCE) {
        const center = lockOnOverlay.centerNorm;
        if (center) {
          const centerX = clamp(center.xNorm * width, 0, width);
          const centerY = clamp(center.yNorm * height, 0, height);
          const centerAlpha = clamp(lockOnOverlay.confidence, 0.3, 0.95);
          ctx.save();
          ctx.shadowColor = 'rgba(64, 255, 183, 0.8)';
          ctx.shadowBlur = reducedEffectsEnabled ? 0 : 14;
          drawHudBrackets(ctx, centerX, centerY, {
            size: 12,
            scale: 1,
            color: `rgba(96, 255, 196, ${centerAlpha})`,
            lineWidth: 2
          });
          ctx.restore();
        }

        const predictions =
          lockPredictionDepth > 0
            ? lockOnOverlay.predictions
                .filter((prediction) => prediction.confidence >= 0.15)
                .sort((a, b) => a.dtSec - b.dtSec)
                .slice(0, lockPredictionDepth)
            : [];
        if (predictions.length > 0) {
          ctx.save();
          ctx.font = '10px sans-serif';
          ctx.lineWidth = 1.75;
          for (const prediction of predictions) {
            const x = clamp(prediction.xNorm * width, 0, width);
            const y = clamp(prediction.yNorm * height, 0, height);
            const alpha = clamp(prediction.confidence * lockOnOverlay.confidence, 0.2, 0.9);
            const radius = prediction.dtSec === 1 ? 12 : prediction.dtSec === 2 ? 9 : 7;

            ctx.strokeStyle = `rgba(96, 255, 196, ${alpha})`;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.setLineDash([]);
            ctx.fillStyle = `rgba(96, 255, 196, ${alpha})`;
            ctx.fillText(`+${prediction.dtSec}s`, x + radius + 4, y + 3);
          }
          ctx.restore();
        }
      }

      if (!aimProjected && aim && headingDeg != null) {
        const yawDelta = normalizeAngleDelta(aim.azDeg - headingDeg);
        const pitchDeltaValue = aim.elDeg - pitchDeg;
        const toleranceYaw = fovXValue / 2 + guidanceSigmaDegScaled;
        const tolerancePitch = fovYValue / 2 + guidanceSigmaDegScaled;
        const showOffscreenGuide = Math.abs(yawDelta) > toleranceYaw || Math.abs(pitchDeltaValue) > tolerancePitch;
        if (showOffscreenGuide) {
          const halfFovXRad = (Math.max(1, fovXValue) * Math.PI) / 180 / 2;
          const halfFovYRad = (Math.max(1, fovYValue) * Math.PI) / 180 / 2;
          const maxAngleRad = Math.PI / 2 - 0.01;
          const yawRadClamped = clamp((yawDelta * Math.PI) / 180, -maxAngleRad, maxAngleRad);
          const pitchRadClamped = clamp((pitchDeltaValue * Math.PI) / 180, -maxAngleRad, maxAngleRad);
          const nx = Math.tan(yawRadClamped) / Math.tan(halfFovXRad);
          const ny = Math.tan(pitchRadClamped) / Math.tan(halfFovYRad);
          let xRaw = width / 2 + nx * (width / 2);
          let yRaw = height / 2 - ny * (height / 2);
          if (rollRad) {
            const cx = width / 2;
            const cy = height / 2;
            const dx = xRaw - cx;
            const dy = yRaw - cy;
            const cos = Math.cos(-rollRad);
            const sin = Math.sin(-rollRad);
            xRaw = cx + dx * cos - dy * sin;
            yRaw = cy + dx * sin + dy * cos;
          }
          const margin = 28;
          const x = clamp(xRaw, margin, width - margin);
          const y = clamp(yRaw, margin, height - margin);
          const angle = Math.atan2(y - height / 2, x - width / 2);

          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.beginPath();
          ctx.arc(0, 0, 18, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.7)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, 18, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.95)';
          ctx.beginPath();
          ctx.moveTo(10, 0);
          ctx.lineTo(-6, -7);
          ctx.lineTo(-6, 7);
          ctx.closePath();
          ctx.fill();
          ctx.restore();

          const horiz = Math.abs(yawDelta) < 3 ? null : yawDelta > 0 ? 'right' : 'left';
          const vert = Math.abs(pitchDeltaValue) < 3 ? null : pitchDeltaValue > 0 ? 'up' : 'down';
          const hint = [horiz, vert].filter(Boolean).join(' / ');
          if (hint) {
            ctx.font = '11px sans-serif';
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(0,0,0,0.7)';
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            const label = `Pan ${hint}`;
            ctx.strokeText(label, x + 22, y + 4);
            ctx.fillText(label, x + 22, y + 4);
          }
        }
      }

        const stabilizePadY = (targetY: number) => {
          const prevY = padMarkerStabilizer.y;
          const prevAt = padMarkerStabilizer.lastAtMs;
          if (prevY == null || !Number.isFinite(prevY) || prevAt == null || !Number.isFinite(prevAt)) {
            padMarkerStabilizer.y = targetY;
            padMarkerStabilizer.lastAtMs = tNowMs;
            return targetY;
          }
          const dtSecY = clamp((tNowMs - prevAt) / 1000, 0.004, 0.08);
          const maxDelta = clamp(dtSecY * 360, 6, Math.max(14, height * 0.07));
          const nextY = prevY + clamp(targetY - prevY, -maxDelta, maxDelta);
          padMarkerStabilizer.y = nextY;
          padMarkerStabilizer.lastAtMs = tNowMs;
          return nextY;
        };

	      if (state.padBearing != null && state.padElevation != null && headingDeg != null) {
	        const padYaw = normalizeAngleDelta(state.padBearing - headingDeg);
	        const padPitch = state.padElevation - pitchDeg;
	        const padInView = Math.abs(padYaw) <= fovXValue / 2 && Math.abs(padPitch) <= fovYValue / 2;
	        const padProjected = project(state.padBearing, state.padElevation);

	        if (padInView) {
	          const x = padProjected?.x ?? width / 2;
	          const y = stabilizePadY(padProjected?.y ?? height / 2);
	          ctx.fillStyle = 'rgba(255, 99, 71, 0.9)';
	          ctx.beginPath();
	          ctx.arc(x, y, 6, 0, Math.PI * 2);
	          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.font = '12px sans-serif';
          ctx.fillText('Pad', x + 10, y - 8);
        } else if (state.showPadGuide) {
          const halfFovXRad = (Math.max(1, fovXValue) * Math.PI) / 180 / 2;
          const halfFovYRad = (Math.max(1, fovYValue) * Math.PI) / 180 / 2;
          const maxAngleRad = Math.PI / 2 - 0.01;
          const yawRadClamped = clamp((padYaw * Math.PI) / 180, -maxAngleRad, maxAngleRad);
          const pitchRadClamped = clamp((padPitch * Math.PI) / 180, -maxAngleRad, maxAngleRad);
          const nx = Math.tan(yawRadClamped) / Math.tan(halfFovXRad);
          const ny = Math.tan(pitchRadClamped) / Math.tan(halfFovYRad);
          let xRaw = width / 2 + nx * (width / 2);
          let yRaw = height / 2 - ny * (height / 2);
          if (rollRad) {
            const cx = width / 2;
            const cy = height / 2;
            const dx = xRaw - cx;
            const dy = yRaw - cy;
            const cos = Math.cos(-rollRad);
            const sin = Math.sin(-rollRad);
            xRaw = cx + dx * cos - dy * sin;
            yRaw = cy + dx * sin + dy * cos;
	          }
	          const margin = 28;
	          const x = clamp(xRaw, margin, width - margin);
	          const y = stabilizePadY(clamp(yRaw, margin, height - margin));
	          const angle = Math.atan2(y - height / 2, x - width / 2);

          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.beginPath();
          ctx.arc(0, 0, 18, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 99, 71, 0.9)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, 18, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255, 99, 71, 0.95)';
          ctx.beginPath();
          ctx.moveTo(10, 0);
          ctx.lineTo(-6, -7);
          ctx.lineTo(-6, 7);
          ctx.closePath();
          ctx.fill();
          ctx.restore();

          const horiz = Math.abs(padYaw) < 3 ? null : padYaw > 0 ? 'right' : 'left';
          const vert = Math.abs(padPitch) < 3 ? null : padPitch > 0 ? 'up' : 'down';
          const hint = [horiz, vert].filter(Boolean).join(' / ');
          ctx.font = '11px sans-serif';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          const label = hint ? `Pad • Pan ${hint}` : 'Pad';
          ctx.strokeText(label, x + 22, y + 4);
          ctx.fillText(label, x + 22, y + 4);
        }
      }

      if (arLoopEpochRef.current !== loopEpoch) return;
      raf = requestAnimationFrame(draw);
    };

    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      telemetryRenderLoopRunningRef.current = false;
      markArLoopActive(false);
    };

    const start = () => {
      if (raf) return;
      if (arLoopEpochRef.current !== loopEpoch) return;
      telemetryRenderLoopRunningRef.current = true;
      markArLoopActive(true);
      raf = requestAnimationFrame(draw);
    };

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') {
        telemetryCanvasHiddenRef.current = true;
        stop();
      } else {
        telemetryCanvasHiddenRef.current = false;
        syncViewport();
        start();
      }
    };

    const handleResize = () => {
      syncViewport();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
      window.visualViewport.addEventListener('resize', handleResize);
      window.visualViewport.addEventListener('scroll', handleResize);
    }
    handleVisibility();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      if (window.visualViewport && typeof window.visualViewport.removeEventListener === 'function') {
        window.visualViewport.removeEventListener('resize', handleResize);
        window.visualViewport.removeEventListener('scroll', handleResize);
      }
      arLoopEpochRef.current += 1;
      stop();
    };
  }, [markArLoopActive, shouldRunArLoop]);

	  return (
	    <div ref={rootRef} className={`fixed inset-0 z-[70] overflow-hidden ${xrActive ? 'bg-transparent' : 'bg-black'}`}>
	      <canvas ref={xrCanvasRef} className="hidden" />
	      <video ref={videoRef} className={`absolute inset-0 h-full w-full object-cover ${xrActive ? 'hidden' : ''}`} playsInline muted />
	      <canvas ref={canvasRef} className={`absolute inset-0 h-full w-full ${showSkyCompass ? 'hidden' : ''}`} />
      {showSkyCompass && (
        <SkyCompass
          points={trajectoryPoints}
          trackPointsByKind={trajectoryTrackPointsByKind}
          tSelectedSec={displayTSec}
          corridorMode={effectiveCorridorMode}
          events={trajectoryProjectedMilestones}
          showMilestones={effectiveShowMilestones && trajectoryRenderable}
          onLoopActiveChange={markSkyCompassLoopActive}
        />
      )}

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[calc(1rem+env(safe-area-inset-left))] top-[calc(1rem+env(safe-area-inset-top))] rounded-xl border border-white/20 bg-black/50 px-3 py-2 text-xs text-white/90">
          <div className="text-[10px] uppercase tracking-[0.12em] text-white/60">AR trajectory</div>
          <div className="text-sm font-semibold text-white">{launchName}</div>
          {netDisplay && <div className="text-[11px] text-white/70">NET {netDisplay}</div>}
          <div className="text-[10px] text-white/50">{trajectoryStatusLabel}</div>
        </div>
        {trajectoryFlightPlanMilestones.length > 0 && (
          <div className="absolute right-[calc(1rem+env(safe-area-inset-right))] top-[calc(1rem+env(safe-area-inset-top))] max-w-[min(18rem,44vw)] rounded-xl border border-white/15 bg-black/55 px-3 py-2 text-white/85">
            <div className="text-[10px] uppercase tracking-[0.12em] text-white/55">Flight plan</div>
            <div className="mt-1 text-[10px] text-white/45">Off-path milestones stay here until a matching AR track exists.</div>
            <div className="mt-2 space-y-1.5">
              {trajectoryFlightPlanMilestones.slice(0, 4).map((milestone, index) => (
                <div key={`${milestone.key}:${milestone.tPlusSec ?? milestone.timeText ?? index}`} className="rounded-lg border border-white/10 bg-black/35 px-2.5 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 text-[11px] font-medium text-white/90">{milestone.label}</div>
                    {formatTrajectoryMilestoneOffsetLabel(milestone.tPlusSec, milestone.timeText) && (
                      <div className="shrink-0 text-[10px] text-white/55">
                        {formatTrajectoryMilestoneOffsetLabel(milestone.tPlusSec, milestone.timeText)}
                      </div>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-white/50">
                    <span>{formatArMilestoneProjectionReason(milestone)}</span>
                    {milestone.estimated && <span className="text-amber-300/90">Estimated</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

	      <div className="absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] left-[calc(1rem+env(safe-area-inset-left))] right-[calc(1rem+env(safe-area-inset-right))] flex flex-col gap-2 text-xs text-white/80">
          {cameraActive && !xrActive && (
            <div className="pointer-events-auto ml-auto flex max-w-[min(20rem,75vw)] flex-col items-end gap-2" data-ar-ui-control="1">
              <button
                type="button"
                onClick={() => {
                  if (!zoomSupported) return;
                  setZoomTrayOpen((prev) => !prev);
                }}
                className="rounded-full border border-white/20 bg-black/70 px-3 py-1.5 text-[11px] font-semibold text-white/90"
              >
                {zoomSupported ? `${zoomRatio.toFixed(2)}x` : 'Zoom unavailable'}
              </button>
              {zoomSupported && zoomTrayOpen && (
                <div className="w-full rounded-xl border border-white/20 bg-black/80 p-3 text-[11px] text-white/85">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-white/60">Zoom</div>
                    <div className="text-[11px] font-semibold text-white/90">{zoomRatio.toFixed(2)}x</div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleZoomStep(-WEB_PINCH_ZOOM_STEP)}
                      className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[12px]"
                    >
                      −
                    </button>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20">
                      <div className="h-full rounded-full bg-cyan-300/90" style={{ width: `${zoomProgressPercent}%` }} />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleZoomStep(WEB_PINCH_ZOOM_STEP)}
                      className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[12px]"
                    >
                      +
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {quickZoomLevels.map((candidate) => (
                      <button
                        key={candidate}
                        type="button"
                        onClick={() => handleZoomPreset(candidate)}
                        className={`rounded-full border px-2.5 py-1 ${
                          Math.abs(zoomRatio - candidate) < 0.06
                            ? 'border-cyan-300/40 bg-cyan-300/20 text-cyan-50'
                            : 'border-white/20 bg-white/10 text-white/90'
                        }`}
                      >
                        {candidate < 1 ? candidate.toFixed(1) : candidate.toFixed(0)}x
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 text-[10px] text-white/60">
                    Pinch to zoom. Safe range {zoomRange.min.toFixed(2)}x to {zoomRange.max.toFixed(2)}x.
                  </div>
                </div>
              )}
            </div>
          )}
        {sessionStatusView && (
          <div
            className={`pointer-events-auto rounded-xl border px-3 py-2 text-[11px] ${sessionStatusTone?.border ?? 'border-white/15'} ${sessionStatusTone?.bg ?? 'bg-black/55'}`}
          >
            <div className={`text-[10px] uppercase tracking-[0.12em] ${sessionStatusTone?.eyebrow ?? 'text-white/55'}`}>
              {sessionStatusView.eyebrow}
            </div>
            <div className={`mt-1 text-[12px] font-semibold ${sessionStatusTone?.title ?? 'text-white/92'}`}>
              {sessionStatusView.title}
            </div>
            <div className={`mt-1 ${sessionStatusTone?.body ?? 'text-white/75'}`}>{sessionStatusView.body}</div>
            {sessionStatusView.footnote && (
              <div className={`mt-1 text-[10px] ${sessionStatusTone?.footnote ?? 'text-white/50'}`}>
                {sessionStatusView.footnote}
              </div>
            )}
            {(sessionStatusView.actions.enableMotion || sessionStatusView.actions.retrySensors) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {sessionStatusView.actions.enableMotion && (
                  <button
                    type="button"
                    onClick={handleMotionPermission}
                    className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs text-white/90"
                  >
                    Enable motion
                  </button>
                )}
                {sessionStatusView.actions.retrySensors && (
                  <button
                    type="button"
                    onClick={handleRetrySensors}
                    className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs text-white/90"
                  >
                    Retry sensors
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {showSettingsPanel && !cameraError && !locationError && (
		          <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2">
		            {pad.latitude != null && pad.longitude != null
		              ? `Pad: ${pad.name} (${pad.latitude.toFixed(4)}, ${pad.longitude.toFixed(4)})${
                    pad.source ? ` [${pad.source}]` : ''
                  }`
		              : `Pad: ${pad.name} (coordinates unavailable)`}
		          </div>
		        )}
	        {showSettingsPanel && !cameraError && !locationError && (
	          <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2">
	            {trajectory ? (
	              <>
	                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div>
                      <span>
                        Trajectory: {formatTrajectoryQualityStateLabel(trajectory.qualityState)}
                      </span>{' '}
                      <span className="text-white/60">
                        (Tier {trajectory.quality} • {trajectory.version})
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-white/70">
                      Authority: {formatTrajectoryAuthorityTierLabel(trajectory.authorityTier)}
                    </div>
                    {(trajectoryEvidenceView || trajectory.confidenceTier || trajectory.freshnessState || trajectory.lineageComplete != null) && (
                      <>
                        {trajectoryEvidenceView && (
                          <div className="mt-1 text-[11px] text-white/80">
                            {trajectoryEvidenceView.evidenceLabel}
                          </div>
                        )}
                        <div className="mt-1 text-[11px] text-white/70">
                          {trajectoryEvidenceView?.confidenceBadgeLabel ??
                            (trajectory.confidenceTier ? `Confidence ${trajectory.confidenceTier}` : 'Confidence unknown')}
                          {trajectory.freshnessState ? ` • ${trajectory.freshnessState}` : ''}
                          {trajectory.lineageComplete != null ? ` • lineage ${trajectory.lineageComplete ? 'complete' : 'partial'}` : ''}
                        </div>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowQualityHelp((prev) => !prev)}
                    className="pointer-events-auto shrink-0 rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] text-white/80"
                    aria-label="Trajectory quality help"
                  >
                    ?
                  </button>
                </div>
                {showQualityHelp && (
                  <div className="mt-2 rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-[11px] text-white/80">
                    <div className="space-y-1">
                      <div>
                        <span className="text-white/90">Landing constrained:</span> Landing recovery is corroborated by stronger directional data; tighter corridor.
                      </div>
                      <div>
                        <span className="text-white/90">Estimate corridor:</span> Orbit, hazard, template, and landing priors are fused; corridor widened when evidence is weaker.
                      </div>
                      <div>
                        <span className="text-white/90">Pad only:</span> No downrange data; only pad bearing available.
                      </div>
                    </div>
                    <div className="mt-2 text-white/60">
                      Default corridor: {defaultCorridorMode.toUpperCase()} • Current: {effectiveCorridorMode.toUpperCase()}
                    </div>
                  </div>
                )}
              </>
            ) : (
              'Trajectory: not available'
	            )}
	          </div>
	        )}
		        {showSettingsPanel && !cameraError && !locationError && (
		          <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2">
		            <div>
		              Heading: {headingStability ? headingStability.toUpperCase() : '...'}{' '}
		              {headingStability === 'poor' ? '(move away from metal)' : ''}
		            </div>
			            {headingUntrusted && <div className="text-white/60">Heading trust: auto-alignment still settling.</div>}
		              <div className="text-white/60">Pose source: {poseSource}</div>
                  <div className="text-white/60">
                    Heading source: {poseSource === 'webxr' ? 'webxr' : headingSourceRef.current} • Declination{' '}
                    {poseSource === 'webxr' ? 'n/a' : declinationAppliedRef.current ? 'applied' : 'not applied'}
                  </div>
                  <div className="text-white/60">Client profile: {clientProfileForUi}</div>
			            {poseFilterRef.current.debug?.absolute != null && (
		              <div className="text-white/60">Heading absolute: {poseFilterRef.current.debug.absolute ? 'yes' : 'no'}</div>
		            )}
			            {poseFilterRef.current.debug?.declinationDeg != null && (
			              <div className="text-white/60">
                      Declination: {poseFilterRef.current.debug.declinationDeg.toFixed(1)}° (
                      {poseFilterRef.current.debug.declinationSource ?? declinationSourceRef.current})
                    </div>
			            )}
                  {poseFilterRef.current.debug?.webkitCompassAccuracyDeg != null && (
                    <div className="text-white/60">
                      iOS compass accuracy: {Math.round(poseFilterRef.current.debug.webkitCompassAccuracyDeg)}°
                    </div>
                  )}
		            {adjustedPitch != null && <div>Look elevation: {adjustedPitch.toFixed(1)}°</div>}
		            {poseFilterRef.current.debug && (
		              <div className="text-white/60">
		                Screen: {poseFilterRef.current.debug.screenAngleDeg}° (reported{' '}
                    {poseFilterRef.current.debug.screenAngleReportedDeg ?? poseFilterRef.current.debug.screenAngleDeg}°) • beta:{' '}
                  {poseFilterRef.current.debug.beta == null ? '—' : poseFilterRef.current.debug.beta.toFixed(1)} • gamma:{' '}
                  {poseFilterRef.current.debug.gamma == null ? '—' : poseFilterRef.current.debug.gamma.toFixed(1)}
		              </div>
		            )}
                {poseFilterRef.current.debug?.alphaHeadingDeg != null && poseFilterRef.current.debug?.tiltHeadingDeg != null && (
                  <div className="text-white/60">
                    Heading candidates: alpha {poseFilterRef.current.debug.alphaHeadingDeg.toFixed(1)}° • tilt{' '}
                    {poseFilterRef.current.debug.tiltHeadingDeg.toFixed(1)}°
                    {poseFilterRef.current.debug.tiltHeadingMag != null
                      ? ` (tilt mag ${poseFilterRef.current.debug.tiltHeadingMag.toFixed(2)})`
                      : ''}
                  </div>
                )}
                {padBearing != null && (
                  <div className="text-white/60">
                    Pad bearing: {padBearing.toFixed(1)}°{adjustedHeading != null ? ` • Heading (adj): ${adjustedHeading.toFixed(1)}°` : ''}
                  </div>
                )}
                {padBearing != null && adjustedHeading != null && (
                  <div className="text-white/60">Yaw error (pad - heading): {normalizeAngleDelta(padBearing - adjustedHeading).toFixed(1)}°</div>
                )}
                {poseFilterRef.current.debug?.pitchSource && (
                  <div className="text-white/60">
                    Pitch source: {poseFilterRef.current.debug.pitchSource}
                    {poseFilterRef.current.debug.pitchSuppressedJump ? ' (jump clamped)' : ''}
                  </div>
                )}
		            {location?.accuracy != null && <div>GPS accuracy: ±{Math.round(location.accuracy)} m</div>}
                {location && (
                  <div className="text-white/60">
                    You: {location.lat.toFixed(5)}, {location.lon.toFixed(5)}
                  </div>
                )}
		            {typeof location?.altMeters === 'number' && Number.isFinite(location.altMeters) && (
		              <div>
		                Altitude: {Math.round(location.altMeters)} m
		                {typeof location.altAccuracy === 'number' && Number.isFinite(location.altAccuracy) ? ` (±${Math.round(location.altAccuracy)} m)` : ''}
		              </div>
		            )}
		            {padElevation != null && <div>Pad elevation: {padElevation.toFixed(1)}°</div>}
                {padRangeKm != null && Number.isFinite(padRangeKm) && <div>Pad range: {padRangeKm.toFixed(1)} km</div>}
                {pad.source && <div className="text-white/60">Pad source: {pad.source}</div>}
                {pad.canonicalDeltaKm != null && Number.isFinite(pad.canonicalDeltaKm) && (
                  <div className="text-white/60">Cache vs LL2 pad delta: {pad.canonicalDeltaKm.toFixed(3)} km</div>
                )}
		          </div>
		        )}
	          {showManualCalibrationUi && (
	          <div className="pointer-events-auto rounded-xl border border-white/20 bg-black/70 px-3 py-3 text-xs text-white/90">
	            <div className="text-[10px] uppercase tracking-[0.12em] text-white/60">Calibration</div>
              {calibrationNotice && (
                <div className="mt-2 rounded-lg border border-amber-300/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100">
                  {calibrationNotice}
                </div>
              )}
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-[12px] text-white/80">
              <li>Stand still, hold phone upright facing the horizon.</li>
              <li>If prompted, allow motion access.</li>
              <li>Center the pad marker, then tap “Calibrate”.</li>
              <li>Adjust FOV if the overlay feels too wide/narrow.</li>
            </ol>
            {autoCalibrationPending && (
              <div className="mt-2 rounded-lg border border-emerald-300/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-100">
                Hold steady: auto-calibration is ready and will run automatically.
              </div>
            )}
	            <div className="mt-2 flex flex-wrap gap-2">
	              <button
	                type="button"
	                onClick={() => {
	                  setShowWizard(false);
	                  persistWizardDismissed();
	                }}
	                className="rounded border border-white/20 bg-white/10 px-2 py-1 text-[11px]"
	              >
	                Dismiss
	              </button>
	              <button
	                type="button"
	                onClick={handleLevel}
	                className="rounded border border-white/20 bg-white/10 px-2 py-1 text-[11px]"
	              >
	                Set horizon
	              </button>
	            </div>
	          </div>
	        )}
	          <div className="flex flex-wrap items-center justify-between gap-2">
	          <Link href={backHref} className="pointer-events-auto rounded-lg border border-white/20 bg-black/60 px-3 py-2 text-xs">
	            Back to launch
	          </Link>
	          <div className="flex flex-wrap items-center gap-2">
              {xrSupport === 'supported' && (
                <button
                  type="button"
                  onClick={() => {
                    if (xrActive) {
                      void stopWebXr();
                      return;
                    }
                    void startWebXr('manual');
                  }}
                  className="pointer-events-auto rounded-lg border border-white/20 bg-black/60 px-3 py-2 text-xs"
                >
                  {xrActive ? 'Exit WebXR' : 'Start AR (WebXR)'}
                </button>
              )}
              {(AR_MANUAL_CALIBRATION_UI_ENABLED || AR_DEBUG_PANELS_ENABLED) && (
                <>
                  {AR_MANUAL_CALIBRATION_UI_ENABLED && (
                    <button
                      type="button"
                      onClick={handleCalibrate}
                      disabled={!calibrationAimState.ok}
                      className="pointer-events-auto rounded-lg border border-white/20 bg-black/60 px-3 py-2 text-xs disabled:opacity-50"
                    >
                      {isCalibratingYaw ? 'Calibrating…' : 'Calibrate'}
                    </button>
                  )}
                  {AR_DEBUG_PANELS_ENABLED && (
	                  <button
	                    type="button"
	                    onClick={() => setShowCalibration((prev) => !prev)}
	                    className="pointer-events-auto rounded-lg border border-white/20 bg-black/60 px-3 py-2 text-xs"
	                  >
	                    {showCalibration ? 'Hide settings' : 'Settings'}
	                  </button>
                  )}
                </>
              )}
	          </div>
	        </div>
        {showSettingsPanel && (
          <div className="pointer-events-auto rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-[11px] text-white/80">
            <div className="mb-2 flex items-center justify-between">
              <span>Calibration</span>
              <button type="button" onClick={handleResetCalibration} className="rounded border border-white/20 px-2 py-1">
                Reset
              </button>
            </div>
	            <button
	              type="button"
	              onClick={handleLevel}
	              className="mb-2 rounded border border-white/20 px-2 py-1"
	            >
	              Set horizon (pitch)
	            </button>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.12em] text-white/60">Lens presets</span>
	              <button
	                type="button"
	                onClick={() => {
                    if (zoomSupported) {
                      void applyZoomTarget(0.5, 'chip');
                    } else {
	                    setFovX(110);
	                    setFovY(80);
	                    setLensPreset('0.5x');
                      setProjectionSource('preset');
                    }
	                }}
                className="rounded border border-white/20 bg-white/10 px-2 py-1 text-[11px]"
              >
                0.5×
              </button>
	              <button
	                type="button"
	                onClick={() => {
                    if (zoomSupported) {
                      void applyZoomTarget(1, 'chip');
                    } else {
	                    setFovX(70);
	                    setFovY(45);
	                    setLensPreset('1x');
                      setProjectionSource('preset');
                    }
	                }}
                className="rounded border border-white/20 bg-white/10 px-2 py-1 text-[11px]"
              >
                1×
              </button>
	              <button
	                type="button"
	                onClick={() => {
                    if (zoomSupported) {
                      void applyZoomTarget(2, 'chip');
                    } else {
	                    setFovX(50);
	                    setFovY(35);
	                    setLensPreset('2x');
                      setProjectionSource('preset');
                    }
	                }}
                className="rounded border border-white/20 bg-white/10 px-2 py-1 text-[11px]"
              >
                2×
              </button>
	              <button
	                type="button"
	                onClick={() => {
                    if (zoomSupported) {
                      void applyZoomTarget(3, 'chip');
                    } else {
	                    setFovX(40);
	                    setFovY(30);
	                    setLensPreset('3x');
                      setProjectionSource('preset');
                    }
	                }}
                className="rounded border border-white/20 bg-white/10 px-2 py-1 text-[11px]"
              >
                3×
              </button>
            </div>
            <label className="flex items-center justify-between gap-3">
              <span>Horizontal FOV</span>
              <span>{Math.round(fovX)}°</span>
            </label>
            <input
              type="range"
              min={40}
              max={120}
              step={1}
              value={fovX}
	              onChange={(event) => {
	                setFovX(Number(event.target.value));
	                setLensPreset('custom');
                  setProjectionSource('preset');
	              }}
              className="w-full"
            />
            <label className="mt-2 flex items-center justify-between gap-3">
              <span>Vertical FOV</span>
              <span>{Math.round(fovY)}°</span>
            </label>
            <input
              type="range"
              min={30}
              max={90}
              step={1}
              value={fovY}
	              onChange={(event) => {
	                setFovY(Number(event.target.value));
	                setLensPreset('custom');
                  setProjectionSource('preset');
	              }}
              className="w-full"
            />
            {padBearing != null && heading != null && (
              <div className="mt-2 text-[10px] text-white/60">Yaw offset: {yawOffset.toFixed(1)}°</div>
            )}

            <div className="mt-3 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.12em] text-white/60">Display</div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="text-[11px] text-white/80">Flight plan milestones</div>
                <button
                  type="button"
                  onClick={() => setShowMilestones((prev) => !prev)}
                  className="rounded border border-white/20 bg-white/10 px-2 py-1 text-[11px]"
                >
                  {showMilestones ? 'On' : 'Off'}
                </button>
              </div>
            </div>

	            <div className="mt-3 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
	              <div className="text-[10px] uppercase tracking-[0.12em] text-white/60">Sensors</div>
	              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="text-[11px] text-white/80">Advanced sensor fusion (beta)</div>
                <button
                  type="button"
                  onClick={() => setAdvancedFusionEnabled((prev) => !prev)}
                  className="rounded border border-white/20 bg-white/10 px-2 py-1 text-[11px]"
                >
                  {advancedFusionEnabled ? 'On' : 'Off'}
                </button>
	              </div>
	              <div className="mt-1 text-[11px] text-white/60">Fuses gyroscope + compass for smoother heading.</div>
	            </div>

            <div className="mt-3 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.12em] text-white/60">Diagnostics</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const suffix = `${Date.now()}`.slice(-6);
                    downloadJsonFile(`ar-snapshot-${launchId.slice(0, 8)}-${suffix}.json`, {
                      schemaVersion: 1,
                      capturedAtIso: new Date().toISOString(),
                      launch: { id: launchId, name: launchName, net: typeof net === 'string' ? net : null },
                      pad: {
                        name: pad.name,
                        latitude: typeof pad.latitude === 'number' && Number.isFinite(pad.latitude) ? pad.latitude : null,
                        longitude: typeof pad.longitude === 'number' && Number.isFinite(pad.longitude) ? pad.longitude : null,
                        source: pad.source ?? null,
                        canonicalDeltaKm: typeof pad.canonicalDeltaKm === 'number' && Number.isFinite(pad.canonicalDeltaKm) ? pad.canonicalDeltaKm : null
                      },
                      sample: buildDiagnosticsSample()
                    });
                  }}
                  className="rounded border border-white/20 bg-white/10 px-2 py-1 text-[11px]"
                >
                  Download snapshot
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (traceRecording) stopAndDownloadTrace();
                    else setTraceRecording(true);
                  }}
                  className="rounded border border-white/20 bg-white/10 px-2 py-1 text-[11px]"
                >
                  {traceRecording ? 'Stop + download 60s trace' : 'Record 60s trace'}
                </button>
              </div>
              <div className="mt-1 text-[11px] text-white/60">
                Exports location + heading pipeline values for offline replay.
              </div>
            </div>

              {lockOnFeatureEnabled && (
                <div className="mt-3 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-white/60">Vision lock-on</div>
                    <div className="text-[10px] text-white/60">
                      {lockOnEnabled ? (lockOnAcquired ? 'Acquired' : lockOnAttempted ? 'Searching' : 'Standby') : 'Off'}
                    </div>
                  </div>
                  <div className="mt-1 text-[11px] text-white/60">
                    {AR_LOCK_ON_MANUAL_DEBUG_ENABLED
                      ? 'Manual debug controls enabled via NEXT_PUBLIC_AR_LOCK_ON_MANUAL_DEBUG=1.'
                      : 'Auto lock-on attempts start when camera and motion are ready.'}
                  </div>
                  {AR_LOCK_ON_MANUAL_DEBUG_ENABLED && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setLockOnEnabled((prev) => {
                            const next = !prev;
                            if (!next) markLockOnLost();
                            return next;
                          });
                        }}
                        className="rounded border border-white/20 bg-white/10 px-2 py-1 text-[11px]"
                      >
                        Tracker: {lockOnEnabled ? 'On' : 'Off'}
                      </button>
                      <button
                        type="button"
                        onClick={lockOnAcquired ? markLockOnLost : markLockOnAcquired}
                        className="rounded border border-white/20 bg-white/10 px-2 py-1 text-[11px]"
                      >
                        {lockOnAcquired ? 'Mark lock lost' : 'Mark lock acquired'}
                      </button>
                    </div>
                  )}
                  <div className="mt-2 text-[11px] text-white/60">
                    Time-to-lock: {lockOnTimeToLockBucket ?? 'pending'} • Losses: {lockOnLossCount}
                  </div>
                </div>
              )}

	            <div className="mt-3 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
	              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-[0.12em] text-white/60">WebXR AR</div>
                <div className="text-[10px] text-white/60">
                  {xrSupport === 'supported' ? (xrActive ? 'Active' : 'Supported') : 'Unavailable'}
                </div>
              </div>
              <div className="mt-1 text-[11px] text-white/60">
                Runtime: {runtimeDecision.poseMode} • Vision: {runtimeDecision.visionBackend}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="text-[11px] text-white/80">{runtimeDecision.reasons[0] ?? clientProfilePolicy.webxrHint}</div>
                <button
                  type="button"
                  onClick={() => {
                    if (xrActive) {
                      void stopWebXr();
                      return;
                    }
                    void startWebXr('manual');
                  }}
                  disabled={xrSupport !== 'supported'}
                  className="rounded border border-white/20 bg-white/10 px-2 py-1 text-[11px] disabled:opacity-50"
                >
                  {xrActive ? 'Exit' : 'Start (beta)'}
                </button>
              </div>
              {xrError && <div className="mt-2 text-[11px] text-red-300">{xrError}</div>}
            </div>
          </div>
        )}

        {showConfidenceInfo && (
          <div
            className="pointer-events-auto fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-6"
            role="dialog"
            aria-modal="true"
            aria-label="Trajectory confidence"
            onClick={() => setShowConfidenceInfo(false)}
          >
            <div
              className={`w-full max-w-md rounded-2xl border border-white/15 bg-black/85 px-4 py-3 text-white/90 ${
                effectiveReducedEffects ? '' : 'backdrop-blur'
              }`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-white/60">Trajectory confidence</div>
                  <div className="mt-1 text-sm font-semibold text-white">
                    {trajectoryEvidenceView?.evidenceLabel ?? 'Trajectory estimate'}
                  </div>
                  <div className="mt-0.5 text-[11px] text-white/70">
                    {trajectoryEvidenceView?.confidenceBadgeLabel ?? 'Confidence unknown'}
                    {trajectory?.confidenceTier ? ` • Tier ${trajectory.confidenceTier}` : ''}
                    {trajectory?.freshnessState ? ` • ${trajectory.freshnessState}` : ''}
                    {trajectory?.lineageComplete != null
                      ? ` • lineage ${trajectory.lineageComplete ? 'complete' : 'partial'}`
                      : ''}
                    {trajectory ? ` • ${formatTrajectoryAuthorityTierLabel(trajectory.authorityTier)}` : ''}
                    {trajectory ? ` • ${formatTrajectoryQualityStateLabel(trajectory.qualityState)}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowConfidenceInfo(false)}
                  className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] text-white/85"
                >
                  Close
                </button>
              </div>

              <div className="mt-3 space-y-1 text-[11px] text-white/80">
                <div>
                  <span className="text-white/90">Tier A:</span> Constraint-backed, fresh sources, full lineage.
                </div>
                <div>
                  <span className="text-white/90">Tier B:</span> Directional constraints present, but some completeness limits.
                </div>
                <div>
                  <span className="text-white/90">Tier C:</span> Best-effort corridor (templates/heuristics); widened uncertainty.
                </div>
                <div>
                  <span className="text-white/90">Tier D:</span> Pad only (no downrange track).
                </div>
              </div>

              {trajectory?.fieldProvenance && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-white/60">Direction</div>
                    <div className="mt-1 text-[11px] text-white/90">
                      {formatTrajectoryAuthorityTierLabel(trajectory.fieldProvenance.azimuth.authorityTier)} •{' '}
                      {formatTrajectoryFieldConfidenceLabel(trajectory.fieldProvenance.azimuth.confidenceLabel)}
                    </div>
                    <div className="mt-1 text-[11px] text-white/60">{trajectory.fieldProvenance.azimuth.summary}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-white/60">Altitude</div>
                    <div className="mt-1 text-[11px] text-white/90">
                      {formatTrajectoryAuthorityTierLabel(trajectory.fieldProvenance.altitude.authorityTier)} •{' '}
                      {formatTrajectoryFieldConfidenceLabel(trajectory.fieldProvenance.altitude.confidenceLabel)}
                    </div>
                    <div className="mt-1 text-[11px] text-white/60">{trajectory.fieldProvenance.altitude.summary}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-white/60">Milestones</div>
                    <div className="mt-1 text-[11px] text-white/90">
                      {formatTrajectoryAuthorityTierLabel(trajectory.fieldProvenance.milestones.authorityTier)} •{' '}
                      {formatTrajectoryFieldConfidenceLabel(trajectory.fieldProvenance.milestones.confidenceLabel)}
                    </div>
                    <div className="mt-1 text-[11px] text-white/60">{trajectory.fieldProvenance.milestones.summary}</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-white/60">Uncertainty</div>
                    <div className="mt-1 text-[11px] text-white/90">
                      {formatTrajectoryAuthorityTierLabel(trajectory.fieldProvenance.uncertainty.authorityTier)} •{' '}
                      {formatTrajectoryFieldConfidenceLabel(trajectory.fieldProvenance.uncertainty.confidenceLabel)}
                    </div>
                    <div className="mt-1 text-[11px] text-white/60">{trajectory.fieldProvenance.uncertainty.summary}</div>
                  </div>
                </div>
              )}

              {(trajectory?.safeModeActive || trajectoryCaveatLabels.length > 0) && (
                <div className="mt-3 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-white/60">Current limits</div>
                  {trajectory?.safeModeActive && (
                    <div className="mt-1 text-[11px] text-white/80">
                      Guidance is widened automatically instead of claiming precision.
                    </div>
                  )}
                  {trajectoryCaveatLabels.length > 0 && (
                    <div className="mt-1 text-[11px] text-white/60">{trajectoryCaveatLabels.join(' • ')}</div>
                  )}
                </div>
              )}

              <div className="mt-3 text-[11px] text-white/60">
                Use this as pointing guidance, not ground truth. Ascent can change after liftoff.
              </div>
            </div>
          </div>
        )}

        <ArBottomPanel
          mode={time.mode}
          primaryTimeLabel={time.countdownSec != null ? formatTMinus(time.countdownSec) : formatTPlus(time.tNowSec)}
          secondaryTimeLabel={
            time.mode === 'SCRUB'
              ? `Preview ${formatTPlus(time.tSelectedSec)}`
              : time.isBeforeLiftoff && !showManualCalibrationUi && displayTSec !== time.tSelectedSec
                ? `Preview ${formatTPlus(displayTSec)}`
                : null
          }
          onSelectLive={() => time.setMode('LIVE')}
          reducedEffects={effectiveReducedEffects}
          evidenceLabel={trajectoryEvidenceView?.evidenceLabel ?? null}
          confidenceBadgeLabel={trajectoryEvidenceView?.confidenceBadgeLabel ?? null}
          confidenceTier={trajectory?.confidenceTier ?? null}
          onOpenConfidenceInfo={() => setShowConfidenceInfo(true)}
          headingHint={headingHintLabel}
          pitchHint={pitchHintLabel}
          rollHint={rollHintLabel}
        />
      </div>
    </div>
  );
}

function formatArMilestoneProjectionReason(milestone: TrajectoryMilestonePayload) {
  switch (milestone.projectionReason) {
    case 'missing_track':
      return milestone.trackKind === 'booster_down' ? 'Awaiting booster-return track' : 'Track unavailable';
    case 'outside_track_horizon':
      return 'Outside current track horizon';
    case 'unresolved_time':
      return 'Time is source-only';
    case 'phase_not_projectable':
      return milestone.phase === 'prelaunch' ? 'Prelaunch timeline' : 'Shown off path';
    default:
      return milestone.phase === 'prelaunch' ? 'Prelaunch timeline' : 'Shown off path';
  }
}
