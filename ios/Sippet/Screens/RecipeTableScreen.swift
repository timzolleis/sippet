import SippetCore
import SwiftUI

/// The recipe as a table (cooking rule 1, ios.md Table). `recipe` is already scaled; the text follows yield and units.
struct RecipeTableScreen: View {
    let recipe: DeviceRecipe
    let units: MeasurementSystem
    @Environment(\.dismiss) private var dismiss
    /// nil until the table is measured; then it starts fitted to the width.
    @State private var zoom: CGFloat?
    @GestureState private var pinch: CGFloat = 1
    @State private var size: CGSize = .zero
    @State private var viewport: CGFloat = 0
    /// Columns grow with Dynamic Type, so large text wraps between words, not inside them; the table zooms to fit.
    @ScaledMetric(relativeTo: .subheadline) private var textScale: CGFloat = 1

    private static let zoomRange: ClosedRange<CGFloat> = 0.4...3
    private var fitted: CGFloat { size.width > 0 && viewport > 0 ? min(1, viewport / size.width) : 1 }
    private var scale: CGFloat { clamped((zoom ?? fitted) * pinch) }
    private func clamped(_ value: CGFloat) -> CGFloat { min(max(value, Self.zoomRange.lowerBound), Self.zoomRange.upperBound) }

    var body: some View {
        NavigationStack {
            Group {
                if let table = recipeTable(recipe) {
                    ScrollView([.horizontal, .vertical]) {
                        content(table)
                            .fixedSize()
                            .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
                            .scaleEffect(scale, anchor: .topLeading)
                            .frame(width: size.width * scale, height: size.height * scale, alignment: .topLeading)
                    }
                    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { viewport = $0 }
                    .simultaneousGesture(
                        MagnifyGesture()
                            .updating($pinch) { value, state, _ in state = value.magnification }
                            .onEnded { zoom = clamped((zoom ?? fitted) * $0.magnification) })
                } else {
                    ContentUnavailableView("No table", systemImage: "tablecells")
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func content(_ table: RecipeTable) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            title
            TableLayout(columns: table.columns, rows: table.rows.count, widths: widths(table)) {
                ForEach(Array(table.cells.enumerated()), id: \.offset) { _, cell in
                    TableCellView(text: text(cell.content, in: table), kind: Kind(cell.content))
                        .layoutValue(key: CellPlacement.self, value: cell)
                }
            }
            .background(TableStyle.line)
            .padding(TableStyle.lineWidth)
            .background(TableStyle.line)
        }
        .font(.subheadline)
        .padding(16)
    }

    /// "Veganer Russischer Zupfkuchen (Springform 26 cm, 12 Stück)".
    private var title: some View {
        let vessel = recipe.yield.vessel.map { key in recipe.equipment.first { $0.key == key }?.name ?? key }
        let detail = [vessel, amountText(recipe.yield.amount, language: Format.language)].compactMap(\.self).joined(separator: ", ")
        return Text("\(Text(recipe.title).bold()) (\(detail))").font(.title3)
    }

    /// The ingredient column fits its longest line; step columns stay narrow and wrap.
    private func widths(_ table: RecipeTable) -> [CGFloat] {
        (0..<table.columns).map { column in
            if column == 0 { return 200 * textScale }
            let isPrep = table.cells.contains { $0.column == column && { if case .prep = $0.content { true } else { false } }($0) }
            return (isPrep ? 110 : 130) * textScale
        }
    }

    // MARK: text

    private func text(_ content: TableCellContent, in table: RecipeTable) -> TableText {
        switch content {
        case .prepStep(let key):
            return TableText(main: step(key).map { stepText($0) } ?? key)
        case .section(let key, let prepStepKeys):
            let name = recipe.sections.first { $0.key == key }?.name ?? key
            return TableText(main: name.uppercased(), detail: prepStepKeys.compactMap(step).map { stepText($0) }.joined(separator: " · "))
        case .ingredient(let key):
            return TableText(main: ingredient(key).map(ingredientText) ?? key)
        case .prep(let key):
            return TableText(main: ingredient(key)?.prep ?? "")
        case .step(let key, let passing):
            guard let step = step(key) else { return TableText(main: key) }
            let written: Set<String> = Set(table.cells.flatMap { cell -> [String] in
                if case .step(_, let keys) = cell.content { keys } else { [] }
            })
            let taken = (step.flow?.takes ?? []).filter { !written.contains($0) }.compactMap(portion).compactMap(\.amount)
            let main = (taken.map { Format.amount($0, system: units) } + [stepText(step, separator: "\n")]).joined(separator: " ")
            let passingText = passing.compactMap(portion).map(portionText).joined(separator: "\n")
            return TableText(main: passingText.isEmpty ? main : main + "\n\n" + passingText)
        case .empty:
            return TableText(main: "")
        }
    }

    /// The label (recipe rule 8: the sentence is for reading and cooking), then temperature, duration, and "(ergibt 750 g)", each fact unbroken.
    private func stepText(_ step: Step, separator: String = " ") -> String {
        var facts: [String] = []
        if let t = step.temperature { facts.append(Format.temperature(t, system: units)) }
        if let d = step.duration { facts.append(Format.duration(d)) }
        if let amount = step.result?.amount {
            facts.append("(\(Format.language == .de ? "ergibt" : "makes") \(Format.amount(amount, system: units)))")
        }
        let unbroken = facts.map { $0.replacingOccurrences(of: " ", with: "\u{00A0}") }
        return ([step.label] + unbroken).joined(separator: separator)
    }

    /// "800 g (2 Becher) Vanille-Skyr", "½ Fl. Zitronenaroma (optional)"; the prep has its own column.
    private func ingredientText(_ ingredient: Ingredient) -> String {
        var parts: [String] = []
        if let amount = ingredient.amount { parts.append(Format.amount(amount, system: units)) }
        parts.append(ingredient.item)
        if let note = ingredient.note, !note.isEmpty { parts.append("(\(note))") }
        if ingredient.optional == true { parts.append("(optional)") }
        return parts.joined(separator: " ")
    }

    /// "250 g Zupfteig".
    private func portionText(_ portion: Portion) -> String {
        portion.amount.map { "\(Format.amount($0, system: units)) \(portion.name)" } ?? portion.name
    }

    private func step(_ key: String) -> Step? { recipe.steps.first { $0.key == key } }
    private func ingredient(_ key: String) -> Ingredient? { recipe.ingredients.first { $0.key == key } }
    private func portion(_ key: String) -> Portion? {
        recipe.steps.lazy.compactMap { $0.result?.split?.first { $0.key == key } }.first
    }
}

// MARK: cells

nonisolated private enum TableStyle {
    static let lineWidth: CGFloat = 1
    static let line = Color.accentColor.opacity(0.45)
    static let sectionTint = Color.accentColor.opacity(0.09)
}

private struct TableText {
    var main: String
    var detail: String = ""
}

private enum Kind {
    case fullWidth, section, ingredient, prep, step, empty

    init(_ content: TableCellContent) {
        switch content {
        case .prepStep: self = .fullWidth
        case .section: self = .section
        case .ingredient: self = .ingredient
        case .prep: self = .prep
        case .step: self = .step
        case .empty: self = .empty
        }
    }
}

private struct TableCellView: View {
    let text: TableText
    let kind: Kind

    var body: some View {
        Group {
            switch kind {
            case .section:
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(text.main).font(.footnote.weight(.bold)).tracking(1)
                    if !text.detail.isEmpty {
                        Text("·").font(.footnote).foregroundStyle(.secondary)
                        Text(text.detail).font(.footnote)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            case .ingredient:
                Text(text.main)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            case .fullWidth, .prep, .step:
                Text(text.main)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .empty:
                Color.clear
            }
        }
        .background(kind == .section ? TableStyle.sectionTint : .clear)
        .background(Color(.systemBackground))
    }
}

// MARK: layout

nonisolated private struct CellPlacement: LayoutValueKey {
    static let defaultValue = TableCell(row: 0, rowSpan: 1, column: 0, columnSpan: 1, content: .empty)
}

/// Places cells by row, column, and spans (`Grid` has no row spans). The gap between cells shows the grid line.
nonisolated private struct TableLayout: Layout {
    let columns: Int
    let rows: Int
    let widths: [CGFloat]
    var line: CGFloat = TableStyle.lineWidth

    struct Cache { var heights: [CGFloat] }

    func makeCache(subviews: Subviews) -> Cache { Cache(heights: heights(subviews)) }
    func updateCache(_ cache: inout Cache, subviews: Subviews) { cache.heights = heights(subviews) }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache) -> CGSize {
        CGSize(width: span(widths, 0, widths.count), height: span(cache.heights, 0, cache.heights.count))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache) {
        for subview in subviews {
            let cell = subview[CellPlacement.self]
            let x = bounds.minX + offset(widths, cell.column)
            let y = bounds.minY + offset(cache.heights, cell.row)
            let size = CGSize(width: span(widths, cell.column, cell.columnSpan), height: span(cache.heights, cell.row, cell.rowSpan))
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
        }
    }

    /// Single-row cells set their row's height; a taller spanning cell grows its rows evenly.
    private func heights(_ subviews: Subviews) -> [CGFloat] {
        var heights = Array(repeating: CGFloat(0), count: rows)
        let sorted = subviews.sorted { $0[CellPlacement.self].rowSpan < $1[CellPlacement.self].rowSpan }
        for subview in sorted {
            let cell = subview[CellPlacement.self]
            let width = span(widths, cell.column, cell.columnSpan)
            let needed = subview.sizeThatFits(ProposedViewSize(width: width, height: nil)).height
            let have = span(heights, cell.row, cell.rowSpan)
            if needed > have {
                let extra = (needed - have) / CGFloat(cell.rowSpan)
                for r in cell.row..<(cell.row + cell.rowSpan) { heights[r] += extra }
            }
        }
        return heights
    }

    private func offset(_ sizes: [CGFloat], _ index: Int) -> CGFloat {
        sizes.prefix(index).reduce(0, +) + CGFloat(index) * line
    }

    private func span(_ sizes: [CGFloat], _ start: Int, _ count: Int) -> CGFloat {
        sizes[start..<(start + count)].reduce(0, +) + CGFloat(max(count - 1, 0)) * line
    }
}
