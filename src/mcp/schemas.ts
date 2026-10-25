// What the tools return (specs/mcp.md Reading, Refusals). Every time is an ISO string.
// The recipe's content comes as written, in the fields the edits use; the output schemas leave its parts open
// (`JsonObject`), so each tool's schema stays small and the edits' schemas are the one place they're described.
import { Schema } from "effect"

const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

// `edit`: the edit, 1-based, when one can't apply.
export const Problem = Schema.Struct({ edit: Schema.optionalKey(Schema.Int), rule: Schema.String, message: Schema.String, fix: Schema.String })

// A refused write or a read that names nothing: a tool result with isError (mcp.md Refusals).
export const Refusal = Schema.Struct({
  refused: Schema.Literal(true),
  problems: Schema.Array(Problem),
  latestRevision: Schema.optionalKey(Revision),
}).annotate({ identifier: "Refusal", description: "Sent with isError; nothing was written." })

export type Refusal = typeof Refusal.Type

// What the content's parts hold; their fields are those of the edits that wrote them.
const Written = Schema.Array(Schema.JsonObject)

export const RecipeViewResult = Schema.Struct({
  id: Schema.String,
  revision: Revision,
  latestRevision: Revision,
  title: Schema.String,
  yield: Schema.JsonObject,
  source: Schema.optionalKey(Schema.String),
  tags: Schema.Array(Schema.String),
  collections: Schema.Array(Schema.String),
  trashedAt: Schema.optionalKey(Schema.String),
  purgeAt: Schema.optionalKey(Schema.String),
  sections: Written,
  equipment: Written,
  ingredients: Written,
  steps: Written.pipe(Schema.annotateKey({
    description: "add_step's fields, plus flow: {takes, waitsFor, makes}, the derived links merged with what the step names.",
  })),
  hasFlow: Schema.Boolean,
  makes: Schema.Array(Schema.String).pipe(Schema.annotateKey({ description: "Steps whose result nobody takes: the products." })),
})

export type RecipeView = typeof RecipeViewResult.Type

// What a write returns: the same recipe get_recipe would, declared once there.
export const WrittenRecipe = Schema.JsonObject.annotate({ description: "The recipe as get_recipe returns it, with each step's flow." })

export const WrittenLibrary = Schema.JsonObject.annotate({ description: "The library as get_library returns it." })

export const RecipeSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  yield: Schema.JsonObject,
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
    Schema.Struct({ edits: Written.pipe(Schema.annotateKey({ description: "The batch, as sent to edit_recipe." })) }),
    Schema.Struct({ restored: Revision }),
  ]),
})

export type RevisionView = typeof RevisionView.Type

export const LibraryView = Schema.Struct({
  tags: Schema.Array(Schema.Struct({ name: Schema.String, recipes: Schema.Int })),
  collections: Schema.Array(Schema.Struct({ name: Schema.String, recipes: Schema.Int })),
  smartCollections: Schema.Array(Schema.Struct({
    name: Schema.String,
    filter: Schema.JsonObject.pipe(Schema.annotateKey({ description: "As save_smart_collection takes it." })),
  })),
})

export type LibraryView = typeof LibraryView.Type
