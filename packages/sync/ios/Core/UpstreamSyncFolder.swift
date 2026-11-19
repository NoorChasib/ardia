import Foundation

public enum UpstreamSyncFolder {
  public static let name = "Ardia Sync"
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
    var folded = component.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines)
    while let last = folded.last, last == "." || last == " " { folded.removeLast() }
    return folded.compare(name, options: [.caseInsensitive], range: nil, locale: nil) == .orderedSame
  }

  public static func check(_ path: String, cwd: String = FileManager.default.currentDirectoryPath) -> Verdict {
    guard !path.isEmpty, !path.contains("\0") else { return .unresolved }
    let absolute = path.hasPrefix("/") ? path : (cwd as NSString).appendingPathComponent(path)
    let given = (absolute as NSString).pathComponents
    if given.contains(where: namesUpstream) { return .upstream }
    guard let resolved = resolve(given) else { return .unresolved }
    if resolved.contains(where: namesUpstream) { return .upstream }
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

  static func resolve(_ components: [String]) -> [String]? {
    guard components.first == "/" else { return nil }
    var head = components
    var tail: [String] = []
    var info = stat()
    while head.count > 1, lstat(NSString.path(withComponents: head), &info) != 0 {
      guard errno == ENOENT || errno == ENOTDIR else { return nil }
      tail.insert(head.removeLast(), at: 0)
    }
    guard let real = realPath(NSString.path(withComponents: head)) else { return nil }
    var resolved = (real as NSString).pathComponents
    for part in tail {
      switch part {
      case "", ".", "/": continue
      case "..": if resolved.count > 1 { resolved.removeLast() }
      default: resolved.append(part)
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
