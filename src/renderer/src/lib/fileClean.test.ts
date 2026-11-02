import { describe, it, expect } from 'vitest'
import {
  stripJpegMetadata, stripPngMetadata, stripWebpMetadata, stripHeifMetadata, stripTiffMetadata,
  scrubDicom, scrubStl, scrubPly, stripObjComments, cleanForUpload, guessFileType, sha256Hex, isDicom, CleanError,
} from './fileClean'

const ascii = (s: string) => [...s].map(c => c.charCodeAt(0))
const text = (b: Uint8Array) => String.fromCharCode(...b)
const NAME = 'Zelinda Quorrington'

// ── A TIFF block with everything a phone writes ─────────────────────────────

/**
 * Little-endian TIFF: IFD0 (orientation 6, Make, Artist, an Exif sub-IFD with
 * the date, a GPS sub-IFD with latitude), IFD1 with a thumbnail.
 */
function tiffBlock(): number[] {
  const b: number[] = []
  const u16 = (v: number) => b.push(v & 0xff, v >> 8)
  const u32 = (v: number) => b.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24)
  const at = (pos: number, v: number) => { b[pos] = v & 0xff; b[pos + 1] = (v >> 8) & 0xff; b[pos + 2] = (v >> 16) & 0xff; b[pos + 3] = v >>> 24 }
  b.push(0x49, 0x49); u16(42); u32(8)
  // IFD0: 5 entries at 8; values after.
  u16(5)
  u16(0x0112); u16(3); u32(1); u16(6); u16(0)               // Orientation = 6
  u16(0x010f); u16(2); u32(8); const make = b.length; u32(0) // Make → "Camera1\0"
  u16(0x013b); u16(2); u32(NAME.length + 1); const artist = b.length; u32(0)
  u16(0x8769); u16(4); u32(1); const exif = b.length; u32(0)
  u16(0x8825); u16(4); u32(1); const gps = b.length; u32(0)
  const next = b.length; u32(0)
  at(make, b.length); b.push(...ascii('Camera1\0'))
  at(artist, b.length); b.push(...ascii(`${NAME}\0`))
  // Exif IFD: DateTimeOriginal
  at(exif, b.length); u16(1); u16(0x9003); u16(2); u32(20); const date = b.length; u32(0); u32(0)
  at(date, b.length); b.push(...ascii('2026:10:01 09:30:00\0'))
  // GPS IFD: latitude, 3 rationals
  at(gps, b.length); u16(1); u16(0x0002); u16(5); u32(3); const lat = b.length; u32(0); u32(0)
  at(lat, b.length); for (const [n, d] of [[59, 1], [26, 1], [1234, 100]]) { u32(n); u32(d) }
  // IFD1: thumbnail offset + length
  at(next, b.length); u16(2)
  u16(0x0201); u16(4); u32(1); const thumb = b.length; u32(0)
  u16(0x0202); u16(4); u32(1); u32(6)
  u32(0)
  at(thumb, b.length); b.push(0xff, 0xd8, ...ascii('FACE'))  // the thumbnail's bytes
  return b
}

const IDENTITY = [NAME, 'Camera1', '2026:10:01', 'FACE']

// ── JPEG ────────────────────────────────────────────────────────────────────

const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]

function phoneJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    ...seg(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xe1, [...ascii('Exif\0\0'), ...tiffBlock()]),
    ...seg(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>'), ...ascii(NAME), ...ascii('</x:xmpmeta>')]),
    ...seg(0xe2, [...ascii('ICC_PROFILE\0'), 1, 1, 9, 9, 9]),
    ...seg(0xe2, [...ascii('MPF\0'), 1, 2, 3]),
    ...seg(0xed, [...ascii('Photoshop 3.0\0'), ...ascii(NAME)]),
    ...seg(0xfe, ascii(`taken by ${NAME}`)),
    ...seg(0xdb, [0, ...new Array(64).fill(1)]),                 // DQT
    ...seg(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),               // SOF0
    ...seg(0xc4, [0, ...new Array(16).fill(0), 0]),             // DHT
    ...seg(0xda, [1, 1, 0, 0, 63, 0]),                          // SOS
    0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56,                   // scan data: a stuffed FF, a restart marker
    0xff, 0xd9,
    // What phones append after the image: a second picture with its own EXIF.
    0xff, 0xd8, ...seg(0xe1, [...ascii('Exif\0\0'), ...ascii(NAME)]), 0xff, 0xd9,
  ])
}

