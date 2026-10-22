import SpriteKit

/**
 Where the pet plays: how its ground maps onto the screen. A photographed
 scene (PhotoWorld) or your own floor seen through the camera (ARWorld).
 Ground points are (x, y) in the world's own units; `unitsPerMetre` says how
 many of them make a metre.
 */
protocol PlayWorld: AnyObject {
  var unitsPerMetre: CGFloat { get }
  /** Where a ground point, `up` metres above the ground, appears in the scene (origin bottom left); nil if out of sight. */
  func screen(_ ground: CGPoint, up: CGFloat, size: CGSize) -> CGPoint?
  /** The ground point under a point on screen, if there is ground there. */
  func ground(at point: CGPoint, size: CGSize) -> CGPoint?
  /** Where you are: the spot just in front of the camera. */
  func you() -> CGPoint
  func clamp(_ ground: CGPoint) -> CGPoint
  func randomSpot() -> CGPoint
  /** Where the pet starts out. */
  func start() -> CGPoint
  /** A flick on screen as a throw: ground velocity (units/s) and upward speed (m/s). */
  func throwVelocity(_ swipe: CGVector, size: CGSize) -> (x: CGFloat, y: CGFloat, up: CGFloat)
  /** Nearer things are drawn over further ones. */
  func drawOrder(_ ground: CGPoint) -> CGFloat
}

/**
 A photographed scene: ground is (x, depth), x 0 left → 1 right, depth 0 far
 → 1 near (a little past 1 is right in front of you), on the photo's own
 perspective (its horizon, and the camera height that makes a pet its size).
 */
final class PhotoWorld: PlayWorld {
  let horizon: CGFloat
  let cameraMetres: CGFloat
  /** About seven metres across the near ground. */
  let unitsPerMetre: CGFloat = 0.137

  init(horizon: CGFloat, cameraMetres: CGFloat) {
    self.horizon = horizon
    self.cameraMetres = cameraMetres
  }

  /** Fraction from the top where ground at this depth appears; matches the garden's photo geometry. */
  private func fraction(_ depth: CGFloat) -> CGFloat {
    horizon + (1 - horizon) * (0.2227 + depth * (0.8118 - 0.2227))
  }

  func screen(_ g: CGPoint, up: CGFloat, size: CGSize) -> CGPoint? {
    let f = fraction(g.y)
    let perMetre = max(0, f - horizon) * size.height / cameraMetres
    return CGPoint(x: g.x * size.width, y: size.height * (1 - f) + up * perMetre)
  }

  func ground(at p: CGPoint, size: CGSize) -> CGPoint? {
    let f = 1 - p.y / size.height
    guard f > horizon + 0.01 else { return nil }
    let depth = ((f - horizon) / (1 - horizon) - 0.2227) / (0.8118 - 0.2227)
    return CGPoint(x: p.x / size.width, y: min(1.1, max(0, depth)))
  }

  func you() -> CGPoint { CGPoint(x: 0.5, y: 1.1) }
  func clamp(_ g: CGPoint) -> CGPoint { CGPoint(x: min(0.95, max(0.05, g.x)), y: min(1.08, max(0.02, g.y))) }
  func randomSpot() -> CGPoint { CGPoint(x: .random(in: 0.15...0.85), y: .random(in: 0.2...0.85)) }
  func start() -> CGPoint { CGPoint(x: 0.5, y: 0.55) }

  func throwVelocity(_ v: CGVector, size: CGSize) -> (x: CGFloat, y: CGFloat, up: CGFloat) {
    (x: v.dx / size.width * 0.55, y: -v.dy / size.height * 0.9, up: min(6, 1.5 + hypot(v.dx, v.dy) / 600))
  }

  func drawOrder(_ g: CGPoint) -> CGFloat { g.y * 100 }
}

/**
 A real-time place to be with the pet: their photo-puppet stands in a
 PlayWorld, in its perspective, and lives there. It rests, looks round,
 wanders off to sniff, invites you to play, runs to where you tap, comes when
 called, leans into your finger when you stroke it, and chases the ball you
 throw and brings it back. At night it sleeps until you wake it.
 */
