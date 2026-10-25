// Local checks only: lets scripts drive the Library without MCP tools. CookLibrary and the Worker refuse it unless PUBLIC_URL is localhost.
import { Result } from "effect"
import { Library, type SearchQuery } from "./library.ts"
import type { Actor, Json } from "./schema.ts"
import { retryKey } from "./retry.ts"
import { cleanSource } from "./source.ts"
import { and, eq } from "drizzle-orm"
import * as schema from "./schema.ts"
import type { Db } from "./library.ts"

export const isLocal = (env: { PUBLIC_URL?: string }): boolean => {
  try {
    return new URL(env.PUBLIC_URL ?? "").hostname === "localhost"
  } catch {
    return false
  }
}

const outcome = <A, E extends { _tag: string }>(result: Result.Result<A, E>) =>
  Result.isSuccess(result) ? { ok: true, value: result.success } : { ok: false, error: { ...result.failure, _tag: result.failure._tag } }

type Args = Record<string, any>

export const runDevOp = async ({ op, args, library, db, storage, connection, setAlarmNow }: { op: string; args: Args; library: Library; db: Db; storage: DurableObjectStorage; connection: string; setAlarmNow: () => Promise<void> }): Promise<unknown> => {
  const by: Actor = { kind: "claude", connection }
  const retry = args.retryTool === undefined ? undefined : retryKey({ connection, tool: args.retryTool, args: args.retryArgs ?? args })
  switch (op) {
    case "add": {
      // cleanSource runs before the transaction (hosting.md#source)
      const cleaned = args.source === undefined ? undefined : await cleanSource({ source: args.source })
      if (cleaned !== undefined && Result.isFailure(cleaned)) return outcome(cleaned)
      return outcome(
        await library.transact({
          retry,
          run: (writes) => {
            const added = writes.addRecipe({ id: args.id, content: args.content, source: cleaned?.success, by })
            return Result.map(added, (value): Json => ({ recipeId: args.id, ...value }))
          },
        }),
      )
    }
    case "revise":
      return outcome(
        await library.transact({
          retry,
          run: (writes) => Result.map(writes.addRevision({ id: args.id, fromRevision: args.fromRevision, content: args.content, was: args.was ?? { edits: [] }, by }), (value): Json => ({ ...value })),
        }),
      )
    case "trash":
      return outcome(await library.transact({ retry, run: (writes) => Result.map(writes.trashRecipes({ ids: args.ids, by }), (value): Json => [...value]) }))
    case "restore":
      return outcome(await library.transact({ retry, run: (writes) => Result.map(writes.restoreRecipes({ ids: args.ids, by }), (value): Json => [...value]) }))
    case "get":
      return library.getRecipe(args.id, args.revision) ?? null
    case "revisions":
      return library.listRevisions(args.id)
    case "search":
      return library.search(args.query as SearchQuery)
    case "trashList":
      return library.listTrash()
    case "changes":
      return library.listChanges({ after: args.after ?? 0, limit: args.limit ?? 100 })
    case "tag": {
      // test setup for search filters; library edits themselves are wired later
      const key = args.name.trim().toLowerCase()
      db.insert(schema.tag).values({ name: args.name, nameKey: key }).onConflictDoNothing().run()
      const row = db.select().from(schema.tag).where(eq(schema.tag.nameKey, key)).get()!
      for (const id of args.ids as string[]) db.insert(schema.recipeTag).values({ recipeId: id, tagId: row.id }).onConflictDoNothing().run()
      return { tagId: row.id }
    }
    case "collect": {
      const key = args.name.trim().toLowerCase()
      db.insert(schema.collection).values({ name: args.name, nameKey: key }).onConflictDoNothing().run()
      const row = db.select().from(schema.collection).where(eq(schema.collection.nameKey, key)).get()!
      ;(args.ids as string[]).forEach((id, position) => db.insert(schema.collectionRecipe).values({ collectionId: row.id, recipeId: id, position }).onConflictDoNothing().run())
      return { collectionId: row.id }
    }
    case "positions":
      return db.select().from(schema.collectionRecipe).where(and(eq(schema.collectionRecipe.collectionId, args.collectionId))).all()
    case "backdate": {
      // pretend the recipe was trashed `daysAgo` days ago
      const purgeAt = Date.now() - args.pastMs
      db.update(schema.recipe).set({ purgeAt, trashedAt: purgeAt - 720 * 3600 * 1000 }).where(eq(schema.recipe.id, args.id)).run()
      await setAlarmNow()
      return { purgeAt }
    }
    case "counts": {
      const count = (table: string) => storage.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM ${table}`).one().n
      return Object.fromEntries(["recipe", "revision", "recipe_item", "recipe_text", "recipe_tag", "collection_recipe", "change", "retry"].map((table) => [table, count(table)]))
    }
    case "sql":
      if (!/^\s*select\s/i.test(args.statement)) return { error: "select only" }
      return storage.sql.exec(args.statement, ...(args.params ?? [])).toArray()
    case "ageRetries":
      storage.sql.exec(`UPDATE retry SET expires_at = 0`)
      return { aged: true }
    case "alarm":
      return { alarm: await storage.getAlarm() }
    default:
      return { error: `unknown op ${op}` }
  }
}
