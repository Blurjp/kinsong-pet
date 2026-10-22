import AVFoundation
import CoreImage
import ExpoModulesCore
import SpriteKit
import ImageIO
import UniformTypeIdentifiers
import WidgetKit

/**
 Cuts the pet out of a short video on the device (see ClipCutter), and plays
 the result as a see-through, looping video view that sits in the garden.
 */
public class PetCutoutModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PetCutout")

    Events("onProgress")

    AsyncFunction("cutOut") { (videoUri: URL, outDir: URL, options: CutOutOptions) async throws -> [String: Any] in
      let settings = ClipCutterOptions(maxSeconds: options.maxSeconds, maxFps: options.maxFps, size: options.size)
      do {
        let clip = try await ClipCutter.cut(video: videoUri, into: outDir, options: settings) { [weak self] p in
          self?.sendEvent("onProgress", ["progress": p])
        }
        return clip.dictionary
      } catch let e as ClipCutterError {
        throw CutOutException(e.description)
      }
    }

    // The home-screen widget's picture and days, written where the widget can read them.
    AsyncFunction("updateWidget") { (info: [String: Any], background: URL?, pet: URL?, closeUp: Bool) throws in
      try WidgetShare.write(info: info, background: background, pet: pet, closeUp: closeUp)
    }

    // "Bring to life": the stills the generated clips start from, made on the device.
    AsyncFunction("cutOutPhoto") { (photo: URL, out: URL) throws -> [String: Any] in
      do {
        let cut = try Keyframe.cutOut(photo: photo, to: out)
        return ["uri": cut.url.absoluteString, "width": cut.width, "height": cut.height, "closeUp": cut.closeUp]
      } catch let e as ClipCutterError {
        throw CutOutException(e.description)
      }
    }

    AsyncFunction("composeKeyframe") { (pet: URL, scene: URL, out: URL, feetX: Double, feetY: Double, height: Double) throws -> String in
      do {
        return try Keyframe.compose(pet: pet, scene: scene, to: out, feet: CGPoint(x: feetX, y: feetY), height: CGFloat(height)).absoluteString
      } catch let e as ClipCutterError {
        throw CutOutException(e.description)
      }
    }

    AsyncFunction("lastFrame") { (video: URL, out: URL) async throws -> String in
      do {
        return try await Keyframe.lastFrame(of: video, to: out).absoluteString
      } catch let e as ClipCutterError {
        throw CutOutException(e.description)
      }
    }

    // Play: the pet's skeleton in its photo, for the real-time puppet.
    AsyncFunction("petRig") { (cutout: URL, species: String?) throws -> [String: [Double]] in
      do {
        return try PetRig.detect(cutout: cutout, species: species ?? "dog").mapValues { [$0.x, $0.y, $0.c] }
      } catch let e as ClipCutterError {
        throw CutOutException(e.description)
      }
    }

    View(PlayView.self) {
      Events("onPlayEvent")
      Prop("pet") { (view: PlayView, pet: [String: Any]?) in
        view.setPet(pet)
      }
      Prop("background") { (view: PlayView, uri: String?) in
        view.setBackground(uri)
      }
      Prop("ball") { (view: PlayView, uri: String?) in
        view.setBall(uri)
      }
      Prop("horizon") { (view: PlayView, horizon: Double?) in
        view.horizon = CGFloat(horizon ?? 0.59)
      }
      Prop("cameraMetres") { (view: PlayView, metres: Double?) in
        view.cameraMetres = CGFloat(metres ?? 0.75)
      }
      Prop("night") { (view: PlayView, night: Bool?) in
        view.night = night ?? false
      }
      Prop("species") { (view: PlayView, species: String?) in
        view.species = species ?? "dog"
      }
      Prop("command") { (view: PlayView, command: [String: Any]?) in
        view.setCommand(command)
      }
      OnViewDidUpdateProps { (view: PlayView) in
        view.refresh()
      }
    }

    View(ARPlayView.self) {
      Events("onPlayEvent")
      Prop("pet") { (view: ARPlayView, pet: [String: Any]?) in
        view.setPet(pet)
      }
      Prop("ball") { (view: ARPlayView, uri: String?) in
        view.setBall(uri)
      }
      Prop("command") { (view: ARPlayView, command: [String: Any]?) in
        view.setCommand(command)
      }
      Prop("species") { (view: ARPlayView, species: String?) in
        view.species = species ?? "dog"
      }
    }

    View(AliveView.self) {
      Events("onActionEnd")
      Prop("loopUri") { (view: AliveView, uri: String?) in
        view.setLoop(uri)
      }
      Prop("action") { (view: AliveView, action: [String: Any]?) in
        view.setAction(action)
      }
      Prop("night") { (view: AliveView, night: Bool?) in
        view.setNight(night ?? false)
      }
    }

    View(PetClipView.self) {
      Prop("uri") { (view: PetClipView, uri: String?) in
        view.setUri(uri)
      }
      Prop("flip") { (view: PetClipView, flip: Bool?) in
        view.setFlip(flip ?? false)
      }
      Prop("restartKey") { (view: PetClipView, key: Int?) in
        view.restart(key)
      }
      Prop("night") { (view: PetClipView, night: Bool?) in
        view.setNight(night ?? false)
      }
    }
  }
}

