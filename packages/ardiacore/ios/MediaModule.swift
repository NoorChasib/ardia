import ExpoModulesCore

public class MediaModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)
    Events(Self.calls.domain)
    Self.calls.forwardEvents(to: self)

    Self.calls.function
  }

  static func chooser(_ action: String) -> CallHandler {
    { args, reply in
      NillaHost.deviceChooser(try args.int32("id"), action: action)
      reply.ok()
    }
  }

  static let calls = CallTable(domain: "media", handlers: [
    "displayMediaSources": { _, reply in reply.ok(NillaHost.displayMediaSources) },
    "screenRecordingAllowed": { _, reply in reply.ok(NillaHost.screenRecordingAllowed) },
    "requestScreenRecording": { _, reply in reply.ok(NillaHost.requestScreenRecording()) },
    "selectDevice": { args, reply in
      NillaHost.deviceChooser(try args.int32("id"), select: try args.int32("index"))
      reply.ok()
    },
    "cancelDeviceChooser": chooser("cancel"),
    "refreshDeviceChooser": chooser("refresh"),
    "openBluetoothSettings": chooser("settings"),
    "devShowBluetoothChooser": { args, reply in
      reply.ok(NillaHost.devShowBluetoothChooser(tabId: try args.text("tabId"), unauthorized: try args.bool("unauthorized")))
    },
    "devChooserEvents": { _, reply in reply.ok(NillaHost.testChooserEvents()) },
    "showCastDialog": { args, reply in reply.ok(NillaHost.showCastDialog(tabId: try args.text("tabId"))) },
    "startCasting": { args, reply in
      NillaHost.castDialog(try args.int32("id"), start: try args.text("sink"), mode: try args.int32("mode"))
      reply.ok()
    },
    "stopCasting": { args, reply in
      NillaHost.castDialog(try args.int32("id"), stop: try args.text("route"))
      reply.ok()
    },
    "closeCastDialog": { args, reply in
      NillaHost.closeCastDialog(try args.int32("id"))
      reply.ok()
    },
    "watchCastRoutes": { args, reply in
      NillaHost.watchCastRoutes(args.profile)
      reply.ok()
    },
    "terminateCastRoute": { args, reply in
      NillaHost.terminateCastRoute(try args.text("route"))
      reply.ok()
    },
    "changeCaptureSource": { args, reply in
      reply.ok(NillaHost.shareTabInstead(capturer: try args.text("capturer"), target: try args.text("target")))
    },
    "stopCapture": { args, reply in reply.ok(NillaHost.stopCapture(tabId: try args.text("tabId"))) },
  ])
}
