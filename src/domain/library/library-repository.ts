import { Context, type Effect } from "effect"
import type { RecipeId } from "../recipe/recipe-id.ts"
import type { Library, RecipePlace } from "./library.ts"
import type { LibraryChangedEvent } from "./library-event.ts"

export class LibraryRepository extends Context.Service<LibraryRepository, {
  findLibrary(): Effect.Effect<Library>
  // a recipe that doesn't exist or was purged is absent from the map
  findRecipePlacesByIds(input: { readonly recipeIds: ReadonlyArray<RecipeId> }): Effect.Effect<ReadonlyMap<RecipeId, RecipePlace>>
  publishLibraryEvent(event: LibraryChangedEvent): Effect.Effect<void>
}>()("LibraryRepository") {}
