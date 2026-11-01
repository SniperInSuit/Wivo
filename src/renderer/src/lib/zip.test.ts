import { describe, it, expect } from 'vitest'
import { crc32, makeZip } from './zip'

/** Reads a stored ZIP back, the way any unzip tool would: from the central directory. */
function readZip(zip: Uint8Array): { name: string; data: Uint8Array; crc: number }[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const end = zip.length - 22
  expect(v.getUint32(end, true)).toBe(0x06054b50)
  const count = v.getUint16(end + 10, true)
  let p = v.getUint32(end + 16, true)
  const out = []
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50)
    const crc = v.getUint32(p + 16, true)
    const size = v.getUint32(p + 24, true)
    const nameLen = v.getUint16(p + 28, true)
    const local = v.getUint32(p + 42, true)
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen))
    const localNameLen = v.getUint16(local + 26, true)
    const data = zip.subarray(local + 30 + localNameLen, local + 30 + localNameLen + size)
    out.push({ name, data, crc })
    p += 46 + nameLen
  }
  return out
}

describe('makeZip', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('round-trips names (UTF-8) and bytes', () => {
    const files = [
      { name: 'Patsient.pdf', data: new Uint8Array([37, 80, 68, 70]) },
      { name: 'files/TAL-26-0042_scan_v1 Ülemine.stl', data: new Uint8Array(1000).map((_, i) => i % 256) },
      { name: 'empty.txt', data: new Uint8Array(0) },
    ]
    const back = readZip(makeZip(files))
    expect(back.map(f => f.name)).toEqual(files.map(f => f.name))
    back.forEach((f, i) => {
      expect(f.data).toEqual(files[i].data)
      expect(f.crc).toBe(crc32(files[i].data))
    })
  })
})
