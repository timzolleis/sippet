import { Schema } from "effect"
import { ChangeAuthor } from "../shared/change-author.ts"
import { Library } from "./library.ts"
import { LibraryEdit } from "./library-edit.ts"

// One change in the cook's sequence (library rule 2): the library after the batch, and the batch.
export const LibraryChangedEvent = Schema.TaggedStruct("LibraryChangedEvent", {
  library: Library,
  edits: Schema.Array(LibraryEdit),
  by: ChangeAuthor,
  occurredOn: Schema.DateTimeUtc,
})
export type LibraryChangedEvent = typeof LibraryChangedEvent.Type
