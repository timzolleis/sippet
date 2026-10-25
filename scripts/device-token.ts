/// <reference types="node" />
// A local cook signed in on a device through the `sippet-app` client, against `pnpm dev` (specs/device-api.md Sign-in):
//   invitation → software passkey → authorize (PKCE, offline_access) → /connect: passkey sign-in, approve → custom-scheme redirect → token.
// Prints the refresh token for the iOS app's SIPPET_REFRESH_TOKEN. Run: pnpm device-token [http://localhost:1337]
// Local only: it writes the invitation into the local D1 file. verify-device-sign-in.ts reuses the steps.
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto"
import { readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { Schema } from "effect"
import { cbor, json } from "./support.ts"

export const deviceClientId = "sippet-app"
export const deviceRedirectUri = "de.bastelboxx.sippet:/oauth"

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest()
const b64url = (data: Buffer) => data.toString("base64url")

const Challenge = Schema.Struct({ challenge: Schema.String })
const Registered = Schema.Struct({ user: Schema.Struct({ id: Schema.String }) })
const Redirect = Schema.Struct({ url: Schema.optional(Schema.String) })
const Consent = Schema.Struct({ url: Schema.String })
const ClientName = Schema.Struct({ client_name: Schema.String })

export const Tokens = Schema.Struct({ access_token: Schema.String, refresh_token: Schema.String, expires_in: Schema.optional(Schema.Number) })

export type Tokens = typeof Tokens.Type

// ── a browser: one cookie jar, Origin set like the account pages ───────────

export type Browser = { request: (path: string, init?: RequestInit & { json?: Schema.Json }) => Promise<Response>; signedIn: () => boolean }

export const browser = (origin: string): Browser => {
  const jar = new Map<string, string>()

  const request = async (path: string, init: RequestInit & { json?: Schema.Json } = {}): Promise<Response> => {
    const headers = new Headers(init.headers)
    headers.set("origin", origin)

    if (jar.size > 0) headers.set("cookie", [...jar].map(([key, value]) => `${key}=${value}`).join("; "))

    if (init.json !== undefined) headers.set("content-type", "application/json")
    const body = init.json === undefined ? (init.body ?? null) : JSON.stringify(init.json)
    const response = await fetch(`${origin}${path}`, { ...init, headers, redirect: "manual", body })

    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";")
      const [key, ...rest] = pair!.split("=")
      const value = rest.join("=")

      if (value === "" || /max-age=0/i.test(cookie)) jar.delete(key!)
      else jar.set(key!, value)
    }

    return response
  }

  return { request, signedIn: () => [...jar.keys()].some((key) => key.includes("session_token")) }
}

// ── a cook with a software passkey (ES256, "none" attestation) ─────────────

export type LocalCook = { cookId: string; origin: string; signIn: (browser: Browser) => Promise<void> }

