import ExpoModulesCore
import MapKit

internal final class TmzLaunchMapView: ExpoView, MKMapViewDelegate {
  var advisoriesJson: String = "[]"
  var boundsJson: String?
  var padJson: String?
  var interactive: Bool = false
  var renderMode: String = "auto"

  private let mapView = MKMapView(frame: .zero)
  private let decoder = JSONDecoder()
  private let padPreviewDistanceMeters: CLLocationDistance = 1_200
  private let boundsEdgePadding = UIEdgeInsets(top: 28, left: 28, bottom: 28, right: 28)
  private var pendingBounds: BoundsPayload?
  private var pendingPad: PadPayload?
  private var hasPendingViewportUpdate = false

  private struct CoordinatePayload: Codable {
    let latitude: Double
    let longitude: Double
  }

  private struct BoundsPayload: Codable {
    let minLatitude: Double
    let minLongitude: Double
    let maxLatitude: Double
    let maxLongitude: Double
  }

  private struct PolygonPayload: Codable {
    let polygonId: String
    let outerRing: [CoordinatePayload]
    let holes: [[CoordinatePayload]]
  }

  private struct AdvisoryPayload: Codable {
    let polygons: [PolygonPayload]
  }

  private struct PadPayload: Codable {
    let latitude: Double?
    let longitude: Double?
    let label: String?
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    backgroundColor = .black
    clipsToBounds = true

    mapView.translatesAutoresizingMaskIntoConstraints = false
    mapView.delegate = self
    mapView.mapType = .satellite
    mapView.showsCompass = false
    mapView.showsScale = false
    mapView.pointOfInterestFilter = .excludingAll

    addSubview(mapView)
    NSLayoutConstraint.activate([
      mapView.leadingAnchor.constraint(equalTo: leadingAnchor),
      mapView.trailingAnchor.constraint(equalTo: trailingAnchor),
      mapView.topAnchor.constraint(equalTo: topAnchor),
      mapView.bottomAnchor.constraint(equalTo: bottomAnchor)
    ])
  }

  deinit {
    teardown()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    updateVisibleRegionIfReady()
  }

  func onPropsUpdated() {
    mapView.mapType = .satellite
    mapView.isScrollEnabled = interactive
    mapView.isZoomEnabled = interactive
    mapView.isRotateEnabled = interactive
    mapView.isPitchEnabled = interactive
    renderMap()
  }

  func teardown() {
    mapView.delegate = nil
    mapView.removeOverlays(mapView.overlays)
    mapView.removeAnnotations(mapView.annotations)
  }

  func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
    guard let polygon = overlay as? MKPolygon else {
      return MKOverlayRenderer(overlay: overlay)
    }

