import { Option } from "effect"
import type { Key } from "./key.ts"
import { isStepResultSplit, portionsOfStep, type RecipeContent, type Step } from "./recipe-content.ts"

// Where a link comes from: the step names it, or a derivation of recipe rule 11 made it.
export type FlowLinkSource = "named" | "chain" | "join" | "prep step"

// A link to a step's result or a portion (takes), or to a step (waitsFor).
export type FlowLink = { readonly key: Key; readonly source: FlowLinkSource }

export type StepFlow = {
  readonly stepKey: Key
  readonly takes: ReadonlyArray<FlowLink>
  readonly waitsFor: ReadonlyArray<FlowLink>
  // false for a prep step: it uses and takes nothing (recipe rule 11)
  readonly makes: boolean
}

export type RecipeFlow = {
  readonly steps: ReadonlyArray<StepFlow>
  // the steps whose result nobody takes or waits for (recipe rule 18)
  readonly makes: ReadonlyArray<Key>
}

const usesSomething = (step: Step) => (step.uses?.length ?? 0) > 0

// Either no step names ingredients (plain steps) or the recipe has a flow (recipe rule 10).
export const recipeHasFlow = (content: RecipeContent): boolean => content.steps.some(usesSomething)

const namedLinks = (keys: ReadonlyArray<Key>): ReadonlyArray<FlowLink> => keys.map((key) => ({ key, source: "named" }))

const sharesEquipment = (a: Step, b: Step) => (a.equipment ?? []).some((key) => (b.equipment ?? []).includes(key))

// Chain: the nearest earlier step in the same section that makes something. Steps without a section are one section.
const chainedLink = ({ steps, makes, index }: {
  readonly steps: ReadonlyArray<Step>; readonly makes: ReadonlyArray<boolean>; readonly index: number
}): ReadonlyArray<FlowLink> => {
  const section = steps[index]?.section
  for (let earlier = index - 1; earlier >= 0; earlier--) {
    const step = steps[earlier]
    if (step !== undefined && step.section === section && makes[earlier]) return [{ key: step.key, source: "chain" }]
  }
  return []
}

/**
 * Join, for a step without a section: the latest result of each section whose steps came since the previous step
 * without a section, and every portion no step has taken yet. A split result joins as its portions.
 * A portion some step names in its own `takes` is left to that step.
 */
const joinedLinks = ({ steps, makes, takesByStep, index }: {
  readonly steps: ReadonlyArray<Step>
  readonly makes: ReadonlyArray<boolean>
  readonly takesByStep: ReadonlyArray<ReadonlyArray<FlowLink>>
  readonly index: number
}): ReadonlyArray<FlowLink> => {
  let previousWithoutSection = index - 1
  while (previousWithoutSection >= 0 && steps[previousWithoutSection]?.section !== undefined) previousWithoutSection--
  const sectionsSince: Array<Key> = []
  const latestMakerBySection = new Map<Key, Step>()
  for (let earlier = previousWithoutSection + 1; earlier < index; earlier++) {
    const step = steps[earlier]
    if (step?.section === undefined) continue
    if (!sectionsSince.includes(step.section)) sectionsSince.push(step.section)
    if (makes[earlier]) latestMakerBySection.set(step.section, step)
  }
  const sectionResults = sectionsSince.flatMap((section): ReadonlyArray<FlowLink> => {
    const step = latestMakerBySection.get(section)
    return step === undefined || isStepResultSplit(step) ? [] : [{ key: step.key, source: "join" }]
  })

  const takenSoFar = new Set(takesByStep.slice(0, index).flat().map((link) => link.key))
  const namedAnywhere = new Set(steps.flatMap((step) => step.takes ?? []))
  const untakenPortions: ReadonlyArray<FlowLink> = steps
    .slice(0, index)
    .flatMap((step) => portionsOfStep(step))
    .filter((portion) => !takenSoFar.has(portion.key) && !namedAnywhere.has(portion.key))
    .map((portion) => ({ key: portion.key, source: "join" }))

  return [...sectionResults, ...untakenPortions]
}

// Prep steps: the next step with the same equipment waits for a step that makes nothing.
const preppedLinks = ({ steps, makes }: {
  readonly steps: ReadonlyArray<Step>; readonly makes: ReadonlyArray<boolean>
}): ReadonlyArray<ReadonlyArray<FlowLink>> => {
  const waitsForByStep: Array<Array<FlowLink>> = steps.map(() => [])
  steps.forEach((prepStep, index) => {
    if (makes[index]) return
    const next = steps.findIndex((step, later) => later > index && sharesEquipment(prepStep, step))
    if (next >= 0) waitsForByStep[next]?.push({ key: prepStep.key, source: "prep step" })
  })
  return waitsForByStep
}

/**
 * The flow derived from the steps' ingredients, sections, equipment, and order (recipe rule 11), merged with what
 * steps name themselves. None for plain steps (recipe rule 10).
 */
export const recipeFlowFromContent = (content: RecipeContent): Option.Option<RecipeFlow> => {
  if (!recipeHasFlow(content)) return Option.none()
  const steps = content.steps
  const makes: Array<boolean> = []
  const takesByStep: Array<ReadonlyArray<FlowLink>> = []
  steps.forEach((step, index) => {
    const takes = step.takes !== undefined
      ? namedLinks(step.takes)
      : [
        ...chainedLink({ steps, makes, index }),
        ...(step.section === undefined ? joinedLinks({ steps, makes, takesByStep, index }) : []),
      ]
    takesByStep.push(takes)
    makes.push(usesSomething(step) || takes.length > 0)
  })
  const derivedWaitsForByStep = preppedLinks({ steps, makes })
  const stepFlows: ReadonlyArray<StepFlow> = steps.map((step, index) => ({
    stepKey: step.key,
    takes: takesByStep[index] ?? [],
    waitsFor: step.waitsFor !== undefined ? namedLinks(step.waitsFor) : derivedWaitsForByStep[index] ?? [],
    makes: makes[index] ?? false,
  }))
  const takenOrWaitedFor = new Set(stepFlows.flatMap((stepFlow) => [...stepFlow.takes, ...stepFlow.waitsFor].map((link) => link.key)))
  return Option.some({
    steps: stepFlows,
    makes: steps
      .filter((step, index) => makes[index] && !isStepResultSplit(step) && !takenOrWaitedFor.has(step.key))
      .map((step) => step.key),
  })
}
