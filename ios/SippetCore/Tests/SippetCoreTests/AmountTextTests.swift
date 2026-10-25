import Testing
@testable import SippetCore

@Test func amountTextTable() {
    let salt = Amount(value: 0.125, unit: .code(.tsp), second: SecondAmount(value: 1, unit: .code(.g)))
    #expect(amountText(salt, language: .de) == "⅛ TL (1 g)")
    #expect(amountText(salt, language: .en) == "⅛ tsp (1 g)")
    #expect(amountText(Amount(value: 1.5, unit: .code(.kg)), language: .de) == "1,5 kg")
    #expect(amountText(Amount(value: 1.5, unit: .code(.kg)), language: .en) == "1.5 kg")
    #expect(durationText(StepDuration(minutes: 60, maxMinutes: 65, kind: .passive), language: .de) == "60–65 Min.")
    #expect(durationText(StepDuration(minutes: 60, maxMinutes: 65, kind: .passive), language: .en) == "60–65 min")
    #expect(amountText(Amount(value: 2, unit: .code(.packet)), language: .en) == "2 packets")
    #expect(amountText(Amount(value: 2, unit: .code(.packet)), language: .de) == "2 Pck.")
    #expect(amountText(Amount(value: 6.25, unit: .code(.oz)), language: .de) == "6¼ oz")
    #expect(amountText(Amount(value: 2), language: .de) == "2")
}

@Test func amountTextEdges() {
    #expect(amountText(Amount(value: 1, unit: .code(.packet)), language: .en) == "1 packet")
    #expect(amountText(Amount(value: 0.5, unit: .code(.packet)), language: .en) == "½ packet")
    #expect(amountText(Amount(value: 1.5, unit: .code(.cup)), language: .en) == "1½ cups")
    #expect(amountText(Amount(value: 1, max: 2, unit: .code(.clove)), language: .en) == "1–2 cloves")
    #expect(amountText(Amount(value: 1, max: 2, unit: .code(.clove)), language: .de) == "1–2 Zehe")
    #expect(amountText(Amount(value: 1, unit: .custom("Messerspitze")), language: .de) == "1 Messerspitze")
    #expect(amountText(Amount(value: 0.333, unit: .code(.g)), language: .de) == "0,33 g")
    #expect(amountText(Amount(value: 380, unit: .code(.g)), language: .de) == "380 g")
    #expect(amountText(Amount(value: 2.5, unit: .code(.l)), language: .de) == "2,5 l")
    #expect(Language(code: "de-DE") == .de && Language(code: "fr") == .en && Language(code: nil) == .en)
}
