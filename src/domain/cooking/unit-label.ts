import type { HeatingMode } from "../recipe/recipe-content.ts"
import type { Unit, UnitCode } from "../recipe/unit.ts"

export type Language = "de" | "en"

const unitLabels: Readonly<Record<UnitCode, Readonly<Record<Language, string>>>> = {
  g: { de: "g", en: "g" },
  kg: { de: "kg", en: "kg" },
  oz: { de: "oz", en: "oz" },
  lb: { de: "lb", en: "lb" },
  ml: { de: "ml", en: "ml" },
  cl: { de: "cl", en: "cl" },
  l: { de: "l", en: "l" },
  tsp: { de: "TL", en: "tsp" },
  tbsp: { de: "EL", en: "tbsp" },
  cup: { de: "Tasse", en: "cup" },
  fl_oz: { de: "fl oz", en: "fl oz" },
  piece: { de: "Stück", en: "piece" },
  serving: { de: "Portion", en: "serving" },
  pinch: { de: "Prise", en: "pinch" },
  packet: { de: "Pck.", en: "packet" },
  can: { de: "Dose", en: "can" },
  tub: { de: "Becher", en: "tub" },
  bottle: { de: "Fl.", en: "bottle" },
  bunch: { de: "Bund", en: "bunch" },
  clove: { de: "Zehe", en: "clove" },
  slice: { de: "Scheibe", en: "slice" },
  sheet: { de: "Blatt", en: "sheet" },
  sprig: { de: "Zweig", en: "sprig" },
  drop: { de: "Tropfen", en: "drop" },
  handful: { de: "Handvoll", en: "handful" },
}

const heatingModeLabels: Readonly<Record<HeatingMode, Readonly<Record<Language, string>>>> = {
  top_bottom: { de: "Ober-/Unterhitze", en: "conventional" },
  fan: { de: "Umluft", en: "fan" },
  top: { de: "Oberhitze", en: "top heat" },
  bottom: { de: "Unterhitze", en: "bottom heat" },
  grill: { de: "Grill", en: "grill" },
}

// Unit names are translated; the author's own units stay as written (cooking rule 8).
export const unitLabel = ({ unit, language }: { readonly unit: Unit; readonly language: Language }): string =>
  typeof unit === "object" ? unit.custom : unitLabels[unit][language]

export const heatingModeLabel = ({ mode, language }: { readonly mode: HeatingMode; readonly language: Language }): string =>
  heatingModeLabels[mode][language]
