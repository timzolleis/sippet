// The eleven tools (specs/mcp.md Tools). Reads are readOnly; writes are not destructive: everything Claude does is undoable (account rule 6).
// An array can't be a tool's structured result (MCP wants an object), so list results are wrapped: `revisions`, `recipes`, `trashed`.
import { Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import { LibraryEdit } from "../domain/library/library-edit.ts"
import { TagFilter } from "../domain/library/recipe-filter.ts"
import { RecipeId } from "../domain/recipe/recipe-id.ts"
import { Yield } from "../domain/recipe/recipe-content.ts"
import { RecipeEdit } from "../domain/recipe/recipe-edit.ts"
import { LibraryView, RecipeSummary, RecipeView, Refusal, RevisionView } from "./schemas.ts"

const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const Names = Schema.Array(Schema.String)

type Config = {
  readonly parameters: Schema.Constraint
  readonly success: Schema.Constraint
  readonly failure: Schema.Constraint
  readonly failureMode: Tool.FailureMode
}

const read = <const Name extends string, C extends Config>(tool: Tool.Tool<Name, C>) =>
  tool.annotate(Tool.Readonly, true).annotate(Tool.OpenWorld, false)

const write = <const Name extends string, C extends Config>(tool: Tool.Tool<Name, C>) =>
  tool.annotate(Tool.Destructive, false).annotate(Tool.OpenWorld, false)

const editsNote =
  "Edits are applied in order and checked once at the end; keys may point at things added later in the batch. " +
  "`edit_*` change only the fields they name, and `null` clears an optional field. `at` defaults to \"end\"."

export const SearchRecipes = read(Tool.make("search_recipes", {
  description:
    "Search the cook's recipes. `text` matches title, ingredients, and steps (substring, ignoring case and accents). " +
    "The filters combine: tags, items used, longest total time, whether the recipe has a flow, a collection (returns its order), " +
    "a smart collection (its saved filter). Without `text` or `collection`, by title. Recipes in the trash never appear. " +
    "Pages of `limit` (20, max 100); pass the returned `cursor` for the next page.",
  parameters: Schema.Struct({
    text: Schema.optionalKey(Schema.String),
    tags: Schema.optionalKey(TagFilter),
    items: Schema.optionalKey(Names),
    maxTotalMinutes: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
    hasFlow: Schema.optionalKey(Schema.Boolean),
    collection: Schema.optionalKey(Schema.String),
    smartCollection: Schema.optionalKey(Schema.String),
    limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
    cursor: Schema.optionalKey(Schema.String),
  }),
  success: Schema.Struct({ recipes: Schema.Array(RecipeSummary), cursor: Schema.optionalKey(Schema.String) }),
  failure: Refusal,
}))

export const GetRecipe = read(Tool.make("get_recipe", {
  description:
    "Read a recipe as written, with the flow derived from its steps. Without `revision`, the latest; a recipe in the trash can be read. " +
    "Pass the returned `latestRevision` as `fromRevision` when you edit.",
  parameters: Schema.Struct({ recipeId: RecipeId, revision: Schema.optionalKey(Revision) }),
  success: RecipeView,
  failure: Refusal,
}))

export const ListRevisions = read(Tool.make("list_revisions", {
  description: "Every revision of a recipe, newest first: when, who, and what changed (the edits, or the revision restored).",
  parameters: Schema.Struct({ recipeId: RecipeId }),
  success: Schema.Struct({ revisions: Schema.Array(RevisionView) }),
  failure: Refusal,
}))

export const GetLibrary = read(Tool.make("get_library", {
  description: "The cook's tags and collections with their recipe counts (the trash left out), and the smart collections with their filters.",
  success: LibraryView,
  failure: Refusal,
}))

export const ListTrash = read(Tool.make("list_trash", {
  description: "The recipes in the trash, with the time each is emptied for good.",
  success: Schema.Struct({
    recipes: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String, trashedAt: Schema.String, purgeAt: Schema.String })),
  }),
  failure: Refusal,
}))

