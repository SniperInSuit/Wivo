/**
 * Marking work paid — and saying HOW.
 *
 * `jobs.makstud` is a boolean and answers only "did money arrive". It cannot
 * answer "in what form", which is the question the owner actually has to
 * report on and reconcile against a till or a bank statement. So every route to
 * "makstud" now goes through this dialog and writes a real `payments` row
 * alongside the flag: the flag keeps the old screens working, the row is what
 * the statistics count.
 */
import { useState } from 'react'
import { motion } from 'framer-motion'
import { X, Euro, Loader2 } from 'lucide-react'
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
  onClose: () => void
}

export function MarkPaidDialog({
  title, amount, alreadyPaid = 0, count, busy, onConfirm, onClose,
}: MarkPaidDialogProps) {
  const outstanding = Math.round(((amount ?? 0) - alreadyPaid) * 100) / 100
  const single = !count || count <= 1

  const [method, setMethod] = useState<PaymentMethod>('ulekanne')
  const [paidAt, setPaidAt] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [reference, setReference] = useState('')
  const [sum, setSum] = useState(() => (outstanding > 0 ? outstanding.toFixed(2) : ''))

  const entered = parseFloat(sum)
  const valid = !single || !Number.isFinite(entered) || entered > 0
  const partial = single && Number.isFinite(entered) && entered > 0 && entered < outstanding

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
        onClick={e => e.stopPropagation()}
        className="bg-bg-card rounded-2xl shadow-panel w-[420px] max-w-dialog overflow-hidden"
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

          {/* Editable only for a single job: one number cannot be divided across
              a batch in any way the user could predict. */}
          {single && (
            <div>
              <label className="label">Makstud summa</label>
              <div className="relative w-40">
                <input
                  type="number" min="0" step="0.01" value={sum}
                  onChange={e => setSum(e.target.value)}
                  className="input pr-7 text-right"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-faint pointer-events-none">€</span>
              </div>
              {partial && (
                <p className="text-[11px] text-orange-600 mt-1 leading-relaxed">
                  Osaline makse. Töö jääb <strong>maksmata</strong> seisu ja jääk{' '}
                  {(outstanding - entered).toFixed(2)} € on endiselt võlgu.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="label">Kuidas maksti?</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-all duration-100 ${
                    method === m
                      ? 'bg-accent text-white border-accent'
                      : 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
                  }`}
                >
                  {PAYMENT_METHOD_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Kuupäev</label>
              <input
                type="date" value={paidAt}
                onChange={e => setPaidAt(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="label">Viide</label>
              <input
                value={reference}
                onChange={e => setReference(e.target.value)}
                placeholder="Vabatahtlik"
                className="input"
              />
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-ink-faint/15 flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn-ghost border border-ink-faint/25">Loobu</button>
          <button
            onClick={() => onConfirm({
              method,
              paid_at: paidAt,
              reference: reference.trim() || null,
              ...(single && Number.isFinite(entered) ? { amount: entered } : {}),
            })}
            disabled={busy || !valid}
            className="btn-primary disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Euro size={13} />}
            {partial ? 'Salvesta osamakse' : 'Märgi makstuks'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
