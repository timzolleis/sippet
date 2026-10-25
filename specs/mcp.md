---
name: mcp
description: The MCP server Claude uses to read and change a cook's library. Tools, edit schema, results, refusals, retries.
type: spec
state: draft
---

# MCP server

Claude reads and changes one cook's library through these tools. Stories: [recipe](../stories/recipe.md), [adding-recipes](../stories/adding-recipes.md), [revising-recipes](../stories/revising-recipes.md), [library](../stories/library.md), [cooking](../stories/cooking.md) rules 9, 10, [account](../stories/account.md) rules 4–6.

Claude gets no tool for what it may not do (account rule 6): emptying the trash, passkeys, connections, deleting the account.

## Tools

| Tool | Input | Returns | Rules |
|---|---|---|---|
| `search_recipes` | `text?`, `tags?: {all?, any?, none?}`, `items?`, `maxTotalMinutes?`, `hasFlow?`, `collection?`, `smartCollection?`, `limit?` (20, max 100), `cursor?` | `recipes: RecipeSummary[]`, `cursor?` | cooking 9 |
| `get_recipe` | `recipeId`, `revision?` | `RecipeView` | cooking 10 |
| `list_revisions` | `recipeId` | `{revisions: Revision[]}`, newest first | revising 3 |
| `get_library` | — | `tags: {name, recipes}[]`, `collections: {name, recipes}[]`, `smartCollections: {name, filter}[]` | library |
| `list_trash` | — | `{recipes: {id, title, trashedAt, purgeAt}[]}` | revising 6, 7 |
| `add_recipe` | `title`, `yield`, `source?`, `edits: RecipeEdit[]` | `recipeId`, `revision: 1`, `recipe: RecipeView` | adding 1–4, 6 (photos, rule 5, later) |
| `edit_recipe` | `recipeId`, `fromRevision`, `edits: RecipeEdit[]` | `revision`, `recipe: RecipeView` | revising 1–4 |
| `restore_revision` | `recipeId`, `fromRevision`, `revision` | `revision`, `recipe: RecipeView` | revising 5 |
| `trash_recipes` | `recipeIds` | `{trashed: {id, purgeAt}[]}` | revising 6, 7, 10 |
| `restore_recipes` | `recipeIds` | `recipeIds` | revising 8–10 |
| `edit_library` | `edits: LibraryEdit[]` | as `get_library` | library 1–15 |

- Reads are `readOnlyHint: true`. Writes are `destructiveHint: false`: everything Claude does is undoable (account rule 6).
- `search_recipes` with `collection` returns the collection's order; with `text`, relevance; otherwise by title.
- `add_recipe`, `edit_recipe`, and `restore_revision` return the recipe with its derived flow, so Claude sees what followed from its steps (recipe rule 11) and can fix it right away.
- Results are objects: MCP structured content can't be a bare list.
- `list_trash` and `get_recipe` show trashed recipes; `search_recipes` doesn't.

## Types

```ts
Key      = string                                   // [a-z0-9-]+, unique in the recipe (recipe rule 20)
Unit     = UnitCode | { custom: string }            // recipe rule 2
Amount   = { value: number, max?: number, unit?: Unit,
             second?: { value: number, max?: number, unit?: Unit } }
Yield    = { amount: Amount, vessel?: Key }         // vessel: an equipment key (recipe rule 9)
Duration = { minutes: number, maxMinutes?: number, kind: "active" | "passive" }
Temperature = { celsius: number, maxCelsius?: number, mode?: HeatingMode }
Result   = { name?: string, amount?: Amount, split?: Portion[] }
Portion  = { key: Key, name: string, amount?: Amount, rest?: true }
Position = "start" | "end" | { after: Key }
```

Total time is the sum of each step's `maxMinutes ?? minutes`.

### Unit codes

| Kind | Code | de | en |
|---|---|---|---|
| mass | `g`, `kg`, `oz`, `lb` | g, kg | g, kg, oz, lb |
| volume | `ml`, `cl`, `l`, `tsp`, `tbsp`, `cup`, `fl_oz` | ml, cl, l, TL, EL, Tasse | ml, cl, l, tsp, tbsp, cup, fl oz |
| count | `piece`, `serving`, `pinch`, `packet`, `can`, `tub`, `bottle`, `bunch`, `clove`, `slice`, `sheet`, `sprig`, `drop`, `handful` | Stück, Portion, Prise, Pck., Dose, Becher, Fl., Bund, Zehe, Scheibe, Blatt, Zweig, Tropfen, Handvoll | piece, serving, pinch, packet, can, tub, bottle, bunch, clove, slice, sheet, sprig, drop, handful |

`tsp` = 5 ml, `tbsp` = 15 ml, `cup` = 240 ml. Count units convert to nothing; they're only translated (cooking rule 8).

### Heating modes

| Code | de | en |
|---|---|---|
| `top_bottom` | Ober-/Unterhitze (O/U) | conventional |
| `fan` | Umluft | fan |
| `top` | Oberhitze | top heat |
| `bottom` | Unterhitze | bottom heat |
| `grill` | Grill | grill |

## Recipe edits

Applied in order to the base revision (an empty recipe for `add_recipe`), checked once at the end (revising rule 1). Keys may point at things added later in the batch.

| `op` | Fields |
|---|---|
| `set_title` | `title` |
| `set_yield` | `yield: Yield` |
| `add_section` | `key`, `name`, `at?` |
| `rename_section` | `key`, `name` |
| `remove_section` | `key`. Its ingredients and steps stay, without a section. |
| `rename_item` | `from`, `to`. To an existing name, the ingredients join that item. |
| `add_ingredient` | `key`, `item`, `amount?`, `section?`, `note?`, `prep?`, `optional?`, `at?` |
| `edit_ingredient` | `key`, then any of `item`, `amount`, `section`, `note`, `prep`, `optional` |
| `move_ingredient` | `key`, `at`, `section?` |
| `remove_ingredient` | `key` |
| `add_equipment` | `key`, `name` |
| `edit_equipment` | `key`, `name` |
| `remove_equipment` | `key` |
| `add_step` | `key`, `label`, `sentence?`, `section?`, `equipment?: Key[]`, `duration?`, `temperature?`, `uses?: Key[]`, `result?`, `takes?: Key[]`, `waitsFor?: Key[]`, `at?` |
| `edit_step` | `key`, then any `add_step` field but `at` |
| `move_step` | `key`, `at`, `section?` |
| `remove_step` | `key` |

- `edit_*` changes only the fields it names. `null` clears an optional field.
- `takes` and `waitsFor` replace the derived links (recipe rule 11). Absent or `null`: derived. `[]`: nothing.
- `at` defaults to `"end"` on `add_*`.
- `add_ingredient` with a new item name adds the item (recipe rule 3).

### The Zupfkuchen

