import { Option } from "effect"
import type { Amount } from "./amount.ts"
import { keysOfContent } from "./apply-recipe-edits.ts"
import type { Key } from "./key.ts"
import { isStepResultSplit, portionsOfStep, type RecipeContent, type Step } from "./recipe-content.ts"
import { recipeFlowFromContent, type FlowLink, type RecipeFlow, type StepFlow } from "./recipe-flow.ts"
import type { RecipeProblem } from "./recipe-problem.ts"
import { valueInUnit, type Unit } from "./unit.ts"

export type RecipeRuleInput = { readonly content: RecipeContent }
export type RecipeFlowRuleInput = { readonly content: RecipeContent; readonly flow: RecipeFlow }

export type RecipeRule = (input: RecipeRuleInput) => ReadonlyArray<RecipeProblem>
export type RecipeFlowRule = (input: RecipeFlowRuleInput) => ReadonlyArray<RecipeProblem>

const brokenRule = (rule: number, message: string): RecipeProblem => ({ rule: `recipe ${rule}`, message })

const quoted = (key: Key) => `"${key}"`

const listed = (words: ReadonlyArray<string>) =>
  words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`

// "(derived: join)" for a link a derivation made (specs/mcp.md, Refusals).
const derivedNote = (link: FlowLink) => link.source === "named" ? "" : ` (derived: ${link.source})`

const unitText = (unit: Unit | undefined) => unit === undefined ? "" : typeof unit === "object" ? ` ${unit.custom}` : ` ${unit}`

const amountText = ({ value, unit }: { readonly value: number; readonly unit: Unit | undefined }) =>
  `${Math.round(value * 100) / 100}${unitText(unit)}`

type TakenLink = { readonly takerKey: Key; readonly link: FlowLink }

// Who takes each result or portion, by its key.
const takersByKey = (flow: RecipeFlow): ReadonlyMap<Key, ReadonlyArray<TakenLink>> => {
  const takers = new Map<Key, Array<TakenLink>>()
  for (const stepFlow of flow.steps) {
    for (const link of stepFlow.takes) takers.set(link.key, [...(takers.get(link.key) ?? []), { takerKey: stepFlow.stepKey, link }])
  }
  return takers
}

const takerText = ({ takerKey, link }: TakenLink) => `${quoted(takerKey)}${derivedNote(link)}`

// The step a link points at: the step itself, or the step whose result a portion splits.
const stepKeyByLinkKey = (content: RecipeContent): ReadonlyMap<Key, Key> =>
  new Map(content.steps.flatMap((step) => [
    [step.key, step.key] as const,
    ...portionsOfStep(step).map((portion) => [portion.key, step.key] as const),
  ]))

// 1. Title, ingredient, step.
export const titleIngredientAndStepRule: RecipeRule = ({ content }) => [
  ...(content.title.trim() === "" ? [brokenRule(1, "the recipe has no title")] : []),
  ...(content.ingredients.length === 0 ? [brokenRule(1, "the recipe has no ingredient")] : []),
  ...(content.steps.length === 0 ? [brokenRule(1, "the recipe has no step")] : []),
]

// 12. Everything named exists: sections, equipment, the vessel, and what steps use, take, or wait for.
export const everythingNamedExistsRule: RecipeRule = ({ content }) => {
  const sectionKeys = new Set(content.sections.map((section) => section.key))
  const equipmentKeys = new Set(content.equipment.map((equipment) => equipment.key))
  const ingredientKeys = new Set(content.ingredients.map((ingredient) => ingredient.key))
  const takeableKeys = stepKeyByLinkKey(content)
  const stepKeys = new Set(content.steps.map((step) => step.key))
  const vessel = content.yield.vessel
  return [
    ...(vessel !== undefined && !equipmentKeys.has(vessel)
      ? [brokenRule(12, `the yield's vessel ${quoted(vessel)} is no equipment`)]
      : []),
    ...content.ingredients.flatMap((ingredient) =>
      ingredient.section !== undefined && !sectionKeys.has(ingredient.section)
        ? [brokenRule(12, `ingredient ${quoted(ingredient.key)} is in no section ${quoted(ingredient.section)}`)]
        : []
    ),
    ...content.steps.flatMap((step) => [
      ...(step.section !== undefined && !sectionKeys.has(step.section)
        ? [brokenRule(12, `step ${quoted(step.key)} is in no section ${quoted(step.section)}`)]
        : []),
      ...(step.equipment ?? []).flatMap((key) =>
        equipmentKeys.has(key) ? [] : [brokenRule(12, `step ${quoted(step.key)} names no equipment ${quoted(key)}`)]
      ),
      ...(step.uses ?? []).flatMap((key) =>
        ingredientKeys.has(key) ? [] : [brokenRule(12, `step ${quoted(step.key)} uses no ingredient ${quoted(key)}`)]
      ),
      ...(step.takes ?? []).flatMap((key) =>
        takeableKeys.has(key)
          ? []
          : ingredientKeys.has(key)
          ? [brokenRule(12, `step ${quoted(step.key)} takes the ingredient ${quoted(key)}; name it in uses`)]
          : [brokenRule(12, `step ${quoted(step.key)} takes no result or portion ${quoted(key)}`)]
      ),
      ...(step.waitsFor ?? []).flatMap((key) =>
        stepKeys.has(key) ? [] : [brokenRule(12, `step ${quoted(step.key)} waits for no step ${quoted(key)}`)]
      ),
    ]),
  ]
}

