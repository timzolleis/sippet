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
    @Environment(\.cookTimers) private var cookTimers
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
            reminder
            TabView(selection: $index) {
                ForEach(Array(recipe.steps.enumerated()), id: \.element.key) { i, step in
                    CookPage(
                        step: step, number: i + 1, count: recipe.steps.count, recipe: recipe, units: units,
                        timer: { timerControl(step) },
                        turn: turn)
                        .tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            bottomBar
        }
        .fontDesign(.rounded)
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

    /// A thin bar, one segment per step, and close. Nothing else at the top.
    private var topBar: some View {
        HStack(spacing: 12) {
            HStack(spacing: 3) {
                ForEach(0..<recipe.steps.count, id: \.self) { i in
                    Capsule()
                        .fill(i <= index ? AnyShapeStyle(.tint) : AnyShapeStyle(Color(.systemFill)))
                        .frame(height: 4)
                }
            }
            .animation(.easeOut(duration: 0.2), value: index)
            .accessibilityElement()
            .accessibilityLabel(Text("Step \(index + 1) of \(recipe.steps.count)"))
            Button("Close", systemImage: "xmark") { dismiss() }
                .labelStyle(.iconOnly)
                .font(.title3.weight(.medium))
                .foregroundStyle(.secondary)
                .frame(width: 60, height: 60)
                .contentShape(.rect)
        }
        .padding(.leading, 24)
        .padding(.trailing, 6)
    }

    /// A step a later step waits for, from the step after it until the step that waits (cooking 5): a soft accent banner.
    private var reminder: some View {
        let steps = reminders(at: index)
        return VStack(alignment: .leading, spacing: 8) {
            ForEach(steps, id: \.key) { step in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Image(systemName: "bell.badge.fill").foregroundStyle(.tint)
                    Text(stepText(step)).foregroundStyle(.primary.opacity(0.8))
                }
                .font(.subheadline.weight(.medium))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.tint.opacity(0.1), in: .rect(cornerRadius: 14))
                .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 24)
        .padding(.bottom, steps.isEmpty ? 0 : 8)
        .animation(.easeOut(duration: 0.2), value: index)
        .accessibilityElement(children: .combine)
    }

    private func reminders(at i: Int) -> [Step] {
        recipe.steps.enumerated().compactMap { s, step in
            guard s < i else { return nil }
            let waits = recipe.steps.enumerated().contains { w, other in
                w > i && (other.flow?.waitsFor ?? other.waitsFor ?? []).contains(step.key)
            }
            return waits ? step : nil
        }
    }

    private var bottomBar: some View {
        VStack(spacing: 0) {
            if !runningSteps.isEmpty { timerBar }
            HStack {
                Button {
                    showAll = true
                } label: {
                    Label("All ingredients", systemImage: "checklist")
                        .font(.body.weight(.semibold))
                        .padding(.horizontal, 8)
                        .frame(minHeight: 46) // + the glass padding: a 60 pt target
                        .contentShape(.capsule)
                }
                .buttonStyle(.glass)
                .padding(.leading, 24)
                Spacer()
                if index == recipe.steps.count - 1 {
                    Button { dismiss() } label: {
                        Text("Done")
                            .font(.title3.weight(.semibold))
                            .padding(.horizontal, 28)
                            .frame(minHeight: 60)
                            .contentShape(.capsule)
                    }
                    .buttonStyle(.glassProminent)
                    .padding(.trailing, 16)
                    .transition(.opacity)
                }
            }
            .padding(.bottom, 4)
            .animation(.easeOut(duration: 0.2), value: index)
        }
    }

    /// The right or left third turns the page.
    private func turn(_ forward: Bool) {
        if forward, index < recipe.steps.count - 1 {
            withAnimation { index += 1 }
        } else if !forward, index > 0 {
            withAnimation { index -= 1 }
        }
    }

    // MARK: timer (cooking 5)

    @ViewBuilder private func timerControl(_ step: Step) -> some View {
        if let duration = step.duration {
            if let end = timers[step.key] {
                RunningTimer(end: end, total: duration.minutes * 60) { cancelTimer(step) }
            } else {
                Button {
                    startTimer(step)
                } label: {
                    Label(Format.duration(duration), systemImage: "timer")
                        .font(.system(.title2, design: .rounded, weight: .semibold))
                        .monospacedDigit()
                        .frame(maxWidth: .infinity, minHeight: 64)
                        .contentShape(.capsule)
                }
                .buttonStyle(.glassProminent)
                .accessibilityLabel(Text("Start timer"))
                .accessibilityValue(Format.duration(duration))
            }
        }
    }

    /// Running timers of the other pages, at the bottom across pages; a tap jumps to the step.
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
                                    Image(systemName: end > context.date ? "timer" : "bell.fill").foregroundStyle(.tint)
                                    Text(step.label).lineLimit(1).foregroundStyle(.secondary)
                                    Group {
                                        if end > context.date {
                                            Text(timerInterval: context.date...end, countsDown: true)
                                        } else {
                                            Text("Time is up")
                                        }
                                    }
                                    .monospacedDigit()
                                    .fontWeight(.semibold)
                                    .foregroundStyle(.tint)
                                }
                                .font(.body)
                                .padding(.horizontal, 18)
                                .frame(minHeight: 52)
                                .background(Color(.secondarySystemFill), in: .capsule)
                                .contentShape(.capsule)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 8)
            }
            .scrollIndicators(.hidden)
        }
    }

    /// stepKey → end of this recipe's running timers; the system holds them (CookTimers).
    private var timers: [String: Date] { cookTimers.running(in: recipe.id) }

    /// Timers of the other pages; the current page shows its own.
    private var runningSteps: [(offset: Int, element: Step)] {
        Array(recipe.steps.enumerated()).filter { timers[$0.element.key] != nil && $0.offset != index }
    }

    private func startTimer(_ step: Step) {
        withAnimation { cookTimers.start(step, of: recipe) }
    }

    private func cancelTimer(_ step: Step) {
        withAnimation { cookTimers.cancel(step, of: recipe) }
    }

    #if DEBUG
    /// Launch argument -SippetTimer: the opened step's timer has been running for 12 min 34 s (screenshots).
    private func startDebugTimers() {
        let step = recipe.steps[index]
        cookTimers.start(step, of: recipe, elapsed: 754)
    }
    #endif
}

