/**
 * Files upload in the background, one at a time, while the app stays usable
 * (spec, Phase 1 Files: "TUS upload in a background queue").
 *
 * Each file: read → clean (fileClean: metadata off photos, identity off DICOM
 * and 3D scans; a file that cannot be cleaned is not uploaded) → SHA-256 of
 * what will actually be stored → `register_job_file` (rights, version, job-code
 * name, path) → resumable upload to that path → `confirm_job_file`. A failure
 * keeps the task with its file so "Retry" continues the same upload
 * (tusUpload resumes by the file's hash).
 *
 * A module-level store, read through useSyncExternalStore like the app's
 * other stores; a job panel can close and reopen and the progress is still
 * there.
 */
import { useSyncExternalStore } from 'react'
import { supabase, storageEndpoint, anonKey } from './supabase'
import { cleanForUpload, extensionOf, sha256Hex, CleanError, type JobFileType } from './fileClean'
import { tusUpload } from './tusUpload'
import { buildFolderZip, folderName } from './zipFolder'
import { ZipLimitError } from './zipStream'
import { makePreview } from './previews'
import { playSound } from './sound'
import { t } from './i18n'

export type UploadStatus = 'queued' | 'preparing' | 'uploading' | 'done' | 'failed'

export interface UploadTask {
  id: string
  jobId: string
  type: JobFileType
  name: string
  size: number
  sent: number
  status: UploadStatus
  error?: string
  supersedes?: string | null
  file: File
  /**
   * A folder (CT/DICOM series, CEREC export) to be made into ONE ZIP. `file` is
   * then a placeholder; `built` is the finished ZIP, kept so a Retry resumes the
   * upload instead of rebuilding from a file list that may be gone.
   */
  folder?: File[]
  built?: { blob: Blob; sha256: string; size: number }
  /** Called with the stored file's id once it is confirmed (a comment attaching it waits for this). */
  onStored?: (fileId: string) => void
}

let tasks: UploadTask[] = []
const listeners = new Set<() => void>()
const emit = () => { tasks = [...tasks]; listeners.forEach(l => l()) }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const snapshot = () => tasks

/** Uploads still on their way: an update restart waits for them (lib/restartGuard). */
export function activeUploads(): number {
  return tasks.filter(t => t.status === 'queued' || t.status === 'preparing' || t.status === 'uploading').length
}

/**
 * Told the job id whenever one of its uploads completes. A set, not one
 * callback: two file panels can be open at once (side and bottom), and the
 * second must not silence the first. Returns the unsubscribe.
 */
const doneListeners = new Set<(jobId: string) => void>()
export function onUploadDone(fn: (jobId: string) => void): () => void {
  doneListeners.add(fn)
  return () => { doneListeners.delete(fn) }
}

const patch = (id: string, p: Partial<UploadTask>) => {
  const t = tasks.find(x => x.id === id)
  if (t) { Object.assign(t, p); emit() }
}

let running = false

async function runFolder(task: UploadTask): Promise<void> {
  patch(task.id, { status: 'preparing', error: undefined })
  if (!task.built) {
    const total = task.folder!.reduce((n, f) => n + f.size, 0)
    patch(task.id, { size: total, sent: 0 })
    const z = await buildFolderZip(task.folder!, done => patch(task.id, { sent: done }))
    patch(task.id, { built: { blob: z.blob, sha256: z.sha256, size: z.size }, folder: undefined })
  }
  const { blob, sha256, size } = task.built!
  const { data: row, error } = await supabase.rpc('register_job_file', {
    p_job: task.jobId, p_type: task.type, p_sha256: sha256, p_size: size,
    p_mime: 'application/zip', p_extension: 'zip', p_supersedes: null,
  })
  if (error) throw error
  const file = row as { id: string; storage_path: string }
  patch(task.id, { status: 'uploading', size, sent: 0 })
  await upload(task, blob, file, sha256, 'application/zip')
  const { error: confirmError } = await supabase.rpc('confirm_job_file', { p_file: file.id })
  if (confirmError) throw confirmError
  patch(task.id, { status: 'done', sent: size, built: undefined })
  doneListeners.forEach(l => l(task.jobId))
  task.onStored?.(file.id)
  playSound('notify-upload-done')
}

