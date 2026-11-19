import SwiftUI

public struct NillaLogoMark: View {
  public var outline: Bool
  public var outlineWeight: CGFloat

  public init(outline: Bool = true, outlineWeight: CGFloat = 0.075) {
    self.outline = outline
    self.outlineWeight = outlineWeight
  }

  public var body: some View {
    Canvas { context, size in
      let width = outline ? size.width * outlineWeight : 0
      let mark = LogoGeometry.Mark(in: CGRect(origin: .zero, size: size).insetBy(dx: width / 2 + 1, dy: width / 2 + 1))
      if outline {
        let style = StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round)
        context.stroke(mark.sun, with: .color(.white), style: style)
        context.fill(mark.sun, with: .color(.white))
        var halo = context
        halo.clip(to: mark.frame(outset: width))
        for hill in mark.hills {
          halo.stroke(hill.path, with: .color(.white), style: style)
          halo.fill(hill.path, with: .color(.white))
        }
      }
      context.fill(mark.sun, with: .color(LogoGeometry.sunColor))
      var hills = context
      hills.clip(to: mark.frame(outset: 0))
      for hill in mark.hills {
        hills.fill(hill.path, with: .color(hill.color))
      }
    }
    .aspectRatio(LogoGeometry.aspectRatio, contentMode: .fit)
    .accessibilityHidden(true)
  }
}

enum LogoGeometry {
  struct Hill {
    var path: Path
    var color: Color
  }

  struct Mark {
    var sun: Path
    var hills: [Hill]
    var scale: CGFloat
    var transform: CGAffineTransform

    init(in rect: CGRect) {
      let canvas = LogoGeometry.canvas
      let scale = min(rect.width / canvas.width, rect.height / canvas.height)
      let transform = CGAffineTransform(translationX: rect.minX, y: rect.minY)
        .scaledBy(x: scale, y: scale)
        .translatedBy(x: -canvas.minX, y: -canvas.minY)
      self.scale = scale
      self.transform = transform
      sun = LogoGeometry.sun.applying(transform)
      hills = [
        Hill(path: LogoGeometry.backHill.applying(transform), color: Color(hex: 0x8A9F6A)),
        Hill(path: LogoGeometry.frontHill.applying(transform), color: Color(hex: 0x43506E)),
      ]
    }

    func frame(outset: CGFloat) -> Path {
      LogoGeometry.frame(scale: 1 + outset / (LogoGeometry.canvas.width * scale)).applying(transform)
    }
  }

  static let canvas = CGRect(x: 100, y: 260, width: 824, height: 664)
  static var aspectRatio: CGFloat { canvas.width / canvas.height }
  static let sunColor = Color(hex: 0xF2C14E)
  static let frameCenter: CGFloat = 512

  static let sun = Path(ellipseIn: CGRect(x: 222, y: 260, width: 224, height: 224))

  static let backHill: Path = {
    var path = Path()
    path.move(to: CGPoint(x: 100, y: 700))
    path.addCurve(to: CGPoint(x: 924, y: 560), control1: CGPoint(x: 320, y: 640), control2: CGPoint(x: 560, y: 610))
    path.addLine(to: CGPoint(x: 924, y: 924))
    path.addLine(to: CGPoint(x: 100, y: 924))
    path.closeSubpath()
    return path
  }()

  static let frontHill: Path = {
    var path = Path()
    path.move(to: CGPoint(x: 100, y: 812))
    path.addCurve(to: CGPoint(x: 924, y: 338), control1: CGPoint(x: 380, y: 760), control2: CGPoint(x: 650, y: 600))
    path.addLine(to: CGPoint(x: 924, y: 924))
    path.addLine(to: CGPoint(x: 100, y: 924))
    path.closeSubpath()
    return path
  }()

  static func frame(scale: CGFloat) -> Path {
    let at = { (x: CGFloat, y: CGFloat) in
      CGPoint(x: frameCenter + (x - frameCenter) * scale, y: frameCenter + (y - frameCenter) * scale)
    }
    var path = Path()
    path.move(to: at(360, 100))
    path.addLine(to: at(664, 100))
    path.addCurve(to: at(924, 360), control1: at(861.3, 100), control2: at(924, 162.7))
    path.addLine(to: at(924, 664))
    path.addCurve(to: at(664, 924), control1: at(924, 861.3), control2: at(861.3, 924))
    path.addLine(to: at(360, 924))
    path.addCurve(to: at(100, 664), control1: at(162.7, 924), control2: at(100, 861.3))
    path.addLine(to: at(100, 360))
    path.addCurve(to: at(360, 100), control1: at(100, 162.7), control2: at(162.7, 100))
    path.closeSubpath()
    return path
  }
}

public struct FidgetLogo: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var angle: Angle = .zero
  @State private var dragStart: Angle?
  @State private var lastSample: (angle: Angle, time: Date)?
  @State private var velocity: Double = 0
  @State private var spins = 0

  public init() {}

  public var body: some View {
    GeometryReader { proxy in
      let center = CGPoint(x: proxy.size.width / 2, y: proxy.size.height / 2)
      NillaLogoMark(outlineWeight: 0.05)
        .shadow(color: .black.opacity(0.22), radius: 14, y: 6)
        .rotationEffect(angle)
        .frame(width: proxy.size.width, height: proxy.size.height)
        .contentShape(.circle)
        .gesture(spin(around: center))
    }
    .sensoryFeedback(.impact(weight: .light, intensity: 0.5), trigger: spins)
    .accessibilityElement()
    .accessibilityLabel("Nilla")
    .accessibilityAddTraits(.isImage)
  }

  private func spin(around center: CGPoint) -> some Gesture {
    DragGesture(minimumDistance: 2)
      .onChanged { value in
        let start = Self.bearing(of: value.startLocation, around: center)
        let now = Self.bearing(of: value.location, around: center)
        if dragStart == nil { dragStart = angle }
        var delta = now - start
        if delta.degrees > 180 { delta -= .degrees(360) }
        if delta.degrees < -180 { delta += .degrees(360) }
        let target = (dragStart ?? .zero) + delta
        let time = value.time
        if let lastSample {
          let elapsed = time.timeIntervalSince(lastSample.time)
          if elapsed > 0.004 { velocity = (target.degrees - lastSample.angle.degrees) / elapsed }
        }
        lastSample = (target, time)
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { angle = target }
      }
      .onEnded { _ in
        dragStart = nil
        lastSample = nil
        let clamped = max(-2400, min(2400, velocity))
        velocity = 0
        guard abs(clamped) > 60 else { return }
        if reduceMotion {
          withAnimation(.easeOut(duration: 0.3)) { angle = .zero }
          return
        }
        let travel = clamped * 0.42
        if abs(travel) >= 360 { spins += 1 }
        withAnimation(.timingCurve(0.12, 0.7, 0.25, 1, duration: Motion.logoSpinDecay)) {
          angle += .degrees(travel)
        }
      }
  }

  private static func bearing(of point: CGPoint, around center: CGPoint) -> Angle {
    .radians(atan2(point.y - center.y, point.x - center.x))
  }
}

#Preview("Logo") {
  VStack(spacing: 32) {
    NillaLogoMark().frame(width: 140)
    NillaLogoMark(outline: false).frame(width: 140)
    FidgetLogo().frame(width: 140, height: 120)
  }
  .padding(40)
  .background(ProfileBackdrop())
}
