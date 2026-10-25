/// <reference types="node" />
// pnpm golden → test/golden/cooking.json (specs/ios.md Golden files).
// The Swift port in ios/SippetCore is tested against it; test/golden/golden.test.ts fails when the committed file is stale.
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { Option, Result } from "effect"
import { itemTotalsFromContent } from "../src/domain/cooking/item-total.ts"
import { measurableAmount } from "../src/domain/cooking/measurable-amount.ts"
import { amountInMeasurementSystem, temperatureInMeasurementSystem, type MeasurementSystem } from "../src/domain/cooking/measurement-system.ts"
import { scaleRecipeContent } from "../src/domain/cooking/scale-recipe.ts"
import { stepSentenceFromStep } from "../src/domain/cooking/step-sentence.ts"
import { heatingModeLabel, unitLabel, type Language } from "../src/domain/cooking/unit-label.ts"
import { recipeMatchesFilter, type RecipeFilter } from "../src/domain/library/recipe-filter.ts"
import type { Amount } from "../src/domain/recipe/amount.ts"
import { recipeContentFromEdits } from "../src/domain/recipe/recipe-content-from-edits.ts"
import { emptyRecipeContent, type HeatingMode, type RecipeContent, type Temperature } from "../src/domain/recipe/recipe-content.ts"
import { recipeFlowFromContent, recipeHasFlow } from "../src/domain/recipe/recipe-flow.ts"
import { recipeTotalMinutesFromContent } from "../src/domain/recipe/recipe-total-minutes.ts"
import type { Unit } from "../src/domain/recipe/unit.ts"
import { decodeNewRecipeEdits, pastaUsesEdits, plainPasta, zupfkuchen } from "../test/domain/fixtures.ts"

// A recipe as DeviceViews builds it: content as written, steps with their flow (device-api.md Views).
const deviceRecipe = ({ id, content }: { readonly id: string; readonly content: RecipeContent }) => {
  const flow = Option.getOrUndefined(recipeFlowFromContent(content))

  return {
    id,
    revision: 1,
    title: content.title,
    yield: content.yield,
    totalMinutes: recipeTotalMinutesFromContent(content),
    sections: content.sections,
    equipment: content.equipment,
    ingredients: content.ingredients,
    steps: content.steps.map((step) => {
      const stepFlow = flow?.steps.find((candidate) => candidate.stepKey === step.key)

      return stepFlow === undefined
        ? step
        : { ...step, flow: { takes: stepFlow.takes.map((link) => link.key), waitsFor: stepFlow.waitsFor.map((link) => link.key), makes: stepFlow.makes } }
    }),
    hasFlow: recipeHasFlow(content),
    makes: flow?.makes ?? [],
  }
}

const pastaWithUses: RecipeContent = Result.getOrThrow(
  recipeContentFromEdits({ content: plainPasta, edits: pastaUsesEdits }),
)

// Mixed units, a range, an own unit, a sentence, and two ingredients of one item: totals add across kinds.
const kekse: RecipeContent = Result.getOrThrow(recipeContentFromEdits({
  content: emptyRecipeContent({ title: "Kekse", yield: { amount: { value: 24, unit: "piece" } } }),
  edits: decodeNewRecipeEdits([
    { op: "add_section", key: "teig", name: "Teig" },
    { op: "add_ingredient", key: "mehl-a", item: "Mehl", amount: { value: 500, unit: "g" }, section: "teig" },
    { op: "add_ingredient", key: "mehl-b", item: "Mehl", amount: { value: 1, unit: "kg" } },
    { op: "add_ingredient", key: "milch-a", item: "Milch", amount: { value: 1, unit: "cup" } },
    { op: "add_ingredient", key: "milch-b", item: "Milch", amount: { value: 100, unit: "ml" } },
    { op: "add_ingredient", key: "zimt", item: "Zimt", amount: { value: 1, unit: { custom: "Messerspitze" } } },
    { op: "add_ingredient", key: "knoblauch", item: "Knoblauch", amount: { value: 1, max: 2, unit: "clove" } },
    { op: "add_ingredient", key: "ei", item: "Ei", amount: { value: 3 }, note: "Größe M" },
    { op: "add_ingredient", key: "butter", item: "Butter", amount: { value: 0.33, unit: "lb", second: { value: 150, unit: "g" } } },
    { op: "add_ingredient", key: "wasser", item: "Wasser", amount: { value: 3, unit: "fl_oz" } },
    { op: "add_step", key: "kneten", label: "Teig kneten", sentence: "Alles zu einem glatten Teig kneten.",
      duration: { minutes: 10, kind: "active" } },
    { op: "add_step", key: "ruhen", label: "ruhen lassen", duration: { minutes: 30, maxMinutes: 60, kind: "passive" } },
    { op: "add_step", key: "backen", label: "backen", temperature: { celsius: 180, maxCelsius: 190, mode: "fan" } },
  ]),
}))

