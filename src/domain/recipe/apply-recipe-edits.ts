import { Match, Result } from "effect"
import type { Key } from "./key.ts"
import {
  portionsOfStep,
  type Equipment,
  type Ingredient,
  type ItemName,
  type RecipeContent,
  type Section,
  type Step,
} from "./recipe-content.ts"
import type {
  AddIngredientEdit,
  AddStepEdit,
  EditIngredientEdit,
  EditStepEdit,
  MoveIngredientEdit,
  MoveStepEdit,
  Position,
  RecipeEdit,
  RenameItemEdit,
} from "./recipe-edit.ts"
import type { RecipeProblem } from "./recipe-problem.ts"

type Keyed = { readonly key: Key }
type Mutable<T> = { -readonly [K in keyof T]: T[K] }
type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T]

// `null` clears the field, `undefined` keeps it (specs/mcp.md: edit_* changes only the fields it names).
const patchOptionalField = <T, K extends OptionalKeys<T>>(target: Mutable<T>, key: K, value: T[K] | null | undefined): void => {
  if (value === null) delete target[key]
  else if (value !== undefined) target[key] = value
}

// Every key in the recipe, portions included (recipe rule 20).
export const keysOfContent = (content: RecipeContent): ReadonlyArray<Key> => [
  ...content.sections.map((section) => section.key),
  ...content.equipment.map((equipment) => equipment.key),
  ...content.ingredients.map((ingredient) => ingredient.key),
  ...content.steps.map((step) => step.key),
  ...content.steps.flatMap((step) => portionsOfStep(step).map((portion) => portion.key)),
]

const isSameItemName = (a: ItemName, b: ItemName) => a.toLowerCase() === b.toLowerCase()

// A name an item already has, ignoring case, joins that item (recipe rule 3).
const itemNameInContent = ({ ingredients, name }: { readonly ingredients: ReadonlyArray<Ingredient>; readonly name: ItemName }): ItemName =>
  ingredients.find((ingredient) => isSameItemName(ingredient.item, name))?.item ?? name

const requireFreeKey = ({ content, key }: { readonly content: RecipeContent; readonly key: Key }): Result.Result<void, string> =>
  keysOfContent(content).includes(key) ? Result.fail(`key "${key}" is already used`) : Result.succeed(undefined)

const findByKey = <T extends Keyed>({ list, key, kind }: { readonly list: ReadonlyArray<T>; readonly key: Key; readonly kind: string }): Result.Result<T, string> => {
  const found = list.find((entry) => entry.key === key)
  return found === undefined ? Result.fail(`no ${kind} "${key}"`) : Result.succeed(found)
}

const insertAtPosition = <T extends Keyed>({ list, value, at, kind }: {
  readonly list: ReadonlyArray<T>
  readonly value: T
  readonly at: Position | undefined
  readonly kind: string
}): Result.Result<ReadonlyArray<T>, string> => {
  if (at === undefined || at === "end") return Result.succeed([...list, value])
  if (at === "start") return Result.succeed([value, ...list])
  const index = list.findIndex((entry) => entry.key === at.after)
  return index < 0
    ? Result.fail(`no ${kind} "${at.after}" to put "${value.key}" after`)
    : Result.succeed([...list.slice(0, index + 1), value, ...list.slice(index + 1)])
}

const replaceByKey = <T extends Keyed>(list: ReadonlyArray<T>, value: T): ReadonlyArray<T> =>
  list.map((entry) => entry.key === value.key ? value : entry)

const withoutKey = <T extends Keyed>(list: ReadonlyArray<T>, key: Key): ReadonlyArray<T> => list.filter((entry) => entry.key !== key)

const ingredientWithoutSection = (ingredient: Ingredient, sectionKey: Key): Ingredient => {
  const edited: Mutable<Ingredient> = { ...ingredient }
  if (edited.section === sectionKey) delete edited.section
  return edited
}

const stepWithoutSection = (step: Step, sectionKey: Key): Step => {
  const edited: Mutable<Step> = { ...step }
  if (edited.section === sectionKey) delete edited.section
  return edited
}

const addSection = ({ content, key, name, at }: {
  readonly content: RecipeContent; readonly key: Key; readonly name: string; readonly at: Position | undefined
}) => Result.gen(function* () {
  yield* requireFreeKey({ content, key })
  const sections = yield* insertAtPosition<Section>({ list: content.sections, value: { key, name }, at, kind: "section" })
  return { ...content, sections }
})

const renameSection = ({ content, key, name }: { readonly content: RecipeContent; readonly key: Key; readonly name: string }) =>
  Result.map(findByKey({ list: content.sections, key, kind: "section" }), (section) => ({
    ...content, sections: replaceByKey(content.sections, { ...section, name }),
  }))

