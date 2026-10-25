// What the app reads (specs/device-api.md Views): the whole library, and the changes since a seq. Each read is one synchronous pass over SQLite.
import { Context, Data, Effect, Layer, Match, Option, pipe, Schema } from "effect"
import { RecipeFilter } from "../domain/library/recipe-filter.ts"
import { Equipment, Ingredient, RecipeContent, Section, Step, Yield } from "../domain/recipe/recipe-content.ts"
import { recipeFlowFromContent, recipeHasFlow } from "../domain/recipe/recipe-flow.ts"
import { Key } from "../domain/recipe/key.ts"
import { withOptional } from "../domain/with-optional.ts"
import { stepsWithFlow } from "../mcp/recipe-view.ts"
import type { Library, RecipeRow, StoredRevision } from "../store/library.ts"
import type { Actor, Json } from "../store/schema.ts"

const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

export const DeviceStep = Schema.Struct({
  ...Step.fields,
  flow: Schema.optionalKey(Schema.Struct({ takes: Schema.Array(Key), waitsFor: Schema.Array(Key), makes: Schema.Boolean })),
})

// The latest revision as written, with its flow. Tags and collections come from LibraryOrganization: a library edit changes them without a revision.
export const DeviceRecipe = Schema.Struct({
  id: Schema.String,
  revision: Revision,
  title: Schema.String,
  yield: Yield,
  source: Schema.optionalKey(Schema.String),
  trashedAt: Schema.optionalKey(Schema.String),
  purgeAt: Schema.optionalKey(Schema.String),
  totalMinutes: Schema.optionalKey(Schema.Finite),
  sections: Schema.Array(Section),
  equipment: Schema.Array(Equipment),
  ingredients: Schema.Array(Ingredient),
  steps: Schema.Array(DeviceStep),
  hasFlow: Schema.Boolean,
  makes: Schema.Array(Key),
})

export type DeviceRecipe = typeof DeviceRecipe.Type

const Members = Schema.Struct({ name: Schema.String, recipeIds: Schema.Array(Schema.String) })

export const LibraryOrganization = Schema.Struct({
  tags: Schema.Array(Members),
  collections: Schema.Array(Members),
  smartCollections: Schema.Array(Schema.Struct({ name: Schema.String, filter: RecipeFilter })),
})

export type LibraryOrganization = typeof LibraryOrganization.Type

export const LibraryAtChange = Schema.Struct({
  seq: Schema.Int,
  recipes: Schema.Array(DeviceRecipe),
  ...LibraryOrganization.fields,
})

export type LibraryAtChange = typeof LibraryAtChange.Type

export const ChangeKind = Schema.Literals(["recipe_added", "recipe_revised", "recipes_trashed", "recipes_restored", "recipes_purged", "library_changed"])

export const ChangeView = Schema.Struct({
  seq: Schema.Int,
  at: Schema.String,
  by: Schema.Struct({ kind: Schema.Literals(["claude", "device", "trash"]), name: Schema.String }),
  kind: ChangeKind,
  recipeIds: Schema.Array(Schema.String),
})

export type ChangeView = typeof ChangeView.Type

export const ChangesAfter = Schema.Struct({
  seq: Schema.Int,
  changes: Schema.Array(ChangeView),
  recipes: Schema.Array(DeviceRecipe),
  purgedRecipeIds: Schema.Array(Schema.String),
  ...LibraryOrganization.fields,
})

export type ChangesAfter = typeof ChangesAfter.Type

// The device is ahead of the log: it asks after a change this library never had (sync rule 6).
export class ChangesNotReachedError extends Data.TaggedError("ChangesNotReachedError")<{ readonly after: number; readonly seq: number }> {}

const newestChanges = 100

const decodeKind = Schema.decodeUnknownSync(ChangeKind)
const decodeContent = Schema.decodeUnknownSync(RecipeContent)
const decodeFilter = Schema.decodeUnknownSync(RecipeFilter)

const iso = (millis: number): string => new Date(millis).toISOString()

export const deviceRecipeOf = (row: RecipeRow & StoredRevision): DeviceRecipe => {
  const content = decodeContent(row.content)
  const flow = recipeFlowFromContent(content)

  const view: DeviceRecipe = {
    id: row.id,
    revision: row.revision,
    title: content.title,
    yield: content.yield,
    sections: content.sections,
    equipment: content.equipment,
    ingredients: content.ingredients,
    steps: stepsWithFlow({ content, flow }),
    hasFlow: recipeHasFlow(content),
    makes: Option.match(flow, { onNone: () => [], onSome: (found) => found.makes }),
  }

  return pipe(
    view,
    (base) => withOptional(base, "source", row.source ?? undefined),
    (base) => withOptional(base, "trashedAt", row.trashedAt === null ? undefined : iso(row.trashedAt)),
    (base) => withOptional(base, "purgeAt", row.purgeAt === null ? undefined : iso(row.purgeAt)),
    (base) => withOptional(base, "totalMinutes", row.totalMinutes ?? undefined),
  )
}

