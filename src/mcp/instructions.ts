// Sent once per session as the server's `instructions` (specs/mcp.md Instructions).
export const instructions = `Sippet is the cook's recipe library. Read before you write: \`get_recipe\` gives the revision to pass as \`fromRevision\`.

Write recipes as steps, the way the source has them. Give every section, ingredient, step, equipment, and portion a short key (\`zucker-teig\`, \`verkneten\`). Name the ingredients each step uses; the flow follows: a step takes the result of the previous step in its section, a step without a section joins the sections before it, and a step that uses nothing (vorheizen) is waited for by the next step with the same equipment. Put parallel parts in sections. Put one-ingredient work (auspressen, schmelzen) on the ingredient as \`prep\`. Name \`takes\` only where the derived flow is wrong, as for split portions. Check the returned \`flow\`.

Use unit codes (\`g\`, \`tsp\`, \`packet\`, \`tub\`, …); \`{ "custom": "Messerspitze" }\` for anything else. Durations in minutes; none if the source gives no length.

A refusal lists every problem. Fix them all and send the batch again.`
