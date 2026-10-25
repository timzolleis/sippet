import { Schema } from "effect"
import { RecipeId } from "../recipe/recipe-id.ts"
import { RecipeFilter } from "./recipe-filter.ts"

const Name = Schema.NonEmptyString
const RecipeIds = Schema.Array(RecipeId)

export const TagEdit = Schema.Struct({ op: Schema.Literal("tag"), tag: Name, recipeIds: RecipeIds })
export type TagEdit = typeof TagEdit.Type
export const UntagEdit = Schema.Struct({ op: Schema.Literal("untag"), tag: Name, recipeIds: RecipeIds })
export type UntagEdit = typeof UntagEdit.Type
export const RenameTagEdit = Schema.Struct({ op: Schema.Literal("rename_tag"), tag: Name, to: Name })
export type RenameTagEdit = typeof RenameTagEdit.Type
export const MergeTagsEdit = Schema.Struct({ op: Schema.Literal("merge_tags"), tag: Name, into: Name })
export type MergeTagsEdit = typeof MergeTagsEdit.Type
export const DeleteTagEdit = Schema.Struct({ op: Schema.Literal("delete_tag"), tag: Name })
export type DeleteTagEdit = typeof DeleteTagEdit.Type
export const CreateCollectionEdit = Schema.Struct({
  op: Schema.Literal("create_collection"), name: Name, recipeIds: Schema.optionalKey(RecipeIds),
})
export type CreateCollectionEdit = typeof CreateCollectionEdit.Type
export const AddToCollectionEdit = Schema.Struct({ op: Schema.Literal("add_to_collection"), collection: Name, recipeIds: RecipeIds })
export type AddToCollectionEdit = typeof AddToCollectionEdit.Type
export const RemoveFromCollectionEdit = Schema.Struct({
  op: Schema.Literal("remove_from_collection"), collection: Name, recipeIds: RecipeIds,
})
export type RemoveFromCollectionEdit = typeof RemoveFromCollectionEdit.Type
// recipeIds is the full new order (library rule 11)
export const ReorderCollectionEdit = Schema.Struct({ op: Schema.Literal("reorder_collection"), collection: Name, recipeIds: RecipeIds })
export type ReorderCollectionEdit = typeof ReorderCollectionEdit.Type
export const RenameCollectionEdit = Schema.Struct({ op: Schema.Literal("rename_collection"), collection: Name, to: Name })
export type RenameCollectionEdit = typeof RenameCollectionEdit.Type
export const DeleteCollectionEdit = Schema.Struct({ op: Schema.Literal("delete_collection"), collection: Name })
export type DeleteCollectionEdit = typeof DeleteCollectionEdit.Type
export const SaveSmartCollectionEdit = Schema.Struct({
  op: Schema.Literal("save_smart_collection"), name: Name, newName: Schema.optionalKey(Name), filter: RecipeFilter,
})
export type SaveSmartCollectionEdit = typeof SaveSmartCollectionEdit.Type
export const DeleteSmartCollectionEdit = Schema.Struct({ op: Schema.Literal("delete_smart_collection"), name: Name })

export type DeleteSmartCollectionEdit = typeof DeleteSmartCollectionEdit.Type
// One intent in a library change (library Edits, specs/mcp.md Library edits).
export const LibraryEdit = Schema.Union([
  TagEdit, UntagEdit, RenameTagEdit, MergeTagsEdit, DeleteTagEdit,
  CreateCollectionEdit, AddToCollectionEdit, RemoveFromCollectionEdit, ReorderCollectionEdit, RenameCollectionEdit, DeleteCollectionEdit,
  SaveSmartCollectionEdit, DeleteSmartCollectionEdit,
])
export type LibraryEdit = typeof LibraryEdit.Type
