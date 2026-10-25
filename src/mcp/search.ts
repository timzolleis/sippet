// search_recipes: the explicit filters, combined with a smart collection's filter when one is named (library rule 13).
import { pipe, Result, Schema } from "effect"
import { RecipeFilter } from "../domain/library/recipe-filter.ts"
import type { Library, SearchQuery } from "../store/library.ts"
import { withOptional } from "../domain/with-optional.ts"
import { refuse } from "./refusal.ts"
import type { Refusal } from "./schemas.ts"

const decodeFilter = Schema.decodeUnknownSync(RecipeFilter)

export type SearchParams = {
  readonly text?: string
  readonly tags?: { readonly all?: ReadonlyArray<string>; readonly any?: ReadonlyArray<string>; readonly none?: ReadonlyArray<string> }
  readonly items?: ReadonlyArray<string>
  readonly maxTotalMinutes?: number
  readonly hasFlow?: boolean
  readonly collection?: string
  readonly smartCollection?: string
  readonly limit?: number
  readonly cursor?: string
}

// "empty": the two filters can't both hold (one wants a flow, the other none).
export const searchQueryOf = ({ library, params }: { readonly library: Library; readonly params: SearchParams }): Result.Result<SearchQuery | "empty", Refusal> => {
  if (params.collection !== undefined && !library.hasCollection(params.collection)) {
    return Result.fail(refuse({ rule: "unknown-collection", message: `no collection "${params.collection}"`, fix: "name a collection get_library lists" }))
  }

  const stored = params.smartCollection === undefined ? undefined : library.smartCollectionFilter(params.smartCollection)

  if (params.smartCollection !== undefined && stored === undefined) {
    return Result.fail(refuse({
      rule: "unknown-smart-collection",
      message: `no smart collection "${params.smartCollection}"`,
      fix: "name a smart collection get_library lists",
    }))
  }

  const smart = stored === undefined ? undefined : decodeFilter(stored)

  if (smart?.hasFlow !== undefined && params.hasFlow !== undefined && smart.hasFlow !== params.hasFlow) return Result.succeed("empty")

  const text = [params.text, smart?.text].filter((part) => part !== undefined && part.trim() !== "").join(" ")
  const items = [...(params.items ?? []), ...(smart?.items ?? [])]
  const maxTotalMinutes = [params.maxTotalMinutes, smart?.maxTotalMinutes].filter((minutes) => minutes !== undefined)
  const anyGroups = smart?.tags?.any === undefined ? [] : [smart.tags.any]

  const tags = pipe(
    { all: [...(params.tags?.all ?? []), ...(smart?.tags?.all ?? [])], anyGroups, none: [...(params.tags?.none ?? []), ...(smart?.tags?.none ?? [])] },
    (base) => withOptional(base, "any", params.tags?.any),
  )

  return Result.succeed(
    pipe(
      { tags },
      (base) => withOptional(base, "text", text === "" ? undefined : text),
      (base) => withOptional(base, "items", items.length === 0 ? undefined : items),
      (base) => withOptional(base, "maxTotalMinutes", maxTotalMinutes.length === 0 ? undefined : Math.min(...maxTotalMinutes)),
      (base) => withOptional(base, "hasFlow", params.hasFlow ?? smart?.hasFlow),
      (base) => withOptional(base, "collection", params.collection),
      (base) => withOptional(base, "limit", params.limit),
      (base) => withOptional(base, "cursor", params.cursor),
    ),
  )
}
