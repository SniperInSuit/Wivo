/**
 * What a file loses before it leaves this computer (spec, Phase 1 Files, and
 * sql/092: a partner never learns who the patient is). Every upload is
 * cleaned, shared job or not: a job can be shared later, with its files.
 *
 *  - Photos lose ALL their metadata — EXIF (camera, dates, GPS, owner, the
 *    embedded thumbnail), XMP, IPTC, comments — keeping only what the picture
 *    needs to look right (orientation, colour profile).
 *  - DICOM loses the patient module and the people and places around it.
 *  - 3D scans lose the names exporters write into them: the STL "solid
 *    <name>" line and binary header, PLY and OBJ comment lines.
 *
 * Where a format is full of offsets (TIFF, HEIF, DICOM, binary STL) a value is
 * overwritten in place and the length never changes — cutting would shift
 * every offset after it, and a shorter file no viewer can open is not
 * "cleaned". Where nothing points into the file (JPEG segments, PNG and WebP
 * chunks, PLY and OBJ lines) metadata is cut out.
 *
 * What no cleaner can reach — a name printed in a PDF, a face in a photo, a
 * name burned into an X-ray image — is asked about before upload to a shared
 * job (sharedUpload.ts). The name is replaced on the server
 * (`register_job_file` names the file after the job code).
 */

/** A file that could not be parsed, so could not be cleaned: it is not uploaded. */
export class CleanError extends Error {
  constructor(format: string) { super(`${format} could not be read, so it could not be cleaned`) }
}

const ascii = (b: Uint8Array, at: number, s: string): boolean =>
  at + s.length <= b.length && [...s].every((c, k) => b[at + k] === c.charCodeAt(0))

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

function indexOf(b: Uint8Array, s: string, from: number): number {
  const first = s.charCodeAt(0)
  for (let i = b.indexOf(first, from); i !== -1; i = b.indexOf(first, i + 1)) {
    if (ascii(b, i, s)) return i
  }
  return -1
}

// ── The TIFF structure inside EXIF (and TIFF files themselves) ──────────────

/** Bytes per value for each TIFF field type (1 BYTE … 12 DOUBLE). */
const TIFF_TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8]
const SUB_IFDS = new Set([0x8769, 0x8825, 0xa005]) // Exif, GPS, Interoperability
const ORIENTATION = 0x0112
const THUMB_OFFSET = 0x0201
const THUMB_LENGTH = 0x0202

interface Tiff { buf: Uint8Array; view: DataView; le: boolean; start: number }

/** A TIFF header at `start` that really is one (byte order, 42, a sane IFD0), or null. */
function tiffAt(buf: Uint8Array, start: number): Tiff | null {
  if (start < 0 || start + 8 > buf.length) return null
  const le = buf[start] === 0x49 && buf[start + 1] === 0x49
  const be = buf[start] === 0x4d && buf[start + 1] === 0x4d
  if (!le && !be) return null
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (view.getUint16(start + 2, le) !== 42) return null
  const ifd0 = start + view.getUint32(start + 4, le)
  if (ifd0 + 2 > buf.length || view.getUint16(ifd0, le) > 500) return null
  return { buf, view, le, start }
}

const u16 = (t: Tiff, o: number) => t.view.getUint16(o, t.le)
const u32 = (t: Tiff, o: number) => t.view.getUint32(o, t.le)

/** The entries of the IFD at `rel` (relative to the TIFF header), as absolute offsets. */
function entries(t: Tiff, rel: number): number[] {
  const at = t.start + rel
  if (rel === 0 || at + 2 > t.buf.length) return []
  const out: number[] = []
  for (let i = 0, n = u16(t, at); i < n && at + 2 + i * 12 + 12 <= t.buf.length; i++) out.push(at + 2 + i * 12)
  return out
}

/** Zeroes an entry's value, wherever it is (inside the entry or pointed at). */
function zeroValue(t: Tiff, e: number): void {
  const size = (TIFF_TYPE_SIZE[u16(t, e + 2)] ?? 1) * u32(t, e + 4)
  if (size > 4) {
    const at = t.start + u32(t, e + 8)
    if (at + size <= t.buf.length) t.buf.fill(0, at, at + size)
  }
  t.buf.fill(0, e + 8, e + 12)
}

