import AVFoundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers

/**
 The stills that "bring to life" starts from, made on the device: the pet cut
 out of a photo, the pet placed in a scene (the key frame every generated clip
 starts and ends on), and a clip's last frame (the pose it was left in).

 No Expo types in here, so the same code can be checked on a Mac.
 */
enum Keyframe {
  private static let ciContext = CIContext()
  private static let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

  struct CutPhoto {
    var url: URL
    var width: Int
    var height: Int
    /** The pet runs off the bottom of the photo, so there are no feet to stand it on. */
    var closeUp: Bool
  }

  /** The pet from a photo, on transparency, cropped to it. */
  static func cutOut(photo: URL, to out: URL) throws -> CutPhoto {
    guard let image = load(photo, maxSide: 2000) else { throw ClipCutterError(description: "That photo couldn't be read.") }
    let source = CIImage(cgImage: image)
    guard let mask = ClipCutter.petMask(for: source) else {
      throw ClipCutterError(description: "Couldn't find your pet in that photo. A photo where they stand out clearly works best.")
    }
    let clear = CIImage(color: .clear).cropped(to: source.extent)
    let cut = source.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: clear, kCIInputMaskImageKey: mask])
    guard let full = ciContext.createCGImage(cut, from: source.extent, format: .RGBA8, colorSpace: sRGB),
          let box = opaqueBox(full), let cropped = full.cropping(to: box)
    else { throw ClipCutterError(description: "Couldn't find your pet in that photo.") }
    try writePNG(cropped, to: out)
    return CutPhoto(url: out, width: cropped.width, height: cropped.height, closeUp: box.maxY >= CGFloat(full.height) * 0.98)
  }

  /**
   The pet standing in a scene: its feet at `feet` (fractions of the scene,
   from the top left), `height` of the scene tall. Its colour balance and
   brightness are pulled part of the way toward the scene's light, and it
   gets a soft contact shadow, so it starts out looking like it was there.
   */
  static func compose(pet: URL, scene: URL, to out: URL, feet: CGPoint, height: CGFloat) throws -> URL {
    guard let bg = load(scene, maxSide: 1440), let animal = load(pet, maxSide: 2000) else {
      throw ClipCutterError(description: "Couldn't read the scene or the pet.")
    }
    let w = bg.width, h = bg.height
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
      throw ClipCutterError(description: "Couldn't make the picture.")
    }
    ctx.interpolationQuality = .high
    ctx.draw(bg, in: CGRect(x: 0, y: 0, width: w, height: h))

    let ph = CGFloat(h) * height
    let pw = ph * CGFloat(animal.width) / CGFloat(animal.height)
    // Core Graphics counts from the bottom.
    let rect = CGRect(x: feet.x * CGFloat(w) - pw / 2, y: CGFloat(h) * (1 - feet.y), width: pw, height: ph)

    let colours = [CGColor(red: 0.08, green: 0.1, blue: 0.06, alpha: 0.5), CGColor(red: 0.08, green: 0.1, blue: 0.06, alpha: 0)] as CFArray
    if let gradient = CGGradient(colorsSpace: sRGB, colors: colours, locations: [0, 1]) {
      ctx.saveGState()
      ctx.translateBy(x: rect.midX, y: rect.minY + ph * 0.01)
      ctx.scaleBy(x: pw * 0.45, y: ph * 0.05)
      ctx.drawRadialGradient(gradient, startCenter: .zero, startRadius: 0, endCenter: .zero, endRadius: 1, options: [])
      ctx.restoreGState()
    }
    ctx.draw(harmonised(animal, toward: bg) ?? animal, in: rect)

    guard let frame = ctx.makeImage(), let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
      throw ClipCutterError(description: "Couldn't save the picture.")
    }
    CGImageDestinationAddImage(dest, frame, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
    guard CGImageDestinationFinalize(dest) else { throw ClipCutterError(description: "Couldn't save the picture.") }
    return out
  }

  /** The last frame of a clip, as a JPEG: where the pet ended up. */
  static func lastFrame(of video: URL, to out: URL) async throws -> URL {
    let asset = AVURLAsset(url: video)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 10)
    generator.requestedTimeToleranceAfter = .zero
    let duration = try await asset.load(.duration)
    let image = try await generator.image(at: CMTimeSubtract(duration, CMTime(value: 1, timescale: 60))).image
    guard let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
      throw ClipCutterError(description: "Couldn't save the frame.")
    }
    CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.92] as CFDictionary)
    guard CGImageDestinationFinalize(dest) else { throw ClipCutterError(description: "Couldn't save the frame.") }
    return out
  }

  // MARK: - Helpers

  /** Average colour of the opaque pixels (the pet) or of everything (the scene), sampled small. */
  private static func average(_ image: CGImage, opaqueOnly: Bool) -> (r: Double, g: Double, b: Double)? {
    let n = 64
    guard let ctx = CGContext(data: nil, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n * 4, space: sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: n, height: n))
    guard let px = ctx.data?.assumingMemoryBound(to: UInt8.self) else { return nil }
    var r = 0.0, g = 0.0, b = 0.0, weight = 0.0
    for i in 0..<(n * n) {
      let a = Double(px[i * 4 + 3]) / 255
      if opaqueOnly && a < 0.5 { continue }
      // Premultiplied: divide the alpha back out.
      let k = a > 0 ? 1 / a : 0
      r += Double(px[i * 4]) * k; g += Double(px[i * 4 + 1]) * k; b += Double(px[i * 4 + 2]) * k
      weight += 1
    }
    guard weight > 0 else { return nil }
    return (r / weight / 255, g / weight / 255, b / weight / 255)
  }

  /** The pet, its white balance and brightness moved part of the way toward the scene's. */
  private static func harmonised(_ pet: CGImage, toward scene: CGImage) -> CGImage? {
    guard let p = average(pet, opaqueOnly: true), let s = average(scene, opaqueOnly: false) else { return nil }
    let luma = { (c: (r: Double, g: Double, b: Double)) in max(0.02, 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) }
    let pl = luma(p), sl = luma(s)
    // Tint: the scene's colour cast relative to its brightness, applied gently.
    let cast = (r: s.r / sl, g: s.g / sl, b: s.b / sl)
    let own = (r: p.r / pl, g: p.g / pl, b: p.b / pl)
    let mix = { (a: Double, b: Double, t: Double) in a + (b - a) * t }
    // Brightness follows how bright the scene's light is (about 0.45 on a sunny day), never the
    // pet's own coat: a black dog stays black on a bright beach.
    _ = pl
    let exposure = min(1.1, max(0.75, mix(1, sl / 0.45, 0.3)))
    let gain = (r: mix(1, cast.r / own.r, 0.25) * exposure, g: mix(1, cast.g / own.g, 0.25) * exposure, b: mix(1, cast.b / own.b, 0.25) * exposure)
    let input = CIImage(cgImage: pet)
    // Scaling colour alone keeps premultiplied alpha valid.
    let out = input.applyingFilter("CIColorMatrix", parameters: [
      "inputRVector": CIVector(x: CGFloat(gain.r), y: 0, z: 0, w: 0),
      "inputGVector": CIVector(x: 0, y: CGFloat(gain.g), z: 0, w: 0),
      "inputBVector": CIVector(x: 0, y: 0, z: CGFloat(gain.b), w: 0),
    ])
    return ciContext.createCGImage(out, from: input.extent, format: .RGBA8, colorSpace: sRGB)
  }

  /** Box around the opaque pixels, in pixels from the top left. */
  private static func opaqueBox(_ image: CGImage) -> CGRect? {
    let w = image.width, h = image.height
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    guard let px = ctx.data?.assumingMemoryBound(to: UInt8.self) else { return nil }
    var x0 = w, y0 = h, x1 = -1, y1 = -1
    for y in 0..<h {
      for x in 0..<w where px[(y * w + x) * 4 + 3] > 20 {
        x0 = min(x0, x); x1 = max(x1, x); y0 = min(y0, y); y1 = max(y1, y)
      }
    }
    guard x1 >= x0, y1 >= y0 else { return nil }
    return CGRect(x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1)
  }

  /** An image file, upright (EXIF orientation applied), no bigger than `maxSide`. */
  private static func load(_ url: URL, maxSide: Int) -> CGImage? {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxSide,
    ]
    return CGImageSourceCreateThumbnailAtIndex(src, 0, options as CFDictionary)
  }

  private static func writePNG(_ image: CGImage, to url: URL) throws {
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
      throw ClipCutterError(description: "Couldn't save the picture.")
    }
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { throw ClipCutterError(description: "Couldn't save the picture.") }
  }
}
