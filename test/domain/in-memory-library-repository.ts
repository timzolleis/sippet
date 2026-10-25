import { Effect, Layer } from "effect"
import type { Library, RecipePlace } from "../../src/domain/library/library.ts"
import type { LibraryChangedEvent } from "../../src/domain/library/library-event.ts"
import { LibraryRepository } from "../../src/domain/library/library-repository.ts"
import type { RecipeId } from "../../src/domain/recipe/recipe-id.ts"

// The LibraryRepository port over plain values; a published change replaces the library.
export const makeInMemoryLibraryRepository = ({ library, recipePlaces }: {
  readonly library: Library; readonly recipePlaces: ReadonlyMap<RecipeId, RecipePlace>
}) => {
  const publishedEvents: Array<LibraryChangedEvent> = []
  const state = { library, publishedEvents }

  const layer = Layer.succeed(LibraryRepository, LibraryRepository.of({
    findLibrary: () => Effect.sync(() => state.library),
    findRecipePlacesByIds: ({ recipeIds }) =>
      Effect.sync(() => new Map(recipeIds.flatMap((recipeId) => {
        const place = recipePlaces.get(recipeId)

        return place === undefined ? [] : [[recipeId, place] as const]
      }))),
    publishLibraryEvent: (event) =>
      Effect.sync(() => {
        state.library = event.library
        state.publishedEvents.push(event)
      }),
  }))

  return { state, layer }
}
