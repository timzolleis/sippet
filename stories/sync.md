---
name: sync
description: Every device and Claude see the same library. Devices catch up after being away and hear about changes live.
type: story
state: draft
---

# Sync

"Claude changes a recipe, and the iPad on the counter shows it."

The server phase records every change (rules 1, 4), so the app isn't blocked later. Catch-up and live updates (rules 2, 3) are served once the app exists.

## Use cases

| Use case | Rules |
|---|---|
| A device catches up after being away. | 1, 2, 4 |
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
5. **Read offline, change online.** A device reads its library offline; changes need a connection. In the kitchen, reading must never fail. Editing offline needs conflict handling beyond [revising-recipes.md](revising-recipes.md) rule 2, so it's in [later.md](later.md).

## Examples

| iPhone last saw change 41, then went offline | Result |
|---|---|
| Claude tags 3 recipes "Kuchen" (42), revises Zupfkuchen twice (43, 44) | — |
| iPhone comes back | catches up from 41: the 3 tagged recipes, Zupfkuchen at its latest revision once; shows "Claude changed 4 recipes" (rule 4) |
| iPad is open meanwhile | shows each change as it happens (rule 3) |
| iPhone in airplane mode | opens Zupfkuchen in cook mode; saving is unavailable (rule 5) |
