import SippetCore
import SwiftUI

/// One scroll: header, Zutaten, Zubereitung. Wide screens put Zutaten left and Zubereitung right.
struct RecipeScreen: View {
    let recipe: DeviceRecipe
    @AppStorage(MeasurementSystem.defaultsKey) private var defaultUnits = MeasurementSystem.asWritten
    @State private var yield: Double
    @State private var unitsOverride: MeasurementSystem?
    @State private var checked: Set<String> = []
    @State private var shopped: Set<String> = []
    @State private var cooking = false
    @State private var showShopping = false
    @State private var showTable = false

    init(recipe: DeviceRecipe) {
        self.recipe = recipe
        _yield = State(initialValue: recipe.yield.amount.value)
    }

    private var units: MeasurementSystem { unitsOverride ?? defaultUnits }
    private var scaled: DeviceRecipe { scaleRecipe(recipe, toYield: yield) }

    var body: some View {
        let scaled = scaled
        GeometryReader { geo in
            if geo.size.width >= 720 {
                HStack(alignment: .top, spacing: 0) {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 36) {
                            header
                            ingredients(scaled)
                        }
                        .padding(28)
                    }
                    .frame(width: min(geo.size.width * 0.42, 460))
                    Divider()
                    ScrollView { steps(scaled).padding(28) }
                }
            } else {
                ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 44) {
                        header
                        ingredients(scaled)
                        steps(scaled).id("steps")
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 8)
                    .padding(.bottom, 48)
                    .frame(maxWidth: 680, alignment: .leading)
                    .frame(maxWidth: .infinity)
                }
                #if DEBUG
                .task {
                    if ProcessInfo.processInfo.arguments.contains("-SippetScrollSteps") {
                        try? await Task.sleep(for: .seconds(1))
                        proxy.scrollTo("steps", anchor: .top)
                    }
                }
                #endif
                }
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                if recipeTable(scaled) != nil {
                    Button("Table", systemImage: "tablecells") { showTable = true }
                }
                Button("Shopping", systemImage: "cart") { showShopping = true }
                Button("Cook") { cooking = true }
                    .fontWeight(.semibold)
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .disabled(recipe.steps.isEmpty)
            }
        }
        .fullScreenCover(isPresented: $cooking) {
            CookModeScreen(recipe: scaled, units: units, checked: $checked)
        }
        .fullScreenCover(isPresented: $showTable) {
            NavigationStack {
                RecipeTableScreen(recipe: scaled, units: units)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Close", systemImage: "xmark") { showTable = false }
                        }
                    }
            }
        }
        .sheet(isPresented: $showShopping) {
            ShoppingSheet(recipe: scaled, units: units, checked: $shopped)
        }
    }

    // MARK: header

    private var header: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(recipe.title)
                .font(.serif(.largeTitle, weight: .bold))
                .fixedSize(horizontal: false, vertical: true)
            Flow(spacing: 8) {
                yieldStepper
                if let minutes = recipe.totalMinutes {
                    Chip(text: Format.minutes(minutes), systemImage: "clock", font: .subheadline, minHeight: 44)
                }
                unitsMenu
                if let source = recipe.source {
                    Link(destination: source) {
                        Chip(text: source.host() ?? String(localized: "Source"), systemImage: "link", font: .subheadline, minHeight: 44)
                    }
                }
            }
        }
    }

    private var yieldStepper: some View {
        HStack(spacing: 0) {
            Button("Fewer", systemImage: "minus") { yield = max(1, yield - 1) }
                .disabled(yield <= 1)
            Text(yieldText)
                .font(.subheadline.weight(.medium))
                .monospacedDigit()
                .padding(.horizontal, 2)
            Button("More", systemImage: "plus") { yield = min(999, yield + 1) }
        }
        .labelStyle(.iconOnly)
        .imageScale(.small)
        .fontWeight(.semibold)
        .foregroundStyle(.secondary)
        .buttonStyle(YieldButtonStyle())
        .background(Color(.secondarySystemFill), in: .capsule)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(yieldText)
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: yield = min(999, yield + 1)
            case .decrement: yield = max(1, yield - 1)
            @unknown default: break
            }
        }
    }

    private var unitsMenu: some View {
        Menu {
            Picker("Units", selection: Binding(get: { units }, set: { unitsOverride = $0 })) {
                ForEach(MeasurementSystem.allCases, id: \.self) { Text($0.title).tag($0) }
            }
        } label: {
            Chip(text: units.titleText, systemImage: "scalemass", font: .subheadline, minHeight: 44)
        }
    }

    private var yieldText: String {
        let amount = Amount(value: yield, unit: recipe.yield.amount.unit)
        let text = amountText(amount, language: Format.language)
        // The vessel is an equipment key; show its name.
        guard let key = recipe.yield.vessel else { return text }
        return "\(text) · \(recipe.equipment.first { $0.key == key }?.name ?? key)"
    }

    // MARK: Zutaten

    private func ingredients(_ scaled: DeviceRecipe) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Ingredients").font(.serif(.title2)).accessibilityAddTraits(.isHeader)
            IngredientList(groups: ingredientGroups(scaled, units: units), checked: $checked)
        }
    }

    // MARK: Zubereitung

    private func steps(_ scaled: DeviceRecipe) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Preparation").font(.serif(.title2)).accessibilityAddTraits(.isHeader)
                .padding(.bottom, 8)
            ForEach(Array(scaled.steps.enumerated()), id: \.element.key) { index, step in
                if index > 0 { Divider() }
                stepRow(step, number: index + 1, in: scaled)
            }
        }
    }

    private func stepRow(_ step: Step, number: Int, in scaled: DeviceRecipe) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            Text("\(number)")
                .font(.serif(.title3))
                .monospacedDigit()
                .foregroundStyle(.tint)
                .frame(width: 28, alignment: .leading)
            VStack(alignment: .leading, spacing: 10) {
                Text(stepSentence(step, in: scaled))
                    .font(.body)
                    .lineSpacing(5)
                    .fixedSize(horizontal: false, vertical: true)
                let used = usedLine(step, in: scaled)
                if !used.isEmpty {
                    Text(used).font(.subheadline).foregroundStyle(.secondary).lineSpacing(2)
                }
                let facts = stepFacts(step, in: scaled)
                if !facts.isEmpty {
                    Flow(spacing: 6) {
                        ForEach(facts, id: \.text) { Chip(text: $0.text, systemImage: $0.icon) }
                    }
                }
            }
        }
        .padding(.vertical, 16)
        .accessibilityElement(children: .combine)
    }

    private func usedLine(_ step: Step, in recipe: DeviceRecipe) -> String {
        (step.uses ?? []).compactMap { key in
            recipe.ingredients.first { $0.key == key }.map { ingredient in
                [ingredient.amount.map { Format.amount($0, system: units) }, ingredient.item].compactMap { $0 }.joined(separator: " ")
            }
        }.joined(separator: " · ")
    }

    private func stepFacts(_ step: Step, in recipe: DeviceRecipe) -> [(text: String, icon: String)] {
        var facts: [(String, String)] = []
        if let d = step.duration { facts.append((Format.duration(d), "clock")) }
        if let t = step.temperature { facts.append((Format.temperature(t, system: units), "thermometer.medium")) }
        for key in step.equipment ?? [] {
            if let name = recipe.equipment.first(where: { $0.key == key })?.name { facts.append((name, "frying.pan")) }
        }
        return facts
    }
}

