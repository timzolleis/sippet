---
name: account
description: A person creates an account and signs in with a passkey, manages passkeys, and connects Claude to their library.
type: story
state: draft
---

# Account

"The cook signs in with Face ID and lets Claude into their recipes."

No passwords, and no open sign-up: the owner invites each cook. Claude connects through the same sign-in, then works in this cook's library only.

## Use cases

| Use case | Rules |
|---|---|
| The owner invites a person. | 7 |
| A person creates an account. | 1, 7 |
| The cook signs in. | 2 |
| The cook adds or removes a passkey. | 3 |
| The cook connects Claude. | 4, 6 |
| The cook sees connections and disconnects one. | 5 |

## Data

| Thing | Fields |
|---|---|
| invitation | who invited, created at, expires at, used or not |
| cook | id |
| passkey | name, added at; at least one per cook |
| connection | which client (Claude on claude.ai, Claude Code), connected at |

## Rules

1. **Passkey only.** An account is created with a passkey. No password.
2. **Any device.** Sign in with a passkey on any device. Passkeys sync through iCloud Keychain, so a new iPhone just works.
3. **Never the last passkey.** A cook can add passkeys (a YubiKey, a second Apple ID) and remove them, but not the last one. With no passkey left the account is locked for good; recovery by e-mail is in [later.md](later.md).
4. **Claude asks, the cook approves.** Claude asks for access; the cook signs in with a passkey and approves. Claude then works in this cook's library only.
5. **Disconnecting.** A cook sees their connections and can disconnect one. Claude's earlier changes stay.
6. **Claude can do less.** Claude can do what the cook can in the library, except:
   - empty the trash ([revising-recipes.md](revising-recipes.md), rule 7)
   - manage passkeys or connections
   - delete the account

   Everything Claude does must stay undoable, through revisions and the trash.
7. **By invitation.** An account is created only from an invitation by the owner. One invitation creates one account, within 14 days; a forgotten link must not open an account months later. It's a personal app: every account costs storage, and Claude can write into it.

## Examples

| Situation | Result |
|---|---|
| the cook connects Claude on claude.ai, approves on the iPhone with Face ID | Claude lists the cook's recipes |
| the cook disconnects Claude | Claude's next request is refused; its revisions stay (rule 5) |
| Claude asks to remove a passkey | refused (rule 6) |
| the cook removes their only passkey | refused (rule 3) |
| someone opens the sign-up page without an invitation | refused (rule 7) |
| a second person uses an invitation that already created an account | refused (rule 7) |
| a person opens an invitation 15 days after it was made | refused, the owner sends a new one (rule 7) |
