import { useState, useMemo } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown, Search, Edit2, Check, Trash2, X as XIcon, Eye, Euro, Zap } from 'lucide-react'
import {
  format, isPast, parseISO,
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, isWithinInterval
} from 'date-fns'
import type { Job, StageKey } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'
import { StatusPill } from '../ui/StatusPill'
import { ShadeChip } from '../ui/ShadeChip'

type SortKey = keyof Job | null
type SortDir = 'asc' | 'desc'
type PeriodFilter = 'all' | 'week' | 'month' | 'last_month'

const PERIOD_OPTIONS: { key: PeriodFilter; label: string }[] = [
  { key: 'all',        label: 'Kõik kuupäevad' },
  { key: 'week',       label: 'See nädal' },
  { key: 'month',      label: 'See kuu' },
  { key: 'last_month', label: 'Eelmine kuu' },
]

interface TableViewProps {
  jobs: Job[]
  onJobClick: (job: Job) => void
  onJobEye?: (job: Job) => void
  onBulkStatusChange?: (ids: string[], status: StageKey) => Promise<void>
  onBulkMarkPaid?: (ids: string[]) => Promise<void>
  onBulkDelete?: (ids: string[]) => Promise<void>
}

function DeadlineCell({ valmis_aeg }: { valmis_aeg: string | null }) {
  if (!valmis_aeg) return <span className="text-ink-faint">—</span>
  const date = parseISO(valmis_aeg)
  const overdue = isPast(date)
  return (
    <span className={`text-xs font-medium ${overdue ? 'text-red-600' : 'text-ink-soft'}`}>
      {format(date, 'dd.MM.yy HH:mm')}
    </span>
  )
}

function SortIcon({ field, sortKey, sortDir }: { field: string; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== field) return <ChevronsUpDown size={12} className="text-ink-faint ml-1 inline" />
  return sortDir === 'asc'
    ? <ChevronUp size={12} className="text-accent ml-1 inline" />
    : <ChevronDown size={12} className="text-accent ml-1 inline" />
}

