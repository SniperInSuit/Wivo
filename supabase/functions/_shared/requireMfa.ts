/**
 * Does the caller's session have the second factor — as the DATABASE sees it
 * (sql/098 `has_mfa()`: aal2 in the token AND the session not ended)?
 *
 * Not the token's own `aal`: a session an owner has just reset still carries
 * a token saying aal2 until it runs out. Asked through the caller's own client,
 * so it is their session that is checked. Any error is a no.
 *
 * No imports, so Vitest tests it as it is.
 */
export type Rpc = (fn: string) => PromiseLike<{ data: unknown; error: unknown }>

export async function sessionHasMfa(rpc: Rpc): Promise<boolean> {
  try {
    const { data, error } = await rpc('has_mfa')
    return !error && data === true
  } catch {
    return false
  }
}
