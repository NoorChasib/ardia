import ExpoModulesCore

public class PasswordsModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)

    Self.calls.function

    AsyncFunction("save") { (profile: String, origin: String, username: String, password: String, promise: Promise) in
      NillaServices.savePassword(profile: profile, origin: origin, username: username, password: password) {
        CallReply(promise: promise).service($0, $1)
      }
    }.runOnQueue(.main)

    AsyncFunction("update") {
      (profile: String, origin: String, username: String, newUsername: String?, newPassword: String?, promise: Promise) in
      NillaServices.updatePassword(profile: profile, origin: origin, username: username, newUsername: newUsername,
                                   newPassword: newPassword) { CallReply(promise: promise).service($0, $1) }
    }.runOnQueue(.main)
  }

  static let calls = CallTable(domain: "passwords", handlers: [
    "list": { args, reply in NillaServices.listPasswords(profile: args.profile) { reply.service($0, $1) } },
    "unlock": { args, reply in NillaServices.unlockPasswords(profile: args.profile) { reply.service($0, $1) } },
    "reveal": { args, reply in
      NillaServices.password(profile: args.profile, origin: try args.text("origin"), username: try args.text("username")) { reply.service($0, $1) }
    },
    "remove": { args, reply in
      NillaServices.deletePassword(profile: args.profile, origin: try args.text("origin"), username: try args.text("username")) { reply.service($0, $1) }
    },
    "neverSaveOrigins": { args, reply in NillaServices.neverSaveOrigins(profile: args.profile) { reply.service($0, $1) } },
    "allowSaving": { args, reply in NillaServices.allowSaving(profile: args.profile, origin: try args.text("origin")) { reply.service($0, $1) } },
    "export": { args, reply in NillaServices.exportPasswords(profile: args.profile, path: nil) { reply.service($0, $1) } },
    "autofillEnabled": { args, reply in
      NillaServices.profileToggles(profile: args.profile, set: nil) { toggles, error in
        guard let toggles = toggles as? [String: Bool], let enabled = toggles["passwords"] else { return reply.service(nil, error ?? "no password setting") }
        reply.ok(enabled)
      }
    },
    "setAutofillEnabled": { args, reply in
      let enabled = try args.bool("enabled")
      NillaServices.profileToggles(profile: args.profile, set: ["passwords": NSNumber(value: enabled)]) { _, error in reply.service(nil, error) }
    },
  ])
}
