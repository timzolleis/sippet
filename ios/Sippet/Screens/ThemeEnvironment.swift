import SwiftUI
import UIKit

/// The cook's colour, kept in Settings: its hue is the accent and the centre of the recipes' art.
extension Theme {
    static let hueKey = "themeHue"
    static let rangeKey = "themeRange"

    /// The accent for light and dark, resolved by the trait collection like an asset colour.
    var accent: Color {
        let theme = self
        return Color(uiColor: UIColor { traits in
            let rgb = themeAccent(theme, dark: traits.userInterfaceStyle == .dark)
            return UIColor(red: CGFloat(rgb.x), green: CGFloat(rgb.y), blue: CGFloat(rgb.z), alpha: 1)
        })
    }

    struct Preset: Identifiable {
        let name: LocalizedStringKey
        let hue: Float
        var id: Float { hue }
    }

    static let presets: [Preset] = [
        Preset(name: "Paprika", hue: 42),
        Preset(name: "Berry", hue: 355),
        Preset(name: "Plum", hue: 318),
        Preset(name: "Indigo", hue: 272),
        Preset(name: "Sky", hue: 235),
        Preset(name: "Lagoon", hue: 200),
        Preset(name: "Sage", hue: 158),
    ]

    /// The art's band: the theme's neighbours, or every hue.
    enum ArtRange: Float, CaseIterable, Identifiable {
        case matching = 140
        case all = 360
        var id: Float { rawValue }
        var title: LocalizedStringKey { self == .matching ? "Matching colours" : "All colours" }
    }
}

extension EnvironmentValues {
    @Entry var theme: Theme = .standard
}

/// At the root: the stored theme as `\.theme` and as the tint.
struct Themed: ViewModifier {
    @AppStorage(Theme.hueKey) private var hue = Double(Theme.standard.hue)
    @AppStorage(Theme.rangeKey) private var range = Double(Theme.standard.range)

    func body(content: Content) -> some View {
        let theme = Theme(hue: Float(hue), range: Float(range))
        content
            .environment(\.theme, theme)
            .tint(theme.accent)
    }
}
