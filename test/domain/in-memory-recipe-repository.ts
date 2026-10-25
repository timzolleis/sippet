import { type DateTime, Effect, Layer, Match, Option } from "effect"
import { LibraryRecipe, TrashedRecipe, type Recipe } from "../../src/domain/recipe/recipe.ts"
import type { RecipeContent } from "../../src/domain/recipe/recipe-content.ts"
import {
  RecipeAlreadyTrashedError,
  RecipeNotFoundError,
  RecipeRevisionNotFoundError,
  RecipesNotFoundError,
} from "../../src/domain/recipe/recipe-error.ts"
import type { RecipeEvent } from "../../src/domain/recipe/recipe-event.ts"
import type { RecipeId } from "../../src/domain/recipe/recipe-id.ts"
import { RecipeRepository, RecipeSources } from "../../src/domain/recipe/recipe-repository.ts"

export type StoredRecipe = {
  readonly recipeId: RecipeId
  revisions: Array<RecipeContent>
  readonly source?: string
  trash?: { readonly trashedAt: DateTime.Utc; readonly purgeAt: DateTime.Utc }
}

// The RecipeRepository port over a Map, applying each published event the way storage would.
export const makeInMemoryRecipeRepository = () => {
  const storedRecipes = new Map<RecipeId, StoredRecipe>()
  const publishedEvents: Array<RecipeEvent> = []

  const recipeFromStored = (stored: StoredRecipe): Recipe => {
    const fields = {
      recipeId: stored.recipeId,
      latestRevision: stored.revisions.length,
      content: stored.revisions[stored.revisions.length - 1]!,
      ...(stored.source === undefined ? {} : { source: stored.source }),
    }
    return stored.trash === undefined
      ? LibraryRecipe.make(fields)
      : TrashedRecipe.make({ ...fields, trashedAt: stored.trash.trashedAt, purgeAt: stored.trash.purgeAt })
  }

  const applyRecipeEvent = (event: RecipeEvent): void =>
    Match.valueTags(event, {
      RecipeAddedEvent: (added) => {
        storedRecipes.set(added.recipeId, {
          recipeId: added.recipeId,
          revisions: [added.content],
          ...(added.source === undefined ? {} : { source: added.source }),
        })
      },
      RecipeRevisedEvent: (revised) => {
        storedRecipes.get(revised.recipeId)?.revisions.push(revised.content)
      },
      RecipesTrashedEvent: (trashed) => {
        for (const { recipeId, purgeAt } of trashed.trashed) {
          const stored = storedRecipes.get(recipeId)
          if (stored !== undefined) stored.trash = { trashedAt: trashed.occurredOn, purgeAt }
        }
      },
      RecipesRestoredEvent: (restored) => {
        for (const recipeId of restored.restoredRecipeIds) {
          const stored = storedRecipes.get(recipeId)
          if (stored !== undefined) delete stored.trash
        }
      },
      RecipesPurgedEvent: (purged) => {
        for (const recipeId of purged.recipeIds) storedRecipes.delete(recipeId)
      },
    })

  const layer = Layer.succeed(RecipeRepository, RecipeRepository.of({
    findLibraryRecipeById: ({ recipeId }) => {
      const stored = storedRecipes.get(recipeId)
      if (stored === undefined) return Effect.fail(new RecipeNotFoundError({ recipeId }))
      return Match.valueTags(recipeFromStored(stored), {
        LibraryRecipe: (recipe) => Effect.succeed(recipe),
        TrashedRecipe: (recipe) => Effect.fail(new RecipeAlreadyTrashedError({ recipeId, trashedAt: recipe.trashedAt })),
      })
    },
    findRecipesByIds: ({ recipeIds }) => {
      const missing = recipeIds.filter((recipeId) => !storedRecipes.has(recipeId))
      return missing.length > 0
        ? Effect.fail(new RecipesNotFoundError({ recipeIds: missing }))
        : Effect.succeed(recipeIds.flatMap((recipeId) => {
          const stored = storedRecipes.get(recipeId)
          return stored === undefined ? [] : [recipeFromStored(stored)]
        }))
    },
    findRecipeBySource: ({ source }) =>
      Effect.sync(() => Option.map(Option.fromUndefinedOr([...storedRecipes.values()].find((stored) => stored.source === source)), recipeFromStored)),
    findRecipeRevisionContent: ({ recipeId, revision }) => {
      const content = storedRecipes.get(recipeId)?.revisions[revision - 1]
      return content === undefined ? Effect.fail(new RecipeRevisionNotFoundError({ recipeId, revision })) : Effect.succeed(content)
    },
    findTrashedRecipes: () =>
      Effect.sync(() =>
        [...storedRecipes.values()].flatMap((stored) =>
          Match.valueTags(recipeFromStored(stored), { LibraryRecipe: () => [], TrashedRecipe: (recipe) => [recipe] })
        )
      ),
    publishRecipeEvent: (event) =>
      Effect.sync(() => {
        applyRecipeEvent(event)
        publishedEvents.push(event)
      }),
  }))

  return { storedRecipes, publishedEvents, layer }
}

// Drops utm_* parameters; the real one also follows redirects (hosting.md Source).
export const inMemoryRecipeSourcesLayer = Layer.succeed(RecipeSources, RecipeSources.of({
  cleanRecipeSource: (address) =>
    Effect.sync(() => {
      const url = new URL(address)
      for (const name of [...url.searchParams.keys()]) if (name.startsWith("utm_")) url.searchParams.delete(name)
      return url.toString()
    }),
}))
