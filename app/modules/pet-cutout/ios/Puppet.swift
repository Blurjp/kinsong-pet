import CoreGraphics
import SpriteKit

/**
 The family's photo of their pet, made into a puppet that moves in real time.

 A fine warp grid is laid over the cut-out. Each grid point is tied, with
 smooth weights, to the bones it lies near (body, head, ears, tail, upper and
 lower legs), found from the pet's own skeleton in the photo. Every frame the
 bones are turned by a `Pose` and the grid follows, so the photo itself bends:
 it breathes, turns its head, wags, walks and runs. The texture is always the
 real photo.

 Internally everything is in "body units": the photo's height is 1, x runs
 right and y up, and the pet faces right (a photo facing left is mirrored).
 */
final class Puppet: SKNode {
  struct Pose {
    /** Body raised (+) or lowered (−), in body heights. */
    var lift: CGFloat = 0
    /** Body pitch about the hips, radians; + lifts the front. */
    var pitch: CGFloat = 0
    /** Head about the neck; + lifts the nose. */
    var head: CGFloat = 0
    var ears: CGFloat = 0
    /** Tail about its base; + lifts it. */
    var tail: CGFloat = 0
    var tailTip: CGFloat = 0
    /** Upper legs, near then far; + swings the paw forward. */
    var front: [CGFloat] = [0, 0]
    var frontKnee: [CGFloat] = [0, 0]
    var back: [CGFloat] = [0, 0]
    var backKnee: [CGFloat] = [0, 0]
  }

  private enum Part { case torso, head, ear, tail, tailTip, front(Int), frontKnee(Int), back(Int), backKnee(Int) }

  private struct Bone {
    var part: Part
    var parent: Int?
    var pivot: CGPoint
    /** The segment whose nearness ties grid points to this bone. */
    var from: CGPoint
    var to: CGPoint
    var sigma: CGFloat
  }

  let sprite: SKSpriteNode
  /** Width over height of the photo. */
  let aspect: CGFloat
  /** Where the paws touch the ground, in body units (usually ~0). */
  let groundY: CGFloat
  /** The nose, where a carried ball sits, in body units. */
  let mouth: CGPoint

  private var bones: [Bone] = []
  private let columns = 20
  private let rows = 16
  private var source: [SIMD2<Float>] = []
  private var points: [CGPoint] = []
  /** For each grid point, the bones that move it and how much. */
  private var weights: [[(Int, CGFloat)]] = []

  init?(image: CGImage, rig: [String: CGPoint]) {
    var rig = rig
    let aspect = CGFloat(image.width) / CGFloat(image.height)
    // Into body units: y up, height 1.
    for (k, p) in rig { rig[k] = CGPoint(x: p.x * aspect, y: 1 - p.y) }
    guard let nose = rig["nose"] else { return nil }
    let tailBase = rig["tail_bottom"] ?? Puppet.average(rig, ["left_back_elbow", "right_back_elbow"])
    var texture = image
    if let tailBase, nose.x < tailBase.x {
      // Facing left in the photo: mirror it, so the puppet always faces right.
      texture = Puppet.mirrored(image) ?? image
      for (k, p) in rig { rig[k] = CGPoint(x: aspect - p.x, y: p.y) }
      // Left and right swap sides in a mirror, which doesn't matter here: legs are near/far by position.
    }
    self.aspect = aspect
    sprite = SKSpriteNode(texture: SKTexture(cgImage: texture))
    sprite.size = CGSize(width: aspect, height: 1)
    sprite.anchorPoint = CGPoint(x: 0, y: 0)

    func p(_ k: String) -> CGPoint? { rig[k] }
    let noseP = rig["nose"]!
    let shoulder = Puppet.average(rig, ["left_front_elbow", "right_front_elbow"]) ?? CGPoint(x: noseP.x - aspect * 0.3, y: 0.55)
    let hip = Puppet.average(rig, ["left_back_elbow", "right_back_elbow"]) ?? CGPoint(x: shoulder.x - aspect * 0.4, y: shoulder.y)
    let eyes = Puppet.average(rig, ["left_eye", "right_eye"]) ?? noseP
    let neck = rig["neck"] ?? rig["heck"] ?? CGPoint(x: shoulder.x + (eyes.x - shoulder.x) * 0.35, y: shoulder.y + (eyes.y - shoulder.y) * 0.5)
    let paws = rig.filter { $0.key.hasSuffix("_paw") }.map(\.value)
    groundY = paws.map(\.y).min() ?? 0
    mouth = CGPoint(x: noseP.x - 0.02, y: noseP.y - 0.05)
    super.init()

    // The body: its segment runs hip to shoulder, and it holds everything not claimed by a limb.
    bones.append(Bone(part: .torso, parent: nil, pivot: hip, from: hip, to: shoulder, sigma: 0.24))
    let headIndex = bones.count
    bones.append(Bone(part: .head, parent: 0, pivot: neck, from: neck, to: noseP, sigma: 0.14))
    for side in ["left", "right"] {
      if let base = p("\(side)_ear_bottom"), let tip = p("\(side)_ear_top") {
        bones.append(Bone(part: .ear, parent: headIndex, pivot: base, from: base, to: tip, sigma: 0.05))
      }
    }
    if let base = tailBase, let mid = p("tail_middle") {
      let tailIndex = bones.count
      bones.append(Bone(part: .tail, parent: 0, pivot: base, from: base, to: mid, sigma: 0.06))
      if let tip = p("tail_top") {
        bones.append(Bone(part: .tailTip, parent: tailIndex, pivot: mid, from: mid, to: tip, sigma: 0.06))
      }
    }
    // Legs: near and far, or one leg pair when they overlap in the photo.
    for front in [true, false] {
      let end = front ? "front" : "back"
      var legs = ["left", "right"].compactMap { side -> (CGPoint, CGPoint, CGPoint)? in
        guard let top = p("\(side)_\(end)_elbow"), let knee = p("\(side)_\(end)_knee"), let paw = p("\(side)_\(end)_paw") else { return nil }
        return (top, knee, paw)
      }
      if legs.count == 2, abs(legs[0].2.x - legs[1].2.x) < 0.06 {
        let a = legs[0], b = legs[1]
        legs = [(Puppet.mid(a.0, b.0), Puppet.mid(a.1, b.1), Puppet.mid(a.2, b.2))]
      }
      for (i, leg) in legs.enumerated() {
        let upper = bones.count
        bones.append(Bone(part: front ? .front(i) : .back(i), parent: 0, pivot: leg.0, from: leg.0, to: leg.1, sigma: 0.05))
        bones.append(Bone(part: front ? .frontKnee(i) : .backKnee(i), parent: upper, pivot: leg.1, from: leg.1, to: leg.2, sigma: 0.045))
      }
    }

    // The grid and how each of its points is tied to the bones.
    for r in 0...rows {
      for c in 0...columns {
        let u = CGFloat(c) / CGFloat(columns), v = CGFloat(r) / CGFloat(rows)
        source.append(SIMD2(Float(u), Float(v)))
        let point = CGPoint(x: u * aspect, y: v)
        points.append(point)
        var ws: [(Int, CGFloat)] = []
        var total: CGFloat = 0
        for (i, b) in bones.enumerated() {
          let d = Puppet.distance(point, b.from, b.to) / b.sigma
          let w = exp(-d * d)
          if w > 0.01 { ws.append((i, w)); total += w }
        }
        weights.append(total > 0 ? ws.map { ($0.0, $0.1 / total) } : [(0, 1)])
      }
    }
    addChild(sprite)
    apply(Pose())
  }

