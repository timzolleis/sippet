import { Schema } from "effect"
import { ChangeAuthor } from "../shared/change-author.ts"
import { RecipeContent } from "./recipe-content.ts"
import { RecipeEdit } from "./recipe-edit.ts"
import { RecipeId } from "./recipe-id.ts"

const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

// What made a revision: the edits of a batch, or restoring an earlier revision (revising rules 1, 5).
export const RevisionOrigin = Schema.Union([
  Schema.Struct({ edits: Schema.Array(RecipeEdit) }),
  Schema.Struct({ restored: Revision }),
])
export type RevisionOrigin = typeof RevisionOrigin.Type

export const RecipeAddedEvent = Schema.TaggedStruct("RecipeAddedEvent", {
  recipeId: RecipeId,
  revision: Schema.Literal(1),
  content: RecipeContent,
  source: Schema.optionalKey(Schema.String),
  by: ChangeAuthor,
  occurredOn: Schema.DateTimeUtc,
})
export type RecipeAddedEvent = typeof RecipeAddedEvent.Type

export const RecipeRevisedEvent = Schema.TaggedStruct("RecipeRevisedEvent", {
  recipeId: RecipeId,
  revision: Revision,
  content: RecipeContent,
  was: RevisionOrigin,
  by: ChangeAuthor,
  occurredOn: Schema.DateTimeUtc,
})
export type RecipeRevisedEvent = typeof RecipeRevisedEvent.Type

const TrashedRecipeEntry = Schema.Struct({ recipeId: RecipeId, purgeAt: Schema.DateTimeUtc })

// occurredOn is the trashedAt of the recipes trashed now; those already in the trash keep their date (revising rule 10).
export const RecipesTrashedEvent = Schema.TaggedStruct("RecipesTrashedEvent", {
  trashed: Schema.Array(TrashedRecipeEntry),
  alreadyTrashed: Schema.Array(TrashedRecipeEntry),
  by: ChangeAuthor,
  occurredOn: Schema.DateTimeUtc,
})
export type RecipesTrashedEvent = typeof RecipesTrashedEvent.Type

// Only the recipes that were in the trash; the rest stay as they are (revising rule 10).
export const RecipesRestoredEvent = Schema.TaggedStruct("RecipesRestoredEvent", {
  restoredRecipeIds: Schema.Array(RecipeId),
  by: ChangeAuthor,
  occurredOn: Schema.DateTimeUtc,
})
export type RecipesRestoredEvent = typeof RecipesRestoredEvent.Type

// Made by the trash, 30 days after trashing (revising rule 7, sync rule 4).
export const RecipesPurgedEvent = Schema.TaggedStruct("RecipesPurgedEvent", {
  recipeIds: Schema.Array(RecipeId),
  occurredOn: Schema.DateTimeUtc,
})
export type RecipesPurgedEvent = typeof RecipesPurgedEvent.Type

export const RecipeEvent = Schema.Union([
  RecipeAddedEvent, RecipeRevisedEvent, RecipesTrashedEvent, RecipesRestoredEvent, RecipesPurgedEvent,
])
export type RecipeEvent = typeof RecipeEvent.Type
