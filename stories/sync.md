---
name: sync
description: Every device and Claude see the same library. A device loads it once, catches up after being away, and hears about changes live.
type: story
state: draft
---

# Sync

"Claude changes a recipe, and the iPad on the counter shows it."

Every change is recorded (rules 1, 4). A device loads the library once after sign-in (rule 6), then only catches up (rule 2) and listens (rule 3).

## Use cases

| Use case | Rules |
|---|---|
| A device loads the library after the cook signs in. | 1, 6 |
| A device catches up after being away. | 1, 2, 4, 6 |
| An open device hears about a change. | 3, 4 |
| A device reads the library offline. | 5 |

## Data

| Thing | Fields |
|---|---|
| change | number in the cook's sequence; what changed; who: a device or Claude |

## Rules

1. **One sequence per cook.** Every change to a cook's library gets the next number: a recipe added or revised; recipes trashed, restored, or purged; a batch of library edits ([library.md](library.md), rule 2). A device only asks "what changed after 41?".
2. **Catch up from the last number.** A device that was away catches up from the last number it saw, including what's gone: purged recipes, deleted tags and collections.
3. **Live within a second.** A device that is open hears about a change within about a second.
4. **Who did it.** Each change says who made it: which device, Claude, or the trash after 30 days ([revising-recipes.md](revising-recipes.md), rule 7). The app shows Claude's changes ("Claude revised Zupfkuchen").
5. **Read offline, change online.** A device reads, searches, and filters its library offline; changes need a connection. In the kitchen, reading must never fail. Editing offline needs conflict handling beyond [revising-recipes.md](revising-recipes.md) rule 2, so it's in [later.md](later.md).
6. **Load once.** After sign-in a device loads the whole library, the trash included, with the number of the last change in it. From then on it only catches up (rule 2). A device asking after a number the library hasn't reached loads again: its copy belongs to a library that no longer exists.

## Examples

| iPhone last saw change 41, then went offline | Result |
|---|---|
| Claude tags 3 recipes "Kuchen" (42), revises Zupfkuchen twice (43, 44) | — |
| iPhone comes back | catches up from 41: the 3 tagged recipes, Zupfkuchen at its latest revision once; shows "Claude changed 4 recipes" (rule 4) |
| iPad is open meanwhile | shows each change as it happens (rule 3) |
| iPhone in airplane mode | opens Zupfkuchen in cook mode; saving is unavailable (rule 5) |
| the cook signs in on a new iPad; the library is at change 44 | loads every recipe, the trash, tags, and collections, at 44 (rule 6) |
| the iPad asks for changes after 50; the library is at 44 | loads again (rule 6) |
