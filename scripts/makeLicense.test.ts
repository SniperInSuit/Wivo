/**
 * The issuing tool and the app must agree byte for byte.
 *
 * scripts/make-license.mjs runs in plain Node, so it cannot import
 * shared/license/token.ts and keeps a small copy of the format: base64url, the
 * module list, the signing domain. A copy drifts. This test closes the loop
 * the only way that cannot lie — it SIGNS with the script and VERIFIES with
 * the module the app uses, so a change to either side that the other does not
 * follow fails here.
 *
 * It also checks what the tool refuses. A licence that promises a page which
 * cannot work, or that names no address, is worse than a missing module: the
 * first is found by a clinic, the second by nobody until a key is copied to
 * the wrong server.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPublicKey, verify as nodeVerify } from 'node:crypto'
import {
  MODULE_KEYS, b64urlDecode, licenceAllowsApi, licenceApiOrigins, licenceModules,
  parseToken, signingInput,
} from '../shared/license/token'

const SCRIPT = 'scripts/make-license.mjs'
const ORG = '8f14e45f-ceea-467a-9b71-1c4a9c0e8b2d'
const API = 'https://abc.supabase.co'

const dir = mkdtempSync(join(tmpdir(), 'wivo-licence-'))
const KEY = join(dir, 'key.pem')
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

/** Run the tool. Returns stdout; throws with the message on a refusal. */
function run(...args: string[]): string {
  return execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' })
}

/** Run it expecting a refusal, and hand back what it said. */
function refusal(...args: string[]): string {
  try {
    run(...args)
  } catch (e) {
    const err = e as { stderr?: Buffer | string; stdout?: Buffer | string; status?: number }
    expect(err.status, 'the tool exited 0 — it did not refuse').not.toBe(0)
    return String(err.stderr ?? '') + String(err.stdout ?? '')
  }
  throw new Error('the tool did not refuse')
}

/** The public key the tool printed, as the app stores it: 32 bytes of hex. */
const PUBLIC_HEX = (() => {
  const out = run('keygen', '--out', KEY)
  const m = /'([0-9a-f]{64})'/.exec(out)
  if (!m) throw new Error(`keygen printed no public key:\n${out}`)
  return m[1]
})()

/** Verify a token exactly as src/main/license.ts does. */
function verifies(token: string, version: number): boolean {
  const parsed = parseToken(token)
  if (!parsed) return false
  const der = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    Buffer.from(PUBLIC_HEX, 'hex'),
  ])
  return nodeVerify(
    null,
    Buffer.from(signingInput(parsed.payloadB64, version)),
    createPublicKey({ key: der, format: 'der', type: 'spki' }),
    Buffer.from(parsed.signature),
  )
}

const sign = (...extra: string[]): string =>
  run('sign', '--org', ORG, '--name', 'Riia kliinik', '--api', API,
      '--key', KEY, '--quiet', ...extra).trim()

describe('keygen', () => {
  it('writes a private key and prints the public one', () => {
    expect(readFileSync(KEY, 'utf8')).toContain('BEGIN PRIVATE KEY')
    expect(PUBLIC_HEX).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses to overwrite a key — a second keypair invalidates every licence', () => {
    expect(refusal('keygen', '--out', KEY)).toMatch(/REFUSING/)
  })
})

