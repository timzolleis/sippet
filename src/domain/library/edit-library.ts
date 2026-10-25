import { type DateTime, Result } from "effect"
import type { RecipeId } from "../recipe/recipe-id.ts"
import type { ChangeAuthor } from "../shared/change-author.ts"
import { applyLibraryEdits } from "./apply-library-edits.ts"
import type { Library, RecipePlace } from "./library.ts"
import type { LibraryEdit } from "./library-edit.ts"
import { LibraryRefusedError } from "./library-error.ts"
import { LibraryChangedEvent } from "./library-event.ts"

export type EditLibraryInput = {
  readonly library: Library
  readonly edits: ReadonlyArray<LibraryEdit>
  // every recipe the edits name or the library holds; absent: doesn't exist or purged
  readonly recipePlaces: ReadonlyMap<RecipeId, RecipePlace>
  readonly by: ChangeAuthor
  readonly now: DateTime.Utc
}

// A batch of edits, applied whole as one change or refused with every problem (library rules 1, 2).
export const editLibrary = ({ library, edits, recipePlaces, by, now }: EditLibraryInput): Result.Result<LibraryChangedEvent, LibraryRefusedError> => {
  const edited = applyLibraryEdits({ library, recipePlaces, edits })

  return edited.problems.length > 0
    ? Result.fail(new LibraryRefusedError({ problems: edited.problems }))
    : Result.succeed(LibraryChangedEvent.make({ library: edited.library, edits, by, occurredOn: now }))
}

// The recipes an edit names, plus every recipe the library holds (reordering must know which are trashed).
export const recipeIdsOfLibraryEdits = ({ library, edits }: {
  readonly library: Library; readonly edits: ReadonlyArray<LibraryEdit>
}): ReadonlyArray<RecipeId> => [...new Set([
  ...library.tags.flatMap((tag) => tag.recipeIds),
  ...library.collections.flatMap((collection) => collection.recipeIds),
  ...edits.flatMap((edit) => "recipeIds" in edit ? edit.recipeIds ?? [] : []),
])]
