import { Option, Result } from "effect"
import { describe, expect, it } from "vitest"
import { applyRecipeEdits } from "../../src/domain/recipe/apply-recipe-edits.ts"
import type { RecipeContent } from "../../src/domain/recipe/recipe-content.ts"
import { recipeContentFromEdits } from "../../src/domain/recipe/recipe-content-from-edits.ts"
import { recipeFlowFromContent, type RecipeFlow } from "../../src/domain/recipe/recipe-flow.ts"
import { decodeRecipeEdits, pastaUsesEdits, plainPasta, zupfkuchen } from "./fixtures.ts"

const flowOf = (content: RecipeContent): RecipeFlow => Option.getOrThrow(recipeFlowFromContent(content))

const linksOf = (flow: RecipeFlow) =>
  Object.fromEntries(flow.steps.map((step) => [step.stepKey, {
    takes: step.takes.map((link) => `${link.key} (${link.source})`),
    waitsFor: step.waitsFor.map((link) => `${link.key} (${link.source})`),
    makes: step.makes,
  }]))

describe("recipe rule 11: the Zupfkuchen's derived flow, as in specs/mcp.md", () => {
  it("derives every link the spec lists, and nothing else", () => {
    expect(linksOf(flowOf(zupfkuchen))).toEqual({
      einfetten: { takes: [], waitsFor: [], makes: false },
      mischen: { takes: [], waitsFor: [], makes: true },
      verkneten: { takes: ["mischen (chain)"], waitsFor: [], makes: true },
      boden: { takes: ["boden-teig (named)"], waitsFor: ["einfetten (prep step)"], makes: true },
      vorheizen: { takes: [], waitsFor: [], makes: false },
      verruehren: { takes: [], waitsFor: [], makes: true },
      untermixen: { takes: ["verruehren (chain)"], waitsFor: [], makes: true },
      giessen: { takes: ["boden (join)", "untermixen (join)", "zupfteig (join)"], waitsFor: [], makes: true },
      backen: { takes: ["giessen (chain)"], waitsFor: ["vorheizen (prep step)"], makes: true },
      auskuehlen: { takes: ["backen (chain)"], waitsFor: [], makes: true },
    })
  })

  it("makes the Zupfkuchen (recipe rule 18)", () => {
    expect(flowOf(zupfkuchen).makes).toEqual(["auskuehlen"])
  })
})

describe("recipe rule 11: the pasta trap", () => {
  const pastaWithUses = (extraEdits: ReturnType<typeof decodeRecipeEdits>) =>
    Result.getOrThrow(recipeContentFromEdits({ content: plainPasta, edits: [...pastaUsesEdits, ...extraEdits] }))

  it("plain steps have no flow (recipe rule 10)", () => {
    expect(Option.isNone(recipeFlowFromContent(plainPasta))).toBe(true)
  })

  it("ingredients named, no sections: the sauce takes the pasta (chain)", () => {
    const links = linksOf(flowOf(pastaWithUses([])))
    expect(links["sosse"]?.takes).toEqual(["kochen (chain)"])
  })

  it("the sauce in its own section takes nothing; abgießen joins pasta and sauce", () => {
    const links = linksOf(flowOf(pastaWithUses(decodeRecipeEdits([
      { op: "add_section", key: "sauce", name: "Soße" },
      { op: "edit_step", key: "sosse", section: "sauce" },
    ]))))
    expect(links["sosse"]?.takes).toEqual([])
    expect(links["abgiessen"]?.takes).toEqual(["kochen (chain)", "sosse (join)"])
  })

  it("the sauce naming what it takes replaces the chain", () => {
    const applied = applyRecipeEdits({
      content: plainPasta,
      edits: [...pastaUsesEdits, ...decodeRecipeEdits([{ op: "edit_step", key: "sosse", takes: [] }])],
    })
    expect(linksOf(flowOf(applied.content))["sosse"]?.takes).toEqual([])
  })
})
