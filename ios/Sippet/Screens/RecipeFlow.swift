import SippetCore
import SwiftUI

// The recipe page with the flow woven in (ios.md Recipe screen): ingredients grouped by the step that takes them,
// steps on a rail whose lanes show parallel parts and where they meet. Recipes without a flow (recipe rule 10) get the
// plain list and a plain rail.

// MARK: lanes

/// The steps of a flow laid out in lanes, in the author's order (recipe rule 19). A lane carries a step's result down
/// to the steps that take it; a step that takes nothing starts in the first free lane. Where a step takes from several
/// lanes, they end in it (Teig and Füllung at "gießen"). A split's portions ride in their step's lane until taken.
/// Layout only: what goes where comes from `step.flow`.
struct FlowRail: Equatable {
    struct Row: Equatable {
        var lane: Int
        /// Its own lane brings something from above.
        var fromAbove = false
        /// Its own lane carries its result (or a portion riding along) down.
        var toBelow = false
        /// Other lanes running straight past.
        var passing: [Int] = []
        /// Other lanes that bring something into this step: they curve into its node.
        var into: [Int] = []
    }

    var rows: [Row] = []
    var lanes = 1
    /// Per step, the steps whose results or portions it takes, and the steps taking its own.
    var takesFrom: [[Int]] = []
    var takenBy: [[Int]] = []
    /// recipe rule 17.
    var waitsFor: [[Int]] = []
    var waitedBy: [[Int]] = []

    init(_ recipe: DeviceRecipe) {
        let steps = recipe.steps
        var producer: [String: Int] = [:]
        for (i, step) in steps.enumerated() {
            producer[step.key] = i
            for portion in step.result?.split ?? [] { producer[portion.key] = i }
        }
        let index = Dictionary(steps.enumerated().map { ($1.key, $0) }, uniquingKeysWith: { a, _ in a })
        takesFrom = steps.map { step in unique((step.flow?.takes ?? step.takes ?? []).compactMap { producer[$0] }) }
        waitsFor = steps.map { step in unique((step.flow?.waitsFor ?? step.waitsFor ?? []).compactMap { index[$0] }) }
        takenBy = Array(repeating: [], count: steps.count)
        waitedBy = Array(repeating: [], count: steps.count)
        for (i, sources) in takesFrom.enumerated() { for s in sources { takenBy[s].append(i) } }
        for (i, sources) in waitsFor.enumerated() { for s in sources { waitedBy[s].append(i) } }

        // Each slot holds the steps still to take what it carries.
        var slots: [Set<Int>?] = []
        for i in steps.indices {
            let incoming = slots.indices.filter { slots[$0]?.contains(i) == true }
            let lane = incoming.first ?? slots.firstIndex { $0 == nil } ?? slots.count
            if lane == slots.count { slots.append(nil) }
            let above = Set(slots.indices.filter { slots[$0] != nil })
            for s in incoming { slots[s]?.remove(i) }
            var row = Row(lane: lane, fromAbove: incoming.contains(lane))
            row.into = incoming.filter { $0 != lane }
            for s in row.into where slots[s]?.isEmpty == true { slots[s] = nil }
            let carried = (slots[lane] ?? []).union(takenBy[i])
            slots[lane] = carried.isEmpty ? nil : carried
            row.toBelow = slots[lane] != nil
            row.passing = slots.indices.filter { $0 != lane && slots[$0] != nil && above.contains($0) }.sorted()
            while slots.last == .some(nil) { slots.removeLast() }
            lanes = max(lanes, slots.count, lane + 1)
            rows.append(row)
        }
    }

    /// Lanes running down from row `i` to the next row.
    func below(_ i: Int) -> [Int] {
        guard rows.indices.contains(i) else { return [] }
        let row = rows[i]
        return (row.passing + (row.toBelow ? [row.lane] : [])).sorted()
    }

    /// For the collapsed rail: the part a step's input comes from, by section, else its result's name, else its number.
    func partName(_ i: Int, in recipe: DeviceRecipe) -> String {
        let step = recipe.steps[i]
        if let key = step.section, let name = recipe.sections.first(where: { $0.key == key })?.name { return name }
        if let name = step.result?.name { return name }
        return String(localized: "step \(i + 1)")
    }
}

private func unique(_ values: [Int]) -> [Int] {
    var seen = Set<Int>()
    return values.filter { seen.insert($0).inserted }
}

// MARK: steps

