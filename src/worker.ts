// Worker edge: /mcp and /api/device/* token check and forward, Better Auth, and the account page endpoints (specs/hosting.md#request-path).
// /mcp never builds betterAuth(); auth.ts loads on the first request that needs it.
import { Option, Schema } from "effect"
import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet, type JWK } from "jose"
import type { Env } from "../alchemy.run.ts"

export { CookLibrary } from "./cook-library.ts"

// ── token check ────────────────────────────────────────────────────────────

// Public keys from the D1 jwks table, cached per isolate.
let cachedJwks: Promise<JSONWebKeySet> | undefined

// An unknown kid reloads at most once a minute, so random kids can't turn every request into a D1 read.
const reloadInterval = 60_000
let lastReload = 0

// The stored public key is a JWK as JSON text. Fields that are absent stay absent.
const PublicKey = Schema.fromJsonString(
  Schema.Struct({
    alg: Schema.optionalKey(Schema.String),
    kty: Schema.optionalKey(Schema.String),
    crv: Schema.optionalKey(Schema.String),
    x: Schema.optionalKey(Schema.String),
    y: Schema.optionalKey(Schema.String),
    n: Schema.optionalKey(Schema.String),
    e: Schema.optionalKey(Schema.String),
  }),
)

const decodePublicKey = Schema.decodeUnknownSync(PublicKey)

const loadJwks = async (db: D1Database): Promise<JSONWebKeySet> => {
  const { results } = await db
    .prepare(`SELECT id, publicKey, alg, crv FROM jwks`)
    .all<{ id: string; publicKey: string; alg: string | null; crv: string | null }>()

  return {
    keys: results.map((row) => {
      const key: JWK = { alg: row.alg ?? "EdDSA" }

      if (row.crv !== null) key.crv = row.crv

      return { ...key, ...decodePublicKey(row.publicKey), kid: row.id }
    }),
  }
}

const reloadJwks = (db: D1Database): Promise<JSONWebKeySet> => {
  const loading = loadJwks(db)
  cachedJwks = loading
  lastReload = Date.now()
  loading.catch(() => {
    if (cachedJwks === loading) cachedJwks = undefined
  })

  return loading
}

const verifyToken = async ({ token, env }: { token: string; env: Env }) => {
  const options = { issuer: env.PUBLIC_URL, audience: `${env.PUBLIC_URL}/mcp` }

  const jwks = await (cachedJwks ??= reloadJwks(env.DB))

  try {
    return await jwtVerify(token, createLocalJWKSet(jwks), options)
  } catch (error) {
    if (!(error instanceof errors.JWKSNoMatchingKey)) throw error

    // the table is empty until the first token is signed, so an empty set always reloads
    if (jwks.keys.length > 0 && Date.now() - lastReload < reloadInterval) throw error

    return await jwtVerify(token, createLocalJWKSet(await reloadJwks(env.DB)), options) // reload once on an unknown kid
  }
}

const unauthorized = (env: Env) =>
  new Response("unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": `Bearer resource_metadata="${env.PUBLIC_URL}/.well-known/oauth-protected-resource/mcp"` },
  })

const Claims = Schema.Struct({ sub: Schema.String, azp: Schema.String, iat: Schema.Number, exp: Schema.Number })
const decodeClaims = Schema.decodeUnknownOption(Claims)

type Claims = typeof Claims.Type

// account rule 6: the app's client reaches /api/device/* only, every other client /mcp only.
const deviceClientId = "sippet-app" // auth.ts deviceClientId; not imported, so /mcp stays free of betterAuth()
const isDeviceClient = (azp: string) => azp === deviceClientId
const isNotDeviceClient = (azp: string) => azp !== deviceClientId

// hosting.md Token check, with the azp rule of the path.
const verifyAccessToken = async ({ request, env, acceptsClient }: { request: Request; env: Env; acceptsClient: (azp: string) => boolean }) => {
  const authorization = request.headers.get("authorization")

  if (authorization === null || !/^Bearer /i.test(authorization)) return Option.none<Claims>()

  try {
    const verified = await verifyToken({ token: authorization.slice(7), env })

    return Option.filter(decodeClaims(verified.payload), (claims) => acceptsClient(claims.azp))
  } catch {
    return Option.none<Claims>()
  }
}

