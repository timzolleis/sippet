import { Result, Schema } from "effect"
import { RecipeContent, Yield, emptyRecipeContent } from "../../src/domain/recipe/recipe-content.ts"
import { NewRecipeEdit, RecipeEdit } from "../../src/domain/recipe/recipe-edit.ts"
import { recipeContentFromEdits } from "../../src/domain/recipe/recipe-content-from-edits.ts"

export const decodeRecipeEdits = Schema.decodeUnknownSync(Schema.Array(RecipeEdit))
export const decodeNewRecipeEdits = Schema.decodeUnknownSync(Schema.Array(NewRecipeEdit))
export const decodeRecipeContent = Schema.decodeUnknownSync(RecipeContent)

// specs/mcp.md, The Zupfkuchen, with the elided ingredients from the Zupfkuchen-Ablauf.
export const zupfkuchenTitle = "Veganer Russischer Zupfkuchen"
export const zupfkuchenYield: Yield = { amount: { value: 12, unit: "piece" }, vessel: "springform" }

export const zupfkuchenEdits = decodeNewRecipeEdits([
  { op: "add_equipment", key: "springform", name: "Springform 26 cm" },
  { op: "add_equipment", key: "ofen", name: "Ofen" },
  { op: "add_section", key: "teig", name: "Teig" },
  { op: "add_section", key: "fuellung", name: "Füllung" },
  { op: "add_ingredient", key: "mehl", item: "Mehl", amount: { value: 300, unit: "g" }, section: "teig" },
  { op: "add_ingredient", key: "zucker-teig", item: "Zucker", amount: { value: 180, unit: "g" }, section: "teig" },
  { op: "add_ingredient", key: "vanillezucker", item: "Vanillezucker", amount: { value: 1, unit: "packet" }, section: "teig" },
  { op: "add_ingredient", key: "backpulver", item: "Backpulver", amount: { value: 1, unit: "packet" }, section: "teig" },
  { op: "add_ingredient", key: "kakao", item: "Kakao", amount: { value: 50, unit: "g" }, section: "teig" },
  { op: "add_ingredient", key: "salz", item: "Salz", section: "teig",
    amount: { value: 0.25, unit: "tsp", second: { value: 2, unit: "g" } } },
  { op: "add_ingredient", key: "butter-teig", item: "vegane Butter", amount: { value: 200, unit: "g" }, section: "teig" },
  { op: "add_ingredient", key: "skyr", item: "Vanille-Skyr", section: "fuellung",
    amount: { value: 800, unit: "g", second: { value: 2, unit: "tub" } } },
  { op: "add_ingredient", key: "zucker-fuellung", item: "Zucker", amount: { value: 200, unit: "g" }, section: "fuellung" },
  { op: "add_ingredient", key: "zitronensaft", item: "Zitronensaft", amount: { value: 30, unit: "g" },
    section: "fuellung", prep: "auspressen" },
  { op: "add_ingredient", key: "zitronenaroma", item: "Zitronenaroma", amount: { value: 0.5, unit: "bottle" },
    section: "fuellung", optional: true },
  { op: "add_ingredient", key: "zitronenschale", item: "Zitronenschale", amount: { value: 1, unit: "packet" },
    section: "fuellung", optional: true },
  { op: "add_ingredient", key: "butter-fuellung", item: "vegane Butter", amount: { value: 100, unit: "g" },
    section: "fuellung", prep: "schmelzen" },
  { op: "add_ingredient", key: "puddingpulver", item: "Puddingpulver", section: "fuellung",
    amount: { value: 2, unit: "packet", second: { value: 74, unit: "g" } } },
  { op: "add_step", key: "einfetten", label: "Springform einfetten", equipment: ["springform"],
    sentence: "Springform einfetten, optional mit Backpapier auslegen." },
  { op: "add_step", key: "mischen", label: "mischen", section: "teig",
    uses: ["mehl", "zucker-teig", "vanillezucker", "backpulver", "kakao", "salz"] },
  { op: "add_step", key: "verkneten", label: "verkneten", section: "teig", uses: ["butter-teig"],
    result: { name: "Teig", amount: { value: 750, unit: "g" },
              split: [{ key: "boden-teig", name: "Boden", amount: { value: 500, unit: "g" } },
                      { key: "zupfteig", name: "Zupfteig", amount: { value: 250, unit: "g" } }] } },
  { op: "add_step", key: "boden", label: "als Boden in die Form drücken, Rand ca. 2,5 cm", section: "teig",
    equipment: ["springform"], takes: ["boden-teig"] },
  { op: "add_step", key: "vorheizen", label: "Ofen vorheizen", section: "fuellung", equipment: ["ofen"],
    temperature: { celsius: 170, mode: "top_bottom" } },
  { op: "add_step", key: "verruehren", label: "mit dem Mixer gut verrühren", section: "fuellung",
    uses: ["skyr", "zucker-fuellung", "zitronensaft", "zitronenaroma", "zitronenschale", "butter-fuellung"],
    result: { name: "Masse" } },
  { op: "add_step", key: "untermixen", label: "Puddingpulver untermixen, bis die Masse glatt ist",
    section: "fuellung", uses: ["puddingpulver"], result: { name: "Füllung" } },
  { op: "add_step", key: "giessen", label: "Füllung auf den Boden gießen, restlichen Teig als Zupfen darauf verteilen" },
  { op: "add_step", key: "backen", label: "backen", equipment: ["ofen"],
    duration: { minutes: 60, maxMinutes: 65, kind: "passive" },
    temperature: { celsius: 170, mode: "top_bottom" } },
  { op: "add_step", key: "auskuehlen", label: "im geöffneten Ofen vollständig auskühlen", equipment: ["ofen"],
    result: { name: "Zupfkuchen" } },
])