/** The markers of a JPEG, in order, by walking it as a reader would. */
function markers(b: Uint8Array): number[] {
  const out = [b[1]]
  let p = 2
  while (p < b.length) {
    const m = b[p + 1]
    out.push(m)
    if (m === 0xd9) break
    const len = (b[p + 2] << 8) | b[p + 3]
    if (m === 0xda) { p = b.length - 2; continue }
    p += 2 + len
  }
  return out
}

describe('stripJpegMetadata', () => {
  const input = phoneJpeg()
  const out = stripJpegMetadata(input)

  it('keeps what the picture needs, in order: JFIF, orientation, colour profile, tables, image', () => {
    expect(markers(out)).toEqual([0xd8, 0xe0, 0xe1, 0xe2, 0xdb, 0xc0, 0xc4, 0xda, 0xd9])
    expect(text(out)).toContain('ICC_PROFILE')
    expect([...out.subarray(out.length - 9)]).toEqual([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xd9])
  })

  it('the new EXIF holds the orientation and nothing else', () => {
    const at = text(out).indexOf('Exif\0\0') + 6
    expect(text(out.subarray(at, at + 2))).toBe('MM')
    expect(out[at + 10]).toBe(0x01); expect(out[at + 11]).toBe(0x12)   // tag 0112
    expect(out[at + 19]).toBe(6)                                        // value 6 (SHORT, big-endian)
    expect(out[at + 9]).toBe(1)                                         // one entry
  })

  it('removes EXIF, GPS, the thumbnail, XMP, IPTC, comments, MPF and the appended picture', () => {
    for (const s of [...IDENTITY, 'xmpmeta', 'Photoshop', 'taken by', 'MPF']) expect(text(out)).not.toContain(s)
    expect(out.length).toBeLessThan(input.length)
  })

  it('a JPEG with nothing to remove comes out the same; a non-JPEG is untouched', () => {
    const plain = new Uint8Array([0xff, 0xd8, ...seg(0xdb, [0, 1]), ...seg(0xda, [1, 1, 0, 0, 63, 0]), 7, 0xff, 0xd9])
    expect(stripJpegMetadata(plain)).toEqual(plain)
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    expect(stripJpegMetadata(png)).toBe(png)
  })

  it('a JPEG it cannot read is refused, not uploaded half-cleaned', () => {
    expect(() => stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0x00, 0x01, 0x02, 0x03, 0x04]))).toThrow(CleanError)
    expect(() => stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0]))).toThrow(CleanError)
  })
})

// ── PNG, WebP ───────────────────────────────────────────────────────────────

const pngChunk = (type: string, data: number[]) => [0, 0, (data.length >> 8) & 0xff, data.length & 0xff, ...ascii(type), ...data, 1, 2, 3, 4]

function pngTypes(b: Uint8Array): string[] {
  const out: string[] = []
  for (let p = 8; p + 12 <= b.length;) {
    const n = (b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]
    out.push(text(b.subarray(p + 4, p + 8)))
    p += 12 + n
  }
  return out
}

describe('stripPngMetadata', () => {
  const input = new Uint8Array([
    0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk('IHDR', new Array(13).fill(1)),
    ...pngChunk('tEXt', ascii(`Author\0${NAME}`)),
    ...pngChunk('iTXt', ascii(`XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta>${NAME}</x:xmpmeta>`)),
    ...pngChunk('eXIf', tiffBlock()),
    ...pngChunk('tIME', [7, 234, 10, 1, 9, 30, 0]),
    ...pngChunk('IDAT', [9, 9, 9]),
    ...pngChunk('IEND', []),
    ...ascii(NAME),                                           // trailing bytes after IEND
  ])
  const out = stripPngMetadata(input)

  it('keeps the image chunks, drops text, XMP, EXIF, time and anything after the end', () => {
    expect(pngTypes(out)).toEqual(['IHDR', 'IDAT', 'IEND'])
    for (const s of IDENTITY) expect(text(out)).not.toContain(s)
  })
})

