import { DateTime, Effect, Layer, Option, Result } from "effect"
import { beforeEach, describe, expect, it } from "vitest"
import { AddRecipeService } from "../../src/domain/recipe/add-recipe-service.ts"
import { RestoreRecipeRevisionService } from "../../src/domain/recipe/restore-recipe-revision-service.ts"
import { RestoreRecipesService } from "../../src/domain/recipe/restore-recipes-service.ts"
import { ReviseRecipeService } from "../../src/domain/recipe/revise-recipe-service.ts"
import { TrashRecipesService } from "../../src/domain/recipe/trash-recipes-service.ts"
import {
  isRecipePurgeDueAt,
  LibraryRecipe,
  recipePurgeAtFromTrashedAt,
  TrashedRecipe,
  trashRecipes,
} from "../../src/domain/recipe/recipe.ts"
import { recipeFlowFromContent } from "../../src/domain/recipe/recipe-flow.ts"
import { RecipeId } from "../../src/domain/recipe/recipe-id.ts"
import type { ChangeAuthor } from "../../src/domain/shared/change-author.ts"
import {
  decodeRecipeEdits,
  pastaUsesEdits,
  plainPasta,
  zupfkuchen,
  zupfkuchenEdits,
  zupfkuchenTitle,
  zupfkuchenYield,
} from "./fixtures.ts"
import { inMemoryRecipeSourcesLayer, makeInMemoryRecipeRepository } from "./in-memory-recipe-repository.ts"

const claude: ChangeAuthor = { kind: "claude", connection: "claude-ai" }
const iPad: ChangeAuthor = { kind: "device", device: "ipad" }

const zupfkuchenId = RecipeId.make("rcp_zupfkuchen".padEnd(28, "0"))
const pastaId = RecipeId.make("rcp_pasta".padEnd(28, "0"))

let repository = makeInMemoryRecipeRepository()

const services = () =>
  Layer.mergeAll(
    AddRecipeService.layer,
    ReviseRecipeService.layer,
    RestoreRecipeRevisionService.layer,
    TrashRecipesService.layer,
    RestoreRecipesService.layer,
  ).pipe(Layer.provide([repository.layer, inMemoryRecipeSourcesLayer]))

const run = <A, E>(
  effect: Effect.Effect<A, E, AddRecipeService | ReviseRecipeService | RestoreRecipeRevisionService | TrashRecipesService | RestoreRecipesService>,
) => Effect.runPromise(Effect.result(Effect.provide(effect, services())))

const failureTag = <A, E extends { readonly _tag: string }>(result: Result.Result<A, E>) =>
  Result.isFailure(result) ? result.failure._tag : "ok"

const reviseZupfkuchen = ({ fromRevision, edits, by = iPad }: { readonly fromRevision: number; readonly edits: ReadonlyArray<unknown>; readonly by?: ChangeAuthor }) =>
  run(ReviseRecipeService.use((service) => service.reviseRecipe({ recipeId: zupfkuchenId, fromRevision, edits: decodeRecipeEdits(edits), by })))

const latestZupfkuchen = () => {
  const revisions = repository.storedRecipes.get(zupfkuchenId)?.revisions ?? []

  return { revision: revisions.length, content: revisions[revisions.length - 1] }
}

const amountOf = (content: typeof zupfkuchen | undefined, key: string) =>
  content?.ingredients.find((ingredient) => ingredient.key === key)?.amount?.value

beforeEach(() => {
  repository = makeInMemoryRecipeRepository()
  repository.storedRecipes.set(zupfkuchenId, { recipeId: zupfkuchenId, revisions: [zupfkuchen, zupfkuchen, zupfkuchen] })
  repository.storedRecipes.set(pastaId, { recipeId: pastaId, revisions: [plainPasta] })
})

