import type { Key } from "./key.ts"
import type { ItemName, RecipeContent } from "./recipe-content.ts"

export type RecipeItem = { readonly name: ItemName; readonly ingredientKeys: ReadonlyArray<Key> }

// Each item once, with the ingredients that refer to it; an item exists while an ingredient does (recipe rule 3).
export const recipeItemsFromContent = (content: RecipeContent): ReadonlyArray<RecipeItem> => {
  const ingredientKeysByItem = new Map<ItemName, Array<Key>>()
  for (const ingredient of content.ingredients) {
    ingredientKeysByItem.set(ingredient.item, [...(ingredientKeysByItem.get(ingredient.item) ?? []), ingredient.key])
  }
  return [...ingredientKeysByItem].map(([name, ingredientKeys]) => ({ name, ingredientKeys }))
}
