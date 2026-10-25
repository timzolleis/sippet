// Worker edge: verify the bearer token, forward /mcp to the cook's Durable Object.
// CookLibrary: one per cook, runs the long-lived MCP server (sessions in memory).
import { DurableObject } from "cloudflare:workers"
import { Layer, Scheduler } from "effect"
import { HttpRouter } from "effect/http"
import { importJWK, jwtVerify, type JWK } from "jose"
import { AppLive } from "./app.ts"

type Env = { COOK_LIBRARY: DurableObjectNamespace<CookLibrary>; JWT_PUBLIC_JWK: string }

const SyncScheduler = Layer.succeed(Scheduler.Scheduler, new Scheduler.MixedScheduler("sync"))
// Built at module scope (toWebHandler gotcha). Only used inside the Durable Object.
const app = HttpRouter.toWebHandler(AppLive.pipe(Layer.provideMerge(SyncScheduler)), { disableLogger: true })

export class CookLibrary extends DurableObject<Env> {
  override fetch(request: Request): Promise<Response> {
    return app.handler(request)
  }
}

let key: CryptoKey | Uint8Array | undefined

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname !== "/mcp") return new Response("not found", { status: 404 })
    const auth = request.headers.get("authorization")
    if (!auth?.startsWith("Bearer ")) return new Response("unauthorized", { status: 401 })
    key ??= await importJWK(JSON.parse(env.JWT_PUBLIC_JWK) as JWK, "ES256")
    let sub: string
    try {
      const { payload } = await jwtVerify(auth.slice(7), key, { issuer: "https://sippet.example", audience: "https://sippet.example/mcp" })
      sub = payload.sub!
    } catch {
      return new Response("unauthorized", { status: 401 })
    }
    return env.COOK_LIBRARY.getByName(sub).fetch(request)
  }
} satisfies ExportedHandler<Env>
