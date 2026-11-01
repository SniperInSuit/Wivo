/** Values a message is filled in with. Messages that compute (plurals) get them whole. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Params = Record<string, any>

/**
 * A message: plain text with `{name}` placeholders, or — where the wording
 * itself depends on a value, such as a plural — a function of the params.
 */
export type Message = string | ((p: Params) => string)
