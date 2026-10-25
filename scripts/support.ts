/// <reference types="node" />
// Shared by the local check scripts: CBOR for the software passkey, and schemas for response bodies.
import { Match, Schema } from "effect"

export type Cbor = number | string | Buffer | { readonly [key: string]: Cbor }

export const cbor = (value: Cbor): Buffer => {
  const head = (major: number, length: number) =>
    length < 24 ? Buffer.from([(major << 5) | length]) : Buffer.from([(major << 5) | 24, length])

  return Match.value(value).pipe(
    Match.when(Match.number, (number) => (number >= 0 ? head(0, number) : head(1, -1 - number))),
    Match.when(Match.string, (text) => Buffer.concat([head(3, Buffer.byteLength(text)), Buffer.from(text)])),
    Match.when(Match.instanceOf(Buffer), (bytes) => Buffer.concat([head(2, bytes.length), bytes])),
    Match.orElse((map) => {
      const entries = Object.entries(map)

      return Buffer.concat([head(5, entries.length), ...entries.flatMap(([key, item]) => [cbor(/^-?\d+$/.test(key) ? Number(key) : key), cbor(item)])])
    }),
  )
}

// `Open` keeps unlisted fields so they can still be shown.
export const Open = <const Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Json)])

export const JsonObject = Schema.Record(Schema.String, Schema.Json)

export const json = async <S extends Schema.ConstraintDecoder<unknown>>(schema: S, response: Response): Promise<S["Type"]> =>
  Schema.decodeUnknownSync(schema)(await response.json())