struct CutOutOptions: Record {
  @Field var maxSeconds: Double = 8
  @Field var maxFps: Double = 30
  @Field var size: Int = 720
}

final class CutOutException: GenericException<String>, @unchecked Sendable {
  override var reason: String { param }
}

/** A cut-out clip, looping, with a transparent background so the garden shows through. */
final class PetClipView: ExpoView {
  private let player = AVQueuePlayer()
  private let playerLayer = AVPlayerLayer()
  private var looper: AVPlayerLooper?
  private var uri: String?
  private var night = false
  private var restartKey: Int?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    isOpaque = false
    isUserInteractionEnabled = false
    player.isMuted = true // the family's sounds are played on their own, in step with restart()
    player.preventsDisplaySleepDuringVideoPlayback = false
    playerLayer.player = player
    playerLayer.videoGravity = .resizeAspect
    playerLayer.backgroundColor = UIColor.clear.cgColor
    playerLayer.pixelBufferAttributes = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    layer.addSublayer(playerLayer)
  }

  deinit {
    looper?.disableLooping()
    player.pause()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    playerLayer.frame = bounds
    CATransaction.commit()
  }

  func setUri(_ next: String?) {
    guard next != uri else { return }
    uri = next
    load()
  }

  /** Daylight footage under a night sky: darker and cooler, like moonlight, so the pet belongs there. */
  func setNight(_ next: Bool) {
    guard next != night else { return }
    night = next
    load()
  }

  private func load() {
    looper?.disableLooping()
    player.removeAllItems()
    looper = nil
    guard let uri, let url = URL(string: uri) else { return }
    let item = AVPlayerItem(url: url)
    if night {
      item.videoComposition = AVVideoComposition(asset: item.asset) { request in
        // Scaling colour alone keeps premultiplied alpha valid, so the see-through edges survive.
        request.finish(with: Moonlight.apply(request.sourceImage), context: nil)
      }
    }
    looper = AVPlayerLooper(player: player, templateItem: item)
    player.play()
  }

  func setFlip(_ flip: Bool) {
    playerLayer.setAffineTransform(flip ? CGAffineTransform(scaleX: -1, y: 1) : .identity)
  }

  /** Back to the first frame whenever the key changes, so a bark lines up with its sound. */
  func restart(_ key: Int?) {
    defer { restartKey = key }
    guard let key, restartKey != nil, key != restartKey else { return }
    player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
    player.play()
  }
}

/** Shares the pet's picture (cut-out on its background) and remembrance days with the widget. */
enum WidgetShare {
  static let appGroup = "group.app.kinsong.pets"

