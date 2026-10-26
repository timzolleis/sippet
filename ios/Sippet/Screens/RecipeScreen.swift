import SippetCore
import SwiftUI

/// A cookbook page: title, quiet facts, Zutaten and Zubereitung in one scroll, with the flow woven in: ingredients by the
/// step that takes them, steps on a rail that shows parallel parts and where they meet.
/// Turned to landscape (or an iPad in landscape), a recipe whose table fits readably shows the table instead, the whole
/// width at once (cooking 1); turning back returns to the page where it was. No switch: the orientation is the mode.
/// Wide without a table: Zutaten left, Zubereitung right, each scrolling on its own.
struct RecipeScreen: View {
    let recipe: DeviceRecipe
    @AppStorage(MeasurementSystem.defaultsKey) private var defaultUnits = MeasurementSystem.asWritten
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var yield: Double
    @State private var unitsOverride: MeasurementSystem?
    @State private var checked: Set<String> = []
    @State private var shopped: Set<String> = []
    @State private var cookAt: CookStart?
    @State private var showShopping = false
    @State private var titleInBar = false
    /// The table's tapped step, shown in a popover at its cell.
    @State private var tableStep: String?
    @State private var showsTable = false
    /// The page's place, kept while the table is shown.
    @State private var pagePosition = ScrollPosition()
    @State private var pageOffset: CGFloat = 0
    @Namespace private var transitions

    init(recipe: DeviceRecipe, yield: Double? = nil) {
        self.recipe = recipe
        _yield = State(initialValue: yield ?? recipe.yield.amount.value)
    }

    /// Cook mode opens at a step and zooms out of the button that opened it.
    struct CookStart: Identifiable {
        let step: Int
        let source: String
        var id: String { "\(source)-\(step)" }
    }

    private var units: MeasurementSystem { unitsOverride ?? defaultUnits }
    private var scaled: DeviceRecipe { scaleRecipe(recipe, toYield: yield) }

    /// The table's side margin.
    private static let tableMargin: CGFloat = 20

    var body: some View {
        let scaled = scaled
        GeometryReader { geo in
            let landscape = (geo.size.width > geo.size.height || DebugScroll.forceTable) && geo.size.width >= 560
            if landscape, let table = recipeTable(scaled),
               let fit = TableFit.make(recipe: scaled, table: table, units: units, width: geo.size.width - 2 * Self.tableMargin, typeSize: typeSize) {
                overview(scaled, table: table, fit: fit)
            } else if geo.size.width >= 560 {
                wide(scaled, size: geo.size)
            } else {
                narrow(scaled, geo: geo)
            }
        }
        .fontDesign(.rounded)
        // The bar shows the title once the page's own title has scrolled under it.
        .navigationTitle(titleInBar && !showsTable ? recipe.title : "")
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
        #if DEBUG
        .task {
            let defaults = UserDefaults.standard
            if ProcessInfo.processInfo.arguments.contains("-SippetShopping") { showShopping = true }
            if let ticks = defaults.string(forKey: "SippetTick") { checked = Set(ticks.split(separator: ",").map(String.init)) }
            if let step = defaults.string(forKey: "SippetSelectStep") {
                try? await Task.sleep(for: .seconds(1))
                tableStep = step
            }
        }
        #endif
    }

    // MARK: layouts

    /// The art's height: the header's aspect, at most 40 % of the screen (landscape).
    private func heroHeight(width: CGFloat, screen: CGSize) -> CGFloat {
        min(width / ArtGeometry.heroAspect, screen.height * 0.4)
    }

