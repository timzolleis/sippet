---
name: account-ui
description: The three web pages around auth. Join with an invitation, connect Claude, manage passkeys and connections. Look, states, copy, weight budget.
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

## Weight

- Static files in `public/`, served by the asset layer: no Worker invocation, no CPU.
- One shared `app.css` and `app.js` (fetch helpers, WebAuthn, strings), plus one small HTML file per page.
- Budget: under 20 KB per page uncompressed, all files included.
- No framework, no build step, no web fonts, no images. Icons are inline SVG.
- WebAuthn through `PublicKeyCredential.parseCreationOptionsFromJSON` / `parseRequestOptionsFromJSON` and `credential.toJSON()`: Safari 18, Chrome 129, Firefox 119.
- Rejected: React or Preact with Vite. They'd add a build and 40+ KB for three forms.

## Look

One centered column, `max-inline-size: 24rem`, on a warm off-white page. The `sippet` wordmark sits on top. Each page has a single card, and each view has one filled button.

```css
:root {
  color-scheme: light dark;
  --font: system-ui, -apple-system, "Segoe UI", sans-serif;      /* SF Pro on Apple devices, no download */

  /* primitives: one warm neutral, one accent (paprika), one danger */
  --neutral-50: oklch(0.985 0.004 70);  --neutral-100: oklch(0.965 0.006 70);
  --neutral-200: oklch(0.92 0.008 70);  --neutral-500: oklch(0.54 0.012 70);
  --neutral-800: oklch(0.29 0.01 70);   --neutral-900: oklch(0.21 0.008 70);  --neutral-950: oklch(0.16 0.006 70);
  --paprika-400: oklch(0.72 0.15 40);   --paprika-500: oklch(0.57 0.17 38);    --paprika-600: oklch(0.54 0.17 36);
  --red-400: oklch(0.72 0.17 27);       --red-600: oklch(0.55 0.2 27);

  /* roles: the only names pages use */
  --color-bg: var(--neutral-100);         --color-surface: var(--neutral-50);
  --color-text: var(--neutral-950);       --color-text-secondary: var(--neutral-500);
  --color-separator: var(--neutral-200);
  --color-accent-solid: var(--paprika-600); --color-on-accent: white; --color-accent-text: var(--paprika-600);
  --color-danger-text: var(--red-600);
}
@media (prefers-color-scheme: dark) {
  :root { --color-bg: var(--neutral-950); --color-surface: var(--neutral-900);
          --color-text: var(--neutral-50); --color-separator: var(--neutral-800);
          --color-accent-solid: var(--paprika-500); --color-accent-text: var(--paprika-400);
          --color-text-secondary: oklch(0.7 0.012 70); --color-danger-text: var(--red-400); }
}
/* every text pair ≥ 4.5:1 in both modes; measured on the built pages */
```

- **Type.** Four sizes: 28 (title, weight 650, `letter-spacing: -0.02em`, `text-wrap: balance`), 17 (body), 15 (secondary), 13 (labels and dates). Body line-height 1.5, title 1.15. Descriptions use `text-wrap: pretty`, and dates use `tabular-nums`.
- **Surfaces.** The card has radius 32, padding 20, and a layered shadow instead of a border. Buttons inside it have radius 12. The radii are concentric: 12 + 20 = 32. List rows use separators, not boxes.
- **Buttons.** At least 48 px high, full width in the card. Press: `scale(0.96)`, with `transition-property: scale, background-color` at 150 ms. The primary button carries the passkey glyph (inline SVG, 1.5 px stroke, `currentColor`).
- **Motion.** The card enters once (opacity plus 8 px `translateY`, 200 ms, `cubic-bezier(0.2, 0, 0, 1)`). State changes inside are instant or 150 ms color. With `prefers-reduced-motion`, nothing moves.
- **Focus.** A 2 px accent outline, offset 2 px. All actions work by keyboard.

Check after building: measure text-secondary on surface and on-accent on accent-solid in both schemes. Each must reach 4.5:1.

## States

Every passkey button goes through the same states:

```text
idle ──tap──▶ waiting ("Waiting for your passkey…", button disabled, spinner in the glyph's place)
waiting ──ok──▶ done (next screen)
waiting ──cancelled──▶ idle, no message (the cook cancelled on purpose)
waiting ──failed──▶ idle + one line under the button, in danger text
```

Errors sit under the button that failed and say what to do next. There's no "oops" and there are no exclamation marks.

## Copy

The language comes from `navigator.language`: `de*` gets German, everything else English. Both live in `app.js`. Sentence case, verb-first buttons, "du" in German.

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

- en: "Claude wants to use your recipes", "back to claude.ai", "Read, add, and change recipes", "Organize tags and collections", "Everything stays undoable. Claude can't empty the trash or change your account.", "Allow with passkey" / "Allow", "Deny".
- With only loopback redirects (Claude Code), the host line reads "zurück zu einem Programm auf diesem Computer" / "back to a program on this computer".
- On allow: passkey sign-in if there's no session, then consent `accept: true`, then Better Auth redirects to Claude. Deny sends `accept: false`.

### `/account`

Without a session, it shows a single card: "Bei Sippet anmelden" / "Sign in to Sippet" with "Mit Passkey anmelden" / "Sign in with passkey". With one, it shows three groups:

| Group | Content |
|---|---|
| Claude verbinden / Connect Claude | "Füge in Claude einen eigenen Connector mit dieser Adresse hinzu" / "In Claude, add a custom connector with this address" · `https://sippet.bastelboxx.de/mcp` · "Kopieren" / "Copy" (the label becomes "Kopiert" / "Copied" for 2 s) |
| Verbindungen / Connections | rows: client name, "verbunden am 12. Okt. 2026" / "connected Oct 12, 2026" · "Trennen" / "Disconnect"; that row's confirmation: "Claude (claude.ai) trennen? Seine Änderungen bleiben." / "Disconnect Claude (claude.ai)? Its changes stay." → "Trennen" / "Disconnect", "Abbrechen" / "Cancel". Empty: "Noch nichts verbunden." / "Nothing connected yet." |
| Passkeys | rows: name, added date · "Umbenennen" / "Rename", "Entfernen" / "Remove". With one passkey left, the row shows "Dein einziger Passkey kann nicht entfernt werden." / "Your only passkey can't be removed." in place of Remove (account rule 3) · "Passkey hinzufügen" / "Add passkey" |

The footer has "Abmelden" / "Sign out".

## Verified (better-auth 1.7.13)

1. `/connect` gets the authorize query plus `exp`, `ba_iat`, `ba_param`, `sig`. The page signs in without `oauth_query`, then posts `/oauth2/consent {accept: true, oauth_query}` → `{redirect, url}`. Sending `oauth_query` on sign-in would resume the authorize and bounce back to `/connect`.
2. `redirect_uri` is in the signed query. `client_name` comes from `POST /api/auth/oauth2/public-client-prelogin`, which needs `allowPublicClientPrelogin: true` in `mcp()`.
3. Deny redirects client-side to `redirect_uri?error=access_denied&state=…`, because `/oauth2/consent` needs a session.
