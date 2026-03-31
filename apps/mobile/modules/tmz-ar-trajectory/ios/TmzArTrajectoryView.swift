import ARKit
import AVFoundation
import CoreLocation
import ExpoModulesCore
import RealityKit
import simd
import UIKit

internal final class TmzArTrajectoryView: ExpoView, ARSessionDelegate, CLLocationManagerDelegate, UIGestureRecognizerDelegate {
  let onSessionStateChange = EventDispatcher()
  let onSessionUpdate = EventDispatcher()
  let onSessionError = EventDispatcher()

  var trajectoryJson = ""
  var qualityState: String?
  var worldAlignmentPreference = "gravity_and_heading"
  var enableSceneDepth = true
  var enableSceneReconstruction = false
  var highResCaptureEnabled = false
  var enablePinchZoom = true
  var targetZoomRatio: Double?
  var activeTPlusSec: Double?
  var sessionActive = true
  var showDebugStatistics = false

  private let arView: ARView
  private let rootAnchor = AnchorEntity(world: .zero)
  private let staticTrackContainer = Entity()
  private let dynamicOverlayContainer = Entity()
  private let locationManager = CLLocationManager()

  private var parsedTrajectory: TmzTrajectoryPayload?
  private var lastParsedTrajectoryJson: String?
  private var viewerLocation: CLLocation?
  private var locationUpdatesRunning = false
  private var lastLocationRequestStartedAt: CFAbsoluteTime?
  private var didStartSession = false
  private var isSessionRunning = false
  private var status: String = "initializing"
  private var statusMessage: String?
  private var trackingState: String = "not_available"
  private var trackingReason: String?
  private var worldAlignment: String = "gravity_and_heading"
  private var worldMappingStatus: String = "not_available"
  private var sceneDepthEnabled = false
  private var sceneReconstructionEnabled = false
  private var occlusionMode: String = "none"
  private var relocalizationCount = 0
  private var retryCount = 0
  private var highResCaptureAttempted = false
  private var highResCaptureSucceeded = false
  private var cameraPermission: String = "prompt"
  private var motionPermission: String = "not_applicable"
  private var locationPermission: String = "prompt"
  private var locationAccuracy: String = "unknown"
  private var locationFixState: String = "unavailable"
  private var geoTrackingStateValue: String = "not_available"
  private var geoTrackingAccuracyValue: String = "unknown"
  private var geoTrackingAvailabilityKnown = false
  private var geoTrackingAvailableAtLocation = false
  private var geoTrackingAvailabilityCoordinateSignature: String?
  private var geoTrackingAvailabilityRequestId = 0
  private var usingGeoTrackingConfiguration = false
  private var zoomSupported = false
  private var zoomRatio: Double = 1.0
  private var zoomRangeMin: Double = 1.0
  private var zoomRangeMax: Double = 1.0
  private var zoomControlPath: String = "unsupported"
  private var projectionSource: String = "projection_matrix"
  private var pinchZoomStartRatio: Double = 1.0
  private var lastZoomApplyAt = CFAbsoluteTimeGetCurrent()
  private var lastZoomApplyLatencyMs: Double = 0
  private var lastZoomProjectionSyncLatencyMs: Double = 0
  private var pendingZoomApplyStartedAt: CFAbsoluteTime?
  private var lastSessionConfigFingerprint: String?
  private var lastStaticRenderFingerprint: String?
  private var lastDynamicRenderFingerprint: String?
  private var lastPayloadFingerprint: String?
  private var lastSessionUpdateEmission = CFAbsoluteTimeGetCurrent()
  private var renderedTracks: [RenderedTrack] = []
  private var projectedMilestones: [ProjectedMilestonePlacement] = []

  required init(appContext: AppContext? = nil) {
    arView = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
    super.init(appContext: appContext)

    backgroundColor = .black
    clipsToBounds = true

    arView.translatesAutoresizingMaskIntoConstraints = false
    arView.automaticallyConfigureSession = false
    arView.renderOptions.insert(.disableMotionBlur)
    arView.session.delegate = self
    arView.scene.addAnchor(rootAnchor)
    rootAnchor.addChild(staticTrackContainer)
    rootAnchor.addChild(dynamicOverlayContainer)

    let pinchRecognizer = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
    pinchRecognizer.cancelsTouchesInView = false
    pinchRecognizer.delegate = self
    arView.addGestureRecognizer(pinchRecognizer)

    addSubview(arView)
    NSLayoutConstraint.activate([
      arView.leadingAnchor.constraint(equalTo: leadingAnchor),
      arView.trailingAnchor.constraint(equalTo: trailingAnchor),
      arView.topAnchor.constraint(equalTo: topAnchor),
      arView.bottomAnchor.constraint(equalTo: bottomAnchor)
    ])

    locationManager.delegate = self
    locationManager.desiredAccuracy = kCLLocationAccuracyBest
    locationManager.distanceFilter = 5
    if CLLocationManager.headingAvailable() {
      locationManager.headingFilter = 5
    }

    refreshLocationAuthorization()
    requestCameraAccessIfNeeded()
    emitSessionState()
  }

  deinit {
    teardown()
  }

  func onPropsUpdated() {
    arView.debugOptions = showDebugStatistics ? [.showWorldOrigin, .showFeaturePoints] : []
    highResCaptureAttempted = false
    highResCaptureSucceeded = false

    let trajectoryChanged = parseTrajectoryIfNeeded()
    refreshLocationAuthorization()
    refreshGeoTrackingAvailabilityIfNeeded()
    syncLocationUpdatesIfNeeded()
    syncSessionLifecycle(forceConfiguration: trajectoryChanged)
    refreshZoomSupportAndBounds()
    applyTargetZoomIfNeeded()
    rebuildTrajectoryEntitiesIfNeeded(force: trajectoryChanged)
    emitSessionState()
  }

  func teardown() {
    pauseSessionIfNeeded()
    stopLocationUpdates()
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    status = "failed"
    statusMessage = error.localizedDescription
    trackingState = "not_available"
    isSessionRunning = false
    emitError(code: "session_failed", message: error.localizedDescription, recoverable: true)
    emitSessionState()
  }

  func sessionWasInterrupted(_ session: ARSession) {
    status = "initializing"
    statusMessage = "AR session interrupted. Reacquire the scene slowly."
    retryCount += 1
    isSessionRunning = false
    emitError(code: "session_interrupted", message: "The AR session was interrupted.", recoverable: true)
    emitSessionState()
  }

