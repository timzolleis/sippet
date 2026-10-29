// One CookLibrary per cook (specs/hosting.md CookLibrary): migrations, the store, the purge job, and the MCP and device servers, per instance.
import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Alchemy from "alchemy"
import type { RuntimeContext } from "alchemy"
import { drizzle } from "drizzle-orm/durable-sqlite"
import { Effect, Scope } from "effect"
import { HttpRouter } from "effect/http"
import { HttpServerRequest } from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import { acceptLive, broadcastChange, closeLive } from "./device/device-live.ts"
import { deviceAppLayer } from "./device/server.ts"
import { mcpAppLayer } from "./mcp/server.ts"
import { derive } from "./store/derive.ts"
import { Library } from "./store/library.ts"
import { adoptDrizzle045History } from "./store/migrations.ts"
import { purgeDueRecipes } from "./store/unit-of-work.ts"

export type Connection = { clientId: string; name: string; connectedAt: number }

type ConnectionRow = { client_id: string; name: string; connected_at: number; disconnected_at: number | null }

const unknownClientName = "Claude"
const purgeJobId = "due"

export interface CookLibraryRpc {
  // account rule 4: the cook approved this client. A later connectClient keeps disconnected_at, so older tokens stay refused.
  readonly connectClient: (input: { readonly clientId: string; readonly name: string }) => Effect.Effect<void, never, RuntimeContext>
  // account rule 5: tokens issued before `at` are refused from now on. `at` is epoch milliseconds.
  readonly disconnectClient: (input: { readonly clientId: string; readonly at: number }) => Effect.Effect<void, never, RuntimeContext>
  // Connections that are currently open: never disconnected, or connected again after the last disconnect.
  readonly listConnections: () => Effect.Effect<ReadonlyArray<Connection>, never, RuntimeContext>
}

export class CookLibrary extends Cloudflare.DurableObject<CookLibrary, CookLibraryRpc>()("CookLibrary") {}

const unauthorized = () => HttpServerResponse.text("unauthorized", { status: 401 })

export default CookLibrary.make(
  Effect.gen(function* () {
    const migrations = yield* Cloudflare.SqlMigrations("./migrations/cook-library")
    const state = yield* Cloudflare.DurableObjectState

    return Effect.gen(function* () {
      const storage = state.raw.storage
      const sql = storage.sql

      adoptDrizzle045History({ storage, migrations })
      yield* migrations.apply().pipe(Effect.orDie)

      // The job and the store need each other: the store reschedules the job, the job purges through the store.
      const library = new Library({
        db: drizzle(storage),
        storage: state.storage,
        derive,
        purge: {
          scheduleAt: (at) => Effect.suspend(() => purge.schedule(purgeJobId, { at, payload: null })).pipe(Effect.orDie),
          cancel: Effect.suspend(() => purge.cancel(purgeJobId)).pipe(Effect.orDie),
        },
        onChange: (seq) => broadcastChange({ state, seq, now: Date.now() }),
      })

      const purge = yield* Alchemy.makeCallback("purge", () => purgeDueRecipes(library))

      // Objects from before the purge job had only the native alarm; this also heals a job lost any other way.
      const nextPurgeAt = library.nextPurgeAt()

      if (nextPurgeAt !== undefined && (yield* purge.getStatus(purgeJobId).pipe(Effect.orDie)) === undefined) {
        yield* purge.schedule(purgeJobId, { at: nextPurgeAt, payload: null }).pipe(Effect.orDie)
      }

      yield* state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))

      // The routers live as long as the instance. The scope Alchemy hands the instance Effect is already closed here,
      // and McpServer's RpcClient fails building in a closed scope.
      const routers = yield* Scope.make()
      const mcp = yield* HttpRouter.toHttpEffect(mcpAppLayer({ library })).pipe(Scope.provide(routers), Effect.orDie)
      const device = yield* HttpRouter.toHttpEffect(deviceAppLayer({ library })).pipe(Scope.provide(routers), Effect.orDie)

      // A token from a disconnected connection is refused when it was issued before the disconnect.
      // An unknown client is stored as "Claude" until connectClient names it.
      const isRefused = ({ connection, issuedAt }: { readonly connection: string; readonly issuedAt: number }) =>
        Effect.sync(() => {
          const [row] = sql.exec<ConnectionRow>(`SELECT client_id, name, connected_at, disconnected_at FROM connection WHERE client_id = ?`, connection).toArray()

          if (row === undefined) {
            sql.exec(`INSERT INTO connection (client_id, name, connected_at) VALUES (?, ?, ?) ON CONFLICT (client_id) DO NOTHING`, connection, unknownClientName, Date.now())

            return false
          }

          return row.disconnected_at !== null && issuedAt * 1000 < row.disconnected_at
        })

      return {
        connectClient: ({ clientId, name }) =>
          Effect.sync(() => {
            sql.exec(
              `INSERT INTO connection (client_id, name, connected_at) VALUES (?, ?, ?)
               ON CONFLICT (client_id) DO UPDATE SET name = excluded.name, connected_at = excluded.connected_at`,
              clientId,
              name,
              Date.now(),
            )
          }),

        disconnectClient: ({ clientId, at }) =>
          Effect.gen(function* () {
            sql.exec(
              `INSERT INTO connection (client_id, name, connected_at, disconnected_at) VALUES (?, ?, ?, ?)
               ON CONFLICT (client_id) DO UPDATE SET disconnected_at = excluded.disconnected_at`,
              clientId,
              unknownClientName,
              at,
              at,
            )
            yield* closeLive({ state, connection: clientId })
          }),

        listConnections: () =>
          Effect.sync(() =>
            sql
              .exec<ConnectionRow>(
                `SELECT client_id, name, connected_at, disconnected_at FROM connection
                 WHERE disconnected_at IS NULL OR disconnected_at < connected_at
                 ORDER BY connected_at DESC`,
              )
              .toArray()
              .map((row) => ({ clientId: row.client_id, name: row.name, connectedAt: row.connected_at }))
          ),

        fetch: Effect.gen(function* () {
          const request = yield* HttpServerRequest
          const connection = request.headers["sippet-connection"]
          const issuedAt = Number(request.headers["sippet-issued-at"])

          if (connection === undefined || !Number.isFinite(issuedAt)) return unauthorized()

          if (yield* isRefused({ connection, issuedAt })) return unauthorized()
          const { pathname } = new URL(request.url, "http://cook-library")

          if (pathname === "/api/device/live" && request.headers["upgrade"] === "websocket") {
            // sippet-expires-at is the token's exp, in epoch seconds like iat
            const expiresAt = Number(request.headers["sippet-expires-at"]) * 1000

            if (!Number.isFinite(expiresAt)) return unauthorized()

            return yield* acceptLive({ connection, expiresAt, lastSeq: library.lastSeq() })
          }

          return yield* pathname.startsWith("/api/device/") ? device : mcp
        }),

        // Nothing to do: the device talks over HTTP, and ping/pong is answered by the runtime.
        webSocketMessage: () => Effect.void,
        webSocketClose: () => Effect.void,
      }
    })
  }),
)
