import Foundation
import Testing
@testable import SippetCore

private struct Harness {
    let host: String
    let store: LibraryStore
    let file: URL
    let tokens: TokenStore
    let api: DeviceAPI
    let session: URLSession
    let live: AsyncThrowingStream<Int, any Error>.Continuation
    let engine: SyncEngine
    let requests = Lock<[URLRequest]>([])
    let refreshes = Lock<Int>(0)

    @MainActor init(host: String, seq: LibraryAtChange? = nil, deviceName: String = "iPhone", handler: @escaping @Sendable (URLRequest, Lock<Int>) -> (Int, Data)) async throws {
        self.host = host
        file = tempFile()
        store = LibraryStore(file: file)
        if let seq { try store.replace(with: seq) }
        tokens = TokenStore(storage: MemoryStorage())
        try await tokens.store(accessToken: "A", refreshToken: "R")
        session = StubProtocol.session()
        let signIn = SignIn(
            authorizationEndpoint: URL(string: "http://\(host)/authorize")!, tokenEndpoint: URL(string: "http://\(host)/token")!,
            resource: URL(string: "http://\(host)/mcp")!, tokens: tokens, session: session)
        api = DeviceAPI(baseURL: URL(string: "http://\(host)")!, tokens: tokens, signIn: signIn, deviceName: { deviceName }, session: session)
        let (stream, continuation) = AsyncThrowingStream<Int, any Error>.makeStream()
        live = continuation
        engine = SyncEngine(api: api, store: store, deviceName: { deviceName }, live: { stream })
        let requests = requests, refreshes = refreshes
        StubProtocol.register(host: host) { request, body in
            requests.with { $0.append(request) }
            if request.url?.path == "/token" {
                refreshes.with { $0 += 1 }
                return handler(request, refreshes)
            }
            return handler(request, refreshes)
        }
    }

    func count(_ path: String) -> Int { requests.with { $0.filter { $0.url?.path == path }.count } }
}

private func org() -> LibraryOrganization { LibraryOrganization(tags: [TagView(name: "Kuchen", recipeIds: ["z"])]) }

private func change(_ seq: Int, by: ChangeAuthor = ChangeAuthor(kind: .claude, name: "Claude"), kind: ChangeKind = .recipeRevised, _ ids: [String]) -> ChangeView {
    ChangeView(seq: seq, at: Date(timeIntervalSince1970: Double(seq)), by: by, kind: kind, recipeIds: ids)
}

private func ok(_ value: some Encodable) -> (Int, Data) { (200, json(value)) }

private let startLibrary = LibraryAtChange(seq: 41, recipes: [recipe("z", title: "Zupfkuchen"), recipe("old", title: "Alt")], organization: LibraryOrganization())

@MainActor @Test func noSeqLoadsTheLibrary() async throws {
    let h = try await Harness(host: "load.test", deviceName: "iPad Küche") { request, _ in
        request.url?.path == "/api/device/library" ? ok(LibraryAtChange(seq: 41, recipes: [recipe("z", title: "Zupfkuchen")], organization: org())) : (404, Data())
    }
    h.engine.start()
    #expect(await waitUntil { h.store.seq == 41 && h.engine.state == .live })
    #expect(h.store.recipes["z"]?.title == "Zupfkuchen")
    let request = h.requests.with { $0.first! }
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer A")
    #expect(request.value(forHTTPHeaderField: "x-device-name") == "iPad%20K%C3%BCche")
    let deviceId = try await h.tokens.deviceId()
    #expect(request.value(forHTTPHeaderField: "x-device-id") == deviceId)
    #expect(FileManager.default.fileExists(atPath: h.file.path))
    h.engine.stop()
}

@MainActor @Test func catchUpReplacesPurgesAndNotices() async throws {
    var revised = recipe("z", title: "Zupfkuchen")
    revised.revision = 3
    let answer = ChangesAfter(
        seq: 45, changes: [change(42, ["a"]), change(43, ["b"]), change(44, ["z"]), change(45, ["c"])],
        recipes: [revised], purgedRecipeIds: ["old"], organization: org())
    let h = try await Harness(host: "changes.test", seq: startLibrary) { request, _ in
        request.url?.path == "/api/device/changes" ? ok(answer) : (404, Data())
    }
    h.engine.start()
    #expect(await waitUntil { h.store.seq == 45 })
    #expect(h.store.recipes["z"]?.revision == 3 && h.store.recipes["old"] == nil)
    #expect(h.engine.lastNotice?.text == "Claude hat 4 Rezepte geändert")
    #expect(h.requests.with { $0.first!.url?.query } == "after=41")
    h.engine.stop()
}

@MainActor @Test func oneRecipeNoticeNamesIt() async throws {
    let answer = ChangesAfter(seq: 42, changes: [change(42, ["z"])], recipes: [recipe("z", title: "Zupfkuchen")], purgedRecipeIds: [], organization: org())
    let h = try await Harness(host: "one.test", seq: startLibrary) { _, _ in ok(answer) }
    h.engine.start()
    #expect(await waitUntil { h.store.seq == 42 })
    #expect(h.engine.lastNotice?.text == "Claude hat Zupfkuchen überarbeitet")
    h.engine.stop()
}

@MainActor @Test func ownChangeMakesNoNotice() async throws {
    let own = ChangeAuthor(kind: .device, name: "iPhone")
    let answer = ChangesAfter(seq: 42, changes: [change(42, by: own, kind: .libraryChanged, ["z"])], recipes: [], purgedRecipeIds: [], organization: org())
    let h = try await Harness(host: "own.test", seq: startLibrary) { _, _ in ok(answer) }
    h.engine.start()
    #expect(await waitUntil { h.store.seq == 42 })
    #expect(h.engine.lastNotice == nil)
    h.engine.stop()
}

