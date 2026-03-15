import ARKit
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

      Prop("enableSceneReconstruction", true) { (view: TmzArTrajectoryView, enabled: Bool) in
        view.enableSceneReconstruction = enabled
      }

      Prop("highResCaptureEnabled", false) { (view: TmzArTrajectoryView, enabled: Bool) in
        view.highResCaptureEnabled = enabled
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
