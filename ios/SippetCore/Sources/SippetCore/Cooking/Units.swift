import Foundation

// src/domain/recipe/unit.ts

extension UnitCode {
    var isMass: Bool { [.g, .kg, .oz, .lb].contains(self) }
    var isVolume: Bool { [.ml, .cl, .l, .tsp, .tbsp, .cup, .flOz].contains(self) }

    var gramsPerUnit: Double {
        switch self {
        case .g: 1
        case .kg: 1000
        case .oz: 28.349523125
        case .lb: 453.59237
        default: 0
        }
    }

    var millilitresPerUnit: Double {
        switch self {
        case .ml: 1
        case .cl: 10
        case .l: 1000
        case .tsp: 5
        case .tbsp: 15
        case .cup: 240
        case .flOz: 30
        default: 0
        }
    }
}

extension Optional where Wrapped == AmountUnit {
    var massCode: UnitCode? {
        if case .code(let code)? = self, code.isMass { return code }
        return nil
    }

    var volumeCode: UnitCode? {
        if case .code(let code)? = self, code.isVolume { return code }
        return nil
    }
}

/// A value in another unit of the same kind: mass within mass, volume within volume, otherwise only the same unit.
func valueInUnit(_ value: Double, from: AmountUnit?, to: AmountUnit?) -> Double? {
    if from == to { return value }
    if let a = from.massCode, let b = to.massCode { return value * a.gramsPerUnit / b.gramsPerUnit }
    if let a = from.volumeCode, let b = to.volumeCode { return value * a.millilitresPerUnit / b.millilitresPerUnit }
    return nil
}

/// JavaScript's Math.round: halves round up.
func jsRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }
