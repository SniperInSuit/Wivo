/**
 * The ZIP writer (zip.ts): read back by an independent reader below, with
 * Node's own CRC-32, so it isn't only checked against itself.
 */
import { describe, it, expect } from 'vitest'
import { crc32 as nodeCrc32 } from 'node:zlib'
import { crc32, zipStored } from './zip'

/** The entries of a stored ZIP, by its central directory, as an unzip tool reads them. */
function unzip(bytes: Uint8Array): { name: string; data: Uint8Array; crc: number }[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = bytes.length - 22
  expect(v.getUint32(end, true)).toBe(0x06054b50)
  const count = v.getUint16(end + 10, true)
  let at = v.getUint32(end + 16, true)
  const out = []
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50)
    expect(v.getUint16(at + 10, true)).toBe(0) // stored
    const crc = v.getUint32(at + 16, true)
    const size = v.getUint32(at + 24, true)
    const nameLen = v.getUint16(at + 28, true)
    const local = v.getUint32(at + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen))
    expect(v.getUint32(local, true)).toBe(0x04034b50)
    const dataAt = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
    out.push({ name, data: bytes.subarray(dataAt, dataAt + size), crc })
    at += 46 + nameLen
  }
  return out
}

describe('one ZIP of several files', () => {
  const enc = new TextEncoder()
  const files = [
    { name: 'pay-2026-10-people.csv', data: enc.encode('﻿sep=;\r\nPerson;Total\r\nJānis Piemērs;1415\r\n') },
    { name: 'pay-2026-10-lines.csv', data: enc.encode('﻿sep=;\r\nPerson;Job code\r\nAnna;RIG-0042\r\n') },
  ]

  it('holds every file, byte for byte, under its own name', () => {
    const back = unzip(zipStored(files, new Date(2026, 10, 9, 14, 30, 12)))
    expect(back.map(f => f.name)).toEqual(files.map(f => f.name))
    back.forEach((f, i) => expect([...f.data]).toEqual([...files[i].data]))
  })

  it('with the CRC-32 an unzip tool checks (Node\'s own, not ours)', () => {
    for (const f of unzip(zipStored(files))) expect(f.crc).toBe(nodeCrc32(f.data))
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926)
  })

  it('an empty file and a non-ASCII name are fine', () => {
    const back = unzip(zipStored([{ name: 'tühi-ādās.csv', data: new Uint8Array() }]))
    expect(back).toMatchObject([{ name: 'tühi-ādās.csv' }])
    expect(back[0].data.length).toBe(0)
  })
})
