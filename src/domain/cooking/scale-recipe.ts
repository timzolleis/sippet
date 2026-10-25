import type { Amount, SecondAmount } from "../recipe/amount.ts"
import type { Portion, RecipeContent, Step, StepResult } from "../recipe/recipe-content.ts"
import { measurableAmount } from "./measurable-amount.ts"
import { withOptional } from "../with-optional.ts"

const scaledSecondAmount = ({ amount, factor }: { readonly amount: SecondAmount; readonly factor: number }): SecondAmount =>   withOptional({ ...amount, value: amount.value * factor }, "max", amount.max === undefined ? undefined : amount.max * factor)

export const scaledAmount = ({ amount, factor }: { readonly amount: Amount; readonly factor: number }): Amount =>
  measurableAmount(
    withOptional(
      scaledSecondAmount({ amount, factor }),
      "second",
      amount.second === undefined ? undefined : scaledSecondAmount({ amount: amount.second, factor }),
    ),
  )

const scaledPortion = ({ portion, factor }: { readonly portion: Portion; readonly factor: number }): Portion =>
  portion.amount === undefined ? portion : { ...portion, amount: scaledAmount({ amount: portion.amount, factor }) }

const scaledResult = ({ result, factor }: { readonly result: StepResult; readonly factor: number }): StepResult =>
  withOptional(
    withOptional({ ...result }, "amount", result.amount === undefined ? undefined : scaledAmount({ amount: result.amount, factor })),
    "split",
    result.split === undefined ? undefined : result.split.map((portion) => scaledPortion({ portion, factor })),
  )

const scaledStep = ({ step, factor }: { readonly step: Step; readonly factor: number }): Step =>
  step.result === undefined ? step : { ...step, result: scaledResult({ result: step.result, factor }) }

/**
 * The recipe for another yield: ingredient amounts, results, and portions scale by the same factor and are rounded
 * to what a cook can measure. Durations, temperatures, and equipment don't (cooking rules 6, 7).
 */
export const scaleRecipeContent = ({ content, yieldValue }: { readonly content: RecipeContent; readonly yieldValue: number }): RecipeContent => {
  const factor = yieldValue / content.yield.amount.value

  return {
    ...content,
    yield: { ...content.yield, amount: { ...scaledSecondAmount({ amount: content.yield.amount, factor }), value: yieldValue } },
    ingredients: content.ingredients.map((ingredient) =>
      ingredient.amount === undefined ? ingredient : { ...ingredient, amount: scaledAmount({ amount: ingredient.amount, factor }) }
    ),
    steps: content.steps.map((step) => scaledStep({ step, factor })),
  }
}
