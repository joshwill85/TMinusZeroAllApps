import UIKit

@objcMembers
public final class TmzArTrajectoryOrientationController: NSObject {
  public static let shared = TmzArTrajectoryOrientationController()

  private(set) public var supportedOrientations: UIInterfaceOrientationMask = .portrait

  private override init() {}

  @discardableResult
  public func lock(orientation: String) -> Bool {
    let nextMask: UIInterfaceOrientationMask
    let targetOrientation: UIInterfaceOrientation

    switch orientation {
    case "landscape":
      nextMask = .landscape
      targetOrientation = .landscapeRight
    case "all":
      nextMask = .allButUpsideDown
      targetOrientation = .portrait
    default:
      nextMask = .portrait
      targetOrientation = .portrait
    }

    DispatchQueue.main.async {
      self.supportedOrientations = nextMask
      if #available(iOS 16.0, *),
        let windowScene = UIApplication.shared.connectedScenes
          .compactMap({ $0 as? UIWindowScene })
          .first(where: { $0.activationState == .foregroundActive }) {
        let geometryPreferences = UIWindowScene.GeometryPreferences.iOS(interfaceOrientations: nextMask)
        try? windowScene.requestGeometryUpdate(geometryPreferences)
      }

      UIDevice.current.setValue(targetOrientation.rawValue, forKey: "orientation")
      UIViewController.attemptRotationToDeviceOrientation()
    }

    return true
  }

  @discardableResult
  public func unlock() -> Bool {
    return lock(orientation: "portrait")
  }
}
