import AppKit
import ArdiaCore
import ExpoModulesCore

public class SharedFoldersModule: Module {
  private static let work = DispatchQueue(label: "nilla.shared-folders", qos: .utility)
  private var watcher: SharedFolderWatcher?

  public func definition() -> ModuleDefinition {
    Name("NillaSharedFolders")

    Events("onChange")

    OnCreate { [weak self] in
      self?.watcher = SharedFolderWatcher { [weak self] paths in self?.sendEvent("onChange", ["paths": paths]) }
    }

    Function("location") { () -> [String: Any] in
      [
        "path": Self.defaultParent.path,
        "iCloudAvailable": Self.testParent != nil || SyncFolder.iCloudDriveAvailable,
        "iCloudPath": SyncFolder.iCloudDrive.path,
      ]
    }

    AsyncFunction("read") { (path: String) -> [String: Any] in
      guard (try? UpstreamSyncFolder.ownShared(path)) != nil else {
        return ["exists": false, "error": UpstreamSyncFolder.sharedRefusalMessage(path)]
      }
      return SharedFolderDirectory(root: URL(fileURLWithPath: path, isDirectory: true)).read()
    }.runOnQueue(Self.work)

    AsyncFunction("apply") { (path: String, ops: String) throws -> [String: Any] in
      try SharedFolderDirectory(root: try Self.ownRoot(path)).apply(json: ops)
    }.runOnQueue(Self.work)

    AsyncFunction("create") { (parent: String, name: String) throws -> String in
      try SharedFolderDirectory.create(in: try Self.ownRoot(parent), named: name).path
    }.runOnQueue(Self.work)

    Function("watch") { [weak self] (paths: [String]) in
      self?.watcher?.watch(paths.filter { if case .own = UpstreamSyncFolder.checkShared($0) { return true } else { return false } })
    }

    OnDestroy { [weak self] in self?.watcher?.stop() }
  }

  static func ownRoot(_ path: String) throws -> URL {
    guard (try? UpstreamSyncFolder.ownShared(path)) != nil else {
      throw Exception(name: "upstreamSharedFolder", description: UpstreamSyncFolder.sharedRefusalMessage(path), code: UpstreamSyncFolder.sharedRefusedCode)
    }
    return URL(fileURLWithPath: path, isDirectory: true)
  }

  private static let dataDirectory = LaunchConfig.shared.dataDirectory.map { URL(fileURLWithPath: $0, isDirectory: true) }
  private static let testParent = LaunchConfig.shared.instance("sharedFolders").map { URL(fileURLWithPath: $0, isDirectory: true) }

  static var defaultParent: URL {
    if let testParent { return testParent }
    if let dataDirectory { return dataDirectory.appendingPathComponent("Nilla Shared", isDirectory: true) }
    return SyncFolder.iCloudDrive.appendingPathComponent("Nilla Shared", isDirectory: true)
  }
}
