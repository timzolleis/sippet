import { Match } from "effect"
import type { RecipeId } from "../recipe/recipe-id.ts"
import type { Collection, Library, RecipePlace, SmartCollection, Tag } from "./library.ts"
import type {
  LibraryEdit,
  ReorderCollectionEdit,
  SaveSmartCollectionEdit,
} from "./library-edit.ts"
import type { LibraryProblem, LibraryRuleName } from "./library-error.ts"
import { isSameLibraryName } from "./library-name.ts"
import type { RecipeFilter, TagFilter } from "./recipe-filter.ts"

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

// Why an edit can't apply; the batch adds which edit it was.
type EditProblem = Omit<LibraryProblem, "edit">

// An edit's outcome: what it could apply, and why the rest can't.
type AppliedEdit = { readonly library: Library; readonly problems: ReadonlyArray<EditProblem> }

type ApplyLibraryEditInput = { readonly library: Library; readonly recipePlaces: ReadonlyMap<RecipeId, RecipePlace> }

const applied = (library: Library, problems: ReadonlyArray<EditProblem> = []): AppliedEdit => ({ library, problems })

const quoted = (name: string) => `"${name}"`

const problem = (rule: LibraryRuleName, message: string, fix: string): EditProblem => ({ rule, message, fix })

const unique = <T>(values: ReadonlyArray<T>): ReadonlyArray<T> => [...new Set(values)]

type RecipeIdsInLibrary = { readonly recipeIds: ReadonlyArray<RecipeId>; readonly problems: ReadonlyArray<EditProblem> }

// A recipe that doesn't exist or is in the trash can't be named (library rule 1).
const recipeIdsInLibrary = ({ recipePlaces, recipeIds }: {
  readonly recipePlaces: ReadonlyMap<RecipeId, RecipePlace>; readonly recipeIds: ReadonlyArray<RecipeId>
}): RecipeIdsInLibrary => ({
  recipeIds: unique(recipeIds.filter((recipeId) => recipePlaces.get(recipeId) === "library")),
  problems: recipeIds.flatMap((recipeId) =>
    Match.value(recipePlaces.get(recipeId)).pipe(
      Match.when("library", () => []),
      Match.when("trash", () => [
        problem("trashed-recipes-leave-the-library", `recipe ${quoted(recipeId)} is in the trash`, `restore_recipes ${quoted(recipeId)} first, or leave it out`),
      ]),
      Match.orElse(() => [problem("unknown-recipe", `no recipe ${quoted(recipeId)}`, "use an id from search_recipes")]),
    )
  ),
})

const findByName = <T extends { readonly name: string }>(list: ReadonlyArray<T>, name: string): T | undefined =>
  list.find((entry) => isSameLibraryName(entry.name, name))

const replaceEntry = <T>(list: ReadonlyArray<T>, current: T, next: T): ReadonlyArray<T> => list.map((entry) => entry === current ? next : entry)

const withoutEntry = <T>(list: ReadonlyArray<T>, current: T): ReadonlyArray<T> => list.filter((entry) => entry !== current)

const appendRecipeIds = (current: ReadonlyArray<RecipeId>, added: ReadonlyArray<RecipeId>) =>
  [...current, ...added.filter((recipeId) => !current.includes(recipeId))]

// A collection's or smart collection's name is unique across both (library rule 9).
const collectionNameTaken = ({ library, name, except }: { readonly library: Library; readonly name: string; readonly except?: object }): EditProblem | undefined => {
  const collection = findByName(library.collections, name)
  const fix = "pick another name; collections and smart collections share names, ignoring case"

  if (collection !== undefined && collection !== except) return problem("one-collection-per-name", `the name ${quoted(name)} is taken by a collection`, fix)
  const smartCollection = findByName(library.smartCollections, name)

  if (smartCollection !== undefined && smartCollection !== except) {
    return problem("one-collection-per-name", `the name ${quoted(name)} is taken by a smart collection`, fix)
  }

  return undefined
}

const tagFilterWith = (tagFilter: TagFilter, renameTag: (name: string) => string | undefined): TagFilter | undefined => {
  const next: Mutable<TagFilter> = {}

  for (const group of ["all", "any", "none"] as const) {
    const names = unique((tagFilter[group] ?? []).flatMap((name) => renameTag(name) ?? []))

    if (names.length > 0) next[group] = names
  }

  return Object.keys(next).length === 0 ? undefined : next
}

