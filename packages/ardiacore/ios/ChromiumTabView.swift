import AppKit
import ExpoModulesCore

final class ChromiumTabView: PageTabHost, NillaWebViewDelegate {
  let onPageEvent = EventDispatcher()

  override var pageEventDispatcher: EventDispatcher { onPageEvent }

  override class func makePage() -> PageTab { NillaWebView(frame: .zero) }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    (page as? NillaWebView)?.delegate = self
  }

  func webView(_ view: NillaWebView, event name: String, payload: [String: Any]) {
    send(name, payload: payload)
  }
}
