import { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  FileText, Plus, Loader2, AlertTriangle, Euro, Clock, CheckCircle2,
  Trash2, X, Search, Printer, Building2, User, Download
} from 'lucide-react'
import { format, parseISO, isValid } from 'date-fns'
import { et } from 'date-fns/locale'
import type { Job } from '../../types/job'
import {
  INVOICE_STATUS_LABEL, INVOICE_STATUS_HEX, PAYMENT_METHOD_LABEL,
  outstanding, paidAmount, isOverdue, lineTotal,
  type InvoiceFull, type InvoiceStatus, type PaymentMethod
} from '../../types/invoice'
import {
  useInvoices, useUpdateInvoice, useDeleteInvoice, useAddPayment, useDeletePayment
} from '../../hooks/useInvoices'
import { usePermissions } from '../../hooks/usePermissions'
import { useAuth } from '../../context/AuthContext'
import { stageChipStyle } from '../../config/pipeline'
import { describeError } from '../Patients/errors'
import { InvoiceForm } from './InvoiceForm'
import { PaymentPlansPanel } from './PaymentPlansPanel'
import { InvoicePrintView } from './InvoicePrintView'
import { exportCsv, INVOICE_COLUMNS } from '../../lib/exports'

interface InvoicesViewProps {
  jobs: Job[]
}

const STATUS_FILTERS: { key: InvoiceStatus | 'koik' | 'tasumata'; label: string }[] = [
  { key: 'koik', label: 'Kõik' },
  { key: 'tasumata', label: 'Tasumata' },
  { key: 'mustand', label: 'Mustandid' },
  { key: 'saadetud', label: 'Saadetud' },
  { key: 'makstud', label: 'Makstud' },
]

