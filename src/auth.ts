// Better Auth on D1: passkeys, JWT access tokens, OAuth for MCP clients (specs/hosting.md#auth-srcauthts).
import { mcp } from "@better-auth/mcp"
import { passkey, type PasskeyOptions } from "@better-auth/passkey"
import { betterAuth, type BetterAuthOptions } from "better-auth"
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api"
import { jwt } from "better-auth/plugins"
import type { Env } from "../alchemy.run.ts"

export type AuthEnv = Pick<Env, "DB" | "COOK_LIBRARY" | "BETTER_AUTH_SECRET" | "PUBLIC_URL">

const rpID = "sippet.bastelboxx.de"
const invitationGone = "invitation used, expired, or unknown"
const provisionalUserPrefix = "invitation:"

// ── invitations (account rule 7) ───────────────────────────────────────────

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

// Read-only: is this token an open invitation?
export const findOpenInvitation = async ({ db, token }: { db: D1Database; token: string }) =>
  db
    .prepare(`SELECT id, name FROM invitation WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2`)
    .bind(await sha256Hex(token), Date.now())
    .first<{ id: string; name: string }>()

// resolveUser runs in generate-register-options, before the WebAuthn ceremony (verify 1).
// So it only checks the invitation and hands out a provisional user; consumeInvitation does the one-use claim after the ceremony.
const joinFromInvitation =
  (env: AuthEnv) =>
  async ({ context }: { context?: string | null | undefined }) => {
    const invitation = context ? await findOpenInvitation({ db: env.DB, token: context }) : null

    if (invitation === null) throw new APIError("GONE", { message: invitationGone })

    return { id: `${provisionalUserPrefix}${invitation.id}`, name: invitation.name }
  }

// afterVerification runs once the passkey is verified. One statement claims the invitation, so one use.
const consumeInvitation =
  (env: AuthEnv): NonNullable<NonNullable<PasskeyOptions["registration"]>["afterVerification"]> =>
  async ({ ctx, user }) => {
    if (!user.id.startsWith(provisionalUserPrefix)) return // a signed-in cook adding a passkey
    const id = user.id.slice(provisionalUserPrefix.length)

    const claimed = await env.DB.prepare(
      `UPDATE invitation SET used_at = ?1 WHERE id = ?2 AND used_at IS NULL AND expires_at > ?1 RETURNING name, email`,
    )
      .bind(Date.now(), id)
      .first<{ name: string; email: string }>()

    if (claimed === null) throw new APIError("GONE", { message: invitationGone })

    try {
      const created = await ctx.context.internalAdapter.createUser(
        { name: claimed.name, email: claimed.email, emailVerified: false },
        { method: "invitation" },
      )

      await env.DB.prepare(`UPDATE invitation SET user_id = ?1 WHERE id = ?2`).bind(created.id, id).run()

      return { userId: created.id }
    } catch (error) {
      await env.DB.prepare(`UPDATE invitation SET used_at = NULL WHERE id = ?1`).bind(id).run() // release the claim
      throw error
    }
  }

// ── hooks ──────────────────────────────────────────────────────────────────

// account rule 3: never the last passkey
const refuseLastPasskey = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/passkey/delete-passkey") return
  const session = await getSessionFromCtx(ctx)

  if (session === null) return // the endpoint answers 401
  const count = await ctx.context.adapter.count({ model: "passkey", where: [{ field: "userId", value: session.user.id }] })

  if (count <= 1) throw new APIError("BAD_REQUEST", { message: "the last passkey can't be removed" })
})

// account rule 4: the cook approved a client on /connect
const connectApproved = (env: AuthEnv) =>
  createAuthMiddleware(async (ctx) => {
    if (ctx.path !== "/oauth2/consent" || ctx.body?.accept !== true) return
    const session = await getSessionFromCtx(ctx)
    const clientId = new URLSearchParams(ctx.body.oauth_query ?? "").get("client_id")

    if (session === null || clientId === null) return

    // the consent row proves the endpoint accepted
    const consent = await ctx.context.adapter.findOne({
      model: "oauthConsent",
      where: [
        { field: "clientId", value: clientId },
        { field: "userId", value: session.user.id },
      ],
    })

    if (consent === null) return

    const client = await ctx.context.adapter.findOne<{ name?: string | null }>({
      model: "oauthClient",
      where: [{ field: "clientId", value: clientId }],
    })

    await env.COOK_LIBRARY.getByName(session.user.id).connectClient({ clientId, name: client?.name ?? "Claude" })
  })

// ── Better Auth ────────────────────────────────────────────────────────────

export const createAuth = (env: AuthEnv, database: BetterAuthOptions["database"] = env.DB) =>
  betterAuth({
    database,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.PUBLIC_URL,
    basePath: "/api/auth",
    emailAndPassword: { enabled: false },
    plugins: [
      jwt({ jwt: { issuer: env.PUBLIC_URL } }),
      passkey({
        rpID: new URL(env.PUBLIC_URL).hostname === "localhost" ? "localhost" : rpID,
        rpName: "Sippet",
        origin: env.PUBLIC_URL,
        registration: { requireSession: false, resolveUser: joinFromInvitation(env), afterVerification: consumeInvitation(env) },
      }),
      mcp({
        resource: `${env.PUBLIC_URL}/mcp`,
        loginPage: "/connect",
        consentPage: "/connect",
        scopes: ["offline_access"],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        allowPublicClientPrelogin: true, // /connect reads client_name before consent
        clientRegistrationDefaultApplicationType: "infer",
        accessTokenExpiresIn: 3600,
      }),
    ],
    hooks: { before: refuseLastPasskey, after: connectApproved(env) },
  })

export type Auth = ReturnType<typeof createAuth>