// 20. Keys are unique in the recipe.
export const uniqueKeysRule: RecipeRule = ({ content }) => {
  const counts = new Map<Key, number>()
  for (const key of keysOfContent(content)) counts.set(key, (counts.get(key) ?? 0) + 1)
  return [...counts].flatMap(([key, count]) => count > 1 ? [brokenRule(20, `key ${quoted(key)} is used ${count} times`)] : [])
}

// 11. A prep step uses and takes nothing, so it makes nothing; 12. a step can't take a result that doesn't exist.
export const prepStepsMakeNothingRule: RecipeFlowRule = ({ content, flow }) => {
  const makesByStepKey = new Map(flow.steps.map((stepFlow) => [stepFlow.stepKey, stepFlow.makes]))
  return [
    ...content.steps.flatMap((step) =>
      makesByStepKey.get(step.key) === false && step.result !== undefined
        ? [brokenRule(11, `step ${quoted(step.key)} uses and takes nothing, so it makes nothing; drop its result`)]
        : []
    ),
    ...flow.steps.flatMap((stepFlow) =>
      stepFlow.takes.flatMap((link) =>
        makesByStepKey.get(link.key) === false
          ? [brokenRule(12, `step ${quoted(stepFlow.stepKey)} takes ${quoted(link.key)}, which makes nothing (prep step)${derivedNote(link)}`)]
          : []
      )
    ),
  ]
}

type FlowEdge = { readonly fromKey: Key; readonly toKey: Key; readonly link: FlowLink; readonly verb: "takes" | "waits for" }

const edgesOfStep = ({ stepFlow, stepKeyByLink }: { readonly stepFlow: StepFlow; readonly stepKeyByLink: ReadonlyMap<Key, Key> }): ReadonlyArray<FlowEdge> => [
  ...stepFlow.takes.flatMap((link): ReadonlyArray<FlowEdge> => {
    const toKey = stepKeyByLink.get(link.key)
    return toKey === undefined ? [] : [{ fromKey: stepFlow.stepKey, toKey, link, verb: "takes" }]
  }),
  ...stepFlow.waitsFor.flatMap((link): ReadonlyArray<FlowEdge> =>
    stepKeyByLink.has(link.key) ? [{ fromKey: stepFlow.stepKey, toKey: link.key, link, verb: "waits for" }] : []
  ),
]

const edgeText = (edge: FlowEdge) => `${quoted(edge.fromKey)} ${edge.verb} ${quoted(edge.link.key)}${derivedNote(edge.link)}`

// 13. No step takes or waits for its own result, directly or through other steps.
export const noLoopsRule: RecipeFlowRule = ({ content, flow }) => {
  const stepKeyByLink = stepKeyByLinkKey(content)
  const edgesByStepKey = new Map(flow.steps.map((stepFlow) => [stepFlow.stepKey, edgesOfStep({ stepFlow, stepKeyByLink })]))
  const visiting = new Set<Key>()
  const visited = new Set<Key>()
  const path: Array<FlowEdge> = []
  const loops = new Map<string, ReadonlyArray<FlowEdge>>()
  const visit = (stepKey: Key): void => {
    if (visited.has(stepKey)) return
    visiting.add(stepKey)
    for (const edge of edgesByStepKey.get(stepKey) ?? []) {
      if (visiting.has(edge.toKey)) {
        const start = path.findIndex((earlier) => earlier.fromKey === edge.toKey)
        const loop = [...(start < 0 ? [] : path.slice(start)), edge]
        loops.set(loop.map((loopEdge) => loopEdge.fromKey).sort().join(" "), loop)
        continue
      }
      path.push(edge)
      visit(edge.toKey)
      path.pop()
    }
    visiting.delete(stepKey)
    visited.add(stepKey)
  }
  for (const step of content.steps) visit(step.key)
  return [...loops.values()].map((loop) => brokenRule(13, `loop: ${loop.map(edgeText).join(", ")}`))
}

// 14. Every ingredient is used by exactly one step.
export const everyIngredientToOneStepRule: RecipeFlowRule = ({ content }) =>
  content.ingredients.flatMap((ingredient) => {
    const users = content.steps.filter((step) => (step.uses ?? []).includes(ingredient.key)).map((step) => quoted(step.key))
    if (users.length === 0) return [brokenRule(14, `ingredient ${quoted(ingredient.key)} is used by no step`)]
    if (users.length > 1) return [brokenRule(14, `ingredient ${quoted(ingredient.key)} is used by ${listed(users)}`)]
    return []
  })

