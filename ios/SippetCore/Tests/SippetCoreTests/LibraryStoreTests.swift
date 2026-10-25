import Foundation
import Testing
@testable import SippetCore

@MainActor @Test func searchFindsWordsInTitleIngredientsAndSteps() {
    let store = LibraryStore(file: tempFile())
    let puder = recipe("a", title: "Waffeln", ingredients: ["Puderzucker"])
    let kase = recipe("b", title: "Käsekuchen")
    let rühr = recipe("c", title: "Suppe", steps: ["mit dem Mixer gut verrühren"])
    let trashed = recipe("d", title: "Zuckerkuchen", ingredients: ["Zucker"], trashed: true)
    let all = [puder, kase, rühr, trashed]
    #expect(store.search("zucker", in: all).map(\.id) == ["a"])
    #expect(store.search("rühr", in: all).map(\.id) == ["c"])
    #expect(store.search("Kase", in: all).map(\.id) == ["b"])
    #expect(store.search("kuchen", in: all).map(\.id) == ["b"])
    #expect(store.search("mixer verruhren", in: all).map(\.id) == ["c"])
    #expect(store.search("suppe mixer", in: all).map(\.id) == ["c"])
    #expect(store.search("suppe käse", in: all).isEmpty)
    #expect(store.search("", in: all).map(\.id) == ["a", "b", "c"])
}

@MainActor @Test func shortWordsMatchTheTitleOnly() {
    let store = LibraryStore(file: tempFile())
    let a = recipe("a", title: "Eis", ingredients: ["Mehl"])
    let b = recipe("b", title: "Brot", ingredients: ["Salz", "Ei"])
    #expect(store.search("ei", in: [a, b]).map(\.id) == ["a"])
}

private func library(seq: Int = 5) -> LibraryAtChange {
    LibraryAtChange(
        seq: seq,
        recipes: [
            recipe("z", title: "Zupfkuchen"), recipe("a", title: "Apfelkuchen"),
            DeviceRecipe(id: "t2", revision: 1, title: "Zweiter", yield: Yield(amount: Amount(value: 1)), trashedAt: Date(timeIntervalSince1970: 100), purgeAt: Date(timeIntervalSince1970: 3000)),
            DeviceRecipe(id: "t1", revision: 1, title: "Erster", yield: Yield(amount: Amount(value: 1)), trashedAt: Date(timeIntervalSince1970: 50), purgeAt: Date(timeIntervalSince1970: 2000)),
        ],
        organization: LibraryOrganization(
            tags: [TagView(name: "Kuchen", recipeIds: ["z", "a", "t1"])],
            collections: [CollectionView(name: "Sonntag", recipeIds: ["z", "a", "t1"])],
            smartCollections: [SmartCollectionView(name: "Kuchen-Fans", filter: RecipeFilter(tags: TagFilter(all: ["kuchen"])))]))
}

@MainActor @Test func libraryRoundTripsThroughTheFile() throws {
    let file = tempFile()
    let store = LibraryStore(file: file)
    #expect(store.seq == nil && store.library.isEmpty)
    try store.replace(with: library())
    let again = LibraryStore(file: file)
    #expect(again.seq == 5)
    #expect(again.recipes == store.recipes)
    #expect(again.organization == store.organization)
    #expect(again.recipes["t1"]?.purgeAt == Date(timeIntervalSince1970: 2000))
}

@MainActor @Test func libraryExcludesTrashAndTrashSortsByPurgeAt() throws {
    let store = LibraryStore(file: tempFile())
    try store.replace(with: library())
    #expect(store.library.map(\.title) == ["Apfelkuchen", "Zupfkuchen"])
    #expect(store.trash.map(\.id) == ["t1", "t2"])
}

@MainActor @Test func collectionsTagsAndSmartCollections() throws {
    let store = LibraryStore(file: tempFile())
    try store.replace(with: library())
    #expect(store.tags(of: "z") == ["Kuchen"])
    #expect(store.recipes(inCollection: "sonntag").map(\.id) == ["z", "a"])
    #expect(store.recipes(taggedWith: "KUCHEN").map(\.id) == ["a", "z"])
    #expect(store.recipes(matching: store.organization.smartCollections[0]).map(\.id) == ["a", "z"])
}

@MainActor @Test func applyUpsertsPurgesAndReplacesOrganization() throws {
    let file = tempFile()
    let store = LibraryStore(file: file)
    try store.replace(with: library())
    var revised = recipe("z", title: "Zupfkuchen")
    revised.revision = 2
    try store.apply(ChangesAfter(seq: 9, changes: [], recipes: [revised], purgedRecipeIds: ["t1"], organization: LibraryOrganization()))
    #expect(store.seq == 9 && store.recipes["z"]?.revision == 2 && store.recipes["t1"] == nil)
    #expect(store.organization.tags.isEmpty)
    try store.reset()
    #expect(!FileManager.default.fileExists(atPath: file.path) && store.recipes.isEmpty && store.seq == nil)
}
