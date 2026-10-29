// A cook's library in memory: node:sqlite behind the Durable Object storage API, the real migrations, and the real MCP handler.
import { readdirSync, readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { join } from "node:path"
import { fromDurableObjectStorage } from "@alchemy.run/cloudflare"
import { RuntimeContext } from "alchemy"
import { drizzle } from "drizzle-orm/durable-sqlite"
import { Effect } from "effect"
import { HttpRouter } from "effect/http"
import { derive } from "../../src/store/derive.ts"
import { Library } from "../../src/store/library.ts"
import { deviceAppLayer } from "../../src/device/server.ts"
import { mcpAppLayer } from "../../src/mcp/server.ts"
import type { Json } from "../../src/store/schema.ts"
import { purgeDueRecipes } from "../../src/store/unit-of-work.ts"

type SqlValue = string | number | null | bigint | Uint8Array

export const makeStorage = () => {
  const database = new DatabaseSync(":memory:")

  const exec = (query: string, ...params: Array<SqlValue>) => {
    const statement = database.prepare(query)
    const names = statement.columns().map((column) => column.name)
    const objects = statement.all(...params)
    const arrays = objects.map((row) => names.map((name) => row[name])) // a repeated column name keeps its last value, which Drizzle's selects here never repeat
    const iterator = objects[Symbol.iterator]()

    return {
      toArray: () => objects,
      one: () => objects[0],
      next: () => iterator.next(),
      raw: () => {
        const rows = arrays[Symbol.iterator]()

        return { toArray: () => arrays, next: () => rows.next(), [Symbol.iterator]: () => rows }
      },
      [Symbol.iterator]: () => iterator,
    }
  }

  let depth = 0

  const inTransaction = <T>(closure: () => T): T => {
    if (depth++ > 0) throw new Error("nested transaction")
    database.exec("BEGIN")

    try {
      const value = closure()
      database.exec("COMMIT")

      return value
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    } finally {
      depth--
    }
  }

  // One async transaction at a time, as the DO's input gate gives Alchemy's storage.transaction.
  let queue: Promise<unknown> = Promise.resolve()

  const transaction = <T>(closure: (txn: { rollback: () => void }) => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      if (depth++ > 0) throw new Error("nested transaction")
      database.exec("BEGIN")
      let rolledBack = false

      try {
        const value = await closure({ rollback: () => void (rolledBack = true) })
        database.exec(rolledBack ? "ROLLBACK" : "COMMIT")

        return value
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      } finally {
        depth--
      }
    })

    queue = run.catch(() => undefined)

    return run
  }

  // Drizzle's durable-sqlite driver and the store use only `sql.exec`, `transactionSync`, and `transaction`, all implemented here.
  const storage: DurableObjectStorage = Object.assign(Object.create(null), { sql: { exec }, transactionSync: inTransaction, transaction })

  return { database, storage }
}


const migrate = (database: DatabaseSync) => {
  const dir = join(import.meta.dirname, "../../migrations/cook-library")

  for (const folder of readdirSync(dir).filter((name) => /^\d{14}_/.test(name)).sort()) {
    for (const statement of readFileSync(join(dir, folder, "migration.sql"), "utf8").split("--> statement-breakpoint")) {
      database.exec(statement)
    }
  }
}

const sessionHeaders = ({ connection, session, protocol }: { connection: string; session: string | undefined; protocol: string }): Headers => {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": protocol,
    "sippet-connection": connection,
  })

  if (session !== undefined) headers.set("mcp-session-id", session)

  return headers
}

export type ToolOutcome = { readonly isError: boolean; readonly value: any }

export const makeCook = ({ now = () => Date.now() }: { now?: () => number } = {}) => {
  const { database, storage } = makeStorage()
  migrate(database)
  const db = drizzle(storage)
  // The purge job as the DO schedules it (hosting.md Trash): its time, or null when cancelled.
  let purgeJobAt: number | null = null

  const library = new Library({
    db,
    storage: fromDurableObjectStorage(storage),
    derive,
    now,
    purge: { scheduleAt: (at) => Effect.sync(() => void (purgeJobAt = at)), cancel: Effect.sync(() => void (purgeJobAt = null)) },
  })

  const server = HttpRouter.toWebHandler(mcpAppLayer({ library }), { disableLogger: true })
  const deviceServer = HttpRouter.toWebHandler(deviceAppLayer({ library }), { disableLogger: true })
  const purge = () => Effect.runPromise(purgeDueRecipes(library).pipe(Effect.provide(RuntimeContext.phantom)))
  let id = 0

  const post = (body: string, { connection, session, protocol }: { connection: string; session?: string | undefined; protocol: string }) =>
    server.handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: sessionHeaders({ connection, session, protocol }),
        body,
      }),
    )

  // One MCP session on one connection.
  const connect = async ({ connection = "connection-1", protocol = "2025-06-18" }: { connection?: string; protocol?: string } = {}) => {
    const init = await post(
      JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "initialize", params: { protocolVersion: protocol, capabilities: {}, clientInfo: { name: "test", version: "0" } } }),
      { connection, session: undefined, protocol },
    )

    const session = init.headers.get("mcp-session-id") ?? undefined
    const initialized = JSON.parse(await init.text()).result
    await post(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), { connection, session, protocol })
    const request = async (method: string, params?: Json) => JSON.parse(await (await post(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), { connection, session, protocol })).text())

    const call = async (name: string, args: Json = {}): Promise<ToolOutcome> => {
      const response = await request("tools/call", { name, arguments: args })

      if (response.error !== undefined) throw new Error(`protocol error: ${JSON.stringify(response.error)}`)
      const result = response.result

      return { isError: result.isError === true, value: result.isError === true ? JSON.parse(result.content[0].text) : result.structuredContent }
    }

    return { call, request, initialized, session }
  }

  // A request to the device API as the Worker forwards it: the connection header is the token's client id.
  const device = async (
    path: string,
    { method = "GET", body, connection = "sippet-app", deviceId = "6f1d1c7e-0c5a-4c55-9d52-3a1b0f6a9a01", deviceName = "iPad", headers = {} }: {
      method?: string
      body?: Json
      connection?: string
      deviceId?: string | null
      deviceName?: string
      headers?: Record<string, string>
    } = {},
  ): Promise<{ status: number; body: any }> => {
    const request = new Headers({ "sippet-connection": connection, "x-device-name": encodeURIComponent(deviceName), "content-type": "application/json", ...headers })

    if (deviceId !== null) request.set("x-device-id", deviceId)
    const response = await deviceServer.handler(new Request(`http://localhost${path}`, { method, headers: request, body: body === undefined ? null : JSON.stringify(body) }))
    const text = await response.text()

    return { status: response.status, body: text === "" ? undefined : JSON.parse(text) }
  }

  return { library, device, database, purgeJobAt: () => purgeJobAt, purge, connect, count: (table: string) => Number(database.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n) }
}
