/**
 * A job's files, for both sides of a shared job (spec, Phase 1 Files).
 *
 * Lists through `job_files`, downloads through `request_file_download` (which
 * writes the audit row and the two-minute grant Storage requires), uploads
 * through the background queue. A partner may add only print and design files
 * and never delete — the same rule the database enforces; the screen only
 * avoids offering what would be refused.
 */
import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Upload, Trash2, RotateCw, X, History, Paperclip } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { guessFileType, type JobFileType } from '../../lib/fileClean'
import { enqueueUpload, retryUpload, dismissUpload, useJobUploads, onUploadDone } from '../../lib/uploadQueue'
import { saveFile } from '../../lib/fileLink'
import { viewKind, viewerFor } from '../../lib/fileViewer'
import { FileViewer, type ViewerFile } from './FileViewer'
import { describeError } from '../Patients/errors'
import { t, dateLocale } from '@/lib/i18n'

interface JobFileRow {
  id: string
  type: JobFileType
  version: number
  is_active: boolean
  file_name: string
  size: number
  uploaded_at: string
  uploaded_by_name: string | null
  uploaded_by_org_name: string | null
  supersedes: string | null
  completed: boolean
}

const ALL_TYPES: JobFileType[] = ['scan', 'photo', 'xray', 'print', 'design', 'other']
const PARTNER_TYPES: JobFileType[] = ['print', 'design']

export const fileTypeLabel = (type: JobFileType): string => ({
  scan: t('files.typeScan'), photo: t('files.typePhoto'), xray: t('files.typeXray'),
  print: t('files.typePrint'), design: t('files.typeDesign'), other: t('files.typeOther'),
})[type]

const sizeText = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

