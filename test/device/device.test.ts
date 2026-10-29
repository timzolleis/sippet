import { describe, expect, it } from "vitest"
import { zupfkuchenEdits, zupfkuchenTitle, zupfkuchenYield } from "../domain/fixtures.ts"
import { makeCook } from "../mcp/harness.ts"

const zupfkuchen = { title: zupfkuchenTitle, yield: zupfkuchenYield, edits: zupfkuchenEdits }

const simple = (title: string) => ({
  title,
  yield: { amount: { value: 4, unit: "serving" } },
  edits: [
    { op: "add_ingredient", key: "a", item: "Mehl" },
    { op: "add_step", key: "s", label: `${title} machen`, uses: ["a"], duration: { minutes: 20, kind: "active" } },
  ],
})

const day = 24 * 3600 * 1000

const setup = async () => {
  let clock = Date.UTC(2026, 0, 10, 12)
  const cook = makeCook({ now: () => clock })
  const claude = await cook.connect()
  const add = async (recipe: Parameters<typeof claude.call>[1]): Promise<string> => (await claude.call("add_recipe", recipe)).value.id
  const advance = (ms: number) => void (clock += ms)

  return { cook, claude, add, advance, now: () => clock }
}

const tagNames = (organization: any) => Object.fromEntries(organization.tags.map((tag: any) => [tag.name, tag.recipeIds]))

describe("getLibrary (sync rules 1, 6)", () => {
  it("returns the library and the trash with their tags, at the last change", async () => {
    const { cook, claude, add } = await setup()
    const zupf = await add(zupfkuchen)
    const apfel = await add(simple("Apfelkuchen"))
    await claude.call("edit_library", { edits: [{ op: "tag", tag: "Kuchen", recipeIds: [zupf, apfel] }] })
    await claude.call("trash_recipes", { recipeIds: [apfel] })

    const { status, body } = await cook.device("/api/device/library")

    expect(status).toBe(200)
    expect(body.seq).toBe(cook.library.lastSeq())
    expect(body.recipes.map((recipe: any) => recipe.id).sort()).toEqual([zupf, apfel].sort())
    const trashed = body.recipes.find((recipe: any) => recipe.id === apfel)
    expect(trashed.trashedAt).toBe("2026-01-10T12:00:00.000Z")
    expect(trashed.purgeAt).toBe("2026-02-09T12:00:00.000Z")
    expect(body.recipes.find((recipe: any) => recipe.id === zupf).trashedAt).toBeUndefined()
    expect(tagNames(body)).toEqual({ Kuchen: [zupf, apfel] })
  })

  it("carries each step's flow (mcp.md example)", async () => {
    const { cook, add } = await setup()
    await add(zupfkuchen)

    const { body } = await cook.device("/api/device/library")
    const steps = body.recipes[0].steps
    const stepOf = (key: string) => steps.find((step: any) => step.key === key)

    expect(body.recipes[0]).toMatchObject({ revision: 1, title: zupfkuchenTitle, hasFlow: true })
    expect(stepOf("giessen").flow.takes).toEqual(["boden", "untermixen", "zupfteig"])
    expect(stepOf("backen").flow).toMatchObject({ takes: ["giessen"], waitsFor: ["vorheizen"] })
  })
})

