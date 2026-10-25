import Foundation
import Observation

/// What library.json holds.
private struct Snapshot: Codable {
    var seq: Int?
    var recipes: [DeviceRecipe]
    var organization: LibraryOrganization
}

/// The device's copy of the library (sync rules 5, 6).
@MainActor @Observable
public final class LibraryStore {
    public private(set) var seq: Int?
    public private(set) var recipes: [String: DeviceRecipe] = [:]
    public private(set) var organization = LibraryOrganization()

    /// Not trashed, by title.
    public var library: [DeviceRecipe] {
        recipes.values.filter { $0.trashedAt == nil }.sorted(by: Self.byTitle)
    }

    /// By purgeAt, soonest first.
    public var trash: [DeviceRecipe] {
        recipes.values.filter { $0.trashedAt != nil }.sorted {
            switch ($0.purgeAt, $1.purgeAt) {
            case (let a?, let b?) where a != b: a < b
            case (nil, _?): false
            case (_?, nil): true
            default: Self.byTitle($0, $1)
            }
        }
    }

    private let file: URL

    /// Loads library.json at launch, before any network. A missing or unreadable file is an empty library.
    public init(file: URL) {
        self.file = file
        guard let data = try? Data(contentsOf: file), let snapshot = try? SippetJSON.decoder().decode(Snapshot.self, from: data) else { return }
        seq = snapshot.seq
        recipes = Dictionary(snapshot.recipes.map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })
        organization = snapshot.organization
    }

    private static func byTitle(_ a: DeviceRecipe, _ b: DeviceRecipe) -> Bool {
        let order = a.title.localizedStandardCompare(b.title)
        return order == .orderedSame ? a.id < b.id : order == .orderedAscending
    }

    public func tags(of recipeId: String) -> [String] {
        organization.tags.filter { $0.recipeIds.contains(recipeId) }.map(\.name)
    }

    /// cooking 9: every word in the title, an ingredient, or a step. Words under 3 letters match the title only.
    /// Trashed recipes never appear.
    public func search(_ text: String, in recipes: [DeviceRecipe]) -> [DeviceRecipe] {
        let words = text.split(whereSeparator: \.isWhitespace).map { searchable(String($0)) }
        return recipes.filter { recipe in
            guard recipe.trashedAt == nil else { return false }
            let title = searchable(recipe.title)
            let everything = searchableText(of: recipe)
            return words.allSatisfy { word in
                word.count < 3 ? title.contains(word) : everything.contains(word)
            }
        }
    }

    /// In the collection's order; trashed recipes left out.
    public func recipes(inCollection name: String) -> [DeviceRecipe] {
        guard let collection = organization.collections.first(where: { $0.name.lowercased() == name.lowercased() }) else { return [] }
        return collection.recipeIds.compactMap { recipes[$0] }.filter { $0.trashedAt == nil }
    }

    public func recipes(matching smart: SmartCollectionView) -> [DeviceRecipe] {
        library.filter { recipeMatchesFilter($0, tags: tags(of: $0.id), filter: smart.filter) }
    }

    public func recipes(taggedWith tag: String) -> [DeviceRecipe] {
        guard let view = organization.tags.first(where: { $0.name.lowercased() == tag.lowercased() }) else { return [] }
        let ids = Set(view.recipeIds)
        return library.filter { ids.contains($0.id) }
    }

    /// Replace everything (sync rule 6); writes library.json.
    public func replace(with library: LibraryAtChange) throws {
        seq = library.seq
        recipes = Dictionary(library.recipes.map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })
        organization = library.organization
        try save()
    }

    /// Upsert recipes, delete purged ones, replace the organization, set seq; writes library.json.
    public func apply(_ changes: ChangesAfter) throws {
        for recipe in changes.recipes { recipes[recipe.id] = recipe }
        for id in changes.purgedRecipeIds { recipes[id] = nil }
        organization = changes.organization
        seq = changes.seq
        try save()
    }

    /// Sign out: forget everything and delete library.json.
    public func reset() throws {
        seq = nil
        recipes = [:]
        organization = LibraryOrganization()
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }

    private func save() throws {
        let snapshot = Snapshot(seq: seq, recipes: Array(recipes.values), organization: organization)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try SippetJSON.encoder().encode(snapshot).write(to: file, options: .atomic)
    }
}