/// One page: "Schritt 6 von 10", what goes in with amounts, then the step in large type, then its facts.
private struct CookPage<Timer: View>: View {
    let step: Step
    let number: Int
    let count: Int
    let recipe: DeviceRecipe
    let units: MeasurementSystem
    @ViewBuilder let timer: () -> Timer
    let turn: (Bool) -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { geo in
                // Landscape: what goes in on the left, the step on the right, so the step stays on screen.
                let side = geo.size.width > geo.size.height && geo.size.width >= 560 && hasIngredients
                ScrollView {
                    VStack(alignment: .leading, spacing: 28) {
                        stepBadge
                        if side {
                            HStack(alignment: .top, spacing: 32) {
                                // As wide as the ingredients need, at most half; then they wrap.
                                ViewThatFits(in: .horizontal) {
                                    ingredients.fixedSize(horizontal: true, vertical: false)
                                    ingredients
                                }
                                .frame(maxWidth: geo.size.width * 0.5, alignment: .leading)
                                stepBody
                            }
                        } else {
                            ingredients
                            stepBody
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 20)
                    .padding(.bottom, 24)
                    .frame(maxWidth: side ? 1000 : 680, alignment: .topLeading)
                    .frame(maxWidth: .infinity, minHeight: geo.size.height, alignment: .top)
                    .contentShape(.rect)
                    .gesture(SpatialTapGesture().onEnded { tap in
                        if tap.location.x > geo.size.width * 2 / 3 { turn(true) }
                        else if tap.location.x < geo.size.width / 3 { turn(false) }
                    })
                }
                .scrollBounceBehavior(.basedOnSize)
            }
            if step.duration != nil {
                timer()
                    .padding(.horizontal, 24)
                    .padding(.vertical, 8)
                    .frame(maxWidth: 680)
            }
        }
    }

    private var hasIngredients: Bool {
        !(step.uses ?? []).isEmpty || !takenParts(step, in: recipe, units: units).isEmpty
    }

    private var stepBody: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(stepText(step))
                .font(textFont)
                .lineSpacing(6)
                .fixedSize(horizontal: false, vertical: true)
            // The timer below shows the duration.
            let facts = stepFacts(step, in: recipe, units: units, duration: false)
            if !facts.isEmpty {
                FactRow(facts: facts, spacing: 10).font(.title3)
            }
            if let made = madeLine {
                Label(made, systemImage: "arrow.turn.down.right")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// "Step 6 of 10" in an accent capsule, the section after it.
    private var stepBadge: some View {
        let section = step.section.flatMap { key in recipe.sections.first { $0.key == key }?.name }
        return Flow(spacing: 10, lineSpacing: 8) {
            Text("Step \(number) of \(count)")
                .foregroundStyle(.tint)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(.tint.opacity(0.12), in: .capsule)
            if let section {
                Text(verbatim: section)
                    .textCase(.uppercase)
                    .tracking(0.9)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 6)
            }
        }
        .font(.subheadline.weight(.semibold))
        .monospacedDigit()
        .accessibilityElement(children: .combine)
    }

    /// A sentence reads at title size; a bare label ("backen") is short enough to go larger.
    private var textFont: Font {
        stepText(step).count > 48
            ? .rounded(.title, weight: .medium)
            : .rounded(.largeTitle, weight: .semibold)
    }

    /// The ingredients this step uses, then what it takes from earlier steps. Plain steps (no flow) list nothing.
    @ViewBuilder private var ingredients: some View {
        let used = (step.uses ?? []).compactMap { key in recipe.ingredients.first { $0.key == key } }
        let taken = takenParts(step, in: recipe, units: units)
        if !used.isEmpty || !taken.isEmpty {
            let rows = used.map { ($0.key, $0.amount.map { a in Format.amount(a, system: units) }, ingredientText($0)) }
                + taken.map { ($0.name, $0.amount, Text($0.name)) }
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(rows, id: \.0) { _, amount, text in
                        VStack(alignment: .leading, spacing: 0) {
                            if let amount { StackedAmount(amount: amount) }
                            text
                        }
                    }
                }
                .font(.title3)
            } else {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 18, verticalSpacing: 8) {
                    ForEach(rows, id: \.0) { _, amount, text in
                        GridRow {
                            Group {
                                if let amount { StackedAmount(amount: amount).monospacedDigit() } else { Color.clear.frame(width: 0, height: 0) }
                            }
                            .fixedSize()
                            text.fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .font(.title3)
            }
        }
    }

    /// "Ergibt 750 g Teig: 500 g Boden, 250 g Zupfteig".
    private var madeLine: String? {
        guard let result = step.result, let name = result.name else { return nil }
        let fmt = { (a: Amount) in Format.amount(a, system: units) }
        let made = result.amount.map { "\(fmt($0)) \(name)" } ?? name
        let split = (result.split ?? []).map { p in p.amount.map { "\(fmt($0)) \(p.name)" } ?? p.name }
        let line = split.isEmpty ? made : "\(made): \(split.joined(separator: ", "))"
        return String(localized: "Makes \(line)")
    }
}

