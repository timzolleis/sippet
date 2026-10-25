import Foundation
import Security

/// Where TokenStore keeps its secrets: the Keychain in the app, memory in tests.
public protocol SecretStorage: Sendable {
    func read(_ key: String) throws -> String?
    func write(_ value: String, for key: String) throws
    func delete(_ key: String) throws
}

public struct KeychainError: Error, Sendable, Equatable { public var status: Int32 }

/// Generic-password items under one service.
public struct KeychainStorage: SecretStorage {
    public let service: String

    public init(service: String = "de.bastelboxx.sippet") { self.service = service }

    private func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
    }

    public func read(_ key: String) throws -> String? {
        var request = query(key)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw KeychainError(status: status) }
        return String(data: data, encoding: .utf8)
    }

    public func write(_ value: String, for key: String) throws {
        let data = Data(value.utf8)
        let status = SecItemUpdate(query(key) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw KeychainError(status: status) }
        var add = query(key)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let added = SecItemAdd(add as CFDictionary, nil)
        guard added == errSecSuccess else { throw KeychainError(status: added) }
    }

    public func delete(_ key: String) throws {
        let status = SecItemDelete(query(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status) }
    }
}

/// For tests and previews.
public final class MemoryStorage: SecretStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: String] = [:]

    public init() {}

    public func read(_ key: String) throws -> String? { lock.withLock { values[key] } }
    public func write(_ value: String, for key: String) throws { lock.withLock { values[key] = value } }
    public func delete(_ key: String) throws { lock.withLock { values[key] = nil } }
}

/// Refresh token and device id in the secret storage; the access token in memory.
public actor TokenStore {
    private let storage: any SecretStorage
    private var access: String?

    public init(storage: any SecretStorage) { self.storage = storage }

    /// The Keychain-backed store for the app.
    public static func keychain(service: String = "de.bastelboxx.sippet") -> TokenStore {
        TokenStore(storage: KeychainStorage(service: service))
    }

    /// A UUID created once and kept.
    public func deviceId() throws -> String {
        if let id = try storage.read("deviceId") { return id }
        let id = UUID().uuidString
        try storage.write(id, for: "deviceId")
        return id
    }

    public func refreshToken() throws -> String? { try storage.read("refreshToken") }
    public func accessToken() -> String? { access }

    public func store(accessToken: String, refreshToken: String?) throws {
        access = accessToken
        if let refreshToken { try storage.write(refreshToken, for: "refreshToken") }
    }

    public func setAccessToken(_ token: String) { access = token }

    /// Debug (SIPPET_REFRESH_TOKEN): store a refresh token alone; the first request refreshes. Writes unconditionally,
    /// so the caller checks `refreshToken() == nil` first.
    public func storeRefreshToken(_ token: String) throws { try storage.write(token, for: "refreshToken") }

    /// Sign out: delete the refresh token and the access token; the device id stays.
    public func clear() throws {
        access = nil
        try storage.delete("refreshToken")
    }
}
