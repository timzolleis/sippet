// CPU spike: a realistic stand-in for the recipe document, the edit batch, and the recipe rules.
import { Schema } from "effect"

const Key = Schema.String
const Amount = Schema.Struct({
  value: Schema.Number,
  max: Schema.optionalKey(Schema.Number),
  unit: Schema.String,
  second: Schema.optionalKey(Schema.Struct({ value: Schema.Number, unit: Schema.String }))
})
const Duration = Schema.Struct({
  min: Schema.optionalKey(Schema.Number),
  max: Schema.optionalKey(Schema.Number),
  unit: Schema.optionalKey(Schema.String),
  kind: Schema.Literals(["active", "passive"])
})
const Temperature = Schema.Struct({ celsius: Schema.Number, mode: Schema.String })
const Portion = Schema.Struct({ key: Key, name: Schema.String, amount: Schema.optionalKey(Amount), rest: Schema.optionalKey(Schema.Boolean) })

const ingredientFields = {
  item: Schema.String,
  amount: Schema.optionalKey(Amount),
  section: Schema.optionalKey(Key),
  note: Schema.optionalKey(Schema.String),
  optional: Schema.optionalKey(Schema.Boolean)
}
const stepFields = {
  label: Schema.String,
  sentence: Schema.optionalKey(Schema.String),
  section: Schema.optionalKey(Key),
  equipment: Schema.optionalKey(Schema.Array(Key)),
  duration: Schema.optionalKey(Duration),
  temperature: Schema.optionalKey(Temperature)
}

export const RecipeEdit = Schema.Union([
  Schema.Struct({ type: Schema.Literal("set_title"), title: Schema.String }),
  Schema.Struct({ type: Schema.Literal("set_yield"), yield: Amount }),
  Schema.Struct({ type: Schema.Literal("add_section"), key: Key, name: Schema.String }),
  Schema.Struct({ type: Schema.Literal("add_equipment"), key: Key, name: Schema.String }),
  Schema.Struct({ type: Schema.Literal("add_ingredient"), key: Key, after: Schema.optionalKey(Key), ...ingredientFields }),
  Schema.Struct({ type: Schema.Literal("edit_ingredient"), key: Key, ...ingredientFields, item: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("remove_ingredient"), key: Key }),
  Schema.Struct({ type: Schema.Literal("add_step"), key: Key, after: Schema.optionalKey(Key), ...stepFields }),
  Schema.Struct({ type: Schema.Literal("edit_step"), key: Key, ...stepFields, label: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("turn_into_flow") }),
  Schema.Struct({ type: Schema.Literal("set_consumes"), step: Key, consumes: Schema.Array(Key) }),
  Schema.Struct({ type: Schema.Literal("set_waits_for"), step: Key, waitsFor: Schema.Array(Key) }),
  Schema.Struct({ type: Schema.Literal("set_result"), step: Key, name: Schema.String, amount: Schema.optionalKey(Amount) }),
  Schema.Struct({ type: Schema.Literal("split_result"), step: Key, portions: Schema.Array(Portion) })
])
export type RecipeEdit = typeof RecipeEdit.Type

type Step = {
  key: string
  label: string
  [k: string]: unknown
  consumes?: ReadonlyArray<string>
  waitsFor?: ReadonlyArray<string>
  result?: { name: string; amount?: typeof Amount.Type; portions?: ReadonlyArray<typeof Portion.Type> }
}
type Ingredient = { key: string; item: string; amount?: typeof Amount.Type; [k: string]: unknown }
export type Recipe = {
  title: string
  yield?: typeof Amount.Type
  sections: Array<{ key: string; name: string }>
  equipment: Array<{ key: string; name: string }>
  ingredients: Array<Ingredient>
  method: { kind: "steps" | "flow"; steps: Array<Step> }
}

export const emptyRecipe = (title: string): Recipe => ({
  title,
  sections: [],
  equipment: [],
  ingredients: [],
  method: { kind: "steps", steps: [] }
})

const insertAfter = <T extends { key: string }>(list: Array<T>, value: T, after: string | undefined) => {
  if (after === undefined) return [...list, value]
  const i = list.findIndex((x) => x.key === after)
  return i < 0 ? [...list, value] : [...list.slice(0, i + 1), value, ...list.slice(i + 1)]
}