/// Zubereitung: numbered nodes on a rail, the sentence beside each, what goes in quietly under it.
/// With a flow, parallel parts run in their own lanes and meet at the step that takes both; at accessibility sizes (or
/// more than three lanes) the lanes collapse to one rail, and a step that brings parts together says so ("joins Teig").
struct FlowSteps: View {
    let recipe: DeviceRecipe
    let units: MeasurementSystem
    let cook: (Int) -> Void
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var scaledBadge: CGFloat = 28

    private enum Item: Identifiable {
        case section(String, before: Int)
        case step(Int)
        var id: String {
            switch self {
            case .section(_, let before): "section-\(before)"
            case .step(let i): "step-\(i)"
            }
        }
    }

    var body: some View {
        let rail = FlowRail(recipe)
        let collapsed = !recipe.hasFlow || typeSize.isAccessibilitySize || rail.lanes > 3
        let geometry = RailGeometry(badge: min(scaledBadge, 44), lanes: collapsed ? 1 : rail.lanes)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(items) { item in
                switch item {
                case .section(let name, let before):
                    sectionRow(name, before: before, rail: rail, collapsed: collapsed, geometry: geometry)
                case .step(let i):
                    FlowStepRow(
                        index: i, recipe: recipe, units: units, rail: rail, collapsed: collapsed, plain: !recipe.hasFlow,
                        geometry: geometry, cook: { cook(i) })
                }
            }
        }
    }

    /// A section label ("FÜLLUNG") where the steps enter a section; none when they leave one.
    private var items: [Item] {
        var items: [Item] = []
        var current: String?
        for (i, step) in recipe.steps.enumerated() {
            if step.section != current, let key = step.section, let name = recipe.sections.first(where: { $0.key == key })?.name {
                items.append(.section(name, before: i))
            }
            current = step.section
            items.append(.step(i))
        }
        return items
    }

    private func sectionRow(_ name: String, before i: Int, rail: FlowRail, collapsed: Bool, geometry: RailGeometry) -> some View {
        let lines: [RailLine] = collapsed
            ? (i > 0 ? [RailLine(lane: 0, dotted: !recipe.hasFlow ? false : !rail.takesFrom[i].contains(i - 1))] : [])
            : rail.below(i - 1).map { RailLine(lane: $0, dotted: false) }
        return Eyebrow(verbatim: name)
            .padding(.leading, geometry.width + geometry.gap)
            .padding(.top, 4)
            .padding(.bottom, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(alignment: .leading) { PassingLines(lines: lines, geometry: geometry) }
            .accessibilityAddTraits(.isHeader)
    }
}

/// Lane positions: lane 0 under the first node, the others a little more than a node's radius apart, so a line passes
/// beside a node without touching it.
struct RailGeometry {
    let badge: CGFloat
    let lanes: Int
    var spacing: CGFloat { badge * 0.85 }
    var width: CGFloat { badge + CGFloat(lanes - 1) * spacing }
    var gap: CGFloat { 14 }
    /// The node's centre, from the row's top; the rows above end here.
    var nodeTop: CGFloat { 16 }
    func x(_ lane: Int) -> CGFloat { badge / 2 + CGFloat(lane) * spacing }
}

struct RailLine: Hashable {
    let lane: Int
    let dotted: Bool
}

private let railWidth: CGFloat = 2

/// Straight lines through a row with no node: section labels.
private struct PassingLines: View {
    let lines: [RailLine]
    let geometry: RailGeometry

    var body: some View {
        GeometryReader { geo in
            ForEach(lines, id: \.self) { line in
                Path { p in
                    p.move(to: CGPoint(x: geometry.x(line.lane), y: 0))
                    p.addLine(to: CGPoint(x: geometry.x(line.lane), y: geo.size.height))
                }
                .stroke(.tint.opacity(line.dotted ? 0.4 : 0.3), style: RailStyle.stroke(dotted: line.dotted))
            }
        }
        .frame(width: geometry.width)
        .accessibilityHidden(true)
    }
}

enum RailStyle {
    static func stroke(dotted: Bool) -> StrokeStyle {
        dotted
            ? StrokeStyle(lineWidth: railWidth, lineCap: .round, dash: [0.1, 6])
            : StrokeStyle(lineWidth: railWidth, lineCap: .round)
    }
}

/// One step: its node on the rail, the lines through its row, the sentence and what goes in.
private struct FlowStepRow: View {
    let index: Int
    let recipe: DeviceRecipe
    let units: MeasurementSystem
    let rail: FlowRail
    let collapsed: Bool
    let plain: Bool
    let geometry: RailGeometry
    let cook: () -> Void