```jsonc
{ "title": "Veganer Russischer Zupfkuchen",
  "yield": { "amount": { "value": 12, "unit": "piece" }, "vessel": "springform" },
  "edits": [
    { "op": "add_equipment", "key": "springform", "name": "Springform 26 cm" },
    { "op": "add_equipment", "key": "ofen", "name": "Ofen" },
    { "op": "add_section", "key": "teig", "name": "Teig" },
    { "op": "add_section", "key": "fuellung", "name": "Füllung" },
    { "op": "add_ingredient", "key": "mehl", "item": "Mehl", "amount": { "value": 300, "unit": "g" }, "section": "teig" },
    // … zucker-teig, vanillezucker, backpulver, kakao
    { "op": "add_ingredient", "key": "salz", "item": "Salz", "section": "teig",
      "amount": { "value": 0.25, "unit": "tsp", "second": { "value": 2, "unit": "g" } } },
    { "op": "add_ingredient", "key": "butter-teig", "item": "vegane Butter", "amount": { "value": 200, "unit": "g" }, "section": "teig" },
    { "op": "add_ingredient", "key": "zitronensaft", "item": "Zitronensaft", "amount": { "value": 30, "unit": "g" },
      "section": "fuellung", "prep": "auspressen" },
    { "op": "add_ingredient", "key": "butter-fuellung", "item": "vegane Butter", "amount": { "value": 100, "unit": "g" },
      "section": "fuellung", "prep": "schmelzen" },
    // … skyr, zucker-fuellung, zitronenaroma, zitronenschale, puddingpulver
    { "op": "add_step", "key": "einfetten", "label": "Springform einfetten", "equipment": ["springform"],
      "sentence": "Springform einfetten, optional mit Backpapier auslegen." },
    { "op": "add_step", "key": "mischen", "label": "mischen", "section": "teig",
      "uses": ["mehl", "zucker-teig", "vanillezucker", "backpulver", "kakao", "salz"] },
    { "op": "add_step", "key": "verkneten", "label": "verkneten", "section": "teig", "uses": ["butter-teig"],
      "result": { "name": "Teig", "amount": { "value": 750, "unit": "g" },
                  "split": [{ "key": "boden-teig", "name": "Boden", "amount": { "value": 500, "unit": "g" } },
                            { "key": "zupfteig", "name": "Zupfteig", "amount": { "value": 250, "unit": "g" } }] } },
    { "op": "add_step", "key": "boden", "label": "als Boden in die Form drücken, Rand ca. 2,5 cm", "section": "teig",
      "equipment": ["springform"], "takes": ["boden-teig"] },
    { "op": "add_step", "key": "vorheizen", "label": "Ofen vorheizen", "section": "fuellung", "equipment": ["ofen"],
      "temperature": { "celsius": 170, "mode": "top_bottom" } },
    { "op": "add_step", "key": "verruehren", "label": "mit dem Mixer gut verrühren", "section": "fuellung",
      "uses": ["skyr", "zucker-fuellung", "zitronensaft", "zitronenaroma", "zitronenschale", "butter-fuellung"],
      "result": { "name": "Masse" } },
    { "op": "add_step", "key": "untermixen", "label": "Puddingpulver untermixen, bis die Masse glatt ist",
      "section": "fuellung", "uses": ["puddingpulver"], "result": { "name": "Füllung" } },
    { "op": "add_step", "key": "giessen", "label": "Füllung auf den Boden gießen, restlichen Teig als Zupfen darauf verteilen" },
    { "op": "add_step", "key": "backen", "label": "backen", "equipment": ["ofen"],
      "duration": { "minutes": 60, "maxMinutes": 65, "kind": "passive" },
      "temperature": { "celsius": 170, "mode": "top_bottom" } },
    { "op": "add_step", "key": "auskuehlen", "label": "im geöffneten Ofen vollständig auskühlen", "equipment": ["ofen"],
      "result": { "name": "Zupfkuchen" } }
  ] }
```

Derived: `verkneten` takes `mischen`; `verruehren` is the first maker in Füllung; `untermixen` takes `verruehren`; `giessen` takes `boden`, `untermixen`, and `zupfteig`; `backen` takes `giessen` and waits for `vorheizen`; `boden` waits for `einfetten`; `auskuehlen` takes `backen`.

## Library edits

Recipes by id; tags and collections by name, ignoring case (library rules 3, 9).

| `op` | Fields |
|---|---|
| `tag` | `tag`, `recipeIds` |
| `untag` | `tag`, `recipeIds` |
| `rename_tag` | `tag`, `to` |
| `merge_tags` | `tag`, `into` |
| `delete_tag` | `tag` |
| `create_collection` | `name`, `recipeIds?` |
| `add_to_collection` | `collection`, `recipeIds` |
| `remove_from_collection` | `collection`, `recipeIds` |
| `reorder_collection` | `collection`, `recipeIds` (the full order) |
| `rename_collection` | `collection`, `to` |
| `delete_collection` | `collection` |
| `save_smart_collection` | `name`, `newName?`, `filter` |
| `delete_smart_collection` | `name` |

