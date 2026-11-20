/**
 * A store-only ZIP built as a STREAM, for a folder of files (a CT/DICOM series,
 * a CEREC export): spec docs/WORKFLOW-STAGES.md 6.2.
 *
 * - Each entry is read in slices; the CRC-32 is computed while streaming, so
 *   the local header carries flag bit 3 and the sizes/CRC follow the data in a
 *   data descriptor. Nothing larger than one slice (or one scrubbed small
 *   entry) is ever held as bytes.
 * - Output is collected as Blob parts, flushed into a Blob every few MB:
 *   Chromium keeps big blobs on disk, not in the renderer's heap.
 * - The SHA-256 of the finished ZIP is computed in the same pass.
 * - Entries under SCRUB_LIMIT bytes go through cleanForUpload (identity out of
 *   DICOM headers, metadata out of images, names out of STL). Bigger entries
 *   are stored as they are: reading them whole is what this module exists to
 *   avoid. The ZIP itself is never cleaned (it is an opaque container).
 * - No zip64: a folder over 4 GB, an entry over 4 GB or more than 65,535
 *   entries is refused with a clear error (ZipLimitError).
 *
 * Runs in a Web Worker (zipFolder.ts) or, as a fallback, on the main thread;
 * it only awaits Blob reads, so the event loop keeps turning either way.
 */
import { crc32Update, crc32Final, CRC32_INIT } from './crc32'
import { Sha256 } from './sha256Stream'
import { cleanForUpload } from './fileClean'

export const SLICE = 1024 * 1024
export const SCRUB_LIMIT = 64 * 1024 * 1024
const FLUSH_AT = 8 * 1024 * 1024
const MAX = 0xffffffff
/** Room for headers and the central directory under the 4 GB ceiling. */
const HEADROOM = 16 * 1024 * 1024

export class ZipLimitError extends Error {
  constructor(readonly reason: 'size' | 'count') { super(`zip limit: ${reason}`) }
}

export interface ZipSource {
  /** Path inside the ZIP, "/"-separated (webkitRelativePath). */
  name: string
  size: number
  lastModified: number
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> }
}

export interface ZipResult {
  blob: Blob
  sha256: string
  size: number
  entries: number
}

function dosTime(ms: number): [number, number] {
  const d = new Date(ms)
  const y = Math.min(Math.max(d.getFullYear(), 1980), 2107)
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const date = ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return [time, date]
}

export async function buildZip(
  sources: ZipSource[],
  opts: { onProgress?: (done: number, total: number) => void; signal?: { aborted: boolean } } = {},
): Promise<ZipResult> {
  const total = sources.reduce((n, s) => n + s.size, 0)
  if (sources.length > 0xffff) throw new ZipLimitError('count')
  if (total > MAX - HEADROOM || sources.some(s => s.size > MAX - HEADROOM)) throw new ZipLimitError('size')

  const enc = new TextEncoder()
  const sha = new Sha256()
  const blobs: Blob[] = []
  let pending: Uint8Array[] = []
  let pendingBytes = 0
  let offset = 0

  const emit = (chunk: Uint8Array) => {
    sha.update(chunk)
    pending.push(chunk)
    pendingBytes += chunk.length
    offset += chunk.length
    if (offset > MAX) throw new ZipLimitError('size')
    if (pendingBytes >= FLUSH_AT) flush()
  }
  const flush = () => {
    if (pending.length) blobs.push(new Blob(pending as BlobPart[]))
    pending = []
    pendingBytes = 0
  }

  const central: Uint8Array[] = []
  let processed = 0

  for (const s of sources) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const name = enc.encode(s.name)
    const [time, date] = dosTime(s.lastModified)
    const headerAt = offset

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0808, true) // UTF-8 names + data descriptor follows
    lv.setUint16(8, 0, true)      // stored
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    // crc and sizes are 0 here: they follow in the data descriptor
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    emit(local)

    let crc = CRC32_INIT
    let written = 0
    if (s.size <= SCRUB_LIMIT) {
      const raw = new Uint8Array(await s.slice(0, s.size).arrayBuffer())
      const bytes = cleanForUpload(raw, s.name)
      crc = crc32Update(crc, bytes)
      written = bytes.length
      if (bytes.length) emit(bytes)
      processed += s.size
      opts.onProgress?.(processed, total)
    } else {
      for (let at = 0; at < s.size; at += SLICE) {
        if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        const part = new Uint8Array(await s.slice(at, Math.min(s.size, at + SLICE)).arrayBuffer())
        crc = crc32Update(crc, part)
        written += part.length
        emit(part)
        processed += part.length
        opts.onProgress?.(processed, total)
      }
    }
    const crcFinal = crc32Final(crc)

    const dd = new Uint8Array(16)
    const dv = new DataView(dd.buffer)
    dv.setUint32(0, 0x08074b50, true)
    dv.setUint32(4, crcFinal, true)
    dv.setUint32(8, written, true)
    dv.setUint32(12, written, true)
    emit(dd)

    const cen = new Uint8Array(46 + name.length)
    const cv = new DataView(cen.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0808, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crcFinal, true)
    cv.setUint32(20, written, true)
    cv.setUint32(24, written, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, headerAt, true)
    cen.set(name, 46)
    central.push(cen)
  }

  const centralAt = offset
  let centralSize = 0
  for (const c of central) { centralSize += c.length; emit(c) }
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, sources.length, true)
  ev.setUint16(10, sources.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, centralAt, true)
  emit(end)
  flush()

  return { blob: new Blob(blobs), sha256: sha.digestHex(), size: offset, entries: sources.length }
}
