import SwiftUI

/// A collection or smart collection as All recipes shows it above the recipes.
struct Folder: Identifiable {
    let item: SidebarItem
    let name: String
    let recipeIds: [String]
    /// A smart collection's symbol; nil for a collection.
    let smartSymbol: String?
    var id: SidebarItem { item }
}

/// Folder tiles in a grid: the folder with its first recipes' art peeking out and its count, the name below.
/// A tile pushes its list, zooming out of the folder; a collection's tile has Rename… and Delete.
struct FolderGrid: View {
    let folders: [Folder]
    @ScaledMetric(relativeTo: .subheadline) private var minimum: CGFloat = 96
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.open) private var open

    var body: some View {
        // At accessibility sizes: one column, a small folder above its name, so the name has the full width and
        // long German compounds ("Sonntagsessen") don't break inside the word.
        let large = typeSize.isAccessibilitySize
        let columns = large
            ? [GridItem(.flexible(), alignment: .leading)]
            : [GridItem(.adaptive(minimum: min(minimum, 150)), spacing: 14, alignment: .top)]
        let tile = AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
        LazyVGrid(columns: columns, spacing: 18) {
            ForEach(folders) { folder in
                Button { open(.list(folder.item)) } label: {
                    tile {
                        FolderGlyph(folder: folder)
                            .frame(maxWidth: large ? 96 : nil)
                            .modifier(ZoomSource(id: LibraryRoute.folderZoom(folder.item)))
                        Text(folder.name)
                            .font(.rounded(.subheadline))
                            .foregroundStyle(.primary)
                            .lineLimit(large ? nil : 2)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel(Text(verbatim: folder.name))
                .accessibilityValue(folder.smartSymbol == nil
                    ? Text("\(folder.recipeIds.count) recipes")
                    : Text("Smart collection, \(folder.recipeIds.count) recipes"))
                .modifier(FolderMenu(folder: folder))
            }
        }
    }
}

/// Rename… and Delete on a collection's tile; a smart collection has none (ios.md: no smart-collection editing).
private struct FolderMenu: ViewModifier {
    let folder: Folder

    func body(content: Content) -> some View {
        if case .collection(let name) = folder.item {
            content.organizeMenu(.collection, name) {
                VStack(alignment: .leading, spacing: 8) {
                    FolderGlyph(folder: folder).frame(width: 180)
                    Text(folder.name).font(.rounded(.subheadline)).lineLimit(2)
                }
                .frame(width: 180)
                .padding(14)
            }
        } else {
            content
        }
    }
}

/// Back panel with a tab, up to three recipe cards, the front panel with the count.
private struct FolderGlyph: View {
    let folder: Folder
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack(alignment: .topLeading) {
                FolderBack(tabWidth: 0.42, tabHeight: 0.1)
                    .fill(back)
                ForEach(Array(cards.enumerated()), id: \.element) { i, id in
                    let spread = CGFloat(i) - CGFloat(cards.count - 1) / 2
                    RecipeArtView(id: id)
                        .frame(width: w * 0.6, height: h * 0.6)
                        .clipShape(.rect(cornerRadius: w * 0.06))
                        .shadow(color: .black.opacity(0.12), radius: 2, y: 1)
                        .rotationEffect(.degrees(Double(spread) * 7))
                        .offset(x: w * 0.2 + spread * w * 0.14, y: h * 0.07 + abs(spread) * h * 0.05)
                }
                front
                    .frame(width: w, height: h * 0.58)
                    .offset(y: h * 0.42)
            }
            .animation(.snappy, value: cards)
        }
        .aspectRatio(1.3, contentMode: .fit)
        .accessibilityHidden(true)
    }

    private var cards: [String] { Array(folder.recipeIds.prefix(3)) }

    private var front: some View {
        RoundedRectangle(cornerRadius: 12)
            .fill(frontFill)
            .overlay {
                // A light top edge, like a folder's fold.
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(LinearGradient(colors: [.white.opacity(scheme == .dark ? 0.18 : 0.7), .clear], startPoint: .top, endPoint: .center), lineWidth: 1)
            }
            .overlay(alignment: .bottomLeading) {
                Text(folder.recipeIds.count, format: .number)
                    .font(.rounded(.title3, weight: .bold))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .animation(.snappy, value: folder.recipeIds.count)
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge) // drawn on the folder, which doesn't grow
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 10)
                    .padding(.bottom, 6)
            }
            .overlay(alignment: .bottomTrailing) {
                if let symbol = folder.smartSymbol {
                    Image(systemName: symbol)
                        .font(.footnote.weight(.semibold))
                        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                        .foregroundStyle(.tint)
                        .padding(10)
                }
            }
            .shadow(color: .black.opacity(scheme == .dark ? 0.3 : 0.08), radius: 3, y: -1)
    }

    /// Neutral greys: the recipes' art brings the colour.
    private var back: Color { Color(.systemGray4) }
    private var frontFill: Color { scheme == .dark ? Color(.systemGray5) : Color(.systemGray6) }
}

/// A rounded panel with a tab on its top-left edge.
nonisolated private struct FolderBack: Shape {
    var tabWidth: CGFloat
    var tabHeight: CGFloat

    func path(in rect: CGRect) -> Path {
        let r: CGFloat = min(12, rect.width * 0.1)
        let tabW = rect.width * tabWidth, tabH = rect.height * tabHeight
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.minY + r))
        p.addQuadCurve(to: CGPoint(x: rect.minX + r, y: rect.minY), control: CGPoint(x: rect.minX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.minX + tabW - tabH, y: rect.minY))
        p.addCurve(
            to: CGPoint(x: rect.minX + tabW + tabH * 0.4, y: rect.minY + tabH),
            control1: CGPoint(x: rect.minX + tabW - tabH * 0.2, y: rect.minY),
            control2: CGPoint(x: rect.minX + tabW, y: rect.minY + tabH))
        p.addLine(to: CGPoint(x: rect.maxX - r, y: rect.minY + tabH))
        p.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY + tabH + r), control: CGPoint(x: rect.maxX, y: rect.minY + tabH))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
        p.addQuadCurve(to: CGPoint(x: rect.maxX - r, y: rect.maxY), control: CGPoint(x: rect.maxX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
        p.addQuadCurve(to: CGPoint(x: rect.minX, y: rect.maxY - r), control: CGPoint(x: rect.minX, y: rect.maxY))
        p.closeSubpath()
        return p
    }
}

/// Shrinks a little while pressed.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.snappy(duration: 0.2), value: configuration.isPressed)
    }
}
