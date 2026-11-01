import { describe, it, expect } from 'vitest'
import { stripJpegGps, scrubDicom, cleanForUpload, guessFileType, sha256Hex, isDicom } from './fileClean'

// ── A JPEG with EXIF: orientation in IFD0, latitude in the GPS IFD ─────────

function jpegWithGps(): { bytes: Uint8Array; latAt: number; gpsAt: number; orientAt: number } {
  const tiff: number[] = []
  const u16 = (v: number) => tiff.push(v & 0xff, v >> 8)
  const u32 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24)
  tiff.push(0x49, 0x49); u16(42); u32(8)            // 'II', magic, IFD0 at 8
  u16(2)                                             // IFD0: 2 entries
  const orientAt = tiff.length
  u16(0x0112); u16(3); u32(1); u16(6); u16(0)        // Orientation = 6 (rotated)
  u16(0x8825); u16(4); u32(1); u32(38)               // GPSInfo → 38
  u32(0)                                             // no next IFD
  const gpsAt = tiff.length                          // = 38
  u16(2)
  u16(0x0001); u16(2); u32(2); tiff.push(0x4e, 0, 0, 0)  // GPSLatitudeRef 'N'
  u16(0x0002); u16(5); u32(3); u32(68)               // GPSLatitude → 3 rationals at 68
  u32(0)
  const latAt = tiff.length                          // = 68
  for (const [n, d] of [[59, 1], [26, 1], [1234, 100]]) { u32(n); u32(d) }
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const len = app1.length + 2
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...app1, 0xff, 0xd9])
  const tiffStart = 2 + 4 + 6
  return { bytes, latAt: tiffStart + latAt, gpsAt: tiffStart + gpsAt, orientAt: tiffStart + orientAt }
}

describe('stripJpegGps', () => {
  const { bytes, latAt, gpsAt, orientAt } = jpegWithGps()
  const out = stripJpegGps(bytes)

  it('removes the coordinates and the reference', () => {
    expect([...out.subarray(latAt, latAt + 24)].every(b => b === 0)).toBe(true)
    expect(out[gpsAt] | out[gpsAt + 1]).toBe(0) // GPS IFD now has no entries
    expect([...out].includes(0x4e) && [...out.subarray(gpsAt, gpsAt + 30)].includes(0x4e)).toBe(false)
  })

  it('keeps orientation, and the file length', () => {
    expect(out[orientAt + 8]).toBe(6)
    expect(out.length).toBe(bytes.length)
  })

  it('does not touch the original', () => {
    expect(bytes[latAt]).toBe(59)
  })

  it('leaves a JPEG without EXIF, and a non-JPEG, as they are', () => {
    const plain = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    expect(stripJpegGps(plain)).toEqual(plain)
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    expect(stripJpegGps(png)).toBe(png)
  })
})

// ── DICOM ──────────────────────────────────────────────────────────────────

const ascii = (s: string) => [...s].map(c => c.charCodeAt(0))
const pad = (s: string) => (s.length % 2 ? s + ' ' : s)

function el(group: number, elem: number, vr: string, value: number[], explicit: boolean): number[] {
  const tag = [group & 0xff, group >> 8, elem & 0xff, elem >> 8]
  const n = value.length
  if (!explicit) return [...tag, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24, ...value]
  if (['OB', 'OW', 'SQ', 'UN', 'UT'].includes(vr)) return [...tag, ...ascii(vr), 0, 0, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24, ...value]
  return [...tag, ...ascii(vr), n & 0xff, n >> 8, ...value]
}
const UNDEF = [0xff, 0xff, 0xff, 0xff]

function dicom(explicit: boolean): Uint8Array {
  const syntax = explicit ? '1.2.840.10008.1.2.1\0' : '1.2.840.10008.1.2\0'
  const meta = el(0x0002, 0x0010, 'UI', ascii(syntax), true)
  const nested = el(0x0010, 0x0010, 'PN', ascii(pad('Nested^Name')), explicit)
  const seqHeader = explicit
    ? [0x08, 0x00, 0x15, 0x11, ...ascii('SQ'), 0, 0, ...UNDEF]
    : [0x08, 0x00, 0x15, 0x11, ...UNDEF]
  const item = [0xfe, 0xff, 0x00, 0xe0, ...UNDEF, ...nested, 0xfe, 0xff, 0x0d, 0xe0, 0, 0, 0, 0]
  const seq = [...seqHeader, ...item, 0xfe, 0xff, 0xdd, 0xe0, 0, 0, 0, 0]
  const data = [
    ...el(0x0008, 0x0080, 'LO', ascii(pad('Tallinna Hambakliinik')), explicit),
    ...el(0x0010, 0x0010, 'PN', ascii(pad('Maasikas^Mari')), explicit),
    ...el(0x0010, 0x1010, 'AS', ascii('040Y'), explicit),
    ...el(0x0010, 0x0040, 'CS', ascii('F '), explicit),
    ...seq,
    ...el(0x0010, 0x0020, 'LO', ascii('48001010000'), explicit),
    ...el(0x7fe0, 0x0010, 'OB', [1, 2, 3, 4], explicit),
  ]
  return new Uint8Array([...new Array(128).fill(0), ...ascii('DICM'), ...meta, ...data])
}

const text = (b: Uint8Array) => String.fromCharCode(...b)

for (const explicit of [true, false]) {
  describe(`scrubDicom (${explicit ? 'explicit' : 'implicit'} VR)`, () => {
    const input = dicom(explicit)
    const out = scrubDicom(input)

    it('blanks name, ID, institution — including inside a sequence', () => {
      for (const s of ['Maasikas', '48001010000', 'Tallinna', 'Nested']) expect(text(out)).not.toContain(s)
    })

    it('keeps age, sex and the image, and the length', () => {
      expect(text(out)).toContain('040Y')
      expect(text(out)).toContain('F ')
      expect([...out.subarray(out.length - 4)]).toEqual([1, 2, 3, 4])
      expect(out.length).toBe(input.length)
    })
  })
}

describe('cleanForUpload', () => {
  it('routes by content, not by name', () => {
    expect(isDicom(dicom(true))).toBe(true)
    expect(text(cleanForUpload(dicom(true)))).not.toContain('Maasikas')
    const stl = new Uint8Array(ascii('solid tooth'))
    expect(cleanForUpload(stl)).toBe(stl)
  })

  it('guesses a type from the extension', () => {
    expect(guessFileType('Upper.STL')).toBe('scan')
    expect(guessFileType('cbct.dcm')).toBe('xray')
    expect(guessFileType('IMG_0001.jpeg')).toBe('photo')
    expect(guessFileType('notes.pdf')).toBe('other')
  })

  it('hashes with SHA-256', async () => {
    expect(await sha256Hex(new Uint8Array(ascii('abc'))))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