final class PlayScene: SKScene {
  struct Setup {
    var background: CGImage?
    var pet: CGImage
    var rig: [String: CGPoint]
    var ball: CGImage?
    /** Optional: the family's photo of the pet asleep, shown (breathing) while it sleeps. */
    var asleep: CGImage?
    /** Which way the asleep photo faces; mirrored to match the puppet. */
    var asleepFacesRight: Bool
    var night: Bool
    /** "dog", "cat", "rabbit", "bird" or "other": how it moves and plays. */
    var species: String = "dog"
  }

  enum Mood: String { case rest, wander, sniff, bow, petted, run, chase, carry, sleep, groom, lookout, binky, pounce, nudge }

  private var isCat: Bool { setup.species == "cat" }
  /** Rabbits (and small pets like them) hop rather than walk. */
  private var hops: Bool { setup.species == "rabbit" || setup.species == "bird" }
  private var moodStarted: TimeInterval = 0
  private var turnedInAir = false

  /** Something worth telling the app: what the pet is doing (for the caption) and sounds to play. */
  var onEvent: ((String) -> Void)?

  private var setup: Setup
  let place: PlayWorld
  private let world = SKNode()
  private var puppet: Puppet?
  private let petNode = SKNode()
  private let shadow = SKSpriteNode(texture: PlayScene.shadowTexture)
  private let ball = SKSpriteNode()
  private let ballShadow = SKSpriteNode(texture: PlayScene.shadowTexture)
  /** Holds the asleep photo: placed and sized each frame, while the photo inside breathes. */
  private let asleepHolder = SKNode()
  private let asleepNode = SKSpriteNode()
  private let night = SKSpriteNode(color: UIColor(red: 0.42, green: 0.48, blue: 0.66, alpha: 1), size: .zero)
  private var background: SKSpriteNode?

  private var pos: CGPoint
  private var target: CGPoint?
  private var running = false
  private var facingRight = true
  private var mood: Mood = .rest
  private var moodUntil: TimeInterval = 0
  private var nextIdea: TimeInterval = 0
  private var happyUntil: TimeInterval = 0
  private var lookAt: CGPoint?
  private var phase: CGFloat = 0
  private var last: TimeInterval = 0
  private var now: TimeInterval = 0
  private var pose = Puppet.Pose()

  // The ball: on the ground at (x, depth), `height` metres up.
  private var ballAt: CGPoint
  private var ballHeight: CGFloat = 0
  private var ballVelocity = (x: CGFloat(0), depth: CGFloat(0), up: CGFloat(0))
  private var ballFlying = false
  private var ballCarried = false
  private var dragging: (start: CGPoint, last: CGPoint, lastTime: TimeInterval, velocity: CGVector)?
  private var stroking = false
  private var lastHeart: TimeInterval = 0
  private var lastPurr: TimeInterval = 0
  private var touchStart: CGPoint?

  private static let dogMetres: CGFloat = 0.6
  /** Ground units for a distance in metres, in this world. */
  private func m(_ metres: CGFloat) -> CGFloat { metres * place.unitsPerMetre }

  init(size: CGSize, setup: Setup, world place: PlayWorld) {
    self.setup = setup
    self.place = place
    pos = place.start()
    ballAt = place.clamp(CGPoint(x: place.you().x + 0.4 * place.unitsPerMetre, y: place.you().y - 0.1 * place.unitsPerMetre))
    super.init(size: size)
    scaleMode = .resizeFill
    backgroundColor = setup.background == nil ? .clear : .black
    addChild(world)
    build()
  }

  required init?(coder: NSCoder) { nil }

  func update(setup next: Setup) {
    let rebuild = next.pet !== setup.pet || next.background !== setup.background || next.asleep !== setup.asleep
    setup = next
    if rebuild { build() }
    night.isHidden = !setup.night
    if setup.night && mood == .rest { mood = .sleep; onEvent?("sleep") }
  }