// Renames or drops one tag in every smart collection's filter.
const smartCollectionsWithTag = ({ smartCollections, tag, to }: {
  readonly smartCollections: ReadonlyArray<SmartCollection>; readonly tag: Tag; readonly to: string | undefined
}): ReadonlyArray<SmartCollection> =>
  smartCollections.map((smartCollection) => {
    if (smartCollection.filter.tags === undefined) return smartCollection
    const filter: Mutable<RecipeFilter> = { ...smartCollection.filter }
    const tags = tagFilterWith(smartCollection.filter.tags, (name) => isSameLibraryName(name, tag.name) ? to : name)

    if (tags === undefined) delete filter.tags
    else filter.tags = tags

    return { ...smartCollection, filter }
  })

const noTag = (name: string) => problem("unknown-tag", `no tag ${quoted(name)}`, "name a tag get_library lists (ignoring case); tag creates new ones")
const missingTag = (library: Library, name: string) => applied(library, [noTag(name)])

const missingCollection = (library: Library, name: string) =>
  applied(library, [problem("unknown-collection", `no collection ${quoted(name)}`, "name a collection get_library lists, or create_collection it in an earlier edit")])

const noSmartCollection = (name: string) =>
  problem("unknown-smart-collection", `no smart collection ${quoted(name)}`, "name a smart collection get_library lists")

// 3, 4. A new name creates the tag; recipes already tagged stay.
const tagRecipes = ({ library, recipePlaces, tag: name, recipeIds }: ApplyLibraryEditInput & { readonly tag: string; readonly recipeIds: ReadonlyArray<RecipeId> }): AppliedEdit => {
  const named = recipeIdsInLibrary({ recipePlaces, recipeIds })
  const tag = findByName(library.tags, name)

  const tags = tag === undefined
    ? [...library.tags, { name, recipeIds: named.recipeIds }]
    : replaceEntry(library.tags, tag, { ...tag, recipeIds: appendRecipeIds(tag.recipeIds, named.recipeIds) })

  return applied({ ...library, tags }, named.problems)
}

// 5. Untagging keeps the tag.
const untagRecipes = ({ library, recipePlaces, tag: name, recipeIds }: ApplyLibraryEditInput & { readonly tag: string; readonly recipeIds: ReadonlyArray<RecipeId> }): AppliedEdit => {
  const tag = findByName(library.tags, name)

  if (tag === undefined) return missingTag(library, name)
  const named = recipeIdsInLibrary({ recipePlaces, recipeIds })
  const tags = replaceEntry(library.tags, tag, { ...tag, recipeIds: tag.recipeIds.filter((recipeId) => !named.recipeIds.includes(recipeId)) })

  return applied({ ...library, tags }, named.problems)
}

// 6. Rename to a free name; a change in case only is a rename. Filters follow.
const renameTag = ({ library, tag: name, to }: { readonly library: Library; readonly tag: string; readonly to: string }): AppliedEdit => {
  const tag = findByName(library.tags, name)

  if (tag === undefined) return missingTag(library, name)
  const other = findByName(library.tags, to)

  if (other !== undefined && other !== tag) {
    return applied(library, [
      problem("rename-to-a-free-name", `the tag ${quoted(other.name)} exists`, `merge_tags ${quoted(tag.name)} into ${quoted(other.name)} instead`),
    ])
  }

  return applied({
    ...library,
    tags: replaceEntry(library.tags, tag, { ...tag, name: to }),
    smartCollections: smartCollectionsWithTag({ smartCollections: library.smartCollections, tag, to }),
  })
}

// 7. Every recipe with the merged tag gets the kept tag; filters name the kept tag; the merged tag is deleted.
const mergeTags = ({ library, tag: name, into }: { readonly library: Library; readonly tag: string; readonly into: string }): AppliedEdit => {
  const merged = findByName(library.tags, name)
  const kept = findByName(library.tags, into)

  if (merged === undefined || kept === undefined) {
    return applied(library, [...(merged === undefined ? [noTag(name)] : []), ...(kept === undefined ? [noTag(into)] : [])])
  }

  if (merged === kept) return applied(library, [problem("merging", `can't merge the tag ${quoted(merged.name)} into itself`, "name two different tags")])

  return applied({
    ...library,
    tags: withoutEntry(replaceEntry(library.tags, kept, { ...kept, recipeIds: appendRecipeIds(kept.recipeIds, merged.recipeIds) }), merged),
    smartCollections: smartCollectionsWithTag({ smartCollections: library.smartCollections, tag: merged, to: kept.name }),
  })
}

// 8, 15. The tag leaves every recipe, trashed ones included, and every filter.
const deleteTag = ({ library, tag: name }: { readonly library: Library; readonly tag: string }): AppliedEdit => {
  const tag = findByName(library.tags, name)

  if (tag === undefined) return missingTag(library, name)

  return applied({
    ...library,
    tags: withoutEntry(library.tags, tag),
    smartCollections: smartCollectionsWithTag({ smartCollections: library.smartCollections, tag, to: undefined }),
  })
}

