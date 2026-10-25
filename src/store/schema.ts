// CookLibrary tables (specs/hosting.md#tables). Times are epoch milliseconds.
// recipe_text (FTS5) is not here: drizzle-kit doesn't know virtual tables. It is created in migration 0001.
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

export type Json = null | boolean | number | string | ReadonlyArray<Json> | { readonly [key: string]: Json }

// sync rule 4: who made a change.
export type Actor =
  | { readonly kind: "claude"; readonly connection: string }
  | { readonly kind: "device"; readonly device: string }
  | { readonly kind: "trash" }

export const recipe = sqliteTable("recipe", {
  id: text().primaryKey(),
  title: text().notNull(),
  latestRevision: integer("latest_revision").notNull(),
  source: text(),
  sourceKey: text("source_key").unique(), // adding rule 6, trashed recipes included
  trashedAt: integer("trashed_at"),
  purgeAt: integer("purge_at"),
  totalMinutes: integer("total_minutes"),
  hasFlow: integer("has_flow", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("recipe_purge_at").on(table.purgeAt)])

export const revision = sqliteTable(
  "revision",
  {
    recipeId: text("recipe_id").notNull(),
    revision: integer().notNull(),
    content: text({ mode: "json" }).$type<Json>().notNull(),
    was: text({ mode: "json" }).$type<Json>().notNull(),
    by: text({ mode: "json" }).$type<Actor>().notNull(),
    at: integer().notNull(),
    changeSeq: integer("change_seq").notNull(),
  },
  (table) => [primaryKey({ columns: [table.recipeId, table.revision] })],
)

export const recipeItem = sqliteTable(
  "recipe_item",
  { recipeId: text("recipe_id").notNull(), itemKey: text("item_key").notNull() },
  (table) => [primaryKey({ columns: [table.recipeId, table.itemKey] }), index("recipe_item_item_key").on(table.itemKey)],
)

export const tag = sqliteTable("tag", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  nameKey: text("name_key").notNull().unique(),
})

export const recipeTag = sqliteTable(
  "recipe_tag",
  { recipeId: text("recipe_id").notNull(), tagId: integer("tag_id").notNull() },
  (table) => [primaryKey({ columns: [table.recipeId, table.tagId] }), index("recipe_tag_tag_id").on(table.tagId)],
)

export const collection = sqliteTable("collection", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  nameKey: text("name_key").notNull().unique(), // also unique against smart_collection (library rule 9): checked by the writer
})

export const collectionRecipe = sqliteTable(
  "collection_recipe",
  { collectionId: integer("collection_id").notNull(), recipeId: text("recipe_id").notNull(), position: integer().notNull() },
  (table) => [primaryKey({ columns: [table.collectionId, table.recipeId] }), index("collection_recipe_recipe_id").on(table.recipeId)],
)

export const smartCollection = sqliteTable("smart_collection", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  nameKey: text("name_key").notNull().unique(),
  filter: text({ mode: "json" }).$type<Json>().notNull(),
})

// sync rules 1, 4. seq is the cook's sequence.
export const change = sqliteTable("change", {
  seq: integer().primaryKey(),
  at: integer().notNull(),
  by: text({ mode: "json" }).$type<Actor>().notNull(),
  kind: text().notNull(),
  payload: text({ mode: "json" }).$type<Json>().notNull(),
})

// specs/mcp.md#retries
export const retry = sqliteTable(
  "retry",
  {
    connection: text().notNull(),
    tool: text().notNull(),
    argsHash: text("args_hash").notNull(),
    result: text({ mode: "json" }).$type<Json>().notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.connection, table.tool, table.argsHash] })],
)

export const connection = sqliteTable("connection", {
  clientId: text("client_id").primaryKey(),
  name: text().notNull(),
  connectedAt: integer("connected_at").notNull(),
  disconnectedAt: integer("disconnected_at"),
})
