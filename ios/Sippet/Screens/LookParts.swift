import SippetCore
import SwiftUI

/// Shared by the recipe page and cook mode: plain backgrounds, SF Rounded, one accent.

extension Font {
    /// Titles and headings; the screens set `.fontDesign(.rounded)` for the rest.
    static func rounded(_ style: Font.TextStyle, weight: Font.Weight = .semibold) -> Font {
        .system(style, design: .rounded, weight: weight)
    }
}

/// An SF Symbol on a soft accent disc: headings, the header's facts.
struct IconBadge: View {
    let systemName: String
    @ScaledMetric(relativeTo: .body) private var size: CGFloat = 30

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: size * 0.46, weight: .semibold))
            .foregroundStyle(.tint)
            .frame(width: size, height: size)
            .background(.tint.opacity(0.13), in: .circle)
            .accessibilityHidden(true)
    }
}

/// "Zutaten" with its symbol on a disc.
struct SectionHeading: View {
    let title: LocalizedStringKey
    let systemName: String

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            IconBadge(systemName: systemName)
            Text(title)
                .font(.rounded(.title2, weight: .bold))
                .accessibilityAddTraits(.isHeader)
        }
    }
}

/// A small caps label: section names, "Schritt 3 von 11".
struct Eyebrow: View {
    let text: Text
    init(_ text: Text) { self.text = text }
    init(verbatim: String) { text = Text(verbatim: verbatim) }

    var body: some View {
        text
            .font(.footnote.weight(.semibold))
            .textCase(.uppercase)
            .tracking(0.9)
            .foregroundStyle(.secondary)
    }
}

/// "¼ TL (2 g)": the amount bold, the second amount in parentheses regular and quiet.
func amountLabel(_ amount: String, weight: Font.Weight = .bold) -> Text {
    let keep = { (s: Substring) in s.replacingOccurrences(of: " ", with: "\u{00A0}") }
    if let open = amount.range(of: " (") {
        let main = keep(amount[..<open.lowerBound])
        let second = " " + keep(amount[amount.index(after: open.lowerBound)...])
        return Text("\(Text(main).fontWeight(weight))\(Text(second).foregroundStyle(.secondary))")
    }
    return Text(keep(amount[...])).fontWeight(weight)
}

/// "Zitronensaft, auspressen – optional": the item in full colour, prep, note, and optional quiet.
func ingredientText(_ ingredient: Ingredient) -> Text {
    var detail = ""
    if let prep = ingredient.prep, !prep.isEmpty { detail += ", " + prep }
    if let note = ingredient.note, !note.isEmpty { detail += " (" + note + ")" }
    if ingredient.optional == true { detail += ", " + String(localized: "optional") }
    return detail.isEmpty ? Text(ingredient.item) : Text("\(Text(ingredient.item))\(Text(detail).foregroundStyle(.secondary))")
}

/// "800 g" over a smaller "2 Becher": keeps the amount column narrow where the type is large (cook mode).
struct StackedAmount: View {
    let amount: String

    var body: some View {
        if let open = amount.range(of: " ("), amount.hasSuffix(")") {
            VStack(alignment: .leading, spacing: 0) {
                amountLabel(String(amount[..<open.lowerBound]))
                Text(amount[open.upperBound..<amount.index(before: amount.endIndex)])
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
        } else {
            amountLabel(amount)
        }
    }
}

/// Wraps its children onto lines. Measuring and placing arrange the same way, so the height it reports is the height
/// it draws: a parent may place it at exactly the width it measured (or a hair less, pixel-rounded), and a line that
/// fit when measured still fits.
struct Flow: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 8

    /// Half a point: float sums and pixel rounding never push the last child of a line onto the next one.
    private static let tolerance: CGFloat = 0.5

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(width: bounds.width, subviews: subviews)
        for (subview, frame) in zip(subviews, result.frames) {
            subview.place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                proposal: ProposedViewSize(frame.size))
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        var frames: [CGRect] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for subview in subviews {
            var size = subview.sizeThatFits(.unspecified)
            if size.width > width + Self.tolerance { size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil)) }
            if x > 0, x + size.width > width + Self.tolerance {
                x = 0
                y += rowHeight + lineSpacing
                rowHeight = 0
            }
            frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
            maxX = max(maxX, x + size.width)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return (CGSize(width: maxX, height: y + rowHeight), frames)
    }
}

/// Duration, temperature, equipment: an SF Symbol and quiet text, no fill.
struct Fact: Identifiable, Hashable {
    let text: String
    let icon: String
    var id: String { icon + text }
}

func stepFacts(_ step: Step, in recipe: DeviceRecipe, units: MeasurementSystem, duration: Bool = true) -> [Fact] {
    var facts: [Fact] = []
    if duration, let d = step.duration { facts.append(Fact(text: Format.duration(d), icon: "clock")) }
    if let t = step.temperature { facts.append(Fact(text: Format.temperature(t, system: units), icon: "thermometer.medium")) }
    for key in step.equipment ?? [] {
        if let name = recipe.equipment.first(where: { $0.key == key })?.name { facts.append(Fact(text: name, icon: equipmentIcon(name))) }
    }
    return facts
}

/// The oven gets its own symbol; any other tool is a pan.
private func equipmentIcon(_ name: String) -> String {
    let lower = name.lowercased()
    return lower.contains("ofen") || lower.contains("oven") ? "oven" : "frying.pan"
}

/// Small chips: the symbol in the accent, quiet text, a soft fill.
struct FactRow: View {
    let facts: [Fact]
    var spacing: CGFloat = 8

    var body: some View {
        Flow(spacing: spacing, lineSpacing: spacing) {
            ForEach(facts) { fact in
                FactChip(fact: fact)
            }
        }
    }
}

