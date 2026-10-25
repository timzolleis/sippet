// The tools' handlers over one cook's Library (specs/mcp.md). Writes are one transaction each, keyed for retries by the connection.
import { Context, DateTime, Effect, Result } from "effect"
import { HttpServerRequest } from "effect/http"
import { EditLibraryService } from "../domain/library/edit-library-service.ts"
import { AddRecipeService } from "../domain/recipe/add-recipe-service.ts"
import { emptyRecipeContent } from "../domain/recipe/recipe-content.ts"
import { recipeContentFromEdits } from "../domain/recipe/recipe-content-from-edits.ts"
import { RestoreRecipeRevisionService } from "../domain/recipe/restore-recipe-revision-service.ts"
import { RestoreRecipesService } from "../domain/recipe/restore-recipes-service.ts"
import { ReviseRecipeService } from "../domain/recipe/revise-recipe-service.ts"
import { TrashRecipesService } from "../domain/recipe/trash-recipes-service.ts"
import type { ChangeAuthor } from "../domain/shared/change-author.ts"
import type { Library } from "../store/library.ts"
import { retryKey } from "../store/retry.ts"
import type { Json } from "../store/schema.ts"
import { cleanSource } from "../store/source.ts"
import { refuse, refusalFromError, type DomainError } from "./refusal.ts"
import { iso, libraryViewOf, recipeSummariesOf, recipeViewOf, revisionViewsOf } from "./recipe-view.ts"
import { searchQueryOf } from "./search.ts"
import { inTransaction, type Services } from "./unit-of-work.ts"
import { SippetToolkit } from "./tools.ts"
import type { Refusal } from "./schemas.ts"

// The Worker puts the connection id on every request (sippet-connection); headers are per request, not per session (hosting.md Verify 4).
const connectionOfRequest = Effect.gen(function* () {
  const request = Context.getOrUndefined(yield* Effect.context<never>(), HttpServerRequest.HttpServerRequest)
  const connection = request?.headers["sippet-connection"]
  if (connection === undefined) return yield* Effect.die("sippet-connection is missing: the Worker sets it")
  return connection
})

