import SippetCore
import SwiftUI

struct RecipeScreen: View {
    enum Tab: Hashable { case steps, ingredients, shopping }

    let recipe: DeviceRecipe
    @AppStorage(MeasurementSystem.defaultsKey) private var defaultUnits = MeasurementSystem.asWritten
    @State private var yield: Double
    @State private var unitsOverride: MeasurementSystem?
    @State private var tab: Tab = .steps
    @State private var cooking = false

    init(recipe: DeviceRecipe) {
        self.recipe = recipe
        _yield = State(initialValue: recipe.yield.amount.value)
    }

    private var units: MeasurementSystem { unitsOverride ?? defaultUnits }
    private var scaled: DeviceRecipe { scaleRecipe(recipe, toYield: yield) }

    var body: some View {
        let scaled = scaled
        List {
            Section { header }
            Section {
                Picker("View", selection: $tab) {
                    Text("Steps").tag(Tab.steps)
                    Text("Ingredients").tag(Tab.ingredients)
                    Text("Shopping").tag(Tab.shopping)
                }
                .pickerStyle(.segmented)
                .listRowInsets(.init(top: 8, leading: 16, bottom: 8, trailing: 16))
                .listRowBackground(Color.clear)
            }
            switch tab {
            case .steps: stepsSection(scaled)
            case .ingredients: ingredientsSections(scaled)
            case .shopping: shoppingSection(scaled)
            }
        }
        .navigationTitle(recipe.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Cook", systemImage: "frying.pan") { cooking = true }
                    .buttonStyle(.borderedProminent)
                    .disabled(recipe.steps.isEmpty)
            }
        }
        .fullScreenCover(isPresented: $cooking) {
            CookModeScreen(recipe: scaled, units: units)
        }
    }

    // MARK: header

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(recipe.title).font(.largeTitle.bold())
            HStack {
                Stepper(value: $yield, in: 1...999, step: 1) {
                    Label(yieldText, systemImage: "person.2")
                }
            }
            HStack {
                Menu {
                    Picker("Units", selection: Binding(get: { units }, set: { unitsOverride = $0 })) {
                        ForEach(MeasurementSystem.allCases, id: \.self) { Text($0.title).tag($0) }
                    }
                } label: {
                    Label(units.title, systemImage: "scalemass")
                }
                Spacer()
                if let source = recipe.source {
                    Link(destination: source) {
                        Label(source.host() ?? String(localized: "Source"), systemImage: "link")
                    }
                }
            }
            .font(.subheadline)
        }
    }

    private var yieldText: String {
        let amount = Amount(value: yield, unit: recipe.yield.amount.unit)
        let text = amountText(amount, language: Format.language)
        return recipe.yield.vessel.map { "\(text) (\($0))" } ?? text
    }

    // MARK: steps

    @ViewBuilder private func stepsSection(_ scaled: DeviceRecipe) -> some View {
        Section {
            ForEach(Array(scaled.steps.enumerated()), id: \.element.key) { index, step in
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text("\(index + 1)")
                        .font(.headline.monospacedDigit())
                        .foregroundStyle(.tint)
                        .frame(minWidth: 24, alignment: .trailing)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(stepSentence(step, in: scaled))
                        let facts = stepFacts(step, in: scaled)
                        if !facts.isEmpty {
                            Text(facts.joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func stepFacts(_ step: Step, in recipe: DeviceRecipe) -> [String] {
        var facts: [String] = []
        if let d = step.duration { facts.append(Format.duration(d)) }
        if let t = step.temperature { facts.append(Format.temperature(t, system: units)) }
        facts += (step.equipment ?? []).compactMap { key in recipe.equipment.first { $0.key == key }?.name }
        return facts
    }

    // MARK: ingredients

    @ViewBuilder private func ingredientsSections(_ scaled: DeviceRecipe) -> some View {
        let groups = ingredientGroups(scaled)
        ForEach(groups, id: \.title) { group in
            Section(group.title ?? "") {
                ForEach(group.items, id: \.key) { ingredient in
                    Text(Format.ingredientLine(ingredient, system: units))
                }
            }
        }
    }

    private func ingredientGroups(_ recipe: DeviceRecipe) -> [(title: String?, items: [Ingredient])] {
        var groups: [(title: String?, items: [Ingredient])] = []
        let loose = recipe.ingredients.filter { $0.section == nil }
        if !loose.isEmpty { groups.append((nil, loose)) }
        for section in recipe.sections {
            let items = recipe.ingredients.filter { $0.section == section.key }
            if !items.isEmpty { groups.append((section.name, items)) }
        }
        return groups
    }

    // MARK: shopping

    @ViewBuilder private func shoppingSection(_ scaled: DeviceRecipe) -> some View {
        Section {
            ForEach(itemTotals(scaled), id: \.item) { total in
                Text(shoppingLine(total, in: scaled))
            }
        }
    }

    private func shoppingLine(_ total: ItemTotal, in recipe: DeviceRecipe) -> String {
        let amounts = total.totals.map { Format.amount($0, system: units) }.joined(separator: " + ")
        var text = amounts.isEmpty ? total.item : "\(amounts) \(total.item)"
        let parts: [String] = total.bySection.compactMap { part in
            guard let amount = part.amount else { return nil }
            let name = recipe.sections.first { $0.key == part.sectionKey }?.name
            let value = Format.amount(amount, system: units)
            return name.map { "\(value) \($0)" } ?? value
        }
        if total.bySection.count > 1, !parts.isEmpty { text += " (\(parts.joined(separator: ", ")))" }
        return text
    }
}
