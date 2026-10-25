import CryptoKit
import Foundation
import Testing
@testable import SippetCore

private func makeSignIn(host: String = "signin.test", tokens: TokenStore = TokenStore(storage: MemoryStorage()), session: URLSession = .shared) -> SignIn {
    SignIn(
        authorizationEndpoint: URL(string: "http://\(host)/api/auth/mcp/authorize")!, tokenEndpoint: URL(string: "http://\(host)/api/auth/mcp/token")!,
        revocationEndpoint: URL(string: "http://\(host)/api/auth/mcp/revoke")!, issuer: "http://\(host)/api/auth",
        resource: URL(string: "http://\(host)/mcp")!, tokens: tokens, session: session)
}

@Test func authorizationURLHasS256ChallengeAndState() {
    let (url, verifier, state) = makeSignIn().authorizationURL()
    let items = Dictionary(uniqueKeysWithValues: URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value!) })
    #expect(items["code_challenge_method"] == "S256" && items["client_id"] == "sippet-app" && items["response_type"] == "code")
    #expect(items["redirect_uri"] == "de.bastelboxx.sippet:/oauth" && items["scope"] == "offline_access")
    #expect(items["resource"] == "http://signin.test/mcp" && items["state"] == state)
    let expected = Data(SHA256.hash(data: Data(verifier.value.utf8))).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    #expect(items["code_challenge"] == expected)
    #expect(verifier.value.count >= 43 && state.count >= 16)
    #expect(makeSignIn().authorizationURL().verifier != verifier)
}

@Test func exchangeRefusesAWrongStateAndIssuer() async {
    let signIn = makeSignIn()
    let verifier = PKCEVerifier(value: "v")
    await #expect(throws: SignInError.stateMismatch) {
        try await signIn.exchange(callback: URL(string: "de.bastelboxx.sippet:/oauth?code=c&state=evil")!, verifier: verifier, state: "good")
    }
    await #expect(throws: SignInError.issuerMismatch) {
        try await signIn.exchange(callback: URL(string: "de.bastelboxx.sippet:/oauth?code=c&state=good&iss=http%3A%2F%2Fevil")!, verifier: verifier, state: "good")
    }
    await #expect(throws: SignInError.denied("access_denied")) {
        try await signIn.exchange(callback: URL(string: "de.bastelboxx.sippet:/oauth?error=access_denied&state=good")!, verifier: verifier, state: "good")
    }
}

@Test func exchangePostsTheCodeAndStoresTokens() async throws {
    let host = "exchange.test"
    let seen = Lock<String>("")
    StubProtocol.register(host: host) { _, body in
        seen.with { $0 = String(decoding: body, as: UTF8.self) }
        return (200, Data(#"{"access_token":"A1","refresh_token":"R1","token_type":"Bearer"}"#.utf8))
    }
    let tokens = TokenStore(storage: MemoryStorage())
    let signIn = makeSignIn(host: host, tokens: tokens, session: StubProtocol.session())
    let (_, verifier, state) = signIn.authorizationURL()
    let callback = URL(string: "de.bastelboxx.sippet:/oauth?code=abc&state=\(state)&iss=http%3A%2F%2F\(host)%2Fapi%2Fauth")!
    try await signIn.exchange(callback: callback, verifier: verifier, state: state)
    let access = await tokens.accessToken()
    let refresh = try await tokens.refreshToken()
    #expect(access == "A1" && refresh == "R1")
    let body = seen.with { $0 }
    #expect(body.contains("grant_type=authorization_code") && body.contains("code=abc") && body.contains("code_verifier=\(verifier.value)"))
}

@Test func signOutRevokesAndClears() async throws {
    let host = "signout.test"
    let revoked = Lock<Bool>(false)
    StubProtocol.register(host: host) { request, _ in
        if request.url?.path.hasSuffix("revoke") == true { revoked.with { $0 = true } }
        return (200, Data())
    }
    let tokens = TokenStore(storage: MemoryStorage())
    try await tokens.store(accessToken: "A", refreshToken: "R")
    let id = try await tokens.deviceId()
    await makeSignIn(host: host, tokens: tokens, session: StubProtocol.session()).signOut()
    let refresh = try await tokens.refreshToken()
    let access = await tokens.accessToken()
    let idAfter = try await tokens.deviceId()
    #expect(revoked.with { $0 } && refresh == nil && access == nil)
    #expect(idAfter == id)
}
