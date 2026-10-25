// Placeholder until the domain's content type lands: derives the columns from the content shape in specs/mcp.md ("Recipe edits" result).
// The wiring replaces this with a function over the domain's Recipe.
import type { Derive } from "./library.ts"
import { nameKey } from "./library.ts"
import type { Json } from "./schema.ts"

type Fields = { readonly [key: string]: Json | undefined }

const objects = (value: Json | undefined): ReadonlyArray<Fields> =>
  Array.isArray(value) ? value.filter((item): item is Fields => typeof item === "object" && item !== null && !Array.isArray(item)) : []

const text = (value: Json | undefined): string => (typeof value === "string" ? value : "")

export const placeholderDerive: Derive = (content) => {
  const recipe = (typeof content === "object" && content !== null && !Array.isArray(content) ? content : {}) as Fields
  const ingredients = objects(recipe.ingredients)
  const steps = objects(recipe.steps)

  const minutes = steps.flatMap((step) => {
    const duration = step.duration

    if (typeof duration !== "object" || duration === null || Array.isArray(duration)) return []
    const { minutes, maxMinutes } = duration as Fields
    const value = typeof maxMinutes === "number" ? maxMinutes : minutes

    return typeof value === "number" ? [value] : []
  })

  return {
    title: text(recipe.title),
    totalMinutes: minutes.length === 0 ? null : minutes.reduce((sum, value) => sum + value, 0),
    hasFlow: steps.some((step) => ["uses", "takes", "waitsFor"].some((field) => Array.isArray(step[field]) && step[field].length > 0)),
    itemKeys: ingredients.map((ingredient) => nameKey(text(ingredient.item))).filter((key) => key !== ""),
    ingredientsText: ingredients.map((ingredient) => [text(ingredient.item), text(ingredient.note), text(ingredient.prep)].filter((part) => part !== "").join(" ")).join("\n"),
    stepsText: steps.map((step) => [text(step.label), text(step.sentence)].filter((part) => part !== "").join(" ")).join("\n"),
  }
}
