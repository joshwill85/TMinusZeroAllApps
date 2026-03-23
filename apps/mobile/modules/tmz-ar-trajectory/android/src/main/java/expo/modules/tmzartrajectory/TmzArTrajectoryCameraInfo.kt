package expo.modules.tmzartrajectory

import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Rect
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import kotlin.math.max
import kotlin.math.min

internal data class TmzBackCameraInfo(
  val cameraId: String?,
  val hasBackCamera: Boolean,
  val hasArFeature: Boolean,
  val supportsZoom: Boolean,
  val minZoomRatio: Double,
  val maxZoomRatio: Double,
  val defaultZoomRatio: Double,
  val useZoomRatioControl: Boolean,
  val activeArray: Rect?
)

internal object TmzArTrajectoryCameraInfo {
  private const val MIN_ZOOM_GLOBAL = 0.5
  private const val MAX_ZOOM_GLOBAL = 3.0

  fun resolve(context: Context): TmzBackCameraInfo {
    val packageManager = context.packageManager
    val hasArFeature = packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_AR)

    val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
      ?: return unsupported(hasArFeature)

    return try {
      val backCameraId = cameraManager.cameraIdList.firstOrNull { id ->
        val characteristics = cameraManager.getCameraCharacteristics(id)
        characteristics.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
      } ?: return unsupported(hasArFeature)

      val characteristics = cameraManager.getCameraCharacteristics(backCameraId)
      var useZoomRatioControl = false
      var minZoomRatio = 1.0
      var maxZoomRatio = 1.0

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val ratioRange = characteristics.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)
        if (ratioRange != null) {
          useZoomRatioControl = true
          minZoomRatio = ratioRange.lower.toDouble()
          maxZoomRatio = ratioRange.upper.toDouble()
        }
      }

      if (!useZoomRatioControl) {
        val maxDigitalZoom = characteristics.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM)?.toDouble() ?: 1.0
        minZoomRatio = 1.0
        maxZoomRatio = maxDigitalZoom
      }

      val clampedMin = clamp(minZoomRatio, MIN_ZOOM_GLOBAL, MAX_ZOOM_GLOBAL)
      val clampedMax = clamp(maxZoomRatio, clampedMin, MAX_ZOOM_GLOBAL)
      val supportsZoom = clampedMax > clampedMin + 0.01

      TmzBackCameraInfo(
        cameraId = backCameraId,
        hasBackCamera = true,
        hasArFeature = hasArFeature,
        supportsZoom = supportsZoom,
        minZoomRatio = clampedMin,
        maxZoomRatio = clampedMax,
        defaultZoomRatio = clamp(1.0, clampedMin, clampedMax),
        useZoomRatioControl = useZoomRatioControl,
        activeArray = characteristics.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
      )
    } catch (_: Throwable) {
      unsupported(hasArFeature)
    }
  }

  fun clampZoom(value: Double, minZoom: Double, maxZoom: Double): Double {
    return clamp(value, minZoom, maxZoom)
  }

  fun buildCropRegion(activeArray: Rect, zoomRatio: Double): Rect {
    val safeZoom = max(1.0, zoomRatio)
    val sensorWidth = activeArray.width().toDouble()
    val sensorHeight = activeArray.height().toDouble()
    val cropWidth = (sensorWidth / safeZoom).toInt().coerceAtLeast(1)
    val cropHeight = (sensorHeight / safeZoom).toInt().coerceAtLeast(1)
    val left = activeArray.left + ((activeArray.width() - cropWidth) / 2)
    val top = activeArray.top + ((activeArray.height() - cropHeight) / 2)
    return Rect(left, top, left + cropWidth, top + cropHeight)
  }

  private fun unsupported(hasArFeature: Boolean): TmzBackCameraInfo {
    return TmzBackCameraInfo(
      cameraId = null,
      hasBackCamera = false,
      hasArFeature = hasArFeature,
      supportsZoom = false,
      minZoomRatio = 1.0,
      maxZoomRatio = 1.0,
      defaultZoomRatio = 1.0,
      useZoomRatioControl = false,
      activeArray = null
    )
  }

  private fun clamp(value: Double, minValue: Double, maxValue: Double): Double {
    return min(max(value, minValue), maxValue)
  }
}