describe("listChangesAfter (sync rules 1, 2, 4, 6)", () => {
  it("catches an iPhone up from 41: changes by Claude, each touched recipe once, the whole organization", async () => {
    const { cook, claude, add } = await setup()
    const zupf = await add(zupfkuchen)
    const [apfel, brownies, kaese] = [await add(simple("Apfelkuchen")), await add(simple("Brownies")), await add(simple("Käsekuchen"))]
    const seen = cook.library.lastSeq()
    await claude.call("edit_library", { edits: [{ op: "tag", tag: "Kuchen", recipeIds: [apfel, brownies, kaese] }] })
    await claude.call("edit_recipe", { recipeId: zupf, fromRevision: 1, edits: [{ op: "set_title", title: "Zupfkuchen" }] })
    await claude.call("edit_recipe", { recipeId: zupf, fromRevision: 2, edits: [{ op: "set_title", title: "Zupfkuchen vegan" }] })

    const { status, body } = await cook.device(`/api/device/changes?after=${seen}`)

    expect(status).toBe(200)
    expect(body.seq).toBe(seen + 3)
    expect(body.changes.map((change: any) => [change.seq, change.kind, change.by])).toEqual([
      [seen + 1, "library_changed", { kind: "claude", name: "Claude" }],
      [seen + 2, "recipe_revised", { kind: "claude", name: "Claude" }],
      [seen + 3, "recipe_revised", { kind: "claude", name: "Claude" }],
    ])
    expect(body.changes[0].recipeIds).toEqual([apfel, brownies, kaese])
    expect(body.recipes.map((recipe: any) => [recipe.id, recipe.revision])).toEqual([[zupf, 3]])
    expect(tagNames(body)).toEqual({ Kuchen: [apfel, brownies, kaese] })
    expect(body.purgedRecipeIds).toEqual([])
  })

  it("lists a recipe added and then purged in purgedRecipeIds, not in recipes (sync rule 4)", async () => {
    const { cook, claude, add, advance } = await setup()
    const seen = cook.library.lastSeq()
    const gone = await add(simple("Brownies"))
    await claude.call("trash_recipes", { recipeIds: [gone] })
    advance(31 * day)
    await cook.purge()

    const { body } = await cook.device(`/api/device/changes?after=${seen}`)

    expect(body.purgedRecipeIds).toEqual([gone])
    expect(body.recipes).toEqual([])
    expect(body.changes.at(-1)).toMatchObject({ kind: "recipes_purged", by: { kind: "trash", name: "Trash" }, recipeIds: [gone] })
  })

  it("returns no changes and no recipes at the last seq", async () => {
    const { cook, add } = await setup()
    await add(zupfkuchen)
    const seq = cook.library.lastSeq()

    const { status, body } = await cook.device(`/api/device/changes?after=${seq}`)

    expect(status).toBe(200)
    expect(body).toMatchObject({ seq, changes: [], recipes: [], purgedRecipeIds: [] })
  })

  it("answers 409 when the device is ahead of the log (sync rule 6)", async () => {
    const { cook, add } = await setup()
    await add(zupfkuchen)

    const { status, body } = await cook.device(`/api/device/changes?after=${cook.library.lastSeq() + 6}`)

    expect(status).toBe(409)
    expect(body._tag).toBe("ChangesNotReachedHttpError")
  })

  it("shows the newest 100 of 150 changes, with every touched recipe", async () => {
    const { cook, claude, add } = await setup()
    const first = await add(simple("Erstes"))
    const seen = cook.library.lastSeq()
    const ids: Array<string> = []
    let revision = 1

    for (let index = 0; index < 150; index++) {
      if (index % 3 === 0) ids.push(await add(simple(`Rezept ${index}`)))
      else await claude.call("edit_recipe", { recipeId: first, fromRevision: revision++, edits: [{ op: "set_title", title: `Erstes ${index}` }] })
    }

    const { body } = await cook.device(`/api/device/changes?after=${seen}`)

    expect(cook.library.lastSeq() - seen).toBe(150)
    expect(body.changes).toHaveLength(100)
    expect(body.changes[0].seq).toBe(seen + 51)
    expect(body.changes.at(-1).seq).toBe(seen + 150)
    expect(body.recipes.map((recipe: any) => recipe.id).sort()).toEqual([first, ...ids].sort())
  })
})

describe("editLibrary (library rules 1–15)", () => {
  it("tags a recipe as the iPad, one change by the device (library 3)", async () => {
    const { cook, add } = await setup()
    const zupf = await add(zupfkuchen)

    const { status, body } = await cook.device("/api/device/library/edits", { method: "POST", body: { edits: [{ op: "tag", tag: "Backen", recipeIds: [zupf] }] } })

    expect(status).toBe(200)
    expect(tagNames(body)).toEqual({ Backen: [zupf] })
    const [last] = cook.library.listChanges({ after: cook.library.lastSeq() - 1, limit: 5 })
    expect(last).toMatchObject({ kind: "library_changed", by: { kind: "device", device: "iPad" } })
  })

  it("refuses a batch naming a trashed recipe with 422 and changes nothing (library 1)", async () => {
    const { cook, claude, add } = await setup()
    const zupf = await add(zupfkuchen)
    const trashed = await add(simple("Alt"))
    await claude.call("trash_recipes", { recipeIds: [trashed] })
    const before = cook.count("change")

    const { status, body } = await cook.device("/api/device/library/edits", {
      method: "POST",
      body: { edits: [{ op: "tag", tag: "Backen", recipeIds: [zupf] }, { op: "tag", tag: "Backen", recipeIds: [trashed] }] },
    })

    expect(status).toBe(422)
    expect(body._tag).toBe("LibraryEditsRefusedHttpError")
    expect(body.problems).toEqual([expect.objectContaining({ edit: 2, rule: "trashed-recipes-leave-the-library" })])
    expect(cook.count("change")).toBe(before)
  })

  const batch = (recipeId: string) => ({ edits: [{ op: "tag", tag: "Backen", recipeIds: [recipeId] }] })

  it("answers the same batch again from the same device with the stored result, one change (mcp.md Retries)", async () => {
    const { cook, add, advance } = await setup()
    const zupf = await add(zupfkuchen)
    const first = await cook.device("/api/device/library/edits", { method: "POST", body: batch(zupf) })
    const seq = cook.library.lastSeq()
    advance(5 * 60 * 1000)

    const again = await cook.device("/api/device/library/edits", { method: "POST", body: batch(zupf) })

    expect(again).toEqual(first)
    expect(cook.library.lastSeq()).toBe(seq)
  })

  it("applies the same batch from another device again (its own retry key)", async () => {
    const { cook, add } = await setup()
    const zupf = await add(zupfkuchen)
    await cook.device("/api/device/library/edits", { method: "POST", body: batch(zupf) })
    const seq = cook.library.lastSeq()

    const other = await cook.device("/api/device/library/edits", {
      method: "POST",
      body: batch(zupf),
      deviceId: "0b9a7d2e-5f10-4b5e-8f0e-6c9f5f3d2a02",
      deviceName: "iPhone",
    })

    expect(other.status).toBe(200)
    expect(cook.library.lastSeq()).toBe(seq + 1)
  })
})

