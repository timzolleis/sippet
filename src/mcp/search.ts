// search_recipes: the explicit filters, combined with a smart collection's filter when one is named (library rule 13).
import { Result, Schema } from "effect"
import { RecipeFilter } from "../domain/library/recipe-filter.ts"
import type { Library, SearchQuery } from "../store/library.ts"
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

const withKey = <K extends string, V>(key: K, value: V | undefined): { readonly [P in K]?: V } => (value === undefined ? {} : ({ [key]: value } as { [P in K]: V }))

// "empty": the two filters can't both hold (one wants a flow, the other none).
export const searchQueryOf = ({ library, params }: { readonly library: Library; readonly params: SearchParams }): Result.Result<SearchQuery | "empty", Refusal> => {
  if (params.collection !== undefined && !library.hasCollection(params.collection)) {
    return Result.fail(refuse({ message: `no collection "${params.collection}"` }))
  }
  const stored = params.smartCollection === undefined ? undefined : library.smartCollectionFilter(params.smartCollection)
  if (params.smartCollection !== undefined && stored === undefined) {
    return Result.fail(refuse({ message: `no smart collection "${params.smartCollection}"` }))
  }
  const smart = stored === undefined ? undefined : decodeFilter(stored)
  if (smart?.hasFlow !== undefined && params.hasFlow !== undefined && smart.hasFlow !== params.hasFlow) return Result.succeed("empty")

  const text = [params.text, smart?.text].filter((part) => part !== undefined && part.trim() !== "").join(" ")
  const items = [...(params.items ?? []), ...(smart?.items ?? [])]
  const maxTotalMinutes = [params.maxTotalMinutes, smart?.maxTotalMinutes].filter((minutes) => minutes !== undefined)
  const anyGroups = smart?.tags?.any === undefined ? [] : [smart.tags.any]
  const tags = {
    ...withKey("all", [...(params.tags?.all ?? []), ...(smart?.tags?.all ?? [])]),
    ...withKey("any", params.tags?.any),
    ...withKey("anyGroups", anyGroups),
    ...withKey("none", [...(params.tags?.none ?? []), ...(smart?.tags?.none ?? [])]),
  }
  return Result.succeed({
    ...(text === "" ? {} : { text }),
    tags,
    ...(items.length === 0 ? {} : { items }),
    ...(maxTotalMinutes.length === 0 ? {} : { maxTotalMinutes: Math.min(...maxTotalMinutes) }),
    ...withKey("hasFlow", params.hasFlow ?? smart?.hasFlow),
    ...withKey("collection", params.collection),
    ...withKey("limit", params.limit),
    ...withKey("cursor", params.cursor),
  })
}
