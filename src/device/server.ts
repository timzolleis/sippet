// The device web handler for one CookLibrary instance: its Library closed over, like mcpWebHandler.
import { Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import type { Library } from "../store/library.ts"
import { DeviceHttpApi } from "./device-api.ts"
import { deviceControllerLayer } from "./device-controller.ts"
import { DeviceMiddleware } from "./device-middleware.ts"
import { deviceViewsLayer } from "./device-views.ts"

export const deviceWebHandler = ({ library }: { readonly library: Library }) => {
  const app = HttpApiBuilder.layer(DeviceHttpApi).pipe(
    Layer.provide(deviceControllerLayer(library)),
    Layer.provide(deviceViewsLayer(library)),
    Layer.provide(DeviceMiddleware.layer),
    Layer.provide(HttpServer.layerServices),
  )

  return HttpRouter.toWebHandler(app, { disableLogger: true })
}
