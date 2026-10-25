// The storage side of a cook's library (specs/hosting.md#cooklibrary). Sync SQLite over Drizzle, no MCP, no recipe rules.
// The domain's content is stored as JSON; `derive` (supplied by the wiring) computes the columns and search text from it.
import { and, asc, eq, inArray, isNotNull, lte, min, sql, type SQL } from "drizzle-orm"
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite"
import { Data, Result, Schema } from "effect"
import { LibraryNameTakenError, readLibrarySnapshot, writeLibrarySnapshot, type LibrarySnapshot } from "./library-change.ts"
import { retryWindowMs, type RetryKey } from "./retry.ts"
import * as schema from "./schema.ts"
import type { Actor, Json } from "./schema.ts"
import type { CleanedSource } from "./source.ts"

const { change, recipe, recipeItem, retry, revision } = schema

export const trashDays = 30 // revising rule 7
export const trashMs = 720 * 3600 * 1000

export type Db = DrizzleSqliteDODatabase<typeof schema>

// What the domain's content means to the columns and to search. Pure; supplied by the wiring.
export type Derived = {
  readonly title: string
  readonly totalMinutes: number | null
  readonly hasFlow: boolean
  readonly itemKeys: ReadonlyArray<string>
  readonly ingredientsText: string
  readonly stepsText: string
}

export type Derive = (content: Json) => Derived

export const nameKey = (name: string): string => name.toLowerCase() // tags, collections, items: the domain's libraryNameKey

// Durable Object SQLite allows 100 bound parameters per statement.
const maxBoundParameters = 90

const chunks = <T>(values: ReadonlyArray<T>): ReadonlyArray<ReadonlyArray<T>> =>
  Array.from({ length: Math.ceil(values.length / maxBoundParameters) }, (_, index) => values.slice(index * maxBoundParameters, (index + 1) * maxBoundParameters))

export type ChangeKind =
  | "recipe_added"
  | "recipe_revised"
  | "recipes_trashed"
  | "recipes_restored"
  | "recipes_purged"
  | "library_changed"

export class SourceTakenError extends Data.TaggedError("SourceTakenError")<{
  readonly recipeId: string
  readonly title: string
  readonly trashed: boolean
}> {}

export class RecipeNotFoundError extends Data.TaggedError("RecipeNotFoundError")<{ readonly recipeIds: ReadonlyArray<string> }> {}

export class RecipeTrashedError extends Data.TaggedError("RecipeTrashedError")<{ readonly recipeId: string }> {}

export class RevisionConflictError extends Data.TaggedError("RevisionConflictError")<{ readonly latestRevision: number }> {}

export type RecipeRow = {
  readonly id: string
  readonly title: string
  readonly latestRevision: number
  readonly source: string | null
  readonly trashedAt: number | null
  readonly purgeAt: number | null
  readonly totalMinutes: number | null
  readonly hasFlow: boolean
  readonly createdAt: number
}

export type StoredRevision = {
  readonly revision: number
  readonly content: Json
  readonly was: Json
  readonly by: Actor
  readonly at: number
  readonly changeSeq: number
}

export type SearchQuery = {
  readonly text?: string
  // every name in `all`; one of `any`, and one of each of `anyGroups` (two filters combined); none of `none`
  readonly tags?: {
    readonly all?: ReadonlyArray<string>
    readonly any?: ReadonlyArray<string>
    readonly anyGroups?: ReadonlyArray<ReadonlyArray<string>>
    readonly none?: ReadonlyArray<string>
  }
  readonly items?: ReadonlyArray<string>
  readonly maxTotalMinutes?: number
  readonly hasFlow?: boolean
  readonly collection?: string
  readonly limit?: number
  readonly cursor?: string
}

export type SearchHit = RecipeRow & { readonly content: Json }