export function JobFiles({ jobId, partner = false }: { jobId: string; partner?: boolean }) {
  const qc = useQueryClient()
  const { data: files = [], error } = useQuery<JobFileRow[]>({
    queryKey: ['job_files', jobId],
    queryFn: async () => {
      const { data, error: err } = await supabase.rpc('job_files', { p_job: jobId })
      if (err) {
        if (err.code === 'PGRST202' || err.code === '42883') return [] // sql/072 not applied yet
        throw err
      }
      return (data ?? []) as JobFileRow[]
    },
  })
  const uploads = useJobUploads(jobId)
  // One request per job opened: grants for every ready preview, one audit row.
  const { data: previews } = useQuery<Map<string, string>>({
    queryKey: ['job_previews', jobId, files.filter(f => f.completed).length],
    enabled: files.length > 0,
    staleTime: 4 * 60_000,
    queryFn: async () => {
      const { data, error: err } = await supabase.rpc('request_job_previews', { p_job: jobId })
      if (err || !data?.length) return new Map()
      const rows = data as { file_id: string; preview_path: string }[]
      const { data: links } = await supabase.storage.from('job-files').createSignedUrls(rows.map(r => r.preview_path), 300)
      return new Map(rows.map((r, i) => [r.file_id, links?.[i]?.signedUrl ?? ''] as [string, string]).filter(([, u]) => u))
    },
  })
  const types = partner ? PARTNER_TYPES : ALL_TYPES
  const [type, setType] = useState<JobFileType | 'auto'>('auto')
  const [actionError, setActionError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const versionOf = useRef<string | null>(null)

  useEffect(() => onUploadDone(done => {
    qc.invalidateQueries({ queryKey: ['job_files', done] })
    qc.invalidateQueries({ queryKey: ['job_previews', done] })
  }), [qc])

  function add(list: FileList | null) {
    if (!list) return
    const supersedes = versionOf.current
    for (const f of Array.from(list)) {
      const prev = supersedes ? files.find(x => x.id === supersedes) : null
      const chosen = prev?.type ?? (type === 'auto' ? guessFileType(f.name) : type)
      enqueueUpload(jobId, f, types.includes(chosen) ? chosen : types[0], supersedes)
    }
    versionOf.current = null
  }

  // Click an image or a PDF: it opens large. Images move between the job's images.
  const [viewing, setViewing] = useState<{ files: ViewerFile[]; start: number } | null>(null)
  const view = (f: JobFileRow) => setViewing(viewerFor(f, files))

  async function download(f: ViewerFile) {
    setActionError(null)
    try {
      await saveFile(f.id, f.file_name)
    } catch (e) {
      setActionError(describeError(e))
    }
  }

  async function remove(f: JobFileRow) {
    if (!window.confirm(t('files.deleteConfirm', { name: f.file_name }))) return
    const { error: err } = await supabase.rpc('delete_job_file', { p_file: f.id })
    if (err) setActionError(describeError(err))
    else qc.invalidateQueries({ queryKey: ['job_files', jobId] })
  }

  const active = files.filter(f => f.is_active && f.completed)
  const older = files.filter(f => !f.is_active && f.completed)

  return (
    <section className="space-y-3"
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); versionOf.current = null; add(e.dataTransfer.files) }}>
      <div className="flex items-center gap-2">
        <Paperclip size={13} className="text-ink-muted" aria-hidden="true" />
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">{t('files.files')}</h3>
        <select value={type} onChange={e => setType(e.target.value as JobFileType | 'auto')}
          aria-label={t('files.fileType')} className="input ml-auto w-36 text-xs py-1">
          {!partner && <option value="auto">{t('files.typeAuto')}</option>}
          {types.map(ty => <option key={ty} value={ty}>{fileTypeLabel(ty)}</option>)}
        </select>
        <button type="button" onClick={() => { versionOf.current = null; input.current?.click() }}
          className="btn-ghost text-xs border border-ink-faint/30 flex items-center gap-1">
          <Upload size={12} aria-hidden="true" /> {t('files.addFiles')}
        </button>
        <input ref={input} type="file" multiple hidden onChange={e => { add(e.target.files); e.target.value = '' }} />
      </div>
      <p className="text-[11px] text-ink-muted">{t('files.cleaningNote')}</p>

      {error && <p role="alert" className="text-sm text-rose-500">{describeError(error)}</p>}
      {actionError && <p role="alert" className="text-sm text-rose-500">{actionError}</p>}

      {uploads.map(u => (
        <div key={u.id} className="rounded-lg bg-bg-sidebar px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="truncate text-ink">{u.name}</span>
            <span className="text-ink-muted">{fileTypeLabel(u.type)}</span>
            <span className="ml-auto text-ink-muted">
              {u.status === 'failed' ? t('files.failed') : u.status === 'queued' ? t('files.waiting')
                : u.status === 'preparing' ? t('files.preparing') : `${Math.round((u.sent / Math.max(u.size, 1)) * 100)} %`}
            </span>
            {u.status === 'failed' && (
              <button type="button" onClick={() => retryUpload(u.id)} title={t('files.retry')} aria-label={t('files.retry')}>
                <RotateCw size={12} />
              </button>
            )}
            {(u.status === 'failed' || u.status === 'queued') && (
              <button type="button" onClick={() => dismissUpload(u.id)} title={t('files.cancel')} aria-label={t('files.cancel')}>
                <X size={12} />
              </button>
            )}
          </div>
          <div className="mt-1 h-1 rounded bg-ink-faint/20">
            <div className="h-1 rounded bg-accent transition-all" style={{ width: `${Math.round((u.sent / Math.max(u.size, 1)) * 100)}%` }} />
          </div>
          {u.error && <p className="mt-1 text-rose-500">{u.error}</p>}
        </div>
      ))}

      {active.length === 0 && uploads.length === 0
        ? <p className="text-sm text-ink-muted">{t('files.noFilesYet')}</p>
        : (
          <ul className="space-y-1">
            {active.map(f => (
              <FileRow key={f.id} f={f} preview={previews?.get(f.id)} history={older.filter(o => chainOf(o, files).includes(f.id))}
                canDelete={!partner} canVersion={types.includes(f.type)}
                onDownload={download} onDelete={remove} onView={view}
                onVersion={() => { versionOf.current = f.id; input.current?.click() }} />
            ))}
          </ul>
        )}
      {viewing && (
        <FileViewer files={viewing.files} start={viewing.start} onClose={() => setViewing(null)} onDownload={download} />
      )}
    </section>
  )
}