describe('a token the tool issues is one the app accepts', () => {
  const token = sign('--modules', 'jobs,payroll,stock')

  it('parses, with the version, organisation and address it was given', () => {
    const payload = parseToken(token)?.payload
    expect(payload?.v).toBe(2)
    expect(payload?.org).toBe(ORG)
    expect(payload?.name).toBe('Riia kliinik')
    expect(licenceApiOrigins(payload!)).toEqual([API])
  })

  it('carries exactly the modules asked for', () => {
    expect([...licenceModules(parseToken(token)!.payload)].sort())
      .toEqual(['jobs', 'payroll', 'stock'])
  })

  it('VERIFIES — the script and shared/license/token.ts sign the same bytes', () => {
    expect(verifies(token, 2)).toBe(true)
  })

  it('does not verify as a v1 token: the domain prefix is really there', () => {
    expect(verifies(token, 1)).toBe(false)
  })

  it('allows the address it names and no other', () => {
    const payload = parseToken(token)!.payload
    expect(licenceAllowsApi(payload, 'https://abc.supabase.co/rest/v1/jobs')).toBe(true)
    expect(licenceAllowsApi(payload, 'https://other.supabase.co')).toBe(false)
  })

  it('a changed payload stops verifying, which is the whole point of signing', () => {
    const [, b64, sig] = token.split('.')
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(b64)))
    const widened = Buffer.from(JSON.stringify({ ...payload, modules: [...MODULE_KEYS] }), 'utf8')
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(verifies(`WIVO1.${widened}.${sig}`, 2)).toBe(false)
  })

  it('its own verify command agrees, and says no to a tampered one', () => {
    expect(run('verify', token, '--public', PUBLIC_HEX)).toMatch(/^OK · v2/)
    const [, b64, sig] = token.split('.')
    const other = sign('--modules', 'jobs').split('.')[2]
    expect(sig).not.toBe(other)
    expect(refusal('verify', `WIVO1.${b64}.${other}`, '--public', PUBLIC_HEX)).toMatch(/NOT VALID/)
  })

  it('--modules all is every module this build knows', () => {
    expect([...licenceModules(parseToken(sign('--modules', 'all'))!.payload)].sort())
      .toEqual([...MODULE_KEYS].sort())
  })
})

describe('what the tool refuses', () => {
  it('ratings without jobs — a rating is given on a job', () => {
    expect(refusal('sign', '--org', ORG, '--name', 'X', '--api', API, '--key', KEY,
                   '--modules', 'ratings,payroll'))
      .toMatch(/ratings needs jobs/)
  })

  it('a module name that does not exist, so a typo is not a quiet downgrade', () => {
    expect(refusal('sign', '--org', ORG, '--name', 'X', '--api', API, '--key', KEY,
                   '--modules', 'jobs,payrol'))
      .toMatch(/unknown module: payrol/)
  })

  it('no organisation: a key with only a name would work in any clinic', () => {
    expect(refusal('sign', '--name', 'X', '--api', API, '--key', KEY, '--modules', 'jobs'))
      .toMatch(/--org/)
  })

  it('an organisation that is not a UUID', () => {
    expect(refusal('sign', '--org', 'riia', '--name', 'X', '--api', API, '--key', KEY,
                   '--modules', 'jobs'))
      .toMatch(/must be a UUID/)
  })

  it('no address: the app checks where it may connect before it connects', () => {
    expect(refusal('sign', '--org', ORG, '--name', 'X', '--key', KEY, '--modules', 'jobs'))
      .toMatch(/--api/)
  })

  it('an address that is not one', () => {
    expect(refusal('sign', '--org', ORG, '--name', 'X', '--api', 'abc.supabase.co',
                   '--key', KEY, '--modules', 'jobs'))
      .toMatch(/not an address/)
  })

  it('a name it cannot put on the key', () => {
    expect(refusal('sign', '--org', ORG, '--api', API, '--key', KEY, '--modules', 'jobs'))
      .toMatch(/--name/)
  })
})