  func sessionInterruptionEnded(_ session: ARSession) {
    relocalizationCount += 1
    retryCount += 1
    status = "initializing"
    statusMessage = "AR session resumed. Rebuilding tracking."
    syncSessionLifecycle(forceConfiguration: true, resetTracking: true)
    emitSessionState()
  }

  func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
    trackingState = mapTrackingState(camera.trackingState)
    trackingReason = mapTrackingReason(camera.trackingState)
    if trackingState == "normal" {
      status = alignmentReady ? "running" : "initializing"
      statusMessage = runningMessage()
    } else if trackingState == "limited" {
      status = "initializing"
      statusMessage = limitedTrackingMessage(reason: trackingReason)
    } else {
      status = "initializing"
      statusMessage = "Move slowly while ARKit builds the world map."
    }
    emitSessionState()
  }

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    DispatchQueue.main.async { [weak self] in
      guard let self else {
        return
      }
      let translation = frame.camera.transform.translation
      self.rootAnchor.position = translation
      self.worldMappingStatus = self.mapWorldMappingStatus(frame.worldMappingStatus)
      self.projectionSource = "projection_matrix"
      if let startedAt = self.pendingZoomApplyStartedAt {
        let now = CFAbsoluteTimeGetCurrent()
        self.lastZoomProjectionSyncLatencyMs = max(0, (now - startedAt) * 1_000)
        self.pendingZoomApplyStartedAt = nil
      }
      self.refreshZoomSupportAndBounds()
      self.emitSessionState()
    }
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    refreshLocationAuthorization()
    refreshGeoTrackingAvailabilityIfNeeded(force: true)
    syncLocationUpdatesIfNeeded()
    rebuildTrajectoryEntitiesIfNeeded(force: true)
    emitSessionState()
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let latestLocation = locations.last else {
      return
    }
    viewerLocation = latestLocation
    updateLocationFixState()
    refreshGeoTrackingAvailabilityIfNeeded()
    rebuildTrajectoryEntitiesIfNeeded(force: true)
    if trackingState == "normal" {
      statusMessage = runningMessage()
    }
    emitSessionState()
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    if locationPermission == "granted" {
      updateLocationFixState()
      refreshGeoTrackingAvailabilityIfNeeded(force: true)
      statusMessage = error.localizedDescription
    }
    emitSessionState()
  }

  func session(_ session: ARSession, didChange geoTrackingStatus: ARGeoTrackingStatus) {
    geoTrackingStateValue = mapGeoTrackingState(geoTrackingStatus.state)
    geoTrackingAccuracyValue = mapGeoTrackingAccuracy(geoTrackingStatus.accuracy)
    if usingGeoTrackingConfiguration && geoTrackingStateValue == "not_available" {
      geoTrackingAvailabilityKnown = true
      geoTrackingAvailableAtLocation = false
      usingGeoTrackingConfiguration = false
      syncSessionLifecycle(forceConfiguration: true)
    }
    rebuildTrajectoryEntitiesIfNeeded(force: true)
    if trackingState == "normal" {
      status = alignmentReady ? "running" : "initializing"
      statusMessage = runningMessage()
    }
    emitSessionState()
  }

  @objc
  private func handlePinch(_ gesture: UIPinchGestureRecognizer) {
    guard enablePinchZoom, zoomSupported else {
      return
    }

    switch gesture.state {
    case .began:
      pinchZoomStartRatio = zoomRatio
    case .changed:
      let targetRatio = clampZoomRatio(pinchZoomStartRatio * Double(gesture.scale))
      _ = applyZoom(to: targetRatio, reason: "pinch")
    case .ended, .cancelled, .failed:
      pinchZoomStartRatio = zoomRatio
    default:
      break
    }
  }

  private func requestCameraAccessIfNeeded() {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      cameraPermission = "granted"
      syncSessionLifecycle(forceConfiguration: true)
    case .notDetermined:
      cameraPermission = "prompt"
      AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
        DispatchQueue.main.async {
          guard let self else {
            return
          }
          self.cameraPermission = granted ? "granted" : "denied"
          if granted {
            self.syncSessionLifecycle(forceConfiguration: true)
          } else {
            self.status = "unsupported"
            self.statusMessage = "Camera access is required for native AR trajectory."
            self.emitError(code: "camera_denied", message: "Camera access is required for native AR trajectory.", recoverable: false)
          }
          self.emitSessionState()
        }
      }
    case .denied, .restricted:
      cameraPermission = "denied"
      status = "unsupported"
      statusMessage = "Camera access is required for native AR trajectory."
      emitError(code: "camera_denied", message: "Camera access is required for native AR trajectory.", recoverable: false)
    @unknown default:
      cameraPermission = "error"
      status = "failed"
      statusMessage = "Unable to determine camera permission state."
      emitError(code: "camera_permission_error", message: "Unable to determine camera permission state.", recoverable: false)
    }
  }

  private func refreshLocationAuthorization() {
    let authorizationStatus = locationManager.authorizationStatus
    switch authorizationStatus {
    case .authorizedAlways, .authorizedWhenInUse:
      locationPermission = "granted"
      if #available(iOS 14.0, *) {
        locationAccuracy = locationManager.accuracyAuthorization == .fullAccuracy ? "full" : "reduced"
      } else {
        locationAccuracy = "unknown"
      }
      updateLocationFixState()
    case .notDetermined:
      locationPermission = "prompt"
      locationAccuracy = "unknown"
      locationFixState = "acquiring"
      locationManager.requestWhenInUseAuthorization()
    case .denied, .restricted:
      locationPermission = "denied"
      locationAccuracy = "unknown"
      locationFixState = "unavailable"
      if statusMessage == nil || status == "running" {
        statusMessage = "Location access is required to align the trajectory with the launch site."
      }
      emitError(code: "location_denied", message: "Location access is required to align the trajectory with the launch site.", recoverable: true)
    @unknown default:
      locationPermission = "error"
      locationAccuracy = "unknown"
      locationFixState = "unavailable"
    }
  }

  private func refreshGeoTrackingAvailabilityIfNeeded(force: Bool = false) {
    guard #available(iOS 14.0, *), ARGeoTrackingConfiguration.isSupported else {
      geoTrackingAvailabilityKnown = false
      geoTrackingAvailableAtLocation = false
      geoTrackingStateValue = "not_available"
      geoTrackingAccuracyValue = "unknown"
      usingGeoTrackingConfiguration = false
      return
    }

    guard locationPermission == "granted", locationAccuracy == "full", let viewerLocation else {
      geoTrackingAvailabilityKnown = false
      geoTrackingAvailableAtLocation = false
      geoTrackingStateValue = "not_available"
      geoTrackingAccuracyValue = "unknown"
      usingGeoTrackingConfiguration = false
      return
    }

    let coordinateSignature = [
      String(format: "%.3f", viewerLocation.coordinate.latitude),
      String(format: "%.3f", viewerLocation.coordinate.longitude)
    ].joined(separator: ",")

    guard force || !geoTrackingAvailabilityKnown || geoTrackingAvailabilityCoordinateSignature != coordinateSignature else {
      return
    }

    geoTrackingAvailabilityCoordinateSignature = coordinateSignature
    geoTrackingAvailabilityKnown = false
    geoTrackingStateValue = usingGeoTrackingConfiguration ? geoTrackingStateValue : "initializing"
    geoTrackingAccuracyValue = "unknown"

    geoTrackingAvailabilityRequestId += 1
    let requestId = geoTrackingAvailabilityRequestId
    let coordinate = viewerLocation.coordinate

    ARGeoTrackingConfiguration.checkAvailability(at: coordinate) { [weak self] isAvailable, _ in
      DispatchQueue.main.async {
        guard let self, self.geoTrackingAvailabilityRequestId == requestId else {
          return
        }
        self.geoTrackingAvailabilityKnown = true
        self.geoTrackingAvailableAtLocation = isAvailable
        if !isAvailable {
          self.geoTrackingStateValue = "not_available"
          self.geoTrackingAccuracyValue = "unknown"
          self.usingGeoTrackingConfiguration = false
        }
        self.syncSessionLifecycle(forceConfiguration: true)
        self.rebuildTrajectoryEntitiesIfNeeded(force: true)
        self.emitSessionState()
      }
    }
  }

  private func parseTrajectoryIfNeeded() -> Bool {
    guard trajectoryJson != lastParsedTrajectoryJson else {
      return false
    }

    lastParsedTrajectoryJson = trajectoryJson
    lastStaticRenderFingerprint = nil
    lastDynamicRenderFingerprint = nil
    renderedTracks.removeAll()
    projectedMilestones.removeAll()

    guard !trajectoryJson.isEmpty else {
      parsedTrajectory = nil
      statusMessage = "Loading trajectory package."
      return true
    }

    guard let data = trajectoryJson.data(using: .utf8) else {
      parsedTrajectory = nil
      status = "failed"
      statusMessage = "The trajectory payload was not valid UTF-8."
      return true
    }

    do {
      parsedTrajectory = try JSONDecoder().decode(TmzTrajectoryPayload.self, from: data)
      if status == "failed" {
        status = "initializing"
      }
      if statusMessage == nil {
        statusMessage = "Move slowly while the AR session stabilizes."
      }
    } catch {
      parsedTrajectory = nil
      status = "failed"
      statusMessage = "Unable to decode the trajectory payload."
    }

    return true
  }

  private func syncSessionLifecycle(forceConfiguration: Bool, resetTracking: Bool = false) {
    guard ARWorldTrackingConfiguration.isSupported else {
      status = "unsupported"
      statusMessage = "ARKit world tracking is unavailable on this iPhone."
      emitError(code: "unsupported", message: "ARKit world tracking is unavailable on this iPhone.", recoverable: false)
      emitSessionState()
      return
    }

    guard sessionActive else {
      pauseSessionIfNeeded()
      status = cameraPermission == "granted" ? "initializing" : status
      statusMessage = cameraPermission == "granted" ? "AR session paused until the screen becomes active again." : statusMessage
      emitSessionState()
      return
    }

    guard cameraPermission == "granted" else {
      pauseSessionIfNeeded()
      emitSessionState()
      return
    }

    applySessionConfigurationIfNeeded(force: forceConfiguration, resetTracking: resetTracking || !didStartSession)
  }

  private func shouldUseGeoTrackingConfiguration() -> Bool {
    guard #available(iOS 14.0, *), ARGeoTrackingConfiguration.isSupported else {
      return false
    }
    guard locationPermission == "granted", locationAccuracy == "full", locationFixState == "ready" else {
      return false
    }
    return geoTrackingAvailabilityKnown && geoTrackingAvailableAtLocation
  }

  private func applySessionConfigurationIfNeeded(force: Bool, resetTracking: Bool) {
    let useGeoTrackingConfiguration = shouldUseGeoTrackingConfiguration()
    let configurationFingerprint = [
      worldAlignmentPreference,
      useGeoTrackingConfiguration ? "geo" : "world",
      enableSceneDepth ? "1" : "0",
      enableSceneReconstruction ? "1" : "0"
    ].joined(separator: "|")

    guard force || !isSessionRunning || configurationFingerprint != lastSessionConfigFingerprint else {
      return
    }

    sceneDepthEnabled = false
    sceneReconstructionEnabled = false
    occlusionMode = "none"

    let configuration: ARConfiguration
    if useGeoTrackingConfiguration, #available(iOS 14.0, *) {
      configuration = ARGeoTrackingConfiguration()
      worldAlignment = "gravity_and_heading"
      geoTrackingStateValue = geoTrackingStateValue == "localized" ? geoTrackingStateValue : "initializing"
      geoTrackingAccuracyValue = geoTrackingStateValue == "localized" ? geoTrackingAccuracyValue : "unknown"
      usingGeoTrackingConfiguration = true
    } else {
      let worldConfiguration = ARWorldTrackingConfiguration()
      worldConfiguration.worldAlignment = worldAlignmentPreference == "gravity" ? .gravity : .gravityAndHeading
      worldAlignment = worldAlignmentPreference == "gravity" ? "gravity" : "gravity_and_heading"

      if enableSceneDepth && ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
        worldConfiguration.frameSemantics.insert(.sceneDepth)
        sceneDepthEnabled = true
        occlusionMode = "scene_depth"
      }

      if enableSceneReconstruction && ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
        worldConfiguration.sceneReconstruction = .mesh
        sceneReconstructionEnabled = true
        occlusionMode = "mesh"
      }
      configuration = worldConfiguration
      usingGeoTrackingConfiguration = false
      geoTrackingStateValue = geoTrackingAvailabilityKnown && !geoTrackingAvailableAtLocation ? "not_available" : geoTrackingStateValue
      geoTrackingAccuracyValue = usingGeoTrackingConfiguration ? geoTrackingAccuracyValue : "unknown"
    }

    if sceneDepthEnabled || sceneReconstructionEnabled {
      arView.environment.sceneUnderstanding.options.insert(.occlusion)
    } else {
      arView.environment.sceneUnderstanding.options.remove(.occlusion)
    }

    let options: ARSession.RunOptions = resetTracking ? [.resetTracking, .removeExistingAnchors] : []
    arView.session.run(configuration, options: options)
    refreshZoomSupportAndBounds()
    didStartSession = true
    isSessionRunning = true
    lastSessionConfigFingerprint = configurationFingerprint
    if status == "unsupported" || status == "failed" {
      status = "initializing"
    }
    if trackingState == "normal" {
      status = alignmentReady ? "running" : "initializing"
      statusMessage = runningMessage()
    } else if statusMessage == nil {
      statusMessage = "Move slowly while the AR session stabilizes."
    }
  }

  private func pauseSessionIfNeeded() {
    guard isSessionRunning || didStartSession else {
      return
    }
    arView.session.pause()
    isSessionRunning = false
  }

  private func syncLocationUpdatesIfNeeded() {
    guard sessionActive, locationPermission == "granted" else {
      stopLocationUpdates()
      updateLocationFixState()
      return
    }

    guard !locationUpdatesRunning else {
      updateLocationFixState()
      return
    }

    locationManager.startUpdatingLocation()
    if CLLocationManager.headingAvailable() {
      locationManager.startUpdatingHeading()
    }
    locationUpdatesRunning = true
    lastLocationRequestStartedAt = CFAbsoluteTimeGetCurrent()
    updateLocationFixState()
  }

  private func stopLocationUpdates() {
    guard locationUpdatesRunning else {
      return
    }
    locationManager.stopUpdatingLocation()
    locationManager.stopUpdatingHeading()
    locationUpdatesRunning = false
  }

  private func updateLocationFixState() {
    guard locationPermission == "granted" else {
      locationFixState = "unavailable"
      return
    }

    guard sessionActive else {
      locationFixState = viewerLocation == nil ? "acquiring" : locationFixState
      return
    }

    guard let viewerLocation else {
      if let startedAt = lastLocationRequestStartedAt, CFAbsoluteTimeGetCurrent() - startedAt >= 8 {
        locationFixState = "timeout"
        statusMessage = "Location fix is taking longer than expected. Move to a clearer view of the sky or retry alignment."
      } else {
        locationFixState = "acquiring"
        statusMessage = "Waiting for a location fix to align the trajectory."
      }
      return
    }

    let horizontalAccuracy = viewerLocation.horizontalAccuracy
    let reducedAccuracy = locationAccuracy == "reduced"
    let coarseAccuracy = !horizontalAccuracy.isFinite || horizontalAccuracy <= 0 || horizontalAccuracy > 100

    if reducedAccuracy || coarseAccuracy {
      locationFixState = "coarse"
      statusMessage = "Full-accuracy location is required before the live AR trajectory can align cleanly."
    } else {
      locationFixState = "ready"
      if trackingState == "normal" {
        statusMessage = runningMessage()
      } else if statusMessage == nil {
        statusMessage = "Launch-site alignment is ready."
      }
    }
  }

  private var alignmentReady: Bool {
    guard locationFixState == "ready" else {
      return false
    }
    if usingGeoTrackingConfiguration {
      return geoTrackingStateValue == "localized"
    }
    return true
  }

  private func currentCaptureDevice() -> AVCaptureDevice? {
    guard #available(iOS 16.0, *) else {
      return nil
    }
    return ARWorldTrackingConfiguration.configurableCaptureDeviceForPrimaryCamera
  }

  private func refreshZoomSupportAndBounds() {
    guard let captureDevice = currentCaptureDevice() else {
      zoomSupported = false
      zoomRangeMin = 1
      zoomRangeMax = 1
      zoomRatio = 1
      zoomControlPath = "unsupported"
      return
    }

    let minAvailable = max(0.5, Double(captureDevice.minAvailableVideoZoomFactor))
    let maxAvailable = min(3.0, Double(captureDevice.maxAvailableVideoZoomFactor))
    zoomRangeMin = minAvailable
    zoomRangeMax = max(maxAvailable, minAvailable)
    zoomSupported = zoomRangeMax > zoomRangeMin + 0.01
    zoomRatio = clampZoomRatio(Double(captureDevice.videoZoomFactor))
    zoomControlPath = zoomSupported ? "native_camera" : "unsupported"
  }

  private func applyTargetZoomIfNeeded() {
    guard let targetZoomRatio else {
      return
    }
    _ = applyZoom(to: targetZoomRatio, reason: "prop_target")
  }

  private func clampZoomRatio(_ value: Double) -> Double {
    min(max(value, zoomRangeMin), zoomRangeMax)
  }

  @discardableResult
  private func applyZoom(to targetRatio: Double, reason: String) -> Bool {
    guard zoomSupported else {
      return false
    }
    guard let captureDevice = currentCaptureDevice() else {
      zoomSupported = false
      zoomControlPath = "unsupported"
      return false
    }

    let clamped = clampZoomRatio(targetRatio)
    if abs(clamped - zoomRatio) < 0.01 {
      return false
    }

    let now = CFAbsoluteTimeGetCurrent()
    if reason == "pinch" && now - lastZoomApplyAt < (1.0 / 30.0) {
      return false
    }

    let startedAt = now
    do {
      try captureDevice.lockForConfiguration()
      if abs(Double(captureDevice.videoZoomFactor) - clamped) > 0.06 {
        captureDevice.ramp(toVideoZoomFactor: CGFloat(clamped), withRate: 8.0)
      } else {
        captureDevice.videoZoomFactor = CGFloat(clamped)
      }
      captureDevice.unlockForConfiguration()

      zoomRatio = clampZoomRatio(Double(captureDevice.videoZoomFactor))
      zoomControlPath = "native_camera"
      lastZoomApplyAt = CFAbsoluteTimeGetCurrent()
      lastZoomApplyLatencyMs = max(0, (lastZoomApplyAt - startedAt) * 1_000)
      pendingZoomApplyStartedAt = startedAt
      emitSessionState()
      return true
    } catch {
      statusMessage = "Unable to adjust camera zoom."
      zoomControlPath = "unsupported"
      emitSessionState()
      return false
    }
  }

  private func rebuildTrajectoryEntitiesIfNeeded(force: Bool) {
    let staticFingerprint = createStaticRenderFingerprint()
    let dynamicFingerprint = createDynamicRenderFingerprint()
    let shouldRebuildStatic = force || staticFingerprint != lastStaticRenderFingerprint
    let shouldRefreshDynamic = shouldRebuildStatic || force || dynamicFingerprint != lastDynamicRenderFingerprint
    guard shouldRebuildStatic || shouldRefreshDynamic else {
      return
    }
    if shouldRebuildStatic {
      lastStaticRenderFingerprint = staticFingerprint
      rebuildStaticTrajectoryEntities()
    }
    if shouldRefreshDynamic {
      lastDynamicRenderFingerprint = dynamicFingerprint
      refreshDynamicTrajectoryEntities()
    }

    if trackingState == "normal" {
      statusMessage = runningMessage()
    }
    emitSessionState()
  }

  private func clearRenderedTrajectoryEntities() {
    staticTrackContainer.children.forEach { child in
      child.removeFromParent()
    }
    dynamicOverlayContainer.children.forEach { child in
      child.removeFromParent()
    }
    renderedTracks.removeAll()
    projectedMilestones.removeAll()
  }

  private func rebuildStaticTrajectoryEntities() {
    clearRenderedTrajectoryEntities()

    guard let trajectory = parsedTrajectory else {
      return
    }

    guard alignmentReady, let viewerLocation else {
      if locationPermission == "granted" {
        updateLocationFixState()
      }
      return
    }

    let radius = shellRadius(for: trajectory.qualityState)

    for track in trajectory.tracks {
      let projectedSamples = projectedTrackSamples(for: track.samples, viewerLocation: viewerLocation, radius: radius)
      guard !projectedSamples.isEmpty else {
        continue
      }
      let trackColor = color(for: track.trackKind)
      if let renderedTrack = buildRenderedTrack(samples: projectedSamples, color: trackColor) {
        renderedTracks.append(renderedTrack)
      }

      if track.trackKind == "core_up", let launchPadPosition = projectedSamples.first?.position {
        let padEntity = makeSphereEntity(radius: 0.32, color: UIColor.systemPink.withAlphaComponent(0.95))
        padEntity.position = launchPadPosition
        staticTrackContainer.addChild(padEntity)
      }
    }

    projectedMilestones = projectedMilestonePlacements(trajectory: trajectory, viewerLocation: viewerLocation, radius: radius)
  }

  private func refreshDynamicTrajectoryEntities() {
    dynamicOverlayContainer.children.forEach { child in
      child.removeFromParent()
    }

    guard parsedTrajectory != nil, alignmentReady else {
      return
    }

    let activeSecond = activeTPlusSec

    for track in renderedTracks {
      applyTrackProgressStyling(track, activeTPlusSec: activeSecond)
      guard let activeSecond,
        let activeSample = track.samples.min(by: { abs($0.tPlusSec - activeSecond) < abs($1.tPlusSec - activeSecond) }) else {
        continue
      }
      let activeMarker = makeSphereEntity(radius: 0.24, color: UIColor.white.withAlphaComponent(0.95))
      activeMarker.position = activeSample.position
      dynamicOverlayContainer.addChild(activeMarker)
    }

    for milestone in projectedMilestones {
      if let activeSecond, activeSecond >= 0, milestone.phase == "prelaunch" {
        continue
      }
      let isPast = activeSecond != nil && milestone.tPlusSec != nil && milestone.tPlusSec! < activeSecond!
      let milestoneColor = milestone.estimated ? UIColor.white.withAlphaComponent(0.55) : UIColor.white.withAlphaComponent(0.9)
      let milestoneEntity = makeSphereEntity(radius: isPast ? 0.12 : 0.18, color: milestoneColor)
      milestoneEntity.position = milestone.position + SIMD3<Float>(0, 0.16, 0)
      dynamicOverlayContainer.addChild(milestoneEntity)
    }
  }

  private func applyTrackProgressStyling(_ track: RenderedTrack, activeTPlusSec: Double?) {
    for segment in track.segments {
      let isPast = activeTPlusSec != nil && segment.midpointTPlusSec < activeTPlusSec!
      let width = segmentWidth(for: segment.sigmaDeg, isPast: isPast)
      updateEntityMaterial(segment.entity, color: track.color.withAlphaComponent(isPast ? 0.26 : 0.84))
      segment.entity.scale = SIMD3<Float>(width / max(segment.baseWidth, 0.0001), width / max(segment.baseWidth, 0.0001), 1)
    }

    for marker in track.markers {
      let isPast = activeTPlusSec != nil && marker.tPlusSec < activeTPlusSec!
      let markerRadius = max(0.06, segmentWidth(for: marker.sigmaDeg, isPast: isPast) * 1.55)
      updateEntityMaterial(marker.entity, color: track.color.withAlphaComponent(isPast ? 0.24 : 0.78))
      marker.entity.scale = SIMD3<Float>(repeating: markerRadius / max(marker.baseRadius, 0.0001))
    }
  }

  private func createStaticRenderFingerprint() -> String {
    let locationSignature: String
    if let viewerLocation {
      locationSignature = [
        String(format: "%.4f", viewerLocation.coordinate.latitude),
        String(format: "%.4f", viewerLocation.coordinate.longitude),
        String(format: "%.0f", max(viewerLocation.horizontalAccuracy, 0))
      ].joined(separator: ",")
    } else {
      locationSignature = "none"
    }

    let trackSignature = parsedTrajectory?.tracks
      .map { "\($0.trackKind):\($0.samples.count)" }
      .joined(separator: "|") ?? "no_tracks"

    return [
      trackSignature,
      locationSignature,
      locationFixState,
      qualityState ?? parsedTrajectory?.qualityState ?? "unknown",
      parsedTrajectory?.milestones.map(\.key).joined(separator: ",") ?? "no_milestones"
    ].joined(separator: "|")
  }

  private func createDynamicRenderFingerprint() -> String {
    [
      activeTPlusSec.map { String(Int($0.rounded())) } ?? "nil",
      locationFixState,
      parsedTrajectory?.milestones.map(\.key).joined(separator: ",") ?? "no_milestones"
    ].joined(separator: "|")
  }

  private func projectedTrackSamples(for samples: [TmzTrajectorySample], viewerLocation: CLLocation, radius: Float) -> [ProjectedTrackSample] {
    let downsampled = downsample(samples: samples, targetCount: 42)
    return downsampled.compactMap { sample in
      guard let position = projectedWorldPosition(ecef: sample.ecef, viewerLocation: viewerLocation, radius: radius) else {
        return nil
      }
      let sigmaDeg = sample.sigmaDeg ?? sample.uncertainty?.sigmaDeg ?? 0
      return ProjectedTrackSample(position: position, tPlusSec: sample.tPlusSec, sigmaDeg: sigmaDeg)
    }
  }

  private func projectedMilestonePlacements(
    trajectory: TmzTrajectoryPayload,
    viewerLocation: CLLocation,
    radius: Float
  ) -> [ProjectedMilestonePlacement] {
    trajectory.milestones.compactMap { milestone in
      guard milestone.projectable else {
        return nil
      }

      let preferredTrackKind = milestone.trackKind
      guard let preferredTrackKind,
        let track = trajectory.tracks.first(where: { $0.trackKind == preferredTrackKind }) else {
        return nil
      }

      guard let sample = nearestSample(for: milestone, within: track.samples) else {
        return nil
      }
      guard let position = projectedWorldPosition(ecef: sample.ecef, viewerLocation: viewerLocation, radius: radius) else {
        return nil
      }

      return ProjectedMilestonePlacement(position: position, estimated: milestone.estimated, tPlusSec: milestone.tPlusSec, phase: milestone.phase)
    }
  }

  private func nearestSample(for milestone: TmzTrajectoryMilestone, within samples: [TmzTrajectorySample]) -> TmzTrajectorySample? {
    guard let tPlusSec = milestone.tPlusSec else {
      return samples.first
    }

    return samples.min { abs($0.tPlusSec - tPlusSec) < abs($1.tPlusSec - tPlusSec) }
  }

  private func buildRenderedTrack(samples: [ProjectedTrackSample], color: UIColor) -> RenderedTrack? {
    guard !samples.isEmpty else {
      return nil
    }

    var segments: [RenderedTrackSegment] = []
    var markers: [RenderedTrackMarker] = []

    for index in 1..<samples.count {
      let start = samples[index - 1]
      let end = samples[index]
      let averageSigmaDeg = max(0, (start.sigmaDeg + end.sigmaDeg) / 2)
      let width = segmentWidth(for: averageSigmaDeg, isPast: false)
      let segment = makeSegmentEntity(from: start.position, to: end.position, color: color.withAlphaComponent(0.84), width: width)
      staticTrackContainer.addChild(segment)
      segments.append(
        RenderedTrackSegment(
          entity: segment,
          midpointTPlusSec: (start.tPlusSec + end.tPlusSec) / 2,
          sigmaDeg: averageSigmaDeg,
          baseWidth: width
        )
      )
    }

    for (index, sample) in samples.enumerated() where index == 0 || index == samples.count - 1 || index % 4 == 0 {
      let markerRadius = max(0.06, segmentWidth(for: sample.sigmaDeg, isPast: false) * 1.55)
      let entity = makeSphereEntity(radius: markerRadius, color: color.withAlphaComponent(0.78))
      entity.position = sample.position
      staticTrackContainer.addChild(entity)
      markers.append(RenderedTrackMarker(entity: entity, tPlusSec: sample.tPlusSec, sigmaDeg: sample.sigmaDeg, baseRadius: markerRadius))
    }

    return RenderedTrack(samples: samples, color: color, segments: segments, markers: markers)
  }

  private func updateEntityMaterial(_ entity: ModelEntity, color: UIColor) {
    entity.model?.materials = [SimpleMaterial(color: color, isMetallic: false)]
  }

  private func segmentWidth(for sigmaDeg: Double, isPast: Bool) -> Float {
    let clampedSigma = min(max(sigmaDeg, 0), 18)
    let baseWidth: Float = isPast ? 0.032 : 0.05
    return baseWidth + Float(clampedSigma / 18.0) * (isPast ? 0.05 : 0.11)
  }

  private func makeSphereEntity(radius: Float, color: UIColor) -> ModelEntity {
    let mesh = MeshResource.generateSphere(radius: radius)
    let material = SimpleMaterial(color: color, isMetallic: false)
    return ModelEntity(mesh: mesh, materials: [material])
  }

  private func makeSegmentEntity(from start: SIMD3<Float>, to end: SIMD3<Float>, color: UIColor, width: Float) -> ModelEntity {
    let direction = end - start
    let length = simd_length(direction)
    let mesh = MeshResource.generateBox(size: SIMD3<Float>(width, width, max(length, width)), cornerRadius: min(width / 3, 0.03))
    let material = SimpleMaterial(color: color, isMetallic: false)
    let entity = ModelEntity(mesh: mesh, materials: [material])
    entity.position = (start + end) / 2
    if length > 0.0001 {
      entity.orientation = simd_quatf(from: SIMD3<Float>(0, 0, 1), to: simd_normalize(direction))
    }
    return entity
  }

  private func projectedWorldPosition(ecef: [Double], viewerLocation: CLLocation, radius: Float) -> SIMD3<Float>? {
    guard ecef.count == 3 else {
      return nil
    }

    let observer = geodeticToEcef(
      latitudeDegrees: viewerLocation.coordinate.latitude,
      longitudeDegrees: viewerLocation.coordinate.longitude,
      altitudeMeters: max(viewerLocation.altitude, 0)
    )
    let target = SIMD3<Double>(ecef[0], ecef[1], ecef[2])
    let delta = target - observer
    let enu = ecefDeltaToEnu(delta: delta, latitudeDegrees: viewerLocation.coordinate.latitude, longitudeDegrees: viewerLocation.coordinate.longitude)
    let horizontal = sqrt((enu.x * enu.x) + (enu.y * enu.y))
    let elevation = atan2(enu.z, horizontal)
    let azimuth = atan2(enu.x, enu.y)

    let cosElevation = cos(elevation)
    return SIMD3<Float>(
      radius * Float(cosElevation * sin(azimuth)),
      radius * Float(sin(elevation)),
      -radius * Float(cosElevation * cos(azimuth))
    )
  }

  private func shellRadius(for qualityState: String?) -> Float {
    switch qualityState {
    case "precision":
      return 42
    case "pad_only":
      return 32
    default:
      return 36
    }
  }

  private func color(for trackKind: String) -> UIColor {
    switch trackKind {
    case "upper_stage_up":
      return UIColor.systemBlue
    case "booster_down":
      return UIColor.systemOrange
    default:
      return UIColor.systemCyan
    }
  }

  private func downsample(samples: [TmzTrajectorySample], targetCount: Int) -> [TmzTrajectorySample] {
    guard samples.count > targetCount, targetCount > 1 else {
      return samples
    }

    let step = max(1, samples.count / targetCount)
    var result: [TmzTrajectorySample] = []
    result.reserveCapacity(targetCount + 1)
    for index in stride(from: 0, to: samples.count, by: step) {
      result.append(samples[index])
    }
    if let lastSample = samples.last, result.last?.tPlusSec != lastSample.tPlusSec {
      result.append(lastSample)
    }
    return result
  }

  private func runningMessage() -> String {
    if locationPermission != "granted" {
      return "Location access is required to align the launch trajectory."
    }
    if locationFixState == "coarse" {
      return "Tracking is waiting for a full-accuracy location fix before enabling the live AR sky track."
    }
    if usingGeoTrackingConfiguration {
      switch geoTrackingStateValue {
      case "localized":
        return "Geo-localized. Follow the live T-time marker as the vehicle climbs."
      case "localizing", "initializing":
        return "Geo-localizing the launch alignment. Keep the phone up and the surrounding scene visible."
      default:
        return "Geo tracking is unavailable here. Falling back to ARKit world tracking."
      }
    }
    return "Tracking stable. Follow the live T-time marker as the vehicle climbs."
  }

  private func limitedTrackingMessage(reason: String?) -> String {
    guard let reason else {
      return "Tracking is limited. Move slowly and give ARKit a better view of the scene."
    }
    return "Tracking limited: \(reason). Move slowly and point the camera at textured surfaces."
  }

  private func mapTrackingState(_ trackingState: ARCamera.TrackingState) -> String {
    switch trackingState {
    case .normal:
      return "normal"
    case .limited:
      return "limited"
    case .notAvailable:
      return "not_available"
    }
  }

  private func mapTrackingReason(_ trackingState: ARCamera.TrackingState) -> String? {
    guard case let .limited(reason) = trackingState else {
      return nil
    }

    switch reason {
    case .initializing:
      return "initializing"
    case .excessiveMotion:
      return "excessive_motion"
    case .insufficientFeatures:
      return "insufficient_features"
    case .relocalizing:
      return "relocalizing"
    @unknown default:
      return "unknown"
    }
  }

  private func mapWorldMappingStatus(_ status: ARFrame.WorldMappingStatus) -> String {
    switch status {
    case .mapped:
      return "mapped"
    case .extending:
      return "extending"
    case .limited:
      return "limited"
    case .notAvailable:
      return "not_available"
    @unknown default:
      return "not_available"
    }
  }

  private func mapGeoTrackingState(_ state: ARGeoTrackingStatus.State) -> String {
    switch state {
    case .notAvailable:
      return "not_available"
    case .initializing:
      return "initializing"
    case .localizing:
      return "localizing"
    case .localized:
      return "localized"
    @unknown default:
      return "not_available"
    }
  }

  private func mapGeoTrackingAccuracy(_ accuracy: ARGeoTrackingStatus.Accuracy) -> String {
    switch accuracy {
    case .high:
      return "high"
    case .medium:
      return "medium"
    case .low:
      return "low"
    case .undetermined:
      return "unknown"
    @unknown default:
      return "unknown"
    }
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
    true
  }

  private func emitSessionState() {
    let payload = createPayload()
    let status = payload["status"] as? String ?? ""
    let trackingState = payload["trackingState"] as? String ?? ""
    let trackingReason = payload["trackingReason"] as? String ?? ""
    let worldMappingStatus = payload["worldMappingStatus"] as? String ?? ""
    let geoTrackingState = payload["geoTrackingState"] as? String ?? ""
    let geoTrackingAccuracy = payload["geoTrackingAccuracy"] as? String ?? ""
    let locationPermission = payload["locationPermission"] as? String ?? ""
    let locationFixState = payload["locationFixState"] as? String ?? ""
    let alignmentReadyFingerprint = (payload["alignmentReady"] as? Bool == true) ? "1" : "0"
    let sceneDepthFingerprint = (payload["sceneDepthEnabled"] as? Bool == true) ? "1" : "0"
    let sceneReconstructionFingerprint = (payload["sceneReconstructionEnabled"] as? Bool == true) ? "1" : "0"
    let sessionRunningFingerprint = (payload["sessionRunning"] as? Bool == true) ? "1" : "0"
    let zoomFingerprint = String(format: "%.2f", zoomRatio)
    let zoomControlPath = payload["zoomControlPath"] as? String ?? ""
    let message = payload["message"] as? String ?? ""

    let fingerprint = [
      status,
      trackingState,
      trackingReason,
      worldMappingStatus,
      geoTrackingState,
      geoTrackingAccuracy,
      locationPermission,
      locationFixState,
      alignmentReadyFingerprint,
      sceneDepthFingerprint,
      sceneReconstructionFingerprint,
      sessionRunningFingerprint,
      zoomFingerprint,
      zoomControlPath,
      message
    ].joined(separator: "|")

    let now = CFAbsoluteTimeGetCurrent()
    let fingerprintChanged = fingerprint != lastPayloadFingerprint
    if fingerprintChanged {
      lastPayloadFingerprint = fingerprint
      onSessionStateChange(payload)
    }

    if fingerprintChanged || now - lastSessionUpdateEmission >= 0.75 {
      lastSessionUpdateEmission = now
      onSessionUpdate(payload)
    }
  }

  private func createPayload() -> [String: Any] {
    [
      "sessionRunning": isSessionRunning,
      "status": status,
      "trackingState": trackingState,
      "trackingReason": trackingReason ?? NSNull(),
      "worldAlignment": worldAlignment,
      "worldMappingStatus": worldMappingStatus,
      "lidarAvailable": ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth),
      "sceneDepthEnabled": sceneDepthEnabled,
      "sceneReconstructionEnabled": sceneReconstructionEnabled,
      "geoTrackingState": geoTrackingStateValue,
      "geoTrackingAccuracy": geoTrackingAccuracyValue,
      "occlusionMode": occlusionMode,
      "relocalizationCount": relocalizationCount,
      "renderLoopRunning": isSessionRunning && trackingState == "normal",
      "highResCaptureAttempted": highResCaptureAttempted,
      "highResCaptureSucceeded": highResCaptureSucceeded,
      "hasTrajectory": parsedTrajectory != nil,
      "qualityState": qualityState ?? parsedTrajectory?.qualityState ?? NSNull(),
      "sampleCount": parsedTrajectory?.tracks.reduce(0, { $0 + $1.samples.count }) ?? 0,
      "milestoneCount": parsedTrajectory?.milestones.count ?? 0,
      "zoomSupported": zoomSupported,
      "zoomRatio": zoomRatio,
      "zoomRangeMin": zoomRangeMin,
      "zoomRangeMax": zoomRangeMax,
      "zoomControlPath": zoomControlPath,
      "projectionSource": projectionSource,
      "zoomRatioBucket": bucketZoomRatio(zoomRatio),
      "zoomApplyLatencyBucket": bucketLatencyMs(lastZoomApplyLatencyMs),
      "zoomProjectionSyncLatencyBucket": bucketLatencyMs(lastZoomProjectionSyncLatencyMs),
      "lastUpdatedAt": ISO8601DateFormatter().string(from: Date()),
      "cameraPermission": cameraPermission,
      "motionPermission": motionPermission,
      "locationPermission": locationPermission,
      "locationAccuracy": locationAccuracy,
      "locationFixState": locationFixState,
      "alignmentReady": alignmentReady,
      "headingStatus": headingStatus(),
      "headingSource": worldAlignment == "gravity_and_heading" ? "arkit_world" : "core_location_heading",
      "poseSource": "arkit_world_tracking",
      "poseMode": "arkit_world_tracking",
      "visionBackend": "none",
      "message": statusMessage ?? NSNull(),
      "retryCount": retryCount
    ]
  }

  private func headingStatus() -> String {
    if locationPermission != "granted" {
      return "unavailable"
    }
    if locationFixState == "coarse" {
      return "noisy"
    }
    if usingGeoTrackingConfiguration {
      return geoTrackingStateValue == "localized" ? geoTrackingAccuracyValue == "high" ? "ok" : "noisy" : "unknown"
    }
    if worldAlignment == "gravity_and_heading" && alignmentReady {
      return "ok"
    }
    return alignmentReady ? "noisy" : "unknown"
  }

  private func bucketZoomRatio(_ zoom: Double) -> String {
    if !zoomSupported {
      return "unsupported"
    }
    if zoom < 0.75 {
      return "0.5..0.75"
    }
    if zoom < 1.0 {
      return "0.75..1.0"
    }
    if zoom < 1.5 {
      return "1.0..1.5"
    }
    if zoom < 2.0 {
      return "1.5..2.0"
    }
    if zoom < 2.5 {
      return "2.0..2.5"
    }
    if zoom < 3.0 {
      return "2.5..3.0"
    }
    return "3.0+"
  }

  private func bucketLatencyMs(_ value: Double) -> String {
    if !value.isFinite || value < 0 {
      return "unknown"
    }
    if value < 16 {
      return "<16ms"
    }
    if value < 33 {
      return "16..33ms"
    }
    if value < 50 {
      return "33..50ms"
    }
    if value < 100 {
      return "50..100ms"
    }
    return "100ms+"
  }

  private func emitError(code: String, message: String, recoverable: Bool) {
    onSessionError([
      "code": code,
      "message": message,
      "recoverable": recoverable
    ])
  }
}

