import { Context, DateTime, Effect, Layer } from "effect"
import type { ChangeAuthor } from "../shared/change-author.ts"
import { editLibrary, recipeIdsOfLibraryEdits } from "./edit-library.ts"
import type { LibraryEdit } from "./library-edit.ts"
import type { LibraryRefusedError } from "./library-error.ts"
import { LibraryRepository } from "./library-repository.ts"

export type EditLibraryCommand = { readonly edits: ReadonlyArray<LibraryEdit>; readonly by: ChangeAuthor }

export class EditLibraryService extends Context.Service<EditLibraryService, {
  editLibrary(command: EditLibraryCommand): Effect.Effect<void, LibraryRefusedError>
}>()("EditLibraryService") {
  static layer = Layer.effect(EditLibraryService, Effect.gen(function* () {
    const libraryRepository = yield* LibraryRepository

    return EditLibraryService.of({
      editLibrary: Effect.fn("EditLibraryService.editLibrary")(function* ({ edits, by }) {
        const now = yield* DateTime.now
        const library = yield* libraryRepository.findLibrary()
        const recipePlaces = yield* libraryRepository.findRecipePlacesByIds({ recipeIds: recipeIdsOfLibraryEdits({ library, edits }) })
        const event = yield* Effect.fromResult(editLibrary({ library, edits, recipePlaces, by, now }))
        yield* libraryRepository.publishLibraryEvent(event)
      }),
    })
  }))
}
