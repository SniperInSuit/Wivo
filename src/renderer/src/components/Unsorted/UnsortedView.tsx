/**
 * "Unsorted": files the scanner software wrote into the watched folder that
 * nobody has put on a job yet (spec, Phase 1 Files: "scanner export folder →
 * Unsorted → attached to a job").
 *
 * Attaching reads the file through the main process (which only reads inside
 * the chosen folder) and hands it to the same upload queue as everything else,
 * so it is cleaned, hashed, named after the job code and uploaded resumably.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { FolderOpen, Inbox, Link2, EyeOff } from 'lucide-react'
import { useJobs } from '../../hooks/useJobs'
import type { Job } from '../../types/job'
import { enqueueUpload } from '../../lib/uploadQueue'
import { guessFileType, type JobFileType } from '../../lib/fileClean'
import { fileTypeLabel } from '../Files/JobFiles'
import { describeError } from '../Patients/errors'
import { t, dateLocale } from '@/lib/i18n'

type Watched = { path: string; name: string; size: number; modifiedAt: number; key: string }

const TYPES: JobFileType[] = ['scan', 'photo', 'xray', 'print', 'design', 'other']

export function UnsortedView() {
  const bridge = window.wivo?.watchFolder
  const [folder, setFolder] = useState<string | null>(null)
  const [files, setFiles] = useState<Watched[]>([])
  const [error, setError] = useState<string | null>(null)
  // Once here, not per row: every useJobs() mount opens its own realtime channel.
  const { data: jobs = [] } = useJobs()

  const refresh = useCallback(async () => {
    if (!bridge) return
    setFolder(await bridge.get())
    setFiles(await bridge.list())
  }, [bridge])

  useEffect(() => {
    void refresh()
    return bridge?.onChanged(() => void refresh())
  }, [bridge, refresh])

  if (!bridge) return <p className="p-6 text-sm text-ink-muted">{t('unsorted.desktopOnly')}</p>

  return (
    <div className="h-full overflow-y-auto p-5 space-y-4">
      <div className="flex items-center gap-3">
        <Inbox size={18} className="text-accent" aria-hidden="true" />
        <h2 className="text-base font-semibold text-ink">{t('unsorted.unsorted')}</h2>
        <span className="ml-auto text-xs text-ink-muted truncate max-w-[40%]">{folder ?? t('unsorted.noFolder')}</span>
        <button type="button" onClick={async () => { await bridge.choose(); await refresh() }}
          className="btn-ghost text-xs border border-ink-faint/30 flex items-center gap-1">
          <FolderOpen size={12} aria-hidden="true" /> {folder ? t('unsorted.changeFolder') : t('unsorted.chooseFolder')}
        </button>
      </div>
      <p className="text-xs text-ink-muted max-w-2xl">{t('unsorted.intro')}</p>
      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}

      {folder && files.length === 0 && <p className="text-sm text-ink-muted">{t('unsorted.nothingWaiting')}</p>}
      <ul className="space-y-2">
        {files.map(f => (
          <UnsortedRow key={f.key} file={f} jobs={jobs} onError={setError}
            onDone={async jobId => { await bridge.handled(f.key, jobId); await refresh() }} />
        ))}
      </ul>
    </div>
  )
}

function UnsortedRow({ file, jobs, onDone, onError }: {
  file: Watched
  jobs: Job[]
  onDone: (jobId: string | null) => Promise<void>
  onError: (e: string | null) => void
}) {
  const [type, setType] = useState<JobFileType>(guessFileType(file.name))
  const [query, setQuery] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return jobs.filter(j => (j.job_code ?? '').toLowerCase().includes(q) || (j.patsient ?? '').toLowerCase().includes(q)).slice(0, 6)
  }, [jobs, query])
  const chosen = jobs.find(j => j.id === jobId)

  async function attach() {
    if (!jobId) return
    setBusy(true)
    onError(null)
    try {
      const bytes = await window.wivo!.watchFolder!.read(file.path)
      enqueueUpload(jobId, new File([new Uint8Array(bytes)], file.name), type)
      await onDone(jobId)
    } catch (e) {
      onError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="card p-3 space-y-2">
      <div className="flex items-center gap-3 text-sm">
        <span className="font-mono text-ink truncate">{file.name}</span>
        <span className="text-xs text-ink-muted">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
        <span className="text-xs text-ink-muted">{format(new Date(file.modifiedAt), 'd MMM HH:mm', { locale: dateLocale })}</span>
        <button type="button" onClick={() => void onDone(null)} title={t('unsorted.dismiss')}
          className="ml-auto text-ink-muted hover:text-ink flex items-center gap-1 text-xs">
          <EyeOff size={12} aria-hidden="true" /> {t('unsorted.dismiss')}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={type} onChange={e => setType(e.target.value as JobFileType)} aria-label={t('files.fileType')} className="input w-36 text-xs py-1">
          {TYPES.map(ty => <option key={ty} value={ty}>{fileTypeLabel(ty)}</option>)}
        </select>
        {chosen ? (
          <span className="text-sm text-ink">{chosen.job_code ?? ''} · {chosen.patsient}
            <button type="button" className="ml-2 text-xs text-ink-muted" onClick={() => setJobId(null)}>{t('unsorted.change')}</button>
          </span>
        ) : (
          <div className="relative">
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('unsorted.findJob')}
              aria-label={t('unsorted.findJob')} className="input w-64 text-xs py-1" />
            {matches.length > 0 && (
              <ul className="absolute z-10 mt-1 w-80 rounded-lg bg-bg-card shadow-panel border border-ink-faint/20">
                {matches.map(j => (
                  <li key={j.id}>
                    <button type="button" onClick={() => { setJobId(j.id); setQuery('') }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-bg-sidebar">
                      <span className="font-mono">{j.job_code ?? '—'}</span> · {j.patsient} · {j.too ?? ''}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <button type="button" onClick={attach} disabled={!jobId || busy}
          className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50">
          <Link2 size={12} aria-hidden="true" /> {t('unsorted.attach')}
        </button>
      </div>
    </li>
  )
}
