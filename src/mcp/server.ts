// The MCP web handler for one CookLibrary instance: its Library closed over in the tool layer (hosting.md Verify 4).
import { Effect, Layer, Schema } from "effect"
import { McpProtocol, McpSchema, McpServer } from "effect/ai"
import { HttpRouter } from "effect/http"
import type { Library } from "../store/library.ts"
import { compactJsonSchema, compactOutputSchema } from "./compact-tool-schema.ts"
import { toolsLayer } from "./handlers.ts"
import { instructions } from "./instructions.ts"
import { SippetToolkit } from "./tools.ts"

const decodeToolJson = Schema.decodeUnknownSync(McpSchema.ToolJson)

// Each tool as tools/list sends it, with compacted schemas (specs/mcp.md Schema size).
const compactTool = ({ tool, described }: { readonly tool: McpSchema.Tool; readonly described: Set<string> }): McpSchema.Tool =>
  new McpSchema.Tool({
    ...tool,
    inputSchema: decodeToolJson(compactJsonSchema({ schema: tool.inputSchema, described })),
    outputSchema: tool.outputSchema === undefined ? undefined : decodeToolJson(compactOutputSchema({ schema: tool.outputSchema, described })),
  })

// McpServer.toolkit, registering through a registry that compacts each tool first.
const toolkitLayer = Layer.effectDiscard(Effect.gen(function* () {
  const registry = yield* McpServer.McpServer
  // in the toolkit's order, so add_recipe documents the edits before edit_recipe
  const described = new Set<string>()

  const compacting = McpServer.McpServer.of({
    ...registry,
    addTool: (options) => registry.addTool({ ...options, tool: compactTool({ tool: options.tool, described }) }),
  })

  yield* McpServer.registerToolkit(SippetToolkit).pipe(Effect.provideService(McpServer.McpServer, compacting))
})).pipe(Layer.provide(McpServer.McpServer.layer))

export const mcpWebHandler = ({ library }: { readonly library: Library }) => {
  const app = toolkitLayer.pipe(
    Layer.provideMerge(toolsLayer(library)),
    Layer.provideMerge(
      McpServer.layerHttp({
        name: "sippet",
        version: "0.1.0",
        instructions,
        path: "/mcp",
        protocols: [McpProtocol.v2025_06_18, McpProtocol.v2025_11_25, McpProtocol.v2026_07_28],
      }),
    ),
  )

  return HttpRouter.toWebHandler(app, { disableLogger: true })
}