/**
 * Empties the IFD at `rel` and everything hanging off it: sub-IFDs, the next
 * IFD (IFD1 holds the thumbnail), the thumbnail's bytes. Entry count 0 and no
 * next IFD — an empty directory every reader accepts.
 */
function emptyIfd(t: Tiff, rel: number, seen = new Set<number>()): void {
  const at = t.start + rel
  if (rel === 0 || seen.has(at) || at + 2 > t.buf.length) return
  seen.add(at)
  const list = entries(t, rel)
  let thumb = 0
  let thumbLen = 0
  for (const e of list) {
    const tag = u16(t, e)
    if (SUB_IFDS.has(tag)) emptyIfd(t, u32(t, e + 8), seen)
    if (tag === THUMB_OFFSET) thumb = u32(t, e + 8)
    if (tag === THUMB_LENGTH) thumbLen = u32(t, e + 8)
  }
  if (thumb && thumbLen && t.start + thumb + thumbLen <= t.buf.length) t.buf.fill(0, t.start + thumb, t.start + thumb + thumbLen)
  const next = at + 2 + list.length * 12
  if (next + 4 <= t.buf.length) {
    emptyIfd(t, u32(t, next), seen)
    t.view.setUint32(next, 0, t.le)
  }
  for (const e of list) { zeroValue(t, e); t.buf.fill(0, e, e + 8) }
  t.view.setUint16(at, 0, t.le)
}

function readOrientation(t: Tiff): number {
  for (const e of entries(t, u32(t, t.start + 4))) {
    if (u16(t, e) === ORIENTATION && u16(t, e + 2) === 3) return u16(t, e + 8)
  }
  return 0
}

/** Blanks the XMP packets (XML: spaces keep it the same length). */
function blankXmp(buf: Uint8Array): void {
  for (let i = indexOf(buf, '<x:xmpmeta', 0); i !== -1; i = indexOf(buf, '<x:xmpmeta', i + 1)) {
    const close = indexOf(buf, '</x:xmpmeta>', i)
    if (close === -1) return
    buf.fill(0x20, i, close + '</x:xmpmeta>'.length)
  }
}

// ── JPEG ────────────────────────────────────────────────────────────────────

/** "Exif" APP1 holding nothing but the orientation. */
function orientationSegment(o: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0,  // APP1, length 34, "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8,                    // MM, 42, IFD0 at 8
    0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1,        // 1 entry: Orientation, SHORT, 1
    0x00, o, 0, 0, 0, 0, 0, 0,                             // value; no next IFD
  ])
}

/** Where the image data that starts with the SOS at `sos` ends: just after EOI. */
function scanEnd(b: Uint8Array, sos: number): number {
  let q = sos + 2 + ((b[sos + 2] << 8) | b[sos + 3])
  while (q + 1 < b.length) {
    if (b[q] !== 0xff) { q++; continue }
    const m = b[q + 1]
    if (m === 0x00 || m === 0xff || (m >= 0xd0 && m <= 0xd7)) { q++; continue } // stuffed byte, fill, restart
    if (m === 0xd9) return q + 2
    q += 2 + ((b[q + 2] << 8) | b[q + 3]) // a table or the next scan of a progressive JPEG
  }
  return b.length
}

/**
 * Rebuilds a JPEG from what the picture needs: the JFIF header, the colour
 * profile, Adobe's colour flag, the tables and the image data — plus a new
 * EXIF block holding only the orientation (a photo that comes out sideways is
 * its own bug). Everything else goes: EXIF with GPS, camera and dates, the
 * EXIF thumbnail, XMP, IPTC, comments, maker segments, and anything after the
 * image (the extra pictures phones append, which carry their own EXIF).
 */
