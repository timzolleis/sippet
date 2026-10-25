import { defineConfig } from "vitest/config"

// Its own config, so the tests don't run with the account UI's Vite root (vite.config.ts).
export default defineConfig({})
