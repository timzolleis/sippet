import { Schema } from "effect"
import { Amount } from "./amount.ts"
import { Key } from "./key.ts"
import { Duration, ItemName, StepResult, Temperature, Yield } from "./recipe-content.ts"

// The descriptions reach the tools' JSON Schema (specs/mcp.md Recipe edits): they are how Claude learns the edits.

export const Position = Schema.Union([Schema.Literals(["start", "end"]), Schema.Struct({ after: Key })]).annotate({
  identifier: "Position",
  description: "Where in its list: \"start\", \"end\" (the default), or {after: key}.",
})

export type Position = typeof Position.Type

const Keys = Schema.Array(Key)

const addStepFields = {
  key: Key,
  label: Schema.NonEmptyString.pipe(Schema.annotateKey({ description: "Short, for the table: verkneten." })),
  sentence: Schema.optionalKey(Schema.NonEmptyString).pipe(Schema.annotateKey({
    description: "The full instruction as the source has it; else built from label, uses, and takes.",
  })),
  section: Schema.optionalKey(Key).pipe(Schema.annotateKey({ description: "Section key. Without one, the step joins the sections before it." })),
  equipment: Schema.optionalKey(Keys).pipe(Schema.annotateKey({ description: "Equipment keys." })),
  duration: Schema.optionalKey(Duration),
  temperature: Schema.optionalKey(Temperature),
  uses: Schema.optionalKey(Keys).pipe(Schema.annotateKey({
    description: "Ingredient keys this step adds, each ingredient in exactly one step. Never step or portion keys (those go in takes).",
  })),
  result: Schema.optionalKey(StepResult),
  takes: Schema.optionalKey(Schema.NullOr(Keys)).pipe(Schema.annotateKey({
    description: "Earlier results (step keys) or portions this step works on; never ingredients (those go in uses). " +
      "Omitted or null: derived. []: none, e.g. a fresh bowl. A list replaces the derived links.",
  })),
  waitsFor: Schema.optionalKey(Schema.NullOr(Keys)).pipe(Schema.annotateKey({
    description: "Steps it waits for without taking their result (backen waits for vorheizen). Omitted or null: derived. []: none.",
  })),
  at: Schema.optionalKey(Position),
}

// `null` clears an optional field; an absent field stays as it is.
const editStepFields = {
  key: Key,
  label: Schema.optionalKey(Schema.NonEmptyString),
  sentence: Schema.optionalKey(Schema.NullOr(Schema.NonEmptyString)),
  section: Schema.optionalKey(Schema.NullOr(Key)),
  equipment: Schema.optionalKey(Schema.NullOr(Keys)),
  duration: Schema.optionalKey(Schema.NullOr(Duration)),
  temperature: Schema.optionalKey(Schema.NullOr(Temperature)),
  uses: Schema.optionalKey(Schema.NullOr(Keys)),
  result: Schema.optionalKey(Schema.NullOr(StepResult)),
  takes: Schema.optionalKey(Schema.NullOr(Keys)).pipe(Schema.annotateKey({ description: "null: back to the derived links. []: nothing." })),
  waitsFor: Schema.optionalKey(Schema.NullOr(Keys)).pipe(Schema.annotateKey({ description: "null: back to the derived links. []: none." })),
}

export const SetTitleEdit = Schema.Struct({ op: Schema.Literal("set_title"), title: Schema.String })

export type SetTitleEdit = typeof SetTitleEdit.Type

export const SetYieldEdit = Schema.Struct({ op: Schema.Literal("set_yield"), yield: Yield })

export type SetYieldEdit = typeof SetYieldEdit.Type

export const AddSectionEdit = Schema.Struct({
  op: Schema.Literal("add_section"),
  key: Key,
  name: Schema.NonEmptyString.pipe(Schema.annotateKey({ description: "As the source names it: Teig." })),
  at: Schema.optionalKey(Position),
}).annotate({ description: "A part made on its own (Teig, Füllung): its steps chain only within it." })

export type AddSectionEdit = typeof AddSectionEdit.Type

export const RenameSectionEdit = Schema.Struct({ op: Schema.Literal("rename_section"), key: Key, name: Schema.NonEmptyString })

export type RenameSectionEdit = typeof RenameSectionEdit.Type

export const RemoveSectionEdit = Schema.Struct({ op: Schema.Literal("remove_section"), key: Key })
  .annotate({ description: "Its ingredients and steps stay, without a section." })

export type RemoveSectionEdit = typeof RemoveSectionEdit.Type

export const RenameItemEdit = Schema.Struct({ op: Schema.Literal("rename_item"), from: ItemName, to: ItemName })
  .annotate({ description: "Renames an item in every ingredient; to an existing name, they join that item." })

