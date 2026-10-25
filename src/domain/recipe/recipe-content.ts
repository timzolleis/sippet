import { Schema } from "effect"
import { Amount } from "./amount.ts"
import { Key } from "./key.ts"

const NonNegativeNumber = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

// The yield, optionally in a vessel from the equipment: "12 Stück", Springform 26 cm (recipe rule 9).
export const Yield = Schema.Struct({
  amount: Amount,
  vessel: Schema.optionalKey(Key).pipe(Schema.annotateKey({ description: "Equipment key of the form it's made in." })),
}).annotate({ identifier: "Yield", description: "What the recipe makes: 12 piece, optionally in a vessel." })

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
  minutes: NonNegativeNumber.pipe(Schema.annotateKey({ description: "Minutes; for a range, the low end." })),
  maxMinutes: Schema.optionalKey(NonNegativeNumber).pipe(Schema.annotateKey({ description: "A range's high end: 60–65 min." })),
  kind: Schema.Literals(["active", "passive"]).pipe(Schema.annotateKey({ description: "active: hands-on; passive: waiting (baking, resting)." })),
}).annotate({ identifier: "Duration", description: "Omit when the source gives no length (über Nacht, vollständig auskühlen)." })

export type Duration = typeof Duration.Type

export const HeatingMode = Schema.Literals(["top_bottom", "fan", "top", "bottom", "grill"])

export type HeatingMode = typeof HeatingMode.Type

export const Temperature = Schema.Struct({
  celsius: Schema.Finite.pipe(Schema.annotateKey({ description: "°C; for a range, the low end." })),
  maxCelsius: Schema.optionalKey(Schema.Finite).pipe(Schema.annotateKey({ description: "A range's high end." })),
  mode: Schema.optionalKey(HeatingMode).pipe(Schema.annotateKey({ description: "top_bottom: Ober-/Unterhitze, fan: Umluft, top: Oberhitze, bottom: Unterhitze." })),
}).annotate({ identifier: "Temperature", description: "Oven or pan heat, in °C." })

export type Temperature = typeof Temperature.Type

// A named part of a result after a split; at most one is "the rest" (recipe rule 16).
export const Portion = Schema.Struct({
  key: Key,
  name: Schema.NonEmptyString.pipe(Schema.annotateKey({ description: "What the portion is for: Boden." })),
  amount: Schema.optionalKey(Amount).pipe(Schema.annotateKey({ description: "Required, except on the rest." })),
  rest: Schema.optionalKey(Schema.Literal(true)).pipe(Schema.annotateKey({ description: "true: whatever is left (den Rest). At most one portion." })),
}).annotate({ identifier: "Portion", description: "A part of a split result. A later step names its key in takes." })

export type Portion = typeof Portion.Type

export const StepResult = Schema.Struct({
  name: Schema.optionalKey(Schema.NonEmptyString).pipe(Schema.annotateKey({ description: "What it's called: Teig, Füllung." })),
  amount: Schema.optionalKey(Amount),
  split: Schema.optionalKey(Schema.Array(Portion)).pipe(Schema.annotateKey({
    description: "Portions for different steps (500 g Boden, the rest for Zupfen); later steps take the portions, not this step.",
  })),
}).annotate({
  identifier: "StepResult",
  description: "Names what the step makes. A step that uses or takes something makes a result anyway; one later step takes it by the step's key.",
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
