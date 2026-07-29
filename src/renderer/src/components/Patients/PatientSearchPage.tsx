import { useMemo, useState } from 'react'
import {
  Search, UserPlus, Loader2, Wand2, ShieldAlert, X, SlidersHorizontal, ChevronRight
} from 'lucide-react'
import { format, parseISO, isValid } from 'date-fns'
import type { Job } from '../../types/job'
import type { Patient } from '../../types/patient'
import { jobsForPatient, patientStats } from './derive'

export type SortKey = 'nimi' | 'tood' | 'viimane' | 'tasumata'

interface PatientSearchPageProps {
  patients: Patient[]
  jobs: Job[]
  loading: boolean
  search: string
  onSearchChange: (v: string) => void
  onSelect: (id: string) => void
  onNew: () => void
  creating: boolean
  unlinkedCount: number
  onBackfill: () => void
  backfilling: boolean
  backfillMsg: string | null
  actionError: string | null
  onDismissError: () => void
}

// Row shape the table renders — stats are computed once per patient here rather
// than inside the row, so sorting and filtering read the same numbers the row shows.
interface Row {
  patient: Patient
  jobCount: number
  totalTeeth: number
  totalInvoiced: number
  unpaidTotal: number
  latestJobDate: string | null
}

export function PatientSearchPage({
  patients, jobs, loading, search, onSearchChange, onSelect, onNew, creating,
  unlinkedCount, onBackfill, backfilling, backfillMsg, actionError, onDismissError
}: PatientSearchPageProps) {
  const [arstFilter, setArstFilter] = useState('')
  const [kliinikFilter, setKliinikFilter] = useState('')
  const [onlyUnpaid, setOnlyUnpaid] = useState(false)
  const [onlyWithoutJobs, setOnlyWithoutJobs] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('nimi')

  const rows = useMemo<Row[]>(() => patients.map(p => {
    const pj = jobsForPatient(jobs, p)
    const s = patientStats(pj)
    return {
      patient: p,
      jobCount: s.jobCount,
      totalTeeth: s.totalTeeth,
      totalInvoiced: s.totalInvoiced,
      unpaidTotal: s.unpaidTotal,
      latestJobDate: s.latestJobDate
    }
  }), [patients, jobs])

  // Filter dropdown options come from the data itself — there is no doctor or
  // clinic registry, they are free text on the patient record.
  const arstOptions = useMemo(
    () => [...new Set(patients.map(p => p.arst?.trim()).filter(Boolean) as string[])].sort(),
    [patients]
  )
  const kliinikOptions = useMemo(
    () => [...new Set(patients.map(p => p.kliinik?.trim()).filter(Boolean) as string[])].sort(),
    [patients]
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    let out = rows.filter(r => {
      const p = r.patient
      if (q && !(
        p.nimi.toLowerCase().includes(q) ||
        (p.arst ?? '').toLowerCase().includes(q) ||
        (p.kliinik ?? '').toLowerCase().includes(q) ||
        (p.telefon ?? '').toLowerCase().includes(q) ||
        (p.email ?? '').toLowerCase().includes(q)
      )) return false
      if (arstFilter && (p.arst ?? '').trim() !== arstFilter) return false
      if (kliinikFilter && (p.kliinik ?? '').trim() !== kliinikFilter) return false
      if (onlyUnpaid && r.unpaidTotal <= 0) return false
      if (onlyWithoutJobs && r.jobCount > 0) return false
      return true
    })
    out = [...out].sort((a, b) => {
      switch (sortKey) {
        case 'tood':     return b.jobCount - a.jobCount
        case 'tasumata': return b.unpaidTotal - a.unpaidTotal
        // Nulls last — a patient with no jobs has no "latest" to compare
        case 'viimane':  return (b.latestJobDate ?? '').localeCompare(a.latestJobDate ?? '')
        default:         return a.patient.nimi.localeCompare(b.patient.nimi, 'et')
      }
    })
    return out
  }, [rows, search, arstFilter, kliinikFilter, onlyUnpaid, onlyWithoutJobs, sortKey])

  const filtersActive =
    !!arstFilter || !!kliinikFilter || onlyUnpaid || onlyWithoutJobs || !!search.trim()

  function clearFilters() {
    setArstFilter(''); setKliinikFilter(''); setOnlyUnpaid(false); setOnlyWithoutJobs(false)
    onSearchChange('')
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
      {/* ─── Search + primary actions ────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-2xl">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Otsi nime, arsti, kliiniku, telefoni või e-posti järgi…"
            autoFocus
            className="input pl-10 py-2.5 text-sm"
          />
          {search.trim() && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
              title="Tühjenda"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button onClick={onNew} disabled={creating} className="btn-primary flex-shrink-0">
          {creating ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
          Uus patsient
        </button>
      </div>

      {/* ─── Filters ─────────────────────────────────────────────────────── */}
      <div className="card p-3 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted uppercase tracking-wider mr-1">
          <SlidersHorizontal size={12} />
          Filtrid
        </span>

        <select value={arstFilter} onChange={e => setArstFilter(e.target.value)} className="input py-1.5 text-sm w-auto">
          <option value="">Kõik arstid</option>
          {arstOptions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        <select value={kliinikFilter} onChange={e => setKliinikFilter(e.target.value)} className="input py-1.5 text-sm w-auto">
          <option value="">Kõik kliinikud</option>
          {kliinikOptions.map(k => <option key={k} value={k}>{k}</option>)}
        </select>

        <Toggle active={onlyUnpaid} onClick={() => setOnlyUnpaid(v => !v)} label="Ainult tasumata" />
        <Toggle active={onlyWithoutJobs} onClick={() => setOnlyWithoutJobs(v => !v)} label="Ilma töödeta" />

        <div className="ml-auto flex items-center gap-2">
          <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)} className="input py-1.5 text-sm w-auto">
            <option value="nimi">Sorteeri: nimi</option>
            <option value="tood">Sorteeri: töid kokku</option>
            <option value="viimane">Sorteeri: viimane töö</option>
            <option value="tasumata">Sorteeri: tasumata</option>
          </select>
          {filtersActive && (
            <button onClick={clearFilters} className="btn-ghost text-xs">
              <X size={12} />
              Tühjenda
            </button>
          )}
        </div>
      </div>

      {unlinkedCount > 0 && (
        <button
          onClick={onBackfill}
          disabled={backfilling}
          className="btn-ghost text-xs border border-dashed border-accent/40 text-accent hover:bg-accent/10"
          title="Loob patsiendikaardid olemasolevate tööde nimedest ja seob tööd nendega"
        >
          {backfilling ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
          Seo {unlinkedCount} tööd patsientidega
        </button>
      )}
      {backfillMsg && <p className="text-xs text-accent font-medium">{backfillMsg}</p>}

      {actionError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3">
          <ShieldAlert size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-red-800 font-medium break-words">{actionError}</p>
          </div>
          <button onClick={onDismissError} className="text-[10px] text-red-600 underline flex-shrink-0">Sulge</button>
        </div>
      )}

      {/* ─── Results ─────────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-ink-faint/15">
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
            {visible.length} patsienti
            {visible.length !== patients.length && ` (${patients.length} kokku)`}
          </p>
        </div>

        {loading && <p className="p-6 text-sm text-ink-muted">Laen…</p>}

        {!loading && visible.length === 0 && (
          <div className="p-6 space-y-2">
            <p className="text-sm text-ink-muted">
              {patients.length === 0 ? 'Patsiente pole veel.' : 'Ükski patsient ei vasta filtritele.'}
            </p>
            {patients.length === 0 && unlinkedCount > 0 && (
              <p className="text-xs text-ink-faint leading-relaxed">
                Sul on {unlinkedCount} tööd patsiendinimedega — vajuta „Seo tööd patsientidega".
                Kui midagi ei juhtu, pole <code>sql/002_patients_rls.sql</code> veel käivitatud.
              </p>
            )}
          </div>
        )}

        {!loading && visible.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold text-ink-muted uppercase tracking-wider border-b border-ink-faint/15">
                  <th className="px-4 py-2">Patsient</th>
                  <th className="px-4 py-2">Arst / kliinik</th>
                  <th className="px-4 py-2 text-right">Tööd</th>
                  <th className="px-4 py-2 text-right">Hambad</th>
                  <th className="px-4 py-2">Viimane töö</th>
                  <th className="px-4 py-2 text-right">Arveldatud</th>
                  <th className="px-4 py-2 text-right">Tasumata</th>
                  <th className="px-4 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {visible.map(r => {
                  const d = r.latestJobDate ? parseISO(r.latestJobDate) : null
                  return (
                    <tr
                      key={r.patient.id}
                      onClick={() => onSelect(r.patient.id)}
                      className="border-b border-ink-faint/10 hover:bg-bg-sidebar cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-2.5 font-semibold text-ink">{r.patient.nimi}</td>
                      <td className="px-4 py-2.5 text-ink-muted text-xs">
                        {[r.patient.arst, r.patient.kliinik].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-ink-soft">{r.jobCount}</td>
                      <td className="px-4 py-2.5 text-right text-ink-soft">{r.totalTeeth}</td>
                      <td className="px-4 py-2.5 text-ink-muted text-xs">
                        {d && isValid(d) ? format(d, 'dd.MM.yyyy') : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-ink-soft">{r.totalInvoiced.toFixed(2)} €</td>
                      <td className={`px-4 py-2.5 text-right font-medium ${r.unpaidTotal > 0 ? 'text-orange-600' : 'text-ink-faint'}`}>
                        {r.unpaidTotal.toFixed(2)} €
                      </td>
                      <td className="px-4 py-2.5 text-ink-faint"><ChevronRight size={14} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Toggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-accent text-white' : 'text-ink-muted hover:bg-bg-sidebar border border-ink-faint/30'
      }`}
    >
      {label}
    </button>
  )
}
