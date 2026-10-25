/// <reference types="node" />
// Walks the whole auth path against `pnpm dev` (alchemy dev, local D1 and DO) with a software passkey:
//   invitation → passkey registration → sign-in → DCR → authorize → consent → token → /mcp → disconnect.
// Prints the facts hosting.md "Verify before building on it" 1–3 depend on. Run: node scripts/verify-local.ts [http://localhost:1337]
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto"
import { readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

const origin = process.argv[2] ?? "http://localhost:1337"
const rpId = new URL(origin).hostname
const step = (text: string) => console.log(`\n── ${text}`)
const show = (label: string, value: unknown) => console.log(`   ${label}:`, typeof value === "string" ? value : JSON.stringify(value))
const check = (label: string, ok: boolean) => {
  console.log(`   ${ok ? "ok  " : "FAIL"} ${label}`)
  if (!ok) process.exitCode = 1
}
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest()
const b64url = (data: Buffer) => data.toString("base64url")

// ── cookie jar ─────────────────────────────────────────────────────────────

const jar = new Map<string, string>()
const request = async (path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> => {
  const headers = new Headers(init.headers)
  headers.set("origin", origin)
  if (jar.size > 0) headers.set("cookie", [...jar].map(([key, value]) => `${key}=${value}`).join("; "))
  if (init.json !== undefined) headers.set("content-type", "application/json")
  const response = await fetch(path.startsWith("http") ? path : `${origin}${path}`, {
    ...init,
    headers,
    redirect: "manual",
    body: init.json === undefined ? init.body ?? null : JSON.stringify(init.json),
  })
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(";")
    const [key, ...rest] = pair!.split("=")
    const value: string = rest.join("=")
    if (value === "" || /max-age=0/i.test(cookie)) jar.delete(key!)
    else jar.set(key!, value)
  }
  return response
}

// ── software passkey (ES256, "none" attestation) ───────────────────────────

const cbor = (value: unknown): Buffer => {
  const head = (major: number, length: number) =>
    length < 24 ? Buffer.from([(major << 5) | length]) : Buffer.from([(major << 5) | 24, length])
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value)
  if (typeof value === "string") return Buffer.concat([head(3, Buffer.byteLength(value)), Buffer.from(value)])
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, (value as Buffer).length), value as Buffer])
  const entries = Object.entries(value as Record<string, unknown>)
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([key, item]) => [cbor(/^-?\d+$/.test(key) ? Number(key) : key), cbor(item)])])
}

const keys = generateKeyPairSync("ec", { namedCurve: "P-256" })
const credentialId = randomBytes(16)
const jwk = keys.publicKey.export({ format: "jwk" })
const coseKey = cbor({ 1: 2, 3: -7, "-1": 1, "-2": Buffer.from(jwk.x!, "base64url"), "-3": Buffer.from(jwk.y!, "base64url") })
let counter = 0

const createCredential = (options: { challenge: string }) => {
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin, crossOrigin: false }))
  const authData = Buffer.concat([sha256(rpId), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, credentialId.length]), credentialId, coseKey])
  return {
    id: b64url(credentialId),
    rawId: b64url(credentialId),
    type: "public-key",
    response: {
      clientDataJSON: b64url(clientDataJSON),
      attestationObject: b64url(cbor({ fmt: "none", attStmt: {}, authData })),
      transports: ["internal"],
    },
    clientExtensionResults: {},
  }
}

const getCredential = (options: { challenge: string }) => {
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin, crossOrigin: false }))
  const count = Buffer.alloc(4)
  count.writeUInt32BE(++counter)
  const authenticatorData = Buffer.concat([sha256(rpId), Buffer.from([0x05]), count])
  return {
    id: b64url(credentialId),
    rawId: b64url(credentialId),
    type: "public-key",
    response: {
      clientDataJSON: b64url(clientDataJSON),
      authenticatorData: b64url(authenticatorData),
      signature: b64url(sign("sha256", Buffer.concat([authenticatorData, sha256(clientDataJSON)]), keys.privateKey)),
    },
    clientExtensionResults: {},
  }
}

