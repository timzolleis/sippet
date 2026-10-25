import type { Amount, SecondAmount } from "../recipe/amount.ts"
import type { Portion, RecipeContent, Step, StepResult } from "../recipe/recipe-content.ts"
import { measurableAmount } from "./measurable-amount.ts"

const scaledSecondAmount = ({ amount, factor }: { readonly amount: SecondAmount; readonly factor: number }): SecondAmount => ({
  ...amount,
  value: amount.value * factor,
  ...(amount.max === undefined ? {} : { max: amount.max * factor }),
})

export const scaledAmount = ({ amount, factor }: { readonly amount: Amount; readonly factor: number }): Amount =>
  measurableAmount({
    ...scaledSecondAmount({ amount, factor }),
    ...(amount.second === undefined ? {} : { second: scaledSecondAmount({ amount: amount.second, factor }) }),
  })

const scaledPortion = ({ portion, factor }: { readonly portion: Portion; readonly factor: number }): Portion =>
  portion.amount === undefined ? portion : { ...portion, amount: scaledAmount({ amount: portion.amount, factor }) }

const scaledResult = ({ result, factor }: { readonly result: StepResult; readonly factor: number }): StepResult => ({
  ...result,
  ...(result.amount === undefined ? {} : { amount: scaledAmount({ amount: result.amount, factor }) }),
  ...(result.split === undefined ? {} : { split: result.split.map((portion) => scaledPortion({ portion, factor })) }),
})

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
