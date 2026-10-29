// One use case is one transaction (specs/hosting.md Unit of work): the domain services run inside `Library.transact`,
// over ports that read and write through that transaction. The clock is fixed to the transaction's time, so events and rows agree.
import type { RuntimeContext } from "alchemy"
import { Clock, Effect, Layer } from "effect"
import { EditLibraryService } from "../domain/library/edit-library-service.ts"
import { AddRecipeService } from "../domain/recipe/add-recipe-service.ts"
import { PurgeTrashedRecipesService } from "../domain/recipe/purge-trashed-recipes-service.ts"
import { RestoreRecipeRevisionService } from "../domain/recipe/restore-recipe-revision-service.ts"
import { RestoreRecipesService } from "../domain/recipe/restore-recipes-service.ts"
import { ReviseRecipeService } from "../domain/recipe/revise-recipe-service.ts"
import { TrashRecipesService } from "../domain/recipe/trash-recipes-service.ts"
import { libraryRepositoryLayer } from "./library-ports.ts"
import type { Library, Writes } from "./library.ts"
import { recipeRepositoryLayer, recipeSourcesLayer } from "./recipe-ports.ts"
import type { RetryKey } from "./retry.ts"
import type { Json } from "./schema.ts"

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

// A typed failure or a defect rolls the transaction back and comes out of the Effect as it is.
export const inTransaction = <A extends Json, E>({ library, retry, dryRun, reschedulePurge, cleanedSource, program }: {
  readonly library: Library
  readonly retry?: RetryKey | undefined
  readonly reschedulePurge?: boolean | undefined
  // run every check and the view, then roll back
  readonly dryRun?: boolean | undefined
  // the source address, cleaned before the transaction because that can fetch
  readonly cleanedSource?: string | undefined
  readonly program: Effect.Effect<A, E, Services>
}): Effect.Effect<A, E, RuntimeContext> =>
  library.transact({
    retry,
    dryRun,
    reschedulePurge,
    program: (writes: Writes) =>
      Effect.clockWith((clock) =>
        program.pipe(
          Effect.provide(servicesLayer.pipe(
            Layer.provideMerge(Layer.mergeAll(recipeRepositoryLayer({ library, writes }), libraryRepositoryLayer({ library, writes }), recipeSourcesLayer(cleanedSource))),
          )),
          Effect.provideService(Clock.Clock, fixedClock({ clock, now: writes.now })),
        )
      ),
  })

// The purge job (revising rules 7, 9): every recipe due leaves the trash; the transaction reschedules the job for the next.
export const purgeDueRecipes = (library: Library): Effect.Effect<void, never, RuntimeContext> =>
  inTransaction({
    library,
    reschedulePurge: true,
    program: Effect.gen(function* () {
      const purge = yield* PurgeTrashedRecipesService
      yield* purge.purgeTrashedRecipes()

      return null
    }),
  })
