/// <reference types="node" />
// Drives the real tools over MCP against `pnpm dev` (local state only) with a minted token: add the Zupfkuchen, read it back, revise,
// restore a revision, trash and restore, search, tag and collection edits, a retry, refusals, a second cook.
// Run: node scripts/verify-mcp.ts [http://localhost:1337]
import { Schema } from "effect"
import { zupfkuchenEdits, zupfkuchenTitle, zupfkuchenYield } from "../test/domain/fixtures.ts"
import { signInLocalCook } from "./local-cook.ts"

type Json = Schema.Json

const origin = process.argv[2] ?? "http://localhost:1337"
const step = (text: string) => console.log(`\n── ${text}`)

const check = (label: string, ok: boolean, detail?: Json) => {
  console.log(`   ${ok ? "ok  " : "FAIL"} ${label}${ok || detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`)

  if (!ok) process.exitCode = 1
}

// Replies are plain JSON; `at` reads a path out of one without assuming its shape.
const isJsonObject = Schema.is(Schema.Record(Schema.String, Schema.Json))

const at = (value: Json | undefined, ...path: ReadonlyArray<string | number>): Json | undefined =>
  path.reduce<Json | undefined>((node, key) => {
    if (Array.isArray(node)) return node[Number(key)]

    return isJsonObject(node) ? node[String(key)] : undefined
  }, value)

const list = (value: Json | undefined): ReadonlyArray<Json> => (Array.isArray(value) ? value : [])
const textOf = (value: Json | undefined): string => (Schema.is(Schema.String)(value) ? value : "")
const names = (value: Json | undefined, field: string) => list(value).map((entry) => at(entry, field))

const decodeJson = Schema.decodeUnknownSync(Schema.Json)
const protocol = "2025-06-18"

type Outcome = { readonly isError: boolean; readonly value: Json }

// One MCP session on one token. `headers` are extra request headers (to check the Worker drops forged sippet-* ones).
const connect = async (token: string, headers: Record<string, string> = {}) => {
  let session: string | null = null
  let id = 0

  const post = (body: Json) => {
    const sent = new Headers({
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": protocol,
    })

    if (session !== null) sent.set("mcp-session-id", session)

    for (const [name, value] of Object.entries(headers)) sent.set(name, value)

    return fetch(`${origin}/mcp`, { method: "POST", headers: sent, body: JSON.stringify(body) })
  }

  const init = await post({ jsonrpc: "2.0", id: ++id, method: "initialize", params: { protocolVersion: protocol, capabilities: {}, clientInfo: { name: "verify-mcp", version: "0" } } })

  if (init.status !== 200) throw new Error(`initialize answered ${init.status}`)
  session = init.headers.get("mcp-session-id")
  const initialized = decodeJson(await init.json())
  await post({ jsonrpc: "2.0", method: "notifications/initialized" })

  const request = async (method: string, params: Json = {}) => decodeJson(await (await post({ jsonrpc: "2.0", id: ++id, method, params })).json())

  const call = async (name: string, args: Json = {}): Promise<Outcome> => {
    const reply = await request("tools/call", { name, arguments: args })
    const error = at(reply, "error")

    if (error !== undefined) throw new Error(`${name}: protocol error ${JSON.stringify(error)}`)
    const isError = at(reply, "result", "isError") === true

    return { isError, value: isError ? decodeJson(JSON.parse(textOf(at(reply, "result", "content", 0, "text")))) : (at(reply, "result", "structuredContent") ?? null) }
  }

  return { call, request, initialized }
}

const cook = await signInLocalCook(origin)
const claude = await connect(cook.token)
const { call } = claude

const pfannkuchen = {
  title: "Pfannkuchen",
  yield: { amount: { value: 4, unit: "serving" } },
  edits: [
    { op: "add_ingredient", key: "mehl", item: "Mehl" },
    { op: "add_ingredient", key: "milch", item: "Milch", note: "kalt" },
    { op: "add_step", key: "braten", label: "in der Pfanne ausbacken", uses: ["mehl", "milch"], duration: { minutes: 10, kind: "active" } },
  ],
}

const titles = async (query: Json) => names(at((await call("search_recipes", query)).value, "recipes"), "title")

step("the server")

const tools = await claude.request("tools/list")

check("eleven tools", list(at(tools, "result", "tools")).length === 11)

