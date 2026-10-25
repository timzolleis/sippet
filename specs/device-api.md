---
name: device-api
description: The HTTP API the Sippet app uses. Device sign-in through the existing OAuth server, loading and catching up the library, live change notices, library edits, trash and restore.
type: spec
state: draft
---

# Device API

The app reads the whole library onto the device and catches up from the change log. Its writes are library edits, trash, and restore; recipe edits stay with Claude for now. Built on [hosting.md](hosting.md): the same Worker, token check, `CookLibrary`, `Library` store, and domain services. The client is [ios.md](ios.md).

Host mapping:
- Tenant: the cook, one `CookLibrary` per `sub`.
- Actor: `{ kind: "device", device: <device name> }`, a `ChangeAuthor` (`src/domain/shared/change-author.ts`). It has no access flags: a device may do in the library what the cook may (account rule 8).
- Effect 4 `HttpApi` inside the DO, in effect-ddd style.

Out of scope:
- Recipe edits from the app: add, revise, restore a revision.
- Emptying the trash.
- Per-device connections (later.md).
- Search on the server. The device searches its own copy (sync rule 5).

## Use cases

Stories: [sync](../stories/sync.md), [account](../stories/account.md) rule 8, [library](../stories/library.md), [revising-recipes](../stories/revising-recipes.md). This spec ships:

| Use case | Rules | Endpoint |
|---|---|---|
| The cook signs in on a device. | account 2, 8 | OAuth, client `sippet-app` |
| A device loads the library after the cook signs in. | sync 1, 6 | `getLibrary` |
| A device catches up after being away. | sync 1, 2, 4, 6 | `listChangesAfter` |
| An open device hears about a change. | sync 3 | `live` |
| The cook changes the library with a batch of edits, on a device. | library 1–15 | `editLibrary` |
| The cook moves recipes to the trash. | revising 6, 7, 10 | `trashRecipes` |
| The cook restores recipes from the trash. | revising 8–10 | `restoreRecipes` |
| The cook signs a device out. | account 8 | client only ([ios.md](ios.md)) |

## Affected use cases

```text
The cook disconnects "Sippet app" on the account page: every device's next request gets 401 and its live socket closes (account rule 8).
Claude's token on /api/device/*: 401. A device's token on /mcp: 401 (account rule 6).
Every write, Claude's and the trash alarm's included, sends {"seq"} to open live sockets (sync rule 3).
```

## Sign-in (`src/auth.ts`)

The app is one pre-registered public OAuth client. It signs in through `/connect`, as Claude does. No new page, no password, no Associated Domains: the passkey ceremony runs on the website inside `ASWebAuthenticationSession`.

```ts
// the oauthClient row, created once per database, idempotent
{ clientId: "sippet-app", name: "Sippet app", type: "native", public: true (tokenEndpointAuthMethod "none"),
  redirectUris: ["de.bastelboxx.sippet:/oauth"],       // RFC 8252 private-use, reverse domain, no authority
  grantTypes: ["authorization_code", "refresh_token"], responseTypes: ["code"],
  scopes: ["offline_access"], requirePKCE: true, skipConsent: false }
// linked to the resource <PUBLIC_URL>/mcp, as mcp() links every DCR client
```

```text
app → GET  <authorization_endpoint>?client_id=sippet-app&redirect_uri=de.bastelboxx.sippet:/oauth&response_type=code
         &code_challenge=…&code_challenge_method=S256&scope=offline_access&resource=<PUBLIC_URL>/mcp&state=…
    → /connect: one passkey tap signs in and approves "Sippet app"   → connectApproved → CookLibrary.connectClient
    ← de.bastelboxx.sippet:/oauth?code=…&state=…&iss=…
app → POST <token_endpoint> (code, code_verifier)  → access token (1 h, azp "sippet-app"), refresh token (30 days, rotated)
```

- The client is created by `ensureDeviceClient(env)`, once per isolate, before the first `/api/auth/*` request. It does an insert-if-missing of the client and its resource link, so dev and prod need no manual step.
- `skipConsent: false`: `/connect` already signs in and approves in one tap, and the approval is what creates the connection row (`connectApproved`).
- Rejected: a second resource (`<PUBLIC_URL>/api/device`) to separate device and Claude tokens by audience. It needs per-client resource links and seeding for both. `azp` separates them with one string compare.
- Cost: all devices share one connection. Disconnecting signs out every device (account rule 8).

