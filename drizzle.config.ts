// `pnpm db:generate` writes migrations/cook-library/*.sql plus migrations.js (bundled into the Worker, run by CookLibrary on activation).
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: "./src/store/schema.ts",
  out: "./migrations/cook-library",
})
