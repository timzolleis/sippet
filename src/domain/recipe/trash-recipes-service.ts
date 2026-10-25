import { Context, DateTime, Effect, Layer } from "effect"
import type { ChangeAuthor } from "../shared/change-author.ts"
import { trashRecipes } from "./recipe.ts"
import type { RecipesNotFoundError } from "./recipe-error.ts"
import type { RecipesTrashedEvent } from "./recipe-event.ts"
import type { RecipeId } from "./recipe-id.ts"
import { RecipeRepository } from "./recipe-repository.ts"

export type TrashRecipesCommand = { readonly recipeIds: ReadonlyArray<RecipeId>; readonly by: ChangeAuthor }

export class TrashRecipesService extends Context.Service<TrashRecipesService, {
  // every named recipe with its purge time, the ones already trashed included
  trashRecipes(command: TrashRecipesCommand): Effect.Effect<RecipesTrashedEvent["trashed"], RecipesNotFoundError>
}>()("TrashRecipesService") {
  static layer = Layer.effect(TrashRecipesService, Effect.gen(function* () {
    const recipeRepository = yield* RecipeRepository
    return TrashRecipesService.of({
      trashRecipes: Effect.fn("TrashRecipesService.trashRecipes")(function* ({ recipeIds, by }) {
        const now = yield* DateTime.now
        const recipes = yield* recipeRepository.findRecipesByIds({ recipeIds })
        const event = trashRecipes({ recipes, by, now })
        yield* recipeRepository.publishRecipeEvent(event)
        return [...event.trashed, ...event.alreadyTrashed]
      }),
    })
  }))
}