/** Applies a batch in order. Returns the new recipe or the problems, naming each edit. */
export const applyEdits = (recipe: Recipe, edits: ReadonlyArray<RecipeEdit>): { recipe: Recipe; problems: Array<string> } => {
  const problems: Array<string> = []
  let r: Recipe = structuredClone(recipe)
  const allKeys = () =>
    new Set([...r.sections, ...r.equipment, ...r.ingredients, ...r.method.steps].map((x) => x.key))
  const stepAt = (n: number, key: string) => {
    const s = r.method.steps.find((x) => x.key === key)
    if (!s) problems.push(`edit ${n}: no step "${key}"`)
    return s
  }
  edits.forEach((e, i) => {
    const n = i + 1
    switch (e.type) {
      case "set_title": r.title = e.title; break
      case "set_yield": r.yield = e.yield; break
      case "add_section":
      case "add_equipment": {
        if (allKeys().has(e.key)) { problems.push(`edit ${n}: key "${e.key}" already used`); break }
        ;(e.type === "add_section" ? r.sections : r.equipment).push({ key: e.key, name: e.name })
        break
      }
      case "add_ingredient": {
        if (allKeys().has(e.key)) { problems.push(`edit ${n}: key "${e.key}" already used`); break }
        const { type: _, after, ...fields } = e
        r.ingredients = insertAfter(r.ingredients, fields, after)
        break
      }
      case "edit_ingredient": {
        const ing = r.ingredients.find((x) => x.key === e.key)
        if (!ing) { problems.push(`edit ${n}: no ingredient "${e.key}"`); break }
        const { type: _, ...fields } = e
        Object.assign(ing, fields)
        break
      }
      case "remove_ingredient": {
        const before = r.ingredients.length
        r.ingredients = r.ingredients.filter((x) => x.key !== e.key)
        if (r.ingredients.length === before) problems.push(`edit ${n}: no ingredient "${e.key}"`)
        break
      }
      case "add_step": {
        if (allKeys().has(e.key)) { problems.push(`edit ${n}: key "${e.key}" already used`); break }
        const { type: _, after, ...fields } = e
        r.method.steps = insertAfter(r.method.steps, fields as Step, after)
        break
      }
      case "edit_step": {
        const s = stepAt(n, e.key)
        if (s) { const { type: _, ...fields } = e; Object.assign(s, fields) }
        break
      }
      case "turn_into_flow": r.method.kind = "flow"; break
      case "set_consumes": { const s = stepAt(n, e.step); if (s) s.consumes = e.consumes; break }
      case "set_waits_for": { const s = stepAt(n, e.step); if (s) s.waitsFor = e.waitsFor; break }
      case "set_result": {
        const s = stepAt(n, e.step)
        if (s) s.result = { name: e.name, ...(e.amount ? { amount: e.amount } : {}), ...(s.result?.portions ? { portions: s.result.portions } : {}) }
        break
      }
      case "split_result": {
        const s = stepAt(n, e.step)
        if (!s) break
        if (!s.result) { problems.push(`edit ${n}: step "${e.step}" has no result to split`); break }
        s.result = { ...s.result, portions: e.portions }
        break
      }
    }
  })
  return { recipe: r, problems }
}

