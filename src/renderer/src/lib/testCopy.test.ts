import { describe, it, expect } from 'vitest'
import { supabaseTarget, PRODUCTION_REF } from './testCopy'

const TEST_URL = 'https://jhqyvancrzykxhzwnost.supabase.co'
const PROD_URL = `https://${PRODUCTION_REF}.supabase.co`

describe('supabaseTarget: test mode never reaches production', () => {
  it('outside test mode: the values as they are', () => {
    expect(supabaseTarget('development', PROD_URL, 'k')).toEqual({ url: PROD_URL, key: 'k', problem: null })
  })

  it('test mode with the test copy: connected', () => {
    expect(supabaseTarget('test', TEST_URL, 'k')).toEqual({ url: TEST_URL, key: 'k', problem: null })
  })

  it('test mode pointed at production (or falling back to .env): refused, nowhere', () => {
    const r = supabaseTarget('test', PROD_URL, 'k')
    expect(r.problem).toBe('production')
    expect(r.url).not.toContain(PRODUCTION_REF)
    expect(r.key).not.toBe('k')
  })

  it('test mode with an empty .env.test: not connected', () => {
    for (const [u, k] of [['', 'k'], [TEST_URL, ''], [undefined, undefined], ['  ', 'k']] as const) {
      const r = supabaseTarget('test', u, k)
      expect(r.problem).toBe('missing')
      expect(r.url).toBe('http://127.0.0.1:9')
    }
  })
})

// ── Hardening: only the test copy, and its own session ─────────────────────

import { createClient } from '@supabase/supabase-js'
import { allowedInTestMode, guardTestFetch, installTestModeNetworkGuard, isSupabaseHost, TEST_ORIGIN, TEST_STORAGE_KEY, TestCopyRefused } from './testCopy'
import { supabaseOptions } from './supabaseOptions'

describe('test mode accepts only the test copy, not just "not production"', () => {
  it('any other project, or junk, is refused the same way', () => {
    for (const url of ['https://abcdefghijklmnopqrst.supabase.co', 'https://evil.example', 'http://jhqyvancrzykxhzwnost.supabase.co',
                       'https://jhqyvancrzykxhzwnost.supabase.co.evil.example', 'not a url']) {
      const r = supabaseTarget('test', url, 'k')
      expect(r.problem, url).toBe('not-test-copy')
      expect(r.url).toBe('http://127.0.0.1:9')
      expect(r.key).not.toBe('k')
    }
  })

  it('the test copy with a trailing slash is the test copy', () => {
    expect(supabaseTarget('test', `${TEST_URL}/`, 'k')).toEqual({ url: TEST_ORIGIN, key: 'k', problem: null })
  })
})

/**
 * The real Supabase client, built as the app builds it in test mode, with
 * every request it would send recorded instead of sent.
 */
