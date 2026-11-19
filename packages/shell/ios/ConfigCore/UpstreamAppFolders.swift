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

  public static func ownPath(_ path: String, home: String = NSHomeDirectory()) -> String? {
    guard let resolved = resolve(path) else { return nil }
    let candidate = comparable(resolved)
    for folder in folders(home: home) {
      guard let root = resolve(folder).map(comparable) else { return nil }
      if candidate == root || candidate.hasPrefix(root + "/") { return nil }
    }
    return resolved
  }

  public static func resolve(_ path: String) -> String? {
    guard path.hasPrefix("/"), !path.contains("\0") else { return nil }
    var resolved = ["/"]
    var missing = false
    var info = stat()
    for part in (path as NSString).pathComponents.dropFirst() {
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
    return NSString.path(withComponents: resolved)
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
