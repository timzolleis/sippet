// Placeholder until the domain's content type lands: derives the columns from the content shape in specs/mcp.md ("Recipe edits" result).
// The wiring replaces this with a function over the domain's Recipe.
import { Option, Schema } from "effect"
import type { Derive } from "./library.ts"
import { nameKey } from "./library.ts"

const Duration = Schema.Struct({ minutes: Schema.optionalKey(Schema.Number), maxMinutes: Schema.optionalKey(Schema.Number) })

const Ingredient = Schema.Struct({
  item: Schema.optionalKey(Schema.String),
  note: Schema.optionalKey(Schema.String),
  prep: Schema.optionalKey(Schema.String),
})

const Step = Schema.Struct({
  label: Schema.optionalKey(Schema.String),
  sentence: Schema.optionalKey(Schema.String),
  duration: Schema.optionalKey(Duration),
  uses: Schema.optionalKey(Schema.Array(Schema.Json)),
  takes: Schema.optionalKey(Schema.Array(Schema.Json)),
  waitsFor: Schema.optionalKey(Schema.Array(Schema.Json)),
})

const Content = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  ingredients: Schema.optionalKey(Schema.Array(Ingredient)),
  steps: Schema.optionalKey(Schema.Array(Step)),
})

// Content the placeholder can't read derives as an empty recipe.
const readContent = (content: Schema.Json): typeof Content.Type => {
  const result = Schema.decodeUnknownOption(Content)(content)

  return Option.getOrElse(result, () => ({}))
}

export const placeholderDerive: Derive = (content) => {
  const recipe = readContent(content)
  const ingredients = recipe.ingredients ?? []
  const steps = recipe.steps ?? []

  const minutes = steps.flatMap((step) => {
    const { minutes, maxMinutes } = step.duration ?? {}
    const value = maxMinutes ?? minutes

    return value === undefined ? [] : [value]
  })

  const joined = (parts: ReadonlyArray<string | undefined>) => parts.filter((part) => part !== undefined && part !== "").join(" ")

  return {
    title: recipe.title ?? "",
    totalMinutes: minutes.length === 0 ? null : minutes.reduce((sum, value) => sum + value, 0),
    hasFlow: steps.some((step) => [step.uses, step.takes, step.waitsFor].some((field) => field !== undefined && field.length > 0)),
    itemKeys: ingredients.map((ingredient) => nameKey(ingredient.item ?? "")).filter((key) => key !== ""),
    ingredientsText: ingredients.map((ingredient) => joined([ingredient.item, ingredient.note, ingredient.prep])).join("\n"),
    stepsText: steps.map((step) => joined([step.label, step.sentence])).join("\n"),
  }
}
