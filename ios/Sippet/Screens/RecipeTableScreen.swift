import SippetCore
import SwiftUI
import UIKit

/// The recipe as its table (cooking rule 1, ios.md Table): the overview a turned phone or an iPad shows in place of the
/// page. The whole table at once, scaled to the width: columns sized from their words, the text one step smaller if
/// needed; no sideways scroll, nothing pinned. `TableFit.make` says whether it fits readably; if not, the page stays.
/// Read-only: a tap on a step selects it, and a small popover at the step shows `card` (its sentence, "Cook from here");
/// no dimming, the table stays in view.
/// `recipe` is already scaled, so the text follows yield and units.
struct RecipeTableScreen: View {
    let recipe: DeviceRecipe
    let table: RecipeTable
    let fit: TableFit
    let units: MeasurementSystem
    @Binding var selected: String?
    let card: (String) -> AnyView

    var body: some View {
        let model = TableModel(recipe: recipe, table: table, units: units)
        TableLayout(widths: fit.widths, rows: table.rows.count + 1) {
            ForEach(model.items) { item in
                TableCellView(item: item, selected: $selected, card: card)
                    .layoutValue(key: CellPlacement.self, value: item.placement)
                    .accessibilitySortPriority(Double(model.items.count - (model.readingOrder[item.id] ?? model.items.count)))
            }
        }
        .font(fit.font)
        .overlay { Rectangle().strokeBorder(TableStyle.line, lineWidth: 1) }
        .accessibilityElement(children: .contain)
        .sensoryFeedback(.selection, trigger: selected)
    }
}

// MARK: fit

/// Column widths and the text style for a table at a given width, or nil when it can't be read there.
/// A column is at least as wide as its longest word, so no word breaks inside a cell; the ingredient column then grows
/// until three of four ingredients fit on one line (at most a third of the width), step columns toward half their
/// longest text. The largest of
/// callout, subheadline, footnote at which the ingredient column gets that room; else the largest at which the words fit.
struct TableFit: Equatable {
    let widths: [CGFloat]
    let style: Font.TextStyle

    init(widths: [CGFloat], style: Font.TextStyle) {
        self.widths = widths
        self.style = style
    }

    var font: Font { .system(style, design: .rounded) }

    static let ingredientPadding: CGFloat = 22
    static let stepPadding: CGFloat = 16

    @MainActor static func make(recipe: DeviceRecipe, table: RecipeTable, units: MeasurementSystem, width: CGFloat, typeSize: DynamicTypeSize) -> TableFit? {
        guard table.columns > 1, width > 0 else { return nil }
        let model = TableModel(recipe: recipe, table: table, units: units)
        let fits = [Font.TextStyle.callout, .subheadline, .footnote].compactMap { style in
            fit(model: model, columns: table.columns, style: style, width: width, typeSize: typeSize)
        }
        return fits.first { $0.roomy } ?? fits.first
    }

    /// Whether the ingredient column got its wish; a table that only just fits wraps every ingredient.
    private var roomy = true

    @MainActor private static func fit(model: TableModel, columns: Int, style: Font.TextStyle, width: CGFloat, typeSize: DynamicTypeSize) -> TableFit? {
        let measure = Measure(style: style, typeSize: typeSize)
        var mins = Array(repeating: CGFloat(48), count: columns)
        var wants = mins
        var lines: [CGFloat] = []
        for item in model.items where item.placement.columnSpan == 1 {
            let column = item.placement.column
            switch item.kind {
            case .ingredient(let line):
                let amount = line.amount.map { measure.width($0, bold: true) } ?? 0
                let words = measure.longestWord(line.item + line.rest)
                let full = amount + measure.width(" " + line.item + line.rest)
                mins[column] = max(mins[column], max(amount, words) + ingredientPadding)
                lines.append(full + ingredientPadding)
            case .prep(_, let text):
                mins[column] = max(mins[column], measure.longestWord(text) + stepPadding)
                wants[column] = max(wants[column], measure.width(text) + stepPadding)
            case .step(let line):
                let texts = [line.main] + line.facts + line.passing
                mins[column] = max(mins[column], (texts.map(measure.longestWord).max() ?? 0) + stepPadding)
                wants[column] = max(wants[column], min(measure.width(line.main) / 2, 220) + stepPadding)
            default:
                break
            }
        }
        lines.sort()
        if !lines.isEmpty { wants[0] = max(mins[0], lines[min(lines.count - 1, lines.count * 3 / 4)]) }
        var widths = mins
        var extra = width - mins.reduce(0, +)
        guard extra >= 0 else { return nil }
        // The ingredient column first: a line on one row reads best.
        let wish = max(0, min(wants[0], width / 3) - widths[0])
        let first = min(extra, wish)
        widths[0] += first
        extra -= first
        // Then step columns toward their wish, all by the same share.
        let needs = (1..<widths.count).map { max(0, wants[$0] - widths[$0]) }
        let total = needs.reduce(0, +)
        if total > 0 {
            let share = min(1, extra / total)
            for (offset, need) in needs.enumerated() { widths[offset + 1] += need * share }
            extra -= total * share
        }
        // What's left goes to the step columns evenly.
        let even = extra / CGFloat(widths.count - 1)
        for i in 1..<widths.count { widths[i] += even }
        var fit = TableFit(widths: widths.map { ($0 * 2).rounded(.down) / 2 }, style: style)
        fit.roomy = first >= wish
        return fit
    }
}

