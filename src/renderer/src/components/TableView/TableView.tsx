import { useState, useMemo } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown, Search, Edit2, Check, Trash2, X as XIcon, Eye, Euro, Zap, CalendarDays, Shapes, Download, HandCoins, Wallet } from 'lucide-react'
import {
  format, isPast, parseISO,
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, isWithinInterval
} from 'date-fns'
import type { Job, StageKey } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'
import { useClinicProfiles } from '../../hooks/useClinicProfiles'
import { MarkPaidDialog, type PaidDetails } from '../JobDetail/MarkPaidDialog'
import { stageChipStyle } from '../../config/pipeline'
import { StatusPill } from '../ui/StatusPill'
import { ShadeChip } from '../ui/ShadeChip'
import { usePayments, useInvoices } from '../../hooks/useInvoices'
import { jobPaymentState } from '../../lib/jobPayments'
import { SelectMenu, MultiFilterMenu } from '../ui/FilterMenu'
import { useWorkTypes } from '../../stores/useSettings'
import { useCustomers } from '../../hooks/useCustomers'
import { exportCsv, jobColumns } from '../../lib/exports'
import { toDate, fmtDate } from '../../lib/dates'
import { jobTotalValue } from '../../lib/jobPayments'
import { debtors, type DebtorRow } from '../../lib/debtors'

type SortKey = keyof Job | null
type SortDir = 'asc' | 'desc'
type PeriodFilter = 'all' | 'week' | 'month' | 'last_month'

/**
 * The money filter. Four states, and each answers a question somebody actually
 * asks: what is still owed, who has half-paid, what is LATE, what is done.
 *
 * "Üle tähtaja" is deliberately narrower than "tasumata": it means a bill was
 * sent and its date has passed. Uninvoiced work is unpaid, but nobody was ever
 * asked for the money, so calling it late would be a false accusation — the
 * same line `lib/debtors.ts` draws.
 */
type PayFilter = 'all' | 'unpaid' | 'partial' | 'overdue' | 'settled'

const PAY_OPTIONS: { key: PayFilter; label: string }[] = [
  { key: 'all',      label: 'Kõik maksed' },
  { key: 'unpaid',   label: 'Tasumata' },
  { key: 'partial',  label: 'Osaliselt makstud' },
  { key: 'overdue',  label: 'Üle tähtaja' },
  { key: 'settled',  label: 'Makstud' },
]

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
  onBulkMarkPaid?: (ids: string[], details: PaidDetails) => Promise<void>
  onBulkDelete?: (ids: string[]) => Promise<void>
  onBulkAssign?: (ids: string[], patch: { assigned_to?: string | null; designed_by?: string | null }) => Promise<void>
  search: string
  onSearchChange: (v: string) => void
}

