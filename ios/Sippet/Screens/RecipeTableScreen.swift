import SippetCore
import SwiftUI

/// The recipe as a table (cooking rule 1, ios.md Table), inline on the recipe page when the cook picks "Ablauf".
/// `recipe` is already scaled, so the text follows yield and units. The page scrolls it down; it scrolls sideways itself.
/// Pinned: the ingredient column and the section names sideways, the step-number header downwards. A cell that spans
/// many rows keeps its text in the part of it on screen.
/// Tap an ingredient to tick it (cooking 3, the page's checks); tap a step to select it: its ingredients and the results
/// it takes light up, the rest steps back, and the page shows its sentence (recipe rule 8).
struct RecipeTableScreen: View {
    let recipe: DeviceRecipe
    let table: RecipeTable
    let units: MeasurementSystem
    @Binding var checked: Set<String>
    @Binding var selected: String?
    /// The page's readable band in its scroll view's coordinates: under the bar, above the step card.
    let visibleTop: CGFloat
    let visibleBottom: CGFloat

    @State private var viewport = TableViewport()
    @State private var width: CGFloat = 0
    @State private var position = ScrollPosition(edge: .leading)
    /// Columns grow with Dynamic Type, so large text wraps between words, not inside them.
    @ScaledMetric(relativeTo: .callout) private var textScale: CGFloat = 1

    var body: some View {
        let widths = columnWidths()
        let model = TableModel(recipe: recipe, table: table, units: units)
        let focus = TableFocus(selected: selected, recipe: recipe)
        ScrollView(.horizontal) {
            TableLayout(widths: widths, rows: table.rows.count + 1) {
                ForEach(model.items) { item in
                    TableCellView(
                        item: item, emphasis: focus.emphasis(item.kind), checked: isChecked(item.kind),
                        selectedStep: selected, viewport: viewport,
                        tick: tick, select: select)
                        .layoutValue(key: CellPlacement.self, value: item.placement)
                        .accessibilitySortPriority(Double(model.items.count - (model.readingOrder[item.id] ?? model.items.count)))
                }
            }
            .coordinateSpace(.named(TableSpace.name))
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { viewport.set(\.contentHeight, $0) }
            .accessibilityElement(children: .contain)
        }
        .scrollPosition($position)
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.x + $0.contentInsets.leading } action: {
            viewport.set(\.scrollX, $1)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: {
            width = $0
            viewport.set(\.width, $0)
        }
        .onGeometryChange(for: CGFloat.self) { $0.frame(in: .scrollView(axis: .vertical)).minY } action: {
            viewport.set(\.minY, $0)
        }
        .onChange(of: widths.first, initial: true) { viewport.set(\.pinnedWidth, widths.first ?? 0) }
        .onChange(of: visibleTop, initial: true) { viewport.set(\.visibleTop, visibleTop) }
        .onChange(of: visibleBottom, initial: true) { viewport.set(\.visibleBottom, visibleBottom) }
        .onChange(of: selected) { _, key in reveal(key, model: model, widths: widths) }
        .sensoryFeedback(.selection, trigger: selected)
        .sensoryFeedback(.impact(weight: .light), trigger: checked)
        #if DEBUG
        .task {
            if let x = UserDefaults.standard.string(forKey: "SippetTableX").flatMap(Double.init) {
                try? await Task.sleep(for: .seconds(1))
                position.scrollTo(x: x)
            }
        }
        #endif
    }

    private func isChecked(_ kind: ItemKind) -> Bool {
        switch kind {
        case .ingredient(let line): checked.contains(line.key)
        case .prep(let key, _): checked.contains(key)
        default: false
        }
    }

    private func tick(_ key: String) {
        withAnimation(.easeOut(duration: 0.15)) {
            if checked.contains(key) { checked.remove(key) } else { checked.insert(key) }
        }
    }

    private func select(_ key: String) {
        withAnimation(.easeOut(duration: 0.2)) { selected = selected == key ? nil : key }
    }

