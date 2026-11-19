// swift-tools-version:6.2
import PackageDescription

let package = Package(
  name: "NillaKit",
  platforms: [.iOS("27.0"), .macOS("27.0")],
  products: [
    .library(name: "NillaShared", targets: ["NillaShared"]),
    .library(name: "NillaSync", targets: ["NillaSync"]),
    .library(name: "NillaBrowser", targets: ["NillaBrowser"]),
    .library(name: "NillaDesign", targets: ["NillaDesign"]),
  ],
  dependencies: [
    .package(name: "NillaSyncCore", path: "../../../sync"),
  ],
  targets: [
    .target(name: "NillaShared", resources: [.copy("Scripts")]),
    .target(name: "NillaSync", dependencies: ["NillaShared", .product(name: "NillaSyncCore", package: "NillaSyncCore")]),
    .target(name: "NillaBrowser", dependencies: ["NillaShared", "NillaSync"], resources: [.copy("Blocking/FilterListCatalog.json")]),
    .target(name: "NillaDesign", dependencies: ["NillaBrowser", "NillaSync"]),
    .testTarget(name: "NillaSharedTests", dependencies: ["NillaShared"]),
    .testTarget(name: "NillaSyncTests", dependencies: ["NillaSync", .product(name: "NillaSyncCore", package: "NillaSyncCore")]),
    .testTarget(name: "NillaBrowserTests", dependencies: ["NillaBrowser"]),
    .testTarget(name: "NillaDesignTests", dependencies: ["NillaDesign"]),
  ]
)
