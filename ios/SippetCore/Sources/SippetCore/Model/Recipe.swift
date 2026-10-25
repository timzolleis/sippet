import Foundation

public struct Yield: Codable, Sendable, Hashable {
    public var amount: Amount
    public var vessel: String?

    public init(amount: Amount, vessel: String? = nil) {
        self.amount = amount
        self.vessel = vessel
    }
}

public struct Section: Codable, Sendable, Hashable {
    public var key: String
    public var name: String

    public init(key: String, name: String) {
        self.key = key
        self.name = name
    }
}

public struct Equipment: Codable, Sendable, Hashable {
    public var key: String
    public var name: String

    public init(key: String, name: String) {
        self.key = key
        self.name = name
    }
}

public struct Ingredient: Codable, Sendable, Hashable {
    public var key: String
    public var item: String
    public var amount: Amount?
    public var section: String?
    public var note: String?
    public var prep: String?
    public var optional: Bool?

    public init(key: String, item: String, amount: Amount? = nil, section: String? = nil, note: String? = nil, prep: String? = nil, optional: Bool? = nil) {
        self.key = key
        self.item = item
        self.amount = amount
        self.section = section
        self.note = note
        self.prep = prep
        self.optional = optional
    }
}

public enum DurationKind: String, Codable, Sendable, Hashable {
    case active, passive
}

public struct Duration: Codable, Sendable, Hashable {
    public var minutes: Double
    public var maxMinutes: Double?
    public var kind: DurationKind

    public init(minutes: Double, maxMinutes: Double? = nil, kind: DurationKind) {
        self.minutes = minutes
        self.maxMinutes = maxMinutes
        self.kind = kind
    }
}

public enum HeatingMode: String, Codable, CaseIterable, Sendable, Hashable {
    case topBottom = "top_bottom"
    case fan, top, bottom, grill
}

public struct Temperature: Codable, Sendable, Hashable {
    public var celsius: Double
    public var maxCelsius: Double?
    public var mode: HeatingMode?

    public init(celsius: Double, maxCelsius: Double? = nil, mode: HeatingMode? = nil) {
        self.celsius = celsius
        self.maxCelsius = maxCelsius
        self.mode = mode
    }
}

/// A named part of a split result.
public struct Portion: Codable, Sendable, Hashable {
    public var key: String
    public var name: String
    public var amount: Amount?
    public var rest: Bool?

    public init(key: String, name: String, amount: Amount? = nil, rest: Bool? = nil) {
        self.key = key
        self.name = name
        self.amount = amount
        self.rest = rest
    }
}

public struct StepResult: Codable, Sendable, Hashable {
    public var name: String?
    public var amount: Amount?
    public var split: [Portion]?

    public init(name: String? = nil, amount: Amount? = nil, split: [Portion]? = nil) {
        self.name = name
        self.amount = amount
        self.split = split
    }
}

/// The derived links of a step (device-api.md `steps[].flow`).
public struct StepFlow: Codable, Sendable, Hashable {
    public var takes: [String]
    public var waitsFor: [String]
    public var makes: Bool

    public init(takes: [String], waitsFor: [String], makes: Bool) {
        self.takes = takes
        self.waitsFor = waitsFor
        self.makes = makes
    }
}

public struct Step: Codable, Sendable, Hashable {
    public var key: String
    public var label: String
    public var sentence: String?
    public var section: String?
    public var equipment: [String]?
    public var duration: Duration?
    public var temperature: Temperature?
    public var uses: [String]?
    public var result: StepResult?
    public var takes: [String]?
    public var waitsFor: [String]?
    public var flow: StepFlow?

    public init(
        key: String, label: String, sentence: String? = nil, section: String? = nil, equipment: [String]? = nil,
        duration: Duration? = nil, temperature: Temperature? = nil, uses: [String]? = nil, result: StepResult? = nil,
        takes: [String]? = nil, waitsFor: [String]? = nil, flow: StepFlow? = nil
    ) {
        self.key = key
        self.label = label
        self.sentence = sentence
        self.section = section
        self.equipment = equipment
        self.duration = duration
        self.temperature = temperature
        self.uses = uses
        self.result = result
        self.takes = takes
        self.waitsFor = waitsFor
        self.flow = flow
    }
}

/// device-api.md Views `DeviceRecipe`: the latest revision, as written, with its flow.
public struct DeviceRecipe: Codable, Identifiable, Sendable, Hashable {
    public var id: String
    public var revision: Int
    public var title: String
    public var `yield`: Yield
    public var source: URL?
    public var trashedAt: Date?
    public var purgeAt: Date?
    public var totalMinutes: Double?
    public var sections: [Section]
    public var equipment: [Equipment]
    public var ingredients: [Ingredient]
    public var steps: [Step]
    public var hasFlow: Bool
    public var makes: [String]

    public init(
        id: String, revision: Int, title: String, yield: Yield, source: URL? = nil, trashedAt: Date? = nil,
        purgeAt: Date? = nil, totalMinutes: Double? = nil, sections: [Section] = [], equipment: [Equipment] = [],
        ingredients: [Ingredient] = [], steps: [Step] = [], hasFlow: Bool = false, makes: [String] = []
    ) {
        self.id = id
        self.revision = revision
        self.title = title
        self.yield = yield
        self.source = source
        self.trashedAt = trashedAt
        self.purgeAt = purgeAt
        self.totalMinutes = totalMinutes
        self.sections = sections
        self.equipment = equipment
        self.ingredients = ingredients
        self.steps = steps
        self.hasFlow = hasFlow
        self.makes = makes
    }
}
