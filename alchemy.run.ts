import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Alchemy from "alchemy"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import type { CookLibrary as CookLibraryClass } from "./src/cook-library.ts"

const DB = Cloudflare.D1.Database("auth", { migrations: "./migrations/auth" })
const CookLibrary = Cloudflare.DurableObject<CookLibraryClass>("CookLibrary")

const Site = Cloudflare.Worker("sippet", {
  main: "./src/worker.ts",
  assets: { directory: "./public", runWorkerFirst: ["/mcp", "/api/*", "/.well-known/*"] },
  compatibility: { flags: ["nodejs_compat"] },
  domain: "sippet.bastelboxx.de",
  workersDev: false,
  env: {
    DB,
    COOK_LIBRARY: CookLibrary,
    BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
    PUBLIC_URL: Cloudflare.Worker.URL,
  },
})

export type Env = Cloudflare.InferEnv<typeof Site>

export default Alchemy.Stack(
  "sippet",
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const db = yield* DB
    const site = yield* Site

    return { url: site.url, databaseId: db.databaseId }
  }),
)
