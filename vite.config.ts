import { fileURLToPath } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

import { themeCss } from "./web/src/theme.ts"

const web = fileURLToPath(new URL("./web", import.meta.url))

// The colors, generated at build time instead of shipping the generator: `themeCss()` as `virtual:theme.css`,
// imported after the tokens, so it lands in the shared stylesheet.
const themeId = "\0virtual:theme.css"

const theme = (): Plugin => ({
  name: "sippet-theme",
  resolveId: (id) => (id === "virtual:theme.css" ? themeId : undefined),
  load: (id) => (id === themeId ? themeCss() : undefined),
})

// Three static pages served as assets; the Worker only answers /api, /mcp and /.well-known.
export default defineConfig({
  root: web,
  plugins: [theme(), tailwindcss(), react()],
  resolve: { alias: { "~": `${web}/src` } },
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        join: `${web}/join.html`,
        connect: `${web}/connect.html`,
        account: `${web}/account.html`,
      },
    },
  },
})