const idsFrom = <A>(schema: Schema.Decoder<A>, pick: (payload: A) => ReadonlyArray<string>) => (payload: Json): ReadonlyArray<string> =>
  Option.match(Schema.decodeUnknownOption(schema)(payload), { onNone: () => [], onSome: pick })

const Ids = Schema.Array(Schema.String)

// The recipes a change names: added/revised one, trashed/restored/purged theirs, library_changed the ids its edits name.
const recipeIdsOfPayload = {
  recipe_added: idsFrom(Schema.Struct({ recipeId: Schema.String }), ({ recipeId }) => [recipeId]),
  recipe_revised: idsFrom(Schema.Struct({ recipeId: Schema.String }), ({ recipeId }) => [recipeId]),
  recipes_trashed: idsFrom(Schema.Struct({ recipes: Schema.Array(Schema.Struct({ id: Schema.String })) }), ({ recipes }) => recipes.map(({ id }) => id)),
  recipes_restored: idsFrom(Schema.Struct({ recipeIds: Ids }), ({ recipeIds }) => recipeIds),
  recipes_purged: idsFrom(Schema.Struct({ recipeIds: Ids }), ({ recipeIds }) => recipeIds),
  library_changed: idsFrom(
    Schema.Struct({ edits: Schema.Array(Schema.Struct({ recipeIds: Schema.optionalKey(Ids) })) }),
    ({ edits }) => [...new Set(edits.flatMap((edit) => edit.recipeIds ?? []))],
  ),
} satisfies Record<ChangeView["kind"], (payload: Json) => ReadonlyArray<string>>

export class DeviceViews extends Context.Service<DeviceViews, {
  getLibrary(): Effect.Effect<LibraryAtChange>
  getOrganization(): Effect.Effect<LibraryOrganization>
  // the named recipes at their latest revision, in the order named; an unknown id is left out
  getRecipes(input: { readonly recipeIds: ReadonlyArray<string> }): Effect.Effect<ReadonlyArray<DeviceRecipe>>
  listChangesAfter(input: { readonly after: number }): Effect.Effect<ChangesAfter, ChangesNotReachedError>
}>()("DeviceViews") {}

export const deviceViewsLayer = (library: Library) => {
  const organization = (): LibraryOrganization => {
    const snapshot = library.readLibrary()

    return {
      tags: snapshot.tags,
      collections: snapshot.collections,
      smartCollections: snapshot.smartCollections.map((smart) => ({ name: smart.name, filter: decodeFilter(smart.filter) })),
    }
  }

  const authorOf = (names: ReadonlyMap<string, string>) => (actor: Actor): ChangeView["by"] =>
    Match.value(actor).pipe(Match.discriminatorsExhaustive("kind")({
      claude: ({ connection }) => ({ kind: "claude" as const, name: names.get(connection) ?? "Claude" }),
      device: ({ device }) => ({ kind: "device" as const, name: device }),
      trash: () => ({ kind: "trash" as const, name: "Trash" }),
    }))

  return Layer.succeed(DeviceViews, DeviceViews.of({
    getLibrary: () => Effect.sync(() => ({ seq: library.lastSeq(), recipes: library.listRecipes().map(deviceRecipeOf), ...organization() })),

    getOrganization: () => Effect.sync(organization),

    getRecipes: ({ recipeIds }) =>
      Effect.sync(() => {
        const found = new Map(library.getRecipes(recipeIds).map((row) => [row.id, deviceRecipeOf(row)]))

        return recipeIds.flatMap((id) => {
          const recipe = found.get(id)

          return recipe === undefined ? [] : [recipe]
        })
      }),

    listChangesAfter: ({ after }) =>
      Effect.gen(function* () {
        const seq = library.lastSeq()

        if (after > seq) return yield* new ChangesNotReachedError({ after, seq })

        const all = library.changesAfter(after)
        const names = authorOf(library.connectionNames())

        const named = all.map((row) => {
          const kind = decodeKind(row.kind)

          return { seq: row.seq, at: iso(row.at), by: names(row.by), kind, recipeIds: recipeIdsOfPayload[kind](row.payload) }
        })

        const changes = named.slice(-newestChanges)
        // Library changes touch no recipe's content; the organization is always whole.
        const touched = [...new Set(named.filter((row) => row.kind !== "library_changed").flatMap((row) => row.recipeIds))]
        const recipes = library.getRecipes(touched).map(deviceRecipeOf)
        const purgedRecipeIds = [...new Set(named.filter((row) => row.kind === "recipes_purged").flatMap((row) => row.recipeIds))]

        return { seq, changes, recipes, purgedRecipeIds, ...organization() }
      }),
  }))
}
