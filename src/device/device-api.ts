// The device API's endpoints (specs/device-api.md Endpoints). `live` is a WebSocket upgrade CookLibrary answers before this handler (device-live.ts).
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { LibraryEdit } from "../domain/library/library-edit.ts"
import { RecipeId } from "../domain/recipe/recipe-id.ts"
import {
  ChangesNotReachedHttpError,
  LibraryEditsRefusedHttpError,
  RecipesNotFoundHttpError,
} from "./device-http-errors.ts"
import { DeviceMiddleware } from "./device-middleware.ts"
import { ChangesAfter, DeviceRecipe, LibraryAtChange, LibraryOrganization } from "./device-views.ts"

const RecipesPayload = Schema.Struct({ recipeIds: Schema.Array(RecipeId) })
const Recipes = Schema.Struct({ recipes: Schema.Array(DeviceRecipe) })

export class DeviceApi extends HttpApiGroup.make("device")
  .add(
    HttpApiEndpoint.get("getLibrary", "/library", { success: LibraryAtChange }),
    HttpApiEndpoint.get("listChangesAfter", "/changes", {
      query: { after: Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)) },
      success: ChangesAfter,
      error: ChangesNotReachedHttpError,
    }),
    HttpApiEndpoint.post("editLibrary", "/library/edits", {
      payload: Schema.Struct({ edits: Schema.Array(LibraryEdit) }),
      success: LibraryOrganization,
      error: LibraryEditsRefusedHttpError,
    }),
    HttpApiEndpoint.post("trashRecipes", "/recipes/trash", { payload: RecipesPayload, success: Recipes, error: RecipesNotFoundHttpError }),
    HttpApiEndpoint.post("restoreRecipes", "/recipes/restore", { payload: RecipesPayload, success: Recipes, error: RecipesNotFoundHttpError }),
  )
  .prefix("/api/device")
  .middleware(DeviceMiddleware)
{}

export const DeviceHttpApi = HttpApi.make("sippet-device").add(DeviceApi)
