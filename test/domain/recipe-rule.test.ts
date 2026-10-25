import { Option, Result } from "effect"
import { describe, expect, it } from "vitest"
import { applyRecipeEdits } from "../../src/domain/recipe/apply-recipe-edits.ts"
import type { RecipeContent } from "../../src/domain/recipe/recipe-content.ts"
import { recipeContentFromEdits } from "../../src/domain/recipe/recipe-content-from-edits.ts"
import type { RecipeEdit } from "../../src/domain/recipe/recipe-edit.ts"
import { recipeFlowFromContent } from "../../src/domain/recipe/recipe-flow.ts"
import { recipeItemsFromContent } from "../../src/domain/recipe/recipe-item.ts"
import type { RecipeProblem } from "../../src/domain/recipe/recipe-problem.ts"
import {
  decodeRecipeEdits,
  emptyPasta,
  pastaIngredientEdits,
  pastaPlainStepEdits,
  pastaUsesEdits,
  plainPasta,
  zupfkuchen,
} from "./fixtures.ts"

const problemsOf = ({ content, edits }: { readonly content: RecipeContent; readonly edits: ReadonlyArray<RecipeEdit> }): ReadonlyArray<RecipeProblem> =>
  Result.match(recipeContentFromEdits({ content, edits }), { onSuccess: () => [], onFailure: (error) => error.problems })

const revisedZupfkuchen = (edits: ReadonlyArray<unknown>) => problemsOf({ content: zupfkuchen, edits: decodeRecipeEdits(edits) })

const takesOf = (content: RecipeContent, stepKey: string) =>
  Option.getOrThrow(recipeFlowFromContent(content)).steps.find((step) => step.stepKey === stepKey)?.takes.map((link) => link.key)

// A problem names its rule and says how to fix it (specs/mcp.md Refusals).
const rule = (name: RecipeProblem["rule"], message: string) => expect.objectContaining({ rule: name, message, fix: expect.any(String) })