const recipes = {
  zupfkuchen: deviceRecipe({ id: "rcp_zupfkuchen", content: zupfkuchen }),
  pasta: deviceRecipe({ id: "rcp_pasta", content: plainPasta }),
  pastaWithUses: deviceRecipe({ id: "rcp_pasta_uses", content: pastaWithUses }),
  kekse: deviceRecipe({ id: "rcp_kekse", content: kekse }),
}

const contents: Record<keyof typeof recipes, RecipeContent> = { zupfkuchen, pasta: plainPasta, pastaWithUses, kekse }
const names: ReadonlyArray<keyof typeof recipes> = ["zupfkuchen", "pasta", "pastaWithUses", "kekse"]

const amounts: ReadonlyArray<Amount> = [
  { value: 152, unit: "g" }, { value: 13.4, unit: "ml" }, { value: 0.3, unit: "tbsp" }, { value: 1.1, unit: "cup" },
  { value: 1.3, unit: "piece" }, { value: 1.37, unit: "kg" }, { value: 0.4, unit: "g" }, { value: 0.3, unit: "ml" },
  { value: 0.05, unit: "tsp" }, { value: 0.1, unit: "oz" }, { value: 0.2, unit: "packet" }, { value: 0, unit: "g" },
  { value: 19.6, unit: "g" }, { value: 20, unit: "ml" }, { value: 2.5, unit: "clove" }, { value: 3 },
  { value: 1, max: 2, unit: "clove" }, { value: 62.5, max: 67, unit: "g" },
  { value: 0.33, unit: "lb", second: { value: 150, unit: "g" } },
  { value: 1, unit: { custom: "Messerspitze" } },
  { value: 0.25, unit: "tsp", second: { value: 2, unit: "g" } },
  { value: 800, unit: "g", second: { value: 2, unit: "tub" } },
]

const systemAmounts: ReadonlyArray<Amount> = [
  ...amounts,
  { value: 180, unit: "g" }, { value: 1, unit: "cup" }, { value: 2, unit: "packet", second: { value: 74, unit: "g" } },
  { value: 4, unit: "l" }, { value: 250, unit: "ml" }, { value: 5, unit: "ml" }, { value: 30, unit: "ml" }, { value: 100, unit: "ml" },
  { value: 3, unit: "cl" }, { value: 1, unit: "tbsp" }, { value: 2, unit: "oz" }, { value: 1, unit: "lb" }, { value: 6, unit: "fl_oz" },
  { value: 1, max: 1.5, unit: "kg" }, { value: 500, unit: "g", second: { value: 1, unit: "cup" } },
]

const systems: ReadonlyArray<MeasurementSystem> = ["as_written", "metric", "us"]
const languages: ReadonlyArray<Language> = ["de", "en"]

const temperatures: ReadonlyArray<Temperature> = [
  { celsius: 170, mode: "top_bottom" }, { celsius: 180, maxCelsius: 190, mode: "fan" }, { celsius: 200 }, { celsius: 160 },
  { celsius: 220, mode: "grill" }, { celsius: 0 }, { celsius: 97 },
]

const unitCodes: ReadonlyArray<Unit> = [
  "g", "kg", "oz", "lb", "ml", "cl", "l", "tsp", "tbsp", "cup", "fl_oz",
  "piece", "serving", "pinch", "packet", "can", "tub", "bottle", "bunch", "clove", "slice", "sheet", "sprig", "drop", "handful",
  { custom: "Messerspitze" },
]

const heatingModes: ReadonlyArray<HeatingMode> = ["top_bottom", "fan", "top", "bottom", "grill"]

