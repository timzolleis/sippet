/// <reference types="node" />
// A local cook for working on the iOS app against `pnpm dev`: Claude adds the Zupfkuchen and the pasta (and revises it) over MCP, tags them,
// and the device signs in through sippet-app. Prints SIPPET_REFRESH_TOKEN for the app's scheme, and a Claude token to make changes.
// Local only: it writes into the local D1 file. Run: pnpm dev-cook [http://localhost:1337]
import { createHash, randomBytes } from "node:crypto"
import { Schema } from "effect"
import { pastaIngredientEdits, pastaPlainStepEdits, pastaTitle, pastaUsesEdits, pastaYield, zupfkuchenEdits, zupfkuchenTitle, zupfkuchenYield } from "../test/domain/fixtures.ts"
import { joinLocalCook, signInDevice, type Browser } from "./device-token.ts"
import { at, connectMcp, json, textOf } from "./support.ts"

const b64url = (data: Buffer) => data.toString("base64url")
const Client = Schema.Struct({ client_id: Schema.String })
const Redirect = Schema.Struct({ url: Schema.optional(Schema.String) })
const Consent = Schema.Struct({ url: Schema.String })
const Token = Schema.Struct({ access_token: Schema.String })

// Claude connects the way claude.ai does: DCR, authorize, consent in the cook's browser session, token.
const connectClaude = async ({ origin, browser }: { origin: string; browser: Browser }): Promise<string> => {
  const redirectUri = "https://claude.ai/api/mcp/auth_callback"

  const client = await json(Client, await browser.request(`/api/auth/oauth2/register`, {
    method: "POST",
    json: { client_name: "Claude", redirect_uris: [redirectUri], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
  }))

  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash("sha256").update(verifier).digest())
  const query = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: redirectUri, scope: "offline_access", state: "s1", code_challenge: challenge, code_challenge_method: "S256", resource: `${origin}/mcp` })
  const authorize = await browser.request(`/api/auth/oauth2/authorize?${query}`, { headers: { accept: "application/json" } })
  const location = authorize.headers.get("location") ?? (await json(Redirect, authorize)).url

  if (location === undefined) throw new Error(`authorize answered ${authorize.status} without a redirect`)
  const next = new URL(location, origin)
  const consent = await json(Consent, await browser.request(`/api/auth/oauth2/consent`, { method: "POST", json: { accept: true, oauth_query: next.search.slice(1) } }))
  const code = new URL(consent.url).searchParams.get("code")

  if (code === null) throw new Error("consent returned no code")

  const token = await json(Token, await browser.request(`/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: client.client_id, code_verifier: verifier, resource: `${origin}/mcp` }),
  }))

  return token.access_token
}

const origin = process.argv[2] ?? "http://localhost:1337"
const cook = await joinLocalCook(origin)
const claudeToken = await connectClaude({ origin, browser: cook.browser })
const { call } = await connectMcp({ origin, token: claudeToken })

const added = async (title: string, result: Awaited<ReturnType<typeof call>>) => {
  if (result.isError) throw new Error(`add_recipe ${title} refused: ${JSON.stringify(result.value)}`)

  return textOf(at(result.value, "id"))
}

const zupfkuchen = await added(zupfkuchenTitle, await call("add_recipe", { title: zupfkuchenTitle, yield: zupfkuchenYield, edits: zupfkuchenEdits }))
const pasta = await added(pastaTitle, await call("add_recipe", { title: pastaTitle, yield: pastaYield, edits: [...pastaIngredientEdits, ...pastaPlainStepEdits] }))
await call("edit_recipe", { recipeId: pasta, fromRevision: 1, edits: pastaUsesEdits }) // a second revision, as Claude would name each step's ingredients

await call("edit_library", {
  edits: [
    { op: "tag", tag: "Kuchen", recipeIds: [zupfkuchen] },
    { op: "tag", tag: "vegan", recipeIds: [zupfkuchen] },
    { op: "tag", tag: "Schnell", recipeIds: [pasta] },
    { op: "create_collection", name: "Wochenende", recipeIds: [zupfkuchen, pasta] },
  ],
})

const { tokens } = await signInDevice(cook)

console.log(`cook:         ${cook.cookId}`)
console.log(`recipes:      ${zupfkuchenTitle} (${zupfkuchen}), ${pastaTitle} (${pasta})`)
console.log(`claude token: ${claudeToken}`)
console.log(`\nSIPPET_REFRESH_TOKEN=${tokens.refresh_token}`)
