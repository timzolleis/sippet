// Runs the bench flow against a running Worker: `node remote.ts <base-url>`.
// Prints wall time; CPU comes from Workers Logs / dashboard (or `wrangler tail --format json`).
import { readFileSync } from "node:fs"
import { lessSugarEdits, zupfkuchenEdits } from "./src/zupfkuchen.ts"

const baseUrl = process.argv[2] ?? "http://localhost:8787"
const token = readFileSync(new URL("./.token", import.meta.url), "utf8").trim()
const PROTOCOL = process.env.PROTOCOL ?? "2025-06-18"
const N = Number(process.env.N ?? 20)
let session: string | null = null
let id = 0

const call = async (body: unknown) => {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": PROTOCOL,
      ...(session ? { "mcp-session-id": session } : {})
    },
    body: JSON.stringify(body)
  })
  return { res, text: await res.text() }
}
const tool = async (name: string, args: unknown) => {
  const r = await call({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } })
  return JSON.parse(r.text).result.structuredContent as { recipeId: string; revision: number; problems: Array<string> }
}

const init = await call({ jsonrpc: "2.0", id: ++id, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "remote", version: "1" } } })
if (init.res.status !== 200) throw new Error(`initialize ${init.res.status}: ${init.text}`)
session = init.res.headers.get("mcp-session-id")
await call({ jsonrpc: "2.0", method: "notifications/initialized" })
console.log(`session ${session}`)

const added = await tool("add_recipe", { title: "Zupfkuchen", edits: zupfkuchenEdits })
console.log("add_recipe", added)
let rev = added.revision
const t0 = performance.now()
for (let i = 0; i < N; i++) {
  const r = await tool("edit_recipe", { recipeId: added.recipeId, fromRevision: rev, edits: lessSugarEdits })
  if (r.problems.length) throw new Error(JSON.stringify(r))
  rev = r.revision
}
console.log(`edit_recipe x${N}: revision ${rev}, ${((performance.now() - t0) / N).toFixed(0)} ms wall per call`)
for (let i = 0; i < N; i++) await tool("add_recipe", { title: "Zupfkuchen", edits: zupfkuchenEdits })
console.log(`add_recipe x${N}: done`)
