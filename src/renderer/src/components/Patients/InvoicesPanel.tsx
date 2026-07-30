import { Euro } from 'lucide-react'
import { format, parseISO, isValid } from 'date-fns'
import { PanelCard } from './PanelCard'
import type { patientStats } from './derive'
import { PAYMENT_METHOD_LABEL, type Payment, type PaymentMethod } from '../../types/invoice'

interface InvoicesPanelProps {
  stats: ReturnType<typeof patientStats>
  /** Every payment this patient has made, across jobs and invoices. */
  payments: Payment[]
}

export function InvoicesPanel({ stats, payments }: InvoicesPanelProps) {
  // How they pay, not just how much. A patient who always pays cash and one who
  // always transfers are different to chase, and the totals alone cannot say
  // which is which.
  const byMethod = new Map<PaymentMethod, { count: number; amount: number }>()
  for (const p of payments) {
    const b = byMethod.get(p.method) ?? { count: 0, amount: 0 }
    b.count++
    b.amount += Number(p.amount)
    byMethod.set(p.method, b)
  }
  const methods = [...byMethod.entries()].sort((a, b) => b[1].amount - a[1].amount)
  const recent = [...payments]
    .sort((a, b) => b.paid_at.localeCompare(a.paid_at))
    .slice(0, 6)

  return (
    <PanelCard title="ARVED" icon={Euro}>
      <div className="space-y-2 text-sm">
        <Row dot="bg-accent" label="Arveldatud" value={stats.totalInvoiced} />
        <Row dot="bg-green-500" label="Makstud" value={stats.paidTotal} />
        <Row dot="bg-red-200" label="Tasumata" value={stats.unpaidTotal} />
      </div>

      <p className="text-[11px] text-ink-muted">
        {stats.unpaidCount} tasumata arvet
        {stats.partialCount > 0 && (
          <span className="text-orange-600"> · {stats.partialCount} osaliselt makstud</span>
        )}
      </p>

      {methods.length > 0 && (
        <div className="pt-2 border-t border-ink-faint/15 space-y-1">
          <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider">
            Makseviisid
          </p>
          {methods.map(([m, b]) => (
            <div key={m} className="flex items-center justify-between text-xs">
              <span className="text-ink-muted">
                {PAYMENT_METHOD_LABEL[m] ?? m}
                <span className="text-ink-faint"> · {b.count}×</span>
              </span>
              <span className="tabular-nums font-medium text-ink">{b.amount.toFixed(2)} €</span>
            </div>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div className="pt-2 border-t border-ink-faint/15 space-y-1">
          <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider">
            Viimased maksed
          </p>
          {recent.map(p => (
            <div key={p.id} className="flex items-center gap-2 text-[11px]">
              <span className="text-ink-faint tabular-nums w-16 flex-shrink-0">
                {fmtDate(p.paid_at)}
              </span>
              <span className="text-ink-muted truncate flex-1">
                {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                {p.reference ? ` · ${p.reference}` : ''}
              </span>
              <span className="tabular-nums font-medium text-ink flex-shrink-0">
                {Number(p.amount).toFixed(2)} €
              </span>
            </div>
          ))}
          {payments.length > recent.length && (
            <p className="text-[10px] text-ink-faint">
              Näidatud {recent.length} viimast {payments.length}-st.
            </p>
          )}
        </div>
      )}

      {payments.length === 0 && (
        <p className="text-[10px] text-ink-faint">
          Makseid ei ole veel kirja pandud. Vanad "makstud" märked tehti enne
          maksete jälgimist ja neil ei ole makseviisi.
        </p>
      )}
    </PanelCard>
  )
}

function fmtDate(d: string): string {
  const p = parseISO(d)
  return isValid(p) ? format(p, 'dd.MM.yy') : '—'
}

function Row({ dot, label, value }: { dot: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-3 h-3 rounded-full inline-block flex-shrink-0 ${dot}`} />
      <span className="text-ink-muted truncate">{label}</span>
      <span className="font-semibold ml-auto">{value.toFixed(2)} €</span>
    </div>
  )
}
