import SwiftUI

/// Draws `recipeArt(id:dark:)`: the mesh, finished by `RecipeArt.metal` (marbled flow, faint contour lines, film grain).
/// Fills its frame; decoration only.
///
/// The finished art is rendered once per recipe, scheme, and size into an image and kept: a shader on every tile
/// costs an offscreen pass per tile per frame, which drops frames while a list scrolls. An image costs nothing.
struct RecipeArtView: View {
    let id: String
    @Environment(\.colorScheme) private var scheme
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        GeometryReader { geo in
            if let image = ArtImages.image(id: id, dark: scheme == .dark, size: geo.size, scale: displayScale) {
                Image(decorative: image, scale: displayScale)
                    .resizable()
            }
        }
        .accessibilityHidden(true)
    }
}

/// The finished art as images, by recipe, scheme, and pixel size. Rendering one takes a few milliseconds, once.
@MainActor private enum ArtImages {
    static let cache: NSCache<NSString, CGImage> = {
        let cache = NSCache<NSString, CGImage>()
        cache.totalCostLimit = 64 << 20 // bytes
        return cache
    }()

    static func image(id: String, dark: Bool, size: CGSize, scale: CGFloat) -> CGImage? {
        let width = (size.width * scale).rounded(), height = (size.height * scale).rounded()
        guard width >= 1, height >= 1 else { return nil }
        let key = "\(id) \(dark) \(Int(width))×\(Int(height))" as NSString
        if let image = cache.object(forKey: key) { return image }
        let points = CGSize(width: width / scale, height: height / scale)
        let renderer = ImageRenderer(content: FinishedArt(art: recipeArt(id: id, dark: dark), dark: dark, size: points, scale: scale))
        renderer.scale = scale
        renderer.isOpaque = true
        guard let image = renderer.cgImage else { return nil }
        cache.setObject(image, forKey: key, cost: Int(width * height) * 4)
        return image
    }
}

/// The mesh through the shader, at a fixed size.
private struct FinishedArt: View {
    let art: MeshArt
    let dark: Bool
    let size: CGSize
    let scale: CGFloat

    var body: some View {
        let flow = size.height * ArtFinish.flow
        MeshGradient(
            width: 3, height: 3, points: art.points,
            colors: art.colors.map { Color(.sRGB, red: Double($0.x), green: Double($0.y), blue: Double($0.z)) },
            smoothsColors: true)
            .layerEffect(
                ShaderLibrary.recipeArt(
                    .float(art.seed), .float2(size), .float(scale), .float(ArtFinish.flow),
                    .float(dark ? ArtFinish.linesDark : ArtFinish.lines), .float(dark ? ArtFinish.grainDark : ArtFinish.grain)),
                maxSampleOffset: CGSize(width: flow, height: flow))
            .frame(width: size.width, height: size.height)
    }
}

/// The shader's strengths. Flow: how far the mesh is pulled, in fractions of the art's height.
private enum ArtFinish {
    static let flow: CGFloat = 0.24
    static let lines: Float = 0.22
    static let linesDark: Float = 0.26
    static let grain: Float = 0.085
    static let grainDark: Float = 0.07
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
