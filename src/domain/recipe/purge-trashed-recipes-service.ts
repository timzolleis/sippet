import { Context, DateTime, Effect, Layer } from "effect"
import { purgeTrashedRecipes } from "./recipe.ts"
import { RecipeRepository } from "./recipe-repository.ts"

// Run by the trash's alarm, not by the cook or Claude (revising rule 7, account rule 6).
export class PurgeTrashedRecipesService extends Context.Service<PurgeTrashedRecipesService, {
  purgeTrashedRecipes(): Effect.Effect<void>
}>()("PurgeTrashedRecipesService") {
  static layer = Layer.effect(PurgeTrashedRecipesService, Effect.gen(function* () {
    const recipeRepository = yield* RecipeRepository

    return PurgeTrashedRecipesService.of({
      purgeTrashedRecipes: Effect.fn("PurgeTrashedRecipesService.purgeTrashedRecipes")(function* () {
        const now = yield* DateTime.now
        const recipes = yield* recipeRepository.findTrashedRecipes()
        const event = purgeTrashedRecipes({ recipes, now })

        if (event.recipeIds.length > 0) yield* recipeRepository.publishRecipeEvent(event)
      }),
    })
  }))
}