function clientIn(mode: 'test' | 'development', url: string) {
  const sent: string[] = []
  const inner = (async (input: RequestInfo | URL) => {
    sent.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  const target = supabaseTarget(mode, url, 'anon-key')
  const client = createClient(target.url, target.key, {
    ...supabaseOptions(mode === 'test', inner),
    auth: { ...(supabaseOptions(mode === 'test').auth ?? {}), persistSession: false, autoRefreshToken: false },
  })
  return { client, sent }
}

/** One call of every kind the app makes: database, function, sign-in, storage, Edge Function. */
async function everyKindOfCall(client: ReturnType<typeof clientIn>["client"]): Promise<void> {
  await client.from('jobs').select('id').limit(1)
  await client.rpc('has_mfa')
  await client.auth.signInWithPassword({ email: 'a@b.ee', password: 'x' })
  await client.storage.from('job-files').createSignedUrl('a/b.stl', 60)
  await client.functions.invoke('file-link', { body: { fileId: 'x' } })
}

describe('every request in test mode goes to the test copy, or is not sent', () => {
  it('with the test copy configured: every request the client makes is addressed to the test copy', async () => {
    const { client, sent } = clientIn('test', TEST_URL)
    await everyKindOfCall(client)
    expect(sent.length).toBeGreaterThanOrEqual(5)
    const outside = sent.filter(u => !u.startsWith(`${TEST_ORIGIN}/`))
    expect(outside).toEqual([])
  })

  it('pointed at production, at another project, or not configured: nothing is sent at all', async () => {
    for (const url of [PROD_URL, 'https://abcdefghijklmnopqrst.supabase.co', '']) {
      const { client, sent } = clientIn('test', url)
      await everyKindOfCall(client)
      expect(sent, url || '(empty)').toEqual([])
    }
  }, 30_000)  // supabase-js retries a refused read for ~7 s before giving up: still nothing sent

  it('the guard refuses before sending, and lets the test copy through', async () => {
    let calls = 0
    const guarded = guardTestFetch((async () => { calls++; return new Response('') }) as typeof fetch)
    await expect(guarded(`${PROD_URL}/rest/v1/jobs`)).rejects.toBeInstanceOf(TestCopyRefused)
    await expect(guarded('http://127.0.0.1:9/rest/v1/jobs')).rejects.toBeInstanceOf(TestCopyRefused)
    expect(calls).toBe(0)
    await guarded(new URL(`${TEST_ORIGIN}/functions/v1/file-link`))
    expect(calls).toBe(1)
    expect(allowedInTestMode(`${TEST_ORIGIN}/storage/v1/upload/resumable`)).toBe(true)
  })

  it('outside test mode the client is left as it was (no guard, no separate session)', () => {
    expect('auth' in supabaseOptions(false)).toBe(false)
  })
})

describe('test mode keeps its own session', () => {
  it('its sign-in is stored under its own key, never the normal app\'s', () => {
    const options = supabaseOptions(true)
    expect(options.auth?.storageKey).toBe(TEST_STORAGE_KEY)
    // The normal app keeps supabase-js's default, sb-<project>-auth-token.
    expect(TEST_STORAGE_KEY).not.toMatch(/^sb-/)
  })

  it('the desktop\'s main process gives test mode its own userData folder, before anything reads it', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(__dirname, '../../../main/index.ts'), 'utf8')
    const setPath = src.indexOf("app.setPath('userData'")
    expect(setPath).toBeGreaterThan(-1)
    expect(src.slice(Math.max(0, setPath - 200), setPath)).toContain("import.meta.env.MODE === 'test'")
    for (const later of ['requestSingleInstanceLock', 'initSentryMain(', 'app.whenReady']) {
      const at = src.indexOf(later)
      if (at > -1) expect(at, later).toBeGreaterThan(setPath)
    }
  })
})

describe('the rest of the app in test mode (fetch, uploads, realtime)', () => {
  function fakeWindow() {
    const sent: string[] = []
    const opened: string[] = []
    const sockets: string[] = []
    class XHR { open(_m: string, url: string) { opened.push(url) } }
    class WS { constructor(url: string) { sockets.push(url) } }
    const w = {
      fetch: (async (input: RequestInfo | URL) => { sent.push(String(input)); return new Response('') }) as typeof fetch,
      XMLHttpRequest: XHR, WebSocket: WS,
    }
    installTestModeNetworkGuard(w as unknown as Parameters<typeof installTestModeNetworkGuard>[0])
    return { w, sent, opened, sockets }
  }

  it('a fetch, an upload or a socket to another Supabase project is refused; the test copy and the app\'s own files pass', async () => {
    const { w, sent, opened, sockets } = fakeWindow()
    await expect(w.fetch(`${PROD_URL}/rest/v1/jobs`)).rejects.toBeInstanceOf(TestCopyRefused)
    await expect(w.fetch('https://abcdefghijklmnopqrst.functions.supabase.co/x')).rejects.toBeInstanceOf(TestCopyRefused)
    await w.fetch(`${TEST_ORIGIN}/rest/v1/jobs`)
    await w.fetch('sounds/notify.mp3')
    expect(sent).toEqual([`${TEST_ORIGIN}/rest/v1/jobs`, 'sounds/notify.mp3'])

    const xhr = new w.XMLHttpRequest()
    expect(() => xhr.open('POST', `${PROD_URL}/storage/v1/upload/resumable`)).toThrow(TestCopyRefused)
    xhr.open('POST', `${TEST_ORIGIN}/storage/v1/upload/resumable`)
    expect(opened).toEqual([`${TEST_ORIGIN}/storage/v1/upload/resumable`])

    const Ws = w.WebSocket as unknown as new (url: string) => unknown
    expect(() => new Ws(`wss://${PRODUCTION_REF}.supabase.co/realtime/v1/websocket`)).toThrow(TestCopyRefused)
    new Ws(`wss://jhqyvancrzykxhzwnost.supabase.co/realtime/v1/websocket`)
    expect(sockets).toEqual(['wss://jhqyvancrzykxhzwnost.supabase.co/realtime/v1/websocket'])
  })

  it('knows a Supabase host from anything else', () => {
    expect(isSupabaseHost(`${PROD_URL}/x`)).toBe(true)
    expect(isSupabaseHost('https://abc.functions.supabase.co/x')).toBe(true)
    expect(isSupabaseHost('https://github.com/x')).toBe(false)
    expect(isSupabaseHost('sounds/x.mp3')).toBe(false)
  })
})
