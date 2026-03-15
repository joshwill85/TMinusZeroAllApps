import ARKit
import AVFoundation
import CoreLocation
import ExpoModulesCore
import RealityKit
import simd

internal final class TmzArTrajectoryView: ExpoView, ARSessionDelegate, CLLocationManagerDelegate {
  let onSessionStateChange = EventDispatcher()
  let onSessionUpdate = EventDispatcher()
  let onSessionError = EventDispatcher()

  var trajectoryJson = ""
  var qualityState: String?
  var worldAlignmentPreference = "gravity_and_heading"
  var enableSceneDepth = true
  var enableSceneReconstruction = true
  var highResCaptureEnabled = false
  var showDebugStatistics = false

  private let arView: ARView
  private let rootAnchor = AnchorEntity(world: .zero)
  private let locationManager = CLLocationManager()

  private var parsedTrajectory: TmzTrajectoryPayload?
  private var viewerLocation: CLLocation?
  private var didStartSession = false
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
  private var motionPermission: String = "granted"
  private var locationPermission: String = "prompt"
  private var locationAccuracy: String = "unknown"
  private var lastPayloadFingerprint: String?
  private var lastSessionUpdateEmission = CFAbsoluteTimeGetCurrent()

  required init(appContext: AppContext? = nil) {
    self.arView = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
    super.init(appContext: appContext)

    backgroundColor = .black
    clipsToBounds = true

    arView.translatesAutoresizingMaskIntoConstraints = false
    arView.automaticallyConfigureSession = false
    arView.renderOptions.insert(.disableMotionBlur)
    arView.session.delegate = self
    arView.scene.addAnchor(rootAnchor)

    addSubview(arView)
    NSLayoutConstraint.activate([
      arView.leadingAnchor.constraint(equalTo: leadingAnchor),
      arView.trailingAnchor.constraint(equalTo: trailingAnchor),
      arView.topAnchor.constraint(equalTo: topAnchor),
      arView.bottomAnchor.constraint(equalTo: bottomAnchor)
    ])

    locationManager.delegate = self
    locationManager.desiredAccuracy = kCLLocationAccuracyBest
    locationManager.distanceFilter = 10
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
    highResCaptureAttempted = highResCaptureEnabled
    parseTrajectoryIfNeeded()
    applySessionConfiguration(resetTracking: !didStartSession)
    rebuildTrajectoryEntitiesIfPossible()
    emitSessionState()
  }

  func teardown() {
    arView.session.pause()
    locationManager.stopUpdatingLocation()
    locationManager.stopUpdatingHeading()
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    status = "failed"
    statusMessage = error.localizedDescription
    trackingState = "not_available"
    emitError(code: "session_failed", message: error.localizedDescription, recoverable: true)
    emitSessionState()
  }

  func sessionWasInterrupted(_ session: ARSession) {
    status = "initializing"
    statusMessage = "AR session interrupted. Reacquire the scene slowly."
    retryCount += 1
    emitError(code: "session_interrupted", message: "The AR session was interrupted.", recoverable: true)
    emitSessionState()
  }

  func sessionInterruptionEnded(_ session: ARSession) {
    relocalizationCount += 1
    retryCount += 1
    status = "initializing"
    statusMessage = "AR session resumed. Rebuilding tracking."
    applySessionConfiguration(resetTracking: true)
    emitSessionState()
  }