/// Text widths with the font the cells use (SF Rounded at the current Dynamic Type size).
@MainActor private struct Measure {
    let regular: UIFont
    let bold: UIFont

    init(style: Font.TextStyle, typeSize: DynamicTypeSize) {
        let uiStyle: UIFont.TextStyle = style == .callout ? .callout : style == .subheadline ? .subheadline : .footnote
        let traits = UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(typeSize))
        let base = UIFont.preferredFont(forTextStyle: uiStyle, compatibleWith: traits)
        let rounded = base.fontDescriptor.withDesign(.rounded) ?? base.fontDescriptor
        regular = UIFont(descriptor: rounded, size: base.pointSize)
        let heavy = rounded.addingAttributes([.traits: [UIFontDescriptor.TraitKey.weight: UIFont.Weight.semibold]])
        bold = UIFont(descriptor: heavy, size: base.pointSize)
    }

    func width(_ text: String, bold: Bool = false) -> CGFloat {
        ceil((text as NSString).size(withAttributes: [.font: bold ? self.bold : regular]).width)
    }

    /// Lines break at spaces only; "170 °C" and "750 g" hold together (no-break spaces).
    func longestWord(_ text: String) -> CGFloat {
        text.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "-" }).map { width(String($0)) }.max() ?? 0
    }
}

// MARK: model

/// One placed view: a cell of `recipeTable`, or a header cell with step numbers.
private struct TableItem: Identifiable {
    let id: String
    let placement: TableCell
    let kind: ItemKind
}

struct StepLine {
    let step: Step
    let number: Int
    /// "500 g als Boden in die Form drücken"; the label (recipe rule 8: the sentence is for reading and cooking).
    let main: String
    /// Temperature, duration, "(ergibt 750 g)".
    let facts: [String]
    /// "250 g Zupfteig": a portion passing this column.
    let passing: [String]

    var spoken: String {
        ([String(localized: "Step \(number)"), main] + facts + passing).joined(separator: ", ")
    }
}

/// "300 g" | "Mehl" | " (optional)"; spoken with its prep: "30 g Zitronensaft, auspressen".
struct IngredientLine {
    let key: String
    let amount: String?
    let item: String
    let rest: String
    let spoken: String
}

private enum ItemKind {
    case ingredient(IngredientLine)
    case prep(String, String)
    case step(StepLine)
    case fullWidth(StepLine)
    case section(String, [StepLine])
    case empty
    case header([StepLine])
    case corner(String)

    var stepKey: String? {
        switch self {
        case .step(let line), .fullWidth(let line): line.step.key
        default: nil
        }
    }
}

/// The table's cells as views: text from the scaled recipe, in the app's formats; the reading order for VoiceOver.
private struct TableModel {
    var items: [TableItem] = []
    /// Item id → position when VoiceOver reads by step: each step, then the ingredients it brings in.
    var readingOrder: [String: Int] = [:]

