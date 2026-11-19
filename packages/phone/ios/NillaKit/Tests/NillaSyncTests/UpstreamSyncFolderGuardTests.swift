import NillaSyncCore
import Foundation
import Testing
@testable import NillaSync

@MainActor
@Suite struct UpstreamSyncFolderGuardTests {
  static let scope = SyncEndToEndTests.scope
  let fileManager = FileManager.default

  func upstream(_ sandbox: Sandbox, entropy: Data) throws -> URL {
    let folder = sandbox.root.appendingPathComponent(UpstreamSyncFolder.name, isDirectory: true)
    try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
    let mac = try FakeMac(folder: folder, entropy: entropy)
    try mac.put(Self.scope, "upstream", "1")
    try mac.sync([Self.scope])
    return folder
  }

  @discardableResult
  func link(_ url: URL, to target: URL) throws -> URL {
    try fileManager.createSymbolicLink(at: url, withDestinationURL: target)
    return url
  }

  func tree(_ url: URL) -> [String] {
    (fileManager.subpaths(atPath: url.path) ?? []).sorted()
  }

  func phrase(_ entropy: Data) -> String {
    RecoveryPhrase.words(for: entropy).joined(separator: " ")
  }

  func isUnavailable(_ resolution: SyncFolderAccess.Resolution) -> Bool {
    if case .unavailable = resolution { true } else { false }
  }