## Request path

```text
Worker
├─ /mcp                 verifyAccessToken; azp = "sippet-app" → 401            (account rule 6)
├─ /api/device/*        verifyAccessToken; azp ≠ "sippet-app" → 401            (account rule 6)
│    forward to CookLibrary.getByName(sub) with sippet-cook, sippet-connection, sippet-issued-at, sippet-expires-at (exp);
│    x-device-id and x-device-name pass through; WebSocket upgrades are forwarded as they are
└─ (rest unchanged, hosting.md)

CookLibrary.fetch(request)
├─ isRefused({ connection, issuedAt }) → 401                                    (unchanged: disconnects)
├─ /mcp                                 → mcp handler
├─ /api/device/live + Upgrade           → acceptLive
└─ /api/device/*                        → device handler (DeviceApi)
```

`verifyAccessToken` takes the expected `azp` rule as a parameter. Everything else about it is unchanged (hosting.md Token check).

## Endpoints (`src/device/device-api.ts`)

```text
GET  /api/device/library                     getLibrary         200 LibraryAtChange                        sync 1, 6
GET  /api/device/changes?after=41            listChangesAfter   200 ChangesAfter | 409                     sync 1, 2, 4, 6
GET  /api/device/live   (WebSocket)          live               101; server → {"seq": 45}                  sync 3
POST /api/device/library/edits {edits}       editLibrary        200 LibraryOrganization | 422              library 1–15
POST /api/device/recipes/trash {recipeIds}   trashRecipes       200 {recipes: DeviceRecipe[]} | 404        revising 6, 7, 10
POST /api/device/recipes/restore {recipeIds} restoreRecipes     200 {recipes: DeviceRecipe[]} | 404        revising 8–10
```

Every request carries `x-device-id` (a UUID, made once per install) and `x-device-name` (1–40 characters, "iPad", percent-encoded UTF-8 so "Tim’s iPhone" survives the header). `DeviceMiddleware` decodes them into `CurrentDevice { connection, deviceId, deviceName }`. Missing or malformed: `DeviceUnknownHttpError` 400.

## Views (`src/device/device-views.ts`)

```ts
DeviceRecipe = {                                   // the latest revision, as written, with its flow
  id, revision, title, yield: Yield, source?, trashedAt?, purgeAt?, totalMinutes?,
  sections: Section[], equipment: Equipment[], ingredients: Ingredient[],
  steps: (Step & { flow?: { takes: Key[], waitsFor: Key[], makes: boolean } })[],
  hasFlow: boolean, makes: Key[] }
// The content schemas are the domain's (src/domain/recipe/recipe-content.ts), fully typed, not JsonObject: the app decodes them.
// The same as mcp.md's RecipeView without tags and collections: those come from LibraryOrganization,
// because a library edit changes them without a revision.

LibraryOrganization = {
  tags:             { name, recipeIds }[],         // trashed recipes included (revising rule 8)
  collections:      { name, recipeIds }[],         // the cook's order
  smartCollections: { name, filter: RecipeFilter }[] }

LibraryAtChange = { seq, recipes: DeviceRecipe[], ...LibraryOrganization }        // library and trash

ChangesAfter = {
  seq,                                              // the last change; the device stores it
  changes: ChangeView[],                            // after `after`, oldest first, at most the newest 100
  recipes: DeviceRecipe[],                          // each recipe a change after `after` named, current state, once; purged ones left out
  purgedRecipeIds: string[],
  ...LibraryOrganization }                          // always whole: small, and edits like merge_tags touch recipes no change names

ChangeView = { seq, at, by: { kind: "claude" | "device" | "trash", name }, kind: ChangeKind, recipeIds: string[] }
// recipeIds: added/revised → [id]; trashed/restored/purged → their ids; library_changed → the ids its edits name
// by.name: the connection's name for Claude ("Claude"), the device name, "Trash"
```

```text
DeviceViews.getLibrary(): LibraryAtChange
DeviceViews.listChangesAfter({ after }): Effect<ChangesAfter, ChangesNotReachedError>     // after > last seq (sync rule 6)
```

