import { Result } from "effect"

// The first rejection wins.
export const checkRules = <Input, E>(
  rules: ReadonlyArray<(input: Input) => Result.Result<void, E>>,
  input: Input,
): Result.Result<void, E> => {
  for (const rule of rules) {
    const ruleResult = rule(input)

    if (Result.isFailure(ruleResult)) return ruleResult
  }

  return Result.succeed(undefined)
}
