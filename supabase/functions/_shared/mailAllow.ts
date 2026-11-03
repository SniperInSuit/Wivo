/**
 * EMAIL_ALLOW_ONLY: on the test copy, which holds a copy of production's
 * accounts, mail may reach only Kevin's own addresses (docs/ACCOUNTS.md §6.4).
 * Never set on production.
 *
 * A comma-separated list. `@wivodent.com` allows a domain, `fullgevity@` a
 * mailbox on any domain, anything else one exact address. Unset or empty:
 * every address is allowed.
 *
 * No imports, so Deno and Vitest load it as it is.
 */
export function mayMail(address: string, allowOnly: string | undefined): boolean {
  const rules = (allowOnly ?? '').split(',').map(r => r.trim().toLowerCase()).filter(Boolean)
  if (rules.length === 0) return true
  const a = address.trim().toLowerCase()
  return rules.some(r => r.startsWith('@') ? a.endsWith(r) : r.endsWith('@') ? a.startsWith(r) : a === r)
}
