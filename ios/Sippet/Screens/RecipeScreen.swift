import SippetCore
import SwiftUI

/// A cookbook page: title, quiet facts, Zutaten, Zubereitung, in one scroll.
/// Wide (iPad, landscape): Zutaten left, Zubereitung right, each scrolling on its own.
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
            if geo.size.width >= 560 {
                wide(scaled, width: geo.size.width)
            } else {
                narrow(scaled)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                if recipeTable(scaled) != nil {
                    Button("Table", systemImage: "tablecells") { showTable = true }
                }
                Button("Shopping", systemImage: "basket") { showShopping = true }
            }
            ToolbarSpacer(.fixed, placement: .primaryAction)
            ToolbarItem(placement: .primaryAction) {
                Button("Cook") { cooking = true }
                    .fontWeight(.semibold)
                    .buttonStyle(.glassProminent)
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
        #if DEBUG
        .task {
            if ProcessInfo.processInfo.arguments.contains("-SippetShopping") { showShopping = true }
        }
        #endif
    }

    // MARK: layouts

    private func narrow(_ scaled: DeviceRecipe) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 40) {
                    header(wide: false)
                    ingredients(scaled)
                    steps(scaled).id("steps")
                }
                .padding(.horizontal, 24)
                .padding(.top, 4)
                .padding(.bottom, 56)
                .frame(maxWidth: 620, alignment: .leading)
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

    private func wide(_ scaled: DeviceRecipe, width: CGFloat) -> some View {
        HStack(alignment: .top, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 36) {
                    header(wide: true)
                    ingredients(scaled)
                }
                .padding(.horizontal, 32)
                .padding(.top, 4)
                .padding(.bottom, 48)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(width: min(max(width * 0.42, 250), 440))
            Rectangle().fill(.separator).frame(width: 0.5).ignoresSafeArea(edges: .bottom)
            ScrollView {
                steps(scaled)
                    .padding(.horizontal, 36)
                    .padding(.top, 4)
                    .padding(.bottom, 48)
                    .frame(maxWidth: 640, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    // MARK: header

    /// In the narrow left column the title steps down a size, so long German words don't break.
    private func header(wide: Bool) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(recipe.title)
                .font(.serif(wide ? .title : .largeTitle, weight: .bold))
                .lineSpacing(-2)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            meta
            Flow(spacing: 8, lineSpacing: 8) {
                yieldStepper
                unitsMenu
            }
            .padding(.top, 4)
        }
    }

    /// Total time, the vessel, the source: one quiet line.
    @ViewBuilder private var meta: some View {
        let minutes = recipe.totalMinutes.map(Format.minutes)
        let vessel = recipe.yield.vessel.map { key in recipe.equipment.first { $0.key == key }?.name ?? key }
        if minutes != nil || vessel != nil || recipe.source != nil {
            Flow(spacing: 16, lineSpacing: 4) {
                if let minutes {
                    Label(minutes, systemImage: "clock")
                }
                if let vessel {
                    Label(vessel, systemImage: "circle.dashed")
                }
                if let source = recipe.source {
                    Link(destination: source) {
                        Label(source.host()?.replacingOccurrences(of: "www.", with: "") ?? String(localized: "Source"),
                              systemImage: "arrow.up.right")
                            .labelStyle(TrailingIconLabelStyle())
                    }
                    .foregroundStyle(.secondary)
                }
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .labelStyle(QuietIconLabelStyle())
        }
    }

    private var yieldStepper: some View {
        HStack(spacing: 0) {
            Button("Fewer", systemImage: "minus") { yield = max(1, yield - 1) }
                .disabled(yield <= 1)
            Text(yieldText)
                .monospacedDigit()
            Button("More", systemImage: "plus") { yield = min(999, yield + 1) }
        }
        .font(.subheadline.weight(.medium))
        .labelStyle(.iconOnly)
        .buttonStyle(StepperButtonStyle())
        .modifier(HairlineCapsule())
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
            HStack(spacing: 6) {
                Text(units.title)
                Image(systemName: "chevron.up.chevron.down").imageScale(.small).foregroundStyle(.secondary)
            }
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 16)
            .modifier(HairlineCapsule())
        }
        .tint(.primary)
    }

    /// "12 Stück"; the vessel sits in the line above, so the stepper stays one short line.
    private var yieldText: String {
        amountText(Amount(value: yield, unit: recipe.yield.amount.unit), language: Format.language)
    }

    // MARK: Zutaten

    private func ingredients(_ scaled: DeviceRecipe) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            heading("Ingredients")
            IngredientList(groups: ingredientGroups(scaled, units: units), checked: $checked)
        }
    }

    private func heading(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .font(.serif(.title2, weight: .bold))
            .accessibilityAddTraits(.isHeader)
    }

    // MARK: Zubereitung

    private func steps(_ scaled: DeviceRecipe) -> some View {
        VStack(alignment: .leading, spacing: 28) {
            heading("Preparation")
                .padding(.bottom, -6)
            ForEach(Array(scaled.steps.enumerated()), id: \.element.key) { index, step in
                StepRow(number: index + 1, step: step, recipe: scaled, units: units)
            }
        }
    }
}

