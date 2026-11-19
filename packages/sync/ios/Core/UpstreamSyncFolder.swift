import Foundation

public enum UpstreamSyncFolder {
  public static let name = "Ardia Sync"
  public static let sharedName = "Ardia Shared"
  public static let sharedRefusal = "That folder is in Ardia's Shared folder. Nilla keeps its shared folders apart from Ardia's, so choose another folder."
  public static let sharedRefusedCode = "ERR_UPSTREAM_SHARED_FOLDER"
  public static let refusal = "That folder is Ardia's Sync folder. Nilla keeps its sync data apart from Ardia's, so choose another folder."
  public static let unresolved = "Nilla couldn't tell where that folder leads, so it won't use it for sync. Choose another folder."
  public static let refusedCode = "ERR_UPSTREAM_SYNC_FOLDER"
  public static let unresolvedCode = "ERR_SYNC_FOLDER_UNRESOLVED"

  public enum Verdict: Equatable {
    case own(URL)
    case upstream
    case unresolved
  }

  public struct Refused: Error, Equatable {
    public let verdict: Verdict
  }

  public static func namesUpstream(_ component: String) -> Bool {
    names(component, [name])
  }

  static func names(_ component: String, _ upstream: [String]) -> Bool {
    if let ascii = asciiFolded(component) {
      return upstream.contains { target in ascii.elementsEqual(target.utf8.map(asciiLowercased)) }
    }
    return foldedNames(component, upstream)
  }

  static func asciiFolded(_ component: String) -> [UInt8]? {
    var bytes = Array(component.utf8)
    guard bytes.allSatisfy({ $0 < 0x80 }) else { return nil }
    let isSpace = { (byte: UInt8) in byte == 0x20 || (0x09...0x0D).contains(byte) }
    while let last = bytes.last, isSpace(last) { bytes.removeLast() }
    let leading = bytes.prefix(while: isSpace).count
    bytes.removeFirst(leading)
    while let last = bytes.last, last == UInt8(ascii: ".") || last == UInt8(ascii: " ") { bytes.removeLast() }
    return bytes.map(asciiLowercased)
  }

  static func asciiLowercased(_ byte: UInt8) -> UInt8 {
    (UInt8(ascii: "A")...UInt8(ascii: "Z")).contains(byte) ? byte + 32 : byte
  }

  static func foldedNames(_ component: String, _ upstream: [String]) -> Bool {
    var folded = component.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines)
    while let last = folded.last, last == "." || last == " " { folded.removeLast() }
    return upstream.contains { folded.compare($0, options: [.caseInsensitive], range: nil, locale: nil) == .orderedSame }
  }

  public static func check(_ path: String, cwd: String = FileManager.default.currentDirectoryPath) -> Verdict {
    check(path, cwd: cwd, upstream: [name])
  }

  public static func checkShared(_ path: String, cwd: String = FileManager.default.currentDirectoryPath) -> Verdict {
    check(path, cwd: cwd, upstream: [sharedName, name])
  }

  public static let sharedUnresolved = "Nilla couldn't tell where that folder leads, so it won't share it. Choose another folder."

  public static func sharedRefusalMessage(_ path: String) -> String {
    checkShared(path) == .unresolved ? sharedUnresolved : sharedRefusal
  }

  public static func ownShared(_ path: String) throws -> URL {
    let verdict = checkShared(path)
    guard case .own(let url) = verdict else { throw Refused(verdict: verdict) }
    return url
  }

  static func check(_ path: String, cwd: String, upstream: [String]) -> Verdict {
    guard !path.isEmpty, !path.contains("\0") else { return .unresolved }
    let absolute = path.hasPrefix("/") ? path : (cwd as NSString).appendingPathComponent(path)
    let given = (absolute as NSString).pathComponents
    let named = { (component: String) in names(component, upstream) }
    if given.contains(where: named) { return .upstream }
    guard let resolved = resolve(given) else { return .unresolved }
    if resolved.contains(where: named) { return .upstream }
    return .own(URL(fileURLWithPath: NSString.path(withComponents: resolved), isDirectory: true))
  }

  public static func own(_ path: String, cwd: String = FileManager.default.currentDirectoryPath) throws -> URL {
    let verdict = check(path, cwd: cwd)
    guard case .own(let url) = verdict else { throw Refused(verdict: verdict) }
    return url
  }

  public static func ownURL(_ url: URL) throws -> URL {
    try own(url.path)
  }

  public static func pickerSeed(_ current: String?) -> URL? {
    guard let current, case .own(let seed) = check(current) else { return nil }
    return seed
  }

  public static func folderToProbe(_ requested: String?, fallback: URL) throws -> URL {
    try own(requested ?? fallback.path)
  }

  public enum EntryKind: Equatable {
    case file
    case absent
    case other
  }

  public static func entryKind(_ url: URL) -> EntryKind {
    var info = stat()
    guard lstat(url.path, &info) == 0 else { return errno == ENOENT ? .absent : .other }
    return info.st_mode & S_IFMT == S_IFREG ? .file : .other
  }

  public static func readEntry(_ url: URL) throws -> Data {
    guard case .own = check(url.deletingLastPathComponent().path) else { throw Refused(verdict: .upstream) }
    let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
    guard descriptor >= 0 else {
      if errno == ELOOP { throw Refused(verdict: .upstream) }
      throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
    }
    let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    var info = stat()
    guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG else { throw Refused(verdict: .upstream) }
    return try handle.readToEnd() ?? Data()
  }

  static func resolve(_ components: [String]) -> [String]? {
    guard components.first == "/" else { return nil }
    var resolved = ["/"]
    var missing = false
    var info = stat()
    for part in components.dropFirst() {
      switch part {
      case "", ".", "/": continue
      case "..":
        guard !missing else { return nil }
        if resolved.count > 1 { resolved.removeLast() }
      default:
        if missing {
          resolved.append(part)
          continue
        }
        let candidate = NSString.path(withComponents: resolved + [part])
        if lstat(candidate, &info) == 0 {
          guard let real = realPath(candidate) else { return nil }
          resolved = (real as NSString).pathComponents
        } else if errno == ENOENT {
          missing = true
          resolved.append(part)
        } else {
          return nil
        }
      }
    }
    return resolved
  }

  static func realPath(_ path: String) -> String? {
    guard let pointer = realpath(path, nil) else { return nil }
    defer { free(pointer) }
    return String(cString: pointer)
  }
}
