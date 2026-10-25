import Foundation
import Testing
@testable import SippetCore

private struct Golden: Decodable {
    struct ScaleCase: Decodable { var recipe: String; var toYield: Double; var expected: DeviceRecipe }
    struct MeasurableCase: Decodable { var amount: Amount; var expected: Amount }
    struct SystemCase: Decodable { var amount: Amount; var system: MeasurementSystem; var expected: Amount }
    struct TemperatureCase: Decodable { var temperature: Temperature; var system: MeasurementSystem; var expected: ShownTemperature }
    struct UnitLabelCase: Decodable { var unit: AmountUnit; var language: Language; var expected: String }
    struct ModeCase: Decodable { var mode: HeatingMode; var language: Language; var expected: String }
    struct TotalsCase: Decodable { var recipe: String; var expected: [ItemTotal] }
    struct SentenceCase: Decodable { var recipe: String; var step: String; var expected: String }
    struct FilterCase: Decodable { var recipe: String; var tags: [String]; var filter: RecipeFilter; var expected: Bool }

    var recipes: [String: DeviceRecipe]
    var scaleRecipe: [ScaleCase]
    var measurableAmount: [MeasurableCase]
    var amountInMeasurementSystem: [SystemCase]
    var temperatureInMeasurementSystem: [TemperatureCase]
    var unitLabel: [UnitLabelCase]
    var heatingModeLabel: [ModeCase]
    var itemTotals: [TotalsCase]
    var stepSentence: [SentenceCase]
    var recipeMatchesFilter: [FilterCase]
}

extension Language: Decodable {}
extension MeasurementSystem: Decodable {}

private let golden: Golden = {
    let data = try! Data(contentsOf: goldenFile("cooking.json"))
    return try! SippetJSON.decoder().decode(Golden.self, from: data)
}()

@Test func goldenScaleRecipe() {
    #expect(!golden.scaleRecipe.isEmpty)
    for c in golden.scaleRecipe {
        #expect(scaleRecipe(golden.recipes[c.recipe]!, toYield: c.toYield) == c.expected, "\(c.recipe) → \(c.toYield)")
    }
}

@Test func goldenMeasurableAmount() {
    for c in golden.measurableAmount { #expect(measurableAmount(c.amount) == c.expected, "\(c.amount)") }
}

@Test func goldenAmountInMeasurementSystem() {
    for c in golden.amountInMeasurementSystem {
        #expect(amountInMeasurementSystem(c.amount, system: c.system) == c.expected, "\(c.amount) \(c.system)")
    }
}

@Test func goldenTemperature() {
    for c in golden.temperatureInMeasurementSystem {
        #expect(temperatureInMeasurementSystem(c.temperature, system: c.system) == c.expected, "\(c.temperature) \(c.system)")
    }
}

@Test func goldenLabels() {
    for c in golden.unitLabel { #expect(unitLabel(c.unit, language: c.language) == c.expected) }
    for c in golden.heatingModeLabel { #expect(heatingModeLabel(c.mode, language: c.language) == c.expected) }
}

@Test func goldenItemTotals() {
    for c in golden.itemTotals { #expect(itemTotals(golden.recipes[c.recipe]!) == c.expected, "\(c.recipe)") }
}

@Test func goldenStepSentence() {
    #expect(!golden.stepSentence.isEmpty)
    for c in golden.stepSentence {
        let recipe = golden.recipes[c.recipe]!
        let step = recipe.steps.first { $0.key == c.step }!
        #expect(stepSentence(step, in: recipe) == c.expected, "\(c.recipe).\(c.step)")
    }
}

@Test func goldenRecipeMatchesFilter() {
    for c in golden.recipeMatchesFilter {
        #expect(recipeMatchesFilter(golden.recipes[c.recipe]!, tags: c.tags, filter: c.filter) == c.expected, "\(c.recipe) \(c.filter)")
    }
}

@Test func zupfkuchenScaledToSix() {
    let scaled = scaleRecipe(golden.recipes["zupfkuchen"]!, toYield: 6)
    func text(_ key: String) -> String { amountText(scaled.ingredients.first { $0.key == key }!.amount!, language: .de) }
    #expect(text("mehl") == "150 g")
    #expect(text("salz") == "⅛ TL (1 g)")
    #expect(text("vanillezucker") == "½ Pck.")
    let backen = scaled.steps.first { $0.key == "backen" }!
    #expect(backen.temperature == Temperature(celsius: 170, mode: .topBottom))
    #expect(durationText(backen.duration!, language: .de) == "60–65 Min.")
}
