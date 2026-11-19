// swift-tools-version:6.2
import PackageDescription

let package = Package(
  name: "PhoneSync",
  platforms: [.iOS("27.0"), .macOS("27.0")],
  products: [
    .library(name: "PhoneSync", targets: ["PhoneSync"]),
  ],
  dependencies: [
    .package(name: "NillaKit", path: "../NillaKit"),
    .package(name: "NillaSyncCore", path: "../../../sync"),
  ],
  targets: [
    .target(name: "PhoneSync", dependencies: [.product(name: "NillaSync", package: "NillaKit")]),
    .testTarget(
      name: "PhoneSyncTests",
      dependencies: [
        "PhoneSync",
        .product(name: "NillaSync", package: "NillaKit"),
        .product(name: "NillaShared", package: "NillaKit"),
        .product(name: "NillaSyncCore", package: "NillaSyncCore"),
      ]
    ),
  ]
)