    /// Scrolls sideways so a selected step's column sits beside the pinned ingredients.
    private func reveal(_ key: String?, model: TableModel, widths: [CGFloat]) {
        guard let key, let columns = model.stepColumns[key], widths.count > columns.upperBound else { return }
        let pinned = widths[0]
        let start = widths.prefix(columns.lowerBound).reduce(0, +)
        let end = widths.prefix(columns.upperBound + 1).reduce(0, +)
        let shownFrom = viewport.scrollX + pinned, shownTo = viewport.scrollX + width
        guard start < shownFrom || end > shownTo else { return }
        let target = end - start > width - pinned ? start - pinned : (start < shownFrom ? start - pinned : end - width)
        withAnimation(.smooth) { position.scrollTo(x: max(0, target)) }
    }

    /// The ingredient column fits a long line, at most half the screen, so a step always sits beside it.
    /// Step columns stay narrow and wrap; when the table is narrower than the screen, they share the rest.
    private func columnWidths() -> [CGFloat] {
        let screen = width > 0 ? width : 390
        let first = min(TableStyle.edge + 184 * textScale, max(150, screen * 0.5))
        var widths = (0..<table.columns).map { column -> CGFloat in
            if column == 0 { return first }
            let isPrep = table.cells.contains { $0.column == column && { if case .prep = $0.content { true } else { false } }($0) }
            return min((isPrep ? 112 : 136) * textScale, max(120, screen - first))
        }
        let total = widths.reduce(0, +)
        if total < screen, widths.count > 1 {
            let extra = (screen - total) / CGFloat(widths.count - 1)
            for i in 1..<widths.count { widths[i] += extra }
        }
        return widths
    }
}

// MARK: viewport

nonisolated private enum TableSpace {
    static let name = "recipeTable"
}

/// What is on screen, updated while scrolling. Only the cells that pin or keep text in view read it,
/// so a scroll doesn't rebuild the table.
@Observable private final class TableViewport {
    var scrollX: CGFloat = 0
    var width: CGFloat = 0
    /// The table's top in the page's scroll view.
    var minY: CGFloat = 0
    var visibleTop: CGFloat = 0
    var visibleBottom: CGFloat = 10_000
    var contentHeight: CGFloat = 0
    var headerHeight: CGFloat = 0
    var pinnedWidth: CGFloat = 0

    func set(_ key: ReferenceWritableKeyPath<TableViewport, CGFloat>, _ value: CGFloat) {
        if self[keyPath: key] != value { self[keyPath: key] = value }
    }

    /// The header stays under the bar while the table passes, and stops at its end.
    var headerOffset: CGFloat { min(max(visibleTop - minY, 0), max(contentHeight - headerHeight, 0)) }

    /// The part of the table on screen and not under the pinned header or column, in the table's coordinates.
    func visible(fullWidth: Bool) -> CGRect {
        let left = scrollX + (fullWidth ? 0 : pinnedWidth)
        let top = headerOffset + headerHeight
        let bottom = visibleBottom - minY
        return CGRect(x: left, y: top, width: max(0, scrollX + width - left), height: max(0, bottom - top))
    }
}

// MARK: model

/// One placed view: a cell of `recipeTable`, a pinned section name, or a header cell.
private struct TableItem: Identifiable {
    let id: String
    let placement: TableCell
    let layer: Layer
    let kind: ItemKind

    enum Layer { case body, pinned, header, corner }
}

private struct StepLine {
    let step: Step
    let number: Int
    /// "500 g als Boden in die Form drücken"; the label (recipe rule 8: the sentence is for reading and cooking).
    let main: String
    /// Temperature, duration, "(ergibt 750 g)", each unbroken.
    let facts: [String]
    /// "250 g Zupfteig": a portion passing this column.
    let passing: [String]

    var spoken: String {
        ([String(localized: "Step \(number)"), main] + facts + passing).joined(separator: ", ")
    }
}

/// "300 g" | "Mehl" | " (optional)"; spoken with its prep: "30 g Zitronensaft, auspressen".
private struct IngredientLine {
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
    case sectionName(String)
    case sectionBand([StepLine])
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
    /// Step key → the columns of its cell, to scroll it into view.
    var stepColumns: [String: ClosedRange<Int>] = [:]

