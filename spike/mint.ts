// Creates an ES256 key pair, writes .token (for remote.ts) and .dev.vars (JWT_PUBLIC_JWK for wrangler).
// For a deploy: `npx wrangler secret put JWT_PUBLIC_JWK < .jwk`.
import { writeFileSync } from "node:fs"
import { exportJWK, generateKeyPair, SignJWT } from "jose"

const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true })
const jwk = JSON.stringify(await exportJWK(publicKey))
const token = await new SignJWT({ sub: "cook_1", aud: "https://sippet.example/mcp" })
  .setProtectedHeader({ alg: "ES256" }).setIssuer("https://sippet.example").setExpirationTime("7d").sign(privateKey)
writeFileSync(".token", token)
writeFileSync(".jwk", jwk)
writeFileSync(".dev.vars", `JWT_PUBLIC_JWK='${jwk}'\n`)
console.log("wrote .token, .jwk, .dev.vars")
