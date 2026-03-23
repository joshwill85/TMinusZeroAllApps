package expo.modules.tmzartrajectory

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.Surface
import android.view.TextureView
import android.widget.FrameLayout
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.events.RCTEventEmitter
import com.google.ar.core.Config
import com.google.ar.core.Frame
import com.google.ar.core.Session
import com.google.ar.core.SharedCamera
import com.google.ar.core.TrackingFailureReason
import com.google.ar.core.TrackingState
import com.google.ar.core.exceptions.CameraNotAvailableException
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.EnumSet
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs
import kotlin.math.max

internal class TmzArTrajectoryView(context: Context, appContext: AppContext) : ExpoView(context, appContext), TextureView.SurfaceTextureListener {
  var trajectoryJson: String = ""
  var qualityState: String? = null
  var worldAlignmentPreference: String = "gravity_and_heading"
  var enableSceneDepth: Boolean = true
  var enableSceneReconstruction: Boolean = true
  var highResCaptureEnabled: Boolean = false
  var enablePinchZoom: Boolean = true
  var targetZoomRatio: Double? = null
  var showDebugStatistics: Boolean = false

  private val textureView = TextureView(context)
  private val mainHandler = Handler(Looper.getMainLooper())
  private val cameraThread = HandlerThread("TmzArTrajectoryCamera")
  private var cameraHandler: Handler

  private var cameraManager: CameraManager? = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
  private var cameraInfo = TmzArTrajectoryCameraInfo.resolve(context)
  private var cameraDevice: CameraDevice? = null
  private var captureSession: CameraCaptureSession? = null
  private var previewBuilder: CaptureRequest.Builder? = null
  private var previewSurface: Surface? = null
  private var arSession: Session? = null
  private var sharedCamera: SharedCamera? = null
  private var arCoreEnabled = false
  private var arSessionResumed = false
  private var arLastTrackingState: TrackingState? = null

  private var status: String = "initializing"
  private var statusMessage: String? = null
  private var trackingState: String = "not_available"
  private var trackingReason: String? = null
  private var worldMappingStatus: String = "not_available"
  private var occlusionMode: String = "none"
  private var relocalizationCount = 0
  private var retryCount = 0
  private var highResCaptureAttempted = false
  private var highResCaptureSucceeded = false
  private var cameraPermission: String = "prompt"
  private var motionPermission: String = "granted"
  private var locationPermission: String = "prompt"
  private var locationAccuracy: String = "unknown"

  private var zoomSupported = false
  private var zoomRatio = 1.0
  private var zoomRangeMin = 1.0
  private var zoomRangeMax = 1.0
  private var zoomControlPath = "unsupported"
  private var projectionSource = "projection_matrix"
  private var lastZoomApplyAtMs = 0L
  private var lastZoomApplyLatencyMs = 0.0
  private var lastZoomProjectionSyncLatencyMs = 0.0
  private var pendingZoomApplyStartedAtMs: Long? = null
  private var pinchZoomStartRatio = 1.0

  private var hasTrajectory = false
  private var parsedQualityState: String? = null
  private var sampleCount = 0
  private var milestoneCount = 0

  private var sessionRunning = false
  private var renderLoopRunning = false
  private var lastFingerprint: String? = null
  private var lastSessionUpdateEmissionAtMs = 0L
  private var isTornDown = false

  private val scaleGestureDetector: ScaleGestureDetector

  private val cameraStateCallback = object : CameraDevice.StateCallback() {
    override fun onOpened(camera: CameraDevice) {
      mainHandler.post {
        cameraDevice = camera
        sessionRunning = true
        status = "initializing"
        trackingState = "limited"
        trackingReason = "initializing"
        createPreviewSession()
      }
    }

    override fun onDisconnected(camera: CameraDevice) {
      mainHandler.post {
        camera.close()
        cameraDevice = null
        status = "failed"
        statusMessage = "Android camera disconnected."
        trackingState = "not_available"
        trackingReason = "camera_disconnected"
        sessionRunning = false
        emitError("camera_disconnected", "Android camera disconnected.", true)
        emitSessionState(forceStateChange = true)
      }
    }

    override fun onError(camera: CameraDevice, error: Int) {
      mainHandler.post {
        camera.close()
        cameraDevice = null
        status = "failed"
        statusMessage = "Android camera error ($error)."
        trackingState = "not_available"
        trackingReason = "camera_error"
        sessionRunning = false
        emitError("camera_error", "Android camera error ($error).", true)
        emitSessionState(forceStateChange = true)
      }
    }
  }

