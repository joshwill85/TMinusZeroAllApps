package expo.modules.tmzlaunchmap

import android.content.Context
import android.widget.FrameLayout
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactContext
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.GoogleMap
import com.google.android.gms.maps.MapView
import com.google.android.gms.maps.MapsInitializer
import com.google.android.gms.maps.OnMapReadyCallback
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.android.gms.maps.model.MarkerOptions
import com.google.android.gms.maps.model.PolygonOptions
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.max

internal class TmzLaunchMapView(context: Context, appContext: AppContext) : ExpoView(context, appContext), OnMapReadyCallback, LifecycleEventListener {
  var advisoriesJson: String = "[]"
  var boundsJson: String? = null
  var padJson: String? = null
  var interactive: Boolean = false

  private val mapView = MapView(context)
  private val reactContext = appContext.reactContext as? ReactContext
  private var googleMap: GoogleMap? = null
  private var isTornDown = false

  init {
    layoutParams = FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    mapView.layoutParams = FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    addView(mapView)

    MapsInitializer.initialize(context)
    mapView.onCreate(null)
    mapView.onStart()
    mapView.onResume()
    mapView.getMapAsync(this)
    reactContext?.addLifecycleEventListener(this)
  }

  override fun onMapReady(map: GoogleMap) {
    if (isTornDown) {
      return
    }
    googleMap = map
    renderMap()
  }

  fun onPropsUpdated() {
    renderMap()
  }

  fun teardown() {
    if (isTornDown) {
      return
    }
    isTornDown = true
    reactContext?.removeLifecycleEventListener(this)
    googleMap?.clear()
    googleMap = null
    mapView.onPause()
    mapView.onStop()
    mapView.onDestroy()
  }

  override fun onHostResume() {
    if (!isTornDown) {
      mapView.onResume()
    }
  }

  override fun onHostPause() {
    if (!isTornDown) {
      mapView.onPause()
    }
  }

  override fun onHostDestroy() {
    teardown()
  }

