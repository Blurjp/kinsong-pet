import AVFoundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import VideoToolbox
import Vision

/**
 Turns a short video of the pet into a clip of just the pet, on the device.

 The output is the real footage at its own frame rate (up to `maxFps`), with
 everything but the pet made transparent and saved as HEVC with alpha, so it
 plays like a video, not a flipbook. A quick first pass finds the pet a few
 times a second; the crop then follows it smoothly, like a camera operator,
 keeping it the same size with its feet in the same place. A dog walking
 across the room becomes a steady walk on the spot, and the garden supplies
 the travel. The clip's own sound is copied out untouched. Nothing is
 generated or retouched.

 No Expo types in here, so the same code can be checked on a Mac.
 */
struct ClipCutterOptions {
  var maxSeconds = 8.0
  var maxFps = 30.0
  /** Longest side of the output, in pixels. */
  var size = 720
}

struct ClipCutterError: Error, CustomStringConvertible {
  let description: String
}

struct CutClip {
  var videoURL: URL
  var posterURL: URL
  var width: Int
  var height: Int
  var seconds: Double
  /** False when the pet couldn't be separated from the background, so the footage keeps it. */
  var cutout: Bool
  /** The pet runs off the bottom of the frame (a close-up), so it has no feet to stand on. */
  var closeUp: Bool
  /** Which way the pet travels in the clip; "right" when it doesn't travel. */
  var facing: String
  var audioURL: URL?

  var dictionary: [String: Any] {
    var d: [String: Any] = [
      "videoUri": videoURL.absoluteString,
      "posterUri": posterURL.absoluteString,
      "width": width,
      "height": height,
      "seconds": seconds,
      "cutout": cutout,
      "closeUp": closeUp,
      "facing": facing,
    ]
    if let audioURL { d["audioUri"] = audioURL.absoluteString }
    return d
  }
}

enum ClipCutter {
  private static let ciContext = CIContext()
  private static let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