describe('renew keeps what renewing must not quietly change', () => {
  const first = sign('--modules', 'jobs,stock', '--months', '1')
  const renewed = run('renew', first, '--key', KEY, '--months', '24', '--quiet').trim()

  it('carries the organisation, the address and the modules over', () => {
    const before = parseToken(first)!.payload
    const after = parseToken(renewed)!.payload
    expect(after.org).toBe(before.org)
    expect(licenceApiOrigins(after)).toEqual(licenceApiOrigins(before))
    expect([...licenceModules(after)].sort()).toEqual([...licenceModules(before)].sort())
  })

  it('moves only the expiry, and the new token verifies too', () => {
    const before = parseToken(first)!.payload
    const after = parseToken(renewed)!.payload
    expect(after.exp > before.exp).toBe(true)
    expect(verifies(renewed, 2)).toBe(true)
  })

  it('a v1 key renewed stays v1 — renewing cannot invent an organisation', () => {
    // There is no way to issue v1 any more, so build one the way the script
    // reads it: the payload alone decides the version.
    const v1 = 'WIVO1.' + Buffer.from(JSON.stringify({
      v: 1, name: 'Vana labor', plan: 'labor', seats: 5, iat: '2026-01-01', exp: '2026-12-31',
    }), 'utf8').toString('base64url') + '.AAAA'
    const out = run('renew', v1, '--key', KEY, '--months', '12', '--quiet').trim()
    const after = parseToken(out)!.payload
    expect(after.v).toBe(1)
    expect(after.org).toBeUndefined()
    // And it still means everything, as it always did.
    expect([...licenceModules(after)].sort()).toEqual([...MODULE_KEYS].sort())
    expect(verifies(out, 1)).toBe(true)
  })
})

describe('the copy in the script has not drifted', () => {
  it('its module list is the app\'s module list', () => {
    // The usage text prints it, so this reads what the tool itself believes
    // rather than what the file happens to contain.
    const usage = refusal()
    const line = /modules: (.+)/.exec(usage)
    expect(line, usage).not.toBeNull()
    expect(line![1].split(',').map(s => s.trim()).sort()).toEqual([...MODULE_KEYS].sort())
  })
})

/**
 * Signing on a YubiKey. There is no key to touch in a test, so WIVO_YKMAN names
 * a stand-in for `ykman` that speaks setup-device.py's `sign` file format and
 * signs with the test key. Everything else — the statement the key is asked to
 * sign, the check against the pinned public key — is the real code.
 */
