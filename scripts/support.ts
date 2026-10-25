/// <reference types="node" />
// Shared by the local check scripts: CBOR for the software passkey, and schemas for response bodies.
import { Match, Schema } from "effect"

export type Cbor = number | string | Buffer | { readonly [key: string]: Cbor }

export const cbor = (value: Cbor): Buffer => {
  const head = (major: number, length: number) =>
    length < 24 ? Buffer.from([(major << 5) | length]) : Buffer.from([(major << 5) | 24, length])

  return Match.value(value).pipe(
    Match.when(Match.number, (number) => (number >= 0 ? head(0, number) : head(1, -1 - number))),
    Match.when(Match.string, (text) => Buffer.concat([head(3, Buffer.byteLength(text)), Buffer.from(text)])),
    Match.when(Match.instanceOf(Buffer), (bytes) => Buffer.concat([head(2, bytes.length), bytes])),
    Match.orElse((map) => {
      const entries = Object.entries(map)

      return Buffer.concat([head(5, entries.length), ...entries.flatMap(([key, item]) => [cbor(/^-?\d+$/.test(key) ? Number(key) : key), cbor(item)])])
    }),
  )
}

// `Open` keeps unlisted fields so they can still be shown.
export const Open = <const Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Json)])

export const JsonObject = Schema.Record(Schema.String, Schema.Json)

export const json = async <S extends Schema.ConstraintDecoder<unknown>>(schema: S, response: Response): Promise<S["Type"]> =>
  Schema.decodeUnknownSync(schema)(await response.json())

// Replies are plain JSON; `at` reads a path out of one without assuming its shape.
export type Json = Schema.Json

const isJsonObject = Schema.is(Schema.Record(Schema.String, Schema.Json))

export const at = (value: Json | undefined, ...path: ReadonlyArray<string | number>): Json | undefined =>
  path.reduce<Json | undefined>((node, key) => {
    if (Array.isArray(node)) return node[Number(key)]

    return isJsonObject(node) ? node[String(key)] : undefined
  }, value)

export const list = (value: Json | undefined): ReadonlyArray<Json> => (Array.isArray(value) ? value : [])
export const textOf = (value: Json | undefined): string => (Schema.is(Schema.String)(value) ? value : "")

const decodeJson = Schema.decodeUnknownSync(Schema.Json)
const protocol = "2025-06-18"

export type Outcome = { readonly isError: boolean; readonly value: Json }

// One MCP session on one token. `headers` are extra request headers (to check the Worker drops forged sippet-* ones).
export const connectMcp = async ({ origin, token, headers = {} }: { origin: string; token: string; headers?: Record<string, string> }) => {
  let session: string | null = null
  let id = 0

  const post = (body: Json) => {
    const sent = new Headers({
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": protocol,
    })

    if (session !== null) sent.set("mcp-session-id", session)

    for (const [name, value] of Object.entries(headers)) sent.set(name, value)

    return fetch(`${origin}/mcp`, { method: "POST", headers: sent, body: JSON.stringify(body) })
  }

  const init = await post({ jsonrpc: "2.0", id: ++id, method: "initialize", params: { protocolVersion: protocol, capabilities: {}, clientInfo: { name: "verify-mcp", version: "0" } } })

  if (init.status !== 200) throw new Error(`initialize answered ${init.status}`)
  session = init.headers.get("mcp-session-id")
  const initialized = decodeJson(await init.json())
  await post({ jsonrpc: "2.0", method: "notifications/initialized" })

  const request = async (method: string, params: Json = {}) => decodeJson(await (await post({ jsonrpc: "2.0", id: ++id, method, params })).json())

  const call = async (name: string, args: Json = {}): Promise<Outcome> => {
    const reply = await request("tools/call", { name, arguments: args })
    const error = at(reply, "error")

    if (error !== undefined) throw new Error(`${name}: protocol error ${JSON.stringify(error)}`)
    const isError = at(reply, "result", "isError") === true

    return { isError, value: isError ? decodeJson(JSON.parse(textOf(at(reply, "result", "content", 0, "text")))) : (at(reply, "result", "structuredContent") ?? null) }
  }

  return { call, request, initialized }
}

