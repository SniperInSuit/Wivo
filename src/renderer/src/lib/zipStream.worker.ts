/// <reference lib="webworker" />
/** Builds the folder ZIP off the UI thread. See zipStream.ts. */
import { buildZip, ZipLimitError } from './zipStream'
import { CleanError } from './fileClean'

export type ZipWorkerIn = { files: { name: string; size: number; lastModified: number; file: Blob }[] }
export type ZipWorkerOut =
  | { kind: 'progress'; done: number; total: number }
  | { kind: 'done'; blob: Blob; sha256: string; size: number; entries: number }
  | { kind: 'error'; code: 'size' | 'count' | 'clean' | 'other'; message: string }

const post = (m: ZipWorkerOut) => (self as unknown as Worker).postMessage(m)

self.onmessage = async (e: MessageEvent<ZipWorkerIn>) => {
  try {
    let last = 0
    const r = await buildZip(e.data.files.map(f => ({ ...f, slice: (a: number, b: number) => f.file.slice(a, b) })), {
      onProgress: (done, total) => {
        const now = Date.now()
        if (now - last > 100 || done === total) { last = now; post({ kind: 'progress', done, total }) }
      },
    })
    post({ kind: 'done', ...r })
  } catch (err) {
    post({
      kind: 'error',
      code: err instanceof ZipLimitError ? err.reason : err instanceof CleanError ? 'clean' : 'other',
      message: (err as Error).message ?? String(err),
    })
  }
}