export const toolsLayer = (library: Library) => {
  const write = <A extends Json>({ tool, args, cleanedSource, latestRevisionOf, program }: {
    readonly tool: string
    readonly args: unknown
    readonly cleanedSource?: string | undefined
    // a refusal says where the recipe is now (mcp.md Refusals)
    readonly latestRevisionOf?: string
    readonly program: (by: ChangeAuthor) => Effect.Effect<A, DomainError, Services>
  }): Effect.Effect<A, Refusal> =>
    Effect.gen(function* () {
      const connection = yield* connectionOfRequest
      const retry = retryKey({ connection, tool, args })
      const done = yield* Effect.promise(() =>
        inTransaction({ library, retry, cleanedSource, program: program({ kind: "claude", connection }) })
      )
      if (Result.isSuccess(done)) return done.success
      const refusal = refusalFromError(done.failure)
      const latest = latestRevisionOf === undefined ? undefined : library.getRecipe(latestRevisionOf)?.latestRevision
      return yield* Effect.fail(latest === undefined || refusal.latestRevision !== undefined ? refusal : { ...refusal, latestRevision: latest })
    })

  const recipeViewById = (recipeId: string, revision?: number) => {
    const row = library.getRecipe(recipeId, revision)
    return row === undefined ? undefined : recipeViewOf({ library, row })
  }
  const viewAfterWrite = (recipeId: string) => {
    const view = recipeViewById(recipeId)
    if (view === undefined) throw new Error(`recipe ${recipeId} is missing after its write`)
    return view
  }

  return SippetToolkit.toLayer({
    search_recipes: (params) =>
      Effect.gen(function* () {
        const query = searchQueryOf({ library, params })
        if (Result.isFailure(query)) return yield* Effect.fail(query.failure)
        if (query.success === "empty") return { recipes: [] }
        const found = library.search(query.success)
        return { recipes: recipeSummariesOf({ library, hits: found.recipes }), ...(found.cursor === undefined ? {} : { cursor: found.cursor }) }
      }),

    get_recipe: ({ recipeId, revision }) =>
      Effect.gen(function* () {
        const view = recipeViewById(recipeId, revision)
        if (view !== undefined) return view
        const exists = library.getRecipe(recipeId) !== undefined
        return yield* Effect.fail(refuse({ message: exists ? `${JSON.stringify(recipeId)} has no revision ${revision}` : `no recipe ${JSON.stringify(recipeId)}` }))
      }),

    list_revisions: ({ recipeId }) =>
      Effect.gen(function* () {
        if (library.getRecipe(recipeId) === undefined) return yield* Effect.fail(refuse({ message: `no recipe ${JSON.stringify(recipeId)}` }))
        return { revisions: revisionViewsOf({ library, recipeId }) }
      }),

    get_library: () => Effect.sync(() => libraryViewOf(library)),

    list_trash: () =>
      Effect.sync(() => ({
        recipes: library.listTrash().map((trashed) => ({ id: trashed.id, title: trashed.title, trashedAt: iso(trashed.trashedAt), purgeAt: iso(trashed.purgeAt) })),
      })),

    add_recipe: ({ title, yield: recipeYield, source, edits }) =>
      Effect.gen(function* () {
        // A refused batch costs no fetch (hosting.md Source): the service refuses the same batch before it asks for the address.
        const batchOk = Result.isSuccess(recipeContentFromEdits({ content: emptyRecipeContent({ title, yield: recipeYield }), edits }))
        let cleanedSource: string | undefined
        if (source !== undefined && batchOk) {
          const cleaned = yield* Effect.promise(() => cleanSource({ source }))
          if (Result.isFailure(cleaned)) return yield* Effect.fail(refuse({ rule: "adding 4", message: `source ${JSON.stringify(source)} is not a web address` }))
          cleanedSource = cleaned.success.source
        }
        return yield* write({
          tool: "add_recipe",
          args: { title, yield: recipeYield, source, edits },
          cleanedSource,
          program: (by) =>
            Effect.gen(function* () {
              const added = yield* AddRecipeService
              const recipeId = yield* added.addRecipe({ title, yield: recipeYield, ...(source === undefined ? {} : { source }), edits, by })
              return { recipeId, revision: 1 as const, recipe: viewAfterWrite(recipeId) }
            }),
        })
      }),

    edit_recipe: ({ recipeId, fromRevision, edits }) =>
      write({
        tool: "edit_recipe",
        args: { recipeId, fromRevision, edits },
        latestRevisionOf: recipeId,
        program: (by) =>
          Effect.gen(function* () {
            const revised = yield* ReviseRecipeService
            const revision = yield* revised.reviseRecipe({ recipeId, fromRevision, edits, by })
            return { revision, recipe: viewAfterWrite(recipeId) }
          }),
      }),

    restore_revision: ({ recipeId, fromRevision, revision }) =>
      write({
        tool: "restore_revision",
        args: { recipeId, fromRevision, revision },
        latestRevisionOf: recipeId,
        program: (by) =>
          Effect.gen(function* () {
            const restored = yield* RestoreRecipeRevisionService
            const next = yield* restored.restoreRecipeRevision({ recipeId, fromRevision, revision, by })
            return { revision: next, recipe: viewAfterWrite(recipeId) }
          }),
      }),

    trash_recipes: ({ recipeIds }) =>
      write({
        tool: "trash_recipes",
        args: { recipeIds },
        program: (by) =>
          Effect.gen(function* () {
            const trash = yield* TrashRecipesService
            const trashed = yield* trash.trashRecipes({ recipeIds, by })
            return { trashed: trashed.map((entry) => ({ id: entry.recipeId, purgeAt: DateTime.formatIso(entry.purgeAt) })) }
          }),
      }),

    restore_recipes: ({ recipeIds }) =>
      write({
        tool: "restore_recipes",
        args: { recipeIds },
        program: (by) =>
          Effect.gen(function* () {
            const restore = yield* RestoreRecipesService
            yield* restore.restoreRecipes({ recipeIds, by })
            return { recipeIds: [...recipeIds] }
          }),
      }),

    edit_library: ({ edits }) =>
      write({
        tool: "edit_library",
        args: { edits },
        program: (by) =>
          Effect.gen(function* () {
            const edited = yield* EditLibraryService
            yield* edited.editLibrary({ edits, by })
            return libraryViewOf(library)
          }),
      }),
  })
}
