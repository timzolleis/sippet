---
name: hosting
description: Where sippet runs and how a request reaches a cook's library. Worker, CookLibrary Durable Object, Better Auth on D1, storage, search, trash, change log, retries, MCP sessions.
type: spec
state: draft
---

# Hosting

One Cloudflare Worker on the Free plan. Better Auth on D1 handles accounts and OAuth. Each cook's library is one `CookLibrary` Durable Object with its own SQLite, and it also runs the MCP server ([mcp.md](mcp.md)).

Stories: [account](../stories/account.md), [adding-recipes](../stories/adding-recipes.md) rule 6, [revising-recipes](../stories/revising-recipes.md) rules 6–9, [sync](../stories/sync.md) rules 1, 4, [cooking](../stories/cooking.md) rule 9.
Not in this build: photos (adding rule 5), the device API, catch-up and live updates (sync rules 2, 3), emptying the trash by hand.

## Request path

```text
Worker (10 ms CPU)
├─ /mcp                                   verifyAccessToken → CookLibrary.getByName(sub).fetch
├─ /.well-known/oauth-protected-resource  Better Auth (mcp plugin)
├─ /.well-known/oauth-authorization-server Better Auth
├─ /api/auth/*                            Better Auth: passkey, oauth2 authorize/token/register, jwks
├─ /api/invitation                       invitation name for /join (account-ui.md)
└─ /join  /connect  /account              static files, no Worker run ([account-ui.md](account-ui.md))

CookLibrary (one per cook, 30 s CPU)
├─ fetch          MCP server, McpServer.layerHttp
├─ connect / disconnect   RPC from the Worker (account rules 4, 5)
└─ alarm          trash purge
```

- The `/mcp` path never builds `betterAuth()`. It only runs `jose` against the JWKS (see below) and forwards the request. That keeps cold `/mcp` requests far below 10 ms.
- All domain and MCP work runs in the DO, which has 30 s CPU per request on Free. This replaces the spike's CPU concern.
- Rejected: MCP in the Worker. Effect plus the MCP server took 20 ms CPU cold in the spike.

## Resources (`alchemy.run.ts`)

```ts
const DB = Cloudflare.D1.Database("auth")
const CookLibrary = Cloudflare.DurableObject("CookLibrary")      // SQLite
const Site = Cloudflare.Worker("sippet", {
  main: "./src/worker.ts",
  assets: { directory: "./public", runWorkerFirst: ["/mcp", "/api/*", "/.well-known/*"] },
  compatibility: { flags: ["nodejs_compat"] },
  domain: "sippet.bastelboxx.de",
  workersDev: false,
  env: { DB, COOK_LIBRARY: CookLibrary, BETTER_AUTH_SECRET: Alchemy.Secret("BETTER_AUTH_SECRET"), PUBLIC_URL: Cloudflare.Worker.URL },
})
export type Env = Cloudflare.InferEnv<typeof Site>
```

- The Worker is async: a plain `export default { fetch }` and `class CookLibrary extends DurableObject`. Alchemy only declares the resources.
- Rejected: Alchemy's Effect-native Worker and DO. They tie runtime code to a beta API that renamed its namespaces in beta.59.
- Account `dfbe39d3621591908c9d962e0e644a6b`, zone `bastelboxx.de`.
- **The host `sippet.bastelboxx.de` is fixed forever.** It's the passkeys' RP ID and later the native app's associated domain; moving it locks every cook out (account rule 3). `workersDev: false`, so no second host can mint passkeys.

## Auth (`src/auth.ts`)

```ts
betterAuth({
  database: env.DB,                                   // native D1 (Kysely)
  baseURL: env.PUBLIC_URL, basePath: "/api/auth",
  emailAndPassword: { enabled: false },
  plugins: [
    jwt(),                                            // signs access tokens, serves /api/auth/jwks
    passkey({ rpID: "sippet.bastelboxx.de", rpName: "Sippet",
      registration: { requireSession: false, resolveUser: joinFromInvitation, createSession: true } }),
    mcp({ resource: `${PUBLIC_URL}/mcp`, loginPage: "/connect", consentPage: "/connect",
      scopes: ["offline_access"],
      allowDynamicClientRegistration: true, allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultApplicationType: "infer",          // Claude Code's loopback redirect
      accessTokenExpiresIn: 3600 }),
  ],
  hooks: { before: refuseLastPasskey },               // account rule 3
})
```

