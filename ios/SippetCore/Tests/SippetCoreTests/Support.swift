import Foundation
@testable import SippetCore

/// Finds test/golden/<name> by walking up from this file.
func goldenFile(_ name: String, file: StaticString = #filePath) -> URL {
    var dir = URL(fileURLWithPath: "\(file)").deletingLastPathComponent()
    while dir.path != "/" {
        let candidate = dir.appending(path: "test/golden/\(name)")
        if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
        dir = dir.deletingLastPathComponent()
    }
    fatalError("test/golden/\(name) not found")
}

func recipe(_ id: String = "r1", title: String, ingredients: [String] = [], steps: [String] = [], trashed: Bool = false) -> DeviceRecipe {
    DeviceRecipe(
        id: id, revision: 1, title: title, yield: Yield(amount: Amount(value: 4)),
        trashedAt: trashed ? Date(timeIntervalSince1970: 0) : nil, purgeAt: trashed ? Date(timeIntervalSince1970: 86_400) : nil,
        ingredients: ingredients.enumerated().map { Ingredient(key: "i\($0.offset)", item: $0.element) },
        steps: steps.enumerated().map { Step(key: "s\($0.offset)", label: $0.element) })
}

func tempFile(_ name: String = "library.json") -> URL {
    FileManager.default.temporaryDirectory.appending(path: "sippet-\(UUID().uuidString)/\(name)")
}

final class Lock<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value
    init(_ value: Value) { self.value = value }
    func with<R>(_ body: (inout Value) -> R) -> R { lock.withLock { body(&value) } }
}

/// A URLProtocol whose answers are registered per host, so tests run in parallel.
final class StubProtocol: URLProtocol, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest, Data) -> (Int, Data)
    private static let handlers = Lock<[String: Handler]>([:])

    static func register(host: String, _ handler: @escaping Handler) { handlers.with { $0[host] = handler } }

    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        return URLSession(configuration: configuration)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var body = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                body.append(buffer, count: n)
            }
            stream.close()
        }
        let handler = Self.handlers.with { $0[request.url?.host ?? ""] }
        let (status, data) = handler?(request, body) ?? (500, Data())
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

func json<T: Encodable>(_ value: T) -> Data { try! SippetJSON.encoder().encode(value) }

func waitUntil(timeout: Double = 5, _ condition: @MainActor () -> Bool) async -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if await condition() { return true }
        try? await Task.sleep(for: .milliseconds(10))
    }
    return await condition()
}
