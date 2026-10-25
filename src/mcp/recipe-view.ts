// Views for Claude: a recipe with its derived flow, a search hit, a revision, the library (specs/mcp.md Reading).
import { Match, Option, Schema } from "effect"
import { RecipeFilter } from "../domain/library/recipe-filter.ts"
import { RecipeContent } from "../domain/recipe/recipe-content.ts"
import { recipeFlowFromContent, recipeHasFlow } from "../domain/recipe/recipe-flow.ts"
import type { Library, RecipeRow, SearchHit, StoredRevision } from "../store/library.ts"
import type { Actor } from "../store/schema.ts"
import { RevisionView, type LibraryView, type RecipeSummary, type RecipeView } from "./schemas.ts"

const decodeContent = Schema.decodeUnknownSync(RecipeContent)
const decodeFilter = Schema.decodeUnknownSync(RecipeFilter)
const decodeWas = Schema.decodeUnknownSync(RevisionView.fields.was)

export const iso = (millis: number): string => new Date(millis).toISOString()

// The recipe at the revision in `row`, with the flow of that content.
export const recipeViewOf = ({ library, row }: { readonly library: Library; readonly row: RecipeRow & StoredRevision }): RecipeView => {
  const content = decodeContent(row.content)
  const flow = recipeFlowFromContent(content)
  return {
    id: row.id,
    revision: row.revision,
    latestRevision: row.latestRevision,
    title: content.title,
    yield: content.yield,
    ...(row.source === null ? {} : { source: row.source }),
    tags: library.tagNamesOf([row.id]).get(row.id) ?? [],
    collections: library.collectionNamesOf(row.id),
    ...(row.trashedAt === null ? {} : { trashedAt: iso(row.trashedAt) }),
    ...(row.purgeAt === null ? {} : { purgeAt: iso(row.purgeAt) }),
    sections: content.sections,
    equipment: content.equipment,
    ingredients: content.ingredients,
    steps: content.steps.map((step) => {
      const stepFlow = Option.flatMap(flow, (found) => Option.fromUndefinedOr(found.steps.find((candidate) => candidate.stepKey === step.key)))
      return Option.match(stepFlow, {
        onNone: () => step,
        onSome: ({ takes, waitsFor, makes }) => ({
          ...step,
          flow: { takes: takes.map((link) => link.key), waitsFor: waitsFor.map((link) => link.key), makes },
        }),
      })
    }),
    hasFlow: recipeHasFlow(content),
    makes: Option.match(flow, { onNone: () => [], onSome: (found) => found.makes }),
  }
}

export const recipeSummariesOf = ({ library, hits }: { readonly library: Library; readonly hits: ReadonlyArray<SearchHit> }): ReadonlyArray<RecipeSummary> => {
  const tags = library.tagNamesOf(hits.map((hit) => hit.id))
  return hits.map((hit) => ({
    id: hit.id,
    title: hit.title,
    yield: decodeContent(hit.content).yield,
    tags: tags.get(hit.id) ?? [],
    revision: hit.latestRevision,
    ...(hit.totalMinutes === null ? {} : { totalMinutes: hit.totalMinutes }),
    hasFlow: hit.hasFlow,
    ...(hit.source === null ? {} : { source: hit.source }),
    ...(hit.trashedAt === null ? {} : { trashedAt: iso(hit.trashedAt) }),
  }))
}

export const revisionViewsOf = ({ library, recipeId }: { readonly library: Library; readonly recipeId: string }): ReadonlyArray<RevisionView> => {
  const names = library.connectionNames()
  const authorOf = (actor: Actor): RevisionView["by"] =>
    Match.value(actor).pipe(Match.discriminatorsExhaustive("kind")({
      claude: ({ connection }) => ({ kind: "claude" as const, name: names.get(connection) ?? "Claude" }),
      device: ({ device }) => ({ kind: "device" as const, name: device }),
      trash: () => ({ kind: "claude" as const, name: "Trash" }), // a revision is never made by the trash
    }))
  return library.listRevisions(recipeId).map((stored) => ({
    revision: stored.revision,
    at: iso(stored.at),
    by: authorOf(stored.by),
    was: decodeWas(stored.was),
  }))
}

export const libraryViewOf = (library: Library): LibraryView => {
  const counts = library.countRecipesByName()
  return {
    tags: counts.tags,
    collections: counts.collections,
    smartCollections: library.smartCollections().map((smart) => ({ name: smart.name, filter: decodeFilter(smart.filter) })),
  }
}
