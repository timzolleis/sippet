import AlarmKit
import OSLog
import SippetCore
import SwiftUI
import UserNotifications

/// The running timers of cook mode (cooking 5): one per step with a duration.
@MainActor
protocol CookTimers: AnyObject {
    /// stepKey → when the timer ends, for the timers of this recipe.
    func running(in recipeId: String) -> [String: Date]
    /// Starts the step's timer. `elapsed` is for screenshots only: a timer that has already run that long.
    func start(_ step: Step, of recipe: DeviceRecipe, elapsed: TimeInterval)
    func cancel(_ step: Step, of recipe: DeviceRecipe)
}

extension CookTimers {
    func start(_ step: Step, of recipe: DeviceRecipe) { start(step, of: recipe, elapsed: 0) }
}

extension EnvironmentValues {
    @Entry var cookTimers: any CookTimers = SystemCookTimers.shared
}

/// Timers as system alarms (AlarmKit): they ring like the Clock app's with the app closed, and count down on the
/// Lock Screen and in the Dynamic Island (the widget extension draws that). If the cook declines alarms,
/// a local notification rings at the end instead and the countdown stays in the app.
@MainActor @Observable
final class SystemCookTimers: CookTimers {
    static let shared = SystemCookTimers()

    private struct Entry: Codable {
        enum Backing: String, Codable { case pending, alarm, notification }
        var recipeId: String
        var stepKey: String
        var end: Date
        var backing: Backing
    }

    private static let log = Logger(subsystem: "de.bastelboxx.sippet", category: "timers")
    private static let defaultsKey = "cookTimers.v1"
    private var entries: [String: Entry]

    private init() {
        let stored = UserDefaults.standard.data(forKey: Self.defaultsKey)
            .flatMap { try? JSONDecoder().decode([String: Entry].self, from: $0) } ?? [:]
        // A timer that never got scheduled, or ended long ago as a notification, is gone.
        entries = stored.filter { _, e in
            e.backing == .alarm || (e.backing == .notification && e.end.timeIntervalSinceNow > -6 * 3600)
        }
        reconcile((try? AlarmManager.shared.alarms) ?? [])
        Task { [weak self] in
            for await alarms in AlarmManager.shared.alarmUpdates { self?.reconcile(alarms) }
        }
    }

    func running(in recipeId: String) -> [String: Date] {
        entries.values.reduce(into: [:]) { if $1.recipeId == recipeId { $0[$1.stepKey] = $1.end } }
    }

    func start(_ step: Step, of recipe: DeviceRecipe, elapsed: TimeInterval) {
        guard let duration = step.duration else { return }
        let seconds = max(1, duration.minutes * 60 - elapsed)
        let key = Self.key(recipe.id, step.key)
        let end = Date.now.addingTimeInterval(seconds)
        entries[key] = Entry(recipeId: recipe.id, stepKey: step.key, end: end, backing: .pending)
        save()
        Task { await schedule(step, of: recipe, seconds: seconds, end: end) }
    }