    init(recipe: DeviceRecipe, table: RecipeTable, units: MeasurementSystem) {
        let numbers = Dictionary(uniqueKeysWithValues: recipe.steps.enumerated().map { ($1.key, $0 + 1) })
        let written = Set(table.cells.flatMap { cell -> [String] in
            if case .step(_, let keys) = cell.content { keys } else { [] }
        })
        func step(_ key: String) -> Step? { recipe.steps.first { $0.key == key } }
        func portion(_ key: String) -> Portion? {
            recipe.steps.lazy.compactMap { $0.result?.split?.first { $0.key == key } }.first
        }
        func line(_ step: Step, passing: [String] = []) -> StepLine {
            var facts: [String] = []
            if let t = step.temperature { facts.append(Format.temperature(t, system: units)) }
            if let d = step.duration { facts.append(Format.duration(d)) }
            if let amount = step.result?.amount {
                facts.append("(\(Format.language == .de ? "ergibt" : "makes") \(Format.amount(amount, system: units)))")
            }
            // A portion not written in the columns before shows its amount before the label: "500 g als Boden …".
            let taken = (step.flow?.takes ?? []).filter { !written.contains($0) }.compactMap(portion).compactMap(\.amount)
            let main = (taken.map { Format.amount($0, system: units) } + [step.label]).joined(separator: " ")
            let passingText = passing.compactMap(portion).map { p in
                p.amount.map { "\(Format.amount($0, system: units)) \(p.name)" } ?? p.name
            }
            return StepLine(
                step: step, number: numbers[step.key] ?? 0, main: main,
                facts: facts.map { $0.replacingOccurrences(of: " ", with: "\u{00A0}") }, passing: passingText)
        }

        var stepCellsByColumn: [Int: [(row: Int, line: StepLine)]] = [:]
        var ingredientItem: [String: String] = [:]
        var prepItem: [String: String] = [:]
        var stepItem: [String: String] = [:]
        var sectionItems: [String: [String]] = [:]

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
                items.append(TableItem(id: id, placement: placed, layer: .pinned, kind: .ingredient(line)))
                ingredientItem[key] = id
            case .prep(let key):
                let text = recipe.ingredients.first { $0.key == key }?.prep ?? ""
                items.append(TableItem(id: id, placement: placed, layer: .body, kind: .prep(key, text)))
                prepItem[key] = id
            case .step(let key, let passing):
                guard let s = step(key) else { continue }
                let stepLine = line(s, passing: passing)
                items.append(TableItem(id: id, placement: placed, layer: .body, kind: .step(stepLine)))
                stepCellsByColumn[cell.column, default: []].append((cell.row, stepLine))
                stepColumns[key] = cell.column...(cell.column + cell.columnSpan - 1)
                stepItem[key] = id
            case .prepStep(let key):
                guard let s = step(key) else { continue }
                items.append(TableItem(id: id, placement: placed, layer: .body, kind: .fullWidth(line(s))))
                stepItem[key] = id
            case .section(let key, let prepStepKeys):
                let name = recipe.sections.first { $0.key == key }?.name ?? key
                let lines = prepStepKeys.compactMap(step).map { line($0) }
                items.append(TableItem(id: id, placement: placed, layer: .body, kind: .sectionBand(lines)))
                let nameId = "section-\(cell.row)"
                let nameCell = TableCell(row: cell.row + 1, rowSpan: 1, column: 0, columnSpan: 1, content: .empty)
                items.append(TableItem(id: nameId, placement: nameCell, layer: .pinned, kind: .sectionName(name)))
                sectionItems[key] = [nameId] + (lines.isEmpty ? [] : [id])
                for l in lines { stepItem[l.step.key] = id }
            case .empty:
                items.append(TableItem(id: id, placement: placed, layer: .body, kind: .empty))
            }
        }

        // Header: the numbers of the steps in each column, top to bottom; the corner names the yield.
        for column in 1..<max(table.columns, 1) {
            let lines = (stepCellsByColumn[column] ?? []).sorted { $0.row < $1.row }.map(\.line)
            let cell = TableCell(row: 0, rowSpan: 1, column: column, columnSpan: 1, content: .empty)
            items.append(TableItem(id: "header-\(column)", placement: cell, layer: .header, kind: .header(lines)))
        }
        let yield = amountText(recipe.yield.amount, language: Format.language)
        let corner = TableCell(row: 0, rowSpan: 1, column: 0, columnSpan: 1, content: .empty)
        items.append(TableItem(id: "corner", placement: corner, layer: .corner, kind: .corner(yield)))

        // Drawn in layers: the body scrolls under the pinned column, the header over both, the corner on top.
        let rank: (TableItem.Layer) -> Int = { [.body: 0, .pinned: 1, .header: 2, .corner: 3][$0] ?? 0 }
        items.sort { rank($0.layer) < rank($1.layer) }

        // VoiceOver reads by step: the section when it starts, the step, then the ingredients it brings in.
        var order: [String] = []
        var section: String?
        func add(_ id: String?) { if let id, !order.contains(id) { order.append(id) } }
        for s in recipe.steps {
            if let key = s.section, key != section {
                section = key
                for id in sectionItems[key] ?? [] { add(id) }
            }
            add(stepItem[s.key])
            for key in s.uses ?? [] { add(ingredientItem[key]) }
        }
        for item in items where item.layer == .pinned { add(item.id) }
        readingOrder = Dictionary(uniqueKeysWithValues: order.enumerated().map { ($1, $0) })
    }
}

