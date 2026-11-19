import Foundation
import XCTest
@testable import NillaConfigCore

final class UpstreamAppFoldersTests: XCTestCase {
  private var scratch: String!
  private var home: String!
  private let fm = FileManager.default

  override func setUpWithError() throws {
    let temporary = UpstreamAppFolders.resolve(NSTemporaryDirectory())!
    scratch = (temporary as NSString).appendingPathComponent("upstream-app-folders-\(UUID().uuidString)")
    home = (scratch as NSString).appendingPathComponent("home")
    try fm.createDirectory(atPath: path(".config/ardia/config/themes"), withIntermediateDirectories: true)
    try "{\"planted\": true}\n".write(toFile: path(".config/ardia/config/config.json"), atomically: true, encoding: .utf8)
    try fm.createDirectory(atPath: path("Library/Application Support/com.ardia.browser"), withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try? fm.removeItem(atPath: scratch)
  }

  private func path(_ relative: String) -> String {
    (home as NSString).appendingPathComponent(relative)
  }

  private func own(_ path: String) -> String? {
    UpstreamAppFolders.ownPath(path, home: home)
  }

  func testALinkedConfigFolderIsRefused() throws {
    try fm.createSymbolicLink(atPath: path(".config/nilla"), withDestinationPath: path(".config/ardia/config"))
    XCTAssertNil(own(path(".config/nilla")))
    XCTAssertNil(own(path(".config/nilla/config.json")))
    XCTAssertNil(own(path(".config/nilla/config.schema.json")))
    XCTAssertNil(own(path(".config/nilla/themes/dusk.json")))
  }

  func testALinkedConfigChildOfADataDirIsRefused() throws {
    let data = (scratch as NSString).appendingPathComponent("data")
    try fm.createDirectory(atPath: data, withIntermediateDirectories: true)
    try fm.createSymbolicLink(atPath: (data as NSString).appendingPathComponent("config"), withDestinationPath: path("Library/Application Support/com.ardia.browser"))
    XCTAssertNil(own((data as NSString).appendingPathComponent("config")))
    XCTAssertNil(own((data as NSString).appendingPathComponent("config/theme.schema.json")))
  }

  func testLinkedFilesAndThemesInsideAnOwnFolderAreRefused() throws {
    let config = path(".config/nilla")
    try fm.createDirectory(atPath: config, withIntermediateDirectories: true)
    try fm.createSymbolicLink(atPath: (config as NSString).appendingPathComponent("config.json"), withDestinationPath: path(".config/ardia/config/config.json"))
    try fm.createSymbolicLink(atPath: (config as NSString).appendingPathComponent("themes"), withDestinationPath: path(".config/ardia/config/themes"))
    XCTAssertNotNil(own(config))
    XCTAssertNil(own((config as NSString).appendingPathComponent("config.json")))
    XCTAssertNil(own((config as NSString).appendingPathComponent("themes/dusk.json")))
  }

  func testDotDotAndLinkedAncestorsResolveBeforeTheCheck() throws {
    let config = path(".config/nilla")
    try fm.createDirectory(atPath: config, withIntermediateDirectories: true)
    XCTAssertNil(own((config as NSString).appendingPathComponent("../ardia/config")))
    let elsewhere = (scratch as NSString).appendingPathComponent("elsewhere")
    try fm.createSymbolicLink(atPath: elsewhere, withDestinationPath: path(".config"))
    XCTAssertNil(own((elsewhere as NSString).appendingPathComponent("ardia/config/config.json")))
  }

  func testADanglingLinkCantBeResolvedAndIsRefused() throws {
    try fm.createSymbolicLink(atPath: path(".config/nilla"), withDestinationPath: (scratch as NSString).appendingPathComponent("gone"))
    XCTAssertNil(own(path(".config/nilla/config.json")))
  }

  func testACaseVariantIsRefusedOnTheMac() throws {
    #if os(macOS)
      XCTAssertNil(own(path(".config/ARDIA/config")))
      XCTAssertNil(own(path("Library/Application Support/COM.ARDIA.BROWSER")))
    #endif
  }

  func testNillasOwnFoldersResolveToTheirRealPath() throws {
    let real = (scratch as NSString).appendingPathComponent("dotfiles/nilla")
    try fm.createDirectory(atPath: real, withIntermediateDirectories: true)
    try fm.createDirectory(atPath: path(".config"), withIntermediateDirectories: true)
    try fm.createSymbolicLink(atPath: path(".config/nilla"), withDestinationPath: real)
    XCTAssertEqual(own(path(".config/nilla")), real)
    XCTAssertEqual(own(path(".config/nilla/config.json")), (real as NSString).appendingPathComponent("config.json"))
    XCTAssertEqual(own(path(".config/ardia-notes")), path(".config/ardia-notes"))
    XCTAssertNil(own("relative/config"))
  }
}
