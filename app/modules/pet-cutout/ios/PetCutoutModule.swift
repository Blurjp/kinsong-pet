import AVFoundation
import CoreImage
import ExpoModulesCore
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
        let moonlit = request.sourceImage.applyingFilter("CIColorMatrix", parameters: [
          "inputRVector": CIVector(x: 0.42, y: 0, z: 0, w: 0),
          "inputGVector": CIVector(x: 0, y: 0.48, z: 0, w: 0),
          "inputBVector": CIVector(x: 0, y: 0, z: 0.66, w: 0),
        ])
        request.finish(with: moonlit, context: nil)
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
