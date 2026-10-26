---
name: ios
description: The Sippet app for iPhone and iPad in SwiftUI. Sign-in, the library on the device, reading and cooking, library edits, trash, sync.
type: spec
state: draft
---

# iOS app

The library lives on the device and is read offline. The app catches up from the change log and listens for changes. It reads recipes as steps, ingredients, shopping totals, and in cook mode, with scaling and units. It changes tags, collections, and the trash; recipe edits stay with Claude. API: [device-api.md](device-api.md).

Host mapping:
- Swift 6 with strict concurrency, SwiftUI with `@Observable`, iOS 26, iPhone and iPad, no third-party packages.
- The cooking math is a port of `src/domain/cooking` and `recipeMatchesFilter`. It is checked against golden files the TypeScript domain generates.
- Free Apple account: Simulator, and personal-team builds on a phone (7 days). Nothing needs a paid entitlement.

Out of scope:
- Recipe edits, smart-collection editing, emptying the trash.
- Mac, Watch, Live Activities, background sync, photo import.

## Use cases

Stories: [cooking](../stories/cooking.md), [sync](../stories/sync.md), [library](../stories/library.md), [revising-recipes](../stories/revising-recipes.md), [account](../stories/account.md) rule 8. This spec ships:

| Use case | Rules | Where |
|---|---|---|
| The cook signs in on a device. | account 2, 8 | `SignInScreen`, `SignIn` |
| The cook signs a device out. | account 8 | `SettingsScreen` |
| A device loads the library, catches up, and hears about changes. | sync 1–4, 6 | `SyncEngine` |
| A device reads, searches, and filters the library offline. | sync 5, cooking 9, library 13, 14 | `LibraryStore`, `LibraryScreen` |
| The cook reads a recipe as a table. | cooking 1 | `recipeTable`, `RecipeTableScreen` |
| The cook reads a recipe as numbered steps, with its ingredients. | cooking 2, 3 | `RecipeScreen` |
| The cook sees what to buy for a recipe. | cooking 3 | `RecipeScreen` |
| The cook cooks along in cook mode. | cooking 4, 5 | `CookModeScreen` |
| The cook scales a recipe; reads it in other units or another language. | cooking 6–8 | `RecipeScreen` |
| The cook tags recipes and orders collections. | library 1–12 | `TagsSheet`, `CollectionSheet`, `LibraryScreen` |
| The cook moves recipes to the trash and restores them. | revising 6–10 | `LibraryScreen`, `TrashScreen` |

## Project

```text
ios/
├─ Sippet.xcodeproj            made once in Xcode, committed; synchronized folders, so new files don't touch project.pbxproj
├─ Sippet/                     the app target: SwiftUI only, no logic beyond view state
│  ├─ SippetApp.swift
│  ├─ Screens/                 one file per screen below
│  ├─ Localizable.xcstrings     de, en; "du" in German
│  └─ Info.plist               URL type de.bastelboxx.sippet; NSAppTransportSecurity.NSAllowsLocalNetworking
└─ SippetCore/                 Swift package (macOS 15 + iOS 26), no UIKit; `swift test` runs without Xcode
   ├─ Sources/SippetCore/
   │  ├─ Model/                Codable mirrors of device-api.md's views
   │  ├─ Cooking/              the ported cooking math, amountText
   │  ├─ Library/              LibraryStore, search, recipeMatchesFilter
   │  ├─ Sync/                 DeviceAPI, SyncEngine
   │  └─ Auth/                 PKCE, token exchange and refresh, TokenStore (Keychain)
   └─ Tests/SippetCoreTests/   golden tests read ../../../test/golden/*.json via #filePath
```

- Bundle id `de.bastelboxx.sippet`. Signing: automatic, personal team.
- Server: Debug uses `http://localhost:1337` (`pnpm dev`), overridable with the scheme environment variable `SIPPET_URL`. Release uses `https://sippet.bastelboxx.de`.
- The project is made by hand in Xcode (iOS App template, SwiftUI) and committed. With synchronized folders (Xcode 16+), adding a file needs no project change. `project.pbxproj` changes only for settings: the URL type, local networking, and the SippetCore package link.
- Rejected: XcodeGen. It exists to avoid `project.pbxproj` merge conflicts, which synchronized folders already avoid.
- Rejected: SwiftData. A personal library is a few MB, so one JSON file loads in milliseconds and has no migrations.

