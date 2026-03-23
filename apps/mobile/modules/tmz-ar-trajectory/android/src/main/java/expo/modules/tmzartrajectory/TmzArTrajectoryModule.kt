package expo.modules.tmzartrajectory

import android.content.Context
import com.google.ar.core.Session
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TmzArTrajectoryModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TmzArTrajectory")

    AsyncFunction("getCapabilitiesAsync") {
      val context = appContext.currentActivity?.applicationContext ?: appContext.reactContext ?: return@AsyncFunction mapOf(
        "isSupported" to false,
        "lidarAvailable" to false,
        "sceneDepthSupported" to false,
        "sceneReconstructionSupported" to false,
        "geoTrackingSupported" to false,
        "highResCaptureSupported" to false,
        "preferredWorldAlignment" to "camera",
        "supportsWorldTracking" to false,
        "supportsHeadingAlignment" to false,
        "supportsSceneDepth" to false,
        "supportsSceneReconstruction" to false,
        "supportsGeoTracking" to false,
        "supportsHighResolutionFrameCapture" to false,
        "supportsZoom" to false,
        "minZoomRatio" to 1.0,
        "maxZoomRatio" to 1.0,
        "defaultZoomRatio" to 1.0,
        "reason" to "Android context is unavailable for capability probing."
      )

      buildCapabilities(context)
    }

    AsyncFunction("lockOrientationAsync") { orientation: String ->
      val activity = appContext.currentActivity ?: return@AsyncFunction false
      TmzArTrajectoryOrientationController.lock(activity, orientation)
    }

    AsyncFunction("unlockOrientationAsync") {
      val activity = appContext.currentActivity ?: return@AsyncFunction false
      TmzArTrajectoryOrientationController.unlock(activity)
    }

    View(TmzArTrajectoryView::class) {
      Events("onSessionStateChange", "onSessionUpdate", "onSessionError")

      Prop("trajectoryJson") { view: TmzArTrajectoryView, trajectoryJson: String ->
        view.trajectoryJson = trajectoryJson
      }

      Prop("qualityState") { view: TmzArTrajectoryView, qualityState: String? ->
        view.qualityState = qualityState
      }

      Prop("worldAlignment", "gravity_and_heading") { view: TmzArTrajectoryView, worldAlignment: String ->
        view.worldAlignmentPreference = worldAlignment
      }

      Prop("enableSceneDepth", true) { view: TmzArTrajectoryView, enabled: Boolean ->
        view.enableSceneDepth = enabled
      }

      Prop("enableSceneReconstruction", true) { view: TmzArTrajectoryView, enabled: Boolean ->
        view.enableSceneReconstruction = enabled
      }

      Prop("highResCaptureEnabled", false) { view: TmzArTrajectoryView, enabled: Boolean ->
        view.highResCaptureEnabled = enabled
      }

      Prop("enablePinchZoom", true) { view: TmzArTrajectoryView, enabled: Boolean ->
        view.enablePinchZoom = enabled
      }

      Prop("targetZoomRatio") { view: TmzArTrajectoryView, zoomRatio: Double? ->
        view.targetZoomRatio = zoomRatio
      }

      Prop("showDebugStatistics", false) { view: TmzArTrajectoryView, enabled: Boolean ->
        view.showDebugStatistics = enabled
      }

      OnViewDidUpdateProps { view ->
        view.onPropsUpdated()
      }

      OnViewDestroys { view ->
        view.teardown()
      }
    }
  }

  private fun buildCapabilities(context: Context): Map<String, Any?> {
    val cameraInfo = TmzArTrajectoryCameraInfo.resolve(context)
    val supportsNativeAr = cameraInfo.hasBackCamera
    val arCoreSupported = try {
      Session.isSupported(context) && cameraInfo.hasArFeature
    } catch (_: Throwable) {
      false
    }
    val supportsWorldTracking = supportsNativeAr && arCoreSupported
    val supportsHeadingAlignment = false
    val preferredWorldAlignment = if (supportsWorldTracking) "gravity" else "camera"

    return mapOf(
      "isSupported" to supportsNativeAr,
      "lidarAvailable" to false,
      "sceneDepthSupported" to false,
      "sceneReconstructionSupported" to false,
      "geoTrackingSupported" to false,
      "highResCaptureSupported" to false,
      "preferredWorldAlignment" to preferredWorldAlignment,
      "supportsWorldTracking" to supportsWorldTracking,
      "supportsHeadingAlignment" to supportsHeadingAlignment,
      "supportsSceneDepth" to false,
      "supportsSceneReconstruction" to false,
      "supportsGeoTracking" to false,
      "supportsHighResolutionFrameCapture" to false,
      "supportsZoom" to cameraInfo.supportsZoom,
      "minZoomRatio" to cameraInfo.minZoomRatio,
      "maxZoomRatio" to cameraInfo.maxZoomRatio,
      "defaultZoomRatio" to cameraInfo.defaultZoomRatio,
      "reason" to when {
        supportsWorldTracking -> null
        supportsNativeAr -> "Android native AR trajectory is running camera-guidance mode because ARCore world tracking is unavailable."
        !cameraInfo.hasBackCamera -> "A back camera is required for Android native AR trajectory."
        else -> "Android native AR trajectory is unavailable on this device."
      }
    )
  }
}
