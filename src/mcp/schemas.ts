// What the tools return (specs/mcp.md Reading, Refusals). Every time is an ISO string.
import { Schema } from "effect"
import { RecipeFilter } from "../domain/library/recipe-filter.ts"
import { Key } from "../domain/recipe/key.ts"
import { Equipment, Ingredient, Section, Step, Yield } from "../domain/recipe/recipe-content.ts"
import { RecipeEdit } from "../domain/recipe/recipe-edit.ts"
import { RecipeProblem } from "../domain/recipe/recipe-problem.ts"

const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

// A refused write or a read that names nothing: a tool result with isError (mcp.md Refusals).
export const Refusal = Schema.Struct({
  refused: Schema.Literal(true),
  problems: Schema.Array(RecipeProblem),
  latestRevision: Schema.optionalKey(Revision),
})

export type Refusal = typeof Refusal.Type

export const StepView = Schema.Struct({
  ...Step.fields,
  // the derived links merged with what the step names (recipe rule 11); present when the recipe has a flow
  flow: Schema.optionalKey(Schema.Struct({ takes: Schema.Array(Key), waitsFor: Schema.Array(Key), makes: Schema.Boolean })),
})

export type StepView = typeof StepView.Type

export const RecipeView = Schema.Struct({
  id: Schema.String,
  revision: Revision,
  latestRevision: Revision,
  title: Schema.String,
  yield: Yield,
  source: Schema.optionalKey(Schema.String),
  tags: Schema.Array(Schema.String),
  collections: Schema.Array(Schema.String),
  trashedAt: Schema.optionalKey(Schema.String),
  purgeAt: Schema.optionalKey(Schema.String),
  sections: Schema.Array(Section),
  equipment: Schema.Array(Equipment),
  ingredients: Schema.Array(Ingredient),
  steps: Schema.Array(StepView),
  hasFlow: Schema.Boolean,
  // the steps whose result nobody takes (recipe rule 18)
  makes: Schema.Array(Key),
})

export type RecipeView = typeof RecipeView.Type

export const RecipeSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  yield: Yield,
  tags: Schema.Array(Schema.String),
  revision: Revision,
  totalMinutes: Schema.optionalKey(Schema.Finite),
  hasFlow: Schema.Boolean,
  source: Schema.optionalKey(Schema.String),
  trashedAt: Schema.optionalKey(Schema.String),
})

export type RecipeSummary = typeof RecipeSummary.Type

export const RevisionView = Schema.Struct({
  revision: Revision,
  at: Schema.String,
  by: Schema.Struct({ kind: Schema.Literals(["device", "claude"]), name: Schema.String }),
  was: Schema.Union([
    Schema.Struct({ added: Schema.Literal(true) }),
    Schema.Struct({ edits: Schema.Array(RecipeEdit) }),
    Schema.Struct({ restored: Revision }),
  ]),
})

export type RevisionView = typeof RevisionView.Type

export const LibraryView = Schema.Struct({
  tags: Schema.Array(Schema.Struct({ name: Schema.String, recipes: Schema.Int })),
  collections: Schema.Array(Schema.Struct({ name: Schema.String, recipes: Schema.Int })),
  smartCollections: Schema.Array(Schema.Struct({ name: Schema.String, filter: RecipeFilter })),
})

export type LibraryView = typeof LibraryView.Type