    let renderer = MKPolygonRenderer(polygon: polygon)
    renderer.fillColor = UIColor(red: 1.0, green: 0.34, blue: 0.24, alpha: 0.24)
    renderer.strokeColor = UIColor(red: 1.0, green: 0.39, blue: 0.29, alpha: 0.96)
    renderer.lineWidth = interactive ? 2.5 : 2.0
    return renderer
  }

  func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
    guard !(annotation is MKUserLocation) else {
      return nil
    }

    let identifier = "TmzLaunchMapPad"
    let view = mapView.dequeueReusableAnnotationView(withIdentifier: identifier) as? MKMarkerAnnotationView
      ?? MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: identifier)
    view.annotation = annotation
    view.markerTintColor = UIColor(red: 1.0, green: 0.47, blue: 0.17, alpha: 1.0)
    view.glyphTintColor = .white
    view.glyphText = "P"
    return view
  }

  private func renderMap() {
    mapView.removeOverlays(mapView.overlays)
    mapView.removeAnnotations(mapView.annotations)

    let advisories = shouldRenderAdvisories ? (decodeArray([AdvisoryPayload].self, from: advisoriesJson) ?? []) : []
    let pad = decodeValue(PadPayload.self, from: padJson)
    let bounds = shouldUseBounds ? decodeValue(BoundsPayload.self, from: boundsJson) : nil
    pendingBounds = bounds
    pendingPad = pad
    hasPendingViewportUpdate = true

    for advisory in advisories {
      for polygon in advisory.polygons {
        guard polygon.outerRing.count >= 3 else {
          continue
        }

        let outerCoordinates = polygon.outerRing.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
        let interiorPolygons = polygon.holes.compactMap { hole -> MKPolygon? in
          guard hole.count >= 3 else {
            return nil
          }
          let holeCoordinates = hole.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
          return makePolygon(coordinates: holeCoordinates)
        }

        let overlay = makePolygon(coordinates: outerCoordinates, interiorPolygons: interiorPolygons)
        mapView.addOverlay(overlay)
      }
    }

    if let padLatitude = pad?.latitude, let padLongitude = pad?.longitude {
      let annotation = MKPointAnnotation()
      annotation.coordinate = CLLocationCoordinate2D(latitude: padLatitude, longitude: padLongitude)
      annotation.title = pad?.label ?? "Launch pad"
      mapView.addAnnotation(annotation)
    }

    updateVisibleRegionIfReady()
  }

  private func updateVisibleRegionIfReady() {
    guard hasPendingViewportUpdate, mapView.bounds.width > 0, mapView.bounds.height > 0 else {
      return
    }

    applyVisibleRegion(bounds: pendingBounds, pad: pendingPad)
    hasPendingViewportUpdate = false
  }

  private func applyVisibleRegion(bounds: BoundsPayload?, pad: PadPayload?) {
    if let bounds, hasArea(bounds) {
      let rect = mapRect(for: bounds)
      mapView.setVisibleMapRect(rect, edgePadding: boundsEdgePadding, animated: false)
      return
    }

    if let padLatitude = pad?.latitude, let padLongitude = pad?.longitude {
      let region = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: padLatitude, longitude: padLongitude),
        latitudinalMeters: padPreviewDistanceMeters,
        longitudinalMeters: padPreviewDistanceMeters
      )
      mapView.setRegion(mapView.regionThatFits(region), animated: false)
    }
  }

  private func hasArea(_ bounds: BoundsPayload) -> Bool {
    abs(bounds.maxLatitude - bounds.minLatitude) > 0.0001 || abs(bounds.maxLongitude - bounds.minLongitude) > 0.0001
  }

  private var shouldRenderAdvisories: Bool {
    renderMode != "pad"
  }

  private var shouldUseBounds: Bool {
    renderMode != "pad"
  }

  private func decodeArray<T: Decodable>(_ type: T.Type, from json: String?) -> T? {
    guard let json = json?.data(using: .utf8), !json.isEmpty else {
      return nil
    }
    return try? decoder.decode(type, from: json)
  }

  private func decodeValue<T: Decodable>(_ type: T.Type, from json: String?) -> T? {
    guard let json = json?.data(using: .utf8), !json.isEmpty else {
      return nil
    }
    return try? decoder.decode(type, from: json)
  }

  private func makePolygon(coordinates: [CLLocationCoordinate2D], interiorPolygons: [MKPolygon] = []) -> MKPolygon {
    var mutableCoordinates = coordinates
    return MKPolygon(coordinates: &mutableCoordinates, count: mutableCoordinates.count, interiorPolygons: interiorPolygons)
  }

  private func mapRect(for bounds: BoundsPayload) -> MKMapRect {
    let southWest = MKMapPoint(CLLocationCoordinate2D(latitude: bounds.minLatitude, longitude: bounds.minLongitude))
    let northEast = MKMapPoint(CLLocationCoordinate2D(latitude: bounds.maxLatitude, longitude: bounds.maxLongitude))
    let origin = MKMapPoint(x: min(southWest.x, northEast.x), y: min(southWest.y, northEast.y))
    let size = MKMapSize(
      width: max(1, abs(northEast.x - southWest.x)),
      height: max(1, abs(northEast.y - southWest.y))
    )
    return MKMapRect(origin: origin, size: size)
  }
}
