import ArdiaCore
import Foundation

enum ServicesConfig {
  static let snapshot: ServicesSnapshot? = {
    guard let path = LaunchConfig.shared.testValue("services"), !path.isEmpty else { return nil }
    guard let data = FileManager.default.contents(atPath: path) else {
      NSLog("[services] %@ could not be read; every service stays off", path)
      return nil
    }
    switch ServicesSnapshot.read(data) {
    case .success(let snapshot):
      return snapshot
    case .failure(let refusal):
      NSLog("[services] %@ refused (%@); every service stays off", path, String(describing: refusal))
      return nil
    }
  }()

  static func url(_ field: String) -> URL? { snapshot?.url(field) }

  static var feedbackURL: URL? { url("feedbackUrl") }
  static var macFeedURL: URL? { url("macFeedUrl") }
  static var releaseNotesURL: URL? { url("releaseNotesUrl") }
  static var issueURL: URL { url("issueUrl") ?? URL(string: "https://github.com/\(sourceRepo)/issues/new")! }
  static var sourceRepo: String { snapshot?.string("sourceRepo") ?? "NoorChasib/nilla" }
  static var sourceURL: URL { URL(string: "https://github.com/\(sourceRepo)")! }

  static var forJavaScript: Any { snapshot?.values ?? NSNull() }
}
