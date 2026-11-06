/**
 * The YubiKey setup's plan and checks (setup-plan.mjs), with key A's real
 * attestation from the arrival test where it matters, and shared/release for
 * the certificates root A makes.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as releaseTs from '../../shared/release/release'
import { attestedFacts } from './attestation.mjs'
import { BATCH_F9_SHA256 } from './keys.mjs'
import { loadRelease } from './load-release.mjs'
import {
  ORDER, PLAN, attestationProblems, certificatePayloads, checkConfig, checkPiv, configCommands, keyId, keysOf,
  pivSituation, testStatement,
} from './setup-plan.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const read = (...p) => readFileSync(join(here, ...p), 'utf8')
const yubico = { intermediatesPem: read('yubico', 'yubico-intermediate.pem'), rootPem: read('yubico', 'yubico-ca-1.pem') }
const realF9 = read('fixtures', 'real-f9.pem')
const realAttestation = read('fixtures', 'real-A-attestation-9c.pem')
const realKey = attestedFacts(realAttestation).publicKeyHex

/** As the arrival test found every key (device.json, 2026-11-06). */
const FROM_FACTORY = ['OTP', 'U2F', 'FIDO2', 'OATH', 'PIV', 'OPENPGP', 'HSMAUTH']

/** Key A as the setup would leave it, with the real attested key in 9c. */
const setUpA = (over = {}) => ({
  serial: 38272275, version: [5, 7, 4], f9_pem: realF9,
  pin: { default: false, tries: [3, 3] }, puk: { default: false, tries: [3, 3] },
  management_key: { type: 'AES256', default: false, stored_under_pin: true },
  slots: { '9c': { key_type: 'ED25519', pin_policy: 'ALWAYS', touch_policy: 'ALWAYS', generated: true, public_key_hex: realKey } },
  enabled: { usb: ['PIV'], nfc: [] },
  ...over,
})
const pivA = { complete: true, slots: { '9c': { public_key_hex: realKey, attestation_pem: realAttestation } } }

describe("Kevin's decisions (2026-11-06)", () => {
  it('roots keep only PIV; C and D keep FIDO2 and U2F too; NFC off on all four', () => {
    expect(PLAN.A.usb).toEqual(['PIV'])
    expect(PLAN.B.usb).toEqual(['PIV'])
    expect([...PLAN.C.usb].sort()).toEqual(['FIDO2', 'PIV', 'U2F'])
    expect(PLAN.D.usb).toEqual(PLAN.C.usb)
    expect(configCommands('A', { usb: ['PIV'], nfc: ['PIV'] })).toEqual([['--device', '38272275', 'config', 'nfc', '--disable-all', '--force']])
  })

  it('the keys: a root in 9c; update, app and licence in 9c, 82 and 83 on C and the spare D', () => {
    expect(PLAN.A.slots).toEqual([{ slot: '9c', purpose: 'root' }])
    expect(PLAN.C.slots.map(s => `${s.slot} ${s.purpose}`)).toEqual(['9c update', '82 app', '83 licence'])
    expect(PLAN.D.slots).toEqual(PLAN.C.slots)
  })

  it("each root's PIN on paper is kept with the other root", () => {
    expect(PLAN.A.paper).toBe('root B')
    expect(PLAN.B.paper).toBe('root A')
    expect(PLAN.C.paper).toBeUndefined()
  })

  it('A comes after C and D, which it certifies', () => {
    expect(ORDER.indexOf('A')).toBeGreaterThan(Math.max(ORDER.indexOf('C'), ORDER.indexOf('D')))
  })
})

describe('turning off what a key will not use', () => {
  it('from the factory: everything but the plan, over USB, and all of NFC', () => {
    const enabled = { usb: FROM_FACTORY, nfc: FROM_FACTORY }
    expect(configCommands('A', enabled)).toEqual([
      ['--device', '38272275', 'config', 'nfc', '--disable-all', '--force'],
      ['--device', '38272275', 'config', 'usb', '--disable', 'OTP', '--disable', 'U2F', '--disable', 'FIDO2', '--disable', 'OATH', '--disable', 'OPENPGP', '--disable', 'HSMAUTH', '--force'],
    ])
    expect(configCommands('C', enabled)[1]).toEqual(
      ['--device', '38272295', 'config', 'usb', '--disable', 'OTP', '--disable', 'OATH', '--disable', 'OPENPGP', '--disable', 'HSMAUTH', '--force'])
  })

  it('nothing once it is done, and the check says so', () => {
    expect(configCommands('C', { usb: ['PIV', 'FIDO2', 'U2F'], nfc: [] })).toEqual([])
    expect(checkConfig('C', { enabled: { usb: ['PIV', 'FIDO2', 'U2F'], nfc: [] } }).every(r => r.ok)).toBe(true)
    expect(checkConfig('A', { enabled: { usb: ['PIV', 'OTP'], nfc: [] } })[0]).toEqual({ ok: false, text: 'Over USB: PIV, OTP (should be PIV)' })
  })
})

describe('where a key stands', () => {
  const factory = {
    pin: { default: true, tries: [3, 3] }, puk: { default: true, tries: [3, 3] },
    management_key: { type: 'AES192', default: true, stored_under_pin: false }, slots: {},
  }

  it('as from the factory: set it up', () => {
    expect(pivSituation('A', factory, null)).toBe('factory')
  })

  it('set up by an earlier run, with exactly the keys it recorded: carry on', () => {
    expect(pivSituation('A', setUpA(), pivA)).toBe('ours')
  })

  it('anything else: nothing is done', () => {
    expect(pivSituation('A', setUpA(), null)).toBe('other')
    expect(pivSituation('A', setUpA(), { ...pivA, complete: false })).toBe('other')
    const swapped = setUpA({ slots: { '9c': { ...setUpA().slots['9c'], public_key_hex: '00'.repeat(32) } } })
    expect(pivSituation('A', swapped, pivA)).toBe('other')
    expect(pivSituation('A', { ...factory, pin: { default: false, tries: [3, 3] } }, null)).toBe('other')
    expect(pivSituation('A', { ...factory, slots: { '9a': {} } }, null)).toBe('other')
  })
})