    func cancel(_ step: Step, of recipe: DeviceRecipe) {
        let key = Self.key(recipe.id, step.key)
        guard entries.removeValue(forKey: key) != nil else { return }
        save()
        CookTimerID.end(CookTimerID.make(recipeId: recipe.id, stepKey: step.key))
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [Self.notificationId(recipe.id, step.key)])
    }

    // MARK: scheduling

    private func schedule(_ step: Step, of recipe: DeviceRecipe, seconds: TimeInterval, end: Date) async {
        let key = Self.key(recipe.id, step.key)
        let manager = AlarmManager.shared
        var authorization = manager.authorizationState
        if authorization == .notDetermined { authorization = (try? await manager.requestAuthorization()) ?? .denied }
        Self.log.info("alarm authorization \(String(describing: authorization), privacy: .public)")

        var backing = Entry.Backing.notification
        if authorization == .authorized {
            let id = CookTimerID.make(recipeId: recipe.id, stepKey: step.key)
            CookTimerID.end(id) // a timer of this step that still runs is replaced
            let stepTitle = [recipe.sections.first { $0.key == step.section }?.name, step.label]
                .compactMap { $0 }.joined(separator: " · ")
            let metadata = CookTimerMetadata(
                recipeId: recipe.id, recipeTitle: recipe.title, stepKey: step.key, stepTitle: stepTitle)
            do {
                try await Self.submit(id: id, metadata: metadata, alertTitle: "\(recipe.title) · \(step.label)",
                                      seconds: seconds, tint: Self.tint)
                backing = .alarm
            } catch {
                Self.log.error("alarm schedule failed: \(String(describing: error), privacy: .public)")
                backing = .notification // too many alarms, or the system refused: still ring
            }
        }
        if backing == .notification { await notify(step, of: recipe, seconds: seconds) }

        guard entries[key]?.end == end else { // cancelled or restarted while scheduling
            if backing == .alarm { CookTimerID.end(CookTimerID.make(recipeId: recipe.id, stepKey: step.key)) }
            return
        }
        entries[key]?.backing = backing
        save()
    }

    /// Off the main actor: AlarmKit's configuration isn't Sendable, so it is built where it is used.
    private nonisolated static func submit(
        id: UUID, metadata: CookTimerMetadata, alertTitle: String, seconds: TimeInterval, tint: Color
    ) async throws {
        let open = AlarmButton(text: "Open", textColor: .white, systemImageName: "arrow.right.circle.fill")
        let presentation = AlarmPresentation(
            alert: alert(title: "\(alertTitle)", open: open),
            // What the system shows when the extension can't (right after a restart, before the first unlock).
            countdown: .init(title: "\(metadata.stepTitle)"))
        let attributes = CookTimerAttributes(presentation: presentation, metadata: metadata, tintColor: tint)
        let configuration = AlarmManager.AlarmConfiguration<CookTimerMetadata>.timer(
            duration: seconds, attributes: attributes,
            stopIntent: StopCookTimerIntent(alarmID: id.uuidString),
            secondaryIntent: OpenCookModeIntent(alarmID: id.uuidString))
        _ = try await AlarmManager.shared.schedule(id: id, configuration: configuration)
    }

    /// The system draws the Stop button (iOS 26.1+); the secondary button opens the app.
    private nonisolated static func alert(title: LocalizedStringResource, open: AlarmButton) -> AlarmPresentation.Alert {
        .init(title: title, secondaryButton: open, secondaryButtonBehavior: .custom)
    }

    /// The accent from the Settings theme, as in dark mode: the Lock Screen is dark.
    private static var tint: Color {
        let defaults = UserDefaults.standard
        let theme = Theme(
            hue: defaults.object(forKey: Theme.hueKey).flatMap { $0 as? Double }.map(Float.init) ?? Theme.standard.hue,
            range: defaults.object(forKey: Theme.rangeKey).flatMap { $0 as? Double }.map(Float.init) ?? Theme.standard.range)
        let rgb = themeAccent(theme, dark: true)
        return Color(red: Double(rgb.x), green: Double(rgb.y), blue: Double(rgb.z))
    }

    // MARK: fallback

    private func notify(_ step: Step, of recipe: DeviceRecipe, seconds: TimeInterval) async {
        let center = UNUserNotificationCenter.current()
        _ = try? await center.requestAuthorization(options: [.alert, .sound])
        let content = UNMutableNotificationContent()
        content.title = recipe.title
        content.body = stepText(step)
        content.sound = .default
        let request = UNNotificationRequest(
            identifier: Self.notificationId(recipe.id, step.key), content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: max(1, seconds), repeats: false))
        try? await center.add(request)
    }

    // MARK: state

    /// The system's alarms are the truth for the timers it holds: one that is gone was stopped or cancelled.
    private func reconcile(_ alarms: [Alarm]) {
        let alive = Set(alarms.map(\.id))
        let gone = entries.filter { _, e in
            e.backing == .alarm && !alive.contains(CookTimerID.make(recipeId: e.recipeId, stepKey: e.stepKey))
        }
        guard !gone.isEmpty else { return }
        withAnimation { for key in gone.keys { entries[key] = nil } }
        save()
    }

    private func save() {
        UserDefaults.standard.set(try? JSONEncoder().encode(entries), forKey: Self.defaultsKey)
    }

    private static func key(_ recipeId: String, _ stepKey: String) -> String { "\(recipeId)|\(stepKey)" }
    private static func notificationId(_ recipeId: String, _ stepKey: String) -> String { "timer-\(recipeId)-\(stepKey)" }
}