check("instructions are sent once per session", textOf(at(claude.initialized, "result", "instructions")).includes("Read before you write"))

step("add the Zupfkuchen (adding rules 1, 2; recipe rule 11)")

const added = await call("add_recipe", { title: zupfkuchenTitle, yield: zupfkuchenYield, edits: zupfkuchenEdits })
const recipeId = textOf(at(added.value, "recipeId"))
const stepFlow = (recipe: Json | undefined, key: string, field: string) => at(list(at(recipe, "steps")).find((candidate) => at(candidate, "key") === key), "flow", field)

check("added at revision 1", !added.isError && at(added.value, "revision") === 1, added.value)

check("the flow follows from the steps", JSON.stringify(stepFlow(at(added.value, "recipe"), "giessen", "takes")) === JSON.stringify(["boden", "untermixen", "zupfteig"]) && JSON.stringify(stepFlow(at(added.value, "recipe"), "backen", "waitsFor")) === JSON.stringify(["vorheizen"]))

check("makes the finished cake", JSON.stringify(at(added.value, "recipe", "makes")) === JSON.stringify(["auskuehlen"]))

step("read it back (cooking rule 10)")

const read = await call("get_recipe", { recipeId })

check("get_recipe returns what add_recipe returned", JSON.stringify(read.value) === JSON.stringify(at(added.value, "recipe")))

check("steps as written, with takes", JSON.stringify(at(list(at(read.value, "steps")).find((candidate) => at(candidate, "key") === "boden"), "takes")) === JSON.stringify(["boden-teig"]))

step("a refusal lists every problem (revising rule 1)")

const refused = await call("add_recipe", {
  title: "Kaputt",
  yield: { amount: { value: 2, unit: "piece" } },
  edits: [{ op: "add_ingredient", key: "mehl", item: "Mehl" }, { op: "add_ingredient", key: "kakao", item: "Kakao" }, { op: "add_step", key: "mischen", label: "mischen", uses: ["mehl"] }, { op: "remove_step", key: "gibt-es-nicht" }],
})

const problems = list(at(refused.value, "problems"))

check("isError, with the edit and the rule", refused.isError && problems.some((problem) => at(problem, "edit") === 4) && problems.some((problem) => at(problem, "rule") === "recipe 14"), refused.value)

check("nothing was stored", !(await titles({ text: "Kaputt" })).includes("Kaputt"))

step("revise (revising rules 2, 3)")

const lessSugar = [{ op: "edit_ingredient", key: "zucker-teig", amount: { value: 120, unit: "g" } }, { op: "edit_step", key: "backen", duration: { minutes: 65, maxMinutes: 70, kind: "passive" } }]
const revised = await call("edit_recipe", { recipeId, fromRevision: 1, edits: lessSugar })

check("revision 2", at(revised.value, "revision") === 2 && at(revised.value, "recipe", "latestRevision") === 2, revised.value)

const stale = await call("edit_recipe", { recipeId, fromRevision: 1, edits: [{ op: "set_title", title: "Zupfkuchen" }] })

check("a stale fromRevision is refused with the latest revision", stale.isError && at(stale.value, "latestRevision") === 2, stale.value)

check("revision 1 is kept, as written", at(list(at((await call("get_recipe", { recipeId, revision: 1 })).value, "ingredients")).find((i) => at(i, "key") === "zucker-teig"), "amount", "value") === 180)

const restored = await call("restore_revision", { recipeId, fromRevision: 2, revision: 1 })

check("restoring is revision 3", at(restored.value, "revision") === 3)

const revisions = await call("list_revisions", { recipeId })

check("list_revisions: newest first, what and who", JSON.stringify(names(at(revisions.value, "revisions"), "revision")) === JSON.stringify([3, 2, 1]) && at(revisions.value, "revisions", 0, "was", "restored") === 1 && at(revisions.value, "revisions", 1, "by", "name") === "Claude (local)", revisions.value)

step("the connection id comes from the token, not from a header")

const forging = await connect(cook.token, { "sippet-connection": "forged", "sippet-cook": "forged" })
const forged = await forging.call("edit_recipe", { recipeId, fromRevision: 3, edits: [{ op: "set_title", title: "Veganer Russischer Zupfkuchen" }] })

check("a forged sippet-* header is dropped", !forged.isError && at((await call("list_revisions", { recipeId })).value, "revisions", 0, "by", "name") === "Claude (local)")

