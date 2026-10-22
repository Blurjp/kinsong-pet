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

  static func detect(cutout: URL) throws -> [String: Point] {
    guard let src = CGImageSourceCreateWithURL(cutout as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
      throw ClipCutterError(description: "Couldn't read the picture of your pet.")
    }
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

  /** "animal_joint_left_front_paw" → "left_front_paw". */
  private static func short(_ name: String) -> String {
    name.replacingOccurrences(of: "animal_joint_", with: "")
  }
}
