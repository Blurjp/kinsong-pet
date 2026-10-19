import AVFoundation
import CoreImage
import ExpoModulesCore

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
