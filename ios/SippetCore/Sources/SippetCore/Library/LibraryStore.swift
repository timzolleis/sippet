import Foundation
import Observation

/// The device's copy of the library (sync rules 5, 6).
@MainActor @Observable
public final class LibraryStore {
    public private(set) var seq: Int?
    public private(set) var recipes: [String: DeviceRecipe] = [:]
    public private(set) var organization = LibraryOrganization()

    /// Not trashed, by title.
    public var library: [DeviceRecipe] { fatalError("milestone 2") }
    /// By purgeAt.
    public var trash: [DeviceRecipe] { fatalError("milestone 2") }

    private let file: URL

    /// Loads library.json at launch, before any network.
    public init(file: URL) {
        self.file = file
    }

    public func tags(of recipeId: String) -> [String] { fatalError("milestone 2") }

    /// cooking 9: every word in title, ingredients, or steps.
    public func search(_ text: String, in recipes: [DeviceRecipe]) -> [DeviceRecipe] { fatalError("milestone 2") }

    public func recipes(inCollection name: String) -> [DeviceRecipe] { fatalError("milestone 2") }
    public func recipes(matching smart: SmartCollectionView) -> [DeviceRecipe] { fatalError("milestone 2") }
    public func recipes(taggedWith tag: String) -> [DeviceRecipe] { fatalError("milestone 2") }

    /// Replace everything (sync rule 6); writes library.json.
    public func replace(with library: LibraryAtChange) throws { fatalError("milestone 2") }
    /// Apply a catch-up; writes library.json.
    public func apply(_ changes: ChangesAfter) throws { fatalError("milestone 2") }
    /// Sign out: forget everything and delete library.json.
    public func reset() throws { fatalError("milestone 2") }
}
