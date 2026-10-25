// A refused write or an unknown id, as the tool result Claude reads (specs/mcp.md Refusals).
import { Match } from "effect"
import type { LibraryRefusedError } from "../domain/library/library-error.ts"
import type {
  RecipeAlreadyTrashedError,
  RecipeNotFoundError,
  RecipeRefusedError,
  RecipeRevisedSinceError,
  RecipeRevisionNotFoundError,
  RecipeSourceAlreadyAddedError,
  RecipesNotFoundError,
} from "../domain/recipe/recipe-error.ts"
import type { Refusal } from "./schemas.ts"

export type DomainError =
  | RecipeRefusedError
  | RecipeRevisedSinceError
  | RecipeNotFoundError
  | RecipesNotFoundError
  | RecipeAlreadyTrashedError
  | RecipeRevisionNotFoundError
  | RecipeSourceAlreadyAddedError
  | LibraryRefusedError

const quoted = (id: string) => `"${id}"`

export const refuse = ({ message, rule, latestRevision }: { readonly message: string; readonly rule?: string; readonly latestRevision?: number }): Refusal => ({
  refused: true,
  problems: [{ ...(rule === undefined ? {} : { rule }), message }],
  ...(latestRevision === undefined ? {} : { latestRevision }),
})

export const refusalFromError = (error: DomainError): Refusal =>
  Match.valueTags(error, {
    RecipeRefusedError: ({ problems }) => ({ refused: true as const, problems }),
    LibraryRefusedError: ({ problems }) => ({ refused: true as const, problems }),
    RecipeRevisedSinceError: ({ recipeId, fromRevision, latestRevision }) =>
      refuse({
        rule: "revising 2",
        message: `${quoted(recipeId)} is at revision ${latestRevision}, not ${fromRevision}: read it with get_recipe and rebuild the batch`,
        latestRevision,
      }),
    RecipeNotFoundError: ({ recipeId }) => refuse({ message: `no recipe ${quoted(recipeId)}` }),
    RecipesNotFoundError: ({ recipeIds }) => refuse({ rule: "revising 10", message: `no recipe ${recipeIds.map(quoted).join(", ")}; nothing changed` }),
    RecipeAlreadyTrashedError: ({ recipeId }) => refuse({ rule: "revising 4", message: `${quoted(recipeId)} is in the trash; restore it first` }),
    RecipeRevisionNotFoundError: ({ recipeId, revision }) => refuse({ message: `${quoted(recipeId)} has no revision ${revision}` }),
    RecipeSourceAlreadyAddedError: ({ recipeId, title, trashed }) =>
      refuse({ rule: "adding 6", message: `this page is already added as ${quoted(title)} (${recipeId})${trashed ? ", in the trash" : ""}` }),
  })