## SippetCore: the contract between the two Swift lanes

The app target uses only this surface. Names follow the TypeScript they port, so `rg` finds both sides.

```swift
// Model — field names as on the wire; dates ISO 8601
struct DeviceRecipe: Codable, Identifiable, Sendable, Hashable        // device-api.md Views
  { id, revision, title, yield: Yield, source: URL?, trashedAt: Date?, purgeAt: Date?, totalMinutes: Double?,
    sections: [RecipeSection], equipment: [Equipment], ingredients: [Ingredient], steps: [Step], hasFlow: Bool, makes: [String] }
enum AmountUnit: Codable { case code(UnitCode), custom(String) }    // "g" | {"custom": "Messerspitze"}
enum UnitCode: String, Codable, CaseIterable                        // mcp.md Unit codes, all 25
struct Amount { value: Double; max: Double?; unit: AmountUnit?; second: SecondAmount? }
struct Yield, RecipeSection, Equipment, Ingredient, Step, StepFlow, StepResult, Portion, StepDuration, Temperature
// RecipeSection, AmountUnit, StepDuration: not Section, Unit, Duration, which SwiftUI, Foundation, and the stdlib own
enum HeatingMode: String                                            // top_bottom, fan, top, bottom, grill
struct LibraryOrganization { tags: [TagView], collections: [CollectionView], smartCollections: [SmartCollectionView] }
struct RecipeFilter, TagFilter                                      // library rule 13
struct LibraryAtChange, ChangesAfter, ChangeView
enum LibraryEdit: Encodable                                         // the 13 ops of mcp.md Library edits

// Cooking — ports, same behavior as the TypeScript (golden-tested)
enum MeasurementSystem { case asWritten, metric, us }
enum Language { case de, en }                                       // the device language; anything else → en
func scaleRecipe(_ recipe: DeviceRecipe, toYield: Double) -> DeviceRecipe              // scaleRecipeContent
func measurableAmount(_ amount: Amount) -> Amount
func amountInMeasurementSystem(_ amount: Amount, system: MeasurementSystem) -> Amount
func temperatureInMeasurementSystem(_ t: Temperature, system: MeasurementSystem) -> ShownTemperature
func unitLabel(_ unit: AmountUnit, language: Language) -> String
func heatingModeLabel(_ mode: HeatingMode, language: Language) -> String
func itemTotals(_ recipe: DeviceRecipe) -> [ItemTotal]                                 // itemTotalsFromContent
func stepSentence(_ step: Step, in recipe: DeviceRecipe) -> String                     // stepSentenceFromStep, takes from step.flow
func recipeMatchesFilter(_ recipe: DeviceRecipe, tags: [String], filter: RecipeFilter) -> Bool
func amountText(_ amount: Amount, language: Language) -> String                        // Swift only, see below

// Library — the device's copy (sync rules 5, 6)
@MainActor @Observable final class LibraryStore {
  private(set) var seq: Int?; recipes: [String: DeviceRecipe]; organization: LibraryOrganization
  var library: [DeviceRecipe] { get }                    // not trashed, by title
  var trash: [DeviceRecipe] { get }                      // by purgeAt
  func tags(of recipeId: String) -> [String]
  func search(_ text: String, in recipes: [DeviceRecipe]) -> [DeviceRecipe]   // cooking 9: every word in title, ingredients, or steps
  func recipes(inCollection: String) / recipes(matching: SmartCollectionView) / recipes(taggedWith: String) -> [DeviceRecipe]
  init(file: URL)                                        // loads library.json at launch, before any network
}

// Sync
actor DeviceAPI { getLibrary(), listChangesAfter(_:), editLibrary(_:), trashRecipes(_:), restoreRecipes(_:), liveURLRequest() }
@MainActor @Observable final class SyncEngine {
  var state: SyncState                                   // .offline | .catchingUp | .live
  var lastNotice: ChangeNotice?                          // sync rule 4, for the banner
  func start(); func stop()                              // scene active / background
}
enum DeviceAPIError: Error { case signedOut, offline, refused([Problem]), notFound([String]), changesNotReached, server }

// Auth
struct SignIn { func authorizationURL() -> (URL, PKCEVerifier, state); func exchange(callback: URL, verifier:, state:) async throws }
actor TokenStore                                         // Keychain: refresh token, device id; access token in memory
```

