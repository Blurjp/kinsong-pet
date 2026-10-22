import CoreGraphics
import CoreImage
import Foundation
import ImageIO
import Vision

/**
 The skeleton of the pet in the family's photo, found on the device with
 Vision's animal body pose: nose, eyes, ears, neck, each leg's upper joint,
 knee and paw, and the tail's base, middle and tip. The puppet bends the photo
 along these.

 Points are fractions of the cut-out image, from the top left.
 */
enum PetRig {
  struct Point: Codable {
    var x: Double
    var y: Double
    var c: Double
  }

  /**
   The skeleton for a pet of this species. Vision knows cats and dogs; for
   rabbits, birds and other pets (and whenever Vision can't make one out) the
   skeleton is worked out from the pet's outline instead.
   */
  static func detect(cutout: URL, species: String) throws -> [String: Point] {
    guard let src = CGImageSourceCreateWithURL(cutout as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
      throw ClipCutterError(description: "Couldn't read the picture of your pet.")
    }
    if species == "dog" || species == "cat", let found = try? vision(image) {
      return found
    }
    guard let outline = silhouette(image) else {
      throw ClipCutterError(description: "Couldn't make out your pet's shape. A photo from the side, nose to tail, works best.")
    }
    return outline
  }

  private static func vision(_ image: CGImage) throws -> [String: Point] {
    guard #available(iOS 17.0, macOS 14.0, *) else { throw ClipCutterError(description: "This needs iOS 17 or later.") }
    // Vision looks for animals in photos, so give the cut-out a plain background rather than transparency.
    let w = image.width, h = image.height
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
      throw ClipCutterError(description: "Couldn't read the picture of your pet.")
    }
    ctx.setFillColor(CGColor(red: 0.62, green: 0.66, blue: 0.6, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    let request = VNDetectAnimalBodyPoseRequest()
    try VNImageRequestHandler(cgImage: ctx.makeImage()!, options: [:]).perform([request])
    guard let observation = request.results?.first else {
      throw ClipCutterError(description: "Couldn't make out your pet's shape. A photo from the side, standing, works best.")
    }
    var out: [String: Point] = [:]
    for (name, p) in try observation.recognizedPoints(.all) where p.confidence > 0.1 {
      out[short(name.rawValue.rawValue)] = Point(x: Double(p.location.x), y: Double(1 - p.location.y), c: Double(p.confidence))
    }
    let legs = ["front_paw", "back_paw"].filter { leg in out.keys.contains { $0.hasSuffix(leg) } }
    guard out["nose"] != nil, legs.count == 2 else {
      throw ClipCutterError(description: "Couldn't see all of your pet. Choose a photo from the side that shows them from nose to tail, standing.")
    }
    return out
  }

  /**
   A skeleton from the outline alone, for a pet seen from the side. The head
   end is where the shape reaches highest (a rabbit's ears, a bird's head);
   the nose is the furthest point forward below that; the paws are the lowest
   points at the front and the back; the tail is the furthest point back.
   Joints in between follow the body's proportions.
   */
  static func silhouette(_ image: CGImage) -> [String: Point]? {
    let w = 160, h = max(8, Int(160 * Double(image.height) / Double(image.width)))
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
          let px = { ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h)); return ctx.data?.assumingMemoryBound(to: UInt8.self) }()
    else { return nil }
    // Row 0 is the top of the picture.
    func solid(_ x: Int, _ y: Int) -> Bool { px[(y * w + x) * 4 + 3] > 100 }
    var top = [Int](repeating: h, count: w), bottom = [Int](repeating: -1, count: w)
    for x in 0..<w {
      for y in 0..<h where solid(x, y) {
        top[x] = min(top[x], y)
        bottom[x] = max(bottom[x], y)
      }
    }
    let columns = (0..<w).filter { bottom[$0] >= 0 }
    guard let left = columns.first, let right = columns.last, right - left > 10 else { return nil }
    let width = Double(right - left)
    let ground = bottom.max() ?? h - 1
    let highest = columns.min { top[$0] < top[$1] }!
    // The head is at the end the shape reaches highest; the analysis runs as if facing right.
    let facesRight = Double(highest - left) > width / 2
    func fx(_ x: Int) -> Double { facesRight ? Double(x - left) / width : Double(right - x) / width } // 0 tail → 1 nose
    func at(_ f: Double) -> Int { facesRight ? left + Int(f * width) : right - Int(f * width) }
    func pt(_ x: Double, _ y: Double) -> Point { Point(x: x / Double(w), y: y / Double(h), c: 0.5) }