  private func build() {
    world.removeAllChildren()
    if let bg = setup.background {
      let node = SKSpriteNode(texture: SKTexture(cgImage: bg))
      node.zPosition = -100
      world.addChild(node)
      background = node
    }
    puppet = Puppet(image: setup.pet, rig: setup.rig)
    petNode.removeAllChildren()
    if let puppet { petNode.addChild(puppet) }
    shadow.alpha = 0.55
    ballShadow.alpha = 0.45
    if let b = setup.ball { ball.texture = SKTexture(cgImage: b) }
    asleepNode.texture = setup.asleep.map { SKTexture(cgImage: $0) }
    asleepNode.size = asleepNode.texture?.size() ?? .zero
    asleepNode.anchorPoint = CGPoint(x: 0.5, y: 0.04)
    asleepNode.removeAllActions()
    // Slow, deep breaths.
    asleepNode.run(.repeatForever(.sequence([.scaleY(to: 1.018, duration: 1.9), .scaleY(to: 1, duration: 2.1)])))
    asleepNode.removeFromParent()
    asleepHolder.addChild(asleepNode)
    asleepHolder.alpha = 0
    petNode.alpha = 1
    for n in [shadow, petNode, ballShadow, ball, asleepHolder] { n.removeFromParent(); world.addChild(n) }
    night.blendMode = .multiply
    night.zPosition = 10_000
    night.isHidden = !setup.night
    night.removeFromParent()
    world.addChild(night)
    mood = setup.night ? .sleep : .rest
    layout()
  }

  /** Tell the app where things stand, once it's listening. */
  func announce() {
    onEvent?(mood.rawValue)
  }

  override func didChangeSize(_ oldSize: CGSize) {
    super.didChangeSize(oldSize)
    layout()
  }

  private func layout() {
    if let bg = background, let tex = bg.texture {
      let fill = max(size.width / tex.size().width, size.height / tex.size().height)
      bg.size = CGSize(width: tex.size().width * fill, height: tex.size().height * fill)
      bg.position = CGPoint(x: size.width / 2, y: size.height / 2)
    }
    night.size = size
    night.position = CGPoint(x: size.width / 2, y: size.height / 2)
  }

  // MARK: - Ground and perspective

  private func screen(_ g: CGPoint, up metres: CGFloat = 0) -> CGPoint? {
    place.screen(g, up: metres, size: size)
  }

  private func pointsPerMetre(_ g: CGPoint) -> CGFloat {
    guard let a = screen(g), let b = screen(g, up: 1) else { return 0 }
    return abs(b.y - a.y)
  }

  /** How tall the pet's photo stands in real life, ears or raised tail included. */
  private var petMetres: CGFloat {
    switch setup.species {
    case "cat": return 0.38
    case "rabbit": return 0.35
    case "bird": return 0.18
    default: return PlayScene.dogMetres
    }
  }

  private var petHeight: CGFloat { petMetres * pointsPerMetre(pos) }

  // MARK: - Life

  override func update(_ currentTime: TimeInterval) {
    let dt = last == 0 ? 0 : min(0.05, currentTime - last)
    last = currentTime
    now = currentTime
    guard let puppet else { return }

    think()
    advance(dt)
    updateBall(dt)
    pose = posture(dt)
    puppet.apply(pose)

    let h = petHeight
    guard let feet = screen(pos), h > 1 else {
      petNode.isHidden = true
      shadow.isHidden = true
      return
    }
    petNode.isHidden = false
    shadow.isHidden = false
    petNode.position = feet
    petNode.xScale = (facingRight ? 1 : -1) * h
    petNode.yScale = h
    puppet.position = CGPoint(x: -puppet.aspect / 2, y: -puppet.groundY)
    petNode.zPosition = place.drawOrder(pos)
    shadow.position = petNode.position
    shadow.size = CGSize(width: h * puppet.aspect * 0.85, height: h * 0.12)
    shadow.zPosition = petNode.zPosition - 0.5
    showAsleep(puppetWidth: h * puppet.aspect)
    placeBall()
  }

