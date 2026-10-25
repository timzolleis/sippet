import Foundation
import Testing
@testable import SippetCore

private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try SippetJSON.decoder().decode(type, from: Data(json.utf8))
}

private let recipeJSON = """
{
  "id": "rcp_zupf", "revision": 3, "title": "Zupfkuchen",
  "yield": {"amount": {"value": 12, "unit": "piece"}, "vessel": "form"},
  "source": "https://example.com/zupf",
  "trashedAt": "2025-10-25T08:00:00.000Z", "purgeAt": "2025-11-24T08:00:00.000Z",
  "totalMinutes": 95,
  "sections": [{"key": "teig", "name": "Teig"}],
  "equipment": [{"key": "form", "name": "Springform"}],
  "ingredients": [
    {"key": "mehl", "item": "Mehl", "amount": {"value": 300, "unit": "g"}, "section": "teig"},
    {"key": "salz", "item": "Salz", "amount": {"value": 0.25, "unit": "tsp", "second": {"value": 2, "unit": "g"}}, "optional": true},
    {"key": "msp", "item": "Zimt", "amount": {"value": 1, "unit": {"custom": "Messerspitze"}}, "note": "gemahlen", "prep": "sieben"},
    {"key": "eier", "item": "Eier", "amount": {"value": 1, "max": 2}}
  ],
  "steps": [
    {"key": "backen", "label": "backen", "sentence": "Im Ofen backen.", "equipment": ["form"],
     "duration": {"minutes": 60, "maxMinutes": 65, "kind": "passive"},
     "temperature": {"celsius": 170, "mode": "top_bottom"},
     "uses": ["mehl"], "result": {"name": "Boden", "amount": {"value": 500, "unit": "g"},
       "split": [{"key": "boden", "name": "Boden", "amount": {"value": 300, "unit": "g"}}, {"key": "rest", "name": "Rest", "rest": true}]},
     "flow": {"takes": ["teig"], "waitsFor": ["ofen"], "makes": true}},
    {"key": "plain", "label": "servieren"}
  ],
  "hasFlow": true, "makes": ["backen"]
}
"""

@Test func decodesDeviceRecipe() throws {
    let r = try decode(DeviceRecipe.self, recipeJSON)
    #expect(r.id == "rcp_zupf" && r.revision == 3 && r.title == "Zupfkuchen")
    #expect(r.yield.amount == Amount(value: 12, unit: .code(.piece)) && r.yield.vessel == "form")
    #expect(r.source == URL(string: "https://example.com/zupf"))
    #expect(r.trashedAt != nil && r.purgeAt != nil)
    #expect(r.purgeAt!.timeIntervalSince(r.trashedAt!) == 30 * 86_400)
    #expect(r.totalMinutes == 95 && r.hasFlow && r.makes == ["backen"])
    #expect(r.ingredients[0].section == "teig")
    #expect(r.ingredients[1].amount?.second == SecondAmount(value: 2, unit: .code(.g)))
    #expect(r.ingredients[1].optional == true)
    #expect(r.ingredients[2].amount?.unit == .custom("Messerspitze"))
    #expect(r.ingredients[3].amount == Amount(value: 1, max: 2))
    let step = r.steps[0]
    #expect(step.duration == StepDuration(minutes: 60, maxMinutes: 65, kind: .passive))
    #expect(step.temperature == Temperature(celsius: 170, mode: .topBottom))
    #expect(step.result?.split?.count == 2 && step.result?.split?[1].rest == true)
    #expect(step.flow == StepFlow(takes: ["teig"], waitsFor: ["ofen"], makes: true))
    #expect(r.steps[1].flow == nil && r.steps[1].sentence == nil)
}

@Test func recipeWithoutOptionalFieldsDecodes() throws {
    let r = try decode(DeviceRecipe.self, """
    {"id":"a","revision":1,"title":"T","yield":{"amount":{"value":4}},"sections":[],"equipment":[],
     "ingredients":[],"steps":[],"hasFlow":false,"makes":[]}
    """)
    #expect(r.source == nil && r.trashedAt == nil && r.totalMinutes == nil)
}

@Test func datesDecodeWithAndWithoutFractionalSeconds() throws {
    let a = try decode(Date.self, "\"2025-10-25T08:00:00Z\"")
    let b = try decode(Date.self, "\"2025-10-25T08:00:00.000Z\"")
    #expect(a == b)
}

@Test func unitRoundTrips() throws {
    #expect(UnitCode.allCases.count == 25)
    for code in UnitCode.allCases {
        let data = try JSONEncoder().encode(AmountUnit.code(code))
        #expect(try JSONDecoder().decode(AmountUnit.self, from: data) == .code(code))
    }
    #expect(try decode(AmountUnit.self, "\"fl_oz\"") == .code(.flOz))
    let custom = try JSONEncoder().encode(AmountUnit.custom("Prise"))
    #expect(String(decoding: custom, as: UTF8.self) == "{\"custom\":\"Prise\"}")
}

