#if DEBUG
import Foundation
import SippetCore

/// `-SippetChurn` (with `-SippetDemo`): every 2 s a catch-up changes the library the way sync does, through
/// `LibraryStore.apply`: trash a recipe, reorder a collection, restore, tag and file a recipe, a new revision that
/// changes nothing visible, then back. To watch lists animate and not flash. Recordings only.
enum DemoChurn {
    @MainActor static func run(store: LibraryStore) async {
        guard ProcessInfo.processInfo.arguments.contains("-SippetChurn") else { return }
        var seq = (store.seq ?? 1) + 1
        let steps: [(inout [String: DeviceRecipe], inout LibraryOrganization) -> Void] = [
            { recipes, _ in trash("rcp_shakshuka", &recipes, true) },
            { _, organization in organization.collections[1].recipeIds.reverse() },
            { recipes, _ in trash("rcp_shakshuka", &recipes, false) },
            { _, organization in
                organization.tags[0].recipeIds.append("rcp_pfannkuchen")
                organization.collections[3].recipeIds.append("rcp_zimtschnecken")
            },
            { recipes, _ in recipes["rcp_dal"]?.revision += 1 },
            { _, organization in
                organization.tags[0].recipeIds.removeAll { $0 == "rcp_pfannkuchen" }
                organization.collections[3].recipeIds.removeAll()
                organization.collections[1].recipeIds.reverse()
            },
        ]
        for step in 0... {
            try? await Task.sleep(for: .seconds(2))
            if Task.isCancelled { return }
            var recipes = store.recipes
            var organization = store.organization
            steps[step % steps.count](&recipes, &organization)
            let changed = recipes.values.filter { store.recipes[$0.id] != $0 }
            try? store.apply(ChangesAfter(seq: seq, changes: [], recipes: changed, purgedRecipeIds: [], organization: organization))
            seq += 1
        }
    }

    private static func trash(_ id: String, _ recipes: inout [String: DeviceRecipe], _ on: Bool) {
        recipes[id]?.trashedAt = on ? .now : nil
        recipes[id]?.purgeAt = on ? .now.addingTimeInterval(30 * 86_400) : nil
    }
}
#endif