/** Ids of the newer versions that replaced `f`, following `supersedes`. */
function chainOf(f: JobFileRow, all: JobFileRow[]): string[] {
  const out: string[] = []
  let cur = all.find(x => x.supersedes === f.id)
  while (cur) { out.push(cur.id); const id = cur.id; cur = all.find(x => x.supersedes === id) }
  return out
}

function FileRow({ f, preview, history, canDelete, canVersion, onDownload, onDelete, onVersion, onView }: {
  f: JobFileRow
  preview?: string
  history: JobFileRow[]
  canDelete: boolean
  canVersion: boolean
  onDownload: (f: JobFileRow) => void
  onDelete: (f: JobFileRow) => void
  onVersion: () => void
  onView: (f: JobFileRow) => void
}) {
  const viewable = viewKind(f.file_name) !== null
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-lg border border-ink-faint/15 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        {viewable ? (
          <button type="button" onClick={() => onView(f)} title={t('files.open')}
            className="flex min-w-0 items-center gap-2 text-left hover:text-accent">
            {preview && <img src={preview} alt="" className="h-10 w-10 rounded object-contain bg-bg-sidebar flex-shrink-0" />}
            <span className="font-mono text-ink truncate underline-offset-2 hover:underline">{f.file_name}</span>
          </button>
        ) : (
          <>
            {preview && <img src={preview} alt="" className="h-10 w-10 rounded object-contain bg-bg-sidebar flex-shrink-0" />}
            <span className="font-mono text-ink truncate">{f.file_name}</span>
          </>
        )}
        <span className="rounded bg-bg-sidebar px-1.5 py-0.5 text-ink-soft">{fileTypeLabel(f.type)}</span>
        <span className="text-ink-muted">{sizeText(f.size)}</span>
        <span className="ml-auto flex items-center gap-2 text-ink-muted">
          {history.length > 0 && (
            <button type="button" onClick={() => setOpen(o => !o)} title={t('files.olderVersions')} aria-label={t('files.olderVersions')}>
              <History size={12} />
            </button>
          )}
          {canVersion && (
            <button type="button" onClick={onVersion} className="hover:text-ink">{t('files.newVersion')}</button>
          )}
          <button type="button" onClick={() => onDownload(f)} title={t('files.download')} aria-label={t('files.download')} className="hover:text-ink">
            <Download size={12} />
          </button>
          {canDelete && (
            <button type="button" onClick={() => onDelete(f)} title={t('files.delete')} aria-label={t('files.delete')} className="hover:text-rose-500">
              <Trash2 size={12} />
            </button>
          )}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-ink-muted">
        {t('files.uploadedBy', {
          who: [f.uploaded_by_name, f.uploaded_by_org_name].filter(Boolean).join(' · ') || '—',
          when: format(new Date(f.uploaded_at), 'd MMM yyyy HH:mm', { locale: dateLocale }),
        })}
      </p>
      {open && history.map(h => (
        <div key={h.id} className="mt-1 flex items-center gap-2 text-ink-muted">
          {viewKind(h.file_name) ? (
            <button type="button" onClick={() => onView(h)} title={t('files.open')} className="font-mono hover:text-accent hover:underline">{h.file_name}</button>
          ) : (
            <span className="font-mono">{h.file_name}</span>
          )}
          <button type="button" onClick={() => onDownload(h)} aria-label={t('files.download')}><Download size={11} /></button>
        </div>
      ))}
    </li>
  )
}