  static func write(info: [String: Any], background: URL?, pet: URL?, closeUp: Bool) throws {
    guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
      throw CutOutException("The widget's shared folder isn't available.")
    }
    let picture = dir.appendingPathComponent("widget.png")
    try? FileManager.default.removeItem(at: picture)
    if let background, let image = compose(background: background, pet: pet, closeUp: closeUp) {
      try writePNG(image, to: picture)
    }
    let json = try JSONSerialization.data(withJSONObject: info)
    try json.write(to: dir.appendingPathComponent("widget.json"), options: .atomic)
    WidgetCenter.shared.reloadAllTimelines()
  }

  /** The place, filled to 2:1 (it's cropped to a square for the small widget), with the pet standing in front. */
  private static func compose(background: URL, pet: URL?, closeUp: Bool) -> CGImage? {
    let w = 1000, h = 500
    guard let bg = load(background),
          let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    ctx.interpolationQuality = .high
    let fill = max(CGFloat(w) / CGFloat(bg.width), CGFloat(h) / CGFloat(bg.height))
    let bw = CGFloat(bg.width) * fill, bh = CGFloat(bg.height) * fill
    ctx.draw(bg, in: CGRect(x: (CGFloat(w) - bw) / 2, y: (CGFloat(h) - bh) / 2, width: bw, height: bh))
    if let pet, let p = load(pet) {
      // A close-up rises from the bottom edge; a whole pet stands a little way into the picture.
      let ph = CGFloat(h) * (closeUp ? 0.9 : 0.62)
      let pw = ph * CGFloat(p.width) / CGFloat(p.height)
      let bottom = closeUp ? 0 : CGFloat(h) * 0.1
      if !closeUp {
        // A soft contact shadow, so it stands on the ground rather than floating over it.
        let shadow = CGRect(x: (CGFloat(w) - pw * 0.8) / 2, y: bottom - ph * 0.03, width: pw * 0.8, height: ph * 0.1)
        let colours = [CGColor(red: 0.11, green: 0.16, blue: 0.08, alpha: 0.45), CGColor(red: 0.11, green: 0.16, blue: 0.08, alpha: 0)] as CFArray
        if let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!, colors: colours, locations: [0, 1]) {
          ctx.saveGState()
          ctx.translateBy(x: shadow.midX, y: shadow.midY)
          ctx.scaleBy(x: shadow.width / 2, y: shadow.height / 2)
          ctx.drawRadialGradient(gradient, startCenter: .zero, startRadius: 0, endCenter: .zero, endRadius: 1, options: [])
          ctx.restoreGState()
        }
      }
      ctx.draw(p, in: CGRect(x: (CGFloat(w) - pw) / 2, y: bottom, width: pw, height: ph))
    }
    return ctx.makeImage()
  }

  private static func load(_ url: URL) -> CGImage? {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
  }

  private static func writePNG(_ image: CGImage, to url: URL) throws {
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
      throw CutOutException("Couldn't save the widget's picture.")
    }
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { throw CutOutException("Couldn't save the widget's picture.") }
  }
}

/**
 The pet brought to life: full-frame generated clips that all start and end on
 the same key frame. A loop (resting, or asleep) plays on repeat; an action
 fades in over it, and when it ends, on that same frame, the loop takes over
 again from its start, so the joins can't be seen.
 */
final class AliveView: ExpoView {
  let onActionEnd = EventDispatcher()

  private let loopPlayer = AVQueuePlayer()
  private let loopLayer = AVPlayerLayer()
  private var looper: AVPlayerLooper?
  private var loopUri: String?
  private let actionPlayer = AVPlayer()
  private let actionLayer = AVPlayerLayer()
  private var actionKey: Int?
  private var actionThen: String?
  private var playingAction = false
  private var night = false
  private var endObserver: NSObjectProtocol?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    for (player, layer) in [(loopPlayer as AVPlayer, loopLayer), (actionPlayer, actionLayer)] {
      player.isMuted = true // their real voice is played separately, in step
      player.preventsDisplaySleepDuringVideoPlayback = false
      layer.player = player
      layer.videoGravity = .resizeAspectFill
      self.layer.addSublayer(layer)
    }
    actionLayer.opacity = 0
    actionPlayer.actionAtItemEnd = .pause // hold the last frame until the loop is back on it
  }

  deinit {
    looper?.disableLooping()
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    loopLayer.frame = bounds
    actionLayer.frame = bounds
    CATransaction.commit()
  }

  func setLoop(_ uri: String?) {
    guard uri != loopUri else { return }
    loopUri = uri
    if !playingAction { startLoop() }
  }

  func setNight(_ next: Bool) {
    guard next != night else { return }
    night = next
    startLoop()
  }

  /** { uri, key, then? }: a new key plays the clip; `then` is the loop to carry on with afterwards. */
  func setAction(_ action: [String: Any]?) {
    guard let action, let uri = action["uri"] as? String, let url = URL(string: uri) else { return }
    let key = (action["key"] as? Int) ?? 0
    guard key != actionKey else { return }
    actionKey = key
    actionThen = action["then"] as? String
    let item = item(for: url)
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
      self?.actionEnded()
    }
    actionPlayer.replaceCurrentItem(with: item)
    actionPlayer.seek(to: .zero)
    actionPlayer.play()
    playingAction = true
    CATransaction.begin()
    CATransaction.setAnimationDuration(0.28)
    actionLayer.opacity = 1
    CATransaction.commit()
  }

  private func actionEnded() {
    if let then = actionThen { loopUri = then }
    playingAction = false
    // The action ended on the key frame; start the loop from its first frame (the same picture),
    // and only then let go of the action, so nothing visibly changes.
    startLoop { [weak self] in
      guard let self else { return }
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      self.actionLayer.opacity = 0
      CATransaction.commit()
      self.onActionEnd(["key": self.actionKey ?? 0])
    }
  }

  private func startLoop(ready: (() -> Void)? = nil) {
    looper?.disableLooping()
    loopPlayer.removeAllItems()
    looper = nil
    guard let loopUri, let url = URL(string: loopUri) else { ready?(); return }
    looper = AVPlayerLooper(player: loopPlayer, templateItem: item(for: url))
    loopPlayer.play()
    guard let ready else { return }
    // Give the loop a moment to put its first frame on screen before the action layer goes.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.12, execute: ready)
  }

  private func item(for url: URL) -> AVPlayerItem {
    let item = AVPlayerItem(url: url)
    if night {
      item.videoComposition = AVVideoComposition(asset: item.asset) { request in
        request.finish(with: Moonlight.apply(request.sourceImage), context: nil)
      }
    }
    return item
  }
}