describe("recipe rules, Zupfkuchen unless named", () => {
  it("Zitronensaft and Füllbutter with prep; verrühren is the first step in Füllung that makes something (rules 5, 11)", () => {
    expect(takesOf(zupfkuchen, "verruehren")).toEqual([])
  })

  it("auspressen and schmelzen as steps in Füllung: schmelzen takes the squeezed juice (rule 11, chain)", () => {
    const applied = applyRecipeEdits({
      content: zupfkuchen,
      edits: decodeRecipeEdits([
        { op: "edit_ingredient", key: "zitronensaft", prep: null },
        { op: "edit_ingredient", key: "butter-fuellung", prep: null },
        { op: "add_step", key: "auspressen", label: "Zitrone auspressen", section: "fuellung", uses: ["zitronensaft"], at: { after: "vorheizen" } },
        { op: "add_step", key: "schmelzen", label: "Butter schmelzen", section: "fuellung", uses: ["butter-fuellung"], at: { after: "auspressen" } },
        { op: "edit_step", key: "verruehren", uses: ["skyr", "zucker-fuellung", "zitronenaroma", "zitronenschale"] },
      ]),
    })

    expect(takesOf(applied.content, "schmelzen")).toEqual(["auspressen"])
  })

  it("Zucker in Teig and Füllung: two ingredients of the item Zucker, each used once (rules 3, 14)", () => {
    expect(recipeItemsFromContent(zupfkuchen).find((item) => item.name === "Zucker")?.ingredientKeys).toEqual(["zucker-teig", "zucker-fuellung"])
  })

  it("no step uses Kakao: refused (rule 14)", () => {
    expect(revisedZupfkuchen([
      { op: "edit_step", key: "mischen", uses: ["mehl", "zucker-teig", "vanillezucker", "backpulver", "salz"] },
    ])).toEqual([rule("every-ingredient-goes-to-one-step", 'ingredient "kakao" is used by no step')])
  })

  it("mischen and verrühren both use the 180 g Zucker: refused (rule 14)", () => {
    expect(revisedZupfkuchen([
      { op: "edit_step", key: "verruehren", uses: ["skyr", "zucker-teig", "zitronensaft", "zitronenaroma", "zitronenschale", "butter-fuellung"] },
    ])).toEqual([
      rule("every-ingredient-goes-to-one-step", 'ingredient "zucker-teig" is used by "mischen" and "verruehren"'),
      rule("every-ingredient-goes-to-one-step", 'ingredient "zucker-fuellung" is used by no step'),
    ])
  })

  it("mischen names verkneten as what it takes: refused (rules 13, 19)", () => {
    expect(revisedZupfkuchen([{ op: "edit_step", key: "mischen", takes: ["verkneten"] }])).toEqual([
      rule("no-loops", 'loop: "mischen" takes "verkneten", "verkneten" takes "mischen" (derived: chain)'),
      rule("portions", 'step "mischen" takes the whole result of "verkneten", which is split'),
      rule("authors-order", 'step "mischen" takes "verkneten", which comes after it'),
    ])
  })

  it("vorheizen waits for backen, backen for vorheizen: refused (rule 13)", () => {
    expect(revisedZupfkuchen([
      { op: "edit_step", key: "vorheizen", waitsFor: ["backen"] },
      { op: "edit_step", key: "backen", waitsFor: ["vorheizen"] },
    ])).toContainEqual(rule("no-loops", 'loop: "vorheizen" waits for "backen", "backen" waits for "vorheizen"'))
  })

  it("two steps name the whole Teig as what they take: refused, split it (rule 15)", () => {
    expect(revisedZupfkuchen([
      { op: "edit_step", key: "verkneten", result: { name: "Teig", amount: { value: 750, unit: "g" } } },
      { op: "edit_step", key: "boden", takes: ["verkneten"] },
      { op: "edit_step", key: "giessen", takes: ["verkneten", "untermixen"] },
    ])).toEqual([rule("result-goes-to-one-place", 'result of "verkneten" is taken by "boden" and "giessen"')])
  })

  it("names the derivation that made a link (specs/mcp.md, Refusals)", () => {
    expect(revisedZupfkuchen([
      { op: "edit_step", key: "verkneten", result: { name: "Teig", amount: { value: 750, unit: "g" } } },
      { op: "move_step", key: "boden", at: { after: "giessen" } },
      { op: "edit_step", key: "boden", takes: ["verkneten"] },
    ])).toEqual([rule("result-goes-to-one-place", 'result of "verkneten" is taken by "giessen" (derived: join) and "boden"')])
  })

  it('"500 g als Boden, den Rest für Zupfen": valid (rule 16)', () => {
    expect(revisedZupfkuchen([
      { op: "edit_step", key: "verkneten", result: { name: "Teig", amount: { value: 750, unit: "g" }, split: [
        { key: "boden-teig", name: "Boden", amount: { value: 500, unit: "g" } },
        { key: "zupfteig", name: "Zupfteig", rest: true },
      ] } },
    ])).toEqual([])
  })

  it('"500 g als Boden, 300 g für Zupfen" from 750 g Teig: refused (rule 16)', () => {
    expect(revisedZupfkuchen([
      { op: "edit_step", key: "verkneten", result: { name: "Teig", amount: { value: 750, unit: "g" }, split: [
        { key: "boden-teig", name: "Boden", amount: { value: 500, unit: "g" } },
        { key: "zupfteig", name: "Zupfteig", amount: { value: 300, unit: "g" } },
      ] } },
    ])).toEqual([rule("portions", 'portions of "verkneten" (800 g) exceed its result (750 g)')])
  })

  it("split, but no later step takes Zupfteig and no join follows: refused (rule 16)", () => {
    expect(revisedZupfkuchen([
      { op: "edit_step", key: "giessen", takes: ["boden", "untermixen"] },
      { op: "edit_step", key: "backen", takes: ["giessen"] },
      { op: "edit_step", key: "auskuehlen", takes: ["backen"] },
    ]))
      .toEqual([rule("portions", 'portion "zupfteig" of "verkneten" is taken by no step')])
  })

  it("a later step naming Zupfteig keeps it out of the join (rule 11)", () => {
    const content = Result.getOrThrow(recipeContentFromEdits({
      content: zupfkuchen,
      edits: decodeRecipeEdits([
        { op: "edit_step", key: "giessen", label: "Füllung auf den Boden gießen" },
        { op: "add_step", key: "zupfen", label: "restlichen Teig als Zupfen darauf verteilen", takes: ["giessen", "zupfteig"], at: { after: "giessen" } },
      ]),
    }))

    expect(takesOf(content, "giessen")).toEqual(["boden", "untermixen"])
  })

  it("every result taken or waited for: refused (rule 18)", () => {
    expect(revisedZupfkuchen([
      { op: "add_step", key: "ausschalten", label: "Ofen ausschalten", takes: [], waitsFor: ["auskuehlen"] },
    ])).toEqual([rule("what-the-recipe-makes", "the flow makes nothing: every result is taken or waited for")])
  })

  it("remove kakao while mischen still uses it: refused (rule 12)", () => {
    expect(revisedZupfkuchen([{ op: "remove_ingredient", key: "kakao" }]))
      .toEqual([rule("everything-named-exists", 'step "mischen" uses no ingredient "kakao"')])
  })

  it("two ingredients with the key zucker: refused (rule 20)", () => {
    expect(revisedZupfkuchen([{ op: "add_ingredient", key: "mehl", item: "Zucker" }]))
      .toEqual([{ edit: 1, rule: "keys", message: 'key "mehl" is already used', fix: expect.stringContaining('"mehl-2"') }])
    expect(revisedZupfkuchen([{ op: "edit_step", key: "untermixen", result: { split: [{ key: "mehl", name: "Mehl", rest: true }] } }]))
      .toContainEqual(rule("keys", 'key "mehl" is used 2 times'))
  })

  it("no title, ingredient, or step: refused (rule 1)", () => {
    expect(problemsOf({ content: emptyPasta, edits: decodeRecipeEdits([{ op: "set_title", title: " " }]) })).toEqual([
      rule("title-ingredient-step", "the recipe has no title"),
      rule("title-ingredient-step", "the recipe has no ingredient"),
      rule("title-ingredient-step", "the recipe has no step"),
    ])
  })
})

