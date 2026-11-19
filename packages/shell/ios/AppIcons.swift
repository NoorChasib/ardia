import AppKit

enum AppIcons {
  struct Variant {
    let id: String
    let name: String
  }

  static let defaultsKey = "ACAppIcon"
  static func changedNotification(bundleId: String) -> Notification.Name { .init("\(bundleId).AppIconChanged") }

  static let variants: [Variant] = [
    Variant(id: "default", name: "Highland"),
    Variant(id: "original", name: "Dusk"),
    Variant(id: "brand", name: "Parchment"),
    Variant(id: "forest-dusk", name: "Forest dusk"),
    Variant(id: "noon", name: "Meadow noon"),
    Variant(id: "spring", name: "Spring"),
    Variant(id: "summer-haze", name: "Summer haze"),
    Variant(id: "mint-coral", name: "Mint and coral"),
    Variant(id: "golden", name: "Golden hour"),
    Variant(id: "harvest", name: "Harvest"),
    Variant(id: "apricot-teal", name: "Apricot and teal"),
    Variant(id: "rose", name: "Rose"),
    Variant(id: "blue-hour", name: "Blue hour"),
    Variant(id: "lavender", name: "Lavender"),
    Variant(id: "moonrise", name: "Moonrise"),
    Variant(id: "aurora", name: "Aurora"),
    Variant(id: "clay", name: "Clay and sage"),
    Variant(id: "fog", name: "Fog"),
    Variant(id: "heather", name: "Heather moor"),
    Variant(id: "graphite", name: "Graphite and snow"),
    Variant(id: "electric", name: "Electric sunset"),
    Variant(id: "sumi", name: "Red sun"),
    Variant(id: "citrus", name: "Citrus"),
    Variant(id: "ultramarine", name: "Ultramarine"),
  ]

  static var current: String {
    let id = UserDefaults.standard.string(forKey: defaultsKey) ?? "default"
    return variants.contains { $0.id == id } ? id : "default"
  }

  private static var styleWatcher: IconStyleWatcher?

  static func restore() {
    if styleWatcher == nil { styleWatcher = IconStyleWatcher { apply() } }
    if shown != "default" { apply() }
  }

  static func set(_ id: String, announce: Bool) {
    guard variants.contains(where: { $0.id == id }) else { return }
    UserDefaults.standard.set(id, forKey: defaultsKey)
    apply()
    if announce, let bundleId = Bundle.main.bundleIdentifier {
      DistributedNotificationCenter.default().postNotificationName(
        changedNotification(bundleId: bundleId), object: nil, userInfo: ["icon": id], deliverImmediately: true)
    }
  }

  static var shown: String { IconStyle.shown(saved: current, theme: IconStyle.systemTheme, bundleIcon: IconStyle.bundleIcon) }

  private static func apply() {
    let id = shown
    NSApp.applicationIconImage = id == "default" ? nil : image(id, size: 512)
  }

  private static var cache: [String: NSImage] = [:]

  static var base: NSImage = NSImage(named: "AppIcon") ?? NSWorkspace.shared.icon(forFile: Bundle.main.bundlePath) {
    didSet { cache.removeAll() }
  }

  static var markNamed: (String) -> NSImage? = { NSImage(named: $0) } {
    didSet { cache.removeAll() }
  }

  private static func artwork(_ id: String) -> NSImage {
    id == "default" ? base : markNamed("AppIconVariant-\(id)") ?? base
  }

  static func image(_ id: String, size: CGFloat) -> NSImage? {
    let key = "\(id)@\(size)"
    if let hit = cache[key] { return hit }
    guard variants.contains(where: { $0.id == id }) else { return nil }
    let source = artwork(id)
    let image = NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
      source.draw(in: rect)
      return true
    }
    cache[key] = image
    return image
  }

  static func preview(_ id: String, size: CGFloat) -> String? {
    guard let image = image(id, size: size * 2),
          let tiff = image.tiffRepresentation,
          let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return nil }
    return "data:image/png;base64,\(png.base64EncodedString())"
  }
}
