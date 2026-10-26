import SippetCore
import SwiftUI

/// Steps: Zutaten and numbered Zubereitung. Table: the Ablauf (cooking 1), which holds both.
enum RecipeMode: Hashable { case steps, table }

/// A cookbook page: title, quiet facts, then the recipe as steps or as a table, in one scroll.
/// Wide (iPad, landscape) steps: Zutaten left, Zubereitung right, each scrolling on its own. The table always takes
/// the full width under the header.
struct RecipeScreen: View {
    let recipe: DeviceRecipe
    @AppStorage(MeasurementSystem.defaultsKey) private var defaultUnits = MeasurementSystem.asWritten
    @State private var yield: Double
    @State private var unitsOverride: MeasurementSystem?
    @State private var mode: RecipeMode
    @State private var checked: Set<String> = []
    @State private var shopped: Set<String> = []
    @State private var selectedStep: String?
    @State private var cookAt: CookStart?
    @State private var showShopping = false
    @State private var titleInBar = false
    @State private var cardHeight: CGFloat = 0
    @Namespace private var transitions

    init(recipe: DeviceRecipe, mode: RecipeMode = .steps, yield: Double? = nil) {
        self.recipe = recipe
        _yield = State(initialValue: yield ?? recipe.yield.amount.value)
        _mode = State(initialValue: mode)
    }

    /// Cook mode opens at a step and zooms out of the button that opened it.
    struct CookStart: Identifiable {
        let step: Int
        let source: String
        var id: String { "\(source)-\(step)" }
    }

    private var units: MeasurementSystem { unitsOverride ?? defaultUnits }
    private var scaled: DeviceRecipe { scaleRecipe(recipe, toYield: yield) }

