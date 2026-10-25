import { Match, Option } from "effect"
import type { Amount } from "./amount.ts"
import { keysOfContent } from "./apply-recipe-edits.ts"
import type { Key } from "./key.ts"
import { isStepResultSplit, portionsOfStep, type RecipeContent, type Step } from "./recipe-content.ts"
import { recipeFlowFromContent, type FlowLink, type RecipeFlow, type StepFlow } from "./recipe-flow.ts"
import type { RecipeProblem, RecipeRuleName } from "./recipe-problem.ts"
import { isCustomUnit, valueInUnit, type Unit } from "./unit.ts"

export type RecipeRuleInput = { readonly content: RecipeContent }

export type RecipeFlowRuleInput = { readonly content: RecipeContent; readonly flow: RecipeFlow }

export type RecipeRule = (input: RecipeRuleInput) => ReadonlyArray<RecipeProblem>

export type RecipeFlowRule = (input: RecipeFlowRuleInput) => ReadonlyArray<RecipeProblem>

const brokenRule = (problem: { readonly rule: RecipeRuleName; readonly message: string; readonly fix: string }): RecipeProblem => problem

const quoted = (key: Key) => `"${key}"`

const listed = (words: ReadonlyArray<string>) =>
  words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`

// "(derived: join)" for a link a derivation made (specs/mcp.md, Refusals).
const derivedNote = (link: FlowLink) => link.source === "named" ? "" : ` (derived: ${link.source})`

const unitText = (unit: Unit | undefined) => unit === undefined ? "" : isCustomUnit(unit) ? ` ${unit.custom}` : ` ${unit}`

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

// How to stop a derivation from taking `takenKey` (recipe rule 11: a named `takes` replaces the derived links).
const optOutOfDerivedTake = ({ taken, takenKey }: { readonly taken: TakenLink; readonly takenKey: Key }): ReadonlyArray<string> =>
  Match.value(taken.link.source).pipe(
    Match.when("chain", () => [`set takes: [] on ${quoted(taken.takerKey)} to stop it chaining ${quoted(takenKey)}`]),
    Match.when("join", () => [`set takes on ${quoted(taken.takerKey)} to what it takes, without ${quoted(takenKey)}, to stop it joining ${quoted(takenKey)}`]),
    Match.orElse(() => []),
  )

// The step a link points at: the step itself, or the step whose result a portion splits.
const stepKeyByLinkKey = (content: RecipeContent): ReadonlyMap<Key, Key> =>
  new Map(content.steps.flatMap((step) => [
    [step.key, step.key] as const,
    ...portionsOfStep(step).map((portion) => [portion.key, step.key] as const),
  ]))

// 1. Title, ingredient, step.
export const titleIngredientAndStepRule: RecipeRule = ({ content }) => [
  ...(content.title.trim() === ""
    ? [brokenRule({ rule: "title-ingredient-step", message: "the recipe has no title", fix: "give it a title" })]
    : []),
  ...(content.ingredients.length === 0
    ? [brokenRule({ rule: "title-ingredient-step", message: "the recipe has no ingredient", fix: "add at least one ingredient with add_ingredient" })]
    : []),
  ...(content.steps.length === 0
    ? [brokenRule({ rule: "title-ingredient-step", message: "the recipe has no step", fix: "add at least one step with add_step" })]
    : []),
]

const missing = (message: string, fix: string) => [brokenRule({ rule: "everything-named-exists", message, fix })]

// What a step names in `takes`: an ingredient key belongs in `uses`. When takes names only ingredients,
// moving them leaves takes empty, which means "nothing"; omitted, the derived chain applies again.
const takesProblemsOfStep = ({ step, ingredientKeys, takeableKeys }: {
  readonly step: Step
  readonly ingredientKeys: ReadonlySet<Key>
  readonly takeableKeys: ReadonlyMap<Key, Key>
}): ReadonlyArray<RecipeProblem> => {
  const takes = step.takes ?? []
  const onlyIngredients = takes.every((key) => ingredientKeys.has(key))

  return takes.flatMap((key) => {
    if (takeableKeys.has(key)) return []

    if (!ingredientKeys.has(key)) {
      return missing(
        `step ${quoted(step.key)} takes no result or portion ${quoted(key)}`,
        `name an earlier step or portion key, or drop ${quoted(key)} from the takes of ${quoted(step.key)}`,
      )
    }

    return missing(
      `step ${quoted(step.key)} takes the ingredient ${quoted(key)}; takes is for results of earlier steps and portions`,
      onlyIngredients
        ? `move ${quoted(key)} from takes to uses on ${quoted(step.key)}, and omit takes there (null in edit_step) so ${quoted(step.key)} keeps the derived chain`
        : `move ${quoted(key)} from takes to uses on ${quoted(step.key)}`,
    )
  })
}

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
      ? missing(`the yield's vessel ${quoted(vessel)} is no equipment`, `add_equipment ${quoted(vessel)}, or set the yield's vessel to an equipment key`)
      : []),
    ...content.ingredients.flatMap((ingredient) =>
      ingredient.section !== undefined && !sectionKeys.has(ingredient.section)
        ? missing(
          `ingredient ${quoted(ingredient.key)} is in no section ${quoted(ingredient.section)}`,
          `add_section ${quoted(ingredient.section)}, or drop the section of ${quoted(ingredient.key)}`,
        )
        : []
    ),
    ...content.steps.flatMap((step) => [
      ...(step.section !== undefined && !sectionKeys.has(step.section)
        ? missing(`step ${quoted(step.key)} is in no section ${quoted(step.section)}`, `add_section ${quoted(step.section)}, or drop the section of ${quoted(step.key)}`)
        : []),
      ...(step.equipment ?? []).flatMap((key) =>
        equipmentKeys.has(key)
          ? []
          : missing(`step ${quoted(step.key)} names no equipment ${quoted(key)}`, `add_equipment ${quoted(key)}, or drop it from the equipment of ${quoted(step.key)}`)
      ),
      ...(step.uses ?? []).flatMap((key) => {
        if (ingredientKeys.has(key)) return []

        return takeableKeys.has(key)
          ? missing(
            `step ${quoted(step.key)} uses ${quoted(key)}, which is a step's result or a portion, not an ingredient; uses is for ingredient keys`,
            `move ${quoted(key)} from uses to takes on ${quoted(step.key)}`,
          )
          : missing(`step ${quoted(step.key)} uses no ingredient ${quoted(key)}`, `add_ingredient ${quoted(key)}, or drop it from the uses of ${quoted(step.key)}`)
      }),
      ...takesProblemsOfStep({ step, ingredientKeys, takeableKeys }),
      ...(step.waitsFor ?? []).flatMap((key) =>
        stepKeys.has(key)
          ? []
          : missing(`step ${quoted(step.key)} waits for no step ${quoted(key)}`, `name an earlier step key, or drop ${quoted(key)} from the waitsFor of ${quoted(step.key)}`)
      ),
    ]),
  ]
}