describe("recipe rules, Pasta", () => {
  it("6 numbered instructions, no ingredients named: valid plain steps (rule 10)", () => {
    expect(problemsOf({ content: emptyPasta, edits: [...pastaIngredientEdits, ...pastaPlainStepEdits] })).toEqual([])
  })

  it("5 of 6 ingredients named in steps: refused, Parmesan is used by no step (rule 14)", () => {
    expect(problemsOf({ content: plainPasta, edits: pastaUsesEdits.slice(0, 3) }))
      .toEqual([rule("every-ingredient-goes-to-one-step", 'ingredient "parmesan" is used by no step')])
  })
})

describe("fix hints (specs/mcp.md Refusals)", () => {
  const fixOf = (problems: ReadonlyArray<RecipeProblem>, name: RecipeProblem["rule"]) => problems.find((problem) => problem.rule === name)?.fix

  it("an ingredient in takes: move it to uses, and omit takes so the chain stays", () => {
    const problems = revisedZupfkuchen([{ op: "edit_step", key: "verkneten", uses: [], takes: ["butter-teig"] }])
    expect(problems).toContainEqual({
      rule: "everything-named-exists",
      message: 'step "verkneten" takes the ingredient "butter-teig"; takes is for results of earlier steps and portions',
      fix: 'move "butter-teig" from takes to uses on "verkneten", and omit takes there (null in edit_step) so "verkneten" keeps the derived chain',
    })
  })

  it("an ingredient beside a result in takes: move only the ingredient", () => {
    const problems = revisedZupfkuchen([{ op: "edit_step", key: "verkneten", uses: [], takes: ["mischen", "butter-teig"] }])
    expect(fixOf(problems, "everything-named-exists")).toBe('move "butter-teig" from takes to uses on "verkneten"')
  })

  it("a result in uses: move it to takes", () => {
    const problems = revisedZupfkuchen([{ op: "edit_step", key: "verkneten", uses: ["butter-teig", "mischen"] }])
    expect(problems).toContainEqual(expect.objectContaining({ rule: "everything-named-exists", fix: 'move "mischen" from uses to takes on "verkneten"' }))
  })

  it("a result taken twice through the chain: says how to stop the chain, or split", () => {
    const problems = revisedZupfkuchen([
      { op: "add_step", key: "zweite-schuessel", label: "Kakao extra anrühren", section: "teig", uses: ["kakao"], at: { after: "mischen" } },
      { op: "edit_step", key: "mischen", uses: ["mehl", "zucker-teig", "vanillezucker", "backpulver", "salz"] },
      { op: "edit_step", key: "verkneten", takes: ["mischen", "zweite-schuessel"] },
    ])

    expect(problems).toEqual([{
      rule: "result-goes-to-one-place",
      message: 'result of "mischen" is taken by "zweite-schuessel" (derived: chain) and "verkneten"',
      fix: 'set takes: [] on "zweite-schuessel" to stop it chaining "mischen"; or split the result of "mischen" (result.split) into one portion per step, and let each take its portion',
    }])
  })

  it("a prep step taken: wait for it instead", () => {
    expect(fixOf(revisedZupfkuchen([{ op: "edit_step", key: "backen", takes: ["giessen", "vorheizen"] }]), "flow-is-derived"))
      .toBe('move "vorheizen" from takes to waitsFor on "backen"')
  })

  it("a step that takes a later one: move it, or drop the link", () => {
    const problems = revisedZupfkuchen([{ op: "edit_step", key: "mischen", takes: ["verkneten"] }])
    expect(fixOf(problems, "authors-order")).toBe('move_step "mischen" to after "verkneten", or drop "verkneten" from the takes of "mischen"')
    expect(fixOf(problems, "no-loops")).toBe('a step can only take or wait for earlier steps: drop "verkneten" from the takes of "mischen"')
  })
})