export function stripJpegMetadata(input: Uint8Array): Uint8Array {
  if (input[0] !== 0xff || input[1] !== 0xd8) return input
  let jfif: Uint8Array | null = null
  let orientation = 0
  const kept: Uint8Array[] = []
  let p = 2
  while (p + 4 <= input.length) {
    if (input[p] !== 0xff) throw new CleanError('JPEG')
    const marker = input[p + 1]
    if (marker === 0xff) { p++; continue }
    if (marker === 0xd9) break
    const len = (input[p + 2] << 8) | input[p + 3]
    const end = p + 2 + len
    if (len < 2 || end > input.length) throw new CleanError('JPEG')
    if (marker === 0xda) { kept.push(input.subarray(p, scanEnd(input, p))); break }
    const body = p + 4
    if (marker === 0xe0) { if (ascii(input, body, 'JFIF\0')) jfif = input.subarray(p, end) }
    else if (marker === 0xe1) {
      const t = ascii(input, body, 'Exif\0\0') ? tiffAt(input.subarray(body + 6, end), 0) : null
      if (t) orientation = readOrientation(t) || orientation
    }
    else if (marker === 0xe2) { if (ascii(input, body, 'ICC_PROFILE\0')) kept.push(input.subarray(p, end)) }
    else if (marker === 0xee) kept.push(input.subarray(p, end)) // Adobe: how to read the colours
    else if ((marker >= 0xe3 && marker <= 0xef) || marker === 0xfe) { /* metadata and comments: dropped */ }
    else kept.push(input.subarray(p, end))
    p = end
  }
  const out: Uint8Array[] = [input.subarray(0, 2)]
  if (jfif) out.push(jfif)
  if (orientation > 1 && orientation <= 8) out.push(orientationSegment(orientation))
  return concat([...out, ...kept])
}

// ── PNG, WebP: metadata chunks out ──────────────────────────────────────────

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'dSIG'])

export function isPng(b: Uint8Array): boolean {
  return b[0] === 0x89 && ascii(b, 1, 'PNG')
}

/** Text, EXIF and time chunks out (with them any XMP, which lives in iTXt). */
export function stripPngMetadata(input: Uint8Array): Uint8Array {
  if (!isPng(input)) return input
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const parts = [input.subarray(0, 8)]
  for (let p = 8; p + 12 <= input.length;) {
    const end = p + 12 + view.getUint32(p)
    if (end > input.length) throw new CleanError('PNG')
    const type = String.fromCharCode(...input.subarray(p + 4, p + 8))
    if (!PNG_DROP.has(type)) parts.push(input.subarray(p, end))
    p = end
    if (type === 'IEND') break
  }
  return concat(parts)
}

export function isWebp(b: Uint8Array): boolean {
  return ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')
}

/** EXIF and XMP chunks out, their flags off in the VP8X header, the RIFF size fixed. */
export function stripWebpMetadata(input: Uint8Array): Uint8Array {
  if (!isWebp(input)) return input
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const riffEnd = Math.min(input.length, 8 + view.getUint32(4, true))
  const parts: Uint8Array[] = []
  for (let p = 12; p + 8 <= riffEnd;) {
    const size = view.getUint32(p + 4, true)
    const end = p + 8 + size + (size & 1)
    if (end > riffEnd) throw new CleanError('WebP')
    if (!ascii(input, p, 'EXIF') && !ascii(input, p, 'XMP ')) {
      const chunk = input.slice(p, end)
      if (ascii(input, p, 'VP8X')) chunk[8] &= ~0x0c
      parts.push(chunk)
    }
    p = end
  }
  const body = concat(parts)
  const head = new Uint8Array(12)
  head.set([0x52, 0x49, 0x46, 0x46]); new DataView(head.buffer).setUint32(4, body.length + 4, true); head.set([0x57, 0x45, 0x42, 0x50], 8)
  return concat([head, body])
}

// ── HEIC / AVIF, TIFF: in place ─────────────────────────────────────────────

/** HEIC/HEIF/AVIF: the ISO base media `ftyp` box. */
export function isHeif(b: Uint8Array): boolean {
  return ascii(b, 4, 'ftyp')
}

/**
 * HEIC (the iPhone default) keeps EXIF as an item: "Exif\0\0" and a TIFF
 * block. Each such block is emptied in place, and XMP blanked. Orientation in
 * a HEIC is the container's own `irot` box, which stays. Offsets are bounded
 * by the file; nothing outside a validated TIFF block is touched.
 */
export function stripHeifMetadata(input: Uint8Array): Uint8Array {
  if (!isHeif(input)) return input
  const out = input.slice()
  for (let i = indexOf(out, 'Exif\0\0', 0); i !== -1; i = indexOf(out, 'Exif\0\0', i + 1)) {
    const t = tiffAt(out, i + 6)
    if (t) emptyIfd(t, u32(t, t.start + 4))
  }
  blankXmp(out)
  return out
}

