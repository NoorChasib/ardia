import Foundation
import SQLite3

final class SQLiteSnapshot {
  private var db: OpaquePointer?
  private let tempDir: URL?

  init(copying source: URL) throws {
    let fm = FileManager.default
    let name = source.lastPathComponent
    let folder = try Self.openResolvedFolder(of: source)
    defer { close(folder) }
    guard let file = try Self.openSourceFile(name, in: folder, required: true) else {
      throw ImportError.notFound("\(name) not found")
    }
    defer { close(file) }
    var siblings: [(suffix: String, descriptor: Int32)] = []
    defer { siblings.forEach { close($0.descriptor) } }
    for suffix in ["-wal", "-journal"] {
      if let sibling = try Self.openSourceFile(name + suffix, in: folder, required: false) { siblings.append((suffix, sibling)) }
    }
    let dir = fm.temporaryDirectory.appendingPathComponent("\(Self.prefix)\(getpid())-\(UUID().uuidString)", isDirectory: true)
    tempDir = dir
    try fm.createDirectory(at: dir, withIntermediateDirectories: true)
    let copy = dir.appendingPathComponent("db.sqlite")
    do {
      try Self.copyBytes(from: file, to: copy.path)
      for sibling in siblings { try Self.copyBytes(from: sibling.descriptor, to: copy.path + sibling.suffix) }
    } catch {
      try? fm.removeItem(at: dir)
      throw ImportError.unreadable("Couldn't copy \(name): \(error.localizedDescription)")
    }

    if sqlite3_open_v2(copy.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_NOFOLLOW, nil) != SQLITE_OK {
      sqlite3_close(db)
      db = nil
      let uri = "file:\(copy.path)?immutable=1"
      if sqlite3_open_v2(uri, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_URI | SQLITE_OPEN_NOFOLLOW, nil) != SQLITE_OK {
        let message = db.map { String(cString: sqlite3_errmsg($0)) } ?? "open failed"
        sqlite3_close(db)
        db = nil
        try? fm.removeItem(at: dir)
        throw ImportError.unreadable("Couldn't open \(source.lastPathComponent): \(message)")
      }
    }
    sqlite3_busy_timeout(db, 2000)
  }

