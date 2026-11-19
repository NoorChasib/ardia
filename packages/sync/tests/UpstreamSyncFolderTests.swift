import Foundation
import XCTest
@testable import NillaSyncCore

final class UpstreamSyncFolderTests: XCTestCase {
  var root: URL!
  var upstream: URL!
  var own: URL!
  let fileManager = FileManager.default

  override func setUpWithError() throws {
    root = fileManager.temporaryDirectory.appendingPathComponent("upstream-sync-\(UUID().uuidString)", isDirectory: true)
    upstream = root.appendingPathComponent("iCloud/\(UpstreamSyncFolder.name)", isDirectory: true)
    own = root.appendingPathComponent("iCloud/Nilla Sync", isDirectory: true)
    try fileManager.createDirectory(at: upstream.appendingPathComponent("chain"), withIntermediateDirectories: true)
    try fileManager.createDirectory(at: own, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try? fileManager.removeItem(at: root)
  }

  func link(_ name: String, to target: URL) throws -> URL {
    let url = root.appendingPathComponent(name)
    try fileManager.createSymbolicLink(at: url, withDestinationURL: target)
    return url
  }

  func verdict(_ path: String, cwd: String = "/") -> String {
    switch UpstreamSyncFolder.check(path, cwd: cwd) {
    case .own: return "own"
    case .upstream: return "upstream"
    case .unresolved: return "unresolved"
    }
  }

  func testNillasOwnFolderAndFoldersThatDontExistYetAreOwn() {
    XCTAssertEqual(verdict(own.path), "own")
    XCTAssertEqual(verdict(own.appendingPathComponent("chain/scope").path), "own")
    XCTAssertEqual(verdict(root.appendingPathComponent("iCloud/\(UpstreamSyncFolder.name) Archive").path), "own")
  }

  func testEverySpellingOfTheUpstreamFolderIsRefused() {
    let parent = root.appendingPathComponent("iCloud").path
    for name in [UpstreamSyncFolder.name, UpstreamSyncFolder.name.uppercased(), UpstreamSyncFolder.name.lowercased(), "\(UpstreamSyncFolder.name).", "\(UpstreamSyncFolder.name) ", " \(UpstreamSyncFolder.name)"] {
      XCTAssertEqual(verdict("\(parent)/\(name)"), "upstream", name)
      XCTAssertEqual(verdict("\(parent)/\(name)/chain"), "upstream", name)
    }
  }

  func testALinkIntoTheUpstreamFolderIsRefused() throws {
    let alias = try link("Nilla Sync alias", to: upstream)
    XCTAssertEqual(verdict(alias.path), "upstream")
    XCTAssertEqual(verdict(alias.appendingPathComponent("new/child").path), "upstream")
    let parentAlias = try link("cloud", to: root.appendingPathComponent("iCloud"))
    XCTAssertEqual(verdict(parentAlias.appendingPathComponent(UpstreamSyncFolder.name.lowercased()).path), "upstream")
  }

  func testRelativePathsResolveAgainstTheRealWorkingFolder() {
    XCTAssertEqual(verdict(".", cwd: upstream.path), "upstream")
    XCTAssertEqual(verdict("chain", cwd: upstream.path), "upstream")
    XCTAssertEqual(verdict("../\(UpstreamSyncFolder.name)", cwd: own.path), "upstream")
    XCTAssertEqual(verdict("x", cwd: own.path), "own")
  }

  func testAPathThatCantBeResolvedIsRefused() throws {
    let dangling = try link("dangling", to: root.appendingPathComponent("nowhere/x"))
    XCTAssertEqual(verdict(dangling.path), "unresolved")
    XCTAssertEqual(verdict(""), "unresolved")
    XCTAssertEqual(verdict("a\0b"), "unresolved")
  }

  func testAMissingFolderFollowedByDotDotCantReachALinkIntoTheUpstreamFolder() throws {
    try fileManager.createSymbolicLink(at: own.appendingPathComponent("link"), withDestinationURL: upstream)
    let sneaky = own.path + "/missing/../link"
    XCTAssertEqual(verdict(sneaky), "unresolved")
    XCTAssertEqual(verdict(sneaky + "/chain"), "unresolved")
    XCTAssertEqual(verdict(own.path + "/missing/./x/../y"), "unresolved")
    XCTAssertEqual(verdict(own.path + "/missing/deeper"), "own")
    XCTAssertNil(UpstreamSyncFolder.pickerSeed(sneaky))
    XCTAssertEqual(UpstreamSyncFolder.pickerSeed(own.path)?.path, UpstreamSyncFolder.realPath(own.path))
    XCTAssertThrowsError(try UpstreamSyncFolder.folderToProbe(sneaky, fallback: own))
    XCTAssertThrowsError(try UpstreamSyncFolder.folderToProbe(nil, fallback: own.appendingPathComponent("link")))
    XCTAssertNoThrow(try UpstreamSyncFolder.folderToProbe(nil, fallback: own))
  }

  func testAVaultSkipsEntriesLinkedIntoTheUpstreamFolder() throws {
    let keys = SyncKeys(entropy: Data(count: 32))
    let vault = SyncVault(folder: own, keys: keys)
    let mine = try vault.write(scope: "app", payload: Data("{\"n\":1}".utf8))
    let target = upstream.appendingPathComponent("chain/old.\(SyncVault.fileExtension)")
    try Data("ardia".utf8).write(to: target)
    let scope = vault.scopeURL("app")
    let linked = SyncKeys.newFileId()
    try fileManager.createSymbolicLink(at: scope.appendingPathComponent("\(linked).\(SyncVault.fileExtension)"), withDestinationURL: target)
    let placeholder = SyncKeys.newFileId()
    try Data().write(to: scope.appendingPathComponent(".\(placeholder).\(SyncVault.fileExtension).icloud"))
    try fileManager.createSymbolicLink(at: scope.appendingPathComponent("\(placeholder).\(SyncVault.fileExtension)"), withDestinationURL: target)
    let listing = try vault.read(scope: "app", skipping: [])
    XCTAssertEqual(listing.files.map(\.id), [mine])
    XCTAssertEqual(listing.present, [mine])
    XCTAssertEqual(listing.pending, [])
    XCTAssertTrue(listing.damaged.isEmpty)
    XCTAssertEqual(try Data(contentsOf: target), Data("ardia".utf8))
    XCTAssertThrowsError(try UpstreamSyncFolder.readEntry(scope.appendingPathComponent("\(linked).\(SyncVault.fileExtension)")))
  }

  func testAVaultWithAChainLinkedIntoTheUpstreamFolderNeverTouchesIt() throws {
    let keys = SyncKeys(entropy: Data(count: 32))
    let vault = SyncVault(folder: own, keys: keys)
    try fileManager.createSymbolicLink(at: vault.chainURL, withDestinationURL: upstream.appendingPathComponent("chain"))
    XCTAssertFalse(vault.chainExists())
    XCTAssertThrowsError(try vault.createChain()) { XCTAssertEqual($0 as? UpstreamSyncFolder.Refused, UpstreamSyncFolder.Refused(verdict: .upstream)) }
    XCTAssertThrowsError(try vault.write(scope: "app", payload: Data("{}".utf8))) { XCTAssertTrue($0 is UpstreamSyncFolder.Refused) }
    XCTAssertThrowsError(try vault.read(scope: "app", skipping: [])) { XCTAssertTrue($0 is UpstreamSyncFolder.Refused) }
    XCTAssertThrowsError(try vault.remove(scope: "app", ids: ["x"])) { XCTAssertTrue($0 is UpstreamSyncFolder.Refused) }
    XCTAssertNoThrow(try vault.deleteChain())
    XCTAssertEqual(try fileManager.contentsOfDirectory(atPath: upstream.appendingPathComponent("chain").path), [])
  }

  func testAVaultInNillasOwnFolderStillWorks() throws {
    let keys = SyncKeys(entropy: Data(count: 32))
    let vault = SyncVault(folder: own, keys: keys)
    try vault.createChain()
    XCTAssertTrue(vault.chainExists())
    let id = try vault.write(scope: "app", payload: Data("{\"n\":1}".utf8))
    XCTAssertEqual(try vault.read(scope: "app", skipping: []).files.map(\.id), [id])
  }
}
