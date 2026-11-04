/**
 * config/test-copy.env is in git, so it may hold only what is public by
 * design: the test copy's URL and its anon key. This fails the moment
 * anything else is added (a service_role or secret key, an access token, a
 * Resend key, another name), and dev:test refuses to start on the same.
 * dev:test reads that file and no .env file.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TEST_COPY_ENV, jwtPayload, parseTestCopyEnv, testCopyDefine } from './testCopyEnv'
import { PRODUCTION_REF, TEST_ORIGIN, TEST_REF } from '../src/renderer/src/lib/testCopy'
import config from '../electron.vite.config'

const ROOT = join(__dirname, '..')
const committed = readFileSync(join(ROOT, TEST_COPY_ENV), 'utf8')

const part = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (payload: object): string => `${part({ alg: 'HS256', typ: 'JWT' })}.${part(payload)}.c2lnbmF0dXJl`
const ANON = jwt({ iss: 'supabase', ref: TEST_REF, role: 'anon' })
const URL_LINE = `VITE_SUPABASE_URL=${TEST_ORIGIN}\n`

describe('config/test-copy.env: public values only', () => {
  it('holds the test copy\'s URL and anon key, and nothing else', () => {
    const env = parseTestCopyEnv(committed)
    expect(env.problems).toEqual([])
    expect(env.url).toBe(TEST_ORIGIN)
    // An anon JWT says whose it is: the test copy's. (Empty until pasted: test mode then connects nowhere.)
    if (env.key.startsWith('eyJ')) expect(jwtPayload(env.key)).toMatchObject({ ref: TEST_REF, role: 'anon' })
  })

  it('accepts an anon key, a publishable key, or none', () => {
    for (const key of [ANON, 'sb_publishable_abc123_XYZ', '', `"${ANON}"`]) {
      expect(parseTestCopyEnv(`${URL_LINE}VITE_SUPABASE_ANON_KEY=${key}\n`).problems, key).toEqual([])
    }
  })

  it('names every secret that is added, wherever it is', () => {
    const SERVICE = jwt({ iss: 'supabase', ref: TEST_REF, role: 'service_role' })
    const cases: [string, RegExp][] = [
      [`${URL_LINE}VITE_SUPABASE_ANON_KEY=${SERVICE}`, /a service_role key, not the anon key/],
      [`${URL_LINE}VITE_SUPABASE_ANON_KEY=sb_secret_N7UND0UgjKTVK-Uodkm0Hg`, /not a public key.*secret key \(sb_secret_\)/],
      [`${URL_LINE}VITE_SUPABASE_ANON_KEY=some-password`, /not a public key/],
      [`${URL_LINE}VITE_SUPABASE_ANON_KEY=${ANON}\nSUPABASE_SERVICE_ROLE_KEY=${SERVICE}`, /SUPABASE_SERVICE_ROLE_KEY: only VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY belong here.*token outside/],
      [`${URL_LINE}RESEND_API_KEY=re_123456789_abcdefghijklmnop`, /RESEND_API_KEY: only .*Resend key/],
      [`# old key, do not use: ${SERVICE}\n${URL_LINE}`, /a token outside VITE_SUPABASE_ANON_KEY/],
      [`# supabase login: sbp_0123456789abcdef0123456789abcdef\n${URL_LINE}`, /access token \(sbp_\)/],
      [`${URL_LINE}-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----`, /private key/],
      [`${URL_LINE}VITE_SUPABASE_ANON_KEY=${ANON}\nVITE_SUPABASE_ANON_KEY=${ANON}`, /set twice/],
      [`${URL_LINE}export SECRET`, /line 2 is not NAME=value/],
    ]
    for (const [text, problem] of cases) {
      expect(parseTestCopyEnv(text).problems.join('; '), text).toMatch(problem)
    }
  })

  it('the comments in it are not taken for a secret', () => {
    expect(committed).toMatch(/service_role/)
    expect(parseTestCopyEnv(committed).problems).toEqual([])
  })
})

describe('dev:test', () => {
  type Renderer = (env: { mode: string; command: 'serve' | 'build' }) => { define?: Record<string, unknown>; envDir?: string }
  const renderer = (config as unknown as { renderer: Renderer }).renderer

  it('reads config/test-copy.env and no .env file', () => {
    const r = renderer({ mode: 'test', command: 'serve' })
    const env = parseTestCopyEnv(committed)
    expect(r.define).toMatchObject({
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.url),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.key),
    })
    expect(r.envDir).toBe(join(ROOT, 'config'))
    expect(committed).not.toContain(PRODUCTION_REF)
  })

  it('npm run dev and the release build do not read it', () => {
    for (const mode of ['development', 'production']) {
      const r = renderer({ mode, command: mode === 'production' ? 'build' : 'serve' })
      expect(Object.keys(r.define ?? {}).filter(k => k.startsWith('import.meta.env.'))).toEqual([])
      expect(r.envDir).toBeUndefined()
    }
  })

  it('refuses to start with a secret in the file, and reads a missing file as empty', () => {
    const root = mkdtempSync(join(tmpdir(), 'wivo-test-copy-'))
    expect(testCopyDefine(root)).toEqual({
      'import.meta.env.VITE_SUPABASE_URL': '""',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
    })
    mkdirSync(join(root, 'config'))
    writeFileSync(join(root, TEST_COPY_ENV), `${URL_LINE}VITE_SUPABASE_ANON_KEY=${jwt({ ref: TEST_REF, role: 'service_role' })}\n`)
    expect(() => testCopyDefine(root)).toThrow(/config\/test-copy\.env: .*service_role.*Test mode not started/)
  })
})
