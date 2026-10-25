import Foundation

/// mcp.md Unit codes, all 25.
public enum UnitCode: String, Codable, CaseIterable, Sendable, Hashable {
    // mass
    case g, kg, oz, lb
    // volume
    case ml, cl, l, tsp, tbsp, cup
    case flOz = "fl_oz"
    // count
    case piece, serving, pinch, packet, can, tub, bottle, bunch, clove, slice, sheet, sprig, drop, handful
}

/// On the wire: `"g"` or `{"custom": "Messerspitze"}`.
public enum AmountUnit: Codable, Sendable, Hashable {
    case code(UnitCode)
    case custom(String)

    private enum CodingKeys: String, CodingKey { case custom }

    public init(from decoder: any Decoder) throws {
        if let single = try? decoder.singleValueContainer(), let code = try? single.decode(UnitCode.self) {
            self = .code(code)
            return
        }
        let keyed = try decoder.container(keyedBy: CodingKeys.self)
        self = .custom(try keyed.decode(String.self, forKey: .custom))
    }

    public func encode(to encoder: any Encoder) throws {
        switch self {
        case .code(let code):
            var single = encoder.singleValueContainer()
            try single.encode(code)
        case .custom(let word):
            var keyed = encoder.container(keyedBy: CodingKeys.self)
            try keyed.encode(word, forKey: .custom)
        }
    }
}

/// A number ("300 g") or a range ("1–2 Zehen"); no unit is a count.
public struct SecondAmount: Codable, Sendable, Hashable {
    public var value: Double
    public var max: Double?
    public var unit: Unit?

    public init(value: Double, max: Double? = nil, unit: Unit? = nil) {
        self.value = value
        self.max = max
        self.unit = unit
    }
}

/// May carry a second amount: "¼ TL (2 g) Salz".
public struct Amount: Codable, Sendable, Hashable {
    public var value: Double
    public var max: Double?
    public var unit: Unit?
    public var second: SecondAmount?

    public init(value: Double, max: Double? = nil, unit: Unit? = nil, second: SecondAmount? = nil) {
        self.value = value
        self.max = max
        self.unit = unit
        self.second = second
    }
}
