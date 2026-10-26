import AlarmKit
import AppIntents
import CryptoKit
import Foundation

// Compiled into the app and the widget extension (ios/Shared). The metadata type must be identical in both,
// or the countdown decodes to nothing and renders blank.

/// What the countdown on the Lock Screen and in the Dynamic Island shows (cooking 5): "Füllung · backen" of "Zupfkuchen".
nonisolated struct CookTimerMetadata: AlarmMetadata {
    var recipeId: String
    var recipeTitle: String
    var stepKey: String
    /// "Füllung · backen": the step's section and label.
    var stepTitle: String
}

typealias CookTimerAttributes = AlarmAttributes<CookTimerMetadata>

nonisolated enum CookTimerID {
    /// One alarm per (recipe, step): starting the same step's timer again replaces it, and the app finds its
    /// timers again after a restart without storing the ids.
    static func make(recipeId: String, stepKey: String) -> UUID {
        let hash = Array(SHA256.hash(data: Data("sippet.cook-timer\u{0}\(recipeId)\u{0}\(stepKey)".utf8)))
        var b = Array(hash.prefix(16))
        b[6] = (b[6] & 0x0F) | 0x50 // version 5 layout, name-based
        b[8] = (b[8] & 0x3F) | 0x80
        return UUID(uuid: (b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]))
    }

    /// Ends a timer: `stop` for one that rings, `cancel` for one still counting.
    static func end(_ id: UUID) {
        let manager = AlarmManager.shared
        if (try? manager.alarms.first { $0.id == id })?.state == .alerting {
            try? manager.stop(id: id)
        } else {
            try? manager.cancel(id: id)
        }
    }
}

/// The ✕ on the countdown and the Stop of the alert. Runs in the app's process, which the system wakes for it.
struct StopCookTimerIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Stop timer"

    @Parameter(title: "Timer") var alarmID: String

    init() { alarmID = "" }
    init(alarmID: String) { self.alarmID = alarmID }

    func perform() async throws -> some IntentResult {
        guard let id = UUID(uuidString: alarmID) else { return .result() }
        CookTimerID.end(id)
        return .result()
    }
}

/// "Open" on the ringing alert: stops the sound and brings the cook back to the app.
struct OpenCookModeIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Open Sippet"
    static let openAppWhenRun = true

    @Parameter(title: "Timer") var alarmID: String

    init() { alarmID = "" }
    init(alarmID: String) { self.alarmID = alarmID }

    func perform() async throws -> some IntentResult {
        if let id = UUID(uuidString: alarmID) { try? AlarmManager.shared.stop(id: id) }
        return .result()
    }
}