### Search (cooking rule 9, library rule 13)

- Text: every word appears in the title, an ingredient's item, note, or prep, or a step's label or sentence. Matching ignores case and diacritics (`folding([.caseInsensitive, .diacriticInsensitive])`). Words under 3 letters match the title only. The server's trigram search behaves the same way, as mcp.md describes.
- Trashed recipes never appear (revising rule 6).
- Smart collections apply `recipeMatchesFilter` with the recipe's tags from `organization`.

### Amount text (cooking rules 7, 8)

This is display only and has no TypeScript counterpart.

```text
de  0,125 tsp + 1 g        → "⅛ TL (1 g)"        en → "⅛ tsp (1 g)"
de  1.5 kg                 → "1,5 kg"            the unit stays as given; itemTotals chooses kg for 500 g + 1 kg
de  60–65 min              → "60–65 Min."        en → "60–65 min"
en  2 packet               → "2 packets"         count units take the plural in en; de labels don't change ("2 Pck.")
de  6.25 oz                → "6¼ oz"
```

- Fractions ⅛ ¼ ⅜ ½ ⅝ ¾ ⅞ for the units rounded to fractions (cooking rule 7: tsp, tbsp, oz, cup, packet, piece). Every other unit is decimal, with a comma in de.
- No unit: just the number ("2 Eier" is `2` + the item).

## Sync (`SyncEngine`, sync rules 1–6)

```text
start()                                           scene becomes active
├─ store.seq == nil → getLibrary → replace store (sync 6)
├─ else listChangesAfter(seq) → apply
│    409 changesNotReached → getLibrary → replace (sync 6)
├─ open live socket (Authorization: Bearer)
│    {"seq": n}, n > store.seq → catch up; at most one in flight, and run again if a newer n came in meanwhile
│    close 4401 → refresh the token, reconnect; other close or failure → reconnect after 1, 2, 4 … 30 s
└─ state .live

apply(ChangesAfter)
├─ upsert recipes, delete purgedRecipeIds, replace organization, seq = n
├─ write library.json atomically
└─ lastNotice: the changes not made by this device, grouped by who:
     one recipe   → "Claude hat Zupfkuchen überarbeitet"
     several      → "Claude hat 4 Rezepte geändert"                    (sync rule 4)
stop()                                            scene goes to background: close the socket
```

- Every request sends `x-device-id` (a UUID created once and kept in the Keychain) and `x-device-name` (from Settings, percent-encoded UTF-8; the default is `UIDevice.current.model`: "iPhone" or "iPad").
- 401 → refresh once, single flight, then retry once. If the refresh fails → `signedOut`: the app shows `SignInScreen` and keeps `library.json` until the cook signs in again or signs out.
- Writes return the server's answer, but the store changes only through catch-up. The device's own change arrives as `{"seq"}` like any other, so there's one path into the store.
- Offline (sync rule 5): reads work. Write buttons are disabled with "Offline". Nothing is queued (later.md).

## Sign-in (account rule 8, device-api.md Sign-in)

```text
SignInScreen "Mit Passkey anmelden"
├─ GET <server>/.well-known/oauth-authorization-server → authorization_endpoint, token_endpoint
├─ SignIn.authorizationURL(): PKCE S256, random state, client_id sippet-app, redirect de.bastelboxx.sippet:/oauth,
│    scope offline_access, resource <server>/mcp
├─ ASWebAuthenticationSession(callback: .customScheme("de.bastelboxx.sippet")), prefersEphemeralWebBrowserSession = false
│    so the Safari session also signs in /account, which Settings opens
├─ SignIn.exchange(callback): checks state and iss, POST token_endpoint → TokenStore
└─ SyncEngine.start() → getLibrary
Sign out (Settings): POST revocation_endpoint (refresh token, best effort), delete the Keychain items and library.json
```

- Debug only: if the scheme environment has `SIPPET_REFRESH_TOKEN` and the Keychain has no token, it is stored. `pnpm device-token` prints one for `pnpm dev`. This is the way in when passkeys don't work in the Simulator (Verify 1).

## Screens (`ios/Sippet/Screens/`)

