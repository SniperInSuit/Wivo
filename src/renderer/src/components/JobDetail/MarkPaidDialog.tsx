/**
 * Marking work paid — and saying HOW.
 *
 * `jobs.makstud` is a boolean and answers only "did money arrive". It cannot
 * answer "in what form", which is the question the owner actually has to
 * report on and reconcile against a till or a bank statement. So every route to
 * "makstud" now goes through this dialog and writes a real `payments` row
 * alongside the flag: the flag keeps the old screens working, the row is what
 * the statistics count.
 *
 * Supports split payments: 800€ card + 200€ cash in one go, without reopening.
 */
import { useState } from 'react'
import { motion } from 'framer-motion'
import { X, Euro, Loader2, Plus, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from '../../types/invoice'

export interface PaidDetails {
  method: PaymentMethod
  paid_at: string
  reference: string | null
  /** What was actually handed over. Less than the total is a part payment: the
   *  row is written, the job stays unpaid, and the rest stays owed. */
  amount?: number
}

/** Multiple payment lines — each becomes a separate payments row. */
export type PaidDetailsList = PaidDetails[]

interface PaymentLine {
  id: string
  method: PaymentMethod
  amount: string
  reference: string
  paidAt: string
}

interface MarkPaidDialogProps {
  title: string
  /** Total value of what is being settled. */
  amount?: number | null
  /** Already received against it, so the field can default to what is left. */
  alreadyPaid?: number
  /** More than one job — the same method and date apply to all of them, and the
   *  amount is not editable, because one field cannot split across many jobs. */
  count?: number
  busy?: boolean
  onConfirm: (details: PaidDetails) => void
  /** If provided, supports split payments — called instead of onConfirm. */
  onConfirmMulti?: (details: PaidDetailsList) => void
  onClose: () => void
}

export function MarkPaidDialog({
  title, amount, alreadyPaid = 0, count, busy, onConfirm, onConfirmMulti, onClose,
}: MarkPaidDialogProps) {
  const outstanding = Math.round(((amount ?? 0) - alreadyPaid) * 100) / 100
  const single = !count || count <= 1

  const today = format(new Date(), 'yyyy-MM-dd')

  // Payment lines — start with one
  const [lines, setLines] = useState<PaymentLine[]>(() => [{
    id: crypto.randomUUID(),
    method: 'ulekanne',
    amount: outstanding > 0 ? outstanding.toFixed(2) : '',
    reference: '',
    paidAt: today
  }])

  function addLine() {
    const used = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
    const remaining = Math.max(0, outstanding - used)
    setLines(prev => [...prev, {
      id: crypto.randomUUID(),
      method: 'sularaha',
      amount: remaining > 0 ? remaining.toFixed(2) : '',
      reference: '',
      paidAt: today
    }])
  }

  function removeLine(id: string) {
    if (lines.length <= 1) return
    setLines(prev => prev.filter(l => l.id !== id))
  }

  function updateLine(id: string, updates: Partial<PaymentLine>) {
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l))
  }

  // When first line amount changes and there are other lines, auto-adjust last line
  function setFirstAmount(value: string) {
    updateLine(lines[0].id, { amount: value })
    if (lines.length === 2) {
      const first = parseFloat(value) || 0
      const rest = Math.max(0, outstanding - first)
      updateLine(lines[1].id, { amount: rest > 0 ? rest.toFixed(2) : '0' })
    }
  }

  const totalEntered = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
  const isPartial = single && totalEntered > 0 && totalEntered < outstanding
  const valid = lines.every(l => {
    const a = parseFloat(l.amount)
    return Number.isFinite(a) && a > 0
  })

  function handleSubmit() {
    if (onConfirmMulti && lines.length > 1) {
      onConfirmMulti(lines.map(l => ({
        method: l.method,
        paid_at: l.paidAt,
        reference: l.reference.trim() || null,
        amount: parseFloat(l.amount),
      })))
    } else {
      // Single line — use original onConfirm for backward compat
      const l = lines[0]
      onConfirm({
        method: l.method,
        paid_at: l.paidAt,
        reference: l.reference.trim() || null,
        ...(single && Number.isFinite(parseFloat(l.amount)) ? { amount: parseFloat(l.amount) } : {}),
      })
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
        onClick={e => e.stopPropagation()}
        className="bg-bg-card rounded-2xl shadow-panel w-[460px] max-w-dialog overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-ink-faint/15">
          <h2 className="text-sm font-bold text-ink flex items-center gap-2">
            <Euro size={15} className="text-accent" /> {title}
          </h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><X size={14} /></button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {(amount != null || count != null) && (
            <p className="text-xs text-ink-muted">
              {count != null && count > 1 && <>{count} tööd · </>}
              {amount != null && (
                <>Kokku <strong className="text-ink tabular-nums">{amount.toFixed(2)} €</strong></>
              )}
              {alreadyPaid > 0 && (
                <> · juba laekunud <span className="tabular-nums">{alreadyPaid.toFixed(2)} €</span>
                  {' · '}jääk <strong className="text-ink tabular-nums">{outstanding.toFixed(2)} €</strong>
                </>
              )}
            </p>
          )}

          {/* Payment lines */}
          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={line.id} className={`rounded-xl border p-3 space-y-2 ${
                lines.length > 1 ? 'border-ink-faint/20 bg-bg-sidebar/30' : 'border-transparent'
              }`}>
                {lines.length > 1 && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-ink-muted uppercase">Makse {idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      className="text-ink-faint hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}

                <div className="flex gap-2">
                  {/* Date */}
                  <div className="w-32">
                    <label className="label">Kuupäev</label>
                    <input
                      type="date" value={line.paidAt}
                      onChange={e => updateLine(line.id, { paidAt: e.target.value })}
                      className="input"
                    />
                  </div>

                  {/* Amount */}
                  {single && (
                    <div className="w-28">
                      <label className="label">Summa</label>
                      <div className="relative">
                        <input
                          type="number" min="0" step="0.01"
                          value={line.amount}
                          onChange={e => idx === 0 && lines.length === 2
                            ? setFirstAmount(e.target.value)
                            : updateLine(line.id, { amount: e.target.value })
                          }
                          className="input pr-7 text-right"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-faint pointer-events-none">€</span>
                      </div>
                    </div>
                  )}

                  {/* Reference */}
                  <div className="flex-1">
                    <label className="label">Viide</label>
                    <input
                      value={line.reference}
                      onChange={e => updateLine(line.id, { reference: e.target.value })}
                      placeholder="Vabatahtlik"
                      className="input"
                    />
                  </div>
                </div>

                {/* Method */}
                <div>
                  <label className="label">Makseviis</label>
                  <div className="grid grid-cols-2 gap-1">
                    {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => updateLine(line.id, { method: m })}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border-2 transition-all duration-100 ${
                          line.method === m
                            ? 'bg-accent text-white border-accent'
                            : 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
                        }`}
                      >
                        {PAYMENT_METHOD_LABEL[m]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Add another payment line */}
          {single && (
            <button
              type="button"
              onClick={addLine}
              className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover font-medium transition-colors"
            >
              <Plus size={12} />
              Lisa teine makseviis
            </button>
          )}

          {/* Summary */}
          {lines.length > 1 && (
            <div className="flex items-center justify-between px-1 pt-1 border-t border-ink-faint/15">
              <span className="text-xs text-ink-muted">Kokku makstud</span>
              <span className={`text-sm font-bold tabular-nums ${
                Math.abs(totalEntered - outstanding) < 0.01 ? 'text-emerald-600' : 'text-ink'
              }`}>
                {totalEntered.toFixed(2)} €
              </span>
            </div>
          )}

          {isPartial && (
            <p className="text-[11px] text-orange-600 leading-relaxed">
              Osaline makse. Töö jääb <strong>maksmata</strong> seisu ja jääk{' '}
              {(outstanding - totalEntered).toFixed(2)} € on endiselt võlgu.
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-ink-faint/15 flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn-ghost border border-ink-faint/25">Loobu</button>
          <button
            onClick={handleSubmit}
            disabled={busy || !valid}
            className="btn-primary disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Euro size={13} />}
            {isPartial ? 'Salvesta osamakse' : lines.length > 1 ? 'Salvesta maksed' : 'Märgi makstuks'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
