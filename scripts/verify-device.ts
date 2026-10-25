/// <reference types="node" />
// The device API end to end against `pnpm dev` (specs/device-api.md Verify 4 and the live / edge Cases that need the Worker or a DO).
// Needs a device token from `pnpm device-token` (the auth lane): SIPPET_REFRESH_TOKEN. Optional, each unlocks more checks:
//   SIPPET_CLAUDE_TOKEN    a Claude (DCR) access token of the SAME cook: Claude adds a recipe; also the 401 check on /api/device/*
//   SIPPET_SESSION_COOKIE  the cook's account session cookie: disconnects "Sippet app" (POST /api/connections/sippet-app/disconnect)
//   SIPPET_WAIT_FOR_EXPIRY=1  waits for the access token to expire (about an hour), then makes a change
// Run: SIPPET_REFRESH_TOKEN=… node scripts/verify-device.ts [http://localhost:1337]
import { Schema } from "effect"
import { at, list, type Json } from "./support.ts"

const origin = process.argv[2] ?? "http://localhost:1337"
const wsOrigin = origin.replace(/^http/, "ws")
const refreshToken = process.env["SIPPET_REFRESH_TOKEN"]
const claudeToken = process.env["SIPPET_CLAUDE_TOKEN"]
const sessionCookie = process.env["SIPPET_SESSION_COOKIE"]

if (refreshToken === undefined) throw new Error("set SIPPET_REFRESH_TOKEN from `pnpm device-token`")

const step = (text: string) => console.log(`\n── ${text}`)
const skip = (label: string) => console.log(`   skip ${label}`)

const check = (label: string, ok: boolean, detail?: Json) => {
  console.log(`   ${ok ? "ok  " : "FAIL"} ${label}${ok || detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`)

  if (!ok) process.exitCode = 1
}

const Tokens = Schema.Struct({ access_token: Schema.String, refresh_token: Schema.String })
const decodeJson = Schema.decodeUnknownSync(Schema.Json)

// A refresh rotates the token: keep the newest.
let currentRefresh: string = refreshToken

