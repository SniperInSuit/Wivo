/**
 * One ZIP file of several, stored without compression.
 *
 * Why it exists: an export of two files (the accountant's monthly pay export)
 * downloaded the first and silently lost the second. Chromium, which the
 * desktop runs on, blocks a second automatic download from the same click.
 * One file holding both always arrives.
 *
 * Stored, not deflated: a month's CSVs are small, every unzip tool on Windows,
 * macOS and Linux opens stored entries, and there is no dependency to ship.
 * File names are UTF-8 (general purpose flag bit 11), so "palgad-read.csv"
 * and Latvian names survive.
 *
 * NO DEPENDENCIES: shared/README.md.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

/** CRC-32 (IEEE), as ZIP needs it. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** MS-DOS date and time, local, as ZIP stores them (two-second steps, from 1980). */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

export interface ZipEntry {
  name: string
  data: Uint8Array
}

export function zipStored(entries: ZipEntry[], when: Date = new Date()): Uint8Array {
  const enc = new TextEncoder()
  const { time, date } = dosDateTime(when)
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const e of entries) {
    const name = enc.encode(e.name)
    const crc = crc32(e.data)
    const size = e.data.length

    const local = new Uint8Array(30 + name.length + size)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)  // local file header
    lv.setUint16(4, 20, true)           // version needed
    lv.setUint16(6, 0x0800, true)       // UTF-8 names
    lv.setUint16(8, 0, true)            // stored
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)        // compressed size
    lv.setUint32(22, size, true)        // uncompressed size
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true)           // no extra field
    local.set(name, 30)
    local.set(e.data, 30 + name.length)
    locals.push(local)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)  // central directory header
    cv.setUint16(4, 20, true)           // version made by
    cv.setUint16(6, 20, true)           // version needed
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, name.length, true)
    // extra, comment, disk, internal and external attributes: all zero
    cv.setUint32(42, offset, true)      // where its local header starts
    central.set(name, 46)
    centrals.push(central)

    offset += local.length
  }

  const centralSize = centrals.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)    // end of central directory
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const out = new Uint8Array(offset + centralSize + end.length)
  let at = 0
  for (const part of [...locals, ...centrals, end]) { out.set(part, at); at += part.length }
  return out
}