export type RenameItemEdit = typeof RenameItemEdit.Type

export const AddIngredientEdit = Schema.Struct({
  op: Schema.Literal("add_ingredient"),
  key: Key,
  item: ItemName.pipe(Schema.annotateKey({
    description: "What you buy, in the recipe's language. Ingredients with the same item name (ignoring case) share the item.",
  })),
  amount: Schema.optionalKey(Amount),
  section: Schema.optionalKey(Key).pipe(Schema.annotateKey({ description: "Section key." })),
  note: Schema.optionalKey(Schema.String).pipe(Schema.annotateKey({ description: "Words beside the amount: vegan, nach Geschmack." })),
  prep: Schema.optionalKey(Schema.NonEmptyString).pipe(Schema.annotateKey({
    description: "One verb done to this ingredient alone before its step (auspressen, schmelzen), instead of a step.",
  })),
  optional: Schema.optionalKey(Schema.Boolean).pipe(Schema.annotateKey({ description: "true: the recipe works without it." })),
  at: Schema.optionalKey(Position),
}).annotate({ description: "One line of the ingredient list. An item used in two steps is two ingredients." })

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
}).annotate({ description: "Changes the fields given, as in add_ingredient; null clears one." })

export type EditIngredientEdit = typeof EditIngredientEdit.Type

export const MoveIngredientEdit = Schema.Struct({
  op: Schema.Literal("move_ingredient"),
  key: Key,
  at: Position,
  section: Schema.optionalKey(Schema.NullOr(Key)).pipe(Schema.annotateKey({ description: "Into this section; null: out of any." })),
})

export type MoveIngredientEdit = typeof MoveIngredientEdit.Type

export const RemoveIngredientEdit = Schema.Struct({ op: Schema.Literal("remove_ingredient"), key: Key })

export type RemoveIngredientEdit = typeof RemoveIngredientEdit.Type

export const AddEquipmentEdit = Schema.Struct({
  op: Schema.Literal("add_equipment"),
  key: Key,
  name: Schema.NonEmptyString.pipe(Schema.annotateKey({ description: "As the source names it: Springform 26 cm." })),
}).annotate({ description: "A tool or appliance steps use, or the yield's vessel." })

export type AddEquipmentEdit = typeof AddEquipmentEdit.Type

export const EditEquipmentEdit = Schema.Struct({ op: Schema.Literal("edit_equipment"), key: Key, name: Schema.NonEmptyString })

export type EditEquipmentEdit = typeof EditEquipmentEdit.Type

export const RemoveEquipmentEdit = Schema.Struct({ op: Schema.Literal("remove_equipment"), key: Key })

export type RemoveEquipmentEdit = typeof RemoveEquipmentEdit.Type

export const AddStepEdit = Schema.Struct({ op: Schema.Literal("add_step"), ...addStepFields })
  .annotate({ description: "One instruction, in the source's order." })

export type AddStepEdit = typeof AddStepEdit.Type

export const EditStepEdit = Schema.Struct({ op: Schema.Literal("edit_step"), ...editStepFields })
  .annotate({ description: "Changes the fields given, as in add_step (all but at); null clears one." })

export type EditStepEdit = typeof EditStepEdit.Type

export const MoveStepEdit = Schema.Struct({
  op: Schema.Literal("move_step"),
  key: Key,
  at: Position,
  section: Schema.optionalKey(Schema.NullOr(Key)).pipe(Schema.annotateKey({ description: "Into this section; null: out of any." })),
})

export type MoveStepEdit = typeof MoveStepEdit.Type

export const RemoveStepEdit = Schema.Struct({ op: Schema.Literal("remove_step"), key: Key })

export type RemoveStepEdit = typeof RemoveStepEdit.Type

const contentEdits = [
  AddSectionEdit, RenameSectionEdit, RemoveSectionEdit,
  RenameItemEdit,
  AddIngredientEdit, EditIngredientEdit, MoveIngredientEdit, RemoveIngredientEdit,
  AddEquipmentEdit, EditEquipmentEdit, RemoveEquipmentEdit,
  AddStepEdit, EditStepEdit, MoveStepEdit, RemoveStepEdit,
] as const

// What a new recipe's batch accepts: only adding, since an empty recipe has nothing to change or remove,
// and its title and yield come beside the batch (adding rule 1).
export const NewRecipeEdit = Schema.Union([AddSectionEdit, AddIngredientEdit, AddEquipmentEdit, AddStepEdit])

export type NewRecipeEdit = typeof NewRecipeEdit.Type

// One intent in a revision (revising-recipes Edits, specs/mcp.md Recipe edits).
export const RecipeEdit = Schema.Union([SetTitleEdit, SetYieldEdit, ...contentEdits])

export type RecipeEdit = typeof RecipeEdit.Type