    var body: some View {
        let scaled = scaled
        let table = recipeTable(scaled)
        let shownTable = mode == .table ? table : nil
        GeometryReader { geo in
            if geo.size.width >= 560, shownTable == nil {
                wide(scaled, size: geo.size, hasTable: table != nil)
            } else {
                narrow(scaled, table: shownTable, hasTable: table != nil, geo: geo)
            }
        }
        .fontDesign(.rounded)
        // The bar shows the title once the page's own title has scrolled under it.
        .navigationTitle(titleInBar ? recipe.title : "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Shopping", systemImage: "basket") { showShopping = true }
            }
            .matchedTransitionSource(id: "shopping", in: transitions)
            ToolbarSpacer(.fixed, placement: .primaryAction)
            ToolbarItem(placement: .primaryAction) {
                Button("Cook") { cookAt = CookStart(step: 0, source: "cook") }
                    .fontWeight(.semibold)
                    .buttonStyle(.glassProminent)
                    .disabled(recipe.steps.isEmpty)
            }
            .matchedTransitionSource(id: "cook", in: transitions)
        }
        .fullScreenCover(item: $cookAt) { start in
            CookModeScreen(recipe: scaled, units: units, checked: $checked, startAt: start.step)
                .navigationTransition(.zoom(sourceID: start.source, in: transitions))
        }
        .sheet(isPresented: $showShopping) {
            ShoppingSheet(recipe: scaled, units: units, checked: $shopped)
                .navigationTransition(.zoom(sourceID: "shopping", in: transitions))
        }
        .onChange(of: mode) { if mode == .steps { selectedStep = nil } }
        #if DEBUG
        .task {
            let defaults = UserDefaults.standard
            if ProcessInfo.processInfo.arguments.contains("-SippetShopping") { showShopping = true }
            if let ticks = defaults.string(forKey: "SippetTick") { checked = Set(ticks.split(separator: ",").map(String.init)) }
            if let step = defaults.string(forKey: "SippetSelectStep") {
                try? await Task.sleep(for: .seconds(0.5))
                selectedStep = step
            }
        }
        #endif
    }

    // MARK: layouts

    /// The art's height: the header's aspect, at most 40 % of the screen (landscape).
    private func heroHeight(width: CGFloat, screen: CGSize) -> CGFloat {
        min(width / ArtGeometry.heroAspect, screen.height * 0.4)
    }

    /// One scroll: art, header, then Zutaten and Zubereitung, or the table across the full width.
    private func narrow(_ scaled: DeviceRecipe, table: RecipeTable?, hasTable: Bool, geo: GeometryProxy) -> some View {
        let size = geo.size
        let hero = heroHeight(width: size.width, screen: size)
        // The scroll view runs under the bar, so its coordinates start at the screen's top.
        let barBottom = geo.safeAreaInsets.top
        let selected = table == nil ? nil : selectedStep.flatMap { key in scaled.steps.firstIndex { $0.key == key } }
        return ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    HeroArt(id: recipe.id, height: hero)
                    VStack(alignment: .leading, spacing: 0) {
                        VStack(alignment: .leading, spacing: 40) {
                            header(wide: false, hasTable: hasTable)
                            if table == nil {
                                ingredients(scaled)
                                steps(scaled).id("steps")
                            }
                        }
                        .padding(.horizontal, 24)
                        .padding(.top, 28)
                        .padding(.bottom, table == nil ? 56 : 28)
                        .frame(maxWidth: 620, alignment: .leading)
                        if let table {
                            RecipeTableScreen(
                                recipe: scaled, table: table, units: units, checked: $checked, selected: $selectedStep,
                                visibleTop: barBottom, visibleBottom: barBottom + size.height - (selected == nil ? 0 : cardHeight))
                                // Past AX1 a 2D table breaks words inside its cells; Steps reads at every size.
                                .dynamicTypeSize(...DynamicTypeSize.accessibility1)
                                .id("steps")
                                .padding(.bottom, 56)
                                .transition(.opacity)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.systemBackground), in: .rect(topLeadingRadius: Self.sheetRadius, topTrailingRadius: Self.sheetRadius))
                    .padding(.top, -Self.sheetRadius)
                }
            }
            .ignoresSafeArea(.container, edges: .top)
            .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y + $0.contentInsets.top > hero + 40 } action: { titleInBar = $1 }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if let index = selected {
                    StepCard(
                        step: scaled.steps[index], number: index + 1, count: scaled.steps.count, recipe: scaled, units: units,
                        maxHeight: size.height * 0.45, namespace: transitions,
                        move: { delta in
                            let next = min(max(index + delta, 0), scaled.steps.count - 1)
                            withAnimation(.easeOut(duration: 0.2)) { selectedStep = scaled.steps[next].key }
                        },
                        close: { withAnimation(.easeOut(duration: 0.2)) { selectedStep = nil } },
                        cook: { cookAt = CookStart(step: index, source: "cook-step") })
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { cardHeight = $0 }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            // Landscape and iPad come here from two columns: bring the table up under the bar.
            // Turning the phone with the table open does the same.
            .onAppear {
                if table != nil, size.width >= 560 { proxy.scrollTo("mode", anchor: .top) }
            }
            .onChange(of: size.width >= 560) { _, wide in
                if table != nil, wide { withAnimation(.smooth) { proxy.scrollTo("mode", anchor: .top) } }
            }
            #if DEBUG
            .defaultScrollAnchor(DebugScroll.anchor)
            .task {
                if ProcessInfo.processInfo.arguments.contains("-SippetScrollSteps") {
                    try? await Task.sleep(for: .seconds(1))
                    proxy.scrollTo("steps", anchor: .top)
                }
            }
            #endif
        }
    }

    private func wide(_ scaled: DeviceRecipe, size: CGSize, hasTable: Bool) -> some View {
        let column = min(max(size.width * 0.42, 250), 440)
        let hero = heroHeight(width: column, screen: size)
        return HStack(alignment: .top, spacing: 0) {
            ScrollView {
                VStack(spacing: 0) {
                    HeroArt(id: recipe.id, height: hero)
                    VStack(alignment: .leading, spacing: 36) {
                        header(wide: true, hasTable: hasTable)
                        ingredients(scaled)
                    }
                    .padding(.horizontal, 32)
                    .padding(.top, 28)
                    .padding(.bottom, 48)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.systemBackground), in: .rect(topLeadingRadius: Self.sheetRadius, topTrailingRadius: Self.sheetRadius))
                    .padding(.top, -Self.sheetRadius)
                }
            }
            .ignoresSafeArea(.container, edges: .top)
            .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y + $0.contentInsets.top > hero + 40 } action: { titleInBar = $1 }
            .frame(width: column)
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

    private static let sheetRadius: CGFloat = 28

    /// In the narrow left column the title steps down a size, so long German words don't break.
    private func header(wide: Bool, hasTable: Bool) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(recipe.title)
                .font(.rounded(wide ? .title : .largeTitle, weight: .bold))
                .lineSpacing(-2)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            meta
            Flow(spacing: 10, lineSpacing: 10) {
                yieldStepper
                unitsMenu
            }
            .padding(.top, 2)
            if hasTable {
                Picker("View", selection: $mode.animation(.smooth)) {
                    Text("Steps").tag(RecipeMode.steps)
                    Text("Table").tag(RecipeMode.table)
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 360)
                .padding(.top, 6)
                .id("mode")
            }
        }
    }

    /// Total time, the vessel, the source: each a symbol on a disc and its value.
    @ViewBuilder private var meta: some View {
        let minutes = recipe.totalMinutes.map(Format.minutes)
        let vessel = recipe.yield.vessel.map { key in recipe.equipment.first { $0.key == key }?.name ?? key }
        if minutes != nil || vessel != nil || recipe.source != nil {
            Flow(spacing: 18, lineSpacing: 10) {
                if let minutes {
                    Label(minutes, systemImage: "clock")
                }
                if let vessel {
                    Label(vessel, systemImage: "circle.circle")
                }
                if let source = recipe.source {
                    Link(destination: source) {
                        Label(source.host()?.replacingOccurrences(of: "www.", with: "") ?? String(localized: "Source"),
                              systemImage: "safari")
                    }
                }
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(.secondary)
            .labelStyle(BadgeLabelStyle())
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
        .font(.subheadline.weight(.semibold))
        .labelStyle(.iconOnly)
        .buttonStyle(StepperButtonStyle())
        .modifier(SoftCapsule())
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
            HStack(spacing: 7) {
                Image(systemName: "scalemass").foregroundStyle(.tint)
                Text(units.title)
                Image(systemName: "chevron.up.chevron.down").imageScale(.small).foregroundStyle(.secondary)
            }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 16)
            .modifier(SoftCapsule())
        }
        .tint(.primary)
    }

    /// "12 Stück"; the vessel sits in the line above, so the stepper stays one short line.
    private var yieldText: String {
        amountText(Amount(value: yield, unit: recipe.yield.amount.unit), language: Format.language)
    }

    // MARK: Zutaten

    private func ingredients(_ scaled: DeviceRecipe) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionHeading(title: "Ingredients", systemName: "carrot.fill")
            IngredientList(groups: ingredientGroups(scaled, units: units), checked: $checked)
        }
    }

    // MARK: Zubereitung

    private func steps(_ scaled: DeviceRecipe) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeading(title: "Preparation", systemName: "frying.pan.fill")
                .padding(.bottom, 22)
            ForEach(Array(scaled.steps.enumerated()), id: \.element.key) { index, step in
                StepRow(number: index + 1, isLast: index == scaled.steps.count - 1, step: step, recipe: scaled, units: units)
            }
        }
    }
}

