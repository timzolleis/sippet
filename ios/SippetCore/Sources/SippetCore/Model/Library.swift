import Foundation

public struct TagFilter: Codable, Sendable, Hashable {
    public var all: [String]?
    public var any: [String]?
    public var none: [String]?

    public init(all: [String]? = nil, any: [String]? = nil, none: [String]? = nil) {
        self.all = all
        self.any = any
        self.none = none
    }
}

/// library rule 13, cooking rule 9.
public struct RecipeFilter: Codable, Sendable, Hashable {
    public var tags: TagFilter?
    public var items: [String]?
    public var maxTotalMinutes: Double?
    public var hasFlow: Bool?
    public var text: String?

    public init(tags: TagFilter? = nil, items: [String]? = nil, maxTotalMinutes: Double? = nil, hasFlow: Bool? = nil, text: String? = nil) {
        self.tags = tags
        self.items = items
        self.maxTotalMinutes = maxTotalMinutes
        self.hasFlow = hasFlow
        self.text = text
    }
}

public struct TagView: Codable, Sendable, Hashable {
    public var name: String
    public var recipeIds: [String]

    public init(name: String, recipeIds: [String]) {
        self.name = name
        self.recipeIds = recipeIds
    }
}

public struct CollectionView: Codable, Sendable, Hashable {
    public var name: String
    public var recipeIds: [String]

    public init(name: String, recipeIds: [String]) {
        self.name = name
        self.recipeIds = recipeIds
    }
}

public struct SmartCollectionView: Codable, Sendable, Hashable {
    public var name: String
    public var filter: RecipeFilter

    public init(name: String, filter: RecipeFilter) {
        self.name = name
        self.filter = filter
    }
}

public struct LibraryOrganization: Codable, Sendable, Hashable {
    public var tags: [TagView]
    public var collections: [CollectionView]
    public var smartCollections: [SmartCollectionView]

    public init(tags: [TagView] = [], collections: [CollectionView] = [], smartCollections: [SmartCollectionView] = []) {
        self.tags = tags
        self.collections = collections
        self.smartCollections = smartCollections
    }
}

/// `GET /api/device/library`: `{seq, recipes, ...LibraryOrganization}`.
public struct LibraryAtChange: Codable, Sendable, Hashable {
    public var seq: Int
    public var recipes: [DeviceRecipe]
    public var tags: [TagView]
    public var collections: [CollectionView]
    public var smartCollections: [SmartCollectionView]

    public var organization: LibraryOrganization {
        LibraryOrganization(tags: tags, collections: collections, smartCollections: smartCollections)
    }

    public init(seq: Int, recipes: [DeviceRecipe], organization: LibraryOrganization) {
        self.seq = seq
        self.recipes = recipes
        self.tags = organization.tags
        self.collections = organization.collections
        self.smartCollections = organization.smartCollections
    }
}

public enum ChangeKind: String, Codable, Sendable, Hashable {
    case recipeAdded = "recipe_added"
    case recipeRevised = "recipe_revised"
    case recipesTrashed = "recipes_trashed"
    case recipesRestored = "recipes_restored"
    case recipesPurged = "recipes_purged"
    case libraryChanged = "library_changed"
}

public enum ChangeAuthorKind: String, Codable, Sendable, Hashable {
    case claude, device, trash
}

public struct ChangeAuthor: Codable, Sendable, Hashable {
    public var kind: ChangeAuthorKind
    public var name: String

    public init(kind: ChangeAuthorKind, name: String) {
        self.kind = kind
        self.name = name
    }
}

public struct ChangeView: Codable, Sendable, Hashable {
    public var seq: Int
    public var at: Date
    public var by: ChangeAuthor
    public var kind: ChangeKind
    public var recipeIds: [String]

    public init(seq: Int, at: Date, by: ChangeAuthor, kind: ChangeKind, recipeIds: [String]) {
        self.seq = seq
        self.at = at
        self.by = by
        self.kind = kind
        self.recipeIds = recipeIds
    }
}

/// `GET /api/device/changes?after=n`: the organization is always whole.
public struct ChangesAfter: Codable, Sendable, Hashable {
    public var seq: Int
    public var changes: [ChangeView]
    public var recipes: [DeviceRecipe]
    public var purgedRecipeIds: [String]
    public var tags: [TagView]
    public var collections: [CollectionView]
    public var smartCollections: [SmartCollectionView]

    public var organization: LibraryOrganization {
        LibraryOrganization(tags: tags, collections: collections, smartCollections: smartCollections)
    }

    public init(seq: Int, changes: [ChangeView], recipes: [DeviceRecipe], purgedRecipeIds: [String], organization: LibraryOrganization) {
        self.seq = seq
        self.changes = changes
        self.recipes = recipes
        self.purgedRecipeIds = purgedRecipeIds
        self.tags = organization.tags
        self.collections = organization.collections
        self.smartCollections = organization.smartCollections
    }
}

/// One entry of a 422 `problems` list.
public struct Problem: Codable, Sendable, Hashable {
    public var edit: Int?
    public var rule: String
    public var message: String
    public var fix: String

    public init(edit: Int? = nil, rule: String, message: String, fix: String) {
        self.edit = edit
        self.rule = rule
        self.message = message
        self.fix = fix
    }
}

/// JSON with ISO 8601 dates, with or without fractional seconds (`Date.toISOString()` has milliseconds).
public enum SippetJSON {
    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            let fractional = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
            if let date = try? fractional.parse(text) { return date }
            if let date = try? Date.ISO8601FormatStyle().parse(text) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not an ISO 8601 date: \(text)"))
        }
        return decoder
    }

    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var single = encoder.singleValueContainer()
            try single.encode(date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true)))
        }
        return encoder
    }
}