- **Client registration: DCR.** Claude uses DCR when the server doesn't advertise CIMD. Unauthenticated registration is safe because a token still needs a cook to sign in and approve (account rule 4).
- Cost: claude.ai registers a new client on every fresh connection, sometimes twice. At a few cooks, the rows don't matter.
- Rejected for now: CIMD. Better Auth needs a DNS-pinned fetch, which Workers can't do. claude.ai's metadata document also returns 403 to some datacenter IPs (anthropics/claude-ai-mcp#650).
- **No password, no bearer plugin.** An access token reaches `/mcp` and nothing else. Account pages need a session cookie, so Claude can't reach passkeys or connections (account rule 6).

### Invitations (account rule 7)

```sql
-- D1, beside Better Auth's tables
invitation(id, token_hash, name, email, created_at, expires_at, used_at, user_id)   -- expires_at = created_at + 14 days
```

```text
pnpm invite "Anna" anna@example.com
  → inserts a row via the D1 HTTP API, prints https://sippet.bastelboxx.de/join#<token>    (token: 32 random bytes, stored as SHA-256)

/join → passkey registration with context = token
  joinFromInvitation({ context })
  ├─ UPDATE invitation SET used_at = now WHERE token_hash = ? AND used_at IS NULL AND expires_at > now RETURNING *   ← one statement, so one use
  ├─ none → refuse: "invitation used, expired, or unknown"
  └─ createUser({ name, email, emailVerified: false }) → { id, name }
```

- The owner is whoever can deploy, so the app has no owner role and no admin page.
- The e-mail isn't verified and isn't used for sign-in. It's kept for recovery by e-mail ([later.md](../stories/later.md)).

### Passkeys and connections

```text
refuseLastPasskey          before /passkey/delete-passkey: count(passkey where userId) = 1 → 400   (account rule 3)

/connect approved          → CookLibrary.connect({ clientId, name: client_name })                 (account rule 4)
/account: disconnect       → delete oauthConsent, revoke refresh tokens,
                             CookLibrary.disconnect({ clientId, at: now })                         (account rule 5)
```

- An access token stays valid for up to an hour after a disconnect. The DO closes that gap itself: it refuses a token whose `iat` is before that connection's `disconnected_at`. So "Claude's next request is refused" holds without a D1 read on every request.

### Pages

`/join`, `/connect`, `/account`: see [account-ui.md](account-ui.md).

## Token check (`src/worker.ts`)

```text
verifyAccessToken(request)
├─ no or bad Bearer → 401, WWW-Authenticate: Bearer resource_metadata="<PUBLIC_URL>/.well-known/oauth-protected-resource/mcp"
├─ jose.jwtVerify(token, localJwks, { issuer: PUBLIC_URL, audience: `${PUBLIC_URL}/mcp` })
│    localJwks: the D1 `jwks` table's public keys, cached per isolate, reloaded once on an unknown kid
└─ forward with headers  sippet-cook: sub   sippet-connection: client id   sippet-issued-at: iat
     (incoming sippet-* headers are dropped first)
```

Rejected: `requireMcpAuth`. It fetches the JWKS over HTTP, which here would be the Worker calling itself, and it builds `betterAuth()` on every request.

## CookLibrary

- Built per DO instance in the constructor: Drizzle (`drizzle-orm/durable-sqlite`), migrations inside `blockConcurrencyWhile`, and the MCP web handler with this instance's storage in its layer.
- Rejected: one module-scope handler, as in the spike. Several DOs can share an isolate, and their sessions and storage would mix.
- Writes run in `ctx.storage.transactionSync`: the content, the derived columns, the FTS row, the change, and the retry row commit together.

### Tables

```sql
recipe(id, title, latest_revision, source, source_key UNIQUE, trashed_at, purge_at,
       total_minutes, has_flow, created_at)                       -- source_key: adding rule 6, trashed included
revision(recipe_id, revision, content JSON, was JSON, by JSON, at, change_seq,  PK(recipe_id, revision))
recipe_item(recipe_id, item_key)                                  -- items filter; lowercased item names
recipe_text USING fts5(title, ingredients, steps, tokenize = 'trigram remove_diacritics 1')   -- rowid = recipe rowid
tag(id, name, name_key UNIQUE)            recipe_tag(recipe_id, tag_id)
collection(id, name, name_key UNIQUE)     collection_recipe(collection_id, recipe_id, position)
smart_collection(id, name, name_key UNIQUE, filter JSON)          -- name_key unique across collections too (library rule 9)
change(seq INTEGER PRIMARY KEY, at, by JSON, kind, payload JSON)  -- sync rules 1, 4
retry(connection, tool, args_hash, result JSON, expires_at,  PK(connection, tool, args_hash))
connection(client_id PK, name, connected_at, disconnected_at)
```

- `revision.content` is the whole recipe as written (revising Data). The flow is derived on read and never stored (recipe rule 11).
- `by`: `{ kind: "claude", connection }`, `{ kind: "device", device }` (later), or `{ kind: "trash" }` for purges (sync rule 4).
- Trashed recipes keep their `recipe_tag` and `collection_recipe` rows (revising rules 6, 8). Every library and search read filters on `trashed_at IS NULL`.

### Search (cooking rule 9)

- One `recipe_text` row per recipe that isn't trashed, rewritten on each revision and deleted on trash.
- Trigram, because German compounds need substring matches: "zucker" finds "Puderzucker", "rühr" finds "verrühren".
- Text under 3 characters uses `LIKE` on the title.
- The filters come from columns and joins: tags, `recipe_item`, `total_minutes`, `has_flow`. Order: with `collection`, by position; with `text`, by `bm25`; otherwise by title.

### Source (adding rule 6)

```text
cleanSource(url)                     before the write; outside the transaction
├─ follow redirects by hand: fetch(redirect: "manual"), at most 5 hops, 3 s total; stop at the first non-3xx, whatever its status
│    on a timeout or network error: keep the last address reached
└─ normalize: https, lowercase host, drop "www.", fragment, utm_*, fbclid, gclid, mc_cid, mc_eid, a trailing "/"
source = the cleaned address;  source_key = the same address without the scheme
```

- `source_key UNIQUE` covers trashed recipes. A clash refuses `add_recipe` and names the existing recipe and whether it's trashed.
- Order of work in `add_recipe`: check the edits (pure), clean the source, then the transaction. That keeps a refused batch from costing a fetch.

### Trash (revising rules 6, 7, 9, 10)

- `purge_at = trashed_at + 720 h`. After each trash or restore, the DO sets its single alarm to the earliest `purge_at`.
- `alarm()` purges every due recipe in one change `{ kind: "trash" }`, deleting its revisions, tags, collection places, and FTS row. It then sets the next alarm. Alarms retry on failure, and a second run finds nothing due.

### Change log (sync rules 1, 4)

- Every write appends exactly one `change` row in its transaction. `kind` is `recipe_added`, `recipe_revised`, `recipes_trashed`, `recipes_restored`, `recipes_purged`, or `library_changed`.
- `payload` names what changed, gone things included (purged ids, deleted tag and collection names), so catch-up (sync rule 2) can be built on it later. Rows are kept forever.

### Retries ([mcp.md](mcp.md#retries))

- The key is `(connection, tool, sha256(canonical JSON of the arguments))`, kept for 10 minutes and written in the same transaction as the write.
- A hit returns the stored result. Expired rows are deleted at the start of each write.

### Connections

- The DO handles `sippet-connection` and `sippet-issued-at` before MCP: a token from a disconnected connection with `iat < disconnected_at` gets 401.
- An unknown client is stored as `connection(name: "Claude")` until `connect` names it.

## MCP sessions

- Sessions are in DO memory (`McpServer.layerHttp`). When Cloudflare evicts an idle DO, its sessions go with it. The next request with the old `Mcp-Session-Id` gets 404, and the client must start a new session (MCP 2025-06-18 transport).
- 2026-07-28 is stateless, so eviction doesn't matter there.
- If claude.ai doesn't start a new session after a 404 (verify 5), accept an unknown session id as initialized, with the protocol from `MCP-Protocol-Version`.

## Limits on Free

| Limit | Use |
|---|---|
| Worker 10 ms CPU | `/mcp`: JWT verify + forward. Auth pages: passkey verify (WebCrypto), D1. No password hashing. |
| DO 30 s CPU | all MCP and domain work |
| 100k requests/day each (Worker, DO) | a busy Claude session is a few hundred |
| 100k SQL rows written/day | a revision writes about 10 rows |
| 5 GB DO storage | a revision is about 10 KB of JSON |
| 50 subrequests | source cleaning uses at most 5 |

## Development and deploy

- `alchemy dev` runs the Worker, DO, and D1 locally. `alchemy deploy` deploys.
- Better Auth's schema: `npx auth generate` produces a D1 migration, committed. CookLibrary: `drizzle-kit generate` with the `durable-sqlite` driver; migrations are bundled and run on activation.
- Tests: the domain is pure and tested in vitest without Workers. The MCP flow runs against `alchemy dev` with a minted token, like `spike/remote.ts`.

## Verify before building on it

1. Native D1 plus passkey pre-auth registration: `resolveUser` runs after the WebAuthn verification, so a failed ceremony doesn't use up the invitation. If it runs before, consume the invitation in an after-hook instead.
2. Which claim of the `mcp()` access token holds the client id (`azp` or `client_id`), and that `iat` is set.
3. `/.well-known/*` paths and the RFC 9728 document match `resource = <PUBLIC_URL>/mcp` exactly. Claude Code's loopback redirect passes with `"infer"`.
4. The Effect `McpServer` handler can be built per DO instance, and tool handlers can read the request's `sippet-*` headers (connection and retry key).
5. claude.ai starts a new session after a 404 following DO eviction.
6. Better Auth sign-in and the token endpoint stay near 10 ms CPU cold on the Worker. If they don't, move Better Auth into a singleton `Accounts` DO on its own SQLite.

