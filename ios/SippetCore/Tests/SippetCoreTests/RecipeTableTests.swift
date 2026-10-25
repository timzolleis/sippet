import Foundation
import Testing
@testable import SippetCore

// specs/ios.md Table, Cases. Expected is stories/zupfkuchen-table.png.

private struct Recipes: Decodable { var recipes: [String: DeviceRecipe] }

private let recipes: [String: DeviceRecipe] = {
    let data = try! Data(contentsOf: goldenFile("cooking.json"))
    return try! SippetJSON.decoder().decode(Recipes.self, from: data).recipes
}()

private let zupfkuchen = recipeTable(recipes["zupfkuchen"]!)!

private func row(_ row: TableRow, in table: RecipeTable = zupfkuchen) -> Int { table.rows.firstIndex(of: row)! }
private func ingredientRow(_ key: String) -> Int { row(.ingredient(key)) }

private func stepCell(_ key: String, in table: RecipeTable = zupfkuchen) -> TableCell {
    table.cells.first { if case .step(key, _) = $0.content { true } else { false } }!
}

private func cells(atRow row: Int, in table: RecipeTable = zupfkuchen) -> [TableCell] {
    table.cells.filter { $0.row == row }.sorted { $0.column < $1.column }
}

private func rows(_ cell: TableCell) -> ClosedRange<Int> { cell.row...(cell.row + cell.rowSpan - 1) }

@Test func zupfkuchenHasSevenColumnsAndTheRowsOfThePicture() {
    #expect(zupfkuchen.columns == 7)
    #expect(zupfkuchen.rows == [
        .prepStep("einfetten"),
        .section("teig"),
        .ingredient("mehl"), .ingredient("zucker-teig"), .ingredient("vanillezucker"), .ingredient("backpulver"),
        .ingredient("kakao"), .ingredient("salz"), .ingredient("butter-teig"),
        .section("fuellung"),
        .ingredient("skyr"), .ingredient("zucker-fuellung"), .ingredient("zitronensaft"), .ingredient("zitronenaroma"),
        .ingredient("zitronenschale"), .ingredient("butter-fuellung"), .ingredient("puddingpulver"),
    ])
}

@Test func einfettenSpansTheFullWidthAndVorheizenStandsInTheFuellungHeader() {
    #expect(cells(atRow: 0) == [TableCell(row: 0, rowSpan: 1, column: 0, columnSpan: 7, content: .prepStep("einfetten"))])
    let teig = row(.section("teig"))
    #expect(cells(atRow: teig) == [TableCell(row: teig, rowSpan: 1, column: 0, columnSpan: 7, content: .section("teig", prepStepKeys: []))])
    let fuellung = row(.section("fuellung"))
    #expect(cells(atRow: fuellung).first == TableCell(
        row: fuellung, rowSpan: 1, column: 0, columnSpan: 4, content: .section("fuellung", prepStepKeys: ["vorheizen"])))
}

@Test func mischenAndVerkneten() {
    let mischen = stepCell("mischen")
    #expect(mischen.column == 1 && mischen.columnSpan == 1)
    #expect(rows(mischen) == ingredientRow("mehl")...ingredientRow("salz"))
    let verkneten = stepCell("verkneten")
    #expect(verkneten.column == 2)
    #expect(rows(verkneten) == ingredientRow("mehl")...ingredientRow("butter-teig"))
    let teigbutter = cells(atRow: ingredientRow("butter-teig"))
    #expect(teigbutter.first { $0.column == 1 }?.content == .empty)
}

@Test func prepCellsAndVerruehren() {
    #expect(cells(atRow: ingredientRow("zitronensaft")).first { $0.column == 1 }?.content == .prep("zitronensaft"))
    #expect(cells(atRow: ingredientRow("butter-fuellung")).first { $0.column == 1 }?.content == .prep("butter-fuellung"))
    let verruehren = stepCell("verruehren")
    #expect(verruehren.column == 2)
    #expect(rows(verruehren) == ingredientRow("skyr")...ingredientRow("butter-fuellung"))
}

