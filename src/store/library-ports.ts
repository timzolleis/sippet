// The domain's library port over one transaction's Library and Writes.
import { Effect, Layer, Result, Schema } from "effect"
import { Library as LibraryShape } from "../domain/library/library.ts"
import { LibraryRepository } from "../domain/library/library-repository.ts"
import type { Library, Writes } from "./library.ts"

const decodeLibrary = Schema.decodeUnknownSync(LibraryShape)

export const libraryRepositoryLayer = ({ library, writes }: { readonly library: Library; readonly writes: Writes }) =>
  Layer.succeed(LibraryRepository, LibraryRepository.of({
    findLibrary: () => Effect.sync(() => decodeLibrary(library.readLibrary())),
    findRecipePlacesByIds: ({ recipeIds }) =>
      Effect.sync(() => {
        const places = library.placesOf(recipeIds)
        return new Map(recipeIds.flatMap((recipeId) => {
          const place = places.get(recipeId)
          return place === undefined ? [] : [[recipeId, place] as const]
        }))
      }),
    publishLibraryEvent: (event) =>
      Effect.sync(() => {
        const written = writes.applyLibraryChange({ library: event.library, edits: event.edits, by: event.by })
        if (Result.isFailure(written)) throw written.failure
      }),
  }))