function upload(task: UploadTask, body: Uint8Array | Blob, file: { id: string; storage_path: string }, sha: string, mime: string) {
  return tusUpload(body, {
    endpoint: storageEndpoint(),
    headers: async () => {
      const { data } = await supabase.auth.getSession()
      return { authorization: `Bearer ${data.session?.access_token ?? ''}`, apikey: anonKey(), 'x-upsert': 'false' }
    },
    metadata: { bucketName: 'job-files', objectName: file.storage_path, contentType: mime, cacheControl: '3600' },
    fingerprint: `${sha}:${file.id}`,
    store: localStorage,
    onProgress: sent => patch(task.id, { sent }),
  })
}

async function runOne(task: UploadTask): Promise<void> {
  if (task.folder || task.built) return runFolder(task)
  patch(task.id, { status: 'preparing', error: undefined })
  const bytes = cleanForUpload(new Uint8Array(await task.file.arrayBuffer()), task.file.name)
  const sha = await sha256Hex(bytes)
  const { data: row, error } = await supabase.rpc('register_job_file', {
    p_job: task.jobId, p_type: task.type, p_sha256: sha, p_size: bytes.length,
    p_mime: task.file.type || null, p_extension: extensionOf(task.file.name), p_supersedes: task.supersedes ?? null,
  })
  if (error) throw error
  const file = row as { id: string; storage_path: string }

  patch(task.id, { status: 'uploading', size: bytes.length })
  await upload(task, bytes, file, sha, task.file.type || 'application/octet-stream')

  const { error: confirmError } = await supabase.rpc('confirm_job_file', { p_file: file.id })
  if (confirmError) throw confirmError
  await attachPreview(file.id, task.file.name, bytes)
  patch(task.id, { status: 'done', sent: bytes.length })
  doneListeners.forEach(l => l(task.jobId))
  task.onStored?.(file.id)
  playSound('notify-upload-done') // with the finished row in the Files list
}

/** Best effort: the file is already safely stored when this runs. */
async function attachPreview(fileId: string, name: string, bytes: Uint8Array): Promise<void> {
  try {
    const blob = await makePreview(name, bytes)
    if (!blob) return
    const { data: path, error } = await supabase.rpc('set_job_file_preview', { p_file: fileId })
    if (error) throw error
    const { error: upErr } = await supabase.storage.from('job-files')
      .upload(path as string, blob, { contentType: 'image/png', upsert: false })
    if (upErr) throw upErr
    await supabase.rpc('confirm_job_file_preview', { p_file: fileId })
  } catch (e) {
    console.warn('[wivo] preview not stored:', e)
  }
}

function failureText(e: unknown): string {
  if (e instanceof CleanError) return t('files.couldNotClean')
  if (e instanceof ZipLimitError) return e.reason === 'size' ? t('files.folderTooBig') : t('files.folderTooMany')
  return (e as Error).message ?? String(e)
}

async function pump(): Promise<void> {
  if (running) return
  running = true
  try {
    for (let next = tasks.find(t => t.status === 'queued'); next; next = tasks.find(t => t.status === 'queued')) {
      try {
        await runOne(next)
      } catch (e) {
        patch(next.id, { status: 'failed', error: failureText(e) })
        playSound('notify-error') // with the red "Failed" row and its message
      }
    }
  } finally {
    running = false
  }
}

export function enqueueUpload(
  jobId: string, file: File, type: JobFileType, supersedes: string | null = null,
  onStored?: (fileId: string) => void,
): void {
  tasks.push({
    id: crypto.randomUUID(), jobId, type, name: file.name, size: file.size, sent: 0,
    status: 'queued', supersedes, file, onStored,
  })
  emit()
  void pump()
}

/** A folder becomes one ZIP (built in a worker), then goes the usual way. */
export function enqueueFolderUpload(
  jobId: string, files: File[], type: JobFileType, onStored?: (fileId: string) => void,
): void {
  if (files.length === 0) return
  tasks.push({
    id: crypto.randomUUID(), jobId, type, name: `${folderName(files)}.zip`,
    size: files.reduce((n, f) => n + f.size, 0), sent: 0,
    status: 'queued', supersedes: null, file: files[0], folder: files, onStored,
  })
  emit()
  void pump()
}

export function retryUpload(id: string): void {
  patch(id, { status: 'queued', error: undefined })
  void pump()
}

export function dismissUpload(id: string): void {
  tasks = tasks.filter(t => t.id !== id)
  emit()
}

/** This job's uploads that are still in progress or need attention. */
export function useJobUploads(jobId: string): UploadTask[] {
  const all = useSyncExternalStore(subscribe, snapshot, snapshot)
  return all.filter(t => t.jobId === jobId && t.status !== 'done')
}
