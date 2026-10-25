import { Data, type DateTime } from "effect"
import type { RecipeId } from "./recipe-id.ts"
import type { RecipeProblem } from "./recipe-problem.ts"

// The batch can't apply or breaks recipe rules; every problem at once (revising rule 1).
export class RecipeRefusedError extends Data.TaggedError("RecipeRefusedError")<{
  readonly problems: ReadonlyArray<RecipeProblem>
}> {}

// Someone saved a revision after the one the edits were made from (revising rule 2).
export class RecipeRevisedSinceError extends Data.TaggedError("RecipeRevisedSinceError")<{
  readonly recipeId: RecipeId
  readonly fromRevision: number
  readonly latestRevision: number
}> {}

export class RecipeNotFoundError extends Data.TaggedError("RecipeNotFoundError")<{
  readonly recipeId: RecipeId
}> {}

// Trashing and restoring are all or nothing: a missing or purged recipe refuses all (revising rule 10).
export class RecipesNotFoundError extends Data.TaggedError("RecipesNotFoundError")<{
  readonly recipeIds: ReadonlyArray<RecipeId>
}> {}

// A trashed recipe can't be revised; restore it first (revising rule 4).
export class RecipeAlreadyTrashedError extends Data.TaggedError("RecipeAlreadyTrashedError")<{
  readonly recipeId: RecipeId
  readonly trashedAt: DateTime.Utc
}> {}

export class RecipeRevisionNotFoundError extends Data.TaggedError("RecipeRevisionNotFoundError")<{
  readonly recipeId: RecipeId
  readonly revision: number
}> {}

// One recipe per page, trashed recipes included (adding rule 6).
export class RecipeSourceAlreadyAddedError extends Data.TaggedError("RecipeSourceAlreadyAddedError")<{
  readonly recipeId: RecipeId
  readonly title: string
  readonly trashed: boolean
}> {}