export const AddRecipe = write(Tool.make("add_recipe", {
  description:
    "Add a recipe: a title, a yield, and a batch of recipe edits applied to an empty recipe. " +
    `${editsNote} Refused whole, with every problem, if an edit can't apply or the result breaks a recipe rule. ` +
    "`source` is the page the recipe came from; a page already in the library (the trash too) isn't added again. " +
    "Returns the recipe with its derived flow: check it.",
  parameters: Schema.Struct({
    title: Schema.NonEmptyString,
    yield: Yield,
    source: Schema.optionalKey(Schema.String),
    edits: Schema.Array(RecipeEdit),
  }),
  success: Schema.Struct({ recipeId: Schema.String, revision: Schema.Literal(1), recipe: RecipeView }),
  failure: Refusal,
}))

export const EditRecipe = write(Tool.make("edit_recipe", {
  description:
    "Revise a recipe with a batch of recipe edits to the revision you read (`fromRevision`). " +
    `${editsNote} Refused whole, with every problem, if an edit can't apply or the result breaks a recipe rule; ` +
    "refused with `latestRevision` if someone saved a newer revision: read it with get_recipe and rebuild the batch. " +
    "A recipe in the trash can't be edited. Returns the recipe with its derived flow: check it.",
  parameters: Schema.Struct({ recipeId: RecipeId, fromRevision: Revision, edits: Schema.Array(RecipeEdit) }),
  success: Schema.Struct({ revision: Revision, recipe: RecipeView }),
  failure: Refusal,
}))

export const RestoreRevision = write(Tool.make("restore_revision", {
  description:
    "Make an earlier revision's content the next revision (nothing is removed). `fromRevision` is the latest revision you read; " +
    "`revision` is the one to bring back.",
  parameters: Schema.Struct({ recipeId: RecipeId, fromRevision: Revision, revision: Revision }),
  success: Schema.Struct({ revision: Revision, recipe: RecipeView }),
  failure: Refusal,
}))

export const TrashRecipes = write(Tool.make("trash_recipes", {
  description:
    "Move recipes to the trash, all or nothing: an unknown recipe refuses all. They leave the library, collections, and search, " +
    "and keep their tags and collection places. The cook can restore them for 30 days; one already in the trash keeps its date.",
  parameters: Schema.Struct({ recipeIds: Schema.Array(RecipeId) }),
  success: Schema.Struct({ trashed: Schema.Array(Schema.Struct({ id: Schema.String, purgeAt: Schema.String })) }),
  failure: Refusal,
}))

export const RestoreRecipes = write(Tool.make("restore_recipes", {
  description:
    "Bring recipes back from the trash, all or nothing, with their tags and at their old places in collections. " +
    "One that isn't in the trash stays as it is.",
  parameters: Schema.Struct({ recipeIds: Schema.Array(RecipeId) }),
  success: Schema.Struct({ recipeIds: Schema.Array(Schema.String) }),
  failure: Refusal,
}))

export const EditLibrary = write(Tool.make("edit_library", {
  description:
    "Change tags, collections, and smart collections with a batch of edits, applied in order (each sees the ones before) and all or nothing. " +
    "Recipes are named by id, tags and collections by name ignoring case. Tagging with a new name creates the tag. " +
    "`reorder_collection` names every recipe in the collection, each once. A recipe in the trash can't be named. " +
    "Returns the library as get_library does.",
  parameters: Schema.Struct({ edits: Schema.Array(LibraryEdit) }),
  success: LibraryView,
  failure: Refusal,
}))

export const SippetToolkit = Toolkit.make(
  SearchRecipes, GetRecipe, ListRevisions, GetLibrary, ListTrash,
  AddRecipe, EditRecipe, RestoreRevision, TrashRecipes, RestoreRecipes, EditLibrary,
)
