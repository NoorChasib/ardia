import Foundation

public enum UpstreamAppFolders {
  public static func folders(home: String = NSHomeDirectory()) -> [String] {
    [
      ".config/ardia",
      ".local/share/ardia",
      ".local/state/ardia",
      ".cache/ardia",
      "Library/Application Support/Ardia",
      "Library/Application Support/com.ardia.browser",
      "Library/Logs/Ardia",
    ].map { (home as NSString).appendingPathComponent($0) }
  }

  static let maxLinkHops = 40

  public static func ownPath(_ path: String, home: String = NSHomeDirectory()) -> String? {
    guard let resolved = resolve(path) else { return nil }
    let candidate = comparable(resolved)
    for folder in folders(home: home) {
      guard let root = resolve(folder, followingDanglingLinks: true).map(comparable) else { return nil }
      if candidate == root || candidate.hasPrefix(root + "/") { return nil }
    }
    return resolved
  }

  public static func resolve(_ path: String, followingDanglingLinks: Bool = false) -> String? {
    guard path.hasPrefix("/"), !path.contains("\0") else { return nil }
    var pending = Array((path as NSString).pathComponents.dropFirst().reversed())
    var resolved = ["/"]
    var missing = false
    var hops = 0
    var info = stat()
    while let part = pending.popLast() {
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
          if let real = realPath(candidate) {
            resolved = (real as NSString).pathComponents
          } else if followingDanglingLinks, info.st_mode & S_IFMT == S_IFLNK, hops < maxLinkHops, let target = linkTarget(candidate) {
            hops += 1
            if target.hasPrefix("/") { resolved = ["/"] }
            pending.append(contentsOf: (target as NSString).pathComponents.reversed())
          } else {
            return nil
          }
        } else if errno == ENOENT {
          missing = true
          resolved.append(part)
        } else {
          return nil
        }
      }
    }
    return NSString.path(withComponents: resolved)
  }

  static func linkTarget(_ path: String) -> String? {
    var buffer = [CChar](repeating: 0, count: Int(PATH_MAX) + 1)
    let count = readlink(path, &buffer, buffer.count - 1)
    guard count > 0 else { return nil }
    return String(decoding: buffer[0..<count].map { UInt8(bitPattern: $0) }, as: UTF8.self)
  }

  static func comparable(_ path: String) -> String {
    let trimmed = path.count > 1 && path.hasSuffix("/") ? String(path.dropLast()) : path
    #if os(macOS)
      return trimmed.precomposedStringWithCanonicalMapping.lowercased()
    #else
      return trimmed
    #endif
  }

  static func realPath(_ path: String) -> String? {
    guard let pointer = realpath(path, nil) else { return nil }
    defer { free(pointer) }
    return String(cString: pointer)
  }
}
