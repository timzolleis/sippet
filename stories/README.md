# Stories

The use cases in domain words: who wants to do what, numbered constraints, concrete examples. The spec and the code follow from these; when they disagree, fix the story first.

| File | Covers |
|---|---|
| [recipe.md](recipe.md) | What a recipe is: ingredients, steps, the derived flow. The rules every add and revise checks. |
| [adding-recipes.md](adding-recipes.md) | Write a recipe; Claude imports one from a web page |
| [revising-recipes.md](revising-recipes.md) | Revise, restore a revision, trash, restore from trash |
| [library.md](library.md) | Tags, collections, smart collections, changed in batches of edits |
| [cooking.md](cooking.md) | Reading a recipe: table, steps, cook mode, scaling, units, search (views, not use cases) |
| [sync.md](sync.md) | Devices and Claude stay current |
| [account.md](account.md) | Passkeys, connecting Claude |
| [later.md](later.md) | Ideas kept out of the MVP |

Each story: frontmatter, a one-line intent, **Use cases** (with the rules each one checks), **Data**, **Rules**, **Examples**, **Open**. Rules are numbered per file and start with a bold name. Cite them as "rule 3" in the same file, "recipe rule 11" or "[recipe.md](recipe.md), rule 11" across files. Once built, a story also gets **Interface** and **Tests**.

**Open** lists decisions not yet made, each with a recommendation.

## Glossary

| Term | Meaning |
|---|---|
| owner | The person who runs the app and invites cooks. |
| cook | The person who owns an account and its library. |
| Claude | An MCP client the cook connected. Acts for the cook, with fewer rights (account rule 6). |
| device | One install of the app (iPhone, iPad, Mac). |
| library | All of one cook's recipes, tags, and collections. |
| recipe | Title, yield, ingredients, equipment, steps. Has revisions. |
| revision | One saved version of a recipe's content. Numbered 1, 2, 3 … per recipe. |
| ingredient | One line of the ingredient list: an item, an amount, a section. "180 g Zucker" in Teig. |
| item | What you buy, listed once per recipe. "180 g Zucker" in Teig and "200 g Zucker" in Füllung are two ingredients of the item Zucker. |
| prep | Something done to one ingredient alone before its step: "Zitronensaft: auspressen". |
| equipment | What you cook with: Springform 26 cm, Ofen, Mixer. |
| vessel | The equipment the yield is made in: "12 Stück" in a Springform 26 cm. |
| steps | The ordered instructions. Every recipe has them; a step may name the ingredients it **uses**. |
| flow | What goes where: which results and portions each step **takes** and which steps it waits for. Derived from the steps' ingredients, sections, equipment, and order (German: Ablauf). |
| plain steps | Steps that name no ingredients. No flow, no table. |
| prep step | A step that uses and takes nothing: "vorheizen". Makes nothing; a later step waits for it. |
| result | What a step makes: "Teig (750 g)". |
| portion | A named part of a result after a split: "500 g Boden", "250 g Zupfteig". |
| unit | From a fixed list (g, TL, cup, Pck., …), so it can be converted and translated; or the author's own word. |
| edit | One intent in a revision or a library change: "180 g → 120 g Zucker in Teig", "tag Zupfkuchen with Kuchen". Each is a batch of them. |
| key | What edits and flow steps point at: `zucker-teig`, `verkneten`. Unique in the recipe, kept across revisions. |
| yield | What the recipe makes: "12 Stück". |
| tag | A label on recipes: "Kuchen", "vegan". |
| collection | A hand-ordered list of recipes: "Weihnachten". |
| smart collection | A saved filter: "vegan, under 45 min". |
| trash | Where trashed recipes wait 30 days before they're purged. |
| change | One entry in the cook's sequence: something in the library changed. |