export const joinLocalCook = async (origin: string): Promise<LocalCook & { browser: Browser }> => {
  const rpId = new URL(origin).hostname
  const keys = generateKeyPairSync("ec", { namedCurve: "P-256" })
  const credentialId = randomBytes(16)
  const jwk = keys.publicKey.export({ format: "jwk" })
  const coseKey = cbor({ 1: 2, 3: -7, "-1": 1, "-2": Buffer.from(jwk.x!, "base64url"), "-3": Buffer.from(jwk.y!, "base64url") })
  let counter = 0

  const dir = ".alchemy/local/d1/cloudflare-runtime-D1DatabaseObject"
  const file = readdirSync(dir).find((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")

  if (file === undefined) throw new Error(`no local D1 file in ${dir}; is pnpm dev running?`)
  const invitation = randomBytes(32).toString("base64url")
  const db = new DatabaseSync(`${dir}/${file}`)
  const now = Date.now()
  db.prepare(`INSERT INTO invitation (id, token_hash, name, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    randomUUID(), sha256(invitation).toString("hex"), "Local", `local-${randomUUID().slice(0, 8)}@example.com`, now, now + 14 * 24 * 3600 * 1000)
  db.close()

  const join = browser(origin)
  const options = await json(Challenge, await join.request(`/api/auth/passkey/generate-register-options?context=${invitation}`))
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin, crossOrigin: false }))
  const authData = Buffer.concat([sha256(rpId), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, credentialId.length]), credentialId, coseKey])

  const registered = await join.request(`/api/auth/passkey/verify-registration`, {
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

  // The /connect passkey tap.
  const signIn = async (into: Browser) => {
    const authOptions = await json(Challenge, await into.request(`/api/auth/passkey/generate-authenticate-options`))
    const data = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: authOptions.challenge, origin, crossOrigin: false }))
    const count = Buffer.alloc(4)
    count.writeUInt32BE(++counter)
    const authenticatorData = Buffer.concat([sha256(rpId), Buffer.from([0x05]), count])

    const signedIn = await into.request(`/api/auth/passkey/verify-authentication`, {
      method: "POST",
      json: {
        response: {
          id: b64url(credentialId), rawId: b64url(credentialId), type: "public-key",
          response: {
            clientDataJSON: b64url(data),
            authenticatorData: b64url(authenticatorData),
            signature: b64url(sign("sha256", Buffer.concat([authenticatorData, sha256(data)]), keys.privateKey)),
          },
          clientExtensionResults: {},
        },
      },
    })

    if (signedIn.status !== 200) throw new Error(`passkey sign-in failed: ${signedIn.status}`)
  }

  return { cookId, origin, signIn, browser: join }
}

// ── the app's sign-in (ASWebAuthenticationSession: a fresh browser, no session) ──

export type DeviceSignIn = {
  connectPage: URL // where authorize sent the browser
  clientName: string // what /connect shows
  redirect: URL // de.bastelboxx.sippet:/oauth?code=…&state=…&iss=…
  state: string
  tokens: Tokens
}

const tokenRequest = (origin: string, body: Record<string, string>) =>
  fetch(`${origin}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  })

export const signInDevice = async (cook: LocalCook): Promise<DeviceSignIn> => {
  const { origin } = cook
  const session = browser(origin)
  const verifier = b64url(randomBytes(32))
  const state = b64url(randomBytes(12))

  const query = new URLSearchParams({
    client_id: deviceClientId, redirect_uri: deviceRedirectUri, response_type: "code",
    code_challenge: b64url(sha256(verifier)), code_challenge_method: "S256",
    scope: "offline_access", resource: `${origin}/mcp`, state,
  })

  const authorize = await session.request(`/api/auth/oauth2/authorize?${query}`)
  const location = authorize.headers.get("location") ?? (await json(Redirect, authorize)).url

  if (location === undefined) throw new Error(`authorize answered ${authorize.status} without a redirect`)
  const connectPage = new URL(location, origin)
  const oauthQuery = connectPage.search.slice(1)

  // /connect: the client's name, one passkey tap, approve
  const named = await session.request(`/api/auth/oauth2/public-client-prelogin`, { method: "POST", json: { client_id: deviceClientId, oauth_query: oauthQuery } })
  const clientName = (await json(ClientName, named)).client_name
  await cook.signIn(session)
  const consent = await session.request(`/api/auth/oauth2/consent`, { method: "POST", json: { accept: true, oauth_query: oauthQuery } })

  if (consent.status !== 200) throw new Error(`consent answered ${consent.status}: ${await consent.text()}`)
  const redirect = new URL((await json(Consent, consent)).url)

  if (`${redirect.protocol}${redirect.pathname}` !== deviceRedirectUri) throw new Error(`consent redirected to ${redirect.href}`)
  const code = redirect.searchParams.get("code")

  if (code === null) throw new Error(`no code in ${redirect.href}`)

  const exchanged = await tokenRequest(origin, {
    grant_type: "authorization_code", code, redirect_uri: deviceRedirectUri, client_id: deviceClientId, code_verifier: verifier, resource: `${origin}/mcp`,
  })

  if (exchanged.status !== 200) throw new Error(`token answered ${exchanged.status}: ${await exchanged.text()}`)

  return { connectPage, clientName, redirect, state, tokens: await json(Tokens, exchanged) }
}

export const refreshDevice = ({ origin, refreshToken }: { origin: string; refreshToken: string }) =>
  tokenRequest(origin, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: deviceClientId, resource: `${origin}/mcp` })

// ── run ────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const origin = process.argv[2] ?? "http://localhost:1337"
  const cook = await joinLocalCook(origin)
  const { tokens } = await signInDevice(cook)

  console.log(`cook:          ${cook.cookId}`)
  console.log(`access token:  ${tokens.access_token}`)
  console.log(`refresh token: ${tokens.refresh_token}`)
  console.log(`\nSIPPET_REFRESH_TOKEN=${tokens.refresh_token}`)
}