  static func cut(video: URL, into dir: URL, options: ClipCutterOptions, progress: @escaping (Double) -> Void) async throws -> CutClip {
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let asset = AVURLAsset(url: video)
    guard let track = try await asset.loadTracks(withMediaType: .video).first else {
      throw ClipCutterError(description: "That file has no video in it.")
    }
    let duration = try await asset.load(.duration).seconds
    guard duration.isFinite, duration > 0 else { throw ClipCutterError(description: "That video couldn't be read. Try a different clip.") }
    let seconds = min(duration, max(0.5, options.maxSeconds))
    let natural = try await track.load(.naturalSize)
    let transform = try await track.load(.preferredTransform)
    let orientation = orientation(of: transform)
    let upright = [.left, .right].contains(orientation) ? CGSize(width: natural.height, height: natural.width) : natural

    // Pass 1: where is the pet over the whole clip? Small frames, a few per second.
    let found = try await locate(asset: asset, seconds: seconds) { progress(0.15 * $0) }
    let framing = Framing(found: found, size: upright)
    let (w, h) = framing.outputSize(longest: options.size)
    let frame = CGRect(x: 0, y: 0, width: w, height: h)

    // Pass 2: every frame, cut out and written as video.
    let reader = try AVAssetReader(asset: asset)
    reader.timeRange = CMTimeRange(start: .zero, duration: CMTime(seconds: seconds, preferredTimescale: 600))
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    output.alwaysCopiesSampleData = false
    reader.add(output)

    let videoURL = dir.appendingPathComponent("clip.mov")
    try? FileManager.default.removeItem(at: videoURL)
    let writer = try AVAssetWriter(outputURL: videoURL, fileType: .mov)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: try videoSettings(for: writer, width: w, height: h, alpha: found.cutout))
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      kCVPixelBufferWidthKey as String: w,
      kCVPixelBufferHeightKey as String: h,
    ])
    writer.add(input)
    guard reader.startReading(), writer.startWriting() else {
      throw ClipCutterError(description: "Couldn't prepare that video. Try a different clip.")
    }
    writer.startSession(atSourceTime: .zero)

    let posterURL = dir.appendingPathComponent("poster.png")
    let clear = CIImage(color: .clear).cropped(to: frame)
    var lastMask: CIImage?
    var next = 0.0
    var wrote = 0
    while let sample = output.copyNextSampleBuffer() {
      let time = CMSampleBufferGetPresentationTimeStamp(sample)
      guard let pixels = CMSampleBufferGetImageBuffer(sample), time.seconds + 0.002 >= next else { continue }
      next = time.seconds + 1 / options.maxFps
      let source = CIImage(cvPixelBuffer: pixels).oriented(orientation)
      let crop = framing.crop(at: time.seconds)
      var image = source.transformed(by: CGAffineTransform(translationX: -source.extent.minX, y: -source.extent.minY))
        .cropped(to: crop)
        .transformed(by: CGAffineTransform(translationX: -crop.minX, y: -crop.minY))
        .transformed(by: CGAffineTransform(scaleX: CGFloat(w) / crop.width, y: CGFloat(h) / crop.height))
      if found.cutout {
        // A frame where the pet can't be found (a blur, a paw over the lens) borrows the last good outline.
        if let mask = mask(for: image) ?? lastMask {
          lastMask = mask
          image = image.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: clear, kCIInputMaskImageKey: mask])
        }
      }
      image = image.composited(over: clear)

      while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 2_000_000) }
      guard let pool = adaptor.pixelBufferPool else { throw ClipCutterError(description: "Couldn't write the clip.") }
      var buffer: CVPixelBuffer?
      CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer)
      guard let buffer else { throw ClipCutterError(description: "Couldn't write the clip.") }
      ciContext.render(image, to: buffer, bounds: frame, colorSpace: sRGB)
      adaptor.append(buffer, withPresentationTime: time)
      if wrote == 0, let poster = ciContext.createCGImage(image, from: frame, format: .RGBA8, colorSpace: sRGB) {
        try writePNG(poster, to: posterURL)
      }
      wrote += 1
      progress(0.15 + 0.8 * min(1, time.seconds / seconds))
    }
    input.markAsFinished()
    await writer.finishWriting()
    guard reader.status == .completed, writer.status == .completed, wrote > 0 else {
      throw ClipCutterError(description: writer.error?.localizedDescription ?? reader.error?.localizedDescription ?? "Couldn't write the clip.")
    }

    let audioURL = await copyAudio(of: asset, seconds: seconds, into: dir)
    progress(1)
    return CutClip(
      videoURL: videoURL, posterURL: posterURL, width: w, height: h, seconds: seconds,
      cutout: found.cutout, closeUp: found.closeUp, facing: found.facing, audioURL: audioURL
    )
  }

  // MARK: - Finding the pet

  private struct Found {
    /** The pet's box at moments through the clip, normalised from the top left. Empty when it wasn't found. */
    var track: [(t: Double, box: CGRect)]
    var cutout: Bool
    var closeUp: Bool
    var facing: String
  }

  /** Where to crop each frame so the pet stays put in the clip. */
  private struct Framing {
    let size: CGSize
    let closeUp: Bool
    /** Smoothed pet boxes, in pixels from the top left. */
    let track: [(t: Double, box: CGRect)]
    /** Crop width over height. */
    let aspect: CGFloat
    /** Top of a close-up's crop: the highest the pet reaches. */
    let top: CGFloat

    init(found: Found, size: CGSize) {
      self.size = size
      closeUp = found.closeUp
      let px = found.track.map { (t: $0.t, box: CGRect(x: $0.box.minX * size.width, y: $0.box.minY * size.height, width: $0.box.width * size.width, height: $0.box.height * size.height)) }
      // A moving average over about a second, so the crop glides with the pet instead of twitching.
      track = px.indices.map { i in
        let near = px[max(0, i - 2)...min(px.count - 1, i + 2)].map(\.box)
        let avg = { (f: (CGRect) -> CGFloat) in near.map(f).reduce(0, +) / CGFloat(near.count) }
        let midX = avg(\.midX), maxY = avg(\.maxY), width = avg(\.width), height = avg(\.height)
        return (t: px[i].t, box: CGRect(x: midX - width / 2, y: maxY - height, width: width, height: height))
      }
      let top = max(0, (px.map(\.box.minY).min() ?? 0) - size.height * 0.03)
      let closeUp = found.closeUp
      let widest = px.map { $0.box.width / (closeUp ? size.height - top : $0.box.height * 1.16) }.max() ?? 1
      self.top = top
      aspect = px.isEmpty ? size.width / size.height : min(2.4, max(0.5, widest * 1.1))
    }

    /** The pet's smoothed box at time t. */
    private func box(at t: Double) -> CGRect? {
      guard let first = track.first, let last = track.last else { return nil }
      if t <= first.t { return first.box }
      if t >= last.t { return last.box }
      let i = track.firstIndex { $0.t >= t }!
      let a = track[i - 1], b = track[i]
      let f = CGFloat((t - a.t) / (b.t - a.t))
      let mix = { (p: CGFloat, q: CGFloat) in p + (q - p) * f }
      return CGRect(x: mix(a.box.minX, b.box.minX), y: mix(a.box.minY, b.box.minY), width: mix(a.box.width, b.box.width), height: mix(a.box.height, b.box.height))
    }

    /** The crop for the frame at time t, in Core Image pixels (origin bottom left). */
    func crop(at t: Double) -> CGRect {
      guard let b = box(at: t) else { return CGRect(origin: .zero, size: size) }
      let height = closeUp ? size.height - top : b.height * 1.16
      let bottom = closeUp ? size.height : b.maxY + b.height * 0.05
      let width = height * aspect
      return CGRect(x: b.midX - width / 2, y: size.height - bottom, width: width, height: height)
    }

    /** Output size: the crop's shape, no bigger than `longest` or than the footage itself. */
    func outputSize(longest: Int) -> (Int, Int) {
      let typical = track.isEmpty ? size.height : crop(at: track[track.count / 2].t).height
      let h = min(CGFloat(longest) / max(1, aspect), CGFloat(longest), typical)
      let even = { (v: CGFloat) in max(2, Int(v) / 2 * 2) }
      return (even(h * aspect), even(h))
    }
  }

  private static func locate(asset: AVURLAsset, seconds: Double, progress: (Double) -> Void) async throws -> Found {
    let probe = AVAssetImageGenerator(asset: asset)
    probe.appliesPreferredTrackTransform = true
    probe.maximumSize = CGSize(width: 384, height: 384)
    probe.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 30)
    probe.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 30)
    let count = max(4, Int(seconds * 4))
    var pets: [(t: Double, box: CGRect)] = []
    var animals: [CGRect] = []
    for i in 0..<count {
      let t = seconds * Double(i) / Double(count)
      if let image = try? await probe.image(at: CMTime(seconds: t, preferredTimescale: 600)).image {
        if let b = petBox(in: image) { pets.append((t: t, box: b)) }
        if let b = animalBox(in: image) { animals.append(b) }
      }
      progress(Double(i + 1) / Double(count))
    }
    guard pets.count * 2 >= count else {
      // No clear pet to follow: keep the footage still, framed on the animal if it was recognised.
      let union = animals.dropFirst().reduce(animals.first) { $0?.union($1) }
      return Found(track: union.map { [(t: 0, box: $0)] } ?? [], cutout: false, closeUp: false, facing: "right")
    }
    let closeUp = pets.filter { $0.box.maxY > 0.97 }.count * 10 >= pets.count * 3
    // Only a guess (a panning camera hides which way the pet goes); the family can turn it around.
    let drift = pets.last!.box.midX - pets.first!.box.midX
    return Found(track: pets, cutout: true, closeUp: closeUp, facing: drift < -0.08 ? "left" : "right")
  }

  /** The pet's outline in this frame, softened a touch so no background fringe shows; nil when there's no clear pet. */
  private static func mask(for image: CIImage) -> CIImage? {
    guard #available(iOS 17.0, macOS 14.0, *) else { return nil }
    let handler = VNImageRequestHandler(ciImage: image, options: [:])
    guard let observation = foreground(handler) else { return nil }
    let ids = petInstances(of: observation, inside: animal(handler))
    guard !ids.isEmpty, let buffer = try? observation.generateScaledMaskForImage(forInstances: ids, from: handler) else { return nil }
    return CIImage(cvPixelBuffer: buffer)
      .applyingFilter("CIMorphologyMinimum", parameters: [kCIInputRadiusKey: 1.0])
      .applyingGaussianBlur(sigma: 0.7)
      .cropped(to: image.extent)
  }

  /** Box around the pet, normalised from the top left; nil when there's no clear pet. */
  private static func petBox(in image: CGImage) -> CGRect? {
    guard #available(iOS 17.0, macOS 14.0, *) else { return nil }
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    guard let observation = foreground(handler) else { return nil }
    let ids = petInstances(of: observation, inside: animal(handler))
    guard !ids.isEmpty else { return nil }
    return labelBounds(observation.instanceMask, labels: ids)
  }

  @available(iOS 17.0, macOS 14.0, *)
  private static func foreground(_ handler: VNImageRequestHandler) -> VNInstanceMaskObservation? {
    let request = VNGenerateForegroundInstanceMaskRequest()
    guard (try? handler.perform([request])) != nil else { return nil }
    return request.results?.first
  }

  /** The recognised cat or dog, in Vision's coordinates (normalised, origin bottom left). */
  private static func animal(_ handler: VNImageRequestHandler) -> CGRect? {
    let request = VNRecognizeAnimalsRequest()
    try? handler.perform([request])
    return request.results?.first?.boundingBox
  }

  private static func animalBox(in image: CGImage) -> CGRect? {
    guard let b = animal(VNImageRequestHandler(cgImage: image, options: [:])) else { return nil }
    return CGRect(x: b.minX, y: 1 - b.maxY, width: b.width, height: b.height)
  }

  /**
   Which foreground objects are the pet: when an animal was recognised, the ones
   that lie mostly inside its box (so a person holding the dog is left out);
   otherwise everything in the foreground.
   */
  @available(iOS 17.0, macOS 14.0, *)
  private static func petInstances(of observation: VNInstanceMaskObservation, inside box: CGRect?) -> IndexSet {
    let all = observation.allInstances
    guard let box, all.count > 1 else { return all }
    var total = [Int](repeating: 0, count: 256), inside = [Int](repeating: 0, count: 256)
    let x0 = box.minX, x1 = box.maxX, y0 = 1 - box.maxY, y1 = 1 - box.minY
    scan(observation.instanceMask) { x, y, label in
      total[label] += 1
      if x >= x0, x < x1, y >= y0, y < y1 { inside[label] += 1 }
    }
    let best = all.map { inside[$0] }.max() ?? 0
    guard best > 0 else { return all }
    return IndexSet(all.filter { inside[$0] * 3 >= best && Double(inside[$0]) >= Double(total[$0]) * 0.6 })
  }

  private static func labelBounds(_ mask: CVPixelBuffer, labels: IndexSet) -> CGRect? {
    var minX = 1.0, minY = 1.0, maxX = 0.0, maxY = 0.0
    scan(mask) { x, y, label in
      guard labels.contains(label) else { return }
      minX = min(minX, x); maxX = max(maxX, x)
      minY = min(minY, y); maxY = max(maxY, y)
    }
    guard maxX > minX, maxY > minY else { return nil }
    return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
  }

  /** Visits every pixel of an instance mask with normalised coordinates, origin top left. */
  private static func scan(_ mask: CVPixelBuffer, _ visit: (Double, Double, Int) -> Void) {
    CVPixelBufferLockBaseAddress(mask, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(mask)?.assumingMemoryBound(to: UInt8.self) else { return }
    let w = CVPixelBufferGetWidth(mask), h = CVPixelBufferGetHeight(mask), stride = CVPixelBufferGetBytesPerRow(mask)
    for y in 0..<h {
      for x in 0..<w {
        visit(Double(x) / Double(w), Double(y) / Double(h), Int(base[y * stride + x]))
      }
    }
  }

  // MARK: - Writing

  private static func videoSettings(for writer: AVAssetWriter, width: Int, height: Int, alpha: Bool) throws -> [String: Any] {
    var compression: [String: Any] = [AVVideoQualityKey: 0.9]
    if alpha {
      compression[kVTCompressionPropertyKey_TargetQualityForAlpha as String] = 0.9
      compression[kVTCompressionPropertyKey_AlphaChannelMode as String] = kVTAlphaChannelMode_PremultipliedAlpha
    }
    let codec: AVVideoCodecType = alpha ? .hevcWithAlpha : .hevc
    for props in [compression, [:]] {
      var settings: [String: Any] = [AVVideoCodecKey: codec, AVVideoWidthKey: width, AVVideoHeightKey: height]
      if !props.isEmpty { settings[AVVideoCompressionPropertiesKey] = props }
      if writer.canApply(outputSettings: settings, forMediaType: .video) { return settings }
    }
    throw ClipCutterError(description: "This device can't save see-through video.")
  }

  private static func orientation(of t: CGAffineTransform) -> CGImagePropertyOrientation {
    switch (t.a, t.b, t.c, t.d) {
    case (0, 1, -1, 0): return .right
    case (0, -1, 1, 0): return .left
    case (-1, 0, 0, -1): return .down
    default: return .up
    }
  }

  private static func writePNG(_ image: CGImage, to url: URL) throws {
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
      throw ClipCutterError(description: "Couldn't save the clip's picture.")
    }
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { throw ClipCutterError(description: "Couldn't save the clip's picture.") }
  }

  /** The clip's own sound, untouched, or nil when the video has none. */
  private static func copyAudio(of asset: AVURLAsset, seconds: Double, into dir: URL) async -> URL? {
    guard let tracks = try? await asset.loadTracks(withMediaType: .audio), !tracks.isEmpty,
          let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A)
    else { return nil }
    let out = dir.appendingPathComponent("sound.m4a")
    try? FileManager.default.removeItem(at: out)
    export.outputURL = out
    export.outputFileType = .m4a
    export.timeRange = CMTimeRange(start: .zero, duration: CMTime(seconds: seconds, preferredTimescale: 600))
    await export.export()
    return export.status == .completed ? out : nil
  }
}
