/**
 * Test mode (`npm run dev:test`) reads the test copy's URL and anon key from
 * config/test-copy.env, and from nowhere else (electron.vite.config.ts). The
 * file is in git: both values are public by design (they ship in the bundle
 * of wivo-test.pages.dev), and a tracked file cannot vanish the way the
 * ignored .env.test did. On `main`, where .gitignore did not list it, GitHub
 * Desktop counted .env.test as a change and stashed it away on every switch
 * back to `testing` (three times on 2026-11-03).
 *
 * Nothing secret may go in it. parseTestCopyEnv names anything that should
 * not be there: a name other than the two, a key that is not public, or a
 * secret anywhere in the file, comments included. dev:test then refuses to
 * start, and config/testCopyEnv.test.ts fails.
 *
 * Which project the URL points at is checked where it always was, at run
 * time (src/renderer/src/lib/testCopy.ts): anything but the test copy
 * connects nowhere.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'

export const TEST_COPY_ENV = 'config/test-copy.env'

/** The only two names the file may set. */
export const TEST_COPY_NAMES = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const

export interface TestCopyEnv {
  url: string
  key: string
  /** What may not be in the file. Empty: dev:test may use it. */
  problems: string[]
}

const JWT = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g

/** Secrets that may not appear anywhere in the file, comments included. */
const SECRETS: [RegExp, string][] = [
  [/sb_secret_[A-Za-z0-9_-]{8,}/, 'a secret key (sb_secret_)'],
  [/sbp_[A-Za-z0-9]{8,}/, 'a Supabase access token (sbp_)'],
  [/\bre_[A-Za-z0-9_]{8,}/, 'a Resend key (re_)'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
]

/** A JWT's payload, or null when `token` is not a JWT. */
export function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[0].startsWith('eyJ')) return null
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** Why `key` is not a public key, or null. Empty is allowed: test mode then connects nowhere and says so. */
export function publicKeyProblem(key: string): string | null {
  if (key === '' || /^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return null
  const payload = jwtPayload(key)
  if (!payload) return 'VITE_SUPABASE_ANON_KEY is not a public key (the anon JWT, or sb_publishable_…)'
  if (payload.role !== 'anon') return `VITE_SUPABASE_ANON_KEY is a ${String(payload.role ?? 'role-less')} key, not the anon key`
  return null
}

export function parseTestCopyEnv(text: string): TestCopyEnv {
  const values = new Map<string, string>()
  const problems: string[] = []
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) { problems.push(`line ${i + 1} is not NAME=value`); continue }
    const [, name, value] = m
    if (!(TEST_COPY_NAMES as readonly string[]).includes(name)) problems.push(`${name}: only ${TEST_COPY_NAMES.join(' and ')} belong here`)
    else if (values.has(name)) problems.push(`${name} is set twice`)
    else values.set(name, value.replace(/^(['"])(.*)\1$/, '$2'))
  }
  const key = values.get('VITE_SUPABASE_ANON_KEY') ?? ''
  const keyProblem = publicKeyProblem(key)
  if (keyProblem) problems.push(keyProblem)
  for (const [shape, what] of SECRETS) if (shape.test(text)) problems.push(`it holds ${what}`)
  if ((text.match(JWT) ?? []).some(token => token !== key)) problems.push('it holds a token outside VITE_SUPABASE_ANON_KEY')
  return { url: values.get('VITE_SUPABASE_URL') ?? '', key, problems }
}

/** The file as dev:test reads it. Missing, it reads as empty: test mode then connects nowhere. */
export function readTestCopyEnv(root = process.cwd()): TestCopyEnv {
  let text = ''
  try { text = readFileSync(resolve(root, TEST_COPY_ENV), 'utf8') } catch { /* not there: empty */ }
  return parseTestCopyEnv(text)
}

/** Test mode's two values, for the renderer's `define`; dev:test refuses to start on anything wrong with the file. */
export function testCopyDefine(root?: string): Record<string, string> {
  const env = readTestCopyEnv(root)
  if (env.problems.length) throw new Error(`${TEST_COPY_ENV}: ${env.problems.join('; ')}. Test mode not started.`)
  return {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.url),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.key),
  }
}
