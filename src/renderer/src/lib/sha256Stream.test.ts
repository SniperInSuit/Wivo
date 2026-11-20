import { describe, it, expect } from 'vitest'
import { Sha256 } from './sha256Stream'
import { sha256Hex } from './fileClean'

const rand = (n: number, seed: number): Uint8Array => {
  const out = new Uint8Array(n)
  let s = seed >>> 0
  for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; out[i] = s >>> 24 }
  return out
}

describe('Sha256 (incremental)', () => {
  it('known vectors', () => {
    expect(new Sha256().digestHex()).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(new Sha256().update(new TextEncoder().encode('abc')).digestHex())
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('matches crypto.subtle for many sizes and chunkings', async () => {
    const sizes = [...Array.from({ length: 140 }, (_, i) => i), 255, 256, 257, 1000, 4095, 4096, 65_537, 300_001]
    let seed = 1
    for (const n of sizes) {
      const data = rand(n, seed++)
      const want = await sha256Hex(data)
      for (const chunk of [1, 7, 55, 56, 63, 64, 65, 1000, n || 1]) {
        const h = new Sha256()
        for (let i = 0; i < n; i += chunk) h.update(data.subarray(i, Math.min(n, i + chunk)))
        expect(h.digestHex(), `size ${n} chunk ${chunk}`).toBe(want)
      }
    }
  })

  it('irregular random chunking', async () => {
    const data = rand(200_000, 99)
    const h = new Sha256()
    let i = 0, s = 5
    while (i < data.length) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; const n = 1 + (s >>> 16) % 5000; h.update(data.subarray(i, i + n)); i += n }
    expect(h.digestHex()).toBe(await sha256Hex(data))
  })
})
