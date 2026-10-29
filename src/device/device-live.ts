import * as Cloudflare from "@alchemy.run/cloudflare"
import type { RuntimeContext } from "alchemy"
import { Effect, Option, Schema } from "effect"

type CookState = Effect.Success<typeof Cloudflare.DurableObjectState>

// Live change notices over hibernating WebSockets (specs/device-api.md Live). The message carries only `seq`; the device catches up through listChangesAfter.
export const liveClosedCode = 4401

const Attachment = Schema.Struct({ expiresAt: Schema.Finite })
const decodeAttachment = Schema.decodeUnknownOption(Attachment)

// `expiresAt` is epoch milliseconds.
export const acceptLive = ({ connection, expiresAt, lastSeq }: { readonly connection: string; readonly expiresAt: number; readonly lastSeq: number }) =>
  Effect.gen(function* () {
    const [response, socket] = yield* Cloudflare.upgrade({ tags: [connection] })
    socket.serializeAttachment({ expiresAt })
    yield* socket.send(JSON.stringify({ seq: lastSeq })) // the device catches up if it's behind

    return response
  })

// Every open socket gets {"seq"}; one whose token expired is closed instead. A dead socket never fails a write.
export const broadcastChange = ({ state, seq, now }: { readonly state: CookState; readonly seq: number; readonly now: number }): Effect.Effect<void, never, RuntimeContext> =>
  Effect.gen(function* () {
    for (const socket of yield* state.getWebSockets()) {
      const expiresAt = Option.map(decodeAttachment(socket.deserializeAttachment()), (attachment) => attachment.expiresAt)
      const notice = Option.isSome(expiresAt) && expiresAt.value < now ? socket.close(liveClosedCode, "token expired") : socket.send(JSON.stringify({ seq }))

      yield* notice.pipe(Effect.catchCause(() => Effect.void)) // closing or closed: the runtime drops it
    }
  })

export const closeLive = ({ state, connection }: { readonly state: CookState; readonly connection: string }): Effect.Effect<void, never, RuntimeContext> =>
  Effect.gen(function* () {
    for (const socket of yield* state.getWebSockets(connection)) {
      yield* socket.close(liveClosedCode, "disconnected").pipe(Effect.catchCause(() => Effect.void)) // already closed
    }
  })
