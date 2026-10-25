import SippetCore
import SwiftUI

/// Display helpers shared by the screens. No cooking logic: that lives in SippetCore.
enum Format {
    static var language: Language { AppConfig.language }

    static func minutes(_ value: Double) -> String {
        let total = Int(value.rounded())
        let hours = total / 60, rest = total % 60
        let de = language == .de
        switch (hours, rest) {
        case (0, _): return de ? "\(rest) Min." : "\(rest) min"
        case (_, 0): return de ? "\(hours) Std." : "\(hours) h"
        default: return de ? "\(hours) Std. \(rest) Min." : "\(hours) h \(rest) min"
        }
    }

    static func duration(_ d: StepDuration) -> String {
        let upper = d.maxMinutes.map { max($0, d.minutes) }
        guard let upper, upper != d.minutes else { return minutes(d.minutes) }
        let number = { (v: Double) in v.formatted(.number.precision(.fractionLength(0...1)).locale(Locale(identifier: language.rawValue))) }
        return "\(number(d.minutes))–\(number(upper)) " + (language == .de ? "Min." : "min")
    }

    static func temperature(_ t: Temperature, system: MeasurementSystem) -> String {
        let shown = temperatureInMeasurementSystem(t, system: system)
        let unit = shown.scale == .celsius ? "°C" : "°F"
        let number = { (v: Double) in v.formatted(.number.precision(.fractionLength(0)).locale(Locale(identifier: language.rawValue))) }
        var text = shown.maxDegrees.map { "\(number(shown.degrees))–\(number($0)) \(unit)" } ?? "\(number(shown.degrees)) \(unit)"
        if let mode = t.mode { text += " " + heatingModeLabel(mode, language: language) }
        return text
    }

    static func amount(_ amount: Amount, system: MeasurementSystem) -> String {
        amountText(amountInMeasurementSystem(amount, system: system), language: language)
    }

    static func ingredientLine(_ ingredient: Ingredient, system: MeasurementSystem) -> String {
        var parts: [String] = []
        if let a = ingredient.amount { parts.append(amount(a, system: system)) }
        parts.append(ingredient.item)
        var text = parts.joined(separator: " ")
        if let prep = ingredient.prep, !prep.isEmpty { text += ", " + prep }
        if let note = ingredient.note, !note.isEmpty { text += " (" + note + ")" }
        if ingredient.optional == true { text += " – " + String(localized: "optional") }
        return text
    }
}

extension MeasurementSystem {
    var title: LocalizedStringKey {
        switch self {
        case .asWritten: "As written"
        case .metric: "Metric"
        case .us: "US"
        }
    }
}
