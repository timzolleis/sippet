/// <reference types="node" />
// pnpm invite "Anna" anna@example.com
// Inserts an invitation row through the D1 HTTP API and prints the join link (account rule 7).
// Needs CLOUDFLARE_API_TOKEN and D1_DATABASE_ID (printed as databaseId by `alchemy deploy`). CLOUDFLARE_ACCOUNT_ID defaults to sippet's account.
import { createHash, randomBytes, randomUUID } from "node:crypto"

const days = 14
const defaultAccountId = "dfbe39d3621591908c9d962e0e644a6b"
const joinOrigin = "https://sippet.bastelboxx.de"

const [name, email] = process.argv.slice(2)

if (!name || !email || process.argv.length > 4) {
  console.error('usage: pnpm invite "Anna" anna@example.com')
  process.exit(2)
}

const require = (key: string): string => {
  const value = process.env[key]

  if (!value) {
    console.error(`${key} is not set`)
    process.exit(2)
  }

  return value
}

const token = randomBytes(32).toString("base64url")
const createdAt = Date.now()

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID ?? defaultAccountId}/d1/database/${require("D1_DATABASE_ID")}/query`,
  {
    method: "POST",
    headers: { authorization: `Bearer ${require("CLOUDFLARE_API_TOKEN")}`, "content-type": "application/json" },
    body: JSON.stringify({
      sql: `INSERT INTO invitation (id, token_hash, name, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
      params: [
        randomUUID(),
        createHash("sha256").update(token).digest("hex"),
        name,
        email,
        createdAt,
        createdAt + days * 24 * 60 * 60 * 1000,
      ],
    }),
  },
)

if (!response.ok) {
  console.error(`D1 query failed: ${response.status} ${await response.text()}`)
  process.exit(1)
}

console.log(`${joinOrigin}/join#${token}`)
