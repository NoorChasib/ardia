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
