/// <reference types="node" />
// specs/device-api.md "Verify before building on it" 1–3 and the Worker's request path, end to end against `pnpm dev`:
//   the seeded sippet-app client, authorize → /connect → custom-scheme redirect → token, refresh, the azp rules, disconnect.
// Run: pnpm verify:device-sign-in [http://localhost:1337]
import { createHash, randomBytes } from "node:crypto"
import { readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { Schema } from "effect"
import { deviceClientId, deviceRedirectUri, joinLocalCook, refreshDevice, signInDevice, Tokens } from "./device-token.ts"
import { json, JsonObject } from "./support.ts"

const origin = process.argv[2] ?? "http://localhost:1337"
const step = (text: string) => console.log(`\n── ${text}`)
const show = (label: string, text: string) => console.log(`   ${label}:`, text)

const check = (label: string, ok: boolean) => {
  console.log(`   ${ok ? "ok  " : "FAIL"} ${label}`)

  if (!ok) process.exitCode = 1
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest()
const b64url = (data: Buffer) => data.toString("base64url")
const decodeJwt = (token: string) => Schema.decodeUnknownSync(JsonObject)(JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()))
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const Client = Schema.Struct({ client_id: Schema.String })
const Consent = Schema.Struct({ url: Schema.String })
const Redirect = Schema.Struct({ url: Schema.optional(Schema.String) })
const Connections = Schema.Array(Schema.Struct({ clientId: Schema.String, name: Schema.String }))

const localD1 = () => {
  const dir = ".alchemy/local/d1/cloudflare-runtime-D1DatabaseObject"
  const file = readdirSync(dir).find((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")

  if (file === undefined) throw new Error(`no local D1 file in ${dir}; is pnpm dev running?`)

  return new DatabaseSync(`${dir}/${file}`, { readOnly: true })
}

// The Worker's own 401 carries WWW-Authenticate; the DO's (isRefused) doesn't.
const isWorker401 = (response: Response) => response.status === 401 && response.headers.has("www-authenticate")

const device = (token: string, path = "/api/device/library") =>
  fetch(`${origin}${path}`, { headers: { authorization: `Bearer ${token}`, "x-device-id": crypto.randomUUID(), "x-device-name": "iPad" } })

const mcp = (token: string) =>
  fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify-device-sign-in", version: "0" } } }),
  })

// ── run ────────────────────────────────────────────────────────────────────

const cook = await joinLocalCook(origin)

step("verify 1: ensureDeviceClient on native D1")

// any /api/auth/* request seeds it; joinLocalCook made several
const db = localD1()
const rows = db.prepare(`SELECT * FROM oauthClient WHERE clientId = ?`).all(deviceClientId)
const links = db.prepare(`SELECT resourceId FROM oauthClientResource WHERE clientId = ?`).all(deviceClientId)
const resource = db.prepare(`SELECT identifier FROM oauthResource WHERE identifier = ?`).get(`${origin}/mcp`)

db.close()

show("oauthClient row", JSON.stringify(rows[0]))

check("one sippet-app row", rows.length === 1)

check("linked to <origin>/mcp, once", links.length === 1 && links[0]!.resourceId === `${origin}/mcp`)

check("the resource row exists", resource !== undefined)

const row = rows[0]

check("public, native, PKCE, consent", row?.tokenEndpointAuthMethod === "none" && row.applicationType === "native" && row.requirePKCE === 1 && row.skipConsent === 0)

check("redirect de.bastelboxx.sippet:/oauth", row?.redirectUris === JSON.stringify([deviceRedirectUri]))

const noPkce = await fetch(
  `${origin}/api/auth/oauth2/authorize?${new URLSearchParams({ client_id: deviceClientId, redirect_uri: deviceRedirectUri, response_type: "code", scope: "offline_access", state: "x" })}`,
  { redirect: "manual" },
)

const noPkceRedirect = new URL(noPkce.headers.get("location") ?? (await json(Redirect, noPkce)).url ?? "", origin)

show("authorize without PKCE", noPkceRedirect.href)

check("authorize without PKCE refused", noPkceRedirect.searchParams.get("error") === "invalid_request" && !noPkceRedirect.searchParams.has("code"))

const signIn = await signInDevice(cook)

check("authorize → token with PKCE, offline_access, the custom-scheme redirect", signIn.tokens.refresh_token.length > 0)

step("verify 2: /connect")

show("authorize sent the browser to", `${signIn.connectPage.pathname}?${[...signIn.connectPage.searchParams.keys()].join("&")}`)

check("authorize → /connect", signIn.connectPage.pathname === "/connect")

check(`/connect shows "Sippet app" (${signIn.clientName})`, signIn.clientName === "Sippet app")

show("redirect", signIn.redirect.href.replace(/code=[^&]+/, "code=…"))

check("redirect is de.bastelboxx.sippet:/oauth", `${signIn.redirect.protocol}${signIn.redirect.pathname}` === deviceRedirectUri)

check("state comes back", signIn.redirect.searchParams.get("state") === signIn.state)

check(`iss on the redirect = ${origin}`, signIn.redirect.searchParams.get("iss") === origin)

const connections = await json(Connections, await cook.browser.request(`/api/connections`))

check(`connection "Sippet app" (connectApproved)`, connections.some((c) => c.clientId === deviceClientId && c.name === "Sippet app"))

step("verify 3: refresh")

const claims = decodeJwt(signIn.tokens.access_token)

show("access token claims", JSON.stringify(claims))

check("azp = sippet-app", claims.azp === deviceClientId)

check("aud = <origin>/mcp", claims.aud === `${origin}/mcp`)

check("exp = iat + 1 h", Number(claims.exp) - Number(claims.iat) === 3600)

const refreshed = await refreshDevice({ origin, refreshToken: signIn.tokens.refresh_token })

check(`refresh → 200 (${refreshed.status})`, refreshed.status === 200)

const rotated = await json(Tokens, refreshed)

check("the refresh token rotates", rotated.refresh_token !== signIn.tokens.refresh_token)

check("azp kept", decodeJwt(rotated.access_token).azp === deviceClientId)

step("request path (account rule 6)")

// Claude: a DCR client, approved by the same cook
const registered = await cook.browser.request(`/api/auth/oauth2/register`, {
  method: "POST",
  json: { client_name: "Claude (verify)", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
})

const claude = await json(Client, registered)
const verifier = b64url(randomBytes(32))

const query = new URLSearchParams({
  response_type: "code", client_id: claude.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", scope: "offline_access",
  state: "s", code_challenge: b64url(sha256(verifier)), code_challenge_method: "S256", resource: `${origin}/mcp`,
})

const authorized = await cook.browser.request(`/api/auth/oauth2/authorize?${query}`)
const consentPage = new URL(authorized.headers.get("location") ?? (await json(Redirect, authorized)).url ?? "", origin)
const approved = await json(Consent, await cook.browser.request(`/api/auth/oauth2/consent`, { method: "POST", json: { accept: true, oauth_query: consentPage.search.slice(1) } }))

const claudeTokens = await json(Tokens, await fetch(`${origin}/api/auth/oauth2/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", code: new URL(approved.url).searchParams.get("code") ?? "", redirect_uri: "https://claude.ai/api/mcp/auth_callback", client_id: claude.client_id, code_verifier: verifier, resource: `${origin}/mcp` }),
}))

const claudeOnDevice = await device(claudeTokens.access_token)

check(`Claude's token on /api/device/library → 401 from the Worker (${claudeOnDevice.status})`, isWorker401(claudeOnDevice))

const deviceOnMcp = await mcp(rotated.access_token)

check(`device token on /mcp → 401 from the Worker (${deviceOnMcp.status})`, isWorker401(deviceOnMcp))

const claudeOnMcp = await mcp(claudeTokens.access_token)

check(`Claude's token on /mcp → 200 (${claudeOnMcp.status})`, claudeOnMcp.status === 200)

const forwarded = await device(rotated.access_token)

show("device token on /api/device/library", `${forwarded.status} ${(await forwarded.text()).slice(0, 120)}`)

check("device token on /api/device/library → forwarded (not the Worker's 401)", !isWorker401(forwarded))

check("no token on /api/device/library → 401 from the Worker", isWorker401(await fetch(`${origin}/api/device/library`)))

check("garbage token on /api/device/library → 401 from the Worker", isWorker401(await device("abc.def.ghi")))

step("disconnect Sippet app (account rule 8)")

await pause(1100) // iat has second resolution

const disconnected = await cook.browser.request(`/api/connections/${deviceClientId}/disconnect`, { method: "POST" })

check(`disconnect → 204 (${disconnected.status})`, disconnected.status === 204)

const refusedRefresh = await refreshDevice({ origin, refreshToken: rotated.refresh_token })

check(`refresh after the disconnect fails (${refusedRefresh.status})`, refusedRefresh.status >= 400)

const refusedRequest = await device(rotated.access_token)

check(`forwarded request after the disconnect → 401 from the DO (${refusedRequest.status})`, refusedRequest.status === 401 && !isWorker401(refusedRequest))

console.log(process.exitCode ? "\nFAILED" : "\nall ok")
