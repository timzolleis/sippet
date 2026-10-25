// Retry keys (specs/mcp.md#retries): (connection, tool, sha256(canonical JSON of the arguments)).
import { createHash } from "node:crypto"

export const retryWindowMs = 10 * 60 * 1000

// Object keys sorted at every depth, so the same arguments in another key order hash the same.
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`
  if (typeof value === "object" && value !== null) {
    const fields = Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, field]) => `${JSON.stringify(key)}:${canonicalJson(field)}`)
    return `{${fields.join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

export type RetryKey = { readonly connection: string; readonly tool: string; readonly argsHash: string }

export const retryKey = ({ connection, tool, args }: { connection: string; tool: string; args: unknown }): RetryKey => ({
  connection,
  tool,
  argsHash: createHash("sha256").update(canonicalJson(args)).digest("hex"),
})
