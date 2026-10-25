// Measures CPU per MCP request in Node: JWT check + Effect MCP + decode + edits + recipe rules.
import { exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT } from "jose"
import { makeHandler } from "./src/app.ts"
import { lessSugarEdits, zupfkuchenEdits } from "./src/zupfkuchen.ts"

const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000 }

const { publicKey, privateKey } = await generateKeyPair("ES256")
const jwk = await exportJWK(publicKey)
const token = await new SignJWT({ sub: "cook_1", aud: "https://sippet.example/mcp" })
  .setProtectedHeader({ alg: "ES256" }).setIssuer("https://sippet.example").setExpirationTime("1h").sign(privateKey)

let t = cpu()
const { handler } = makeHandler()
const verifyKey = await importJWK(jwk, "ES256")
const buildMs = cpu() - t

const base = { accept: "application/json, text/event-stream", "content-type": "application/json", authorization: `Bearer ${token}` }
let session: string | null = null
const PROTOCOL = process.env.PROTOCOL ?? "2025-06-18"

const call = async (body: unknown, extra: Record<string, string> = {}) => {
  const req = new Request("http://localhost/mcp", {
    method: "POST",
    headers: { ...base, ...(session ? { "mcp-session-id": session } : {}), "mcp-protocol-version": PROTOCOL, ...extra },
    body: JSON.stringify(body)
  })
  // edge: verify the bearer token, as the Worker would
  await jwtVerify(req.headers.get("authorization")!.slice(7), verifyKey, { issuer: "https://sippet.example", audience: "https://sippet.example/mcp" })
  const res = await handler(req)
  return { res, text: await res.text() }
}

t = cpu()
const init = await call({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "bench", version: "1" } } })
session = init.res.headers.get("mcp-session-id")
await call({ jsonrpc: "2.0", method: "notifications/initialized" })
const initMs = cpu() - t
if (init.res.status !== 200) throw new Error(`initialize: ${init.res.status} ${init.text}`)

let id = 1
const tool = (name: string, args: unknown) => call({ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name, arguments: args } })

// first add_recipe: cold path for decode + rules
t = cpu()
const first = await tool("add_recipe", { title: "Veganer Russischer Zupfkuchen", edits: zupfkuchenEdits })
const firstAddMs = cpu() - t
console.log("first add_recipe response:", first.text.slice(0, 300))

const measure = async (label: string, n: number, f: (i: number) => Promise<unknown>) => {
  for (let i = 0; i < 50; i++) await f(i) // warm up
  const start = cpu()
  for (let i = 0; i < n; i++) await f(i)
  console.log(`${label}: ${((cpu() - start) / n).toFixed(2)} ms CPU per request (avg of ${n})`)
}

console.log(`protocol ${PROTOCOL}, session ${session ?? "none"}`)
console.log(`build handler: ${buildMs.toFixed(1)} ms, initialize: ${initMs.toFixed(1)} ms, first add_recipe: ${firstAddMs.toFixed(1)} ms`)
await measure("add_recipe (Zupfkuchen, 58 edits)", 500, () => tool("add_recipe", { title: "Zupfkuchen", edits: zupfkuchenEdits }))
let rev = 1
await measure("edit_recipe (2 edits)", 500, async () => {
  const r = await tool("edit_recipe", { recipeId: "rcp_1", fromRevision: rev, edits: lessSugarEdits })
  const body = JSON.parse(r.text)
  if (body.result.structuredContent.problems.length > 0) throw new Error(JSON.stringify(body.result.structuredContent))
  rev = body.result.structuredContent.revision
})
console.log(`edit_recipe reached revision ${rev}`)
await measure("tools/list", 500, () => call({ jsonrpc: "2.0", id: id++, method: "tools/list", params: {} }))
