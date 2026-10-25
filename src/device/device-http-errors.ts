// One HTTP error per domain error, plus the middleware's (specs/device-api.md Commands).
import { Effect, Schema } from "effect"
import type { LibraryRefusedError } from "../domain/library/library-error.ts"
import type { RecipesNotFoundError } from "../domain/recipe/recipe-error.ts"
import type { ChangesNotReachedError } from "./device-views.ts"

// The constructor fills in the default: `new DeviceUnknownHttpError()`.
const messageWithDefault = (message: string) => Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed(message)))

export class LibraryEditsRefusedHttpError extends Schema.TaggedError<LibraryEditsRefusedHttpError>()("LibraryEditsRefusedHttpError", {
  message: messageWithDefault("The edits can't be applied; nothing changed."),
  problems: Schema.Array(Schema.Struct({ edit: Schema.Int, rule: Schema.String, message: Schema.String, fix: Schema.String })),
}, { httpApiStatus: 422 }) {}

export class RecipesNotFoundHttpError extends Schema.TaggedError<RecipesNotFoundHttpError>()("RecipesNotFoundHttpError", {
  message: messageWithDefault("Some recipes don't exist; nothing changed."),
  recipeIds: Schema.Array(Schema.String),
}, { httpApiStatus: 404 }) {}

export class ChangesNotReachedHttpError extends Schema.TaggedError<ChangesNotReachedHttpError>()("ChangesNotReachedHttpError", {
  message: messageWithDefault("This library hasn't reached that change. Load the library again."),
}, { httpApiStatus: 409 }) {}

export class DeviceUnknownHttpError extends Schema.TaggedError<DeviceUnknownHttpError>()("DeviceUnknownHttpError", {
  message: messageWithDefault("x-device-id (a UUID) and x-device-name (1–40 characters) are required."),
}, { httpApiStatus: 400 }) {}

export const libraryEditsRefusedHttpErrorFromLibraryRefusedError = ({ problems }: LibraryRefusedError) =>
  new LibraryEditsRefusedHttpError({
    problems: problems.map(({ edit, rule, message, fix }) => ({ edit, rule, message, fix })),
  })

export const recipesNotFoundHttpErrorFromRecipesNotFoundError = ({ recipeIds }: RecipesNotFoundError) =>
  new RecipesNotFoundHttpError({
    message: `No recipe ${recipeIds.map((id) => `"${id}"`).join(", ")}; nothing changed.`,
    recipeIds,
  })

export const changesNotReachedHttpErrorFromChangesNotReachedError = (_error: ChangesNotReachedError) => new ChangesNotReachedHttpError()