// ── local D1 ───────────────────────────────────────────────────────────────

const localD1 = () => {
  const dir = ".alchemy/local/d1/cloudflare-runtime-D1DatabaseObject"
  const file = readdirSync(dir).find((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")
  if (file === undefined) throw new Error(`no local D1 file in ${dir}; is pnpm dev running?`)
  return new DatabaseSync(`${dir}/${file}`)
}

const insertInvitation = ({ name, email, expiresInMs }: { name: string; email: string; expiresInMs: number }) => {
  const token = randomBytes(32).toString("base64url")
  const now = Date.now()
  const db = localD1()
  db.prepare(`INSERT INTO invitation (id, token_hash, name, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    randomUUID(),
    sha256(token).toString("hex"),
    name,
    email,
    now,
    now + expiresInMs,
  )
  db.close()
  return token
}

// ── run ────────────────────────────────────────────────────────────────────

const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify-local", version: "0" } } }
// A real MCP client has no Origin header; the MCP server refuses any Origin it wasn't given (allowedOrigins), so this doesn't use the cookie jar.
const mcpInitialize = (token: string) =>
  fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify(initialize),
  })
const json = async (response: Response) => (await response.json()) as Record<string, any>
const decodeJwt = (token: string) => JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()) as Record<string, any>

step("invitation")
const token = insertInvitation({ name: "Anna", email: `anna-${randomUUID().slice(0, 8)}@example.com`, expiresInMs: 14 * 24 * 3600 * 1000 })
const expired = insertInvitation({ name: "Ben", email: "ben@example.com", expiresInMs: -1000 })
check("GET /api/invitation → name", (await json(await request(`/api/invitation?token=${token}`))).name === "Anna")
check("unknown token → 410", (await request(`/api/invitation?token=nope`)).status === 410)
check("expired token → 410", (await request(`/api/invitation?token=${expired}`)).status === 410)

step("passkey registration without an invitation is refused")
check("no context → refused", (await request(`/api/auth/passkey/generate-register-options`)).status >= 400)
check("unknown context → refused", (await request(`/api/auth/passkey/generate-register-options?context=nope`)).status >= 400)

step("verify 1: resolveUser runs before the ceremony; a failed ceremony keeps the invitation")
const options = await json(await request(`/api/auth/passkey/generate-register-options?context=${token}`))
check("options issued", typeof options.challenge === "string")
check("invitation still open after options", (await request(`/api/invitation?token=${token}`)).status === 200)
const bad = createCredential({ challenge: b64url(randomBytes(32)) }) // wrong challenge
const failed = await request(`/api/auth/passkey/verify-registration`, { method: "POST", json: { response: bad, createSession: true } })
check(`bad ceremony refused (${failed.status})`, failed.status >= 400)
check("invitation still open after a failed ceremony", (await request(`/api/invitation?token=${token}`)).status === 200)

step("registration")
const options2 = await json(await request(`/api/auth/passkey/generate-register-options?context=${token}`))
const registered = await request(`/api/auth/passkey/verify-registration`, {
  method: "POST",
  json: { response: createCredential(options2 as { challenge: string }), createSession: true },
})
const registeredBody = await json(registered)
check(`registered (${registered.status})`, registered.status === 200)
show("user", registeredBody.user)
check("session cookie set", [...jar.keys()].some((key) => key.includes("session_token")))
check("invitation used → 410", (await request(`/api/invitation?token=${token}`)).status === 410)
const cookId: string = registeredBody.user?.id

step("a second use of the same invitation is refused")
const again = await request(`/api/auth/passkey/generate-register-options?context=${token}`, { headers: { cookie: "" } })
// the jar sends the new session, which registers for that cook; use a clean jar to test the invitation itself
jar.clear()
check("used invitation → options refused", (await request(`/api/auth/passkey/generate-register-options?context=${token}`)).status >= 400)
show("with session (status)", again.status)

step("sign-in with the passkey")
const authOptions = await json(await request(`/api/auth/passkey/generate-authenticate-options`))
const signedIn = await request(`/api/auth/passkey/verify-authentication`, { method: "POST", json: { response: getCredential(authOptions as { challenge: string }) } })
check(`signed in (${signedIn.status})`, signedIn.status === 200)

step("never the last passkey")
const passkeys = (await json(await request(`/api/auth/passkey/list-user-passkeys`))) as unknown as Array<{ id: string }>
check("one passkey", Array.isArray(passkeys) && passkeys.length === 1)
const removal = await request(`/api/auth/passkey/delete-passkey`, { method: "POST", json: { id: passkeys[0]!.id } })
check(`delete refused (${removal.status})`, removal.status === 400)

step("verify 3: discovery documents")
const resource = await json(await request(`/.well-known/oauth-protected-resource/mcp`))
show("oauth-protected-resource/mcp", resource)
check("resource = <origin>/mcp", resource.resource === `${origin}/mcp`)
const server = await json(await request(`/.well-known/oauth-authorization-server`))
show("issuer", server.issuer)
check("issuer = origin", server.issuer === origin)
check("authorization_servers = [issuer]", JSON.stringify(resource.authorization_servers) === JSON.stringify([server.issuer]))
const unauthenticated = await request(`/mcp`)
show("/mcp without token", `${unauthenticated.status} ${unauthenticated.headers.get("www-authenticate")}`)

step("DCR (claude.ai style, then Claude Code loopback)")
const registerClient = (redirectUri: string, name: string) =>
  request(`/api/auth/oauth2/register`, {
    method: "POST",
    json: { client_name: name, redirect_uris: [redirectUri], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
  })
const web = await registerClient("https://claude.ai/api/mcp/auth_callback", "Claude (claude.ai)")
const webClient = await json(web)
check(`claude.ai client registered (${web.status})`, web.status === 200 || web.status === 201)
const loopback = await registerClient("http://127.0.0.1:54321/callback", "Claude Code")
const loopbackClient = await json(loopback)
check(`loopback client registered (${loopback.status})`, loopback.status === 200 || loopback.status === 201)
show("loopback application_type", loopbackClient.application_type)

const connect = async (client: Record<string, any>, redirectUri: string) => {
  const verifier = b64url(randomBytes(32))
  const query = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    scope: "offline_access",
    state: "s1",
    code_challenge: b64url(sha256(verifier)),
    code_challenge_method: "S256",
    resource: `${origin}/mcp`,
  })
  const authorize = await request(`/api/auth/oauth2/authorize?${query}`)
  const location = authorize.headers.get("location") ?? ((await authorize.json()) as { url?: string }).url
  const next = new URL(location!, origin)
  show("authorize → redirect", `${authorize.status} ${next.pathname}?${[...next.searchParams.keys()].join("&")}`)
  const prelogin = await request(`/api/auth/oauth2/public-client-prelogin`, { method: "POST", json: { client_id: client.client_id, oauth_query: next.search.slice(1) } })
  show("public-client-prelogin", `${prelogin.status} ${JSON.stringify(await prelogin.json())}`)
  const consent = await json(await request(`/api/auth/oauth2/consent`, { method: "POST", json: { accept: true, oauth_query: next.search.slice(1) } }))
  const callback = new URL(consent.url)
  const code = callback.searchParams.get("code")!
  const tokenResponse = await request(`/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: client.client_id, code_verifier: verifier, resource: `${origin}/mcp` }),
  })
  return { consent, next, token: await json(tokenResponse), status: tokenResponse.status }
}

