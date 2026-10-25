import { DateTime, Effect, Layer, Result, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { editLibrary } from "../../src/domain/library/edit-library.ts"
import { EditLibraryService } from "../../src/domain/library/edit-library-service.ts"
import type { Library, RecipePlace } from "../../src/domain/library/library.ts"
import { LibraryEdit } from "../../src/domain/library/library-edit.ts"
import { recipeMatchesFilter, type RecipeFilter } from "../../src/domain/library/recipe-filter.ts"
import { RecipeId } from "../../src/domain/recipe/recipe-id.ts"
import type { ChangeAuthor } from "../../src/domain/shared/change-author.ts"
import { applyRecipeEdits } from "../../src/domain/recipe/apply-recipe-edits.ts"
import { decodeRecipeEdits, zupfkuchen } from "./fixtures.ts"
import { makeInMemoryLibraryRepository } from "./in-memory-library-repository.ts"

const recipeIdOf = (name: string) => RecipeId.make(`rcp_${name.toLowerCase()}`.padEnd(28, "0"))

const zupfkuchenId = recipeIdOf("zupfkuchen")
const apfelkuchen = recipeIdOf("apfelkuchen")
const brownies = recipeIdOf("brownies")
const kaesekuchen = recipeIdOf("kaesekuchen")
const stollen = recipeIdOf("stollen")
const vanillekipferl = recipeIdOf("vanillekipferl")
const lebkuchen = recipeIdOf("lebkuchen")
const trashedRecipe = recipeIdOf("trashed")
const nachtischOnly = [1, 2, 3, 4, 5, 6].map((n) => recipeIdOf(`nachtisch${n}`))
const dessertOnly = [1, 2, 3].map((n) => recipeIdOf(`dessert${n}`))
const shared = [1, 2].map((n) => recipeIdOf(`shared${n}`))

const recipePlaces: ReadonlyMap<RecipeId, RecipePlace> = new Map<RecipeId, RecipePlace>([
  ...[zupfkuchenId, apfelkuchen, brownies, kaesekuchen, stollen, vanillekipferl, lebkuchen, ...nachtischOnly, ...dessertOnly, ...shared]
    .map((recipeId) => [recipeId, "library"] as const),
  [trashedRecipe, "trash"],
])

const emptyLibrary: Library = { tags: [], collections: [], smartCollections: [] }
const claude: ChangeAuthor = { kind: "claude", connection: "claude-ai" }
const now = DateTime.makeUnsafe("2026-12-01T10:00:00Z")
const decodeLibraryEdits = Schema.decodeUnknownSync(Schema.Array(LibraryEdit))

const edited = ({ library = emptyLibrary, edits, places = recipePlaces }: {
  readonly library?: Library; readonly edits: ReadonlyArray<unknown>; readonly places?: ReadonlyMap<RecipeId, RecipePlace>
}) => Result.map(editLibrary({ library, edits: decodeLibraryEdits(edits), recipePlaces: places, by: claude, now }), (event) => event.library)

const problemsOf = <A>(result: Result.Result<A, { readonly problems: ReadonlyArray<unknown> }>) =>
  Result.isFailure(result) ? result.failure.problems : []

describe("tags", () => {
  const kuchen: Library = { ...emptyLibrary, tags: [{ name: "Kuchen", recipeIds: [zupfkuchenId, apfelkuchen, brownies] }] }

  it('tag Zupfkuchen, Apfelkuchen, Brownies with "Kuchen" (new): tag created, 3 recipes tagged (rule 3)', () => {
    expect(edited({ edits: [{ op: "tag", tag: "Kuchen", recipeIds: [zupfkuchenId, apfelkuchen, brownies] }] })).toEqual(Result.succeed(kuchen))
  })

  it("the same again, plus Käsekuchen: Käsekuchen tagged, the rest unchanged (rule 4)", () => {
    expect(edited({ library: kuchen, edits: [{ op: "tag", tag: "Kuchen", recipeIds: [zupfkuchenId, apfelkuchen, brownies, kaesekuchen] }] }))
      .toEqual(Result.succeed({ ...emptyLibrary, tags: [{ name: "Kuchen", recipeIds: [zupfkuchenId, apfelkuchen, brownies, kaesekuchen] }] }))
  })

  it('tag Zupfkuchen with "kuchen": unchanged, it\'s "Kuchen" (rule 3)', () => {
    expect(edited({ library: kuchen, edits: [{ op: "tag", tag: "kuchen", recipeIds: [zupfkuchenId] }] })).toEqual(Result.succeed(kuchen))
  })

  it('rename "Nachtisch" to "Dessert" while "Dessert" exists: refused, name taken; suggest merging (rule 6)', () => {
    const library: Library = { ...emptyLibrary, tags: [{ name: "Nachtisch", recipeIds: [] }, { name: "Dessert", recipeIds: [] }] }
    expect(problemsOf(edited({ library, edits: [{ op: "rename_tag", tag: "Nachtisch", to: "Dessert" }] })))
      .toEqual([{ edit: 1, message: 'the tag "Dessert" exists; merge "Nachtisch" into it instead' }])
  })

  it('a change in case only is a rename: "kuchen" → "Kuchen" (rule 6)', () => {
    const library: Library = { ...emptyLibrary, tags: [{ name: "kuchen", recipeIds: [zupfkuchenId] }] }
    expect(edited({ library, edits: [{ op: "rename_tag", tag: "kuchen", to: "Kuchen" }] }))
      .toEqual(Result.succeed({ ...emptyLibrary, tags: [{ name: "Kuchen", recipeIds: [zupfkuchenId] }] }))
  })

  it('merge "Nachtisch" (8 recipes) into "Dessert" (5, 2 shared): "Dessert" on 11, "Nachtisch" gone (rule 7)', () => {
    const library: Library = {
      ...emptyLibrary,
      tags: [{ name: "Nachtisch", recipeIds: [...nachtischOnly, ...shared] }, { name: "Dessert", recipeIds: [...dessertOnly, ...shared] }],
    }
    const tags = Result.getOrThrow(edited({ library, edits: [{ op: "merge_tags", tag: "Nachtisch", into: "Dessert" }] })).tags
    expect(tags.map((tag) => tag.name)).toEqual(["Dessert"])
    expect(new Set(tags[0]?.recipeIds)).toEqual(new Set([...dessertOnly, ...shared, ...nachtischOnly]))
    expect(tags[0]?.recipeIds).toHaveLength(11)
  })

  it('tag "Kuchen" deleted while a tagged recipe is in the trash: the tag leaves it too (rule 8, revising rule 8)', () => {
    const library: Library = { ...emptyLibrary, tags: [{ name: "Kuchen", recipeIds: [zupfkuchenId, trashedRecipe] }] }
    expect(edited({ library, edits: [{ op: "delete_tag", tag: "Kuchen" }] })).toEqual(Result.succeed(emptyLibrary))
  })
})

describe("batches and collections", () => {
  const weihnachten = (recipeIds: ReadonlyArray<RecipeId>): Library => ({ ...emptyLibrary, collections: [{ name: "Weihnachten", recipeIds }] })

  it('create "Weihnachten" with Zupfkuchen and Stollen, then tag both "Backen", in one batch: collection and tag created (rules 1, 2)', () => {
    expect(edited({ edits: [
      { op: "create_collection", name: "Weihnachten", recipeIds: [zupfkuchenId, stollen] },
      { op: "tag", tag: "Backen", recipeIds: [zupfkuchenId, stollen] },
    ] })).toEqual(Result.succeed({
      tags: [{ name: "Backen", recipeIds: [zupfkuchenId, stollen] }],
      collections: [{ name: "Weihnachten", recipeIds: [zupfkuchenId, stollen] }],
      smartCollections: [],
    }))
  })

  it("the same, but edit 2 also names a trashed recipe: refused, edit 2; no collection, no tag (rule 1)", () => {
    expect(edited({ edits: [
      { op: "create_collection", name: "Weihnachten", recipeIds: [zupfkuchenId, stollen] },
      { op: "tag", tag: "Backen", recipeIds: [zupfkuchenId, stollen, trashedRecipe] },
    ] })).toEqual(Result.fail(expect.objectContaining({
      problems: [{ edit: 2, message: `recipe "${trashedRecipe}" is in the trash` }],
    })))
  })

  it("Weihnachten: Zupfkuchen, Stollen, Vanillekipferl; add Lebkuchen, Zupfkuchen: Lebkuchen at the end (rule 10)", () => {
    expect(edited({
      library: weihnachten([zupfkuchenId, stollen, vanillekipferl]),
      edits: [{ op: "add_to_collection", collection: "Weihnachten", recipeIds: [lebkuchen, zupfkuchenId] }],
    })).toEqual(Result.succeed(weihnachten([zupfkuchenId, stollen, vanillekipferl, lebkuchen])))
  })

  it("then reorder to Stollen, Zupfkuchen: refused, Vanillekipferl and Lebkuchen missing (rule 11)", () => {
    expect(problemsOf(edited({
      library: weihnachten([zupfkuchenId, stollen, vanillekipferl, lebkuchen]),
      edits: [{ op: "reorder_collection", collection: "Weihnachten", recipeIds: [stollen, zupfkuchenId] }],
    }))).toEqual([{ edit: 1, message: `the new order misses "${vanillekipferl}", "${lebkuchen}"` }])
  })

  it('delete "Weihnachten": collection gone (rule 12)', () => {
    expect(edited({ library: weihnachten([zupfkuchenId, stollen]), edits: [{ op: "delete_collection", collection: "weihnachten" }] }))
      .toEqual(Result.succeed(emptyLibrary))
  })

  it("Zupfkuchen 3rd in Weihnachten and in the trash: a reorder keeps its place, so it's restored at 3 (revising rule 8)", () => {
    const places = new Map([...recipePlaces, [zupfkuchenId, "trash" as const]])
    expect(edited({
      library: weihnachten([stollen, vanillekipferl, zupfkuchenId, lebkuchen]),
      edits: [{ op: "reorder_collection", collection: "Weihnachten", recipeIds: [lebkuchen, vanillekipferl, stollen] }],
      places,
    })).toEqual(Result.succeed(weihnachten([lebkuchen, vanillekipferl, zupfkuchenId, stollen])))
  })

  it("a collection's name is taken by a smart collection, ignoring case (rule 9)", () => {
    const library: Library = { ...emptyLibrary, smartCollections: [{ name: "Schnell", filter: { maxTotalMinutes: 30 } }] }
    expect(problemsOf(edited({ library, edits: [{ op: "create_collection", name: "schnell" }] })))
      .toEqual([{ edit: 1, message: 'the name "schnell" is taken by a smart collection' }])
  })
})

describe("smart collections", () => {
  const schnellUndVegan: RecipeFilter = { tags: { all: ["vegan"] }, maxTotalMinutes: 45 }

  it('"Schnell & vegan": all of [vegan], total time ≤ 45 min; follows the recipe as it changes (rules 13, 14)', () => {
    const quick = applyRecipeEdits({
      content: zupfkuchen,
      edits: decodeRecipeEdits([{ op: "edit_step", key: "backen", duration: { minutes: 30, maxMinutes: 40, kind: "passive" } }]),
    }).content
    expect(recipeMatchesFilter({ content: quick, tags: ["Vegan"], filter: schnellUndVegan })).toBe(true)
    expect(recipeMatchesFilter({ content: zupfkuchen, tags: ["vegan"], filter: schnellUndVegan })).toBe(false)
    expect(recipeMatchesFilter({ content: quick, tags: ["Kuchen"], filter: schnellUndVegan })).toBe(false)
  })

  it('items used, and text across title, ingredients, and steps: "Skyr", "rühr" (rule 13)', () => {
    expect(recipeMatchesFilter({ content: zupfkuchen, tags: [], filter: { items: ["vanille-skyr"], text: "ruhr" } })).toBe(true)
  })

  it('tag "vegan" deleted: the filter becomes total time ≤ 45 min (rule 15)', () => {
    const library: Library = {
      tags: [{ name: "vegan", recipeIds: [zupfkuchenId] }],
      collections: [],
      smartCollections: [{ name: "Schnell & vegan", filter: schnellUndVegan }],
    }
    expect(edited({ library, edits: [{ op: "delete_tag", tag: "vegan" }] }))
      .toEqual(Result.succeed({ ...emptyLibrary, smartCollections: [{ name: "Schnell & vegan", filter: { maxTotalMinutes: 45 } }] }))
  })

  it("saving a filter with a tag that doesn't exist: refused (rule 1)", () => {
    expect(problemsOf(edited({ edits: [{ op: "save_smart_collection", name: "Schnell & vegan", filter: schnellUndVegan }] })))
      .toEqual([{ edit: 1, message: 'no tag "vegan"' }])
  })
})

describe("EditLibraryService", () => {
  it("a refused batch changes nothing and publishes nothing (rule 1)", async () => {
    const repository = makeInMemoryLibraryRepository({ library: emptyLibrary, recipePlaces })
    const result = await Effect.runPromise(Effect.result(EditLibraryService.use((service) =>
      service.editLibrary({
        edits: decodeLibraryEdits([
          { op: "create_collection", name: "Weihnachten", recipeIds: [zupfkuchenId] },
          { op: "add_to_collection", collection: "Ostern", recipeIds: [zupfkuchenId] },
        ]),
        by: claude,
      })
    ).pipe(Effect.provide(EditLibraryService.layer.pipe(Layer.provide(repository.layer))))))
    expect(problemsOf(result)).toEqual([{ edit: 2, message: 'no collection "Ostern"' }])
    expect(repository.state.library).toEqual(emptyLibrary)
    expect(repository.state.publishedEvents).toEqual([])
  })
})
