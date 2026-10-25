// Sent once per session as the server's `instructions` (specs/mcp.md Instructions).
export const instructions = `Sippet is the cook's recipe library. Read before you write: \`get_recipe\` gives the revision to pass as \`fromRevision\`.

Write recipes as steps, the way the source has them, in the recipe's language. Give every section, ingredient, step, equipment, and portion a short key (\`zucker-teig\`, \`verkneten\`). A step's \`uses\` names the ingredients it adds; \`takes\` names earlier steps' results and portions, never ingredients. Leave \`takes\` out and the flow is derived: a step takes the previous result in its section, a step without a section joins the sections before it, and a step that uses nothing (vorheizen) is waited for by the next step with the same equipment. Put parallel parts in sections. Put one-ingredient work (auspressen, schmelzen) on the ingredient as \`prep\`. Name \`takes\` only where the derived flow is wrong, as for split portions. Check the returned \`flow\`.

Units are codes (\`g\`, \`tsp\`, \`packet\`, \`tub\`, …) whatever the language; \`{ "custom": "Messerspitze" }\` only when none fits. Durations in minutes; none if the source gives no length.

A refusal lists every problem with its \`rule\` and a \`fix\`. Fix them all and send the batch again; \`dryRun: true\` checks without writing.`
