import { Result } from "effect"
import { applyRecipeEdits } from "./apply-recipe-edits.ts"
import type { RecipeContent } from "./recipe-content.ts"
import type { RecipeEdit } from "./recipe-edit.ts"
import { RecipeRefusedError } from "./recipe-error.ts"
import { recipeProblemsFromContent } from "./recipe-rule.ts"

// A batch of edits applied in order, then checked once against the recipe rules (revising rule 1, adding rule 1).
export const recipeContentFromEdits = ({ content, edits }: {
  readonly content: RecipeContent
  readonly edits: ReadonlyArray<RecipeEdit>
}): Result.Result<RecipeContent, RecipeRefusedError> => {
  const applied = applyRecipeEdits({ content, edits })
  const problems = [...applied.problems, ...recipeProblemsFromContent(applied.content)]

  return problems.length > 0 ? Result.fail(new RecipeRefusedError({ problems })) : Result.succeed(applied.content)
}
