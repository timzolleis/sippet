import { DateTime, Match, Option, Result, Schema } from "effect"
import { checkRules } from "../lib/check-rules.ts"
import type { ChangeAuthor } from "../shared/change-author.ts"
import { RecipeContent } from "./recipe-content.ts"
import { recipeContentFromEdits } from "./recipe-content-from-edits.ts"
import type { RecipeEdit } from "./recipe-edit.ts"
import { RecipeRefusedError, RecipeRevisedSinceError, RecipeSourceAlreadyAddedError } from "./recipe-error.ts"
import {
  RecipeAddedEvent,
  RecipeRevisedEvent,
  RecipesPurgedEvent,
  RecipesRestoredEvent,
  RecipesTrashedEvent,
} from "./recipe-event.ts"
import { RecipeId } from "./recipe-id.ts"
import { withOptional } from "../with-optional.ts"

const recipeFields = {
  recipeId: RecipeId,
  latestRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  content: RecipeContent,
  source: Schema.optionalKey(Schema.String),
}

// In the library: listed, searchable, revisable.
export const LibraryRecipe = Schema.TaggedStruct("LibraryRecipe", { ...recipeFields })

export type LibraryRecipe = typeof LibraryRecipe.Type

// In the trash until purgeAt; keeps its tags and collection places (revising rules 6, 8).
export const TrashedRecipe = Schema.TaggedStruct("TrashedRecipe", {
  ...recipeFields,
  trashedAt: Schema.DateTimeUtc,
  purgeAt: Schema.DateTimeUtc,
})

export type TrashedRecipe = typeof TrashedRecipe.Type

export type Recipe = LibraryRecipe | TrashedRecipe

// Emptied 30 days after it was trashed (revising rule 7).
export const recipePurgeAtFromTrashedAt = (trashedAt: DateTime.Utc): DateTime.Utc => DateTime.add(trashedAt, { hours: 720 })

export const isRecipePurgeDueAt = ({ recipe, now }: { readonly recipe: TrashedRecipe; readonly now: DateTime.Utc }): boolean =>
  DateTime.isGreaterThanOrEqualTo(now, recipe.purgeAt)

// Adding

export type AddRecipeInput = {
  readonly recipeId: RecipeId
  readonly content: RecipeContent
  readonly source?: string
  // the recipe already added from the same page, trashed included (adding rule 6)
  readonly recipeWithSameSource: Option.Option<Recipe>
  readonly by: ChangeAuthor
  readonly now: DateTime.Utc
}

export type AddRecipeRule = (input: AddRecipeInput) => Result.Result<void, RecipeSourceAlreadyAddedError>

const isRecipeTrashed = (recipe: Recipe): boolean => Match.valueTags(recipe, { LibraryRecipe: () => false, TrashedRecipe: () => true })

export const onePerSourceRule: AddRecipeRule = ({ recipeWithSameSource }) =>
  Option.match(recipeWithSameSource, {
    onNone: () => Result.succeed(undefined),
    onSome: (recipe) => Result.fail(new RecipeSourceAlreadyAddedError({
      recipeId: recipe.recipeId,
      title: recipe.content.title,
      trashed: isRecipeTrashed(recipe),
    })),
  })

export const addRecipeRules: ReadonlyArray<AddRecipeRule> = [onePerSourceRule]

// The content is checked already (recipeContentFromEdits), so a refused batch costs no source lookup.
export const addRecipe = (input: AddRecipeInput): Result.Result<RecipeAddedEvent, RecipeSourceAlreadyAddedError> =>
  Result.gen(function* () {
    yield* checkRules(addRecipeRules, input)

    return RecipeAddedEvent.make(
      withOptional(
        { recipeId: input.recipeId, revision: 1, content: input.content, by: input.by, occurredOn: input.now },
        "source",
        input.source,
      ),
    )
  })

// Revising

export type ReviseRecipeInput = {
  readonly recipe: LibraryRecipe
  readonly fromRevision: number
  readonly edits: ReadonlyArray<RecipeEdit>
  readonly by: ChangeAuthor
  readonly now: DateTime.Utc
}

export type RestoreRecipeRevisionInput = {
  readonly recipe: LibraryRecipe
  readonly fromRevision: number
  readonly revision: number
  readonly revisionContent: RecipeContent
  readonly by: ChangeAuthor
  readonly now: DateTime.Utc
}