  /** What to do next when nothing else is going on. */
  private func think() {
    if mood == .petted || mood == .chase || mood == .carry || target != nil { return }
    if moodUntil > now { return }
    if setup.night {
      if mood != .sleep { mood = .sleep; onEvent?("sleep") }
      return
    }
    if mood != .rest { mood = .rest; onEvent?("rest") }
    guard now > nextIdea else { return }
    nextIdea = now + Double.random(in: 5...11)
    switch Double.random(in: 0...1) {
    case ..<0.4:
      go(to: place.randomSpot(), run: false)
      mood = .wander; onEvent?("wander")
    case ..<0.6:
      // Dogs sniff, cats wash, rabbits nibble.
      set(isCat && Bool.random() ? .groom : .sniff, for: 3.5)
    case ..<0.75:
      if hops { set(.lookout, for: 3) } else { set(.bow, for: 2.2); happyUntil = now + 3 }
    case ..<0.82:
      if hops { set(.binky, for: 0.9); happyUntil = now + 3 } else { lookAt = screen(place.you(), up: 1) }
    default:
      lookAt = screen(place.you(), up: 1)
    }
  }

  private func set(_ next: Mood, for seconds: TimeInterval) {
    mood = next
    moodStarted = now
    turnedInAir = false
    moodUntil = now + seconds
    onEvent?(next.rawValue)
  }

  private func go(to point: CGPoint, run: Bool) {
    target = place.clamp(point)
    running = run
  }

  private func advance(_ dt: CGFloat) {
    guard let t = target else { return }
    let dx = t.x - pos.x, dy = t.y - pos.y
    let dist = hypot(dx, dy)
    let speed = m(running ? (hops ? 1.8 : 2.5) : (isCat ? 0.6 : hops ? 0.7 : 0.8))
    if dist < m(0.07) {
      target = nil
      arrived()
      return
    }
    let step = min(dist, speed * dt)
    pos.x += dx / dist * step
    pos.y += dy / dist * step
    // Face the way it's going, as seen on screen.
    if let a = screen(pos), let b = screen(t), abs(b.x - a.x) > 2 { facingRight = b.x > a.x }
    phase += dt * (hops ? (running ? 15 : 11) : running ? 13 : isCat ? 6 : 7.5)
  }

  private func arrived() {
    switch mood {
    case .chase where !ballFlying && hypot(ballAt.x - pos.x, ballAt.y - pos.y) < m(0.45) && setup.species != "dog":
      // Cats pounce on it and bat it away; rabbits nose it along. Only dogs bring it back.
      set(isCat ? .pounce : .nudge, for: isCat ? 1.3 : 1.2)
      happyUntil = now + 4
      let push: CGFloat = isCat ? 1.6 : 0.6
      let a = CGFloat.random(in: 0...(2 * .pi))
      run(.wait(forDuration: isCat ? 0.8 : 0.6)) { [weak self] in
        guard let self else { return }
        self.ballVelocity = (x: cos(a) * self.m(push), depth: sin(a) * self.m(push), up: self.isCat ? 1.5 : 0.3)
        self.ballFlying = true
      }
    case .chase:
      if !ballFlying && hypot(ballAt.x - pos.x, ballAt.y - pos.y) < m(0.45) {
        ballCarried = true
        mood = .carry
        let you = place.you()
        go(to: CGPoint(x: you.x - m(0.35), y: you.y - m(0.4)), run: true)
        onEvent?("carry")
      } else {
        go(to: ballAt, run: true)
      }
    case .carry:
      ballCarried = false
      let you = place.you()
      ballAt = place.clamp(CGPoint(x: pos.x + (you.x - pos.x) * 0.4, y: pos.y + (you.y - pos.y) * 0.4))
      ballHeight = 0
      mood = .rest
      happyUntil = now + 5
      moodUntil = now + 5
      lookAt = screen(you, up: 1.2)
      onEvent?("fetched")
    default:
      if mood == .wander { mood = .rest }
      moodUntil = now + 1.5
    }
  }

