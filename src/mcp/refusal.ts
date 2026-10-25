// A refused write or an unknown id, as the tool result Claude reads (specs/mcp.md Refusals, Rule names).
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
import { withOptional } from "../domain/with-optional.ts"
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

export const refuse = ({ rule, message, fix, latestRevision }: {
  readonly rule: string
  readonly message: string
  readonly fix: string
  readonly latestRevision?: number
}): Refusal => withOptional({ refused: true as const, problems: [{ rule, message, fix }] }, "latestRevision", latestRevision)

export const unknownRecipe = (recipeId: string): Refusal =>
  refuse({ rule: "unknown-recipe", message: `no recipe ${quoted(recipeId)}`, fix: "use an id from search_recipes or list_trash" })

export const unknownRevision = ({ recipeId, revision }: { readonly recipeId: string; readonly revision: number }): Refusal =>
  refuse({ rule: "unknown-revision", message: `${quoted(recipeId)} has no revision ${revision}`, fix: "pick one list_revisions lists" })

export const refusalFromError = (error: DomainError): Refusal =>
  Match.valueTags(error, {
    RecipeRefusedError: ({ problems }) => ({ refused: true as const, problems }),
    LibraryRefusedError: ({ problems }) => ({ refused: true as const, problems }),
    RecipeRevisedSinceError: ({ recipeId, fromRevision, latestRevision }) =>
      refuse({
        rule: "revise-what-you-saw",
        message: `${quoted(recipeId)} is at revision ${latestRevision}, not ${fromRevision}`,
        fix: "read it with get_recipe and rebuild the batch on what you read",
        latestRevision,
      }),
    RecipeNotFoundError: ({ recipeId }) => unknownRecipe(recipeId),
    RecipesNotFoundError: ({ recipeIds }) =>
      refuse({
        rule: "several-at-once",
        message: `no recipe ${recipeIds.map(quoted).join(", ")}; nothing changed`,
        fix: "leave out the unknown ids and send the rest again",
      }),
    RecipeAlreadyTrashedError: ({ recipeId }) =>
      refuse({ rule: "not-in-the-trash", message: `${quoted(recipeId)} is in the trash`, fix: `restore_recipes ${quoted(recipeId)} first` }),
    RecipeRevisionNotFoundError: ({ recipeId, revision }) => unknownRevision({ recipeId, revision }),
    RecipeSourceAlreadyAddedError: ({ recipeId, title, trashed }) =>
      refuse({
        rule: "one-recipe-per-page",
        message: `this page is already added as ${quoted(title)} (${recipeId})${trashed ? ", in the trash" : ""}`,
        fix: trashed
          ? `restore_recipes ${quoted(recipeId)} to bring it back, then edit_recipe it if needed`
          : `read ${quoted(recipeId)} with get_recipe, and edit_recipe it if needed`,
      }),
  })
