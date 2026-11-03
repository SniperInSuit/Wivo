import { useRef, useState } from 'react'
import { Search, Loader2 } from 'lucide-react'
import { useJobSearch, searchJobs } from '../hooks/useJobSearch'
import { pickJobForSearch } from '../lib/jobSearch'
import { StatusPill } from './ui/StatusPill'
import type { Job } from '../types/job'
import { t } from '@/lib/i18n'

interface Notice {
  tone: 'error' | 'info'
  text: string
}

/**
 * The top bar's search box. Typing still filters the view behind it, as it
 * always did; below the box, the DATABASE's answer (lib/jobSearch) — the exact
 * code first — so a job outside the dates on screen is one click away. Enter
 * opens the exact code at once, or the only result; nothing found is said.
 */
export function JobSearchBox({ value, onChange, onOpenJob }: {
  value: string
  onChange: (v: string) => void
  onOpenJob: (job: Job) => void
}) {
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const { data: results = [], isFetching } = useJobSearch(value)
  const showList = open && value.trim().length >= 2 && results.length > 0 && !notice

  const openJob = (job: Job) => {
    setOpen(false); setNotice(null)
    onOpenJob(job)
  }

  async function submit() {
    if (!value.trim() || busy) return
    setBusy(true)
    try {
      // Asked afresh: the list below may still be the answer to fewer letters.
      const pick = pickJobForSearch(await searchJobs(value), value)
      if (!pick) return
      if (pick.kind === 'job') openJob(pick.job)
      else if (pick.kind === 'none') setNotice({ tone: 'error', text: t('topBar.noJobFound', { q: value.trim() }) })
      else setNotice({ tone: 'info', text: t('topBar.manyJobsFound', { count: pick.count }) })
    } catch {
      setNotice({ tone: 'error', text: t('topBar.searchFailed') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      ref={box}
      className="relative w-full max-w-sm"
      onBlur={e => { if (!box.current?.contains(e.relatedTarget as Node | null)) { setOpen(false); setNotice(null) } }}
    >
      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-nav" aria-hidden="true" />
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setNotice(null); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Enter') void submit()
          else if (e.key === 'Escape') { setOpen(false); setNotice(null) }
        }}
        placeholder={t('topBar.searchPatientsJobs')}
        aria-label={t('topBar.searchPatientsJobs')}
        aria-describedby={notice ? 'topbar-search-notice' : undefined}
        className="w-full pl-8 pr-8 px-3 py-1.5 text-sm bg-nav/10 border border-nav/20 rounded-lg text-nav placeholder:text-nav/60 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors duration-150"
      />
      {(busy || (isFetching && open)) && (
        <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-nav animate-spin" aria-hidden="true" />
      )}

      {notice && (
        <p
          id="topbar-search-notice"
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border px-3 py-2 text-xs shadow-lg ${
            notice.tone === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-bg-card border-ink-faint/30 text-ink-muted'
          }`}
        >
          {notice.text}
        </p>
      )}

      {showList && (
        <ul
          aria-label={t('topBar.searchResults')}
          className="absolute left-0 right-0 top-full mt-1 z-50 max-h-[60vh] overflow-y-auto rounded-lg border border-ink-faint/30 bg-bg-card shadow-lg py-1"
        >
          {results.map(job => (
            <li key={job.id}>
              <button
                type="button"
                onClick={() => openJob(job)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-bg-sidebar focus:bg-bg-sidebar focus:outline-none"
              >
                <span className="font-mono text-ink-muted w-[92px] flex-shrink-0 truncate">{job.job_code ?? '—'}</span>
                <span className="flex-1 min-w-0 truncate text-ink font-medium">{job.patsient || '—'}</span>
                <span className="truncate max-w-[90px] text-ink-muted">{job.too ?? ''}</span>
                <StatusPill status={job.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
