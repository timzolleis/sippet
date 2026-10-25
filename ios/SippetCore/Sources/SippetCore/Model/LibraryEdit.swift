import Foundation

/// The 13 ops of mcp.md Library edits; encodes as `{"op": "...", ...}`.
public enum LibraryEdit: Encodable, Sendable, Hashable {
    case tag(tag: String, recipeIds: [String])
    case untag(tag: String, recipeIds: [String])
    case renameTag(tag: String, to: String)
    case mergeTags(tag: String, into: String)
    case deleteTag(tag: String)
    case createCollection(name: String, recipeIds: [String]? = nil)
    case addToCollection(collection: String, recipeIds: [String])
    case removeFromCollection(collection: String, recipeIds: [String])
    /// `recipeIds` is the full new order (library rule 11).
    case reorderCollection(collection: String, recipeIds: [String])
    case renameCollection(collection: String, to: String)
    case deleteCollection(collection: String)
    case saveSmartCollection(name: String, newName: String? = nil, filter: RecipeFilter)
    case deleteSmartCollection(name: String)

    private enum CodingKeys: String, CodingKey {
        case op, tag, to, into, name, newName, collection, recipeIds, filter
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .tag(let tag, let ids):
            try c.encode("tag", forKey: .op); try c.encode(tag, forKey: .tag); try c.encode(ids, forKey: .recipeIds)
        case .untag(let tag, let ids):
            try c.encode("untag", forKey: .op); try c.encode(tag, forKey: .tag); try c.encode(ids, forKey: .recipeIds)
        case .renameTag(let tag, let to):
            try c.encode("rename_tag", forKey: .op); try c.encode(tag, forKey: .tag); try c.encode(to, forKey: .to)
        case .mergeTags(let tag, let into):
            try c.encode("merge_tags", forKey: .op); try c.encode(tag, forKey: .tag); try c.encode(into, forKey: .into)
        case .deleteTag(let tag):
            try c.encode("delete_tag", forKey: .op); try c.encode(tag, forKey: .tag)
        case .createCollection(let name, let ids):
            try c.encode("create_collection", forKey: .op); try c.encode(name, forKey: .name)
            try c.encodeIfPresent(ids, forKey: .recipeIds)
        case .addToCollection(let collection, let ids):
            try c.encode("add_to_collection", forKey: .op); try c.encode(collection, forKey: .collection); try c.encode(ids, forKey: .recipeIds)
        case .removeFromCollection(let collection, let ids):
            try c.encode("remove_from_collection", forKey: .op); try c.encode(collection, forKey: .collection); try c.encode(ids, forKey: .recipeIds)
        case .reorderCollection(let collection, let ids):
            try c.encode("reorder_collection", forKey: .op); try c.encode(collection, forKey: .collection); try c.encode(ids, forKey: .recipeIds)
        case .renameCollection(let collection, let to):
            try c.encode("rename_collection", forKey: .op); try c.encode(collection, forKey: .collection); try c.encode(to, forKey: .to)
        case .deleteCollection(let collection):
            try c.encode("delete_collection", forKey: .op); try c.encode(collection, forKey: .collection)
        case .saveSmartCollection(let name, let newName, let filter):
            try c.encode("save_smart_collection", forKey: .op); try c.encode(name, forKey: .name)
            try c.encodeIfPresent(newName, forKey: .newName); try c.encode(filter, forKey: .filter)
        case .deleteSmartCollection(let name):
            try c.encode("delete_smart_collection", forKey: .op); try c.encode(name, forKey: .name)
        }
    }
}
