import ARKit
import ExpoModulesCore
import SpriteKit

/**
 Your own floor, seen through the camera, as a place to play. Ground points
 are (x, z) in metres in ARKit's world, on the floor where the family put the
 pet. Each frame the camera's current view projects them onto the screen, so
 the pet stands in the room at its real size and gets bigger as you come
 close.
 */
final class ARWorld: PlayWorld {
  weak var view: ARSKView?
  let floorY: Float
  let origin: CGPoint
  let unitsPerMetre: CGFloat = 1

  init(view: ARSKView, floorY: Float, origin: CGPoint) {
    self.view = view
    self.floorY = floorY
    self.origin = origin
  }

  private var camera: ARCamera? { view?.session.currentFrame?.camera }

  func screen(_ g: CGPoint, up: CGFloat, size: CGSize) -> CGPoint? {
    guard let camera else { return nil }
    let point = SIMD3<Float>(Float(g.x), floorY + Float(up), Float(g.y))
    // Only what's in front of the camera.
    let local = simd_mul(simd_inverse(camera.transform), SIMD4<Float>(point, 1))
    guard local.z < -0.05 else { return nil }
    let p = camera.projectPoint(point, orientation: .portrait, viewportSize: size)
    return CGPoint(x: p.x, y: size.height - p.y)
  }

  func ground(at p: CGPoint, size: CGSize) -> CGPoint? {
    guard let camera else { return nil }
    var plane = matrix_identity_float4x4
    plane.columns.3 = SIMD4<Float>(0, floorY, 0, 1)
    guard let hit = camera.unprojectPoint(CGPoint(x: p.x, y: size.height - p.y), ontoPlane: plane, orientation: .portrait, viewportSize: size) else { return nil }
    return CGPoint(x: CGFloat(hit.x), y: CGFloat(hit.z))
  }

  /** Flat (on the floor) directions the camera is facing and its right. */
  private func flat() -> (position: CGPoint, forward: CGPoint, right: CGPoint)? {
    guard let t = camera?.transform else { return nil }
    let norm = { (x: Float, z: Float) -> CGPoint in
      let l = max(0.0001, (x * x + z * z).squareRoot())
      return CGPoint(x: CGFloat(x / l), y: CGFloat(z / l))
    }
    return (CGPoint(x: CGFloat(t.columns.3.x), y: CGFloat(t.columns.3.z)), norm(-t.columns.2.x, -t.columns.2.z), norm(t.columns.0.x, t.columns.0.z))
  }

  func you() -> CGPoint {
    guard let f = flat() else { return origin }
    return CGPoint(x: f.position.x + f.forward.x * 0.7, y: f.position.y + f.forward.y * 0.7)
  }

  /** Within four metres of where the pet was put down. */
  func clamp(_ g: CGPoint) -> CGPoint {
    let dx = g.x - origin.x, dy = g.y - origin.y, d = hypot(dx, dy)
    guard d > 4 else { return g }
    return CGPoint(x: origin.x + dx / d * 4, y: origin.y + dy / d * 4)
  }

  func randomSpot() -> CGPoint {
    let a = CGFloat.random(in: 0...(2 * .pi)), r = CGFloat.random(in: 0.4...1.6)
    return clamp(CGPoint(x: origin.x + cos(a) * r, y: origin.y + sin(a) * r))
  }

  func start() -> CGPoint { origin }

  func throwVelocity(_ v: CGVector, size: CGSize) -> (x: CGFloat, y: CGFloat, up: CGFloat) {
    guard let f = flat() else { return (0, 0, 2) }
    let ahead = max(0, v.dy) / size.height * 5, aside = v.dx / size.width * 3
    return (x: f.forward.x * ahead + f.right.x * aside, y: f.forward.y * ahead + f.right.y * aside, up: min(5, 1.5 + hypot(v.dx, v.dy) / 700))
  }

