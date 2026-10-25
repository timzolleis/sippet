// The table of a recipe with a flow, like the Zupfkuchen-Ablauf (cooking rule 1, specs/ios.md Table).
// Keys only: the screen renders text from the scaled recipe, so the table follows yield and units.

public struct RecipeTable: Sendable, Equatable {
    public var columns: Int
    public var rows: [TableRow]
    public var cells: [TableCell]

    public init(columns: Int, rows: [TableRow], cells: [TableCell]) {
        self.columns = columns
        self.rows = rows
        self.cells = cells
    }
}

public enum TableRow: Sendable, Equatable {
    case prepStep(String)
    case section(String)
    case ingredient(String)
}

public struct TableCell: Sendable, Equatable {
    public var row: Int
    public var rowSpan: Int
    public var column: Int
    public var columnSpan: Int
    public var content: TableCellContent

    public init(row: Int, rowSpan: Int, column: Int, columnSpan: Int, content: TableCellContent) {
        self.row = row
        self.rowSpan = rowSpan
        self.column = column
        self.columnSpan = columnSpan
        self.content = content
    }
}

public enum TableCellContent: Sendable, Equatable {
    case prepStep(String)
    case section(String, prepStepKeys: [String])
    case ingredient(String)
    case prep(String)
    case step(String, passingPortionKeys: [String])
    case empty
}

/// nil: no flow (recipe rule 10), or the flow can't be drawn as a table (cooking rule 1).
public func recipeTable(_ recipe: DeviceRecipe) -> RecipeTable? {
    guard recipe.hasFlow else { return nil }
    let flow = FlowGraph(recipe)
    let rows = tableRows(recipe, flow: flow)
    var grid = TableGrid(rows: rows, columns: flow.columns)

    for (index, row) in rows.enumerated() {
        switch row {
        case .prepStep(let key):
            grid.place(TableCell(row: index, rowSpan: 1, column: 0, columnSpan: flow.columns, content: .prepStep(key)))
        case .ingredient(let key):
            grid.place(TableCell(row: index, rowSpan: 1, column: 0, columnSpan: 1, content: .ingredient(key)))
            if flow.prepped.contains(key) {
                grid.place(TableCell(row: index, rowSpan: 1, column: 1, columnSpan: 1, content: .prep(key)))
            }
        case .section:
            break
        }
    }

    // A step spans the rows of every ingredient that reaches it, plus the section rows between them.
    var stepRows: [String: ClosedRange<Int>] = [:]
    for step in flow.steps {
        let reached = flow.reaching(step.key).compactMap { rows.firstIndex(of: .ingredient($0)) }
        guard let first = reached.min(), let last = reached.max() else { return nil }
        let span = first...last
        let contiguous = span.allSatisfy { index in
            if case .section = rows[index] { return true }
            return reached.contains(index)
        }
        guard contiguous else { return nil }
        stepRows[step.key] = span
    }

    // A portion passing a column is written in the step cell over its rows there.
    var passing: [String: [String]] = [:]
    for taker in flow.steps {
        for key in taker.flow?.takes ?? [] {
            guard let producer = flow.producerOfPortion[key], let rowsOfPortion = stepRows[producer],
                  let from = flow.column[producer], let to = flow.column[taker.key], from + 1 < to else { continue }
            for column in (from + 1)..<to {
                let over = flow.steps.first { step in
                    flow.column[step.key] == column && stepRows[step.key].map { $0.contains(rowsOfPortion) } == true
                }
                if let over { passing[over.key, default: []].append(key) }
            }
        }
    }

    for step in flow.steps {
        guard let span = stepRows[step.key], let column = flow.column[step.key] else { return nil }
        let cell = TableCell(
            row: span.lowerBound, rowSpan: span.count, column: column, columnSpan: 1,
            content: .step(step.key, passingPortionKeys: passing[step.key] ?? []))
        guard grid.place(cell) else { return nil }
    }

    // A section row spans from column 0 up to the first column a step crossing it occupies.
    for (index, row) in rows.enumerated() {
        guard case .section(let key) = row else { continue }
        let crossing = flow.steps.compactMap { step in stepRows[step.key]?.contains(index) == true ? flow.column[step.key] : nil }
        let span = crossing.min() ?? flow.columns
        let prepStepKeys = flow.prepSteps.filter { $0.section == key }.map(\.key)
        grid.place(TableCell(row: index, rowSpan: 1, column: 0, columnSpan: span, content: .section(key, prepStepKeys: prepStepKeys)))
    }

    grid.fillEmpty()
    return RecipeTable(columns: flow.columns, rows: rows, cells: grid.cells.sorted { ($0.row, $0.column) < ($1.row, $1.column) })
}

