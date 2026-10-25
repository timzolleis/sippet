import SippetCore
import SwiftUI
import UserNotifications

/// Shows local notifications while the app is in the foreground too.
final class ForegroundNotifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = ForegroundNotifications()
    func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions { [.banner, .sound] }
}

/// One step per page, large type (cooking 4, 5). `recipe` is already scaled.
struct CookModeScreen: View {
    let recipe: DeviceRecipe
    let units: MeasurementSystem
    @Environment(\.dismiss) private var dismiss
    @State private var index = 0
    @State private var timers: [String: Date] = [:]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TabView(selection: $index) {
                    ForEach(Array(recipe.steps.enumerated()), id: \.element.key) { i, step in
                        page(step, at: i).tag(i)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                controls
            }
            .navigationTitle(recipe.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
            }
        }
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            UNUserNotificationCenter.current().delegate = ForegroundNotifications.shared
        }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }

    // MARK: controls

    private var controls: some View {
        HStack {
            Button("Previous", systemImage: "chevron.left") { withAnimation { index -= 1 } }
                .labelStyle(.iconOnly)
                .disabled(index == 0)
            Spacer()
            Text("Step \(index + 1) of \(recipe.steps.count)")
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
            Spacer()
            Button("Next", systemImage: "chevron.right") { withAnimation { index += 1 } }
                .labelStyle(.iconOnly)
                .disabled(index >= recipe.steps.count - 1)
        }
        .font(.title2)
        .padding()
        .background(.bar)
    }

    // MARK: page

    private func page(_ step: Step, at i: Int) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                ForEach(reminders(at: i), id: \.key) { reminder in
                    Label(stepSentence(reminder, in: recipe), systemImage: "bell.badge")
                        .font(.callout.weight(.medium))
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.tint.opacity(0.12), in: .rect(cornerRadius: 12))
                }
                Text(stepSentence(step, in: recipe))
                    .font(.system(.title, design: .default, weight: .semibold))
                facts(step)
                if let duration = step.duration { timer(step, duration) }
                uses(step)
                takes(step)
                result(step)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func facts(_ step: Step) -> some View {
        var facts: [String] = []
        if let t = step.temperature { facts.append(Format.temperature(t, system: units)) }
        if let d = step.duration { facts.append(Format.duration(d)) }
        facts += (step.equipment ?? []).compactMap { key in recipe.equipment.first { $0.key == key }?.name }
        return Group {
            if !facts.isEmpty { Text(facts.joined(separator: " · ")).font(.title3).foregroundStyle(.secondary) }
        }
    }

    /// Steps something later waits for stay pinned from the step after them until the step that waits (cooking 5).
    private func reminders(at i: Int) -> [Step] {
        recipe.steps.enumerated().compactMap { s, step in
            guard s < i else { return nil }
            let waiter = recipe.steps.enumerated().first { w, other in
                w > i && (other.flow?.waitsFor ?? other.waitsFor ?? []).contains(step.key)
            }
            return waiter == nil ? nil : step
        }
    }

    // MARK: ingredients and results

    @ViewBuilder private func uses(_ step: Step) -> some View {
        let used = (step.uses ?? []).compactMap { key in recipe.ingredients.first { $0.key == key } }
        // Plain steps (no flow) get the full list.
        let list = used.isEmpty && !recipe.hasFlow ? recipe.ingredients : used
        if !list.isEmpty {
            block(used.isEmpty ? "Ingredients" : "Ingredients for this step") {
                ForEach(list, id: \.key) { Text(Format.ingredientLine($0, system: units)) }
            }
        }
    }

    @ViewBuilder private func takes(_ step: Step) -> some View {
        let lines = (step.flow?.takes ?? step.takes ?? []).compactMap(takenLine)
        if !lines.isEmpty {
            block("Takes") { ForEach(lines, id: \.self) { Text($0) } }
        }
    }

    private func takenLine(_ key: String) -> String? {
        for step in recipe.steps {
            if step.key == key { return resultLine(name: step.result?.name ?? step.label, amount: step.result?.amount) }
            if let portion = step.result?.split?.first(where: { $0.key == key }) {
                return resultLine(name: portion.name, amount: portion.amount)
            }
        }
        return nil
    }

    @ViewBuilder private func result(_ step: Step) -> some View {
        if let result = step.result {
            let lines = result.split?.map { resultLine(name: $0.name, amount: $0.amount) }
                ?? [resultLine(name: result.name ?? step.label, amount: result.amount)]
            block("Makes") { ForEach(lines, id: \.self) { Text($0) } }
        }
    }

    private func resultLine(name: String, amount: Amount?) -> String {
        amount.map { "\(Format.amount($0, system: units)) \(name)" } ?? name
    }

    private func block<Content: View>(_ title: LocalizedStringKey, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.footnote.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
            content().font(.title3)
        }
    }

    // MARK: timer (cooking 5)

    @ViewBuilder private func timer(_ step: Step, _ duration: StepDuration) -> some View {
        if let end = timers[step.key] {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                HStack {
                    if end > context.date {
                        Text(timerInterval: context.date...end, countsDown: true)
                            .font(.system(size: 44, weight: .semibold, design: .rounded).monospacedDigit())
                    } else {
                        Label("Time is up", systemImage: "bell.fill").font(.title2.weight(.semibold)).foregroundStyle(.tint)
                    }
                    Spacer()
                    Button("Cancel timer", systemImage: "xmark.circle") { cancelTimer(step) }
                        .labelStyle(.iconOnly).font(.title2)
                }
            }
        } else {
            Button("Start timer", systemImage: "timer") { Task { await startTimer(step, duration) } }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
        }
    }

    private func startTimer(_ step: Step, _ duration: StepDuration) async {
        let seconds = duration.minutes * 60
        timers[step.key] = Date.now.addingTimeInterval(seconds)
        let center = UNUserNotificationCenter.current()
        _ = try? await center.requestAuthorization(options: [.alert, .sound])
        let content = UNMutableNotificationContent()
        content.title = recipe.title
        content.body = stepSentence(step, in: recipe)
        content.sound = .default
        let request = UNNotificationRequest(
            identifier: "timer-\(recipe.id)-\(step.key)", content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: max(1, seconds), repeats: false))
        try? await center.add(request)
    }

    private func cancelTimer(_ step: Step) {
        timers[step.key] = nil
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["timer-\(recipe.id)-\(step.key)"])
    }
}