    private var step: Step { recipe.steps[index] }
    private var isLast: Bool { index == recipe.steps.count - 1 }
    private var lane: Int { collapsed ? 0 : rail.rows[index].lane }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if collapsed, let joins = joinsText {
                Label(joins, systemImage: "arrow.triangle.merge")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tint)
            }
            Text(stepText(step))
                .font(.body)
                .lineSpacing(5)
                .fixedSize(horizontal: false, vertical: true)
            if let inputs = inputsLine {
                inputs
                    .font(.subheadline)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(waitLines, id: \.text) { line in
                Label(line.text, systemImage: line.icon)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            let facts = stepFacts(step, in: recipe, units: units)
            if !facts.isEmpty {
                FactRow(facts: facts).font(.subheadline)
            }
        }
        // The first line of text sits level with the node.
        .padding(.top, geometry.nodeTop - geometry.badge / 2 + max(0, (geometry.badge - 22) / 2))
        .padding(.bottom, isLast ? 0 : 26)
        .padding(.leading, geometry.width + geometry.gap)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(alignment: .leading) { lines }
        .overlay(alignment: .topLeading) {
            node.offset(x: geometry.x(lane) - geometry.badge / 2, y: geometry.nodeTop - geometry.badge / 2)
        }
        .contentShape(.rect)
        .contextMenu {
            Button("Cook from here", systemImage: "play.fill", action: cook)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
        .accessibilityAction(named: Text("Cook from here"), cook)
    }

    // MARK: rail

    /// A filled disc; a step something waits for (recipe rule 17) is a ring: do it ahead.
    private var node: some View {
        let waited = !rail.waitedBy[index].isEmpty
        // Sized from the node, which stops growing at accessibility sizes, so "10" always fits.
        return Text(index + 1, format: .number)
            .font(.system(size: geometry.badge * 0.5, weight: .bold, design: .rounded))
            .monospacedDigit()
            .minimumScaleFactor(0.7)
            .foregroundStyle(waited ? AnyShapeStyle(.tint) : AnyShapeStyle(Color(.systemBackground)))
            .frame(width: geometry.badge, height: geometry.badge)
            .background {
                if waited {
                    Circle().fill(Color(.systemBackground))
                    Circle().strokeBorder(.tint, style: StrokeStyle(lineWidth: 2, dash: [3, 2.5]))
                } else {
                    Circle().fill(.tint)
                }
            }
            .accessibilityHidden(true)
    }

    private var lines: some View {
        GeometryReader { geo in
            let h = geo.size.height
            let node = CGPoint(x: geometry.x(lane), y: geometry.nodeTop)
            let segments = segments(height: h, node: node)
            ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                segment.path.stroke(.tint.opacity(segment.dotted ? 0.4 : 0.3), style: RailStyle.stroke(dotted: segment.dotted))
            }
        }
        .frame(width: geometry.width)
        .accessibilityHidden(true)
    }

    private struct Segment {
        let path: Path
        let dotted: Bool
    }

    private func segments(height h: CGFloat, node: CGPoint) -> [Segment] {
        func straight(_ x: CGFloat, _ from: CGFloat, _ to: CGFloat) -> Path {
            Path { p in
                p.move(to: CGPoint(x: x, y: from))
                p.addLine(to: CGPoint(x: x, y: to))
            }
        }
        if collapsed {
            // One rail: solid where a step takes from the one before, dotted where it starts something new.
            var out: [Segment] = []
            if index > 0 {
                out.append(Segment(path: straight(node.x, 0, node.y), dotted: !plain && !rail.takesFrom[index].contains(index - 1)))
            }
            if !isLast {
                out.append(Segment(path: straight(node.x, node.y, h), dotted: !plain && !rail.takesFrom[index + 1].contains(index)))
            }
            return out
        }
        let row = rail.rows[index]
        var out: [Segment] = []
        for lane in row.passing { out.append(Segment(path: straight(geometry.x(lane), 0, h), dotted: false)) }
        if row.fromAbove { out.append(Segment(path: straight(node.x, 0, node.y), dotted: false)) }
        if row.toBelow { out.append(Segment(path: straight(node.x, node.y, h), dotted: false)) }
        for lane in row.into {
            let x = geometry.x(lane)
            out.append(Segment(path: Path { p in
                p.move(to: CGPoint(x: x, y: 0))
                p.addCurve(
                    to: node,
                    control1: CGPoint(x: x, y: node.y * 0.75),
                    control2: CGPoint(x: node.x + (x - node.x) * 0.35, y: node.y))
            }, dotted: false))
        }
        return out
    }

    // MARK: text

    /// "500 g Boden · 200 g vegane Butter": what comes in from earlier steps, then the ingredients it adds.
    private var inputsLine: Text? {
        var parts: [Text] = []
        for part in takenParts(step, in: recipe, units: units) {
            parts.append(part.amount.map { Text("\(Text(nbsp($0)).fontWeight(.semibold))\u{00A0}\(nbsp(part.name))") } ?? Text(nbsp(part.name)))
        }
        for key in step.uses ?? [] {
            guard let ingredient = recipe.ingredients.first(where: { $0.key == key }) else { continue }
            let amount = ingredient.amount.map { Format.amount($0, system: units) }
            parts.append(amount.map { Text("\(Text(nbsp($0)).fontWeight(.semibold))\u{00A0}\(nbsp(ingredient.item))") } ?? Text(nbsp(ingredient.item)))
        }
        guard var line = parts.first else { return nil }
        for part in parts.dropFirst() { line = Text("\(line)\u{00A0}\u{00A0}·  \(part)") }
        return line
    }

    /// recipe rule 17, both ends: "Step 9 waits for this", "Waits for step 5".
    private var waitLines: [(text: String, icon: String)] {
        var lines: [(String, String)] = []
        if !rail.waitedBy[index].isEmpty {
            let numbers = rail.waitedBy[index].map { String($0 + 1) }.formatted(.list(type: .and))
            lines.append((rail.waitedBy[index].count == 1
                ? String(localized: "Step \(numbers) waits for this")
                : String(localized: "Steps \(numbers) wait for this"), "bell"))
        }
        if !rail.waitsFor[index].isEmpty {
            let numbers = rail.waitsFor[index].map { String($0 + 1) }.formatted(.list(type: .and))
            lines.append((String(localized: "Waits for step \(numbers)"), "hourglass"))
        }
        return lines
    }

    /// The collapsed rail can't show lanes meeting: "Joins Teig from steps 3 and 4".
    private var joinsText: String? {
        let others = rail.takesFrom[index].filter { $0 != index - 1 }.sorted()
        guard !others.isEmpty else { return nil }
        var names: [String] = []
        for s in others {
            let name = rail.partName(s, in: recipe)
            if !names.contains(name) { names.append(name) }
        }
        let parts = names.formatted(.list(type: .and))
        let steps = others.map { String($0 + 1) }.formatted(.list(type: .and))
        return others.count == 1
            ? String(localized: "Joins \(parts) from step \(steps)")
            : String(localized: "Joins \(parts) from steps \(steps)")
    }

    private var spoken: String {
        var parts = [String(localized: "Step \(index + 1)"), stepText(step)]
        if collapsed, let joins = joinsText { parts.insert(joins, at: 1) }
        let taken = takenParts(step, in: recipe, units: units).map { [$0.amount, $0.name].compactMap { $0 }.joined(separator: " ") }
        let used = (step.uses ?? []).compactMap { key in recipe.ingredients.first { $0.key == key } }
            .map { Format.ingredientLine($0, system: units) }
        if !(taken + used).isEmpty { parts.append((taken + used).joined(separator: ", ")) }
        parts += waitLines.map(\.text)
        parts += stepFacts(step, in: recipe, units: units).map(\.text)
        return parts.joined(separator: ". ")
    }
}

