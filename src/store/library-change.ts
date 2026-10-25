// Tags, collections, and smart collections (library rules 3, 9): the whole library after a batch is diffed against the tables.
// A rename is a delete and an insert, so the change names the old name as gone (sync rule 2).
import { and, asc, eq, inArray } from "drizzle-orm"
import { Data, Result } from "effect"
import type { Db } from "./library.ts"
import { nameKey } from "./library.ts"
import { canonicalJson } from "./retry.ts"
import * as schema from "./schema.ts"
import type { Json } from "./schema.ts"

const { collection, collectionRecipe, recipeTag, smartCollection, tag } = schema

export type LibrarySnapshot = {
  readonly tags: ReadonlyArray<{ readonly name: string; readonly recipeIds: ReadonlyArray<string> }>
  readonly collections: ReadonlyArray<{ readonly name: string; readonly recipeIds: ReadonlyArray<string> }>
  readonly smartCollections: ReadonlyArray<{ readonly name: string; readonly filter: Json }>
}

export type NamesByKind = { readonly tags: ReadonlyArray<string>; readonly collections: ReadonlyArray<string>; readonly smartCollections: ReadonlyArray<string> }

// Library rule 9: a collection and a smart collection never share a name. The domain refuses first; this is the writer's check.
export class LibraryNameTakenError extends Data.TaggedError("LibraryNameTakenError")<{ readonly name: string }> {}

export const readLibrarySnapshot = (db: Db): LibrarySnapshot => {
  const tagMembers = db.select().from(recipeTag).orderBy(asc(recipeTag.tagId)).all()
  const collectionMembers = db.select().from(collectionRecipe).orderBy(asc(collectionRecipe.collectionId), asc(collectionRecipe.position)).all()
  return {
    tags: db.select().from(tag).orderBy(asc(tag.id)).all().map((row) => ({
      name: row.name,
      recipeIds: tagMembers.filter((member) => member.tagId === row.id).map((member) => member.recipeId),
    })),
    collections: db.select().from(collection).orderBy(asc(collection.id)).all().map((row) => ({
      name: row.name,
      recipeIds: collectionMembers.filter((member) => member.collectionId === row.id).map((member) => member.recipeId),
    })),
    smartCollections: db.select().from(smartCollection).orderBy(asc(smartCollection.id)).all().map((row) => ({ name: row.name, filter: row.filter })),
  }
}

const sameList = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) => left.length === right.length && left.every((value, index) => value === right[index])

const byKey = <T extends { readonly name: string }>(list: ReadonlyArray<T>): ReadonlyMap<string, T> => new Map(list.map((entry) => [nameKey(entry.name), entry]))

const tagsOf = ({ db, next }: { db: Db; next: LibrarySnapshot }): { changed: Array<string>; deleted: Array<string> } => {
  const changed: Array<string> = []
  const deleted: Array<string> = []
  const wanted = byKey(next.tags)
  const rows = db.select().from(tag).all()
  const members = db.select().from(recipeTag).all()
  for (const row of rows) {
    if (wanted.has(row.nameKey)) continue
    db.delete(recipeTag).where(eq(recipeTag.tagId, row.id)).run()
    db.delete(tag).where(eq(tag.id, row.id)).run()
    deleted.push(row.name)
  }
  const existing = new Map(rows.map((row) => [row.nameKey, row]))
  for (const [key, entry] of wanted) {
    const row = existing.get(key)
    if (row === undefined) {
      const id = db.insert(tag).values({ name: entry.name, nameKey: key }).returning({ id: tag.id }).get().id
      for (const recipeId of entry.recipeIds) db.insert(recipeTag).values({ recipeId, tagId: id }).run()
      changed.push(entry.name)
      continue
    }
    const had = members.filter((member) => member.tagId === row.id).map((member) => member.recipeId)
    const removed = had.filter((recipeId) => !entry.recipeIds.includes(recipeId))
    const added = entry.recipeIds.filter((recipeId) => !had.includes(recipeId))
    if (row.name === entry.name && removed.length === 0 && added.length === 0) continue
    if (row.name !== entry.name) db.update(tag).set({ name: entry.name }).where(eq(tag.id, row.id)).run()
    if (removed.length > 0) db.delete(recipeTag).where(and(eq(recipeTag.tagId, row.id), inArray(recipeTag.recipeId, removed))).run()
    for (const recipeId of added) db.insert(recipeTag).values({ recipeId, tagId: row.id }).run()
    changed.push(entry.name)
  }
  return { changed, deleted }
}

