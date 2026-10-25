import type { Amount, SecondAmount } from "../recipe/amount.ts"
import type { Temperature } from "../recipe/recipe-content.ts"
import { isMassUnit, isVolumeUnit, valueInUnit, type Unit } from "../recipe/unit.ts"
import { measurableValue } from "./measurable-amount.ts"

// How a device shows amounts: as written, metric, or US (cooking rule 8).
export type MeasurementSystem = "as_written" | "metric" | "us"

const usUnits: ReadonlyArray<Unit> = ["oz", "lb", "tsp", "tbsp", "cup", "fl_oz"]
const metricUnits: ReadonlyArray<Unit> = ["g", "kg", "ml", "cl", "l", "tsp", "tbsp"]

// Mass within mass, volume within volume. Metric keeps TL and EL; US measures volume in tsp, tbsp, and cups.
const unitInMeasurementSystem = ({ value, unit, system }: {
  readonly value: number; readonly unit: Unit | undefined; readonly system: MeasurementSystem
}): Unit | undefined => {
  if (system === "as_written" || unit === undefined) return unit

  if (system === "metric") {
    if (metricUnits.includes(unit)) return unit

    return isMassUnit(unit) ? "g" : isVolumeUnit(unit) ? "ml" : unit
  }

  if (usUnits.includes(unit)) return unit

  if (isMassUnit(unit)) return "oz"

  if (!isVolumeUnit(unit)) return unit
  const millilitres = valueInUnit({ value, from: unit, to: "ml" }) ?? 0

  return millilitres < 15 ? "tsp" : millilitres < 60 ? "tbsp" : "cup"
}

const secondAmountInMeasurementSystem = ({ amount, system }: { readonly amount: SecondAmount; readonly system: MeasurementSystem }): SecondAmount => {
  const unit = unitInMeasurementSystem({ value: amount.value, unit: amount.unit, system })

  if (unit === amount.unit) return amount
  const converted = (value: number) => measurableValue({ value: valueInUnit({ value, from: amount.unit, to: unit }) ?? value, unit })

  return {
    value: converted(amount.value),
    ...(amount.max === undefined ? {} : { max: converted(amount.max) }),
    ...(unit === undefined ? {} : { unit }),
  }
}

// Converted amounts are rounded to what a cook can measure (cooking rule 7); the author's own units stay.
export const amountInMeasurementSystem = ({ amount, system }: { readonly amount: Amount; readonly system: MeasurementSystem }): Amount => ({
  ...secondAmountInMeasurementSystem({ amount, system }),
  ...(amount.second === undefined ? {} : { second: secondAmountInMeasurementSystem({ amount: amount.second, system }) }),
})

// °F to the nearest 5, as ovens are set: 170 °C → 340 °F.
export const fahrenheitFromCelsius = (celsius: number): number => Math.round((celsius * 9 / 5 + 32) / 5) * 5

export type ShownTemperature = { readonly degrees: number; readonly maxDegrees?: number; readonly scale: "celsius" | "fahrenheit" }

export const temperatureInMeasurementSystem = ({ temperature, system }: {
  readonly temperature: Temperature; readonly system: MeasurementSystem
}): ShownTemperature => {
  const degreesOf = (celsius: number) => system === "us" ? fahrenheitFromCelsius(celsius) : celsius

  return {
    degrees: degreesOf(temperature.celsius),
    ...(temperature.maxCelsius === undefined ? {} : { maxDegrees: degreesOf(temperature.maxCelsius) }),
    scale: system === "us" ? "fahrenheit" : "celsius",
  }
}
