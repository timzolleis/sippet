#if DEBUG
import SippetCore
import SwiftUI

/// Debug only: `-SippetOpen table:<recipe id>[:<yield>]` opens the recipe page on its table once the recipe is in the
/// store, so the Simulator can screenshot it. With `-SippetScrollSteps` the table starts under the bar;
/// `-SippetSelectStep <key>`, `-SippetTick <key,key>`, `-SippetTableX <points>` select, tick, and scroll sideways. Attach to the signed-in root: `.modifier(DebugOpenTable(store: model.store))`.
struct DebugOpenTable: ViewModifier {
    let store: LibraryStore
    @State private var shown: DeviceRecipe?
    @State private var opened = false

    private static let request: (id: String, yield: Double?)? = {
        guard let value = UserDefaults.standard.string(forKey: "SippetOpen"), value.hasPrefix("table:") else { return nil }
        let parts = value.split(separator: ":").map(String.init)
        guard parts.count >= 2 else { return nil }
        return (parts[1], parts.count > 2 ? Double(parts[2]) : nil)
    }()

    func body(content: Content) -> some View {
        content
            .onChange(of: store.recipes.count, initial: true) { open() }
            .fullScreenCover(item: $shown) { recipe in
                NavigationStack { RecipeScreen(recipe: recipe, mode: .table, yield: Self.request?.yield) }
            }
    }

    private func open() {
        guard !opened, let request = Self.request, let recipe = store.recipes[request.id] else { return }
        opened = true
        shown = recipe
    }
}
#endif
