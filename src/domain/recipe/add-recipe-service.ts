import { Context, DateTime, Effect, Layer, Option } from "effect"
import type { ChangeAuthor } from "../shared/change-author.ts"
import { addRecipe } from "./recipe.ts"
import { emptyRecipeContent, type Yield } from "./recipe-content.ts"
import { recipeContentFromEdits } from "./recipe-content-from-edits.ts"
import type { RecipeEdit } from "./recipe-edit.ts"
import type { RecipeRefusedError, RecipeSourceAlreadyAddedError } from "./recipe-error.ts"
import { generateRecipeId, type RecipeId } from "./recipe-id.ts"
import { RecipeRepository, RecipeSources } from "./recipe-repository.ts"

export type AddRecipeCommand = {
  readonly title: string
  readonly yield: Yield
  readonly source?: string
  readonly edits: ReadonlyArray<RecipeEdit>
  readonly by: ChangeAuthor
}

export class AddRecipeService extends Context.Service<AddRecipeService, {
  addRecipe(command: AddRecipeCommand): Effect.Effect<RecipeId, RecipeRefusedError | RecipeSourceAlreadyAddedError>
}>()("AddRecipeService") {
  static layer = Layer.effect(AddRecipeService, Effect.gen(function* () {
    const recipeRepository = yield* RecipeRepository
    const recipeSources = yield* RecipeSources
    return AddRecipeService.of({
      addRecipe: Effect.fn("AddRecipeService.addRecipe")(function* (command) {
        const now = yield* DateTime.now
        // checked before the source is cleaned, so a refused batch costs no fetch (hosting.md Source)
        const content = yield* Effect.fromResult(recipeContentFromEdits({
          content: emptyRecipeContent({ title: command.title, yield: command.yield }),
          edits: command.edits,
        }))
        const source = command.source === undefined ? undefined : yield* recipeSources.cleanRecipeSource(command.source)
        const recipeWithSameSource = source === undefined ? Option.none() : yield* recipeRepository.findRecipeBySource({ source })
        const recipeId = generateRecipeId()
        const event = yield* Effect.fromResult(addRecipe({
          recipeId,
          content,
          ...(source === undefined ? {} : { source }),
          recipeWithSameSource,
          by: command.by,
          now,
        }))
        yield* recipeRepository.publishRecipeEvent(event)
        return recipeId
      }),
    })
  }))
}