  private fun renderMap() {
    val map = googleMap ?: return

    map.clear()
    map.mapType = GoogleMap.MAP_TYPE_SATELLITE
    map.isBuildingsEnabled = false
    map.uiSettings.isCompassEnabled = false
    map.uiSettings.isMapToolbarEnabled = interactive
    map.uiSettings.isRotateGesturesEnabled = interactive
    map.uiSettings.isScrollGesturesEnabled = interactive
    map.uiSettings.isTiltGesturesEnabled = interactive
    map.uiSettings.isZoomControlsEnabled = false
    map.uiSettings.isZoomGesturesEnabled = interactive

    val advisories = parseAdvisories(advisoriesJson)
    val pad = parsePad(padJson)
    val bounds = parseBounds(boundsJson)

    advisories.forEach { advisory ->
      advisory.polygons.forEach { polygon ->
        if (polygon.outerRing.size < 3) {
          return@forEach
        }

        val options = PolygonOptions()
          .addAll(polygon.outerRing.map { LatLng(it.latitude, it.longitude) })
          .strokeColor(0xFFF76149.toInt())
          .fillColor(0x40F76149)
          .strokeWidth(if (interactive) 5f else 4f)

        polygon.holes
          .filter { hole -> hole.size >= 3 }
          .forEach { hole ->
            options.addHole(hole.map { LatLng(it.latitude, it.longitude) })
          }

        map.addPolygon(options)
      }
    }

    if (pad?.latitude != null && pad.longitude != null) {
      map.addMarker(
        MarkerOptions()
          .position(LatLng(pad.latitude, pad.longitude))
          .title(pad.label ?: "Launch pad")
      )
    }

    when {
      bounds != null && hasArea(bounds) -> {
        val latLngBounds = LatLngBounds(
          LatLng(bounds.minLatitude, bounds.minLongitude),
          LatLng(bounds.maxLatitude, bounds.maxLongitude)
        )
        mapView.post {
          if (!isTornDown) {
            map.moveCamera(CameraUpdateFactory.newLatLngBounds(latLngBounds, 72))
          }
        }
      }
      pad?.latitude != null && pad.longitude != null -> {
        map.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(pad.latitude, pad.longitude), 17f))
      }
    }
  }

  private fun hasArea(bounds: BoundsPayload): Boolean {
    return abs(bounds.maxLatitude - bounds.minLatitude) > 0.0001 || abs(bounds.maxLongitude - bounds.minLongitude) > 0.0001
  }

  private fun parseAdvisories(json: String): List<AdvisoryPayload> {
    return runCatching {
      val advisories = JSONArray(json)
      buildList {
        for (index in 0 until advisories.length()) {
          val advisory = advisories.optJSONObject(index) ?: continue
          add(
            AdvisoryPayload(
              polygons = parsePolygons(advisory.optJSONArray("polygons"))
            )
          )
        }
      }
    }.getOrDefault(emptyList())
  }

  private fun parsePolygons(polygons: JSONArray?): List<PolygonPayload> {
    if (polygons == null) {
      return emptyList()
    }

    return buildList {
      for (index in 0 until polygons.length()) {
        val polygon = polygons.optJSONObject(index) ?: continue
        add(
          PolygonPayload(
            outerRing = parseCoordinateArray(polygon.optJSONArray("outerRing")),
            holes = parseHoleArrays(polygon.optJSONArray("holes"))
          )
        )
      }
    }
  }

  private fun parseHoleArrays(holes: JSONArray?): List<List<CoordinatePayload>> {
    if (holes == null) {
      return emptyList()
    }

    return buildList {
      for (index in 0 until holes.length()) {
        add(parseCoordinateArray(holes.optJSONArray(index)))
      }
    }
  }

  private fun parseCoordinateArray(array: JSONArray?): List<CoordinatePayload> {
    if (array == null) {
      return emptyList()
    }

    return buildList {
      for (index in 0 until array.length()) {
        val coordinate = array.optJSONObject(index) ?: continue
        val latitude = coordinate.optDouble("latitude", Double.NaN)
        val longitude = coordinate.optDouble("longitude", Double.NaN)
        if (!latitude.isFinite() || !longitude.isFinite()) {
          continue
        }
        add(CoordinatePayload(latitude, longitude))
      }
    }
  }

  private fun parseBounds(json: String?): BoundsPayload? {
    val objectValue = parseObject(json) ?: return null
    val minLatitude = objectValue.optDouble("minLatitude", Double.NaN)
    val minLongitude = objectValue.optDouble("minLongitude", Double.NaN)
    val maxLatitude = objectValue.optDouble("maxLatitude", Double.NaN)
    val maxLongitude = objectValue.optDouble("maxLongitude", Double.NaN)
    if (!minLatitude.isFinite() || !minLongitude.isFinite() || !maxLatitude.isFinite() || !maxLongitude.isFinite()) {
      return null
    }

    return BoundsPayload(minLatitude, minLongitude, maxLatitude, maxLongitude)
  }

  private fun parsePad(json: String?): PadPayload? {
    val objectValue = parseObject(json) ?: return null
    val latitude = objectValue.optDouble("latitude", Double.NaN)
    val longitude = objectValue.optDouble("longitude", Double.NaN)
    return PadPayload(
      latitude = if (latitude.isFinite()) latitude else null,
      longitude = if (longitude.isFinite()) longitude else null,
      label = objectValue.optString("label", null)
    )
  }

  private fun parseObject(json: String?): JSONObject? {
    if (json.isNullOrBlank()) {
      return null
    }
    return runCatching { JSONObject(json) }.getOrNull()
  }

  private data class CoordinatePayload(
    val latitude: Double,
    val longitude: Double
  )

  private data class PolygonPayload(
    val outerRing: List<CoordinatePayload>,
    val holes: List<List<CoordinatePayload>>
  )

  private data class AdvisoryPayload(
    val polygons: List<PolygonPayload>
  )

  private data class BoundsPayload(
    val minLatitude: Double,
    val minLongitude: Double,
    val maxLatitude: Double,
    val maxLongitude: Double
  )

  private data class PadPayload(
    val latitude: Double?,
    val longitude: Double?,
    val label: String?
  )
}
