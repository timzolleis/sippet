import { describe, expect, it } from "vitest"
import type { Json } from "../../src/store/schema.ts"
import { purgeDueRecipes } from "../../src/mcp/unit-of-work.ts"
import { makeCook } from "./harness.ts"

const simple = (title: string, extra: ReadonlyArray<string> = []) => ({
  title,
  yield: { amount: { value: 4, unit: "serving" } },
  edits: [
    { op: "add_ingredient", key: "a", item: "Mehl" },
    ...extra.map((item, index) => ({ op: "add_ingredient", key: `z${index}`, item })),
    { op: "add_step", key: "s", label: `${title} machen`, uses: ["a", ...extra.map((_, index) => `z${index}`)], duration: { minutes: 20, kind: "active" } },
  ],
})

const setup = async () => {
  const cook = makeCook()
  const client = await cook.connect()
  const add = async (title: string, extra: ReadonlyArray<string> = []) => (await client.call("add_recipe", simple(title, extra))).value.id

  return { cook, client, add }
}

describe("edit_library (library rules 1–15)", () => {
  it("tags, creates a collection, and returns the library in one change (rules 1, 2, 3)", async () => {
    const { cook, client, add } = await setup()
    const [zupf, apfel, stollen] = [await add("Zupfkuchen"), await add("Apfelkuchen"), await add("Stollen")]

    const edited = await client.call("edit_library", {
      edits: [
        { op: "tag", tag: "Kuchen", recipeIds: [zupf, apfel] },
        { op: "create_collection", name: "Weihnachten", recipeIds: [stollen, zupf] },
        { op: "tag", tag: "kuchen", recipeIds: [stollen] },
      ],
    })

    expect(edited.isError).toBe(false)
    expect(edited.value).toEqual({
      tags: [{ name: "Kuchen", recipes: 3 }],
      collections: [{ name: "Weihnachten", recipes: 2 }],
      smartCollections: [],
    })
    const changes = cook.library.listChanges({ after: 0, limit: 20 }).filter((change) => change.kind === "library_changed")
    expect(changes).toHaveLength(1)
    expect(changes[0]!.by).toEqual({ kind: "claude", connection: "connection-1" })
    expect(changes[0]!.payload).toMatchObject({ changed: { tags: ["Kuchen"], collections: ["Weihnachten"], smartCollections: [] }, deleted: { tags: [] } })
    const read = await client.call("get_recipe", { recipeId: zupf })
    expect(read.value).toMatchObject({ tags: ["Kuchen"], collections: ["Weihnachten"] })
  })

  it("refuses the whole batch with every problem, naming each edit, and changes nothing (rule 1)", async () => {
    const { cook, client, add } = await setup()
    const zupf = await add("Zupfkuchen")
    const trashed = await add("Alt")
    await client.call("trash_recipes", { recipeIds: [trashed] })
    const before = cook.count("change")

    const refused = await client.call("edit_library", {
      edits: [
        { op: "create_collection", name: "Weihnachten", recipeIds: [zupf] },
        { op: "tag", tag: "Backen", recipeIds: [trashed] },
        { op: "add_to_collection", collection: "Nirgends", recipeIds: [zupf] },
      ],
    })

    expect(refused.isError).toBe(true)
    expect(refused.value.problems).toEqual([
      { edit: 2, rule: "trashed-recipes-leave-the-library", message: expect.stringContaining("in the trash"), fix: expect.stringContaining("restore_recipes") },
      { edit: 3, rule: "unknown-collection", message: 'no collection "Nirgends"', fix: expect.any(String) },
    ])
    expect(cook.count("change")).toBe(before)
    expect(cook.count("collection")).toBe(0)
    expect(cook.count("tag")).toBe(0)
  })

  it("keeps a collection's order and refuses a reorder that misses a recipe (rules 10, 11)", async () => {
    const { client, add } = await setup()
    const [a, b, c] = [await add("Alpha"), await add("Beta"), await add("Gamma")]
    await client.call("edit_library", { edits: [{ op: "create_collection", name: "Liste", recipeIds: [c, a] }, { op: "add_to_collection", collection: "liste", recipeIds: [b, c] }] })
    const order = async () => (await client.call("search_recipes", { collection: "Liste" })).value.recipes.map((recipe: { title: string }) => recipe.title)

    expect(await order()).toEqual(["Gamma", "Alpha", "Beta"])
    const refused = await client.call("edit_library", { edits: [{ op: "reorder_collection", collection: "Liste", recipeIds: [b, a] }] })

    expect(refused.isError).toBe(true)
    expect(refused.value.problems[0]).toMatchObject({ edit: 1 })
    await client.call("edit_library", { edits: [{ op: "reorder_collection", collection: "Liste", recipeIds: [b, c, a] }] })
    expect(await order()).toEqual(["Beta", "Gamma", "Alpha"])
  })

  it("renames, merges, and deletes tags, and smart collections follow (rules 6, 7, 8, 15)", async () => {
    const { client, add } = await setup()
    const [a, b] = [await add("Alpha"), await add("Beta")]
    await client.call("edit_library", {
      edits: [
        { op: "tag", tag: "Nachtisch", recipeIds: [a] },
        { op: "tag", tag: "Dessert", recipeIds: [a, b] },
        { op: "save_smart_collection", name: "Süß", filter: { tags: { all: ["Nachtisch"] }, maxTotalMinutes: 45 } },
      ],
    })
    const clash = await client.call("edit_library", { edits: [{ op: "rename_tag", tag: "Nachtisch", to: "dessert" }] })

    expect(clash.isError).toBe(true)
    expect(clash.value.problems[0]).toMatchObject({ rule: "rename-to-a-free-name", fix: expect.stringContaining("merge_tags") })
    const merged = await client.call("edit_library", { edits: [{ op: "merge_tags", tag: "Nachtisch", into: "Dessert" }] })

    expect(merged.value.tags).toEqual([{ name: "Dessert", recipes: 2 }])
    expect(merged.value.smartCollections).toEqual([{ name: "Süß", filter: { tags: { all: ["Dessert"] }, maxTotalMinutes: 45 } }])
    const deleted = await client.call("edit_library", { edits: [{ op: "delete_tag", tag: "dessert" }] })

    expect(deleted.value.tags).toEqual([])
    expect(deleted.value.smartCollections).toEqual([{ name: "Süß", filter: { maxTotalMinutes: 45 } }])
  })

  it("writes the same edit again after another write in between, instead of treating it as a retry (mcp.md Retries)", async () => {
    const { client, add } = await setup()
    const a = await add("Alpha")
    const tag = { edits: [{ op: "tag", tag: "Kuchen", recipeIds: [a] }] }
    const untag = { edits: [{ op: "untag", tag: "Kuchen", recipeIds: [a] }] }

    await client.call("edit_library", tag)
    expect((await client.call("edit_library", untag)).value.tags).toEqual([{ name: "Kuchen", recipes: 0 }])
    expect((await client.call("edit_library", tag)).value.tags).toEqual([{ name: "Kuchen", recipes: 1 }])
    await client.call("trash_recipes", { recipeIds: [a] })
    await client.call("restore_recipes", { recipeIds: [a] })
    await client.call("trash_recipes", { recipeIds: [a] })

    expect((await client.call("list_trash")).value.recipes).toHaveLength(1)
  })

  it("writes what is gone into the change (sync rule 2)", async () => {
    const { cook, client, add } = await setup()
    const a = await add("Alpha")
    await client.call("edit_library", { edits: [{ op: "tag", tag: "Eins", recipeIds: [a] }, { op: "create_collection", name: "Sammlung" }, { op: "save_smart_collection", name: "Klug", filter: { hasFlow: true } }] })
    await client.call("edit_library", { edits: [{ op: "rename_tag", tag: "Eins", to: "Zwei" }, { op: "delete_collection", collection: "Sammlung" }, { op: "delete_smart_collection", name: "Klug" }] })
    const last = cook.library.listChanges({ after: 0, limit: 20 }).at(-1)

    expect(last?.payload).toMatchObject({
      changed: { tags: ["Zwei"], collections: [], smartCollections: [] },
      deleted: { tags: ["Eins"], collections: ["Sammlung"], smartCollections: ["Klug"] },
    })
  })

  it("keeps a collection's and a smart collection's name apart (rule 9)", async () => {
    const { client } = await setup()
    await client.call("edit_library", { edits: [{ op: "create_collection", name: "Schnell" }] })
    const refused = await client.call("edit_library", { edits: [{ op: "save_smart_collection", name: "schnell", filter: { hasFlow: true } }] })

    expect(refused.isError).toBe(true)
    expect(refused.value.problems[0].message).toContain("taken by a collection")
  })

  it("refuses a smart collection that names a tag that doesn't exist, in the library's spelling (rule 13)", async () => {
    const { client, add } = await setup()
    await client.call("edit_library", { edits: [{ op: "tag", tag: "Vegan", recipeIds: [await add("Alpha")] }] })
    const saved = await client.call("edit_library", { edits: [{ op: "save_smart_collection", name: "V", filter: { tags: { all: ["vegan"] } } }] })

    expect(saved.value.smartCollections).toEqual([{ name: "V", filter: { tags: { all: ["Vegan"] } } }])
    const refused = await client.call("edit_library", { edits: [{ op: "save_smart_collection", name: "W", filter: { tags: { all: ["nope"] } } }] })

    expect(refused.value.problems[0].message).toBe('no tag "nope"')
  })

  it("keeps tags and collection places through the trash and drops them with a purge (revising rules 6, 8, 9)", async () => {
    const { cook, client, add } = await setup()
    const [a, b] = [await add("Alpha"), await add("Beta")]
    await client.call("edit_library", { edits: [{ op: "tag", tag: "T", recipeIds: [a, b] }, { op: "create_collection", name: "C", recipeIds: [a, b] }] })
    await client.call("trash_recipes", { recipeIds: [a] })

    expect((await client.call("get_library")).value).toMatchObject({ tags: [{ name: "T", recipes: 1 }], collections: [{ name: "C", recipes: 1 }] })
    expect((await client.call("get_recipe", { recipeId: a })).value).toMatchObject({ tags: ["T"], collections: ["C"] })
    const named = await client.call("edit_library", { edits: [{ op: "tag", tag: "T", recipeIds: [a] }] })

    expect(named.value.problems[0].message).toContain("in the trash")
    await client.call("restore_recipes", { recipeIds: [a] })
    expect((await client.call("search_recipes", { collection: "C" })).value.recipes.map((recipe: { id: string }) => recipe.id)).toEqual([a, b])

    await client.call("trash_recipes", { recipeIds: [a] })
    cook.database.prepare(`UPDATE recipe SET purge_at = 1 WHERE id = ?`).run(a)
    await purgeDueRecipes(cook.library)

    expect(cook.count("recipe")).toBe(1)
    expect(cook.count("revision")).toBe(1)
    expect(cook.database.prepare(`SELECT count(*) AS n FROM recipe_tag WHERE recipe_id = ?`).get(a)?.n).toBe(0)
    expect((await client.call("get_library")).value.tags).toEqual([{ name: "T", recipes: 1 }])
    const purge = cook.library.listChanges({ after: 0, limit: 50 }).at(-1)

    expect(purge).toMatchObject({ kind: "recipes_purged", by: { kind: "trash" }, payload: { recipeIds: [a] } })
    expect((await client.call("restore_recipes", { recipeIds: [a] })).isError).toBe(true)
    expect((await client.call("get_recipe", { recipeId: a })).isError).toBe(true)
    expect(await cook.getAlarm()).toBe(null)
  })
})