const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`
const characters = (text: string) => [...text].length

// Writes inside one `transact`. Every write appends exactly one change row (sync rule 1).
export class Writes {
  alarmDirty = false

  constructor(
    private readonly db: Db,
    private readonly derive: Derive,
    readonly now: number,
  ) {}

  appendChange({ kind, by, payload }: { kind: ChangeKind; by: Actor; payload: Json }): number {
    return this.db.insert(change).values({ at: this.now, by, kind, payload }).returning({ seq: change.seq }).get().seq
  }

  // Adding rule 6: a clash on the cleaned source names the existing recipe, trashed included.
  addRecipe({ id, content, source, by }: { id: string; content: Json; source?: CleanedSource | undefined; by: Actor }): Result.Result<
    { revision: 1; changeSeq: number },
    SourceTakenError
  > {
    if (source !== undefined) {
      const taken = this.db.select({ id: recipe.id, title: recipe.title, trashedAt: recipe.trashedAt }).from(recipe).where(eq(recipe.sourceKey, source.sourceKey)).get()

      if (taken !== undefined) return Result.fail(new SourceTakenError({ recipeId: taken.id, title: taken.title, trashed: taken.trashedAt !== null }))
    }

    const derived = this.derive(content)
    const changeSeq = this.appendChange({ kind: "recipe_added", by, payload: { recipeId: id, revision: 1, title: derived.title } })
    this.db
      .insert(recipe)
      .values({
        id,
        title: derived.title,
        latestRevision: 1,
        source: source?.source ?? null,
        sourceKey: source?.sourceKey ?? null,
        totalMinutes: derived.totalMinutes,
        hasFlow: derived.hasFlow,
        createdAt: this.now,
      })
      .run()
    this.db.insert(revision).values({ recipeId: id, revision: 1, content, was: { added: true }, by, at: this.now, changeSeq }).run()
    this.writeDerived({ id, derived })

    return Result.succeed({ revision: 1, changeSeq })
  }

  // A revision, or a restore of an old one (the caller says which in `was`). Compare-and-set on the latest revision (revising rule 2).
  addRevision({ id, fromRevision, content, was, by }: { id: string; fromRevision: number; content: Json; was: Json; by: Actor }): Result.Result<
    { revision: number; changeSeq: number },
    RecipeNotFoundError | RecipeTrashedError | RevisionConflictError
  > {
    const current = this.db.select().from(recipe).where(eq(recipe.id, id)).get()

    if (current === undefined) return Result.fail(new RecipeNotFoundError({ recipeIds: [id] }))

    if (current.trashedAt !== null) return Result.fail(new RecipeTrashedError({ recipeId: id }))

    if (current.latestRevision !== fromRevision) return Result.fail(new RevisionConflictError({ latestRevision: current.latestRevision }))
    const derived = this.derive(content)
    const next = fromRevision + 1
    const changeSeq = this.appendChange({ kind: "recipe_revised", by, payload: { recipeId: id, revision: next, title: derived.title } })
    this.db.insert(revision).values({ recipeId: id, revision: next, content, was, by, at: this.now, changeSeq }).run()
    this.db.update(recipe).set({ title: derived.title, latestRevision: next, totalMinutes: derived.totalMinutes, hasFlow: derived.hasFlow }).where(eq(recipe.id, id)).run()
    this.deleteDerived(id)
    this.writeDerived({ id, derived })

    return Result.succeed({ revision: next, changeSeq })
  }

  // Revising rules 6, 7, 10: all or nothing, one change. One already trashed keeps its date.
  trashRecipes({ ids, by }: { ids: ReadonlyArray<string>; by: Actor }): Result.Result<ReadonlyArray<{ id: string; purgeAt: number }>, RecipeNotFoundError> {
    const rows = this.rowsOf(ids)

    if (Result.isFailure(rows)) return Result.fail(rows.failure)
    const trashed = this.now
    const purgeAt = trashed + trashMs
    const fresh = rows.success.filter((row) => row.trashedAt === null)
    const all = rows.success.map((row) => ({ id: row.id, purgeAt: row.purgeAt ?? purgeAt }))
    this.appendChange({ kind: "recipes_trashed", by, payload: { recipes: fresh.map((row) => ({ id: row.id, purgeAt })), alreadyTrashed: rows.success.length - fresh.length } })

    for (const row of fresh) {
      this.db.update(recipe).set({ trashedAt: trashed, purgeAt }).where(eq(recipe.id, row.id)).run()
      this.db.run(sql`DELETE FROM recipe_text WHERE rowid = (SELECT rowid FROM recipe WHERE id = ${row.id})`)
    }

    this.alarmDirty = true

    return Result.succeed(all)
  }

  // Revising rules 8, 10: tags and collection places were kept, so only the trash columns and the search row change.
  restoreRecipes({ ids, by }: { ids: ReadonlyArray<string>; by: Actor }): Result.Result<ReadonlyArray<string>, RecipeNotFoundError> {
    const rows = this.rowsOf(ids)

    if (Result.isFailure(rows)) return Result.fail(rows.failure)
    const trashed = rows.success.filter((row) => row.trashedAt !== null)
    this.appendChange({ kind: "recipes_restored", by, payload: { recipeIds: trashed.map((row) => row.id) } })

    for (const row of trashed) {
      this.db.update(recipe).set({ trashedAt: null, purgeAt: null }).where(eq(recipe.id, row.id)).run()
      const latest = this.db.select({ content: revision.content }).from(revision).where(and(eq(revision.recipeId, row.id), eq(revision.revision, row.latestRevision))).get()
      this.writeSearchText({ id: row.id, derived: this.derive(latest!.content) })
    }

    this.alarmDirty = true

    return Result.succeed(rows.success.map((row) => row.id))
  }

  // Revising rules 7, 9. Called by the alarm; the change is by the trash (sync rule 4).
  purgeDue(): ReadonlyArray<string> {
    const due = this.db.select({ id: recipe.id }).from(recipe).where(and(isNotNull(recipe.purgeAt), lte(recipe.purgeAt, this.now))).all()

    if (due.length === 0) return []
    const ids = due.map((row) => row.id)
    this.appendChange({ kind: "recipes_purged", by: { kind: "trash" }, payload: { recipeIds: ids } })

    for (const id of ids) this.db.run(sql`DELETE FROM recipe_text WHERE rowid = (SELECT rowid FROM recipe WHERE id = ${id})`)

    for (const some of chunks(ids)) {
      this.db.delete(revision).where(inArray(revision.recipeId, [...some])).run()
      this.db.delete(recipeItem).where(inArray(recipeItem.recipeId, [...some])).run()
      this.db.delete(schema.recipeTag).where(inArray(schema.recipeTag.recipeId, [...some])).run()
      this.db.delete(schema.collectionRecipe).where(inArray(schema.collectionRecipe.recipeId, [...some])).run()
      this.db.delete(recipe).where(inArray(recipe.id, [...some])).run()
    }

    this.alarmDirty = true

    return ids
  }

  // Library rules 1, 2: the whole library after the batch becomes the tables; the batch is one change that names what is gone.
  applyLibraryChange({ library, edits, by }: { library: LibrarySnapshot; edits: Json; by: Actor }): Result.Result<void, LibraryNameTakenError> {
    const written = writeLibrarySnapshot({ db: this.db, next: library })

    if (Result.isFailure(written)) return Result.fail(written.failure)
    this.appendChange({ kind: "library_changed", by, payload: { edits, changed: written.success.changed, deleted: written.success.deleted } })

    return Result.succeed(undefined)
  }

  private rowsOf(ids: ReadonlyArray<string>): Result.Result<ReadonlyArray<typeof recipe.$inferSelect>, RecipeNotFoundError> {
    const unique = [...new Set(ids)]
    const rows = chunks(unique).flatMap((some) => this.db.select().from(recipe).where(inArray(recipe.id, [...some])).all())
    const found = new Set(rows.map((row) => row.id))
    const missing = unique.filter((id) => !found.has(id))

    return missing.length > 0 ? Result.fail(new RecipeNotFoundError({ recipeIds: missing })) : Result.succeed(rows)
  }

  private writeDerived({ id, derived }: { id: string; derived: Derived }) {
    const keys = [...new Set(derived.itemKeys)]

    if (keys.length > 0) this.db.insert(recipeItem).values(keys.map((itemKey) => ({ recipeId: id, itemKey }))).run()
    this.writeSearchText({ id, derived })
  }

  private writeSearchText({ id, derived }: { id: string; derived: Derived }) {
    this.db.run(
      sql`INSERT INTO recipe_text (rowid, title, ingredients, steps) VALUES ((SELECT rowid FROM recipe WHERE id = ${id}), ${derived.title}, ${derived.ingredientsText}, ${derived.stepsText})`,
    )
  }

  private deleteDerived(id: string) {
    this.db.delete(recipeItem).where(eq(recipeItem.recipeId, id)).run()
    this.db.run(sql`DELETE FROM recipe_text WHERE rowid = (SELECT rowid FROM recipe WHERE id = ${id})`)
  }
}

type RecipeCount = { readonly name: string; readonly recipes: number }

type RecipeCounts = { readonly tags: ReadonlyArray<RecipeCount>; readonly collections: ReadonlyArray<RecipeCount> }

export class Library {
  constructor(
    private readonly options: {
      readonly db: Db
      readonly storage: DurableObjectStorage
      readonly derive: Derive
      readonly now?: () => number
    },
  ) {}

  private get db() {
    return this.options.db
  }

  // One SQLite transaction: the content, the derived columns, the FTS row, the change, and the retry row commit together.
  // A Result failure rolls everything back. With `retry`, the same call inside the window returns the stored first result.
  // With `dryRun`, a success rolls back too: the caller sees what the write would return, and nothing changes (specs/mcp.md dryRun).
  async transact<A extends Json, E>({
    retry: key,
    dryRun = false,
    run,
  }: {
    retry?: RetryKey | undefined
    dryRun?: boolean
    run: (writes: Writes) => Result.Result<A, E>
  }): Promise<Result.Result<A, E>> {
    const now = (this.options.now ?? Date.now)()
    const writes = new Writes(this.db, this.options.derive, now)
    let outcome: Result.Result<A, E>

    // A refused write or a dry run throws this out of the transaction so SQLite rolls back; it is caught below and returned.
    class Rollback {
      constructor(readonly outcome: Result.Result<A, E>) {}
    }

    try {
      outcome = this.options.storage.transactionSync(() => {
        this.db.delete(retry).where(lte(retry.expiresAt, now)).run()

        if (key !== undefined && !dryRun) {
          const hit = this.db
            .select({ result: retry.result })
            .from(retry)
            .where(and(eq(retry.connection, key.connection), eq(retry.tool, key.tool), eq(retry.argsHash, key.argsHash)))
            .get()

          if (hit !== undefined) {
            // SAFETY: the key names the same connection, tool, and arguments, so the stored result is what that call returned: an A.
            return Result.succeed(hit.result as A)
          }
        }

        const result = run(writes)

        if (Result.isFailure(result) || dryRun) throw new Rollback(result)

        if (key !== undefined) {
          // Only the connection's latest write can be retried: tagging, untagging, and tagging again must write each time.
          this.db.delete(retry).where(eq(retry.connection, key.connection)).run()
          this.db.insert(retry).values({ ...key, result: result.success, expiresAt: now + retryWindowMs }).run()
        }

        return result
      })
    } catch (thrown) {
      if (thrown instanceof Rollback) return thrown.outcome
      throw thrown
    }

    if (writes.alarmDirty) await this.scheduleAlarm()

    return outcome
  }

  // The single alarm is at the earliest purge_at (revising rule 7); none when nothing is trashed.
  async scheduleAlarm(): Promise<void> {
    const next = this.db.select({ at: min(recipe.purgeAt) }).from(recipe).get()?.at ?? null

    if (next === null) await this.options.storage.deleteAlarm()
    else await this.options.storage.setAlarm(next)
  }

  getRecipe(id: string, revisionNumber?: number): (RecipeRow & StoredRevision) | undefined {
    const row = this.db.select().from(recipe).where(eq(recipe.id, id)).get()

    if (row === undefined) return undefined

    const stored = this.db
      .select()
      .from(revision)
      .where(and(eq(revision.recipeId, id), eq(revision.revision, revisionNumber ?? row.latestRevision)))
      .get()

    if (stored === undefined) return undefined

    return { ...row, revision: stored.revision, content: stored.content, was: stored.was, by: stored.by, at: stored.at, changeSeq: stored.changeSeq }
  }

  findRecipeIdBySourceKey(sourceKey: string): string | undefined {
    return this.db.select({ id: recipe.id }).from(recipe).where(eq(recipe.sourceKey, sourceKey)).get()?.id
  }

  // Where each recipe is; a purged or unknown one is absent.
  placesOf(ids: ReadonlyArray<string>): Map<string, "library" | "trash"> {
    const places = new Map<string, "library" | "trash">()

    for (const some of chunks([...new Set(ids)])) {
      for (const row of this.db.select({ id: recipe.id, trashedAt: recipe.trashedAt }).from(recipe).where(inArray(recipe.id, [...some])).all()) {
        places.set(row.id, row.trashedAt === null ? "library" : "trash")
      }
    }

    return places
  }

  readLibrary(): LibrarySnapshot {
    return readLibrarySnapshot(this.db)
  }

  // Names of the tags on each recipe, and the collections each is in, for views.
  tagNamesOf(ids: ReadonlyArray<string>): Map<string, Array<string>> {
    const names = new Map<string, Array<string>>()

    for (const some of chunks(ids)) {
      const rows = this.db
        .select({ recipeId: schema.recipeTag.recipeId, name: schema.tag.name })
        .from(schema.recipeTag)
        .innerJoin(schema.tag, eq(schema.tag.id, schema.recipeTag.tagId))
        .where(inArray(schema.recipeTag.recipeId, [...some]))
        .orderBy(sql`${schema.tag.nameKey}`)
        .all()

      for (const row of rows) names.set(row.recipeId, [...(names.get(row.recipeId) ?? []), row.name])
    }

    return names
  }

  collectionNamesOf(id: string): Array<string> {
    return this.db
      .select({ name: schema.collection.name })
      .from(schema.collectionRecipe)
      .innerJoin(schema.collection, eq(schema.collection.id, schema.collectionRecipe.collectionId))
      .where(eq(schema.collectionRecipe.recipeId, id))
      .orderBy(sql`${schema.collection.nameKey}`)
      .all()
      .map((row) => row.name)
  }

  // get_library: recipe counts leave the trash out (revising rule 6).
  countRecipesByName(): RecipeCounts {
    const count = (table: "tag" | "collection") =>
      this.db.all<{ name: string; recipes: number }>(
        table === "tag"
          ? sql`SELECT t.name AS name, count(r.id) AS recipes FROM tag t
              LEFT JOIN recipe_tag rt ON rt.tag_id = t.id
              LEFT JOIN recipe r ON r.id = rt.recipe_id AND r.trashed_at IS NULL
              GROUP BY t.id ORDER BY t.name_key`
          : sql`SELECT c.name AS name, count(r.id) AS recipes FROM collection c
              LEFT JOIN collection_recipe cr ON cr.collection_id = c.id
              LEFT JOIN recipe r ON r.id = cr.recipe_id AND r.trashed_at IS NULL
              GROUP BY c.id ORDER BY c.name_key`,
      )

    return { tags: count("tag"), collections: count("collection") }
  }

  smartCollections(): ReadonlyArray<{ name: string; filter: Json }> {
    return this.db.select({ name: schema.smartCollection.name, filter: schema.smartCollection.filter }).from(schema.smartCollection).orderBy(sql`${schema.smartCollection.nameKey}`).all()
  }

  smartCollectionFilter(name: string): Json | undefined {
    return this.db.select({ filter: schema.smartCollection.filter }).from(schema.smartCollection).where(eq(schema.smartCollection.nameKey, nameKey(name))).get()?.filter
  }

  hasCollection(name: string): boolean {
    return this.db.select({ id: schema.collection.id }).from(schema.collection).where(eq(schema.collection.nameKey, nameKey(name))).get() !== undefined
  }

  // The name each connection goes by, for "who" in a revision (sync rule 4).
  connectionNames(): Map<string, string> {
    return new Map(this.db.select({ clientId: schema.connection.clientId, name: schema.connection.name }).from(schema.connection).all().map((row) => [row.clientId, row.name]))
  }

  listRevisions(id: string): ReadonlyArray<StoredRevision> {
    return this.db.select().from(revision).where(eq(revision.recipeId, id)).orderBy(sql`${revision.revision} DESC`).all()
  }

  listTrash(): ReadonlyArray<{ id: string; title: string; trashedAt: number; purgeAt: number }> {
    return this.db
      .select({ id: recipe.id, title: recipe.title, trashedAt: recipe.trashedAt, purgeAt: recipe.purgeAt })
      .from(recipe)
      .where(isNotNull(recipe.trashedAt))
      .orderBy(asc(recipe.purgeAt), asc(recipe.id))
      .all()
      .flatMap((row) => (row.trashedAt === null || row.purgeAt === null ? [] : [{ ...row, trashedAt: row.trashedAt, purgeAt: row.purgeAt }]))
  }

  listChanges({ after, limit }: { after: number; limit: number }) {
    return this.db.select().from(change).where(sql`${change.seq} > ${after}`).orderBy(asc(change.seq)).limit(limit).all()
  }

  // Cooking rule 9. Trashed recipes never appear (revising rule 6). Order: collection position, then relevance, then title.
  search(query: SearchQuery): { recipes: ReadonlyArray<SearchHit>; cursor?: string } {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
    const offset = query.cursor === undefined ? 0 : Math.max(Number.parseInt(query.cursor, 10) || 0, 0)
    const where: SQL[] = [sql`r.trashed_at IS NULL`]
    const joins: SQL[] = []

    const text = query.text?.trim() ?? ""
    const terms = text === "" ? [] : text.split(/\s+/)
    const matchTerms = terms.filter((term) => characters(term) >= 3)
    const useFts = matchTerms.length > 0

    if (useFts) {
      joins.push(sql`JOIN recipe_text ON recipe_text.rowid = r.rowid`)
      where.push(sql`recipe_text MATCH ${matchTerms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" AND ")}`)
    } else if (text !== "") {
      where.push(sql`r.title LIKE ${likePattern(text)} ESCAPE '\\'`) // under 3 characters
    }

    const hasTag = (names: ReadonlyArray<string>) =>
      sql`EXISTS (SELECT 1 FROM recipe_tag rt JOIN tag t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id AND t.name_key IN (${sql.join(names.map((name) => sql`${nameKey(name)}`), sql`, `)}))`

    for (const name of query.tags?.all ?? []) where.push(hasTag([name]))

    for (const group of [query.tags?.any ?? [], ...(query.tags?.anyGroups ?? [])]) if (group.length > 0) where.push(hasTag(group))

    if ((query.tags?.none ?? []).length > 0) where.push(sql`NOT ${hasTag(query.tags!.none!)}`)

    for (const item of query.items ?? []) where.push(sql`EXISTS (SELECT 1 FROM recipe_item i WHERE i.recipe_id = r.id AND i.item_key = ${nameKey(item)})`)

    if (query.maxTotalMinutes !== undefined) where.push(sql`r.total_minutes <= ${query.maxTotalMinutes}`)

    if (query.hasFlow !== undefined) where.push(sql`r.has_flow = ${query.hasFlow ? 1 : 0}`)

    if (query.collection !== undefined) {
      joins.push(sql`JOIN collection_recipe cr ON cr.recipe_id = r.id JOIN collection c ON c.id = cr.collection_id AND c.name_key = ${nameKey(query.collection)}`)
    }

    const order: SQL[] = []

    if (query.collection !== undefined) order.push(sql`cr.position`)

    if (useFts) order.push(sql`bm25(recipe_text)`)
    order.push(sql`r.title COLLATE NOCASE`, sql`r.id`)

    const rows = this.db.all<{
      id: string
      title: string
      latest_revision: number
      source: string | null
      trashed_at: number | null
      purge_at: number | null
      total_minutes: number | null
      has_flow: number
      created_at: number
      content: string
    }>(sql`SELECT r.id, r.title, r.latest_revision, r.source, r.trashed_at, r.purge_at, r.total_minutes, r.has_flow, r.created_at, rev.content
      FROM recipe r
      JOIN revision rev ON rev.recipe_id = r.id AND rev.revision = r.latest_revision
      ${sql.join(joins, sql` `)}
      WHERE ${sql.join(where, sql` AND `)}
      ORDER BY ${sql.join(order, sql`, `)}
      LIMIT ${limit + 1} OFFSET ${offset}`)

    const recipes = rows.slice(0, limit).map(
      (row): SearchHit => ({
        id: row.id,
        title: row.title,
        latestRevision: row.latest_revision,
        source: row.source,
        trashedAt: row.trashed_at,
        purgeAt: row.purge_at,
        totalMinutes: row.total_minutes,
        hasFlow: row.has_flow !== 0,
        createdAt: row.created_at,
        content: Schema.decodeUnknownSync(Schema.Json)(JSON.parse(row.content)),
      }),
    )

    return rows.length > limit ? { recipes, cursor: String(offset + limit) } : { recipes }
  }
}