export function isTiff(b: Uint8Array): boolean {
  return tiffAt(b, 0) !== null
}

/** Tags that describe rather than draw: text, owner, software, embedded XMP/IPTC. */
const TIFF_TEXT_TAGS = new Set([
  0x010d, 0x010e, 0x010f, 0x0110, 0x011d, 0x0131, 0x0132, 0x013b, 0x013c, // DocumentName … HostComputer
  0x02bc, 0x83bb, 0x8649, 0x8298,                                         // XMP, IPTC, Photoshop, Copyright
  0x9c9b, 0x9c9c, 0x9c9d, 0x9c9e, 0x9c9f,                                 // Windows XPTitle … XPSubject
])

/**
 * A TIFF image (some X-ray software exports these): the image itself lives
 * in the IFDs, so they stay; their descriptive values are zeroed and the
 * EXIF/GPS sub-directories emptied.
 */
export function stripTiffMetadata(input: Uint8Array): Uint8Array {
  if (!isTiff(input)) return input
  const out = input.slice()
  const t = tiffAt(out, 0)!
  const seen = new Set<number>()
  for (let rel = u32(t, 4); rel !== 0 && !seen.has(rel);) {
    seen.add(rel)
    const list = entries(t, rel)
    for (const e of list) {
      const tag = u16(t, e)
      if (SUB_IFDS.has(tag)) emptyIfd(t, u32(t, e + 8))
      else if (TIFF_TEXT_TAGS.has(tag)) zeroValue(t, e)
    }
    const next = t.start + rel + 2 + list.length * 12
    rel = next + 4 <= out.length ? u32(t, next) : 0
  }
  blankXmp(out)
  return out
}

// ── X-rays and CT: DICOM header ─────────────────────────────────────────────

/**
 * Outside the patient group, the tags that name a person or the place.
 * The patient group (0010) is blanked whole, except sex and age: the partner
 * view shows the age on purpose (sql/092).
 */
const DICOM_BLANK = new Set([
  0x00080050, // AccessionNumber
  0x00080080, // InstitutionName
  0x00080081, // InstitutionAddress
  0x00080090, // ReferringPhysicianName
  0x00080092, // ReferringPhysicianAddress
  0x00080094, // ReferringPhysicianTelephoneNumbers
  0x00081010, // StationName
  0x00081040, // InstitutionalDepartmentName
  0x00081048, // PhysiciansOfRecord
  0x00081050, // PerformingPhysicianName
  0x00081060, // NameOfPhysiciansReadingStudy
  0x00081070, // OperatorsName
  0x00200010, // StudyID
  0x00321032, // RequestingPhysician
  0x00400006, // ScheduledPerformingPhysicianName
])
const DICOM_KEEP = new Set([
  0x00100040, // PatientSex
  0x00101010, // PatientAge
])
const TEXT_VR = new Set(['AE', 'AS', 'CS', 'DA', 'DS', 'DT', 'IS', 'LO', 'LT', 'PN', 'SH', 'ST', 'TM', 'UC', 'UI', 'UR', 'UT'])

const LONG_VR = new Set(['OB', 'OW', 'OF', 'SQ', 'UT', 'UN', 'UC', 'UR', 'OD', 'OL', 'OV', 'SV', 'UV'])
const UNDEFINED = 0xffffffff
const ITEM = 0xfffee000
const ITEM_END = 0xfffee00d
const SEQ_END = 0xfffee0dd
const PIXEL_DATA = 0x7fe00010

export function isDicom(input: Uint8Array): boolean {
  return input.length > 132 && input[128] === 0x44 && input[129] === 0x49 && input[130] === 0x43 && input[131] === 0x4d
}

/**
 * Should this element's value be blanked? `vr` is '' in implicit VR files,
 * where the type is not written: there a patient-group value is blanked
 * unless it is a sequence (it then starts with an item tag and is walked).
 */