/// "1  Springform einfetten, optional mit Backpapier auslegen." with what it uses and its facts underneath, quiet.
private struct StepRow: View {
    let number: Int
    let step: Step
    let recipe: DeviceRecipe
    let units: MeasurementSystem
    @ScaledMetric(relativeTo: .title3) private var numberWidth: CGFloat = 24
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 10))
        layout {
            Text(number, format: .number)
                .font(.serif(.title3, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(.tint)
                .frame(width: typeSize.isAccessibilitySize ? nil : numberWidth, alignment: .leading)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 10) {
                Text(stepText(step))
                    .font(.body)
                    .lineSpacing(5)
                    .fixedSize(horizontal: false, vertical: true)
                if let used = usedLine {
                    used
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                let facts = stepFacts(step, in: recipe, units: units)
                if !facts.isEmpty {
                    FactRow(facts: facts).font(.subheadline)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    /// "300 g Mehl · 180 g Zucker · + 500 g Boden": what the step uses and takes, amounts a shade stronger.
    private var usedLine: Text? {
        var parts: [Text] = []
        for key in step.uses ?? [] {
            guard let ingredient = recipe.ingredients.first(where: { $0.key == key }) else { continue }
            if let amount = ingredient.amount {
                parts.append(Text("\(Text(nbsp(Format.amount(amount, system: units))).fontWeight(.semibold))\u{00A0}\(nbsp(ingredient.item))"))
            } else {
                parts.append(Text(nbsp(ingredient.item)))
            }
        }
        for part in takenParts(step, in: recipe, units: units) {
            if let amount = part.amount {
                parts.append(Text("\(Text(nbsp(amount)).fontWeight(.semibold))\u{00A0}\(nbsp(part.name))"))
            } else {
                parts.append(Text(nbsp(part.name)))
            }
        }
        guard var line = parts.first else { return nil }
        for part in parts.dropFirst() { line = Text("\(line)\u{00A0}\u{00A0}·  \(part)") }
        return line
    }
}

/// Lines break between ingredients, never inside "1 Pck. Vanillezucker".
private func nbsp(_ s: String) -> String { s.replacingOccurrences(of: " ", with: "\u{00A0}") }

/// The header's two controls: a hairline capsule, not a filled box.
private struct HairlineCapsule: ViewModifier {
    func body(content: Content) -> some View {
        content
            .frame(minHeight: 40)
            .overlay(Capsule().strokeBorder(Color(.separator), lineWidth: 1))
            .contentShape(.capsule)
            .padding(.vertical, 2)
    }
}

private struct StepperButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .fontWeight(.semibold)
            .foregroundStyle(isEnabled ? AnyShapeStyle(.tint) : AnyShapeStyle(.quaternary))
            .frame(width: 44, height: 40)
            .contentShape(.rect)
            .opacity(configuration.isPressed ? 0.4 : 1)
    }
}

private struct QuietIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            configuration.icon.imageScale(.small).foregroundStyle(.tertiary)
            configuration.title
        }
    }
}

private struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            configuration.title
            configuration.icon.imageScale(.small)
        }
    }
}

// MARK: Einkaufen

/// itemTotals: "380 g Zucker" with the parts per section quiet after it; checkable like Zutaten (cooking 3).
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
                    .padding(.top, 8)
                    .padding(.bottom, 32)
                    .frame(maxWidth: 620)
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
                let value = Format.amount(amount, system: units)
                let name = recipe.sections.first { $0.key == part.sectionKey }?.name
                return name.map { "\(value) \($0)" } ?? value
            }
            let text = total.bySection.count > 1 && !parts.isEmpty
                ? Text("\(Text(total.item))\(Text(" (\(parts.joined(separator: ", ")))").foregroundStyle(.secondary))")
                : Text(total.item)
            return IngredientRowData(id: total.item, amount: amounts.isEmpty ? nil : amounts, text: text)
        }
    }
}
