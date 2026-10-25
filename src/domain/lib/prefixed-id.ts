import { Schema } from "effect"

export const prefixedId = (prefix: string) =>
  Schema.String.check(Schema.isPattern(new RegExp(`^${prefix}_[a-z][a-z0-9]{23}$`)))

const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"

// A letter, then 23 random base-36 characters, as cuid2 shapes them. No cuid2 dependency: only hosting adds dependencies.
export const createPrefixedId = (prefix: string): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  const characters = Array.from(bytes, (byte, index) => index === 0 ? alphabet[byte % 26] : alphabet[byte % 36])

  return `${prefix}_${characters.join("")}`
}
