import Foundation

public enum MeasurementSystem: String, Sendable, Hashable, CaseIterable {
    case asWritten = "as_written"
    case metric, us
}

/// The device language; anything else is `.en`.
public enum Language: String, Sendable, Hashable {
    case de, en

    public init(code: String?) {
        self = code?.lowercased().hasPrefix("de") == true ? .de : .en
    }
}

public struct ShownTemperature: Codable, Sendable, Hashable {
    public enum Scale: String, Codable, Sendable, Hashable { case celsius, fahrenheit }
    public var degrees: Double
    public var maxDegrees: Double?
    public var scale: Scale

    public init(degrees: Double, maxDegrees: Double? = nil, scale: Scale) {
        self.degrees = degrees
        self.maxDegrees = maxDegrees
        self.scale = scale
    }
}

public struct ItemTotal: Codable, Sendable, Hashable {
    public struct SectionAmount: Codable, Sendable, Hashable {
        public var sectionKey: String?
        public var amount: Amount?

        public init(sectionKey: String? = nil, amount: Amount? = nil) {
            self.sectionKey = sectionKey
            self.amount = amount
        }
    }

    public var item: String
    public var totals: [Amount]
    public var bySection: [SectionAmount]

    public init(item: String, totals: [Amount], bySection: [SectionAmount]) {
        self.item = item
        self.totals = totals
        self.bySection = bySection
    }
}

// Ports of src/domain/cooking and recipeMatchesFilter. Same arithmetic as the TypeScript; golden-tested.

// MARK: measurable-amount.ts

private func measuringStep(value: Double, unit: AmountUnit?) -> Double? {
    guard case .code(let code)? = unit else { return nil }
    switch code {
    case .g, .ml: return value < 20 ? 1 : 5
    case .tsp, .tbsp: return 1.0 / 8
    case .oz, .cup: return 1.0 / 4
    case .packet, .piece: return 1.0 / 2
    default: return nil
    }
}

/// A nonzero amount never rounds to 0, only up to the smallest step.
func measurableValue(_ value: Double, unit: AmountUnit?) -> Double {
    guard let step = measuringStep(value: value, unit: unit) else { return value }
    let rounded = jsRound(value / step) * step
    return rounded == 0 && value > 0 ? step : rounded
}

private func measurable(_ amount: SecondAmount) -> SecondAmount {
    SecondAmount(
        value: measurableValue(amount.value, unit: amount.unit),
        max: amount.max.map { measurableValue($0, unit: amount.unit) },
        unit: amount.unit)
}

public func measurableAmount(_ amount: Amount) -> Amount {
    let main = measurable(SecondAmount(value: amount.value, max: amount.max, unit: amount.unit))
    return Amount(value: main.value, max: main.max, unit: main.unit, second: amount.second.map(measurable))
}

// MARK: scale-recipe.ts

private func scaled(_ amount: SecondAmount, factor: Double) -> SecondAmount {
    SecondAmount(value: amount.value * factor, max: amount.max.map { $0 * factor }, unit: amount.unit)
}

private func scaled(_ amount: Amount, factor: Double) -> Amount {
    let main = scaled(SecondAmount(value: amount.value, max: amount.max, unit: amount.unit), factor: factor)
    return measurableAmount(Amount(value: main.value, max: main.max, unit: main.unit, second: amount.second.map { scaled($0, factor: factor) }))
}

/// scaleRecipeContent: amounts, results, and portions scale and are rounded to what a cook can measure; durations and temperatures don't.
public func scaleRecipe(_ recipe: DeviceRecipe, toYield: Double) -> DeviceRecipe {
    let factor = toYield / recipe.yield.amount.value
    var result = recipe
    // the yield's own second amount is not scaled (as in the TypeScript)
    let y = scaled(SecondAmount(value: recipe.yield.amount.value, max: recipe.yield.amount.max, unit: recipe.yield.amount.unit), factor: factor)
    result.yield.amount = Amount(value: toYield, max: y.max, unit: y.unit, second: recipe.yield.amount.second)
    result.ingredients = recipe.ingredients.map { ingredient in
        var ingredient = ingredient
        ingredient.amount = ingredient.amount.map { scaled($0, factor: factor) }
        return ingredient
    }
    result.steps = recipe.steps.map { step in
        guard var stepResult = step.result else { return step }
        var step = step
        stepResult.amount = stepResult.amount.map { scaled($0, factor: factor) }
        stepResult.split = stepResult.split.map { portions in
            portions.map { portion in
                var portion = portion
                portion.amount = portion.amount.map { scaled($0, factor: factor) }
                return portion
            }
        }
        step.result = stepResult
        return step
    }
    return result
}