describe('signing on a YubiKey', () => {
  const FAKE = join(dir, 'fake-ykman.mjs')
  const SEEN = join(dir, 'seen.json')
  writeFileSync(FAKE, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { createPrivateKey, sign } from 'node:crypto'
const [, , , , py, step, serial, inFile, outFile] = process.argv
const job = JSON.parse(readFileSync(inFile, 'utf8'))
writeFileSync(process.env.FAKE_SEEN, JSON.stringify({ py, step, serial, job }))
if (process.env.FAKE_MODE === 'refuse') { process.stderr.write('Refused (6982).\\n'); process.exit(2) }
if (process.env.FAKE_MODE === 'untouched') {
  writeFileSync(outFile, JSON.stringify({ signed: [{ id: 'licence', error: '6982' }] })); process.exit(0)
}
const key = createPrivateKey(readFileSync(process.env.FAKE_KEY))
const s = job.statements[0]
const sig = sign(null, Buffer.from(s.hex, 'hex'), key)
writeFileSync(outFile, JSON.stringify({ signed: [{ id: s.id, signature_hex: sig.toString('hex') }] }))
`)
  chmodSync(FAKE, 0o755)

  const env = (mode = 'ok', pub: string | undefined = PUBLIC_HEX) => ({
    ...process.env, WIVO_YKMAN: FAKE, FAKE_KEY: KEY, FAKE_SEEN: SEEN, FAKE_MODE: mode,
    ...(pub ? { WIVO_YUBIKEY_PUBLIC_FOR_TEST: pub } : {}),
  })
  const yk = (extra: string[], e = env()) =>
    execFileSync('node', [SCRIPT, 'sign', '--org', ORG, '--name', 'Riia kliinik', '--api', API,
      '--modules', 'jobs,stock', '--quiet', ...extra], { encoding: 'utf8', env: e }).trim()

  it('with no --key, YubiKey C signs, and the app verifies what comes back', () => {
    const token = yk([])
    expect(verifies(token, 2)).toBe(true)
    const seen = JSON.parse(readFileSync(SEEN, 'utf8'))
    expect(seen.step).toBe('sign')
    expect(seen.py).toMatch(/scripts[\\/]yubikey[\\/]setup-device\.py$/)
    expect(seen.serial).toBe('38272295')                       // C
    expect(seen.job.statements).toHaveLength(1)
    expect(seen.job.statements[0].slot).toBe('83')
  })

  it('the key is asked to sign exactly the bytes the app verifies', () => {
    const token = yk([])
    const seen = JSON.parse(readFileSync(SEEN, 'utf8'))
    const parsed = parseToken(token)!
    expect(seen.job.statements[0].hex)
      .toBe(Buffer.from(signingInput(parsed.payloadB64, 2)).toString('hex'))
  })

  it('--yubikey D asks the spare, serial 38272284', () => {
    yk(['--yubikey', 'D'])
    expect(JSON.parse(readFileSync(SEEN, 'utf8')).serial).toBe('38272284')
  })

  it('refuses another letter, and --key together with --yubikey', () => {
    expect(refusal('sign', '--org', ORG, '--name', 'X', '--api', API, '--modules', 'jobs', '--yubikey', 'A'))
      .toMatch(/C or D/)
    expect(refusal('sign', '--org', ORG, '--name', 'X', '--api', API, '--modules', 'jobs',
                   '--key', KEY, '--yubikey', 'C')).toMatch(/choose one/)
  })

  it('prints no token when the signature is not by the pinned key', () => {
    // The stand-in signs with the test key, the tool expects the other key.
    const other = /'([0-9a-f]{64})'/.exec(run('keygen', '--out', join(dir, 'other.pem')))![1]
    let out = ''
    try { yk([], env('ok', other)) } catch (e) {
      const err = e as { stdout?: string; stderr?: string }
      out = String(err.stdout ?? '') + String(err.stderr ?? '')
      expect(String(err.stdout ?? '')).not.toMatch(/WIVO1\./)
    }
    expect(out).toMatch(/REFUSING: the signature does not verify/)
  })

  it('prints no token when the key refuses or is not touched', () => {
    for (const mode of ['refuse', 'untouched']) {
      try { yk([], env(mode)); throw new Error('printed a token') } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string }
        expect(err.status).toBe(1)
        expect(String(err.stdout ?? '')).not.toMatch(/WIVO1\./)
        expect(String(err.stderr ?? '')).toMatch(/No licence was made/)
      }
    }
  })

  it('--key stays a file key, and says so', () => {
    const out = execFileSync('node', [SCRIPT, 'sign', '--org', ORG, '--name', 'X', '--api', API,
      '--modules', 'jobs', '--key', KEY], { encoding: 'utf8' })
    expect(out).toMatch(/FILE key/)
  })

  it('renew signs on the key too', () => {
    const old = yk([])
    const renewed = execFileSync('node', [SCRIPT, 'renew', old, '--months', '6', '--quiet'],
      { encoding: 'utf8', env: env() }).trim()
    expect(verifies(renewed, 2)).toBe(true)
  })

  it('the serials and public keys in the tool are those pinned elsewhere', () => {
    const tool = readFileSync('scripts/make-license.mjs', 'utf8')
    const app = readFileSync('src/main/license.ts', 'utf8')
    const keys = readFileSync('scripts/yubikey/keys.mjs', 'utf8')
    for (const [letter, serial] of [['C', '38272295'], ['D', '38272284']]) {
      expect(keys).toContain(`${letter}: ${serial}`)
      expect(tool).toMatch(new RegExp(`${letter}: \\{ serial: ${serial}`))
    }
    for (const m of tool.matchAll(/pub: '([0-9a-f]{64})'/g)) expect(app).toContain(m[1])
    expect([...tool.matchAll(/pub: '([0-9a-f]{64})'/g)]).toHaveLength(2)
  })
})