// 15. A result, or a portion, is taken by at most one step.
export const resultToOnePlaceRule: RecipeFlowRule = ({ content, flow }) => {
  const takers = takersByKey(flow)
  return content.steps.flatMap((step) => [
    ...(isStepResultSplit(step) ? [] : [{ key: step.key, what: "result of" }]),
    ...portionsOfStep(step).map((portion) => ({ key: portion.key, what: "portion" })),
  ]).flatMap(({ key, what }) => {
    const takenBy = takers.get(key) ?? []
    return takenBy.length > 1 ? [brokenRule(15, `${what} ${quoted(key)} is taken by ${listed(takenBy.map(takerText))}`)] : []
  })
}

const totalInUnit = ({ amounts, unit }: { readonly amounts: ReadonlyArray<Amount>; readonly unit: Unit | undefined }): number | undefined =>
  amounts.reduce<number | undefined>((total, amount) => {
    const value = valueInUnit({ value: amount.value, from: amount.unit, to: unit })
    return total === undefined || value === undefined ? undefined : total + value
  }, 0)

const portionProblemsOfStep = ({ step, takers }: { readonly step: Step; readonly takers: ReadonlyMap<Key, ReadonlyArray<TakenLink>> }): ReadonlyArray<RecipeProblem> => {
  const portions = portionsOfStep(step)
  const resultAmount = step.result?.amount
  const portionAmounts = portions.flatMap((portion) => portion.amount === undefined ? [] : [portion.amount])
  const portionsTotal = resultAmount === undefined ? undefined : totalInUnit({ amounts: portionAmounts, unit: resultAmount.unit })
  const rests = portions.filter((portion) => portion.rest === true)
  return [
    ...(takers.get(step.key) ?? []).map((taken) =>
      brokenRule(16, `step ${takerText(taken)} takes the whole result of ${quoted(step.key)}, which is split; take its portions`)
    ),
    ...portions.flatMap((portion) =>
      portion.amount === undefined && portion.rest !== true
        ? [brokenRule(16, `portion ${quoted(portion.key)} of ${quoted(step.key)} has no amount; only the rest may have none`)]
        : []
    ),
    ...(rests.length > 1 ? [brokenRule(16, `${quoted(step.key)} has ${rests.length} portions that are the rest; at most one may be`)] : []),
    ...(resultAmount !== undefined && portionsTotal !== undefined && portionsTotal > (resultAmount.max ?? resultAmount.value)
      ? [brokenRule(16, `portions of ${quoted(step.key)} (${amountText({ value: portionsTotal, unit: resultAmount.unit })}) exceed its result (${amountText({ value: resultAmount.max ?? resultAmount.value, unit: resultAmount.unit })})`)]
      : []),
    ...portions.flatMap((portion) =>
      (takers.get(portion.key) ?? []).length === 0
        ? [brokenRule(16, `portion ${quoted(portion.key)} of ${quoted(step.key)} is taken by no step`)]
        : []
    ),
  ]
}

// 16. A split is taken as its portions; each has an amount but the rest; together no more than the result; each taken.
export const portionsRule: RecipeFlowRule = ({ content, flow }) => {
  const takers = takersByKey(flow)
  return content.steps.filter(isStepResultSplit).flatMap((step) => portionProblemsOfStep({ step, takers }))
}

// 18. A flow makes at least one thing.
export const recipeMakesSomethingRule: RecipeFlowRule = ({ flow }) =>
  flow.makes.length === 0 ? [brokenRule(18, "the flow makes nothing: every result is taken or waited for")] : []

// 19. Each step comes after every step it takes from or waits for.
export const authorsOrderRule: RecipeFlowRule = ({ content, flow }) => {
  const stepKeyByLink = stepKeyByLinkKey(content)
  const indexByStepKey = new Map(content.steps.map((step, index) => [step.key, index]))
  return flow.steps.flatMap((stepFlow) =>
    edgesOfStep({ stepFlow, stepKeyByLink }).flatMap((edge) =>
      (indexByStepKey.get(edge.toKey) ?? 0) > (indexByStepKey.get(edge.fromKey) ?? 0)
        ? [brokenRule(19, `step ${edgeText(edge)}, which comes after it`)]
        : []
    )
  )
}

export const recipeRules: ReadonlyArray<RecipeRule> = [titleIngredientAndStepRule, everythingNamedExistsRule, uniqueKeysRule]

export const recipeFlowRules: ReadonlyArray<RecipeFlowRule> = [
  prepStepsMakeNothingRule,
  noLoopsRule,
  everyIngredientToOneStepRule,
  resultToOnePlaceRule,
  portionsRule,
  recipeMakesSomethingRule,
  authorsOrderRule,
]

// Every broken recipe rule at once (revising rule 1); the flow rules only for a recipe with a flow (recipe rule 10).
export const recipeProblemsFromContent = (content: RecipeContent): ReadonlyArray<RecipeProblem> => [
  ...recipeRules.flatMap((rule) => rule({ content })),
  ...Option.match(recipeFlowFromContent(content), {
    onNone: () => [],
    onSome: (flow) => recipeFlowRules.flatMap((rule) => rule({ content, flow })),
  }),
]