  init(memory bytes: Data, name: String) throws {
    tempDir = nil
    guard !bytes.isEmpty, let buffer = sqlite3_malloc64(sqlite3_uint64(bytes.count)) else {
      throw ImportError.unreadable("Couldn't open \(name)")
    }
    bytes.withUnsafeBytes { buffer.copyMemory(from: $0.baseAddress!, byteCount: bytes.count) }
    guard sqlite3_open_v2(":memory:", &db, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK else {
      sqlite3_free(buffer)
      sqlite3_close(db)
      db = nil
      throw ImportError.unreadable("Couldn't open \(name)")
    }
    let flags = UInt32(SQLITE_DESERIALIZE_FREEONCLOSE | SQLITE_DESERIALIZE_READONLY)
    let size = sqlite3_int64(bytes.count)
    guard sqlite3_deserialize(db, "main", buffer.assumingMemoryBound(to: UInt8.self), size, size, flags) == SQLITE_OK else {
      let message = String(cString: sqlite3_errmsg(db))
      sqlite3_close(db)
      db = nil
      throw ImportError.unreadable("Couldn't open \(name): \(message)")
    }
    guard sqlite3_compileoption_used("TEMP_STORE=0") == 0,
          sqlite3_exec(db, "PRAGMA temp_store=MEMORY", nil, nil, nil) == SQLITE_OK,
          (try? scalar("PRAGMA temp_store")) == 2 else {
      sqlite3_close(db)
      db = nil
      throw ImportError.unreadable("Couldn't keep \(name) in memory")
    }
  }

  deinit {
    if tempDir == nil, let db {
      var size: sqlite3_int64 = 0
      if let bytes = sqlite3_serialize(db, "main", &size, UInt32(SQLITE_SERIALIZE_NOCOPY)), size > 0 {
        _ = memset_s(bytes, Int(size), 0, Int(size))
      }
    }
    sqlite3_close(db)
    if let tempDir { try? FileManager.default.removeItem(at: tempDir) }
  }

  static func openResolvedFolder(of source: URL) throws -> Int32 {
    let name = source.lastPathComponent
    guard source.isFileURL, !name.isEmpty, name != "/", name != ".", name != "..", !name.contains("/") else {
      throw ImportError.unreadable("Couldn't open \(name)")
    }
    guard let resolved = realpath(source.deletingLastPathComponent().path, nil) else {
      let code = errno
      if code == ENOENT { throw ImportError.notFound("\(name) not found") }
      throw ImportError.unreadable("Couldn't open \(name): \(String(cString: strerror(code)))")
    }
    let folder = open(resolved, O_RDONLY | O_DIRECTORY | O_CLOEXEC)
    let code = errno
    free(resolved)
    guard folder >= 0 else { throw ImportError.unreadable("Couldn't open \(name): \(String(cString: strerror(code)))") }
    return folder
  }

  static func openSourceFile(_ name: String, in folder: Int32, required: Bool) throws -> Int32? {
    let descriptor = openat(folder, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
    guard descriptor >= 0 else {
      let code = errno
      if code == ENOENT {
        if required { throw ImportError.notFound("\(name) not found") }
        return nil
      }
      if code == ELOOP { throw ImportError.unreadable("\(name) is a link, so Nilla won't follow it") }
      throw ImportError.unreadable("Couldn't open \(name): \(String(cString: strerror(code)))")
    }
    var info = stat()
    guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG else {
      close(descriptor)
      throw ImportError.unreadable("\(name) isn't a regular file")
    }
    return descriptor
  }

  static func copyBytes(from source: Int32, to path: String) throws {
    let target = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
    guard target >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
    defer { close(target) }
    var buffer = [UInt8](repeating: 0, count: 1 << 20)
    while true {
      let count = buffer.withUnsafeMutableBytes { read(source, $0.baseAddress, $0.count) }
      if count == 0 { return }
      if count < 0 {
        if errno == EINTR { continue }
        throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
      }
      var written = 0
      while written < count {
        let step = buffer.withUnsafeBytes { write(target, $0.baseAddress! + written, count - written) }
        if step < 0 {
          if errno == EINTR { continue }
          throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
        written += step
      }
    }
  }

  static let prefix = "nilla-import-"
  static let leftoverAge: TimeInterval = 3600

  static func removeLeftovers(in folder: URL = FileManager.default.temporaryDirectory, now: Date = Date()) {
    let fm = FileManager.default
    for name in (try? fm.contentsOfDirectory(atPath: folder.path)) ?? [] where isLeftover(name, in: folder, now: now) {
      try? fm.removeItem(at: folder.appendingPathComponent(name, isDirectory: true))
    }
  }

  static func isLeftover(_ name: String, in folder: URL, now: Date) -> Bool {
    guard name.hasPrefix(prefix) else { return false }
    let rest = name.dropFirst(prefix.count)
    if UUID(uuidString: String(rest)) != nil {
      let modified = (try? FileManager.default.attributesOfItem(atPath: folder.appendingPathComponent(name).path))?[.modificationDate] as? Date
      return modified.map { now.timeIntervalSince($0) > leftoverAge } ?? false
    }
    let parts = rest.split(separator: "-", maxSplits: 1)
    guard parts.count == 2, UUID(uuidString: String(parts[1])) != nil, let pid = pid_t(parts[0]), pid > 0 else { return false }
    return pid != getpid() && kill(pid, 0) != 0 && errno == ESRCH
  }

  func tableExists(_ name: String) -> Bool {
    (try? scalar("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", [.text(name)])) ?? 0 > 0
  }

  func scalar(_ sql: String, _ bindings: [Value] = []) throws -> Int64? {
    var result: Int64?
    try query(sql, bindings) { row in
      result = row.int(0)
      return false
    }
    return result
  }

  enum Value {
    case int(Int64)
    case text(String)
  }

  func query(_ sql: String, _ bindings: [Value] = [], _ body: (Row) throws -> Bool) throws {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
      throw ImportError.unreadable(String(cString: sqlite3_errmsg(db)))
    }
    defer { sqlite3_finalize(stmt) }
    let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    for (i, value) in bindings.enumerated() {
      switch value {
      case .int(let v): sqlite3_bind_int64(stmt, Int32(i + 1), v)
      case .text(let v): sqlite3_bind_text(stmt, Int32(i + 1), v, -1, transient)
      }
    }
    let row = Row(stmt: stmt!)
    while true {
      let rc = sqlite3_step(stmt)
      if rc == SQLITE_DONE { return }
      guard rc == SQLITE_ROW else { throw ImportError.unreadable(String(cString: sqlite3_errmsg(db))) }
      if try !body(row) { return }
    }
  }

  struct Row {
    let stmt: OpaquePointer
    private let columns: [String: Int32]

    init(stmt: OpaquePointer) {
      self.stmt = stmt
      var columns: [String: Int32] = [:]
      for i in 0..<sqlite3_column_count(stmt) {
        let name = String(cString: sqlite3_column_name(stmt, i))
        if columns[name] == nil { columns[name] = i }
      }
      self.columns = columns
    }

    func index(_ name: String) -> Int32? { columns[name] }

    func isNull(_ i: Int32) -> Bool { sqlite3_column_type(stmt, i) == SQLITE_NULL }

    func int(_ i: Int32) -> Int64 { sqlite3_column_int64(stmt, i) }
    func int(_ name: String) -> Int64? { index(name).flatMap { isNull($0) ? nil : int($0) } }

    func text(_ i: Int32) -> String? {
      guard let p = sqlite3_column_text(stmt, i) else { return nil }
      return String(cString: p)
    }
    func text(_ name: String) -> String? { index(name).flatMap { text($0) } }

    func blob(_ i: Int32) -> Data? {
      let count = Int(sqlite3_column_bytes(stmt, i))
      guard let p = sqlite3_column_blob(stmt, i) else { return count == 0 && !isNull(i) ? Data() : nil }
      return Data(bytes: p, count: count)
    }
    func blob(_ name: String) -> Data? { index(name).flatMap { blob($0) } }

    func blobPointer(_ i: Int32) -> UnsafeRawBufferPointer? {
      guard !isNull(i) else { return nil }
      let p = sqlite3_column_blob(stmt, i)
      let count = Int(sqlite3_column_bytes(stmt, i))
      return UnsafeRawBufferPointer(start: count > 0 ? p : nil, count: count)
    }

    func secret(_ name: String) -> SecretBytes? {
      index(name).flatMap { blobPointer($0) }.map { SecretBytes(copying: $0) }
    }

    func has(_ name: String) -> Bool { index(name) != nil }
  }
}

public final class SQLiteSnapshots {
  private var open: [String: SQLiteSnapshot] = [:]

  public init() {}

  func snapshot(copying source: URL) throws -> SQLiteSnapshot {
    let key = source.standardizedFileURL.path
    if let db = open[key] { return db }
    let db = try SQLiteSnapshot(copying: source)
    open[key] = db
    return db
  }
}