private let orgJSON = """
"tags": [{"name": "Kuchen", "recipeIds": ["a", "b"]}],
"collections": [{"name": "Sonntag", "recipeIds": ["b", "a"]}],
"smartCollections": [{"name": "Schnell", "filter": {"tags": {"all": ["Kuchen"], "none": ["Torte"]}, "items": ["Mehl"], "maxTotalMinutes": 30, "hasFlow": true, "text": "zucker"}}]
"""

@Test func decodesLibraryAtChange() throws {
    let l = try decode(LibraryAtChange.self, "{\"seq\": 41, \"recipes\": [\(recipeJSON)], \(orgJSON)}")
    #expect(l.seq == 41 && l.recipes.count == 1)
    #expect(l.organization.tags == [TagView(name: "Kuchen", recipeIds: ["a", "b"])])
    #expect(l.organization.collections[0].recipeIds == ["b", "a"])
    let f = l.organization.smartCollections[0].filter
    #expect(f.tags == TagFilter(all: ["Kuchen"], none: ["Torte"]) && f.items == ["Mehl"])
    #expect(f.maxTotalMinutes == 30 && f.hasFlow == true && f.text == "zucker")
}

@Test func decodesChangesAfter() throws {
    let c = try decode(ChangesAfter.self, """
    {"seq": 44, "changes": [
      {"seq": 42, "at": "2025-10-25T08:00:00.123Z", "by": {"kind": "claude", "name": "Claude"}, "kind": "library_changed", "recipeIds": ["a"]},
      {"seq": 43, "at": "2025-10-25T08:01:00.000Z", "by": {"kind": "device", "name": "iPad"}, "kind": "recipe_revised", "recipeIds": ["b"]},
      {"seq": 44, "at": "2025-10-25T08:02:00.000Z", "by": {"kind": "trash", "name": "Trash"}, "kind": "recipes_purged", "recipeIds": ["c"]}],
     "recipes": [], "purgedRecipeIds": ["c"], \(orgJSON)}
    """)
    #expect(c.seq == 44 && c.changes.count == 3)
    #expect(c.changes[0].by == ChangeAuthor(kind: .claude, name: "Claude") && c.changes[0].kind == .libraryChanged)
    #expect(c.changes[1].by.kind == .device && c.changes[1].kind == .recipeRevised)
    #expect(c.changes[2].kind == .recipesPurged && c.purgedRecipeIds == ["c"])
    #expect(c.organization.tags.count == 1)
}

@Test func decodesProblems() throws {
    let p = try decode([Problem].self, """
    [{"edit": 1, "rule": "trashed-recipes-leave-the-library", "message": "m", "fix": "f"}]
    """)
    #expect(p == [Problem(edit: 1, rule: "trashed-recipes-leave-the-library", message: "m", fix: "f")])
}

private func json(_ edit: LibraryEdit) throws -> [String: Any] {
    let data = try SippetJSON.encoder().encode(edit)
    return try JSONSerialization.jsonObject(with: data) as! [String: Any]
}

@Test func encodesAllThirteenEdits() throws {
    let ids = ["a"]
    let cases: [(LibraryEdit, String)] = [
        (.tag(tag: "K", recipeIds: ids), "tag"), (.untag(tag: "K", recipeIds: ids), "untag"),
        (.renameTag(tag: "K", to: "L"), "rename_tag"), (.mergeTags(tag: "K", into: "L"), "merge_tags"),
        (.deleteTag(tag: "K"), "delete_tag"), (.createCollection(name: "S", recipeIds: ids), "create_collection"),
        (.addToCollection(collection: "S", recipeIds: ids), "add_to_collection"),
        (.removeFromCollection(collection: "S", recipeIds: ids), "remove_from_collection"),
        (.reorderCollection(collection: "S", recipeIds: ids), "reorder_collection"),
        (.renameCollection(collection: "S", to: "T"), "rename_collection"), (.deleteCollection(collection: "S"), "delete_collection"),
        (.saveSmartCollection(name: "N", filter: RecipeFilter(text: "x")), "save_smart_collection"),
        (.deleteSmartCollection(name: "N"), "delete_smart_collection"),
    ]
    #expect(cases.count == 13)
    for (edit, op) in cases { #expect(try json(edit)["op"] as? String == op) }
    let tag = try json(.tag(tag: "Backen", recipeIds: ["z"]))
    #expect(tag["tag"] as? String == "Backen" && tag["recipeIds"] as? [String] == ["z"])
    let create = try json(.createCollection(name: "S"))
    #expect(create["recipeIds"] == nil)
    let smart = try json(.saveSmartCollection(name: "N", newName: "M", filter: RecipeFilter(maxTotalMinutes: 30)))
    #expect(smart["newName"] as? String == "M" && (smart["filter"] as? [String: Any])?["maxTotalMinutes"] as? Double == 30)
}
