/**
 * What a file loses before it leaves this computer (spec, Phase 1 Files:
 * "on upload, on the client side: DICOM header scrub, EXIF GPS removal from
 * photos, file name replaced by the job code").
 *
 * Both cleaners work IN PLACE on a copy and never change the file's length:
 * an identifying value is overwritten (spaces for DICOM text, zeros for GPS),
 * not cut out. Cutting would shift every offset after it, and both formats are
 * full of offsets — a shorter file that no viewer can open is not "cleaned".
 *
 * The name is replaced on the server (`register_job_file` names the file after
 * the job code), so nothing here needs to know the job.
 */

// ── Photos: EXIF GPS ────────────────────────────────────────────────────────

/** Bytes per value for each TIFF field type (1 BYTE … 12 DOUBLE). */
const TIFF_TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8]

/**
 * Removes the GPS data from a JPEG's EXIF block, keeping everything else
 * (orientation especially — a photo that comes out sideways is its own bug).
 *
 * The GPS IFD's entries and every value they point at are zeroed and its entry
 * count set to 0. The pointer from IFD0 stays, now pointing at an empty IFD,
 * which every reader accepts. Returns the input unchanged when there is no
 * EXIF or no GPS, or when the file is not a JPEG.
 */
export function stripJpegGps(input: Uint8Array): Uint8Array {
  if (input[0] !== 0xff || input[1] !== 0xd8) return input
  const out = input.slice()
  let p = 2
  while (p + 4 <= out.length && out[p] === 0xff) {
    const marker = out[p + 1]
    if (marker === 0xda || marker === 0xd9) break // start of scan / end: no more metadata
    const len = (out[p + 2] << 8) | out[p + 3]
    const seg = p + 4
    const isExif = marker === 0xe1 && out[seg] === 0x45 && out[seg + 1] === 0x78 && out[seg + 2] === 0x69
      && out[seg + 3] === 0x66 && out[seg + 4] === 0 && out[seg + 5] === 0
    if (isExif) clearGps(out, seg + 6, p + 2 + len)
    p += 2 + len
  }
  return out
}

function clearGps(buf: Uint8Array, tiff: number, end: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const le = buf[tiff] === 0x49 // 'II' little endian, 'MM' big
  const u16 = (o: number) => view.getUint16(o, le)
  const u32 = (o: number) => view.getUint32(o, le)
  const ifd0 = tiff + u32(tiff + 4)
  if (ifd0 + 2 > end) return
  const n0 = u16(ifd0)
  for (let i = 0; i < n0; i++) {
    const e = ifd0 + 2 + i * 12
    if (u16(e) !== 0x8825) continue // GPSInfo
    const gps = tiff + u32(e + 8)
    if (gps + 2 > end) return
    const n = u16(gps)
    for (let k = 0; k < n; k++) {
      const g = gps + 2 + k * 12
      const size = (TIFF_TYPE_SIZE[u16(g + 2)] ?? 1) * u32(g + 4)
      if (size > 4) {
        const at = tiff + u32(g + 8)
        if (at + size <= end) buf.fill(0, at, at + size)
      }
      buf.fill(0, g, g + 12)
    }
    view.setUint16(gps, 0, le)
  }
}

// ── X-rays and CT: DICOM header ─────────────────────────────────────────────

/**
 * Tags that identify a person or the place, blanked. Age and sex stay: the
 * partner view shows them on purpose (spec: "derives age, sex").
 */
const DICOM_BLANK = new Set([
  0x00100010, // PatientName
  0x00100020, // PatientID
  0x00100030, // PatientBirthDate
  0x00100032, // PatientBirthTime
  0x00101000, // OtherPatientIDs
  0x00101001, // OtherPatientNames
  0x00101040, // PatientAddress
  0x00101060, // PatientMotherBirthName
  0x00102154, // PatientTelephoneNumbers
  0x00080080, // InstitutionName
  0x00080081, // InstitutionAddress
  0x00080090, // ReferringPhysicianName
  0x00081050, // PerformingPhysicianName
  0x00081070, // OperatorsName
])

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
      if (DICOM_BLANK.has(tag) && at + len <= out.length) out.fill(0x20, at, at + len)
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

/** The bytes as they will be uploaded: GPS gone from photos, identity gone from DICOM. */
export function cleanForUpload(bytes: Uint8Array): Uint8Array {
  if (isDicom(bytes)) return scrubDicom(bytes)
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return stripJpegGps(bytes)
  return bytes
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}
