import AVFoundation
import CoreImage
import ExpoModulesCore
import ImageIO
import UniformTypeIdentifiers
import Vision

/**
 Cuts the pet out of a short video, entirely on the device.

 Frames are the real footage: Vision separates the pet from its background,
 every frame is cropped to the same box (so the pet doesn't jump around), and
 the frames are packed into one sprite sheet. The clip's own audio is copied
 out as-is. Nothing is generated or retouched.
 */
public class PetCutoutModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PetCutout")

    AsyncFunction("cutOut") { (videoUri: URL, outDir: URL, options: CutOutOptions) async throws -> [String: Any] in
      try await cutOut(video: videoUri, into: outDir, options: options)
    }
  }
}

struct CutOutOptions: Record {
  @Field var fps: Double = 12
  @Field var maxSeconds: Double = 6
  @Field var frameSize: Int = 240
}

final class NoVideoException: Exception, @unchecked Sendable {
  override var reason: String { "That video couldn't be read. Try a different clip." }
}

private let ciContext = CIContext()
private let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
/** Keeps memory small: frames are worked on at this size at most. */
private let workingSize = CGSize(width: 480, height: 480)
private let maxFrames = 96

private func cutOut(video: URL, into dir: URL, options: CutOutOptions) async throws -> [String: Any] {
  try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  let asset = AVURLAsset(url: video)
  let duration = try await asset.load(.duration).seconds
  guard duration.isFinite, duration > 0 else { throw NoVideoException() }
  let fps = max(4, min(options.fps, 24))
  let seconds = min(duration, max(0.5, options.maxSeconds))
  let count = max(1, min(Int(seconds * fps), maxFrames))
  let times = (0..<count).map { CMTime(seconds: Double($0) / fps, preferredTimescale: 600) }

  let generator = AVAssetImageGenerator(asset: asset)
  generator.appliesPreferredTrackTransform = true
  generator.requestedTimeToleranceBefore = .zero
  generator.requestedTimeToleranceAfter = .zero
  generator.maximumSize = workingSize

  // First try to cut the pet out of every frame.
  var masked: [CGImage?] = []
  for t in times {
    let frame = try await generator.image(at: t).image
    masked.append(foreground(of: frame))
  }
  let found = masked.compactMap { $0 }.count
  var frames: [CGImage]
  var crop: CGRect?
  let cutout = found * 2 >= count
  if cutout {
    // A frame where the pet was hidden borrows its nearest neighbour.
    frames = masked.indices.map { i in
      let near = masked.indices.sorted { abs($0 - i) < abs($1 - i) }.first { masked[$0] != nil }!
      return masked[near]!
    }
    crop = frames.compactMap(alphaBounds).reduce(nil) { $0?.union($1) ?? $1 }
  } else {
    // No clear subject (or no Vision support): keep the footage, framed on the animal if we can find it.
    frames = []
    for t in times {
      frames.append(try await generator.image(at: t).image)
    }
    crop = frames.compactMap(animalBounds).reduce(nil) { $0?.union($1) ?? $1 }
  }
  let first = frames[0]
  let full = CGRect(x: 0, y: 0, width: first.width, height: first.height)
  let box = (crop?.insetBy(dx: -(crop!.width * 0.04), dy: -(crop!.height * 0.04)) ?? full).intersection(full).integral

  let scale = CGFloat(max(64, options.frameSize)) / max(box.width, box.height)
  let cellW = max(1, Int((box.width * scale).rounded()))
  let cellH = max(1, Int((box.height * scale).rounded()))
  let cols = Int(Double(count).squareRoot().rounded(.up))
  let rows = (count + cols - 1) / cols
  guard let ctx = CGContext(
    data: nil, width: cols * cellW, height: rows * cellH, bitsPerComponent: 8, bytesPerRow: 0,
    space: sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else { throw NoVideoException() }
  ctx.interpolationQuality = .high
  for (i, frame) in frames.enumerated() {
    guard let piece = frame.cropping(to: box) else { continue }
    let col = i % cols, row = i / cols
    // Core Graphics counts rows from the bottom.
    ctx.draw(piece, in: CGRect(x: col * cellW, y: (rows - 1 - row) * cellH, width: cellW, height: cellH))
  }
  guard let sheet = ctx.makeImage() else { throw NoVideoException() }
  let sheetURL = dir.appendingPathComponent("sheet.png")
  try writePNG(sheet, to: sheetURL)

  var result: [String: Any] = [
    "sheetUri": sheetURL.absoluteString,
    "frameCount": count,
    "cols": cols,
    "fps": fps,
    "width": cellW,
    "height": cellH,
    "cutout": cutout,
  ]
  if let audio = await copyAudio(of: asset, seconds: seconds, into: dir) {
    result["audioUri"] = audio.absoluteString
  }
  return result
}

/** The frame with everything but the pet made transparent, or nil if there's no clear subject. */
private func foreground(of image: CGImage) -> CGImage? {
  guard #available(iOS 17.0, *) else { return nil }
  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  let request = VNGenerateForegroundInstanceMaskRequest()
  do {
    try handler.perform([request])
  } catch {
    return nil
  }
  guard let observation = request.results?.first else { return nil }
  let animals = VNRecognizeAnimalsRequest()
  try? handler.perform([animals])
  let instances = petInstances(of: observation, inside: animals.results?.first?.boundingBox)
  guard !instances.isEmpty,
        let buffer = try? observation.generateMaskedImage(ofInstances: instances, from: handler, croppedToInstancesExtent: false)
  else { return nil }
  let ci = CIImage(cvPixelBuffer: buffer)
  return ciContext.createCGImage(ci, from: ci.extent, format: .RGBA8, colorSpace: sRGB)
}

/**
 Which foreground objects are the pet: when an animal was recognised, the ones
 that lie mostly inside its box (so a person holding the dog is left out);
 otherwise everything in the foreground.
 */
@available(iOS 17.0, *)
private func petInstances(of observation: VNInstanceMaskObservation, inside box: CGRect?) -> IndexSet {
  let all = observation.allInstances
  guard let box, all.count > 1 else { return all }
  let mask = observation.instanceMask
  CVPixelBufferLockBaseAddress(mask, .readOnly)
  defer { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }
  guard let base = CVPixelBufferGetBaseAddress(mask)?.assumingMemoryBound(to: UInt8.self) else { return all }
  let w = CVPixelBufferGetWidth(mask), h = CVPixelBufferGetHeight(mask), stride = CVPixelBufferGetBytesPerRow(mask)
  // Vision boxes are normalised, with the origin at the bottom left.
  let x0 = Int(box.minX * CGFloat(w)), x1 = Int(box.maxX * CGFloat(w))
  let y0 = Int((1 - box.maxY) * CGFloat(h)), y1 = Int((1 - box.minY) * CGFloat(h))
  var total = [Int](repeating: 0, count: 256), inside = [Int](repeating: 0, count: 256)
  for y in 0..<h {
    for x in 0..<w {
      let label = Int(base[y * stride + x])
      total[label] += 1
      if x >= x0, x < x1, y >= y0, y < y1 { inside[label] += 1 }
    }
  }
  let best = all.map { inside[$0] }.max() ?? 0
  guard best > 0 else { return all }
  return IndexSet(all.filter { inside[$0] * 3 >= best && Double(inside[$0]) >= Double(total[$0]) * 0.6 })
}

/** The box around the opaque pixels, in pixels from the top left. */
private func alphaBounds(_ image: CGImage) -> CGRect? {
  let w = image.width, h = image.height
  guard let ctx = CGContext(
    data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
    space: sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else { return nil }
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
  guard let data = ctx.data?.assumingMemoryBound(to: UInt8.self) else { return nil }
  var minX = w, minY = h, maxX = -1, maxY = -1
  for y in 0..<h {
    for x in 0..<w where data[(y * w + x) * 4 + 3] > 24 {
      minX = min(minX, x); maxX = max(maxX, x)
      minY = min(minY, y); maxY = max(maxY, y)
    }
  }
  guard maxX >= minX, maxY >= minY else { return nil }
  return CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
}

/** The recognised cat or dog, in pixels from the top left. */
private func animalBounds(_ image: CGImage) -> CGRect? {
  let request = VNRecognizeAnimalsRequest()
  try? VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
  guard let box = request.results?.first?.boundingBox else { return nil }
  let w = CGFloat(image.width), h = CGFloat(image.height)
  return CGRect(x: box.minX * w, y: (1 - box.maxY) * h, width: box.width * w, height: box.height * h)
}

private func writePNG(_ image: CGImage, to url: URL) throws {
  guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    throw NoVideoException()
  }
  CGImageDestinationAddImage(dest, image, nil)
  guard CGImageDestinationFinalize(dest) else { throw NoVideoException() }
}

/** The clip's own sound, untouched, or nil when the video has none. */
private func copyAudio(of asset: AVURLAsset, seconds: Double, into dir: URL) async -> URL? {
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
