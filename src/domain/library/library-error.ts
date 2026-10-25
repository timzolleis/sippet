import { Data } from "effect"

// One edit that can't apply, 1-based.
export type LibraryProblem = { readonly edit: number; readonly message: string }

// Every problem at once; nothing changes (library rule 1).
export class LibraryRefusedError extends Data.TaggedError("LibraryRefusedError")<{
  readonly problems: ReadonlyArray<LibraryProblem>
}> {}
