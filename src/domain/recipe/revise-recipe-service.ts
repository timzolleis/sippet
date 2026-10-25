import { Context, DateTime, Effect, Layer } from "effect"
import type { ChangeAuthor } from "../shared/change-author.ts"
import { reviseRecipe } from "./recipe.ts"
import type { RecipeEdit } from "./recipe-edit.ts"
import type { RecipeAlreadyTrashedError, RecipeNotFoundError, RecipeRefusedError, RecipeRevisedSinceError } from "./recipe-error.ts"
import type { RecipeId } from "./recipe-id.ts"
import { RecipeRepository } from "./recipe-repository.ts"

export type ReviseRecipeCommand = {
  readonly recipeId: RecipeId
  readonly fromRevision: number
  readonly edits: ReadonlyArray<RecipeEdit>
  readonly by: ChangeAuthor
}

export class ReviseRecipeService extends Context.Service<ReviseRecipeService, {
  // the new revision's number
  reviseRecipe(command: ReviseRecipeCommand): Effect.Effect<
    number,
    RecipeNotFoundError | RecipeAlreadyTrashedError | RecipeRevisedSinceError | RecipeRefusedError
  >
}>()("ReviseRecipeService") {
  static layer = Layer.effect(ReviseRecipeService, Effect.gen(function* () {
    const recipeRepository = yield* RecipeRepository
    return ReviseRecipeService.of({
      reviseRecipe: Effect.fn("ReviseRecipeService.reviseRecipe")(function* ({ recipeId, fromRevision, edits, by }) {
        const now = yield* DateTime.now
        const recipe = yield* recipeRepository.findLibraryRecipeById({ recipeId })
        const event = yield* Effect.fromResult(reviseRecipe({ recipe, fromRevision, edits, by, now }))
        yield* recipeRepository.publishRecipeEvent(event)
        return event.revision
      }),
    })
  }))
}
