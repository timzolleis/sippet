---
name: revising-recipes
description: The cook or Claude revises a recipe, restores an earlier revision, moves a recipe to the trash, and restores it from there.
type: story
state: draft
---

# Revising recipes

"The cook can change any recipe, and undo whatever Claude changed."

A revision is a batch of edits, each one intent, like "180 g → 120 g Zucker in Teig". The batch is checked once and saved as one revision, or refused whole. Nothing is overwritten. The trash keeps a recipe for 30 days.

## Use cases

| Use case | Rules |
|---|---|
| The cook revises a recipe with a batch of edits: fixes an amount, rewrites a step, names the ingredients each step uses. On a device or through Claude. | 1–4 |
| The cook restores an earlier revision. | 2, 5 |
| The cook moves recipes to the trash. | 6, 7, 10 |
| The cook empties the trash. | 7 |
| The cook restores recipes from the trash. | 8–10 |

## Data

| Field | Type | Content |
|---|---|---|
| revisions | list | each the whole content ([recipe.md](recipe.md)), numbered 1, 2, 3 … |
| trashed at | time, optional | set while the recipe is in the trash |

## Edits

Each edit does one thing; the recipe rules at the end catch its consequences. Removing an ingredient or equipment a step still names is refused (recipe rule 12) unless the same batch changes that step too. An edit that changes a thing names only the fields that change, and can clear a field.

| Area | Edits |
|---|---|
| recipe | set title, set yield |
| sections | add, rename, remove (its ingredients and steps stay, without a section) |
| items | rename ("Zucker" → "Rohrzucker"; every ingredient follows; to an existing name, the ingredients join that item) |
| ingredients | add (with an item name; a new name adds the item), edit, move, remove |
| equipment | add, edit, remove |
| steps | add, edit, move, remove; a step's fields include what it uses, its result and split, and what it takes or waits for (recipe rules 10, 11) |

The flow follows from the steps (recipe rule 11); there is no edit for it.

## Rules

### Revising

1. **A batch of edits, checked once.** A revision is a list of [edits](#edits) to the revision it was made from, applied in order. In between, the recipe may break rules; the result must satisfy the [recipe rules](recipe.md#rules) and becomes the next revision. An edit that can't apply (no such key, key already used) or a broken rule refuses the whole batch, and nothing is saved. The refusal lists every problem at once, each naming its edit or rule. Claude fixes them and sends the batch again; a half-applied batch would leave a recipe nobody wrote.
2. **Revise what you saw.** A revision names the revision it was made from. If someone saved a revision in between, it's refused and the cook sees the newer one. Claude and two devices edit the same library; saving silently over someone else's edit loses work nobody notices.
3. **Every revision is kept.** Claude edits recipes; the cook must be able to see and undo what changed (rule 5).
4. **Not in the trash.** A trashed recipe can't be revised. Restore it first.

### Restoring a revision

5. **Restoring is a revision.** Restoring saves the old content as the next revision, under rule 2. No revision is removed: undoing Claude's edit must not lose it, the cook may want it back.

### Trash

6. **Trashed recipes leave the library.** A trashed recipe leaves the library, its collections, smart collections, and search. It keeps its tags and collection places, for rule 8.
7. **Emptied after 30 days.** The trash is emptied 30 days after a recipe was trashed. The cook can also empty it right away. Claude can trash, but never empty the trash ([account.md](account.md), rule 6): a mistake by Claude must stay recoverable.
8. **Restored as it was.** A restored recipe comes back with its tags and in its collections, at its old position. A tag deleted in the meantime is gone.
9. **Purged is gone.** A purged recipe can't be restored.
10. **Several at once.** Trashing and restoring name any number of recipes, all or nothing, as one change ([sync.md](sync.md), rule 1). A recipe that doesn't exist or is purged refuses all of them. One already in the trash stays as it is and keeps its 30 days; restoring one that isn't in the trash changes nothing. "Delete these 5 duplicates" is one request; half of them trashed is hard to notice.

## Examples

| Zupfkuchen at revision 3, unless named | Result |
|---|---|
| iPad saves from revision 3 | revision 4 |
| edit `zucker-teig` to 120 g and `backen` to 65–70 min | one revision: 4 (rule 1) |
| edit 2 names `zucker-tieg` | refused: edit 2, no ingredient `zucker-tieg`; nothing saved (rule 1) |
| remove `kakao` while "mischen" still uses it | refused (recipe rule 12); nothing saved |
| remove `kakao` and edit what "mischen" uses without it | revision 4 |
| Claude saves revision 4; then iPad saves from revision 3 | refused, iPad shows revision 4 (rule 2) |
| "Pasta" with plain steps: name the ingredients each step uses, in one batch | next revision, now with a flow (recipe rule 10) |
| "Pasta": name ingredients for 5 of 6 steps, Parmesan in none | refused (recipe rule 14) |
| remove section "Teig" | its ingredients and steps stay, without a section; the derived flow changes (recipe rule 11) |
| Claude saves a flow where "250 g Zupfteig" is never taken | refused (recipe rule 16) |
| revising a trashed recipe | refused (rule 4) |
| Claude's revision 5 cut the Zucker in Teig from 180 g to 120 g; the cook restores revision 4 | revision 6 with 180 g (rule 5) |
| restoring revision 6's own content | revision 7, same content |
| trashed Mon 12 Oct 2026, 18:00 Europe/Berlin; Tue 10 Nov 2026 | still restorable |
| the same, Wed 11 Nov 2026, 18:00 | purged, on every device ([sync.md](sync.md), rule 2) |
| Claude asks to empty the trash | refused (rule 7) |
| Claude trashes 5 duplicates, one already trashed last week | 4 trashed now, the fifth keeps its date; one change (rule 10) |
| Claude trashes 5 recipes, one purged meanwhile | refused, nothing trashed (rule 10) |
| "Zupfkuchen" was 3rd in "Weihnachten"; trashed, then restored | back at position 3 (rule 8) |
| tag "Kuchen" deleted while the recipe was in the trash | restored without "Kuchen" (rule 8) |