export const emptyZupfkuchen = emptyRecipeContent({ title: zupfkuchenTitle, yield: zupfkuchenYield })

export const zupfkuchen: RecipeContent = Result.getOrThrow(
  recipeContentFromEdits({ content: emptyZupfkuchen, edits: zupfkuchenEdits }),
)

// A pasta blog recipe: water, pasta, a "meanwhile" sauce, no sections.
export const pastaTitle = "Spaghetti al pomodoro"
export const pastaYield: Yield = { amount: { value: 4, unit: "serving" } }

export const pastaIngredientEdits = decodeRecipeEdits([
  { op: "add_ingredient", key: "wasser", item: "Wasser", amount: { value: 4, unit: "l" } },
  { op: "add_ingredient", key: "salz", item: "Salz", amount: { value: 1, unit: "tbsp" } },
  { op: "add_ingredient", key: "spaghetti", item: "Spaghetti", amount: { value: 500, unit: "g" } },
  { op: "add_ingredient", key: "olivenoel", item: "Olivenöl", amount: { value: 3, unit: "tbsp" } },
  { op: "add_ingredient", key: "knoblauch", item: "Knoblauch", amount: { value: 2, unit: "clove" } },
  { op: "add_ingredient", key: "tomaten", item: "gehackte Tomaten", amount: { value: 1, unit: "can" } },
  { op: "add_ingredient", key: "parmesan", item: "Parmesan", note: "nach Geschmack" },
])

export const pastaPlainStepEdits = decodeRecipeEdits([
  { op: "add_step", key: "aufkochen", label: "Wasser aufkochen und salzen" },
  { op: "add_step", key: "kochen", label: "Spaghetti al dente kochen" },
  { op: "add_step", key: "sosse", label: "Inzwischen Knoblauch in Öl anschwitzen, Tomaten dazugeben" },
  { op: "add_step", key: "abgiessen", label: "Spaghetti abgießen" },
  { op: "add_step", key: "vermengen", label: "Spaghetti mit der Soße vermengen" },
  { op: "add_step", key: "servieren", label: "mit Parmesan servieren" },
])

// The edits that name each step's ingredients, as a revision of the plain pasta.
export const pastaUsesEdits = decodeRecipeEdits([
  { op: "edit_step", key: "aufkochen", uses: ["wasser", "salz"] },
  { op: "edit_step", key: "kochen", uses: ["spaghetti"] },
  { op: "edit_step", key: "sosse", uses: ["olivenoel", "knoblauch", "tomaten"] },
  { op: "edit_step", key: "servieren", uses: ["parmesan"] },
])

export const emptyPasta = emptyRecipeContent({ title: pastaTitle, yield: pastaYield })

export const plainPasta: RecipeContent = Result.getOrThrow(
  recipeContentFromEdits({ content: emptyPasta, edits: [...pastaIngredientEdits, ...pastaPlainStepEdits] }),
)
