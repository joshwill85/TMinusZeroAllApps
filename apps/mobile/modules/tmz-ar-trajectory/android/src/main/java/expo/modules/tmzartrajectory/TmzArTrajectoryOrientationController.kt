package expo.modules.tmzartrajectory

import android.app.Activity
import android.content.pm.ActivityInfo

internal object TmzArTrajectoryOrientationController {
  fun lock(activity: Activity, orientation: String): Boolean {
    val requested = when (orientation) {
      "portrait" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
      "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
      "all" -> ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
      else -> return false
    }

    activity.requestedOrientation = requested
    return true
  }

  fun unlock(activity: Activity): Boolean {
    activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    return true
  }
}
