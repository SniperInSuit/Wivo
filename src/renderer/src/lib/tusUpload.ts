/**
 * Resumable upload (TUS 1.0.0), the protocol Supabase Storage speaks at
 * `/storage/v1/upload/resumable`.
 *
 * Spec acceptance: "a 200 MB scan continues uploading after a network
 * interruption". So: the upload URL is remembered under the file's hash; any
 * failure — a dropped connection, a 5xx, a laptop lid — is followed by a HEAD
 * that asks the server how much it actually has, and the upload continues from
 * THERE, never from zero and never from where the client thinks it was.
 *
 * Written here rather than added as a dependency: the protocol is three
 * requests, and the part that matters (what to do after a failure) is the
 * part worth owning and testing (tusUpload.test.ts).
 */

/** Supabase requires exactly 6 MB chunks (the last one may be shorter). */
export const SUPABASE_CHUNK = 6 * 1024 * 1024

/** Where upload URLs are remembered between attempts. localStorage in the app. */
export interface UrlStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface TusOptions {
  endpoint: string
  /** Fresh per request: the access token may be refreshed during a long upload. */
  headers: () => Promise<Record<string, string>>
  metadata: Record<string, string>
  /** Stable for the same bytes — the SHA-256 — so a retry finds its URL. */
  fingerprint: string
  chunkSize?: number
  store?: UrlStore
  fetch?: typeof fetch
  /** Waits between attempts after a failure, in ms. Then it gives up. */
  retryDelays?: number[]
  onProgress?: (sent: number, total: number) => void
  signal?: AbortSignal
}

const KEY = (fp: string) => `wivo_tus:${fp}`

const b64 = (s: string): string => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
})

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

/** Retry on the network and on the server; give up at once on a 4xx the client caused. */
const retryable = (e: unknown): boolean =>
  !(e instanceof HttpError) || e.status >= 500 || e.status === 409 || e.status === 423 || e.status === 429

export async function tusUpload(bytes: Uint8Array, o: TusOptions): Promise<void> {
  const http = o.fetch ?? fetch
  const chunk = o.chunkSize ?? SUPABASE_CHUNK
  const delays = o.retryDelays ?? [1000, 3000, 5000, 10_000, 20_000, 30_000]
  const total = bytes.length
  const base = { 'Tus-Resumable': '1.0.0' }

  const create = async (): Promise<string> => {
    const res = await http(o.endpoint, {
      method: 'POST',
      headers: {
        ...base, ...(await o.headers()),
        'Upload-Length': String(total),
        'Upload-Metadata': Object.entries(o.metadata).map(([k, v]) => `${k} ${b64(v)}`).join(','),
      },
      signal: o.signal,
    })
    if (res.status !== 201) throw new HttpError(res.status, `Could not start the upload (${res.status})`)
    const loc = res.headers.get('Location')
    if (!loc) throw new Error('The server did not say where to upload')
    const url = new URL(loc, o.endpoint).toString()
    o.store?.setItem(KEY(o.fingerprint), url)
    return url
  }

  /** How much the server has. null = it no longer knows this upload. */
  const offsetAt = async (url: string): Promise<number | null> => {
    const res = await http(url, { method: 'HEAD', headers: { ...base, ...(await o.headers()) }, signal: o.signal })
    if (res.status === 404 || res.status === 410 || res.status === 403) return null
    if (!res.ok) throw new HttpError(res.status, `Could not resume (${res.status})`)
    return Number(res.headers.get('Upload-Offset') ?? 0)
  }

  let url = o.store?.getItem(KEY(o.fingerprint)) ?? null
  let offset = 0
  let attempt = 0

  for (;;) {
    try {
      if (url) {
        const known = await offsetAt(url)
        if (known === null) { o.store?.removeItem(KEY(o.fingerprint)); url = null }
        else offset = known
      }
      if (!url) { url = await create(); offset = 0 }
      o.onProgress?.(offset, total)

      while (offset < total) {
        const end = Math.min(offset + chunk, total)
        const res = await http(url, {
          method: 'PATCH',
          headers: {
            ...base, ...(await o.headers()),
            'Content-Type': 'application/offset+octet-stream',
            'Upload-Offset': String(offset),
          },
          // A copy, not a view: fetch wants an ArrayBuffer-backed body, and 6 MB is cheap.
          body: bytes.slice(offset, end),
          signal: o.signal,
        })
        if (res.status !== 204) throw new HttpError(res.status, `Upload interrupted (${res.status})`)
        offset = Number(res.headers.get('Upload-Offset') ?? end)
        attempt = 0 // progress was made: the next failure gets the full set of retries again
        o.onProgress?.(offset, total)
      }

      o.store?.removeItem(KEY(o.fingerprint))
      return
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      if (!retryable(e) || attempt >= delays.length) throw e
      await wait(delays[attempt++], o.signal)
      // Loop: HEAD tells us where the server really is.
    }
  }
}
