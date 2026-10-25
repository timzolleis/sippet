import { describe, expect, it } from "vitest"
import { canonicalJson, retryKey } from "../../src/store/retry.ts"

describe("canonicalJson", () => {
  it("sorts object keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 2], c: null } })).toBe('{"a":{"c":null,"d":[3,2]},"b":1}')
  })
  it("leaves out undefined fields, like JSON", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }))
  })
})

describe("retryKey", () => {
  const base = { connection: "c1", tool: "add_recipe", args: { title: "Zupfkuchen", edits: [{ op: "set_title", title: "x" }] } }
  it("is the same for the same arguments in another key order", () => {
    const reordered = { ...base, args: { edits: [{ title: "x", op: "set_title" }], title: "Zupfkuchen" } }
    expect(retryKey(reordered)).toEqual(retryKey(base))
  })
  it("differs by connection, tool, and arguments", () => {
    const key = retryKey(base)
    expect(retryKey({ ...base, connection: "c2" })).not.toEqual(key)
    expect(retryKey({ ...base, tool: "edit_recipe" })).not.toEqual(key)
    expect(retryKey({ ...base, args: { ...base.args, title: "Other" } })).not.toEqual(key)
  })
  it("keeps array order significant", () => {
    expect(retryKey({ ...base, args: { ids: [1, 2] } })).not.toEqual(retryKey({ ...base, args: { ids: [2, 1] } }))
  })
  it("hashes to sha256 hex", () => {
    expect(retryKey(base).argsHash).toMatch(/^[0-9a-f]{64}$/)
  })
})