/// A selected step, its ingredients and the steps whose results it takes.
private struct TableFocus {
    let selected: String?
    let ingredients: Set<String>
    let incoming: Set<String>

    init(selected: String?, recipe: DeviceRecipe) {
        self.selected = selected
        guard let key = selected, let step = recipe.steps.first(where: { $0.key == key }) else {
            ingredients = []
            incoming = []
            return
        }
        ingredients = Set(step.uses ?? [])
        incoming = Set((step.flow?.takes ?? step.takes ?? []).compactMap { taken in
            recipe.steps.first { $0.key == taken || ($0.result?.split ?? []).contains { $0.key == taken } }?.key
        })
    }

    func emphasis(_ kind: ItemKind) -> Emphasis {
        guard let selected else { return .normal }
        switch kind {
        case .ingredient(let line): return ingredients.contains(line.key) ? .related : .dimmed
        case .prep(let key, _): return ingredients.contains(key) ? .related : .dimmed
        case .step(let line), .fullWidth(let line):
            return line.step.key == selected ? .selected : incoming.contains(line.step.key) ? .related : .dimmed
        case .sectionBand(let lines):
            return lines.contains { $0.step.key == selected } ? .selected : .dimmed
        case .sectionName, .empty, .header, .corner:
            return .normal
        }
    }
}

private enum Emphasis { case normal, selected, related, dimmed }

// MARK: cells

nonisolated private enum TableStyle {
    /// The page margin: the ingredient column's text lines up with the page's text.
    static let edge: CGFloat = 24
    static let lineOpacity = 0.3
    static let sectionTintOpacity = 0.09
    static let selectedTintOpacity = 0.2
    static let relatedTintOpacity = 0.1
}

private struct TableCellView: View {
    let item: TableItem
    let emphasis: Emphasis
    let checked: Bool
    let selectedStep: String?
    let viewport: TableViewport
    let tick: (String) -> Void
    let select: (String) -> Void
    @Environment(\.displayScale) private var displayScale
    @Environment(\.theme) private var theme
    @ScaledMetric(relativeTo: .callout) private var badge: CGFloat = 24

    var body: some View {
        content
            .opacity(emphasis == .dimmed ? 0.35 : 1)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { background }
            .overlay(alignment: .bottom) { hairline.frame(height: 1 / displayScale) }
            .overlay(alignment: .trailing) { hairline.frame(width: 1 / displayScale) }
            .modifier(Pin(layer: item.layer, viewport: viewport))
    }

    private var hairline: some View { Rectangle().fill(theme.accent.opacity(TableStyle.lineOpacity)) }

    @ViewBuilder private var background: some View {
        ZStack {
            Rectangle().fill(Color(.systemBackground))
            switch (item.kind, emphasis) {
            case (_, .selected): Rectangle().fill(theme.accent.opacity(TableStyle.selectedTintOpacity))
            case (.sectionName, _), (.sectionBand, _): Rectangle().fill(theme.accent.opacity(TableStyle.sectionTintOpacity))
            case (_, .related): Rectangle().fill(theme.accent.opacity(TableStyle.relatedTintOpacity))
            default: EmptyView()
            }
        }
    }