private struct TmzTrajectoryPayload: Decodable {
  let qualityState: String
  let tracks: [TmzTrajectoryTrack]
  let milestones: [TmzTrajectoryMilestone]
}

private struct TmzTrajectoryTrack: Decodable {
  let trackKind: String
  let samples: [TmzTrajectorySample]
}

private struct TmzTrajectorySample: Decodable {
  let tPlusSec: Double
  let ecef: [Double]
  let sigmaDeg: Double?
  let uncertainty: TmzTrajectoryUncertainty?
}

private struct TmzTrajectoryUncertainty: Decodable {
  let sigmaDeg: Double?
}

private struct TmzTrajectoryMilestone: Decodable {
  let key: String
  let label: String
  let tPlusSec: Double?
  let phase: String
  let trackKind: String?
  let estimated: Bool
  let projectable: Bool
}

private struct ProjectedTrackSample {
  let position: SIMD3<Float>
  let tPlusSec: Double
  let sigmaDeg: Double
}

private struct ProjectedMilestonePlacement {
  let position: SIMD3<Float>
  let estimated: Bool
  let tPlusSec: Double?
  let phase: String
}

private struct RenderedTrack {
  let samples: [ProjectedTrackSample]
  let color: UIColor
  let segments: [RenderedTrackSegment]
  let markers: [RenderedTrackMarker]
}

