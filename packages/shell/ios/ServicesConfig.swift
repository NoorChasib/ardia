import ArdiaCore
import Foundation

enum ServicesConfig {
  static let snapshot: ServicesSnapshot? = {
    guard let path = LaunchConfig.shared.testValue("services"), !path.isEmpty else { return nil }
    guard let data = FileManager.default.contents(atPath: path) else {
      NSLog("[services] %@ could not be read; the build's own settings stay", path)
      return nil
    }
    switch ServicesSnapshot.read(data) {
    case .success(let snapshot):
      return snapshot
    case .failure(let refusal):
      NSLog("[services] %@ refused (%@); the build's own settings stay", path, String(describing: refusal))
      return nil
    }
  }()

  private static func info(_ key: String) -> String? { Bundle.main.object(forInfoDictionaryKey: key) as? String }

  static func url(_ field: String, built key: String) -> URL? { ServicesSnapshot.url(field, in: snapshot, built: info(key)) }

  static var feedbackURL: URL? { url("feedbackUrl", built: "NLReportServerURL") }
  static var macFeedURL: URL? { url("macFeedUrl", built: "SUFeedURL") }
  static var releaseNotesURL: URL? { url("releaseNotesUrl", built: "NLReleaseNotesURL") }
  static var testsMacFeed: Bool { snapshot?.url("macFeedUrl") != nil }
  static var issueURL: URL { snapshot?.url("issueUrl") ?? URL(string: "https://github.com/\(sourceRepo)/issues/new")! }
  static var sourceRepo: String { snapshot?.string("sourceRepo") ?? "NoorChasib/nilla" }
  static var sourceURL: URL { URL(string: "https://github.com/\(sourceRepo)")! }

  static var forJavaScript: Any { snapshot?.values ?? NSNull() }
}
