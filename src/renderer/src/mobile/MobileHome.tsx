/** Home: my jobs, all active jobs, jobs shared with us; search by code. */
import { useMemo, useState } from 'react'
import { format, isPast } from 'date-fns'
import { Search, Loader2 } from 'lucide-react'
import { useJobs } from '../hooks/useJobs'
import { usePartnerJobs } from '../hooks/usePartners'
import { useAuth } from '../context/AuthContext'
import { usePipeline } from '../context/PipelineContext'
import { StatusPill } from '../components/ui/StatusPill'
import { phoneLists, type PhoneJobItem } from './jobLists'
import { t, dateLocale } from '@/lib/i18n'

type Tab = 'mine' | 'active' | 'shared'

export function MobileHome({ onOpen }: { onOpen: (jobId: string) => void }) {
  const { user } = useAuth()
  const { doneStageKey } = usePipeline()
  const { data: jobs = [], isLoading } = useJobs()
  const { data: shared = [] } = usePartnerJobs('')
  const [query, setQuery] = useState('')
  const lists = useMemo(
    () => phoneLists({ jobs, shared, me: user?.id ?? '', doneStage: doneStageKey, query }),
    [jobs, shared, user?.id, doneStageKey, query],
  )
  // Start where the work is: my own jobs if I have any.
  const [tab, setTab] = useState<Tab | null>(null)
  const current: Tab = tab ?? (lists.mine.length > 0 || isLoading ? 'mine' : 'active')
  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: 'mine', label: t('mobile.mine'), n: lists.mine.length },
    { key: 'active', label: t('mobile.active'), n: lists.active.length },
    ...(shared.length > 0 ? [{ key: 'shared' as const, label: t('mobile.sharedWithUs'), n: lists.shared.length }] : []),
  ]
  const items = lists[current]

  return (
    <main className="space-y-3 p-3">
      <label className="flex items-center gap-2 rounded-xl border border-ink-faint/30 bg-bg-card px-3 py-2">
        <Search size={16} className="text-ink-muted" aria-hidden="true" />
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} inputMode="search"
          placeholder={t('mobile.searchByCode')} aria-label={t('mobile.searchByCode')}
          className="w-full bg-transparent text-base outline-none" />
      </label>

      <div role="tablist" className="flex gap-1 rounded-xl bg-bg-sidebar p-1">
        {tabs.map(tb => (
          <button key={tb.key} type="button" role="tab" aria-selected={current === tb.key} onClick={() => setTab(tb.key)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-sm font-medium ${current === tb.key ? 'bg-bg-card text-ink shadow-sm' : 'text-ink-muted'}`}>
            {tb.label} <span className="text-xs text-ink-muted">{tb.n}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid place-items-center py-10"><Loader2 className="animate-spin text-accent" /></div>
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-muted">{query ? t('mobile.nothingFound') : t('mobile.noJobs')}</p>
      ) : (
        <ul className="space-y-2">
          {items.map(i => <JobRow key={`${i.kind}:${i.id}`} item={i} onOpen={() => onOpen(i.id)} />)}
        </ul>
      )}
    </main>
  )
}

function JobRow({ item, onOpen }: { item: PhoneJobItem; onOpen: () => void }) {
  const { stageMap } = usePipeline()
  const due = item.due ? new Date(item.due) : null
  return (
    <li>
      <button type="button" onClick={onOpen} className="w-full rounded-xl border border-ink-faint/20 bg-bg-card px-3 py-2.5 text-left active:bg-bg-sidebar">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-ink-muted">{item.code ?? '—'}</span>
          <span className="ml-auto">
            {/* A shared job can sit in a stage only its owner has. */}
            {stageMap[item.stage] ? <StatusPill status={item.stage} /> : <span className="text-xs text-ink-soft">{item.stage}</span>}
          </span>
        </div>
        <div className="mt-0.5 truncate text-sm font-semibold">{item.title}</div>
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <span className="truncate">{item.work ?? '—'}</span>
          {due && (
            <span className={`ml-auto shrink-0 ${isPast(due) ? 'font-semibold text-rose-500' : ''}`}>
              {format(due, 'd MMM HH:mm', { locale: dateLocale })}
            </span>
          )}
        </div>
      </button>
    </li>
  )
}
