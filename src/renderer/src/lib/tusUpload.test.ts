/**
 * The resumable upload against a fake TUS server that drops connections.
 * Spec acceptance: "a 200 MB scan continues uploading after a network
 * interruption". The file here is small and the chunks tiny so the test is
 * fast; the protocol does not care about size.
 */
import { describe, it, expect } from 'vitest'
import { tusUpload, type UrlStore } from './tusUpload'

class MemStore implements UrlStore {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
}

/** A TUS server keeping uploads in memory, with ways to make it fail. */
function server(opts: { failPatchAt?: number[]; partialOnFail?: boolean; forgetAfterFail?: boolean } = {}) {
  const uploads = new Map<string, { length: number; data: number[] }>()
  let patches = 0
  let creates = 0
  const fails = new Set(opts.failPatchAt ?? [])
  const fake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const h = new Headers(init?.headers)
    if (init?.method === 'POST') {
      creates++
      const id = `https://store.test/upload/${creates}`
      uploads.set(id, { length: Number(h.get('Upload-Length')), data: [] })
      return new Response(null, { status: 201, headers: { Location: id } })
    }
    const u = uploads.get(url)
    if (!u) return new Response(null, { status: 404 })
    if (init?.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Upload-Offset': String(u.data.length) } })
    if (init?.method === 'PATCH') {
      patches++
      const offset = Number(h.get('Upload-Offset'))
      if (offset !== u.data.length) return new Response(null, { status: 409 })
      const body = init.body as Uint8Array
      if (fails.has(patches)) {
        fails.delete(patches)
        // The connection drops part-way: the server may have kept some bytes.
        if (opts.partialOnFail) u.data.push(...body.subarray(0, Math.floor(body.length / 2)))
        if (opts.forgetAfterFail) uploads.delete(url)
        throw new TypeError('Failed to fetch')
      }
      u.data.push(...body)
      return new Response(null, { status: 204, headers: { 'Upload-Offset': String(u.data.length) } })
    }
    return new Response(null, { status: 405 })
  }
  return { fake, uploads, counts: () => ({ patches, creates }) }
}

const file = new Uint8Array(Array.from({ length: 1000 }, (_, i) => i % 251))
const base = (s: ReturnType<typeof server>, store = new MemStore()) => ({
  endpoint: 'https://store.test/upload',
  headers: async () => ({ Authorization: 'Bearer x' }),
  metadata: { bucketName: 'job-files', objectName: 'a/b/c' },
  fingerprint: 'sha-of-file',
  chunkSize: 100,
  store,
  fetch: s.fake as typeof fetch,
  retryDelays: [0, 0, 0],
})

const stored = (s: ReturnType<typeof server>) => new Uint8Array([...s.uploads.values()][0].data)

describe('tusUpload', () => {
  it('uploads in chunks', async () => {
    const s = server()
    const progress: number[] = []
    await tusUpload(file, { ...base(s), onProgress: sent => progress.push(sent) })
    expect(stored(s)).toEqual(file)
    expect(progress.at(-1)).toBe(1000)
  })

  it('continues after the connection drops mid-chunk, from what the server really has', async () => {
    const s = server({ failPatchAt: [4], partialOnFail: true })
    await tusUpload(file, base(s))
    expect(stored(s)).toEqual(file)
    expect(s.counts().creates).toBe(1) // resumed, not restarted
  })

  it('survives several drops in a row', async () => {
    const s = server({ failPatchAt: [2, 3, 4], partialOnFail: true })
    await tusUpload(file, base(s))
    expect(stored(s)).toEqual(file)
  })

  it('a later attempt (after an app restart) resumes the same upload', async () => {
    const s = server({ failPatchAt: [3, 4, 5, 6, 7] })
    const store = new MemStore()
    await expect(tusUpload(file, { ...base(s, store), retryDelays: [0] })).rejects.toThrow()
    expect(store.getItem('wivo_tus:sha-of-file')).toBeTruthy()
    await tusUpload(file, base(s, store))
    expect(stored(s)).toEqual(file)
    expect(s.counts().creates).toBe(1)
    expect(store.getItem('wivo_tus:sha-of-file')).toBeNull()
  })

  it('starts over when the server has forgotten the upload', async () => {
    const s = server({ failPatchAt: [2], forgetAfterFail: true })
    await tusUpload(file, base(s))
    expect(s.counts().creates).toBe(2)
    expect(new Uint8Array([...s.uploads.values()].at(-1)!.data)).toEqual(file)
  })

  it('gives up after the last retry, and says so', async () => {
    const s = server({ failPatchAt: [1, 2, 3, 4, 5, 6] })
    await expect(tusUpload(file, base(s))).rejects.toThrow('Failed to fetch')
  })
})