    // Ears: from the highest point down to where the shape widens into the head.
    let earTip = (x: highest, y: top[highest])
    var earBase = earTip.y
    for y in earTip.y..<ground {
      let run = (0..<w).filter { solid($0, y) && abs($0 - earTip.x) < Int(width * 0.3) }.count
      earBase = y
      if Double(run) > width * 0.22 { break }
    }
    // Nose: the furthest point forward between the ears' base and the middle of the body.
    let bodyTop = Double(earBase), bodyBottom = Double(ground)
    var nose = (x: earTip.x, y: earBase)
    var best = -1.0
    for y in earBase..<Int(bodyTop + (bodyBottom - bodyTop) * 0.6) {
      for x in 0..<w where solid(x, y) && fx(x) > best { best = fx(x); nose = (x, y) }
    }
    // Paws: the lowest points in the front and back thirds.
    func lowest(_ from: Double, _ to: Double) -> (x: Int, y: Int) {
      var p = (x: at((from + to) / 2), y: ground)
      var low = -1
      for x in columns where fx(x) >= from && fx(x) <= to && bottom[x] > low { low = bottom[x]; p = (x, bottom[x]) }
      return p
    }
    let front = lowest(0.55, 0.85), back = lowest(0.08, 0.45)
    // Tail: the furthest point back, in the middle of the body's height.
    var tail = (x: at(0), y: Int((bodyTop + bodyBottom) / 2))
    best = 2
    for y in Int(bodyTop + (bodyBottom - bodyTop) * 0.2)..<Int(bodyTop + (bodyBottom - bodyTop) * 0.85) {
      for x in 0..<w where solid(x, y) && fx(x) < best { best = fx(x); tail = (x, y) }
    }
    let legTop = bodyTop + (bodyBottom - bodyTop) * 0.45
    let inward = width * 0.06 * (facesRight ? 1 : -1)
    let eyes = (x: Double(nose.x) - inward * 1.6, y: Double(nose.y) - (bodyBottom - bodyTop) * 0.06)
    var out: [String: Point] = [
      "nose": pt(Double(nose.x), Double(nose.y)),
      "left_eye": pt(eyes.x, eyes.y),
      "neck": pt(Double(nose.x) - inward * 4, Double(earBase) + (bodyBottom - bodyTop) * 0.12),
      "left_ear_bottom": pt(Double(earTip.x) - inward * 0.5, Double(earBase)),
      "left_ear_top": pt(Double(earTip.x), Double(earTip.y)),
      "tail_bottom": pt(Double(tail.x) + inward * 1.5, Double(tail.y)),
      "tail_middle": pt(Double(tail.x) + inward * 0.5, Double(tail.y)),
      "tail_top": pt(Double(tail.x), Double(tail.y) - 1),
    ]
    for (name, paw) in [("front", front), ("back", back)] {
      // The hip sits over the haunch, between the back foot and the tail; the shoulder just behind the front paw.
      let top = (x: name == "back" ? (Double(paw.x) + Double(tail.x)) / 2 : Double(paw.x) - inward * 0.5, y: legTop)
      out["left_\(name)_elbow"] = pt(top.x, top.y)
      out["left_\(name)_knee"] = pt((top.x + Double(paw.x)) / 2, (top.y + Double(paw.y)) / 2)
      out["left_\(name)_paw"] = pt(Double(paw.x), Double(paw.y))
    }
    return out
  }

  /** "animal_joint_left_front_paw" → "left_front_paw". */
  private static func short(_ name: String) -> String {
    name.replacingOccurrences(of: "animal_joint_", with: "")
  }
}
