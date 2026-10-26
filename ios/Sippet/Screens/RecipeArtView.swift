import SwiftUI

/// Draws `recipeArt(id:dark:)`: the mesh, then fine grain. Fills its frame; decoration only.
struct RecipeArtView: View {
    let id: String
    @Environment(\.colorScheme) private var scheme
    @Environment(\.theme) private var theme

    var body: some View {
        let art = recipeArt(id: id, dark: scheme == .dark, theme: theme)
        MeshGradient(
            width: 3, height: 3, points: art.points,
            colors: art.colors.map { Color(.sRGB, red: Double($0.x), green: Double($0.y), blue: Double($0.z)) },
            smoothsColors: true)
            .overlay {
                Image(decorative: Grain.tile, scale: 3)
                    .resizable(resizingMode: .tile)
                    .blendMode(.overlay)
                    .opacity(scheme == .dark ? 0.22 : 0.3)
            }
            .accessibilityHidden(true)
    }
}

/// A fixed tile of grey noise, made once. Plain CoreGraphics: a Metal shader would need the Metal toolchain to build.
private enum Grain {
    static let tile: CGImage = {
        let side = 192
        var state: UInt64 = 0x5EED
        let pixels: [UInt8] = (0..<side * side).map { _ in
            state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return UInt8(truncatingIfNeeded: 128 + Int((state >> 33) % 96) - 48)
        }
        let provider = CGDataProvider(data: Data(pixels) as CFData)!
        return CGImage(
            width: side, height: side, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: side,
            space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
            provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
    }()
}

/// The header's aspect; a tile is a square from its middle, so a recipe looks the same in the list and on its page.
enum ArtGeometry {
    static let heroAspect: CGFloat = 1.3
}

/// A rounded square cut from the middle of the recipe's header art.
struct RecipeArtTile: View {
    let id: String
    var size: CGFloat
    var cornerRadius: CGFloat?

    var body: some View {
        let radius = cornerRadius ?? size * 0.26
        RecipeArtView(id: id)
            .frame(width: size * ArtGeometry.heroAspect, height: size)
            .frame(width: size, height: size)
            .clipShape(.rect(cornerRadius: radius))
            .overlay {
                RoundedRectangle(cornerRadius: radius)
                    .strokeBorder(.primary.opacity(0.06), lineWidth: 0.5)
            }
            .accessibilityHidden(true)
    }
}