    /// One scroll: art, header, Zutaten, Zubereitung. Its place survives a turn to the table and back.
    private func narrow(_ scaled: DeviceRecipe, geo: GeometryProxy) -> some View {
        let size = geo.size
        let hero = heroHeight(width: size.width, screen: size)
        return ScrollView {
            VStack(spacing: 0) {
                HeroArt(id: recipe.id, height: hero)
                VStack(alignment: .leading, spacing: 40) {
                    header(wide: false)
                    ingredients(scaled)
                    steps(scaled).id("steps")
                }
                .padding(.horizontal, 24)
                .padding(.top, 28)
                .padding(.bottom, 56)
                .frame(maxWidth: 620, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.systemBackground), in: .rect(topLeadingRadius: Self.sheetRadius, topTrailingRadius: Self.sheetRadius))
                .padding(.top, -Self.sheetRadius)
            }
        }
        .scrollPosition($pagePosition)
        .ignoresSafeArea(.container, edges: .top)
        .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y + $0.contentInsets.top } action: { _, y in
            pageOffset = y
            titleInBar = y > hero + 40
        }
        .onAppear {
            if pageOffset > 0 { pagePosition.scrollTo(y: pageOffset) }
        }
        #if DEBUG
        .defaultScrollAnchor(DebugScroll.anchor)
        .task {
            if ProcessInfo.processInfo.arguments.contains("-SippetScrollSteps") {
                try? await Task.sleep(for: .seconds(1))
                pagePosition.scrollTo(id: "steps", anchor: .top)
            }
            if let y = UserDefaults.standard.string(forKey: "SippetScrollY").flatMap(Double.init) {
                try? await Task.sleep(for: .seconds(1))
                pagePosition.scrollTo(y: y)
            }
        }
        #endif
    }

    private func wide(_ scaled: DeviceRecipe, size: CGSize) -> some View {
        let column = min(max(size.width * 0.42, 250), 440)
        let hero = heroHeight(width: column, screen: size)
        return HStack(alignment: .top, spacing: 0) {
            ScrollView {
                VStack(spacing: 0) {
                    HeroArt(id: recipe.id, height: hero)
                    VStack(alignment: .leading, spacing: 36) {
                        header(wide: true)
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

    /// The table, as in the picture: "Veganer Russischer Zupfkuchen (Springform 26 cm, 12 Stück)", then the grid.
    private func overview(_ scaled: DeviceRecipe, table: RecipeTable, fit: TableFit) -> some View {
        let vessel = recipe.yield.vessel.map { key in recipe.equipment.first { $0.key == key }?.name ?? key }
        let facts = ([vessel] + [yieldText]).compactMap { $0 }.joined(separator: ", ")
        return ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("\(Text(recipe.title).fontWeight(.bold)) \(Text("(\(facts))").foregroundStyle(.secondary))")
                    .font(.rounded(.title3, weight: .regular))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                RecipeTableScreen(recipe: scaled, table: table, fit: fit, units: units, selected: $tableStep) { key in
                    AnyView(Group {
                        if let index = scaled.steps.firstIndex(where: { $0.key == key }) {
                            TableStepCard(recipe: scaled, index: index, units: units) { cook(from: index) }
                        }
                    })
                }
            }
            .padding(.horizontal, Self.tableMargin)
            .padding(.top, 4)
            .padding(.bottom, 32)
        }
        .onAppear { showsTable = true }
        .onDisappear {
            showsTable = false
            tableStep = nil
        }
    }

    /// "Cook from here" in the table's popover: the popover goes first, then cook mode comes up.
    private func cook(from index: Int) {
        tableStep = nil
        Task {
            try? await Task.sleep(for: .milliseconds(350))
            cookAt = CookStart(step: index, source: "cook")
        }
    }

    // MARK: header

    private static let sheetRadius: CGFloat = 28

    /// In the narrow left column the title steps down a size, so long German words don't break.
    private func header(wide: Bool) -> some View {
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
            if scaled.hasFlow {
                FlowIngredientList(recipe: scaled, units: units, checked: $checked)
            } else {
                IngredientList(groups: ingredientGroups(scaled, units: units), checked: $checked)
            }
        }
    }

    // MARK: Zubereitung

    private func steps(_ scaled: DeviceRecipe) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeading(title: "Preparation", systemName: "frying.pan.fill")
                .padding(.bottom, 22)
            FlowSteps(recipe: scaled, units: units) { index in cookAt = CookStart(step: index, source: "cook") }
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
            // Scaled, not re-laid out: the art is an image rendered once for this size.
            RecipeArtView(id: id)
                .frame(width: geo.size.width, height: height)
                .scaleEffect(1 + pull / height, anchor: .bottom)
        }
        .frame(height: height)
    }
}

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
