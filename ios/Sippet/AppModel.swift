import Foundation
import Observation
import SippetCore
import UIKit

enum AppConfig {
    static let productionURL = URL(string: "https://sippet.bastelboxx.de")!

    static var serverURL: URL {
        #if DEBUG
        // Xcode passes SIPPET_URL only when it launches the app; remember it for launches from the home screen.
        let key = "debugServerURL"
        if let text = ProcessInfo.processInfo.environment["SIPPET_URL"], let url = URL(string: text) {
            UserDefaults.standard.set(text, forKey: key)
            return url
        }
        if let text = UserDefaults.standard.string(forKey: key), let url = URL(string: text) { return url }
        #if targetEnvironment(simulator)
        return URL(string: "http://localhost:1337")!
        #else
        return productionURL // a phone can't reach the Mac's localhost
        #endif
        #else
        return productionURL
        #endif
    }

    static var language: Language { Language(code: Locale.preferredLanguages.first) }

    static var libraryFile: URL {
        let dir = URL.applicationSupportDirectory
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appending(path: "library.json")
    }
}

/// The measurement system the cook prefers, kept in Settings.
extension MeasurementSystem {
    static let defaultsKey = "units"
}

nonisolated enum DeviceName {
    static let defaultsKey = "deviceName"
    static func current() -> String {
        let saved = UserDefaults.standard.string(forKey: defaultsKey)?.trimmingCharacters(in: .whitespaces) ?? ""
        return saved.isEmpty ? defaultName : saved
    }
    /// "iPhone" or "iPad"; set once on the main actor at launch.
    nonisolated(unsafe) static var defaultName = "iPhone"
}

/// The wiring of SippetCore; the views hold no logic beyond view state.
@MainActor @Observable
final class AppModel {
    enum Phase { case launching, signedOut, signedIn }

    let tokens: TokenStore
    let store: LibraryStore
    private(set) var phase: Phase = .launching
    private(set) var signIn: SignIn?
    private(set) var api: DeviceAPI?
    private(set) var sync: SyncEngine?
    /// A refusal or failure for the cook, shown in an alert.
    var alertMessage: String?
    var signInError: String?
    var isSigningIn = false

    private static let endpointsKey = "oauthEndpoints"
    private struct Endpoints: Codable {
        var authorization: URL, token: URL, revocation: URL?, issuer: String?
    }

    init(tokens: TokenStore = .keychain(), store: LibraryStore = LibraryStore(file: AppConfig.libraryFile)) {
        DeviceName.defaultName = UIDevice.current.model
        self.tokens = tokens
        self.store = store
    }

    var isOffline: Bool { sync == nil || sync?.state == .offline }

    /// Launch: the library is already loaded from disk; decide signed in or out.
    func launch() async {
        #if DEBUG
        if let token = ProcessInfo.processInfo.environment["SIPPET_REFRESH_TOKEN"], !token.isEmpty,
           (try? await tokens.refreshToken()) == nil {
            try? await tokens.storeRefreshToken(token)
        }
        #endif
        guard (try? await tokens.refreshToken()) != nil else { phase = .signedOut; return }
        await connect()
        phase = .signedIn
    }

    /// Builds SignIn, DeviceAPI and SyncEngine. Offline at launch uses the endpoints cached at the last sign-in.
    private func connect() async {
        let server = AppConfig.serverURL
        var found: SignIn?
        if let discovered = try? await SignIn.discover(server: server, tokens: tokens) {
            found = discovered
            cache(discovered)
        } else if let data = UserDefaults.standard.data(forKey: Self.endpointsKey),
                  let cached = try? JSONDecoder().decode(Endpoints.self, from: data) {
            found = SignIn(
                authorizationEndpoint: cached.authorization, tokenEndpoint: cached.token,
                revocationEndpoint: cached.revocation, issuer: cached.issuer,
                resource: server.appending(path: "mcp"), tokens: tokens)
        }
        guard let signIn = found else { return }
        let api = DeviceAPI(baseURL: server, tokens: tokens, signIn: signIn, deviceName: { DeviceName.current() })
        self.signIn = signIn
        self.api = api
        sync = SyncEngine(api: api, store: store, deviceName: { DeviceName.current() })
        sync?.start()
    }

    private func cache(_ signIn: SignIn) {
        let endpoints = Endpoints(
            authorization: signIn.authorizationEndpoint, token: signIn.tokenEndpoint,
            revocation: signIn.revocationEndpoint, issuer: signIn.issuer)
        if let data = try? JSONEncoder().encode(endpoints) { UserDefaults.standard.set(data, forKey: Self.endpointsKey) }
    }

    /// Scene active / background.
    func sceneActive(_ active: Bool) async {
        guard phase == .signedIn else { return }
        if sync == nil { await connect() }
        if active { sync?.start() } else { sync?.stop() }
    }

    /// A refresh failed: show SignInScreen, keep library.json (account rule 8).
    func checkSignedOut() {
        if sync?.isSignedOut == true, phase == .signedIn {
            sync?.stop()
            sync = nil
            api = nil
            phase = .signedOut
        }
    }

    // MARK: sign in and out

    /// Called by SignInScreen with the callback URL of the web authentication session.
    func beginSignIn() async throws -> (SignIn, URL, PKCEVerifier, String) {
        let signIn = try await SignIn.discover(server: AppConfig.serverURL, tokens: tokens)
        cache(signIn)
        let (url, verifier, state) = signIn.authorizationURL()
        return (signIn, url, verifier, state)
    }

    func finishSignIn(_ signIn: SignIn, callback: URL, verifier: PKCEVerifier, state: String) async throws {
        try await signIn.exchange(callback: callback, verifier: verifier, state: state)
        sync = nil
        api = nil
        await connect()
        phase = .signedIn
    }

    func signOut() async {
        sync?.stop()
        await signIn?.signOut()
        try? store.reset()
        sync = nil
        api = nil
        signIn = nil
        phase = .signedOut
    }

    // MARK: writes. The store changes only through catch-up (ios.md Sync).

    @discardableResult
    func edit(_ edits: [LibraryEdit]) async -> Bool {
        guard let api else { return false }
        return await attempt { () async throws(DeviceAPIError) in _ = try await api.editLibrary(edits) }
    }

    @discardableResult
    func trash(_ ids: [String]) async -> Bool {
        guard let api else { return false }
        return await attempt { () async throws(DeviceAPIError) in _ = try await api.trashRecipes(ids) }
    }

    @discardableResult
    func restore(_ ids: [String]) async -> Bool {
        guard let api else { return false }
        return await attempt { () async throws(DeviceAPIError) in _ = try await api.restoreRecipes(ids) }
    }

    private func attempt(_ work: () async throws(DeviceAPIError) -> Void) async -> Bool {
        do {
            try await work()
            return true
        } catch {
            switch error {
            case .refused(let problems):
                alertMessage = problems.map(\.message).joined(separator: "\n")
            case .offline:
                alertMessage = String(localized: "Offline")
            case .signedOut:
                checkSignedOut()
            case .notFound:
                alertMessage = String(localized: "This recipe is gone.")
            case .changesNotReached, .server:
                alertMessage = String(localized: "The server didn't answer. Try again.")
            }
            return false
        }
    }
}
