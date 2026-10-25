/// <reference types="node" />
// Config for `auth generate` only: pnpm auth:generate. The database is a throwaway in-memory SQLite.
import { DatabaseSync } from "node:sqlite"
import { createAuth, type AuthEnv } from "../src/auth.ts"

// SAFETY: createAuth reads only BETTER_AUTH_SECRET and PUBLIC_URL while building the config; DB and COOK_LIBRARY are used per request, and no request is served here.
const env = {
  BETTER_AUTH_SECRET: "schema-only-secret-schema-only-secret",
  PUBLIC_URL: "https://sippet.bastelboxx.de",
} as AuthEnv

export const auth = createAuth(env, new DatabaseSync(":memory:"))
