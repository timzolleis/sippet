// What a model gets from the MCP surface on its first try (specs/mcp.md Refusals, dryRun, Schema size).
import { describe, expect, it } from "vitest"
import { makeCook } from "./harness.ts"

// A Rührkuchen written as a model first writes it: "Eier unterrühren" names the eggs in takes, and the flour
// mixture is a second bowl in the same (no) section, so the chain makes it take the butter mixture too.
const firstTry = {
  title: "Marmorkuchen",
  yield: { amount: { value: 1, unit: "piece" }, vessel: "kastenform" },
  edits: [
    { op: "add_equipment", key: "kastenform", name: "Kastenform 25 cm" },
    { op: "add_equipment", key: "ofen", name: "Ofen" },
    { op: "add_ingredient", key: "butter", item: "Butter", amount: { value: 250, unit: "g" }, note: "weich" },
    { op: "add_ingredient", key: "zucker", item: "Zucker", amount: { value: 200, unit: "g" } },
    { op: "add_ingredient", key: "eier", item: "Eier", amount: { value: 4 } },
    { op: "add_ingredient", key: "mehl", item: "Mehl", amount: { value: 300, unit: "g" } },
    { op: "add_ingredient", key: "backpulver", item: "Backpulver", amount: { value: 1, unit: "packet" } },
    { op: "add_ingredient", key: "milch", item: "Milch", amount: { value: 100, unit: "ml" } },
    { op: "add_step", key: "vorheizen", label: "Ofen vorheizen", equipment: ["ofen"], temperature: { celsius: 175, mode: "top_bottom" } },
    { op: "add_step", key: "schaumig", label: "Butter und Zucker schaumig rühren", uses: ["butter", "zucker"] },
    { op: "add_step", key: "eier-unterruehren", label: "Eier einzeln unterrühren", takes: ["eier"] },
    { op: "add_step", key: "mehl-mischen", label: "Mehl und Backpulver mischen", uses: ["mehl", "backpulver"] },
    { op: "add_step", key: "teig", label: "Mehlmischung abwechselnd mit der Milch unterrühren", uses: ["milch"],
      takes: ["eier-unterruehren", "mehl-mischen"] },
    { op: "add_step", key: "backen", label: "in der Form backen", equipment: ["kastenform", "ofen"],
      duration: { minutes: 50, maxMinutes: 60, kind: "passive" }, result: { name: "Marmorkuchen" } },
  ],
}

describe("a German recipe on the first try", () => {
  it("is refused with named rules and fixes that say what to move where", async () => {
    const cook = makeCook()
    const client = await cook.connect()
    const refused = await client.call("add_recipe", firstTry)

    expect(refused.isError).toBe(true)

    expect(refused.value).toEqual({
      refused: true,
      problems: [
        {
          rule: "everything-named-exists",
          message: 'step "eier-unterruehren" takes the ingredient "eier"; takes is for results of earlier steps and portions',
          fix: 'move "eier" from takes to uses on "eier-unterruehren", and omit takes there (null in edit_step) so "eier-unterruehren" keeps the derived chain',
        },
        {
          rule: "every-ingredient-goes-to-one-step",
          message: 'ingredient "eier" is used by no step',
          fix: 'add "eier" to the uses of the step it goes into, or remove it',
        },
        {
          rule: "result-goes-to-one-place",
          message: 'result of "eier-unterruehren" is taken by "mehl-mischen" (derived: chain) and "teig"',
          fix: 'set takes: [] on "mehl-mischen" to stop it chaining "eier-unterruehren"; ' +
            'or split the result of "eier-unterruehren" (result.split) into one portion per step, and let each take its portion',
        },
      ],
    })

    expect(cook.count("recipe")).toBe(0)
  })

  it("is added once the fixes are applied as they say", async () => {
    const client = await makeCook().connect()

    const fixes = new Map([
      ["eier-unterruehren", { op: "add_step", key: "eier-unterruehren", label: "Eier einzeln unterrühren", uses: ["eier"] }],
      ["mehl-mischen", { op: "add_step", key: "mehl-mischen", label: "Mehl und Backpulver mischen", uses: ["mehl", "backpulver"], takes: [] }],
    ])

    const fixed = { ...firstTry, edits: firstTry.edits.map((edit) => fixes.get(edit.key) ?? edit) }

    const added = await client.call("add_recipe", fixed)
    expect(added.isError).toBe(false)
    const flowOf = (key: string) => added.value.steps.find((step: any) => step.key === key).flow
    expect(flowOf("eier-unterruehren").takes).toEqual(["schaumig"])
    expect(flowOf("mehl-mischen").takes).toEqual([])
    expect(flowOf("backen")).toMatchObject({ takes: ["teig"], waitsFor: ["vorheizen"] })
    expect(added.value.makes).toEqual(["backen"])
  })

  it("takes only add_* ops in add_recipe's batch: title and yield are top-level, and there's nothing to change", async () => {
    const client = await makeCook().connect()

    for (const edit of [{ op: "set_title", title: "x" }, { op: "remove_step", key: "backen" }, { op: "edit_step", key: "backen", label: "x" }]) {
      await expect(client.call("add_recipe", { ...firstTry, edits: [...firstTry.edits, edit] }), edit.op).rejects.toThrow(/-32602/)
    }
  })
})

