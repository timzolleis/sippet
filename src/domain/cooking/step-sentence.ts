import { Option } from "effect"
import { portionsOfStep, type RecipeContent, type Step } from "../recipe/recipe-content.ts"
import { recipeFlowFromContent } from "../recipe/recipe-flow.ts"

// What a step takes, by name: a portion's name, a result's name, or the label of the step that made it.
const nameOfTaken = ({ content, key }: { readonly content: RecipeContent; readonly key: string }): string => {
  for (const step of content.steps) {
    if (step.key === key) return step.result?.name ?? step.label
    const portion = portionsOfStep(step).find((candidate) => candidate.key === key)
    if (portion !== undefined) return portion.name
  }
  return key
}

/**
 * The step's sentence; without one, its label and what it uses and takes: "verkneten (vegane Butter, mischen)"
 * (recipe rule 8).
 */
export const stepSentenceFromStep = ({ content, step }: { readonly content: RecipeContent; readonly step: Step }): string => {
  if (step.sentence !== undefined) return step.sentence
  const used = content.ingredients.filter((ingredient) => (step.uses ?? []).includes(ingredient.key)).map((ingredient) => ingredient.item)
  const taken = Option.match(recipeFlowFromContent(content), {
    onNone: () => [],
    onSome: (flow) => (flow.steps.find((stepFlow) => stepFlow.stepKey === step.key)?.takes ?? []).map((link) => nameOfTaken({ content, key: link.key })),
  })
  const names = [...new Set([...used, ...taken])]
  return names.length === 0 ? step.label : `${step.label} (${names.join(", ")})`
}
