/**
 * Files upload in the background, one at a time, while the app stays usable
 * (spec, Phase 1 Files: "TUS upload in a background queue").
 *
 * Each file: read → clean (GPS off photos, identity off DICOM) → SHA-256 of
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
import { cleanForUpload, extensionOf, sha256Hex, type JobFileType } from './fileClean'
import { tusUpload } from './tusUpload'
import { makePreview } from './previews'

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
}

let tasks: UploadTask[] = []
const listeners = new Set<() => void>()
const emit = () => { tasks = [...tasks]; listeners.forEach(l => l()) }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const snapshot = () => tasks

/** Called with the job id whenever one of its uploads completes. */
let onDone: ((jobId: string) => void) | null = null
export function onUploadDone(fn: ((jobId: string) => void) | null): void { onDone = fn }

const patch = (id: string, p: Partial<UploadTask>) => {
  const t = tasks.find(x => x.id === id)
  if (t) { Object.assign(t, p); emit() }
}

let running = false

async function runOne(task: UploadTask): Promise<void> {
  patch(task.id, { status: 'preparing', error: undefined })
  const bytes = cleanForUpload(new Uint8Array(await task.file.arrayBuffer()))
  const sha = await sha256Hex(bytes)
  const { data: row, error } = await supabase.rpc('register_job_file', {
    p_job: task.jobId, p_type: task.type, p_sha256: sha, p_size: bytes.length,
    p_mime: task.file.type || null, p_extension: extensionOf(task.file.name), p_supersedes: task.supersedes ?? null,
  })
  if (error) throw error
  const file = row as { id: string; storage_path: string }

  patch(task.id, { status: 'uploading', size: bytes.length })
  await tusUpload(bytes, {
    endpoint: storageEndpoint(),
    headers: async () => {
      const { data } = await supabase.auth.getSession()
      return { authorization: `Bearer ${data.session?.access_token ?? ''}`, apikey: anonKey(), 'x-upsert': 'false' }
    },
    metadata: {
      bucketName: 'job-files',
      objectName: file.storage_path,
      contentType: task.file.type || 'application/octet-stream',
      cacheControl: '3600',
    },
    fingerprint: `${sha}:${file.id}`,
    store: localStorage,
    onProgress: sent => patch(task.id, { sent }),
  })

  const { error: confirmError } = await supabase.rpc('confirm_job_file', { p_file: file.id })
  if (confirmError) throw confirmError
  await attachPreview(file.id, task.file.name, bytes)
  patch(task.id, { status: 'done', sent: bytes.length })
  onDone?.(task.jobId)
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

async function pump(): Promise<void> {
  if (running) return
  running = true
  try {
    for (let next = tasks.find(t => t.status === 'queued'); next; next = tasks.find(t => t.status === 'queued')) {
      try {
        await runOne(next)
      } catch (e) {
        patch(next.id, { status: 'failed', error: (e as Error).message ?? String(e) })
      }
    }
  } finally {
    running = false
  }
}

export function enqueueUpload(jobId: string, file: File, type: JobFileType, supersedes: string | null = null): void {
  tasks.push({
    id: crypto.randomUUID(), jobId, type, name: file.name, size: file.size, sent: 0,
    status: 'queued', supersedes, file,
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
