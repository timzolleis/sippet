import { Schema } from "effect"
import type { RecipeContent } from "../recipe/recipe-content.ts"
import { recipeHasFlow } from "../recipe/recipe-flow.ts"
import { recipeTotalMinutesFromContent } from "../recipe/recipe-total-minutes.ts"
import { isSameLibraryName } from "./library-name.ts"

const Names = Schema.Array(Schema.NonEmptyString)

// The descriptions reach the tools' JSON Schema (specs/mcp.md).
export const TagFilter = Schema.Struct({
  all: Schema.optionalKey(Names).pipe(Schema.annotateKey({ description: "Has every one of these tags." })),
  any: Schema.optionalKey(Names).pipe(Schema.annotateKey({ description: "Has at least one." })),
  none: Schema.optionalKey(Names).pipe(Schema.annotateKey({ description: "Has none of them." })),
}).annotate({ description: "Tag names, ignoring case; the groups combine with AND." })

export type TagFilter = typeof TagFilter.Type

// What a smart collection and search filter by (library rule 13, cooking rule 9).
export const RecipeFilter = Schema.Struct({
  tags: Schema.optionalKey(TagFilter),
  items: Schema.optionalKey(Names).pipe(Schema.annotateKey({ description: "Item names, ignoring case: the recipe uses all of them." })),
  maxTotalMinutes: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))).pipe(Schema.annotateKey({
    description: "Total time (step durations added, ranges at their high end) at most this; recipes without durations drop out.",
  })),
  hasFlow: Schema.optionalKey(Schema.Boolean).pipe(Schema.annotateKey({ description: "Whether its steps name their ingredients." })),
  text: Schema.optionalKey(Schema.NonEmptyString).pipe(Schema.annotateKey({
    description: "In the title, ingredients, or steps, ignoring case and accents.",
  })),
})

export type RecipeFilter = typeof RecipeFilter.Type

// Case and accents don't matter: "rühr" finds "verrühren", "zucker" finds "Puderzucker".
const searchableText = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()

const textOfContent = (content: RecipeContent) =>
  searchableText([
    content.title,
    ...content.ingredients.flatMap((ingredient) => [ingredient.item, ingredient.note ?? "", ingredient.prep ?? ""]),
    ...content.steps.flatMap((step) => [step.label, step.sentence ?? ""]),
  ].join("\n"))

const hasTag = (tags: ReadonlyArray<string>, name: string) => tags.some((tag) => isSameLibraryName(tag, name))

// A recipe without any duration has no total time, so a time limit leaves it out.
const isWithinMinutes = ({ content, maxTotalMinutes }: { readonly content: RecipeContent; readonly maxTotalMinutes: number }) => {
  const totalMinutes = recipeTotalMinutesFromContent(content)

  return totalMinutes !== undefined && totalMinutes <= maxTotalMinutes
}

// Every condition given holds; items are all of, ignoring case (library rule 13).
export const recipeMatchesFilter = ({ content, tags, filter }: {
  readonly content: RecipeContent
  readonly tags: ReadonlyArray<string>
  readonly filter: RecipeFilter
}): boolean =>
  (filter.tags?.all ?? []).every((name) => hasTag(tags, name))
  && (filter.tags?.any === undefined || filter.tags.any.some((name) => hasTag(tags, name)))
  && !(filter.tags?.none ?? []).some((name) => hasTag(tags, name))
  && (filter.items ?? []).every((name) => content.ingredients.some((ingredient) => isSameLibraryName(ingredient.item, name)))
  && (filter.maxTotalMinutes === undefined || isWithinMinutes({ content, maxTotalMinutes: filter.maxTotalMinutes }))
  && (filter.hasFlow === undefined || recipeHasFlow(content) === filter.hasFlow)
  && (filter.text === undefined || textOfContent(content).includes(searchableText(filter.text)))