step("verify 1 (account-ui): what /connect receives and the call that continues authorize")
const first = await connect(webClient, "https://claude.ai/api/mcp/auth_callback")
show("login/consent page query keys", [...first.next.searchParams.keys()])
show("consent response", first.consent)
check(`token issued (${first.status})`, first.status === 200 && typeof first.token.access_token === "string")
show("token response keys", Object.keys(first.token))

step("verify 2: access token claims")
const claims = decodeJwt(first.token.access_token)
show("claims", claims)
check("client id in azp", claims.azp === webClient.client_id)
check("client id in client_id", claims.client_id === webClient.client_id)
check("iat is a number", typeof claims.iat === "number")
check("iss = origin", claims.iss === origin)
check("aud = <origin>/mcp", claims.aud === `${origin}/mcp` || (Array.isArray(claims.aud) && claims.aud.includes(`${origin}/mcp`)))
check("sub = the cook", claims.sub === cookId)

step("/mcp with the token")
// /api/dev/headers goes through the same token check as /mcp and echoes what the DO received (localhost only)
const mcp = await request(`/api/dev/headers`, { method: "POST", headers: { authorization: `Bearer ${first.token.access_token}`, "sippet-cook": "forged" }, json: {} })
const forwarded = await json(mcp)
show("DO saw", forwarded)
check("200", mcp.status === 200)
check("sippet-cook = sub (forged header dropped)", forwarded["sippet-cook"] === cookId)
check("sippet-connection = client id", forwarded["sippet-connection"] === webClient.client_id)
check("sippet-issued-at = iat", forwarded["sippet-issued-at"] === String(claims.iat))
check("garbage token → 401", (await request(`/mcp`, { headers: { authorization: "Bearer abc.def.ghi" } })).status === 401)

