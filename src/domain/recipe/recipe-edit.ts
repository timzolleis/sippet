import { Schema } from "effect"
import { Amount } from "./amount.ts"
import { Key } from "./key.ts"
import { Duration, ItemName, StepResult, Temperature, Yield } from "./recipe-content.ts"

export const Position = Schema.Union([Schema.Literals(["start", "end"]), Schema.Struct({ after: Key })])
export type Position = typeof Position.Type

const KeyList = Schema.Array(Key)

const addStepFields = {
  key: Key,
  label: Schema.NonEmptyString,
  sentence: Schema.optionalKey(Schema.NonEmptyString),
  section: Schema.optionalKey(Key),
  equipment: Schema.optionalKey(KeyList),
  duration: Schema.optionalKey(Duration),
  temperature: Schema.optionalKey(Temperature),
  uses: Schema.optionalKey(KeyList),
  result: Schema.optionalKey(StepResult),
  // absent or null: derived; []: nothing
  takes: Schema.optionalKey(Schema.NullOr(KeyList)),
  waitsFor: Schema.optionalKey(Schema.NullOr(KeyList)),
  at: Schema.optionalKey(Position),
}

// `null` clears an optional field; an absent field stays as it is.
const editStepFields = {
  key: Key,
  label: Schema.optionalKey(Schema.NonEmptyString),
  sentence: Schema.optionalKey(Schema.NullOr(Schema.NonEmptyString)),
  section: Schema.optionalKey(Schema.NullOr(Key)),
  equipment: Schema.optionalKey(Schema.NullOr(KeyList)),
  duration: Schema.optionalKey(Schema.NullOr(Duration)),
  temperature: Schema.optionalKey(Schema.NullOr(Temperature)),
  uses: Schema.optionalKey(Schema.NullOr(KeyList)),
  result: Schema.optionalKey(Schema.NullOr(StepResult)),
  takes: Schema.optionalKey(Schema.NullOr(KeyList)),
  waitsFor: Schema.optionalKey(Schema.NullOr(KeyList)),
}

export const SetTitleEdit = Schema.Struct({ op: Schema.Literal("set_title"), title: Schema.String })
export type SetTitleEdit = typeof SetTitleEdit.Type
export const SetYieldEdit = Schema.Struct({ op: Schema.Literal("set_yield"), yield: Yield })
export type SetYieldEdit = typeof SetYieldEdit.Type
export const AddSectionEdit = Schema.Struct({
  op: Schema.Literal("add_section"), key: Key, name: Schema.NonEmptyString, at: Schema.optionalKey(Position),
})
export type AddSectionEdit = typeof AddSectionEdit.Type
export const RenameSectionEdit = Schema.Struct({ op: Schema.Literal("rename_section"), key: Key, name: Schema.NonEmptyString })
export type RenameSectionEdit = typeof RenameSectionEdit.Type
export const RemoveSectionEdit = Schema.Struct({ op: Schema.Literal("remove_section"), key: Key })
export type RemoveSectionEdit = typeof RemoveSectionEdit.Type
export const RenameItemEdit = Schema.Struct({ op: Schema.Literal("rename_item"), from: ItemName, to: ItemName })
export type RenameItemEdit = typeof RenameItemEdit.Type
export const AddIngredientEdit = Schema.Struct({
  op: Schema.Literal("add_ingredient"),
  key: Key,
  item: ItemName,
  amount: Schema.optionalKey(Amount),
  section: Schema.optionalKey(Key),
  note: Schema.optionalKey(Schema.String),
  prep: Schema.optionalKey(Schema.NonEmptyString),
  optional: Schema.optionalKey(Schema.Boolean),
  at: Schema.optionalKey(Position),
})
export type AddIngredientEdit = typeof AddIngredientEdit.Type
export const EditIngredientEdit = Schema.Struct({
  op: Schema.Literal("edit_ingredient"),
  key: Key,
  item: Schema.optionalKey(ItemName),
  amount: Schema.optionalKey(Schema.NullOr(Amount)),
  section: Schema.optionalKey(Schema.NullOr(Key)),
  note: Schema.optionalKey(Schema.NullOr(Schema.String)),
  prep: Schema.optionalKey(Schema.NullOr(Schema.NonEmptyString)),
  optional: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
})
export type EditIngredientEdit = typeof EditIngredientEdit.Type
export const MoveIngredientEdit = Schema.Struct({
  op: Schema.Literal("move_ingredient"), key: Key, at: Position, section: Schema.optionalKey(Schema.NullOr(Key)),
})
export type MoveIngredientEdit = typeof MoveIngredientEdit.Type
export const RemoveIngredientEdit = Schema.Struct({ op: Schema.Literal("remove_ingredient"), key: Key })
export type RemoveIngredientEdit = typeof RemoveIngredientEdit.Type
export const AddEquipmentEdit = Schema.Struct({ op: Schema.Literal("add_equipment"), key: Key, name: Schema.NonEmptyString })
export type AddEquipmentEdit = typeof AddEquipmentEdit.Type
export const EditEquipmentEdit = Schema.Struct({ op: Schema.Literal("edit_equipment"), key: Key, name: Schema.NonEmptyString })
export type EditEquipmentEdit = typeof EditEquipmentEdit.Type
export const RemoveEquipmentEdit = Schema.Struct({ op: Schema.Literal("remove_equipment"), key: Key })
export type RemoveEquipmentEdit = typeof RemoveEquipmentEdit.Type
export const AddStepEdit = Schema.Struct({ op: Schema.Literal("add_step"), ...addStepFields })
export type AddStepEdit = typeof AddStepEdit.Type
export const EditStepEdit = Schema.Struct({ op: Schema.Literal("edit_step"), ...editStepFields })
export type EditStepEdit = typeof EditStepEdit.Type
export const MoveStepEdit = Schema.Struct({
  op: Schema.Literal("move_step"), key: Key, at: Position, section: Schema.optionalKey(Schema.NullOr(Key)),
})
export type MoveStepEdit = typeof MoveStepEdit.Type
export const RemoveStepEdit = Schema.Struct({ op: Schema.Literal("remove_step"), key: Key })

// One intent in a revision (revising-recipes Edits, specs/mcp.md Recipe edits).
export type RemoveStepEdit = typeof RemoveStepEdit.Type
export const RecipeEdit = Schema.Union([
  SetTitleEdit, SetYieldEdit,
  AddSectionEdit, RenameSectionEdit, RemoveSectionEdit,
  RenameItemEdit,
  AddIngredientEdit, EditIngredientEdit, MoveIngredientEdit, RemoveIngredientEdit,
  AddEquipmentEdit, EditEquipmentEdit, RemoveEquipmentEdit,
  AddStepEdit, EditStepEdit, MoveStepEdit, RemoveStepEdit,
])
export type RecipeEdit = typeof RecipeEdit.Type