describe("trashRecipes / restoreRecipes (revising rules 6–10)", () => {
  it("trashes the Zupfkuchen: trashedAt and purgeAt 30 days later", async () => {
    const { cook, add } = await setup()
    const zupf = await add(zupfkuchen)

    const { status, body } = await cook.device("/api/device/recipes/trash", { method: "POST", body: { recipeIds: [zupf] } })

    expect(status).toBe(200)
    expect(body.recipes).toHaveLength(1)
    expect(body.recipes[0]).toMatchObject({ id: zupf, trashedAt: "2026-01-10T12:00:00.000Z", purgeAt: "2026-02-09T12:00:00.000Z" })
  })

  it("refuses the whole batch with 404 naming the unknown id, trashing nothing (revising 10)", async () => {
    const { cook, add } = await setup()
    const zupf = await add(zupfkuchen)
    const unknown = "rcp_a00000000000000000000000"
    const before = cook.count("change")

    const { status, body } = await cook.device("/api/device/recipes/trash", { method: "POST", body: { recipeIds: [zupf, unknown] } })

    expect(status).toBe(404)
    expect(body).toMatchObject({ recipeIds: [unknown] })
    expect(body._tag).toBe("RecipesNotFoundHttpError")
    expect(cook.count("change")).toBe(before)
    expect(cook.library.getRecipe(zupf)?.trashedAt).toBeNull()
  })

  it("restores the Zupfkuchen: no trashedAt (revising 8)", async () => {
    const { cook, claude, add } = await setup()
    const zupf = await add(zupfkuchen)
    await claude.call("trash_recipes", { recipeIds: [zupf] })

    const { status, body } = await cook.device("/api/device/recipes/restore", { method: "POST", body: { recipeIds: [zupf] } })

    expect(status).toBe(200)
    expect(body.recipes[0].id).toBe(zupf)
    expect(body.recipes[0].trashedAt).toBeUndefined()
    expect(body.recipes[0].purgeAt).toBeUndefined()
  })
})

describe("edge", () => {
  it("answers 400 DeviceUnknownHttpError without x-device-id", async () => {
    const { cook } = await setup()

    const { status, body } = await cook.device("/api/device/library", { deviceId: null })

    expect(status).toBe(400)
    expect(body._tag).toBe("DeviceUnknownHttpError")
  })

  it("decodes a percent-encoded device name: the change is by \"Tim’s iPhone\"", async () => {
    const { cook, add } = await setup()
    const zupf = await add(zupfkuchen)

    const { status } = await cook.device("/api/device/library/edits", {
      method: "POST",
      body: { edits: [{ op: "tag", tag: "Backen", recipeIds: [zupf] }] },
      deviceName: "Tim’s iPhone",
    })

    expect(status).toBe(200)
    expect(cook.library.listChanges({ after: cook.library.lastSeq() - 1, limit: 5 })[0]?.by).toEqual({ kind: "device", device: "Tim’s iPhone" })
  })

  it("answers 400 for a malformed percent-encoding in the device name", async () => {
    const { cook } = await setup()

    expect((await cook.device("/api/device/library", { headers: { "x-device-name": "%E0%A4%A" } })).status).toBe(400)
  })

  it("answers 400 for a device name over 40 characters", async () => {
    const { cook } = await setup()

    expect((await cook.device("/api/device/library", { deviceName: "x".repeat(41) })).status).toBe(400)
  })
})
