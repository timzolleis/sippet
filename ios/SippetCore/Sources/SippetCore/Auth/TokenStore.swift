import Foundation

/// Where TokenStore keeps its secrets: the Keychain in the app, memory in tests.
public protocol SecretStorage: Sendable {
    func read(_ key: String) throws -> String?
    func write(_ value: String, for key: String) throws
    func delete(_ key: String) throws
}

/// Refresh token and device id in the secret storage; the access token in memory.
public actor TokenStore {
    public init(storage: any SecretStorage) { fatalError("milestone 2") }

    /// The Keychain-backed store for the app.
    public static func keychain(service: String = "de.bastelboxx.sippet") -> TokenStore { fatalError("milestone 2") }

    /// A UUID created once and kept.
    public func deviceId() throws -> String { fatalError("milestone 2") }
    public func refreshToken() throws -> String? { fatalError("milestone 2") }
    public func accessToken() -> String? { fatalError("milestone 2") }
    public func store(accessToken: String, refreshToken: String?) throws { fatalError("milestone 2") }
    public func setAccessToken(_ token: String) { fatalError("milestone 2") }
    /// Sign out: delete the refresh token and the access token; the device id stays.
    public func clear() throws { fatalError("milestone 2") }
}
