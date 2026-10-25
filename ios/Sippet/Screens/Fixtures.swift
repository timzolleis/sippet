#if DEBUG
import SippetCore
import SwiftUI

/// Preview data. The previews below call SippetCore's cooking functions, so they render once its bodies land.
enum Fixtures {
    static let zupfkuchen = DeviceRecipe(
        id: "zupfkuchen", revision: 1, title: "Zupfkuchen",
        yield: Yield(amount: Amount(value: 12, unit: .code(.piece)), vessel: "26 cm Springform"),
        totalMinutes: 110,
        sections: [RecipeSection(key: "teig", name: "Teig"), RecipeSection(key: "fuellung", name: "Füllung")],
        equipment: [Equipment(key: "ofen", name: "Ofen"), Equipment(key: "mixer", name: "Mixer")],
        ingredients: [
            Ingredient(key: "mehl", item: "Mehl", amount: Amount(value: 250, unit: .code(.g)), section: "teig"),
            Ingredient(key: "zucker-teig", item: "Zucker", amount: Amount(value: 180, unit: .code(.g)), section: "teig"),
            Ingredient(key: "skyr", item: "Skyr", amount: Amount(value: 500, unit: .code(.g)), section: "fuellung"),
            Ingredient(key: "zucker-fuellung", item: "Zucker", amount: Amount(value: 200, unit: .code(.g)), section: "fuellung"),
        ],
        steps: [
            Step(key: "vorheizen", label: "Ofen vorheizen", temperature: Temperature(celsius: 170, mode: .topBottom),
                 flow: StepFlow(takes: [], waitsFor: [], makes: false)),
            Step(key: "mischen", label: "Teig mischen", section: "teig", uses: ["mehl", "zucker-teig"],
                 result: StepResult(name: "Teig"), flow: StepFlow(takes: [], waitsFor: [], makes: true)),
            Step(key: "verruehren", label: "mit dem Mixer gut verrühren", section: "fuellung", equipment: ["mixer"],
                 uses: ["skyr", "zucker-fuellung"], flow: StepFlow(takes: [], waitsFor: [], makes: true)),
            Step(key: "backen", label: "backen", equipment: ["ofen"],
                 duration: StepDuration(minutes: 60, maxMinutes: 65, kind: .passive),
                 temperature: Temperature(celsius: 170, mode: .topBottom),
                 flow: StepFlow(takes: ["mischen", "verruehren"], waitsFor: ["vorheizen"], makes: false)),
        ],
        hasFlow: true)
}

#Preview("Recipe") {
    NavigationStack { RecipeScreen(recipe: Fixtures.zupfkuchen) }
}

#Preview("Cook mode") {
    CookModeScreen(recipe: Fixtures.zupfkuchen, units: .asWritten)
}
#endif