// MARK: measurement-system.ts

private let usUnits: [AmountUnit] = [.code(.oz), .code(.lb), .code(.tsp), .code(.tbsp), .code(.cup), .code(.flOz)]
private let metricUnits: [AmountUnit] = [.code(.g), .code(.kg), .code(.ml), .code(.cl), .code(.l), .code(.tsp), .code(.tbsp)]

private func unit(in system: MeasurementSystem, value: Double, unit: AmountUnit?) -> AmountUnit? {
    guard system != .asWritten, let unit else { return unit }
    if system == .metric {
        if metricUnits.contains(unit) { return unit }
        if Optional(unit).massCode != nil { return .code(.g) }
        if Optional(unit).volumeCode != nil { return .code(.ml) }
        return unit
    }
    if usUnits.contains(unit) { return unit }
    if Optional(unit).massCode != nil { return .code(.oz) }
    if Optional(unit).volumeCode == nil { return unit }
    let millilitres = valueInUnit(value, from: unit, to: .code(.ml)) ?? 0
    return .code(millilitres < 15 ? .tsp : millilitres < 60 ? .tbsp : .cup)
}

private func converted(_ amount: SecondAmount, system: MeasurementSystem) -> SecondAmount {
    let target = unit(in: system, value: amount.value, unit: amount.unit)
    if target == amount.unit { return amount }
    func convert(_ value: Double) -> Double {
        measurableValue(valueInUnit(value, from: amount.unit, to: target) ?? value, unit: target)
    }
    return SecondAmount(value: convert(amount.value), max: amount.max.map(convert), unit: target)
}

/// Converted amounts are rounded to what a cook can measure; the author's own units stay.
public func amountInMeasurementSystem(_ amount: Amount, system: MeasurementSystem) -> Amount {
    let main = converted(SecondAmount(value: amount.value, max: amount.max, unit: amount.unit), system: system)
    return Amount(value: main.value, max: main.max, unit: main.unit, second: amount.second.map { converted($0, system: system) })
}

/// °F to the nearest 5, as ovens are set: 170 °C → 340 °F.
func fahrenheit(fromCelsius celsius: Double) -> Double { jsRound((celsius * 9 / 5 + 32) / 5) * 5 }

public func temperatureInMeasurementSystem(_ t: Temperature, system: MeasurementSystem) -> ShownTemperature {
    func degrees(_ celsius: Double) -> Double { system == .us ? fahrenheit(fromCelsius: celsius) : celsius }
    return ShownTemperature(degrees: degrees(t.celsius), maxDegrees: t.maxCelsius.map(degrees), scale: system == .us ? .fahrenheit : .celsius)
}

// MARK: unit-label.ts

private let unitLabels: [UnitCode: (de: String, en: String)] = [
    .g: ("g", "g"), .kg: ("kg", "kg"), .oz: ("oz", "oz"), .lb: ("lb", "lb"),
    .ml: ("ml", "ml"), .cl: ("cl", "cl"), .l: ("l", "l"), .tsp: ("TL", "tsp"), .tbsp: ("EL", "tbsp"),
    .cup: ("Tasse", "cup"), .flOz: ("fl oz", "fl oz"),
    .piece: ("Stück", "piece"), .serving: ("Portion", "serving"), .pinch: ("Prise", "pinch"), .packet: ("Pck.", "packet"),
    .can: ("Dose", "can"), .tub: ("Becher", "tub"), .bottle: ("Fl.", "bottle"), .bunch: ("Bund", "bunch"),
    .clove: ("Zehe", "clove"), .slice: ("Scheibe", "slice"), .sheet: ("Blatt", "sheet"), .sprig: ("Zweig", "sprig"),
    .drop: ("Tropfen", "drop"), .handful: ("Handvoll", "handful"),
]

/// Unit names are translated; the author's own units stay as written.
public func unitLabel(_ unit: AmountUnit, language: Language) -> String {
    switch unit {
    case .custom(let word): return word
    case .code(let code):
        let labels = unitLabels[code]
        return (language == .de ? labels?.de : labels?.en) ?? code.rawValue
    }
}