const riffChunk = (type: string, data: number[]) => {
  const n = data.length
  return [...ascii(type), n & 0xff, (n >> 8) & 0xff, 0, 0, ...data, ...(n & 1 ? [0] : [])]
}

describe('stripWebpMetadata', () => {
  const body = [
    ...ascii('WEBP'),
    ...riffChunk('VP8X', [0x2c, 0, 0, 0, 1, 0, 0, 1, 0, 0]),  // flags: EXIF, XMP, alpha(0x10)… 0x2c = ICC? no: 0x20 ICC, 0x08 EXIF, 0x04 XMP
    ...riffChunk('VP8 ', [5, 5, 5]),                          // odd size: padded
    ...riffChunk('EXIF', tiffBlock()),
    ...riffChunk('XMP ', ascii(`<x:xmpmeta>${NAME}</x:xmpmeta>`)),
  ]
  const input = new Uint8Array([...ascii('RIFF'), body.length & 0xff, (body.length >> 8) & 0xff, 0, 0, ...body])
  const out = stripWebpMetadata(input)
  const view = new DataView(out.buffer)

  it('drops EXIF and XMP, clears their flags, fixes the RIFF size', () => {
    for (const s of IDENTITY) expect(text(out)).not.toContain(s)
    expect(text(out)).not.toContain('XMP ')
    expect(view.getUint32(4, true)).toBe(out.length - 8)
    expect(out[20]).toBe(0x20)                                 // ICC flag kept, EXIF and XMP off
    expect(text(out.subarray(30, 34))).toBe('VP8 ')
    expect([...out.subarray(38, 42)]).toEqual([5, 5, 5, 0])
  })
})

// ── HEIC, TIFF: in place ────────────────────────────────────────────────────

describe('stripHeifMetadata', () => {
  const head = [0, 0, 0, 24, ...ascii('ftypheic'), 0, 0, 0, 0, ...ascii('mif1heic'), ...new Array(40).fill(7)]
  const exifItem = [0, 0, 0, 6, ...ascii('Exif'), 0, 0]
  const xmp = ascii(`<x:xmpmeta xmlns:x="adobe:ns:meta/">${NAME}</x:xmpmeta>`)
  const input = new Uint8Array([...head, ...exifItem, ...tiffBlock(), ...new Array(30).fill(9), ...xmp, 1, 2, 3])
  const out = stripHeifMetadata(input)

  it('empties the whole EXIF block — name, camera, date, GPS, thumbnail — and the XMP', () => {
    for (const s of [...IDENTITY, 'xmpmeta']) expect(text(out)).not.toContain(s)
    const ifd0 = head.length + exifItem.length + 8
    expect(out[ifd0] | out[ifd0 + 1]).toBe(0)                  // IFD0 has no entries left
    expect([...out.subarray(ifd0 + 2, ifd0 + 2 + 60)].every(b => b === 0)).toBe(true)
  })

  it('keeps the length and everything outside the EXIF block', () => {
    expect(out.length).toBe(input.length)
    expect([...out.subarray(0, head.length)]).toEqual(head)
    expect([...out.subarray(out.length - 3)]).toEqual([1, 2, 3])
  })

  it('bytes that merely contain "Exif" but no valid TIFF are left alone', () => {
    const noise = new Uint8Array([0, 0, 0, 24, ...ascii('ftypheic'), ...ascii('Exif'), 0, 0, ...ascii('IIxx'), ...new Array(40).fill(1)])
    expect(stripHeifMetadata(noise)).toEqual(noise)
  })
})

