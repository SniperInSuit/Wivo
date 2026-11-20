import { describe, it, expect } from 'vitest'
import { buildZip, ZipLimitError, SLICE, SCRUB_LIMIT, type ZipSource } from './zipStream'
import { crc32 } from './zip'
import { sha256Hex } from './fileClean'

const src = (name: string, data: Uint8Array): ZipSource => ({
  name, size: data.length, lastModified: Date.UTC(2024, 5, 1, 12), slice: (a, b) => new Blob([data.slice(a, b) as BlobPart]),
})
const rand = (n: number, seed: number) => {
  const out = new Uint8Array(n); let s = seed
  for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; out[i] = s >>> 24 }
  return out
}

/** A small independent ZIP reader: central directory, then each local entry. */
function read(zip: Uint8Array) {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.length)
  const eocd = zip.length - 22
  expect(v.getUint32(eocd, true)).toBe(0x06054b50)
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  expect(p + v.getUint32(eocd + 12, true)).toBe(eocd)
  const out: { name: string; data: Uint8Array }[] = []
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50)
    expect(v.getUint16(p + 8, true) & 0x0800).toBe(0x0800)
    const crc = v.getUint32(p + 16, true), csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true)
    const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true)
    const lo = v.getUint32(p + 42, true)
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nl))
    expect(csize).toBe(usize)
    expect(v.getUint32(lo, true)).toBe(0x04034b50)
    expect(v.getUint16(lo + 8, true)).toBe(0)
    expect(new TextDecoder().decode(zip.subarray(lo + 30, lo + 30 + v.getUint16(lo + 26, true)))).toBe(name)
    const dataAt = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true)
    const data = zip.subarray(dataAt, dataAt + usize)
    // data descriptor right after the data
    expect(v.getUint32(dataAt + usize, true)).toBe(0x08074b50)
    expect(v.getUint32(dataAt + usize + 4, true)).toBe(crc)
    expect(v.getUint32(dataAt + usize + 8, true)).toBe(usize)
    expect(crc32(data)).toBe(crc)
    out.push({ name, data })
    p += 46 + nl + xl + cl
  }
  return out
}

const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer())

describe('buildZip', () => {
  it('is a valid ZIP: names, empty files, UTF-8, many entries, data over the slice size', async () => {
    const inputs: [string, Uint8Array][] = [
      ['Seeria/empty', new Uint8Array(0)],
      ['Ülemine/hammas ä.stl', rand(1000, 1)],
      ['Seeria/a/IM0001', rand(SLICE + 123, 2)],
      ['Seeria/big', rand(3 * SLICE, 3)],
      ...Array.from({ length: 300 }, (_, i) => [`Seeria/IM${i}`, rand(i * 7, 10 + i)] as [string, Uint8Array]),
    ]
    const r = await buildZip(inputs.map(([n, d]) => src(n, d)))
    const zip = await bytesOf(r.blob)
    expect(zip.length).toBe(r.size)
    expect(r.entries).toBe(inputs.length)
    expect(r.sha256).toBe(await sha256Hex(zip))
    const got = read(zip)
    expect(got.map(g => g.name)).toEqual(inputs.map(i => i[0]))
    // Names that are not scrubbed (no signature, not .stl/.obj) are byte-identical.
    for (let i = 0; i < inputs.length; i++) {
      if (inputs[i][0].endsWith('.stl')) continue
      expect(Array.from(got[i].data.subarray(0, 50))).toEqual(Array.from(inputs[i][1].subarray(0, 50)))
      expect(got[i].data.length).toBe(inputs[i][1].length)
    }
  })

  it('a ZIP of no files is still valid', async () => {
    const r = await buildZip([])
    expect(read(await bytesOf(r.blob))).toEqual([])
  })

  it('reports progress up to the total', async () => {
    let last = [0, 0]
    await buildZip([src('a/x', rand(10, 1)), src('a/y', rand(20, 2))], { onProgress: (d, t) => { last = [d, t] } })
    expect(last).toEqual([30, 30])
  })

  it('refuses more than 65535 entries and more than 4 GB, without reading', async () => {
    const tiny = src('x', new Uint8Array(1))
    await expect(buildZip(Array.from({ length: 65_536 }, () => tiny))).rejects.toMatchObject({ reason: 'count' })
    const huge: ZipSource = { name: 'h', size: 4 * 1024 ** 3, lastModified: 0, slice: () => { throw new Error('read') } }
    await expect(buildZip([huge])).rejects.toBeInstanceOf(ZipLimitError)
  })

  it('scrubs a small DICOM entry (identity out of the header)', async () => {
    // Minimal Part-10 file: 128-byte preamble, DICM, then PatientName (0010,0010) explicit VR.
    const name = new TextEncoder().encode('DOE^JOHN')
    const el = new Uint8Array(8 + name.length)
    el.set([0x10, 0x00, 0x10, 0x00, 0x50, 0x4e, name.length, 0]); el.set(name, 8)
    const dcm = new Uint8Array(132 + el.length)
    dcm.set(new TextEncoder().encode('DICM'), 128); dcm.set(el, 132)
    const r = await buildZip([src('S/IM1.dcm', dcm)])
    const got = read(await bytesOf(r.blob))
    expect(new TextDecoder('latin1').decode(got[0].data)).not.toContain('DOE')
  })

  it('streams an entry over the scrub limit in slices (never read whole)', async () => {
    const size = SCRUB_LIMIT + 5 * SLICE + 17
    let widest = 0
    const big: ZipSource = {
      name: 'S/huge', size, lastModified: 0,
      slice: (a, b) => { widest = Math.max(widest, b - a); return new Blob([new Uint8Array(b - a).fill(a % 251)]) },
    }
    const r = await buildZip([big, src('S/after', rand(5, 4))])
    expect(widest).toBeLessThanOrEqual(SLICE)
    const got = read(await bytesOf(r.blob))
    expect(got[0].data.length).toBe(size)
    expect(got[1].name).toBe('S/after')
  }, 60_000)
})
