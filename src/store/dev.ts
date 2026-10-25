// Local checks only: lets scripts drive the Library without MCP tools. CookLibrary and the Worker refuse it unless PUBLIC_URL is localhost.
import { Option, Result, Schema } from "effect"
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

// What goes over the wire is plain JSON; error classes and rows are checked into JSON form once, here.
const JsonObject = Schema.Record(Schema.String, Schema.Json)

const toJson = Schema.decodeUnknownSync(Schema.Json)

const outcome = <A extends Json, E extends { readonly _tag: string }>(result: Result.Result<A, E>) =>
  Result.isSuccess(result) ? { ok: true, value: result.success } : { ok: false, error: toJson({ ...result.failure, _tag: result.failure._tag }) }

const Ids = Schema.Array(Schema.String)

const SearchQueryFields = Schema.Struct({
  text: Schema.optionalKey(Schema.String),
  tags: Schema.optionalKey(
    Schema.Struct({ all: Schema.optionalKey(Ids), any: Schema.optionalKey(Ids), none: Schema.optionalKey(Ids) }),
  ),
  items: Schema.optionalKey(Ids),
  maxTotalMinutes: Schema.optionalKey(Schema.Number),
  hasFlow: Schema.optionalKey(Schema.Boolean),
  collection: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(Schema.Number),
  cursor: Schema.optionalKey(Schema.String),
})

const retryFields = { retryTool: Schema.optionalKey(Schema.String), retryArgs: Schema.optionalKey(Schema.Json) }

const DevRequest = Schema.Union([
  Schema.Struct({ op: Schema.Literal("add"), id: Schema.String, content: Schema.Json, source: Schema.optionalKey(Schema.String), ...retryFields }),
  Schema.Struct({
    op: Schema.Literal("revise"),
    id: Schema.String,
    fromRevision: Schema.Number,
    content: Schema.Json,
    was: Schema.optionalKey(Schema.Json),
    ...retryFields,
  }),
  Schema.Struct({ op: Schema.Literal("trash"), ids: Ids, ...retryFields }),
  Schema.Struct({ op: Schema.Literal("restore"), ids: Ids, ...retryFields }),
  Schema.Struct({ op: Schema.Literal("get"), id: Schema.String, revision: Schema.optionalKey(Schema.Number) }),
  Schema.Struct({ op: Schema.Literal("revisions"), id: Schema.String }),
  Schema.Struct({ op: Schema.Literal("search"), query: SearchQueryFields }),
  Schema.Struct({ op: Schema.Literal("trashList") }),
  Schema.Struct({ op: Schema.Literal("changes"), after: Schema.optionalKey(Schema.Number), limit: Schema.optionalKey(Schema.Number) }),
  Schema.Struct({ op: Schema.Literal("tag"), name: Schema.String, ids: Ids }),
  Schema.Struct({ op: Schema.Literal("collect"), name: Schema.String, ids: Ids }),
  Schema.Struct({ op: Schema.Literal("positions"), collectionId: Schema.Number }),
  Schema.Struct({ op: Schema.Literal("backdate"), id: Schema.String, pastMs: Schema.Number }),
  Schema.Struct({ op: Schema.Literal("counts") }),
  Schema.Struct({
    op: Schema.Literal("sql"),
    statement: Schema.String,
    params: Schema.optionalKey(Schema.Array(Schema.Union([Schema.String, Schema.Number, Schema.Null]))),
  }),
  Schema.Struct({ op: Schema.Literal("ageRetries") }),
  Schema.Struct({ op: Schema.Literal("alarm") }),
])

const decodeDevRequest = Schema.decodeUnknownOption(DevRequest)

type DevContext = {
  readonly library: Library
  readonly db: Db
  readonly storage: DurableObjectStorage
  readonly connection: string
  readonly setAlarmNow: () => Promise<void>
}

