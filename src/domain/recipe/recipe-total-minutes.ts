import type { RecipeContent } from "./recipe-content.ts"

// The sum of each step's longest duration; none if no step has one (specs/mcp.md Types).
export const recipeTotalMinutesFromContent = (content: RecipeContent): number | undefined => {
  const durations = content.steps.flatMap((step) => step.duration === undefined ? [] : [step.duration])
  return durations.length === 0
    ? undefined
    : durations.reduce((total, duration) => total + (duration.maxMinutes ?? duration.minutes), 0)
}