const filterCases: ReadonlyArray<{ readonly recipe: keyof typeof recipes; readonly tags: ReadonlyArray<string>; readonly filter: RecipeFilter }> = [
  { recipe: "zupfkuchen", tags: ["Kuchen", "Backen"], filter: {} },
  { recipe: "zupfkuchen", tags: ["Kuchen", "Backen"], filter: { tags: { all: ["kuchen"] } } },
  { recipe: "zupfkuchen", tags: ["Kuchen"], filter: { tags: { all: ["Kuchen", "Backen"] } } },
  { recipe: "zupfkuchen", tags: ["Kuchen"], filter: { tags: { any: ["Brot", "KUCHEN"] } } },
  { recipe: "zupfkuchen", tags: ["Kuchen"], filter: { tags: { any: ["Brot"] } } },
  { recipe: "zupfkuchen", tags: ["Kuchen"], filter: { tags: { none: ["kuchen"] } } },
  { recipe: "zupfkuchen", tags: ["Kuchen"], filter: { tags: { none: ["Brot"] } } },
  { recipe: "zupfkuchen", tags: [], filter: { tags: { any: [] } } },
  { recipe: "zupfkuchen", tags: [], filter: { items: ["zucker", "MEHL"] } },
  { recipe: "zupfkuchen", tags: [], filter: { items: ["Zucker", "Eier"] } },
  { recipe: "zupfkuchen", tags: [], filter: { maxTotalMinutes: 65 } },
  { recipe: "zupfkuchen", tags: [], filter: { maxTotalMinutes: 64 } },
  { recipe: "pasta", tags: [], filter: { maxTotalMinutes: 600 } },
  { recipe: "kekse", tags: [], filter: { maxTotalMinutes: 70 } },
  { recipe: "kekse", tags: [], filter: { maxTotalMinutes: 69 } },
  { recipe: "zupfkuchen", tags: [], filter: { hasFlow: true } },
  { recipe: "zupfkuchen", tags: [], filter: { hasFlow: false } },
  { recipe: "pasta", tags: [], filter: { hasFlow: false } },
  { recipe: "pasta", tags: [], filter: { hasFlow: true } },
  { recipe: "pastaWithUses", tags: [], filter: { hasFlow: true } },
  { recipe: "zupfkuchen", tags: [], filter: { text: "rühr" } },
  { recipe: "zupfkuchen", tags: [], filter: { text: "ZUCKER" } },
  { recipe: "zupfkuchen", tags: [], filter: { text: "Puderzucker" } },
  { recipe: "zupfkuchen", tags: [], filter: { text: "verruhren" } },
  { recipe: "zupfkuchen", tags: [], filter: { text: "auspressen" } },
  { recipe: "pasta", tags: [], filter: { text: "nach geschmack" } },
  { recipe: "kekse", tags: [], filter: { text: "grose" } },
  { recipe: "kekse", tags: [], filter: { text: "größe" } },
  { recipe: "kekse", tags: ["Plätzchen"], filter: { tags: { all: ["plätzchen"] }, items: ["Mehl"], maxTotalMinutes: 100, hasFlow: false, text: "kneten" } },
  { recipe: "kekse", tags: ["Plätzchen"], filter: { tags: { all: ["plätzchen"] }, items: ["Mehl"], maxTotalMinutes: 100, hasFlow: true } },
]

export const goldenCooking = () => ({
  recipes,
  scaleRecipe:
    ([["zupfkuchen", 6], ["zupfkuchen", 24], ["zupfkuchen", 7], ["zupfkuchen", 1], ["zupfkuchen", 12], ["pasta", 2], ["pasta", 6], ["kekse", 5], ["kekse", 100]] as const).map(
      ([recipe, toYield]) => ({
        recipe,
        toYield,
        // the steps keep their flow: scaling doesn't change it
        expected: { ...recipes[recipe], ...scaleRecipeContent({ content: recipes[recipe], yieldValue: toYield }) },
      }),
    ),
  measurableAmount: amounts.map((amount) => ({ amount, expected: measurableAmount(amount) })),
  amountInMeasurementSystem: systemAmounts.flatMap((amount) =>
    systems.map((system) => ({ amount, system, expected: amountInMeasurementSystem({ amount, system }) }))
  ),
  temperatureInMeasurementSystem: temperatures.flatMap((temperature) =>
    systems.map((system) => ({ temperature, system, expected: temperatureInMeasurementSystem({ temperature, system }) }))
  ),
  unitLabel: unitCodes.flatMap((unit) => languages.map((language) => ({ unit, language, expected: unitLabel({ unit, language }) }))),
  heatingModeLabel: heatingModes.flatMap((mode) => languages.map((language) => ({ mode, language, expected: heatingModeLabel({ mode, language }) }))),
  itemTotals: names.map((recipe) => ({ recipe, expected: itemTotalsFromContent(contents[recipe]) })),
  stepSentence: names.flatMap((recipe) =>
    contents[recipe].steps.map((step) => ({ recipe, step: step.key, expected: stepSentenceFromStep({ content: contents[recipe], step }) }))
  ),
  recipeMatchesFilter: filterCases.map(({ recipe, tags, filter }) => ({
    recipe, tags, filter, expected: recipeMatchesFilter({ content: contents[recipe], tags, filter }),
  })),
})

export const goldenCookingJson = (): string => `${JSON.stringify(goldenCooking(), null, 2)}\n`


if (import.meta.main) {
  const path = join(import.meta.dirname, "../test/golden/cooking.json")
  writeFileSync(path, goldenCookingJson())
  console.log(`wrote ${path}`)
}