  /** The pose for this moment: what it's doing, plus breathing, wagging and looking. */
  private func posture(_ dt: CGFloat) -> Puppet.Pose {
    var p = Puppet.Pose()
    let t = CGFloat(now)
    let happy = now < happyUntil || mood == .petted || mood == .bow
    p.lift = 0.004 * sin(t * 2.2)
    p.tail = 0.1 + (happy ? 0.3 * sin(t * 18) : 0.12 * sin(t * 3))
    p.tailTip = happy ? 0.3 * sin(t * 18 - 0.8) : 0.1 * sin(t * 3 - 0.6)
    p.ears = 0.05 * sin(t * 0.7) + (sin(t * 0.37) > 0.97 ? 0.25 : 0)

    if target != nil && hops {
      // Hops: push off with the back legs, reach with the front, nose up then down.
      let up = max(0, sin(phase))
      p.lift = (running ? 0.24 : 0.14) * up
      p.pitch = 0.16 * cos(phase)
      p.back = [-0.7 * up, -0.7 * up]
      p.backKnee = [0.5 * up, 0.5 * up]
      p.front = [0.6 * up, 0.6 * up]
      p.head = 0.08 * cos(phase)
      p.ears = -0.15 * up
      return p
    }
    if target != nil {
      let s = sin(phase), c = cos(phase)
      if running {
        // A gallop: front legs together, back legs together, half a stride apart.
        p.front = [0.55 * s, 0.55 * sin(phase - 0.35)]
        p.back = [-0.5 * sin(phase + 2.4), -0.5 * sin(phase + 2.0)]
        p.frontKnee = [max(0, -s) * -0.8, max(0, -sin(phase - 0.35)) * -0.8]
        p.backKnee = [max(0, sin(phase + 2.4)) * 0.7, max(0, sin(phase + 2.0)) * 0.7]
        p.pitch = 0.07 * c
        p.lift = 0.035 * abs(sin(phase))
        p.head = -0.08 + 0.06 * c
        p.tail = 0.25 + 0.1 * s
      } else {
        // A walk: diagonal pairs.
        p.front = [0.3 * s, -0.3 * s]
        p.back = [-0.28 * s, 0.28 * s]
        p.frontKnee = [min(0, s) * 0.5, min(0, -s) * 0.5]
        p.backKnee = [max(0, s) * 0.4, max(0, -s) * 0.4]
        p.lift = (isCat ? 0.006 : 0.012) * abs(c)
        p.head = 0.03 * sin(phase * 2)
        if isCat { p.tail = 0.5 + 0.12 * sin(t * 1.6); p.tailTip = 0.3 }
      }
      return p
    }
    if isCat && mood != .sleep && !happy {
      // A cat's tail: held up, swaying slowly.
      p.tail = 0.4 + 0.15 * sin(t * 1.2)
      p.tailTip = 0.35 * sin(t * 1.2 - 1)
    }
    if hops {
      // Ears always busy; quick breaths.
      p.ears = 0.08 * sin(t * 1.7) + (sin(t * 0.9) > 0.95 ? 0.35 : 0)
      p.lift = 0.006 * sin(t * 5)
    }
    let f = moodUntil > moodStarted ? CGFloat((now - moodStarted) / (moodUntil - moodStarted)) : 0

    switch mood {
    case .sniff:
      p.head = -0.5 + 0.05 * sin(t * 9)
      p.pitch = -0.06
      p.front = [0.1, 0.1]
    case .bow:
      p.pitch = -0.2
      p.front = [0.7, 0.7]
      p.frontKnee = [-0.9, -0.9]
      p.head = 0.25
    case .sleep:
      // Resting where it stands: head low, tail still, slow breaths. (Lying down needs a photo of
      // them lying down; a standing photo can't be bent into one convincingly.)
      p.lift = 0.006 * sin(t * 1.3)
      p.head = -0.28
      p.pitch = -0.02
      p.tail = -0.05
      p.tailTip = 0
      p.ears = -0.05
    case .petted:
      p.head = 0.15 + 0.08 * sin(t * 2.5)
      p.pitch = 0.04
      p.lift = 0.01 * sin(t * 2.5)
    case .groom:
      // Washing: head down to a raised paw.
      p.head = -0.45 + 0.08 * sin(t * 7)
      p.front = [0.45, 0]
      p.frontKnee = [-0.9, 0]
    case .lookout:
      // Sitting up on the back legs to look around.
      let k = min(1, min(f, 1 - f) * 5)
      p.pitch = 0.45 * k
      p.lift = 0.06 * k
      p.front = [-0.5 * k, -0.5 * k]
      p.frontKnee = [0.9 * k, 0.9 * k]
      p.head = -0.25 * k + 0.1 * sin(t * 1.5)
      p.ears = 0.15 * k
    case .binky:
      // A happy leap with a twist.
      p.lift = 0.38 * sin(.pi * f)
      p.pitch = 0.35 * sin(2 * .pi * f)
      p.back = [-0.6 * sin(.pi * f), -0.6 * sin(.pi * f)]
      if f > 0.5 && !turnedInAir { facingRight.toggle(); turnedInAir = true }
    case .pounce:
      // Crouch, wiggle, leap onto it.
      if f < 0.55 {
        p.lift = -0.07
        p.pitch = -0.1
        p.tail = 0.1 + 0.25 * sin(t * 20)
      } else {
        let g = (f - 0.55) / 0.45
        p.lift = 0.22 * sin(.pi * g)
        p.pitch = 0.3 * sin(.pi * g)
        p.front = [0.8 * sin(.pi * g), 0.8 * sin(.pi * g)]
      }
    case .nudge:
      p.head = -0.4 + 0.05 * sin(t * 12)
      p.pitch = -0.05
    default:
      break
    }
    // Look toward the finger, the ball or you: a turn of the head.
    if ![.sleep, .sniff, .groom, .nudge, .binky].contains(mood), let look = lookAt ?? (ballFlying ? screen(ballAt, up: ballHeight) : nil), let head = screen(pos, up: petMetres * 0.8) {
      var angle = atan2(look.y - head.y, abs(look.x - head.x) + 1)
      if (look.x < head.x) == facingRight && abs(look.x - head.x) > 40 { facingRight.toggle() }
      angle = max(-0.35, min(0.45, angle))
      p.head += angle * 0.7
    }
    return p
  }

