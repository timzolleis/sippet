// The eleven tools (specs/mcp.md Tools). Reads are readOnly; writes are not destructive: everything Claude does is undoable (account rule 6).
// An array can't be a tool's structured result (MCP wants an object), so list results are wrapped: `revisions`, `recipes`, `trashed`.
// A write's success schema also names the Refusal, so its output schema declares both shapes (the refusal comes with isError).
import { Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import { LibraryEdit } from "../domain/library/library-edit.ts"
import { RecipeFilter } from "../domain/library/recipe-filter.ts"
import { RecipeId } from "../domain/recipe/recipe-id.ts"
import { Yield } from "../domain/recipe/recipe-content.ts"
import { NewRecipeEdit, RecipeEdit } from "../domain/recipe/recipe-edit.ts"
import { LibraryView, RecipeSummary, RecipeViewResult, Refusal, RevisionView, WrittenLibrary, WrittenRecipe } from "./schemas.ts"

const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

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

const dryRun = Schema.optionalKey(Schema.Boolean).pipe(Schema.annotateKey({
  description: "true: run every check and return the recipe or the refusal; nothing is written.",
}))

const recipeModel = [
  "Add a recipe. title and yield are top-level and required; edits holds the rest, only add_section, add_ingredient, add_equipment, add_step (a new recipe has nothing to change or remove), " +
  "applied in order to an empty recipe and checked once at the end, so keys may point at things added later.",
  "Model. An ingredient is one line of the list: an item (what you buy), an amount, a section. A step is one instruction, in the source's order; " +
  "uses lists the ingredients it adds, takes the earlier results or portions it works on. A step that uses or takes something makes a result; " +
  "each result goes to one later step, and the result nobody takes (normally the last step's) is what the recipe makes. " +
  "A section is a part made on its own (Teig, Füllung). Keys are lowercase ids [a-z0-9-] you pick, unique in the recipe; steps and edit_* point at them.",
  "Flow, derived where a step omits takes or waitsFor. Chain: a step takes the result of the nearest earlier step in its section that has one " +
  "(steps without a section are one section). Join: a step without a section also takes the latest result of each section used since the previous " +
  "such step, and every portion not yet taken. Prep: a step that uses and takes nothing (vorheizen) makes nothing; the next step with the same " +
  "equipment waits for it (a prep step after a step with a result in its section chains it unless it has takes: []). So \"Eier unterrühren\" is uses: [\"eier\"], and the chain brings the bowl; a second bowl in the same section needs " +
  "takes: [] or its own section. Checked: every ingredient in exactly one step's uses (or no step names uses: plain steps); " +
  "every result taken at most once (split it into portions otherwise); steps take only earlier steps.",
  "Names and sentences in the recipe's language; units as codes (Unit). Returns the recipe with each step's flow: check it. " +
  "A refusal lists every problem with rule, message, and fix; fix them all and send the batch again.",
].join("\n\n")

export const SearchRecipes = read(Tool.make("search_recipes", {
  description:
    "Search the cook's recipes; the trash never shows. Every filter given must hold (AND), a smartCollection's saved filter included. " +
    "Order: the collection's order, else relevance to text, else title. Pages of limit (20, max 100); pass the returned cursor for the next.",
  parameters: Schema.Struct({
    ...RecipeFilter.fields,
    text: Schema.optionalKey(Schema.String).pipe(Schema.annotateKey({
      description: "Every word (3+ letters) appears in the title, ingredients, or steps; substring, ignoring case and accents. Not source or tags.",
    })),
    collection: Schema.optionalKey(Schema.String).pipe(Schema.annotateKey({ description: "Only recipes in this collection, in its order." })),
    smartCollection: Schema.optionalKey(Schema.String).pipe(Schema.annotateKey({ description: "Also apply this smart collection's filter." })),
    limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
    cursor: Schema.optionalKey(Schema.String),
  }),
  success: Schema.Struct({ recipes: Schema.Array(RecipeSummary), cursor: Schema.optionalKey(Schema.String) }),
  failure: Refusal,
}))

export const GetRecipe = read(Tool.make("get_recipe", {
  description:
    "Read a recipe as written (steps in add_step's fields) with its derived flow. Without revision, the latest; trashed recipes too. " +
    "Pass latestRevision as fromRevision to edit_recipe.",
  parameters: Schema.Struct({ recipeId: RecipeId, revision: Schema.optionalKey(Revision) }),
  success: RecipeViewResult,
  failure: Refusal,
}))

export const ListRevisions = read(Tool.make("list_revisions", {
  description: "Every revision of a recipe, newest first: when, who, and what changed (the batch, or the revision restored).",
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
  description: recipeModel,
  parameters: Schema.Struct({
    title: Schema.NonEmptyString.pipe(Schema.annotateKey({ description: "As the source has it." })),
    yield: Yield,
    source: Schema.optionalKey(Schema.String).pipe(Schema.annotateKey({
      description: "The page it came from; normalized (https, no www., tracking parameters dropped, redirects followed). " +
        "A page already added, trash included, is refused with that recipe's id and whether it's trashed.",
    })),
    edits: Schema.Array(NewRecipeEdit),
    dryRun,
  }),
  success: Schema.Union([WrittenRecipe, Refusal]),
  failure: Refusal,
}))

export const EditRecipe = write(Tool.make("edit_recipe", {
  description:
    "Revise a recipe: a batch of edits to the revision you read, applied in order and checked once at the end; refused whole, with every problem. " +
    "Same recipe model and ops as add_recipe, plus set_title and set_yield. edit_* change only the fields given; null clears one. " +
    "Refused with latestRevision if someone saved since: read it with get_recipe and rebuild the batch. A recipe in the trash can't be edited. " +
    "Returns the recipe with its derived flow: check it.",
  parameters: Schema.Struct({
    recipeId: RecipeId,
    fromRevision: Revision.pipe(Schema.annotateKey({ description: "latestRevision from get_recipe." })),
    edits: Schema.Array(RecipeEdit),
    dryRun,
  }),
  success: Schema.Union([WrittenRecipe, Refusal]),
  failure: Refusal,
}))

export const RestoreRevision = write(Tool.make("restore_revision", {
  description: "Make an earlier revision's content the next revision; nothing is removed. Returns the recipe.",
  parameters: Schema.Struct({
    recipeId: RecipeId,
    fromRevision: Revision.pipe(Schema.annotateKey({ description: "The latest revision you read." })),
    revision: Revision.pipe(Schema.annotateKey({ description: "The one to bring back." })),
  }),
  success: Schema.Union([WrittenRecipe, Refusal]),
  failure: Refusal,
}))

export const TrashRecipes = write(Tool.make("trash_recipes", {
  description:
    "Move recipes to the trash, all or nothing: an unknown recipe refuses all. They leave the library, collections, and search, " +
    "and keep their tags and collection places. The cook can restore them for 30 days; one already in the trash keeps its date.",
  parameters: Schema.Struct({ recipeIds: Schema.Array(RecipeId) }),
  success: Schema.Union([Schema.Struct({ trashed: Schema.Array(Schema.Struct({ id: Schema.String, purgeAt: Schema.String })) }), Refusal]),
  failure: Refusal,
}))

export const RestoreRecipes = write(Tool.make("restore_recipes", {
  description:
    "Bring recipes back from the trash, all or nothing, with their tags and at their old places in collections. " +
    "One that isn't in the trash stays as it is.",
  parameters: Schema.Struct({ recipeIds: Schema.Array(RecipeId) }),
  success: Schema.Union([Schema.Struct({ recipeIds: Schema.Array(Schema.String) }), Refusal]),
  failure: Refusal,
}))

export const EditLibrary = write(Tool.make("edit_library", {
  description:
    "Change tags, collections, and smart collections with a batch of edits, applied in order (each sees the ones before) and all or nothing. " +
    "Recipes are named by id, tags and collections by name ignoring case. Tagging with a new name creates the tag. " +
    "reorder_collection names every recipe in the collection, each once. A recipe in the trash can't be named. " +
    "Returns the library as get_library does.",
  parameters: Schema.Struct({ edits: Schema.Array(LibraryEdit) }),
  success: Schema.Union([WrittenLibrary, Refusal]),
  failure: Refusal,
}))

export const SippetToolkit = Toolkit.make(
  SearchRecipes, GetRecipe, ListRevisions, GetLibrary, ListTrash,
  AddRecipe, EditRecipe, RestoreRevision, TrashRecipes, RestoreRecipes, EditLibrary,
)
