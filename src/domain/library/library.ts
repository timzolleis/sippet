import { Schema } from "effect"
import { RecipeId } from "../recipe/recipe-id.ts"
import { RecipeFilter } from "./recipe-filter.ts"

const recipeIds = Schema.Array(RecipeId)

// Trashed recipes keep their tags and collection places, for restoring (revising rules 6, 8).
export const Tag = Schema.Struct({ name: Schema.NonEmptyString, recipeIds })

export type Tag = typeof Tag.Type

// Recipes in the cook's order.
export const Collection = Schema.Struct({ name: Schema.NonEmptyString, recipeIds })

export type Collection = typeof Collection.Type

export const SmartCollection = Schema.Struct({ name: Schema.NonEmptyString, filter: RecipeFilter })

export type SmartCollection = typeof SmartCollection.Type

// One cook's tags, collections, and smart collections.
export const Library = Schema.Struct({
  tags: Schema.Array(Tag),
  collections: Schema.Array(Collection),
  smartCollections: Schema.Array(SmartCollection),
})

export type Library = typeof Library.Type

// Where a recipe is: in the library or in the trash. A purged recipe is nowhere.
export type RecipePlace = "library" | "trash"
