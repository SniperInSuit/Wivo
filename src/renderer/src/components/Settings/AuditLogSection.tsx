/**
 * Seaded → Audit log, for organisation owners and admins (spec: audit_log —
 * view, download, share, stage move; append-only; edits since sql/114). Search by person, action,
 * job code and dates, a page at a time, and export what was found as CSV.
 * Reads `audit_search` and `audit_people` (sql/105), which refuse anyone who
 * is not an admin and show only what `audit_entries` always did.
 */
import { useEffect, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { ScrollText, Download, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, X, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toCsv, csvFileName } from '@shared/export/csv'
import { downloadCsv } from '../../lib/exports'
import { recordExport } from '../../lib/exportAudit'
import {
  AUDIT_ACTIONS, CSV_MAX_ROWS, NO_FILTERS, actionLabel, auditCsvColumns, chartSummary, cursorAfter, describeEntry, entryPatient,
  entryWhat, entryWhen, entryWho, filterArgs, groupRows, type AuditEntry, type AuditFilters, type Cursor, type Names,
} from '../../lib/auditSearch'
import { describeError } from '../Patients/errors'
import { t } from '@/lib/i18n'

const PAGE = 50

async function fetchPage(f: AuditFilters, before: Cursor | null, limit: number): Promise<AuditEntry[]> {
  const { data, error } = await supabase.rpc('audit_search', {
    ...filterArgs(f), p_before_at: before?.at ?? null, p_before_id: before?.id ?? null, p_limit: limit,
  })
  if (error) throw error
  return (data ?? []) as AuditEntry[]
}

/** The clinic's members and clients, to name the ids an entry holds. Anyone missing has left. */
async function fetchNames(): Promise<Names> {
  const [members, clients] = await Promise.all([
    supabase.from('profiles').select('id, full_name'),
    supabase.from('customers').select('id, name'),
  ])
  const names = new Map<string, string>()
  for (const m of (members.data ?? []) as { id: string; full_name: string | null }[]) names.set(m.id, m.full_name || '—')
  for (const c of (clients.data ?? []) as { id: string; name: string }[]) names.set(c.id, c.name)
  return names
}

type OpenPatient = ((patientId: string) => void) | undefined

/** What the entry is about; a patient's with a way to their card. */
function WhatCell({ e, names, onOpenPatient }: { e: AuditEntry; names: Names; onOpenPatient: OpenPatient }) {
  const patient = entryPatient(e)
  return (
    <td className="pr-3 font-mono whitespace-nowrap">
      {entryWhat(e, names)}
      {patient && onOpenPatient && (
        <button type="button" onClick={() => onOpenPatient(patient)} className="ml-2 font-sans text-accent hover:underline">
          {t('audit.openPatient')}
        </button>
      )}
    </td>
  )
}

/** Clicks on one patient's chart in a row: one line, each click below it on request. */
function ChartRows({ entries, names, onOpenPatient }: { entries: AuditEntry[]; names: Names; onOpenPatient: OpenPatient }) {
  const [open, setOpen] = useState(false)
  const first = entries[0]
  return (
    <>
      <tr className="border-t border-ink-faint/15">
        <td className="py-1.5 pr-3 whitespace-nowrap">{entryWhen(first)}</td>
        <td className="pr-3">{entryWho(first)}</td>
        <td className="pr-3">{actionLabel(first.action)}</td>
        <WhatCell e={first} names={names} onOpenPatient={onOpenPatient} />
        <td className="text-ink-muted">
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
            title={open ? t('audit.hideChanges') : t('audit.showChanges')}
            className="inline-flex items-center gap-1 hover:text-ink">
            {chartSummary(entries)} {open ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
          </button>
        </td>
      </tr>
      {open && entries.map(e => (
        <tr key={e.id} className="text-ink-muted">
          <td className="py-1 pr-3 pl-4 whitespace-nowrap">{entryWhen(e)}</td>
          <td colSpan={3} />
          <td>{describeEntry(e, names)}</td>
        </tr>
      ))}
    </>
  )
}

export function AuditLogSection({ onOpenPatient }: { onOpenPatient?: (patientId: string) => void } = {}) {
  const [filters, setFilters] = useState<AuditFilters>(NO_FILTERS)
  // The job code is typed: searched once typing stops.
  const [jobInput, setJobInput] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setFilters(f => (f.jobCode === jobInput ? f : { ...f, jobCode: jobInput })), 300)
    return () => clearTimeout(timer)
  }, [jobInput])
  // Paging: where each page starts. Page 1 starts at the newest row.
  const [starts, setStarts] = useState<(Cursor | null)[]>([null])
  const page = starts.length - 1
  useEffect(() => { setStarts([null]) }, [filters])

  const { data: people = [] } = useQuery<{ user_id: string; name: string }[]>({
    queryKey: ['audit_people'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('audit_people')
      if (error) return [] // a database before sql/105
      return (data ?? []) as { user_id: string; name: string }[]
    },
  })

  const { data: names = new Map<string, string>() } = useQuery<Names>({ queryKey: ['audit_names'], queryFn: fetchNames })

  // One row more than a page, to know whether there is an older page.
  const { data = [], error, isLoading, isFetching } = useQuery<AuditEntry[]>({
    queryKey: ['audit_search', filters, starts[page]],
    queryFn: () => fetchPage(filters, starts[page], PAGE + 1),
    placeholderData: keepPreviousData,
  })
  const rows = data.slice(0, PAGE)
  const hasOlder = data.length > PAGE

  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<string | null>(null)
  async function exportFound() {
    setExporting(true)
    setExportNote(null)
    try {
      const all: AuditEntry[] = []
      let before: Cursor | null = null
      while (all.length < CSV_MAX_ROWS) {
        const batch = await fetchPage(filters, before, 1000)
        all.push(...batch)
        if (batch.length < 1000) break
        before = cursorAfter(batch)
      }
      const capped = all.slice(0, CSV_MAX_ROWS)
      // The export itself goes in the log (sql/106) before the file is made:
      // the filters and the number of rows, never the rows.
      await recordExport('audit_log', capped.length, {
        person: people.find(p => p.user_id === filters.userId)?.name ?? null,
        action: filters.action, jobCode: filters.jobCode.trim(), from: filters.from, to: filters.to,
      })
      downloadCsv(csvFileName('audit-log', new Date()), toCsv(capped, auditCsvColumns(names)))
      if (all.length >= CSV_MAX_ROWS) setExportNote(t('audit.exportCapped', { n: CSV_MAX_ROWS }))
    } catch (e) {
      setExportNote(describeError(e))
    } finally {
      setExporting(false)
    }
  }

  const set = (p: Partial<AuditFilters>) => setFilters(f => ({ ...f, ...p }))
  const filtered = filters.userId || filters.action || filters.jobCode || filters.from || filters.to

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <ScrollText size={14} className="text-accent" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-ink">{t('audit.auditLog')}</h3>
        <button type="button" onClick={() => void exportFound()} disabled={exporting || rows.length === 0}
          className="ml-auto btn-ghost text-xs border border-ink-faint/25 flex items-center gap-1.5 disabled:opacity-50">
          {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} {t('audit.exportCsv')}
        </button>
      </div>
      <p className="text-xs text-ink-muted max-w-2xl">{t('audit.intro')}</p>

      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-0.5">
          <span className="text-ink-muted">{t('audit.who')}</span>
          <select value={filters.userId} onChange={e => set({ userId: e.target.value })} className="input w-44 text-xs py-1">
            <option value="">{t('audit.everyone')}</option>
            {people.map(p => <option key={p.user_id} value={p.user_id}>{p.name || t('audit.formerMemberWho')}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-ink-muted">{t('audit.action')}</span>
          <select value={filters.action} onChange={e => set({ action: e.target.value })} className="input w-44 text-xs py-1">
            <option value="">{t('audit.allActions')}</option>
            {AUDIT_ACTIONS.map(a => <option key={a} value={a}>{actionLabel(a)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-ink-muted">{t('audit.jobCode')}</span>
          <input value={jobInput} onChange={e => setJobInput(e.target.value)} placeholder={t('audit.jobCodePlaceholder')}
            className="input w-36 text-xs py-1 font-mono" autoCapitalize="none" spellCheck={false} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-ink-muted">{t('audit.from')}</span>
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={e => set({ from: e.target.value })} className="input text-xs py-1" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-ink-muted">{t('audit.to')}</span>
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={e => set({ to: e.target.value })} className="input text-xs py-1" />
        </label>
        {filtered && (
          <button type="button" onClick={() => { setFilters(NO_FILTERS); setJobInput('') }}
            className="btn-ghost text-xs flex items-center gap-1"><X size={12} /> {t('audit.clearFilters')}</button>
        )}
      </div>
      {exportNote && <p role="status" className="text-xs text-ink-muted">{exportNote}</p>}

      {error ? <p role="alert" className="text-sm text-rose-500">{describeError(error)}</p>
        : isLoading ? <p className="text-sm text-ink-muted">{t('partners.loading')}</p>
        : rows.length === 0 ? <p className="text-sm text-ink-muted">{filtered ? t('audit.noMatches') : t('audit.empty')}</p>
        : (
          <>
            <table className={`w-full text-xs ${isFetching ? 'opacity-60' : ''}`}>
              <thead className="text-left text-ink-muted uppercase tracking-wider text-[10px]">
                <tr><th className="py-1.5 pr-3">{t('audit.when')}</th><th className="pr-3">{t('audit.who')}</th><th className="pr-3">{t('audit.action')}</th><th className="pr-3">{t('audit.what')}</th><th /></tr>
              </thead>
              <tbody>
                {groupRows(rows).map(r => r.kind === 'chart'
                  ? <ChartRows key={r.entries[0].id} entries={r.entries} names={names} onOpenPatient={onOpenPatient} />
                  : (
                    <tr key={r.entry.id} className="border-t border-ink-faint/15">
                      <td className="py-1.5 pr-3 whitespace-nowrap">{entryWhen(r.entry)}</td>
                      <td className="pr-3">{entryWho(r.entry)}</td>
                      <td className="pr-3">{actionLabel(r.entry.action)}</td>
                      <WhatCell e={r.entry} names={names} onOpenPatient={onOpenPatient} />
                      <td className="text-ink-muted">{describeEntry(r.entry, names)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <div className="flex items-center gap-2 text-xs">
              <button type="button" onClick={() => setStarts(s => s.slice(0, -1))} disabled={page === 0}
                className="btn-ghost border border-ink-faint/25 flex items-center gap-1 disabled:opacity-40">
                <ChevronLeft size={12} /> {t('audit.newer')}
              </button>
              <span className="text-ink-muted tabular-nums">{t('audit.pageN', { n: page + 1 })}</span>
              <button type="button" onClick={() => setStarts(s => [...s, cursorAfter(rows)])} disabled={!hasOlder}
                className="btn-ghost border border-ink-faint/25 flex items-center gap-1 disabled:opacity-40">
                {t('audit.older')} <ChevronRight size={12} />
              </button>
            </div>
          </>
        )}
    </section>
  )
}
