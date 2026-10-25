import { Schema } from "effect"

// What edits and steps point at: unique in the recipe, kept across revisions (recipe rule 20).
export const Key = Schema.String.check(Schema.isPattern(/^[a-z0-9-]+$/))
export type Key = typeof Key.Type
