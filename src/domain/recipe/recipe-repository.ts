import { Context, type Effect, type Option } from "effect"
import type { Recipe, LibraryRecipe, TrashedRecipe } from "./recipe.ts"
import type { RecipeContent } from "./recipe-content.ts"
import type { RecipeAlreadyTrashedError, RecipeNotFoundError, RecipeRevisionNotFoundError, RecipesNotFoundError } from "./recipe-error.ts"
import type { RecipeEvent } from "./recipe-event.ts"
import type { RecipeId } from "./recipe-id.ts"

// The cook's recipes, one library per cook. A purged recipe is not found (revising rule 9).
export class RecipeRepository extends Context.Service<RecipeRepository, {
  findLibraryRecipeById(input: { readonly recipeId: RecipeId }): Effect.Effect<LibraryRecipe, RecipeNotFoundError | RecipeAlreadyTrashedError>
  // every one or none (revising rule 10)
  findRecipesByIds(input: { readonly recipeIds: ReadonlyArray<RecipeId> }): Effect.Effect<ReadonlyArray<Recipe>, RecipesNotFoundError>
  // compared cleaned up, trashed recipes included (adding rule 6)
  findRecipeBySource(input: { readonly source: string }): Effect.Effect<Option.Option<Recipe>>
  findRecipeRevisionContent(input: { readonly recipeId: RecipeId; readonly revision: number }): Effect.Effect<RecipeContent, RecipeRevisionNotFoundError>
  findTrashedRecipes(): Effect.Effect<ReadonlyArray<TrashedRecipe>>
  publishRecipeEvent(event: RecipeEvent): Effect.Effect<void>
}>()("RecipeRepository") {}

// Follows redirects and drops tracking parameters, so the same page compares equal (adding rule 6, hosting.md Source).
export class RecipeSources extends Context.Service<RecipeSources, {
  cleanRecipeSource(address: string): Effect.Effect<string>
}>()("RecipeSources") {}
