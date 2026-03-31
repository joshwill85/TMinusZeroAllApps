import UIKit

@objcMembers
public final class TmzArTrajectoryOrientationController: NSObject {
  public static let shared = TmzArTrajectoryOrientationController()

  private(set) public var supportedOrientations: UIInterfaceOrientationMask

  private override init() {
    supportedOrientations = .allButUpsideDown
  }

  @discardableResult
  public func lock(orientation: String) -> Bool {
    let nextMask: UIInterfaceOrientationMask
    let targetOrientation: UIInterfaceOrientation?
    let shouldRequestGeometryUpdate: Bool

    switch orientation {
    case "landscape":
      nextMask = .landscape
      targetOrientation = .landscapeRight
      shouldRequestGeometryUpdate = true
    case "all":
      nextMask = .allButUpsideDown
      targetOrientation = nil
      shouldRequestGeometryUpdate = false
    default:
      nextMask = .portrait
      targetOrientation = .portrait
      shouldRequestGeometryUpdate = true
    }

    DispatchQueue.main.async {
      self.supportedOrientations = nextMask
      if shouldRequestGeometryUpdate,
        #available(iOS 16.0, *),
        let windowScene = UIApplication.shared.connectedScenes
          .compactMap({ $0 as? UIWindowScene })
          .first(where: { $0.activationState == .foregroundActive }) {
        let geometryPreferences = UIWindowScene.GeometryPreferences.iOS(interfaceOrientations: nextMask)
        windowScene.requestGeometryUpdate(geometryPreferences) { _ in }
      }

      if let targetOrientation {
        UIDevice.current.setValue(targetOrientation.rawValue, forKey: "orientation")
      }
      UIViewController.attemptRotationToDeviceOrientation()
    }

    return true
  }

  @discardableResult
  public func unlock() -> Bool {
    DispatchQueue.main.async {
      self.supportedOrientations = .allButUpsideDown
      UIViewController.attemptRotationToDeviceOrientation()
    }
    return true
  }
}
