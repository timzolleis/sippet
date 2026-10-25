---
name: account-ui
description: The three web pages around auth. Join with an invitation, connect Claude, manage passkeys and connections. Look, build, states, copy.
type: spec
state: draft
---

# Account UI

The only web UI. Claude's sign-in always goes through a browser, so these pages stay after the native app exists. Stories: [account](../stories/account.md) rules 1–5, 7. Host and auth: [hosting.md](hosting.md#auth-srcauthts).

## Pages

| Page | For | Rules |
|---|---|---|
| `/join#<token>` | create the account with a passkey | 1, 7 |
| `/connect?…` | Better Auth's `loginPage` and `consentPage`: sign in and approve Claude, one passkey tap | 2, 4 |
| `/account` | sign in if needed; connect Claude, connections, passkeys | 2, 3, 5 |

- The token is in the fragment, so it never reaches a server log. `/join` is a static file.
- Rejected: separate sign-in and consent pages. That's two screens and two taps for one intent.

## Look

- Built on the Triargos design system (`~/code/triargos-design`, design.a-np.de): its components, tokens, type, spacing, surfaces and motion, added the shadcn way (`components.json`, `~` → `web/src`). `web/src/components/ui`, `web/src/lib` are the registry's: `shadcn add @triargos/<name>` again to update, don't edit.
- Theme: `brandingThemeCss({ primaryColor: "orange", baseColor: "stone", destructiveColor: "red" })` (`web/src/theme.ts`), generated at build time into the stylesheet, with the `orange` anchor deepened to a paprika (orange-700's hue and chroma at LCH L 42). Inter Variable, light and dark from `prefers-color-scheme`.
- Patterns: Page (wordmark, title, cards), List in card for connections and passkeys, Confirmation (`AlertDialog`) for disconnect and remove, `Dialog` + `Field` for rename, `CopyButton` for the address, `toast` for results, `Empty` for "nothing connected" and failures. One `Button intent="primary"` per view.
- Contrast, measured on the built pages: the primary label on its fill 6.0:1, and at least 4.6:1 where the solid button's gradient is lightest; muted text on the page 6.3:1. The stock `orange` anchor gave 3.5:1.

## Build

- Vite multi-page build of `web/{join,connect,account}.html` into `dist/` (gitignored), served by the asset layer: no Worker invocation, no CPU. `pnpm deploy` builds first.
- `pnpm dev`: `vite build --watch` next to `alchemy dev`, which serves `dist/` as it changes. Same origin as the API, so passkeys work locally.
- About 176 KB gzipped JS + CSS per page (React, Base UI, framer-motion) plus the 352 KB Inter font. Hashed assets are cached for a year (`web/public/_headers`).
- WebAuthn through `PublicKeyCredential.parseCreationOptionsFromJSON` / `parseRequestOptionsFromJSON` and `credential.toJSON()`: Safari 18, Chrome 129, Firefox 119.

## States

Every passkey button goes through the same states:

```text
idle ──tap──▶ waiting (spinner in the button, "Waiting for your passkey…" under it)
waiting ──ok──▶ done (next screen)
waiting ──cancelled──▶ idle, no message (the cook cancelled on purpose)
waiting ──failed──▶ idle + one line under the button, in danger text
```

Errors sit under the button that failed and say what to do next. There's no "oops" and there are no exclamation marks. On `/account`, results and failures of list actions are toasts; a list that doesn't load shows "Das hat nicht geklappt" / "That didn't work" with "Erneut versuchen" / "Try again".

## Copy

The language comes from `navigator.language`: `de*` gets German, everything else English. Both live in `web/src/app/strings.ts`. Sentence case, verb-first buttons, "du" in German.

### `/join`

| | de | en |
|---|---|---|
| title | Willkommen, Anna | Welcome, Anna |
| body | Sippet bewahrt deine Rezepte. Du meldest dich mit einem Passkey an, ohne Passwort. | Sippet keeps your recipes. You sign in with a passkey, no password. |
| button | Passkey erstellen | Create passkey |
| used, expired, unknown | Diese Einladung gilt nicht mehr. Bitte um eine neue. | This invitation is no longer valid. Ask for a new one. |

When it's done, the page goes to `/account`, which opens on "Connect Claude".

`GET /api/invitation?token=` returns `{ name }`, or 410 when the invitation is used, expired, or unknown. That's the only new endpoint.

### `/connect`

```text
┌──────────────────────────────────┐
│ sippet                           │
│                                  │
│ Claude möchte deine Rezepte      │   title: client_name
│ verwenden                        │
│ zurück zu claude.ai              │   redirect host, always shown
│                                  │
│ ✓ Rezepte lesen, hinzufügen      │
│   und ändern                     │
│ ✓ Tags und Sammlungen ordnen     │
│ Alles bleibt rückgängig zu       │   account rule 6
│ machen. Den Papierkorb leeren    │
│ oder dein Konto ändern kann      │
│ Claude nicht.                    │
│                                  │
│ [ ◉ Mit Passkey erlauben ]       │   signed in already: "Erlauben"
│   Ablehnen                       │   plain text button
└──────────────────────────────────┘
```

- en: "Claude wants to use your recipes", "back to claude.ai", "Read, add, and change recipes", "Organize tags and collections", "Everything stays undoable." with "Claude can’t empty the trash or change your account." under it (de the same: two lines), "Allow with passkey" / "Allow", "Deny".
- With only loopback redirects (Claude Code), the host line reads "zurück zu einem Programm auf diesem Computer" / "back to a program on this computer".
- On allow: passkey sign-in if there's no session, then consent `accept: true`, then Better Auth redirects to Claude. Deny sends `accept: false`.

### `/account`

Without a session, it shows a single card: "Bei Sippet anmelden" / "Sign in to Sippet" with "Mit Passkey anmelden" / "Sign in with passkey". With one, it shows three cards, and "Abmelden" / "Sign out" sits top right:

| Group | Content |
|---|---|
| Claude verbinden / Connect Claude | "Füge in Claude einen eigenen Connector mit dieser Adresse hinzu" / "In Claude, add a custom connector with this address" · `https://sippet.bastelboxx.de/mcp` · "Kopieren" / "Copy" (the label becomes "Kopiert" / "Copied" for 2 s) |
| Verbindungen / Connections | rows: client name, "verbunden am 12. Okt. 2026" / "connected Oct 12, 2026" · "Trennen" / "Disconnect"; confirmation: "Claude (claude.ai) trennen?" / "Disconnect Claude (claude.ai)?", "Seine Änderungen bleiben." / "Its changes stay." → "Trennen" / "Disconnect", "Abbrechen" / "Cancel"; toast "Claude (claude.ai) getrennt" / "Claude (claude.ai) disconnected". Empty: "Noch nichts verbunden" / "Nothing connected yet" |
| Passkeys | rows: name, added date, a menu with "Umbenennen…" / "Rename…" and "Entfernen…" / "Remove…". Rename: dialog "Passkey umbenennen" / "Rename passkey", field "Name", "Speichern" / "Save"; toast "Passkey umbenannt" / "Passkey renamed". Remove: "iPhone entfernen?" / "Remove iPhone?"; toast "iPhone entfernt" / "iPhone removed". With one passkey left, Remove is gone and the card says "Dein einziger Passkey kann nicht entfernt werden." / "Your only passkey can't be removed." (account rule 3) · header action "Passkey hinzufügen" / "Add passkey"; toast "Passkey hinzugefügt" / "Passkey added" |

## Verified (better-auth 1.7.13)

1. `/connect` gets the authorize query plus `exp`, `ba_iat`, `ba_param`, `sig`. The page signs in without `oauth_query`, then posts `/oauth2/consent {accept: true, oauth_query}` → `{redirect, url}`. Sending `oauth_query` on sign-in would resume the authorize and bounce back to `/connect`.
2. `redirect_uri` is in the signed query. `client_name` comes from `POST /api/auth/oauth2/public-client-prelogin`, which needs `allowPublicClientPrelogin: true` in `mcp()`.
3. Deny redirects client-side to `redirect_uri?error=access_denied&state=…`, because `/oauth2/consent` needs a session.
