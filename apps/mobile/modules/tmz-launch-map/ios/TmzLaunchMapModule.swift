import ExpoModulesCore

public final class TmzLaunchMapModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TmzLaunchMap")

    AsyncFunction("getCapabilitiesAsync") { () -> [String: Any?] in
      [
        "isAvailable": true,
        "provider": "apple",
        "reason": nil
      ]
    }

    View(TmzLaunchMapView.self) {
      Prop("advisoriesJson") { (view: TmzLaunchMapView, advisoriesJson: String?) in
        view.advisoriesJson = advisoriesJson ?? "[]"
      }

      Prop("boundsJson") { (view: TmzLaunchMapView, boundsJson: String?) in
        view.boundsJson = boundsJson
      }

      Prop("padJson") { (view: TmzLaunchMapView, padJson: String?) in
        view.padJson = padJson
      }

      Prop("interactive", false) { (view: TmzLaunchMapView, interactive: Bool) in
        view.interactive = interactive
      }

      Prop("renderMode", "auto") { (view: TmzLaunchMapView, renderMode: String) in
        view.renderMode = renderMode
      }

      OnViewDidUpdateProps { view in
        view.onPropsUpdated()
      }
    }
  }
}