    init(recipe: DeviceRecipe, table: RecipeTable, units: MeasurementSystem) {
        let numbers = Dictionary(recipe.steps.enumerated().map { ($1.key, $0 + 1) }, uniquingKeysWith: { a, _ in a })
        let written = Set(table.cells.flatMap { cell -> [String] in
            if case .step(_, let keys) = cell.content { keys } else { [] }
        })
        func step(_ key: String) -> Step? { recipe.steps.first { $0.key == key } }
        func portion(_ key: String) -> Portion? {
            recipe.steps.lazy.compactMap { $0.result?.split?.first { $0.key == key } }.first
        }
        /// "170 °C O/U" may break before the mode, never inside "170 °C".
        func keep(_ s: String) -> String { s.replacingOccurrences(of: " °", with: "\u{00A0}°") }
        func line(_ step: Step, passing: [String] = []) -> StepLine {
            var facts: [String] = []
            if let t = step.temperature { facts.append(keep(Format.temperature(t, system: units))) }
            if let d = step.duration { facts.append(nbsp(Format.duration(d))) }
            if let amount = step.result?.amount {
                facts.append("(\(Format.language == .de ? "ergibt" : "makes") \(nbsp(Format.amount(amount, system: units))))")
            }
            // A portion not written in the columns before shows its amount before the label: "500 g als Boden …".
            let taken = (step.flow?.takes ?? []).filter { !written.contains($0) }.compactMap(portion).compactMap(\.amount)
            let main = (taken.map { nbsp(Format.amount($0, system: units)) } + [step.label]).joined(separator: " ")
            let passingText = passing.compactMap(portion).map { p in
                p.amount.map { "\(nbsp(Format.amount($0, system: units))) \(p.name)" } ?? p.name
            }
            return StepLine(step: step, number: numbers[step.key] ?? 0, main: main, facts: facts, passing: passingText)
        }

        var stepCellsByColumn: [Int: [(row: Int, line: StepLine)]] = [:]
        var ingredientItem: [String: String] = [:]
        var stepItem: [String: String] = [:]
        var sectionItem: [String: String] = [:]

        for (index, cell) in table.cells.enumerated() {
            let id = "cell-\(index)"
            let placed = TableCell(row: cell.row + 1, rowSpan: cell.rowSpan, column: cell.column, columnSpan: cell.columnSpan, content: cell.content)
            switch cell.content {
            case .ingredient(let key):
                guard let ingredient = recipe.ingredients.first(where: { $0.key == key }) else { continue }
                var rest = ""
                if let note = ingredient.note, !note.isEmpty { rest += " (\(note))" }
                if ingredient.optional == true { rest += " (\(String(localized: "optional")))" }
                let line = IngredientLine(
                    key: key, amount: ingredient.amount.map { Format.amount($0, system: units) }, item: ingredient.item,
                    rest: rest, spoken: Format.ingredientLine(ingredient, system: units))
                items.append(TableItem(id: id, placement: placed, kind: .ingredient(line)))
                ingredientItem[key] = id
            case .prep(let key):
                let text = recipe.ingredients.first { $0.key == key }?.prep ?? ""
                items.append(TableItem(id: id, placement: placed, kind: .prep(key, text)))
            case .step(let key, let passing):
                guard let s = step(key) else { continue }
                let stepLine = line(s, passing: passing)
                items.append(TableItem(id: id, placement: placed, kind: .step(stepLine)))
                stepCellsByColumn[cell.column, default: []].append((cell.row, stepLine))
                stepItem[key] = id
            case .prepStep(let key):
                guard let s = step(key) else { continue }
                items.append(TableItem(id: id, placement: placed, kind: .fullWidth(line(s))))
                stepItem[key] = id
            case .section(let key, let prepStepKeys):
                let name = recipe.sections.first { $0.key == key }?.name ?? key
                let lines = prepStepKeys.compactMap(step).map { line($0) }
                items.append(TableItem(id: id, placement: placed, kind: .section(name, lines)))
                sectionItem[key] = id
                for l in lines { stepItem[l.step.key] = id }
            case .empty:
                items.append(TableItem(id: id, placement: placed, kind: .empty))
            }
        }

        // Header: the numbers of the steps in each column, top to bottom; the corner names the yield.
        for column in 1..<max(table.columns, 1) {
            let lines = (stepCellsByColumn[column] ?? []).sorted { $0.row < $1.row }.map(\.line)
            let cell = TableCell(row: 0, rowSpan: 1, column: column, columnSpan: 1, content: .empty)
            items.append(TableItem(id: "header-\(column)", placement: cell, kind: .header(lines)))
        }
        let yield = amountText(recipe.yield.amount, language: Format.language)
        let corner = TableCell(row: 0, rowSpan: 1, column: 0, columnSpan: 1, content: .empty)
        items.append(TableItem(id: "corner", placement: corner, kind: .corner(yield)))

        // VoiceOver reads by step: the section when it starts, the step, then the ingredients it brings in.
        var order: [String] = []
        var section: String?
        func add(_ id: String?) { if let id, !order.contains(id) { order.append(id) } }
        for s in recipe.steps {
            if let key = s.section, key != section {
                section = key
                add(sectionItem[key])
            }
            add(stepItem[s.key])
            for key in s.uses ?? [] { add(ingredientItem[key]) }
        }
        readingOrder = Dictionary(uniqueKeysWithValues: order.enumerated().map { ($1, $0) })
    }
}

