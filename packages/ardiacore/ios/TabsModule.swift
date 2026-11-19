import ExpoModulesCore

public class TabsModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)
    Events(Self.calls.domain)
    Self.calls.forwardEvents(to: self)

    OnCreate {
      NillaTabStrip.watchStrips()
    }

    Function("prepareTransfer") { (key: String) in
      for engine in PageEngines.all { engine.prepareTransfer(key) }
    }
    Function("releaseTransfer") { (key: String) in
      for engine in PageEngines.all { engine.releaseTransfer(key) }
    }
    Function("claimLaunchTab") { (key: String, url: String, profile: String) in
      NillaWebView.claimLaunchTab(key, url: url, profile: profile)
    }
    Function("revealTab") { (key: String) in NillaWebView.revealTab(key) }
    Function("dropTabReveals") { (key: String) in NillaWebView.dropTabReveals(key) }
    Function("revealOffered") { (adoptId: String, key: String) in NillaWebView.revealOffered(adoptId, over: key) }
    AsyncFunction("discardOffered") { (adoptId: String) -> Bool in NillaWebView.discardOffered(adoptId) }.runOnQueue(.main)

    Self.calls.function
  }

  static func browserId(_ args: CallArgs) throws -> Int32 { NillaWebView.browserId(ofTab: try args.text("tabId")) }

  static let calls = CallTable(domain: "tabs", handlers: [
    "routeLinkTabs": { args, reply in reply.ok(NillaWebView.routeLinkTabs(try args.strings("urls"))) },
    "stripCommand": { args, reply in
      NillaTabStrip.command(try args.int("id"), command: try args.dict("command"))
      reply.ok()
    },
    "strips": { _, reply in reply.ok(NillaTabStrip.allStrips) },
    "reportCommits": { args, reply in
      NillaWebView.reportsCommits = try args.bool("on")
      reply.ok()
    },
    "lastTabPolicy": EngineCall.passing("ac_tabs_last_tab_policy"),
    "devBrowserId": { args, reply in reply.ok(try browserId(args)) },
    "devEvents": { args, reply in reply.ok(NillaWebView.devEvents(browserId: try browserId(args))) },
    "devWindowNumber": { args, reply in reply.ok(NillaWebView.devWindowNumber(browserId: try browserId(args))) },
    "devFocusPage": { args, reply in reply.ok(NillaWebView.devFocusPage(browserId: try browserId(args))) },
    "devPictureInPicture": { _, reply in reply.ok(NillaWebView.devPictureInPicture()) },
    "devPostPeekMouseUp": { args, reply in reply.ok(NillaWebView.devPostPeekMouseUp(try args.text("keys"), over: try args.text("tabId"))) },
    "devScrollZoom": { args, reply in
      let steps = try args.dicts("steps")
      reply.ok(NillaWebView.devScrollZoom(steps, browserId: NillaWebView.browserId(ofTab: try args.optionalText("tabId"))))
    },
  ].merging(LaunchConfig.shared.testInstance ? testInstanceCalls : [:]) { call, _ in call })

  private static let testInstanceCalls: [String: CallHandler] = [
    "devPictureInPictureAction": { args, reply in reply.ok(NillaWebView.devPictureInPictureAction(try args.text("action"))) },
    "devPagePhase": { args, reply in reply.ok(NillaWebView.devPagePhase(of: try args.text("tabId"))) },
    "devClosePage": { args, reply in reply.ok(NillaWebView.devClosePage(of: try args.text("tabId"))) },
  ]
}
