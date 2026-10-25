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
    nil // stub: the table lane implements this
}
