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

private struct EditsBody: Encodable { var edits: [LibraryEdit] }
private struct IdsBody: Encodable { var recipeIds: [String] }
private struct RecipesBody: Decodable { var recipes: [DeviceRecipe] }
private struct RefusedBody: Decodable { var problems: [Problem] }
private struct NotFoundBody: Decodable { var recipeIds: [String] }

/// device-api.md Endpoints. Every request carries x-device-id and x-device-name (percent-encoded UTF-8).
/// A 401 refreshes once (single flight) and retries once.
public actor DeviceAPI {
    private let baseURL: URL
    private let tokens: TokenStore
    private let signIn: SignIn
    private let deviceName: @Sendable () -> String
    private let session: URLSession
    private var refreshTask: Task<Void, any Error>?

    public init(
        baseURL: URL, tokens: TokenStore, signIn: SignIn, deviceName: @escaping @Sendable () -> String,
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.tokens = tokens
        self.signIn = signIn
        self.deviceName = deviceName
        self.session = session
    }

    public func getLibrary() async throws(DeviceAPIError) -> LibraryAtChange {
        try decode(try await execute("GET", "api/device/library"))
    }

    public func listChangesAfter(_ seq: Int) async throws(DeviceAPIError) -> ChangesAfter {
        try decode(try await execute("GET", "api/device/changes", query: [URLQueryItem(name: "after", value: String(seq))]))
    }

    public func editLibrary(_ edits: [LibraryEdit]) async throws(DeviceAPIError) -> LibraryOrganization {
        try decode(try await execute("POST", "api/device/library/edits", body: EditsBody(edits: edits)))
    }

    public func trashRecipes(_ ids: [String]) async throws(DeviceAPIError) -> [DeviceRecipe] {
        let body: RecipesBody = try decode(try await execute("POST", "api/device/recipes/trash", body: IdsBody(recipeIds: ids)))
        return body.recipes
    }

    public func restoreRecipes(_ ids: [String]) async throws(DeviceAPIError) -> [DeviceRecipe] {
        let body: RecipesBody = try decode(try await execute("POST", "api/device/recipes/restore", body: IdsBody(recipeIds: ids)))
        return body.recipes
    }

    /// `GET /api/device/live` as a ws(s) request with Authorization and the device headers.
    public func liveURLRequest() async throws(DeviceAPIError) -> URLRequest {
        let token = try await currentToken()
        var components = URLComponents(url: baseURL.appending(path: "api/device/live"), resolvingAgainstBaseURL: false)!
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        var request = URLRequest(url: components.url!)
        try await addHeaders(&request, token: token)
        return request
    }

    /// Refresh the access token now (the live socket closed with 4401). Single flight.
    public func refreshTokens() async throws(DeviceAPIError) {
        _ = try await refreshed(replacing: await tokens.accessToken())
    }

    // MARK: requests

    private func decode<T: Decodable>(_ data: Data) throws(DeviceAPIError) -> T {
        do { return try SippetJSON.decoder().decode(T.self, from: data) } catch { throw .server }
    }

    private func currentToken() async throws(DeviceAPIError) -> String {
        if let token = await tokens.accessToken() { return token }
        return try await refreshed(replacing: nil)
    }

    private func addHeaders(_ request: inout URLRequest, token: String) async throws(DeviceAPIError) {
        let id: String
        do { id = try await tokens.deviceId() } catch { throw .server }
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(id, forHTTPHeaderField: "x-device-id")
        request.setValue(deviceName().addingPercentEncoding(withAllowedCharacters: allowed) ?? "", forHTTPHeaderField: "x-device-name")
    }

    private func execute(_ method: String, _ path: String, query: [URLQueryItem] = [], body: (any Encodable)? = nil) async throws(DeviceAPIError) -> Data {
        var token = try await currentToken()
        var (status, data) = try await send(method, path, query: query, body: body, token: token)
        if status == 401 {
            token = try await refreshed(replacing: token)
            (status, data) = try await send(method, path, query: query, body: body, token: token)
            if status == 401 { throw .signedOut }
        }
        switch status {
        case 200..<300: return data
        case 404: throw .notFound((try? JSONDecoder().decode(NotFoundBody.self, from: data))?.recipeIds ?? [])
        case 409: throw .changesNotReached
        case 422: throw .refused((try? JSONDecoder().decode(RefusedBody.self, from: data))?.problems ?? [])
        default: throw .server
        }
    }

    private func send(_ method: String, _ path: String, query: [URLQueryItem], body: (any Encodable)?, token: String) async throws(DeviceAPIError) -> (Int, Data) {
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        try await addHeaders(&request, token: token)
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            do { request.httpBody = try SippetJSON.encoder().encode(body) } catch { throw .server }
        }
        do {
            let (data, response) = try await session.data(for: request)
            return ((response as? HTTPURLResponse)?.statusCode ?? 0, data)
        } catch let error as URLError where Self.isOffline(error) {
            throw .offline
        } catch {
            throw .server
        }
    }

    private static func isOffline(_ error: URLError) -> Bool {
        [.notConnectedToInternet, .networkConnectionLost, .cannotConnectToHost, .cannotFindHost, .timedOut, .dnsLookupFailed, .dataNotAllowed, .internationalRoamingOff]
            .contains(error.code)
    }

    /// Single flight: concurrent 401s share one refresh. If the token already changed since `old`, use it.
    private func refreshed(replacing old: String?) async throws(DeviceAPIError) -> String {
        if let current = await tokens.accessToken(), current != old { return current }
        let task: Task<Void, any Error>
        if let running = refreshTask {
            task = running
        } else {
            let signIn = signIn
            task = Task { try await signIn.refresh() }
            refreshTask = task
        }
        do {
            try await task.value
            refreshTask = nil
        } catch {
            refreshTask = nil
            switch error {
            case SignInError.noRefreshToken: throw .signedOut
            case SignInError.tokenRequestFailed(let status) where (400..<500).contains(status): throw .signedOut
            case let urlError as URLError where Self.isOffline(urlError): throw .offline
            default: throw .server
            }
        }
        guard let token = await tokens.accessToken() else { throw .signedOut }
        return token
    }
}