```ts
Filter = { tags?: { all?: string[], any?: string[], none?: string[] }, items?: string[],
           maxTotalMinutes?: number, hasFlow?: boolean, text?: string }
```

## Reading

```ts
RecipeSummary = { id, title, yield: Yield, tags: string[], revision: number,
                  totalMinutes?: number, hasFlow: boolean, source?: string, trashedAt?: string }

RecipeView = {
  id, revision, latestRevision, title, yield: Yield, source?,
  tags: string[], collections: string[], trashedAt?, purgeAt?,
  sections: { key, name }[], equipment: { key, name }[],
  ingredients: { key, item, amount?, section?, note?, prep?, optional? }[],
  steps: (StepAsWritten & { flow?: { takes: Key[], waitsFor: Key[], makes: boolean } })[],
  hasFlow: boolean, makes: Key[]                        // recipe rule 18
}

Revision = { revision, at, by: { kind: "device" | "claude", name },
             was: { added: true } | { edits: RecipeEdit[] } | { restored: number } }
```

- Steps come as written, in the same fields edits use, so Claude copies values from what it read.
- `flow` is present when the recipe has one: the derived links merged with what the step names.

## Refusals

A refused write is a tool result with `isError: true`, so Claude reads it:

```json
{ "refused": true,
  "problems": [
    { "edit": 2, "message": "no ingredient \"zucker-tieg\"" },
    { "rule": "recipe 14", "message": "ingredient \"kakao\" is used by no step" },
    { "rule": "recipe 15", "message": "result of \"verkneten\" is taken by \"boden\" and \"giessen\" (derived: join)" }
  ],
  "latestRevision": 4 }
```

- Every problem at once (revising rule 1, library rule 1). `edit` is the 1-based position in the batch.
- A problem from a derived link says which derivation made it (chain, join, prep step).
- A stale `fromRevision` (revising rule 2) returns `latestRevision`; Claude reads it with `get_recipe` and rebuilds the batch.
- A protocol error is for a bad session or token, and for input that doesn't decode (a bad key or unit: `-32602` naming the path, no edit number).

## Retries

The same write from the same connection with the same arguments within 10 minutes returns the stored first result and changes nothing. Only a connection's latest write can be retried: any other write from that connection drops its stored result, so tag → untag → tag applies all three. Stored per cook as `(connection, tool, hash of canonical arguments) → result`, dropped after 10 minutes. Reads aren't stored.

This covers `add_recipe` without a source and renames. `edit_recipe` is safe through `fromRevision` but would otherwise return a refusal to its own retry.

## Instructions

Sent once per session as the server's `instructions`, not repeated in each tool:

> Sippet is the cook's recipe library. Read before you write: `get_recipe` gives the revision to pass as `fromRevision`.
>
> Write recipes as steps, the way the source has them. Give every section, ingredient, step, equipment, and portion a short key (`zucker-teig`, `verkneten`). Name the ingredients each step uses; the flow follows: a step takes the result of the previous step in its section, a step without a section joins the sections before it, and a step that uses nothing (vorheizen) is waited for by the next step with the same equipment. Put parallel parts in sections. Put one-ingredient work (auspressen, schmelzen) on the ingredient as `prep`. Name `takes` only where the derived flow is wrong, as for split portions. Check the returned `flow`.
>
> Use unit codes (`g`, `tsp`, `packet`, `tub`, …); `{ "custom": "Messerspitze" }` for anything else. Durations in minutes; none if the source gives no length.
>
> A refusal lists every problem. Fix them all and send the batch again.

## Transport and auth

- Streamable HTTP at `/mcp`, `effect/ai` `McpServer.layerHttp` with sessions; protocols `2025-06-18`, `2025-11-25`, `2026-07-28`. Stateless once Claude speaks `2026-07-28`.
- OAuth through `@better-auth/mcp` with DCR (account rule 4). The token's subject is the cook; the Worker routes to that cook's `CookLibrary`.
- The connection id from the token goes into every change (sync rule 4) and the retry key.
- Hosting, auth setup, and storage: [hosting.md](hosting.md).