step("loopback client (Claude Code)")
const second = await connect(loopbackClient, "http://127.0.0.1:54321/callback")
check(`token issued (${second.status})`, second.status === 200)

step("connections")
const connections = await json(await request(`/api/connections`)) as unknown as Array<{ clientId: string; name: string; connectedAt: number }>
show("GET /api/connections", connections)
check("both listed with client_name", connections.length === 2 && connections.some((c) => c.name === "Claude (claude.ai)") && connections.some((c) => c.name === "Claude Code"))
check("no session → 401", (await fetch(`${origin}/api/connections`)).status === 401)

step("disconnect (account rule 5)")
await new Promise((resolve) => setTimeout(resolve, 1100)) // iat has second resolution
const noOrigin = await fetch(`${origin}/api/connections/${webClient.client_id}/disconnect`, { method: "POST", headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } })
check(`POST without Origin → 403 (${noOrigin.status})`, noOrigin.status === 403)
const disconnected = await request(`/api/connections/${webClient.client_id}/disconnect`, { method: "POST" })
check(`disconnect → 204 (${disconnected.status})`, disconnected.status === 204)
const refused = await mcpInitialize(first.token.access_token)
check(`old access token refused (${refused.status})`, refused.status === 401)
const refresh = await request(`/api/auth/oauth2/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: first.token.refresh_token ?? "", client_id: webClient.client_id }),
})
check(`refresh token revoked (${refresh.status})`, refresh.status >= 400)
const stillThere = await mcpInitialize(second.token.access_token)
check(`the other connection still works (${stillThere.status})`, stillThere.status === 200)
const left = await json(await request(`/api/connections`)) as unknown as Array<{ name: string }>
check("only Claude Code is listed", left.length === 1 && left[0]!.name === "Claude Code")

step("reconnect after disconnect")
await new Promise((resolve) => setTimeout(resolve, 1100)) // a token minted in the disconnect second counts as older (iat has second resolution)
const third = await connect(webClient, "https://claude.ai/api/mcp/auth_callback")
const reconnected = await mcpInitialize(third.token.access_token)
check(`new token works (${reconnected.status})`, reconnected.status === 200)
const oldStill = await mcpInitialize(first.token.access_token)
check(`old token still refused (${oldStill.status})`, oldStill.status === 401)

console.log(process.exitCode ? "\nFAILED" : "\nall ok")