function dicomBlank(tag: number, vr: string, value: Uint8Array): boolean {
  if (DICOM_BLANK.has(tag)) return true
  const group = tag >>> 16
  if (group === 0x0010 && !DICOM_KEEP.has(tag)) {
    return vr ? TEXT_VR.has(vr) : !(value[0] === 0xfe && value[1] === 0xff && value[2] === 0x00 && value[3] === 0xe0)
  }
  // Vendors keep names in private tags too. Text values only (and not the
  // private creator ids at xx10–xxFF), so the vendor's binary data survives.
  return (group & 1) === 1 && TEXT_VR.has(vr) && (tag & 0xffff) > 0x00ff
}

/**
 * Blanks the identifying values of a DICOM Part 10 file (explicit or implicit
 * VR, little endian — what dental CBCT and intraoral sensors write), including
 * inside sequences. Stops at the pixel data. Not a DICOM file → unchanged.
 */
export function scrubDicom(input: Uint8Array): Uint8Array {
  if (!isDicom(input)) return input
  const out = input.slice()
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  const tagAt = (o: number) => ((view.getUint16(o, true) << 16) | view.getUint16(o + 2, true)) >>> 0
  const vrAt = (o: number) => String.fromCharCode(out[o], out[o + 1])

  // File meta (group 0002) is always explicit VR; it says how the rest is written.
  let explicit = true
  let p = 132
  while (p + 8 <= out.length && view.getUint16(p, true) === 0x0002) {
    const tag = tagAt(p)
    const vr = vrAt(p + 4)
    const long = LONG_VR.has(vr)
    const len = long ? view.getUint32(p + 8, true) : view.getUint16(p + 6, true)
    const at = p + (long ? 12 : 8)
    if (tag === 0x00020010) {
      const syntax = String.fromCharCode(...out.subarray(at, at + len)).replace(/[\0 ]+$/, '')
      explicit = syntax !== '1.2.840.10008.1.2'
    }
    p = at + len
  }

  /** Walks elements from `p` until `end` or a delimiter; returns where it stopped. */
  const walk = (start: number, end: number): number => {
    let q = start
    while (q + 8 <= end) {
      const tag = tagAt(q)
      if (tag === ITEM_END || tag === SEQ_END) return q + 8
      if (tag === PIXEL_DATA) return end
      let vr = ''
      let len: number
      let at: number
      if (explicit && !(tag >>> 16 === 0xfffe)) {
        vr = vrAt(q + 4)
        if (LONG_VR.has(vr)) { len = view.getUint32(q + 8, true); at = q + 12 }
        else { len = view.getUint16(q + 6, true); at = q + 8 }
      } else {
        len = view.getUint32(q + 4, true)
        at = q + 8
      }
      const isSeq = vr === 'SQ' || (!explicit && len === UNDEFINED)
      if (isSeq) {
        q = sequence(at, len === UNDEFINED ? end : Math.min(end, at + len))
        continue
      }
      if (len === UNDEFINED) return end // undefined-length non-sequence (encapsulated pixels): stop
      if (at + len <= out.length && dicomBlank(tag, vr, out.subarray(at, at + len))) out.fill(0x20, at, at + len)
      q = at + len
    }
    return q
  }

  const sequence = (start: number, end: number): number => {
    let q = start
    while (q + 8 <= end) {
      const tag = tagAt(q)
      if (tag === SEQ_END) return q + 8
      if (tag !== ITEM) return end
      const len = view.getUint32(q + 4, true)
      const body = q + 8
      q = len === UNDEFINED ? walk(body, end) : (walk(body, body + len), body + len)
    }
    return q
  }

  walk(p, out.length)
  return out
}

// ── 3D: STL, PLY, OBJ ───────────────────────────────────────────────────────

/** A binary STL: an 80-byte header, a triangle count, 50 bytes per triangle. */
function isBinaryStl(b: Uint8Array): boolean {
  return b.length >= 84 && 84 + 50 * new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(80, true) === b.length
}

/**
 * Scanners write the patient into an STL: the binary header (80 free bytes,
 * often "<patient> upper jaw"), or the ASCII `solid <name>` / `endsolid
 * <name>` lines. The header is zeroed (zeros, not spaces: a header starting
 * "solid" makes readers take the file for ASCII); the names become spaces.
 */