// 20. Keys are unique in the recipe.
export const uniqueKeysRule: RecipeRule = ({ content }) => {
  const counts = new Map<Key, number>()

  for (const key of keysOfContent(content)) counts.set(key, (counts.get(key) ?? 0) + 1)

  return [...counts].flatMap(([key, count]) =>
    count > 1
      ? [brokenRule({ rule: "keys", message: `key ${quoted(key)} is used ${count} times`, fix: `give each of them its own key, e.g. ${quoted(`${key}-2`)}` })]
      : []
  )
}

// 11. A prep step uses and takes nothing, so it makes nothing, and nothing can take it; waiting for it is how to follow it.
export const prepStepsMakeNothingRule: RecipeFlowRule = ({ content, flow }) => {
  const makesByStepKey = new Map(flow.steps.map((stepFlow) => [stepFlow.stepKey, stepFlow.makes]))

  return [
    ...content.steps.flatMap((step) =>
      makesByStepKey.get(step.key) === false && step.result !== undefined
        ? [brokenRule({
          rule: "flow-is-derived",
          message: `step ${quoted(step.key)} uses and takes nothing, so it makes nothing (prep step), but has a result`,
          fix: `drop the result of ${quoted(step.key)}, or name what it uses or takes`,
        })]
        : []
    ),
    ...flow.steps.flatMap((stepFlow) =>
      stepFlow.takes.flatMap((link) =>
        makesByStepKey.get(link.key) === false
          ? [brokenRule({
            rule: "flow-is-derived",
            message: `step ${quoted(stepFlow.stepKey)} takes ${quoted(link.key)}, which makes nothing (prep step)${derivedNote(link)}`,
            fix: `move ${quoted(link.key)} from takes to waitsFor on ${quoted(stepFlow.stepKey)}`,
          })]
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

const fieldOfEdge = (edge: FlowEdge) => edge.verb === "takes" ? "takes" : "waitsFor"

const dropEdgeText = (edge: FlowEdge) => `drop ${quoted(edge.link.key)} from the ${fieldOfEdge(edge)} of ${quoted(edge.fromKey)}`

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

  // Derived links always point back, so a loop has a named link to drop.
  return [...loops.values()].map((loop) =>
    brokenRule({
      rule: "no-loops",
      message: `loop: ${loop.map(edgeText).join(", ")}`,
      fix: `a step can only take or wait for earlier steps: ${loop.filter((edge) => edge.link.source === "named").map(dropEdgeText).join(", or ")}`,
    })
  )
}

// 14. Every ingredient is used by exactly one step.
export const everyIngredientToOneStepRule: RecipeFlowRule = ({ content }) =>
  content.ingredients.flatMap((ingredient) => {
    const users = content.steps.filter((step) => (step.uses ?? []).includes(ingredient.key)).map((step) => step.key)

    if (users.length === 0) {
      return [brokenRule({
        rule: "every-ingredient-goes-to-one-step",
        message: `ingredient ${quoted(ingredient.key)} is used by no step`,
        fix: `add ${quoted(ingredient.key)} to the uses of the step it goes into, or remove it`,
      })]
    }

    if (users.length > 1) {
      return [brokenRule({
        rule: "every-ingredient-goes-to-one-step",
        message: `ingredient ${quoted(ingredient.key)} is used by ${listed(users.map(quoted))}`,
        fix: `keep ${quoted(ingredient.key)} in the uses of one step; for the others add another ingredient of the item ${JSON.stringify(ingredient.item)} with its own key and amount`,
      })]
    }

    return []
  })

// 15. A result, or a portion, is taken by at most one step.
export const resultToOnePlaceRule: RecipeFlowRule = ({ content, flow }) => {
  const takers = takersByKey(flow)

  return content.steps.flatMap((step) => [
    ...(isStepResultSplit(step) ? [] : [{ key: step.key, what: "result of", isPortion: false }]),
    ...portionsOfStep(step).map((portion) => ({ key: portion.key, what: "portion", isPortion: true })),
  ]).flatMap(({ key, what, isPortion }) => {
    const takenBy = takers.get(key) ?? []

    if (takenBy.length <= 1) return []
    const optOuts = takenBy.flatMap((taken) => optOutOfDerivedTake({ taken, takenKey: key }))

    const named = isPortion
      ? `drop ${quoted(key)} from the takes of all steps but one`
      : `split the result of ${quoted(key)} (result.split) into one portion per step, and let each take its portion`

    return [brokenRule({
      rule: "result-goes-to-one-place",
      message: `${what} ${quoted(key)} is taken by ${listed(takenBy.map(takerText))}`,
      fix: [...optOuts, named].join("; or "),
    })]
  })
}

const totalInUnit = ({ amounts, unit }: { readonly amounts: ReadonlyArray<Amount>; readonly unit: Unit | undefined }): number | undefined =>
  amounts.reduce<number | undefined>((total, amount) => {
    const value = valueInUnit({ value: amount.value, from: amount.unit, to: unit })

    return total === undefined || value === undefined ? undefined : total + value
  }, 0)

const portionsBroken = (message: string, fix: string) => [brokenRule({ rule: "portions", message, fix })]

const wholeSplitTakenFix = ({ taken, step }: { readonly taken: TakenLink; readonly step: Step }) => {
  const portions = listed(portionsOfStep(step).map((portion) => quoted(portion.key)))

  return taken.link.source === "chain"
    ? `${quoted(taken.takerKey)} chains ${quoted(step.key)}, which is split: set takes on ${quoted(taken.takerKey)} to the portions it gets (${portions})`
    : `in the takes of ${quoted(taken.takerKey)}, replace ${quoted(step.key)} with the portions it gets (${portions})`
}

const portionProblemsOfStep = ({ step, takers }: { readonly step: Step; readonly takers: ReadonlyMap<Key, ReadonlyArray<TakenLink>> }): ReadonlyArray<RecipeProblem> => {
  const portions = portionsOfStep(step)
  const resultAmount = step.result?.amount
  const portionAmounts = portions.flatMap((portion) => portion.amount === undefined ? [] : [portion.amount])
  const portionsTotal = resultAmount === undefined ? undefined : totalInUnit({ amounts: portionAmounts, unit: resultAmount.unit })
  const rests = portions.filter((portion) => portion.rest === true)

  return [
    ...(takers.get(step.key) ?? []).flatMap((taken) =>
      portionsBroken(`step ${takerText(taken)} takes the whole result of ${quoted(step.key)}, which is split`, wholeSplitTakenFix({ taken, step }))
    ),
    ...portions.flatMap((portion) =>
      portion.amount === undefined && portion.rest !== true
        ? portionsBroken(
          `portion ${quoted(portion.key)} of ${quoted(step.key)} has no amount; only the rest may have none`,
          `give ${quoted(portion.key)} an amount, or set rest: true on it (one portion at most)`,
        )
        : []
    ),
    ...(rests.length > 1
      ? portionsBroken(`${quoted(step.key)} has ${rests.length} portions that are the rest; at most one may be`, "keep rest: true on one portion and give the others amounts")
      : []),
    ...(resultAmount !== undefined && portionsTotal !== undefined && portionsTotal > (resultAmount.max ?? resultAmount.value)
      ? portionsBroken(
        `portions of ${quoted(step.key)} (${amountText({ value: portionsTotal, unit: resultAmount.unit })}) exceed its result (${amountText({ value: resultAmount.max ?? resultAmount.value, unit: resultAmount.unit })})`,
        `lower the portions' amounts, mark one as rest: true without an amount, or raise the result's amount`,
      )
      : []),
    ...portions.flatMap((portion) =>
      (takers.get(portion.key) ?? []).length === 0
        ? portionsBroken(
          `portion ${quoted(portion.key)} of ${quoted(step.key)} is taken by no step`,
          `name ${quoted(portion.key)} in the takes of the later step that gets it, or remove the portion`,
        )
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
  flow.makes.length === 0
    ? [brokenRule({
      rule: "what-the-recipe-makes",
      message: "the flow makes nothing: every result is taken or waited for",
      fix: "leave the last step's result untaken: no step may take or wait for it",
    })]
    : []

// 19. Each step comes after every step it takes from or waits for.
export const authorsOrderRule: RecipeFlowRule = ({ content, flow }) => {
  const stepKeyByLink = stepKeyByLinkKey(content)
  const indexByStepKey = new Map(content.steps.map((step, index) => [step.key, index]))

  return flow.steps.flatMap((stepFlow) =>
    edgesOfStep({ stepFlow, stepKeyByLink }).flatMap((edge) =>
      (indexByStepKey.get(edge.toKey) ?? 0) > (indexByStepKey.get(edge.fromKey) ?? 0)
        ? [brokenRule({
          rule: "authors-order",
          message: `step ${edgeText(edge)}, which comes after it`,
          fix: `move_step ${quoted(edge.fromKey)} to after ${quoted(edge.toKey)}, or ${dropEdgeText(edge)}`,
        })]
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
