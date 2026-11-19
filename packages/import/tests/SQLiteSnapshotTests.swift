import Foundation
import SQLite3
import XCTest
@testable import NillaImportCore

final class SQLiteSnapshotTests: XCTestCase {
  private var folder: URL!
  private let fm = FileManager.default

  override func setUpWithError() throws {
    folder = fm.temporaryDirectory.appendingPathComponent("snapshot-tests-\(UUID().uuidString)", isDirectory: true)
    try fm.createDirectory(at: folder, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try? fm.removeItem(at: folder)
  }

  private func copyFolder(_ name: String, modified: Date = Date()) throws -> URL {
    let url = folder.appendingPathComponent(name, isDirectory: true)
    try fm.createDirectory(at: url, withIntermediateDirectories: true)
    try Data("logins".utf8).write(to: url.appendingPathComponent("db.sqlite"))
    try fm.setAttributes([.modificationDate: modified], ofItemAtPath: url.path)
    return url
  }

  private func exitedPid() throws -> pid_t {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/true")
    try process.run()
    process.waitUntilExit()
    return process.processIdentifier
  }

  func testCopiesLeftByAnImportThatNeverFinishedAreRemovedAndLiveOnesStay() throws {
    let now = Date()
    let dead = try copyFolder("nilla-import-\(try exitedPid())-\(UUID().uuidString)")
    let live = try copyFolder("nilla-import-\(getpid())-\(UUID().uuidString)")
    let oldUnnamed = try copyFolder("nilla-import-\(UUID().uuidString)", modified: now.addingTimeInterval(-7200))
    let freshUnnamed = try copyFolder("nilla-import-\(UUID().uuidString)", modified: now.addingTimeInterval(-60))
    let unrelated = try copyFolder("nilla-import-swiftpm", modified: now.addingTimeInterval(-86_400))

    SQLiteSnapshot.removeLeftovers(in: folder, now: now)

    XCTAssertFalse(fm.fileExists(atPath: dead.path))
    XCTAssertFalse(fm.fileExists(atPath: oldUnnamed.path))
    XCTAssertTrue(fm.fileExists(atPath: live.path))
    XCTAssertTrue(fm.fileExists(atPath: freshUnnamed.path))
    XCTAssertTrue(fm.fileExists(atPath: unrelated.path))
  }

  func testACopyIsNamedForItsProcessAndGoesWithIt() throws {
    let before = Set(try fm.contentsOfDirectory(atPath: fm.temporaryDirectory.path).filter { $0.hasPrefix("nilla-import-\(getpid())-") })
    var snapshot: SQLiteSnapshot? = try SQLiteSnapshot(copying: Fixtures.support("Google/Chrome/Default/History"))
    let during = Set(try fm.contentsOfDirectory(atPath: fm.temporaryDirectory.path).filter { $0.hasPrefix("nilla-import-\(getpid())-") })
    XCTAssertEqual(during.subtracting(before).count, 1)
    XCTAssertTrue(snapshot?.tableExists("urls") ?? false)
    snapshot = nil
    let after = Set(try fm.contentsOfDirectory(atPath: fm.temporaryDirectory.path).filter { $0.hasPrefix("nilla-import-\(getpid())-") })
    XCTAssertEqual(after, before)
  }

  private func makeDatabase(_ url: URL, table: String) throws {
    try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    var db: OpaquePointer?
    defer { sqlite3_close(db) }
    guard sqlite3_open(url.path, &db) == SQLITE_OK,
          sqlite3_exec(db, "CREATE TABLE \(table) (value TEXT); INSERT INTO \(table) VALUES ('x');", nil, nil, nil) == SQLITE_OK else {
      throw ImportError.unreadable("fixture")
    }
  }

  private func state(_ folder: URL) throws -> [String: Data] {
    var files: [String: Data] = [:]
    for name in try fm.contentsOfDirectory(atPath: folder.path) {
      files[name] = try Data(contentsOf: folder.appendingPathComponent(name))
    }
    return files
  }

  private func temporaryCopies() throws -> Set<String> {
    Set(try fm.contentsOfDirectory(atPath: fm.temporaryDirectory.path).filter { $0.hasPrefix("nilla-import-\(getpid())-") })
  }

  func testALinkedSourceFileIsNeverFollowedOrOpened() throws {
    let elsewhere = folder.appendingPathComponent("Elsewhere", isDirectory: true)
    try makeDatabase(elsewhere.appendingPathComponent("History"), table: "secret")
    let profile = folder.appendingPathComponent("Profile", isDirectory: true)
    try fm.createDirectory(at: profile, withIntermediateDirectories: true)
    try fm.createSymbolicLink(at: profile.appendingPathComponent("History"), withDestinationURL: elsewhere.appendingPathComponent("History"))
    try fm.createSymbolicLink(atPath: profile.appendingPathComponent("Favicons").path, withDestinationPath: "../Elsewhere/History")
    let before = try state(elsewhere)
    let copies = try temporaryCopies()

    for name in ["History", "Favicons"] {
      XCTAssertThrowsError(try SQLiteSnapshot(copying: profile.appendingPathComponent(name)), name) { error in
        XCTAssertEqual((error as? ImportError)?.code, "unreadable")
      }
    }
    XCTAssertEqual(try state(elsewhere), before)
    XCTAssertEqual(try temporaryCopies(), copies)
  }

  func testALinkedWriteAheadLogOrJournalIsRefusedAndNeverRead() throws {
    let elsewhere = folder.appendingPathComponent("Elsewhere", isDirectory: true)
    try makeDatabase(elsewhere.appendingPathComponent("Other"), table: "secret")
    for suffix in ["-wal", "-journal"] {
      let profile = folder.appendingPathComponent("Profile\(suffix)", isDirectory: true)
      try makeDatabase(profile.appendingPathComponent("History"), table: "urls")
      try fm.createSymbolicLink(at: profile.appendingPathComponent("History\(suffix)"), withDestinationURL: elsewhere.appendingPathComponent("Other"))
      XCTAssertThrowsError(try SQLiteSnapshot(copying: profile.appendingPathComponent("History")), suffix)
    }
    XCTAssertEqual(try fm.contentsOfDirectory(atPath: elsewhere.path), ["Other"])
  }

  func testASourceReachedThroughALinkedFolderCopiesTheResolvedFileOnly() throws {
    let real = folder.appendingPathComponent("Real/Default", isDirectory: true)
    try makeDatabase(real.appendingPathComponent("History"), table: "urls")
    let picked = folder.appendingPathComponent("Picked", isDirectory: true)
    try fm.createSymbolicLink(at: picked, withDestinationURL: real)
    let snapshot = try SQLiteSnapshot(copying: picked.appendingPathComponent("History"))
    XCTAssertTrue(snapshot.tableExists("urls"))
    let made = try temporaryCopies().compactMap { name -> String? in
      let copy = fm.temporaryDirectory.appendingPathComponent(name).appendingPathComponent("db.sqlite").path
      var info = stat()
      guard lstat(copy, &info) == 0 else { return nil }
      XCTAssertEqual(info.st_mode & S_IFMT, S_IFREG)
      XCTAssertEqual(info.st_mode & 0o077, 0)
      return copy
    }
    XCTAssertFalse(made.isEmpty)
    XCTAssertEqual(try fm.contentsOfDirectory(atPath: real.path), ["History"])
  }

  func testAPipeOrFolderInPlaceOfTheSourceIsRefusedWithoutBlocking() throws {
    let profile = folder.appendingPathComponent("Profile", isDirectory: true)
    try fm.createDirectory(at: profile.appendingPathComponent("Favicons"), withIntermediateDirectories: true)
    XCTAssertEqual(mkfifo(profile.appendingPathComponent("History").path, 0o600), 0)
    let start = Date()
    for name in ["History", "Favicons"] {
      XCTAssertThrowsError(try SQLiteSnapshot(copying: profile.appendingPathComponent(name)), name)
    }
    XCTAssertLessThan(Date().timeIntervalSince(start), 5)
    XCTAssertThrowsError(try SQLiteSnapshot(copying: profile.appendingPathComponent("Missing"))) { error in
      XCTAssertEqual((error as? ImportError)?.code, "notFound")
    }
    XCTAssertThrowsError(try SQLiteSnapshot(copying: folder.appendingPathComponent("Gone/History"))) { error in
      XCTAssertEqual((error as? ImportError)?.code, "notFound")
    }
  }

  func testOneImportCopiesEachSourceFileOnce() throws {
    let places = Fixtures.support("Firefox/Profiles/abcd1234.default-release/places.sqlite")
    let snapshots = SQLiteSnapshots()
    let first = try snapshots.snapshot(copying: places)
    let again = try snapshots.snapshot(copying: URL(fileURLWithPath: places.path + "/../places.sqlite").standardizedFileURL)
    XCTAssertTrue(first === again)
    let bookmarks = try Firefox.bookmarks(places: places, snapshots: snapshots)
    let history = try HistoryReader.read(places, flavor: .firefox, snapshots: snapshots)
    XCTAssertEqual(bookmarks.linkCount, try Firefox.bookmarks(places: places).linkCount)
    XCTAssertEqual(history.count, try HistoryReader.read(places, flavor: .firefox).count)
  }
}
