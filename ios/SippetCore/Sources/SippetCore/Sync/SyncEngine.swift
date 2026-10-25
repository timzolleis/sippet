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

/// Opens the live socket; yields each `{"seq": n}`. Fails with `LiveError.tokenExpired` on close 4401 or a 401 upgrade.
public typealias LiveConnector = @Sendable () async throws -> AsyncThrowingStream<Int, any Error>

public enum LiveError: Error, Sendable { case tokenExpired, closed }

/// The real socket: `URLSessionWebSocketTask` with an Authorization header (device-api.md Live).
public func webSocketLive(api: DeviceAPI, session: URLSession = .shared) -> LiveConnector {
    {
        let request = try await api.liveURLRequest()
        let task = session.webSocketTask(with: request)
        task.resume()
        return AsyncThrowingStream { continuation in
            let reader = Task {
                do {
                    while true {
                        let message = try await task.receive()
                        guard case .string(let text) = message else { continue }
                        if let seq = try? JSONDecoder().decode([String: Int].self, from: Data(text.utf8))["seq"] { continuation.yield(seq) }
                    }
                } catch {
                    let unauthorized = (task.response as? HTTPURLResponse)?.statusCode == 401
                    continuation.finish(throwing: unauthorized || task.closeCode.rawValue == 4401 ? LiveError.tokenExpired : error)
                }
            }
            let keepAlive = Task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(25))
                    try? await task.send(.string("ping"))
                }
            }
            continuation.onTermination = { _ in
                reader.cancel()
                keepAlive.cancel()
                task.cancel(with: .goingAway, reason: nil)
            }
        }
    }
}

@MainActor @Observable
public final class SyncEngine {
    public private(set) var state: SyncState = .offline
    public private(set) var lastNotice: ChangeNotice?
    /// Set when a refresh failed: the app shows SignInScreen.
    public private(set) var isSignedOut = false

    @ObservationIgnored private let api: DeviceAPI
    @ObservationIgnored private let store: LibraryStore
    @ObservationIgnored private let deviceName: @Sendable () -> String
    @ObservationIgnored private let connect: LiveConnector
    @ObservationIgnored private let maxDelay: Double
    @ObservationIgnored private var runTask: Task<Void, Never>?
    @ObservationIgnored private var catchUpTask: Task<Void, Never>?
    @ObservationIgnored private var newestKnown = 0

    /// `deviceName` tells this device's own changes from others' (no notice for them).
    public init(
        api: DeviceAPI, store: LibraryStore, deviceName: @escaping @Sendable () -> String,
        live: LiveConnector? = nil, session: URLSession = .shared, maxReconnectDelay: Double = 30
    ) {
        self.api = api
        self.store = store
        self.deviceName = deviceName
        self.connect = live ?? webSocketLive(api: api, session: session)
        self.maxDelay = maxReconnectDelay
    }

    /// Scene active: catch up, then listen.
    public func start() {
        guard runTask == nil else { return }
        isSignedOut = false
        runTask = Task { await run() }
    }

    /// Scene in background: close the socket.
    public func stop() {
        runTask?.cancel()
        runTask = nil
        catchUpTask?.cancel()
        catchUpTask = nil
        state = .offline
    }

    /// One catch-up now (pull to refresh, after a write). Waits for it.
    public func catchUp() async throws(DeviceAPIError) {
        try await catchUpOnce()
    }

    // MARK: loop

    private func run() async {
        var delay = 1.0
        while !Task.isCancelled {
            do {
                state = .catchingUp
                try await catchUpOnce()
                let stream = try await connect()
                state = .live
                delay = 1
                for try await seq in stream { noticed(seq) }
                throw LiveError.closed
            } catch DeviceAPIError.signedOut {
                signOutDetected()
                return
            } catch LiveError.tokenExpired {
                do { try await api.refreshTokens() } catch DeviceAPIError.signedOut {
                    signOutDetected()
                    return
                } catch {}
            } catch is CancellationError {
                return
            } catch {
                state = .offline
                try? await Task.sleep(for: .seconds(delay))
                delay = min(delay * 2, maxDelay)
            }
        }
    }

    private func signOutDetected() {
        isSignedOut = true
        state = .offline
        runTask = nil
        catchUpTask?.cancel()
        catchUpTask = nil
    }

    /// A `{"seq": n}` message: catch up if n is newer. At most one catch-up runs; a newer n meanwhile makes it run again.
    func noticed(_ seq: Int) {
        newestKnown = max(newestKnown, seq)
        guard catchUpTask == nil, seq > (store.seq ?? 0) else { return }
        catchUpTask = Task {
            do {
                while (store.seq ?? 0) < newestKnown, !Task.isCancelled { try await catchUpOnce() }
            } catch DeviceAPIError.signedOut {
                signOutDetected()
            } catch {
                // the live loop notices a broken connection; the next start catches up again
                state = .offline
            }
            catchUpTask = nil
        }
    }

    // MARK: catch-up

    private func catchUpOnce() async throws(DeviceAPIError) {
        guard let seq = store.seq else {
            try await reload()
            return
        }
        let changes: ChangesAfter
        do {
            changes = try await api.listChangesAfter(seq)
        } catch DeviceAPIError.changesNotReached {
            try await reload()
            return
        }
        do { try store.apply(changes) } catch { throw .server }
        lastNoticeFrom(changes)
    }

    private func reload() async throws(DeviceAPIError) {
        let library = try await api.getLibrary()
        do { try store.replace(with: library) } catch { throw .server }
    }

    // MARK: notice (sync rule 4)

    private func lastNoticeFrom(_ changes: ChangesAfter) {
        let own = deviceName()
        let others = changes.changes.filter { $0.by.kind != .trash && !($0.by.kind == .device && $0.by.name == own) }
        guard let newest = others.last else { return }
        let theirs = others.filter { $0.by.name == newest.by.name }
        var ids: [String] = []
        for id in theirs.flatMap(\.recipeIds) where !ids.contains(id) { ids.append(id) }
        let text: String
        switch ids.count {
        case 0:
            text = "\(newest.by.name) hat die Bibliothek geändert"
        case 1:
            let title = store.recipes[ids[0]]?.title ?? "ein Rezept"
            let revised = theirs.allSatisfy { $0.kind == .recipeRevised }
            text = "\(newest.by.name) hat \(title) \(revised ? "überarbeitet" : "geändert")"
        default:
            text = "\(newest.by.name) hat \(ids.count) Rezepte geändert"
        }
        lastNotice = ChangeNotice(author: newest.by.name, recipeIds: ids, text: text)
    }
}
