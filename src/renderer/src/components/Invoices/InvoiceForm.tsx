/**
 * Create an invoice from a patient's unbilled work.
 *
 * The line list is built by COPYING description and price off the job at this
 * moment. It is not a live join: once this document is issued, editing the job's
 * price must not restate what the customer was told to pay.
 */
import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Plus, Trash2, Loader2, FileText } from 'lucide-react'
import { format, addDays, parseISO } from 'date-fns'
import type { Job } from '../../types/job'
import { revisionReasonLabel, jobWorkItems } from '../../types/job'
import { useSettings } from '../../stores/useSettings'
import { useCreateInvoice, useInvoices, type CreateInvoiceInput } from '../../hooks/useInvoices'
import { PatientPicker } from '../Patients/PatientPicker'
import { describeError } from '../Patients/errors'
import { jobTotalValue } from '../../lib/jobPayments'
import { useCustomers } from '../../hooks/useCustomers'
import type { BillToKind } from '../../types/customer'
import { toDate } from '../../lib/dates'
import { instalmentSchedule, splitAmount } from '@shared/billing/instalments'

interface DraftLine {
  key: string
  job_id: string | null
  revision_id: string | null
  description: string
  qty: number
  unit_price: number
}

interface InvoiceFormProps {
  jobs: Job[]
  initialPatient?: { id: string | null; nimi: string }
  onClose: () => void
  onCreated?: (invoiceId: string) => void
}