```text
SippetApp
├─ SignInScreen                    signed out
└─ LibraryScreen                   NavigationSplitView: sidebar | a NavigationStack rooted at the sidebar's choice; iPhone collapses
   │                               to one stack. A recipe or folder tile pushes with a zoom out of its art (navigationTransition(.zoom))
   ├─ sidebar     Alle Rezepte · Sammlungen (art mosaic) · Intelligente Sammlungen (filter symbol) · Tags (chips in the
   │              recipe art's colours) · Papierkorb · Einstellungen; each with its count
   ├─ list        art tile, title, total time, tags; .searchable over the current list (cooking 9), tags as search tokens
   │              Alle Rezepte: collections and smart collections as folder tiles above the recipes
   │              swipe → in den Papierkorb, Tags…; context menu → Tags…, Zu Sammlung…, aus der Sammlung entfernen (library 10)
   │              in a collection: EditButton reorders → reorder_collection with the full order (library 11)
   │              catch-ups, trashing, restoring, and moves slide rows in and out
   ├─ TagsSheet          toggles per tag + new tag → one batch of tag/untag edits (library 1, 3–5)
   ├─ CollectionSheet    toggles per collection + new collection → add_to_collection / remove_from_collection / create_collection
   ├─ TrashScreen        "wird am 24. Nov. gelöscht"; swipe → wiederherstellen (revising 7, 8)
   ├─ tag chips, collection rows and tiles: context menu → umbenennen, löschen (library 6, 8, 12); "name taken" shows the refusal's message
   └─ RecipeScreen                one scroll, no tab picker (see Look)
      ├─ header      the recipe's art on top; large title; a row of chips: yield stepper "12 Stück · Springform 26 cm"
      │              (cooking 6), total time, units menu: wie geschrieben | metrisch | US (cooking 8); source link;
      │              Schritte | Ablauf (only when recipeTable(recipe) isn't nil): Zutaten and Zubereitung, or the table
      ├─ Zutaten     by section, amount column bold and aligned, item and note after it (cooking 3);
      │              tap a row to check it off (struck through, dimmed); checks live as long as the screen
      ├─ Zubereitung numbered steps: the sentence, then the ingredients it uses with amounts in one quiet line,
      │              duration, temperature, equipment as small chips (cooking 2)
      │              iPad and landscape: Zutaten in a left column, Zubereitung right, each scrolling on its own
      ├─ Ablauf      RecipeTableScreen under the header, full width, in place of Zutaten and Zubereitung; iPad and
      │              landscape too (no columns). Tap a step: a card at the bottom with its sentence, ‹ ›, "Ab hier
      │              kochen" → CookModeScreen at that step (see Table)
      ├─ toolbar     Kochen (primary) · Einkaufen
      ├─ Einkaufen → sheet zooming out of its button: itemTotals "380 g Zucker (180 g Teig, 200 g Füllung)",
      │              checkable like Zutaten (cooking 3)
      └─ Kochen → CookModeScreen (full screen, zooming out of the button that opened it)
           chrome: a thin segmented progress bar (one segment per step) and a close button; nothing else at the top
           page: "Schritt 3 von 11" small; the step's ingredients with amounts large and bold, the results and portions it
             takes ("+ Masse"), then the sentence in large type (title, wraps freely); duration and temperature as chips (cooking 4)
           navigation: swipe, or tap the right or left third of the page; the last page ends with "Fertig"
           timer: a large pill on a step with a duration; tapped, it counts down in place; running timers stay in a bar
             at the bottom across pages, tap one to jump to its step; local notification at the end (cooking 5)
           reminders: a step a later step waits for (flow.waitsFor) shows as a quiet banner under the progress bar, from the
             step after it until the step that waits: at "mit dem Mixer gut verrühren": "Ofen auf 170 °C O/U vorheizen" (cooking 5)
           "Alle Zutaten": a button at the bottom opens the full checked list as a sheet
           the screen stays awake while open
SettingsScreen     units default, device name, "Konto verwalten" (opens <server>/account), abmelden
banner             SyncEngine.lastNotice, 4 s (sync 4); "Offline" pill while offline (sync 5); launch shows the library from disk at once, no pill until the first connect has tried
```

