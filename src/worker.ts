// Worker edge (specs/hosting.md Request path): /mcp and /api/device/* token check and forward, Better Auth, and the account page endpoints.
// /mcp never builds betterAuth(); auth.ts loads on the first request that needs it.
import * as Cloudflare from "@alchemy.run/cloudflare"
import type { RuntimeContext } from "alchemy"
import { Config, Effect, Option, Redacted, Ref, Schema } from "effect"
import * as Headers from "effect/http/Headers"
import { HttpServerRequest } from "effect/http/HttpServerRequest"
import * as ServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet, type JWK } from "jose"
import type { AuthEnv } from "./auth.ts"
import CookLibraryLive, { CookLibrary } from "./cook-library.ts"

export const DB = Cloudflare.D1.Database("auth", { migrations: "./migrations/auth" })

// The deploy evaluates this module in Node. Anything but an explicit staging deploy is prod, so prod never loses its host (hosting.md Resources).
const staging = typeof process !== "undefined" && process.env.SIPPET_STAGING === "1"

// ── token check ────────────────────────────────────────────────────────────

// An unknown kid reloads at most once a minute, so random kids can't turn every request into a D1 read.
const reloadInterval = 60_000

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

const Claims = Schema.Struct({ sub: Schema.String, azp: Schema.String, iat: Schema.Number, exp: Schema.Number })
const decodeClaims = Schema.decodeUnknownOption(Claims)

type Claims = typeof Claims.Type

// account rule 6: the app's client reaches /api/device/* only, every other client /mcp only.
const deviceClientId = "sippet-app" // auth.ts deviceClientId; not imported, so /mcp stays free of betterAuth()
const isDeviceClient = (azp: string) => azp === deviceClientId
const isNotDeviceClient = (azp: string) => azp !== deviceClientId

const disconnectPath = /^\/api\/connections\/([^/]+)\/disconnect$/

const text = (body: string, status: number) => HttpServerResponse.text(body, { status })

