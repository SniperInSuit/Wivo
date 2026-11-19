/**
 * The keys pinned at the YubiKey setup of 2026-11-19 are the keys the setup
 * made, and root A's certificates check out against them.
 *
 * Nothing here trusts a value for being in the repo: every certificate goes
 * through the same checkCertificate the app and `wivo-update` run.
 */
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PINNED_ROOTS, b64urlDecode, checkCertificate, trustFrom } from './release'
import { ROOT_A_CERTIFICATES } from './certificates'

const shortSha = (b64: string): string => {
  const raw = b64urlDecode(b64)
  if (!raw || raw.length !== 32) throw new Error(`not a 32-byte key: ${b64}`)
  return createHash('sha256').update(raw).digest('hex').slice(0, 8)
}

/** The keys on C and D, as the setup recorded them (~/wivo-yubikey-setup/{C,D}-…/public.json). */
const SIGNING_KEYS = {
  'update-C-cfbcf4eb': '5ihL2EIYDZjJxkC7SLYjj_cM_sawGeTak1tV5XKo5BU',
  'app-C-c17eb189': 'hjTR8997i6ZdUhfSy9UR6vnVHBK2QYYlqNlyukTLNHs',
  'update-D-f02808a2': 'cvsEjo6ImOW3NXlUSiFkThwTNaqtYkHhSjjj0zBV_P8',
  'app-D-22a3e357': 'znuyY1wEqcbNCzGQLH0l38oyc-OMnYVxasw4n2b_A7Q',
} as const

describe('the pinned roots', () => {
  it('each id is its purpose, its letter and the start of its key\'s SHA-256', () => {
    for (const root of PINNED_ROOTS) {
      expect(root.id).toMatch(/^root-[AB]-[0-9a-f]{8}$/)
      expect(root.id.endsWith(shortSha(root.publicKey))).toBe(true)
    }
    expect(new Set(PINNED_ROOTS.map(r => r.publicKey)).size).toBe(2)
  })

  it('the Edge Functions\' copy pins the same roots', () => {
    const copy = readFileSync(join(__dirname, '../../supabase/functions/_shared/generated/release.ts'), 'utf8')
    for (const root of PINNED_ROOTS) expect(copy).toContain(`{ id: '${root.id}', publicKey: '${root.publicKey}' }`)
  })
})

describe("root A's certificates", () => {
  const atSetup = new Date('2026-11-19T12:00:00Z')

  it('all four are signed by root A, for the keys on C and D, valid for two years', async () => {
    const trust = await trustFrom(PINNED_ROOTS, [])
    expect(ROOT_A_CERTIFICATES).toHaveLength(4)
    const seen: string[] = []
    for (const token of ROOT_A_CERTIFICATES) {
      const purpose = token.includes('.') && JSON.parse(new TextDecoder().decode(b64urlDecode(token.split('.')[1])!)).purpose
      const c = await checkCertificate(token, trust, purpose, atSetup)
      expect(c.ok, `${purpose}: ${c.ok ? '' : c.reason}`).toBe(true)
      if (!c.ok) continue
      const p = c.payload as typeof c.payload & { root_id?: string }
      expect(p.root_id).toBe('root-A-946e9af8')
      expect(SIGNING_KEYS[p.key_id as keyof typeof SIGNING_KEYS]).toBe(p.public_key)
      expect(p.key_id.endsWith(shortSha(p.public_key))).toBe(true)
      expect(p.key_id.startsWith(`${p.purpose}-`)).toBe(true)
      expect([p.not_before, p.not_after]).toEqual(['2026-11-19T00:00:00Z', '2028-11-19T00:00:00Z'])
      seen.push(p.key_id)
    }
    expect(seen.sort()).toEqual(Object.keys(SIGNING_KEYS).sort())
  })

  it('a certificate is refused for the other purpose, and after it ends', async () => {
    const trust = await trustFrom(PINNED_ROOTS, [])
    const update = ROOT_A_CERTIFICATES[0]
    expect((await checkCertificate(update, trust, 'app', atSetup)).ok).toBe(false)
    expect((await checkCertificate(update, trust, 'update', new Date('2028-11-20T00:00:00Z'))).ok).toBe(false)
  })

  it('a root that is not pinned vouches for nothing', async () => {
    const trust = await trustFrom(PINNED_ROOTS.filter(r => r.id.startsWith('root-B')), [])
    for (const token of ROOT_A_CERTIFICATES) {
      expect((await checkCertificate(token, trust, 'update', atSetup)).ok).toBe(false)
      expect((await checkCertificate(token, trust, 'app', atSetup)).ok).toBe(false)
    }
  })
})

describe('the licence keys', () => {
  it('src/main/license.ts trusts the licence keys on C and D, and each is named by its SHA-256', () => {
    const source = readFileSync(join(__dirname, '../../src/main/license.ts'), 'utf8')
    const keys = [...source.matchAll(/'([0-9a-f]{64})', \/\/ (licence-[CD]-[0-9a-f]{8})/g)]
    expect(keys.map(k => k[2])).toEqual(['licence-C-217c4193', 'licence-D-b61d3095'])
    for (const [, hex, id] of keys) {
      expect(id.endsWith(createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex').slice(0, 8))).toBe(true)
    }
  })
})