public func heatingModeLabel(_ mode: HeatingMode, language: Language) -> String {
    switch (mode, language) {
    case (.topBottom, .de): "Ober-/Unterhitze"
    case (.topBottom, .en): "conventional"
    case (.fan, .de): "Umluft"
    case (.fan, .en): "fan"
    case (.top, .de): "Oberhitze"
    case (.top, .en): "top heat"
    case (.bottom, .de): "Unterhitze"
    case (.bottom, .en): "bottom heat"
    case (.grill, .de): "Grill"
    case (.grill, .en): "grill"
    }
}

// MARK: item-total.ts

private func isSameKind(_ a: AmountUnit?, _ b: AmountUnit?) -> Bool {
    (a.massCode != nil && b.massCode != nil) || (a.volumeCode != nil && b.volumeCode != nil) || a == b
}

/// The larger unit of two of the same kind: 500 g + 1 kg = 1,5 kg.
private func largerUnit(_ a: AmountUnit?, _ b: AmountUnit?) -> AmountUnit? {
    if let x = a.massCode, let y = b.massCode { return y.gramsPerUnit > x.gramsPerUnit ? b : a }
    if let x = a.volumeCode, let y = b.volumeCode { return y.millilitresPerUnit > x.millilitresPerUnit ? b : a }
    return a
}

private func add(_ total: Amount, _ amount: Amount) -> Amount {
    let unit = largerUnit(total.unit, amount.unit)
    func inUnit(_ value: Double, _ from: AmountUnit?) -> Double { valueInUnit(value, from: from, to: unit) ?? value }
    let value = inUnit(total.value, total.unit) + inUnit(amount.value, amount.unit)
    let max: Double? = total.max == nil && amount.max == nil
        ? nil
        : inUnit(total.max ?? total.value, total.unit) + inUnit(amount.max ?? amount.value, amount.unit)
    return Amount(value: value, max: max, unit: unit)
}

/// itemTotalsFromContent: totals per item with the split by section, for shopping.
public func itemTotals(_ recipe: DeviceRecipe) -> [ItemTotal] {
    var order: [String] = []
    var keysByItem: [String: Set<String>] = [:]
    for ingredient in recipe.ingredients {
        if keysByItem[ingredient.item] == nil { order.append(ingredient.item) }
        keysByItem[ingredient.item, default: []].insert(ingredient.key)
    }
    return order.map { item in
        let ingredients = recipe.ingredients.filter { keysByItem[item]?.contains($0.key) == true }
        var sums: [Amount] = []
        for ingredient in ingredients {
            guard let amount = ingredient.amount else { continue }
            if let index = sums.firstIndex(where: { isSameKind($0.unit, amount.unit) }) {
                sums[index] = add(sums[index], amount)
            } else {
                sums.append(amount)
            }
        }
        return ItemTotal(
            item: item,
            totals: sums.map { Amount(value: $0.value, max: $0.max, unit: $0.unit) },
            bySection: ingredients.map { .init(sectionKey: $0.section, amount: $0.amount) })
    }
}

// MARK: step-sentence.ts

private func nameOfTaken(_ key: String, in recipe: DeviceRecipe) -> String {
    for step in recipe.steps {
        if step.key == key { return step.result?.name ?? step.label }
        if let portion = (step.result?.split ?? []).first(where: { $0.key == key }) { return portion.name }
    }
    return key
}

/// The step's sentence; without one, its label and what it uses and takes: "verkneten (vegane Butter, mischen)".
public func stepSentence(_ step: Step, in recipe: DeviceRecipe) -> String {
    if let sentence = step.sentence { return sentence }
    let used = recipe.ingredients.filter { (step.uses ?? []).contains($0.key) }.map(\.item)
    let taken = (step.flow?.takes ?? []).map { nameOfTaken($0, in: recipe) }
    var names: [String] = []
    for name in used + taken where !names.contains(name) { names.append(name) }
    return names.isEmpty ? step.label : "\(step.label) (\(names.joined(separator: ", ")))"
}

// MARK: recipe-filter.ts

/// Case and accents don't matter: "rühr" finds "verrühren", "zucker" finds "Puderzucker".
func searchable(_ text: String) -> String {
    String(String.UnicodeScalarView(text.decomposedStringWithCanonicalMapping.unicodeScalars.filter { !(0x0300...0x036F).contains($0.value) }))
        .lowercased()
}

