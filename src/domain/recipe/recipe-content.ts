import { Schema } from "effect"
import { Amount } from "./amount.ts"
import { Key } from "./key.ts"

const NonNegativeNumber = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

// The yield, optionally in a vessel from the equipment: "12 Stück", Springform 26 cm (recipe rule 9).
export const Yield = Schema.Struct({ amount: Amount, vessel: Schema.optionalKey(Key) })

export type Yield = typeof Yield.Type

export const Section = Schema.Struct({ key: Key, name: Schema.NonEmptyString })

export type Section = typeof Section.Type

export const Equipment = Schema.Struct({ key: Key, name: Schema.NonEmptyString })

export type Equipment = typeof Equipment.Type

// What you buy; ingredients refer to it by name, unique ignoring case (recipe rule 3).
export const ItemName = Schema.NonEmptyString

export type ItemName = typeof ItemName.Type

export const Ingredient = Schema.Struct({
  key: Key,
  item: ItemName,
  amount: Schema.optionalKey(Amount),
  section: Schema.optionalKey(Key),
  note: Schema.optionalKey(Schema.String),
  prep: Schema.optionalKey(Schema.NonEmptyString),
  optional: Schema.optionalKey(Schema.Boolean),
})

export type Ingredient = typeof Ingredient.Type

export const Duration = Schema.Struct({
  minutes: NonNegativeNumber,
  maxMinutes: Schema.optionalKey(NonNegativeNumber),
  kind: Schema.Literals(["active", "passive"]),
})

export type Duration = typeof Duration.Type

export const HeatingMode = Schema.Literals(["top_bottom", "fan", "top", "bottom", "grill"])

export type HeatingMode = typeof HeatingMode.Type

export const Temperature = Schema.Struct({
  celsius: Schema.Finite,
  maxCelsius: Schema.optionalKey(Schema.Finite),
  mode: Schema.optionalKey(HeatingMode),
})

export type Temperature = typeof Temperature.Type

// A named part of a result after a split; at most one is "the rest" (recipe rule 16).
export const Portion = Schema.Struct({
  key: Key,
  name: Schema.NonEmptyString,
  amount: Schema.optionalKey(Amount),
  rest: Schema.optionalKey(Schema.Literal(true)),
})

export type Portion = typeof Portion.Type

export const StepResult = Schema.Struct({
  name: Schema.optionalKey(Schema.NonEmptyString),
  amount: Schema.optionalKey(Amount),
  split: Schema.optionalKey(Schema.Array(Portion)),
})

export type StepResult = typeof StepResult.Type

// `takes` and `waitsFor` replace the derived links when present (recipe rule 11).
export const Step = Schema.Struct({
  key: Key,
  label: Schema.NonEmptyString,
  sentence: Schema.optionalKey(Schema.NonEmptyString),
  section: Schema.optionalKey(Key),
  equipment: Schema.optionalKey(Schema.Array(Key)),
  duration: Schema.optionalKey(Duration),
  temperature: Schema.optionalKey(Temperature),
  uses: Schema.optionalKey(Schema.Array(Key)),
  result: Schema.optionalKey(StepResult),
  takes: Schema.optionalKey(Schema.Array(Key)),
  waitsFor: Schema.optionalKey(Schema.Array(Key)),
})

export type Step = typeof Step.Type

// The content of one revision, as written.
export const RecipeContent = Schema.Struct({
  title: Schema.String,
  yield: Yield,
  sections: Schema.Array(Section),
  equipment: Schema.Array(Equipment),
  ingredients: Schema.Array(Ingredient),
  steps: Schema.Array(Step),
})

export type RecipeContent = typeof RecipeContent.Type

// What add_recipe applies its edits to (adding rule 1).
export const emptyRecipeContent = ({ title, yield: recipeYield }: { readonly title: string; readonly yield: Yield }): RecipeContent => ({
  title,
  yield: recipeYield,
  sections: [],
  equipment: [],
  ingredients: [],
  steps: [],
})

// A split with no portions is no split.
export const portionsOfStep = (step: Step): ReadonlyArray<Portion> => step.result?.split ?? []
export const isStepResultSplit = (step: Step): boolean => portionsOfStep(step).length > 0
