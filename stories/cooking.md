---
name: cooking
description: Ways to read a recipe (table, steps, cook mode, scaling, units, search, and the structured form Claude reads). Views only; nothing in the library changes.
type: story
state: draft
---

# Cooking

"The cook reads the recipe the way the kitchen needs it right now."

Views, not use cases: nothing in the library changes. All of them follow from the content ([recipe.md](recipe.md)). For the server phase only rules 9 and 10 matter: what Claude can search and read.

## Use cases

| Use case | Rules |
|---|---|
| The cook reads a recipe as a table. | 1 |
| The cook reads a recipe as numbered steps, with its ingredients. | 2, 3 |
| The cook sees what to buy for a recipe. | 3 |
| The cook cooks along in cook mode. | 4, 5 |
| The cook scales a recipe to another yield. | 6, 7 |
| The cook reads a recipe in other units or another language. | 7, 8 |
| The cook or Claude searches the library. | 9 |
| Claude reads a recipe. | 10 |

## Rules

1. **Table.** Like the [Zupfkuchen-Ablauf](zupfkuchen-ablauf.png). Only for recipes with a flow (recipe rule 10).
   - Header: title, vessel, and yield.
   - Ingredients in the left column, by section. A step spans the rows of every ingredient that reaches it, and stands in the column of its longest path from them. An ingredient that skips a column leaves its cell empty.
   - An ingredient's prep stands in the column next to it (recipe rule 5).
   - A prep step without a section spans the full width at its place ("Springform einfetten"); one in a section stands in that section's header ("FÜLLUNG · jetzt Ofen auf 170 °C O/U vorheizen").
   - A portion passing a column is written in it: "250 g Zupfteig".
   - Within a section, rows are reordered so each step's ingredients sit together, otherwise in the author's order. A flow that can't be drawn this way has no table.
2. **Steps.** A numbered list in the author's order (recipe rule 19), for every recipe.
3. **Ingredients.** While cooking, ingredients by section (recipe rule 6): "Teig: 180 g Zucker". For shopping and checking the pantry, totals per item with the split: "380 g Zucker (180 g Teig, 200 g Füllung)". Amounts of the same kind add up (500 g + 1 kg = 1,5 kg); others are listed side by side. Amounts are scaled (rule 6). A combined "380 g Zucker" while cooking invites putting it all into the dough.
4. **Cook mode.** One step at a time, large. Shows the ingredients this step uses and the results and portions it takes, with amounts. With plain steps, the full list.
5. **Timers and reminders.** Cook mode offers a timer for each step with a duration (recipe rule 7). It reminds about steps something else waits for (recipe rule 17) early enough: "jetzt Ofen vorheizen" while the filling is being made.
6. **Scaling.** The cook picks a yield ("6 Stück"). Ingredient amounts, portions, and results scale by the same factor. Durations, temperatures, and equipment don't. Scaling to another vessel (26 cm → 20 cm Springform) is in [later.md](later.md).
7. **Measurable amounts.** Scaled and converted amounts are rounded to what a cook can measure: g and ml to 5 (under 20 to 1), TL and EL to ⅛, oz and cup to ¼, Pck. and Stück to ½. A nonzero amount never rounds to 0; it rounds up to the smallest step ("1 g", "⅛ TL"). Other units aren't rounded. The second amount stays alongside ("⅛ TL (1 g) Salz").
8. **Units and language.** A device shows recipes in its language and a measurement system: as written, metric, or US. A recipe can be switched for the moment ("show in US units"). Mass converts within mass, volume within volume (TL = 5 ml, EL = 15 ml, cup = 240 ml), °C to °F. Unit names and heating modes are translated ("TL" ↔ "tsp", "O/U" ↔ "conventional"); the author's own units, item names, and steps stay as written. Volume to mass ("1 cup Mehl" in g) needs a density per item and is in [later.md](later.md).
9. **Search.** Text across title, ingredients, and steps, with the filters of smart collections ([library.md](library.md), rule 13). Trashed recipes never appear ([revising-recipes.md](revising-recipes.md), rule 6).
10. **For Claude.** The recipe as structured data, as written, with the same content and revision number a device sees, so Claude can revise it ([revising-recipes.md](revising-recipes.md), rule 2). The derived flow comes with it, marked as derived (recipe rule 11), so Claude sees what follows from its steps.

## Examples

| Zupfkuchen, 12 Stück, unless named | Result |
|---|---|
| as a table | the [Zupfkuchen-Ablauf](zupfkuchen-ablauf.png) (rule 1) |
| scaled to 6 Stück | 150 g Mehl, ⅛ TL (1 g) Salz, ½ Pck. Vanillezucker, "500 g als Boden" becomes 250 g; backen still 170 °C, 60–65 min |
| ingredients for shopping | 380 g Zucker (180 g Teig, 200 g Füllung), 300 g vegane Butter (200 g Teig, 100 g Füllung) |
| cook mode at "Puddingpulver untermixen" | shows 2 Pck. Puddingpulver and "Masse" from the step before |
| cook mode at "mit dem Mixer gut verrühren" | reminds: Ofen auf 170 °C vorheizen (backen waits for it) |
| on an English iPad, in US units | "6¼ oz Zucker" (not "sugar"), "2 Pck. Puddingpulver" as "2 packets", backen at 340 °F conventional (rule 8) |
| "Pasta" with plain steps | no table (rule 1); steps and cook mode work |
