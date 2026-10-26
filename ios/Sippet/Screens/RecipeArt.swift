import Foundation
import simd

/// A recipe's generated header art: a 3×3 mesh in one hue family, the same for the same id on every launch and device.
/// Pure: no SwiftUI, no randomness beyond the id. `RecipeArtView` draws it.
nonisolated struct MeshArt: Equatable, Sendable {
    /// 9 control points, row by row, in the unit square; corners fixed, edges and centre jittered.
    var points: [SIMD2<Float>]
    /// 9 gamma-encoded sRGB colours, one per point.
    var colors: [SIMD3<Float>]
    /// Seeds the finish (`RecipeArt.metal`); a whole number below 2^20, exact as a Float.
    var seed: Float
}

/// The seed of every colour in the app: the accent's hue, and the band of hues the art takes around it.
nonisolated struct Theme: Equatable, Sendable {
    /// OKLCH hue, 0..<360.
    var hue: Float
    /// Width of the art's hue band around `hue`; 360 is the whole wheel.
    var range: Float

    static let standard = Theme(hue: 42, range: 360)
}

/// The accent: the theme's hue at a lightness that reads as text on the background (≈ 6:1 light, ≈ 8:1 dark).
nonisolated func themeAccent(_ theme: Theme, dark: Bool) -> SIMD3<Float> {
    srgb(OKLCH(l: dark ? 0.72 : 0.50, c: 0.15, h: cleanHue(theme.hue)))
}

/// id → art. Dark: the same hues and layout at lower lightness.
///
/// The theme gives seven hue families, evenly over its band. Four roles with fixed lightness and chroma give it depth: deep, mid, light, and a glow from a neighbouring family.
/// A layout puts the roles on the grid (a diagonal sweep, a glow, a horizon, a corner light), mirrored by the seed.
nonisolated func recipeArt(id: String, dark: Bool, theme: Theme = .standard) -> MeshArt {
    let hash = fnv1a(id)
    var random = SplitMix64(seed: hash)

    let families = ArtPalette.families(theme)
    let family = families[Int(random.next() % UInt64(families.count))]
    let base = family + random.float(in: -12...12) * min(1, theme.range / 180)
    let hues: [Float] = [
        base - random.float(in: 6...18),                                  // deep: a shade cooler
        base,                                                             // mid
        base + random.float(in: 10...24),                                 // light: a shade warmer
        base + (random.next() % 2 == 0 ? 1 : -1) * random.float(in: 45...80), // glow: a neighbour
    ].map(cleanHue)
    let roles = dark ? ArtPalette.dark : ArtPalette.light
    let palette = zip(hues, roles).map { hue, role in srgb(OKLCH(l: role.l, c: role.c, h: hue)) }

    var layout = ArtPalette.layouts[Int(random.next() % UInt64(ArtPalette.layouts.count))]
    if random.next() % 2 == 0 { layout = layout.mirroredHorizontally }
    if random.next() % 2 == 0 { layout = layout.mirroredVertically }

    let j: Float = 0.22
    let points: [SIMD2<Float>] = [
        [0, 0], [0.5 + random.float(in: -j...j), 0], [1, 0],
        [0, 0.5 + random.float(in: -j...j)],
        [0.5 + random.float(in: -j...j), 0.5 + random.float(in: -j...j)],
        [1, 0.5 + random.float(in: -j...j)],
        [0, 1], [0.5 + random.float(in: -j...j), 1], [1, 1],
    ]
    return MeshArt(points: points, colors: layout.roles.map { palette[$0] }, seed: Float(hash >> 44))
}

// MARK: palette