  func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
    trackingState = mapTrackingState(camera.trackingState)
    trackingReason = mapTrackingReason(camera.trackingState)
    if trackingState == "normal" {
      status = "running"
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
      self.emitSessionState()
    }
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    refreshLocationAuthorization()
    if locationPermission == "granted" {
      manager.startUpdatingLocation()
      if CLLocationManager.headingAvailable() {
        manager.startUpdatingHeading()
      }
    }
    rebuildTrajectoryEntitiesIfPossible()
    emitSessionState()
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let latestLocation = locations.last else {
      return
    }
    viewerLocation = latestLocation
    rebuildTrajectoryEntitiesIfPossible()
    if trackingState == "normal" && statusMessage == nil {
      statusMessage = runningMessage()
    }
    emitSessionState()
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    statusMessage = error.localizedDescription
    emitSessionState()
  }

  private func requestCameraAccessIfNeeded() {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      cameraPermission = "granted"
      applySessionConfiguration(resetTracking: !didStartSession)
    case .notDetermined:
      cameraPermission = "prompt"
      AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
        DispatchQueue.main.async {
          guard let self else {
            return
          }
          self.cameraPermission = granted ? "granted" : "denied"
          if granted {
            self.applySessionConfiguration(resetTracking: !self.didStartSession)
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
    case .notDetermined:
      locationPermission = "prompt"
      locationAccuracy = "unknown"
      locationManager.requestWhenInUseAuthorization()
    case .denied, .restricted:
      locationPermission = "denied"
      locationAccuracy = "unknown"
      if statusMessage == nil {
        statusMessage = "Location access is required to align the trajectory with the launch site."
      }
      emitError(code: "location_denied", message: "Location access is required to align the trajectory with the launch site.", recoverable: true)
    @unknown default:
      locationPermission = "error"
      locationAccuracy = "unknown"
    }
  }

  private func parseTrajectoryIfNeeded() {
    guard !trajectoryJson.isEmpty else {
      parsedTrajectory = nil
      statusMessage = "Loading trajectory package."
      return
    }

    guard let data = trajectoryJson.data(using: .utf8) else {
      parsedTrajectory = nil
      status = "failed"
      statusMessage = "The trajectory payload was not valid UTF-8."
      return
    }

    do {
      parsedTrajectory = try JSONDecoder().decode(TmzTrajectoryPayload.self, from: data)
    } catch {
      parsedTrajectory = nil
      status = "failed"
      statusMessage = "Unable to decode the trajectory payload."
    }
  }

  private func applySessionConfiguration(resetTracking: Bool) {
    guard ARWorldTrackingConfiguration.isSupported else {
      status = "unsupported"
      statusMessage = "ARKit world tracking is unavailable on this iPhone."
      emitError(code: "unsupported", message: "ARKit world tracking is unavailable on this iPhone.", recoverable: false)
      emitSessionState()
      return
    }

    guard cameraPermission == "granted" else {
      emitSessionState()
      return
    }

    let configuration = ARWorldTrackingConfiguration()
    configuration.worldAlignment = worldAlignmentPreference == "gravity" ? .gravity : .gravityAndHeading
    worldAlignment = worldAlignmentPreference == "gravity" ? "gravity" : "gravity_and_heading"

    sceneDepthEnabled = false
    sceneReconstructionEnabled = false
    occlusionMode = "none"

    if enableSceneDepth && ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
      configuration.frameSemantics.insert(.sceneDepth)
      sceneDepthEnabled = true
      occlusionMode = "scene_depth"
    }

    if enableSceneReconstruction && ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
      configuration.sceneReconstruction = .mesh
      sceneReconstructionEnabled = true
      occlusionMode = "mesh"
    }

    if sceneDepthEnabled || sceneReconstructionEnabled {
      arView.environment.sceneUnderstanding.options.insert(.occlusion)
    } else {
      arView.environment.sceneUnderstanding.options.remove(.occlusion)
    }

    let options: ARSession.RunOptions = resetTracking ? [.resetTracking, .removeExistingAnchors] : []
    arView.session.run(configuration, options: options)
    didStartSession = true
    if status == "unsupported" || status == "failed" {
      status = "initializing"
    }
    if statusMessage == nil {
      statusMessage = "Move slowly while the AR session stabilizes."
    }
  }

  private func rebuildTrajectoryEntitiesIfPossible() {
    guard let trajectory = parsedTrajectory else {
      return
    }

    guard let viewerLocation else {
      if locationPermission == "granted" {
        statusMessage = "Waiting for a location fix to align the trajectory."
      }
      emitSessionState()
      return
    }

    rootAnchor.children.forEach { child in
      child.removeFromParent()
    }

    let radius = shellRadius(for: trajectory.qualityState)

    for track in trajectory.tracks {
      let positions = projectedPositions(for: track.samples, viewerLocation: viewerLocation, radius: radius)
      let color = track.trackKind == "booster_down" ? UIColor.systemOrange : UIColor.systemCyan
      addTrackEntities(positions: positions, color: color)

      if track.trackKind == "core_up", let launchPadPosition = positions.first {
        let padEntity = makeSphereEntity(radius: 0.35, color: UIColor.systemPink)
        padEntity.position = launchPadPosition
        rootAnchor.addChild(padEntity)
      }
    }

    let milestonePositions = projectedMilestonePositions(trajectory: trajectory, viewerLocation: viewerLocation, radius: radius)
    for position in milestonePositions {
      let milestoneEntity = makeSphereEntity(radius: 0.2, color: UIColor.white.withAlphaComponent(0.9))
      milestoneEntity.position = position + SIMD3<Float>(0, 0.18, 0)
      rootAnchor.addChild(milestoneEntity)
    }

    if trackingState == "normal" {
      statusMessage = runningMessage()
    }
  }

  private func projectedPositions(for samples: [TmzTrajectorySample], viewerLocation: CLLocation, radius: Float) -> [SIMD3<Float>] {
    let downsampled = downsample(samples: samples, targetCount: 36)
    return downsampled.compactMap { sample in
      projectedWorldPosition(ecef: sample.ecef, viewerLocation: viewerLocation, radius: radius)
    }
  }

  private func projectedMilestonePositions(trajectory: TmzTrajectoryPayload, viewerLocation: CLLocation, radius: Float) -> [SIMD3<Float>] {
    return trajectory.milestones.compactMap { milestone in
      let preferredTrackKind = milestone.trackKind ?? "core_up"
      guard let track = trajectory.tracks.first(where: { $0.trackKind == preferredTrackKind }) ?? trajectory.tracks.first else {
        return nil
      }

      let sample = nearestSample(for: milestone, within: track.samples) ?? track.samples.first
      guard let sample else {
        return nil
      }

      return projectedWorldPosition(ecef: sample.ecef, viewerLocation: viewerLocation, radius: radius)
    }
  }

  private func nearestSample(for milestone: TmzTrajectoryMilestone, within samples: [TmzTrajectorySample]) -> TmzTrajectorySample? {
    guard let tPlusSec = milestone.tPlusSec else {
      return samples.first
    }

    return samples.min { abs($0.tPlusSec - tPlusSec) < abs($1.tPlusSec - tPlusSec) }
  }

  private func addTrackEntities(positions: [SIMD3<Float>], color: UIColor) {
    guard !positions.isEmpty else {
      return
    }

    for position in positions {
      let entity = makeSphereEntity(radius: 0.13, color: color)
      entity.position = position
      rootAnchor.addChild(entity)
    }

    for index in 1..<positions.count {
      let segment = makeSegmentEntity(from: positions[index - 1], to: positions[index], color: color)
      rootAnchor.addChild(segment)
    }
  }

  private func makeSphereEntity(radius: Float, color: UIColor) -> ModelEntity {
    let mesh = MeshResource.generateSphere(radius: radius)
    let material = SimpleMaterial(color: color, isMetallic: false)
    return ModelEntity(mesh: mesh, materials: [material])
  }

  private func makeSegmentEntity(from start: SIMD3<Float>, to end: SIMD3<Float>, color: UIColor) -> ModelEntity {
    let direction = end - start
    let length = simd_length(direction)
    let mesh = MeshResource.generateBox(size: SIMD3<Float>(repeating: 0.045), cornerRadius: 0.01)
    let material = SimpleMaterial(color: color.withAlphaComponent(0.72), isMetallic: false)
    let entity = ModelEntity(mesh: mesh, materials: [material])
    entity.scale = SIMD3<Float>(1, 1, max(length / 0.045, 1))
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
      return "Location access improves alignment. Grant it in Settings for the cleanest sky fit."
    }
    return "Tracking stable. Landscape is recommended once the corridor is lined up."
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

  private func emitSessionState() {
    let payload = createPayload()
    let fingerprint = [
      payload["status"] as? String ?? "",
      payload["trackingState"] as? String ?? "",
      payload["trackingReason"] as? String ?? "",
      payload["worldMappingStatus"] as? String ?? "",
      payload["sceneDepthEnabled"] as? Bool == true ? "1" : "0",
      payload["sceneReconstructionEnabled"] as? Bool == true ? "1" : "0",
      payload["locationPermission"] as? String ?? "",
      payload["message"] as? String ?? ""
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
    return [
      "sessionRunning": didStartSession,
      "status": status,
      "trackingState": trackingState,
      "trackingReason": trackingReason ?? NSNull(),
      "worldAlignment": worldAlignment,
      "worldMappingStatus": worldMappingStatus,
      "lidarAvailable": ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth),
      "sceneDepthEnabled": sceneDepthEnabled,
      "sceneReconstructionEnabled": sceneReconstructionEnabled,
      "geoTrackingState": "not_available",
      "geoTrackingAccuracy": "unknown",
      "occlusionMode": occlusionMode,
      "relocalizationCount": relocalizationCount,
      "renderLoopRunning": didStartSession,
      "highResCaptureAttempted": highResCaptureAttempted,
      "highResCaptureSucceeded": highResCaptureSucceeded,
      "hasTrajectory": parsedTrajectory != nil,
      "qualityState": qualityState ?? parsedTrajectory?.qualityState ?? NSNull(),
      "sampleCount": parsedTrajectory?.tracks.reduce(0, { $0 + $1.samples.count }) ?? 0,
      "milestoneCount": parsedTrajectory?.milestones.count ?? 0,
      "lastUpdatedAt": ISO8601DateFormatter().string(from: Date()),
      "cameraPermission": cameraPermission,
      "motionPermission": motionPermission,
      "locationPermission": locationPermission,
      "locationAccuracy": locationAccuracy,
      "message": statusMessage ?? NSNull(),
      "retryCount": retryCount
    ]
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
}

private struct TmzTrajectoryMilestone: Decodable {
  let tPlusSec: Double?
  let trackKind: String?
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