// Its ingredients and steps stay, without a section.
const removeSection = ({ content, key }: { readonly content: RecipeContent; readonly key: Key }) =>
  Result.map(findByKey({ list: content.sections, key, kind: "section" }), () => ({
    ...content,
    sections: withoutKey(content.sections, key),
    ingredients: content.ingredients.map((ingredient) => ingredientWithoutSection(ingredient, key)),
    steps: content.steps.map((step) => stepWithoutSection(step, key)),
  }))

// Every ingredient follows; to an existing name, the ingredients join that item.
const renameItem = ({ content, edit }: { readonly content: RecipeContent; readonly edit: RenameItemEdit }): Result.Result<RecipeContent, string> => {
  if (!content.ingredients.some((ingredient) => isSameItemName(ingredient.item, edit.from))) {
    return Result.fail(`no item "${edit.from}"`)
  }
  const otherIngredients = content.ingredients.filter((ingredient) => !isSameItemName(ingredient.item, edit.from))
  const item = itemNameInContent({ ingredients: otherIngredients, name: edit.to })
  return Result.succeed({
    ...content,
    ingredients: content.ingredients.map((ingredient) => isSameItemName(ingredient.item, edit.from) ? { ...ingredient, item } : ingredient),
  })
}

const addIngredient = ({ content, edit }: { readonly content: RecipeContent; readonly edit: AddIngredientEdit }) => Result.gen(function* () {
  yield* requireFreeKey({ content, key: edit.key })
  const ingredient: Mutable<Ingredient> = { key: edit.key, item: itemNameInContent({ ingredients: content.ingredients, name: edit.item }) }
  patchOptionalField(ingredient, "amount", edit.amount)
  patchOptionalField(ingredient, "section", edit.section)
  patchOptionalField(ingredient, "note", edit.note)
  patchOptionalField(ingredient, "prep", edit.prep)
  patchOptionalField(ingredient, "optional", edit.optional === true ? true : undefined)
  const ingredients = yield* insertAtPosition<Ingredient>({ list: content.ingredients, value: ingredient, at: edit.at, kind: "ingredient" })
  return { ...content, ingredients }
})

const editIngredient = ({ content, edit }: { readonly content: RecipeContent; readonly edit: EditIngredientEdit }) =>
  Result.map(findByKey({ list: content.ingredients, key: edit.key, kind: "ingredient" }), (current) => {
    const ingredient: Mutable<Ingredient> = { ...current }
    if (edit.item !== undefined) {
      const otherIngredients = content.ingredients.filter((other) => other.key !== edit.key)
      ingredient.item = itemNameInContent({ ingredients: otherIngredients, name: edit.item })
    }
    patchOptionalField(ingredient, "amount", edit.amount)
    patchOptionalField(ingredient, "section", edit.section)
    patchOptionalField(ingredient, "note", edit.note)
    patchOptionalField(ingredient, "prep", edit.prep)
    patchOptionalField(ingredient, "optional", edit.optional === false ? null : edit.optional)
    return { ...content, ingredients: replaceByKey(content.ingredients, ingredient) }
  })

const moveIngredient = ({ content, edit }: { readonly content: RecipeContent; readonly edit: MoveIngredientEdit }) => Result.gen(function* () {
  const current = yield* findByKey({ list: content.ingredients, key: edit.key, kind: "ingredient" })
  const ingredient: Mutable<Ingredient> = { ...current }
  patchOptionalField(ingredient, "section", edit.section)
  const ingredients = yield* insertAtPosition<Ingredient>({
    list: withoutKey(content.ingredients, edit.key), value: ingredient, at: edit.at, kind: "other ingredient",
  })
  return { ...content, ingredients }
})

const removeIngredient = ({ content, key }: { readonly content: RecipeContent; readonly key: Key }) =>
  Result.map(findByKey({ list: content.ingredients, key, kind: "ingredient" }), () => ({
    ...content, ingredients: withoutKey(content.ingredients, key),
  }))

const addEquipment = ({ content, key, name }: { readonly content: RecipeContent; readonly key: Key; readonly name: string }) =>
  Result.map(requireFreeKey({ content, key }), () => ({ ...content, equipment: [...content.equipment, { key, name }] }))

const editEquipment = ({ content, key, name }: { readonly content: RecipeContent; readonly key: Key; readonly name: string }) =>
  Result.map(findByKey({ list: content.equipment, key, kind: "equipment" }), (equipment) => ({
    ...content, equipment: replaceByKey<Equipment>(content.equipment, { ...equipment, name }),
  }))

// Steps or the yield that still name it are refused at the end (recipe rule 12).
const removeEquipment = ({ content, key }: { readonly content: RecipeContent; readonly key: Key }) =>
  Result.map(findByKey({ list: content.equipment, key, kind: "equipment" }), () => ({
    ...content, equipment: withoutKey(content.equipment, key),
  }))

