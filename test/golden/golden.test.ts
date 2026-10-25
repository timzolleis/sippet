import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, it } from "vitest"
import { goldenCookingJson } from "../../scripts/golden.ts"

it("test/golden/cooking.json is current; run `pnpm golden` after changing the cooking math", () => {
  const committed = readFileSync(join(import.meta.dirname, "cooking.json"), "utf8")
  expect(goldenCookingJson()).toBe(committed)
})
