import { Schema } from "effect"

// Who made a change: Claude through one connection, or a device (sync rule 4). The trash purges on its own.
export const ClaudeAuthor = Schema.Struct({ kind: Schema.Literal("claude"), connection: Schema.String })

export type ClaudeAuthor = typeof ClaudeAuthor.Type

export const DeviceAuthor = Schema.Struct({ kind: Schema.Literal("device"), device: Schema.String })

export type DeviceAuthor = typeof DeviceAuthor.Type

export const ChangeAuthor = Schema.Union([ClaudeAuthor, DeviceAuthor])

export type ChangeAuthor = typeof ChangeAuthor.Type