  required init?(coder: NSCoder) { nil }

  /** Bend the photo into a pose. */
  func apply(_ pose: Pose) {
    var transforms = [CGAffineTransform](repeating: .identity, count: bones.count)
    for (i, b) in bones.enumerated() {
      let angle: CGFloat
      switch b.part {
      case .torso: angle = pose.pitch
      case .head: angle = pose.head
      case .ear: angle = pose.ears
      case .tail: angle = pose.tail
      case .tailTip: angle = pose.tailTip
      case let .front(n): angle = pose.front[min(n, 1)]
      case let .frontKnee(n): angle = pose.frontKnee[min(n, 1)]
      case let .back(n): angle = pose.back[min(n, 1)]
      case let .backKnee(n): angle = pose.backKnee[min(n, 1)]
      }
      var local = CGAffineTransform(translationX: b.pivot.x, y: b.pivot.y).rotated(by: angle).translatedBy(x: -b.pivot.x, y: -b.pivot.y)
      if b.parent == nil { local = local.concatenating(CGAffineTransform(translationX: 0, y: pose.lift)) }
      transforms[i] = b.parent.map { local.concatenating(transforms[$0]) } ?? local
    }
    var destination = [SIMD2<Float>](repeating: .zero, count: points.count)
    for (k, point) in points.enumerated() {
      var x: CGFloat = 0, y: CGFloat = 0
      for (i, w) in weights[k] {
        let q = point.applying(transforms[i])
        x += q.x * w
        y += q.y * w
      }
      destination[k] = SIMD2(Float(x / aspect), Float(y))
    }
    sprite.warpGeometry = SKWarpGeometryGrid(columns: columns, rows: rows, sourcePositions: source, destinationPositions: destination)
  }

  /** Where a body-unit point ends up after a pose (for the carried ball). */
  func headPoint(_ point: CGPoint, pose: Pose, scaleX: CGFloat) -> CGPoint {
    guard bones.count > 1 else { return point }
    let neck = bones[1].pivot, hip = bones[0].pivot
    var t = CGAffineTransform(translationX: neck.x, y: neck.y).rotated(by: pose.head).translatedBy(x: -neck.x, y: -neck.y)
    t = t.concatenating(CGAffineTransform(translationX: hip.x, y: hip.y).rotated(by: pose.pitch).translatedBy(x: -hip.x, y: -hip.y))
    t = t.concatenating(CGAffineTransform(translationX: 0, y: pose.lift))
    return point.applying(t)
  }

  // MARK: - Geometry

  private static func average(_ rig: [String: CGPoint], _ keys: [String]) -> CGPoint? {
    let ps = keys.compactMap { rig[$0] }
    guard !ps.isEmpty else { return nil }
    return CGPoint(x: ps.map(\.x).reduce(0, +) / CGFloat(ps.count), y: ps.map(\.y).reduce(0, +) / CGFloat(ps.count))
  }

  private static func mid(_ a: CGPoint, _ b: CGPoint) -> CGPoint { CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2) }

  private static func distance(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> CGFloat {
    let dx = b.x - a.x, dy = b.y - a.y
    let len2 = dx * dx + dy * dy
    let t = len2 > 0 ? max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
    return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
  }

  private static func mirrored(_ image: CGImage) -> CGImage? {
    guard let ctx = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    ctx.translateBy(x: CGFloat(image.width), y: 0)
    ctx.scaleBy(x: -1, y: 1)
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    return ctx.makeImage()
  }
}
