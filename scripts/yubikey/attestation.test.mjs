/**
 * The arrival test's checks (attestation.mjs), against a made-up chain with
 * Yubico's names but other keys (fixtures/make-fixtures.sh), and against the
 * Yubico certificates kept beside the script.
 */
import { generateKeyPairSync, sign, X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { atLeast, attestedFacts, checkChain, checkSignature, serialOf, splitPem, YUBICO_ROOT_SHA256 } from './attestation.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = name => readFileSync(join(here, 'fixtures', name), 'utf8')
const yubico = name => readFileSync(join(here, 'yubico', name), 'utf8')

const madeUp = {
  attestationPem: fixture('attestation.pem'),
  f9Pem: fixture('f9.pem'),
  intermediatesPem: fixture('intermediates.pem'),
  rootPem: fixture('root.pem'),
  rootSha256: new X509Certificate(fixture('root.pem')).fingerprint256,
}

describe('the chain', () => {
  it('passes a chain that reaches the pinned root, signature by signature', () => {
    const r = checkChain(madeUp)
    expect(r.problems).toEqual([])
    expect(r.path).toEqual([
      'CN=YubiKey PIV Attestation 9c',
      'CN=Yubico PIV Attestation',
      'CN=Yubico PIV Attestation B 1',
      'CN=Yubico Attestation Intermediate B 1',
      'CN=Yubico Attestation Root 1',
    ])
  })

  it("refuses the same names under a root that isn't Yubico's", () => {
    const r = checkChain({ ...madeUp, rootSha256: YUBICO_ROOT_SHA256 })
    expect(r.ok).toBe(false)
    expect(r.problems[0]).toMatch(/not Yubico's/)
  })

  it("refuses an attestation that another key's f9 didn't sign", () => {
    const r = checkChain({ ...madeUp, f9Pem: fixture('other-f9.pem') })
    expect(r.ok).toBe(false)
    expect(r.problems).toContain("the attestation is not signed by the key's factory certificate (f9)")
  })

  it("refuses a made-up chain presented with Yubico's real intermediates and root", () => {
    const r = checkChain({ ...madeUp, intermediatesPem: yubico('yubico-intermediate.pem'), rootPem: yubico('yubico-ca-1.pem'), rootSha256: YUBICO_ROOT_SHA256 })
    expect(r.ok).toBe(false)
    expect(r.problems.join(';')).toMatch(/is not signed by "CN=Yubico PIV Attestation B 1"/)
  })

  it('refuses a chain outside its dates', () => {
    expect(checkChain({ ...madeUp, now: new Date('1999-01-01') }).ok).toBe(false)
  })
})

describe("Yubico's certificates beside the script", () => {
  const root = new X509Certificate(yubico('yubico-ca-1.pem'))
  const all = splitPem(yubico('yubico-intermediate.pem')).map(p => new X509Certificate(p))

  it('the root is the one pinned', () => {
    expect(root.subject).toBe('CN=Yubico Attestation Root 1')
    expect(root.fingerprint256).toBe(YUBICO_ROOT_SHA256)
  })

  it.each(['A 1', 'B 1', 'B2 1'])('Yubico PIV Attestation %s chains to it', name => {
    const piv = all.find(c => c.subject === `CN=Yubico PIV Attestation ${name}`)
    const mid = all.find(c => c.subject === piv.issuer)
    expect(piv.verify(mid.publicKey)).toBe(true)
    expect(mid.issuer).toBe(root.subject)
    expect(mid.verify(root.publicKey)).toBe(true)
  })
})

describe("key A's real attestation (2026-11-06; public certificates only)", () => {
  const real = {
    attestationPem: fixture('real-A-attestation-9c.pem'),
    f9Pem: fixture('real-f9.pem'),
    intermediatesPem: yubico('yubico-intermediate.pem'),
    rootPem: yubico('yubico-ca-1.pem'),
  }

  it("chains to Yubico's pinned root", () => {
    const r = checkChain(real)
    expect(r.problems).toEqual([])
    expect(r.path).toEqual([
      'CN=YubiKey PIV Attestation 9c',
      'CN=Yubico PIV Attestation',
      'CN=Yubico PIV Attestation B 1',
      'CN=Yubico Attestation Intermediate B 1',
      'CN=Yubico Attestation Root 1',
    ])
  })

  it('states the serial, firmware, form factor and policies', () => {
    expect(attestedFacts(real.attestationPem)).toMatchObject({
      serial: 38272275, firmware: [5, 7, 4], formFactor: 'USB-C keychain', fips: false,
      pinPolicy: 'always', touchPolicy: 'always', keyType: 'ed25519',
    })
  })

  it("is refused under a made-up f9 or a made-up root", () => {
    expect(checkChain({ ...real, f9Pem: madeUp.f9Pem }).ok).toBe(false)
    expect(checkChain({ ...real, rootPem: madeUp.rootPem }).ok).toBe(false)
  })
})

describe('what the attestation says', () => {
  it('reads the serial, firmware, policy, form factor and key', () => {
    expect(attestedFacts(madeUp.attestationPem)).toMatchObject({
      serial: 38272275,
      firmware: [5, 7, 4],
      pinPolicy: 'always',
      touchPolicy: 'always',
      formFactor: 'USB-C keychain',
      fips: false,
      keyType: 'ed25519',
      publicKeyHex: fixture('public-key.hex').trim(),
    })
  })

  it('reads a serial as a DER INTEGER or as bare bytes', () => {
    expect(serialOf(Buffer.from([0x02, 0x04, 0x02, 0x47, 0xfd, 0x13]))).toBe(38272275)
    expect(serialOf(Buffer.from([0x02, 0x47, 0xfd, 0x13]))).toBe(38272275)
    expect(serialOf(Buffer.from([0x02, 0x05, 0x00, 0x82, 0x47, 0xfd, 0x13]))).toBe(2185755923)
  })

  it('compares firmware versions', () => {
    expect(atLeast([5, 7, 4], [5, 7, 0])).toBe(true)
    expect(atLeast([5, 7, 0], [5, 7, 0])).toBe(true)
    expect(atLeast([5, 6, 9], [5, 7, 0])).toBe(false)
    expect(atLeast([6, 0, 0], [5, 7, 0])).toBe(true)
  })
})

describe('the signature', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex')
  const message = Buffer.from('WIVOTEST1.arrival test')

  it('verifies a good signature both ways, and refuses a changed message', async () => {
    const sig = sign(null, message, privateKey).toString('hex')
    expect(await checkSignature(raw, message.toString('hex'), sig)).toEqual({ node: true, webcrypto: true, changedRefused: true })
  })

  it("refuses another key's signature", async () => {
    const other = generateKeyPairSync('ed25519').privateKey
    const r = await checkSignature(raw, message.toString('hex'), sign(null, message, other).toString('hex'))
    expect(r.node || r.webcrypto).toBe(false)
  })
})