- Look: like Crouton. Calm, typographic, much white space, content over chrome. Large titles; amounts bold. No grouped-list boxes on the recipe and cook mode: plain backgrounds, hairline dividers, generous line height. One accent (paprika, account-ui.md) for the primary action, step numbers, and checks. SF Symbols, Dynamic Type up to accessibility sizes, dark mode. Library, sidebar, sheets, and settings stay standard SwiftUI lists, given colour by the recipe art: art tiles, collection mosaics, tag chips.
- Cook mode is for a phone propped on the counter at arm's length: the step text is the largest thing on screen, targets are at least 60 pt, and nothing needs precise taps.
- Scaling and units are view state per recipe screen. The units default comes from Settings.
- Refusals (`DeviceAPIError.refused`) show each problem's `message` in an alert. The app has no "fix" UI; the cook changes the input.

## Table (cooking rule 1, `SippetCore/Cooking/RecipeTable.swift`, `Screens/RecipeTableScreen.swift`)

The [Zupfkuchen-Ablauf](../stories/zupfkuchen-table.png), drawn from the recipe's content and its flow (`step.flow`). Swift only: no other client draws it yet.

```swift
func recipeTable(_ recipe: DeviceRecipe) -> RecipeTable?      // nil: no flow (recipe rule 10), or the flow can't be drawn (cooking 1)

struct RecipeTable: Sendable, Equatable { columns: Int; rows: [TableRow]; cells: [TableCell] }
enum TableRow: Sendable, Equatable { case prepStep(stepKey), section(sectionKey), ingredient(ingredientKey) }
struct TableCell: Sendable, Equatable { row: Int; rowSpan: Int; column: Int; columnSpan: Int; content: TableCellContent }
enum TableCellContent: Sendable, Equatable {
  case prepStep(stepKey)                          // full width: "Springform einfetten"
  case section(sectionKey, prepStepKeys: [String])   // "FÜLLUNG · jetzt Ofen auf 170 °C O/U vorheizen"
  case ingredient(ingredientKey)
  case prep(ingredientKey)                        // "auspressen", next to its ingredient (recipe rule 5)
  case step(stepKey, passingPortionKeys: [String])   // "verkneten (ergibt 750 g)"; a portion passing this column is written in it: "250 g für Zupfen"
  case empty                                      // an ingredient skipping a column
}
```

The table holds keys only. `RecipeTableScreen` renders text with the same functions as the rest of the app (scaled recipe, units, `amountText`), so the table follows the yield stepper and units.

```text
recipeTable(recipe)
├─ !recipe.hasFlow → nil
├─ rows
│    prep steps without a section (no uses, nothing taken, no section): full-width rows, at the top when they come
│      before every step in a section in the author's order, else at the bottom
│    per section in order: a section row, then its ingredients, reordered so the ingredients each step uses
│      directly sit together (stable: by the first step that uses them, then author's order)
│    ingredients without a section: last, without a section row
├─ columns
│    ingredient 0; its prep 1; a step 1 + the largest column of what it uses (an ingredient: 0, or 1 with prep)
│      and takes (a step, or the step that made a portion). waitsFor doesn't move a step.
├─ cells
│    a step spans the rows of every ingredient that reaches it through uses and takes, plus the section rows between them;
│      those rows must be contiguous, else nil
│    a section row spans from column 0 up to the first column a step crossing that row occupies
│    an ingredient row gets an empty cell for each column between its last filled one and the step that uses it
│    a portion from step A taken by step B is written in each column strictly between A and B, in the cell over its rows
│    a step that takes a portion shows the portion's amount before its text: "500 g als Boden in die Form drücken"
└─ step text: the label (recipe rule 8; the sentence is for the recipe screen and cook mode); temperature, duration, "(ergibt 750 g)" from the result
```

Cases (`swift test`, the Zupfkuchen from the golden file; expected is the picture)
  Zupfkuchen                 → 7 columns; rows: einfetten, TEIG, Mehl … Teigbutter, FÜLLUNG (vorheizen), Skyr … Puddingpulver
  mischen                    → column 1, rows Mehl … Salz;  verkneten → column 2, rows Mehl … Teigbutter; Teigbutter column 1 empty
  auspressen, schmelzen      → prep cells in column 1;  verrühren → column 2, rows Skyr … Füllbutter
  untermixen                 → column 3, rows Skyr … Puddingpulver; Puddingpulver columns 1, 2 empty
  boden                      → column 3, rows Mehl … Teigbutter, passing portion zupfteig ("250 g …")
  giessen, backen, auskühlen → columns 4, 5, 6, rows Mehl … Puddingpulver with the FÜLLUNG row; FÜLLUNG spans columns 0–3
  pasta with plain steps     → nil (recipe rule 10)
  a step whose ingredients sit in two sections with another section between them and no step joining it → nil

