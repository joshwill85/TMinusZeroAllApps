import ARKit
import AVFoundation
import ExpoModulesCore

public final class TmzArTrajectoryModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TmzArTrajectory")

    AsyncFunction("getCapabilitiesAsync") { () -> [String: Any] in
      let worldTrackingSupported = ARWorldTrackingConfiguration.isSupported
      let sceneDepthSupported = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
      let sceneReconstructionSupported = ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)
      let geoTrackingSupported = ARGeoTrackingConfiguration.isSupported
      let supportsHighResolutionCapture = ARWorldTrackingConfiguration.supportedVideoFormats.contains { format in
        let maxDimension = max(format.imageResolution.width, format.imageResolution.height)
        return maxDimension >= 3_840
      }
      var supportsZoom = false
      var minZoomRatio = 1.0
      var maxZoomRatio = 1.0
      var defaultZoomRatio = 1.0

      if #available(iOS 16.0, *) {
        if let captureDevice = ARWorldTrackingConfiguration.configurableCaptureDeviceForPrimaryCamera {
          let minAvailable = max(0.5, Double(captureDevice.minAvailableVideoZoomFactor))
          let maxAvailable = min(3.0, Double(captureDevice.maxAvailableVideoZoomFactor))
          supportsZoom = maxAvailable > minAvailable + 0.01
          minZoomRatio = minAvailable
          maxZoomRatio = maxAvailable
          defaultZoomRatio = Double(captureDevice.videoZoomFactor)
        }
      }

      return [
        "isSupported": worldTrackingSupported,
        "lidarAvailable": sceneDepthSupported || sceneReconstructionSupported,
        "sceneDepthSupported": sceneDepthSupported,
        "sceneReconstructionSupported": sceneReconstructionSupported,
        "geoTrackingSupported": geoTrackingSupported,
        "highResCaptureSupported": supportsHighResolutionCapture,
        "preferredWorldAlignment": "gravity_and_heading",
        "supportsWorldTracking": worldTrackingSupported,
        "supportsHeadingAlignment": worldTrackingSupported,
        "supportsSceneDepth": sceneDepthSupported,
        "supportsSceneReconstruction": sceneReconstructionSupported,
        "supportsGeoTracking": geoTrackingSupported,
        "supportsHighResolutionFrameCapture": supportsHighResolutionCapture,
        "supportsZoom": supportsZoom,
        "minZoomRatio": minZoomRatio,
        "maxZoomRatio": maxZoomRatio,
        "defaultZoomRatio": defaultZoomRatio,
        "reason": worldTrackingSupported ? NSNull() : "ARKit world tracking is unavailable on this iPhone."
      ]
    }

    AsyncFunction("lockOrientationAsync") { (orientation: String) -> Bool in
      return TmzArTrajectoryOrientationController.shared.lock(orientation: orientation)
    }

    AsyncFunction("unlockOrientationAsync") { () -> Bool in
      return TmzArTrajectoryOrientationController.shared.unlock()
    }

    View(TmzArTrajectoryView.self) {
      Events("onSessionStateChange", "onSessionUpdate", "onSessionError")

      Prop("trajectoryJson") { (view: TmzArTrajectoryView, trajectoryJson: String) in
        view.trajectoryJson = trajectoryJson
      }

      Prop("qualityState") { (view: TmzArTrajectoryView, qualityState: String?) in
        view.qualityState = qualityState
      }

      Prop("worldAlignment", "gravity_and_heading") { (view: TmzArTrajectoryView, worldAlignment: String) in
        view.worldAlignmentPreference = worldAlignment
      }

      Prop("enableSceneDepth", true) { (view: TmzArTrajectoryView, enabled: Bool) in
        view.enableSceneDepth = enabled
      }

      Prop("enableSceneReconstruction", false) { (view: TmzArTrajectoryView, enabled: Bool) in
        view.enableSceneReconstruction = enabled
      }

      Prop("highResCaptureEnabled", false) { (view: TmzArTrajectoryView, enabled: Bool) in
        view.highResCaptureEnabled = enabled
      }

      Prop("enablePinchZoom", true) { (view: TmzArTrajectoryView, enabled: Bool) in
        view.enablePinchZoom = enabled
      }

      Prop("targetZoomRatio") { (view: TmzArTrajectoryView, zoomRatio: Double?) in
        view.targetZoomRatio = zoomRatio
      }

      Prop("activeTPlusSec") { (view: TmzArTrajectoryView, activeTPlusSec: Double?) in
        view.activeTPlusSec = activeTPlusSec
      }

      Prop("sessionActive", true) { (view: TmzArTrajectoryView, active: Bool) in
        view.sessionActive = active
      }

      Prop("showDebugStatistics", false) { (view: TmzArTrajectoryView, enabled: Bool) in
        view.showDebugStatistics = enabled
      }

      OnViewDidUpdateProps { view in
        view.onPropsUpdated()
      }
    }
  }
}
