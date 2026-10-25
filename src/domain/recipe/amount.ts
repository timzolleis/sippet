import { Schema } from "effect"
import { Unit } from "./unit.ts"

const NonNegativeNumber = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

const amountFields = {
  value: NonNegativeNumber,
  max: Schema.optionalKey(NonNegativeNumber),
  unit: Schema.optionalKey(Unit),
}

const maxNotBelowValue = Schema.makeFilter(
  (amount: { readonly value: number; readonly max?: number }) =>
    amount.max === undefined || amount.max >= amount.value || "max must not be below value",
)

// A number ("300 g") or a range ("1–2 Zehen"); no unit is a count ("2 Eier") (recipe rule 2).
export const SecondAmount = Schema.Struct(amountFields).check(maxNotBelowValue).annotate({ identifier: "SecondAmount" })
export type SecondAmount = typeof SecondAmount.Type

// May carry a second amount: "¼ TL (2 g) Salz".
export const Amount = Schema.Struct({ ...amountFields, second: Schema.optionalKey(SecondAmount) }).check(maxNotBelowValue).annotate({ identifier: "Amount" })
export type Amount = typeof Amount.Type
