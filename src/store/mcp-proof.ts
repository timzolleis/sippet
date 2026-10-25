// Verify 4 proof: a per-instance McpServer handler whose tool reads the request's sippet-* headers and this instance's storage.
import { Context, Effect, Layer, Schema } from "effect"
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai"
import { HttpRouter, HttpServerRequest } from "effect/http"

const Whoami = Tool.make("whoami", {
  description: "Proof: returns the sippet-* headers of this request and a counter from this instance's storage.",
  success: Schema.Struct({ headers: Schema.Record(Schema.String, Schema.String), calls: Schema.Number }),
})

const ProofToolkit = Toolkit.make(Whoami)

export const makeMcpHandler = ({ sql }: { sql: SqlStorage }) => {
  const ToolsLive = ProofToolkit.toLayer({
    whoami: () =>
      Effect.gen(function* () {
        const request = Context.getOrUndefined(yield* Effect.context<never>(), HttpServerRequest.HttpServerRequest)
        const headers: Record<string, string> = {}

        for (const [name, value] of Object.entries(request?.headers ?? {})) if (name.startsWith("sippet-")) headers[name] = value
        sql.exec(`CREATE TABLE IF NOT EXISTS proof (n INTEGER)`)
        sql.exec(`INSERT INTO proof VALUES (1)`)
        const calls = sql.exec<{ n: number }>(`SELECT count(*) AS n FROM proof`).one().n

        return { headers, calls }
      }),
  })

  const App = McpServer.toolkit(ProofToolkit).pipe(
    Layer.provideMerge(ToolsLive),
    Layer.provideMerge(
      McpServer.layerHttp({
        name: "sippet",
        version: "0.0.0",
        path: "/mcp",
        protocols: [McpProtocol.v2025_06_18, McpProtocol.v2025_11_25, McpProtocol.v2026_07_28],
      }),
    ),
  )

  return HttpRouter.toWebHandler(App, { disableLogger: true })
}
