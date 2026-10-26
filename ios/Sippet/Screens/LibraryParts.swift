import SippetCore
import SwiftUI

// MARK: navigation

/// A column's root: the sidebar's choice.
enum SidebarItem: Hashable {
    case all, collection(String), smart(String), tag(String), trash

    /// Stable text for zoom ids.
    var key: String {
        switch self {
        case .all: "all"
        case .collection(let name): "collection:\(name)"
        case .smart(let name): "smart:\(name)"
        case .tag(let name): "tag:\(name)"
        case .trash: "trash"
        }
    }
}

/// What the detail stack pushes. `zoom` names the tile it grows out of; nil is a plain push.
enum LibraryRoute: Hashable {
    case recipe(String, zoom: String?)
    case list(SidebarItem)

    /// A folder tile's zoom id.
    static func folderZoom(_ item: SidebarItem) -> String { "folder/\(item.key)" }
}

extension EnvironmentValues {
    /// The namespace the library's zoom transitions match in; nil outside LibraryScreen.
    @Entry var zoomNamespace: Namespace.ID?
    @Entry var organize = OrganizeActions()
    /// Pushes onto the library's stack. Rows and tiles use it instead of NavigationLink, which a List draws with a chevron.
    @Entry var open: (LibraryRoute) -> Void = { _ in }
}

/// Marks the view a zoom transition grows out of, clipped like the tile.
struct ZoomSource: ViewModifier {
    let id: String
    var cornerRadius: CGFloat = 12
    @Environment(\.zoomNamespace) private var namespace

    func body(content: Content) -> some View {
        if let namespace {
            content.matchedTransitionSource(id: id, in: namespace) { $0.clipShape(.rect(cornerRadius: cornerRadius)) }
        } else {
            content
        }
    }
}

// MARK: rename and delete

/// A tag or collection the cook renames or deletes.
struct OrganizeTarget: Identifiable, Hashable {
    enum Kind { case tag, collection }
    let kind: Kind
    let name: String
    var id: String { "\(kind)-\(name)" }
    var item: SidebarItem { kind == .tag ? .tag(name) : .collection(name) }
}

/// LibraryScreen's prompts, reachable from the sidebar, the chips, and the folder tiles.
struct OrganizeActions {
    var rename: (OrganizeTarget) -> Void = { _ in }
    var delete: (OrganizeTarget) -> Void = { _ in }
}

/// Rename… and Delete as a context menu and as VoiceOver actions (library 6, 8, 12).
/// `preview` is for views inside a List row (a folder tile, a chip): without it the menu lifts the whole row.
struct OrganizeMenu<Preview: View>: ViewModifier {
    let target: OrganizeTarget
    let preview: Preview?
    @Environment(\.organize) private var organize

    func body(content: Content) -> some View {
        Group {
            if let preview {
                content.contextMenu { items } preview: { preview }
            } else {
                content.contextMenu { items }
            }
        }
        .accessibilityAction(named: "Rename…") { organize.rename(target) }
        .accessibilityAction(named: "Delete") { organize.delete(target) }
    }

    @ViewBuilder private var items: some View {
        Button("Rename…", systemImage: "pencil") { organize.rename(target) }
        Button("Delete", systemImage: "trash", role: .destructive) { organize.delete(target) }
    }
}

extension View {
    func organizeMenu(_ kind: OrganizeTarget.Kind, _ name: String) -> some View {
        modifier(OrganizeMenu<EmptyView>(target: OrganizeTarget(kind: kind, name: name), preview: nil))
    }

    func organizeMenu(_ kind: OrganizeTarget.Kind, _ name: String, @ViewBuilder preview: () -> some View) -> some View {
        modifier(OrganizeMenu(target: OrganizeTarget(kind: kind, name: name), preview: preview()))
    }
}

// MARK: tag colours

/// A tag's colour: one of the recipe art's hue families (RecipeArt.swift), picked by the name, so a tag looks the
/// same everywhere. Fill and ink are OKLCH tones of the family: ink on fill and white on ink stay above 5:1.
struct TagColor {
    let fill: Color
    let ink: Color

    init(_ name: String) {
        let family = Self.families[Int(Self.hash(name.lowercased()) % UInt64(Self.families.count))]
        fill = Color(light: family.lightFill, dark: family.darkFill)
        ink = Color(light: family.lightInk, dark: family.darkInk)
    }

    /// berry, coral, sage, teal, sky, indigo, plum. Light fill L .93, ink L .48; dark fill L .30, ink L .80.
    private static let families: [(lightFill: UInt32, lightInk: UInt32, darkFill: UInt32, darkInk: UInt32)] = [
        (0xFFDDE9, 0x933861, 0x45202F, 0xF6A0C1),
        (0xFFDFDD, 0x99393B, 0x472020, 0xFDA19E),
        (0xD0F2DD, 0x007044, 0x0C3722, 0x7DD3A3),
        (0xC6F2EF, 0x006C6A, 0x003634, 0x58D4D0),
        (0xCFEDFF, 0x00658E, 0x043247, 0x71C9FA),
        (0xE0E7FF, 0x4555A6, 0x232B4C, 0xA7BAFF),
        (0xF5DFFC, 0x7B428C, 0x3A2341, 0xDCA7EC),
    ]

