import { describe, it, expect } from 'vitest'
import { scrubPersonalData, scrubSentryEvent } from './scrub'

describe('scrubSentryEvent', () => {
  const event = {
    message: 'Insert failed for mari@example.com',
    user: { id: 'u1', email: 'mari@example.com', ip_address: '1.2.3.4' },
    extra: { patient: { nimi: 'Mari Maasikas' } },
    request: { url: 'https://x.supabase.co/rest/v1/patients?nimi=ilike.*Maasikas*', method: 'GET', data: '{"nimi":"Mari"}' },
    exception: { values: [{ type: 'Error', value: 'Patient 48001010000 not found',
      stacktrace: { frames: [{ filename: 'a.js', lineno: 1, vars: { patient: 'Mari Maasikas' } }] } }] },
    breadcrumbs: [
      { category: 'console', message: 'Mari Maasikas' },
      { category: 'ui.input', message: 'typed' },
      { category: 'fetch', data: { url: 'https://x.supabase.co/rest/v1/jobs?patsient=eq.Mari%20Maasikas', method: 'GET' } },
      { category: 'navigation', data: { from: '/a?x=1', to: '/b?q=Mari' } },
    ],
  }
  const out = scrubSentryEvent(event)!
  const text = JSON.stringify(out)

  it('nothing personal survives', () => {
    for (const s of ['Maasikas', 'mari@example.com', '48001010000', '1.2.3.4', 'Mari']) expect(text).not.toContain(s)
  })

  it('the error itself and where it happened survive', () => {
    expect(out.exception.values[0].type).toBe('Error')
    expect(out.exception.values[0].stacktrace.frames[0]).toEqual({ filename: 'a.js', lineno: 1 })
    expect(out.request).toEqual({ url: 'https://x.supabase.co/rest/v1/patients', method: 'GET' })
    expect(out.breadcrumbs.map((b: { category: string }) => b.category)).toEqual(['fetch', 'navigation'])
  })

  it('does not change the original event', () => {
    expect(event.user.email).toBe('mari@example.com')
  })

  it('text scrubbing keeps ordinary messages', () => {
    expect(scrubPersonalData('TypeError: x is undefined')).toBe('TypeError: x is undefined')
  })
})
