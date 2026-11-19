import ExpoModulesCore

public class ContentBlockerModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)
    Events(Self.calls.domain)
    Self.calls.forwardEvents(to: self)

    Self.calls.function
  }

  static func settled(_ reply: CallReply) -> (String?) -> Void {
    { error in
      if let error { return reply.fail("ERR_CONTENT_BLOCKER", error) }
      reply.ok()
    }
  }

  static let calls = CallTable(domain: "contentBlocker", handlers: [
    "state": { _, reply in NillaContentBlocker.state { reply.ok($0) } },
    "setEnabled": { args, reply in NillaContentBlocker.setEnabled(try args.bool("enabled"), completion: settled(reply)) },
    "setListEnabled": { args, reply in
      NillaContentBlocker.setList(try args.text("id"), enabled: try args.bool("enabled"), completion: settled(reply))
    },
    "addList": { args, reply in
      NillaContentBlocker.addList(try args.text("url")) { added, error in
        if let error { return reply.fail("ERR_CONTENT_BLOCKER", error) }
        reply.ok(added ?? [:])
      }
    },
    "removeList": { args, reply in NillaContentBlocker.removeList(try args.text("id"), completion: settled(reply)) },
    "isAllowed": { args, reply in NillaContentBlocker.isAllowed(host: try args.text("host")) { reply.ok($0) } },
    "setAllowed": { args, reply in
      NillaContentBlocker.setAllowed(try args.bool("allowed"), host: try args.text("host"), completion: settled(reply))
    },
    "hiddenElements": { args, reply in
      NillaContentBlocker.hiddenElements(profile: args.profile) { filters, error in
        if let error { return reply.fail("ERR_CONTENT_BLOCKER", error) }
        reply.ok(filters ?? [])
      }
    },
    "hideElements": { args, reply in
      NillaContentBlocker.hideElements(try args.strings("filters"), profile: args.profile, completion: settled(reply))
    },
    "restoreElements": { args, reply in
      NillaContentBlocker.restoreElements(try args.strings("filters"), profile: args.profile, completion: settled(reply))
    },
    "devFailNextMessage": { _, reply in
      NillaContentBlocker.devFailNextMessage()
      reply.ok()
    },
    "devDelayNextLoad": { args, reply in
      NillaContentBlocker.devDelayNextLoad(try args.double("ms"))
      reply.ok()
    },
  ])
}
