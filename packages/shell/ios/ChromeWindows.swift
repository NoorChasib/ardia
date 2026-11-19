import AppKit
import ArdiaCore
import ExpoModulesCore

enum ChromeWindows {
  static func makeWindow(profile: String?, chromeWindow: String? = nil, appWindow: String? = nil) -> NSWindow? {
    let profile = profile ?? ""
    installCloseHandler()
    if let appWindow {
      return NillaChromeWindowHost.makeWindow(forProfile: profile, chromeWindow: chromeWindow, appWindow: appWindow)
    }
    if let chromeWindow {
      return NillaChromeWindowHost.makeWindow(forProfile: profile, chromeWindow: chromeWindow)
    }
    return NillaChromeWindowHost.makeWindow(forProfile: profile)
  }

  private static var closeHandlerInstalled = false
  private static func installCloseHandler() {
    guard !closeHandlerInstalled else { return }
    closeHandlerInstalled = true
    NillaChromeWindowHost.shouldCloseHandler = { WindowManager.shared.windowShouldClose($0) }
    NillaChromeWindowHost.refusesUnhandledKeyHandler = { FocusHandoff.shared.refusesUnhandledKey($1, in: $0) }
    NillaChromeWindowHost.focusHandoffSummaryHandler = { FocusHandoff.shared.summary(of: $0) }
  }

  private static let drawnMoves = LaunchConfig.shared.switchOn("sidebarSlideLean")

  static func setTrafficLightsCenter(_ center: NSPoint?, trailing: Bool, in window: NSWindow) {
    let value = center.map { NSValue(point: $0) }
    if drawnMoves {
      NillaChromeWindowHost.moveTrafficLightsCenter(value, trailing: trailing, in: window)
    } else {
      NillaChromeWindowHost.setTrafficLightsCenter(value, trailing: trailing, in: window)
    }
  }

  private static var swapHandlerInstalled = false
  static func onSwap(_ handler: @escaping (NSWindow, NSWindow) -> Void) {
    guard !swapHandlerInstalled else { return }
    swapHandlerInstalled = true
    NillaChromeWindowHost.swappedHandler = handler
    NillaChromeWindowHost.accessibilityTitleReadHandler = { _ in ShellEvents.send(.app, ["type": "windowTitleRead"]) }
  }
}
