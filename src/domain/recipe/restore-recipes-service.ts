import { Context, DateTime, Effect, Layer } from "effect"
import type { ChangeAuthor } from "../shared/change-author.ts"
import { restoreRecipes } from "./recipe.ts"
import type { RecipesNotFoundError } from "./recipe-error.ts"
import type { RecipeId } from "./recipe-id.ts"
import { RecipeRepository } from "./recipe-repository.ts"

export type RestoreRecipesCommand = { readonly recipeIds: ReadonlyArray<RecipeId>; readonly by: ChangeAuthor }

export class RestoreRecipesService extends Context.Service<RestoreRecipesService, {
  restoreRecipes(command: RestoreRecipesCommand): Effect.Effect<void, RecipesNotFoundError>
}>()("RestoreRecipesService") {
  static layer = Layer.effect(RestoreRecipesService, Effect.gen(function* () {
    const recipeRepository = yield* RecipeRepository

    return RestoreRecipesService.of({
      restoreRecipes: Effect.fn("RestoreRecipesService.restoreRecipes")(function* ({ recipeIds, by }) {
        const now = yield* DateTime.now
        const recipes = yield* recipeRepository.findRecipesByIds({ recipeIds })
        yield* recipeRepository.publishRecipeEvent(restoreRecipes({ recipes, by, now }))
      }),
    })
  }))
}
