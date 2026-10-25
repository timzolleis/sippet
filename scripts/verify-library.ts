/// <reference types="node" />
// Checks the CookLibrary storage against `pnpm dev` (local state only): migrations, add/revise, source key, search, trash, purge alarm,
// change log, retries. Drives the Library through the localhost-only /api/dev ops. Run: node scripts/verify-library.ts [http://localhost:1337]
import { Schema } from "effect"
import { signInLocalCook } from "./local-cook.ts"

const origin = process.argv[2] ?? "http://localhost:1337"
const step = (text: string) => console.log(`\n── ${text}`)

const check = (label: string, ok: boolean, detail?: Schema.Json | ReadonlyArray<Schema.Json | undefined>) => {
  console.log(`   ${ok ? "ok  " : "FAIL"} ${label}${ok || detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`)

  if (!ok) process.exitCode = 1
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const cook = await signInLocalCook(origin)

// Replies are plain JSON; `at` reads a path out of one without assuming its shape.
type Json = Schema.Json

const isJsonObject = Schema.is(Schema.Record(Schema.String, Schema.Json))

const at = (value: Json | undefined, ...path: ReadonlyArray<string | number>): Json | undefined =>
  path.reduce<Json | undefined>((node, key) => {
    if (Array.isArray(node)) return node[Number(key)]

    return isJsonObject(node) ? node[String(key)] : undefined
  }, value)

const list = (value: Json | undefined): ReadonlyArray<Json> => (Array.isArray(value) ? value : [])
const first = (value: Json | undefined): Json | undefined => list(value)[0]
const numberOf = (value: Json | undefined): number => (Schema.is(Schema.Number)(value) ? value : Number.NaN)
const textOf = (value: Json | undefined): string => (Schema.is(Schema.String)(value) ? value : "")
const ok = (reply: Json) => at(reply, "ok") === true
const errorOf = (reply: Json, field: string) => at(reply, "error", field)
const valueOf = (reply: Json, ...path: ReadonlyArray<string | number>) => at(reply, "value", ...path)

// Columns that hold JSON text.
const parsed = (row: Json | undefined, column: string): Json => Schema.decodeUnknownSync(Schema.Json)(JSON.parse(textOf(at(row, column))))

const devAs = (token: string) => async (op: string, args: Json = {}): Promise<Json> => {
  const res = await fetch(`${origin}/api/dev/${op}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(args) })
  const text = await res.text()

  try {
    return Schema.decodeUnknownSync(Schema.Json)(JSON.parse(text))
  } catch {
    throw new Error(`${op}: ${res.status} ${text.slice(0, 300)}`)
  }
}

const dev = devAs(cook.token)
const rows = (statement: string, params: Array<Json> = []) => dev("sql", { statement, params })
const count = async (table: string, where = "1=1") => numberOf(at(first(await rows(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)), "n"))
const found = async (query: Json) => list(at(await dev("search", { query }), "recipes")).map((hit) => at(hit, "id"))

const zupfkuchen = (overrides: Readonly<Record<string, Json>> = {}) => ({
  title: "Veganer Russischer Zupfkuchen",
  ingredients: [
    { key: "puderzucker", item: "Puderzucker", note: "gesiebt" },
    { key: "skyr", item: "Skyr" },
    { key: "butter", item: "vegane Butter", prep: "schmelzen" },
  ],
  steps: [
    { key: "verruehren", label: "mit dem Mixer gut verrühren", uses: ["skyr", "puderzucker"] },
    { key: "backen", label: "backen", duration: { minutes: 60, maxMinutes: 65, kind: "passive" } },
  ],
  ...overrides,
})

const pfannkuchen = {
  title: "Pfannkuchen",
  ingredients: [{ key: "mehl", item: "Mehl" }, { key: "milch", item: "Milch" }],
  steps: [{ key: "braten", label: "in der Pfanne ausbacken", duration: { minutes: 10, kind: "active" } }],
}

step("migrations")

const tables = list(await rows(`SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name`)).map((row) => at(row, "name"))

for (const name of ["recipe", "revision", "recipe_item", "recipe_text", "tag", "recipe_tag", "collection", "collection_recipe", "smart_collection", "change", "retry", "connection"])
  check(`table ${name}`, tables.includes(name))

check("one migration row per file", (await count("__drizzle_migrations")) === 2)

const fts = textOf(at(first(await rows(`SELECT sql FROM sqlite_master WHERE name = 'recipe_text'`)), "sql"))

check("recipe_text is trigram + remove_diacritics 1", /trigram remove_diacritics 1/.test(fts), fts)

check("connection rows survive (the iat check ran for this token)", (await count("connection", "client_id = ?".replace("?", `'${cook.clientId}'`))) === 1)

step("add (adding rules 2, 6; sync rule 1)")

const added = await dev("add", { id: "rcp_1", content: zupfkuchen(), source: "http://www.example.com/rezepte/zupfkuchen/?utm_source=instagram&id=7#top" })

check("added at revision 1", ok(added) && valueOf(added, "revision") === 1, added)

const stored = first(await rows(`SELECT source, source_key, total_minutes, has_flow, latest_revision FROM recipe WHERE id = 'rcp_1'`))

check("source is the cleaned address", at(stored, "source") === "https://example.com/rezepte/zupfkuchen?id=7", stored)

check("source_key is the address without the scheme", at(stored, "source_key") === "example.com/rezepte/zupfkuchen?id=7", stored)

check("derived columns", at(stored, "total_minutes") === 65 && at(stored, "has_flow") === 1 && at(stored, "latest_revision") === 1, stored)

check("items stored lowercased", JSON.stringify(list(await rows(`SELECT item_key FROM recipe_item WHERE recipe_id = 'rcp_1' ORDER BY 1`)).map((row) => at(row, "item_key"))) === JSON.stringify(["puderzucker", "skyr", "vegane butter"]))

check("one FTS row", (await count("recipe_text")) === 1)

const revision1 = first(await rows(`SELECT content, was, by, change_seq FROM revision WHERE recipe_id = 'rcp_1'`))

check("content stored as JSON, was and by", at(parsed(revision1, "content"), "title") === "Veganer Russischer Zupfkuchen" && at(parsed(revision1, "was"), "added") === true && at(parsed(revision1, "by"), "connection") === cook.clientId, revision1)

let changes = list(await dev("changes"))

check("one change: recipe_added by this connection", changes.length === 1 && at(changes[0], "kind") === "recipe_added" && at(changes[0], "by", "connection") === cook.clientId, changes)

check("revision.change_seq points at it", at(revision1, "change_seq") === at(changes[0], "seq"))

step("source key (adding rule 6)")

const clash = await dev("add", { id: "rcp_x", content: zupfkuchen(), source: "https://example.com/rezepte/zupfkuchen/?id=7&utm_medium=x" })

check("same page with tracking parameters refused, names the existing recipe", !ok(clash) && errorOf(clash, "_tag") === "SourceTakenError" && errorOf(clash, "recipeId") === "rcp_1" && errorOf(clash, "trashed") === false, clash)

check("a refusal writes nothing", (await count("recipe")) === 1 && (await count("change")) === 1)

const other = await dev("add", { id: "rcp_2", content: pfannkuchen, source: "https://example.com/rezepte/pfannkuchen" })

check("a different page is added", ok(other), other)

const unreachable = await dev("add", { id: "rcp_3", content: { title: "Offline" }, source: "https://nonexistent.invalid/a/?utm_source=x" })

check("an unreachable host keeps its address (network error)", ok(unreachable) && at(first(await rows(`SELECT source FROM recipe WHERE id = 'rcp_3'`)), "source") === "https://nonexistent.invalid/a", unreachable)

const bad = await dev("add", { id: "rcp_4", content: { title: "Bad" }, source: "not a url" })

check("an unusable source is refused", !ok(bad) && errorOf(bad, "_tag") === "InvalidSourceError", bad)

const noSource = await dev("add", { id: "rcp_5", content: { title: "Ohne Quelle" } })
const noSource2 = await dev("add", { id: "rcp_6", content: { title: "Ohne Quelle 2" } })

check("recipes without a source don't clash", ok(noSource) && ok(noSource2))

step("a write that throws rolls back whole")

const changesBefore = await count("change")
const retriesBefore = await count("retry")
const countsBefore = JSON.stringify(await dev("counts"))
const duplicate = await fetch(`${origin}/api/dev/add`, { method: "POST", headers: { authorization: `Bearer ${cook.token}`, "content-type": "application/json" }, body: JSON.stringify({ id: "rcp_1", content: zupfkuchen(), retryTool: "add_recipe", retryArgs: { boom: 1 } }) })

check("a duplicate id fails (500)", duplicate.status === 500, duplicate.status)

check("its change row, items, FTS row, and retry row are gone", JSON.stringify(await dev("counts")) === countsBefore && (await count("change")) === changesBefore && (await count("retry")) === retriesBefore, await dev("counts"))

step("revise (revising rules 2, 3)")

const stale = await dev("revise", { id: "rcp_1", fromRevision: 5, content: zupfkuchen() })

check("stale fromRevision → latestRevision", !ok(stale) && errorOf(stale, "_tag") === "RevisionConflictError" && errorOf(stale, "latestRevision") === 1, stale)

const missing = await dev("revise", { id: "nope", fromRevision: 1, content: zupfkuchen() })

check("unknown recipe refused", !ok(missing) && errorOf(missing, "_tag") === "RecipeNotFoundError", missing)

const revised = await dev("revise", {
  id: "rcp_1",
  fromRevision: 1,
  was: { edits: [{ op: "set_title" }] },
  content: zupfkuchen({ title: "Zupfkuchen", ingredients: [{ key: "kakao", item: "Kakao", note: "Backkakao" }], steps: [{ key: "backen", label: "backen", duration: { minutes: 50, kind: "passive" } }] }),
})

check("revision 2", ok(revised) && valueOf(revised, "revision") === 2, revised)

const recipe1 = await dev("get", { id: "rcp_1" })

check("recipe row follows the latest revision", at(recipe1, "title") === "Zupfkuchen" && at(recipe1, "latestRevision") === 2 && at(recipe1, "totalMinutes") === 50 && at(recipe1, "hasFlow") === false, recipe1)

const old = await dev("get", { id: "rcp_1", revision: 1 })

check("revision 1 is kept, as written", at(old, "content", "title") === "Veganer Russischer Zupfkuchen" && at(old, "revision") === 1)

check("items replaced", JSON.stringify(list(await rows(`SELECT item_key FROM recipe_item WHERE recipe_id = 'rcp_1'`)).map((row) => at(row, "item_key"))) === JSON.stringify(["kakao"]))

check("one FTS row per recipe that isn't trashed", (await count("recipe_text")) === (await count("recipe", "trashed_at IS NULL")))

check("old text is gone from search", !(await found({ text: "puderzucker" })).includes("rcp_1"))

check("new text is found", (await found({ text: "backkakao" })).includes("rcp_1"))

check("list_revisions newest first", list(await dev("revisions", { id: "rcp_1" })).map((row) => at(row, "revision")).join() === "2,1")

changes = list(await dev("changes"))

check("one change per write", changes.length === 6 && at(changes.at(-1), "kind") === "recipe_revised", changes.map((change) => at(change, "kind")))

// back to the original content for the search checks
await dev("revise", { id: "rcp_1", fromRevision: 2, was: { restored: 1 }, content: zupfkuchen() })

step("search (cooking rule 9)")

check("zucker finds Puderzucker (substring)", (await found({ text: "zucker" })).includes("rcp_1"))

check("rühr finds verrühren", (await found({ text: "rühr" })).includes("rcp_1"))

check("ruhr finds verrühren (diacritics removed)", (await found({ text: "ruhr" })).includes("rcp_1"))

check("case-insensitive", (await found({ text: "SKYR" })).includes("rcp_1"))

check("matches ingredients, steps, title", (await found({ text: "mixer" })).includes("rcp_1") && (await found({ text: "ausbacken" })).includes("rcp_2") && (await found({ text: "zupfkuchen" })).includes("rcp_1"))

check("no match → empty", (await found({ text: "xylophon" })).length === 0)

check("under 3 characters: LIKE on the title only", JSON.stringify((await found({ text: "pf" })).sort()) === JSON.stringify(["rcp_1", "rcp_2"]) && (await found({ text: "ku" })).length === 2 && (await found({ text: "sk" })).length === 0, await found({ text: "pf" }))

check("quotes in the text don't break the query", Array.isArray(await found({ text: 'say "cheese' })))

check("no text: by title, ignoring case", JSON.stringify(await found({})) === JSON.stringify(["rcp_3", "rcp_5", "rcp_6", "rcp_2", "rcp_1"]), await found({}))

await dev("tag", { name: "Kuchen", ids: ["rcp_1"] })

await dev("tag", { name: "Süß", ids: ["rcp_1", "rcp_2"] })

await dev("tag", { name: "Schnell", ids: ["rcp_2"] })

check("tags.all (case-insensitive)", JSON.stringify(await found({ tags: { all: ["kuchen", "SÜß"] } })) === JSON.stringify(["rcp_1"]))

check("tags.any", (await found({ tags: { any: ["kuchen", "schnell"] } })).sort().join() === "rcp_1,rcp_2")

check("tags.none", !(await found({ tags: { none: ["kuchen"] } })).includes("rcp_1") && (await found({ tags: { none: ["kuchen"] } })).includes("rcp_2"))

check("items", JSON.stringify(await found({ items: ["Skyr", "puderzucker"] })) === JSON.stringify(["rcp_1"]))

check("maxTotalMinutes", JSON.stringify(await found({ maxTotalMinutes: 30 })) === JSON.stringify(["rcp_2"]), await found({ maxTotalMinutes: 30 }))

check("hasFlow", JSON.stringify(await found({ hasFlow: true })) === JSON.stringify(["rcp_1"]))

check("text + filter", JSON.stringify(await found({ text: "zucker", tags: { all: ["süß"] } })) === JSON.stringify(["rcp_1"]))

await dev("collect", { name: "Weihnachten", ids: ["rcp_2", "rcp_1"] })

check("collection: by position", JSON.stringify(await found({ collection: "weihnachten" })) === JSON.stringify(["rcp_2", "rcp_1"]), await found({ collection: "weihnachten" }))

check("unknown collection → empty", (await found({ collection: "nope" })).length === 0)

const page1 = await dev("search", { query: { limit: 2 } })
const page2 = await dev("search", { query: { limit: 2, cursor: at(page1, "cursor") ?? null } })
const page3 = await dev("search", { query: { limit: 2, cursor: at(page2, "cursor") ?? null } })

check("limit and cursor page through all, once each", [page1, page2, page3].map((page) => list(at(page, "recipes")).length).join() === "2,2,1" && at(page1, "cursor") !== undefined && at(page2, "cursor") !== undefined && at(page3, "cursor") === undefined && new Set([page1, page2, page3].flatMap((page) => list(at(page, "recipes")).map((hit) => at(hit, "id")))).size === 5)

check("hits carry the latest content", list(at(page1, "recipes")).every((hit) => isJsonObject(at(hit, "content")) && numberOf(at(hit, "latestRevision")) >= 1))

step("trash (revising rules 6, 7, 8, 10)")

const refusedTrash = await dev("trash", { ids: ["rcp_1", "rcp_2", "ghost"] })

check("one unknown id refuses all", !ok(refusedTrash) && errorOf(refusedTrash, "_tag") === "RecipeNotFoundError" && list(errorOf(refusedTrash, "recipeIds")).join() === "ghost", refusedTrash)

check("and trashes none", (await count("recipe", "trashed_at IS NOT NULL")) === 0)

const before = Date.now()
const trashed = await dev("trash", { ids: ["rcp_1"] })
const purgeAt = numberOf(valueOf(trashed, 0, "purgeAt"))

check("purge_at = trashed_at + 720 h", ok(trashed) && Math.abs(purgeAt - (before + 720 * 3600 * 1000)) < 10_000, trashed)

check("trashed recipe leaves search", !(await found({ text: "zupfkuchen" })).includes("rcp_1") && !(await found({})).includes("rcp_1"))

check("FTS row removed, tags and collection place kept", at(first(await rows(`SELECT count(*) AS n FROM recipe_text WHERE recipe_text MATCH '"zupfk"'`)), "n") === 0 && (await count("recipe_tag", "recipe_id = 'rcp_1'")) === 2 && (await count("collection_recipe", "recipe_id = 'rcp_1'")) === 1)

check("still readable (get_recipe)", at(await dev("get", { id: "rcp_1" }), "trashedAt") !== null)

check("list_trash", JSON.stringify(list(await dev("trashList")).map((row) => at(row, "id"))) === JSON.stringify(["rcp_1"]))

check("alarm is at the earliest purge_at", at(await dev("alarm"), "alarm") === purgeAt, await dev("alarm"))

const revisingTrashed = await dev("revise", { id: "rcp_1", fromRevision: 3, content: zupfkuchen() })

check("a trashed recipe can't be revised", !ok(revisingTrashed) && errorOf(revisingTrashed, "_tag") === "RecipeTrashedError", revisingTrashed)

check("its source stays taken", errorOf(await dev("add", { id: "rcp_y", content: zupfkuchen(), source: "https://example.com/rezepte/zupfkuchen?id=7" }), "trashed") === true)

await sleep(1100)

const again = await dev("trash", { ids: ["rcp_1", "rcp_2"] })

check("one already in the trash keeps its date; one change", ok(again) && valueOf(again, 0, "purgeAt") === purgeAt && numberOf(valueOf(again, 1, "purgeAt")) > purgeAt, again)

changes = list(await dev("changes"))

check("the second trash is one change", changes.filter((change) => at(change, "kind") === "recipes_trashed").length === 2)

const restored = await dev("restore", { ids: ["rcp_1", "rcp_2", "rcp_5"] })

check("restore: names all, a recipe not in the trash changes nothing", ok(restored) && list(valueOf(restored)).join() === "rcp_1,rcp_2,rcp_5", restored)

check("back in search", (await found({ text: "zupfkuchen" })).includes("rcp_1"))

check("with tags and in the collection at its old position", JSON.stringify(await found({ collection: "Weihnachten" })) === JSON.stringify(["rcp_2", "rcp_1"]) && (await found({ tags: { all: ["kuchen"] } })).includes("rcp_1"))

check("no alarm when the trash is empty", at(await dev("alarm"), "alarm") === null, await dev("alarm"))

check("restoring unknown refuses", !ok(await dev("restore", { ids: ["ghost"] })))

step("purge alarm (revising rules 7, 9, 10; sync rule 4)")

await dev("trash", { ids: ["rcp_1", "rcp_2"] })

await dev("revise", { id: "rcp_3", fromRevision: 1, content: { title: "Offline 2" } })

const purgeChangesBefore = list(await dev("changes")).filter((change) => at(change, "kind") === "recipes_purged").length

await dev("backdate", { id: "rcp_1", pastMs: 1000 })

for (let i = 0; i < 40 && (await count("recipe", "id = 'rcp_1'")) === 1; i++) await sleep(250)

check("the alarm purged the due recipe", (await count("recipe", "id = 'rcp_1'")) === 0)

check("and only that one (rcp_2 is trashed but not due)", (await count("recipe", "id = 'rcp_2'")) === 1)

for (const table of ["revision", "recipe_item", "recipe_tag", "collection_recipe"]) check(`${table} rows gone`, (await count(table, "recipe_id = 'rcp_1'")) === 0)

check("tag and collection themselves stay", (await count("tag")) === 3 && (await count("collection")) === 1)

check("FTS row gone", at(first(await rows(`SELECT count(*) AS n FROM recipe_text WHERE recipe_text MATCH '"zupfk"'`)), "n") === 0)

changes = list(await dev("changes"))

const purges = changes.filter((change) => at(change, "kind") === "recipes_purged")

check("one change by the trash naming the purged ids", purges.length === purgeChangesBefore + 1 && at(purges.at(-1), "by", "kind") === "trash" && list(at(purges.at(-1), "payload", "recipeIds")).join() === "rcp_1", purges.at(-1) ?? null)

check("purged is gone: restore refused", !ok(await dev("restore", { ids: ["rcp_1"] })))

check("a trashed batch containing a purged recipe is refused", !ok(await dev("trash", { ids: ["rcp_1", "rcp_3"] })))

check("its source is free again", ok(await dev("add", { id: "rcp_7", content: zupfkuchen(), source: "https://example.com/rezepte/zupfkuchen?id=7" })))

check("the next alarm is set for the remaining trashed recipe", at(await dev("alarm"), "alarm") === at(await dev("get", { id: "rcp_2" }), "purgeAt"), await dev("alarm"))

await dev("backdate", { id: "rcp_2", pastMs: 1000 })

for (let i = 0; i < 40 && (await count("recipe", "id = 'rcp_2'")) === 1; i++) await sleep(250)

check("the second run purges the next one", (await count("recipe", "id = 'rcp_2'")) === 0)

check("then no alarm is left", at(await dev("alarm"), "alarm") === null, await dev("alarm"))

check("change seq is gap-free and strictly increasing", list(await dev("changes")).every((change, index, all) => index === 0 || at(change, "seq") === numberOf(at(all[index - 1], "seq")) + 1))

step("retries (mcp.md#retries)")

const recipesBefore = await count("recipe")
const firstAdd = await dev("add", { id: "rcp_r1", content: pfannkuchen, retryTool: "add_recipe", retryArgs: { title: "Pfannkuchen", n: 1 } })
const second = await dev("add", { id: "rcp_r2", content: pfannkuchen, retryTool: "add_recipe", retryArgs: { n: 1, title: "Pfannkuchen" } })

check("the same call returns the stored first result", ok(firstAdd) && JSON.stringify(second) === JSON.stringify(firstAdd), { first: firstAdd, second })

check("and changes nothing", (await count("recipe")) === recipesBefore + 1 && (await count("recipe", "id = 'rcp_r2'")) === 0)

check("the retry row is written with the write", (await count("retry")) === 1)

const differentArgs = await dev("add", { id: "rcp_r3", content: pfannkuchen, retryTool: "add_recipe", retryArgs: { title: "Pfannkuchen", n: 2 } })

check("other arguments write again", ok(differentArgs) && valueOf(differentArgs, "recipeId") === "rcp_r3")

const other2 = await cook.connect("Claude Code")
const devOther = devAs(other2.token)
const fromOther = await devOther("add", { id: "rcp_r4", content: pfannkuchen, retryTool: "add_recipe", retryArgs: { title: "Pfannkuchen", n: 1 } })

check("another connection writes again", ok(fromOther) && valueOf(fromOther, "recipeId") === "rcp_r4", fromOther)

const refusedRetry = await dev("revise", { id: "rcp_r1", fromRevision: 9, content: pfannkuchen, retryTool: "edit_recipe", retryArgs: { a: 1 } })

check("a refusal isn't stored", !ok(refusedRetry) && (await count("retry", "tool = 'edit_recipe'")) === 0)

await dev("ageRetries")

const afterWindow = await dev("add", { id: "rcp_r5", content: pfannkuchen, retryTool: "add_recipe", retryArgs: { title: "Pfannkuchen", n: 1 } })

check("after 10 minutes the call writes again", ok(afterWindow) && valueOf(afterWindow, "recipeId") === "rcp_r5", afterWindow)

check("expired rows are deleted at the start of a write", (await count("retry", "expires_at <= 0")) === 0)

step("cooks are separate")

const stranger = await signInLocalCook(origin)

check("another cook's library is empty", at(await devAs(stranger.token)("counts"), "recipe") === 0)

console.log(process.exitCode ? "\nFAILED" : "\nall ok")
