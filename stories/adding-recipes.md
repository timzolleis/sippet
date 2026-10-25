---
name: adding-recipes
description: The cook adds a recipe in the app or through Claude (dictated, from a photo, from a chat, or from a web page Claude reads).
type: story
state: draft
---

# Adding recipes

"The cook adds a recipe to the library, by hand or by asking Claude."

Claude is the import: for a photo of a cookbook page, a chat, or a link, Claude reads the source and writes the recipe down. The app has no import of its own.

## Use cases

| Use case | Rules |
|---|---|
| The cook writes down a recipe, in the app or by telling Claude (dictated, photo, chat). | 1–3 |
| Claude adds a recipe from a web page the cook links. | 1–6 |

## Data

Beside the content ([recipe.md](recipe.md)):

| Field | Type | Content |
|---|---|---|
| source | web address, optional | the page Claude read; compared cleaned up (rule 6) |
| photo | image, optional | copied from the page |
| revision | number | starts at 1 |

## Rules

1. **Edits on an empty recipe.** A new recipe is a title, a yield, and a batch of [edits](revising-recipes.md#edits) applied to an empty recipe, checked once like a revision ([revising-recipes.md](revising-recipes.md), rule 1). The result satisfies the [recipe rules](recipe.md#rules). Adding and revising share one vocabulary: whoever writes a recipe learns it once.
2. **Revision 1.** A new recipe starts at revision 1. Its change records who added it: a device or Claude ([sync.md](sync.md), rule 4).
3. **The same steps everywhere.** Claude and the app editor write the same steps; naming each step's ingredients gives the recipe a flow ([recipe.md](recipe.md), rules 10, 11). In the app the cook ticks them. Splits and steps that name what they take need their own UI, which isn't MVP; Claude can write them now.
4. **Source kept.** When Claude adds from a page, the page address is kept as the recipe's source.
5. **Photo copied.** The page's photo is copied into the library. Pages change and vanish. Without a photo, or if copying fails, the recipe is added without one and Claude is told: the photo never blocks the recipe.
6. **One recipe per page.** A source already in the library isn't added again, trashed recipes included. Adding is refused and points to the existing recipe. Addresses are compared after following redirects and dropping tracking parameters (`?utm_source=…`). A second copy of the same page is almost always a mistake, and the two would drift apart.

Photo import inside the app is in [later.md](later.md).

## Examples

| Situation | Result |
|---|---|
| The cook sends Claude a photo of the Zupfkuchen card; Claude adds it, each step naming its ingredients | added with a flow, revision 1, by Claude |
| The cook types "Pfannkuchen" with 4 ingredients and 3 steps on the iPhone | added, revision 1, by iPhone |
| Claude adds a recipe where no step uses Kakao | refused (recipe rule 14) |
| Claude reads a chefkoch.de link and adds it | added, source and photo kept |
| a messy blog post without recipe markup | added; Claude reads it like any page |
| the same chefkoch.de page a week later | refused, already added as "Zupfkuchen" (rule 6) |
| the same page shared with `?utm_source=instagram` | refused, already added (rule 6) |
| the same page while "Zupfkuchen" is in the trash | refused, points to the trashed recipe (rule 6) |
| a page whose photo can't be loaded | added without photo, Claude is told (rule 5) |
| the same recipe from a different site | added (rule 6 compares the page address only) |