const collectionsOf = ({ db, next }: { db: Db; next: LibrarySnapshot }): { changed: Array<string>; deleted: Array<string> } => {
  const changed: Array<string> = []
  const deleted: Array<string> = []
  const wanted = byKey(next.collections)
  const rows = db.select().from(collection).all()
  const members = db.select().from(collectionRecipe).orderBy(asc(collectionRecipe.position)).all()
  for (const row of rows) {
    if (wanted.has(row.nameKey)) continue
    db.delete(collectionRecipe).where(eq(collectionRecipe.collectionId, row.id)).run()
    db.delete(collection).where(eq(collection.id, row.id)).run()
    deleted.push(row.name)
  }
  const existing = new Map(rows.map((row) => [row.nameKey, row]))
  for (const [key, entry] of wanted) {
    const row = existing.get(key)
    const id = row?.id ?? db.insert(collection).values({ name: entry.name, nameKey: key }).returning({ id: collection.id }).get().id
    const had = row === undefined ? [] : members.filter((member) => member.collectionId === id).map((member) => member.recipeId)
    if (row !== undefined && row.name === entry.name && sameList(had, entry.recipeIds)) continue
    if (row !== undefined && row.name !== entry.name) db.update(collection).set({ name: entry.name }).where(eq(collection.id, id)).run()
    if (!sameList(had, entry.recipeIds)) {
      db.delete(collectionRecipe).where(eq(collectionRecipe.collectionId, id)).run()
      entry.recipeIds.forEach((recipeId, position) => db.insert(collectionRecipe).values({ collectionId: id, recipeId, position }).run())
    }
    changed.push(entry.name)
  }
  return { changed, deleted }
}

const smartCollectionsOf = ({ db, next }: { db: Db; next: LibrarySnapshot }): { changed: Array<string>; deleted: Array<string> } => {
  const changed: Array<string> = []
  const deleted: Array<string> = []
  const wanted = byKey(next.smartCollections)
  const rows = db.select().from(smartCollection).all()
  for (const row of rows) {
    if (wanted.has(row.nameKey)) continue
    db.delete(smartCollection).where(eq(smartCollection.id, row.id)).run()
    deleted.push(row.name)
  }
  const existing = new Map(rows.map((row) => [row.nameKey, row]))
  for (const [key, entry] of wanted) {
    const row = existing.get(key)
    if (row === undefined) db.insert(smartCollection).values({ name: entry.name, nameKey: key, filter: entry.filter }).run()
    else if (row.name === entry.name && canonicalJson(row.filter) === canonicalJson(entry.filter)) continue
    else db.update(smartCollection).set({ name: entry.name, filter: entry.filter }).where(eq(smartCollection.id, row.id)).run()
    changed.push(entry.name)
  }
  return { changed, deleted }
}

// Writes the rows, returns what changed and what is gone, by name.
export const writeLibrarySnapshot = ({ db, next }: { db: Db; next: LibrarySnapshot }): Result.Result<{ changed: NamesByKind; deleted: NamesByKind }, LibraryNameTakenError> => {
  const smartKeys = new Set(next.smartCollections.map((entry) => nameKey(entry.name)))
  const clash = next.collections.find((entry) => smartKeys.has(nameKey(entry.name)))
  if (clash !== undefined) return Result.fail(new LibraryNameTakenError({ name: clash.name }))
  const tags = tagsOf({ db, next })
  const collections = collectionsOf({ db, next })
  const smartCollections = smartCollectionsOf({ db, next })
  return Result.succeed({
    changed: { tags: tags.changed, collections: collections.changed, smartCollections: smartCollections.changed },
    deleted: { tags: tags.deleted, collections: collections.deleted, smartCollections: smartCollections.deleted },
  })
}
