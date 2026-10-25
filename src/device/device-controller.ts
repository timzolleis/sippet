// The device endpoints: middleware → view or use case → error mapping (specs/device-api.md Commands).
import { Effect, Result } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { EditLibraryService } from "../domain/library/edit-library-service.ts"
import { RestoreRecipesService } from "../domain/recipe/restore-recipes-service.ts"
import { TrashRecipesService } from "../domain/recipe/trash-recipes-service.ts"
import { inTransaction } from "../mcp/unit-of-work.ts"
import type { Library } from "../store/library.ts"
import { retryKey } from "../store/retry.ts"
import { DeviceApi, DeviceHttpApi } from "./device-api.ts"
import {
  changesNotReachedHttpErrorFromChangesNotReachedError,
  libraryEditsRefusedHttpErrorFromLibraryRefusedError,
  recipesNotFoundHttpErrorFromRecipesNotFoundError,
} from "./device-http-errors.ts"
import { CurrentDevice } from "./device-middleware.ts"
import { DeviceViews } from "./device-views.ts"

export const deviceControllerLayer = (library: Library) =>
  HttpApiBuilder.group(DeviceHttpApi, "device", (handlers) => Effect.gen(function* () {
    const views = yield* DeviceViews

    // Retries are per device: the key's connection is `<client id>/<device id>` (mcp.md Retries).
    const retryOf = ({ tool, args }: { readonly tool: string; readonly args: Parameters<typeof retryKey>[0]["args"] }) =>
      Effect.gen(function* () {
        const device = yield* CurrentDevice

        return {
          retry: retryKey({ connection: `${device.connection}/${device.deviceId}`, tool, args }),
          by: { kind: "device" as const, device: device.deviceName },
        }
      })

    return handlers.handleAll({
      getLibrary: () => views.getLibrary(),

      listChangesAfter: ({ query }) =>
        views.listChangesAfter({ after: query.after }).pipe(Effect.mapError(changesNotReachedHttpErrorFromChangesNotReachedError)),

      editLibrary: ({ payload }) =>
        Effect.gen(function* () {
          const { retry, by } = yield* retryOf({ tool: "editLibrary", args: { edits: payload.edits } })

          const done = yield* Effect.promise(() =>
            inTransaction({
              library,
              retry,
              program: Effect.gen(function* () {
                const edited = yield* EditLibraryService
                yield* edited.editLibrary({ edits: payload.edits, by })

                return {}
              }),
            })
          )

          if (Result.isFailure(done)) return yield* libraryEditsRefusedHttpErrorFromLibraryRefusedError(done.failure)

          return yield* views.getOrganization()
        }),

      trashRecipes: ({ payload }) =>
        Effect.gen(function* () {
          const { retry, by } = yield* retryOf({ tool: "trashRecipes", args: { recipeIds: payload.recipeIds } })

          const done = yield* Effect.promise(() =>
            inTransaction({
              library,
              retry,
              program: Effect.gen(function* () {
                const trash = yield* TrashRecipesService
                yield* trash.trashRecipes({ recipeIds: payload.recipeIds, by })

                return { recipeIds: [...payload.recipeIds] }
              }),
            })
          )

          if (Result.isFailure(done)) return yield* recipesNotFoundHttpErrorFromRecipesNotFoundError(done.failure)

          return { recipes: yield* views.getRecipes({ recipeIds: payload.recipeIds }) }
        }),

      restoreRecipes: ({ payload }) =>
        Effect.gen(function* () {
          const { retry, by } = yield* retryOf({ tool: "restoreRecipes", args: { recipeIds: payload.recipeIds } })

          const done = yield* Effect.promise(() =>
            inTransaction({
              library,
              retry,
              program: Effect.gen(function* () {
                const restore = yield* RestoreRecipesService
                yield* restore.restoreRecipes({ recipeIds: payload.recipeIds, by })

                return { recipeIds: [...payload.recipeIds] }
              }),
            })
          )

          if (Result.isFailure(done)) return yield* recipesNotFoundHttpErrorFromRecipesNotFoundError(done.failure)

          return { recipes: yield* views.getRecipes({ recipeIds: payload.recipeIds }) }
        }),
    })
  }))

export { DeviceApi }
