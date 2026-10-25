import { describe, expect, it, vi } from "vitest"
import { zupfkuchenEdits, zupfkuchenTitle, zupfkuchenYield } from "../domain/fixtures.ts"
import { makeCook } from "./harness.ts"

const zupfkuchen = { title: zupfkuchenTitle, yield: zupfkuchenYield, edits: zupfkuchenEdits }

const setup = async () => {
  const cook = makeCook()
  const client = await cook.connect()
  const added = await client.call("add_recipe", zupfkuchen)
  expect(added.isError).toBe(false)

  return { cook, client, recipeId: added.value.id, added: added.value }
}

const stepOf = (recipe: any, key: string) => recipe.steps.find((step: any) => step.key === key)

describe("the server", () => {
  it("sends the instructions and declares its tools", async () => {
    const client = await makeCook().connect()
    expect(client.initialized.instructions).toContain("Read before you write")
    const tools: Array<any> = (await client.request("tools/list")).result.tools
    expect(tools.map((tool) => tool.name)).toEqual([
      "search_recipes", "get_recipe", "list_revisions", "get_library", "list_trash",
      "add_recipe", "edit_recipe", "restore_revision", "trash_recipes", "restore_recipes", "edit_library",
    ])
    const reads = ["search_recipes", "get_recipe", "list_revisions", "get_library", "list_trash"]

    for (const tool of tools) {
      if (reads.includes(tool.name)) expect(tool.annotations.readOnlyHint).toBe(true)
      else expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    }
  })

  it("has no tool for emptying the trash, passkeys, connections, or the account (account rule 6)", async () => {
    const client = await makeCook().connect()
    const names: Array<string> = (await client.request("tools/list")).result.tools.map((tool: any) => tool.name)
    expect(names.filter((name) => /purge|empty|passkey|connection|account|delete/.test(name))).toEqual([])
  })
})

