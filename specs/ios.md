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
- The table view (cooking rule 1).
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
| The cook reads a recipe as numbered steps, with its ingredients. | cooking 2, 3 | `RecipeScreen` |
| The cook sees what to buy for a recipe. | cooking 3 | `RecipeScreen` |
| The cook cooks along in cook mode. | cooking 4, 5 | `CookModeScreen` |
| The cook scales a recipe; reads it in other units or another language. | cooking 6–8 | `RecipeScreen` |
| The cook tags recipes and orders collections. | library 1–12 | `TagsSheet`, `CollectionSheet`, `LibraryScreen` |
| The cook moves recipes to the trash and restores them. | revising 6–10 | `LibraryScreen`, `TrashScreen` |

## Project

```text
ios/
├─ project.yml                 XcodeGen spec; `xcodegen` writes Sippet.xcodeproj (git-ignored)
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
- Rejected: a committed `.xcodeproj`. Parallel branches can't merge it. `project.yml` is text, and `brew install xcodegen` is a one-time step.
- Rejected: SwiftData. A personal library is a few MB, so one JSON file loads in milliseconds and has no migrations.

## SippetCore: the contract between the two Swift lanes

The app target uses only this surface. Names follow the TypeScript they port, so `rg` finds both sides.

```swift
// Model — field names as on the wire; dates ISO 8601
struct DeviceRecipe: Codable, Identifiable, Sendable, Hashable        // device-api.md Views
  { id, revision, title, yield: Yield, source: URL?, trashedAt: Date?, purgeAt: Date?, totalMinutes: Double?,
    sections: [Section], equipment: [Equipment], ingredients: [Ingredient], steps: [Step], hasFlow: Bool, makes: [String] }
enum Unit: Codable { case code(UnitCode), custom(String) }          // "g" | {"custom": "Messerspitze"}
enum UnitCode: String, Codable, CaseIterable                        // mcp.md Unit codes, all 25
struct Amount { value: Double; max: Double?; unit: Unit?; second: SecondAmount? }
struct Yield, Section, Equipment, Ingredient, Step, StepFlow, StepResult, Portion, Duration, Temperature
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
func unitLabel(_ unit: Unit, language: Language) -> String
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

- Every request sends `x-device-id` (a UUID created once and kept in the Keychain) and `x-device-name` (from Settings; the default is `UIDevice.current.model`: "iPhone" or "iPad").
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
└─ LibraryScreen                   NavigationSplitView: sidebar | list | RecipeScreen; iPhone collapses to a stack
   ├─ sidebar     Alle Rezepte · Sammlungen · Intelligente Sammlungen · Tags · Papierkorb (count) · Einstellungen
   ├─ list        title, total time, tags; .searchable over the current list (cooking 9)
   │              swipe → in den Papierkorb; context menu → Tags…, Zu Sammlung…
   │              in a collection: EditButton reorders → reorder_collection with the full order (library 11)
   ├─ TagsSheet          toggles per tag + new tag → one batch of tag/untag edits (library 1, 3–5)
   ├─ CollectionSheet    toggles per collection + new collection → add_to_collection / remove_from_collection / create_collection
   ├─ TrashScreen        "wird am 24. Nov. gelöscht"; swipe → wiederherstellen (revising 7, 8)
   ├─ tag and collection rows: context menu → umbenennen, löschen (library 6, 8, 12); "name taken" shows the refusal's message
   └─ RecipeScreen
      ├─ header      title, yield stepper (cooking 6), units menu: wie geschrieben | metrisch | US (cooking 8), source link
      ├─ picker      Schritte | Zutaten | Einkauf
      │    Schritte  numbered stepSentence; duration, temperature, equipment per step (cooking 2)
      │    Zutaten   by section: "Teig: 180 g Zucker" (cooking 3)
      │    Einkauf   itemTotals: "380 g Zucker (180 g Teig, 200 g Füllung)" (cooking 3)
      └─ Kochen → CookModeScreen (full screen)
           one step per page, large type; the ingredients it uses with amounts, the results and portions it takes (cooking 4)
           a step with a duration: timer button; countdown in the page, local notification at the end (cooking 5)
           a step a later step waits for (flow.waitsFor) stays pinned as a reminder from the step after it until the step that waits:
             at "mit dem Mixer gut verrühren": "Ofen auf 170 °C O/U vorheizen" (cooking 5 example)
           the screen stays awake while open
SettingsScreen     units default, device name, "Konto verwalten" (opens <server>/account), abmelden
banner             SyncEngine.lastNotice, 4 s (sync 4); "Offline" pill while offline (sync 5)
```

- Look: system SwiftUI, with no custom chrome. Accent is the paprika from account-ui.md. Use SF Symbols, Dynamic Type, and dark mode.
- Scaling and units are view state per recipe screen. The units default comes from Settings.
- Refusals (`DeviceAPIError.refused`) show each problem's `message` in an alert. The app has no "fix" UI; the cook changes the input.

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