describe('the checks of a set-up key', () => {
  it('passes key A as the setup would leave it, with its real attestation', () => {
    expect(checkPiv('A', setUpA(), pivA, yubico).filter(r => !r.ok)).toEqual([])
  })

  it('one wrong PIN does not block the run that asks for the right one; one try left stops everything', () => {
    expect(checkPiv('A', setUpA({ pin: { default: false, tries: [2, 3] } }), pivA, yubico).every(r => r.ok)).toBe(true)
    const last = checkPiv('A', setUpA({ pin: { default: false, tries: [1, 3] } }), pivA, yubico).find(r => !r.ok)
    expect(last.text).toMatch(/1 of 3 tries left: stop/)
  })

  it("refuses the factory's PIN, a management key not kept under the PIN, a key in another slot", () => {
    const fails = over => checkPiv('A', setUpA(over), pivA, yubico).filter(r => !r.ok).map(r => r.text)
    expect(fails({ pin: { default: true, tries: [3, 3] } })[0]).toMatch(/PIN/)
    expect(fails({ management_key: { type: 'AES256', default: false, stored_under_pin: false } })[0]).toMatch(/NOT kept under the PIN/)
    expect(fails({ slots: { ...setUpA().slots, '9a': { key_type: 'ED25519' } } })[0]).toMatch(/slots outside the plan: 9a/)
  })

  it("the attestation must be this key's, under the batch's factory certificate", () => {
    const made = pivA.slots['9c']
    expect(attestationProblems('A', made, realF9, yubico, [5, 7, 4])).toEqual([])
    expect(attestationProblems('B', made, realF9, yubico, [5, 7, 4])).toEqual(['it states serial 38272275'])
    expect(attestationProblems('A', { ...made, public_key_hex: '00'.repeat(32) }, realF9, yubico, [5, 7, 4])).toEqual(['it is not the Ed25519 key recorded'])
    expect(attestationProblems('A', made, read('fixtures', 'f9.pem'), yubico, [5, 7, 4]))
      .toContain("the factory certificate is not the batch's from the arrival test")
  })

  it('the batch certificate is the one the arrival test found', async () => {
    const { X509Certificate } = await import('node:crypto')
    expect(new X509Certificate(realF9).fingerprint256).toBe(BATCH_F9_SHA256)
  })
})

describe("root A's certificates", () => {
  it('a key gets a new name when it is made again', () => {
    expect(keyId('update', 'C', 'aa'.repeat(32))).toMatch(/^update-C-[0-9a-f]{8}$/)
    expect(keyId('update', 'C', 'aa'.repeat(32))).not.toBe(keyId('update', 'C', 'bb'.repeat(32)))
  })

  it('update and app keys only, for two years from the day', () => {
    const keys = keysOf('C', { slots: { '9c': { public_key_hex: '01'.repeat(32) }, '82': { public_key_hex: '02'.repeat(32) }, '83': { public_key_hex: '03'.repeat(32) } } })
    const certs = certificatePayloads('root-A-x', keys, '2026-11-06')
    expect(certs.map(c => c.purpose)).toEqual(['update', 'app'])
    expect(certs[0]).toMatchObject({ v: 1, root_id: 'root-A-x', not_before: '2026-11-06T00:00:00Z', not_after: '2028-11-06T00:00:00Z', public_key: keys[0].public_key })
    expect(certificatePayloads('r', keys, '2028-02-29')[0].not_after).toBe('2030-03-01T00:00:00Z')
  })

  it('signed in two steps, as the setup signs on the key, shared/release accepts them', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const rootPub = releaseTs.b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
    const keys = keysOf('D', { slots: { '9c': { public_key_hex: '04'.repeat(32) }, '82': { public_key_hex: '05'.repeat(32) }, '83': { public_key_hex: '06'.repeat(32) } } })
    const trust = await releaseTs.trustFrom([{ id: 'root-A-x', publicKey: rootPub }], [])
    for (const c of certificatePayloads('root-A-x', keys, '2026-11-06')) {
      const { payloadB64, statement } = await releaseTs.prepare('certificate', c)
      const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, statement))
      const r = await releaseTs.checkCertificate(releaseTs.assemble('certificate', payloadB64, sig), trust, c.purpose, new Date('2026-11-07'))
      expect(r).toMatchObject({ ok: true, payload: { key_id: c.key_id } })
    }
  })

  it("a test statement can't pass for a release, a certificate or a licence", () => {
    const t = testStatement('update-C-12345678')
    for (const prefix of [...Object.values(releaseTs.PREFIX), 'WIVO1']) expect(t.startsWith(`${prefix}.`)).toBe(false)
  })
})

describe('shared/release for plain Node (load-release.mjs)', () => {
  it('gives the same tokens as the TypeScript itself', async () => {
    const loaded = await loadRelease()
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const sign = async b => new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, b))
    const payload = { v: 1, key_id: 'k', public_key: 'p', purpose: 'update', not_before: 'a', not_after: 'b', root_id: 'r' }
    expect(await loaded.encode('certificate', payload, sign)).toBe(await releaseTs.encode('certificate', payload, sign))
  })
})
