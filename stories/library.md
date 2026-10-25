---
name: library
description: The cook or Claude organizes recipes with tags, collections, and smart collections, in batches of edits.
type: story
state: draft
---

# Library

"Claude, tag all cakes and make me a Christmas collection."

Mostly Claude's work, often on many recipes at once. Like a revision, a library change is a batch of edits, applied whole or not at all.

## Use cases

| Use case | Rules |
|---|---|
| The cook changes the library with a batch of [edits](#edits): tags recipes, makes a collection, saves a smart collection. On a device or through Claude. | 1, 2, and each edit's rules |

## Data

| Thing | Fields |
|---|---|
| tag | name, unique in the library ignoring case |
| collection | name, unique in the library ignoring case; recipes in the cook's order |
| smart collection | name, unique like a collection's; a filter (rule 13) |

## Edits

| Area | Edits | Rules |
|---|---|---|
| tags | tag recipes (a new name creates the tag), untag recipes, rename, merge into another, delete | 3–8 |
| collections | create (optionally with recipes), add recipes, remove recipes, reorder, rename, delete | 9–12 |
| smart collections | save (new, or a changed name or filter), delete | 9, 13–15 |

Each tag and collection edit names any number of recipes.

## Rules

### Batches

1. **A batch of edits, checked once.** A library change is a list of [edits](#edits), applied in order; each sees the ones before it ("create Weihnachten", then "add Zupfkuchen to Weihnachten"). An edit that can't apply refuses the whole batch, and nothing changes: a recipe that doesn't exist or is in the trash, a tag or collection that doesn't exist, a name that's taken. The refusal lists every problem at once, each naming its edit. Claude fixes them and sends the batch again. A half-applied bulk change is hard to notice and hard to undo.
2. **One change.** A batch is one change in the cook's sequence ([sync.md](sync.md), rule 1), saying who made it.

### Tags

3. **One tag per name.** A tag's name is unique in the library, ignoring case: "Kuchen" and "kuchen" are the same tag. Tagging with a name that doesn't exist yet creates the tag.
4. **Already tagged stays.** Recipes that already have the tag stay as they are.
5. **Untagging keeps the tag.** Recipes without the tag stay as they are. The tag stays, even with no recipes left.
6. **Rename to a free name.** The new name must not belong to another tag (rule 3); when it's taken, the cook probably wants to merge (rule 7), which is its own decision. A change in case only is a rename ("kuchen" → "Kuchen").
7. **Merging.** Every recipe with the merged tag gets the kept tag; the merged tag is deleted.
8. **Deleting a tag.** The tag is removed from every recipe, trashed ones included ([revising-recipes.md](revising-recipes.md), rule 8). The recipes stay.

### Collections

9. **One collection per name.** A collection's or smart collection's name is unique in the library, ignoring case. Claude and the cook refer to collections by name ("put it in Weihnachten").
10. **Added at the end.** Added recipes go to the end, in the order given. A recipe is in a collection at most once; one already there keeps its place. Removing a recipe that isn't there changes nothing.
11. **Reorder names everything.** Reordering names the full new order. A recipe missing or extra is refused: when two devices reorder at once, the second must not silently drop or duplicate a recipe. Refusing makes it reload.
12. **Deleting a collection keeps its recipes.**

### Smart collections

13. **A named filter.** A smart collection filters by tags (all of, any of, none of), items used ("Skyr"), longest total time, whether it has a flow, and text in title, ingredients, or steps.
14. **Always current.** Its recipes follow the filter at all times. Recipes can't be added or ordered by hand.
15. **Deleted tags drop out.** A filter naming a tag that gets deleted drops that tag. Deleting a tag doesn't stop for filters, as it doesn't for recipes (rule 8).

## Examples

| Situation | Result |
|---|---|
| tag Zupfkuchen, Apfelkuchen, Brownies with "Kuchen" (new) | tag created, 3 recipes tagged |
| the same again, plus Käsekuchen | Käsekuchen tagged, the rest unchanged (rule 4) |
| tag Zupfkuchen with "kuchen" | unchanged, it's "Kuchen" (rule 3) |
| create "Weihnachten" with Zupfkuchen and Stollen, then tag both "Backen", in one batch | one change: collection and tag created (rules 1, 2) |
| the same, but edit 2 also names a trashed recipe | refused: edit 2, recipe in the trash; no collection, no tag (rule 1) |
| rename "Nachtisch" to "Dessert" while "Dessert" exists | refused, name taken; suggest merging (rule 6) |
| merge "Nachtisch" (8 recipes) into "Dessert" (5, 2 shared) | "Dessert" on 11 recipes, "Nachtisch" gone (rule 7) |
| "Weihnachten": Zupfkuchen, Stollen, Vanillekipferl; add Lebkuchen, Zupfkuchen | Zupfkuchen, Stollen, Vanillekipferl, Lebkuchen (rule 10) |
| then reorder to Stollen, Zupfkuchen | refused, Vanillekipferl and Lebkuchen missing (rule 11) |
| delete "Weihnachten" | collection gone, 4 recipes stay (rule 12) |
| "Schnell & vegan": all of [vegan], total time ≤ 45 min | lists matching recipes, updates as recipes change (rule 14) |
| tag "vegan" deleted | filter becomes total time ≤ 45 min (rule 15) |