func searchableText(of recipe: DeviceRecipe) -> String {
    searchable(
        ([recipe.title]
            + recipe.ingredients.flatMap { [$0.item, $0.note ?? "", $0.prep ?? ""] }
            + recipe.steps.flatMap { [$0.label, $0.sentence ?? ""] }).joined(separator: "\n"))
}

func totalMinutes(of recipe: DeviceRecipe) -> Double? {
    let durations = recipe.steps.compactMap(\.duration)
    return durations.isEmpty ? nil : durations.reduce(0) { $0 + ($1.maxMinutes ?? $1.minutes) }
}

func hasFlow(_ recipe: DeviceRecipe) -> Bool { recipe.steps.contains { !($0.uses ?? []).isEmpty } }

public func recipeMatchesFilter(_ recipe: DeviceRecipe, tags: [String], filter: RecipeFilter) -> Bool {
    func has(_ name: String) -> Bool { tags.contains { $0.lowercased() == name.lowercased() } }
    if !(filter.tags?.all ?? []).allSatisfy(has) { return false }
    if let any = filter.tags?.any, !any.contains(where: has) { return false }
    if (filter.tags?.none ?? []).contains(where: has) { return false }
    if !(filter.items ?? []).allSatisfy({ name in recipe.ingredients.contains { $0.item.lowercased() == name.lowercased() } }) { return false }
    if let limit = filter.maxTotalMinutes {
        guard let total = totalMinutes(of: recipe), total <= limit else { return false }
    }
    if let wanted = filter.hasFlow, hasFlow(recipe) != wanted { return false }
    if let text = filter.text, !searchableText(of: recipe).contains(searchable(text)) { return false }
    return true
}

// MARK: amount text (Swift only)

private let fractionUnits: Set<UnitCode> = [.tsp, .tbsp, .oz, .cup, .packet, .piece]
private let fractionGlyphs = ["", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞"]

private func number(_ value: Double, fractions: Bool, language: Language) -> String {
    if fractions {
        let eighths = value * 8
        if abs(eighths - eighths.rounded()) < 1e-6 {
            let total = Int(eighths.rounded())
            let whole = total / 8
            let glyph = fractionGlyphs[total % 8]
            if glyph.isEmpty { return String(whole) }
            return (whole == 0 ? "" : String(whole)) + glyph
        }
    }
    var text = String(format: "%.2f", value)
    if text.contains(".") {
        while text.hasSuffix("0") { text.removeLast() }
        if text.hasSuffix(".") { text.removeLast() }
    }
    return language == .de ? text.replacingOccurrences(of: ".", with: ",") : text
}

private let pluralCountUnits: Set<UnitCode> = [
    .cup, .piece, .serving, .pinch, .packet, .can, .tub, .bottle, .bunch, .clove, .slice, .sheet, .sprig, .drop, .handful,
]

private func plural(_ label: String) -> String {
    label.hasSuffix("ch") || label.hasSuffix("s") ? label + "es" : label + "s"
}

private func text(value: Double, max: Double?, unit: AmountUnit?, language: Language) -> String {
    var fractions = false
    if case .code(let code)? = unit { fractions = fractionUnits.contains(code) }
    var result = number(value, fractions: fractions, language: language)
    if let max { result += "–" + number(max, fractions: fractions, language: language) }
    guard let unit else { return result }
    var label = unitLabel(unit, language: language)
    if language == .en, case .code(let code) = unit, pluralCountUnits.contains(code), (max ?? value) > 1 { label = plural(label) }
    return result + " " + label
}

/// "⅛ TL (1 g)", "1,5 kg", "2 packets" (ios.md Amount text).
public func amountText(_ amount: Amount, language: Language) -> String {
    var result = text(value: amount.value, max: amount.max, unit: amount.unit, language: language)
    if let second = amount.second {
        result += " (" + text(value: second.value, max: second.max, unit: second.unit, language: language) + ")"
    }
    return result
}

/// "60–65 Min." / "60–65 min" (ios.md Amount text; a step's duration is not an Amount).
public func durationText(_ duration: StepDuration, language: Language) -> String {
    let unit = language == .de ? "Min." : "min"
    let range = duration.maxMinutes.map { "\(number(duration.minutes, fractions: false, language: language))–\(number($0, fractions: false, language: language))" }
        ?? number(duration.minutes, fractions: false, language: language)
    return range + " " + unit
}
