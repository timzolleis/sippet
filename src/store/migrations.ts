// Objects created before the Effect DO kept drizzle 0.45's history (specs/hosting.md Migrations from drizzle 0.45).
// Alchemy adopts drizzle history by name only, so each row is named before `apply()` runs.
import type { SqlMigrations } from "@alchemy.run/cloudflare"

// The v0 journal's `when` → the folder `drizzle-kit up` made of it. Frozen: v0 history ends here.
const legacyMigrationNames = new Map([
  [1792954507028, "20261025185507_library"],
  [1792954507254, "20261025185507_recipe_text"],
])

// Sync, before the instance serves anything. An unknown row throws: the object stays down rather than replay a migration.
export const adoptDrizzle045History = ({ storage, migrations }: { readonly storage: DurableObjectStorage; readonly migrations: Pick<SqlMigrations, "records"> }): void => {
  const columns = storage.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('__drizzle_migrations')").toArray().map((row) => row.name)

  if (columns.length === 0 || columns.includes("name")) return

  storage.transactionSync(() => {
    storage.sql.exec("ALTER TABLE __drizzle_migrations ADD COLUMN name text")
    storage.sql.exec("ALTER TABLE __drizzle_migrations ADD COLUMN applied_at text")

    for (const row of storage.sql.exec<{ created_at: number }>("SELECT created_at FROM __drizzle_migrations").toArray()) {
      const record = migrations.records.find((candidate) => candidate.name === legacyMigrationNames.get(Number(row.created_at)))

      if (record === undefined) throw new Error(`applied migration from ${row.created_at} has no local folder`)
      storage.sql.exec("UPDATE __drizzle_migrations SET name = ?, hash = ? WHERE created_at = ?", record.name, record.hash, row.created_at)
    }
  })
}
