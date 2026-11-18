import Foundation

public struct ServicesSnapshot: Equatable {
  public static let urlFields = [
    "telemetryUrl", "feedbackUrl", "switchesUrl", "macFeedUrl", "windowsFeedUrl", "windowsTrustedPrefix",
    "linuxReleasesUrl", "releaseNotesUrl", "siteUrl", "issueUrl",
  ]
  public static let fields = urlFields + ["ingestKeys", "sourceRepo"]
  public static let ingestKeyFields = ["app", "cli", "site"]
  public static let largestFileBytes = 64 * 1024

  public enum Refusal: Error, Equatable {
    case unreadable
    case notAnObject
    case unknownField(String)
    case notHttps(String)
    case notAFolder(String)
    case wrongType(String)
  }

  public let values: [String: Any]

  public static func == (a: ServicesSnapshot, b: ServicesSnapshot) -> Bool {
    NSDictionary(dictionary: a.values).isEqual(to: b.values)
  }

  public func url(_ field: String) -> URL? {
    guard let text = values[field] as? String else { return nil }
    return URL(string: text)
  }

  public func string(_ field: String) -> String? { values[field] as? String }

  public static func url(_ field: String, in snapshot: ServicesSnapshot?, built: String?) -> URL? {
    if let snapshot, snapshot.values.keys.contains(field) { return snapshot.url(field) }
    guard let built = built?.trimmingCharacters(in: .whitespaces), isHttps(built) else { return nil }
    return URL(string: built)
  }

  public static func isHttps(_ value: Any) -> Bool {
    guard let text = value as? String, let url = URL(string: text), url.scheme == "https", url.host?.isEmpty == false else { return false }
    return true
  }

  public static func isFolderPrefix(_ value: Any) -> Bool {
    guard isHttps(value), let text = value as? String, let url = URL(string: text), url.user == nil, url.query == nil, url.fragment == nil else { return false }
    return text.hasSuffix("/") && !text.contains("..") && !text.contains("%") && !text.contains("@")
  }

  public static func read(_ data: Data) -> Result<ServicesSnapshot, Refusal> {
    guard data.count <= largestFileBytes, let object = try? JSONSerialization.jsonObject(with: data) else { return .failure(.unreadable) }
    guard let fields = object as? [String: Any] else { return .failure(.notAnObject) }
    for field in fields.keys.sorted() {
      let value = fields[field]!
      guard Self.fields.contains(field) else { return .failure(.unknownField(field)) }
      let isNull = value is NSNull
      switch field {
      case "ingestKeys":
        if isNull { continue }
        guard let keys = value as? [String: Any], Set(keys.keys) == Set(ingestKeyFields),
          keys.values.allSatisfy({ ($0 as? String)?.isEmpty == false })
        else { return .failure(.wrongType(field)) }
      case "sourceRepo":
        guard let repo = value as? String, repo.range(of: #"^[\w.-]+/[\w.-]+$"#, options: .regularExpression) != nil else {
          return .failure(.wrongType(field))
        }
      case "windowsTrustedPrefix":
        if isNull { continue }
        guard value is String else { return .failure(.wrongType(field)) }
        guard isFolderPrefix(value) else { return .failure(.notAFolder(field)) }
      case "issueUrl":
        guard isHttps(value) else { return .failure(.notHttps(field)) }
      default:
        if isNull { continue }
        guard value is String else { return .failure(.wrongType(field)) }
        guard isHttps(value) else { return .failure(.notHttps(field)) }
      }
    }
    return .success(ServicesSnapshot(values: fields))
  }
}
