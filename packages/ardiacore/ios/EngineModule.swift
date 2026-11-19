import AppKit
import ExpoModulesCore

public class EngineModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)
    Events(Self.calls.domain)
    Self.calls.forwardEvents(to: self)

    OnCreate {
      NillaEngineBridge.forwardEngineEvents()
      SystemState.shared.onChange = { state in NillaEvents.emit("engine.systemState", data: state) }
      SystemState.shared.start()
    }

    Self.calls.function

    Function("inputIdleSeconds") { () -> Double in
      guard NSRunningApplication.current.isActive else { return 3600 }
      return CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: UInt32.max)!)
    }
  }

  static let calls = CallTable(domain: "engine", handlers: [
    "info": { _, reply in reply.ok(NillaHost.engineInfo) },
    "components": { _, reply in NillaServices.components { reply.service($0, $1) } },
    "tasks": { _, reply in NillaServices.tasks { reply.service($0, $1) } },
    "beginTracing": { _, reply in NillaHost.beginTracing { reply.ok($0) } },
    "endTracing": { args, reply in NillaHost.endTracing(keep: try args.bool("keep")) { reply.ok($0) } },
    "isTracing": { _, reply in reply.ok(NillaHost.isTracing) },
    "systemState": { _, reply in reply.ok(SystemState.shared.snapshot) },
    "batterySaver": EngineCall.passing("ac_battery_saver"),
    "memorySaver": EngineCall.passing("ac_memory_saver"),
    "validateKeepActiveSite": { args, reply in
      EngineCall.passing("ac_memory_saver", profile: args.profile, args: ["validate": try args.text("site")], reply: reply)
    },
    "trimMemory": EngineCall.passing("ac_memory_trim"),
    "openTaskManager": EngineCall.passing("ac_task_manager_open"),
    "cliControlStatus": EngineCall.passing("ac_cli_control"),
    "setCliControl": { args, reply in
      EngineCall.passing("ac_cli_control", profile: args.profile, args: ["on": try args.bool("on")], reply: reply)
    },
    "cliTabTargets": { args, reply in
      NillaHost.cliTabTargets(try args.strings("tabIds")) { reply.ok($0) }
    },
    "cliOwnsTab": { args, reply in
      let tab = NillaHost.chromeTabId(ofTab: try args.text("tabId"))
      EngineCall.passing("ac_cli_owns_tab", profile: args.profile, args: ["tab": tab], reply: reply)
    },
    "cliMoveOffscreen": { args, reply in
      NillaHost.cliMoveOffscreen(try args.text("tabId")) { reply.ok($0) }
    },
    "cliCloseOffscreenTabs": { _, reply in
      NillaHost.cliCloseOffscreenTabs()
      reply.ok()
    },
    "setCliActiveTab": { args, reply in
      let active = try args.optionalText("tabId").map { NillaHost.chromeTabId(ofTab: $0) } ?? -1
      EngineCall.passing("ac_cli_control", profile: args.profile, args: ["active": active], reply: reply)
    },
  ])
}