  /** With a photo of them asleep, sleeping crossfades from the puppet to it. */
  private func showAsleep(puppetWidth: CGFloat) {
    guard let tex = asleepNode.texture else { return }
    let alpha: CGFloat = mood == .sleep && target == nil ? 1 : 0
    if abs(asleepHolder.alpha - alpha) > 0.01 && asleepHolder.action(forKey: "fade") == nil {
      asleepHolder.run(.fadeAlpha(to: alpha, duration: 0.6), withKey: "fade")
      petNode.run(.fadeAlpha(to: 1 - alpha, duration: 0.6))
    }
    // About as long as the standing pet, facing the same way. Sleeping photos are often taken from
    // above; seen from low down in the scene a lying pet is foreshortened, so it's never drawn taller
    // than half its length.
    let width = puppetWidth * 0.95
    let scale = width / tex.size().width
    let height = min(tex.size().height * scale, width * 0.5)
    asleepHolder.xScale = (setup.asleepFacesRight == facingRight ? 1 : -1) * scale
    asleepHolder.yScale = height / tex.size().height
    asleepHolder.position = petNode.position
    asleepHolder.zPosition = petNode.zPosition + 0.1
  }

  // MARK: - The ball

  private func updateBall(_ dt: CGFloat) {
    guard ballFlying else { return }
    ballVelocity.up -= 9.8 * dt
    ballHeight += ballVelocity.up * dt
    ballAt.x += ballVelocity.x * dt
    ballAt.y += ballVelocity.depth * dt
    // Bounce off the edges of where the pet can go.
    let inside = place.clamp(ballAt)
    if inside.x != ballAt.x { ballVelocity.x *= -0.6 }
    if inside.y != ballAt.y { ballVelocity.depth *= -0.5 }
    ballAt = inside
    if ballHeight <= 0 {
      ballHeight = 0
      if abs(ballVelocity.up) > 1.2 {
        ballVelocity.up *= -0.45 // a bounce
        ballVelocity.x *= 0.7
        ballVelocity.depth *= 0.7
      } else {
        ballVelocity.up = 0
        ballVelocity.x *= max(0, 1 - 3 * dt) // rolling to a stop in the grass
        ballVelocity.depth *= max(0, 1 - 3 * dt)
        if hypot(ballVelocity.x, ballVelocity.depth) < m(0.07) { ballFlying = false }
      }
    }
    if mood == .chase { target = ballAt; running = true }
  }