const createCollection = ({ library, recipePlaces, name, recipeIds }: ApplyLibraryEditInput & { readonly name: string; readonly recipeIds: ReadonlyArray<RecipeId> }): AppliedEdit => {
  const taken = collectionNameTaken({ library, name })

  if (taken !== undefined) return applied(library, [taken])
  const named = recipeIdsInLibrary({ recipePlaces, recipeIds })

  return applied({ ...library, collections: [...library.collections, { name, recipeIds: named.recipeIds }] }, named.problems)
}

// 10. Added at the end, in the order given; one already there keeps its place.
const addToCollection = ({ library, recipePlaces, collection: name, recipeIds }: ApplyLibraryEditInput & { readonly collection: string; readonly recipeIds: ReadonlyArray<RecipeId> }): AppliedEdit => {
  const collection = findByName(library.collections, name)

  if (collection === undefined) return missingCollection(library, name)
  const named = recipeIdsInLibrary({ recipePlaces, recipeIds })

  return applied({
    ...library,
    collections: replaceEntry(library.collections, collection, { ...collection, recipeIds: appendRecipeIds(collection.recipeIds, named.recipeIds) }),
  }, named.problems)
}

// 10. Removing a recipe that isn't there changes nothing.
const removeFromCollection = ({ library, recipePlaces, collection: name, recipeIds }: ApplyLibraryEditInput & { readonly collection: string; readonly recipeIds: ReadonlyArray<RecipeId> }): AppliedEdit => {
  const collection = findByName(library.collections, name)

  if (collection === undefined) return missingCollection(library, name)
  const named = recipeIdsInLibrary({ recipePlaces, recipeIds })

  return applied({
    ...library,
    collections: replaceEntry(library.collections, collection, {
      ...collection, recipeIds: collection.recipeIds.filter((recipeId) => !named.recipeIds.includes(recipeId)),
    }),
  }, named.problems)
}

/**
 * 11. Reordering names every recipe in the collection outside the trash, each once. Trashed recipes keep their
 * position, so a restored one comes back where it was (revising rule 8).
 */
const reorderCollection = ({ library, recipePlaces, edit }: ApplyLibraryEditInput & { readonly edit: ReorderCollectionEdit }): AppliedEdit => {
  const collection = findByName(library.collections, edit.collection)

  if (collection === undefined) return missingCollection(library, edit.collection)
  const isTrashed = (recipeId: RecipeId) => recipePlaces.get(recipeId) === "trash"
  const listed = collection.recipeIds.filter((recipeId) => !isTrashed(recipeId))
  const named = edit.recipeIds
  const twice = unique(named.filter((recipeId, index) => named.indexOf(recipeId) !== index))
  const missing = listed.filter((recipeId) => !named.includes(recipeId))
  const extra = unique(named.filter((recipeId) => !listed.includes(recipeId)))

  const problems = [
    ...(missing.length > 0
      ? [problem("reorder-names-everything", `the new order misses ${missing.map(quoted).join(", ")}`, "name every recipe in the collection, each once")]
      : []),
    ...(extra.length > 0
      ? [problem("reorder-names-everything", `not in ${quoted(collection.name)}: ${extra.map(quoted).join(", ")}`, "add_to_collection them first, or leave them out")]
      : []),
    ...(twice.length > 0
      ? [problem("reorder-names-everything", `named more than once: ${twice.map(quoted).join(", ")}`, "name each recipe once")]
      : []),
  ]

  if (problems.length > 0) return applied(library, problems)
  const reordered = [...named]
  const recipeIds = collection.recipeIds.map((recipeId) => isTrashed(recipeId) ? recipeId : reordered.shift() ?? recipeId)

  return applied({ ...library, collections: replaceEntry(library.collections, collection, { ...collection, recipeIds }) })
}

const renameCollection = ({ library, collection: name, to }: { readonly library: Library; readonly collection: string; readonly to: string }): AppliedEdit => {
  const collection = findByName(library.collections, name)

  if (collection === undefined) return missingCollection(library, name)
  const taken = collectionNameTaken({ library, name: to, except: collection })

  if (taken !== undefined) return applied(library, [taken])

  return applied({ ...library, collections: replaceEntry<Collection>(library.collections, collection, { ...collection, name: to }) })
}

// 12. Deleting a collection keeps its recipes.
const deleteCollection = ({ library, collection: name }: { readonly library: Library; readonly collection: string }): AppliedEdit => {
  const collection = findByName(library.collections, name)

  if (collection === undefined) return missingCollection(library, name)

  return applied({ ...library, collections: withoutEntry(library.collections, collection) })
}