  private val captureSessionCallback = object : CameraCaptureSession.StateCallback() {
    override fun onConfigured(session: CameraCaptureSession) {
      mainHandler.post {
        captureSession = session
        val builder = previewBuilder ?: return@post
        try {
          session.setRepeatingRequest(builder.build(), cameraCaptureCallback, cameraHandler)
          sessionRunning = true
          renderLoopRunning = true
          if (arCoreEnabled) {
            status = "initializing"
            statusMessage = "ARCore world tracking is initializing. Move slowly for map stabilization."
            trackingState = "limited"
            trackingReason = "initializing"
            worldMappingStatus = "limited"
          } else {
            status = "running"
            statusMessage = runningMessage()
            trackingState = "normal"
            trackingReason = null
            worldMappingStatus = "not_available"
          }
          emitSessionState(forceStateChange = true)
        } catch (error: Throwable) {
          status = "failed"
          statusMessage = "Unable to start Android camera preview."
          trackingState = "not_available"
          trackingReason = "camera_start_failed"
          sessionRunning = false
          emitError("camera_start_failed", error.message ?: "Unable to start Android camera preview.", true)
          emitSessionState(forceStateChange = true)
        }
      }
    }

    override fun onActive(session: CameraCaptureSession) {
      mainHandler.post {
        if (arCoreEnabled) {
          resumeArSessionIfNeeded()
        }
      }
    }

    override fun onConfigureFailed(session: CameraCaptureSession) {
      mainHandler.post {
        status = "failed"
        statusMessage = "Android camera session configuration failed."
        trackingState = "not_available"
        trackingReason = "camera_config_failed"
        sessionRunning = false
        emitError("camera_config_failed", "Android camera session configuration failed.", true)
        emitSessionState(forceStateChange = true)
      }
    }
  }

  private val cameraCaptureCallback = object : CameraCaptureSession.CaptureCallback() {
    override fun onCaptureCompleted(
      session: CameraCaptureSession,
      request: CaptureRequest,
      result: android.hardware.camera2.TotalCaptureResult
    ) {
      if (!arCoreEnabled || !arSessionResumed) {
        return
      }
      updateArTrackingState()
    }
  }

  private val emitRunnable = object : Runnable {
    override fun run() {
      emitSessionState()
      mainHandler.postDelayed(this, 750)
    }
  }

  init {
    cameraThread.start()
    cameraHandler = Handler(cameraThread.looper)

    prepareArCoreSession()
    highResCaptureAttempted = highResCaptureEnabled
    applyCameraInfo(cameraInfo)
    refreshPermissionState()

    scaleGestureDetector = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
      override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
        pinchZoomStartRatio = zoomRatio
        return true
      }

      override fun onScale(detector: ScaleGestureDetector): Boolean {
        if (!enablePinchZoom || !zoomSupported) {
          return false
        }
        val target = clampZoomRatio(pinchZoomStartRatio * detector.scaleFactor.toDouble())
        applyZoom(target, "pinch")
        return true
      }