/// Lines break between ingredients, never inside "1 Pck. Vanillezucker".
func nbsp(_ s: String) -> String { s.replacingOccurrences(of: " ", with: "\u{00A0}") }

// MARK: ingredients

/// Zutaten by section (cooking 3), and within a section by the step that takes them: each run of ingredients has a
/// thin bracket on the right with that step's number and label ("300 g Mehl … 50 g Kakao ┤ 2 mischen").
/// Checks are the page's (cooking 3). At accessibility sizes, or in a narrow column (iPad's left column, a small
/// phone), the step goes under its run instead, so the items keep their width.
struct FlowIngredientList: View {
    let recipe: DeviceRecipe
    let units: MeasurementSystem
    @Binding var checked: Set<String>
    @State private var amountWidth: CGFloat = 0
    @State private var width: CGFloat = 0
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var checkWidth: CGFloat = 22
    /// Below this, a bracket column would squeeze the items.
    @ScaledMetric(relativeTo: .body) private var bracketMinWidth: CGFloat = 330

    private var stacked: Bool { typeSize.isAccessibilitySize || (width > 0 && width < bracketMinWidth) }

    struct Run: Identifiable {
        let step: Int?
        let rows: [IngredientRowData]
        var id: String { rows.first?.id ?? "" }
    }