describe("adding and reading (adding rules 1, 2; cooking rule 10)", () => {
  it("adds the Zupfkuchen at revision 1 with the derived flow", async () => {
    const { added: recipe, recipeId } = await setup()
    expect(recipe).toMatchObject({ id: recipeId, revision: 1, latestRevision: 1, title: zupfkuchenTitle, hasFlow: true, tags: [], collections: [] })
    expect(stepOf(recipe, "verkneten").flow.takes).toEqual(["mischen"])
    expect(stepOf(recipe, "verruehren").flow.takes).toEqual([])
    expect(stepOf(recipe, "untermixen").flow.takes).toEqual(["verruehren"])
    expect(stepOf(recipe, "giessen").flow.takes).toEqual(["boden", "untermixen", "zupfteig"])
    expect(stepOf(recipe, "backen").flow).toMatchObject({ takes: ["giessen"], waitsFor: ["vorheizen"] })
    expect(stepOf(recipe, "boden").flow.waitsFor).toEqual(["einfetten"])
    expect(stepOf(recipe, "auskuehlen").flow.takes).toEqual(["backen"])
    expect(stepOf(recipe, "vorheizen").flow.makes).toBe(false)
    expect(recipe.makes).toEqual(["auskuehlen"])
  })

  it("reads it back as written", async () => {
    const { client, recipeId, added } = await setup()
    const read = await client.call("get_recipe", { recipeId })
    expect(read.value).toEqual(added)
    expect(read.value.ingredients).toHaveLength(14)
    expect(stepOf(read.value, "boden").takes).toEqual(["boden-teig"])
  })

  it("keeps who added it and one change per write (sync rules 1, 4)", async () => {
    const { cook, client, recipeId } = await setup()
    const changes = cook.library.listChanges({ after: 0, limit: 10 })
    expect(changes.map((change) => change.kind)).toEqual(["recipe_added"])
    expect(changes[0]!.by).toEqual({ kind: "claude", connection: "connection-1" })
    const { value } = await client.call("list_revisions", { recipeId })
    expect(value.revisions).toEqual([{ revision: 1, at: expect.any(String), by: { kind: "claude", name: "Claude" }, was: { added: true } }])
  })

  it("refuses with every problem, naming the edit and the rule, and writes nothing", async () => {
    const cook = makeCook()
    const client = await cook.connect()

    const refused = await client.call("add_recipe", {
      title: "Kaputt",
      yield: { amount: { value: 2, unit: "piece" } },
      edits: [
        { op: "add_ingredient", key: "mehl", item: "Mehl" },
        { op: "add_ingredient", key: "kakao", item: "Kakao" },
        { op: "add_step", key: "mischen", label: "mischen", uses: ["mehl", "zucker-tieg"] },
        { op: "add_step", key: "ruehren", label: "rühren", at: { after: "gibt-es-nicht" } },
      ],
    })

    expect(refused.isError).toBe(true)
    expect(refused.value.refused).toBe(true)
    const problems: Array<{ edit?: number; rule?: string; message: string }> = refused.value.problems
    expect(problems.flatMap((problem) => (problem.edit === undefined ? [] : [problem.edit]))).toContain(4)
    expect(problems.some((problem) => problem.rule === "every-ingredient-goes-to-one-step" && problem.message.includes("kakao"))).toBe(true)
    expect(problems.length).toBeGreaterThanOrEqual(3)

    for (const table of ["recipe", "revision", "change", "retry", "recipe_text", "recipe_item"]) expect(cook.count(table), table).toBe(0)
  })

  it("refuses a page already in the library, the trash included, and names it (adding rule 6)", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }))

    try {
      const cook = makeCook()
      const client = await cook.connect()
      const first = await client.call("add_recipe", { ...zupfkuchen, source: "http://www.example.com/zupfkuchen/?utm_source=insta#top" })
      expect(first.value.source).toBe("https://example.com/zupfkuchen")
      const second = await client.call("add_recipe", { ...zupfkuchen, source: "https://example.com/zupfkuchen?utm_medium=x" })
      expect(second.isError).toBe(true)
      expect(second.value.problems[0]).toMatchObject({ rule: "one-recipe-per-page" })
      expect(second.value.problems[0].message).toContain(first.value.id)
      await client.call("trash_recipes", { recipeIds: [first.value.id] })
      const third = await client.call("add_recipe", { ...zupfkuchen, source: "https://example.com/zupfkuchen" })
      expect(third.value.problems[0].message).toContain("in the trash")
      expect((await client.call("add_recipe", { ...zupfkuchen, source: "not a url" })).value.problems[0].message).toContain("not a web address")
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("costs no fetch when the batch is refused", async () => {
    let fetched = 0
    vi.stubGlobal("fetch", async () => {
      fetched++

      return new Response(null, { status: 200 })
    })

    try {
      const client = await makeCook().connect()
      const refused = await client.call("add_recipe", { title: "Leer", yield: { amount: { value: 1 } }, source: "https://example.com/leer", edits: [] })
      expect(refused.isError).toBe(true)
      expect(fetched).toBe(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("reports an unknown recipe as a refusal, not a protocol error", async () => {
    const { client } = await setup()
    const missing = await client.call("get_recipe", { recipeId: "rcp_aaaaaaaaaaaaaaaaaaaaaaaa" })
    expect(missing).toEqual({
      isError: true,
      value: { refused: true, problems: [{ rule: "unknown-recipe", message: 'no recipe "rcp_aaaaaaaaaaaaaaaaaaaaaaaa"', fix: expect.any(String) }] },
    })
  })
})

describe("revising (revising rules 1–5)", () => {
  const lessSugar = [
    { op: "edit_ingredient", key: "zucker-teig", amount: { value: 120, unit: "g" } },
    { op: "edit_step", key: "backen", duration: { minutes: 65, maxMinutes: 70, kind: "passive" } },
  ]

  it("saves a batch as one revision and returns the recipe", async () => {
    const { cook, client, recipeId } = await setup()
    const revised = await client.call("edit_recipe", { recipeId, fromRevision: 1, edits: lessSugar })
    expect(revised.isError).toBe(false)
    expect(revised.value).toMatchObject({ revision: 2, latestRevision: 2 })
    expect(revised.value.ingredients.find((ingredient: any) => ingredient.key === "zucker-teig").amount.value).toBe(120)
    expect(cook.library.listChanges({ after: 0, limit: 10 }).map((change) => change.kind)).toEqual(["recipe_added", "recipe_revised"])
    const old = await client.call("get_recipe", { recipeId, revision: 1 })
    expect(old.value).toMatchObject({ revision: 1, latestRevision: 2 })
    expect(old.value.ingredients.find((ingredient: any) => ingredient.key === "zucker-teig").amount.value).toBe(180)
    const { value } = await client.call("list_revisions", { recipeId })
    expect(value.revisions.map((revision: any) => revision.revision)).toEqual([2, 1])
    expect(value.revisions[0].was).toEqual({ edits: lessSugar })
  })

  it("refuses a stale fromRevision with the latest revision (rule 2)", async () => {
    const { client, recipeId } = await setup()
    await client.call("edit_recipe", { recipeId, fromRevision: 1, edits: lessSugar })
    const stale = await client.call("edit_recipe", { recipeId, fromRevision: 1, edits: [{ op: "set_title", title: "Zupfkuchen" }] })
    expect(stale.isError).toBe(true)
    expect(stale.value).toMatchObject({ refused: true, latestRevision: 2 })
    expect(stale.value.problems[0].rule).toBe("revise-what-you-saw")
  })

  it("refuses a broken batch with the latest revision and changes nothing (rule 1)", async () => {
    const { cook, client, recipeId } = await setup()

    const refused = await client.call("edit_recipe", {
      recipeId,
      fromRevision: 1,
      edits: [{ op: "edit_ingredient", key: "mehl", amount: { value: 1 } }, { op: "remove_ingredient", key: "kakao" }, { op: "edit_ingredient", key: "nix", item: "x" }],
    })

    expect(refused.value).toMatchObject({ refused: true, latestRevision: 1 })
    expect(refused.value.problems.some((problem: any) => problem.edit === 3)).toBe(true)
    expect(refused.value.problems.some((problem: any) => problem.rule === "everything-named-exists")).toBe(true)
    expect(cook.count("revision")).toBe(1)
    expect(cook.count("change")).toBe(1)
  })

  it("restores an earlier revision as the next one (rule 5)", async () => {
    const { client, recipeId } = await setup()
    await client.call("edit_recipe", { recipeId, fromRevision: 1, edits: lessSugar })
    const restored = await client.call("restore_revision", { recipeId, fromRevision: 2, revision: 1 })
    expect(restored.value.revision).toBe(3)
    expect(restored.value.ingredients.find((ingredient: any) => ingredient.key === "zucker-teig").amount.value).toBe(180)
    const { value } = await client.call("list_revisions", { recipeId })
    expect(value.revisions[0].was).toEqual({ restored: 1 })
    expect(value.revisions).toHaveLength(3)
    const missing = await client.call("restore_revision", { recipeId, fromRevision: 3, revision: 9 })
    expect(missing.isError).toBe(true)
    expect(missing.value.problems[0].message).toContain("no revision 9")
  })

  it("names the connection that revised, by the name connectClient gave it", async () => {
    const { cook, recipeId } = await setup()
    cook.database.prepare(`INSERT INTO connection (client_id, name, connected_at) VALUES ('connection-1', 'Claude Code', 0)`).run()
    const { call } = await cook.connect({ connection: "connection-1" })
    const { value } = await call("list_revisions", { recipeId })
    expect(value.revisions[0].by).toEqual({ kind: "claude", name: "Claude Code" })
  })
})

describe("trash (revising rules 4, 6–10)", () => {
  it("trashes, lists, hides from search, and restores", async () => {
    const { cook, client, recipeId } = await setup()
    const trashed = await client.call("trash_recipes", { recipeIds: [recipeId] })
    expect(trashed.value.trashed).toHaveLength(1)
    const purgeAt = Date.parse(trashed.value.trashed[0].purgeAt)
    expect(Math.abs(purgeAt - (Date.now() + 720 * 3600 * 1000))).toBeLessThan(10_000)
    const listed = await client.call("list_trash")
    expect(listed.value.recipes).toEqual([{ id: recipeId, title: zupfkuchenTitle, trashedAt: expect.any(String), purgeAt: trashed.value.trashed[0].purgeAt }])
    expect((await client.call("search_recipes", {})).value.recipes).toEqual([])
    const read = await client.call("get_recipe", { recipeId })
    expect(read.value).toMatchObject({ trashedAt: listed.value.recipes[0].trashedAt, purgeAt: trashed.value.trashed[0].purgeAt })
    expect(cook.count("recipe_text")).toBe(0)
    expect(await cook.getAlarm()).toBe(purgeAt)

    const refused = await client.call("edit_recipe", { recipeId, fromRevision: 1, edits: [{ op: "set_title", title: "Neu" }] })
    expect(refused.value.problems[0]).toMatchObject({ rule: "not-in-the-trash" })

    const restored = await client.call("restore_recipes", { recipeIds: [recipeId] })
    expect(restored.value).toEqual({ recipeIds: [recipeId] })
    expect((await client.call("search_recipes", {})).value.recipes).toHaveLength(1)
    expect((await client.call("list_trash")).value.recipes).toEqual([])
    expect(await cook.getAlarm()).toBe(null)
  })

  it("is all or nothing, and keeps the date of one already trashed (rule 10)", async () => {
    const { cook, client, recipeId } = await setup()

    const other = (await client.call("add_recipe", { title: "Pfannkuchen", yield: { amount: { value: 4, unit: "serving" } }, edits: [
      { op: "add_ingredient", key: "mehl", item: "Mehl" }, { op: "add_step", key: "braten", label: "braten", uses: ["mehl"] },
    ] })).value.id

    const ghost = "rcp_zzzzzzzzzzzzzzzzzzzzzzzz"
    const refused = await client.call("trash_recipes", { recipeIds: [recipeId, other, ghost] })
    expect(refused.value.problems[0]).toMatchObject({ rule: "several-at-once" })
    expect(refused.value.problems[0].message).toContain(ghost)
    expect((await client.call("list_trash")).value.recipes).toEqual([])

    const first = await client.call("trash_recipes", { recipeIds: [recipeId] })
    const both = await client.call("trash_recipes", { recipeIds: [recipeId, other] })
    const byId = Object.fromEntries(both.value.trashed.map((entry: any) => [entry.id, entry.purgeAt]))
    expect(byId[recipeId]).toBe(first.value.trashed[0].purgeAt)
    expect(Object.keys(byId).sort()).toEqual([recipeId, other].sort())
    expect(cook.library.listChanges({ after: 0, limit: 20 }).filter((change) => change.kind === "recipes_trashed")).toHaveLength(2)

    const restoredAll = await client.call("restore_recipes", { recipeIds: [recipeId, other, ghost] })
    expect(restoredAll.isError).toBe(true)
    expect((await client.call("list_trash")).value.recipes).toHaveLength(2)
  })
})

describe("retries (mcp.md Retries)", () => {
  it("returns the stored first result for the same write from the same connection, and changes nothing", async () => {
    const cook = makeCook()
    const client = await cook.connect()

    const args = { title: "Pfannkuchen", yield: { amount: { value: 4, unit: "serving" } }, edits: [
      { op: "add_ingredient", key: "mehl", item: "Mehl" }, { op: "add_step", key: "braten", label: "braten", uses: ["mehl"] },
    ] }

    const first = await client.call("add_recipe", args)
    const again = await client.call("add_recipe", { edits: args.edits, yield: args.yield, title: args.title })
    expect(again).toEqual(first)
    expect(cook.count("recipe")).toBe(1)
    expect(cook.count("change")).toBe(1)
    expect(cook.count("retry")).toBe(1)
  })

  it("writes again for another connection, other arguments, or after 10 minutes", async () => {
    let clock = 1_000_000
    const cook = makeCook({ now: () => clock })
    const client = await cook.connect()
    const other = await cook.connect({ connection: "connection-2" })
    const args = { title: "Eins", yield: { amount: { value: 1 } }, edits: [{ op: "add_ingredient", key: "a", item: "A" }, { op: "add_step", key: "s", label: "s", uses: ["a"] }] }
    const first = await client.call("add_recipe", args)
    expect((await other.call("add_recipe", args)).value.id).not.toBe(first.value.id)
    expect((await client.call("add_recipe", { ...args, title: "Zwei" })).value.id).not.toBe(first.value.id)
    clock += 10 * 60 * 1000 + 1
    expect((await client.call("add_recipe", args)).value.id).not.toBe(first.value.id)
    expect(cook.count("recipe")).toBe(4)
  })

  it("answers an edit_recipe retry with its stored result, not a stale-revision refusal", async () => {
    const { client, recipeId } = await setup()
    const args = { recipeId, fromRevision: 1, edits: [{ op: "set_title", title: "Zupfkuchen" }] }
    const first = await client.call("edit_recipe", args)
    expect(first.value.revision).toBe(2)
    expect(await client.call("edit_recipe", args)).toEqual(first)
  })

  it("doesn't store a refusal", async () => {
    const { cook, client, recipeId } = await setup()
    const args = { recipeId, fromRevision: 7, edits: [{ op: "set_title", title: "Zupfkuchen" }] }
    expect((await client.call("edit_recipe", args)).isError).toBe(true)
    expect(cook.count("retry")).toBe(1) // the add
  })
})

describe("input", () => {
  it("rejects a malformed key as a protocol error that says where", async () => {
    const { client, recipeId } = await setup()
    await expect(client.call("edit_recipe", { recipeId, fromRevision: 1, edits: [{ op: "remove_step", key: "Nicht Gültig" }] })).rejects.toThrow(/key/)
  })
})