export default class Sippet extends Cloudflare.Worker<Sippet>()(
  "sippet",
  {
    main: import.meta.url,
    assets: { directory: "./dist", runWorkerFirst: ["/mcp", "/api/*", "/.well-known/*"] },
    compatibility: { flags: ["nodejs_compat"] },
    ...(staging ? { workersDev: true } : { domain: "sippet.bastelboxx.de", workersDev: false }),
  },
  Effect.gen(function* () {
    const d1 = yield* Cloudflare.D1.QueryDatabase(DB)
    const libraries = yield* CookLibrary
    const secret = yield* Config.Redacted("BETTER_AUTH_SECRET")
    const selfUrl = yield* Cloudflare.Worker.URL

    // Public keys from the D1 jwks table, cached per isolate.
    const jwks = yield* Ref.make<{ readonly keys: JSONWebKeySet; readonly loadedAt: number } | undefined>(undefined)

    const publicUrl = Effect.map(selfUrl, (url) => url.replace(/\/$/, ""))

    const loadJwks = Effect.gen(function* () {
      const db = yield* d1.raw
      const { results } = yield* Effect.promise(() => db.prepare(`SELECT id, publicKey, alg, crv FROM jwks`).all<{ id: string; publicKey: string; alg: string | null; crv: string | null }>())

      const keys: JSONWebKeySet = {
        keys: results.map((row) => {
          const key: JWK = { alg: row.alg ?? "EdDSA" }

          if (row.crv !== null) key.crv = row.crv

          return { ...key, ...decodePublicKey(row.publicKey), kid: row.id }
        }),
      }

      yield* Ref.set(jwks, { keys, loadedAt: Date.now() })

      return keys
    })

    const verifyToken = (token: string) =>
      Effect.gen(function* () {
        const url = yield* publicUrl
        const options = { issuer: url, audience: `${url}/mcp` }
        const cached = yield* Ref.get(jwks)
        const keys = cached?.keys ?? (yield* loadJwks)
        const verify = (set: JSONWebKeySet) => Effect.tryPromise(() => jwtVerify(token, createLocalJWKSet(set), options))

        return yield* verify(keys).pipe(
          Effect.catch((error) => {
            const unknownKid = error.cause instanceof errors.JWKSNoMatchingKey
            // the table is empty until the first token is signed, so an empty set always reloads
            const mayReload = keys.keys.length === 0 || cached === undefined || Date.now() - cached.loadedAt >= reloadInterval

            return unknownKid && mayReload ? Effect.flatMap(loadJwks, verify) : Effect.fail(error) // reload once on an unknown kid
          }),
        )
      })

    // hosting.md Token check, with the azp rule of the path.
    const verifyAccessToken = ({ authorization, acceptsClient }: { readonly authorization: string | undefined; readonly acceptsClient: (azp: string) => boolean }) =>
      authorization === undefined || !/^Bearer /i.test(authorization)
        ? Effect.succeed(Option.none<Claims>())
        : verifyToken(authorization.slice(7)).pipe(
          Effect.map((verified) => Option.filter(decodeClaims(verified.payload), (claims) => acceptsClient(claims.azp))),
          Effect.orElseSucceed(() => Option.none<Claims>()),
        )

    const unauthorized = Effect.map(publicUrl, (url) =>
      HttpServerResponse.text("unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": `Bearer resource_metadata="${url}/.well-known/oauth-protected-resource/mcp"` },
      })
    )

    // Incoming sippet-* headers are dropped first. Other headers (x-device-id, x-device-name, WebSocket upgrade) pass through,
    // and the DO's response is returned as it is, so a 101 with its socket reaches the client.
    const forward = ({ request, claims, sent }: { readonly request: ServerRequest.HttpServerRequest; readonly claims: Claims; readonly sent: Record<string, string> }) => {
      const kept = Object.entries(request.headers).filter(([name]) => !name.startsWith("sippet-") && name !== "authorization")

      const headers = Headers.fromInput({
        ...Object.fromEntries(kept),
        "sippet-cook": claims.sub,
        "sippet-connection": claims.azp,
        "sippet-issued-at": String(claims.iat),
        ...sent,
      })

      return libraries.getByName(claims.sub).fetch(request.modify({ headers }))
    }

    const handleWithToken = ({ request, acceptsClient, sent }: {
      readonly request: ServerRequest.HttpServerRequest
      readonly acceptsClient: (azp: string) => boolean
      readonly sent: (claims: Claims) => Record<string, string>
    }) =>
      Effect.gen(function* () {
        const claims = yield* verifyAccessToken({ authorization: request.headers["authorization"], acceptsClient })

        return Option.isNone(claims) ? yield* unauthorized : yield* forward({ request, claims: claims.value, sent: sent(claims.value) })
      })

    // auth.ts is promise-shaped: raw D1, and the cook's DO with connectClient as a promise for the consent hook (hosting.md Auth).
    const authEnv = Effect.gen(function* () {
      const run = Effect.runPromiseWith(yield* Effect.context<RuntimeContext>())

      const env: AuthEnv = {
        DB: yield* d1.raw,
        BETTER_AUTH_SECRET: Redacted.value(secret),
        PUBLIC_URL: yield* publicUrl,
        COOK_LIBRARY: { getByName: (cookId) => ({ connectClient: (input) => run(libraries.getByName(cookId).connectClient(input)) }) },
      }

      return { env, auth: yield* Effect.promise(() => import("./auth.ts")) }
    })

    const toWeb = (request: ServerRequest.HttpServerRequest) => ServerRequest.toWeb(request).pipe(Effect.orDie)

    const handleInvitation = (request: ServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        const token = new URL(request.url, "http://sippet").searchParams.get("token")
        const { env, auth } = yield* authEnv
        const invitation = token === null ? null : yield* Effect.promise(() => auth.findOpenInvitation({ db: env.DB, token }))

        return invitation === null ? HttpServerResponse.empty({ status: 410 }) : yield* HttpServerResponse.json({ name: invitation.name })
      })

    const handleConnections = (request: ServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        const { pathname } = new URL(request.url, "http://sippet")
        const disconnect = disconnectPath.exec(pathname)

        if (pathname !== "/api/connections" && disconnect === null) return text("not found", 404)

        if (disconnect === null ? request.method !== "GET" : request.method !== "POST") return text("method not allowed", 405)
        const { env, auth: authModule } = yield* authEnv

        if (disconnect !== null && request.headers["origin"] !== new URL(env.PUBLIC_URL).origin) return text("forbidden", 403)
        const auth = authModule.createAuth(env)
        const web = yield* toWeb(request)
        const session = yield* Effect.promise(() => auth.api.getSession({ headers: web.headers }))

        if (session === null) return text("unauthorized", 401)
        const cook = libraries.getByName(session.user.id)

        if (disconnect === null) return yield* HttpServerResponse.json(yield* cook.listConnections())

        // account rule 5. The DO refuses the old tokens first; the rest stops the client from getting new ones.
        const clientId = decodeURIComponent(disconnect[1]!)
        yield* cook.disconnectClient({ clientId, at: Date.now() })
        const { adapter } = yield* Effect.promise(() => auth.$context)

        const where = [
          { field: "clientId", value: clientId },
          { field: "userId", value: session.user.id },
        ]

        yield* Effect.promise(() => adapter.deleteMany({ model: "oauthConsent", where }))
        yield* Effect.promise(() => adapter.deleteMany({ model: "oauthAccessToken", where }))
        yield* Effect.promise(() => adapter.updateMany({ model: "oauthRefreshToken", where, update: { revoked: new Date() } }))

        return HttpServerResponse.empty({ status: 204 })
      })

    const handleAuth = (request: ServerRequest.HttpServerRequest, pathname: string) =>
      Effect.gen(function* () {
        const { env, auth } = yield* authEnv

        if (pathname.startsWith("/api/auth/")) yield* Effect.promise(() => auth.ensureDeviceClient(env))
        const web = yield* toWeb(request)

        return HttpServerResponse.fromWeb(yield* Effect.promise(() => auth.createAuth(env).handler(web)))
      })

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest
        const { pathname } = new URL(request.url, "http://sippet")

        if (pathname === "/mcp") return yield* handleWithToken({ request, acceptsClient: isNotDeviceClient, sent: () => ({}) })

        // specs/device-api.md Request path
        if (pathname.startsWith("/api/device/")) {
          return yield* handleWithToken({ request, acceptsClient: isDeviceClient, sent: (claims) => ({ "sippet-expires-at": String(claims.exp) }) })
        }

        if (pathname === "/api/invitation") return yield* handleInvitation(request)

        if (pathname === "/api/connections" || pathname.startsWith("/api/connections/")) return yield* handleConnections(request)

        if (pathname.startsWith("/api/auth/") || pathname.startsWith("/.well-known/")) return yield* handleAuth(request, pathname)

        return text("not found", 404)
      }),
    }
  }).pipe(Effect.provide(CookLibraryLive), Effect.provide(Cloudflare.D1.QueryDatabaseBinding)),
) {}
