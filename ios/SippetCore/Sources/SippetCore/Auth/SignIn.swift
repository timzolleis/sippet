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
    case tokenRequestFailed(Int)
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

    public init(
        authorizationEndpoint: URL, tokenEndpoint: URL, revocationEndpoint: URL? = nil, issuer: String? = nil,
        resource: URL, tokens: TokenStore, session: URLSession = .shared
    ) { fatalError("milestone 2") }

    /// GET `<server>/.well-known/oauth-authorization-server`.
    public static func discover(server: URL, tokens: TokenStore, session: URLSession = .shared) async throws -> SignIn { fatalError("milestone 2") }

    /// PKCE S256, random state, scope offline_access, resource `<server>/mcp`.
    public func authorizationURL() -> (url: URL, verifier: PKCEVerifier, state: String) { fatalError("milestone 2") }

    /// Checks `state` and `iss`, POSTs the token endpoint, stores the tokens.
    public func exchange(callback: URL, verifier: PKCEVerifier, state: String) async throws { fatalError("milestone 2") }

    /// Refresh grant; rotates the refresh token. Throws when the server refuses.
    public func refresh() async throws { fatalError("milestone 2") }

    /// Best effort: POST the revocation endpoint with the refresh token, then clear the TokenStore.
    public func signOut() async { fatalError("milestone 2") }
}
