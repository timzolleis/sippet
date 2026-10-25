// Derived columns and search text from a revision's content (specs/hosting.md#cooklibrary), over the domain's RecipeContent.
import { Schema } from "effect"
import { RecipeContent } from "../domain/recipe/recipe-content.ts"
import { recipeHasFlow } from "../domain/recipe/recipe-flow.ts"
import { recipeTotalMinutesFromContent } from "../domain/recipe/recipe-total-minutes.ts"
import { nameKey, type Derive } from "./library.ts"

const decodeContent = Schema.decodeUnknownSync(RecipeContent)

const joinedText = (parts: ReadonlyArray<string | undefined>) => parts.filter((part) => part !== undefined && part !== "").join(" ")

export const derive: Derive = (json) => {
  const content = decodeContent(json)

  return {
    title: content.title,
    totalMinutes: recipeTotalMinutesFromContent(content) ?? null,
    hasFlow: recipeHasFlow(content),
    itemKeys: content.ingredients.map((ingredient) => nameKey(ingredient.item)),
    ingredientsText: content.ingredients.map((ingredient) => joinedText([ingredient.item, ingredient.note, ingredient.prep])).join("\n"),
    stepsText: content.steps.map((step) => joinedText([step.label, step.sentence])).join("\n"),
  }
}
