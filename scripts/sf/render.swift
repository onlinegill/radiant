// Renders SF Symbols exactly as the system draws them — weight, scale and all —
// to alpha-only PNGs at 4x, for use as CSS masks tinted with currentColor.
// Usage: png <outdir> <weight> <pointSize> name[,name…]
import AppKit
let a = CommandLine.arguments
let outDir = a[1], weightName = a[2], pt = Double(a[3])!, names = a[4].split(separator: ",").map(String.init)
let weights: [String: NSFont.Weight] = ["ultralight": .ultraLight, "thin": .thin, "light": .light, "regular": .regular, "medium": .medium, "semibold": .semibold, "bold": .bold, "heavy": .heavy, "black": .black]
let scale: CGFloat = 4
for name in names {
  guard let base = NSImage(systemSymbolName: name, accessibilityDescription: nil),
        let img = base.withSymbolConfiguration(.init(pointSize: pt, weight: weights[weightName] ?? .regular, scale: .medium)) else { print("MISSING \(name)"); continue }
  let sz = img.size
  let W = Int((sz.width * scale).rounded(.up)), H = Int((sz.height * scale).rounded(.up))
  let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.clear(CGRect(x: 0, y: 0, width: W, height: H))
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
  img.draw(in: CGRect(x: 0, y: 0, width: CGFloat(W), height: CGFloat(H)), from: .zero, operation: .sourceOver, fraction: 1)
  NSGraphicsContext.restoreGraphicsState()
  let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(outDir)/\(name).png"))
  print("\(name) \(sz.width)x\(sz.height)pt → \(W)x\(H)px")
}