  func drawOrder(_ g: CGPoint) -> CGFloat {
    guard let f = flat() else { return 0 }
    return -hypot(g.x - f.position.x, g.y - f.position.y) * 100
  }
}

/**
 The pet in your home: the camera, ARKit finding the floor, and the same play
 scene on top. The family taps the floor where the pet should be; from then
 on everything works as in the garden: stroke it, tap the floor to call it
 over, flick the ball.
 */
final class ARPlayView: ExpoView {
  let onPlayEvent = EventDispatcher()
  private let arView = ARSKView()
  private var scene: PlayScene?
  private var pet: CGImage?
  private var rig: [String: CGPoint] = [:]
  private var ball: CGImage?
  private var petUri: String?
  private var ballUri: String?
  private var commandKey: Int?
  private var running = false
  private lazy var placing = UITapGestureRecognizer(target: self, action: #selector(place(_:)))

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    addSubview(arView)
    arView.addGestureRecognizer(placing)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    arView.frame = bounds
    if arView.scene == nil, bounds.width > 0 {
      let empty = SKScene(size: bounds.size)
      empty.backgroundColor = .clear
      empty.scaleMode = .resizeFill
      arView.presentScene(empty)
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil, !running {
      guard ARWorldTrackingConfiguration.isSupported else {
        onPlayEvent(["type": "ar-unsupported"])
        return
      }
      let config = ARWorldTrackingConfiguration()
      config.planeDetection = [.horizontal]
      arView.session.run(config)
      running = true
      onPlayEvent(["type": "ar-find-floor"])
    } else if window == nil, running {
      arView.session.pause()
      running = false
    }
  }

  func setPet(_ value: [String: Any]?) {
    guard let value, let uri = value["uri"] as? String, uri != petUri else { return }
    petUri = uri
    pet = ARPlayView.load(uri)
    rig = [:]
    for (k, v) in (value["rig"] as? [String: [Double]]) ?? [:] where v.count >= 2 {
      rig[k] = CGPoint(x: v[0], y: v[1])
    }
  }

  func setBall(_ uri: String?) {
    guard uri != ballUri else { return }
    ballUri = uri
    ball = uri.flatMap(ARPlayView.load)
  }

  func setCommand(_ command: [String: Any]?) {
    guard let command, let kind = command["kind"] as? String else { return }
    let key = (command["key"] as? Int) ?? 0
    guard key != commandKey else { return }
    commandKey = key
    scene?.command(kind)
  }

  /** Until the pet is placed, a tap on the floor puts it there. */
  @objc private func place(_ tap: UITapGestureRecognizer) {
    guard scene == nil, let pet, !rig.isEmpty, let frame = arView.session.currentFrame else { return }
    let p = tap.location(in: arView)
    let normalised = CGPoint(x: p.x / bounds.width, y: p.y / bounds.height)
      .applying(frame.displayTransform(for: .portrait, viewportSize: bounds.size).inverted())
    let query = frame.raycastQuery(from: normalised, allowing: .estimatedPlane, alignment: .horizontal)
    guard let hit = arView.session.raycast(query).first else {
      onPlayEvent(["type": "ar-find-floor"])
      return
    }
    let t = hit.worldTransform.columns.3
    let world = ARWorld(view: arView, floorY: t.y, origin: CGPoint(x: CGFloat(t.x), y: CGFloat(t.z)))
    let setup = PlayScene.Setup(background: nil, pet: pet, rig: rig, ball: ball, asleep: nil, asleepFacesRight: true, night: false)
    let s = PlayScene(size: bounds.size, setup: setup, world: world)
    s.onEvent = { [weak self] type in self?.onPlayEvent(["type": type]) }
    scene = s
    arView.presentScene(s)
    // From now on touches belong to the play scene.
    arView.removeGestureRecognizer(placing)
    onPlayEvent(["type": "ar-placed"])
    s.announce()
  }

  private static func load(_ uri: String) -> CGImage? {
    guard let url = URL(string: uri), let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
  }
}
