import { format, isValid, parseISO } from 'date-fns'
import type { patientStats } from './derive'
import { t } from '@/lib/i18n'

// The strip is dumb on purpose: derive.ts owns every number, this file only
// formats them. Typing off the function keeps the two in lockstep.
type PatientStats = ReturnType<typeof patientStats>

interface PatientStatStripProps {
  stats: PatientStats
}

export function PatientStatStrip({ stats }: PatientStatStripProps) {
  const last = stats.latestJobDate ? parseISO(stats.latestJobDate) : null
  const lastLabel = last && isValid(last) ? format(last, 'dd.MM.yyyy') : '—'

  // One card, four divided cells — it sits in the 40% column beside the identity
  // card, so four separate floating cards would be too cramped. h-full keeps its
  // height matched to the identity card next to it.
  return (
    <div className="card h-full grid grid-cols-2 xl:grid-cols-4 divide-x divide-y xl:divide-y-0 divide-ink-faint/15">
      <StatCard
        label={t('patients.totalJobs')}
        value={String(stats.jobCount)}
        sub={t('patients.latest', { lastLabel })}
      />
      <StatCard
        label={t('patients.teethWorkedOn')}
        value={String(stats.totalTeeth)}
        sub={t('patients.originalRevisionRevisions', { stats, originalTeeth: stats.originalTeeth, revisionTeeth: stats.revisionTeeth })}
      />
      <StatCard
        label={t('patients.invoiced')}
        value={`${stats.totalInvoiced.toFixed(2)} €`}
      />
      <StatCard
        label={t('patients.unpaid')}
        value={`${stats.unpaidTotal.toFixed(2)} €`}
        sub={t('patients.invoiceInvoices', { stats, unpaidCount: stats.unpaidCount })}
        danger={stats.unpaidTotal > 0}
      />
    </div>
  )
}

function StatCard({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="px-3 py-3 flex flex-col justify-center min-w-0">
      <p className="text-[11px] font-medium text-ink-muted truncate">{label}</p>
      <p className={`text-xl font-bold leading-tight ${danger ? 'text-orange-600' : 'text-ink'}`}>{value}</p>
      {sub && <p className="text-[10px] text-ink-faint truncate" title={sub}>{sub}</p>}
    </div>
  )
}
