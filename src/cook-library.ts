// One CookLibrary per cook. Skeleton: connection table, the connection/iat check, connect/disconnect RPCs.
// The MCP server and the library tables are added on top of this (specs/hosting.md#cooklibrary).
import { DurableObject } from "cloudflare:workers"
import { drizzle } from "drizzle-orm/durable-sqlite"
import { migrate } from "drizzle-orm/durable-sqlite/migrator"
import type { Env } from "../alchemy.run.ts"
import migrations from "../migrations/cook-library/migrations.js"
import { acceptLive, broadcastChange, closeLive } from "./device/device-live.ts"
import { deviceWebHandler } from "./device/server.ts"
import { mcpWebHandler } from "./mcp/server.ts"
import { purgeDueRecipes } from "./mcp/unit-of-work.ts"
import { Library, type Db } from "./store/library.ts"
import { derive } from "./store/derive.ts"
import * as schema from "./store/schema.ts"

export type Connection = { clientId: string; name: string; connectedAt: number }

type ConnectionRow = { client_id: string; name: string; connected_at: number; disconnected_at: number | null }

const unknownClientName = "Claude"

export class CookLibrary extends DurableObject<Env> {
  private readonly db: Db
  private readonly library: Library
  private readonly mcp: ReturnType<typeof mcpWebHandler>
  private readonly device: ReturnType<typeof deviceWebHandler>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.db = drizzle(ctx.storage)
    this.library = new Library({ db: this.db, storage: ctx.storage, derive, onChange: (seq) => broadcastChange({ ctx, seq, now: Date.now() }) })
    this.mcp = mcpWebHandler({ library: this.library })
    this.device = deviceWebHandler({ library: this.library })
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))
    ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, migrations)
      await this.library.scheduleAlarm() // self-heal: the alarm is set after the commit that changed purge_at
    })
  }

  // Revising rules 7, 9: purge every due recipe, then set the next alarm. Alarms retry on failure; a second run finds nothing due.
  override async alarm(): Promise<void> {
    await purgeDueRecipes(this.library)
  }

  // account rule 4: the cook approved this client. A later connectClient keeps disconnected_at, so older tokens stay refused.
  connectClient({ clientId, name }: { clientId: string; name: string }): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO connection (client_id, name, connected_at) VALUES (?, ?, ?)
       ON CONFLICT (client_id) DO UPDATE SET name = excluded.name, connected_at = excluded.connected_at`,
      clientId,
      name,
      Date.now(),
    )
  }

  // account rule 5: tokens issued before `at` are refused from now on. `at` is epoch milliseconds.
  disconnectClient({ clientId, at }: { clientId: string; at: number }): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO connection (client_id, name, connected_at, disconnected_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (client_id) DO UPDATE SET disconnected_at = excluded.disconnected_at`,
      clientId,
      unknownClientName,
      at,
      at,
    )
    closeLive({ ctx: this.ctx, connection: clientId })
  }

  // Connections that are currently open: never disconnected, or connected again after the last disconnect.
  listConnections(): Connection[] {
    return this.ctx.storage.sql
      .exec<ConnectionRow>(
        `SELECT client_id, name, connected_at, disconnected_at FROM connection
         WHERE disconnected_at IS NULL OR disconnected_at < connected_at
         ORDER BY connected_at DESC`,
      )
      .toArray()
      .map((row) => ({ clientId: row.client_id, name: row.name, connectedAt: row.connected_at }))
  }

  override async fetch(request: Request): Promise<Response> {
    const connection = request.headers.get("sippet-connection")
    const issuedAt = Number(request.headers.get("sippet-issued-at"))

    if (connection === null || !Number.isFinite(issuedAt)) return new Response("unauthorized", { status: 401 })

    if (this.isRefused({ connection, issuedAt })) return new Response("unauthorized", { status: 401 })

    const { pathname } = new URL(request.url)

    if (pathname === "/api/device/live" && request.headers.get("upgrade") === "websocket") {
      // sippet-expires-at is the token's exp, in epoch seconds like iat
      const expiresAt = Number(request.headers.get("sippet-expires-at")) * 1000

      if (!Number.isFinite(expiresAt)) return new Response("unauthorized", { status: 401 })

      return acceptLive({ ctx: this.ctx, connection, expiresAt, lastSeq: this.library.lastSeq() })
    }

    if (pathname.startsWith("/api/device/")) return this.device.handler(request)

    return this.mcp.handler(request)
  }

  // Nothing to do: the device talks over HTTP, and ping/pong is answered by the runtime.
  override webSocketMessage(): void {}

  override webSocketClose(): void {}

  // A token from a disconnected connection is refused when it was issued before the disconnect.
  // An unknown client is stored as "Claude" until connectClient names it.
  private isRefused({ connection, issuedAt }: { connection: string; issuedAt: number }): boolean {
    const [row] = this.ctx.storage.sql
      .exec<ConnectionRow>(`SELECT client_id, name, connected_at, disconnected_at FROM connection WHERE client_id = ?`, connection)
      .toArray()

    if (row === undefined) {
      this.ctx.storage.sql.exec(
        `INSERT INTO connection (client_id, name, connected_at) VALUES (?, ?, ?) ON CONFLICT (client_id) DO NOTHING`,
        connection,
        unknownClientName,
        Date.now(),
      )

      return false
    }

    return row.disconnected_at !== null && issuedAt * 1000 < row.disconnected_at
  }
}
