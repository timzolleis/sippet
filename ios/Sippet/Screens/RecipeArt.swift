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

/// id → art. Dark: the same hues and layout at lower lightness.
///
/// Four roles with fixed lightness and chroma give it depth: deep, mid, light, and a glow from a neighbouring family.
/// A layout puts the roles on the grid (a diagonal sweep, a glow, a horizon, a corner light), mirrored by the seed.
nonisolated func recipeArt(id: String, dark: Bool) -> MeshArt {
    let hash = fnv1a(id)
    var random = SplitMix64(seed: hash)

    let family = ArtPalette.families[Int(random.next() % UInt64(ArtPalette.families.count))]
    let base = family + random.float(in: -12...12)
    let hues: [Float] = [
        base - random.float(in: 6...18),                                  // deep: a shade cooler
        base,                                                             // mid
        base + random.float(in: 10...24),                                 // light: a shade warmer
        base + (random.next() % 2 == 0 ? 1 : -1) * random.float(in: 45...80), // glow: a neighbour
    ]
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
    /// OKLCH hues that stay clean at every role: berry, coral, sage, teal, sky, indigo, plum.
    /// No apricot or yellow: their deep shades turn brown and olive.
    static let families: [Float] = [355, 22, 158, 192, 235, 272, 318]
    /// deep, mid, light, glow.
    static let light: [(l: Float, c: Float)] = [(0.50, 0.13), (0.68, 0.14), (0.90, 0.06), (0.80, 0.12)]
    static let dark: [(l: Float, c: Float)] = [(0.26, 0.08), (0.38, 0.11), (0.55, 0.08), (0.50, 0.12)]

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