// Incoming sippet-* headers are dropped first. Other headers (x-device-id, x-device-name, WebSocket upgrade) pass through,
// and the DO's response is returned as it is, so a 101 with its socket reaches the client.
const forward = ({ request, env, claims, sent }: { request: Request; env: Env; claims: Claims; sent: Record<string, string> }) => {
  const headers = new Headers()

  for (const [name, value] of request.headers) if (!name.startsWith("sippet-") && name !== "authorization") headers.append(name, value)
  headers.set("sippet-cook", claims.sub)
  headers.set("sippet-connection", claims.azp)
  headers.set("sippet-issued-at", String(claims.iat))

  for (const [name, value] of Object.entries(sent)) headers.set(name, value)

  return env.COOK_LIBRARY.getByName(claims.sub).fetch(new Request(request, { headers }))
}

const handleMcp = async (request: Request, env: Env): Promise<Response> => {
  const claims = await verifyAccessToken({ request, env, acceptsClient: isNotDeviceClient })

  return Option.isNone(claims) ? unauthorized(env) : forward({ request, env, claims: claims.value, sent: {} })
}

// specs/device-api.md Request path
const handleDevice = async (request: Request, env: Env): Promise<Response> => {
  const claims = await verifyAccessToken({ request, env, acceptsClient: isDeviceClient })

  if (Option.isNone(claims)) return unauthorized(env)

  return forward({ request, env, claims: claims.value, sent: { "sippet-expires-at": String(claims.value.exp) } })
}

// ── account page endpoints ─────────────────────────────────────────────────

const handleInvitation = async (request: Request, env: Env): Promise<Response> => {
  const token = new URL(request.url).searchParams.get("token")
  const { findOpenInvitation } = await import("./auth.ts")
  const invitation = token === null ? null : await findOpenInvitation({ db: env.DB, token })

  return invitation === null ? new Response(null, { status: 410 }) : Response.json({ name: invitation.name })
}

const disconnectPath = /^\/api\/connections\/([^/]+)\/disconnect$/

const handleConnections = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url)
  const disconnect = disconnectPath.exec(url.pathname)

  if (url.pathname !== "/api/connections" && disconnect === null) return new Response("not found", { status: 404 })

  if (disconnect === null ? request.method !== "GET" : request.method !== "POST") {
    return new Response("method not allowed", { status: 405 })
  }

  if (disconnect !== null && request.headers.get("origin") !== new URL(env.PUBLIC_URL).origin) {
    return new Response("forbidden", { status: 403 })
  }

  const { createAuth } = await import("./auth.ts")
  const auth = createAuth(env)
  const session = await auth.api.getSession({ headers: request.headers })

  if (session === null) return new Response("unauthorized", { status: 401 })
  const cook = env.COOK_LIBRARY.getByName(session.user.id)

  if (disconnect === null) return Response.json(await cook.listConnections())

  // account rule 5. The DO refuses the old tokens first; the rest stops the client from getting new ones.
  const clientId = decodeURIComponent(disconnect[1]!)
  await cook.disconnectClient({ clientId, at: Date.now() })
  const { adapter } = await auth.$context

  const where = [
    { field: "clientId", value: clientId },
    { field: "userId", value: session.user.id },
  ]

  await adapter.deleteMany({ model: "oauthConsent", where })
  await adapter.deleteMany({ model: "oauthAccessToken", where })
  await adapter.updateMany({ model: "oauthRefreshToken", where, update: { revoked: new Date() } })

  return new Response(null, { status: 204 })
}

// ── routing ────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)

    if (pathname === "/mcp") return handleMcp(request, env)

    if (pathname.startsWith("/api/device/")) return handleDevice(request, env)

    if (pathname === "/api/invitation") return handleInvitation(request, env)

    if (pathname === "/api/connections" || pathname.startsWith("/api/connections/")) return handleConnections(request, env)

    if (pathname.startsWith("/api/auth/") || pathname.startsWith("/.well-known/")) {
      const { createAuth, ensureDeviceClient } = await import("./auth.ts")

      if (pathname.startsWith("/api/auth/")) await ensureDeviceClient(env)

      return createAuth(env).handler(request)
    }

    return new Response("not found", { status: 404 })
  },
} satisfies ExportedHandler<Env>