// MARK: cells

nonisolated private enum TableStyle {
    static let line = AnyShapeStyle(TintShapeStyle().opacity(0.3))
    static let sectionTint = AnyShapeStyle(TintShapeStyle().opacity(0.09))
    static let selectedTint = AnyShapeStyle(TintShapeStyle().opacity(0.16))
}

private struct TableCellView: View {
    let item: TableItem
    @Binding var selectedKey: String?
    let card: (String) -> AnyView

    init(item: TableItem, selected: Binding<String?>, card: @escaping (String) -> AnyView) {
        self.item = item
        _selectedKey = selected
        self.card = card
    }

    private var selected: Bool { item.kind.stepKey.map { $0 == selectedKey } ?? false }

    private func select(_ key: String) {
        withAnimation(.easeOut(duration: 0.15)) { selectedKey = selectedKey == key ? nil : key }
    }

    /// The step's card in a popover at the cell, also on iPhone: small, undimmed.
    private func popover(_ key: String) -> some ViewModifier {
        StepPopover(key: key, selected: $selectedKey, card: card)
    }
    @Environment(\.displayScale) private var displayScale
    @ScaledMetric(relativeTo: .callout) private var badge: CGFloat = 22

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { background }
            .overlay(alignment: .bottom) { Rectangle().fill(TableStyle.line).frame(height: 1 / displayScale) }
            .overlay(alignment: .trailing) { Rectangle().fill(TableStyle.line).frame(width: 1 / displayScale) }
    }

    @ViewBuilder private var background: some View {
        if selected {
            Rectangle().fill(TableStyle.selectedTint)
        } else if case .section = item.kind {
            Rectangle().fill(TableStyle.sectionTint)
        }
    }

    @ViewBuilder private var content: some View {
        switch item.kind {
        case .ingredient(let ingredient):
            ingredientLabel(ingredient)
                .padding(.leading, 12)
                .padding(.trailing, 10)
                .padding(.vertical, 7)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(ingredient.spoken)
        case .prep(_, let text):
            Text(text)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, TableFit.stepPadding / 2)
                .padding(.vertical, 7)
                .accessibilityHidden(true) // read with its ingredient
        case .step(let line):
            Button { select(line.step.key) } label: {
                stepLabel(line)
                    .padding(.horizontal, TableFit.stepPadding / 2)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .modifier(popover(line.step.key))
            .accessibilityLabel(line.spoken)
            .accessibilityAddTraits(selected ? .isSelected : [])
        case .fullWidth(let line):
            Button { select(line.step.key) } label: {
                Text(([line.main] + line.facts).joined(separator: " · "))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, minHeight: 36)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .modifier(popover(line.step.key))
            .accessibilityLabel(line.spoken)
        case .section(let name, let lines):
            HStack(alignment: .firstTextBaseline, spacing: 14) {
                Text(name)
                    .font(.footnote.weight(.bold))
                    .textCase(.uppercase)
                    .tracking(1)
                    .foregroundStyle(.tint)
                    .accessibilityAddTraits(.isHeader)
                ForEach(lines, id: \.step.key) { line in
                    Button { select(line.step.key) } label: {
                        Text(verbatim: "\(line.number). \(([line.main] + line.facts).joined(separator: " "))")
                            .font(.footnote)
                            .frame(minHeight: 28)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .modifier(popover(line.step.key))
                    .accessibilityLabel(line.spoken)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 2)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        case .empty:
            Color.clear.accessibilityHidden(true)
        case .header(let lines):
            HStack(spacing: 6) {
                ForEach(lines, id: \.step.key) { line in
                    Text(line.number, format: .number)
                        .font(.caption.weight(.bold))
                        .monospacedDigit()
                        .foregroundStyle(.tint)
                        .frame(width: badge, height: badge)
                        .background(.tint.opacity(0.13), in: .circle)
                }
            }
            .padding(.vertical, 6)
            .accessibilityHidden(true) // the step cells say their numbers
        case .corner(let yield):
            Text("For \(yield)")
                .font(.caption.weight(.semibold))
                .textCase(.uppercase)
                .tracking(0.8)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .accessibilityHidden(true)
        }
    }

    /// "300 g Mehl", the amount a shade stronger with tabular digits; note and optional quiet.
    private func ingredientLabel(_ line: IngredientLine) -> Text {
        let tail = Text(line.rest).foregroundStyle(.secondary)
        guard let amount = line.amount else { return Text("\(line.item)\(tail)") }
        return Text("\(amountLabel(amount, weight: .semibold).monospacedDigit()) \(line.item)\(tail)")
    }

    private func stepLabel(_ line: StepLine) -> some View {
        VStack(spacing: 3) {
            // Not bolder when selected: columns are measured at regular weight, the tint marks it.
            Text(line.main)
            ForEach(line.facts, id: \.self) { fact in
                Text(fact).foregroundStyle(.secondary).monospacedDigit()
            }
            if !line.passing.isEmpty {
                VStack(spacing: 2) {
                    ForEach(line.passing, id: \.self) { Text($0).monospacedDigit() }
                }
                .foregroundStyle(.secondary)
                .padding(.top, 6)
            }
        }
        .multilineTextAlignment(.center)
    }
}

// MARK: step card

private struct StepPopover: ViewModifier {
    let key: String
    @Binding var selected: String?
    let card: (String) -> AnyView

    func body(content: Content) -> some View {
        content.popover(isPresented: Binding(get: { selected == key }, set: { if !$0, selected == key { selected = nil } })) {
            card(key).presentationCompactAdaptation(.popover)
        }
    }
}

/// The step tapped in the table: its sentence (recipe rule 8), its facts, and cook mode from here.
struct TableStepCard: View {
    let recipe: DeviceRecipe
    let index: Int
    let units: MeasurementSystem
    let cook: () -> Void

    var body: some View {
        let step = recipe.steps[index]
        let section = step.section.flatMap { key in recipe.sections.first { $0.key == key }?.name }
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("Step \(index + 1) of \(recipe.steps.count)")
                        .font(.footnote.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(.tint)
                    if let section { Eyebrow(verbatim: section) }
                }
                Text(stepText(step))
                    .font(.body)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
                let facts = stepFacts(step, in: recipe, units: units)
                if !facts.isEmpty { FactRow(facts: facts).font(.subheadline) }
                Button(action: cook) {
                    Label("Cook from here", systemImage: "play.fill")
                        .font(.body.weight(.semibold))
                        .frame(minHeight: 32)
                }
                .buttonStyle(.glassProminent)
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .padding(20)
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(idealWidth: 340, maxWidth: 380)
        .fixedSize(horizontal: false, vertical: true)
        .fontDesign(.rounded)
    }
}

// MARK: layout

nonisolated private struct CellPlacement: LayoutValueKey {
    static let defaultValue = TableCell(row: 0, rowSpan: 1, column: 0, columnSpan: 1, content: .empty)
}

/// Places cells by row, column, and spans (`Grid` has no row spans). Row 0 is the header. Each cell draws its own
/// bottom and trailing hairline.
nonisolated private struct TableLayout: Layout {
    let widths: [CGFloat]
    let rows: Int

    struct Cache { var heights: [CGFloat] }

    func makeCache(subviews: Subviews) -> Cache { Cache(heights: heights(subviews)) }
    func updateCache(_ cache: inout Cache, subviews: Subviews) { cache.heights = heights(subviews) }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache) -> CGSize {
        CGSize(width: widths.reduce(0, +), height: cache.heights.reduce(0, +))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache) {
        for subview in subviews {
            let cell = subview[CellPlacement.self]
            let x = bounds.minX + span(widths, 0, cell.column)
            let y = bounds.minY + span(cache.heights, 0, cell.row)
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
            guard cell.row + cell.rowSpan <= rows, cell.column + cell.columnSpan <= widths.count else { continue }
            let needed = subview.sizeThatFits(ProposedViewSize(width: span(widths, cell.column, cell.columnSpan), height: nil)).height
            let have = span(heights, cell.row, cell.rowSpan)
            if needed > have {
                let extra = (needed - have) / CGFloat(cell.rowSpan)
                for r in cell.row..<(cell.row + cell.rowSpan) { heights[r] += extra }
            }
        }
        return heights
    }

    private func span(_ sizes: [CGFloat], _ start: Int, _ count: Int) -> CGFloat {
        sizes[start..<min(start + count, sizes.count)].reduce(0, +)
    }
}