const patchStepFields = (step: Mutable<Step>, edit: Omit<EditStepEdit, "op" | "key" | "label">): void => {
  patchOptionalField(step, "sentence", edit.sentence)
  patchOptionalField(step, "section", edit.section)
  patchOptionalField(step, "equipment", edit.equipment)
  patchOptionalField(step, "duration", edit.duration)
  patchOptionalField(step, "temperature", edit.temperature)
  patchOptionalField(step, "uses", edit.uses)
  patchOptionalField(step, "result", edit.result)
  patchOptionalField(step, "takes", edit.takes)
  patchOptionalField(step, "waitsFor", edit.waitsFor)
}

const addStep = ({ content, edit }: { readonly content: RecipeContent; readonly edit: AddStepEdit }) => Result.gen(function* () {
  yield* requireFreeKey({ content, key: edit.key })
  const step: Mutable<Step> = { key: edit.key, label: edit.label }
  patchStepFields(step, edit)
  const steps = yield* insertAtPosition<Step>({ list: content.steps, value: step, at: edit.at, kind: "step" })
  return { ...content, steps }
})

const editStep = ({ content, edit }: { readonly content: RecipeContent; readonly edit: EditStepEdit }) =>
  Result.map(findByKey({ list: content.steps, key: edit.key, kind: "step" }), (current) => {
    const step: Mutable<Step> = { ...current, label: edit.label ?? current.label }
    patchStepFields(step, edit)
    return { ...content, steps: replaceByKey(content.steps, step) }
  })

const moveStep = ({ content, edit }: { readonly content: RecipeContent; readonly edit: MoveStepEdit }) => Result.gen(function* () {
  const current = yield* findByKey({ list: content.steps, key: edit.key, kind: "step" })
  const step: Mutable<Step> = { ...current }
  patchOptionalField(step, "section", edit.section)
  const steps = yield* insertAtPosition<Step>({ list: withoutKey(content.steps, edit.key), value: step, at: edit.at, kind: "other step" })
  return { ...content, steps }
})

// Steps that still take from it or wait for it are refused at the end (recipe rule 12).
const removeStep = ({ content, key }: { readonly content: RecipeContent; readonly key: Key }) =>
  Result.map(findByKey({ list: content.steps, key, kind: "step" }), () => ({ ...content, steps: withoutKey(content.steps, key) }))

const applyRecipeEdit = ({ content, edit }: { readonly content: RecipeContent; readonly edit: RecipeEdit }): Result.Result<RecipeContent, string> =>
  Match.value(edit).pipe(Match.discriminatorsExhaustive("op")({
    set_title: ({ title }) => Result.succeed({ ...content, title }),
    set_yield: (setYield) => Result.succeed({ ...content, yield: setYield.yield }),
    add_section: ({ key, name, at }) => addSection({ content, key, name, at }),
    rename_section: ({ key, name }) => renameSection({ content, key, name }),
    remove_section: ({ key }) => removeSection({ content, key }),
    rename_item: (renameItemEdit) => renameItem({ content, edit: renameItemEdit }),
    add_ingredient: (addIngredientEdit) => addIngredient({ content, edit: addIngredientEdit }),
    edit_ingredient: (editIngredientEdit) => editIngredient({ content, edit: editIngredientEdit }),
    move_ingredient: (moveIngredientEdit) => moveIngredient({ content, edit: moveIngredientEdit }),
    remove_ingredient: ({ key }) => removeIngredient({ content, key }),
    add_equipment: ({ key, name }) => addEquipment({ content, key, name }),
    edit_equipment: ({ key, name }) => editEquipment({ content, key, name }),
    remove_equipment: ({ key }) => removeEquipment({ content, key }),
    add_step: (addStepEdit) => addStep({ content, edit: addStepEdit }),
    edit_step: (editStepEdit) => editStep({ content, edit: editStepEdit }),
    move_step: (moveStepEdit) => moveStep({ content, edit: moveStepEdit }),
    remove_step: ({ key }) => removeStep({ content, key }),
  }))

/**
 * Applies a batch in order (revising rule 1). An edit that can't apply is a problem naming it and is skipped;
 * the rest still apply, so the recipe rules report on what the batch meant.
 */
export const applyRecipeEdits = ({ content, edits }: {
  readonly content: RecipeContent
  readonly edits: ReadonlyArray<RecipeEdit>
}): { readonly content: RecipeContent; readonly problems: ReadonlyArray<RecipeProblem> } =>
  edits.reduce<{ content: RecipeContent; problems: ReadonlyArray<RecipeProblem> }>(
    (applied, edit, index) => Result.match(applyRecipeEdit({ content: applied.content, edit }), {
      onSuccess: (editedContent) => ({ content: editedContent, problems: applied.problems }),
      onFailure: (message) => ({ content: applied.content, problems: [...applied.problems, { edit: index + 1, message }] }),
    }),
    { content, problems: [] },
  )