export function InvoiceForm({ jobs, initialPatient, onClose, onCreated }: InvoiceFormProps) {
  const { settings } = useSettings()
  const createInvoice = useCreateInvoice()
  const { data: invoices = [] } = useInvoices()
  const { data: customers = [] } = useCustomers()

  const [patsient, setPatsient] = useState(initialPatient?.nimi ?? '')
  const [patientId, setPatientId] = useState<string | null>(initialPatient?.id ?? null)
  // Who this document is addressed to. A lab bills the ordering practice; the
  // patient route stays because clinic work and legacy documents both use it.
  const [billTo, setBillTo] = useState<BillToKind>('patient')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [issueDate, setIssueDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [vatRate, setVatRate] = useState(settings.kmMaar)
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  // Split into equal monthly instalments. Generated up front as real documents
  // rather than as a recurring rule: a desktop app has nothing running when it
  // is closed, so a rule that "fires next month" would simply never fire.
  const [instalments, setInstalments] = useState(1)
  const [error, setError] = useState<string | null>(null)

  // Clearing the issue date leaves '' here, and parseISO('') is an Invalid Date
  // that format() throws on — during render, so the whole invoice screen went
  // behind the error boundary instead of showing an empty due date.
  const dueDate = useMemo(() => {
    const d = toDate(issueDate)
    return d ? format(addDays(d, settings.makseTahtaegPaevades), 'yyyy-MM-dd') : ''
  }, [issueDate, settings.makseTahtaegPaevades])

  // Every job_id already on any invoice. Billing the same job twice is the
  // mistake this screen most needs to prevent, so those jobs are not offered.
  const billedJobIds = useMemo(() => {
    const set = new Set<string>()
    for (const inv of invoices) {
      if (inv.status === 'tuhistatud') continue
      for (const l of inv.lines) if (l.job_id) set.add(`${l.job_id}:${l.revision_id ?? ''}`)
    }
    return set
  }, [invoices])

  const patientKey = patsient.trim().toLowerCase()

  // Candidate work, minus what is already billed and minus what is already on
  // this draft. WHOSE work depends on the addressee: a customer invoice covers
  // everything that practice ordered, whoever the patients were.
  const candidates = useMemo(() => {
    if (billTo === 'customer' ? !customerId : !patientKey) return []
    const onDraft = new Set(lines.map(l => `${l.job_id}:${l.revision_id ?? ''}`))
    const out: DraftLine[] = []

    for (const j of jobs) {
      const matches = billTo === 'customer'
        ? j.customer_id === customerId
        : (patientId && j.patient_id === patientId)
          || (j.patsient ?? '').trim().toLowerCase() === patientKey
      if (!matches) continue

      const jobKey = `${j.id}:`
      if (!billedJobIds.has(jobKey) && !onDraft.has(jobKey)) {
        out.push({
          key: jobKey,
          job_id: j.id,
          revision_id: null,
          description: [
            // All work types, not just the first one
            [...new Set(jobWorkItems(j).map(i => i.too))].join(' + ') || j.too?.trim() || 'Töö',
            billTo === 'customer'
              ? (j.customer_ref?.trim() || j.patsient?.trim() || null)
              : null,
            j.hambad ? `hambad ${j.hambad}` : null,
            (j.extras ?? []).length > 0
              ? (j.extras ?? []).map(e => e.nimi).join(', ')
              : null,
          ].filter(Boolean).join(' · '),
          qty: 1,
          // Through jobTotalValue, not summed by hand: this line and the job's
          // own payment state must agree about what the job is worth, and they
          // did not while extras were missing from one of them.
          unit_price: jobTotalValue(j),
        })
      }

      // Revisions are billed as their own lines — they have their own price and
      // are frequently charged separately from the original work.
      for (const [i, r] of (j.revisions ?? []).entries()) {
        const revKey = `${j.id}:${r.id}`
        if (billedJobIds.has(revKey) || onDraft.has(revKey)) continue
        if (!r.price) continue
        out.push({
          key: revKey,
          job_id: j.id,
          revision_id: r.id,
          description: `${j.too?.trim() || 'Töö'} — muudatus #${i + 1}${
            revisionReasonLabel(r) ? ` (${revisionReasonLabel(r)})` : ''}`,
          qty: 1,
          unit_price: Number(r.price),
        })
      }
    }
    return out
  }, [jobs, billTo, customerId, patientKey, patientId, billedJobIds, lines])

  const net = Math.round(lines.reduce((s, l) => s + l.qty * l.unit_price, 0) * 100) / 100
  const vat = Math.round(net * vatRate) / 100
  const gross = Math.round((net + vat) * 100) / 100

  const addLine = (l: DraftLine) => setLines(prev => [...prev, l])
  const addBlank = () => setLines(prev => [...prev, {
    key: `manual-${prev.length}-${prev.reduce((n, x) => n + x.key.length, 0)}`,
    job_id: null, revision_id: null, description: '', qty: 1, unit_price: 0,
  }])
  const patchLine = (key: string, patch: Partial<DraftLine>) =>
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)))
  const removeLine = (key: string) => setLines(prev => prev.filter(l => l.key !== key))

  const addresseeOk = billTo === 'customer' ? !!customerId : patsient.trim().length > 0
  // An invoice with no issue date has no period, no due date and no place in a
  // sequence. Blocked here rather than left to Postgres, because the instalment
  // path formats this date and would throw before the insert was even attempted.
  const canSave =
    addresseeOk && lines.length > 0 && !!toDate(issueDate) && !createInvoice.isPending

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!canSave) return
    const input: CreateInvoiceInput = {
      // The check constraint in sql/035 requires these to agree: a customer
      // invoice carries customer_id and no patient_id, and vice versa.
      patient_id: billTo === 'customer' ? null : patientId,
      patsient: billTo === 'customer'
        ? (customers.find(c => c.id === customerId)?.name ?? '')
        : patsient.trim(),
      customer_id: billTo === 'customer' ? customerId : null,
      bill_to_kind: billTo,
      issue_date: issueDate,
      due_date: dueDate || null,
      vat_rate: vatRate,
      note: note.trim() || null,
      lines: lines.map((l, i) => ({
        job_id: l.job_id,
        revision_id: l.revision_id,
        description: l.description.trim() || 'Töö',
        qty: l.qty,
        unit_price: l.unit_price,
        sort_order: i,
      })),
    }
    try {
      if (instalments <= 1) {
        const invoice = await createInvoice.mutateAsync(input)
        onCreated?.(invoice.id)
        onClose()
        return
      }

      // Dates from instalmentSchedule, money from splitAmount — the same two
      // functions the plan preview uses, so what was shown and what is written
      // down cannot disagree. Both live in shared/billing because the scheduled
      // sender will need them too.
      const schedule = instalmentSchedule({
        total: gross,
        count: instalments,
        firstIssue: input.issue_date,
        termDays: settings.makseTahtaegPaevades,
      })
      if (schedule.length !== instalments) {
        setError('Maksegraafikut ei õnnestu koostada — kontrolli kuupäeva ja summat.')
        return
      }

      // EVERY instalment carries the job link, with its own share of the value.
      // Instalment 1 used to carry it alone, which meant `paidForJob` — which
      // credits a job from its invoice LINES, pro rata — saw nothing for
      // instalments 2..n. A job paid off over five months stayed 1/5 paid on
      // its own panel, on the patient page and in Laekumata, forever. Billing
      // it twice is not a risk: `billedJobIds` is a Set.
      const perLine = new Map(
        input.lines.map(l => [l.sort_order, splitAmount(l.qty * l.unit_price, instalments)])
      )
      let first: Awaited<ReturnType<typeof createInvoice.mutateAsync>> | null = null

      for (const part of schedule) {
        const k = part.no - 1
        const linesForK = input.lines.map(l => ({
          ...l,
          description: `${l.description} — osamakse ${part.no}/${instalments}`,
          qty: 1,
          unit_price: perLine.get(l.sort_order)?.[k] ?? 0,
        }))

        const inv = await createInvoice.mutateAsync({
          ...input,
          issue_date: part.issueDate,
          due_date: part.dueDate,
          note: [input.note, `Osamakse ${part.no}/${instalments}`].filter(Boolean).join(' · '),
          lines: linesForK,
        })
        if (part.no === 1) first = inv
      }

      if (first) onCreated?.(first.id)
      onClose()
    } catch (err) {
      setError(describeError(err))
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <motion.form
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="bg-bg-card rounded-2xl shadow-panel w-[720px] max-w-dialog max-h-panel flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-ink-faint/15 flex-shrink-0">
          <h2 className="text-sm font-bold text-ink flex items-center gap-2">
            <FileText size={15} className="text-accent" /> Uus arve
          </h2>
          <button type="button" onClick={onClose} className="btn-ghost p-1.5"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Saaja</label>
              {/* Switching clears the other side's selection: an invoice
                  addressed to a customer must not carry a patient_id, and the
                  DB refuses the row if it does. */}
              <div className="flex items-center gap-1 bg-bg-sidebar rounded-lg p-0.5 w-fit mb-2">
                {([
                  { key: 'customer' as const, label: 'Klient' },
                  { key: 'patient'  as const, label: 'Patsient' },
                ]).map(o => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => {
                      setBillTo(o.key)
                      setLines([])
                      if (o.key === 'customer') { setPatsient(''); setPatientId(null) }
                      else setCustomerId(null)
                    }}
                    className={`text-xs font-medium px-3 py-1 rounded-md transition-colors ${
                      billTo === o.key ? 'chip-active' : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {billTo === 'customer' ? (
                <select
                  value={customerId ?? ''}
                  onChange={e => { setCustomerId(e.target.value || null); setLines([]) }}
                  className="input"
                >
                  <option value="">Vali klient…</option>
                  {customers.filter(c => !c.archived_at).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              ) : (
                <PatientPicker
                  name={patsient}
                  patientId={patientId}
                  onChange={(nimi, pid) => { setPatsient(nimi); setPatientId(pid) }}
                  required
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Kuupäev</label>
                <input
                  type="date" value={issueDate}
                  onChange={e => setIssueDate(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Maksetähtaeg</label>
                <input type="date" value={dueDate} readOnly className="input opacity-70" />
              </div>
            </div>
          </div>

          {/* ── Unbilled work ── */}
          <div>
            <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
              Arveldamata töö {patientKey && `(${candidates.length})`}
            </p>
            {!patientKey ? (
              <p className="text-xs text-ink-faint">Vali patsient, et näha tema arveldamata töid.</p>
            ) : candidates.length === 0 ? (
              <p className="text-xs text-ink-faint">
                Arveldamata töid ei ole. Kõik selle patsiendi tööd on juba arvel.
              </p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                {candidates.map(c => (
                  <button
                    key={c.key} type="button" onClick={() => addLine(c)}
                    className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-lg
                      border border-ink-faint/20 hover:border-accent/40 transition-colors"
                  >
                    <Plus size={11} className="text-accent flex-shrink-0" />
                    <span className="text-xs text-ink truncate flex-1">{c.description}</span>
                    <span className="text-xs font-semibold text-ink tabular-nums flex-shrink-0">
                      {c.unit_price.toFixed(2)} €
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Lines ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                Arve read ({lines.length})
              </p>
              <button type="button" onClick={addBlank} className="btn-ghost text-xs border border-ink-faint/25">
                <Plus size={12} /> Lisa rida
              </button>
            </div>

            {lines.length === 0 ? (
              <p className="text-xs text-ink-faint">Ridu ei ole. Lisa ülalt või käsitsi.</p>
            ) : (
              <div className="space-y-1.5">
                <div className="grid grid-cols-[1fr_60px_90px_28px] gap-2 px-1">
                  <span className="text-[10px] font-semibold text-ink-faint uppercase">Kirjeldus</span>
                  <span className="text-[10px] font-semibold text-ink-faint uppercase text-center">Kogus</span>
                  <span className="text-[10px] font-semibold text-ink-faint uppercase text-right">Hind</span>
                  <span />
                </div>
                {lines.map(l => (
                  <div key={l.key} className="grid grid-cols-[1fr_60px_90px_28px] gap-2 items-center">
                    <input
                      value={l.description}
                      onChange={e => patchLine(l.key, { description: e.target.value })}
                      placeholder="Kirjeldus"
                      className="input py-1.5 text-sm"
                    />
                    <input
                      type="number" min="0" step="0.5" value={l.qty}
                      onChange={e => patchLine(l.key, { qty: parseFloat(e.target.value) || 0 })}
                      className="input py-1.5 text-sm text-center"
                    />
                    <input
                      type="number" min="0" step="0.01" value={l.unit_price}
                      onChange={e => patchLine(l.key, { unit_price: parseFloat(e.target.value) || 0 })}
                      className="input py-1.5 text-sm text-right"
                    />
                    <button
                      type="button" onClick={() => removeLine(l.key)}
                      className="p-1.5 rounded text-ink-faint hover:text-red-500 transition-colors"
                      title="Eemalda rida"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="label">Jaga osamakseteks</label>
            <div className="flex items-center gap-2">
              <input
                type="number" min="1" max="24" value={instalments}
                onChange={e => setInstalments(Math.max(1, Math.min(24, parseInt(e.target.value) || 1)))}
                className="input py-1.5 text-sm w-20 text-right"
              />
              <span className="text-xs text-ink-muted">
                {instalments > 1
                  ? `${instalments} arvet, üks kuus, igaüks ${(gross / instalments).toFixed(2)} €`
                  : 'kuud (1 = üks arve)'}
              </span>
            </div>
            {instalments > 1 && (
              <p className="text-[11px] text-ink-faint mt-1 leading-relaxed">
                Kõik arved luuakse kohe mustanditena, kuupäevadega kuu kaupa edasi.
                Esimene arve seob tööd, ülejäänud on samade ridade osamaksed — seega
                tööd ei arveldata mitu korda. Viimane arve võtab ümardusjäägi.
              </p>
            )}
          </div>

          <div>
            <label className="label">Märkus arvel</label>
            <textarea
              value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="Nähtav arvel…" className="input resize-none"
            />
          </div>
        </div>

        {/* ── Totals + actions ── */}
        <div className="border-t border-ink-faint/15 px-5 py-3 flex-shrink-0 space-y-2">
          {error && (
            <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
              {error}
            </p>
          )}
          <div className="flex items-end justify-between gap-4">
            <div className="flex items-end gap-3">
              <div>
                <label className="label">KM %</label>
                <input
                  type="number" min="0" max="30" step="0.5" value={vatRate}
                  onChange={e => setVatRate(parseFloat(e.target.value) || 0)}
                  className="input py-1.5 text-sm w-20 text-right"
                />
              </div>
              <div className="text-xs text-ink-muted space-y-0.5 pb-1">
                <div className="flex gap-3 justify-between"><span>Summa</span><span className="tabular-nums font-medium text-ink">{net.toFixed(2)} €</span></div>
                <div className="flex gap-3 justify-between"><span>KM</span><span className="tabular-nums font-medium text-ink">{vat.toFixed(2)} €</span></div>
                <div className="flex gap-3 justify-between border-t border-ink-faint/20 pt-0.5">
                  <span className="font-semibold text-ink">Kokku</span>
                  <span className="tabular-nums font-bold text-accent">{gross.toFixed(2)} €</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="btn-ghost border border-ink-faint/25">
                Loobu
              </button>
              <button type="submit" disabled={!canSave} className="btn-primary disabled:opacity-50">
                {createInvoice.isPending ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                Loo arve
              </button>
            </div>
          </div>
        </div>
      </motion.form>
    </motion.div>
  )
}
