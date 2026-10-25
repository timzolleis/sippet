import SippetCore
import SwiftUI

/// The recipe as a table (cooking rule 1). `recipe` is already scaled. Stub: the table lane implements this.
struct RecipeTableScreen: View {
    let recipe: DeviceRecipe
    let units: MeasurementSystem

    var body: some View {
        Text(recipe.title)
    }
}