    /// FNV-1a: stable across launches, unlike `hashValue`.
    private static func hash(_ text: String) -> UInt64 {
        text.utf8.reduce(0xcbf2_9ce4_8422_2325) { ($0 ^ UInt64($1)) &* 0x0000_0100_0000_01b3 }
    }
}

extension Color {
    init(light: UInt32, dark: UInt32) {
        func ui(_ hex: UInt32) -> UIColor {
            UIColor(red: CGFloat(hex >> 16 & 0xFF) / 255, green: CGFloat(hex >> 8 & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
        }
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? ui(dark) : ui(light) })
    }
}

/// A tag as a tinted capsule with its count; filled when it's the open list.
struct TagChip: View {
    let name: String
    var count: Int?
    var selected = false

    var body: some View {
        let color = TagColor(name)
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(name)
                .fontWeight(.medium)
                .multilineTextAlignment(.leading)
            if let count {
                Text(count, format: .number)
                    .monospacedDigit()
                    .opacity(0.7)
            }
        }
        .font(.subheadline)
        .foregroundStyle(selected ? AnyShapeStyle(Color(.systemBackground)) : AnyShapeStyle(color.ink))
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(selected ? color.ink : color.fill, in: .capsule)
        .contentShape(.capsule)
    }
}

// MARK: sidebar glyphs

/// A collection in the sidebar: its first four recipes' art as a mosaic; a quiet folder when it's empty.
struct CollectionThumb: View {
    let recipeIds: [String]
    @ScaledMetric(relativeTo: .body) private var size: CGFloat = 30

    var body: some View {
        let side = min(size, 44)
        let ids = Array(recipeIds.prefix(4))
        Group {
            if ids.isEmpty {
                Image(systemName: "folder")
                    .font(.system(size: side * 0.45, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(width: side, height: side)
                    .background(Color(.tertiarySystemFill))
            } else {
                mosaic(ids, side: side)
            }
        }
        .clipShape(.rect(cornerRadius: side * 0.26))
        .overlay { RoundedRectangle(cornerRadius: side * 0.26).strokeBorder(.primary.opacity(0.06), lineWidth: 0.5) }
        .accessibilityHidden(true)
    }

    /// 1: whole; 2: halves; 3: one half, two quarters; 4: quarters.
    @ViewBuilder private func mosaic(_ ids: [String], side: CGFloat) -> some View {
        let gap: CGFloat = 1
        let half = (side - gap) / 2
        switch ids.count {
        case 1:
            RecipeArtView(id: ids[0]).frame(width: side, height: side)
        case 2:
            HStack(spacing: gap) {
                ForEach(ids, id: \.self) { RecipeArtView(id: $0).frame(width: half, height: side) }
            }
        case 3:
            HStack(spacing: gap) {
                RecipeArtView(id: ids[0]).frame(width: half, height: side)
                VStack(spacing: gap) {
                    ForEach(ids.dropFirst(), id: \.self) { RecipeArtView(id: $0).frame(width: half, height: half) }
                }
            }
        default:
            Grid(horizontalSpacing: gap, verticalSpacing: gap) {
                GridRow { ForEach(ids.prefix(2), id: \.self) { RecipeArtView(id: $0).frame(width: half, height: half) } }
                GridRow { ForEach(ids.suffix(2), id: \.self) { RecipeArtView(id: $0).frame(width: half, height: half) } }
            }
        }
    }
}

/// A smart collection's symbol, from what its filter asks most visibly.
func smartSymbol(_ filter: RecipeFilter) -> String {
    if filter.maxTotalMinutes != nil { return "timer" }
    if filter.tags != nil { return "tag" }
    if filter.items?.isEmpty == false { return "carrot" }
    if filter.hasFlow != nil { return "point.3.connected.trianglepath.dotted" }
    if filter.text?.isEmpty == false { return "text.magnifyingglass" }
    return "sparkles"
}

/// "up to 30 min · vegan · not süß": the filter in a line, for the list's subtitle (library 13).
func filterSummary(_ filter: RecipeFilter) -> String {
    var parts: [String] = []
    if let minutes = filter.maxTotalMinutes { parts.append(String(localized: "up to \(Format.minutes(minutes))")) }
    if let tags = filter.tags {
        if let all = tags.all, !all.isEmpty { parts.append(all.joined(separator: " + ")) }
        if let any = tags.any, !any.isEmpty { parts.append(any.joined(separator: " / ")) }
        if let none = tags.none, !none.isEmpty { parts.append(String(localized: "not \(none.joined(separator: ", "))")) }
    }
    if let items = filter.items, !items.isEmpty { parts.append(String(localized: "with \(items.joined(separator: ", "))")) }
    if let flow = filter.hasFlow { parts.append(flow ? String(localized: "with a flow") : String(localized: "without a flow")) }
    if let text = filter.text, !text.isEmpty { parts.append("“\(text)”") }
    return parts.joined(separator: " · ")
}

/// A smart collection in the sidebar: its symbol on a tinted square, the same size as a collection's mosaic.
struct SmartThumb: View {
    let symbol: String
    @ScaledMetric(relativeTo: .body) private var size: CGFloat = 30

    var body: some View {
        let side = min(size, 44)
        Image(systemName: symbol)
            .font(.system(size: side * 0.46, weight: .semibold))
            .foregroundStyle(.tint)
            .frame(width: side, height: side)
            .background(.tint.opacity(0.14), in: .rect(cornerRadius: side * 0.26))
            .accessibilityHidden(true)
    }
}