const accessToken = async (): Promise<string> => {
  const response = await fetch(`${origin}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: currentRefresh, client_id: "sippet-app", resource: `${origin}/mcp` }),
  })

  if (response.status !== 200) throw new Error(`refresh answered ${response.status}`)
  const tokens = Schema.decodeUnknownSync(Tokens)(await response.json())
  currentRefresh = tokens.refresh_token

  return tokens.access_token
}

const deviceHeaders = (token: string, deviceId = "6f1d1c7e-0c5a-4c55-9d52-3a1b0f6a9a01") => ({
  authorization: `Bearer ${token}`,
  "x-device-id": deviceId,
  "x-device-name": "verify-device",
  "content-type": "application/json",
})

const device = async (token: string, path: string, body?: Json) => {
  const response = await fetch(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: deviceHeaders(token), body: body === undefined ? null : JSON.stringify(body) })
  const text = await response.text()

  return { status: response.status, body: text === "" ? null : decodeJson(JSON.parse(text)) }
}

// A live socket with its messages and close code. Bearer goes in the header; the Worker forwards the upgrade.
const openLive = async (token: string) => {
  const messages: Array<Json> = []
  let closed: number | undefined
  // SAFETY: Node's WebSocket (undici) takes {headers} as its second argument; the DOM typings don't know it.
  const socket = new WebSocket(`${wsOrigin}/api/device/live`, { headers: deviceHeaders(token) } as never)
  socket.addEventListener("message", (event) => messages.push(decodeJson(JSON.parse(String(event.data)))))
  socket.addEventListener("close", (event) => void (closed = event.code))
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve())
    socket.addEventListener("error", () => reject(new Error("the upgrade failed")))
  })

  const until = async (done: () => boolean, ms = 1000) => {
    const deadline = Date.now() + ms

    while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))

    return done()
  }

  return { messages, closedCode: () => closed, until, socket }
}

const seqOf = (value: Json | undefined) => Number(at(value, "seq"))

// A change the cook's other hand makes: Claude when we have its token, else this device's own library edit.
const makeChange = async (token: string) => {
  if (claudeToken === undefined) return (await device(token, "/api/device/library/edits", { edits: [{ op: "create_collection", name: `Live ${Date.now()}`, recipeIds: [] }] })).status === 200

  const { connectMcp } = await import("./support.ts")
  const claude = await connectMcp({ origin, token: claudeToken })
  const added = await claude.call("add_recipe", { title: `Live ${Date.now()}`, yield: { amount: { value: 1, unit: "serving" } }, edits: [{ op: "add_ingredient", key: "a", item: "Mehl" }, { op: "add_step", key: "s", label: "mischen", uses: ["a"] }] })

  return !added.isError
}

step("edge: tokens (account rules 6, 8)")

if (claudeToken === undefined) skip("Claude's token on /api/device/library → 401 (SIPPET_CLAUDE_TOKEN)")
else check("Claude's token on /api/device/library → 401", (await device(claudeToken, "/api/device/library")).status === 401)

step("read: library and catch-up")

const token = await accessToken()
const library = await device(token, "/api/device/library")

check("getLibrary answers 200 with seq", library.status === 200 && Number.isInteger(at(library.body, "seq")), library.body)

const seq = seqOf(library.body)
const empty = await device(token, `/api/device/changes?after=${seq}`)

check("listChangesAfter at the last seq: nothing", empty.status === 200 && list(at(empty.body, "changes")).length === 0 && list(at(empty.body, "recipes")).length === 0, empty.body)

check("listChangesAfter ahead of the log → 409", (await device(token, `/api/device/changes?after=${seq + 1000}`)).status === 409)

step("live (sync rule 3; Verify 4)")

const live = await openLive(token)

check("on open: {seq} of the last change", await live.until(() => live.messages.length > 0) && seqOf(live.messages[0]) === seq, live.messages)

check("a change → {seq: n + 1} within a second", (await makeChange(token)) && (await live.until(() => live.messages.length > 1)) && seqOf(live.messages[1]) > seq, live.messages)

live.socket.send("ping")

check("ping → pong, answered by the runtime", await new Promise<boolean>((resolve) => {
  live.socket.addEventListener("message", (event) => void (String(event.data) === "pong" && resolve(true)))
  setTimeout(() => resolve(false), 1000)
}))

step("disconnect \"Sippet app\" (account rule 8)")

if (sessionCookie === undefined) skip("disconnect → socket closed 4401, next request 401 (SIPPET_SESSION_COOKIE)")
else {
  const disconnected = await fetch(`${origin}/api/connections/sippet-app/disconnect`, { method: "POST", headers: { cookie: sessionCookie, origin } })

  check("disconnect answered ok", disconnected.status < 300, disconnected.status)

  check("socket closed 4401", await live.until(() => live.closedCode() !== undefined) && live.closedCode() === 4401, live.closedCode())

  check("the old token's next request → 401", (await device(token, "/api/device/library")).status === 401)
}

step("token expired, then a change (Verify 4)")

if (process.env["SIPPET_WAIT_FOR_EXPIRY"] !== "1" || sessionCookie !== undefined) skip("set SIPPET_WAIT_FOR_EXPIRY=1 on a connected cook (no SIPPET_SESSION_COOKIE): waits an hour")
else {
  const fresh = await accessToken()
  const expiring = await openLive(fresh)
  const exp = Number(JSON.parse(Buffer.from(fresh.split(".")[1]!, "base64url").toString()).exp)
  console.log(`   waiting ${Math.ceil(exp - Date.now() / 1000)} s for the token to expire`)
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, exp * 1000 - Date.now()) + 2000))
  const before = expiring.messages.length
  await makeChange(await accessToken())

  check("socket closed 4401 instead of the message", await expiring.until(() => expiring.closedCode() !== undefined) && expiring.closedCode() === 4401 && expiring.messages.length === before, expiring.messages)
}

live.socket.close()