/**
 Daylight footage under a night sky, matching the night photos: mostly
 desaturated, then darker and bluer. Core Image works in linear light, so the
 display-space factors (0.42, 0.48, 0.66) are raised to the power 2.2 here.
 Scaling colour alone keeps premultiplied alpha valid, so see-through edges survive.
 */
enum Moonlight {
  static func apply(_ image: CIImage) -> CIImage {
    image
      .applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 0.4])
      .applyingFilter("CIColorMatrix", parameters: [
        "inputRVector": CIVector(x: 0.148, y: 0, z: 0, w: 0),
        "inputGVector": CIVector(x: 0, y: 0.2, z: 0, w: 0),
        "inputBVector": CIVector(x: 0, y: 0, z: 0.4, w: 0),
      ])
  }
}

/** Hosts the real-time play scene in the app. */
final class PlayView: ExpoView {
  let onPlayEvent = EventDispatcher()
  private let skView = SKView()
  private var scene: PlayScene?
  private var pet: CGImage?
  private var rig: [String: CGPoint] = [:]
  private var asleep: CGImage?
  private var asleepUri: String?
  private var asleepFacesRight = true
  private var background: CGImage?
  private var ball: CGImage?
  private var petUri: String?
  private var backgroundUri: String?
  private var ballUri: String?
  private var commandKey: Int?
  var horizon: CGFloat = 0.59
  var cameraMetres: CGFloat = 0.75
  var night = false
  var species = "dog"

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    skView.ignoresSiblingOrder = true
    skView.preferredFramesPerSecond = 60
    addSubview(skView)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    skView.frame = bounds
    refresh()
  }

  func setPet(_ value: [String: Any]?) {
    guard let value else { return }
    let asleepValue = value["asleep"] as? [String: Any]
    let nextAsleep = asleepValue?["uri"] as? String
    if nextAsleep != asleepUri {
      asleepUri = nextAsleep
      asleep = nextAsleep.flatMap(PlayView.load)
      asleepFacesRight = (asleepValue?["facesRight"] as? Bool) ?? true
    }
    guard let uri = value["uri"] as? String, uri != petUri else { return }
    petUri = uri
    pet = PlayView.load(uri)
    rig = [:]
    for (k, v) in (value["rig"] as? [String: [Double]]) ?? [:] where v.count >= 2 {
      rig[k] = CGPoint(x: v[0], y: v[1])
    }
  }

  func setBackground(_ uri: String?) {
    guard uri != backgroundUri else { return }
    backgroundUri = uri
    background = uri.flatMap(PlayView.load)
  }

  func setBall(_ uri: String?) {
    guard uri != ballUri else { return }
    ballUri = uri
    ball = uri.flatMap(PlayView.load)
  }

  /** { kind, key }: a new key sends the command (call, play, pet, treat). */
  func setCommand(_ command: [String: Any]?) {
    guard let command, let kind = command["kind"] as? String else { return }
    let key = (command["key"] as? Int) ?? 0
    guard key != commandKey else { return }
    commandKey = key
    scene?.command(kind)
  }

  func refresh() {
    guard let pet, !rig.isEmpty, bounds.width > 0 else { return }
    let setup = PlayScene.Setup(background: background, pet: pet, rig: rig, ball: ball, asleep: asleep, asleepFacesRight: asleepFacesRight, night: night, species: species)
    if let scene, let world = scene.place as? PhotoWorld, world.horizon == horizon, world.cameraMetres == cameraMetres {
      scene.update(setup: setup)
    } else {
      let s = PlayScene(size: bounds.size, setup: setup, world: PhotoWorld(horizon: horizon, cameraMetres: cameraMetres))
      s.onEvent = { [weak self] type in self?.onPlayEvent(["type": type]) }
      scene = s
      skView.presentScene(s)
      s.announce()
    }
  }

  private static func load(_ uri: String) -> CGImage? {
    guard let url = URL(string: uri), let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
  }
}
