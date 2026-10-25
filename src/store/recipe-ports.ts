// The domain's recipe ports over one transaction's Library and Writes (specs/hosting.md#cooklibrary).
// Everything here is synchronous SQLite, so the domain services run to completion inside `Library.transact`.
import { DateTime, Effect, Layer, Match, Option, Result, Schema } from "effect"
import { LibraryRecipe, TrashedRecipe, type Recipe } from "../domain/recipe/recipe.ts"
import { RecipeContent } from "../domain/recipe/recipe-content.ts"
import { RecipeAlreadyTrashedError, RecipeNotFoundError, RecipeRevisionNotFoundError, RecipesNotFoundError } from "../domain/recipe/recipe-error.ts"
import { RecipeId } from "../domain/recipe/recipe-id.ts"
import { RecipeRepository, RecipeSources } from "../domain/recipe/recipe-repository.ts"
import { withOptional } from "../domain/with-optional.ts"
import type { Library, RecipeRow, StoredRevision, Writes } from "./library.ts"
import { normalizeSource } from "./source.ts"

const decodeContent = Schema.decodeUnknownSync(RecipeContent)

// A failure here is a broken invariant (the domain checked first), so it dies and the transaction rolls back.
const orDie = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure

  return result.success
}

export const recipeFromStored = (row: RecipeRow & StoredRevision): Recipe => {
  const fields = withOptional(
    { recipeId: RecipeId.make(row.id), latestRevision: row.latestRevision, content: decodeContent(row.content) },
    "source",
    row.source ?? undefined,
  )

  return row.trashedAt === null || row.purgeAt === null
    ? LibraryRecipe.make(fields)
    : TrashedRecipe.make({ ...fields, trashedAt: DateTime.makeUnsafe(row.trashedAt), purgeAt: DateTime.makeUnsafe(row.purgeAt) })
}

export const recipeRepositoryLayer = ({ library, writes }: { readonly library: Library; readonly writes: Writes }) =>
  Layer.succeed(RecipeRepository, RecipeRepository.of({
    findLibraryRecipeById: ({ recipeId }) => {
      const row = library.getRecipe(recipeId)

      if (row === undefined) return Effect.fail(new RecipeNotFoundError({ recipeId }))

      return Match.valueTags(recipeFromStored(row), {
        LibraryRecipe: (recipe) => Effect.succeed(recipe),
        TrashedRecipe: (recipe) => Effect.fail(new RecipeAlreadyTrashedError({ recipeId, trashedAt: recipe.trashedAt })),
      })
    },
    findRecipesByIds: ({ recipeIds }) => {
      const unique = [...new Set(recipeIds)]
      const rows = unique.map((recipeId) => ({ recipeId, row: library.getRecipe(recipeId) }))
      const missing = rows.flatMap(({ recipeId, row }) => (row === undefined ? [recipeId] : []))

      return missing.length > 0
        ? Effect.fail(new RecipesNotFoundError({ recipeIds: missing }))
        : Effect.succeed(rows.flatMap(({ row }) => (row === undefined ? [] : [recipeFromStored(row)])))
    },
    findRecipeBySource: ({ source }) =>
      Effect.sync(() => {
        const normalized = normalizeSource(source)
        const id = Result.isFailure(normalized) ? undefined : library.findRecipeIdBySourceKey(normalized.success.sourceKey)
        const row = id === undefined ? undefined : library.getRecipe(id)

        return Option.map(Option.fromUndefinedOr(row), recipeFromStored)
      }),
    findRecipeRevisionContent: ({ recipeId, revision }) => {
      const row = library.getRecipe(recipeId, revision)

      return row === undefined
        ? Effect.fail(new RecipeRevisionNotFoundError({ recipeId, revision }))
        : Effect.succeed(decodeContent(row.content))
    },
    findTrashedRecipes: () =>
      Effect.sync(() =>
        library.listTrash().flatMap(({ id }) => {
          const row = library.getRecipe(id)

          return row === undefined ? [] : Match.valueTags(recipeFromStored(row), { LibraryRecipe: () => [], TrashedRecipe: (recipe) => [recipe] })
        })
      ),
    // The store writes with the transaction's own clock, which the services read too, so event and rows agree.
    publishRecipeEvent: (event) =>
      Effect.sync(() => {
        Match.valueTags(event, {
          RecipeAddedEvent: (added) => {
            const source = added.source === undefined ? undefined : orDie(normalizeSource(added.source))
            orDie(writes.addRecipe({ id: added.recipeId, content: added.content, source, by: added.by }))
          },
          RecipeRevisedEvent: (revised) => {
            orDie(writes.addRevision({ id: revised.recipeId, fromRevision: revised.revision - 1, content: revised.content, was: revised.was, by: revised.by }))
          },
          RecipesTrashedEvent: (trashed) => {
            orDie(writes.trashRecipes({ ids: [...trashed.trashed, ...trashed.alreadyTrashed].map((entry) => entry.recipeId), by: trashed.by }))
          },
          RecipesRestoredEvent: (restored) => {
            orDie(writes.restoreRecipes({ ids: restored.restoredRecipeIds, by: restored.by }))
          },
          RecipesPurgedEvent: () => {
            writes.purgeDue()
          },
        })
      }),
  }))

// The address is cleaned before the transaction (it can fetch); the service gets the result.
export const recipeSourcesLayer = (cleaned: string | undefined) =>
  Layer.succeed(RecipeSources, RecipeSources.of({
    cleanRecipeSource: (address) => Effect.succeed(cleaned ?? address),
  }))