// A filter names existing tags, in their spelling.
const filterWithLibraryTags = ({ library, filter }: { readonly library: Library; readonly filter: RecipeFilter }): AppliedEdit & { readonly filter: RecipeFilter } => {
  if (filter.tags === undefined) return { ...applied(library), filter }
  const problems: Array<EditProblem> = []

  const tags = tagFilterWith(filter.tags, (name) => {
    const tag = findByName(library.tags, name)

    if (tag === undefined) problems.push(noTag(name))

    return tag?.name
  })

  const next: Mutable<RecipeFilter> = { ...filter }

  if (tags === undefined) delete next.tags
  else next.tags = tags

  return { ...applied(library, problems), filter: next }
}

// 13. Save a new smart collection, or change one's name or filter.
const saveSmartCollection = ({ library, edit }: { readonly library: Library; readonly edit: SaveSmartCollectionEdit }): AppliedEdit => {
  const checkedFilter = filterWithLibraryTags({ library, filter: edit.filter })
  const smartCollection = findByName(library.smartCollections, edit.name)

  if (smartCollection === undefined) {
    if (edit.newName !== undefined) return applied(library, [noSmartCollection(edit.name), ...checkedFilter.problems])
    const taken = collectionNameTaken({ library, name: edit.name })

    if (taken !== undefined) return applied(library, [taken, ...checkedFilter.problems])

    return applied(
      { ...library, smartCollections: [...library.smartCollections, { name: edit.name, filter: checkedFilter.filter }] },
      checkedFilter.problems,
    )
  }

  const name = edit.newName ?? smartCollection.name
  const taken = collectionNameTaken({ library, name, except: smartCollection })

  if (taken !== undefined) return applied(library, [taken, ...checkedFilter.problems])

  return applied(
    { ...library, smartCollections: replaceEntry(library.smartCollections, smartCollection, { name, filter: checkedFilter.filter }) },
    checkedFilter.problems,
  )
}

const deleteSmartCollection = ({ library, name }: { readonly library: Library; readonly name: string }): AppliedEdit => {
  const smartCollection = findByName(library.smartCollections, name)

  if (smartCollection === undefined) return applied(library, [noSmartCollection(name)])

  return applied({ ...library, smartCollections: withoutEntry(library.smartCollections, smartCollection) })
}

const applyLibraryEdit = ({ library, recipePlaces, edit }: ApplyLibraryEditInput & { readonly edit: LibraryEdit }): AppliedEdit =>
  Match.value(edit).pipe(Match.discriminatorsExhaustive("op")({
    tag: ({ tag, recipeIds }) => tagRecipes({ library, recipePlaces, tag, recipeIds }),
    untag: ({ tag, recipeIds }) => untagRecipes({ library, recipePlaces, tag, recipeIds }),
    rename_tag: ({ tag, to }) => renameTag({ library, tag, to }),
    merge_tags: ({ tag, into }) => mergeTags({ library, tag, into }),
    delete_tag: ({ tag }) => deleteTag({ library, tag }),
    create_collection: ({ name, recipeIds }) => createCollection({ library, recipePlaces, name, recipeIds: recipeIds ?? [] }),
    add_to_collection: ({ collection, recipeIds }) => addToCollection({ library, recipePlaces, collection, recipeIds }),
    remove_from_collection: ({ collection, recipeIds }) => removeFromCollection({ library, recipePlaces, collection, recipeIds }),
    reorder_collection: (reorderEdit) => reorderCollection({ library, recipePlaces, edit: reorderEdit }),
    rename_collection: ({ collection, to }) => renameCollection({ library, collection, to }),
    delete_collection: ({ collection }) => deleteCollection({ library, collection }),
    save_smart_collection: (saveEdit) => saveSmartCollection({ library, edit: saveEdit }),
    delete_smart_collection: ({ name }) => deleteSmartCollection({ library, name }),
  }))

/**
 * Applies a batch in order; each edit sees the ones before it (library rule 1). An edit applies what it can, so
 * the edits after it report only their own problems.
 */
export const applyLibraryEdits = ({ library, recipePlaces, edits }: ApplyLibraryEditInput & {
  readonly edits: ReadonlyArray<LibraryEdit>
}): { readonly library: Library; readonly problems: ReadonlyArray<LibraryProblem> } =>
  edits.reduce<{ library: Library; problems: ReadonlyArray<LibraryProblem> }>(
    (batch, edit, index) => {
      const appliedEdit = applyLibraryEdit({ library: batch.library, recipePlaces, edit })

      return {
        library: appliedEdit.library,
        problems: [...batch.problems, ...appliedEdit.problems.map((editProblem) => ({ edit: index + 1, ...editProblem }))],
      }
    },
    { library, problems: [] },
  )