@MainActor @Test func changesNotReachedLoadsTheLibrary() async throws {
    let h = try await Harness(host: "conflict.test", seq: startLibrary) { request, _ in
        switch request.url?.path {
        case "/api/device/changes": (409, Data(#"{"message":"gone"}"#.utf8))
        case "/api/device/library": ok(LibraryAtChange(seq: 90, recipes: [recipe("n", title: "Neu")], organization: org()))
        default: (404, Data())
        }
    }
    h.engine.start()
    #expect(await waitUntil { h.store.seq == 90 })
    #expect(Set(h.store.recipes.keys) == ["n"])
    #expect(h.count("/api/device/changes") == 1 && h.count("/api/device/library") == 1)
    h.engine.stop()
}

@MainActor @Test func aNoticeDuringACatchUpRunsExactlyOneMore() async throws {
    let calls = Lock<Int>(0)
    let h = try await Harness(host: "notice.test", seq: startLibrary) { request, _ in
        guard request.url?.path == "/api/device/changes" else { return (404, Data()) }
        let n = calls.with { $0 += 1; return $0 }
        if n == 1 { return ok(ChangesAfter(seq: 41, changes: [], recipes: [], purgedRecipeIds: [], organization: org())) }
        Thread.sleep(forTimeInterval: 0.3)   // the catch-up the notices trigger stays in flight meanwhile
        return ok(ChangesAfter(seq: 45, changes: [change(45, ["z"])], recipes: [], purgedRecipeIds: [], organization: org()))
    }
    h.engine.start()
    #expect(await waitUntil { h.engine.state == .live })
    h.live.yield(45)
    try await Task.sleep(for: .milliseconds(50))
    h.live.yield(45)
    #expect(await waitUntil { h.store.seq == 45 })
    try await Task.sleep(for: .milliseconds(300))
    #expect(h.count("/api/device/changes") == 2)
    // an older or equal number does nothing
    h.live.yield(45)
    try await Task.sleep(for: .milliseconds(100))
    #expect(h.count("/api/device/changes") == 2)
    h.engine.stop()
}

@MainActor @Test func a401RefreshesOnceAndRetries() async throws {
    let h = try await Harness(host: "refresh.test") { request, refreshes in
        switch request.url?.path {
        case "/token": (200, Data(#"{"access_token":"B","refresh_token":"R2"}"#.utf8))
        case "/api/device/library":
            request.value(forHTTPHeaderField: "Authorization") == "Bearer B" ? ok(LibraryAtChange(seq: 7, recipes: [], organization: LibraryOrganization())) : (401, Data())
        default: (404, Data())
        }
    }
    let library = try await h.api.getLibrary()
    #expect(library.seq == 7)
    #expect(h.refreshes.with { $0 } == 1 && h.count("/api/device/library") == 2)
    let rotated = try await h.tokens.refreshToken()
    #expect(rotated == "R2")
    // two concurrent 401s share one refresh
    try await h.tokens.store(accessToken: "A", refreshToken: nil)
    async let one = h.api.getLibrary()
    async let two = h.api.getLibrary()
    _ = try await (one, two)
    #expect(h.refreshes.with { $0 } == 2)
}

@MainActor @Test func aFailedRefreshSignsOutAndKeepsTheFile() async throws {
    let h = try await Harness(host: "signedout.test", seq: startLibrary) { request, _ in
        request.url?.path == "/token" ? (400, Data(#"{"error":"invalid_grant"}"#.utf8)) : (401, Data())
    }
    h.engine.start()
    #expect(await waitUntil { h.engine.isSignedOut })
    #expect(FileManager.default.fileExists(atPath: h.file.path))
    #expect(LibraryStore(file: h.file).seq == 41)
    await #expect(throws: DeviceAPIError.signedOut) { _ = try await h.api.getLibrary() }
}

@MainActor @Test func errorsMapToDeviceAPIError() async throws {
    let h = try await Harness(host: "errors.test") { request, _ in
        switch request.url?.path {
        case "/api/device/library/edits":
            (422, Data(#"{"message":"m","problems":[{"edit":1,"rule":"trashed-recipes-leave-the-library","message":"weg","fix":"f"}]}"#.utf8))
        case "/api/device/recipes/trash": (404, Data(#"{"message":"m","recipeIds":["x"]}"#.utf8))
        case "/api/device/changes": (409, Data(#"{"message":"m"}"#.utf8))
        default: (500, Data())
        }
    }
    await #expect(throws: DeviceAPIError.refused([Problem(edit: 1, rule: "trashed-recipes-leave-the-library", message: "weg", fix: "f")])) {
        _ = try await h.api.editLibrary([.tag(tag: "K", recipeIds: ["a"])])
    }
    await #expect(throws: DeviceAPIError.notFound(["x"])) { _ = try await h.api.trashRecipes(["x"]) }
    await #expect(throws: DeviceAPIError.changesNotReached) { _ = try await h.api.listChangesAfter(99) }
    await #expect(throws: DeviceAPIError.server) { _ = try await h.api.getLibrary() }
}

@MainActor @Test func liveRequestUsesWebSocketSchemeAndHeaders() async throws {
    let h = try await Harness(host: "live.test") { _, _ in (404, Data()) }
    let request = try await h.api.liveURLRequest()
    #expect(request.url?.absoluteString == "ws://live.test/api/device/live")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer A" && request.value(forHTTPHeaderField: "x-device-name") == "iPhone")
}
