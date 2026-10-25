// What tools/list sends, made smaller without changing what validates (specs/mcp.md Schema size).
// Effect's JSON Schema writes `additionalProperties: true` on every object (the JSON Schema default), a field's
// description as `allOf: [{description}]`, a literal as `{type, enum: [one]}`, and an Int's safe-integer bounds,
// which only reject numbers Effect's decoding rejects anyway.
// The tools share types (Amount, Unit, the edits), so a description is sent the first time it occurs in the list:
// add_recipe documents the edits, edit_recipe repeats only their shape.
import { Schema } from "effect"
import type { Json } from "../store/schema.ts"

const isNode = Schema.is(Schema.JsonObject)
const isText = Schema.is(Schema.String)
const isList = Schema.is(Schema.Array(Schema.Json))

const annotationKeys = ["description", "title"]

const onlyAnnotations = (node: typeof Schema.JsonObject.Type) => Object.keys(node).every((key) => annotationKeys.includes(key))

// None of `member`'s keys is in `into`, so merging changes nothing a validator checks.
const mergeable = ({ into, member }: { readonly into: typeof Schema.JsonObject.Type; readonly member: typeof Schema.JsonObject.Type }) =>
  Object.keys(member).every((key) => !(key in into))

// `{allOf: [{$ref}, {description}]}` → `{$ref, description}`: annotation-only members join the node, and a lone
// remaining member is inlined when the node holds nothing but annotations.
const withoutAnnotationAllOf = (node: typeof Schema.JsonObject.Type) => {
  const allOf = node["allOf"]

  if (!isList(allOf)) return node
  const rest = Object.fromEntries(Object.entries(node).filter(([key]) => key !== "allOf"))
  const annotations = allOf.filter((member) => isNode(member) && onlyAnnotations(member) && mergeable({ into: rest, member }))
  const kept = allOf.filter((member) => !annotations.includes(member))
  const merged = Object.assign({}, rest, ...annotations)
  const lone = kept[0] ?? null

  if (kept.length === 1 && isNode(lone) && onlyAnnotations(merged) && mergeable({ into: merged, member: lone })) return Object.assign({}, lone, merged)

  return kept.length === 0 ? merged : { ...merged, allOf: kept }
}

// `{type: "string", enum: ["add_step"]}` → `{const: "add_step"}`.
const withConst = (node: typeof Schema.JsonObject.Type) => {
  const values = node["enum"]

  if (!isList(values) || values.length !== 1) return node

  return { const: values[0] ?? null, ...Object.fromEntries(Object.entries(node).filter(([key]) => key !== "enum" && key !== "type")) }
}

const isSafeIntegerBound = ([key, value]: readonly [string, Json]) =>
  (key === "minimum" || key === "maximum") && Math.abs(Number(value)) === Number.MAX_SAFE_INTEGER

// `described` holds the descriptions sent so far in this tools/list; a repeated one is dropped.
export const compactJsonSchema = ({ schema, described }: { readonly schema: Json; readonly described: Set<string> }): Json => {
  if (isList(schema)) return schema.map((member) => compactJsonSchema({ schema: member, described }))

  if (!isNode(schema)) return schema

  const entries = Object.entries(schema).flatMap(([key, value]): ReadonlyArray<readonly [string, Json]> => {
    if (key === "additionalProperties" && value === true) return []

    if (isSafeIntegerBound([key, value])) return []

    if (key === "description" && isText(value)) {
      const repeated = described.has(value)
      described.add(value)

      return repeated ? [] : [[key, value]]
    }

    // `enum` and `const` hold values, not schemas
    return [[key, key === "enum" || key === "const" ? value : compactJsonSchema({ schema: value, described })]]
  })

  return withConst(withoutAnnotationAllOf(Object.fromEntries(entries)))
}

// MCP wants an object root; a union (a result or a Refusal) has none of its own.
export const compactOutputSchema = ({ schema, described }: { readonly schema: Json; readonly described: Set<string> }): Json => {
  const compacted = compactJsonSchema({ schema, described })

  return isNode(compacted) && compacted["type"] === undefined ? Object.assign({ type: "object" }, compacted) : compacted
}
