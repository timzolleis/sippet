// A cook's library in memory: node:sqlite behind the Durable Object storage API, the real migrations, and the real MCP handler.
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { join } from "node:path"
import { drizzle } from "drizzle-orm/durable-sqlite"
import { derive } from "../../src/store/derive.ts"
import { Library } from "../../src/store/library.ts"
import { mcpWebHandler } from "../../src/mcp/server.ts"
import * as schema from "../../src/store/schema.ts"
import type { Json } from "../../src/store/schema.ts"

type SqlValue = string | number | null | bigint | Uint8Array

const makeStorage = () => {
  const database = new DatabaseSync(":memory:")
  let alarm: number | null = null

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
      raw: () => ({ toArray: () => arrays }),
      [Symbol.iterator]: () => iterator,
    }
  }

  let depth = 0

  // Drizzle's durable-sqlite driver and Library use only `sql.exec`, `transactionSync`, and the alarm calls, all implemented here.
  const storage: DurableObjectStorage = Object.assign(Object.create(null), {
    sql: { exec },
    transactionSync: <T>(closure: () => T): T => {
      if (depth++ > 0) throw new Error("nested transactionSync")
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
    },
    setAlarm: async (at: number) => void (alarm = at),
    deleteAlarm: async () => void (alarm = null),
    getAlarm: async () => alarm,
  })

  return { database, storage, getAlarm: () => alarm }
}

const migrate = (database: DatabaseSync) => {
  for (const file of ["0000_library.sql", "0001_recipe_text.sql"]) {
    for (const statement of readFileSync(join(import.meta.dirname, "../../migrations/cook-library", file), "utf8").split("--> statement-breakpoint")) {
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
  const { database, storage, getAlarm } = makeStorage()
  migrate(database)
  const db = drizzle(storage, { schema })
  const library = new Library({ db, storage, derive, now })
  const server = mcpWebHandler({ library })
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

  return { library, database, getAlarm, connect, count: (table: string) => Number(database.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n) }
}
