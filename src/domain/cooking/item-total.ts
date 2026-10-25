import type { Amount } from "../recipe/amount.ts"
import type { Key } from "../recipe/key.ts"
import type { ItemName, RecipeContent } from "../recipe/recipe-content.ts"
import { recipeItemsFromContent } from "../recipe/recipe-item.ts"
import { gramsPerMassUnit, isMassUnit, isSameUnit, isVolumeUnit, millilitresPerVolumeUnit, valueInUnit, type Unit } from "../recipe/unit.ts"

export type ItemTotal = {
  readonly item: ItemName
  // one amount per kind: mass, volume, and each other unit side by side
  readonly totals: ReadonlyArray<Amount>
  readonly bySection: ReadonlyArray<{ readonly sectionKey?: Key; readonly amount?: Amount }>
}

const isSameKind = (a: Unit | undefined, b: Unit | undefined) =>
  (isMassUnit(a) && isMassUnit(b)) || (isVolumeUnit(a) && isVolumeUnit(b)) || isSameUnit(a, b)

// The larger unit of two of the same kind: 500 g + 1 kg = 1,5 kg.
const largerUnit = (a: Unit | undefined, b: Unit | undefined): Unit | undefined => {
  if (isMassUnit(a) && isMassUnit(b)) return gramsPerMassUnit[b] > gramsPerMassUnit[a] ? b : a
  if (isVolumeUnit(a) && isVolumeUnit(b)) return millilitresPerVolumeUnit[b] > millilitresPerVolumeUnit[a] ? b : a
  return a
}

const addAmounts = (total: Amount, amount: Amount): Amount => {
  const unit = largerUnit(total.unit, amount.unit)
  const inUnit = (value: number, from: Unit | undefined) => valueInUnit({ value, from, to: unit }) ?? value
  const value = inUnit(total.value, total.unit) + inUnit(amount.value, amount.unit)
  const max = total.max === undefined && amount.max === undefined
    ? undefined
    : inUnit(total.max ?? total.value, total.unit) + inUnit(amount.max ?? amount.value, amount.unit)
  return { value, ...(max === undefined ? {} : { max }), ...(unit === undefined ? {} : { unit }) }
}

// Totals per item with the split by section, for shopping and the pantry (cooking rule 3, recipe rule 3).
export const itemTotalsFromContent = (content: RecipeContent): ReadonlyArray<ItemTotal> =>
  recipeItemsFromContent(content).map((item) => {
    const ingredients = content.ingredients.filter((ingredient) => item.ingredientKeys.includes(ingredient.key))
    const totals = ingredients.reduce<ReadonlyArray<Amount>>((sums, ingredient) => {
      const amount = ingredient.amount
      if (amount === undefined) return sums
      const index = sums.findIndex((sum) => isSameKind(sum.unit, amount.unit))
      return index < 0 ? [...sums, amount] : sums.map((sum, at) => at === index ? addAmounts(sum, amount) : sum)
    }, [])
    return {
      item: item.name,
      totals: totals.map(({ second: _second, ...total }) => total),
      bySection: ingredients.map((ingredient) => ({
        ...(ingredient.section === undefined ? {} : { sectionKey: ingredient.section }),
        ...(ingredient.amount === undefined ? {} : { amount: ingredient.amount }),
      })),
    }
  })