/// The recipe's art, full bleed under the toolbar; pulled down, it stretches instead of showing a gap.
private struct HeroArt: View {
    let id: String
    let height: CGFloat

    var body: some View {
        GeometryReader { geo in
            let pull = max(0, geo.frame(in: .scrollView).minY)
            RecipeArtView(id: id)
                .frame(width: geo.size.width, height: height + pull)
                .offset(y: -pull)
        }
        .frame(height: height)
    }
}

/// The step selected in the table, over the page's bottom: its sentence (recipe rule 8), what it uses, its facts;
/// the steps before and after; cook mode from here.
private struct StepCard: View {
    let step: Step
    let number: Int
    let count: Int
    let recipe: DeviceRecipe
    let units: MeasurementSystem
    let maxHeight: CGFloat
    let namespace: Namespace.ID
    let move: (Int) -> Void
    let close: () -> Void
    let cook: () -> Void
    @State private var rowHeight: CGFloat = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 8) {
                // As tall as the step, at most `maxHeight`; a longer one scrolls (accessibility sizes).
                ScrollView {
                    row.onGeometryChange(for: CGFloat.self) { $0.size.height } action: { rowHeight = $0 }
                }
                .scrollBounceBehavior(.basedOnSize)
                .frame(height: rowHeight > 0 ? min(rowHeight, maxHeight) : nil)
                Button("Close", systemImage: "xmark", action: close)
                    .labelStyle(.iconOnly)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 44, height: 44)
                    .contentShape(.rect)
                    .padding(.top, -10)
                    .padding(.trailing, -10)
            }
            HStack(spacing: 10) {
                Group {
                    Button("Previous step", systemImage: "chevron.left") { move(-1) }
                        .disabled(number == 1)
                    Button("Next step", systemImage: "chevron.right") { move(1) }
                        .disabled(number == count)
                }
                .labelStyle(.iconOnly)
                .font(.body.weight(.semibold))
                .frame(minWidth: 28, minHeight: 32)
                .buttonStyle(.glass)
                Spacer(minLength: 0)
                Button(action: cook) {
                    Label("Cook from here", systemImage: "play.fill")
                        .font(.body.weight(.semibold))
                        .frame(minHeight: 32)
                }
                .buttonStyle(.glassProminent)
                .matchedTransitionSource(id: "cook-step", in: namespace)
            }
        }
        .padding(20)
        .frame(maxWidth: 560)
        .glassEffect(.regular, in: .rect(cornerRadius: 30))
        .padding(.horizontal, 12)
        .padding(.bottom, 4)
        .frame(maxWidth: .infinity)
        .id(step.key)
    }

    private var row: some View {
        StepRow(number: number, isLast: true, step: step, recipe: recipe, units: units)
    }
}