/// The steps that make something, with their columns and the ingredients reaching them.
private struct FlowGraph {
    var steps: [Step]
    var prepSteps: [Step]
    var prepped: Set<String>
    var producerOfPortion: [String: String] = [:]
    var column: [String: Int] = [:]
    var columns: Int
    private var stepsByKey: [String: Step] = [:]
    private var ingredientKeys: Set<String>

    init(_ recipe: DeviceRecipe) {
        let steps = recipe.steps.filter { $0.flow?.makes == true }
        let prepped = Set(recipe.ingredients.filter { !($0.prep ?? "").isEmpty }.map(\.key))
        let ingredientKeys = Set(recipe.ingredients.map(\.key))
        var producerOfPortion: [String: String] = [:]
        for step in steps {
            for portion in step.result?.split ?? [] { producerOfPortion[portion.key] = step.key }
        }
        // The author's order puts every step after what it takes (recipe rule 19), so one pass sets every column.
        var column: [String: Int] = [:]
        for step in steps {
            let used = (step.uses ?? []).filter(ingredientKeys.contains).map { prepped.contains($0) ? 1 : 0 }
            let taken = (step.flow?.takes ?? []).compactMap { column[producerOfPortion[$0] ?? $0] }
            column[step.key] = 1 + ((used + taken).max() ?? -1)
        }
        self.steps = steps
        self.prepSteps = recipe.steps.filter { $0.flow?.makes != true }
        self.prepped = prepped
        self.ingredientKeys = ingredientKeys
        self.producerOfPortion = producerOfPortion
        self.stepsByKey = Dictionary(uniqueKeysWithValues: steps.map { ($0.key, $0) })
        self.column = column
        self.columns = (column.values.max() ?? 0) + 1
    }

    /// The step a key in `takes` comes from: the step itself, or the step whose result it's a portion of.
    func producer(of key: String) -> String { producerOfPortion[key] ?? key }

    /// Every ingredient that reaches the step through uses and takes.
    func reaching(_ stepKey: String) -> Set<String> {
        guard let step = stepsByKey[stepKey] else { return [] }
        var result = Set((step.uses ?? []).filter(ingredientKeys.contains))
        for key in step.flow?.takes ?? [] { result.formUnion(reaching(producer(of: key))) }
        return result
    }
}

/// Prep steps without a section first or last; then each section's row and ingredients; then the rest.
private func tableRows(_ recipe: DeviceRecipe, flow: FlowGraph) -> [TableRow] {
    let sectionKeys = Set(recipe.sections.map(\.key))
    let firstUser = Dictionary(
        recipe.steps.enumerated().flatMap { index, step in (step.uses ?? []).map { ($0, index) } },
        uniquingKeysWith: min)
    func ordered(_ ingredients: [Ingredient]) -> [TableRow] {
        ingredients.enumerated()
            .sorted { (firstUser[$0.element.key] ?? .max, $0.offset) < (firstUser[$1.element.key] ?? .max, $1.offset) }
            .map { .ingredient($0.element.key) }
    }
    let loose = flow.prepSteps.filter { $0.section.map(sectionKeys.contains) != true }
    let firstSectioned = recipe.steps.firstIndex { $0.section.map(sectionKeys.contains) == true } ?? recipe.steps.count
    let index = Dictionary(uniqueKeysWithValues: recipe.steps.enumerated().map { ($1.key, $0) })
    let top = loose.filter { index[$0.key]! < firstSectioned }
    let bottom = loose.filter { index[$0.key]! >= firstSectioned }

    var rows: [TableRow] = top.map { .prepStep($0.key) }
    for section in recipe.sections {
        rows.append(.section(section.key))
        rows += ordered(recipe.ingredients.filter { $0.section == section.key })
    }
    rows += ordered(recipe.ingredients.filter { $0.section.map(sectionKeys.contains) != true })
    rows += bottom.map { .prepStep($0.key) }
    return rows
}

/// Which positions are taken; a cell over a taken position means the flow can't be drawn.
private struct TableGrid {
    var cells: [TableCell] = []
    private var taken: [[Bool]]
    private let columns: Int

    init(rows: [TableRow], columns: Int) {
        self.columns = columns
        taken = Array(repeating: Array(repeating: false, count: columns), count: rows.count)
    }

    @discardableResult
    mutating func place(_ cell: TableCell) -> Bool {
        let rows = cell.row..<(cell.row + cell.rowSpan), columns = cell.column..<(cell.column + cell.columnSpan)
        guard columns.upperBound <= self.columns,
              rows.allSatisfy({ r in columns.allSatisfy { !taken[r][$0] } }) else { return false }
        for r in rows { for c in columns { taken[r][c] = true } }
        cells.append(cell)
        return true
    }

    /// An ingredient skipping a column leaves its cell empty.
    mutating func fillEmpty() {
        for r in taken.indices {
            for c in 0..<columns where !taken[r][c] {
                place(TableCell(row: r, rowSpan: 1, column: c, columnSpan: 1, content: .empty))
            }
        }
    }
}
