// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "NillaSyncCore",
  platforms: [.macOS(.v14), .iOS(.v17)],
  products: [
    .library(name: "NillaSyncCore", targets: ["NillaSyncCore"]),
  ],
  targets: [
    .target(name: "NillaSyncCore", path: "ios/Core"),
    .testTarget(name: "NillaSyncCoreTests", dependencies: ["NillaSyncCore"], path: "tests", exclude: ["fixtures"]),
  ]
)
