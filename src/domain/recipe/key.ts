import { Schema } from "effect"

// What edits and steps point at: unique in the recipe, kept across revisions (recipe rule 20).
// The `u` flag lets the pattern reach the JSON Schema.
export const Key = Schema.String.check(Schema.isPattern(/^[a-z0-9-]+$/u)).annotate({
  identifier: "Key",
  description: "Lowercase id you pick, kept across revisions; steps and edit_* point at it. Unique in the recipe: sections, ingredients, equipment, steps, and portions share one set of keys.",
})

export type Key = typeof Key.Type
