import CryptoKit
import Foundation

public struct PKCEVerifier: Sendable, Hashable {
    public let value: String
    public init(value: String) { self.value = value }
}

public enum SignInError: Error, Sendable, Equatable {
    case stateMismatch
    case issuerMismatch
    case missingCode
    case denied(String)
    case noRefreshToken
    case tokenRequestFailed(Int)
    case badResponse
}

private func base64URL(_ data: some DataProtocol) -> String {
    Data(data).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}

private func randomString(bytes: Int) -> String {
    base64URL((0..<bytes).map { _ in UInt8.random(in: .min ... .max) })
}

private struct TokenResponse: Decodable {
    var access_token: String
    var refresh_token: String?
}

private struct Metadata: Decodable {
    var issuer: String?
    var authorization_endpoint: URL
    var token_endpoint: URL
    var revocation_endpoint: URL?
}

/// PKCE sign-in against the OAuth server (ios.md Sign-in).
public struct SignIn: Sendable {
    public var authorizationEndpoint: URL
    public var tokenEndpoint: URL
    public var revocationEndpoint: URL?
    public var issuer: String?
    /// `<server>/mcp`
    public var resource: URL
    public var clientId = "sippet-app"
    public var redirectURI = "de.bastelboxx.sippet:/oauth"
    private let tokens: TokenStore
    private let session: URLSession

    public init(
        authorizationEndpoint: URL, tokenEndpoint: URL, revocationEndpoint: URL? = nil, issuer: String? = nil,
        resource: URL, tokens: TokenStore, session: URLSession = .shared
    ) {
        self.authorizationEndpoint = authorizationEndpoint
        self.tokenEndpoint = tokenEndpoint
        self.revocationEndpoint = revocationEndpoint
        self.issuer = issuer
        self.resource = resource
        self.tokens = tokens
        self.session = session
    }

    /// GET `<server>/.well-known/oauth-authorization-server`.
    public static func discover(server: URL, tokens: TokenStore, session: URLSession = .shared) async throws -> SignIn {
        let (data, response) = try await session.data(from: server.appending(path: ".well-known/oauth-authorization-server"))
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw SignInError.tokenRequestFailed((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        let metadata = try JSONDecoder().decode(Metadata.self, from: data)
        return SignIn(
            authorizationEndpoint: metadata.authorization_endpoint, tokenEndpoint: metadata.token_endpoint,
            revocationEndpoint: metadata.revocation_endpoint, issuer: metadata.issuer,
            resource: server.appending(path: "mcp"), tokens: tokens, session: session)
    }

    /// PKCE S256, random state, scope offline_access, resource `<server>/mcp`.
    public func authorizationURL() -> (url: URL, verifier: PKCEVerifier, state: String) {
        let verifier = PKCEVerifier(value: randomString(bytes: 32))
        let state = randomString(bytes: 16)
        let challenge = base64URL(Data(SHA256.hash(data: Data(verifier.value.utf8))))
        var components = URLComponents(url: authorizationEndpoint, resolvingAgainstBaseURL: false)!
        components.queryItems = (components.queryItems ?? []) + [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "scope", value: "offline_access"),
            URLQueryItem(name: "resource", value: resource.absoluteString),
            URLQueryItem(name: "state", value: state),
        ]
        return (components.url!, verifier, state)
    }

    /// Checks `state` and `iss`, POSTs the token endpoint, stores the tokens.
    public func exchange(callback: URL, verifier: PKCEVerifier, state: String) async throws {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        if let error = value("error") { throw SignInError.denied(error) }
        guard value("state") == state else { throw SignInError.stateMismatch }
        if let iss = value("iss"), let issuer, iss != issuer { throw SignInError.issuerMismatch }
        guard let code = value("code") else { throw SignInError.missingCode }
        let response = try await tokenRequest([
            "grant_type": "authorization_code", "code": code, "code_verifier": verifier.value,
            "client_id": clientId, "redirect_uri": redirectURI, "resource": resource.absoluteString,
        ])
        try await tokens.store(accessToken: response.access_token, refreshToken: response.refresh_token)
    }

    /// Refresh grant; rotates the refresh token. Throws when the server refuses.
    public func refresh() async throws {
        guard let refreshToken = try await tokens.refreshToken() else { throw SignInError.noRefreshToken }
        let response = try await tokenRequest([
            "grant_type": "refresh_token", "refresh_token": refreshToken, "client_id": clientId, "resource": resource.absoluteString,
        ])
        try await tokens.store(accessToken: response.access_token, refreshToken: response.refresh_token)
    }

    /// Best effort: POST the revocation endpoint with the refresh token, then clear the TokenStore.
    public func signOut() async {
        if let revocationEndpoint, let token = try? await tokens.refreshToken() {
            _ = try? await post(revocationEndpoint, ["token": token, "client_id": clientId, "token_type_hint": "refresh_token"])
        }
        try? await tokens.clear()
    }

    private func post(_ url: URL, _ fields: [String: String]) async throws -> (Data, Int) {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        request.httpBody = Data(
            fields.sorted { $0.key < $1.key }
                .map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }
                .joined(separator: "&").utf8)
        let (data, response) = try await session.data(for: request)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }

    private func tokenRequest(_ fields: [String: String]) async throws -> TokenResponse {
        let (data, status) = try await post(tokenEndpoint, fields)
        guard (200..<300).contains(status) else { throw SignInError.tokenRequestFailed(status) }
        guard let response = try? JSONDecoder().decode(TokenResponse.self, from: data) else { throw SignInError.badResponse }
        return response
    }
}
