import Foundation

enum ProfileData {
  typealias Done = ([String]) -> Void
  private typealias Step = (label: String, run: (@escaping (Bool) -> Void) -> Void)

  static func deleteDefault(_ done: @escaping Done) {
    let steps: [Step] = [
      ("history, cookies and cache", { ok in
        NillaServices.clearBrowsingData(profile: "", types: ["history", "siteData", "cache", "downloads"], since: 0) { ok($0 == nil) }
      }),
      ("autocomplete entries", { ok in
        NillaServices.call("ac_browsing_data_clear", profile: "", args: ["types": ["formData", "siteSettings"]]) { ok($0["ok"] as? Bool == true) }
      }),
      ("passwords", deletePasswords),
      ("addresses", { ok in clearEach(list: { done in NillaServices.addresses(profile: "") { value, _ in done(listed(value)) } }, key: "addresses", done: ok) {
        item, next in NillaServices.deleteAutofillEntry(item["id"] as? String ?? "", profile: "") { _, _ in next() }
      } }),
      ("cards", { ok in clearEach(list: { done in NillaServices.cards(profile: "") { value, _ in done(listed(value)) } }, key: "cards", done: ok) {
        item, next in NillaServices.deleteAutofillEntry(item["id"] as? String ?? "", profile: "") { _, _ in next() }
      } }),
      ("extensions", { ok in clearEach(list: runningExtensions, key: "extensions", done: ok) {
        item, next in NillaServices.setExtension(item["id"] as? String ?? "", enabled: false, profile: "") { _, _ in next() }
      } }),
      ("site settings", resetSiteSettings),
      ("zoom levels", resetZoom),
    ]
    var remaining: [String] = []
    func run(_ i: Int) {
      guard i < steps.count else { return done(remaining) }
      steps[i].run { ok in
        if !ok { remaining.append(steps[i].label) }
        run(i + 1)
      }
    }
    run(0)
  }

  private static func deletePasswords(_ ok: @escaping (Bool) -> Void) {
    clearEach(list: { done in NillaServices.listPasswords(profile: "") { value, _ in done(listed(value)) } }, key: "passwords", done: { deleted in
      NillaServices.neverSaveOrigins(profile: "") { result, _ in
        let origins = listed(result)["origins"] as? [String] ?? []
        forEach(origins, { origin, next in NillaServices.allowSaving(profile: "", origin: origin) { _, _ in next() } }) {
          NillaServices.neverSaveOrigins(profile: "") { again, _ in ok(deleted && (listed(again)["origins"] as? [String])?.isEmpty == true) }
        }
      }
    }) { item, next in
      NillaServices.deletePassword(profile: "", origin: item["origin"] as? String ?? "", username: item["username"] as? String ?? "") { _, _ in next() }
    }
  }

  private static func runningExtensions(_ completion: @escaping ([String: Any]) -> Void) {
    NillaServices.listExtensions(profile: "") { result, _ in
      guard let all = listed(result)["extensions"] as? [[String: Any]] else { return completion([:]) }
      completion(["extensions": all.filter { $0["mayModify"] as? Bool != false && $0["enabled"] as? Bool == true }])
    }
  }

  private static func resetSiteSettings(_ ok: @escaping (Bool) -> Void) {
    NillaServices.siteSettingsOrigins(profile: "") { origins, _ in
      forEach(origins as? [String] ?? [], { origin, next in
        NillaServices.call("ac_site_settings_reset", profile: "", args: ["origin": origin]) { _ in next() }
      }) {
        NillaServices.siteSettingsOrigins(profile: "") { left, _ in ok((left as? [String] ?? []).isEmpty) }
      }
    }
  }

  private static func resetZoom(_ ok: @escaping (Bool) -> Void) {
    NillaServices.zoomLevels(profile: "") { levels, _ in
      for host in (levels as? [String: Any] ?? [:]).keys { NillaServices.setZoom(1, profile: "", host: host) }
      func check(_ attempt: Int) {
        NillaServices.zoomLevels(profile: "") { left, _ in
          let remaining = left as? [String: Any] ?? [:]
          if remaining.isEmpty || attempt >= 20 { return ok(remaining.isEmpty) }
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { check(attempt + 1) }
        }
      }
      check(0)
    }
  }

  private static func clearEach(
    list: @escaping (@escaping ([String: Any]) -> Void) -> Void, key: String, done: @escaping (Bool) -> Void,
    clear: @escaping ([String: Any], @escaping () -> Void) -> Void
  ) {
    list { result in
      guard let items = result[key] as? [[String: Any]] else { return done(false) }
      forEach(items, clear) {
        list { again in done((again[key] as? [Any])?.isEmpty == true) }
      }
    }
  }

  private static func listed(_ value: Any?) -> [String: Any] { value as? [String: Any] ?? [:] }

  private static func forEach<T>(_ items: [T], _ body: @escaping (T, @escaping () -> Void) -> Void, then: @escaping () -> Void) {
    guard let first = items.first else { return then() }
    body(first) { forEach(Array(items.dropFirst()), body, then: then) }
  }
}
