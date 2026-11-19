import Foundation
import XCTest
@testable import NillaSyncCore

final class SharedFolderDirectoryTests: XCTestCase {
  private var scratch: URL!
  private let fm = FileManager.default

  override func setUpWithError() throws {
    scratch = fm.temporaryDirectory.appendingPathComponent("shared-folder-tests-\(UUID().uuidString)", isDirectory: true)
    try fm.createDirectory(at: scratch, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try? fm.removeItem(at: scratch)
  }

  private func webloc(_ url: String) -> String {
    "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>URL</key><string>\(url)</string></dict></plist>"
  }

  private func folder(_ name: String) throws -> URL {
    let url = scratch.appendingPathComponent(name, isDirectory: true)
    try fm.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  private func ops(_ list: [[String: Any]]) throws -> String {
    String(data: try JSONSerialization.data(withJSONObject: list), encoding: .utf8)!
  }

  private func entries(_ listing: [String: Any]) -> [[String: Any]] {
    ((listing["root"] as? [String: Any])?["entries"] as? [[String: Any]]) ?? []
  }

  func testSymlinkedSubfolderIsNeitherReadNorWrittenThrough() throws {
    let outside = try folder("outside")
    try webloc("https://outside.example/").write(to: outside.appendingPathComponent("Secret.webloc"), atomically: true, encoding: .utf8)
    let root = try folder("root")
    try fm.createSymbolicLink(at: root.appendingPathComponent("Linked"), withDestinationURL: outside)
    try fm.createSymbolicLink(at: root.appendingPathComponent("Alias.webloc"), withDestinationURL: outside.appendingPathComponent("Secret.webloc"))
    let directory = SharedFolderDirectory(root: root)

    let listed = entries(directory.read())
    XCTAssertFalse(String(describing: listed).contains("outside.example"))
    XCTAssertEqual(Set(listed.compactMap { $0["file"] as? String }), ["Alias.webloc", "Linked"])
    XCTAssertTrue(listed.allSatisfy { $0["kind"] as? String == "pending" })

    for change in [
      ["op": "delete", "path": "Linked/Secret.webloc", "expect": "https://outside.example/"],
      ["op": "write", "path": "Linked/.nilla-folder.json", "text": "{}", "create": false],
      ["op": "delete", "path": "Alias.webloc", "expect": "https://outside.example/"],
    ] as [[String: Any]] {
      XCTAssertThrowsError(try directory.apply(json: try ops([change])))
    }
    XCTAssertTrue(fm.fileExists(atPath: outside.appendingPathComponent("Secret.webloc").path))
    XCTAssertFalse(fm.fileExists(atPath: outside.appendingPathComponent(".nilla-folder.json").path))
  }

  func testDeletingALinkNeverRemovesADirectoryOrAChangedLink() throws {
    let root = try folder("root")
    let trap = root.appendingPathComponent("Reading/Docs.webloc", isDirectory: true)
    try fm.createDirectory(at: trap, withIntermediateDirectories: true)
    try "pdf".write(to: trap.appendingPathComponent("report.pdf"), atomically: true, encoding: .utf8)
    try webloc("https://changed.example/").write(to: root.appendingPathComponent("Reading/Old.webloc"), atomically: true, encoding: .utf8)
    try webloc("https://keep.example/").write(to: root.appendingPathComponent("Reading/Gone.webloc"), atomically: true, encoding: .utf8)
    _ = try SharedFolderDirectory(root: root).apply(json: try ops([
      ["op": "delete", "path": "Reading/Docs.webloc", "expect": "https://docs.example/"],
      ["op": "delete", "path": "Reading/Old.webloc", "expect": "https://old.example/"],
      ["op": "delete", "path": "Reading/Gone.webloc", "expect": "https://keep.example/"],
      ["op": "rmdir", "path": "Reading"],
    ]))
    XCTAssertTrue(fm.fileExists(atPath: trap.appendingPathComponent("report.pdf").path))
    XCTAssertTrue(fm.fileExists(atPath: root.appendingPathComponent("Reading/Old.webloc").path))
    XCTAssertFalse(fm.fileExists(atPath: root.appendingPathComponent("Reading/Gone.webloc").path))
  }

  func testCreatingANameThatExistsIsAConflictAndReplacingChecksTheOldURL() throws {
    let root = try folder("root")
    let directory = SharedFolderDirectory(root: root)
    let first = try directory.apply(json: try ops([["op": "write", "path": "Docs.webloc", "text": webloc("https://mac-a.example/"), "create": true]]))
    XCTAssertEqual(first["conflicts"] as? [String], [])
    let second = try directory.apply(json: try ops([["op": "write", "path": "Docs.webloc", "text": webloc("https://mac-b.example/"), "create": true]]))
    XCTAssertEqual(second["conflicts"] as? [String], ["Docs.webloc"])
    let stale = try directory.apply(json: try ops([["op": "write", "path": "Docs.webloc", "text": webloc("https://x.example/"), "create": false, "expect": "https://old.example/"]]))
    XCTAssertEqual(stale["conflicts"] as? [String], ["Docs.webloc"])
    XCTAssertTrue(try String(contentsOf: root.appendingPathComponent("Docs.webloc"), encoding: .utf8).contains("mac-a"))
    let current = try directory.apply(json: try ops([["op": "write", "path": "Docs.webloc", "text": webloc("https://new.example/"), "create": false, "expect": "https://mac-a.example/"]]))
    XCTAssertEqual(current["conflicts"] as? [String], [])
    XCTAssertTrue(try String(contentsOf: root.appendingPathComponent("Docs.webloc"), encoding: .utf8).contains("new.example"))
  }

  func testAMoveOntoAnExistingNameIsAConflict() throws {
    let root = try folder("root")
    try webloc("https://a.example/").write(to: root.appendingPathComponent("A.webloc"), atomically: true, encoding: .utf8)
    try webloc("https://b.example/").write(to: root.appendingPathComponent("B.webloc"), atomically: true, encoding: .utf8)
    let result = try SharedFolderDirectory(root: root).apply(json: try ops([["op": "move", "path": "A.webloc", "to": "B.webloc"]]))
    XCTAssertEqual(result["conflicts"] as? [String], ["B.webloc"])
    XCTAssertTrue(try String(contentsOf: root.appendingPathComponent("B.webloc"), encoding: .utf8).contains("b.example"))
  }

  func testAFolderThatCantBeListedIsAnErrorNotEmpty() throws {
    let root = try folder("root")
    let locked = root.appendingPathComponent("Locked", isDirectory: true)
    try fm.createDirectory(at: locked, withIntermediateDirectories: true)
    try webloc("https://x.example/").write(to: locked.appendingPathComponent("In.webloc"), atomically: true, encoding: .utf8)
    chmod(locked.path, 0o000)
    defer { chmod(locked.path, 0o755) }
    let listing = SharedFolderDirectory(root: root).read()
    XCTAssertNotNil((listing["root"] as? [String: Any])?["error"])
  }

  func testOversizedFilesAreHeldWithoutBeingRead() throws {
    let root = try folder("root")
    fm.createFile(atPath: root.appendingPathComponent("Big.webloc").path, contents: Data(count: 2_000_000))
    fm.createFile(atPath: root.appendingPathComponent(".nilla-folder.json").path, contents: Data(count: 3_000_000))
    let listing = SharedFolderDirectory(root: root).read()
    let level = listing["root"] as? [String: Any]
    XCTAssertEqual(entries(listing).first?["kind"] as? String, "pending")
    XCTAssertEqual(entries(listing).first?["reason"] as? String, "unreadable")
    XCTAssertEqual(level?["manifestPending"] as? Bool, true)
  }

  func testAFolderWithoutSearchPermissionIsAnErrorNotEmpty() throws {
    let root = try folder("root")
    let locked = root.appendingPathComponent("NoSearch", isDirectory: true)
    try fm.createDirectory(at: locked, withIntermediateDirectories: true)
    try webloc("https://x.example/").write(to: locked.appendingPathComponent("In.webloc"), atomically: true, encoding: .utf8)
    chmod(locked.path, 0o444)
    defer { chmod(locked.path, 0o755) }
    let listing = SharedFolderDirectory(root: root).read()
    XCTAssertNotNil((listing["root"] as? [String: Any])?["error"])
  }

  func testTheFirstConflictStopsTheBatch() throws {
    let root = try folder("root")
    for (name, url) in [("A", "https://a.example/"), ("B", "https://b.example/"), ("C", "https://c.example/")] {
      try webloc(url).write(to: root.appendingPathComponent("\(name).webloc"), atomically: true, encoding: .utf8)
    }
    let result = try SharedFolderDirectory(root: root).apply(json: try ops([
      ["op": "move", "path": "A.webloc", "to": "B.webloc"],
      ["op": "move", "path": "C.webloc", "to": "A.webloc"],
    ]))
    XCTAssertEqual(result["conflicts"] as? [String], ["B.webloc"])
    XCTAssertTrue(fm.fileExists(atPath: root.appendingPathComponent("C.webloc").path))
    XCTAssertTrue(try String(contentsOf: root.appendingPathComponent("A.webloc"), encoding: .utf8).contains("a.example"))
  }

  func testReadsStopAtTheCapWhateverSizeTheFileReported() throws {
    let root = try folder("root")
    let path = root.appendingPathComponent("Growing.webloc")
    let fifo = root.appendingPathComponent("Pipe.webloc")
    XCTAssertEqual(mkfifo(fifo.path, 0o644), 0)
    try webloc("https://small.example/").write(to: path, atomically: true, encoding: .utf8)
    let listing = SharedFolderDirectory(root: root).read()
    let kinds = Dictionary(uniqueKeysWithValues: entries(listing).map { ($0["file"] as! String, $0["kind"] as! String) })
    XCTAssertEqual(kinds["Growing.webloc"], "link")
    XCTAssertEqual(kinds["Pipe.webloc"], "pending")
    XCTAssertNil(SharedFolderDirectory.boundedRead(path.path, limit: 10))
    XCTAssertEqual(SharedFolderDirectory.boundedRead(path.path, limit: 4096).map { String(decoding: $0, as: UTF8.self).contains("small") }, true)
  }

  func testAFolderWithAnUnknownEntryKeepsItsOrderFile() throws {
    let root = try folder("root")
    let sub = try folder("root/Sub")
    try "{\"version\":1,\"order\":[\"Note.txt\"]}".write(to: sub.appendingPathComponent(".nilla-folder.json"), atomically: true, encoding: .utf8)
    try "keep".write(to: sub.appendingPathComponent("Note.txt"), atomically: true, encoding: .utf8)
    _ = try SharedFolderDirectory(root: root).apply(json: try ops([["op": "rmdir", "path": "Sub"]]))
    XCTAssertTrue(fm.fileExists(atPath: sub.appendingPathComponent(".nilla-folder.json").path))
    try fm.removeItem(at: sub.appendingPathComponent("Note.txt"))
    _ = try SharedFolderDirectory(root: root).apply(json: try ops([["op": "rmdir", "path": "Sub"]]))
    XCTAssertFalse(fm.fileExists(atPath: sub.path))
  }

  func testFolderNamesAreCappedByTheirUTF8Bytes() {
    XCTAssertLessThanOrEqual(SharedFolderDirectory.folderName(String(repeating: "界", count: 150)).utf8.count, 200)
    XCTAssertEqual(SharedFolderDirectory.folderName("a/b"), "a-b")
  }

  func testAFolderThatCantBeOpenedIsAnErrorNotMissing() throws {
    let parent = try folder("locked")
    let root = try folder("locked/Shared")
    chmod(parent.path, 0o000)
    defer { chmod(parent.path, 0o755) }
    let listing = SharedFolderDirectory(root: root).read()
    XCTAssertEqual(listing["exists"] as? Bool, false)
    XCTAssertNotNil(listing["error"] as? String)
    XCTAssertNil(SharedFolderDirectory(root: scratch.appendingPathComponent("nowhere")).read()["error"])
  }

  private func tree(_ root: URL) -> [String] {
    ((try? fm.subpathsOfDirectory(atPath: root.path)) ?? []).sorted().map { path in
      let url = root.appendingPathComponent(path)
      return "\(path)=\((try? String(contentsOf: url, encoding: .utf8)) ?? "dir")"
    }
  }

  func testAParentOfArdiasSharedFolderNeverReadsOrWritesInsideIt() throws {
    let root = try folder("iCloud Drive")
    let upstream = try folder("iCloud Drive/Ardia Shared")
    _ = try folder("iCloud Drive/Ardia Shared/Work")
    try webloc("https://upstream.example/").write(to: upstream.appendingPathComponent("Work/Secret.webloc"), atomically: true, encoding: .utf8)
    try "{}".write(to: upstream.appendingPathComponent(".nilla-folder.json"), atomically: true, encoding: .utf8)
    _ = try folder("iCloud Drive/Ardia Sync")
    let mine = try folder("iCloud Drive/Mine")
    try webloc("https://mine.example/").write(to: mine.appendingPathComponent("Ok.webloc"), atomically: true, encoding: .utf8)
    let before = tree(upstream)
    let directory = SharedFolderDirectory(root: root)

    let listing = directory.read()
    XCTAssertEqual(entries(listing).compactMap { $0["file"] as? String }, ["Mine"])
    XCTAssertFalse(String(describing: listing).contains("upstream.example"))

    for change in [
      ["op": "write", "path": "Ardia Shared/New.webloc", "text": webloc("https://new.example/"), "create": true],
      ["op": "write", "path": "Ardia Shared/.nilla-folder.json", "text": "[]", "create": false],
      ["op": "write", "path": "ardia shared./Work/New.webloc", "text": webloc("https://new.example/"), "create": true],
      ["op": "mkdir", "path": "Ardia Shared/Fresh"],
      ["op": "mkdir", "path": "ARDIA SHARED"],
      ["op": "mkdir", "path": "Ardia Sync/Fresh"],
      ["op": "move", "path": "Mine/Ok.webloc", "to": "Ardia Shared/Ok.webloc"],
      ["op": "move", "path": "Ardia Shared/Work/Secret.webloc", "to": "Mine/Secret.webloc"],
      ["op": "move", "path": "Ardia Shared/Work", "to": "Mine/Work"],
      ["op": "delete", "path": "Ardia Shared/Work/Secret.webloc", "expect": "https://upstream.example/"],
      ["op": "rmdir", "path": "Ardia Shared/Work"],
    ] as [[String: Any]] {
      XCTAssertThrowsError(try directory.apply(json: try ops([change])), "\(change)")
    }
    XCTAssertEqual(tree(upstream), before)
    XCTAssertTrue(fm.fileExists(atPath: mine.appendingPathComponent("Ok.webloc").path))
    XCTAssertFalse(fm.fileExists(atPath: mine.appendingPathComponent("Secret.webloc").path))

    XCTAssertThrowsError(try SharedFolderDirectory.create(in: root, named: "Ardia Shared"))
    XCTAssertThrowsError(try SharedFolderDirectory.create(in: root, named: " ardia sync "))
    XCTAssertThrowsError(try SharedFolderDirectory.create(in: upstream, named: "Inside"))
    XCTAssertEqual(tree(upstream), before)
    XCTAssertEqual(try SharedFolderDirectory.create(in: root, named: "Ardia Shared Notes").lastPathComponent, "Ardia Shared Notes")
  }

  func testAFolderHoldingTheUpstreamSharedFolderIsNeverMoved() throws {
    let root = try folder("Drive")
    let upstream = try folder("Drive/Holder/Inner/Ardia Shared")
    try webloc("https://upstream.example/").write(to: upstream.appendingPathComponent("Secret.webloc"), atomically: true, encoding: .utf8)
    _ = try folder("Drive/Cloudy")
    try "".write(to: root.appendingPathComponent("Cloudy/.ardia sync..icloud"), atomically: true, encoding: .utf8)
    let plain = try folder("Drive/Plain/Inner")
    try webloc("https://mine.example/").write(to: plain.appendingPathComponent("Ok.webloc"), atomically: true, encoding: .utf8)
    let before = tree(root)
    let directory = SharedFolderDirectory(root: root)

    for change in [
      ["op": "move", "path": "Holder", "to": "Moved"],
      ["op": "move", "path": "Holder/Inner", "to": "Plain/Inner/Taken"],
      ["op": "move", "path": "Cloudy", "to": "Plain/Cloudy"],
    ] as [[String: Any]] {
      XCTAssertThrowsError(try directory.apply(json: try ops([change])), "\(change)")
    }
    XCTAssertEqual(tree(root), before)

    XCTAssertEqual(try directory.apply(json: try ops([["op": "move", "path": "Plain", "to": "Plain 2"]]))["conflicts"] as? [String], [])
    XCTAssertTrue(fm.fileExists(atPath: root.appendingPathComponent("Plain 2/Inner/Ok.webloc").path))
  }

  func testTheHoldingCheckStopsAtTheFirstMatchFollowsNoLinksAndNeverOpensAPackage() throws {
    let elsewhere = try folder("Elsewhere/Ardia Sync")
    let root = try folder("Drive")
    try fm.createSymbolicLink(at: root.appendingPathComponent("Linked"), withDestinationURL: elsewhere.deletingLastPathComponent())
    _ = try folder("Drive/Deep/A/B/C/D")
    let isPackage = { (path: String) in path.hasSuffix(".app") }
    var visited: [String] = []
    let watching = { (path: String) -> Bool in
      visited.append(path)
      return isPackage(path)
    }

    XCTAssertFalse(SharedFolderDirectory.holdsUpstreamFolder(root.path, isPackage: watching))
    XCTAssertFalse(visited.contains { $0.hasPrefix(root.appendingPathComponent("Linked").path) })
    XCTAssertTrue(visited.contains(root.appendingPathComponent("Deep/A/B/C/D").path))

    _ = try folder("Drive/Deep/A/B/C/D/ardia shared.")
    XCTAssertTrue(SharedFolderDirectory.holdsUpstreamFolder(root.path, isPackage: isPackage))
    try fm.removeItem(at: root.appendingPathComponent("Deep/A/B/C/D/ardia shared."))

    _ = try folder("Drive/Ardia Sync")
    visited = []
    XCTAssertTrue(SharedFolderDirectory.holdsUpstreamFolder(root.path, isPackage: watching))
    XCTAssertFalse(visited.contains { ($0 as NSString).deletingLastPathComponent != root.path }, "\(visited)")
    try fm.removeItem(at: root.appendingPathComponent("Ardia Sync"))

    _ = try folder("Drive/Deep/Tool.app/Contents")
    visited = []
    XCTAssertTrue(SharedFolderDirectory.holdsUpstreamFolder(root.path, isPackage: watching))
    XCTAssertFalse(visited.contains { $0.contains("/Tool.app/") }, "\(visited)")
    try fm.removeItem(at: root.appendingPathComponent("Deep/Tool.app"))

    let locked = try folder("Drive/Deep/Locked")
    try fm.setAttributes([.posixPermissions: 0o000], ofItemAtPath: locked.path)
    if access(locked.path, R_OK) != 0 {
      XCTAssertTrue(SharedFolderDirectory.holdsUpstreamFolder(root.path, isPackage: isPackage))
    }
    try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: locked.path)

    let directory = SharedFolderDirectory(root: root)
    XCTAssertEqual(try directory.apply(json: try ops([["op": "move", "path": "Deep", "to": "Moved"]]))["conflicts"] as? [String], [])
    XCTAssertTrue(fm.fileExists(atPath: root.appendingPathComponent("Moved/A/B/C/D").path))
    XCTAssertTrue(fm.fileExists(atPath: elsewhere.path))
  }
}
