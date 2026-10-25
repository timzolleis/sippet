import { Schema } from "effect"

export const MassUnitCode = Schema.Literals(["g", "kg", "oz", "lb"])

export type MassUnitCode = typeof MassUnitCode.Type

export const VolumeUnitCode = Schema.Literals(["ml", "cl", "l", "tsp", "tbsp", "cup", "fl_oz"])

export type VolumeUnitCode = typeof VolumeUnitCode.Type

export const CountUnitCode = Schema.Literals([
  "piece", "serving", "pinch", "packet", "can", "tub", "bottle", "bunch", "clove", "slice", "sheet", "sprig", "drop", "handful",
])

export type CountUnitCode = typeof CountUnitCode.Type

export const UnitCode = Schema.Union([MassUnitCode, VolumeUnitCode, CountUnitCode])

export type UnitCode = typeof UnitCode.Type

// The author's own word: "Messerspitze" (recipe rule 2).
export const CustomUnit = Schema.Struct({ custom: Schema.NonEmptyString })

export type CustomUnit = typeof CustomUnit.Type

export const Unit = Schema.Union([UnitCode, CustomUnit])

export type Unit = typeof Unit.Type

export const isCustomUnit = (unit: Unit | undefined): unit is CustomUnit => Schema.is(CustomUnit)(unit)

export const gramsPerMassUnit: Readonly<Record<MassUnitCode, number>> = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 }

// tsp, tbsp, cup as in the spec; fl_oz as an eighth of that cup.
export const millilitresPerVolumeUnit: Readonly<Record<VolumeUnitCode, number>> = {
  ml: 1, cl: 10, l: 1000, tsp: 5, tbsp: 15, cup: 240, fl_oz: 30,
}

export const isMassUnit = (unit: Unit | undefined): unit is MassUnitCode => Schema.is(MassUnitCode)(unit)
export const isVolumeUnit = (unit: Unit | undefined): unit is VolumeUnitCode => Schema.is(VolumeUnitCode)(unit)

export const isSameUnit = (a: Unit | undefined, b: Unit | undefined): boolean =>
  isCustomUnit(a) && isCustomUnit(b) ? a.custom === b.custom : a === b

// A value in another unit of the same kind: mass within mass, volume within volume, otherwise only the same unit.
export const valueInUnit = ({ value, from, to }: {
  readonly value: number; readonly from: Unit | undefined; readonly to: Unit | undefined
}): number | undefined => {
  if (isSameUnit(from, to)) return value

  if (isMassUnit(from) && isMassUnit(to)) return value * gramsPerMassUnit[from] / gramsPerMassUnit[to]

  if (isVolumeUnit(from) && isVolumeUnit(to)) return value * millilitresPerVolumeUnit[from] / millilitresPerVolumeUnit[to]

  return undefined
}
