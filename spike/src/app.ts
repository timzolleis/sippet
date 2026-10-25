// CPU spike: MCP endpoint with add_recipe / edit_recipe, sessions (layerHttp), in-memory library.
import { Effect, Layer, Schema } from "effect"
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai"
import { HttpRouter } from "effect/http"
import { applyEdits, checkRecipe, emptyRecipe, RecipeEdit, type Recipe } from "./recipe.ts"

const Result = Schema.Struct({
  recipeId: Schema.String,
  revision: Schema.Number,
  problems: Schema.Array(Schema.String)
})

const AddRecipe = Tool.make("add_recipe", {
  description: "Add a recipe: a title and a batch of edits applied to an empty recipe, checked once.",
  parameters: Schema.Struct({ title: Schema.String, edits: Schema.Array(RecipeEdit) }),
  success: Result
})
const EditRecipe = Tool.make("edit_recipe", {
  description: "Revise a recipe with a batch of edits to the revision you last saw. All or nothing.",
  parameters: Schema.Struct({ recipeId: Schema.String, fromRevision: Schema.Number, edits: Schema.Array(RecipeEdit) }),
  success: Result
})
const RecipeToolkit = Toolkit.make(AddRecipe, EditRecipe)

const library = new Map<string, { revision: number; recipe: Recipe }>()
let nextId = 1

const save = (recipeId: string, base: Recipe, revision: number, edits: ReadonlyArray<RecipeEdit>) => {
  const applied = applyEdits(base, edits)
  const problems = applied.problems.length > 0 ? applied.problems : checkRecipe(applied.recipe)
  if (problems.length === 0) library.set(recipeId, { revision: revision + 1, recipe: applied.recipe })
  return { recipeId, revision: problems.length === 0 ? revision + 1 : revision, problems }
}

const ToolsLive = RecipeToolkit.toLayer({
  add_recipe: ({ title, edits }) => Effect.sync(() => save(`rcp_${nextId++}`, emptyRecipe(title), 0, edits)),
  edit_recipe: ({ recipeId, fromRevision, edits }) =>
    Effect.sync(() => {
      const current = library.get(recipeId)
      if (!current) return { recipeId, revision: 0, problems: [`no recipe ${recipeId}`] }
      if (current.revision !== fromRevision) return { recipeId, revision: current.revision, problems: [`revision ${current.revision} is newer`] }
      return save(recipeId, current.recipe, current.revision, edits)
    })
})

export const AppLive = McpServer.toolkit(RecipeToolkit).pipe(
  Layer.provideMerge(ToolsLive),
  Layer.provideMerge(McpServer.layerHttp({
    name: "sippet-spike",
    version: "0.0.0",
    path: "/mcp",
    protocols: [McpProtocol.v2025_06_18, McpProtocol.v2025_11_25, McpProtocol.v2026_07_28]
  }))
)

export const makeHandler = () => HttpRouter.toWebHandler(AppLive, { disableLogger: true })