/// "(1)  Springform einfetten, optional mit Backpapier auslegen." with what it uses and its facts underneath.
/// The numbers sit on a thin line that runs down to the next step.
private struct StepRow: View {
    let number: Int
    let isLast: Bool
    let step: Step
    let recipe: DeviceRecipe
    let units: MeasurementSystem
    @ScaledMetric(relativeTo: .body) private var badge: CGFloat = 28
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let stacked = typeSize.isAccessibilitySize
        let layout = stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 14))
        layout {
            Text(number, format: .number)
                .font(.subheadline.weight(.bold))
                .monospacedDigit()
                .foregroundStyle(Color(.systemBackground)) // like the Cook button's label: dark on the lighter accent in dark mode
                .frame(width: badge, height: badge)
                .background(.tint, in: .circle)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 12) {
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
            .padding(.bottom, isLast ? 0 : 30)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(alignment: .topLeading) {
            // The badge is the row's top edge; the line runs from under it to the next badge.
            if !stacked, !isLast {
                Capsule()
                    .fill(.tint.opacity(0.3))
                    .frame(width: 2)
                    .frame(maxHeight: .infinity)
                    .padding(.top, badge + 6)
                    .padding(.bottom, 6)
                    .padding(.leading, badge / 2 - 1)
            }
        }
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

/// The header's two controls: a soft filled capsule.
private struct SoftCapsule: ViewModifier {
    func body(content: Content) -> some View {
        content
            .frame(minHeight: 44)
            .background(.fill.tertiary, in: .capsule)
            .contentShape(.capsule)
    }
}

private struct StepperButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .fontWeight(.semibold)
            .foregroundStyle(isEnabled ? AnyShapeStyle(.tint) : AnyShapeStyle(.quaternary))
            .frame(minWidth: 44, minHeight: 44)
            .padding(.horizontal, 4)
            .contentShape(.rect)
            .opacity(configuration.isPressed ? 0.4 : 1)
    }
}

/// The header's facts: the symbol on a small accent disc, then the value.
private struct BadgeLabelStyle: LabelStyle {
    @ScaledMetric(relativeTo: .subheadline) private var size: CGFloat = 26

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 8) {
            configuration.icon
                .font(.system(size: size * 0.48, weight: .semibold))
                .foregroundStyle(.tint)
                .frame(width: size, height: size)
                .background(.tint.opacity(0.13), in: .circle)
            configuration.title
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