  private func placeBall() {
    guard let puppet else { return }
    let size = 0.075 * pointsPerMetre(ballCarried ? pos : ballAt)
    ball.size = CGSize(width: size, height: size)
    if ballCarried {
      let m = puppet.headPoint(puppet.mouth, pose: pose, scaleX: 1)
      let h = petHeight
      ball.position = CGPoint(x: petNode.position.x + (m.x - puppet.aspect / 2) * h * (facingRight ? 1 : -1), y: petNode.position.y + (m.y - puppet.groundY) * h)
      ball.zPosition = petNode.zPosition + 1
      ballShadow.isHidden = true
      return
    }
    guard let ground = screen(ballAt) else {
      ball.isHidden = true
      ballShadow.isHidden = true
      return
    }
    ball.isHidden = false
    ballShadow.isHidden = false
    ball.position = CGPoint(x: ground.x, y: ground.y + ballHeight * pointsPerMetre(ballAt) + size / 2)
    ball.zPosition = place.drawOrder(ballAt) + 0.2
    ballShadow.position = ground
    ballShadow.size = CGSize(width: size * 1.1 / (1 + ballHeight), height: size * 0.3 / (1 + ballHeight))
    ballShadow.zPosition = ball.zPosition - 0.1
  }

  private func throwBall(velocity v: CGVector) {
    let speed = hypot(v.dx, v.dy)
    guard speed > 150 else { return }
    ballFlying = true
    ballHeight = 0.3
    let throwing = place.throwVelocity(v, size: size)
    ballVelocity = (x: throwing.x, depth: throwing.y, up: throwing.up)
    mood = .chase
    happyUntil = now + 8
    lookAt = nil
    go(to: ballAt, run: true)
    onEvent?("chase")
  }

  // MARK: - Touch

  private func touchesPet(_ p: CGPoint) -> Bool {
    guard let puppet else { return false }
    let h = petHeight, w = puppet.aspect * h
    let base = petNode.position
    return CGRect(x: base.x - w / 2, y: base.y, width: w, height: h * 0.95).contains(p)
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let p = touches.first?.location(in: self) else { return }
    touchStart = p
    if !ballCarried && !ballFlying && hypot(p.x - ball.position.x, p.y - ball.position.y) < max(44, ball.size.width) {
      dragging = (p, p, now, .zero)
      return
    }
    if touchesPet(p) {
      if mood == .sleep { mood = .rest; moodUntil = now + 4; onEvent?("wake") }
      stroking = true
      target = nil
      if mood != .chase && mood != .carry { mood = .petted; onEvent?("petted") }
      lookAt = p
    }
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let p = touches.first?.location(in: self) else { return }
    if var d = dragging {
      let dt = max(0.001, now - d.lastTime)
      d.velocity = CGVector(dx: (p.x - d.last.x) / CGFloat(dt), dy: (p.y - d.last.y) / CGFloat(dt))
      d.last = p
      d.lastTime = now
      dragging = d
      if let g = place.ground(at: p, size: size) { ballAt = place.clamp(g) }
      return
    }
    if stroking {
      lookAt = p
      happyUntil = now + 3
      if now - lastHeart > 0.22 { heart(at: p); lastHeart = now }
      if now - lastPurr > 2.5 { onEvent?("happy"); lastPurr = now }
    }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let p = touches.first?.location(in: self) else { return }
    defer { dragging = nil; touchStart = nil }
    if let d = dragging {
      throwBall(velocity: d.velocity)
      return
    }
    if stroking {
      stroking = false
      mood = .rest
      moodUntil = now + 2.5
      happyUntil = now + 3
      lookAt = nil
      return
    }
    // A tap on the ground: come here.
    if let s = touchStart, hypot(p.x - s.x, p.y - s.y) < 12, let g = place.ground(at: p, size: size), mood != .chase, mood != .carry {
      if mood == .sleep { mood = .rest; onEvent?("wake") }
      go(to: g, run: hypot(g.x - pos.x, g.y - pos.y) > m(1.8))
      mood = .wander
      onEvent?(running ? "run" : "wander")
    }
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    dragging = nil
    stroking = false
  }