describe("dryRun", () => {
  const pfannkuchen = {
    title: "Pfannkuchen",
    yield: { amount: { value: 4, unit: "serving" } },
    edits: [{ op: "add_ingredient", key: "mehl", item: "Mehl" }, { op: "add_step", key: "braten", label: "braten", uses: ["mehl"] }],
  }

  const tables = ["recipe", "revision", "change", "retry", "recipe_text", "recipe_item"]

  it("add_recipe runs every check, returns the recipe, and writes nothing", async () => {
    const cook = makeCook()
    const client = await cook.connect()
    const dry = await client.call("add_recipe", { ...pfannkuchen, dryRun: true })

    expect(dry.isError).toBe(false)
    expect(dry.value).toMatchObject({ revision: 1, title: "Pfannkuchen", hasFlow: true, makes: ["braten"] })

    for (const table of tables) expect(cook.count(table), table).toBe(0)

    const refused = await client.call("add_recipe", { ...firstTry, dryRun: true })
    expect(refused.value.problems.map((problem: any) => problem.rule)).toContain("result-goes-to-one-place")

    const added = await client.call("add_recipe", pfannkuchen)
    expect(added.value.id).not.toBe(dry.value.id)
    expect(cook.count("recipe")).toBe(1)
  })

  it("edit_recipe returns the next revision without saving it, and isn't kept for a retry", async () => {
    const cook = makeCook()
    const client = await cook.connect()
    const recipeId = (await client.call("add_recipe", pfannkuchen)).value.id
    const edits = [{ op: "set_title", title: "Crêpes" }]
    const dry = await client.call("edit_recipe", { recipeId, fromRevision: 1, edits, dryRun: true })

    expect(dry.value).toMatchObject({ revision: 2, latestRevision: 2, title: "Crêpes" })
    expect((await client.call("get_recipe", { recipeId })).value).toMatchObject({ revision: 1, title: "Pfannkuchen" })
    expect(cook.count("revision")).toBe(1)
    expect(cook.count("change")).toBe(1)

    const saved = await client.call("edit_recipe", { recipeId, fromRevision: 1, edits })
    expect(saved.value).toMatchObject({ revision: 2, title: "Crêpes" })
    expect(cook.count("revision")).toBe(2)
  })
})

describe("tools/list (specs/mcp.md Schema size)", () => {
  // Measured: 54,146 bytes before $defs, compaction, and loose output schemas; see the spec for the current size.
  const ceilingBytes = 33_000

  it(`stays under ${ceilingBytes} bytes`, async () => {
    const client = await makeCook().connect()
    const listed = (await client.request("tools/list")).result
    expect(JSON.stringify(listed).length).toBeLessThan(ceilingBytes)
  })

  it("sends shared types once per tool as $defs, without JSON Schema defaults", async () => {
    const client = await makeCook().connect()
    const tools: Array<any> = (await client.request("tools/list")).result.tools
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]))
    const listed = JSON.stringify(tools)

    expect(listed).not.toContain('"additionalProperties":true')
    expect(Object.keys(byName["add_recipe"].inputSchema.$defs)).toEqual(expect.arrayContaining(["Key", "Unit", "Amount", "Duration", "StepResult"]))

    const opsOf = (name: string): Array<string> => byName[name].inputSchema.properties.edits.items.anyOf.map((edit: any) => edit.properties.op.const)
    expect(opsOf("add_recipe")).toEqual(["add_section", "add_ingredient", "add_equipment", "add_step"])
    expect(opsOf("edit_recipe")).toEqual(expect.arrayContaining(["set_title", "set_yield", "add_step", "edit_step"]))

    // list_revisions doesn't carry the edits' schemas
    expect(JSON.stringify(byName["list_revisions"].outputSchema)).not.toContain("add_step")
  })

  it("declares the refusal in every write's output schema", async () => {
    const client = await makeCook().connect()
    const tools: Array<any> = (await client.request("tools/list")).result.tools

    for (const tool of tools.filter((candidate) => candidate.annotations.readOnlyHint === false)) {
      expect(tool.outputSchema.type, tool.name).toBe("object")
      expect(tool.outputSchema.anyOf, tool.name).toContainEqual({ $ref: "#/$defs/Refusal" })
      expect(tool.outputSchema.$defs.Refusal.properties.problems.items.required, tool.name).toEqual(["rule", "message", "fix"])
    }
  })
})
