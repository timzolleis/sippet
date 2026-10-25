/**
 * `base` with `key` set when `value` is present; with exactOptionalPropertyTypes an absent field must be missing, not undefined.
 */
export const withOptional = <Base extends object, Key extends string, Value>(
  base: Base,
  key: Key,
  value: Value | undefined,
): Base & { readonly [Field in Key]?: Value } => {
  if (value === undefined) return base
  const present = { ...base }

  return Object.assign(present, { [key]: value })
}
