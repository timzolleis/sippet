import { Schema } from "effect"

// One reason a batch is refused: an edit that can't apply (`edit`, 1-based) or a broken recipe rule (`rule`).
export const RecipeProblem = Schema.Struct({
  edit: Schema.optionalKey(Schema.Int),
  rule: Schema.optionalKey(Schema.String),
  message: Schema.String,
})
export type RecipeProblem = typeof RecipeProblem.Type
