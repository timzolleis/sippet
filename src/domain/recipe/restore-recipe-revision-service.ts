import { Context, DateTime, Effect, Layer } from "effect"
import type { ChangeAuthor } from "../shared/change-author.ts"
import { restoreRecipeRevision } from "./recipe.ts"
import type {
  RecipeAlreadyTrashedError,
  RecipeNotFoundError,
  RecipeRevisedSinceError,
  RecipeRevisionNotFoundError,
} from "./recipe-error.ts"
import type { RecipeId } from "./recipe-id.ts"
import { RecipeRepository } from "./recipe-repository.ts"

export type RestoreRecipeRevisionCommand = {
  readonly recipeId: RecipeId
  readonly fromRevision: number
  readonly revision: number
  readonly by: ChangeAuthor
}

export class RestoreRecipeRevisionService extends Context.Service<RestoreRecipeRevisionService, {
  // the new revision's number
  restoreRecipeRevision(command: RestoreRecipeRevisionCommand): Effect.Effect<
    number,
    RecipeNotFoundError | RecipeAlreadyTrashedError | RecipeRevisionNotFoundError | RecipeRevisedSinceError
  >
}>()("RestoreRecipeRevisionService") {
  static layer = Layer.effect(RestoreRecipeRevisionService, Effect.gen(function* () {
    const recipeRepository = yield* RecipeRepository

    return RestoreRecipeRevisionService.of({
      restoreRecipeRevision: Effect.fn("RestoreRecipeRevisionService.restoreRecipeRevision")(
        function* ({ recipeId, fromRevision, revision, by }) {
          const now = yield* DateTime.now
          const recipe = yield* recipeRepository.findLibraryRecipeById({ recipeId })
          const revisionContent = yield* recipeRepository.findRecipeRevisionContent({ recipeId, revision })
          const event = yield* Effect.fromResult(restoreRecipeRevision({ recipe, fromRevision, revision, revisionContent, by, now }))
          yield* recipeRepository.publishRecipeEvent(event)

          return event.revision
        },
      ),
    })
  }))
}
