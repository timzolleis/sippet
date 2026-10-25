// The MCP web handler for one CookLibrary instance: its Library closed over in the tool layer (hosting.md Verify 4).
import { Layer } from "effect"
import { McpProtocol, McpServer } from "effect/ai"
import { HttpRouter } from "effect/http"
import type { Library } from "../store/library.ts"
import { toolsLayer } from "./handlers.ts"
import { instructions } from "./instructions.ts"
import { SippetToolkit } from "./tools.ts"

export const makeMcpHandler = ({ library }: { readonly library: Library }) => {
  const app = McpServer.toolkit(SippetToolkit).pipe(
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
