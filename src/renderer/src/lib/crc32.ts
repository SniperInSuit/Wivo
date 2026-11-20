/** Incremental CRC-32 (same table as zip.ts's crc32, which is one-shot). */
const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export const CRC32_INIT = 0xffffffff
export function crc32Update(state: number, bytes: Uint8Array): number {
  let c = state
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return c >>> 0
}
export const crc32Final = (state: number): number => (state ^ 0xffffffff) >>> 0
