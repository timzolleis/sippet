// The recipe rules a refusal names, by the bold names in stories/recipe.md (specs/mcp.md Rule names).
export type RecipeRuleName =
  | "title-ingredient-step"
  | "flow-is-derived"
  | "everything-named-exists"
  | "no-loops"
  | "every-ingredient-goes-to-one-step"
  | "result-goes-to-one-place"
  | "portions"
  | "what-the-recipe-makes"
  | "authors-order"
  | "keys"

// One reason a batch is refused: the rule, what's wrong, and how to fix it; `edit` (1-based) when an edit can't apply.
export type RecipeProblem = {
  readonly edit?: number
  readonly rule: RecipeRuleName
  readonly message: string
  readonly fix: string
}