private struct RenderedTrackSegment {
  let entity: ModelEntity
  let midpointTPlusSec: Double
  let sigmaDeg: Double
  let baseWidth: Float
}

private struct RenderedTrackMarker {
  let entity: ModelEntity
  let tPlusSec: Double
  let sigmaDeg: Double
  let baseRadius: Float
}

private func geodeticToEcef(latitudeDegrees: Double, longitudeDegrees: Double, altitudeMeters: Double) -> SIMD3<Double> {
  let semiMajorAxis = 6_378_137.0
  let flattening = 1.0 / 298.257223563
  let eccentricitySquared = flattening * (2 - flattening)

  let latitude = latitudeDegrees * .pi / 180
  let longitude = longitudeDegrees * .pi / 180
  let sinLatitude = sin(latitude)
  let cosLatitude = cos(latitude)
  let sinLongitude = sin(longitude)
  let cosLongitude = cos(longitude)

  let radiusOfCurvature = semiMajorAxis / sqrt(1 - eccentricitySquared * sinLatitude * sinLatitude)
  let x = (radiusOfCurvature + altitudeMeters) * cosLatitude * cosLongitude
  let y = (radiusOfCurvature + altitudeMeters) * cosLatitude * sinLongitude
  let z = (radiusOfCurvature * (1 - eccentricitySquared) + altitudeMeters) * sinLatitude
  return SIMD3<Double>(x, y, z)
}

private func ecefDeltaToEnu(delta: SIMD3<Double>, latitudeDegrees: Double, longitudeDegrees: Double) -> SIMD3<Double> {
  let latitude = latitudeDegrees * .pi / 180
  let longitude = longitudeDegrees * .pi / 180
  let sinLatitude = sin(latitude)
  let cosLatitude = cos(latitude)
  let sinLongitude = sin(longitude)
  let cosLongitude = cos(longitude)

  let east = (-sinLongitude * delta.x) + (cosLongitude * delta.y)
  let north = (-sinLatitude * cosLongitude * delta.x) - (sinLatitude * sinLongitude * delta.y) + (cosLatitude * delta.z)
  let up = (cosLatitude * cosLongitude * delta.x) + (cosLatitude * sinLongitude * delta.y) + (sinLatitude * delta.z)
  return SIMD3<Double>(east, north, up)
}

private extension simd_float4x4 {
  var translation: SIMD3<Float> {
    SIMD3<Float>(columns.3.x, columns.3.y, columns.3.z)
  }
}
