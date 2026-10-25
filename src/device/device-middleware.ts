// x-device-id, x-device-name, and the Worker's sippet-connection → CurrentDevice (specs/device-api.md Endpoints).
import { Context, Effect, Layer, Schema } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiMiddleware } from "effect/http-api"
import { DeviceUnknownHttpError } from "./device-http-errors.ts"

export const DeviceId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu))
export const DeviceName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40))

export class CurrentDevice extends Context.Service<CurrentDevice, {
  readonly connection: string
  readonly deviceId: string
  readonly deviceName: string
}>()("CurrentDevice") {}

// x-device-name travels percent-encoded UTF-8; malformed encoding is unknown, like a bad length.
const decodeName = (encoded: string | undefined) => {
  try {
    return encoded === undefined ? undefined : decodeURIComponent(encoded)
  } catch {
    return undefined
  }
}

const DeviceHeaders = Schema.Struct({ "x-device-id": DeviceId, "x-device-name": DeviceName, "sippet-connection": Schema.String })

const decodeHeaders = Schema.decodeUnknownEffect(DeviceHeaders)

export class DeviceMiddleware extends HttpApiMiddleware.Service<DeviceMiddleware, {
  provides: CurrentDevice
}>()("DeviceMiddleware", { error: DeviceUnknownHttpError }) {
  static layer = Layer.succeed(DeviceMiddleware, DeviceMiddleware.of((handler) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const headers = yield* decodeHeaders({ ...request.headers, "x-device-name": decodeName(request.headers["x-device-name"]) }).pipe(Effect.mapError(() => new DeviceUnknownHttpError()))

      return yield* handler.pipe(Effect.provideService(CurrentDevice, {
        connection: headers["sippet-connection"],
        deviceId: headers["x-device-id"],
        deviceName: headers["x-device-name"],
      }))
    })
  ))
}
