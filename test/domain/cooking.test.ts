import { describe, expect, it } from "vitest"
import { itemTotalsFromContent } from "../../src/domain/cooking/item-total.ts"
import { measurableValue } from "../../src/domain/cooking/measurable-amount.ts"
import { amountInMeasurementSystem, temperatureInMeasurementSystem } from "../../src/domain/cooking/measurement-system.ts"
import { scaleRecipeContent } from "../../src/domain/cooking/scale-recipe.ts"
import { stepSentenceFromStep } from "../../src/domain/cooking/step-sentence.ts"
import { heatingModeLabel, unitLabel } from "../../src/domain/cooking/unit-label.ts"
import type { Amount } from "../../src/domain/recipe/amount.ts"
import type { RecipeContent } from "../../src/domain/recipe/recipe-content.ts"
import { recipeTotalMinutesFromContent } from "../../src/domain/recipe/recipe-total-minutes.ts"
import { zupfkuchen } from "./fixtures.ts"

const amountOf = (content: RecipeContent, key: string) => content.ingredients.find((ingredient) => ingredient.key === key)?.amount
const stepOf = (content: RecipeContent, key: string) => content.steps.find((step) => step.key === key)

describe("Zupfkuchen, 12 Stück", () => {
  it("scaled to 6 Stück: 150 g Mehl, ⅛ TL (1 g) Salz, ½ Pck. Vanillezucker, Boden 250 g; backen still 170 °C, 60–65 min (rules 6, 7)", () => {
    const scaled = scaleRecipeContent({ content: zupfkuchen, yieldValue: 6 })
    expect(scaled.yield.amount).toEqual({ value: 6, unit: "piece" })
    expect(amountOf(scaled, "mehl")).toEqual({ value: 150, unit: "g" })
    expect(amountOf(scaled, "salz")).toEqual({ value: 0.125, unit: "tsp", second: { value: 1, unit: "g" } })
    expect(amountOf(scaled, "vanillezucker")).toEqual({ value: 0.5, unit: "packet" })
    expect(stepOf(scaled, "verkneten")?.result?.split?.[0]?.amount).toEqual({ value: 250, unit: "g" })
    expect(stepOf(scaled, "backen")).toEqual(stepOf(zupfkuchen, "backen"))
  })

  it("ingredients for shopping: 380 g Zucker (180 g Teig, 200 g Füllung), 300 g vegane Butter (rule 3)", () => {
    const totals = itemTotalsFromContent(zupfkuchen)
    expect(totals.find((total) => total.item === "Zucker")).toEqual({
      item: "Zucker",
      totals: [{ value: 380, unit: "g" }],
      bySection: [{ sectionKey: "teig", amount: { value: 180, unit: "g" } }, { sectionKey: "fuellung", amount: { value: 200, unit: "g" } }],
    })
    expect(totals.find((total) => total.item === "vegane Butter")?.totals).toEqual([{ value: 300, unit: "g" }])
  })

  it("on an English iPad, in US units: 6¼ oz Zucker, 2 packets Puddingpulver, backen at 340 °F conventional (rule 8)", () => {
    expect(amountInMeasurementSystem({ amount: amountOf(zupfkuchen, "zucker-teig")!, system: "us" })).toEqual({ value: 6.25, unit: "oz" })
    const puddingpulver = amountInMeasurementSystem({ amount: amountOf(zupfkuchen, "puddingpulver")!, system: "us" })
    expect(puddingpulver).toEqual({ value: 2, unit: "packet", second: { value: 2.5, unit: "oz" } })
    expect(unitLabel({ unit: "packet", language: "en" })).toBe("packet")
    const backen = stepOf(zupfkuchen, "backen")?.temperature
    expect(temperatureInMeasurementSystem({ temperature: backen!, system: "us" })).toEqual({ degrees: 340, scale: "fahrenheit" })
    expect(heatingModeLabel({ mode: "top_bottom", language: "en" })).toBe("conventional")
  })

  it("total time is the sum of each step's longest duration: 65 min (specs/mcp.md)", () => {
    expect(recipeTotalMinutesFromContent(zupfkuchen)).toBe(65)
  })
})

describe("measurable amounts (rule 7)", () => {
  it.each([
    { value: 152, unit: "g", measured: 150 },
    { value: 13.4, unit: "ml", measured: 13 },
    { value: 0.3, unit: "tbsp", measured: 0.25 },
    { value: 1.1, unit: "cup", measured: 1 },
    { value: 1.3, unit: "piece", measured: 1.5 },
    { value: 1.37, unit: "kg", measured: 1.37 },
    { value: 0.4, unit: "g", measured: 1 },
    { value: 0.3, unit: "ml", measured: 1 },
    { value: 0.05, unit: "tsp", measured: 0.125 },
    { value: 0.1, unit: "oz", measured: 0.25 },
    { value: 0.2, unit: "packet", measured: 0.5 },
    { value: 0, unit: "g", measured: 0 },
  ] as const)("$value $unit → $measured", ({ value, unit, measured }) => {
    expect(measurableValue({ value, unit })).toBe(measured)
  })

  it("1 cup is 240 ml in metric; the author's own units stay (rule 8)", () => {
    const messerspitze: Amount = { value: 1, unit: { custom: "Messerspitze" } }
    expect(amountInMeasurementSystem({ amount: { value: 1, unit: "cup" }, system: "metric" })).toEqual({ value: 240, unit: "ml" })
    expect(amountInMeasurementSystem({ amount: messerspitze, system: "us" })).toEqual(messerspitze)
  })
})

describe("step sentences (recipe rule 8)", () => {
  it.each([
    { stepKey: "einfetten", sentence: "Springform einfetten, optional mit Backpapier auslegen." },
    { stepKey: "verkneten", sentence: "verkneten (vegane Butter, mischen)" },
    { stepKey: "giessen", sentence: "Füllung auf den Boden gießen, restlichen Teig als Zupfen darauf verteilen (als Boden in die Form drücken, Rand ca. 2,5 cm, Füllung, Zupfteig)" },
    { stepKey: "vorheizen", sentence: "Ofen vorheizen" },
  ])("$stepKey → $sentence", ({ stepKey, sentence }) => {
    expect(stepSentenceFromStep({ content: zupfkuchen, step: stepOf(zupfkuchen, stepKey)! })).toBe(sentence)
  })
})