describe("revising, Zupfkuchen at revision 3", () => {
  it("iPad saves from revision 3: revision 4", async () => {
    expect(await reviseZupfkuchen({ fromRevision: 3, edits: [{ op: "set_title", title: "Zupfkuchen" }] })).toEqual(Result.succeed(4))
  })

  it("edit zucker-teig to 120 g and backen to 65–70 min: one revision, 4 (rule 1)", async () => {
    await reviseZupfkuchen({ fromRevision: 3, edits: [
      { op: "edit_ingredient", key: "zucker-teig", amount: { value: 120, unit: "g" } },
      { op: "edit_step", key: "backen", duration: { minutes: 65, maxMinutes: 70, kind: "passive" } },
    ] })
    const latest = latestZupfkuchen()
    expect(latest.revision).toBe(4)
    expect(amountOf(latest.content, "zucker-teig")).toBe(120)
    expect(latest.content?.steps.find((step) => step.key === "backen")?.duration).toEqual({ minutes: 65, maxMinutes: 70, kind: "passive" })
  })

  it("edit 2 names zucker-tieg: refused, edit 2; nothing saved (rule 1)", async () => {
    const result = await reviseZupfkuchen({ fromRevision: 3, edits: [
      { op: "edit_ingredient", key: "zucker-teig", amount: { value: 120, unit: "g" } },
      { op: "edit_ingredient", key: "zucker-tieg", amount: { value: 120, unit: "g" } },
    ] })

    expect(Result.isFailure(result) && result.failure._tag === "RecipeRefusedError" && result.failure.problems)
      .toEqual([{ edit: 2, message: 'no ingredient "zucker-tieg"' }])
    expect(latestZupfkuchen().revision).toBe(3)
  })

  it("remove kakao and edit what mischen uses without it: revision 4", async () => {
    expect(await reviseZupfkuchen({ fromRevision: 3, edits: [
      { op: "remove_ingredient", key: "kakao" },
      { op: "edit_step", key: "mischen", uses: ["mehl", "zucker-teig", "vanillezucker", "backpulver", "salz"] },
    ] })).toEqual(Result.succeed(4))
  })

  it("Claude saves revision 4, then iPad saves from revision 3: refused, iPad sees revision 4 (rule 2)", async () => {
    await reviseZupfkuchen({ fromRevision: 3, edits: [{ op: "set_title", title: "Zupfkuchen" }], by: claude })
    const result = await reviseZupfkuchen({ fromRevision: 3, edits: [{ op: "set_title", title: "Russischer Zupfkuchen" }] })
    expect(Result.isFailure(result) && result.failure._tag === "RecipeRevisedSinceError" && result.failure.latestRevision).toBe(4)
  })

  it("Pasta with plain steps: name the ingredients each step uses, in one batch: next revision, with a flow (recipe rule 10)", async () => {
    const result = await run(ReviseRecipeService.use((service) =>
      service.reviseRecipe({ recipeId: pastaId, fromRevision: 1, edits: pastaUsesEdits, by: claude })
    ))

    expect(result).toEqual(Result.succeed(2))
    const revisions = repository.storedRecipes.get(pastaId)?.revisions ?? []
    expect(Option.isSome(recipeFlowFromContent(revisions[1]!))).toBe(true)
  })

  it("remove section Teig: its ingredients and steps stay, without a section; the derived flow changes (recipe rule 11)", async () => {
    await reviseZupfkuchen({ fromRevision: 3, edits: [{ op: "remove_section", key: "teig" }] })
    const content = latestZupfkuchen().content!
    expect(content.sections.map((section) => section.key)).toEqual(["fuellung"])
    expect(content.ingredients.find((ingredient) => ingredient.key === "mehl")?.section).toBeUndefined()
    expect(content.steps.find((step) => step.key === "verkneten")?.section).toBeUndefined()
    const giessen = Option.getOrThrow(recipeFlowFromContent(content)).steps.find((step) => step.stepKey === "giessen")
    expect(giessen?.takes).toContainEqual({ key: "boden", source: "chain" })
  })

  it("revising a trashed recipe: refused (rule 4)", async () => {
    await run(TrashRecipesService.use((service) => service.trashRecipes({ recipeIds: [zupfkuchenId], by: claude })))
    expect(failureTag(await reviseZupfkuchen({ fromRevision: 3, edits: [{ op: "set_title", title: "Zupfkuchen" }] })))
      .toBe("RecipeAlreadyTrashedError")
  })

  it("Claude's revision 5 cut the Zucker in Teig to 120 g; the cook restores revision 4: revision 6 with 180 g (rule 5)", async () => {
    await reviseZupfkuchen({ fromRevision: 3, edits: [{ op: "set_title", title: "Zupfkuchen" }] })
    await reviseZupfkuchen({ fromRevision: 4, edits: [{ op: "edit_ingredient", key: "zucker-teig", amount: { value: 120, unit: "g" } }], by: claude })

    const restored = await run(RestoreRecipeRevisionService.use((service) =>
      service.restoreRecipeRevision({ recipeId: zupfkuchenId, fromRevision: 5, revision: 4, by: iPad })
    ))

    expect(restored).toEqual(Result.succeed(6))
    expect(amountOf(latestZupfkuchen().content, "zucker-teig")).toBe(180)
    expect(repository.storedRecipes.get(zupfkuchenId)?.revisions).toHaveLength(6)

    const restoredAgain = await run(RestoreRecipeRevisionService.use((service) =>
      service.restoreRecipeRevision({ recipeId: zupfkuchenId, fromRevision: 6, revision: 6, by: iPad })
    ))

    expect(restoredAgain).toEqual(Result.succeed(7))
    expect(latestZupfkuchen().content).toEqual(repository.storedRecipes.get(zupfkuchenId)?.revisions[5])
  })
})

