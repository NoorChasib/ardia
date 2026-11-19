// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "NillaImportCore",
  platforms: [.macOS(.v14)],
  products: [.library(name: "NillaImportCore", targets: ["NillaImportCore"])],
  targets: [
    .target(name: "NillaImportCore", path: "ios/Core", linkerSettings: [.linkedLibrary("sqlite3")]),
    .testTarget(
      name: "NillaImportCoreTests",
      dependencies: ["NillaImportCore"],
      path: "tests"
    ),
  ]
)
