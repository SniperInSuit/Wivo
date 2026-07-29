import { Euro } from 'lucide-react'
import { PanelCard } from './PanelCard'
import type { patientStats } from './derive'

interface InvoicesPanelProps {
  stats: ReturnType<typeof patientStats>
}

export function InvoicesPanel({ stats }: InvoicesPanelProps) {
  return (
    <PanelCard title="ARVED" icon={Euro}>
      <div className="space-y-2 text-sm">
        <Row dot="bg-accent" label="Arveldatud" value={stats.totalInvoiced} />
        <Row dot="bg-green-500" label="Makstud" value={stats.paidTotal} />
        <Row dot="bg-red-200" label="Tasumata" value={stats.unpaidTotal} />
      </div>

      <p className="text-[11px] text-ink-muted">
        {stats.unpaidCount} tasumata arvet
      </p>

      {/* `makstud` is one boolean per job (types/job.ts:45) — there is nowhere to
          record a part-payment, so these three numbers are all-or-nothing. */}
      <p className="text-[10px] text-ink-faint">
        Osalisi makseid ei saa hetkel märkida — töö on kas makstud või maksmata.
      </p>
    </PanelCard>
  )
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