- Each view reads in one synchronous pass over the DO's SQLite, so `seq` and the contents agree. No write interleaves inside a DO request without an `await`.
- Built: a `library_changed` change names recipe ids in `ChangeView.recipeIds` but adds nothing to `recipes` (a library edit changes no recipe's content; the Cases show Zupfkuchen only). Purged ids come from every `recipes_purged` change after `after`, not only the newest 100.
- `after = seq` returns no changes and no recipes. `after = 0` is valid, but a device never sends it: a device without a library calls `getLibrary`.
- Cost: a device more than 100 changes behind shows a summary of the newest 100 only. Its recipes are still complete.

## Commands (`src/device/device-controller.ts`)

```text
DeviceController.editLibrary({ payload: { edits } })
├─ CurrentDevice                                         → by = { kind: "device", device: deviceName }
├─ inTransaction({ library, retry: retryKey({ connection: `${connection}/${deviceId}`, tool: "editLibrary", args }), program:
│    EditLibraryService.editLibrary({ edits, by }) : Effect<void, LibraryRefusedError> })
└─ DeviceViews.getLibrary() organization part            → LibraryOrganization

DeviceController.trashRecipes({ payload: { recipeIds } })      TrashRecipesService.trashRecipes   : RecipesNotFoundError → the recipes, read back
DeviceController.restoreRecipes({ payload: { recipeIds } })    RestoreRecipesService.restoreRecipes : RecipesNotFoundError → the recipes, read back
```

- The same services, `inTransaction` (`src/mcp/unit-of-work.ts`), and retry table as MCP. A write commits its change row and retry row together (hosting.md).
- Retries: the same rules as mcp.md Retries. The key's connection is `<client id>/<device id>`, so two devices never share a stored result.
- `LibraryEdit` is the domain schema (`src/domain/library/library-edit.ts`), the same ops as `edit_library`.

```ts
// src/device/device-http-errors.ts — one per domain error, plus the view's and the middleware's
LibraryEditsRefusedHttpError   422 { message, problems: { edit, rule, message, fix }[] }   // LibraryRefusedError; the app shows each message
RecipesNotFoundHttpError       404 { message, recipeIds }                                   // RecipesNotFoundError
ChangesNotReachedHttpError     409 { message }                                              // ChangesNotReachedError → load again (sync rule 6)
DeviceUnknownHttpError         400 { message }                                              // DeviceMiddleware
```

## Live (`src/cook-library.ts`, `src/device/device-live.ts`)

```text
acceptLive({ connection, expiresAt })
├─ WebSocketPair; ctx.acceptWebSocket(server, [connection]); server.serializeAttachment({ expiresAt })
├─ send {"seq": last seq}                      the device catches up if it's behind
└─ 101

Library({ …, onChange: (seq) => broadcastChange(seq) })   after every commit that appended a change: tools, device, alarm
broadcastChange(seq)
└─ each ctx.getWebSockets(): expiresAt < now → close(4401, "token expired"); else send {"seq": seq}

disconnectClient({ clientId, at })   also closes ctx.getWebSockets(clientId) with 4401
constructor                          ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))
webSocketMessage / webSocketClose    nothing to do
```

- Built: `sippet-expires-at` is the token's `exp` in epoch seconds (like `sippet-issued-at`); `acceptLive` stores it in milliseconds. `live` is not in `DeviceApi` (HttpApi has no upgrade endpoint): `CookLibrary.fetch` answers it before the handler.
- Built: the stored retry result is `{}` (editLibrary) or `{ recipeIds }` (trash, restore), never `null` (the retry column is NOT NULL); the response is read back from the current state, so a retry answers with the state now.
- Hibernation API: an idle socket costs no DO duration. A broadcast after eviction finds the sockets through `getWebSockets`.
- The message carries only `seq`. The device calls `listChangesAfter`, so the change log stays the one path that brings data (sync rule 2).
- 4401 means "refresh the token and reconnect". A token that can't refresh means the device is signed out.
- Rejected: pushing the change itself over the socket. That would be a second catch-up path that can drift from `listChangesAfter`.

## Modules

```text
DeviceController                 device endpoints: middleware → view or use case → error mapping
├─ DeviceMiddleware              x-device-id, x-device-name, sippet-connection → CurrentDevice
├─ EditLibraryService, TrashRecipesService, RestoreRecipesService     (existing, via inTransaction)
└─ DeviceViews                   LibraryAtChange, ChangesAfter, LibraryOrganization over Library
```

```diff
  src/
  ├─ device/
+ │  ├─ device-api.ts             DeviceApi: endpoints, payloads, errors
+ │  ├─ device-http-errors.ts     HTTP errors, deviceHttpErrorFrom… mappers
+ │  ├─ device-middleware.ts      CurrentDevice
+ │  ├─ device-controller.ts      handlers
+ │  ├─ device-views.ts           view schemas and DeviceViews over Library
+ │  ├─ device-live.ts            acceptLive, broadcastChange
+ │  └─ server.ts                 deviceWebHandler({ library }): built per DO instance, like mcpWebHandler
~ ├─ store/library.ts             onChange; reads: every recipe at its latest revision (trash included), recipes by ids, changes after, last seq, organization with ids
~ ├─ cook-library.ts              routing, live, onChange, disconnect closes sockets
~ ├─ worker.ts                    /api/device/*, azp rules, sippet-expires-at, WebSocket forward
~ └─ auth.ts                      ensureDeviceClient
+ scripts/device-token.ts         pnpm device-token: a local cook signed in through sippet-app against pnpm dev; prints the refresh token
+ scripts/verify-device.ts        end-to-end against pnpm dev (Verify 1–4)
+ test/device/                    in-process tests with the MCP harness's storage
```

## Cases

Fixture: the MCP harness (`test/mcp/harness.ts`): node:sqlite storage, real migrations, the device handler beside the MCP handler. The Zupfkuchen, Apfelkuchen, and Brownies come from `test/domain/fixtures.ts`.

```text
getLibrary
  Zupfkuchen, Apfelkuchen trashed, both tagged "Kuchen" (sync 6)        → 2 recipes, Apfelkuchen with trashedAt and purgeAt; Kuchen: both ids; seq = last change
  Zupfkuchen with flow                                                   → steps carry flow; giessen takes boden, untermixen, zupfteig (mcp.md example)

listChangesAfter (iPhone saw 41)
  Claude tags Apfelkuchen, Brownies, Käsekuchen "Kuchen" (42), revises Zupfkuchen twice (43, 44) (sync 2, 4)
                                                                         → seq 44; changes 42–44 by {claude, "Claude"}; recipes: Zupfkuchen once, at revision 3; Kuchen: 3 ids
  a recipe added at 42 and purged at 43                                  → in purgedRecipeIds, not in recipes
  after = 44, library at 44                                              → no changes, no recipes
  after = 50, library at 44 (sync 6)                                     → 409 ChangesNotReachedHttpError
  150 changes after 41                                                   → the newest 100 changes; every touched recipe

editLibrary
  "iPad" tags Zupfkuchen "Backen" (library 3)                            → 200; the change is by {device, "iPad"}; Backen: [zupfkuchen]
  batch naming a trashed recipe (library 1)                              → 422, problem with edit 1, rule trashed-recipes-leave-the-library; nothing changes
  the same batch again within 10 minutes, same device                    → the stored result; one change
  the same batch from another device                                     → applies again (its own retry key)

trashRecipes / restoreRecipes
  trash Zupfkuchen (revising 6, 7)                                       → 200, trashedAt, purgeAt = trashedAt + 30 days
  trash Zupfkuchen and an unknown id (revising 10)                       → 404 RecipesNotFoundHttpError naming the unknown id; nothing trashed
  restore Zupfkuchen (revising 8)                                        → 200, no trashedAt

edge
  no x-device-id                                                         → 400 DeviceUnknownHttpError
  Claude's token on /api/device/library (account 6)                      → 401 (Worker)
  device token after "Sippet app" was disconnected (account 8)           → 401 (CookLibrary.isRefused)

live (scripts/verify-device.ts against pnpm dev; WebSocketPair isn't in node)
  socket open, Claude adds a recipe (sync 3)                             → {"seq": n+1} within a second
  disconnect "Sippet app"                                                → socket closed 4401
  token expired, then a change                                           → socket closed 4401 instead of the message
```

## Verify before building on it

1. `ensureDeviceClient` works on native D1, and authorize → token works with PKCE, `offline_access`, and the redirect `de.bastelboxx.sippet:/oauth`. Better Auth's native-client check accepts the authority-free reverse-domain form.
2. `/connect` shows "Sippet app" and approves in one tap, unchanged. The `iss` parameter reaches the custom-scheme redirect.
3. A refresh rotates the refresh token and keeps `azp`. A refresh after the disconnect fails.
4. A WebSocket upgrade passes through the Worker to the DO in `alchemy dev` and in production. Hibernation keeps the socket across a DO eviction (wait for eviction, then send a change).