step("trash (revising rules 4, 6–8, 10)")

await call("add_recipe", pfannkuchen)

const other = textOf(at((await call("search_recipes", { text: "pfannkuchen" })).value, "recipes", 0, "id"))
const trashed = await call("trash_recipes", { recipeIds: [recipeId] })
const purgeAt = Date.parse(textOf(at(trashed.value, "trashed", 0, "purgeAt")))

check("purge in 30 days", Math.abs(purgeAt - (Date.now() + 720 * 3600 * 1000)) < 60_000, trashed.value)

check("list_trash", JSON.stringify(names(at((await call("list_trash")).value, "recipes"), "id")) === JSON.stringify([recipeId]))

check("gone from search, readable with get_recipe", !(await titles({})).some((title) => textOf(title).includes("Zupfkuchen")) && textOf(at((await call("get_recipe", { recipeId })).value, "trashedAt")) !== "")

const trashedEdit = await call("edit_recipe", { recipeId, fromRevision: 4, edits: [{ op: "set_title", title: "x" }] })

check("a trashed recipe can't be revised", trashedEdit.isError && at(trashedEdit.value, "problems", 0, "rule") === "revising 4", trashedEdit.value)

const ghost = await call("trash_recipes", { recipeIds: [other, "rcp_zzzzzzzzzzzzzzzzzzzzzzzz"] })

check("an unknown id refuses all", ghost.isError && (await titles({})).length === 1, ghost.value)

const restoredFromTrash = await call("restore_recipes", { recipeIds: [recipeId] })

check("restore_recipes", JSON.stringify(at(restoredFromTrash.value, "recipeIds")) === JSON.stringify([recipeId]) && (await titles({})).length === 2)

step("search (cooking rule 9)")

check("zucker finds Puderzucker-like compounds by substring", (await titles({ text: "zucker" })).length === 1)

check("rühr finds verrühren", (await titles({ text: "rühr" })).length === 1)

check("ruhr finds verrühren (diacritics removed)", (await titles({ text: "ruhr" })).length === 1)

check("case-insensitive", (await titles({ text: "MIXER" })).length === 1)

check("under 3 characters: the title only", JSON.stringify(await titles({ text: "pf" })) === JSON.stringify(["Pfannkuchen", zupfkuchenTitle]) && (await titles({ text: "mi" })).length === 0)

check("quotes in the text don't break the query", !(await call("search_recipes", { text: 'say "cheese' })).isError)

check("items", JSON.stringify(await titles({ items: ["vegane Butter"] })) === JSON.stringify([zupfkuchenTitle]))

check("maxTotalMinutes", JSON.stringify(await titles({ maxTotalMinutes: 30 })) === JSON.stringify(["Pfannkuchen"]))

check("hasFlow", (await titles({ hasFlow: true })).length === 2 && (await titles({ hasFlow: false })).length === 0)

const page1 = await call("search_recipes", { limit: 1 })
const page2 = await call("search_recipes", { limit: 1, cursor: textOf(at(page1.value, "cursor")) })

check("limit and cursor", list(at(page1.value, "recipes")).length === 1 && list(at(page2.value, "recipes")).length === 1 && at(page2.value, "cursor") === undefined && at(page1.value, "recipes", 0, "id") !== at(page2.value, "recipes", 0, "id"))

step("tags, collections, smart collections (library rules 1–15)")

const edited = await call("edit_library", {
  edits: [
    { op: "tag", tag: "Kuchen", recipeIds: [recipeId] },
    { op: "tag", tag: "kuchen", recipeIds: [other] },
    { op: "create_collection", name: "Weihnachten", recipeIds: [other, recipeId] },
    { op: "save_smart_collection", name: "Schnell", filter: { tags: { all: ["Kuchen"] }, maxTotalMinutes: 30 } },
  ],
})

check("one batch: tag (case-insensitive), collection, smart collection", at(edited.value, "tags", 0, "recipes") === 2 && at(edited.value, "collections", 0, "name") === "Weihnachten" && at(edited.value, "smartCollections", 0, "name") === "Schnell", edited.value)

check("search by tag", (await titles({ tags: { all: ["KUCHEN"] } })).length === 2 && (await titles({ tags: { none: ["kuchen"] } })).length === 0)