export function scrubStl(input: Uint8Array): Uint8Array {
  if (isBinaryStl(input)) {
    const out = input.slice()
    out.fill(0, 0, 80)
    return out
  }
  let s = 0
  while (s < input.length && (input[s] === 0x20 || input[s] === 0x09)) s++
  if (!ascii(input, s, 'solid')) return input
  const out = input.slice()
  for (let line = 0; line < out.length;) {
    let nl = out.indexOf(0x0a, line)
    if (nl === -1) nl = out.length
    let k = line
    while (k < nl && (out[k] === 0x20 || out[k] === 0x09)) k++
    const word = ascii(out, k, 'endsolid') ? 8 : ascii(out, k, 'solid') ? 5 : 0
    if (word) for (let i = k + word; i < nl; i++) if (out[i] !== 0x0d) out[i] = 0x20
    line = nl + 1
  }
  return out
}

/** The lines of `bytes[from, to)`, without those `drop` picks. */
function dropLines(bytes: Uint8Array, from: number, to: number, drop: (line: Uint8Array) => boolean): Uint8Array[] {
  const kept: Uint8Array[] = []
  for (let line = from; line < to;) {
    let nl = bytes.indexOf(0x0a, line)
    if (nl === -1 || nl >= to) nl = to - 1
    const l = bytes.subarray(line, nl + 1)
    if (!drop(l)) kept.push(l)
    line = nl + 1
  }
  return kept
}

const startsWithWord = (l: Uint8Array, words: string[]): boolean => {
  let k = 0
  while (k < l.length && (l[k] === 0x20 || l[k] === 0x09)) k++
  return words.some(w => ascii(l, k, w) && (k + w.length === l.length || [0x20, 0x09, 0x0d, 0x0a].includes(l[k + w.length])))
}

export function isPly(b: Uint8Array): boolean {
  return ascii(b, 0, 'ply\n') || ascii(b, 0, 'ply\r\n')
}

/**
 * PLY: `comment` and `obj_info` lines out of the header (exporters put the
 * patient, the clinic and the scanner there). The header is text up to
 * `end_header`; the data after it is copied as it is.
 */
export function scrubPly(input: Uint8Array): Uint8Array {
  if (!isPly(input)) return input
  const endHeader = indexOf(input, 'end_header', 0)
  if (endHeader === -1) return input
  const nl = input.indexOf(0x0a, endHeader)
  const headerEnd = nl === -1 ? input.length : nl + 1
  return concat([
    ...dropLines(input, 0, headerEnd, l => startsWithWord(l, ['comment', 'obj_info'])),
    input.subarray(headerEnd),
  ])
}

/** OBJ and its MTL: `#` comment lines out. */
export function stripObjComments(input: Uint8Array): Uint8Array {
  return concat(dropLines(input, 0, input.length, l => {
    let k = 0
    while (k < l.length && (l[k] === 0x20 || l[k] === 0x09)) k++
    return l[k] === 0x23
  }))
}

// ── Everything a file needs before upload ───────────────────────────────────

export type JobFileType = 'scan' | 'photo' | 'xray' | 'print' | 'design' | 'other'

export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name)
  return m ? m[1].toLowerCase() : ''
}

/** A sensible default type from the extension; the user can change it. */
export function guessFileType(name: string): JobFileType {
  const ext = extensionOf(name)
  if (['stl', 'ply', 'obj', '3mf'].includes(ext)) return 'scan'
  if (['dcm', 'dicom'].includes(ext)) return 'xray'
  if (['jpg', 'jpeg', 'png', 'heic', 'webp'].includes(ext)) return 'photo'
  return 'other'
}

/**
 * The bytes as they will be uploaded. Routed by content where the format has
 * a signature; STL (binary has none) and OBJ/MTL (plain text) by the name.
 */
export function cleanForUpload(bytes: Uint8Array, name = ''): Uint8Array {
  if (isDicom(bytes)) return scrubDicom(bytes)
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return stripJpegMetadata(bytes)
  if (isPng(bytes)) return stripPngMetadata(bytes)
  if (isWebp(bytes)) return stripWebpMetadata(bytes)
  if (isHeif(bytes)) return stripHeifMetadata(bytes)
  if (isTiff(bytes)) return stripTiffMetadata(bytes)
  if (isPly(bytes)) return scrubPly(bytes)
  const ext = extensionOf(name)
  if (ext === 'stl' || ascii(bytes, 0, 'solid')) return scrubStl(bytes)
  if (ext === 'obj' || ext === 'mtl') return stripObjComments(bytes)
  return bytes
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}
