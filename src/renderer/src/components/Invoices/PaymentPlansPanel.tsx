/**
 * Where the payment plans stand.
 *
 * A plan is five invoices that already exist — generated up front, because
 * nothing runs behind a closed desktop app. That makes them easy to create and
 * easy to LOSE: five documents scattered through a list of forty, with nothing
 * on screen saying they are one agreement. This panel is that missing sentence.
 *
 * Every figure comes from `planProgress()`, which reads the INVOICES and never
 * the plan's own numbers. The plan says what was agreed; the invoices say what
 * happened; when they disagree the documents are the truth.
 */
import { useMemo, useState } from 'react'
import { CalendarClock, ChevronDown, ChevronUp, Ban, AlertTriangle } from 'lucide-react'
import type { InvoiceFull } from '../../types/invoice'
import type { PaymentPlan } from '../../types/paymentPlan'
import {
  planProgress, PAYMENT_PLAN_STATUS_LABEL, PAYMENT_PLAN_STATUS_HEX,
} from '../../types/paymentPlan'
import { usePaymentPlans, useCancelPaymentPlan } from '../../hooks/usePaymentPlans'
import { describeError } from '../Patients/errors'

export interface PaymentPlansPanelProps {
  invoices: InvoiceFull[]
  canWrite: boolean
  /** Opens one instalment in the invoice detail panel. */
  onOpenInvoice: (id: string) => void
}

const fmt = (n: number): string => n.toFixed(2)