  // MARK: - From the app's buttons

  func command(_ kind: String) {
    switch kind {
    case "call":
      if mood == .sleep { onEvent?("wake") }
      mood = .wander
      let you = place.you()
      go(to: CGPoint(x: you.x + m(.random(in: -0.5...0.5)), y: you.y - m(0.6)), run: !isCat)
      happyUntil = now + 6
      onEvent?("call")
    case "play":
      guard !ballFlying && !ballCarried else { return }
      let you = place.you()
      ballAt = place.clamp(CGPoint(x: you.x + m(0.3), y: you.y - m(0.2)))
      throwBall(velocity: CGVector(dx: .random(in: -500...500), dy: .random(in: 700...1100)))
    case "pet":
      mood = .petted
      happyUntil = now + 4
      moodUntil = now + 3
      lookAt = screen(place.you(), up: 1)
      for i in 0..<5 {
        run(.wait(forDuration: Double(i) * 0.25)) { [weak self] in
          guard let self, let p = self.screen(self.pos, up: self.petMetres * 1.05) else { return }
          self.heart(at: p)
        }
      }
      run(.wait(forDuration: 3)) { [weak self] in if self?.mood == .petted { self?.mood = .rest } }
      onEvent?("petted")
    case "treat":
      mood = .sniff
      moodUntil = now + 4
      happyUntil = now + 6
      onEvent?("treat")
    default:
      break
    }
  }

  // MARK: - Little things

  private func heart(at p: CGPoint) {
    let path = CGMutablePath()
    path.move(to: CGPoint(x: 0, y: -6))
    path.addCurve(to: CGPoint(x: 0, y: 5), control1: CGPoint(x: -14, y: 4), control2: CGPoint(x: -6, y: 13))
    path.addCurve(to: CGPoint(x: 0, y: -6), control1: CGPoint(x: 6, y: 13), control2: CGPoint(x: 14, y: 4))
    let h = SKShapeNode(path: path)
    h.fillColor = UIColor(red: 0.95, green: 0.47, blue: 0.54, alpha: 1)
    h.strokeColor = .clear
    h.position = p
    h.zPosition = 20_000
    h.setScale(0.8)
    world.addChild(h)
    h.run(.sequence([.group([.moveBy(x: .random(in: -14...14), y: 60, duration: 1.1), .fadeOut(withDuration: 1.1), .scale(to: 1.2, duration: 1.1)]), .removeFromParent()]))
  }

  /** A soft round shadow, drawn once. */
  private static let shadowTexture: SKTexture = {
    let size = 64
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let colours = [CGColor(red: 0.06, green: 0.08, blue: 0.04, alpha: 0.85), CGColor(red: 0.06, green: 0.08, blue: 0.04, alpha: 0)] as CFArray
    let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!, colors: colours, locations: [0, 1])!
    let c = CGPoint(x: size / 2, y: size / 2)
    ctx.drawRadialGradient(gradient, startCenter: c, startRadius: 0, endCenter: c, endRadius: CGFloat(size) / 2, options: [])
    return SKTexture(cgImage: ctx.makeImage()!)
  }()
}