describe("search_recipes (cooking rule 9)", () => {
  it("finds substrings in title, ingredients, and steps, ignoring case and accents", async () => {
    const { client, add } = await setup()
    await add("Zupfkuchen", ["Puderzucker"])
    await add("Pfannkuchen")
    const titles = async (text: string) => (await client.call("search_recipes", { text })).value.recipes.map((recipe: { title: string }) => recipe.title)

    expect(await titles("zucker")).toEqual(["Zupfkuchen"])
    expect(await titles("KUCHEN")).toEqual(["Pfannkuchen", "Zupfkuchen"])
    expect(await titles("machen")).toEqual(["Pfannkuchen", "Zupfkuchen"])
    expect(await titles("pf")).toEqual(["Pfannkuchen", "Zupfkuchen"])
    expect(await titles("xylophon")).toEqual([])
  })

  it("filters by tags, items, time, and flow, and combines them with a smart collection", async () => {
    const { client, add } = await setup()
    const [a, b] = [await add("Alpha", ["Skyr"]), await add("Beta")]
    await client.call("edit_library", {
      edits: [
        { op: "tag", tag: "Süß", recipeIds: [a, b] },
        { op: "tag", tag: "Schnell", recipeIds: [b] },
        { op: "save_smart_collection", name: "Skyr-Sachen", filter: { items: ["skyr"], tags: { any: ["süß", "schnell"] } } },
      ],
    })
    const ids = async (query: Json) => (await client.call("search_recipes", query)).value.recipes.map((recipe: { title: string }) => recipe.title)

    expect(await ids({ tags: { all: ["süß"] } })).toEqual(["Alpha", "Beta"])
    expect(await ids({ tags: { any: ["schnell"] }, items: ["mehl"] })).toEqual(["Beta"])
    expect(await ids({ tags: { none: ["schnell"] } })).toEqual(["Alpha"])
    expect(await ids({ maxTotalMinutes: 19 })).toEqual([])
    expect(await ids({ maxTotalMinutes: 20, hasFlow: true })).toEqual(["Alpha", "Beta"])
    expect(await ids({ hasFlow: false })).toEqual([])
    expect(await ids({ smartCollection: "skyr-sachen" })).toEqual(["Alpha"])
    expect(await ids({ smartCollection: "Skyr-Sachen", tags: { any: ["schnell"] } })).toEqual([])
    expect(await ids({ smartCollection: "Skyr-Sachen", hasFlow: false })).toEqual([])
    const unknown = await client.call("search_recipes", { smartCollection: "Nix" })

    expect(unknown).toEqual({ isError: true, value: { refused: true, problems: [{ rule: "unknown-smart-collection", message: 'no smart collection "Nix"', fix: "name a smart collection get_library lists" }] } })
    expect((await client.call("search_recipes", { collection: "Nix" })).isError).toBe(true)
  })

  it("returns summaries and pages through everything once", async () => {
    const { client, add } = await setup()

    for (const title of ["A1", "B2", "C3", "D4", "E5"]) await add(title)
    const first = await client.call("search_recipes", { limit: 2 })
    const second = await client.call("search_recipes", { limit: 2, cursor: first.value.cursor })
    const third = await client.call("search_recipes", { limit: 2, cursor: second.value.cursor })

    expect([first, second, third].map((page) => page.value.recipes.length)).toEqual([2, 2, 1])
    expect(third.value.cursor).toBeUndefined()
    expect(first.value.recipes[0]).toEqual({
      id: expect.any(String),
      title: "A1",
      yield: { amount: { value: 4, unit: "serving" } },
      tags: [],
      revision: 1,
      totalMinutes: 20,
      hasFlow: true,
    })
    await expect(client.call("search_recipes", { limit: 0 })).rejects.toThrow(/limit/)
  })
})
