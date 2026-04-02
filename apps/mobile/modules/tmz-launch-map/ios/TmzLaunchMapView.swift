import ExpoModulesCore
import MapKit

internal final class TmzLaunchMapView: ExpoView, MKMapViewDelegate {
  var advisoriesJson: String = "[]"
  var boundsJson: String?
  var padJson: String?
  var interactive: Bool = false

  private let mapView = MKMapView(frame: .zero)
  private let decoder = JSONDecoder()

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

    let advisories = decodeArray([AdvisoryPayload].self, from: advisoriesJson) ?? []
    let pad = decodeValue(PadPayload.self, from: padJson)
    let bounds = decodeValue(BoundsPayload.self, from: boundsJson)

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

    applyVisibleRegion(bounds: bounds, pad: pad)
  }

  private func applyVisibleRegion(bounds: BoundsPayload?, pad: PadPayload?) {
    if let bounds {
      let latitudeDelta = max(0.08, abs(bounds.maxLatitude - bounds.minLatitude) * 1.25)
      let longitudeDelta = max(0.08, abs(bounds.maxLongitude - bounds.minLongitude) * 1.25)
      let region = MKCoordinateRegion(
        center: CLLocationCoordinate2D(
          latitude: (bounds.minLatitude + bounds.maxLatitude) / 2,
          longitude: (bounds.minLongitude + bounds.maxLongitude) / 2
        ),
        span: MKCoordinateSpan(latitudeDelta: latitudeDelta, longitudeDelta: longitudeDelta)
      )
      mapView.setRegion(region, animated: false)
      return
    }

    if let padLatitude = pad?.latitude, let padLongitude = pad?.longitude {
      let region = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: padLatitude, longitude: padLongitude),
        span: MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08)
      )
      mapView.setRegion(region, animated: false)
    }
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
}
