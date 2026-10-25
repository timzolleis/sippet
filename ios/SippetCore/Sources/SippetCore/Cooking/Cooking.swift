import Foundation

public enum MeasurementSystem: String, Sendable, Hashable, CaseIterable {
    case asWritten, metric, us
}

/// The device language; anything else is `.en`.
public enum Language: String, Sendable, Hashable {
    case de, en

    public init(code: String?) {
        self = code?.lowercased().hasPrefix("de") == true ? .de : .en
    }
}

public struct ShownTemperature: Sendable, Hashable {
    public enum Scale: String, Sendable, Hashable { case celsius, fahrenheit }
    public var degrees: Double
    public var maxDegrees: Double?
    public var scale: Scale

    public init(degrees: Double, maxDegrees: Double? = nil, scale: Scale) {
        self.degrees = degrees
        self.maxDegrees = maxDegrees
        self.scale = scale
    }
}

public struct ItemTotal: Sendable, Hashable {
    public struct SectionAmount: Sendable, Hashable {
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

// Ports of src/domain/cooking and recipeMatchesFilter. Bodies: milestone 2.

/// scaleRecipeContent
public func scaleRecipe(_ recipe: DeviceRecipe, toYield: Double) -> DeviceRecipe { fatalError("milestone 2") }

public func measurableAmount(_ amount: Amount) -> Amount { fatalError("milestone 2") }

public func amountInMeasurementSystem(_ amount: Amount, system: MeasurementSystem) -> Amount { fatalError("milestone 2") }

public func temperatureInMeasurementSystem(_ t: Temperature, system: MeasurementSystem) -> ShownTemperature { fatalError("milestone 2") }

public func unitLabel(_ unit: Unit, language: Language) -> String { fatalError("milestone 2") }

public func heatingModeLabel(_ mode: HeatingMode, language: Language) -> String { fatalError("milestone 2") }

/// itemTotalsFromContent
public func itemTotals(_ recipe: DeviceRecipe) -> [ItemTotal] { fatalError("milestone 2") }

/// stepSentenceFromStep; takes from `step.flow`.
public func stepSentence(_ step: Step, in recipe: DeviceRecipe) -> String { fatalError("milestone 2") }

public func recipeMatchesFilter(_ recipe: DeviceRecipe, tags: [String], filter: RecipeFilter) -> Bool { fatalError("milestone 2") }

/// Swift only: "⅛ TL (1 g)", "60–65 Min.", "2 packets" (ios.md Amount text).
public func amountText(_ amount: Amount, language: Language) -> String { fatalError("milestone 2") }
