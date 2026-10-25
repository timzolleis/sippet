/// <reference types="node" />
// A signed-in cook against `pnpm dev`, for local checks of the library: invitation → software passkey → DCR → consent → access token.
// Same flow as verify-local.ts, without the assertions. Local only: it writes into the local D1 file.
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto"
import { readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { Schema } from "effect"
import { cbor, json } from "./support.ts"

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest()
const b64url = (data: Buffer) => data.toString("base64url")

const Challenge = Schema.Struct({ challenge: Schema.String })
const Registered = Schema.Struct({ user: Schema.Struct({ id: Schema.String }) })
const Client = Schema.Struct({ client_id: Schema.String })
const Redirect = Schema.Struct({ url: Schema.optional(Schema.String) })
const Consent = Schema.Struct({ url: Schema.String })
const Token = Schema.Struct({ access_token: Schema.String })

export type LocalCook = { cookId: string; clientId: string; token: string; connect: (name: string) => Promise<{ clientId: string; token: string }> }

export const signInLocalCook = async (origin = "http://localhost:1337"): Promise<LocalCook> => {
  const rpId = new URL(origin).hostname
  const jar = new Map<string, string>()

  const request = async (path: string, init: RequestInit & { json?: Schema.Json } = {}): Promise<Response> => {
    const headers = new Headers(init.headers)
    headers.set("origin", origin)

    if (jar.size > 0) headers.set("cookie", [...jar].map(([key, value]) => `${key}=${value}`).join("; "))

    if (init.json !== undefined) headers.set("content-type", "application/json")
    const response = await fetch(`${origin}${path}`, { ...init, headers, redirect: "manual", body: init.json === undefined ? init.body ?? null : JSON.stringify(init.json) })

    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";")
      const [key, ...rest] = pair!.split("=")
      const value = rest.join("=")

      if (value === "" || /max-age=0/i.test(cookie)) jar.delete(key!)
      else jar.set(key!, value)
    }

    return response
  }

  const dir = ".alchemy/local/d1/cloudflare-runtime-D1DatabaseObject"
  const file = readdirSync(dir).find((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")

  if (file === undefined) throw new Error(`no local D1 file in ${dir}; is pnpm dev running?`)
  const invitation = randomBytes(32).toString("base64url")
  const db = new DatabaseSync(`${dir}/${file}`)
  const now = Date.now()
  db.prepare(`INSERT INTO invitation (id, token_hash, name, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    randomUUID(), sha256(invitation).toString("hex"), "Local", `local-${randomUUID().slice(0, 8)}@example.com`, now, now + 14 * 24 * 3600 * 1000)
  db.close()

  const keys = generateKeyPairSync("ec", { namedCurve: "P-256" })
  const credentialId = randomBytes(16)
  const jwk = keys.publicKey.export({ format: "jwk" })
  const coseKey = cbor({ 1: 2, 3: -7, "-1": 1, "-2": Buffer.from(jwk.x!, "base64url"), "-3": Buffer.from(jwk.y!, "base64url") })
  const options = await json(Challenge, await request(`/api/auth/passkey/generate-register-options?context=${invitation}`))
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin, crossOrigin: false }))
  const authData = Buffer.concat([sha256(rpId), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, credentialId.length]), credentialId, coseKey])

  const registered = await request(`/api/auth/passkey/verify-registration`, {
    method: "POST",
    json: {
      createSession: true,
      response: {
        id: b64url(credentialId), rawId: b64url(credentialId), type: "public-key",
        response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(cbor({ fmt: "none", attStmt: {}, authData })), transports: ["internal"] },
        clientExtensionResults: {},
      },
    },
  })

  if (registered.status !== 200) throw new Error(`registration failed: ${registered.status}`)
  const cookId = (await json(Registered, registered)).user.id

  const connect = async (name: string) => {
    const redirectUri = "https://claude.ai/api/mcp/auth_callback"

    const client = await json(Client, await request(`/api/auth/oauth2/register`, {
      method: "POST",
      json: { client_name: name, redirect_uris: [redirectUri], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
    }))

    const verifier = b64url(randomBytes(32))
    const query = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: redirectUri, scope: "offline_access", state: "s1", code_challenge: b64url(sha256(verifier)), code_challenge_method: "S256", resource: `${origin}/mcp` })
    const authorize = await request(`/api/auth/oauth2/authorize?${query}`)
    const location = authorize.headers.get("location") ?? (await json(Redirect, authorize)).url

    if (location === undefined) throw new Error(`authorize answered ${authorize.status} without a redirect`)
    const next = new URL(location, origin)
    const consent = await json(Consent, await request(`/api/auth/oauth2/consent`, { method: "POST", json: { accept: true, oauth_query: next.search.slice(1) } }))
    const code = new URL(consent.url).searchParams.get("code")!

    const token = await json(Token, await request(`/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: client.client_id, code_verifier: verifier, resource: `${origin}/mcp` }),
    }))

    return { clientId: client.client_id, token: token.access_token }
  }

  const first = await connect("Claude (local)")

  return { cookId, clientId: first.clientId, token: first.token, connect }
}