    struct Group: Identifiable {
        let title: String?
        let runs: [Run]
        var id: String { title ?? "" }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            ForEach(groups) { group in
                VStack(alignment: .leading, spacing: 0) {
                    if let title = group.title {
                        Eyebrow(verbatim: title)
                            .padding(.bottom, 6)
                            .accessibilityAddTraits(.isHeader)
                    }
                    ForEach(Array(group.runs.enumerated()), id: \.element.id) { r, run in
                        if r > 0 { Divider().padding(.leading, checkWidth + 12) }
                        runView(run)
                    }
                }
            }
        }
        .onPreferenceChange(AmountWidthKey.self) { amountWidth = $0 }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }

    @ViewBuilder private func runView(_ run: Run) -> some View {
        let rows = VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(run.rows.enumerated()), id: \.element.id) { i, row in
                if i > 0 { Divider().padding(.leading, checkWidth + 12) }
                IngredientRow(row: row, checked: $checked, amountWidth: amountWidth, maxWidth: 80)
            }
        }
        if let i = run.step {
            if stacked {
                VStack(alignment: .leading, spacing: 0) {
                    rows
                    StepTag(number: i + 1, label: recipe.steps[i].label, bracket: false)
                        .padding(.leading, checkWidth + 12)
                        .padding(.bottom, 8)
                }
            } else {
                HStack(alignment: .center, spacing: 6) {
                    rows
                    StepTag(number: i + 1, label: recipe.steps[i].label, bracket: true)
                        .frame(maxHeight: .infinity)
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        } else {
            rows
        }
    }

    /// Loose ingredients first, then each section; within one, by the step that takes them, else as written.
    private var groups: [Group] {
        let byStep = Dictionary(
            recipe.steps.enumerated().flatMap { i, step in (step.uses ?? []).map { ($0, i) } },
            uniquingKeysWith: { a, _ in a })
        func runs(_ items: [Ingredient]) -> [Run] {
            let ordered = items.enumerated()
                .sorted { (byStep[$0.element.key] ?? .max, $0.offset) < (byStep[$1.element.key] ?? .max, $1.offset) }
                .map(\.element)
            var runs: [(step: Int?, items: [Ingredient])] = []
            for ingredient in ordered {
                let step = byStep[ingredient.key]
                if let last = runs.last, last.step == step {
                    runs[runs.count - 1].items.append(ingredient)
                } else {
                    runs.append((step, [ingredient]))
                }
            }
            return runs.map { run in
                Run(step: run.step, rows: run.items.map {
                    IngredientRowData(id: $0.key, amount: $0.amount.map { a in Format.amount(a, system: units) }, text: ingredientText($0))
                })
            }
        }
        var groups: [Group] = []
        let loose = recipe.ingredients.filter { $0.section == nil }
        if !loose.isEmpty { groups.append(Group(title: nil, runs: runs(loose))) }
        for section in recipe.sections {
            let items = recipe.ingredients.filter { $0.section == section.key }
            if !items.isEmpty { groups.append(Group(title: section.name, runs: runs(items))) }
        }
        return groups
    }
}

/// "┤ 2 mischen": a hairline bracket over the run's height, the step's number and label beside its middle.
private struct StepTag: View {
    let number: Int
    let label: String
    let bracket: Bool
    /// Room for "2 verkneten" on one line; longer labels wrap.
    @ScaledMetric(relativeTo: .footnote) private var labelWidth: CGFloat = 80

    var body: some View {
        HStack(alignment: .center, spacing: 4) {
            if bracket {
                Bracket()
                    .stroke(.tint.opacity(0.45), style: StrokeStyle(lineWidth: 1, lineCap: .round, lineJoin: .round))
                    .frame(width: 10)
                    .padding(.vertical, 10)
            } else {
                Image(systemName: "arrow.turn.down.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tint.opacity(0.6))
            }
            // A label is short ("mischen"); a long one keeps three lines, the steps below have it in full.
            Text("\(Text(number, format: .number).fontWeight(.bold).foregroundStyle(.tint))\u{202F}\u{202F}\(label)")
                .font(.footnote)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .lineLimit(bracket ? 3 : nil)
                .fixedSize(horizontal: false, vertical: true)
                .frame(width: bracket ? labelWidth : nil, alignment: .leading)
        }
        .padding(.vertical, bracket ? 0 : 6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Step \(number), \(label)"))
    }
}

/// "]" with a stub to the right at its middle.
nonisolated private struct Bracket: Shape {
    func path(in rect: CGRect) -> Path {
        Path { p in
            let x = rect.minX + 4
            p.move(to: CGPoint(x: rect.minX, y: rect.minY))
            p.addLine(to: CGPoint(x: x, y: rect.minY))
            p.addLine(to: CGPoint(x: x, y: rect.maxY))
            p.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
            p.move(to: CGPoint(x: x, y: rect.midY))
            p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        }
    }
}
