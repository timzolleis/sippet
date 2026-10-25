// The account endpoints (hosting.md, Request path) and Better Auth 1.7's passkey and OAuth endpoints. The flows are the
// ones account-ui.md "Verified" lists; keep them as they are.

export class RequestFailed extends Error {
  readonly status: number

  constructor(status: number) {
    super(`request failed with ${status}`)
    this.status = status
  }
}

export interface User {
  readonly id: string
  readonly name: string
}

export interface Connection {
  readonly clientId: string
  readonly name: string
  readonly connectedAt: number
}

export interface Passkey {
  readonly id: string
  readonly name?: string | null
  readonly createdAt: string
}

async function api<A>(path: string, init?: RequestInit): Promise<A | null> {
  const res = await fetch(`/api${path}`, { credentials: "same-origin", ...init })

  if (!res.ok) throw new RequestFailed(res.status)
  const text = await res.text()

  // SAFETY: same-origin endpoints of this Worker and Better Auth; each caller names the body that endpoint returns.
  return text ? (JSON.parse(text) as A) : null
}

/** A GET whose body must be there. */
async function load<A>(path: string): Promise<A> {
  const body = await api<A>(path)

  if (body === null) throw new RequestFailed(204)

  return body
}

/** A request body: plain JSON, or a WebAuthn credential's own JSON. */
type Json =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json }
  | RegistrationResponseJSON
  | AuthenticationResponseJSON

function post<A>(path: string, body?: { readonly [key: string]: Json }): Promise<A | null> {
  const init: RequestInit = { method: "POST" }

  if (body !== undefined) Object.assign(init, { headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

  return api<A>(path, init)
}

/** The cook cancelled the passkey sheet on purpose: no message. */
export const isCancel = (cause: unknown): boolean =>
  cause instanceof Error && (cause.name === "NotAllowedError" || cause.name === "AbortError")

const publicKeyCredential = (credential: Credential | null): PublicKeyCredential => {
  if (credential instanceof PublicKeyCredential) return credential
  throw new DOMException("no credential", "AbortError")
}

/** `query` carries the invitation (`?context=<token>`); `/join` also asks for a session. */
export async function registerPasskey(query = "", createSession?: boolean): Promise<void> {
  const options = await load<PublicKeyCredentialCreationOptionsJSON>(`/auth/passkey/generate-register-options${query}`)
  const credential = await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options) })
  await post("/auth/passkey/verify-registration", { response: publicKeyCredential(credential).toJSON(), createSession })
}

export async function signInWithPasskey(): Promise<void> {
  const options = await load<PublicKeyCredentialRequestOptionsJSON>("/auth/passkey/generate-authenticate-options")
  const credential = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) })
  await post("/auth/passkey/verify-authentication", { response: publicKeyCredential(credential).toJSON() })
}

export const currentUser = async (): Promise<User | undefined> =>
  (await api<{ readonly user: User }>("/auth/get-session"))?.user

export const signOut = async (): Promise<void> => {
  await post("/auth/sign-out", {})
}

export const invitationName = async (token: string): Promise<string> =>
  (await load<{ readonly name: string }>(`/invitation?token=${encodeURIComponent(token)}`)).name

// ── /connect ────────────────────────────────────────────────────────────────

/** The part of Better Auth's query that its `oauth_query` field takes back. */
export function signedQuery(params: URLSearchParams): string | null {
  const names = new Set(params.getAll("ba_param"))

  if (!params.has("sig") || !names.size) return null
  const out = new URLSearchParams()

  for (const [key, value] of params) if (key === "sig" || key === "ba_param" || names.has(key)) out.append(key, value)

  return out.toString()
}

export const clientName = async (clientId: string | null, oauthQuery: string | null): Promise<string> => {
  const client = await post<{ readonly client_name: string }>("/auth/oauth2/public-client-prelogin", {
    client_id: clientId,
    oauth_query: oauthQuery,
  })

  if (client === null) throw new RequestFailed(204)

  return client.client_name
}

/** Approve; Better Auth answers with the redirect back to the client. Sign in first, without `oauth_query`. */
export const consent = async (oauthQuery: string | null): Promise<string> => {
  const result = await post<{ readonly url: string }>("/auth/oauth2/consent", { accept: true, oauth_query: oauthQuery })

  if (result === null) throw new RequestFailed(204)

  return result.url
}

// ── /account ────────────────────────────────────────────────────────────────

export const listConnections = (): Promise<ReadonlyArray<Connection>> => load("/connections")

export const disconnect = async (clientId: string): Promise<void> => {
  await post(`/connections/${encodeURIComponent(clientId)}/disconnect`)
}

export const listPasskeys = (): Promise<ReadonlyArray<Passkey>> => load("/auth/passkey/list-user-passkeys")

export const renamePasskey = async (id: string, name: string): Promise<void> => {
  await post("/auth/passkey/update-passkey", { id, name })
}

/** The Worker refuses to remove the last one (account rule 3). */
export const removePasskey = async (id: string): Promise<void> => {
  await post("/auth/passkey/delete-passkey", { id })
}