export function InvoicesView({ jobs }: InvoicesViewProps) {
  const { data: invoices = [], isLoading, isError, error } = useInvoices()
  const { can } = usePermissions()
  const auth = useAuth()
  const updateInvoice = useUpdateInvoice()
  const deleteInvoice = useDeleteInvoice()

  const [filter, setFilter] = useState<InvoiceStatus | 'koik' | 'tasumata'>('koik')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [printing, setPrinting] = useState<InvoiceFull | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const canWrite = can('payments.write')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return invoices.filter(inv => {
      if (filter === 'tasumata') {
        if (outstanding(inv) <= 0) return false
      } else if (filter !== 'koik' && inv.status !== filter) {
        return false
      }
      if (q && !inv.number.toLowerCase().includes(q) && !inv.patsient.toLowerCase().includes(q)) {
        return false
      }
      return true
    })
  }, [invoices, filter, search])

  // Totals over what is on screen, not over everything — a filtered list whose
  // summary described a different set would be worse than no summary.
  const totals = useMemo(() => {
    let billed = 0, paid = 0, due = 0, overdue = 0
    for (const inv of filtered) {
      if (inv.status === 'tuhistatud') continue
      billed += Number(inv.gross_total)
      paid += paidAmount(inv)
      due += outstanding(inv)
      if (isOverdue(inv)) overdue += outstanding(inv)
    }
    return { billed, paid, due, overdue }
  }, [filtered])

  const selected = selectedId ? invoices.find(i => i.id === selectedId) ?? null : null

  async function setStatus(inv: InvoiceFull, status: InvoiceStatus) {
    setActionError(null)
    try { await updateInvoice.mutateAsync({ id: inv.id, status }) }
    catch (err) { setActionError(describeError(err)) }
  }

  async function handleDelete(inv: InvoiceFull) {
    setActionError(null)
    try {
      await deleteInvoice.mutateAsync(inv.id)
      setSelectedId(null)
    } catch (err) { setActionError(describeError(err)) }
  }

  if (isError) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="card p-4 flex items-start gap-2 max-w-2xl">
          <AlertTriangle size={15} className="text-orange-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-ink">Arvete tabelit ei leitud</p>
            <p className="text-xs text-ink-muted">
              Käivita <code className="px-1 rounded bg-bg-sidebar">sql/020_invoices.sql</code>{' '}
              Supabase SQL-redaktoris (Wivo kinni).
            </p>
            <p className="text-[10px] text-ink-faint mt-1">{(error as Error)?.message}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto px-6 py-5 space-y-5">
        {/* ── Header ── */}
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-ink">Arved</h1>
          <div className="relative ml-auto">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Otsi numbri või nime järgi…"
              className="input py-1.5 pl-8 text-sm w-64"
            />
          </div>
          <button
            onClick={() => exportCsv('arved', filtered, INVOICE_COLUMNS)}
            disabled={filtered.length === 0}
            title={`Ekspordi ${filtered.length} arvet CSV-sse`}
            className="btn-ghost text-sm border border-ink-faint/25 disabled:opacity-40"
          >
            <Download size={14} /> CSV
          </button>
          {canWrite && (
            <button onClick={() => setShowForm(true)} className="btn-primary">
              <Plus size={14} /> Uus arve
            </button>
          )}
        </div>

        {/* ── Summary ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard icon={FileText} label="Arveldatud" value={totals.billed} />
          <SummaryCard icon={CheckCircle2} label="Laekunud" value={totals.paid} accent="#22C55E" />
          <SummaryCard icon={Clock} label="Tasumata" value={totals.due} accent="#F59E0B" />
          <SummaryCard icon={AlertTriangle} label="Üle tähtaja" value={totals.overdue} accent="#EF4444" />
        </div>

        {/* ── Payment plans ── */}
        {/* Above the list, not inside it: a plan's five instalments are five
            ordinary rows in there, and nothing in that list says they are one
            agreement. Renders nothing at all when no plan exists. */}
        <PaymentPlansPanel
          invoices={invoices}
          canWrite={canWrite}
          onOpenInvoice={setSelectedId}
        />

        {/* ── Filters ── */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-100 ${
                filter === f.key ? 'chip-active' : 'bg-bg-sidebar text-ink-muted hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {actionError && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {actionError}
          </p>
        )}

        {/* ── List ── */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-accent" size={28} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-8 text-center">
            <FileText size={28} className="text-ink-faint mx-auto mb-2" />
            <p className="text-sm text-ink-muted">
              {invoices.length === 0 ? 'Arveid ei ole veel loodud.' : 'Ükski arve ei vasta filtrile.'}
            </p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted border-b border-ink-faint/15">
                  <th className="px-3 py-2 font-semibold">Number</th>
                  <th className="px-3 py-2 font-semibold">Saaja</th>
                  <th className="px-3 py-2 font-semibold">Kuupäev</th>
                  <th className="px-3 py-2 font-semibold">Tähtaeg</th>
                  <th className="px-3 py-2 font-semibold text-right">Summa</th>
                  <th className="px-3 py-2 font-semibold text-right">Tasumata</th>
                  <th className="px-3 py-2 font-semibold">Seis</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => {
                  const due = outstanding(inv)
                  const late = isOverdue(inv)
                  return (
                    <tr
                      key={inv.id}
                      onClick={() => setSelectedId(inv.id)}
                      className={`border-b border-ink-faint/10 last:border-0 cursor-pointer transition-colors even:bg-bg-sidebar/40 hover:bg-accent/5 ${
                        selectedId === inv.id ? 'bg-accent/10' : ''
                      }`}
                    >
                      <td className="px-3 py-2 font-semibold text-ink tabular-nums">{inv.number}</td>
                      {/* Which KIND of addressee, not just the name: a list
                          sorted by name puts practices and patients side by
                          side and they read identically without this. */}
                      <td className="px-3 py-2 text-ink truncate max-w-[200px]">
                        <span className="inline-flex items-center gap-1.5">
                          {inv.bill_to_kind === 'customer'
                            ? <Building2 size={11} className="text-ink-faint flex-shrink-0" />
                            : <User size={11} className="text-ink-faint flex-shrink-0" />}
                          <span className="truncate">{inv.patsient}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-ink-muted tabular-nums">{fmtDate(inv.issue_date)}</td>
                      <td className={`px-3 py-2 tabular-nums ${late ? 'text-red-500 font-semibold' : 'text-ink-muted'}`}>
                        {fmtDate(inv.due_date)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-ink">
                        {Number(inv.gross_total).toFixed(2)} €
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${due > 0 ? 'text-ink' : 'text-emerald-600'}`}>
                        {due.toFixed(2)} €
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="text-[10px] font-medium rounded-full px-1.5 py-0.5"
                          style={stageChipStyle(late ? '#EF4444' : INVOICE_STATUS_HEX[inv.status])}
                        >
                          {late ? 'Üle tähtaja' : INVOICE_STATUS_LABEL[inv.status]}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Detail panel ── */}
      {selected && (
        <InvoiceDetail
          invoice={selected}
          canWrite={canWrite}
          onClose={() => setSelectedId(null)}
          onStatus={setStatus}
          onDelete={handleDelete}
          onPrint={() => setPrinting(selected)}
        />
      )}

      <AnimatePresence>
        {showForm && (
          <InvoiceForm
            jobs={jobs}
            onClose={() => setShowForm(false)}
            onCreated={id => setSelectedId(id)}
          />
        )}
      </AnimatePresence>

      {printing && (
        <InvoicePrintView
          invoice={printing}
          clinic={auth.clinic}
          onClose={() => setPrinting(null)}
        />
      )}
    </div>
  )
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function InvoiceDetail({ invoice, canWrite, onClose, onStatus, onDelete, onPrint }: {
  invoice: InvoiceFull
  canWrite: boolean
  onClose: () => void
  onStatus: (inv: InvoiceFull, s: InvoiceStatus) => void
  onDelete: (inv: InvoiceFull) => void
  onPrint: () => void
}) {
  const addPayment = useAddPayment()
  const deletePayment = useDeletePayment()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('ulekanne')
  const [paidAt, setPaidAt] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const due = outstanding(invoice)
  const paid = paidAmount(invoice)

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const value = parseFloat(amount)
    if (!Number.isFinite(value) || value <= 0) {
      setError('Sisesta summa, mis on suurem kui null.')
      return
    }
    try {
      await addPayment.mutateAsync({
        invoice_id: invoice.id,
        job_id: null,
        amount: value,
        method,
        paid_at: paidAt,
        reference: reference.trim() || null,
        note: null,
        recorded_by: null,
      })
      setAmount('')
      setReference('')
      // Fully settled → mark it paid, so the list and the status agree without
      // the user having to do it in two places.
      if (value >= due && invoice.status !== 'makstud') onStatus(invoice, 'makstud')
    } catch (err) {
      setError(describeError(err))
    }
  }

  return (
    <aside className="w-[380px] flex-shrink-0 border-l border-ink-faint/15 bg-bg-card overflow-y-auto">
      <div className="p-4 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] text-ink-muted">Arve</p>
            <h2 className="text-lg font-bold text-ink tabular-nums">{invoice.number}</h2>
            <p className="text-sm text-ink-muted flex items-center gap-1.5">
              {invoice.bill_to_kind === 'customer'
                ? <Building2 size={12} className="text-ink-faint" />
                : <User size={12} className="text-ink-faint" />}
              {invoice.patsient}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onPrint} className="btn-ghost p-1.5" title="Prindi / salvesta PDF">
              <Printer size={14} />
            </button>
            <button onClick={onClose} className="btn-ghost p-1.5" title="Sulge"><X size={14} /></button>
          </div>
        </div>

        {/* Lines */}
        <section className="space-y-1.5">
          <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
            Read ({invoice.lines.length})
          </h3>
          {invoice.lines.map(l => (
            <div key={l.id} className="flex items-start justify-between gap-2 text-xs">
              <span className="text-ink-muted flex-1">
                {l.description}
                {l.qty !== 1 && <span className="text-ink-faint"> × {l.qty}</span>}
              </span>
              <span className="tabular-nums font-medium text-ink flex-shrink-0">
                {lineTotal(l).toFixed(2)} €
              </span>
            </div>
          ))}
          <div className="border-t border-ink-faint/15 pt-1.5 space-y-0.5 text-xs">
            <Row label="Summa" value={`${Number(invoice.net_total).toFixed(2)} €`} />
            <Row label={`KM ${Number(invoice.vat_rate)}%`} value={`${Number(invoice.vat_total).toFixed(2)} €`} />
            <Row label="Kokku" value={`${Number(invoice.gross_total).toFixed(2)} €`} bold />
            <Row label="Laekunud" value={`${paid.toFixed(2)} €`} tone="text-emerald-600" />
            <Row label="Tasumata" value={`${due.toFixed(2)} €`} bold tone={due > 0 ? 'text-ink' : 'text-emerald-600'} />
          </div>
        </section>

        {invoice.note && (
          <p className="text-xs text-ink-muted italic bg-bg-sidebar rounded-lg px-2.5 py-2">{invoice.note}</p>
        )}

        {/* Status */}
        {canWrite && (
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Seis</h3>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(INVOICE_STATUS_LABEL) as InvoiceStatus[]).map(s => (
                <button
                  key={s}
                  onClick={() => onStatus(invoice, s)}
                  disabled={invoice.status === s}
                  className="text-[11px] font-medium rounded-lg px-2 py-1 border transition-colors disabled:opacity-100 disabled:bg-accent/10"
                  style={{ color: INVOICE_STATUS_HEX[s], borderColor: `${INVOICE_STATUS_HEX[s]}59` }}
                >
                  {INVOICE_STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Payments */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
            Maksed ({invoice.payments.length})
          </h3>
          {invoice.payments.length === 0 ? (
            <p className="text-xs text-ink-faint">Makseid ei ole.</p>
          ) : invoice.payments.map(p => (
            <div key={p.id} className="flex items-center gap-2 text-xs rounded-lg border border-ink-faint/20 px-2.5 py-1.5">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink tabular-nums">{Number(p.amount).toFixed(2)} €</p>
                <p className="text-[11px] text-ink-faint">
                  {fmtDate(p.paid_at)} · {PAYMENT_METHOD_LABEL[p.method]}
                  {p.reference ? ` · ${p.reference}` : ''}
                </p>
              </div>
              {canWrite && (
                <button
                  onClick={() => deletePayment.mutate(p.id)}
                  className="p-1 rounded text-ink-faint hover:text-red-500 transition-colors"
                  title="Kustuta makse"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          ))}

          {canWrite && due > 0 && (
            <form onSubmit={submitPayment} className="space-y-2 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number" step="0.01" min="0" value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder={due.toFixed(2)}
                  className="input py-1.5 text-sm text-right"
                />
                <select
                  value={method}
                  onChange={e => setMethod(e.target.value as PaymentMethod)}
                  className="input py-1.5 text-sm"
                >
                  {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map(m => (
                    <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>
                  ))}
                </select>
                <input
                  type="date" value={paidAt}
                  onChange={e => setPaidAt(e.target.value)}
                  className="input py-1.5 text-sm"
                />
                <input
                  value={reference} onChange={e => setReference(e.target.value)}
                  placeholder="Viide" className="input py-1.5 text-sm"
                />
              </div>
              {error && <p className="text-[11px] text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={addPayment.isPending}
                className="w-full btn-ghost justify-center border border-ink-faint/25 disabled:opacity-50"
              >
                <Euro size={13} /> Lisa makse
              </button>
            </form>
          )}
        </section>

        {/* Delete */}
        {canWrite && (
          <section className="pt-1 border-t border-ink-faint/15">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onDelete(invoice)}
                  className="flex-1 text-xs font-semibold text-white bg-red-500 rounded-lg py-1.5"
                >
                  Kustuta jäädavalt
                </button>
                <button onClick={() => setConfirmDelete(false)} className="btn-ghost text-xs">Loobu</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 text-xs text-ink-faint hover:text-red-500 transition-colors"
              >
                <Trash2 size={11} /> Kustuta arve
              </button>
            )}
          </section>
        )}
      </div>
    </aside>
  )
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function Row({ label, value, bold, tone }: {
  label: string; value: string; bold?: boolean; tone?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? 'font-semibold text-ink' : 'text-ink-muted'}>{label}</span>
      <span className={`tabular-nums ${bold ? 'font-bold' : 'font-medium'} ${tone ?? 'text-ink'}`}>
        {value}
      </span>
    </div>
  )
}

function SummaryCard({ icon: Icon, label, value, accent }: {
  icon: typeof FileText; label: string; value: number; accent?: string
}) {
  return (
    <div className="card p-4 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${accent ?? '#0AB6C4'}18` }}
        >
          <Icon size={14} style={{ color: accent ?? '#0AB6C4' }} />
        </div>
        <span className="text-xs font-medium text-ink-muted">{label}</span>
      </div>
      <p className="text-xl font-bold text-ink leading-none tabular-nums">{value.toFixed(2)} €</p>
    </div>
  )
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const parsed = parseISO(d)
  return isValid(parsed) ? format(parsed, 'dd.MM.yyyy', { locale: et }) : '—'
}
