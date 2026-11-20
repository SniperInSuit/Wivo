/**
 * Builds a folder's ZIP in a Web Worker (electron-vite/Vite bundles
 * `new Worker(new URL(...), { type: 'module' })`). If the worker cannot start
 * (a file:// origin refusing it, no Worker at all) the same code runs on the
 * main thread: it awaits Blob reads slice by slice, so the UI stays responsive,
 * only less smoothly.
 */
import { buildZip, ZipLimitError, type ZipResult, type ZipSource } from './zipStream'
import { CleanError } from './fileClean'
import type { ZipWorkerOut } from './zipStream.worker'

export type FolderZip = ZipResult

const fail = (code: string, message: string): Error =>
  code === 'size' || code === 'count' ? new ZipLimitError(code)
    : code === 'clean' ? new CleanError(message) : new Error(message)

/** The ZIP name's root and the entry paths come from webkitRelativePath. */
export function folderSources(files: File[]): ZipSource[] {
  return files.map(f => ({
    name: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
    size: f.size, lastModified: f.lastModified, slice: (a, b) => f.slice(a, b),
  }))
}

export function folderName(files: File[]): string {
  const p = (files[0] as (File & { webkitRelativePath?: string }) | undefined)?.webkitRelativePath
  return p?.split('/')[0] || 'folder'
}

export function buildFolderZip(files: File[], onProgress: (done: number, total: number) => void): Promise<FolderZip> {
  const sources = folderSources(files)
  const mainThread = () => buildZip(sources, { onProgress })
  if (typeof Worker === 'undefined') return mainThread()

  return new Promise<FolderZip>((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./zipStream.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      mainThread().then(resolve, reject)
      return
    }
    let started = false
    worker.onmessage = (e: MessageEvent<ZipWorkerOut>) => {
      started = true
      const m = e.data
      if (m.kind === 'progress') onProgress(m.done, m.total)
      else if (m.kind === 'done') { worker.terminate(); resolve({ blob: m.blob, sha256: m.sha256, size: m.size, entries: m.entries }) }
      else { worker.terminate(); reject(fail(m.code, m.message)) }
    }
    worker.onerror = () => {
      worker.terminate()
      // Never got going (script blocked): do it here. Mid-run failure: report it.
      if (!started) mainThread().then(resolve, reject)
      else reject(new Error('The ZIP could not be built'))
    }
    // File objects are structured-cloneable; slices are read inside the worker.
    worker.postMessage({ files: files.map((f, i) => ({ name: sources[i].name, size: f.size, lastModified: f.lastModified, file: f })) })
  })
}