struct FactChip: View {
    let fact: Fact

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: fact.icon).imageScale(.small).foregroundStyle(.tint)
            Text(fact.text).foregroundStyle(.secondary)
        }
        .fontWeight(.medium)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        // A capsule on one line; at accessibility sizes a chip may wrap, and stays a soft rectangle.
        .background(.fill.tertiary, in: .rect(cornerRadius: 16))
        .accessibilityElement(children: .combine)
    }
}

/// What a step takes from earlier steps, with amounts: "500 g Boden", "Masse". In a chain, a result without a name is
/// just "what you made before", so it isn't listed. Where several things come together (a merge), each is named: an
/// unnamed result by what its step took ("Boden"), else by the step's label.
func takenParts(_ step: Step, in recipe: DeviceRecipe, units: MeasurementSystem) -> [(name: String, amount: String?)] {
    let keys = step.flow?.takes ?? step.takes ?? []
    return keys.compactMap { key in
        for other in recipe.steps {
            if other.key == key {
                if let name = other.result?.name {
                    return (name, other.result?.amount.map { Format.amount($0, system: units) })
                }
                return keys.count > 1 ? (carriedName(other, in: recipe) ?? other.label, nil) : nil
            }
            if let portion = other.result?.split?.first(where: { $0.key == key }) {
                return (portion.name, portion.amount.map { Format.amount($0, system: units) })
            }
        }
        return nil
    }
}

/// The name an unnamed result carries on from what its step took: `boden` takes the portion "Boden".
private func carriedName(_ step: Step, in recipe: DeviceRecipe, depth: Int = 0) -> String? {
    if let name = step.result?.name { return name }
    guard depth < 8 else { return nil }
    for key in step.flow?.takes ?? step.takes ?? [] {
        for other in recipe.steps {
            if other.key == key, let name = carriedName(other, in: recipe, depth: depth + 1) { return name }
            if let portion = other.result?.split?.first(where: { $0.key == key }) { return portion.name }
        }
    }
    return nil
}

/// The step's text: its sentence, or its label. Never the generated "label (A, B)": the ingredients sit next to it.
func stepText(_ step: Step) -> String { step.sentence ?? step.label }

// MARK: ingredient list

struct IngredientRowData: Identifiable {
    let id: String
    let amount: String?
    let text: Text
}

struct IngredientGroup: Identifiable {
    let title: String?
    let rows: [IngredientRowData]
    var id: String { title ?? "" }
}

/// Loose ingredients first, then each section in order.
func ingredientGroups(_ recipe: DeviceRecipe, units: MeasurementSystem) -> [IngredientGroup] {
    func rows(_ items: [Ingredient]) -> [IngredientRowData] {
        items.map { IngredientRowData(id: $0.key, amount: $0.amount.map { a in Format.amount(a, system: units) }, text: ingredientText($0)) }
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

struct AmountWidthKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// Sections of rows, the bold amount column aligned across all of them, hairlines between rows.
/// A tap fills the row's circle and strikes it through (cooking 3). At accessibility sizes the amount sits above the item.
struct IngredientList: View {
    let groups: [IngredientGroup]
    @Binding var checked: Set<String>
    @State private var amountWidth: CGFloat = 0
    @ScaledMetric(relativeTo: .body) private var checkWidth: CGFloat = 22

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            ForEach(groups) { group in
                VStack(alignment: .leading, spacing: 0) {
                    if let title = group.title {
                        Eyebrow(verbatim: title)
                            .padding(.bottom, 6)
                            .accessibilityAddTraits(.isHeader)
                    }
                    ForEach(Array(group.rows.enumerated()), id: \.element.id) { i, row in
                        if i > 0 { Divider().padding(.leading, checkWidth + 12) }
                        IngredientRow(row: row, checked: $checked, amountWidth: amountWidth)
                    }
                }
            }
        }
        .onPreferenceChange(AmountWidthKey.self) { amountWidth = $0 }
    }
}

/// One checkable line: circle, amount in its column (tabular digits), the item. Reports its amount's width through
/// `AmountWidthKey`, so the list around it can align the column.
struct IngredientRow: View {
    let row: IngredientRowData
    @Binding var checked: Set<String>
    let amountWidth: CGFloat
    /// The amount column's cap at the default size; it scales with Dynamic Type.
    var maxWidth: CGFloat = 92
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1
    @ScaledMetric(relativeTo: .body) private var checkWidth: CGFloat = 22

    var body: some View {
        let isChecked = checked.contains(row.id)
        Button {
            withAnimation(.easeOut(duration: 0.15)) {
                if isChecked { checked.remove(row.id) } else { checked.insert(row.id) }
            }
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Image(systemName: isChecked ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isChecked ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
                    .frame(width: checkWidth)
                    .contentTransition(.symbolEffect(.replace))
                    .accessibilityHidden(true)
                Group {
                    if typeSize.isAccessibilitySize {
                        VStack(alignment: .leading, spacing: 2) {
                            if let amount = row.amount { amountLabel(amount).monospacedDigit() }
                            row.text
                        }
                    } else {
                        HStack(alignment: .firstTextBaseline, spacing: 14) {
                            amountLabel(row.amount ?? "")
                                .monospacedDigit()
                                .background {
                                    amountLabel(row.amount ?? "").monospacedDigit().fixedSize().hidden()
                                        .background(GeometryReader { Color.clear.preference(key: AmountWidthKey.self, value: $0.size.width) })
                                }
                                .frame(width: amountWidth > 0 ? min(amountWidth, maxWidth * scale) : nil, alignment: .leading)
                            row.text
                        }
                    }
                }
                .lineSpacing(2)
                .strikethrough(isChecked)
                .opacity(isChecked ? 0.38 : 1)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(.vertical, 4)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isChecked ? .isSelected : [])
    }
}
