import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

public class OutsidePressAreaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NillaOutsidePressArea")

    View(OutsidePressArea.self) {
      Events("onOutsidePress")
    }
  }
}