private struct YieldButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(width: 44, height: 44)
            .contentShape(.rect)
            .opacity(configuration.isPressed ? 0.5 : 1)
    }
}

// MARK: Einkaufen

private struct ShoppingSheet: View {
    let recipe: DeviceRecipe
    let units: MeasurementSystem
    @Binding var checked: Set<String>
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                IngredientList(groups: [IngredientGroup(title: nil, rows: rows)], checked: $checked)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 32)
                    .frame(maxWidth: 680)
                    .frame(maxWidth: .infinity)
            }
            .navigationTitle("Shopping")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var rows: [IngredientRowData] {
        itemTotals(recipe).map { total in
            let amounts = total.totals.map { Format.amount($0, system: units) }.joined(separator: " + ")
            let parts: [String] = total.bySection.compactMap { part in
                guard let amount = part.amount else { return nil }
                let name = recipe.sections.first { $0.key == part.sectionKey }?.name
                let value = Format.amount(amount, system: units)
                return name.map { "\(value) \($0)" } ?? value
            }
            let text = total.bySection.count > 1 && !parts.isEmpty ? "\(total.item) (\(parts.joined(separator: ", ")))" : total.item
            return IngredientRowData(id: total.item, amount: amounts.isEmpty ? nil : amounts, text: text)
        }
    }
}
