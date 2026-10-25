import { describe, expect, it } from "vitest"
import { zupfkuchenEdits, zupfkuchenTitle, zupfkuchenYield } from "../domain/fixtures.ts"
import { makeCook } from "./harness.ts"

describe("smoke", () => {
  it("lists the tools and adds the Zupfkuchen", async () => {
    const cook = makeCook()
    const client = await cook.connect()
    const tools = await client.request("tools/list")
    console.log(tools.result.tools.map((tool: any) => tool.name), JSON.stringify(tools).length)
    const added = await client.call("add_recipe", { title: zupfkuchenTitle, yield: zupfkuchenYield, edits: zupfkuchenEdits })
    console.log(JSON.stringify(added).slice(0, 600))
    expect(added.isError).toBe(false)
  })
})
