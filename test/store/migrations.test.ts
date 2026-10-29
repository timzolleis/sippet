// Adopting drizzle 0.45's history (specs/hosting.md Migrations from drizzle 0.45).
import type { SqlMigrations } from "@alchemy.run/cloudflare"
import { describe, expect, it } from "vitest"
import { adoptDrizzle045History } from "../../src/store/migrations.ts"
import { makeStorage } from "../mcp/harness.ts"

const record = (name: string) => ({ name, hash: `hash-of-${name}`, createdAtMillis: undefined, sql: "", statements: [] })

const migrations: Pick<SqlMigrations, "records"> = { records: [record("20261025185507_library"), record("20261025185507_recipe_text")] }

// The table and rows exactly as drizzle 0.45's durable-sqlite migrator wrote them.
const legacyStorage = (whens: ReadonlyArray<number>) => {
  const { database, storage } = makeStorage()
  database.exec(`CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`)

  for (const when of whens) database.prepare(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('', ?)`).run(when)

  return { database, storage }
}

describe("adoptDrizzle045History", () => {
  it("names each row by its journal time, with the folder's hash", () => {
    const { database, storage } = legacyStorage([1792954507028, 1792954507254])

    adoptDrizzle045History({ storage, migrations })

    expect(database.prepare(`SELECT name, hash FROM __drizzle_migrations ORDER BY created_at`).all()).toEqual([
      { name: "20261025185507_library", hash: "hash-of-20261025185507_library" },
      { name: "20261025185507_recipe_text", hash: "hash-of-20261025185507_recipe_text" },
    ])
  })

  it("leaves an adopted or a fresh object alone", () => {
    const { database, storage } = legacyStorage([1792954507028])
    adoptDrizzle045History({ storage, migrations })
    adoptDrizzle045History({ storage, migrations })

    expect(database.prepare(`SELECT count(*) AS n FROM pragma_table_info('__drizzle_migrations')`).get()?.n).toBe(5)
    expect(() => adoptDrizzle045History({ storage: makeStorage().storage, migrations })).not.toThrow()
  })

  it("refuses a row it can't name, and changes nothing", () => {
    const { database, storage } = legacyStorage([1792954507028, 1800000000000])

    expect(() => adoptDrizzle045History({ storage, migrations })).toThrow("has no local folder")
    expect(database.prepare(`SELECT name FROM pragma_table_info('__drizzle_migrations')`).all().map((row) => row.name)).toEqual(["id", "hash", "created_at"])
  })
})
