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

const rule = (number: number, message: string) => ({ rule: `recipe ${number}`, message })

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
    ])).toEqual([rule(14, 'ingredient "kakao" is used by no step')])
  })

  it("mischen and verrühren both use the 180 g Zucker: refused (rule 14)", () => {
    expect(revisedZupfkuchen([
      { op: "edit_step", key: "verruehren", uses: ["skyr", "zucker-teig", "zitronensaft", "zitronenaroma", "zitronenschale", "butter-fuellung"] },
    ])).toEqual([
      rule(14, 'ingredient "zucker-teig" is used by "mischen" and "verruehren"'),
      rule(14, 'ingredient "zucker-fuellung" is used by no step'),
    ])
  })

  it("mischen names verkneten as what it takes: refused (rules 13, 19)", () => {
    expect(revisedZupfkuchen([{ op: "edit_step", key: "mischen", takes: ["verkneten"] }])).toEqual([
      rule(13, 'loop: "mischen" takes "verkneten", "verkneten" takes "mischen" (derived: chain)'),
      rule(16, 'step "mischen" takes the whole result of "verkneten", which is split; take its portions'),
      rule(19, 'step "mischen" takes "verkneten", which comes after it'),
    ])
  })

  it("vorheizen waits for backen, backen for vorheizen: refused (rule 13)", () => {
    expect(revisedZupfkuchen([
      { op: "edit_step", key: "vorheizen", waitsFor: ["backen"] },
      { op: "edit_step", key: "backen", waitsFor: ["vorheizen"] },
    ])).toContainEqual(rule(13, 'loop: "vorheizen" waits for "backen", "backen" waits for "vorheizen"'))
  })

  it("two steps name the whole Teig as what they take: refused, split it (rule 15)", () => {
    expect(revisedZupfkuchen([
      { op: "edit_step", key: "verkneten", result: { name: "Teig", amount: { value: 750, unit: "g" } } },
      { op: "edit_step", key: "boden", takes: ["verkneten"] },
      { op: "edit_step", key: "giessen", takes: ["verkneten", "untermixen"] },
    ])).toEqual([rule(15, 'result of "verkneten" is taken by "boden" and "giessen"')])
  })

  it("names the derivation that made a link (specs/mcp.md, Refusals)", () => {
    expect(revisedZupfkuchen([
      { op: "edit_step", key: "verkneten", result: { name: "Teig", amount: { value: 750, unit: "g" } } },
      { op: "move_step", key: "boden", at: { after: "giessen" } },
      { op: "edit_step", key: "boden", takes: ["verkneten"] },
    ])).toEqual([rule(15, 'result of "verkneten" is taken by "giessen" (derived: join) and "boden"')])
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
    ])).toEqual([rule(16, 'portions of "verkneten" (800 g) exceed its result (750 g)')])
  })

  it("split, but no later step takes Zupfteig and no join follows: refused (rule 16)", () => {
    expect(revisedZupfkuchen([
      { op: "edit_step", key: "giessen", takes: ["boden", "untermixen"] },
      { op: "edit_step", key: "backen", takes: ["giessen"] },
      { op: "edit_step", key: "auskuehlen", takes: ["backen"] },
    ]))
      .toEqual([rule(16, 'portion "zupfteig" of "verkneten" is taken by no step')])
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
    ])).toEqual([rule(18, "the flow makes nothing: every result is taken or waited for")])
  })

  it("remove kakao while mischen still uses it: refused (rule 12)", () => {
    expect(revisedZupfkuchen([{ op: "remove_ingredient", key: "kakao" }]))
      .toEqual([rule(12, 'step "mischen" uses no ingredient "kakao"')])
  })

  it("two ingredients with the key zucker: refused (rule 20)", () => {
    expect(revisedZupfkuchen([{ op: "add_ingredient", key: "mehl", item: "Zucker" }]))
      .toEqual([{ edit: 1, message: 'key "mehl" is already used' }])
    expect(revisedZupfkuchen([{ op: "edit_step", key: "untermixen", result: { split: [{ key: "mehl", name: "Mehl", rest: true }] } }]))
      .toContainEqual(rule(20, 'key "mehl" is used 2 times'))
  })

  it("no title, ingredient, or step: refused (rule 1)", () => {
    expect(problemsOf({ content: emptyPasta, edits: decodeRecipeEdits([{ op: "set_title", title: " " }]) })).toEqual([
      rule(1, "the recipe has no title"),
      rule(1, "the recipe has no ingredient"),
      rule(1, "the recipe has no step"),
    ])
  })
})

describe("recipe rules, Pasta", () => {
  it("6 numbered instructions, no ingredients named: valid plain steps (rule 10)", () => {
    expect(problemsOf({ content: emptyPasta, edits: [...pastaIngredientEdits, ...pastaPlainStepEdits] })).toEqual([])
  })

  it("5 of 6 ingredients named in steps: refused, Parmesan is used by no step (rule 14)", () => {
    expect(problemsOf({ content: plainPasta, edits: pastaUsesEdits.slice(0, 3) }))
      .toEqual([rule(14, 'ingredient "parmesan" is used by no step')])
  })
})