      override fun onScaleEnd(detector: ScaleGestureDetector) {
        pinchZoomStartRatio = zoomRatio
      }
    })

    textureView.surfaceTextureListener = this
    textureView.isOpaque = true
    textureView.setOnTouchListener { _, event ->
      if (enablePinchZoom) {
        scaleGestureDetector.onTouchEvent(event)
      }
      event.actionMasked == MotionEvent.ACTION_MOVE && event.pointerCount > 1
    }

    addView(
      textureView,
      FrameLayout.LayoutParams(
        LayoutParams.MATCH_PARENT,
        LayoutParams.MATCH_PARENT
      )
    )

    parseTrajectoryMetadata()
    emitRunnable.run()
  }

  fun onPropsUpdated() {
    if (isTornDown) {
      return
    }
    if (!arCoreEnabled) {
      prepareArCoreSession()
    }
    refreshPermissionState()
    highResCaptureAttempted = highResCaptureEnabled
    parseTrajectoryMetadata()
    applyTargetZoomIfNeeded()
    emitSessionState(forceStateChange = true)
  }

  fun teardown() {
    if (isTornDown) {
      return
    }
    isTornDown = true
    mainHandler.removeCallbacks(emitRunnable)
    stopCamera()
    releaseArCoreSession()
    if (cameraThread.isAlive) {
      cameraThread.quitSafely()
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (isTornDown) {
      return
    }
    refreshPermissionState()
    mainHandler.removeCallbacks(emitRunnable)
    emitRunnable.run()
    if (textureView.isAvailable && cameraDevice == null) {
      startCamera()
    }
  }

  override fun onDetachedFromWindow() {
    mainHandler.removeCallbacks(emitRunnable)
    stopCamera()
    super.onDetachedFromWindow()
  }

  override fun onSurfaceTextureAvailable(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
    if (isTornDown) {
      return
    }
    startCamera()
  }

  override fun onSurfaceTextureSizeChanged(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
    if (cameraDevice != null) {
      createPreviewSession()
    }
  }

  override fun onSurfaceTextureDestroyed(surfaceTexture: SurfaceTexture): Boolean {
    stopCamera()
    return true
  }

  override fun onSurfaceTextureUpdated(surfaceTexture: SurfaceTexture) {
    renderLoopRunning = sessionRunning
    if (sessionRunning && !arCoreEnabled && trackingState != "normal") {
      trackingState = "normal"
      trackingReason = null
      status = "running"
      statusMessage = runningMessage()
    }

    val pendingStartedAt = pendingZoomApplyStartedAtMs
    if (pendingStartedAt != null) {
      val now = SystemClock.elapsedRealtime()
      lastZoomProjectionSyncLatencyMs = (now - pendingStartedAt).toDouble().coerceAtLeast(0.0)
      pendingZoomApplyStartedAtMs = null
    }
  }

  private fun startCamera() {
    if (isTornDown || !textureView.isAvailable || cameraDevice != null) {
      return
    }

    refreshPermissionState()
    if (!hasCameraPermission()) {
      status = "unsupported"
      statusMessage = "Camera access is required for Android native AR trajectory."
      trackingState = "not_available"
      trackingReason = "camera_denied"
      emitError("camera_denied", "Camera access is required for Android native AR trajectory.", false)
      emitSessionState(forceStateChange = true)
      return
    }

    cameraPermission = "granted"
    if (cameraInfo.cameraId == null) {
      cameraInfo = TmzArTrajectoryCameraInfo.resolve(context)
      applyCameraInfo(cameraInfo)
    }

    val cameraId = resolveActiveCameraId()
    val manager = cameraManager
    if (cameraId == null || manager == null) {
      status = "unsupported"
      statusMessage = "No back camera is available for Android native AR trajectory."
      trackingState = "not_available"
      trackingReason = "camera_unavailable"
      emitError("camera_unavailable", "No back camera is available for Android native AR trajectory.", false)
      emitSessionState(forceStateChange = true)
      return
    }

    try {
      val callback =
        if (arCoreEnabled && sharedCamera != null) {
          sharedCamera?.createARDeviceStateCallback(cameraStateCallback, cameraHandler) ?: cameraStateCallback
        } else {
          cameraStateCallback
        }
      manager.openCamera(cameraId, callback, cameraHandler)
    } catch (securityError: SecurityException) {
      cameraPermission = "denied"
      status = "unsupported"
      statusMessage = "Camera permission is required for Android native AR trajectory."
      trackingState = "not_available"
      trackingReason = "camera_denied"
      emitError("camera_denied", "Camera permission is required for Android native AR trajectory.", false)
      emitSessionState(forceStateChange = true)
    } catch (error: Throwable) {
      status = "failed"
      statusMessage = "Unable to open Android camera."
      trackingState = "not_available"
      trackingReason = "camera_open_failed"
      emitError("camera_open_failed", error.message ?: "Unable to open Android camera.", true)
      emitSessionState(forceStateChange = true)
    }
  }

  private fun createPreviewSession() {
    if (isTornDown) {
      return
    }
    val camera = cameraDevice ?: return
    val texture = textureView.surfaceTexture ?: return

    val width = max(textureView.width, 1)
    val height = max(textureView.height, 1)
    texture.setDefaultBufferSize(width, height)

    try {
      captureSession?.close()
    } catch (_: Throwable) {
    }
    captureSession = null

    previewSurface?.release()
    previewSurface = Surface(texture)
    val surface = previewSurface ?: return

    try {
      val arSurfaces = mutableListOf<Surface>()
      val captureSurfaces = mutableListOf<Surface>()
      val shared = sharedCamera
      val activeCameraId = resolveActiveCameraId()

      if (arCoreEnabled && shared != null && activeCameraId != null) {
        arSurfaces.addAll(shared.arCoreSurfaces)
        if (arSurfaces.isNotEmpty()) {
          shared.setAppSurfaces(activeCameraId, listOf(surface))
          captureSurfaces.addAll(arSurfaces)
        }
      }

      captureSurfaces.add(surface)
      val requestTemplate = if (arCoreEnabled && arSurfaces.isNotEmpty()) CameraDevice.TEMPLATE_RECORD else CameraDevice.TEMPLATE_PREVIEW
      val builder = camera.createCaptureRequest(requestTemplate).apply {
        for (target in captureSurfaces) {
          addTarget(target)
        }
        set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
        set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO)
      }
      previewBuilder = builder
      applyZoomToBuilder(builder, zoomRatio)
      val wrappedCallback =
        if (arCoreEnabled && shared != null && arSurfaces.isNotEmpty()) {
          shared.createARSessionStateCallback(captureSessionCallback, cameraHandler)
        } else {
          captureSessionCallback
        }

      camera.createCaptureSession(captureSurfaces, wrappedCallback, cameraHandler)
    } catch (error: Throwable) {
      status = "failed"
      statusMessage = "Unable to configure Android camera preview."
      trackingState = "not_available"
      trackingReason = "camera_config_failed"
      emitError("camera_config_failed", error.message ?: "Unable to configure Android camera preview.", true)
      emitSessionState(forceStateChange = true)
    }
  }

  private fun stopCamera() {
    pauseArSessionIfNeeded()

    try {
      captureSession?.stopRepeating()
    } catch (_: Throwable) {
    }
    try {
      captureSession?.abortCaptures()
    } catch (_: Throwable) {
    }

    captureSession?.close()
    captureSession = null
    previewBuilder = null

    cameraDevice?.close()
    cameraDevice = null

    previewSurface?.release()
    previewSurface = null

    sessionRunning = false
    renderLoopRunning = false
    pendingZoomApplyStartedAtMs = null
    arLastTrackingState = null
    if (status != "failed" && status != "unsupported") {
      status = "initializing"
      statusMessage = "Preparing Android native AR trajectory preview."
      trackingState = "not_available"
      trackingReason = "session_closed"
    }
  }

  private fun hasCameraPermission(): Boolean {
    return ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
  }

  private fun prepareArCoreSession() {
    if (arCoreEnabled || arSession != null || isTornDown) {
      return
    }

    val arCoreSupported = try {
      Session.isSupported(context)
    } catch (_: Throwable) {
      false
    }
    if (!arCoreSupported) {
      return
    }

    try {
      val session = Session(context, EnumSet.of(Session.Feature.SHARED_CAMERA))
      val config = Config(session).apply {
        focusMode = Config.FocusMode.AUTO
        updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
        lightEstimationMode = Config.LightEstimationMode.DISABLED
        depthMode = Config.DepthMode.DISABLED
      }
      session.configure(config)
      arSession = session
      sharedCamera = session.sharedCamera
      arCoreEnabled = true
      if (statusMessage == null) {
        statusMessage = "ARCore world tracking is available. Starting camera guidance."
      }
    } catch (_: Throwable) {
      arCoreEnabled = false
      arSession = null
      sharedCamera = null
    }
  }

  private fun releaseArCoreSession() {
    pauseArSessionIfNeeded()
    try {
      arSession?.close()
    } catch (_: Throwable) {
    }
    arSession = null
    sharedCamera = null
    arCoreEnabled = false
  }

  private fun resolveActiveCameraId(): String? {
    if (arCoreEnabled) {
      val arCameraId = try {
        arSession?.cameraConfig?.cameraId
      } catch (_: Throwable) {
        null
      }
      if (!arCameraId.isNullOrBlank()) {
        return arCameraId
      }
    }
    return cameraInfo.cameraId
  }

  private fun resumeArSessionIfNeeded() {
    if (!arCoreEnabled || arSessionResumed) {
      return
    }
    val session = arSession ?: return

    try {
      session.resume()
      arSessionResumed = true
      sharedCamera?.setCaptureCallback(cameraCaptureCallback, cameraHandler)
      trackingState = "limited"
      trackingReason = "initializing"
      worldMappingStatus = "limited"
      status = "initializing"
      statusMessage = "ARCore world tracking is initializing. Move slowly for map stabilization."
      emitSessionState(forceStateChange = true)
    } catch (error: CameraNotAvailableException) {
      status = "failed"
      statusMessage = "ARCore camera is unavailable."
      trackingState = "not_available"
      trackingReason = "camera_unavailable"
      emitError("arcore_camera_unavailable", error.message ?: "ARCore camera is unavailable.", true)
      emitSessionState(forceStateChange = true)
    } catch (error: Throwable) {
      status = "failed"
      statusMessage = "Unable to resume ARCore tracking."
      trackingState = "not_available"
      trackingReason = "arcore_resume_failed"
      emitError("arcore_resume_failed", error.message ?: "Unable to resume ARCore tracking.", true)
      emitSessionState(forceStateChange = true)
    }
  }

  private fun pauseArSessionIfNeeded() {
    if (!arCoreEnabled || !arSessionResumed) {
      return
    }
    try {
      arSession?.pause()
    } catch (_: Throwable) {
    }
    arSessionResumed = false
  }

  private fun updateArTrackingState() {
    if (!arCoreEnabled || !arSessionResumed) {
      return
    }
    val session = arSession ?: return
    val frame: Frame = try {
      session.update()
    } catch (_: CameraNotAvailableException) {
      status = "failed"
      statusMessage = "ARCore camera became unavailable."
      trackingState = "not_available"
      trackingReason = "camera_unavailable"
      emitSessionState(forceStateChange = true)
      return
    } catch (_: Throwable) {
      return
    }

    val camera = frame.camera
    val nextState = camera.trackingState
    if (arLastTrackingState == TrackingState.TRACKING && nextState == TrackingState.PAUSED && camera.trackingFailureReason == TrackingFailureReason.BAD_STATE) {
      relocalizationCount += 1
    }
    arLastTrackingState = nextState

    when (nextState) {
      TrackingState.TRACKING -> {
        trackingState = "normal"
        trackingReason = null
        worldMappingStatus = "extending"
        status = "running"
        statusMessage = runningMessage()
      }

      TrackingState.PAUSED -> {
        trackingState = "limited"
        trackingReason = mapArTrackingReason(camera.trackingFailureReason)
        worldMappingStatus = "limited"
        status = "initializing"
        statusMessage = limitedTrackingMessage(trackingReason)
      }

      TrackingState.STOPPED -> {
        trackingState = "not_available"
        trackingReason = "stopped"
        worldMappingStatus = "not_available"
        status = "failed"
        statusMessage = "ARCore tracking stopped."
      }
    }

    projectionSource = try {
      val focal = FloatArray(2)
      camera.imageIntrinsics.getFocalLength(focal, 0)
      if (focal[0] > 0f && focal[1] > 0f) "intrinsics_frame" else "projection_matrix"
    } catch (_: Throwable) {
      "projection_matrix"
    }

    emitSessionState()
  }

  private fun mapArTrackingReason(reason: TrackingFailureReason): String {
    return when (reason) {
      TrackingFailureReason.NONE -> "initializing"
      TrackingFailureReason.BAD_STATE -> "relocalizing"
      TrackingFailureReason.INSUFFICIENT_LIGHT -> "insufficient_light"
      TrackingFailureReason.EXCESSIVE_MOTION -> "excessive_motion"
      TrackingFailureReason.INSUFFICIENT_FEATURES -> "insufficient_features"
      TrackingFailureReason.CAMERA_UNAVAILABLE -> "camera_unavailable"
      else -> "unknown"
    }
  }

  private fun limitedTrackingMessage(reason: String?): String {
    return when (reason) {
      "insufficient_light" -> "ARCore tracking limited by low light. Increase lighting and move slowly."
      "insufficient_features" -> "ARCore tracking limited by scene detail. Aim at textured surfaces."
      "excessive_motion" -> "ARCore tracking limited by motion. Slow down camera movement."
      "camera_unavailable" -> "ARCore lost camera access. Resume app or retry."
      "relocalizing" -> "ARCore is relocalizing. Hold steady and scan nearby surfaces."
      else -> "ARCore world tracking is initializing. Move slowly to stabilize."
    }
  }

  private fun hasFineLocationPermission(): Boolean {
    return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
  }

  private fun hasCoarseLocationPermission(): Boolean {
    return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
  }

  private fun refreshPermissionState() {
    cameraPermission = if (hasCameraPermission()) "granted" else "denied"

    when {
      hasFineLocationPermission() -> {
        locationPermission = "granted"
        locationAccuracy = "full"
      }

      hasCoarseLocationPermission() -> {
        locationPermission = "granted"
        locationAccuracy = "reduced"
      }

      else -> {
        locationPermission = "denied"
        locationAccuracy = "unknown"
      }
    }
  }

  private fun applyCameraInfo(info: TmzBackCameraInfo) {
    zoomSupported = info.supportsZoom
    zoomRangeMin = info.minZoomRatio
    zoomRangeMax = info.maxZoomRatio
    zoomRatio = TmzArTrajectoryCameraInfo.clampZoom(info.defaultZoomRatio, zoomRangeMin, zoomRangeMax)
    zoomControlPath = if (zoomSupported) "native_camera" else "unsupported"
    projectionSource = if (zoomSupported) "projection_matrix" else "preset"
  }

  private fun applyTargetZoomIfNeeded() {
    val target = targetZoomRatio ?: return
    applyZoom(target, "prop_target")
  }

  private fun clampZoomRatio(value: Double): Double {
    return TmzArTrajectoryCameraInfo.clampZoom(value, zoomRangeMin, zoomRangeMax)
  }

  private fun applyZoom(targetValue: Double, reason: String): Boolean {
    if (!zoomSupported) {
      return false
    }

    val builder = previewBuilder ?: return false
    val session = captureSession ?: return false

    val target = clampZoomRatio(targetValue)
    if (abs(target - zoomRatio) < 0.01) {
      return false
    }

    val now = SystemClock.elapsedRealtime()
    if (reason == "pinch" && now - lastZoomApplyAtMs < 33) {
      return false
    }

    val startedAt = now
    return try {
      applyZoomToBuilder(builder, target)
      session.setRepeatingRequest(builder.build(), cameraCaptureCallback, cameraHandler)
      zoomRatio = target
      zoomControlPath = "native_camera"
      lastZoomApplyAtMs = now
      lastZoomApplyLatencyMs = (SystemClock.elapsedRealtime() - startedAt).toDouble().coerceAtLeast(0.0)
      pendingZoomApplyStartedAtMs = startedAt
      emitSessionState(forceStateChange = true)
      true
    } catch (error: Throwable) {
      zoomControlPath = "unsupported"
      statusMessage = "Unable to adjust Android camera zoom."
      emitError("zoom_apply_failed", error.message ?: "Unable to adjust Android camera zoom.", true)
      false
    }
  }

  private fun applyZoomToBuilder(builder: CaptureRequest.Builder, zoom: Double) {
    val safeZoom = clampZoomRatio(zoom)
    if (cameraInfo.useZoomRatioControl && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      builder.set(CaptureRequest.CONTROL_ZOOM_RATIO, safeZoom.toFloat())
      return
    }

    val activeArray = cameraInfo.activeArray ?: return
    builder.set(CaptureRequest.SCALER_CROP_REGION, TmzArTrajectoryCameraInfo.buildCropRegion(activeArray, safeZoom))
  }

  private fun parseTrajectoryMetadata() {
    val source = trajectoryJson
    if (source.isBlank()) {
      hasTrajectory = false
      parsedQualityState = null
      sampleCount = 0
      milestoneCount = 0
      return
    }

    try {
      val root = JSONObject(source)
      hasTrajectory = true
      parsedQualityState = root.optString("qualityState").takeIf { it.isNotBlank() }
      val tracks = root.optJSONArray("tracks")
      var sampleTotal = 0
      if (tracks != null) {
        for (index in 0 until tracks.length()) {
          val track = tracks.optJSONObject(index) ?: continue
          val samples = track.optJSONArray("samples")
          sampleTotal += samples?.length() ?: 0
        }
      }
      sampleCount = sampleTotal
      milestoneCount = root.optJSONArray("milestones")?.length() ?: 0
    } catch (_: Throwable) {
      hasTrajectory = source.isNotBlank()
      parsedQualityState = null
      sampleCount = 0
      milestoneCount = 0
    }
  }

  private fun emitSessionState(forceStateChange: Boolean = false) {
    val fingerprint = listOf(
      status,
      trackingState,
      trackingReason.orEmpty(),
      worldMappingStatus,
      if (renderLoopRunning) "1" else "0",
      String.format(Locale.US, "%.2f", zoomRatio),
      zoomControlPath,
      statusMessage.orEmpty()
    ).joinToString("|")

    val now = SystemClock.elapsedRealtime()
    val fingerprintChanged = forceStateChange || fingerprint != lastFingerprint
    if (fingerprintChanged) {
      lastFingerprint = fingerprint
      dispatchEvent("onSessionStateChange", createPayloadMap())
    }

    if (fingerprintChanged || now - lastSessionUpdateEmissionAtMs >= 750) {
      lastSessionUpdateEmissionAtMs = now
      dispatchEvent("onSessionUpdate", createPayloadMap())
    }
  }

  private fun createPayloadMap(): WritableMap {
    refreshPermissionState()
    val payload = Arguments.createMap()
    payload.putBoolean("sessionRunning", sessionRunning)
    payload.putString("status", status)
    payload.putString("trackingState", trackingState)
    if (trackingReason != null) {
      payload.putString("trackingReason", trackingReason)
    } else {
      payload.putNull("trackingReason")
    }
    payload.putString("worldAlignment", resolveWorldAlignment())
    payload.putString("worldMappingStatus", worldMappingStatus)
    payload.putBoolean("lidarAvailable", false)
    payload.putBoolean("sceneDepthEnabled", false)
    payload.putBoolean("sceneReconstructionEnabled", false)
    payload.putString("geoTrackingState", "not_available")
    payload.putString("geoTrackingAccuracy", "unknown")
    payload.putString("occlusionMode", occlusionMode)
    payload.putInt("relocalizationCount", relocalizationCount)
    payload.putBoolean("renderLoopRunning", renderLoopRunning)
    payload.putBoolean("highResCaptureAttempted", highResCaptureAttempted)
    payload.putBoolean("highResCaptureSucceeded", highResCaptureSucceeded)
    payload.putBoolean("hasTrajectory", hasTrajectory)

    val effectiveQuality = qualityState ?: parsedQualityState
    if (effectiveQuality != null) {
      payload.putString("qualityState", effectiveQuality)
    } else {
      payload.putNull("qualityState")
    }

    payload.putInt("sampleCount", sampleCount)
    payload.putInt("milestoneCount", milestoneCount)
    payload.putBoolean("zoomSupported", zoomSupported)
    payload.putDouble("zoomRatio", zoomRatio)
    payload.putDouble("zoomRangeMin", zoomRangeMin)
    payload.putDouble("zoomRangeMax", zoomRangeMax)
    payload.putString("zoomControlPath", zoomControlPath)
    payload.putString("projectionSource", projectionSource)
    payload.putString("zoomRatioBucket", bucketZoomRatio(zoomRatio))
    payload.putString("zoomApplyLatencyBucket", bucketLatencyMs(lastZoomApplyLatencyMs))
    payload.putString("zoomProjectionSyncLatencyBucket", bucketLatencyMs(lastZoomProjectionSyncLatencyMs))
    payload.putString("lastUpdatedAt", nowIso())

    payload.putString("cameraPermission", cameraPermission)
    payload.putString("motionPermission", motionPermission)
    payload.putString("locationPermission", locationPermission)
    payload.putString("locationAccuracy", locationAccuracy)
    payload.putString("headingSource", "unknown")
    payload.putString("poseSource", "deviceorientation")
    payload.putString("poseMode", "sensor_fused")
    payload.putString("visionBackend", "none")
    if (statusMessage != null) {
      payload.putString("message", statusMessage)
    } else {
      payload.putNull("message")
    }
    payload.putInt("retryCount", retryCount)
    return payload
  }

  private fun dispatchEvent(eventName: String, payload: WritableMap) {
    val reactContext = context as? ReactContext ?: appContext.reactContext ?: return
    reactContext.getJSModule(RCTEventEmitter::class.java).receiveEvent(id, eventName, payload)
  }

  private fun emitError(code: String, message: String, recoverable: Boolean) {
    val payload = Arguments.createMap().apply {
      putString("code", code)
      putString("message", message)
      putBoolean("recoverable", recoverable)
    }
    dispatchEvent("onSessionError", payload)
  }

  private fun resolveWorldAlignment(): String {
    if (!supportsHeadingAlignment()) {
      return if (arCoreEnabled) {
        if (worldAlignmentPreference == "camera") "camera" else "gravity"
      } else {
        "camera"
      }
    }

    return when (worldAlignmentPreference) {
      "gravity" -> "gravity"
      "camera" -> "camera"
      else -> "gravity_and_heading"
    }
  }

  private fun supportsHeadingAlignment(): Boolean {
    return false
  }

  private fun runningMessage(): String {
    val runtimeLabel = if (arCoreEnabled) "Android ARCore tracking" else "Android camera guidance"
    return if (locationPermission == "granted") {
      "$runtimeLabel active. Pinch to adjust zoom."
    } else {
      "$runtimeLabel active. Enable location for launch-site alignment."
    }
  }

  private fun bucketZoomRatio(value: Double): String {
    if (!zoomSupported || !value.isFinite() || value <= 0) {
      return "unsupported"
    }
    if (value < 0.75) return "0.5..0.75"
    if (value < 1.0) return "0.75..1.0"
    if (value < 1.5) return "1.0..1.5"
    if (value < 2.0) return "1.5..2.0"
    if (value < 2.5) return "2.0..2.5"
    if (value < 3.0) return "2.5..3.0"
    return "3.0+"
  }

  private fun bucketLatencyMs(value: Double): String {
    if (!value.isFinite() || value < 0) {
      return "unknown"
    }
    if (value < 16) return "<16ms"
    if (value < 33) return "16..33ms"
    if (value < 50) return "33..50ms"
    if (value < 100) return "50..100ms"
    return "100ms+"
  }

  private fun nowIso(): String {
    return synchronized(isoFormatter) {
      isoFormatter.format(Date())
    }
  }

  companion object {
    private val isoFormatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
      timeZone = TimeZone.getTimeZone("UTC")
    }
  }
}