/// The current page's timer, counting down in place; the fill behind it is the time gone.
private struct RunningTimer: View {
    let end: Date
    let total: Double
    let cancel: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let left = end.timeIntervalSince(context.date)
            HStack(spacing: 0) {
                Group {
                    if left > 0 {
                        Label {
                            Text(timerInterval: context.date...end, countsDown: true)
                        } icon: { Image(systemName: "timer").foregroundStyle(.tint) }
                    } else {
                        Label { Text("Time is up") } icon: { Image(systemName: "bell.fill") }
                            .foregroundStyle(.tint)
                    }
                }
                .font(.rounded(.largeTitle, weight: .semibold))
                .monospacedDigit()
                .padding(.leading, 24)
                Spacer(minLength: 8)
                Button("Cancel timer", systemImage: "xmark", action: cancel)
                    .labelStyle(.iconOnly)
                    .font(.title3.weight(.medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 64, height: 64)
                    .contentShape(.rect)
            }
            .frame(maxWidth: .infinity, minHeight: 64)
            .background {
                GeometryReader { geo in
                    let gone = total > 0 ? min(max(1 - left / total, 0), 1) : 1
                    ZStack(alignment: .leading) {
                        Rectangle().fill(.tint.opacity(0.1))
                        Rectangle().fill(.tint.opacity(0.18)).frame(width: geo.size.width * gone)
                    }
                }
                .clipShape(.capsule)
            }
        }
    }
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
                    .padding(.top, 8)
                    .padding(.bottom, 32)
                    .frame(maxWidth: 620)
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
