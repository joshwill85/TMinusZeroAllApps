package expo.modules.tmzlaunchmap

import android.content.Context
import android.content.pm.PackageManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TmzLaunchMapModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TmzLaunchMap")

    AsyncFunction("getCapabilitiesAsync") {
      val context = appContext.currentActivity?.applicationContext ?: appContext.reactContext ?: return@AsyncFunction mapOf(
        "isAvailable" to false,
        "provider" to "none",
        "reason" to "Android context is unavailable for native launch maps."
      )

      buildCapabilities(context)
    }

    View(TmzLaunchMapView::class) {
      Prop("advisoriesJson") { view: TmzLaunchMapView, advisoriesJson: String? ->
        view.advisoriesJson = advisoriesJson ?: "[]"
      }

      Prop("boundsJson") { view: TmzLaunchMapView, boundsJson: String? ->
        view.boundsJson = boundsJson
      }

      Prop("padJson") { view: TmzLaunchMapView, padJson: String? ->
        view.padJson = padJson
      }

      Prop("interactive", false) { view: TmzLaunchMapView, interactive: Boolean ->
        view.interactive = interactive
      }

      Prop("renderMode", "auto") { view: TmzLaunchMapView, renderMode: String ->
        view.renderMode = renderMode
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
    return if (hasGoogleMapsApiKey(context)) {
      mapOf(
        "isAvailable" to true,
        "provider" to "google",
        "reason" to null
      )
    } else {
      mapOf(
        "isAvailable" to false,
        "provider" to "none",
        "reason" to "GOOGLE_MAPS_ANDROID_API_KEY is not configured for native launch maps."
      )
    }
  }

  private fun hasGoogleMapsApiKey(context: Context): Boolean {
    return try {
      val appInfo = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
      val value = appInfo.metaData?.getString("com.google.android.geo.API_KEY")?.trim()
      !value.isNullOrEmpty()
    } catch (_: Throwable) {
      false
    }
  }
}
