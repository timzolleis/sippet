import type { Amount, SecondAmount } from "../recipe/amount.ts"
import type { Unit } from "../recipe/unit.ts"
import { withOptional } from "../with-optional.ts"

// What a cook can measure: g and ml to 5 (under 20 to 1), TL and EL to ⅛, oz and cup to ¼, Pck. and Stück to ½ (cooking rule 7).
const measuringStepOf = ({ value, unit }: { readonly value: number; readonly unit: Unit | undefined }): number | undefined => {
  switch (unit) {
    case "g":
    case "ml":
      return value < 20 ? 1 : 5
    case "tsp":
    case "tbsp":
      return 1 / 8
    case "oz":
    case "cup":
      return 1 / 4
    case "packet":
    case "piece":
      return 1 / 2
    default:
      return undefined
  }
}

// Other units aren't rounded. A nonzero amount never rounds to 0, only up to the smallest step.
export const measurableValue = ({ value, unit }: { readonly value: number; readonly unit: Unit | undefined }): number => {
  const step = measuringStepOf({ value, unit })

  if (step === undefined) return value
  const rounded = Math.round(value / step) * step

  return rounded === 0 && value > 0 ? step : rounded
}

const measurableSecondAmount = (amount: SecondAmount): SecondAmount =>
  withOptional(
    { ...amount, value: measurableValue({ value: amount.value, unit: amount.unit }) },
    "max",
    amount.max === undefined ? undefined : measurableValue({ value: amount.max, unit: amount.unit }),
  )

// The second amount is rounded alongside: "⅛ TL (1 g) Salz".
export const measurableAmount = (amount: Amount): Amount =>
  withOptional(measurableSecondAmount(amount), "second", amount.second === undefined ? undefined : measurableSecondAmount(amount.second))