/** The recipe rules (recipe.md). Returns every broken rule. */
export const checkRecipe = (r: Recipe): Array<string> => {
  const problems: Array<string> = []
  if (!r.title.trim()) problems.push("rule 1: no title")
  if (r.ingredients.length === 0) problems.push("rule 1: no ingredient")
  if (r.method.steps.length === 0) problems.push("rule 1: no step")

  const keys = new Map<string, number>()
  const portions = r.method.steps.flatMap((s) => s.result?.portions ?? [])
  for (const x of [...r.sections, ...r.equipment, ...r.ingredients, ...r.method.steps, ...portions]) {
    keys.set(x.key, (keys.get(x.key) ?? 0) + 1)
  }
  for (const [k, c] of keys) if (c > 1) problems.push(`rule 17: key "${k}" used ${c} times`)

  const sections = new Set(r.sections.map((s) => s.key))
  const equipment = new Set(r.equipment.map((s) => s.key))
  for (const i of r.ingredients) {
    if (i.section !== undefined && !sections.has(i.section as string)) problems.push(`rule 5: ingredient "${i.key}": no section "${i.section}"`)
  }
  const items = new Map<string, string>()
  for (const i of r.ingredients) {
    const lower = i.item.toLowerCase()
    const seen = items.get(lower)
    if (seen !== undefined && seen !== i.item) problems.push(`rule 3: item "${i.item}" and "${seen}" differ only in case`)
    items.set(lower, i.item)
  }
  for (const s of r.method.steps) {
    for (const e of (s.equipment as Array<string> | undefined) ?? []) if (!equipment.has(e)) problems.push(`rule 6: step "${s.key}": no equipment "${e}"`)
  }
  if (r.method.kind === "steps") return problems

  // Flow
  const ingredientKeys = new Set(r.ingredients.map((i) => i.key))
  const stepIndex = new Map(r.method.steps.map((s, i) => [s.key, i]))
  const portionOwner = new Map<string, string>()
  for (const s of r.method.steps) for (const p of s.result?.portions ?? []) portionOwner.set(p.key, s.key)

  const consumedBy = new Map<string, Array<string>>()
  const deps = new Map<string, Array<string>>()
  for (const s of r.method.steps) {
    const d: Array<string> = []
    for (const c of s.consumes ?? []) {
      consumedBy.set(c, [...(consumedBy.get(c) ?? []), s.key])
      if (ingredientKeys.has(c)) continue
      if (stepIndex.has(c)) { d.push(c); continue }
      const owner = portionOwner.get(c)
      if (owner !== undefined) { d.push(owner); continue }
      problems.push(`rule 9: step "${s.key}" consumes "${c}", which doesn't exist`)
    }
    for (const w of s.waitsFor ?? []) {
      if (!stepIndex.has(w)) problems.push(`rule 9: step "${s.key}" waits for "${w}", which doesn't exist`)
      else d.push(w)
    }
    deps.set(s.key, d)
  }

  // rule 10: no loops (DFS)
  const state = new Map<string, 1 | 2>()
  const visit = (k: string, path: Array<string>): void => {
    if (state.get(k) === 2) return
    if (state.get(k) === 1) { problems.push(`rule 10: loop ${[...path, k].join(" → ")}`); return }
    state.set(k, 1)
    for (const d of deps.get(k) ?? []) visit(d, [...path, k])
    state.set(k, 2)
  }
  for (const s of r.method.steps) visit(s.key, [])

  // rule 11: every ingredient goes to exactly one step
  for (const i of r.ingredients) {
    const by = consumedBy.get(i.key) ?? []
    if (by.length === 0) problems.push(`rule 11: ingredient "${i.key}" (${i.item}) is never consumed`)
    if (by.length > 1) problems.push(`rule 11: ingredient "${i.key}" is consumed by ${by.join(", ")}`)
  }
  // rule 12/13: results and portions go to one place
  for (const s of r.method.steps) {
    const by = consumedBy.get(s.key) ?? []
    if (s.result?.portions) {
      if (by.length > 0) problems.push(`rule 12: result of "${s.key}" is split; consume its portions`)
      const rests = s.result.portions.filter((p) => p.rest).length
      if (rests > 1) problems.push(`rule 13: "${s.key}" has ${rests} rest portions`)
      const sum = s.result.portions.reduce((a, p) => a + (p.amount?.value ?? 0), 0)
      if (s.result.amount && sum > s.result.amount.value) problems.push(`rule 13: portions of "${s.key}" exceed ${s.result.amount.value}`)
      for (const p of s.result.portions) {
        const pb = consumedBy.get(p.key) ?? []
        if (pb.length !== 1) problems.push(`rule 13: portion "${p.key}" is consumed ${pb.length} times`)
      }
    } else if (by.length > 1) problems.push(`rule 12: result of "${s.key}" is consumed by ${by.join(", ")}`)
  }
  // rule 16: the author's order respects the flow
  for (const s of r.method.steps) {
    for (const d of deps.get(s.key) ?? []) {
      if ((stepIndex.get(d) ?? -1) > (stepIndex.get(s.key) ?? -1)) problems.push(`rule 16: "${s.key}" comes before "${d}"`)
    }
  }
  // rule 15: at least one thing the recipe makes
  const waitedFor = new Set(r.method.steps.flatMap((s) => s.waitsFor ?? []))
  const makes = r.method.steps.filter((s) => s.result && !s.result.portions && (consumedBy.get(s.key) ?? []).length === 0 && !waitedFor.has(s.key))
  if (makes.length === 0) problems.push("rule 15: the flow makes nothing")
  return problems
}
