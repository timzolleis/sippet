import { Option, Schema } from "effect"

// Live change notices over hibernating WebSockets (specs/device-api.md Live). The message carries only `seq`; the device catches up through listChangesAfter.
export const liveClosedCode = 4401

const Attachment = Schema.Struct({ expiresAt: Schema.Finite })
const decodeAttachment = Schema.decodeUnknownOption(Attachment)

// `expiresAt` is epoch milliseconds.
export const acceptLive = ({ ctx, connection, expiresAt, lastSeq }: { readonly ctx: DurableObjectState; readonly connection: string; readonly expiresAt: number; readonly lastSeq: number }): Response => {
  const pair = new WebSocketPair()
  const [client, server] = [pair[0], pair[1]]
  ctx.acceptWebSocket(server, [connection])
  server.serializeAttachment({ expiresAt })
  server.send(JSON.stringify({ seq: lastSeq })) // the device catches up if it's behind

  return new Response(null, { status: 101, webSocket: client })
}

// Every open socket gets {"seq"}; one whose token expired is closed instead. A dead socket never fails a write.
export const broadcastChange = ({ ctx, seq, now }: { readonly ctx: DurableObjectState; readonly seq: number; readonly now: number }): void => {
  for (const socket of ctx.getWebSockets()) {
    try {
      const expiresAt = Option.map(decodeAttachment(socket.deserializeAttachment()), (attachment) => attachment.expiresAt)

      if (Option.isSome(expiresAt) && expiresAt.value < now) socket.close(liveClosedCode, "token expired")
      else socket.send(JSON.stringify({ seq }))
    } catch {
      // closing or closed: the runtime drops it
    }
  }
}

export const closeLive = ({ ctx, connection }: { readonly ctx: DurableObjectState; readonly connection: string }): void => {
  for (const socket of ctx.getWebSockets(connection)) {
    try {
      socket.close(liveClosedCode, "disconnected")
    } catch {
      // already closed
    }
  }
}