function DeadlineCell({ valmis_aeg }: { valmis_aeg: string | null }) {
  const date = toDate(valmis_aeg)
  if (!date) return <span className="text-ink-faint">—</span>
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

export function TableView({ jobs, onJobClick, onJobEye, onBulkStatusChange, onBulkMarkPaid, onBulkDelete, onBulkAssign, search, onSearchChange }: TableViewProps) {
  const { stages, doneStageKey } = usePipeline()
  const wt = useWorkTypes()
  const { data: workers = [] } = useClinicProfiles()
  const { data: customers = [] } = useCustomers()
  const { data: allPayments = [] } = usePayments()
  const { data: allInvoices = [] } = useInvoices()
  const [stageFilter, setStageFilter] = useState<StageKey | 'all'>('all')
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all')
  // Resolved type NAMES from Seaded, not the raw `too` strings. The raw field is
  // free text, so filtering on it listed "Allon4", "allon4 ülemine", "all-on5"
  // and "allonx ülemine" as four unrelated filters and picking one silently hid
  // the other three. Empty set means no filter.
  const [workTypeFilter, setWorkTypeFilter] = useState<Set<string>>(new Set())
  const [payFilter, setPayFilter] = useState<PayFilter>('all')
  // A debtor KEY from lib/debtors — 'klient:<id>' or 'patsient:<name>' — not a
  // name. Two patients can share a name; a key cannot collide with the other.
  const [debtorFilter, setDebtorFilter] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('valmis_aeg')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkWorking, setBulkWorking] = useState(false)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [paidDialog, setPaidDialog] = useState(false)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  /**
   * Who owes what, over EVERY job rather than the filtered set. The list in the
   * menu must not shrink as you use it: filtering to one debtor and then seeing
   * only that debtor offered is a menu you cannot get back out of.
   */
  const debt = useMemo(
    () => debtors({
      jobs, payments: allPayments, invoices: allInvoices,
      today: format(new Date(), 'yyyy-MM-dd'),
      customers,
    }),
    [jobs, allPayments, allInvoices, customers],
  )

  /** Job id → its debtor row, so a row can be filtered without recomputing. */
  const debtorOfJob = useMemo(() => {
    const m = new Map<string, DebtorRow>()
    for (const r of debt.rows) for (const id of r.jobIds) m.set(id, r)
    return m
  }, [debt])

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
    if (payFilter !== 'all') {
      result = result.filter(j => {
        const pay = jobPaymentState(j, allPayments, allInvoices)
        if (payFilter === 'settled') return pay.settled
        if (payFilter === 'partial') return pay.partial
        if (payFilter === 'unpaid')  return !pay.settled
        // 'overdue': unpaid AND on a bill whose date has passed. `debtorOfJob`
        // only holds jobs with money against them, so absence answers it.
        return (debtorOfJob.get(j.id)?.overdue ?? 0) > 0
      })
    }
    if (debtorFilter.size) result = result.filter(j => {
      const d = debtorOfJob.get(j.id)
      return !!d && debtorFilter.has(d.key)
    })
    if (workTypeFilter.size) result = result.filter(j => workTypeFilter.has(wt.resolve(j.too).nimi))
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
  }, [jobs, search, stageFilter, periodFilter, workTypeFilter, payFilter, debtorFilter,
      debtorOfJob, allPayments, allInvoices, sortKey, sortDir, stages, wt])

  // The work types actually on screen, grouped the way Seaded defines them, with
  // the row count and colour each one carries elsewhere in the app.
  const workTypeOptions = useMemo(() => {
    const byName = new Map<string, { hex: string; count: number }>()
    for (const j of jobs) {
      const t = wt.resolve(j.too)
      const seen = byName.get(t.nimi)
      if (seen) seen.count++
      else byName.set(t.nimi, { hex: t.hex, count: 1 })
    }
    const names = [...byName.keys()].sort((a, b) => a.localeCompare(b, 'et'))
    return {
      names,
      swatches: Object.fromEntries(names.map(n => [n, byName.get(n)!.hex])),
      counts:   Object.fromEntries(names.map(n => [n, byName.get(n)!.count])),
    }
  }, [jobs, wt])

  /**
   * The menu takes plain strings, and the debt rollup is keyed. This maps
   * between them, and the label carries the number so the menu itself is the
   * report: "Hambakliinik OÜ — 420 € · 12 p üle".
   */
  const debtorLabels = useMemo(() => {
    const names: string[] = []
    const keyOf: Record<string, string> = {}
    const counts: Record<string, number> = {}
    const swatches: Record<string, string> = {}
    for (const r of debt.rows) {
      const late = r.daysLate > 0 ? ` · ${r.daysLate} p üle` : r.partial ? ' · osaliselt' : ''
      const label = `${r.nimi} — ${r.outstanding.toFixed(2)} €${late}`
      names.push(label)
      keyOf[label] = r.key
      counts[label] = r.jobs
      // Red only when a bill was sent and its date passed; grey when we never
      // invoiced it at all. The colour is a claim, so it has to be earned.
      swatches[label] = r.overdue > 0 ? '#EF4444' : r.uninvoiced > 0 ? '#94A3B8' : '#F59E0B'
    }
    return { names, keyOf, counts, swatches }
  }, [debt])

  const debtorLabelSelection = useMemo(
    () => new Set(debtorLabels.names.filter(n => debtorFilter.has(debtorLabels.keyOf[n]))),
    [debtorLabels, debtorFilter],
  )

  const hasFilters = stageFilter !== 'all' || periodFilter !== 'all' || workTypeFilter.size > 0
    || payFilter !== 'all' || debtorFilter.size > 0 || !!search.trim()

  function clearFilters() {
    setStageFilter('all')
    setPeriodFilter('all')
    setWorkTypeFilter(new Set())
    setPayFilter('all')
    setDebtorFilter(new Set())
    onSearchChange('')
  }

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

  async function handleBulkAssign(field: 'assigned_to' | 'designed_by', value: string | null) {
    if (!onBulkAssign || selected.size === 0) return
    setBulkWorking(true)
    try {
      await onBulkAssign([...selected], { [field]: value })
      setSelected(new Set())
    } finally {
      setBulkWorking(false)
    }
  }

  async function handleBulkMarkPaid(details: PaidDetails) {
    if (!onBulkMarkPaid || selected.size === 0) return
    setBulkWorking(true)
    try {
      await onBulkMarkPaid([...selected], details)
      setSelected(new Set())
      setPaidDialog(false)
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
        {/* Search — controlled by the top bar so there is only one box (R7).
            Kept here as a read-only chip so it is obvious what is filtering. */}
        {search.trim() && (
          <button
            onClick={() => onSearchChange('')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/10 text-accent text-xs font-medium hover:bg-accent/20 transition-colors flex-shrink-0"
            title="Tühjenda otsing"
          >
            <Search size={11} />
            {search.trim()}
            <XIcon size={11} />
          </button>
        )}

        {/* Stage filter pills */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setStageFilter('all')}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
              stageFilter === 'all' ? 'chip-active' : 'text-ink-muted hover:text-ink bg-bg-sidebar'
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
                // From stage.hex, not the legacy class pair — the class fields go
                // stale as soon as a stage is recoloured in Seaded.
                style={stageFilter === s.key ? stageChipStyle(s.hex) : undefined}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                  stageFilter === s.key ? '' : 'text-ink-muted hover:text-ink bg-bg-sidebar'
                }`}
              >
                {s.label} ({count})
              </button>
            )
          })}
        </div>

        <span className="text-ink-faint/30 text-sm select-none">|</span>

        {/* Period and work type. Both were chip rows until the work types grew
            past a dozen and pushed the toolbar onto a second line — a filter you
            have to scan for ten seconds is not faster than sorting. */}
        <SelectMenu
          icon={CalendarDays}
          value={periodFilter}
          options={PERIOD_OPTIONS}
          onChange={setPeriodFilter}
        />

        {workTypeOptions.names.length > 1 && (
          <MultiFilterMenu
            label="Tööliik"
            icon={Shapes}
            options={workTypeOptions.names}
            swatches={workTypeOptions.swatches}
            counts={workTypeOptions.counts}
            selected={workTypeFilter}
            onChange={setWorkTypeFilter}
          />
        )}

        <SelectMenu
          icon={Wallet}
          value={payFilter}
          options={PAY_OPTIONS}
          onChange={setPayFilter}
        />

        {/* The debtor list. Only appears when somebody owes something — an empty
            menu is a button that does nothing. The amount is IN the option
            label, so "kes kui palju võlgu on" is answered without picking one. */}
        {debt.rows.length > 0 && (
          <MultiFilterMenu
            label={`Võlglane${debt.outstanding > 0 ? ` · ${debt.outstanding.toFixed(0)} €` : ''}`}
            icon={HandCoins}
            options={debtorLabels.names}
            counts={debtorLabels.counts}
            swatches={debtorLabels.swatches}
            selected={debtorLabelSelection}
            onChange={next => setDebtorFilter(new Set(
              [...next].map(label => debtorLabels.keyOf[label]).filter(Boolean),
            ))}
          />
        )}

        {/* Picked types stay readable without reopening the menu, and each one
            comes off with the click that put it on. */}
        {[...workTypeFilter].map(name => (
          <button
            key={name}
            onClick={() => setWorkTypeFilter(prev => {
              const next = new Set(prev)
              next.delete(name)
              return next
            })}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-bg-sidebar text-xs font-medium text-ink-muted hover:text-ink transition-colors flex-shrink-0"
            title={`Eemalda filter: ${name}`}
          >
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: workTypeOptions.swatches[name] }}
            />
            {name}
            <XIcon size={11} className="opacity-60" />
          </button>
        ))}

        {/* Exports what is ON SCREEN, filters included. Exporting everything
            from a filtered view is how someone sends the wrong month to their
            accountant. */}
        <button
          onClick={() => exportCsv('tood', filtered, jobColumns(
            key => stages.find(st => st.key === key)?.label ?? key,
            id => customers.find(c => c.id === id)?.name ?? '',
            id => workers.find(w => w.id === id)?.full_name ?? '',
          ))}
          disabled={filtered.length === 0}
          title={`Ekspordi ${filtered.length} rida CSV-sse`}
          className="text-xs px-2.5 py-1 rounded-lg font-medium text-ink-muted hover:text-ink bg-bg-sidebar transition-colors flex-shrink-0 flex items-center gap-1.5 disabled:opacity-40 ml-auto"
        >
          <Download size={12} /> CSV
        </button>

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-ink-faint hover:text-red-500 transition-colors flex-shrink-0"
          >
            Tühjenda filtrid
          </button>
        )}

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
                style={stageChipStyle(s.hex)}
                className="text-xs px-2.5 py-1 rounded-lg font-medium border border-transparent transition-all duration-100 disabled:opacity-50 hover:opacity-80"
              >
                {s.label}
              </button>
            ))}
          </div>
          {/* Assigning who did the work, in bulk. Doing it one form at a time is
              what stops the pay data from ever getting filled in. */}
          {onBulkAssign && (
            <>
              <span className="text-ink-faint/40">|</span>
              <span className="text-xs text-ink-muted whitespace-nowrap">Teostaja:</span>
              <select
                disabled={bulkWorking}
                value=""
                onChange={e => {
                  if (e.target.value === '') return
                  handleBulkAssign('assigned_to', e.target.value === '__none' ? null : e.target.value)
                }}
                className="input py-1 text-xs w-36"
              >
                <option value="">Määra…</option>
                {workers.map(w => <option key={w.id} value={w.id}>{w.full_name || 'Nimeta'}</option>)}
                <option value="__none">— eemalda —</option>
              </select>
              <span className="text-xs text-ink-muted whitespace-nowrap">Disainija:</span>
              <select
                disabled={bulkWorking}
                value=""
                onChange={e => {
                  if (e.target.value === '') return
                  handleBulkAssign('designed_by', e.target.value === '__none' ? null : e.target.value)
                }}
                className="input py-1 text-xs w-36"
              >
                <option value="">Määra…</option>
                {workers.map(w => <option key={w.id} value={w.id}>{w.full_name || 'Nimeta'}</option>)}
                <option value="__none">— eemalda —</option>
              </select>
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            {onBulkMarkPaid && (
              <button
                disabled={bulkWorking}
                onClick={() => setPaidDialog(true)}
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
              {/* Pencil column — opens the side editor */}
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
                  {hasFilters ? 'Tulemusi ei leitud' : 'Töid pole veel lisatud'}
                </td>
              </tr>
            )}
            {filtered.map((job, idx) => {
              const isSelected = selectedIds.has(job.id)
              const overdue = job.valmis_aeg && isPast(parseISO(job.valmis_aeg)) && job.status !== doneStageKey
              return (
                <tr
                  key={job.id}
                  // Row click opens the BOTTOM sheet — the side panel is for
                  // adding and editing, this is for looking something up.
                  onClick={() => (onJobEye ?? onJobClick)(job)}
                  className={`border-b border-ink-faint/10 cursor-pointer transition-colors duration-100 group
                    ${job.kiirtoo ? 'border-l-2 border-l-orange-400' : 'border-l-2 border-l-transparent'}
                    ${isSelected
                      ? 'bg-accent/[0.07]'
                      : idx % 2 === 0 ? 'bg-bg-card' : 'bg-[#f0f4f6]'
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

                  {/* Pencil — opens the side panel for editing */}
                  <td
                    className="px-1 py-3 w-8"
                    onClick={e => { e.stopPropagation(); onJobClick(job) }}
                    title="Muuda"
                  >
                    <Edit2
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
                    {fmtDate(job.kuupaev, 'dd.MM.yy HH:mm')}
                  </td>

                  {/* Patsient */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm text-ink">{job.patsient}</span>
                      {job.kiirtoo && (
                        <span title="Kiirtöö" className="flex-shrink-0 leading-none">
                          <Zap size={12} className="text-orange-500" />
                        </span>
                      )}
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

                  {/* Makstud — with the AMOUNT, because "osaliselt" on its own
                      does not answer "kui palju ta maksnud on". */}
                  <td className="px-4 py-3">
                    {(() => {
                      const pay = jobPaymentState(job, allPayments, allInvoices)
                      const late = (debtorOfJob.get(job.id)?.overdue ?? 0) > 0
                      if (pay.settled) return (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full font-medium">
                          <Check size={10} /> Jah
                        </span>
                      )
                      if (pay.partial) return (
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1 text-xs text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full font-medium w-fit">
                            {pay.paid.toFixed(2)} € / {pay.total.toFixed(2)} €
                          </span>
                          <span className="text-[10px] text-orange-600 tabular-nums">
                            jääk {pay.outstanding.toFixed(2)} €
                          </span>
                        </div>
                      )
                      return job.hind ? (
                        <span className={`text-xs font-medium ${late ? 'text-red-600' : 'text-red-500'}`}>
                          Ei{late ? ` · ${debtorOfJob.get(job.id)?.daysLate} p üle` : ''}
                        </span>
                      ) : (
                        <span className="text-ink-faint text-xs">—</span>
                      )
                    })()}
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

                  {/* Row-hover affordance for the bottom sheet the row opens */}
                  <td className="px-2 py-3">
                    <Eye size={13} className="text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Footer count */}
        {filtered.length > 0 && (
          <div className="px-5 py-3 text-xs text-ink-faint border-t border-ink-faint/10 flex items-center gap-3 flex-wrap">
            <span>
              {filtered.length} töö{filtered.length !== 1 ? 'd' : ''}
              {hasFilters ? ` (filtreeritud ${jobs.length}-st)` : ''}
              {selected.size > 0 && ` · ${selected.size} valitud`}
            </span>
            {/* What is ON SCREEN is owed. Sums the same rows the CSV exports,
                so the footer and the export can never disagree. */}
            {(() => {
              const rows = filtered.map(j => jobPaymentState(j, allPayments, allInvoices))
              const owed = rows.reduce((s, p) => s + p.outstanding, 0)
              const paid = rows.reduce((s, p) => s + Math.min(p.paid, p.total), 0)
              if (owed <= 0.005 && paid <= 0.005) return null
              return (
                <span className="ml-auto tabular-nums">
                  Laekunud <span className="text-emerald-600 font-semibold">{paid.toFixed(2)} €</span>
                  {' · '}
                  Tasumata <span className={owed > 0 ? 'text-red-500 font-semibold' : ''}>{owed.toFixed(2)} €</span>
                </span>
              )
            })()}
          </div>
        )}
      </div>

      {/* One method and date for the whole selection — that is how a batch is
          actually settled (one bank transfer, one till at close of day). */}
      {paidDialog && (
        <MarkPaidDialog
          title="Märgi valitud tööd makstuks"
          count={selected.size}
          // Same function the single-job dialog and the invoice use, so a batch
          // cannot be settled for a different number than its rows.
          amount={filtered
            .filter(j => selected.has(j.id))
            .reduce((s, j) => s + jobTotalValue(j), 0)}
          busy={bulkWorking}
          onClose={() => setPaidDialog(false)}
          onConfirm={handleBulkMarkPaid}
        />
      )}
    </div>
  )
}