    @ViewBuilder private var content: some View {
        switch item.kind {
        case .ingredient(let ingredient):
            Button { tick(ingredient.key) } label: {
                ingredientLabel(ingredient)
                    .strikethrough(checked, color: theme.accent)
                    .opacity(checked ? 0.38 : 1)
                    .padding(.leading, TableStyle.edge)
                    .padding(.trailing, 10)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, minHeight: 44, maxHeight: .infinity, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ingredient.spoken)
            .accessibilityAddTraits(checked ? .isSelected : [])
        case .prep(let key, let text):
            Button { tick(key) } label: {
                Text(text)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .strikethrough(checked, color: theme.accent)
                    .opacity(checked ? 0.38 : 1)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHidden(true) // read with its ingredient
        case .step(let line):
            Button { select(line.step.key) } label: {
                Sticky(viewport: viewport, mode: .centerVertically) { stepLabel(line) }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 12)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(line.spoken)
            .accessibilityAddTraits(emphasis == .selected ? .isSelected : [])
        case .fullWidth(let line):
            Button { select(line.step.key) } label: {
                Sticky(viewport: viewport, mode: .centerHorizontally) {
                    Text(([line.main] + line.facts).joined(separator: " · "))
                        .fontWeight(emphasis == .selected ? .semibold : .regular)
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .frame(minHeight: 44)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(line.spoken)
            .accessibilityAddTraits(emphasis == .selected ? .isSelected : [])
        case .sectionName(let name):
            Text(name.uppercased())
                .font(.footnote.weight(.bold))
                .tracking(1)
                .foregroundStyle(.tint)
                .padding(.leading, TableStyle.edge)
                .padding(.trailing, 8)
                .padding(.vertical, 7)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .accessibilityLabel(name)
                .accessibilityAddTraits(.isHeader)
        case .sectionBand(let lines):
            if lines.isEmpty {
                Color.clear.accessibilityHidden(true)
            } else {
                Sticky(viewport: viewport, mode: .leading(inset: viewport.pinnedWidth + 12)) {
                    HStack(spacing: 10) {
                        ForEach(lines, id: \.step.key) { line in
                            Button { select(line.step.key) } label: {
                                Text(([line.main] + line.facts).joined(separator: " "))
                                    .font(.footnote.weight(line.step.key == selectedStep ? .semibold : .regular))
                                    .frame(minHeight: 32)
                                    .contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(line.spoken)
                        }
                    }
                }
                .padding(.vertical, 4)
            }
        case .empty:
            Color.clear.accessibilityHidden(true)
        case .header(let lines):
            HStack(spacing: 6) {
                ForEach(lines, id: \.step.key) { line in
                    Button { select(line.step.key) } label: {
                        let on = line.step.key == selectedStep
                        Text(line.number, format: .number)
                            .font(.footnote.weight(.bold))
                            .monospacedDigit()
                            .foregroundStyle(on ? AnyShapeStyle(Color(.systemBackground)) : AnyShapeStyle(.tint))
                            .frame(width: badge, height: badge)
                            .background(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.tint.opacity(0.13)), in: .circle)
                            .frame(minWidth: 36, minHeight: 36)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 4)
            .accessibilityHidden(true) // the step cells say their numbers
        case .corner(let yield):
            Text("For \(yield)")
                .font(.footnote.weight(.semibold))
                .textCase(.uppercase)
                .tracking(0.8)
                .foregroundStyle(.secondary)
                .padding(.leading, TableStyle.edge)
                .padding(.trailing, 8)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { viewport.set(\.headerHeight, $0) }
                .accessibilityHidden(true)
        }
    }

    /// "300 g Mehl", the amount a shade stronger; note and optional quiet.
    private func ingredientLabel(_ line: IngredientLine) -> Text {
        let tail = Text(line.rest).foregroundStyle(.secondary)
        guard let amount = line.amount else { return Text("\(line.item)\(tail)") }
        return Text("\(amountLabel(amount, weight: .semibold)) \(line.item)\(tail)")
    }

    private func stepLabel(_ line: StepLine) -> some View {
        VStack(spacing: 4) {
            Text(line.main)
                .fontWeight(emphasis == .selected ? .semibold : .regular)
            ForEach(line.facts, id: \.self) { fact in
                Text(fact).foregroundStyle(.secondary)
            }
            if !line.passing.isEmpty {
                VStack(spacing: 2) {
                    ForEach(line.passing, id: \.self) { Text($0) }
                }
                .foregroundStyle(.secondary)
                .padding(.top, 8)
            }
        }
        .multilineTextAlignment(.center)
    }
}

/// Pinned layers follow the scroll: the ingredient column sideways, the header down the page, the corner both.
/// A soft shadow shows where content slides under them.
private struct Pin: ViewModifier {
    let layer: TableItem.Layer
    let viewport: TableViewport

    func body(content: Content) -> some View {
        switch layer {
        case .body:
            content
        case .pinned:
            content
                .overlay(alignment: .trailing) { edge(.horizontal, shown: viewport.scrollX > 1) }
                .offset(x: max(0, viewport.scrollX))
        case .header:
            content
                .overlay(alignment: .bottom) { edge(.vertical, shown: viewport.headerOffset > 1) }
                .offset(y: viewport.headerOffset)
        case .corner:
            content
                .overlay(alignment: .trailing) { edge(.horizontal, shown: viewport.scrollX > 1) }
                .overlay(alignment: .bottom) { edge(.vertical, shown: viewport.headerOffset > 1) }
                .offset(x: max(0, viewport.scrollX), y: viewport.headerOffset)
        }
    }

    private func edge(_ axis: Axis, shown: Bool) -> some View {
        let gradient = LinearGradient(
            colors: [.black.opacity(0.1), .clear],
            startPoint: axis == .horizontal ? .leading : .top,
            endPoint: axis == .horizontal ? .trailing : .bottom)
        return Rectangle()
            .fill(gradient)
            .frame(width: axis == .horizontal ? 8 : nil, height: axis == .vertical ? 8 : nil)
            .offset(x: axis == .horizontal ? 8 : 0, y: axis == .vertical ? 8 : 0)
            .opacity(shown ? 1 : 0)
            .animation(.easeOut(duration: 0.15), value: shown)
            .allowsHitTesting(false)
    }
}

/// Keeps a cell's text in the part of the cell on screen: a step spanning the whole table stays readable while it
/// scrolls past; "Springform einfetten" stays centred in the screen's slice of its full-width row.
private struct Sticky<Content: View>: View {
    enum Mode { case centerVertically, centerHorizontally, leading(inset: CGFloat) }

    let viewport: TableViewport
    let mode: Mode
    @ViewBuilder let content: Content
    @State private var frame: CGRect = .zero
    @State private var size: CGSize = .zero

    var body: some View {
        content
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: maxWidth)
            .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
            .offset(offset)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: alignment)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(TableSpace.name)) } action: { frame = $0 }
    }

    private var alignment: Alignment {
        if case .leading = mode { .leading } else { .center }
    }

    private var maxWidth: CGFloat? {
        switch mode {
        case .centerVertically: nil
        case .centerHorizontally: viewport.width > 0 ? max(80, viewport.width - 32) : nil
        case .leading(let inset):
            // Within the cell, and within the screen beside the pinned column, so it wraps instead of running off.
            frame.width > inset ? min(frame.width - inset - 8, max(80, viewport.width - viewport.pinnedWidth - 24)) : nil
        }
    }

    private var offset: CGSize {
        guard frame.width > 0, size.width > 0 else { return .zero }
        switch mode {
        case .centerVertically:
            let shown = viewport.visible(fullWidth: false)
            let low = max(frame.minY, shown.minY), high = min(frame.maxY, shown.maxY)
            guard high > low, size.height < frame.height else { return .zero }
            let top = min(max((low + high - size.height) / 2, frame.minY), frame.maxY - size.height)
            return CGSize(width: 0, height: top - (frame.midY - size.height / 2))
        case .centerHorizontally:
            let shown = viewport.visible(fullWidth: true)
            let low = max(frame.minX, shown.minX), high = min(frame.maxX, shown.maxX)
            guard high > low, size.width < frame.width else { return .zero }
            let left = min(max((low + high - size.width) / 2, frame.minX), frame.maxX - size.width)
            return CGSize(width: left - (frame.midX - size.width / 2), height: 0)
        case .leading(let inset):
            let shown = viewport.visible(fullWidth: false)
            let left = max(min(shown.minX + 12, frame.maxX - size.width - 8), frame.minX + inset)
            return CGSize(width: left - frame.minX, height: 0)
        }
    }
}

// MARK: layout

nonisolated private struct CellPlacement: LayoutValueKey {
    static let defaultValue = TableCell(row: 0, rowSpan: 1, column: 0, columnSpan: 1, content: .empty)
}

/// Places cells by row, column, and spans (`Grid` has no row spans). Row 0 is the header. Each cell draws its own
/// bottom and trailing hairline, so a pinned cell carries its lines with it.
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
