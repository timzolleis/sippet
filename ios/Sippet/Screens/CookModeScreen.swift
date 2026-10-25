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

/// One step per page, read at arm's length (cooking 4, 5). `recipe` is already scaled.
struct CookModeScreen: View {
    let recipe: DeviceRecipe
    let units: MeasurementSystem
    @Binding var checked: Set<String>
    @Environment(\.dismiss) private var dismiss
    @State private var index: Int
    @State private var timers: [String: Date] = [:]
    @State private var showAll = false

    init(recipe: DeviceRecipe, units: MeasurementSystem, checked: Binding<Set<String>> = .constant([]), startAt: Int = 0) {
        self.recipe = recipe
        self.units = units
        _checked = checked
        _index = State(initialValue: min(max(startAt, 0), max(recipe.steps.count - 1, 0)))
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            reminderBanner
            TabView(selection: $index) {
                ForEach(Array(recipe.steps.enumerated()), id: \.element.key) { i, step in
                    page(step, at: i).tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            bottomBar
        }
        .background(Color(.systemBackground))
        .sheet(isPresented: $showAll) {
            AllIngredientsSheet(recipe: recipe, units: units, checked: $checked)
        }
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            UNUserNotificationCenter.current().delegate = ForegroundNotifications.shared
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-SippetTimer") { startDebugTimers() }
            #endif
        }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }

    // MARK: chrome

    private var topBar: some View {
        HStack(spacing: 8) {
            HStack(spacing: 4) {
                ForEach(0..<recipe.steps.count, id: \.self) { i in
                    Capsule()
                        .fill(i <= index ? AnyShapeStyle(.tint) : AnyShapeStyle(Color(.tertiarySystemFill)))
                        .frame(height: 4)
                }
            }
            .animation(.easeOut(duration: 0.2), value: index)
            .accessibilityElement()
            .accessibilityLabel(Text("Step \(index + 1) of \(recipe.steps.count)"))
            Button("Close", systemImage: "xmark") { dismiss() }
                .labelStyle(.iconOnly)
                .font(.title3.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 60, height: 60)
                .contentShape(.rect)
        }
        .padding(.leading, 20)
        .padding(.trailing, 4)
    }

    /// Steps something later waits for stay pinned from the step after them until the step that waits (cooking 5).
    private var reminderBanner: some View {
        VStack(spacing: 6) {
            ForEach(reminders(at: index), id: \.key) { reminder in
                Label(stepSentence(reminder, in: recipe), systemImage: "bell")
                    .font(.subheadline.weight(.medium))
                    .lineLimit(2)
                    .foregroundStyle(.tint)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.tint.opacity(0.1), in: .rect(cornerRadius: 12))
                    .transition(.opacity)
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, reminders(at: index).isEmpty ? 0 : 4)
        .animation(.easeOut(duration: 0.2), value: index)
    }

    private func reminders(at i: Int) -> [Step] {
        recipe.steps.enumerated().compactMap { s, step in
            guard s < i else { return nil }
            let waiter = recipe.steps.enumerated().first { w, other in
                w > i && (other.flow?.waitsFor ?? other.waitsFor ?? []).contains(step.key)
            }
            return waiter == nil ? nil : step
        }
    }