describe('stripTiffMetadata (a TIFF X-ray export)', () => {
  const input = new Uint8Array(tiffBlock())
  const out = stripTiffMetadata(input)

  it('zeroes the descriptive values and empties EXIF and GPS', () => {
    for (const s of [NAME, 'Camera1', '2026:10:01']) expect(text(out)).not.toContain(s)
    expect(out.length).toBe(input.length)
  })

  it('keeps the image structure: IFD0 and its entries stay, orientation too', () => {
    expect(out[8]).toBe(5)
    expect(out[10 + 8]).toBe(6)
  })
})

// ── DICOM ──────────────────────────────────────────────────────────────────

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
  const seqOf = (group: number, elem: number, inner: number[]) => {
    const header = explicit
      ? [group & 0xff, group >> 8, elem & 0xff, elem >> 8, ...ascii('SQ'), 0, 0, ...UNDEF]
      : [group & 0xff, group >> 8, elem & 0xff, elem >> 8, ...UNDEF]
    return [...header, 0xfe, 0xff, 0x00, 0xe0, ...UNDEF, ...inner, 0xfe, 0xff, 0x0d, 0xe0, 0, 0, 0, 0, 0xfe, 0xff, 0xdd, 0xe0, 0, 0, 0, 0]
  }
  const data = [
    ...el(0x0008, 0x0050, 'SH', ascii(pad('ACC12345')), explicit),
    ...el(0x0008, 0x0080, 'LO', ascii(pad('Tallinna Hambakliinik')), explicit),
    ...el(0x0008, 0x1010, 'SH', ascii(pad('XRAY-ROOM-2')), explicit),
    ...el(0x0009, 0x0010, 'LO', ascii(pad('VENDOR')), explicit),          // private creator: kept
    ...el(0x0009, 0x1001, 'LO', ascii(pad('Private Zelinda')), explicit),
    ...el(0x0010, 0x0010, 'PN', ascii(pad('Maasikas^Mari')), explicit),
    ...el(0x0010, 0x0020, 'LO', ascii('48001010000'), explicit),
    ...el(0x0010, 0x0030, 'DA', ascii('19800101'), explicit),
    ...el(0x0010, 0x0040, 'CS', ascii('F '), explicit),
    ...el(0x0010, 0x1010, 'AS', ascii('040Y'), explicit),
    ...el(0x0010, 0x1040, 'LO', ascii(pad('Tartu mnt 1')), explicit),
    ...seqOf(0x0008, 0x1115, el(0x0010, 0x0010, 'PN', ascii(pad('Nested^Name')), explicit)),
    ...seqOf(0x0010, 0x1002, el(0x0010, 0x0020, 'LO', ascii(pad('OTHER-ID-77')), explicit)),
    ...el(0x7fe0, 0x0010, 'OB', [1, 2, 3, 4], explicit),
  ]
  return new Uint8Array([...new Array(128).fill(0), ...ascii('DICM'), ...meta, ...data])
}

for (const explicit of [true, false]) {
  describe(`scrubDicom (${explicit ? 'explicit' : 'implicit'} VR)`, () => {
    const input = dicom(explicit)
    const out = scrubDicom(input)

    it('blanks the patient group, the institution, the station, the accession — also inside sequences', () => {
      for (const s of ['Maasikas', '48001010000', '19800101', 'Tartu', 'Tallinna', 'XRAY-ROOM', 'ACC12345', 'Nested', 'OTHER-ID'])
        expect(text(out)).not.toContain(s)
    })

    it('keeps age, sex, the image, the length — and walks the patient-group sequence instead of blanking it', () => {
      expect(text(out)).toContain('040Y')
      expect(text(out)).toContain('F ')
      expect([...out.subarray(out.length - 4)]).toEqual([1, 2, 3, 4])
      expect(out.length).toBe(input.length)
      expect([...out]).toEqual(expect.arrayContaining([0xfe, 0xff, 0x00, 0xe0]))
    })

    if (explicit) {
      it('blanks private text values but keeps the private creator', () => {
        expect(text(out)).not.toContain('Zelinda')
        expect(text(out)).toContain('VENDOR')
      })
    }
  })
}

// ── 3D ──────────────────────────────────────────────────────────────────────

