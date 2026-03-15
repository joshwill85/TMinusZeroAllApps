import { requireOptionalNativeModule } from 'expo-modules-core'
import TmzArTrajectoryView from './TmzArTrajectoryView'
import type { TmzArTrajectoryCapabilities, TmzArTrajectoryOrientationLock } from './TmzArTrajectory.types'

export type {
  TmzArTrajectoryCapabilities,
  TmzArTrajectoryGeoTrackingAccuracy,
  TmzArTrajectoryGeoTrackingState,
  TmzArTrajectoryOcclusionMode,
  TmzArTrajectoryError,
  TmzArTrajectoryErrorEvent,
  TmzArTrajectoryOrientationLock,
  TmzArTrajectoryPermissionState,
  TmzArTrajectoryQualityState,
  TmzArTrajectorySessionUpdate,
  TmzArTrajectorySessionUpdateEvent,
  TmzArTrajectorySessionState,
  TmzArTrajectoryTrackingState,
  TmzArTrajectoryViewProps,
  TmzArTrajectoryWorldAlignment,
  TmzArTrajectoryWorldMappingStatus
} from './TmzArTrajectory.types'

type TmzArTrajectoryNativeModule = {
  getCapabilitiesAsync(): Promise<TmzArTrajectoryCapabilities>
  lockOrientationAsync(orientation: TmzArTrajectoryOrientationLock): Promise<boolean>
  unlockOrientationAsync(): Promise<boolean>
}

const nativeModule = requireOptionalNativeModule<TmzArTrajectoryNativeModule>('TmzArTrajectory')

export { TmzArTrajectoryView }

function normalizeCapabilities(capabilities: Partial<TmzArTrajectoryCapabilities>): TmzArTrajectoryCapabilities {
  return {
    isSupported: capabilities.isSupported === true,
    lidarAvailable: capabilities.lidarAvailable === true,
    sceneDepthSupported: capabilities.sceneDepthSupported === true,
    sceneReconstructionSupported: capabilities.sceneReconstructionSupported === true,
    geoTrackingSupported: capabilities.geoTrackingSupported === true,
    highResCaptureSupported: capabilities.highResCaptureSupported === true,
    preferredWorldAlignment: capabilities.preferredWorldAlignment ?? 'gravity_and_heading',
    supportsWorldTracking: capabilities.supportsWorldTracking ?? capabilities.isSupported === true,
    supportsHeadingAlignment: capabilities.supportsHeadingAlignment ?? capabilities.isSupported === true,
    supportsSceneDepth: capabilities.supportsSceneDepth ?? capabilities.sceneDepthSupported === true,
    supportsSceneReconstruction: capabilities.supportsSceneReconstruction ?? capabilities.sceneReconstructionSupported === true,
    supportsGeoTracking: capabilities.supportsGeoTracking ?? capabilities.geoTrackingSupported === true,
    supportsHighResolutionFrameCapture:
      capabilities.supportsHighResolutionFrameCapture ?? capabilities.highResCaptureSupported === true,
    reason: capabilities.reason ?? (capabilities.isSupported === false ? 'The native AR trajectory module is not available on this device.' : null)
  }
}

export async function getCapabilitiesAsync() {
  if (!nativeModule) {
    return normalizeCapabilities({
      isSupported: false,
      lidarAvailable: false,
      sceneDepthSupported: false,
      sceneReconstructionSupported: false,
      geoTrackingSupported: false,
      highResCaptureSupported: false,
      preferredWorldAlignment: 'gravity_and_heading',
      reason: 'The native AR trajectory module is not available on this platform.'
    })
  }

  return normalizeCapabilities(await nativeModule.getCapabilitiesAsync())
}

export async function lockOrientationAsync(orientation: TmzArTrajectoryOrientationLock) {
  if (!nativeModule?.lockOrientationAsync) {
    return false
  }

  return nativeModule.lockOrientationAsync(orientation)
}

export async function unlockOrientationAsync() {
  if (!nativeModule?.unlockOrientationAsync) {
    return false
  }

  return nativeModule.unlockOrientationAsync()
}

export const getTmzArTrajectoryCapabilitiesAsync = getCapabilitiesAsync

export default nativeModule
