// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "NillaUpdaterCore",
  platforms: [.macOS(.v14)],
  products: [
    .library(name: "NillaUpdaterCore", targets: ["NillaUpdaterCore"]),
    .library(name: "NillaTranslateCore", targets: ["NillaTranslateCore"]),
    .library(name: "NillaReportCore", targets: ["NillaReportCore"]),
    .library(name: "NillaNotificationCore", targets: ["NillaNotificationCore"]),
    .library(name: "NillaConfigCore", targets: ["NillaConfigCore"]),
  ],
  targets: [
    .target(name: "NillaUpdaterCore", path: "ios/UpdaterCore"),
    .testTarget(name: "NillaUpdaterCoreTests", dependencies: ["NillaUpdaterCore"], path: "tests"),
    .target(name: "NillaTranslateCore", path: "ios/TranslateCore"),
    .testTarget(name: "NillaTranslateCoreTests", dependencies: ["NillaTranslateCore"], path: "translate-tests"),
    .target(name: "NillaReportCore", path: "ios/ReportCore"),
    .testTarget(name: "NillaReportCoreTests", dependencies: ["NillaReportCore"], path: "report-tests"),
    .target(name: "NillaNotificationCore", path: "ios/NotificationCore"),
    .testTarget(name: "NillaNotificationCoreTests", dependencies: ["NillaNotificationCore"], path: "notification-tests"),
    .target(name: "NillaConfigCore", path: "ios/ConfigCore"),
    .testTarget(name: "NillaConfigCoreTests", dependencies: ["NillaConfigCore"], path: "config-tests"),
  ]
)
