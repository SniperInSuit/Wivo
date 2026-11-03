/**
 * The functions only pg_cron may call (send-notifications, send-invoices):
 * the gateway's JWT check is off for them, because it would let the public
 * anon key or any signed-in user's token through, so their own check
 * (isServiceRequest, serviceAuth.test.ts) must be the very first thing they do.
 * This keeps it so.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const functions = join(__dirname, '..')
const config = readFileSync(join(functions, '..', 'config.toml'), 'utf8')

describe.each(['send-notifications', 'send-invoices'])('%s answers only this project\'s service key', name => {
  const source = readFileSync(join(functions, name, 'index.ts'), 'utf8')

  it('checks the caller first thing in its handler, and refuses with 401', () => {
    const handler = source.slice(source.indexOf('Deno.serve('))
    const firstStatement = handler.split('\n').slice(1).find(l => l.trim() && !l.trim().startsWith('//'))
    expect(firstStatement?.trim()).toBe("if (!isServiceRequest(req.headers.get('Authorization'), env)) {")
    expect(handler).toMatch(/isServiceRequest[^\n]*\n\s*return json\(401,/)
  })

  it('its own database client uses the service key the check accepts', () => {
    expect(source).toContain('serviceClientKey(env)')
  })

  it('has the gateway\'s JWT check off in config.toml', () => {
    expect(config).toMatch(new RegExp(`\\[functions\\.${name}\\]\\s*\\nverify_jwt = false`))
  })
})