`RecipeTableScreen`: a view inside `RecipeScreen` (Ablauf), not a screen of its own. The page scrolls it down; it scrolls sideways itself, at reading size (no fit-to-screen, no pinch). The page's header carries title, vessel, and yield; the table's corner repeats the yield ("Für 12 Stück").
- Pinned: the ingredient column and the section names sideways; a header row with each column's step numbers under the bar while the table passes. A cell spanning many rows keeps its text in the part of it on screen.
- Ingredient column at most half the screen; step columns share what's left when the table is narrower than the screen. Dynamic Type up to AX1, where columns grow; past it, words would break inside cells.
- Tap an ingredient (or its prep): tick it, the same checks as Zutaten and cook mode (cooking 3). Tap a step (cell, header number, or the prep step in a section row): it is selected, its ingredients and the steps whose results it takes are tinted, the rest dims; the page shows its sentence (recipe rule 8).
- VoiceOver reads by step: the section where it starts, "Schritt 3, verkneten, (ergibt 750 g)", then the ingredients that step brings in.
- Hairlines in the accent's muted tint, drawn by each cell; section rows tinted; text centred in step cells and leading in ingredient cells, as in the picture. A custom SwiftUI `Layout` places cells by row, column, and spans (`Grid` has no row spans).

## Golden files (`scripts/golden.ts`, `test/golden/`)

```text
pnpm golden  → test/golden/cooking.json, committed
  { scaleRecipe, measurableAmount, amountInMeasurementSystem, temperatureInMeasurementSystem, unitLabel,
    heatingModeLabel, itemTotals, stepSentence, recipeMatchesFilter }: [{ input…, expected }]
  recipes in DeviceRecipe shape, built from test/domain/fixtures.ts with the domain's own functions
  (recipeFlowFromContent, recipeHasFlow, recipeTotalMinutesFromContent), as DeviceViews builds them
test/golden/golden.test.ts   regenerates in memory and fails when the committed file differs
```

A change to the TypeScript cooking math fails the vitest staleness check. Running `pnpm golden` then fails the Swift tests until the port follows. That is the price of 2B (two implementations), made visible.

## Cases

SippetCore (`swift test`):

```text
golden          every case in cooking.json, each function                           (cooking 3, 6–8, library 13)
                Zupfkuchen scaled to 6 → 150 g Mehl, ⅛ TL (1 g) Salz, ½ Pck. Vanillezucker; backen still 170 °C, 60–65 min
amountText      the table above
search          "zucker" finds Puderzucker; "rühr" finds verrühren; "Kase" finds Käsekuchen; a trashed recipe never   (cooking 9)
LibraryStore    library.json round-trips; library excludes trash; trash sorted by purgeAt
SyncEngine      (URLProtocol stub)
  no seq → getLibrary, seq stored                                                     (sync 6)
  seq 41 → changes → Zupfkuchen replaced, purged removed, notice "Claude hat 4 Rezepte geändert"   (sync 2, 4)
  409 → getLibrary                                                                    (sync 6)
  {"seq": 45} twice while a catch-up runs → exactly one more catch-up
  401 → one refresh, retried; refresh 400 → signedOut, library.json kept
  own change (by this device) → no notice
SignIn          authorizationURL has S256 challenge and state; exchange refuses a wrong state
```

App (Xcode, by hand against `pnpm dev`, then prod): Verify 1–3 below, then the use-case table top to bottom with the Zupfkuchen.

## Verify before building on it

1. In the Simulator, `ASWebAuthenticationSession` → `/connect` on `http://localhost:1337` creates and uses a passkey (RP ID `localhost`). If it doesn't, use the dev refresh token (above) for daily work, and test passkeys on a phone against prod.
2. On a phone with a personal-team build: sign in against `https://sippet.bastelboxx.de` with an iCloud Keychain passkey made on the Mac.
3. `URLSessionWebSocketTask` with an `Authorization` header reaches `/api/device/live` through the Worker (device-api.md Verify 4).