check("a collection returns its order", JSON.stringify(await titles({ collection: "weihnachten" })) === JSON.stringify(["Pfannkuchen", zupfkuchenTitle]))

check("a smart collection returns what its filter finds", JSON.stringify(await titles({ smartCollection: "Schnell" })) === JSON.stringify(["Pfannkuchen"]))

const reorder = await call("edit_library", { edits: [{ op: "reorder_collection", collection: "Weihnachten", recipeIds: [recipeId] }] })

check("reorder must name every recipe", reorder.isError && at(reorder.value, "problems", 0, "edit") === 1, reorder.value)

const clash = await call("edit_library", { edits: [{ op: "save_smart_collection", name: "weihnachten", filter: { hasFlow: true } }] })

check("a smart collection can't take a collection's name", clash.isError, clash.value)

const merged = await call("edit_library", { edits: [{ op: "tag", tag: "Dessert", recipeIds: [recipeId] }, { op: "merge_tags", tag: "Kuchen", into: "Dessert" }] })

check("merge: the filter follows the kept tag", JSON.stringify(at(merged.value, "tags")) === JSON.stringify([{ name: "Dessert", recipes: 2 }]) && at(merged.value, "smartCollections", 0, "filter", "tags", "all", 0) === "Dessert", merged.value)

await call("trash_recipes", { recipeIds: [other] })

check("trashed recipes keep their tags and leave the counts and collections", at((await call("get_library")).value, "tags", 0, "recipes") === 1 && (await titles({ collection: "Weihnachten" })).length === 1)

const trashedNamed = await call("edit_library", { edits: [{ op: "tag", tag: "Dessert", recipeIds: [other] }] })

check("a recipe in the trash can't be named", trashedNamed.isError, trashedNamed.value)

await call("restore_recipes", { recipeIds: [other] })

check("restored with its tag, at its place", (await titles({ collection: "Weihnachten" })).length === 2 && JSON.stringify(at((await call("get_recipe", { recipeId: other })).value, "tags")) === JSON.stringify(["Dessert"]))

const gone = await call("edit_library", { edits: [{ op: "delete_tag", tag: "dessert" }] })

check("delete_tag drops it from the smart collection's filter", JSON.stringify(at(gone.value, "smartCollections", 0, "filter")) === JSON.stringify({ maxTotalMinutes: 30 }), gone.value)

step("retries (mcp.md Retries)")

const retryArgs = { ...pfannkuchen, title: "Eierkuchen" }
const first = await call("add_recipe", retryArgs)
const again = await call("add_recipe", retryArgs)

check("the same call returns the stored first result", !first.isError && JSON.stringify(again.value) === JSON.stringify(first.value))

check("and changes nothing", (await titles({ text: "eierkuchen" })).length === 1)

const secondConnection = await connect((await cook.connect("Claude Code")).token)
const fromOther = await secondConnection.call("add_recipe", retryArgs)

check("another connection writes again", !fromOther.isError && at(fromOther.value, "recipeId") !== at(first.value, "recipeId"))

step("source (adding rule 6)")

const page = `https://${new URL(origin).host}/account` // the address is cleaned to https
const withSource = await call("add_recipe", { ...pfannkuchen, title: "Mit Quelle", source: `${origin}/account?utm_source=instagram#top` })

check("the source is the cleaned address", at(withSource.value, "recipe", "source") === page, withSource.value)

const duplicate = await call("add_recipe", { ...pfannkuchen, title: "Mit Quelle 2", source: `${origin}/account/?utm_medium=x` })

check("the same page is refused and points to the first", duplicate.isError && textOf(at(duplicate.value, "problems", 0, "message")).includes(textOf(at(withSource.value, "recipeId"))), duplicate.value)

step("cooks are separate")

const stranger = await signInLocalCook(origin)
const strangerClient = await connect(stranger.token)

check("another cook's library is empty", list(at((await strangerClient.call("search_recipes")).value, "recipes")).length === 0 && (await strangerClient.call("get_recipe", { recipeId })).isError)

step("no tool for what Claude may not do (account rule 6)")

check("no tool empties the trash or touches the account", !names(at(tools, "result", "tools"), "name").some((name) => /purge|empty|passkey|connection|account|delete/.test(textOf(name))))

console.log(process.exitCode ? "\nFAILED" : "\nall ok")
