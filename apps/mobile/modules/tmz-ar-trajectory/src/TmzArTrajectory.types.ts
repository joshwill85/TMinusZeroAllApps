import type { NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native'

export type TmzArTrajectoryQualityState = 'precision' | 'safe_corridor' | 'pad_only'
export type TmzArTrajectoryTrackingState = 'not_available' | 'limited' | 'normal'
export type TmzArTrajectoryWorldAlignment = 'gravity' | 'gravity_and_heading' | 'camera'
export type TmzArTrajectoryWorldMappingStatus = 'not_available' | 'limited' | 'extending' | 'mapped'
export type TmzArTrajectoryGeoTrackingState = 'not_available' | 'initializing' | 'localizing' | 'localized'
export type TmzArTrajectoryGeoTrackingAccuracy = 'unknown' | 'low' | 'medium' | 'high'
export type TmzArTrajectoryOcclusionMode = 'none' | 'scene_depth' | 'mesh'
export type TmzArTrajectoryPermissionState = 'granted' | 'denied' | 'prompt' | 'error'
export type TmzArTrajectoryOrientationLock = 'portrait' | 'landscape' | 'all'
export type TmzArTrajectoryZoomControlPath = 'native_camera' | 'track_constraints' | 'preset_fallback' | 'unsupported'
export type TmzArTrajectoryProjectionSource = 'intrinsics_frame' | 'projection_matrix' | 'inferred_fov' | 'preset'
export type TmzArTrajectoryHeadingSource = 'arkit_world' | 'core_location_heading' | 'unknown'
export type TmzArTrajectoryPoseSource = 'arkit_world_tracking' | 'deviceorientation'
export type TmzArTrajectoryPoseMode = 'arkit_world_tracking' | 'sensor_fused'
export type TmzArTrajectoryVisionBackend = 'vision_native' | 'none'

export type TmzArTrajectoryCapabilities = {
  isSupported: boolean
  lidarAvailable: boolean
  sceneDepthSupported: boolean
  sceneReconstructionSupported: boolean
  geoTrackingSupported: boolean
  highResCaptureSupported: boolean
  preferredWorldAlignment: TmzArTrajectoryWorldAlignment
  supportsWorldTracking: boolean
  supportsHeadingAlignment: boolean
  supportsSceneDepth: boolean
  supportsSceneReconstruction: boolean
  supportsGeoTracking: boolean
  supportsHighResolutionFrameCapture: boolean
  supportsZoom: boolean
  minZoomRatio: number
  maxZoomRatio: number
  defaultZoomRatio: number
  reason: string | null
}

export type TmzArTrajectorySessionUpdate = {
  sessionRunning: boolean
  trackingState: TmzArTrajectoryTrackingState
  trackingReason: string | null
  worldAlignment: TmzArTrajectoryWorldAlignment
  worldMappingStatus: TmzArTrajectoryWorldMappingStatus
  lidarAvailable: boolean
  sceneDepthEnabled: boolean
  sceneReconstructionEnabled: boolean
  geoTrackingState: TmzArTrajectoryGeoTrackingState
  geoTrackingAccuracy: TmzArTrajectoryGeoTrackingAccuracy
  occlusionMode: TmzArTrajectoryOcclusionMode
  relocalizationCount: number
  renderLoopRunning: boolean
  highResCaptureAttempted: boolean
  highResCaptureSucceeded: boolean
  hasTrajectory: boolean
  qualityState: TmzArTrajectoryQualityState | null
  sampleCount: number
  milestoneCount: number
  zoomSupported: boolean
  zoomRatio: number
  zoomRangeMin: number
  zoomRangeMax: number
  zoomControlPath: TmzArTrajectoryZoomControlPath
  projectionSource: TmzArTrajectoryProjectionSource
  cameraPermission?: TmzArTrajectoryPermissionState
  motionPermission?: TmzArTrajectoryPermissionState
  locationPermission?: TmzArTrajectoryPermissionState
  headingSource?: TmzArTrajectoryHeadingSource
  poseSource?: TmzArTrajectoryPoseSource
  poseMode?: TmzArTrajectoryPoseMode
  visionBackend?: TmzArTrajectoryVisionBackend
  zoomRatioBucket?: string
  zoomApplyLatencyBucket?: string
  zoomProjectionSyncLatencyBucket?: string
  lastUpdatedAt: string
}

export type TmzArTrajectorySessionState = TmzArTrajectorySessionUpdate & {
  status: 'initializing' | 'running' | 'unsupported' | 'failed'
  cameraPermission: TmzArTrajectoryPermissionState
  motionPermission: TmzArTrajectoryPermissionState
  locationPermission: TmzArTrajectoryPermissionState
  locationAccuracy: 'full' | 'reduced' | 'unknown'
  message: string | null
  retryCount: number
}

export type TmzArTrajectoryError = {
  code: string
  message: string
  recoverable: boolean
}

export type TmzArTrajectorySessionUpdateEvent = NativeSyntheticEvent<TmzArTrajectorySessionUpdate>
export type TmzArTrajectoryErrorEvent = NativeSyntheticEvent<TmzArTrajectoryError>

export type TmzArTrajectoryViewProps = {
  style?: StyleProp<ViewStyle>
  trajectoryJson: string
  qualityState?: TmzArTrajectoryQualityState | null
  worldAlignment?: TmzArTrajectoryWorldAlignment
  enableSceneDepth?: boolean
  enableSceneReconstruction?: boolean
  highResCaptureEnabled?: boolean
  enablePinchZoom?: boolean
  targetZoomRatio?: number
  showDebugStatistics?: boolean
  onSessionUpdate?: (event: TmzArTrajectorySessionUpdateEvent) => void
  onSessionError?: (event: TmzArTrajectoryErrorEvent) => void
  onSessionStateChange?: (event: NativeSyntheticEvent<TmzArTrajectorySessionState>) => void
}