nonisolated private enum ArtPalette {
    /// Seven hues evenly over the theme's band, measured on the clean wheel (the hue wheel without the yellow zone).
    /// The whole wheel starts at the theme's hue; a band is centred on it and slides to stay off the yellow zone.
    static func families(_ theme: Theme) -> [Float] {
        let count = 7
        let length = CleanWheel.length
        let centre = CleanWheel.position(of: theme.hue)
        let range = min(max(theme.range, 0), 360)
        if range >= 360 {
            return (0..<count).map { CleanWheel.hue(at: (centre + Float($0) * length / Float(count)).truncatingRemainder(dividingBy: length)) }
        }
        let width = min(range, length)
        let start = min(max(centre - width / 2, 0), length - width)
        return (0..<count).map { CleanWheel.hue(at: start + Float($0) * width / Float(count - 1)) }
    }
    /// deep, mid, light, glow.
    static let light: [(l: Float, c: Float)] = [(0.50, 0.13), (0.68, 0.14), (0.90, 0.06), (0.80, 0.12)]
    static let dark: [(l: Float, c: Float)] = [(0.30, 0.09), (0.42, 0.12), (0.58, 0.09), (0.52, 0.13)]

    /// Role per point, row by row: 0 deep, 1 mid, 2 light, 3 glow.
    static let layouts: [Layout] = [
        Layout(roles: [0, 1, 2,  1, 1, 2,  3, 2, 2]),   // diagonal sweep
        Layout(roles: [1, 1, 0,  2, 3, 1,  2, 2, 1]),   // glow off centre
        Layout(roles: [2, 2, 3,  1, 1, 2,  0, 0, 1]),   // horizon
        Layout(roles: [3, 2, 1,  2, 1, 0,  1, 0, 0]),   // corner light
    ]

    struct Layout {
        var roles: [Int]
        var mirroredHorizontally: Layout {
            Layout(roles: stride(from: 0, to: 9, by: 3).flatMap { roles[$0..<$0 + 3].reversed() })
        }
        var mirroredVertically: Layout {
            Layout(roles: [6, 3, 0].flatMap { roles[$0..<$0 + 3] })
        }
    }
}

/// Deep yellows turn olive and brown: a hue in that zone moves to its nearer edge (amber or green).
nonisolated private func cleanHue(_ hue: Float) -> Float {
    let h = CleanWheel.normalized(hue)
    let zone = CleanWheel.yellow
    guard zone.contains(h) else { return h }
    return h - zone.lowerBound < zone.upperBound - h ? zone.lowerBound : zone.upperBound
}

/// The hue wheel with the yellow zone cut out: position 0 is green at the zone's end, running through blue, purple,
/// red to amber at the zone's start.
nonisolated private enum CleanWheel {
    static let yellow: ClosedRange<Float> = 70...135
    static var length: Float { 360 - (yellow.upperBound - yellow.lowerBound) }

    static func normalized(_ hue: Float) -> Float {
        (hue.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
    }

    static func position(of hue: Float) -> Float {
        min(normalized(cleanHue(hue) - yellow.upperBound), length)
    }

    static func hue(at position: Float) -> Float {
        normalized(yellow.upperBound + position)
    }
}

// MARK: hashing

/// FNV-1a over the id's UTF-8: stable across launches, unlike `hashValue`.
nonisolated private func fnv1a(_ text: String) -> UInt64 {
    var hash: UInt64 = 0xcbf2_9ce4_8422_2325
    for byte in text.utf8 {
        hash ^= UInt64(byte)
        hash &*= 0x0000_0100_0000_01b3
    }
    return hash
}

nonisolated private struct SplitMix64 {
    var state: UInt64
    init(seed: UInt64) { state = seed }

    mutating func next() -> UInt64 {
        state &+= 0x9e37_79b9_7f4a_7c15
        var z = state
        z = (z ^ (z >> 30)) &* 0xbf58_476d_1ce4_e5b9
        z = (z ^ (z >> 27)) &* 0x94d0_49bb_1331_11eb
        return z ^ (z >> 31)
    }

    mutating func float(in range: ClosedRange<Float>) -> Float {
        let unit = Float(next() >> 40) / Float(1 << 24)
        return range.lowerBound + unit * (range.upperBound - range.lowerBound)
    }
}

// MARK: colour

nonisolated private struct OKLCH { var l, c, h: Float }

/// OKLCH → gamma-encoded sRGB. Out of gamut: chroma comes down until it fits, so hue and lightness stay.
nonisolated private func srgb(_ color: OKLCH) -> SIMD3<Float> {
    func linear(_ c: Float) -> SIMD3<Float> {
        let rad = color.h * .pi / 180
        let a = c * cos(rad), b = c * sin(rad)
        let l_ = color.l + 0.3963377774 * a + 0.2158037573 * b
        let m_ = color.l - 0.1055613458 * a - 0.0638541728 * b
        let s_ = color.l - 0.0894841775 * a - 1.2914855480 * b
        let l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_
        return [
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
        ]
    }
    func inGamut(_ v: SIMD3<Float>) -> Bool { v.min() >= 0 && v.max() <= 1 }

    var rgb = linear(color.c)
    if !inGamut(rgb) {
        var low: Float = 0, high = color.c
        for _ in 0..<16 {
            let mid = (low + high) / 2
            if inGamut(linear(mid)) { low = mid } else { high = mid }
        }
        rgb = linear(low)
    }
    func encode(_ x: Float) -> Float {
        let x = min(max(x, 0), 1)
        return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1 / 2.4) - 0.055
    }
    return [encode(rgb.x), encode(rgb.y), encode(rgb.z)]
}
