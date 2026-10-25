import { Schema } from "effect"
import { createPrefixedId, prefixedId } from "../lib/prefixed-id.ts"

export const RecipeId = prefixedId("rcp").pipe(Schema.brand("RecipeId"))

export type RecipeId = typeof RecipeId.Type

export const generateRecipeId = (): RecipeId => RecipeId.make(createPrefixedId("rcp"))
