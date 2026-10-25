// Retry keys (specs/mcp.md#retries): (connection, tool, sha256(canonical JSON of the arguments)).
import { createHash } from "node:crypto"
import { Predicate } from "effect"
import type { Json } from "./schema.ts"

export const retryWindowMs = 10 * 60 * 1000

// Json, and undefined where a field or array item was left out.
export type CanonicalValue = Json | undefined | ReadonlyArray<CanonicalValue> | { readonly [key: string]: CanonicalValue }

// Object keys sorted at every depth, so the same arguments in another key order hash the same.
export const canonicalJson = (value: CanonicalValue): string => {
  if (value === undefined || value === null) return "null"

  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`

  if (Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value)) return JSON.stringify(value)

  const fields = Object.entries(value)
    .filter(([, field]) => field !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, field]) => `${JSON.stringify(key)}:${canonicalJson(field)}`)

  return `{${fields.join(",")}}`
}

export type RetryKey = { readonly connection: string; readonly tool: string; readonly argsHash: string }

export const retryKey = ({ connection, tool, args }: { connection: string; tool: string; args: CanonicalValue }): RetryKey => ({
  connection,
  tool,
  argsHash: createHash("sha256").update(canonicalJson(args)).digest("hex"),
})
