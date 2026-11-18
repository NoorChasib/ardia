import XCTest
@testable import ArdiaUpdaterCore

final class ServicesSnapshotTests: XCTestCase {
  func read(_ json: String) -> Result<ServicesSnapshot, ServicesSnapshot.Refusal> {
    ServicesSnapshot.read(Data(json.utf8))
  }

  func testAValidSnapshotKeepsItsEndpoints() throws {
    let snapshot = try read(#"{"feedbackUrl":"https://feedback.example.test/api/feedback","switchesUrl":null,"ingestKeys":{"app":"a","cli":"c","site":"s"}}"#).get()
    XCTAssertEqual(snapshot.url("feedbackUrl")?.absoluteString, "https://feedback.example.test/api/feedback")
    XCTAssertNil(snapshot.url("switchesUrl"))
    XCTAssertNil(snapshot.url("telemetryUrl"))
  }

  func testAnUnknownFieldIsRefused() {
    XCTAssertEqual(read(#"{"feedbackURL":"https://x.test"}"#), .failure(.unknownField("feedbackURL")))
  }

  func testANonHttpsURLIsRefused() {
    XCTAssertEqual(read(#"{"telemetryUrl":"http://x.test/logs"}"#), .failure(.notHttps("telemetryUrl")))
    XCTAssertEqual(read(#"{"issueUrl":null}"#), .failure(.notHttps("issueUrl")))
  }

  func testAWrongTypeIsRefused() {
    XCTAssertEqual(read(#"{"macFeedUrl":3}"#), .failure(.wrongType("macFeedUrl")))
    XCTAssertEqual(read(#"{"ingestKeys":{"app":"a"}}"#), .failure(.wrongType("ingestKeys")))
    XCTAssertEqual(read(#"{"sourceRepo":"no slash"}"#), .failure(.wrongType("sourceRepo")))
    XCTAssertEqual(read("[]"), .failure(.notAnObject))
    XCTAssertEqual(read("not json"), .failure(.unreadable))
  }

  func testTheWindowsTrustedPrefixMustBeAWholeFolder() {
    for prefix in ["https://u.example.test", "https://u.example.test/r", "https://u.example.test/r?x=/", "https://me@u.example.test/r/"] {
      XCTAssertEqual(read(#"{"windowsTrustedPrefix":"\#(prefix)"}"#), .failure(.notAFolder("windowsTrustedPrefix")), prefix)
    }
    XCTAssertNotNil(try? read(#"{"windowsTrustedPrefix":"https://u.example.test/r/"}"#).get())
    XCTAssertNotNil(try? read(#"{"windowsTrustedPrefix":null}"#).get())
  }

  func testATestSnapshotFieldWinsOverTheBuiltValueAndAMissingFieldKeepsIt() throws {
    let built = "https://feedback.example.test/api"
    XCTAssertEqual(ServicesSnapshot.url("feedbackUrl", in: nil, built: built)?.absoluteString, built)
    XCTAssertNil(ServicesSnapshot.url("feedbackUrl", in: nil, built: ""))
    XCTAssertNil(ServicesSnapshot.url("feedbackUrl", in: nil, built: nil))
    XCTAssertNil(ServicesSnapshot.url("feedbackUrl", in: nil, built: "http://feedback.example.test/api"))
    let off = try read(#"{"feedbackUrl":null}"#).get()
    XCTAssertNil(ServicesSnapshot.url("feedbackUrl", in: off, built: built))
    let other = try read(#"{"switchesUrl":null}"#).get()
    XCTAssertEqual(ServicesSnapshot.url("feedbackUrl", in: other, built: built)?.absoluteString, built)
    let on = try read(#"{"feedbackUrl":"https://test.example.test/f"}"#).get()
    XCTAssertEqual(ServicesSnapshot.url("feedbackUrl", in: on, built: nil)?.absoluteString, "https://test.example.test/f")
  }

  func testTheFieldListMatchesTheSharedConfig() throws {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../core/src/services.ts")
    let source = try String(contentsOf: root, encoding: .utf8)
    for field in ServicesSnapshot.fields { XCTAssertTrue(source.contains("  \(field): "), field) }
  }
}
