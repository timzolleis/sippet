import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Alchemy from "alchemy"
import * as Effect from "effect/Effect"
import Sippet, { DB } from "./src/worker.ts"

// The resources live with their runtime code (src/worker.ts, src/cook-library.ts; specs/hosting.md Resources).
export default Alchemy.Stack(
  "sippet",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const db = yield* DB
    const site = yield* Sippet

    return { url: site.url, databaseId: db.databaseId }
  }),
)
