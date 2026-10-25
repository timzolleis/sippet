import SippetCore
import SwiftUI

/// Pieces shared by the recipe page and cook mode: calm, typographic, plain backgrounds, hairlines.

extension Font {
    /// Titles in the serif design, the rest of the Look is the system face.
    static func serif(_ style: Font.TextStyle, weight: Font.Weight = .semibold) -> Font {
        .system(style, design: .serif, weight: weight)
    }
}

/// A small rounded fact: duration, temperature, equipment.
struct Chip: View {
    let text: String
    var systemImage: String?
    var font: Font = .footnote
    var minHeight: CGFloat?

    var body: some View {
        HStack(spacing: 5) {
            if let systemImage { Image(systemName: systemImage).imageScale(.small) }
            Text(text)
        }
        .font(font.weight(.medium))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .frame(minHeight: minHeight)
        .background(Color(.secondarySystemFill), in: .capsule)
    }
}

/// Wraps its children onto lines.
struct Flow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(width: bounds.width, subviews: subviews)
        for (subview, point) in zip(subviews, result.points) {
            subview.place(at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y), proposal: .unspecified)
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (size: CGSize, points: [CGPoint]) {
        var points: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            points.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            maxX = max(maxX, x - spacing)
            rowHeight = max(rowHeight, size.height)
        }
        return (CGSize(width: maxX, height: y + rowHeight), points)
    }
}

// MARK: ingredient list

struct IngredientRowData: Identifiable, Hashable {
    let id: String
    let amount: String?
    let text: String
}

struct IngredientGroup: Identifiable {
    let title: String?
    let rows: [IngredientRowData]
    var id: String { title ?? "" }
}

/// Loose ingredients first, then each section in order.
func ingredientGroups(_ recipe: DeviceRecipe, units: MeasurementSystem) -> [IngredientGroup] {
    func rows(_ items: [Ingredient]) -> [IngredientRowData] {
        items.map {
            let parts = Format.ingredientParts($0, system: units)
            return IngredientRowData(id: $0.key, amount: parts.amount, text: parts.text)
        }
    }
    var groups: [IngredientGroup] = []
    let loose = recipe.ingredients.filter { $0.section == nil }
    if !loose.isEmpty { groups.append(IngredientGroup(title: nil, rows: rows(loose))) }
    for section in recipe.sections {
        let items = recipe.ingredients.filter { $0.section == section.key }
        if !items.isEmpty { groups.append(IngredientGroup(title: section.name, rows: rows(items))) }
    }
    return groups
}

private struct AmountWidthKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// Sections of rows with a bold amount column aligned across all of them; a tap checks a row off.
struct IngredientList: View {
    let groups: [IngredientGroup]
    @Binding var checked: Set<String>
    @State private var amountWidth: CGFloat = 0
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            ForEach(groups) { group in
                VStack(alignment: .leading, spacing: 0) {
                    if let title = group.title {
                        Text(title)
                            .font(.footnote.weight(.semibold))
                            .textCase(.uppercase)
                            .tracking(0.8)
                            .foregroundStyle(.secondary)
                            .padding(.bottom, 4)
                            .accessibilityAddTraits(.isHeader)
                    }
                    ForEach(Array(group.rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 { Divider() }
                        rowView(row)
                    }
                }
            }
        }
        .onPreferenceChange(AmountWidthKey.self) { amountWidth = $0 }
    }

    private func rowView(_ row: IngredientRowData) -> some View {
        let isChecked = checked.contains(row.id)
        let stacked = typeSize.isAccessibilitySize
        return Button {
            withAnimation(.easeOut(duration: 0.15)) {
                if isChecked { checked.remove(row.id) } else { checked.insert(row.id) }
            }
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 16) {
                if !stacked {
                    Text(row.amount ?? "")
                        .fontWeight(.bold)
                        .monospacedDigit()
                        .background {
                            Text(row.amount ?? "").fontWeight(.bold).monospacedDigit().fixedSize().hidden()
                                .background(GeometryReader { Color.clear.preference(key: AmountWidthKey.self, value: $0.size.width) })
                        }
                        .frame(width: amountWidth > 0 ? min(amountWidth, 120) : nil, alignment: .leading)
                }
                Text(stacked ? [row.amount, row.text].compactMap { $0 }.joined(separator: " ") : row.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "checkmark")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(.tint)
                    .opacity(isChecked ? 1 : 0)
            }
            .strikethrough(isChecked)
            .opacity(isChecked ? 0.4 : 1)
            .padding(.vertical, 12)
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isChecked ? .isSelected : [])
    }
}
