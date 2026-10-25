// One CookLibrary per cook. Skeleton: connection table, the connection/iat check, connect/disconnect RPCs.
// The MCP server and the library tables are added on top of this (specs/hosting.md#cooklibrary).
import { DurableObject } from "cloudflare:workers"

export type Connection = { clientId: string; name: string; connectedAt: number }

type ConnectionRow = { client_id: string; name: string; connected_at: number; disconnected_at: number | null }

const unknownClientName = "Claude"

export class CookLibrary extends DurableObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS connection (
           client_id TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           connected_at INTEGER NOT NULL,
           disconnected_at INTEGER
         )`,
      )
    })
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

    const sippetHeaders: Record<string, string> = {}
    for (const [name, value] of request.headers) if (name.startsWith("sippet-")) sippetHeaders[name] = value
    return Response.json(sippetHeaders)
  }

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
