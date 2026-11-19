import ExpoModulesCore

public class AutofillModule: Module {
  public func definition() -> ModuleDefinition {
    Name(Self.calls.moduleName)

    Self.calls.function

    AsyncFunction("saveCard") { (profile: String, card: [String: Any], number: String?, promise: Promise) in
      NillaServices.saveCard(card, number: number, profile: profile) { CallReply(promise: promise).service($0, $1) }
    }.runOnQueue(.main)
  }

  static let calls = CallTable(domain: "autofill", handlers: [
    "settings": { args, reply in
      NillaServices.profileToggles(profile: args.profile, set: nil) { toggles, error in
        guard let toggles = toggles as? [String: Bool] else { return reply.service(nil, error ?? "no autofill settings") }
        reply.ok(["addresses": toggles["addresses"] ?? true, "cards": toggles["cards"] ?? true])
      }
    },
    "setSettings": { args, reply in
      var values: [String: NSNumber] = [:]
      if let addresses = try args.optionalBool("addresses") { values["addresses"] = NSNumber(value: addresses) }
      if let cards = try args.optionalBool("cards") { values["cards"] = NSNumber(value: cards) }
      NillaServices.profileToggles(profile: args.profile, set: values) { _, error in reply.service(nil, error) }
    },
    "addresses": { args, reply in NillaServices.addresses(profile: args.profile) { reply.service($0, $1) } },
    "saveAddress": { args, reply in NillaServices.saveAddress(try args.dict("address"), profile: args.profile) { reply.service($0, $1) } },
    "cards": { args, reply in NillaServices.cards(profile: args.profile) { reply.service($0, $1) } },
    "remove": { args, reply in NillaServices.deleteAutofillEntry(try args.text("id"), profile: args.profile) { reply.service($0, $1) } },
    "cardNumber": { args, reply in NillaServices.revealCardNumber(try args.text("id"), profile: args.profile) { reply.service($0, $1) } },
    "showSuggestions": { args, reply in
      reply.ok(NillaHost.showAutofillSuggestions(tabId: try args.text("tabId"), passwords: try args.bool("passwords")))
    },
  ])
}