@Test func untermixen() {
    let untermixen = stepCell("untermixen")
    #expect(untermixen.column == 3)
    #expect(rows(untermixen) == ingredientRow("skyr")...ingredientRow("puddingpulver"))
    let pudding = cells(atRow: ingredientRow("puddingpulver"))
    #expect(pudding.map(\.content) == [.ingredient("puddingpulver"), .empty, .empty])
    #expect(pudding.map(\.column) == [0, 1, 2])
}

@Test func bodenCarriesThePassingZupfteig() {
    let boden = stepCell("boden")
    #expect(boden.column == 3)
    #expect(rows(boden) == ingredientRow("mehl")...ingredientRow("butter-teig"))
    #expect(boden.content == .step("boden", passingPortionKeys: ["zupfteig"]))
}

@Test func giessenBackenAuskuehlenSpanEverythingWithTheFuellungRow() {
    for (key, column) in [("giessen", 4), ("backen", 5), ("auskuehlen", 6)] {
        let cell = stepCell(key)
        #expect(cell.column == column, "\(key)")
        #expect(rows(cell) == ingredientRow("mehl")...ingredientRow("puddingpulver"), "\(key)")
        #expect(cell.content == .step(key, passingPortionKeys: []), "\(key)")
    }
}

@Test func everyPositionIsCoveredExactlyOnce() {
    var covered = Array(repeating: Array(repeating: 0, count: zupfkuchen.columns), count: zupfkuchen.rows.count)
    for cell in zupfkuchen.cells {
        for r in rows(cell) { for c in cell.column..<(cell.column + cell.columnSpan) { covered[r][c] += 1 } }
    }
    #expect(covered.allSatisfy { $0.allSatisfy { $0 == 1 } })
}

@Test func pastaWithPlainStepsHasNoTable() {
    #expect(recipeTable(recipes["pasta"]!) == nil)
}

/// Sections a, b, c: "join" uses an ingredient from a and one from c; b's step joins neither.
@Test func aStepAcrossASectionItDoesNotJoinHasNoTable() {
    let flow = StepFlow(takes: [], waitsFor: [], makes: true)
    let recipe = DeviceRecipe(
        id: "r", revision: 1, title: "Drei Schüsseln", yield: Yield(amount: Amount(value: 4)),
        sections: [RecipeSection(key: "a", name: "A"), RecipeSection(key: "b", name: "B"), RecipeSection(key: "c", name: "C")],
        ingredients: [
            Ingredient(key: "a1", item: "Mehl", section: "a"),
            Ingredient(key: "b1", item: "Zucker", section: "b"),
            Ingredient(key: "c1", item: "Salz", section: "c"),
        ],
        steps: [
            Step(key: "b", label: "rühren", section: "b", uses: ["b1"], flow: flow),
            Step(key: "join", label: "mischen", uses: ["a1", "c1"], flow: flow),
        ],
        hasFlow: true)
    #expect(recipeTable(recipe) == nil)
}

@Test func aStepJoiningTheSectionBetweenIsDrawn() {
    let recipe = DeviceRecipe(
        id: "r", revision: 1, title: "Drei Schüsseln", yield: Yield(amount: Amount(value: 4)),
        sections: [RecipeSection(key: "a", name: "A"), RecipeSection(key: "b", name: "B"), RecipeSection(key: "c", name: "C")],
        ingredients: [
            Ingredient(key: "a1", item: "Mehl", section: "a"),
            Ingredient(key: "b1", item: "Zucker", section: "b"),
            Ingredient(key: "c1", item: "Salz", section: "c"),
        ],
        steps: [
            Step(key: "b", label: "rühren", section: "b", uses: ["b1"], flow: StepFlow(takes: [], waitsFor: [], makes: true)),
            Step(key: "join", label: "mischen", uses: ["a1", "c1"], flow: StepFlow(takes: ["b"], waitsFor: [], makes: true)),
        ],
        hasFlow: true)
    let table = recipeTable(recipe)
    #expect(table?.columns == 3)
    #expect(table.map { rows(stepCell("join", in: $0)) } == 1...5)
}