  @Test func pickingTheUpstreamFolderInAnySpellingIsRefused() throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let folder = try upstream(sandbox, entropy: RecoveryPhrase.generateEntropy())
    let parent = sandbox.root.path
    let spellings = [UpstreamSyncFolder.name, UpstreamSyncFolder.name.uppercased(), UpstreamSyncFolder.name.lowercased(), "\(UpstreamSyncFolder.name).", "\(UpstreamSyncFolder.name) ", " \(UpstreamSyncFolder.name)"]
    for name in spellings {
      #expect(throws: UpstreamSyncFolder.Refused.self, "\(name)") {
        _ = try SyncFolderAccess.grant(picked: URL(fileURLWithPath: "\(parent)/\(name)", isDirectory: true))
      }
    }
    #expect(throws: UpstreamSyncFolder.Refused.self) {
      _ = try SyncFolderAccess.grant(picked: folder.appendingPathComponent("chain", isDirectory: true))
    }
    #expect(throws: UpstreamSyncFolder.Refused.self) {
      _ = try SyncFolderAccess.grant(picked: try link(sandbox.root.appendingPathComponent("Alias", isDirectory: true), to: folder))
    }
  }

  @Test func connectingToTheUpstreamFolderOrALinkToItLeavesBothSidesUntouched() async throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let entropy = RecoveryPhrase.generateEntropy()
    let folder = try upstream(sandbox, entropy: entropy)
    let before = tree(folder)
    let alias = try link(sandbox.root.appendingPathComponent("Shortcut", isDirectory: true), to: folder)
    for picked in [folder, alias] {
      let service = SyncService(directory: sandbox.state, keyStore: FileKeyStore(directory: sandbox.keys))
      #expect(await service.connect(phrase: phrase(entropy), folder: picked) == .folderUnavailable)
      #expect(service.phase == .off)
    }
    #expect(tree(folder) == before)
    #expect(!fileManager.fileExists(atPath: sandbox.state.appendingPathComponent("sync.json").path))
    #expect(sandbox.contents(sandbox.keys).isEmpty)
  }

  @Test func aNillaSyncChildThatLeadsIntoTheUpstreamFolderIsNeverProbedOrChosen() throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let entropy = RecoveryPhrase.generateEntropy()
    let folder = try upstream(sandbox, entropy: entropy)
    let drive = sandbox.root.appendingPathComponent("Drive", isDirectory: true)
    try fileManager.createDirectory(at: drive, withIntermediateDirectories: true)
    try link(drive.appendingPathComponent(SyncFolderAccess.folderNames[0], isDirectory: true), to: folder)

    #expect(SyncFolderAccess.syncSubfolder(in: drive) == nil)
    let (grant, location) = try SyncFolderAccess.grant(picked: drive)
    #expect(grant.folder == drive)
    #expect(location.subfolder == nil)
    #expect(SyncEngine.check(entropy: entropy, folder: grant.folder) == .noSyncData)
    #expect(SyncEngine.check(entropy: entropy, folder: drive.appendingPathComponent(SyncFolderAccess.folderNames[0], isDirectory: true)) == .unavailable)
    #expect(SyncFolderAccess.coordinatedListing(folder) == nil)
    #expect(!SyncFolderAccess.isDirectory(folder))
  }

  @Test func aSavedChildOrNameThatPointsAtTheUpstreamFolderIsNotReopened() throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let entropy = RecoveryPhrase.generateEntropy()
    _ = try upstream(sandbox, entropy: entropy)
    _ = try FakeMac(folder: sandbox.folder, entropy: entropy)
    let (grant, location) = try SyncFolderAccess.grant(picked: sandbox.root)
    #expect(location.subfolder == SyncFolderAccess.folderNames[0])
    _ = grant

    guard case .resolved(let reopened, _) = SyncFolderAccess.resolve(location) else {
      Issue.record("the saved Nilla Sync location should reopen")
      return
    }
    #expect(reopened.folder.lastPathComponent == SyncFolderAccess.folderNames[0])

    for subfolder in [UpstreamSyncFolder.name, UpstreamSyncFolder.name.lowercased(), "\(UpstreamSyncFolder.name).", "\(SyncFolderAccess.folderNames[0])/../\(UpstreamSyncFolder.name)", "..", ".", ""] {
      let saved = SyncFolderLocation(bookmark: location.bookmark, subfolder: subfolder, name: location.name)
      #expect(isUnavailable(SyncFolderAccess.resolve(saved)), "\(subfolder)")
    }
    let named = SyncFolderLocation(bookmark: location.bookmark, subfolder: location.subfolder, name: UpstreamSyncFolder.name)
    #expect(isUnavailable(SyncFolderAccess.resolve(named)))
  }

  @Test func aSavedChildThatBecameALinkIntoTheUpstreamFolderIsNotReopened() throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let entropy = RecoveryPhrase.generateEntropy()
    let folder = try upstream(sandbox, entropy: entropy)
    _ = try FakeMac(folder: sandbox.folder, entropy: entropy)
    let (_, location) = try SyncFolderAccess.grant(picked: sandbox.root)
    #expect(location.subfolder == SyncFolderAccess.folderNames[0])

    try fileManager.moveItem(at: sandbox.folder, to: sandbox.root.appendingPathComponent("Moved", isDirectory: true))
    try link(sandbox.folder, to: folder)
    #expect(isUnavailable(SyncFolderAccess.resolve(location)))
  }

  @Test func aSavedRootRenamedToTheUpstreamNameIsNotReopened() throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    _ = try FakeMac(folder: sandbox.folder, entropy: RecoveryPhrase.generateEntropy())
    let (grant, location) = try SyncFolderAccess.grant(picked: sandbox.folder)
    #expect(location.subfolder == nil)
    _ = grant

    let box = sandbox.root.appendingPathComponent("Box", isDirectory: true)
    try fileManager.createDirectory(at: box, withIntermediateDirectories: true)
    try fileManager.moveItem(at: sandbox.folder, to: box.appendingPathComponent(UpstreamSyncFolder.name, isDirectory: true))
    #expect(isUnavailable(SyncFolderAccess.resolve(location)))
  }

  @Test func aRootSwappedForALinkIntoTheUpstreamFolderIsNotListed() throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let entropy = RecoveryPhrase.generateEntropy()
    _ = try FakeMac(folder: sandbox.folder, entropy: entropy)
    let folder = try upstream(sandbox, entropy: entropy)
    let (grant, _) = try SyncFolderAccess.grant(picked: sandbox.folder)
    let host = SyncHost(device: "phoneguard0000000000000000", files: SyncFiles(directory: sandbox.state), keys: SyncKeys(entropy: entropy), grant: grant, coordination: SyncCoordination(timeout: 5))
    #expect(host.chainStatus() == "ok")

    try fileManager.moveItem(at: sandbox.folder, to: sandbox.root.appendingPathComponent("Moved", isDirectory: true))
    try link(sandbox.folder, to: folder)
    host.chainSeen = false
    #expect(host.chainStatus() == "unavailable")
    #expect(!host.timedOut)
    #expect(!host.chainSeen)
  }

  @Test func aRunningServiceWhoseFolderNowLeadsUpstreamGoesOfflineAndNeverWritesOrResets() async throws {
    let j = try await SyncHardeningTests().joined()
    defer { j.sandbox.remove() }
    #expect(j.service.phase == .updated)
    let folder = try upstream(j.sandbox, entropy: j.entropy)
    let before = tree(folder)

    try fileManager.moveItem(at: j.sandbox.folder, to: j.sandbox.root.appendingPathComponent("Moved", isDirectory: true))
    try link(j.sandbox.folder, to: folder)
    j.source.tabs.append(LocalTabRecord(url: "https://later.example/", title: "Later", lastActive: .now, profileSyncId: nil))
    await j.service.syncNow()
    #expect(j.service.phase == .offline)
    j.clock.advance(120)
    await j.service.syncNow()
    #expect(j.service.phase == .offline)
    await j.service.addBookmark(url: URL(string: "https://after.example/")!, title: "After")
    await j.service.syncNow()
    #expect(j.service.phase == .offline)
    #expect(tree(folder) == before)
    #expect(!j.sandbox.contents(j.sandbox.keys).isEmpty)

    let relaunched = SyncHardeningTests().makeService(j.sandbox, source: j.source, clock: j.clock)
    await j.service.close()
    relaunched.start()
    #expect(relaunched.phase == .needsFolderAccess)
    #expect(tree(folder) == before)
  }

  @Test func removingAnEntryLinkedIntoTheUpstreamFolderDeletesOnlyTheLink() throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let entropy = RecoveryPhrase.generateEntropy()
    let folder = try upstream(sandbox, entropy: entropy)
    let keys = SyncKeys(entropy: entropy)
    let vault = SyncVault(folder: sandbox.folder, keys: keys)
    try vault.createChain()
    try vault.write(scope: Self.scope, payload: Data("{}".utf8))
    let scopeFolder = vault.chainURL.appendingPathComponent(keys.scopeTag(Self.scope), isDirectory: true)
    let target = try #require(fileManager.enumerator(atPath: folder.path)?.compactMap { $0 as? String }.first { $0.hasSuffix(".\(SyncVault.fileExtension)") })
    let id = SyncKeys.newFileId()
    let planted = scopeFolder.appendingPathComponent("\(id).\(SyncVault.fileExtension)")
    try link(planted, to: folder.appendingPathComponent(target))
    let before = tree(folder)

    try vault.remove(scope: Self.scope, ids: [id])
    #expect((try? fileManager.destinationOfSymbolicLink(atPath: planted.path)) == nil)
    #expect(tree(folder) == before)
  }

  @Test func aScopeFolderLinkedIntoTheUpstreamFolderIsNeitherReadNorWritten() throws {
    let sandbox = try Sandbox()
    defer { sandbox.remove() }
    let entropy = RecoveryPhrase.generateEntropy()
    let folder = try upstream(sandbox, entropy: entropy)
    let keys = SyncKeys(entropy: entropy)
    let vault = SyncVault(folder: sandbox.folder, keys: keys)
    try vault.createChain()
    let upstreamScope = SyncVault(folder: folder, keys: keys).chainURL.appendingPathComponent(keys.scopeTag(Self.scope), isDirectory: true)
    try link(vault.chainURL.appendingPathComponent(keys.scopeTag(Self.scope), isDirectory: true), to: upstreamScope)
    let before = tree(folder)

    #expect(throws: UpstreamSyncFolder.Refused.self) { _ = try vault.read(scope: Self.scope, skipping: []) }
    #expect(throws: UpstreamSyncFolder.Refused.self) { try vault.write(scope: Self.scope, payload: Data("{}".utf8)) }
    #expect(throws: UpstreamSyncFolder.Refused.self) { try vault.remove(scope: Self.scope, ids: [SyncKeys.newFileId()]) }
    #expect(tree(folder) == before)
  }
}
