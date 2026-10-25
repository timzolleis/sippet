import { Data } from "effect"

// The rules a library refusal names (specs/mcp.md Rule names).
export type LibraryRuleName =
  | "unknown-recipe"
  | "trashed-recipes-leave-the-library"
  | "unknown-tag"
  | "unknown-collection"
  | "unknown-smart-collection"
  | "rename-to-a-free-name"
  | "merging"
  | "one-collection-per-name"
  | "reorder-names-everything"

// One edit that can't apply, 1-based: the rule, what's wrong, and how to fix it.
export type LibraryProblem = { readonly edit: number; readonly rule: LibraryRuleName; readonly message: string; readonly fix: string }

// Every problem at once; nothing changes (library rule 1).
export class LibraryRefusedError extends Data.TaggedError("LibraryRefusedError")<{
  readonly problems: ReadonlyArray<LibraryProblem>
}> {}
