// One tool call is one transaction (specs/hosting.md#cooklibrary): the domain services run to completion inside `Library.transact`,
// over ports that read and write through that transaction. The clock is fixed to the transaction's time, so events and rows agree.
import { Clock, Effect, Layer, Result } from "effect"
import { EditLibraryService } from "../domain/library/edit-library-service.ts"
import { AddRecipeService } from "../domain/recipe/add-recipe-service.ts"
import { PurgeTrashedRecipesService } from "../domain/recipe/purge-trashed-recipes-service.ts"
import { RestoreRecipeRevisionService } from "../domain/recipe/restore-recipe-revision-service.ts"
import { RestoreRecipesService } from "../domain/recipe/restore-recipes-service.ts"
import { ReviseRecipeService } from "../domain/recipe/revise-recipe-service.ts"
import { TrashRecipesService } from "../domain/recipe/trash-recipes-service.ts"
import { libraryRepositoryLayer } from "../store/library-ports.ts"
import type { Library, Writes } from "../store/library.ts"
import { recipeRepositoryLayer, recipeSourcesLayer } from "../store/recipe-ports.ts"
import type { RetryKey } from "../store/retry.ts"
import type { Json } from "../store/schema.ts"

export type Services =
  | AddRecipeService
  | ReviseRecipeService
  | RestoreRecipeRevisionService
  | TrashRecipesService
  | RestoreRecipesService
  | PurgeTrashedRecipesService
  | EditLibraryService

const servicesLayer = Layer.mergeAll(
  AddRecipeService.layer,
  ReviseRecipeService.layer,
  RestoreRecipeRevisionService.layer,
  TrashRecipesService.layer,
  RestoreRecipesService.layer,
  PurgeTrashedRecipesService.layer,
  EditLibraryService.layer,
)

const fixedClock = ({ clock, now }: { readonly clock: Clock.Clock; readonly now: number }): Clock.Clock =>
  Object.create(clock, {
    currentTimeMillisUnsafe: { value: () => now },
    currentTimeMillis: { value: Effect.succeed(now) },
    currentTimeNanosUnsafe: { value: () => BigInt(now) * 1_000_000n },
    currentTimeNanos: { value: Effect.succeed(BigInt(now) * 1_000_000n) },
  })

// A typed failure rolls the transaction back and comes out as a Result; a defect rolls back and throws.
export const inTransaction = <A extends Json, E>({ library, retry, cleanedSource, program }: {
  readonly library: Library
  readonly retry?: RetryKey | undefined
  // the source address, cleaned before the transaction because that can fetch
  readonly cleanedSource?: string | undefined
  readonly program: Effect.Effect<A, E, Services>
}): Promise<Result.Result<A, E>> =>
  library.transact({
    retry,
    run: (writes: Writes) => {
      const ports = Layer.mergeAll(recipeRepositoryLayer({ library, writes }), libraryRepositoryLayer({ library, writes }), recipeSourcesLayer(cleanedSource))
      const run = Effect.clockWith((clock) =>
        program.pipe(
          Effect.provide(servicesLayer.pipe(Layer.provideMerge(ports))),
          Effect.provideService(Clock.Clock, fixedClock({ clock, now: writes.now })),
          Effect.result,
        )
      )
      return Effect.runSync(run)
    },
  })

// The alarm (revising rules 7, 9): the trash empties itself of every recipe due, then the next alarm is set.
export const purgeDueRecipes = async (library: Library): Promise<void> => {
  const purged = await inTransaction({
    library,
    program: Effect.gen(function* () {
      const purge = yield* PurgeTrashedRecipesService
      yield* purge.purgeTrashedRecipes()
      return null
    }),
  })
  if (Result.isFailure(purged)) throw purged.failure
  await library.scheduleAlarm()
}