const dispatch = async ({ request, args, library, db, storage, connection, setAlarmNow }: DevContext & {
  readonly request: typeof DevRequest.Type
  readonly args: Json
}) => {
  const by: Actor = { kind: "claude", connection }

  // the retry key is over the call's own arguments unless the caller names others
  const retryOf = (call: { readonly retryTool?: string; readonly retryArgs?: Json }) =>
    call.retryTool === undefined ? undefined : retryKey({ connection, tool: call.retryTool, args: call.retryArgs ?? args })

  switch (request.op) {
    case "add": {
      // cleanSource runs before the transaction (hosting.md#source)
      const cleaned = request.source === undefined ? undefined : await cleanSource({ source: request.source })

      if (cleaned !== undefined && Result.isFailure(cleaned)) return outcome(cleaned)

      return outcome(
        await library.transact({
          retry: retryOf(request),
          run: (writes) => {
            const added = writes.addRecipe({ id: request.id, content: request.content, source: cleaned?.success, by })

            return Result.map(added, (value): Json => ({ recipeId: request.id, ...value }))
          },
        }),
      )
    }

    case "revise":
      return outcome(
        await library.transact({
          retry: retryOf(request),
          run: (writes) =>
            Result.map(
              writes.addRevision({ id: request.id, fromRevision: request.fromRevision, content: request.content, was: request.was ?? { edits: [] }, by }),
              (value): Json => ({ ...value }),
            ),
        }),
      )
    case "trash":
      return outcome(await library.transact({ retry: retryOf(request), run: (writes) => Result.map(writes.trashRecipes({ ids: request.ids, by }), (value): Json => [...value]) }))
    case "restore":
      return outcome(await library.transact({ retry: retryOf(request), run: (writes) => Result.map(writes.restoreRecipes({ ids: request.ids, by }), (value): Json => [...value]) }))
    case "get":
      return library.getRecipe(request.id, request.revision) ?? null
    case "revisions":
      return library.listRevisions(request.id)
    case "search":
      return library.search(request.query satisfies SearchQuery)
    case "trashList":
      return library.listTrash()
    case "changes":
      return library.listChanges({ after: request.after ?? 0, limit: request.limit ?? 100 })
    case "tag": {
      // test setup for search filters; library edits themselves are wired later
      const key = request.name.trim().toLowerCase()
      db.insert(schema.tag).values({ name: request.name, nameKey: key }).onConflictDoNothing().run()
      const row = db.select().from(schema.tag).where(eq(schema.tag.nameKey, key)).get()!

      for (const id of request.ids) db.insert(schema.recipeTag).values({ recipeId: id, tagId: row.id }).onConflictDoNothing().run()

      return { tagId: row.id }
    }

    case "collect": {
      const key = request.name.trim().toLowerCase()
      db.insert(schema.collection).values({ name: request.name, nameKey: key }).onConflictDoNothing().run()

      const row = db.select().from(schema.collection).where(eq(schema.collection.nameKey, key)).get()!

      request.ids.forEach((id, position) => db.insert(schema.collectionRecipe).values({ collectionId: row.id, recipeId: id, position }).onConflictDoNothing().run())

      return { collectionId: row.id }
    }

    case "positions":
      return db.select().from(schema.collectionRecipe).where(and(eq(schema.collectionRecipe.collectionId, request.collectionId))).all()
    case "backdate": {
      // pretend the recipe was trashed `daysAgo` days ago
      const purgeAt = Date.now() - request.pastMs
      db.update(schema.recipe).set({ purgeAt, trashedAt: purgeAt - 720 * 3600 * 1000 }).where(eq(schema.recipe.id, request.id)).run()
      await setAlarmNow()

      return { purgeAt }
    }

    case "counts": {
      const count = (table: string) => storage.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM ${table}`).one().n

      return Object.fromEntries(["recipe", "revision", "recipe_item", "recipe_text", "recipe_tag", "collection_recipe", "change", "retry"].map((table) => [table, count(table)]))
    }

    case "sql":
      if (!/^\s*select\s/i.test(request.statement)) return { error: "select only" }

      return storage.sql.exec(request.statement, ...(request.params ?? [])).toArray()
    case "ageRetries":
      storage.sql.exec(`UPDATE retry SET expires_at = 0`)

      return { aged: true }
    case "alarm":
      return { alarm: await storage.getAlarm() }
  }
}

export const runDevOp = async ({ op, args, ...context }: DevContext & { readonly op: string; readonly args: typeof JsonObject.Type }): Promise<Json> => {
  const request = decodeDevRequest({ ...args, op })

  if (Option.isNone(request)) return { error: `unknown op or bad arguments: ${op}` }

  return toJson(await dispatch({ ...context, request: request.value, args }))
}
