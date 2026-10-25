import Foundation
import Observation

public enum SyncState: Sendable, Hashable {
    case offline, catchingUp, live
}

/// sync rule 4: what others changed, for the banner.
public struct ChangeNotice: Sendable, Hashable {
    public var author: String
    public var recipeIds: [String]
    /// "Claude hat Zupfkuchen überarbeitet" / "Claude hat 4 Rezepte geändert"
    public var text: String

    public init(author: String, recipeIds: [String], text: String) {
        self.author = author
        self.recipeIds = recipeIds
        self.text = text
    }
}

@MainActor @Observable
public final class SyncEngine {
    public private(set) var state: SyncState = .offline
    public private(set) var lastNotice: ChangeNotice?
    /// Set when a refresh failed: the app shows SignInScreen.
    public private(set) var isSignedOut = false

    /// `deviceName` tells this device's own changes from others' (no notice for them).
    public init(api: DeviceAPI, store: LibraryStore, deviceName: @escaping @Sendable () -> String) { fatalError("milestone 2") }

    /// Scene active.
    public func start() { fatalError("milestone 2") }
    /// Scene in background: close the socket.
    public func stop() { fatalError("milestone 2") }
}