export function TableView({ jobs, onJobClick, onJobEye, onBulkStatusChange, onBulkMarkPaid, onBulkDelete }: TableViewProps) {
  const { stages, doneStageKey } = usePipeline()
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<StageKey | 'all'>('all')
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('kuupaev')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkWorking, setBulkWorking] = useState(false)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    let result = [...jobs]
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(j =>
        j.patsient.toLowerCase().includes(q) ||
        (j.too ?? '').toLowerCase().includes(q) ||
        (j.hambad ?? '').toLowerCase().includes(q)
      )
    }
    if (stageFilter !== 'all') result = result.filter(j => j.status === stageFilter)
    if (periodFilter !== 'all') {
      const now = new Date()
      let start: Date, end: Date
      if (periodFilter === 'week') {
        start = startOfWeek(now, { weekStartsOn: 1 })
        end   = endOfWeek(now,   { weekStartsOn: 1 })
      } else if (periodFilter === 'month') {
        start = startOfMonth(now)
        end   = endOfMonth(now)
      } else {
        const prev = subMonths(now, 1)
        start = startOfMonth(prev)
        end   = endOfMonth(prev)
      }
      result = result.filter(j =>
        j.kuupaev && isWithinInterval(parseISO(j.kuupaev), { start, end })
      )
    }
    if (sortKey) {
      result.sort((a, b) => {
        let av = a[sortKey] ?? ''
        let bv = b[sortKey] ?? ''
        if (sortKey === 'status') {
          av = stages.findIndex(s => s.key === a.status)
          bv = stages.findIndex(s => s.key === b.status)
        }
        if (sortKey === 'hind') { av = a.hind ?? 0; bv = b.hind ?? 0 }
        const cmp = av < bv ? -1 : av > bv ? 1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return result
  }, [jobs, search, stageFilter, periodFilter, sortKey, sortDir, stages])

  const allFilteredSelected = filtered.length > 0 && filtered.every(j => selected.has(j.id))
  const someSelected = filtered.some(j => selected.has(j.id)) && !allFilteredSelected

  function toggleSelectAll() {
    if (allFilteredSelected) {
      // deselect all filtered
      setSelected(prev => {
        const next = new Set(prev)
        filtered.forEach(j => next.delete(j.id))
        return next
      })
    } else {
      // select all filtered
      setSelected(prev => {
        const next = new Set(prev)
        filtered.forEach(j => next.add(j.id))
        return next
      })
    }
  }

  function toggleRow(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    setBulkDeleteConfirm(false)
  }

  async function handleBulkStatus(status: StageKey) {
    if (!onBulkStatusChange || selected.size === 0) return
    setBulkWorking(true)
    try {
      await onBulkStatusChange([...selected], status)
      setSelected(new Set())
    } finally {
      setBulkWorking(false)
    }
  }

  async function handleBulkDelete() {
    if (!onBulkDelete || selected.size === 0) return
    setBulkWorking(true)
    try {
      await onBulkDelete([...selected])
      setSelected(new Set())
      setBulkDeleteConfirm(false)
    } finally {
      setBulkWorking(false)
    }
  }

  async function handleBulkMarkPaid() {
    if (!onBulkMarkPaid || selected.size === 0) return
    setBulkWorking(true)
    try {
      await onBulkMarkPaid([...selected])
      setSelected(new Set())
    } finally {
      setBulkWorking(false)
    }
  }

  function Th({ label, field, className = '' }: { label: string; field: SortKey; className?: string }) {
    return (
      <th
        onClick={() => toggleSort(field)}
        className={`px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wide cursor-pointer select-none whitespace-nowrap hover:text-ink transition-colors ${className}`}
      >
        {label}
        <SortIcon field={field as string} sortKey={sortKey} sortDir={sortDir} />
      </th>
    )
  }

  const toothCount = (h: string | null) => h ? h.split(',').filter(Boolean).length : 0
  const selectedIds = selected

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-ink-faint/15 bg-bg-card flex-shrink-0">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            type="text"
            placeholder="Otsi patsienti, tööd…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input pl-8 py-1.5 text-sm"
          />
        </div>

        {/* Stage filter pills */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setStageFilter('all')}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
              stageFilter === 'all' ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink bg-bg-sidebar'
            }`}
          >
            Kõik ({jobs.length})
          </button>
          {stages.map(s => {
            const count = jobs.filter(j => j.status === s.key).length
            if (count === 0) return null
            return (
              <button
                key={s.key}
                onClick={() => setStageFilter(s.key)}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                  stageFilter === s.key
                    ? `${s.bg} ${s.color}`
                    : 'text-ink-muted hover:text-ink bg-bg-sidebar'
                }`}
              >
                {s.label} ({count})
              </button>
            )
          })}
        </div>

        <span className="text-ink-faint/30 text-sm select-none">|</span>

        {/* Period filter pills */}
        <div className="flex items-center gap-1">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setPeriodFilter(opt.key)}
              className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                periodFilter === opt.key
                  ? 'bg-ink text-bg-card'
                  : 'text-ink-muted hover:text-ink bg-bg-sidebar'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-5 py-2.5 bg-accent/[0.06] border-b border-accent/20 flex-shrink-0">
          <span className="text-sm font-semibold text-accent whitespace-nowrap">
            {selected.size} valitud
          </span>
          <span className="text-ink-faint/40">|</span>
          <span className="text-xs text-ink-muted whitespace-nowrap">Muuda staatust:</span>
          <div className="flex gap-1 flex-wrap">
            {stages.map(s => (
              <button
                key={s.key}
                disabled={bulkWorking}
                onClick={() => handleBulkStatus(s.key as StageKey)}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium border transition-all duration-100 disabled:opacity-50 ${s.bg} ${s.color} border-transparent hover:opacity-80`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {onBulkMarkPaid && (
              <button
                disabled={bulkWorking}
                onClick={handleBulkMarkPaid}
                className="flex items-center gap-1 text-xs text-green-700 bg-green-100 hover:bg-green-200 px-2.5 py-1 rounded-lg font-semibold transition-colors disabled:opacity-50"
              >
                <Euro size={11} /> Makstud
              </button>
            )}
            {onBulkDelete && (
              bulkDeleteConfirm ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-red-600 font-medium">Kustutada {selected.size}?</span>
                  <button
                    disabled={bulkWorking}
                    onClick={handleBulkDelete}
                    className="text-xs bg-red-500 text-white px-2 py-1 rounded-lg hover:bg-red-600 disabled:opacity-50"
                  >
                    Jah
                  </button>
                  <button
                    onClick={() => setBulkDeleteConfirm(false)}
                    className="text-xs text-ink-muted hover:text-ink px-2 py-1 rounded-lg"
                  >
                    Ei
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setBulkDeleteConfirm(true)}
                  className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 transition-colors"
                >
                  <Trash2 size={12} /> Kustuta
                </button>
              )
            )}
            <button
              onClick={() => { setSelected(new Set()); setBulkDeleteConfirm(false) }}
              className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink transition-colors"
            >
              <XIcon size={12} /> Tühista
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-bg-card z-10 shadow-[0_1px_0_0_rgba(14,17,22,0.08)]">
            <tr>
              {/* Select-all checkbox */}
              <th className="w-10 px-3 py-3 pl-4" onClick={e => e.stopPropagation()}>
                <div
                  onClick={toggleSelectAll}
                  className={`w-4 h-4 rounded border-2 flex items-center justify-center cursor-pointer transition-colors ${
                    allFilteredSelected
                      ? 'bg-accent border-accent'
                      : someSelected
                        ? 'bg-accent/40 border-accent'
                        : 'border-ink-faint hover:border-accent/60'
                  }`}
                >
                  {allFilteredSelected && <Check size={10} className="text-white" />}
                  {someSelected && <div className="w-2 h-0.5 bg-accent" />}
                </div>
              </th>
              {/* Eye column — opens bottom sheet */}
              <th className="w-8 px-1 py-3" />
              <Th label="Staatus"    field="status" />
              <Th label="Kuupäev"   field="kuupaev" />
              <Th label="Patsient"  field="patsient" />
              <Th label="Töö"       field="too" />
              <Th label="Materjal"  field="materjal" />
              <th className="px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wide whitespace-nowrap">
                Print ID
              </th>
              <Th label="Värv"      field="varv" />
              <th className="px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wide whitespace-nowrap">
                Hambad
              </th>
              <Th label="Tähtaeg"   field="valmis_aeg" />
              <Th label="Hind"      field="hind" />
              <th className="px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wide">
                Makstud
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wide min-w-[200px]">
                Muudatused
              </th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={15} className="text-center py-16 text-ink-faint text-sm">
                  {search || stageFilter !== 'all' ? 'Tulemusi ei leitud' : 'Töid pole veel lisatud'}
                </td>
              </tr>
            )}
            {filtered.map((job, idx) => {
              const isSelected = selectedIds.has(job.id)
              const overdue = job.valmis_aeg && isPast(parseISO(job.valmis_aeg)) && job.status !== doneStageKey
              return (
                <tr
                  key={job.id}
                  onClick={() => onJobClick(job)}
                  className={`border-b border-ink-faint/10 cursor-pointer transition-colors duration-100 group
                    ${job.kiirtoo ? 'border-l-2 border-l-orange-400' : 'border-l-2 border-l-transparent'}
                    ${isSelected
                      ? 'bg-accent/[0.07]'
                      : idx % 2 === 0 ? 'bg-bg-card' : 'bg-bg/50'
                    }
                    hover:bg-accent-light`}
                >
                  {/* Checkbox */}
                  <td className="px-3 py-3 w-10" onClick={e => toggleRow(job.id, e)}>
                    <div
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-accent border-accent'
                          : 'border-ink-faint group-hover:border-accent/50'
                      }`}
                    >
                      {isSelected && <Check size={10} className="text-white" />}
                    </div>
                  </td>

                  {/* Eye — opens bottom sheet */}
                  <td className="px-1 py-3 w-8" onClick={e => { e.stopPropagation(); onJobEye?.(job) }}>
                    <Eye
                      size={14}
                      className="text-ink-faint/50 group-hover:text-accent cursor-pointer transition-colors"
                    />
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <StatusPill status={job.status} />
                  </td>

                  {/* Kuupäev */}
                  <td className="px-4 py-3 text-xs text-ink-muted whitespace-nowrap">
                    {job.kuupaev ? format(parseISO(job.kuupaev), 'dd.MM.yy') : '—'}
                  </td>

                  {/* Patsient */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm text-ink">{job.patsient}</span>
                      {job.kiirtoo && <Zap size={12} className="text-orange-500 flex-shrink-0" title="Kiirtöö" />}
                    </div>
                  </td>

                  {/* Töö */}
                  <td className="px-4 py-3 text-sm text-ink-soft max-w-[160px]">
                    <span className="truncate block">{job.too ?? '—'}</span>
                  </td>

                  {/* Materjal */}
                  <td className="px-4 py-3 text-xs text-ink-muted whitespace-nowrap">
                    {job.materjal ?? '—'}
                  </td>

                  {/* Print ID */}
                  <td className="px-4 py-3 text-xs font-mono text-ink-soft whitespace-nowrap">
                    {job.print_id ?? <span className="text-ink-faint">—</span>}
                  </td>

                  {/* Värv */}
                  <td className="px-4 py-3">
                    {job.varv ? <ShadeChip shade={job.varv} /> : <span className="text-ink-faint text-xs">—</span>}
                  </td>

                  {/* Hambad */}
                  <td className="px-4 py-3 text-xs font-mono whitespace-nowrap">
                    {job.hambad ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="bg-accent/15 text-accent font-bold px-1.5 py-0.5 rounded text-[11px] flex-shrink-0">
                          {toothCount(job.hambad)}
                        </span>
                        <span className="text-ink-faint">
                          {job.hambad.length > 20 ? job.hambad.slice(0, 20) + '…' : job.hambad}
                        </span>
                      </span>
                    ) : <span className="text-ink-faint">—</span>}
                  </td>

                  {/* Tähtaeg */}
                  <td className={`px-4 py-3 whitespace-nowrap ${overdue ? 'text-red-600' : ''}`}>
                    <DeadlineCell valmis_aeg={job.valmis_aeg} />
                  </td>

                  {/* Hind */}
                  <td className="px-4 py-3 text-sm font-medium text-ink-soft whitespace-nowrap">
                    {job.hind != null ? `${job.hind.toFixed(2)} €` : <span className="text-ink-faint">—</span>}
                  </td>

                  {/* Makstud */}
                  <td className="px-4 py-3">
                    {job.makstud ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full font-medium">
                        <Check size={10} /> Jah
                      </span>
                    ) : (
                      job.hind ? (
                        <span className="text-xs text-red-500 font-medium">Ei</span>
                      ) : (
                        <span className="text-ink-faint text-xs">—</span>
                      )
                    )}
                  </td>

                  {/* Muudatused */}
                  <td className="px-4 py-3">
                    {(() => {
                      const revs = [...(job.revisions ?? [])]
                        .sort((a, b) => b.ts.localeCompare(a.ts))
                      if (revs.length === 0) return <span className="text-ink-faint text-xs">—</span>
                      const visible = revs.slice(0, 3)
                      const overflow = revs.length - visible.length
                      return (
                        <div className="flex flex-col gap-1">
                          {visible.map((rev, i) => {
                            const stageInfo = stages.find(s => s.key === (rev.status ?? 'disain'))
                            const note = rev.note.length > 22 ? rev.note.slice(0, 22) + '…' : rev.note
                            return (
                              <div key={rev.id} className="flex items-center gap-1 min-w-0">
                                <span className="text-[10px] text-ink-faint font-mono flex-shrink-0">
                                  #{revs.length - i}
                                </span>
                                {rev.hambad && (
                                  <span className="bg-accent/15 text-accent font-bold px-1 py-0.5 rounded text-[10px] flex-shrink-0 font-mono">
                                    {toothCount(rev.hambad)}
                                  </span>
                                )}
                                <span
                                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: stageInfo?.hex ?? '#94a3b8' }}
                                  title={stageInfo?.label ?? rev.status}
                                />
                                <span className="text-xs text-ink-soft truncate">{note}</span>
                                {rev.price != null && (
                                  <span className="text-[10px] text-accent font-semibold flex-shrink-0 ml-auto pl-1">
                                    {rev.price.toFixed(0)}€
                                  </span>
                                )}
                                {rev.kiirtoo && <Zap size={9} className="text-orange-400 flex-shrink-0" />}
                              </div>
                            )
                          })}
                          {overflow > 0 && (
                            <span className="text-[10px] text-ink-faint">+{overflow} veel</span>
                          )}
                        </div>
                      )
                    })()}
                  </td>

                  {/* Edit icon */}
                  <td className="px-2 py-3">
                    <Edit2 size={13} className="text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Footer count */}
        {filtered.length > 0 && (
          <div className="px-5 py-3 text-xs text-ink-faint border-t border-ink-faint/10">
            {filtered.length} töö{filtered.length !== 1 ? 'd' : ''}
            {stageFilter !== 'all' || search ? ` (filtreeritud ${jobs.length}-st)` : ''}
            {selected.size > 0 && ` · ${selected.size} valitud`}
          </div>
        )}
      </div>
    </div>
  )
}
