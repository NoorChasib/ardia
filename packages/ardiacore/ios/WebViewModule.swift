import AppKit
import ExpoModulesCore

public class WebViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)

    Self.calls.function

    PageViewDefinition.of(ChromiumTabView.self)
  }

  static func setting(_ apply: @escaping (CallArgs) throws -> Void) -> CallHandler {
    { args, reply in
      try apply(args)
      reply.ok()
    }
  }

  static let calls = CallTable(domain: "webView", handlers: [
    "setDisplayMediaPicker": setting { NillaWebView.setDisplayMediaPicker(try $0.bool("enabled")) },
    "setPeekModifier": setting { NillaWebView.setPeekModifier(try $0.text("modifier")) },
    "setSplitLinkModifier": setting { NillaWebView.setSplitLinkModifier(try $0.text("modifier")) },
    "setPeekOtherSiteTabs": setting { NillaWebView.setPeekOtherSiteTabs(try $0.strings("tabIds")) },
    "setSelectionPopover": setting { NillaWebView.setSelectionPopoverEnabled(try $0.bool("enabled")) },
    "setBlockAutoplayEverywhere": setting { NillaWebView.setBlockAutoplayEverywhere(try $0.bool("enabled")) },
    "setCommandScrollZoom": setting { NillaWebView.setCommandScrollZoomEnabled(try $0.bool("enabled")) },
    "setLittleArdiaOpensNewTabLinks": setting { ArdiaWebView.setLittleArdiaOpensNewTabLinks(try $0.bool("enabled")) },
    "setPopupsOpenAsTabs": setting { NillaWebView.setPopupsOpenAsTabs(try $0.bool("enabled")) },
    "setAutoPictureInPicture": setting { NillaWebView.setAutoPictureInPictureEnabled(try $0.bool("enabled")) },
    "setVideoUpscaling": setting { NillaWebView.setVideoUpscalingEnabled(try $0.bool("enabled")) },
    "setVideoUpscalingTestConditions": setting { args in
      var conditions: [String: NSNumber] = [:]
      for key in ["lowPower", "thermalPressure", "capturing"] { if let on = try args.optionalBool(key) { conditions[key] = NSNumber(value: on) } }
      NillaWebView.setVideoUpscalingTestConditions(conditions)
    },
    "videoUpscalingState": { _, reply in reply.ok(NillaWebView.videoUpscalingState()) },
    "takeContentDrift": { _, reply in reply.ok(NillaWebView.takeContentDrift()) },
    "takeFirstPaintHolds": { _, reply in reply.ok(NillaWebView.takeFirstPaintHolds()) },
  ])
}