function binaryStl(header: string): Uint8Array {
  const b = new Uint8Array(84 + 50)
  b.set(ascii(header))
  new DataView(b.buffer).setUint32(80, 1, true)
  b.fill(7, 84)
  return b
}

describe('scrubStl', () => {
  it('binary: the 80-byte header is zeroed, the triangles stay', () => {
    const input = binaryStl(`${NAME} upper jaw`)
    const out = scrubStl(input)
    expect([...out.subarray(0, 80)].every(b => b === 0)).toBe(true)
    expect([...out.subarray(80)]).toEqual([...input.subarray(80)])
  })

  it('binary even when the header starts with "solid" (exporters do that)', () => {
    const out = scrubStl(binaryStl(`solid ${NAME}`))
    expect(text(out)).not.toContain('Zelinda')
    expect(out.length).toBe(134)
  })

  it('ASCII: every solid / endsolid name becomes spaces; geometry and length stay', () => {
    const src = `solid ${NAME}_upper\r\n facet normal 0 0 1\n  outer loop\n   vertex 1 2 3\n  endloop\n endfacet\nendsolid ${NAME}_upper\nsolid second\nendsolid second\n`
    const out = scrubStl(new Uint8Array(ascii(src)))
    expect(text(out)).not.toContain('Zelinda')
    expect(text(out)).not.toContain('second')
    expect(out.length).toBe(src.length)
    expect(text(out)).toContain('vertex 1 2 3')
    expect(text(out).startsWith('solid ')).toBe(true)
    expect(text(out)).toContain('\r\n facet')
  })
})

describe('scrubPly', () => {
  it('comment and obj_info lines leave the header; the data after it is copied as is', () => {
    const header = `ply\nformat binary_little_endian 1.0\ncomment Patient: ${NAME}\nobj_info scanner TRIOS\n  comment clinic Tallinn\nelement vertex 1\nproperty float x\ncommentary_is_not_a_comment 1\nend_header\n`
    const input = new Uint8Array([...ascii(header), 0x0a, 0x23, 0xff, 0x00])
    const out = scrubPly(input)
    expect(text(out)).not.toContain('Zelinda')
    expect(text(out)).not.toContain('TRIOS')
    expect(text(out)).not.toContain('Tallinn')
    expect(text(out)).toContain('commentary_is_not_a_comment 1\nend_header\n')
    expect([...out.subarray(out.length - 4)]).toEqual([0x0a, 0x23, 0xff, 0x00])
  })
})

describe('stripObjComments', () => {
  it('# lines go; everything else stays', () => {
    const src = `# Exported for ${NAME}\nmtllib model.mtl\nv 1 2 3\n  # ${NAME} again\nf 1 2 3`
    expect(text(stripObjComments(new Uint8Array(ascii(src))))).toBe('mtllib model.mtl\nv 1 2 3\nf 1 2 3')
  })
})

// ── Routing ─────────────────────────────────────────────────────────────────

describe('cleanForUpload', () => {
  it('routes by content where a format has a signature', () => {
    expect(isDicom(dicom(true))).toBe(true)
    expect(text(cleanForUpload(dicom(true)))).not.toContain('Maasikas')
    expect(text(cleanForUpload(phoneJpeg()))).not.toContain('Zelinda')
    expect(text(cleanForUpload(new Uint8Array(tiffBlock())))).not.toContain('Zelinda')
    expect(text(cleanForUpload(new Uint8Array(ascii(`solid ${NAME}\nendsolid\n`))))).not.toContain('Zelinda')
  })

  it('a binary STL and an OBJ by their name', () => {
    expect(text(cleanForUpload(binaryStl(NAME), 'upper.STL'))).not.toContain('Zelinda')
    expect(text(cleanForUpload(new Uint8Array(ascii(`# ${NAME}\nv 1 2 3\n`)), 'scan.obj'))).toBe('v 1 2 3\n')
  })

  it('leaves what it does not know alone', () => {
    const pdf = new Uint8Array(ascii('%PDF-1.7 ...'))
    expect(cleanForUpload(pdf, 'order.pdf')).toBe(pdf)
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
