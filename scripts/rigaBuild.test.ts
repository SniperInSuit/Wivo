/**
 * Riga's temporary installer (scripts/riga-env.mjs, build-riga.mjs,
 * electron-builder.riga.cjs; docs/RIGA-TEMPORARY.md): what it refuses before a
 * build, and what it will not let into the app.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs without types
import { PRODUCTION_REF, TEST_REF, forbiddenIn, parseRigaEnv, phoneBranchCommand, refOf } from './riga-env.mjs'

const RIGA = 'abcdefghijklmnopqrst'
const URL = `https://${RIGA}.supabase.co`
const jwt = (payload: Record<string, unknown>) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig_nature`
const ANON = jwt({ iss: 'supabase', ref: RIGA, role: 'anon' })
const file = (url = URL, key = ANON) => `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${key}\n`

describe('riga.env', () => {
  it('accepts Riga\'s URL with its anon key, and a publishable key', () => {
    expect(parseRigaEnv(file()).problems).toEqual([])
    expect(parseRigaEnv(file(URL, 'sb_publishable_abc123_XYZ')).problems).toEqual([])
    expect(parseRigaEnv(file()).ref).toBe(RIGA)
  })
  it('accepts a byte-order mark, CRLF, quotes and a trailing slash', () => {
    const text = `﻿VITE_SUPABASE_URL="${URL}/"\r\nVITE_SUPABASE_ANON_KEY='${ANON}'\r\n`
    const r = parseRigaEnv(text)
    expect(r.problems).toEqual([])
    expect(r.url).toBe(URL)
  })
  it('refuses production and the test copy by their IDs', () => {
    expect(parseRigaEnv(file(`https://${PRODUCTION_REF}.supabase.co`, jwt({ ref: PRODUCTION_REF, role: 'anon' }))).problems.join()).toContain('production')
    expect(parseRigaEnv(file(`https://${TEST_REF}.supabase.co`, jwt({ ref: TEST_REF, role: 'anon' }))).problems.join()).toContain('test copy')
  })
  it('refuses a service_role key, a secret key and a key from another project', () => {
    expect(parseRigaEnv(file(URL, jwt({ ref: RIGA, role: 'service_role' }))).problems.join()).toContain('service_role')
    expect(parseRigaEnv(file(URL, 'sb_secret_abcdefghijkl')).problems.length).toBeGreaterThan(0)
    expect(parseRigaEnv(file(URL, jwt({ ref: 'zzzzzzzzzzzzzzzzzzzz', role: 'anon' }))).problems.join()).toContain('another project')
  })
  it('refuses other names, duplicates, a missing value and a wrong address', () => {
    expect(parseRigaEnv(file() + 'RESEND_API_KEY=x\n').problems.join()).toContain('RESEND_API_KEY')
    expect(parseRigaEnv(file() + `VITE_SUPABASE_URL=${URL}\n`).problems.join()).toContain('twice')
    expect(parseRigaEnv('').problems.length).toBe(2)
    expect(parseRigaEnv(file('http://localhost:54321')).problems.join()).toContain('supabase.co')
    expect(parseRigaEnv(file(`https://${RIGA}.supabase.co.evil.com`)).problems.length).toBeGreaterThan(0)
  })
  it('refuses a secret anywhere in the file, comments included', () => {
    for (const secret of ['sbp_0123456789abcdef', 're_AbCdEfGh1234', '-----BEGIN PRIVATE KEY-----', jwt({ role: 'service_role' })]) {
      expect(parseRigaEnv(`# ${secret}\n${file()}`).problems.length, secret).toBeGreaterThan(0)
    }
  })
  it('reads the project ref off a URL only when it is exactly one', () => {
    expect(refOf(URL)).toBe(RIGA)
    expect(refOf(`${URL}/rest/v1`)).toBeNull()
    expect(refOf('https://abc.supabase.co')).toBeNull()
  })
  it('hard-codes the same two IDs as the app', () => {
    const src = readFileSync('src/renderer/src/lib/testCopy.ts', 'utf8')
    expect(src).toContain(`PRODUCTION_REF = '${PRODUCTION_REF}'`)
    expect(src).toContain(`TEST_REF = '${TEST_REF}'`)
  })
})

describe('the built app', () => {
  it('may hold the public key and nothing like a secret', () => {
    expect(forbiddenIn(`var k="${ANON}"; var sr="service_role";`, ANON)).toEqual([])
  })
  it('may not hold another token, a secret key, an access token or a private key', () => {
    expect(forbiddenIn(jwt({ role: 'service_role' }), ANON).join()).toContain('service_role')
    expect(forbiddenIn(jwt({ role: 'anon', ref: 'zzzzzzzzzzzzzzzzzzzz' }), ANON).length).toBe(1)
    for (const s of ['sb_secret_abcdefghijkl', 'sbp_0123456789abcdef', 're_AbCdEfGh1234', '-----BEGIN RSA PRIVATE KEY-----']) {
      expect(forbiddenIn(`x="${s}"`, ANON).length, s).toBe(1)
    }
  })
})

describe('the packaging configuration', () => {
  const config = createRequire(import.meta.url)('./electron-builder.riga.cjs') as {
    extraResources: { from: string }[]; directories: { output: string }; artifactName: string
    publish?: unknown; files: string[]
  }
  it('ships no .env, keeps the teeth model, writes to dist-riga and names the installer for Riga', () => {
    expect(config.extraResources.map(r => r.from)).toEqual(['resources/teeth.glb'])
    expect(config.directories.output).toBe('dist-riga')
    expect(config.artifactName).toContain('Wivo-Riga-Setup')
    expect(config.files).toEqual(['out/**/*'])
  })
  it('leaves package.json (the releases\' configuration) as it is', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { build: { extraResources: { from: string }[]; directories: { output: string } } }
    expect(pkg.build.extraResources.map(r => r.from)).toContain('.env')
    expect(pkg.build.directories.output).toBe('dist')
  })
  it('is run by a script that refuses to start without the checks', () => {
    const src = readFileSync('scripts/build-riga.mjs', 'utf8')
    for (const needle of ["'testing'", 'parseRigaEnv', 'forbiddenIn', "'never'", 'MAIN_VITE_SENTRY_DSN', 'phoneBranchCommand(fullCommit)']) expect(src).toContain(needle)
  })
})

describe('the riga branch (Riga\'s phone app)', () => {
  it('is moved to the installer\'s full commit, never forced', () => {
    const sha = 'a'.repeat(40)
    expect(phoneBranchCommand(sha)).toBe(`git push origin ${sha}:refs/heads/riga`)
    expect(phoneBranchCommand(sha)).not.toMatch(/--force|-f\b|\+/)
  })
  it('refuses a short or odd commit', () => {
    expect(() => phoneBranchCommand('abc1234')).toThrow()
    expect(() => phoneBranchCommand(`${'a'.repeat(40)} --force`)).toThrow()
  })
})
