import Foundation

public enum DeviceAPIError: Error, Sendable, Equatable {
    case signedOut
    case offline
    /// 422: each problem's `message` is for the cook.
    case refused([Problem])
    /// 404: the unknown ids.
    case notFound([String])
    /// 409: load the library again (sync rule 6).
    case changesNotReached
    case server
}

/// device-api.md Endpoints. Every request carries x-device-id and x-device-name; a 401 refreshes once (single flight) and retries once.
public actor DeviceAPI {
    public init(
        baseURL: URL, tokens: TokenStore, signIn: SignIn, deviceName: @escaping @Sendable () -> String,
        session: URLSession = .shared
    ) { fatalError("milestone 2") }

    public func getLibrary() async throws(DeviceAPIError) -> LibraryAtChange { fatalError("milestone 2") }
    public func listChangesAfter(_ seq: Int) async throws(DeviceAPIError) -> ChangesAfter { fatalError("milestone 2") }
    public func editLibrary(_ edits: [LibraryEdit]) async throws(DeviceAPIError) -> LibraryOrganization { fatalError("milestone 2") }
    public func trashRecipes(_ ids: [String]) async throws(DeviceAPIError) -> [DeviceRecipe] { fatalError("milestone 2") }
    public func restoreRecipes(_ ids: [String]) async throws(DeviceAPIError) -> [DeviceRecipe] { fatalError("milestone 2") }
    /// `GET /api/device/live` as a ws(s) request with Authorization and the device headers.
    public func liveURLRequest() async throws(DeviceAPIError) -> URLRequest { fatalError("milestone 2") }
}