export function PaymentPlansPanel({ invoices, canWrite, onOpenInvoice }: PaymentPlansPanelProps) {
  const { data: plans = [] } = usePaymentPlans()
  const [open, setOpen] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  // Cancelled plans stay in the list but sink to the bottom: the invoices they
  // produced are still real history and hiding the plan would leave them
  // belonging to nothing.
  const sorted = useMemo(
    () => [...plans].sort((a, b) => {
      const rank = (p: PaymentPlan) => (p.staatus === 'aktiivne' ? 0 : 1)
      return rank(a) - rank(b) || b.created_at.localeCompare(a.created_at)
    }),
    [plans]
  )

  if (sorted.length === 0) return null

  const activeCount = sorted.filter(p => p.staatus === 'aktiivne').length

  return (
    <section className="card p-4 mb-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left"
      >
        <CalendarClock size={15} className="text-accent flex-shrink-0" />
        <span className="text-sm font-semibold text-ink">Maksegraafikud</span>
        <span className="text-xs text-ink-faint">
          {activeCount} aktiivne{sorted.length > activeCount ? ` · ${sorted.length - activeCount} lõpetatud` : ''}
        </span>
        <span className="ml-auto text-ink-faint">
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {sorted.map(plan => (
            <PlanRow
              key={plan.id}
              plan={plan}
              invoices={invoices}
              canWrite={canWrite}
              expanded={expanded === plan.id}
              onToggle={() => setExpanded(expanded === plan.id ? null : plan.id)}
              onOpenInvoice={onOpenInvoice}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function PlanRow({ plan, invoices, canWrite, expanded, onToggle, onOpenInvoice }: {
  plan: PaymentPlan
  invoices: InvoiceFull[]
  canWrite: boolean
  expanded: boolean
  onToggle: () => void
  onOpenInvoice: (id: string) => void
}) {
  const cancel = useCancelPaymentPlan()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const p = useMemo(() => planProgress(plan, invoices), [plan, invoices])
  // Progress by MONEY, not by instalment count: a plan where four small ones
  // are paid and the big one is not is not 80% done.
  const pct = p.billed > 0 ? Math.min(100, Math.round((p.paid / p.billed) * 100)) : 0
  const live = plan.staatus === 'aktiivne'

  return (
    <div className="rounded-xl border border-ink-faint/20 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-sidebar/60 transition-colors"
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: PAYMENT_PLAN_STATUS_HEX[plan.staatus] }}
          title={PAYMENT_PLAN_STATUS_LABEL[plan.staatus]}
        />
        <span className="text-sm font-medium text-ink truncate">{plan.patsient}</span>
        <span className="text-[11px] text-ink-faint tabular-nums flex-shrink-0">
          {p.settledCount}/{plan.osamakseid} tasutud
        </span>

        {p.overdueCount > 0 && (
          <span
            className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-600 flex-shrink-0"
            title={`${fmt(p.overdue)} € üle tähtaja`}
          >
            <AlertTriangle size={9} /> {p.overdueCount} hilinenud
          </span>
        )}

        <span className="ml-auto flex items-center gap-2 flex-shrink-0">
          <span className="text-[11px] text-ink-muted tabular-nums">
            {fmt(p.paid)} / {fmt(p.billed)} €
          </span>
          <span className="text-ink-faint">
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </span>
        </span>
      </button>

      {/* The bar is the fastest read on the row, so it stays visible collapsed. */}
      <div className="h-1 bg-bg-sidebar">
        <div
          className="h-full transition-all"
          style={{
            width: `${pct}%`,
            backgroundColor: p.overdueCount > 0 ? '#EF4444' : PAYMENT_PLAN_STATUS_HEX[plan.staatus],
          }}
        />
      </div>

      {expanded && (
        <div className="px-3 py-2.5 space-y-2 bg-bg-sidebar/40">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted">
            <span>{plan.osamakseid} osamakset</span>
            <span>arve {plan.arve_paev ?? '—'}. kuupäeval</span>
            <span>tähtaeg {plan.maksetahtaeg_paevi} p</span>
            <span className="tabular-nums">laekumata {fmt(p.outstanding)} €</span>
            {p.next && (
              <span className="text-ink">
                järgmine {p.next.instalment_no}/{plan.osamakseid} · {p.next.due_date}
              </span>
            )}
          </div>

          <div className="space-y-0.5">
            {p.invoices.map(inv => {
              const paid = (inv.payments ?? []).reduce((s, x) => s + Number(x.amount), 0)
              const due = Math.max(0, Number(inv.gross_total ?? 0) - paid)
              const cancelled = inv.status === 'tuhistatud'
              return (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => onOpenInvoice(inv.id)}
                  className={`w-full flex items-center gap-2 text-[11px] px-2 py-1 rounded-lg hover:bg-bg-card transition-colors ${
                    cancelled ? 'opacity-50 line-through' : ''
                  }`}
                >
                  <span className="w-8 text-ink-faint tabular-nums text-left">
                    {inv.instalment_no}/{plan.osamakseid}
                  </span>
                  <span className="text-ink-muted tabular-nums">{inv.number}</span>
                  <span className="text-ink-faint tabular-nums">{inv.due_date}</span>
                  <span className="ml-auto tabular-nums text-ink">
                    {fmt(Number(inv.gross_total ?? 0))} €
                  </span>
                  <span
                    className={`w-16 text-right tabular-nums ${
                      cancelled ? 'text-ink-faint'
                        : due <= 0.005 ? 'text-emerald-600'
                        : 'text-orange-600'
                    }`}
                  >
                    {cancelled ? 'tühistatud' : due <= 0.005 ? 'tasutud' : `${fmt(due)} €`}
                  </span>
                </button>
              )
            })}
          </div>

          {error && <p className="text-[11px] text-red-600">{error}</p>}

          {canWrite && live && (
            <div className="flex items-center gap-2 pt-1">
              {confirming ? (
                <>
                  {/* Said in full before it happens: this stops the future and
                      is NOT a refund — a receipt cannot be reversed, so a paid
                      instalment is left exactly as it is. */}
                  <span className="text-[11px] text-ink-muted">
                    Tühistab {p.invoices.filter(i =>
                      i.status !== 'tuhistatud'
                      && (i.payments ?? []).reduce((s, x) => s + Number(x.amount), 0) <= 0.005
                    ).length} maksmata osamakset. Juba laekunut ei tagastata.
                  </span>
                  <button
                    type="button"
                    disabled={cancel.isPending}
                    onClick={async () => {
                      setError(null)
                      try { await cancel.mutateAsync(plan.id) }
                      catch (err) { setError(describeError(err)) }
                      finally { setConfirming(false) }
                    }}
                    className="text-[11px] font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                  >
                    Tühista graafik
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="text-[11px] text-ink-muted hover:text-ink"
                  >
                    Loobu
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="flex items-center gap-1 text-[11px] text-ink-muted hover:text-red-600 transition-colors"
                >
                  <Ban size={11} /> Peata graafik
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