// Revise what you saw (revising rule 2).
export const reviseOnlyLatestRevisionRule = (input: { readonly recipe: LibraryRecipe; readonly fromRevision: number }) =>
  input.fromRevision === input.recipe.latestRevision
    ? Result.succeed(undefined)
    : Result.fail(new RecipeRevisedSinceError({
      recipeId: input.recipe.recipeId,
      fromRevision: input.fromRevision,
      latestRevision: input.recipe.latestRevision,
    }))

export type ReviseRecipeRule = (input: ReviseRecipeInput) => Result.Result<void, RecipeRevisedSinceError>

export const reviseRecipeRules: ReadonlyArray<ReviseRecipeRule> = [reviseOnlyLatestRevisionRule]

export type RestoreRecipeRevisionRule = (input: RestoreRecipeRevisionInput) => Result.Result<void, RecipeRevisedSinceError>

export const restoreRecipeRevisionRules: ReadonlyArray<RestoreRecipeRevisionRule> = [reviseOnlyLatestRevisionRule]

// A batch of edits, checked once, becomes the next revision (revising rules 1–4).
export const reviseRecipe = (input: ReviseRecipeInput): Result.Result<RecipeRevisedEvent, RecipeRevisedSinceError | RecipeRefusedError> =>
  Result.gen(function* () {
    yield* checkRules(reviseRecipeRules, input)
    const content = yield* recipeContentFromEdits({ content: input.recipe.content, edits: input.edits })

    return RecipeRevisedEvent.make({
      recipeId: input.recipe.recipeId,
      revision: input.recipe.latestRevision + 1,
      content,
      was: { edits: input.edits },
      by: input.by,
      occurredOn: input.now,
    })
  })

// Restoring saves the old content as the next revision; nothing is removed (revising rule 5).
export const restoreRecipeRevision = (input: RestoreRecipeRevisionInput): Result.Result<RecipeRevisedEvent, RecipeRevisedSinceError> =>
  Result.gen(function* () {
    yield* checkRules(restoreRecipeRevisionRules, input)

    return RecipeRevisedEvent.make({
      recipeId: input.recipe.recipeId,
      revision: input.recipe.latestRevision + 1,
      content: input.revisionContent,
      was: { restored: input.revision },
      by: input.by,
      occurredOn: input.now,
    })
  })

// Trash

export type TrashRecipesInput = { readonly recipes: ReadonlyArray<Recipe>; readonly by: ChangeAuthor; readonly now: DateTime.Utc }

// All at once; one already in the trash keeps its 30 days (revising rules 6, 7, 10).
export const trashRecipes = ({ recipes, by, now }: TrashRecipesInput): RecipesTrashedEvent => {
  const purgeAt = recipePurgeAtFromTrashedAt(now)

  return RecipesTrashedEvent.make({
    trashed: recipes.flatMap((recipe) =>
      Match.valueTags(recipe, { LibraryRecipe: (inLibrary) => [{ recipeId: inLibrary.recipeId, purgeAt }], TrashedRecipe: () => [] })
    ),
    alreadyTrashed: recipes.flatMap((recipe) =>
      Match.valueTags(recipe, {
        LibraryRecipe: () => [],
        TrashedRecipe: (trashed) => [{ recipeId: trashed.recipeId, purgeAt: trashed.purgeAt }],
      })
    ),
    by,
    occurredOn: now,
  })
}

export type RestoreRecipesInput = { readonly recipes: ReadonlyArray<Recipe>; readonly by: ChangeAuthor; readonly now: DateTime.Utc }

// Back with its tags and collection places; one not in the trash stays as it is (revising rules 8, 10).
export const restoreRecipes = ({ recipes, by, now }: RestoreRecipesInput): RecipesRestoredEvent =>
  RecipesRestoredEvent.make({
    restoredRecipeIds: recipes.flatMap((recipe) =>
      Match.valueTags(recipe, { LibraryRecipe: () => [], TrashedRecipe: (trashed) => [trashed.recipeId] })
    ),
    by,
    occurredOn: now,
  })

export type PurgeTrashedRecipesInput = { readonly recipes: ReadonlyArray<TrashedRecipe>; readonly now: DateTime.Utc }

// The trash empties itself of every recipe due (revising rule 7); a purged recipe is gone (revising rule 9).
export const purgeTrashedRecipes = ({ recipes, now }: PurgeTrashedRecipesInput): RecipesPurgedEvent =>
  RecipesPurgedEvent.make({
    recipeIds: recipes.filter((recipe) => isRecipePurgeDueAt({ recipe, now })).map((recipe) => recipe.recipeId),
    occurredOn: now,
  })
