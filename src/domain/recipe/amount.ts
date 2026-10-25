import { Schema } from "effect"
import { Unit } from "./unit.ts"

const NonNegativeNumber = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

const amountFields = { value: NonNegativeNumber, max: Schema.optionalKey(NonNegativeNumber), unit: Schema.optionalKey(Unit) }

const maxNotBelowValue = Schema.makeFilter(
  (amount: { readonly value: number; readonly max?: number }) =>
    amount.max === undefined || amount.max >= amount.value || "max must not be below value",
)

// A number ("300 g") or a range ("1–2 Zehen"); no unit is a count ("2 Eier") (recipe rule 2).
export const SecondAmount = Schema.Struct(amountFields).check(maxNotBelowValue).annotate({ identifier: "SecondAmount", description: "Like Amount, without a second." })

export type SecondAmount = typeof SecondAmount.Type

// May carry a second amount: "¼ TL (2 g) Salz".
export const Amount = Schema.Struct({
  value: amountFields.value.pipe(Schema.annotateKey({ description: "The number; for a range, the low end." })),
  max: amountFields.max.pipe(Schema.annotateKey({ description: "A range's high end: 1–2 Zehen is value 1, max 2." })),
  unit: amountFields.unit.pipe(Schema.annotateKey({ description: "Omit for a bare count: 2 Eier." })),
  second: Schema.optionalKey(SecondAmount).pipe(Schema.annotateKey({ description: "The amount in brackets: ¼ TL (2 g) is 0.25 tsp, second 2 g." })),
}).check(maxNotBelowValue).annotate({ identifier: "Amount", description: "As written: a number or a range, a unit, optionally a second amount." })

export type Amount = typeof Amount.Type
