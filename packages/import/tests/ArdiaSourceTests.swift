import Foundation
import XCTest
@testable import NillaImportCore

final class ArdiaSourceTests: XCTestCase {
  var support: URL!
  var chromium: URL!
  let fileManager = FileManager.default

  override func setUpWithError() throws {
    support = fileManager.temporaryDirectory.appendingPathComponent("ardia-source-\(UUID().uuidString)/Application Support", isDirectory: true)
    chromium = support.appendingPathComponent("com.ardia.browser/Chromium", isDirectory: true)
    try fileManager.createDirectory(at: chromium, withIntermediateDirectories: true)
    let chrome = Fixtures.support("Google/Chrome")
    try fileManager.copyItem(at: chrome.appendingPathComponent("Default"), to: chromium.appendingPathComponent("Default"))
    try fileManager.copyItem(at: chrome.appendingPathComponent("Profile 1"), to: chromium.appendingPathComponent("Profile 3"))
    let state: [String: Any] = ["profile": ["profiles_order": ["Default", "Profile 3"], "last_used": "Default",
                                            "info_cache": ["Default": ["name": "Personal"], "Profile 3": ["name": "Work"]]]]
    try JSONSerialization.data(withJSONObject: state).write(to: chromium.appendingPathComponent("Local State"))
  }

  override func tearDownWithError() throws {
    try? fileManager.removeItem(at: support.deletingLastPathComponent())
  }

  func discovery(installed: Bool = true) -> BrowserDiscovery {
    BrowserDiscovery(applicationSupport: support, locateApp: { ids in
      installed && ids.contains("com.ardia.browser") ? URL(fileURLWithPath: "/Applications/Ardia.app") : nil
    })
  }

  func snapshot() throws -> [String: Data] {
    var files: [String: Data] = [:]
    let walker = try XCTUnwrap(fileManager.enumerator(at: chromium, includingPropertiesForKeys: [.isRegularFileKey]))
    for case let url as URL in walker where (try? url.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true {
      files[String(url.path.dropFirst(chromium.path.count))] = try Data(contentsOf: url)
    }
    return files
  }

  func testACopiedArdiaProfileIsAChromiumSourceWithItsOwnKeychainItem() throws {
    let definition = try XCTUnwrap(BrowserDefinition.find("ardia"))
    XCTAssertEqual(definition.family, .chromium)
    XCTAssertEqual(definition.bundleIds, ["com.ardia.browser"])
    XCTAssertEqual(definition.keychainItems, [.init(service: "Ardia Safe Storage", account: "Ardia")])
    let source = try XCTUnwrap(discovery().list().first { $0.id == "ardia" })
    XCTAssertEqual(source.name, "Ardia")
    XCTAssertEqual(source.keychainService, "Ardia Safe Storage")
    XCTAssertTrue(source.needsKeychain)
    XCTAssertEqual(source.profiles.map(\.id), ["Default", "Profile 3"])
    XCTAssertEqual(source.profiles.map(\.name), ["Personal", "Work"])
    XCTAssertEqual(source.profiles.first?.path, chromium.appendingPathComponent("Default").path)
    XCTAssertTrue(Set([ImportKind.history, .bookmarks, .passwords]).isSubset(of: source.profiles[0].available))
  }

  func testAnArdiaImportReadsTheProfileAndWritesNothingIntoIt() throws {
    let before = try snapshot()
    let importer = Importer(discovery: discovery())
    var asked: [String] = []
    try importer.unlock(browserId: "ardia") { service, account in
      asked.append("\(service)|\(account)")
      return Fixtures.chromiumSecret
    }
    XCTAssertEqual(asked, ["Ardia Safe Storage|Ardia"])
    let result = try importer.importData(browserId: "ardia", profileId: "Default", kinds: [.history, .bookmarks, .passwords])
    XCTAssertEqual(result.failed, [])
    XCTAssertGreaterThan(result.historyCount, 0)
    XCTAssertNotNil(result.bookmarks)
    XCTAssertFalse(result.credentials.isEmpty)
    XCTAssertEqual(try snapshot(), before)
  }

  func testALookupForAnotherBrowserNeverOpensArdiasProfile() throws {
    XCTAssertEqual(discovery().list(only: ["arc"]).filter { $0.id != "arc" }.map(\.id), [])
    XCTAssertEqual(discovery().list(only: ["ardia"]).map(\.id), ["ardia"])
  }

  func testArdiaIsListedOnlyWhenItsProfileIsThere() throws {
    try fileManager.removeItem(at: chromium)
    XCTAssertNil(discovery().list().first { $0.id == "ardia" })
  }

  func writeSessions(_ profile: URL, cleartextComplete: Bool) throws {
    for folder in ["Sessions", "Sessions_Encrypted"] {
      try? fileManager.removeItem(at: profile.appendingPathComponent(folder))
      try fileManager.createDirectory(at: profile.appendingPathComponent(folder), withIntermediateDirectories: true)
    }
    var cleartext = Data("SNSS".utf8)
    cleartext.append(contentsOf: cleartextComplete ? [1, 0, 0, 0] : [3, 0, 0, 0])
    try cleartext.write(to: profile.appendingPathComponent("Sessions/Session_13400000000000001"))
    try Data("sealed".utf8).write(to: profile.appendingPathComponent("Sessions_Encrypted/Session_13400000000000002"))
  }

  func testListingArdiaIsTheSameWhateverItsSessionFilesHold() throws {
    let profile = chromium.appendingPathComponent("Default", isDirectory: true)
    let definition = try XCTUnwrap(BrowserDefinition.find("ardia"))
    try writeSessions(profile, cleartextComplete: true)
    let complete = try XCTUnwrap(discovery().list().first { $0.id == "ardia" })
    XCTAssertEqual(discovery().profilesNeedingKey(definition, ["Default"]), [])
    try writeSessions(profile, cleartextComplete: false)
    let incomplete = try XCTUnwrap(discovery().list().first { $0.id == "ardia" })
    XCTAssertEqual(complete.profiles.map(\.tabsNeedKey), [false, false])
    XCTAssertEqual(incomplete.profiles.map(\.tabsNeedKey), [false, false])
    XCTAssertEqual(complete.profiles.map(\.available), incomplete.profiles.map(\.available))
    XCTAssertEqual(discovery().profilesNeedingKey(definition, ["Default"]), ["Default"])
  }
}