describe("adding", () => {
  const addZupfkuchen = ({ source, by = claude }: { readonly source?: string; readonly by?: ChangeAuthor }) =>
    run(AddRecipeService.use((service) =>
      service.addRecipe({ title: zupfkuchenTitle, yield: zupfkuchenYield, edits: zupfkuchenEdits, by, ...(source === undefined ? {} : { source }) })
    ))

  it("Claude adds the Zupfkuchen with each step naming its ingredients: revision 1, by Claude (adding rules 1, 2)", async () => {
    const result = await addZupfkuchen({})
    const recipeId = Result.getOrThrow(result)
    expect(repository.storedRecipes.get(recipeId)?.revisions).toHaveLength(1)
    expect(repository.publishedEvents.at(-1)).toMatchObject({ _tag: "RecipeAddedEvent", revision: 1, by: claude })
  })

  it("the same page a week later, shared with ?utm_source=instagram, while the first is in the trash: refused (adding rule 6)", async () => {
    const first = Result.getOrThrow(await addZupfkuchen({ source: "https://www.chefkoch.de/rezepte/zupfkuchen" }))
    await run(TrashRecipesService.use((service) => service.trashRecipes({ recipeIds: [first], by: claude })))
    const second = await addZupfkuchen({ source: "https://www.chefkoch.de/rezepte/zupfkuchen?utm_source=instagram" })
    expect(Result.isFailure(second) && second.failure).toMatchObject({
      _tag: "RecipeSourceAlreadyAddedError", recipeId: first, title: zupfkuchenTitle, trashed: true,
    })
  })
})

describe("trash", () => {
  // Mon 12 Oct 2026, 18:00 Europe/Berlin (CEST)
  const trashedAt = DateTime.makeUnsafe("2026-10-12T16:00:00Z")
  const purgeAt = recipePurgeAtFromTrashedAt(trashedAt)
  const trashed = TrashedRecipe.make({ recipeId: zupfkuchenId, latestRevision: 3, content: zupfkuchen, trashedAt, purgeAt })

  it.each([
    { now: "2026-11-10T17:00:00Z", due: false }, // Tue 10 Nov 2026, still restorable
    { now: "2026-11-11T15:59:59.999Z", due: false }, // 1 ms before 30 days
    { now: "2026-11-11T16:00:00Z", due: true }, // 30 days after, across the end of summer time
    { now: "2026-11-11T17:00:00Z", due: true }, // Wed 11 Nov 2026, 18:00 Europe/Berlin (CET)
  ])("trashed Mon 12 Oct 2026, 18:00 Europe/Berlin; at $now purge due: $due (rule 7)", ({ now, due }) => {
    expect(isRecipePurgeDueAt({ recipe: trashed, now: DateTime.makeUnsafe(now) })).toBe(due)
  })

  it("Claude trashes 5 duplicates, one already trashed last week: 4 trashed now, the fifth keeps its date; one change (rule 10)", () => {
    const now = DateTime.makeUnsafe("2026-10-19T16:00:00Z")

    const duplicates = [1, 2, 3, 4].map((n) =>
      LibraryRecipe.make({ recipeId: RecipeId.make(`rcp_duplicate${n}`.padEnd(28, "0")), latestRevision: 1, content: zupfkuchen })
    )

    const event = trashRecipes({ recipes: [...duplicates, trashed], by: claude, now })
    expect(event.trashed.map((entry) => entry.recipeId)).toEqual(duplicates.map((recipe) => recipe.recipeId))
    expect(event.alreadyTrashed).toEqual([{ recipeId: zupfkuchenId, purgeAt }])
  })

  it("Claude trashes 5 recipes, one purged meanwhile: refused, nothing trashed (rule 10)", async () => {
    const purgedId = RecipeId.make("rcp_purged".padEnd(28, "0"))
    const result = await run(TrashRecipesService.use((service) => service.trashRecipes({ recipeIds: [zupfkuchenId, purgedId], by: claude })))
    expect(Result.isFailure(result) && result.failure).toMatchObject({ _tag: "RecipesNotFoundError", recipeIds: [purgedId] })
    expect(repository.storedRecipes.get(zupfkuchenId)?.trash).toBeUndefined()
  })

  it("restoring one that isn't in the trash changes nothing (rule 10)", async () => {
    await run(TrashRecipesService.use((service) => service.trashRecipes({ recipeIds: [zupfkuchenId], by: claude })))
    await run(RestoreRecipesService.use((service) => service.restoreRecipes({ recipeIds: [zupfkuchenId, pastaId], by: iPad })))
    expect(repository.publishedEvents.at(-1)).toMatchObject({ _tag: "RecipesRestoredEvent", restoredRecipeIds: [zupfkuchenId] })
    expect(repository.storedRecipes.get(zupfkuchenId)?.trash).toBeUndefined()
  })
})