    private var bottomBar: some View {
        VStack(spacing: 0) {
            if !runningSteps.isEmpty { timerBar }
            Divider()
            Button {
                showAll = true
            } label: {
                Label("All ingredients", systemImage: "list.bullet")
                    .font(.body.weight(.medium))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 60)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: page

    private func page(_ step: Step, at i: Int) -> some View {
        VStack(spacing: 0) {
            GeometryReader { geo in
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        Text("Step \(i + 1) of \(recipe.steps.count)")
                            .font(.subheadline.weight(.medium))
                            .textCase(.uppercase)
                            .tracking(0.8)
                            .foregroundStyle(.secondary)
                        // The ingredients and portions sit above; the fallback sentence would list them again.
                        Text(step.sentence ?? step.label)
                            .font(.system(.largeTitle, weight: .semibold))
                            .lineSpacing(4)
                            .fixedSize(horizontal: false, vertical: true)
                        result(step)
                        facts(step)
                        ingredientBlock(step)
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 16)
                    .padding(.bottom, 24)
                    .frame(maxWidth: 720, alignment: .topLeading)
                    .frame(maxWidth: .infinity, minHeight: geo.size.height, alignment: .topLeading)
                    .contentShape(.rect)
                    .gesture(SpatialTapGesture().onEnded { tap in turn(at: tap.location.x, width: geo.size.width) })
                }
            }
            // Pinned: what you tap with floury hands stays on screen.
            if step.duration != nil || i == recipe.steps.count - 1 {
                VStack(spacing: 12) {
                    if let duration = step.duration { timer(step, duration) }
                    if i == recipe.steps.count - 1 { finish }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .frame(maxWidth: 720)
            }
        }
    }

    /// The right or left third turns the page.
    private func turn(at x: CGFloat, width: CGFloat) {
        if x > width * 2 / 3, index < recipe.steps.count - 1 {
            withAnimation { index += 1 }
        } else if x < width / 3, index > 0 {
            withAnimation { index -= 1 }
        }
    }

    private var finish: some View {
        Button { dismiss() } label: {
            Text("Done")
                .font(.title2.weight(.semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 64)
                .background(.tint, in: .capsule)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private func facts(_ step: Step) -> some View {
        let equipment = (step.equipment ?? []).compactMap { key in recipe.equipment.first { $0.key == key }?.name }
        if step.temperature != nil || !equipment.isEmpty {
            Flow(spacing: 8) {
                if let t = step.temperature {
                    Chip(text: Format.temperature(t, system: units), systemImage: "thermometer.medium", font: .body)
                }
                ForEach(equipment, id: \.self) { Chip(text: $0, systemImage: "frying.pan", font: .body) }
            }
        }
    }

    // MARK: ingredients and what a step takes

    @ViewBuilder private func ingredientBlock(_ step: Step) -> some View {
        let used = (step.uses ?? []).compactMap { key in recipe.ingredients.first { $0.key == key } }
        // Plain steps (no flow) get the full list.
        let list = used.isEmpty && !recipe.hasFlow ? recipe.ingredients : used
        let taken = (step.flow?.takes ?? step.takes ?? []).compactMap(takenPart)
        if !list.isEmpty || !taken.isEmpty {
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 16, verticalSpacing: 8) {
                ForEach(list, id: \.key) { ingredient in
                    let parts = Format.ingredientParts(ingredient, system: units)
                    GridRow {
                        Text(parts.amount ?? "").fontWeight(.bold).monospacedDigit().fixedSize().gridColumnAlignment(.leading)
                        Text(parts.text)
                    }
                }
                ForEach(taken, id: \.name) { part in
                    GridRow {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text("+").foregroundStyle(.tint)
                            if let amount = part.amount { Text(amount).monospacedDigit() }
                        }
                        .fontWeight(.bold)
                        Text(part.name)
                    }
                }
            }
            .font(.body)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 20)
            .overlay(alignment: .top) { Divider() }
        }
    }

    private func takenPart(_ key: String) -> (name: String, amount: String?)? {
        for step in recipe.steps {
            if step.key == key { return (step.result?.name ?? step.label, step.result?.amount.map(formatted)) }
            if let portion = step.result?.split?.first(where: { $0.key == key }) {
                return (portion.name, portion.amount.map(formatted))
            }
        }
        return nil
    }

    private func formatted(_ amount: Amount) -> String { Format.amount(amount, system: units) }

    @ViewBuilder private func result(_ step: Step) -> some View {
        if let result = step.result {
            let lines = result.split?.map { resultLine(name: $0.name, amount: $0.amount) }
                ?? [resultLine(name: result.name ?? step.label, amount: result.amount)]
            VStack(alignment: .leading, spacing: 2) {
                ForEach(lines, id: \.self) { Text("Makes \($0)") }
            }
            .font(.title3)
            .foregroundStyle(.secondary)
        }
    }

    private func resultLine(name: String, amount: Amount?) -> String {
        amount.map { "\(formatted($0)) \(name)" } ?? name
    }

    // MARK: timer (cooking 5)

    @ViewBuilder private func timer(_ step: Step, _ duration: StepDuration) -> some View {
        if let end = timers[step.key] {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                HStack(spacing: 0) {
                    Group {
                        if end > context.date {
                            Label {
                                Text(timerInterval: context.date...end, countsDown: true).monospacedDigit()
                            } icon: { Image(systemName: "timer") }
                        } else {
                            Label("Time is up", systemImage: "bell.fill")
                        }
                    }
                    .font(.system(.title, design: .rounded, weight: .semibold))
                    .foregroundStyle(.tint)
                    .padding(.leading, 24)
                    Spacer(minLength: 8)
                    Button("Cancel timer", systemImage: "xmark") { cancelTimer(step) }
                        .labelStyle(.iconOnly)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 64, height: 64)
                        .contentShape(.rect)
                }
                .frame(maxWidth: .infinity, minHeight: 68)
                .background(.tint.opacity(0.12), in: .capsule)
            }
        } else {
            Button {
                Task { await startTimer(step, duration) }
            } label: {
                Label(Format.duration(duration), systemImage: "timer")
                    .font(.system(.title2, design: .rounded, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 68)
                    .background(.tint, in: .capsule)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Start timer"))
            .accessibilityValue(Format.duration(duration))
        }
    }

    /// Running timers stay at the bottom across pages; a tap jumps to the step.
    private var timerBar: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(runningSteps, id: \.offset) { offset, step in
                        if let end = timers[step.key] {
                            Button {
                                withAnimation { index = offset }
                            } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: end > context.date ? "timer" : "bell.fill")
                                    Text(step.label).lineLimit(1)
                                    if end > context.date {
                                        Text(timerInterval: context.date...end, countsDown: true).monospacedDigit().fontWeight(.semibold)
                                    } else {
                                        Text("Time is up").fontWeight(.semibold)
                                    }
                                }
                                .font(.body)
                                .foregroundStyle(.tint)
                                .padding(.horizontal, 16)
                                .frame(minHeight: 48)
                                .background(.tint.opacity(offset == index ? 0.18 : 0.1), in: .capsule)
                                .contentShape(.capsule)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
            }
            .scrollIndicators(.hidden)
        }
    }

    /// Timers of the other pages; the current page shows its own.
    private var runningSteps: [(offset: Int, element: Step)] {
        Array(recipe.steps.enumerated()).filter { timers[$0.element.key] != nil && $0.offset != index }
    }

    private func startTimer(_ step: Step, _ duration: StepDuration) async {
        let seconds = duration.minutes * 60
        withAnimation { timers[step.key] = Date.now.addingTimeInterval(seconds) }
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
        withAnimation { timers[step.key] = nil }
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["timer-\(recipe.id)-\(step.key)"])
    }

    #if DEBUG
    /// Launch argument -SippetTimer: the current step's timer is already running (screenshots).
    private func startDebugTimers() {
        let step = recipe.steps[index]
        if let d = step.duration { timers[step.key] = Date.now.addingTimeInterval(d.minutes * 60 - 754) }
    }
    #endif
}

private struct AllIngredientsSheet: View {
    let recipe: DeviceRecipe
    let units: MeasurementSystem
    @Binding var checked: Set<String>
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                IngredientList(groups: ingredientGroups(recipe, units: units), checked: $checked)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 32)
                    .frame(maxWidth: 680)
                    .frame(maxWidth: .infinity)
            }
            .navigationTitle("All ingredients")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
