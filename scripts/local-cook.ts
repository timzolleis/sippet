/// <reference types="node" />
// A signed-in cook against `pnpm dev`, for local checks of the library: invitation → software passkey → DCR → consent → access token.
// Same flow as verify-local.ts, without the assertions. Local only: it writes into the local D1 file.
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto"
import { readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest()
const b64url = (data: Buffer) => data.toString("base64url")

const cbor = (value: unknown): Buffer => {
  const head = (major: number, length: number) =>
    length < 24 ? Buffer.from([(major << 5) | length]) : Buffer.from([(major << 5) | 24, length])
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value)
  if (typeof value === "string") return Buffer.concat([head(3, Buffer.byteLength(value)), Buffer.from(value)])
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, (value as Buffer).length), value as Buffer])
  const entries = Object.entries(value as Record<string, unknown>)
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([key, item]) => [cbor(/^-?\d+$/.test(key) ? Number(key) : key), cbor(item)])])
}

export type LocalCook = { cookId: string; clientId: string; token: string; connect: (name: string) => Promise<{ clientId: string; token: string }> }

export const signInLocalCook = async (origin = "http://localhost:1337"): Promise<LocalCook> => {
  const rpId = new URL(origin).hostname
  const jar = new Map<string, string>()
  const request = async (path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> => {
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
  const json = async (response: Response) => (await response.json()) as Record<string, any>

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
  const options = await json(await request(`/api/auth/passkey/generate-register-options?context=${invitation}`))
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
  const cookId: string = (await json(registered)).user.id

  const connect = async (name: string) => {
    const redirectUri = "https://claude.ai/api/mcp/auth_callback"
    const client = await json(await request(`/api/auth/oauth2/register`, {
      method: "POST",
      json: { client_name: name, redirect_uris: [redirectUri], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
    }))
    const verifier = b64url(randomBytes(32))
    const query = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: redirectUri, scope: "offline_access", state: "s1", code_challenge: b64url(sha256(verifier)), code_challenge_method: "S256", resource: `${origin}/mcp` })
    const authorize = await request(`/api/auth/oauth2/authorize?${query}`)
    const location = authorize.headers.get("location") ?? ((await authorize.json()) as { url?: string }).url
    const next = new URL(location!, origin)
    const consent = await json(await request(`/api/auth/oauth2/consent`, { method: "POST", json: { accept: true, oauth_query: next.search.slice(1) } }))
    const code = new URL(consent.url).searchParams.get("code")!
    const token = await json(await request(`/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: client.client_id, code_verifier: verifier, resource: `${origin}/mcp` }),
    }))
    return { clientId: client.client_id as string, token: token.access_token as string }
  }
  const first = await connect("Claude (local)")
  return { cookId, clientId: first.clientId, token: first.token, connect }
}
