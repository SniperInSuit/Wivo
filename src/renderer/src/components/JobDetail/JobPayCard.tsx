/**
 * What this job pays the people on it, large (spec, Phase 1: "technician's
 * pay, large, on the job — from the existing rule engine").
 *
 * Shows only what the database lets the viewer read: `worker_rates` returns a
 * worker their own rates and a payroll manager everybody's (sql/022, 027).
 * Someone who may not see a colleague's pay simply sees no card for them.
 */
import { Wallet } from 'lucide-react'
import type { Job } from '../../types/job'
import { useWorkerRates } from '../../hooks/useWorkerPay'
import { useClinicProfiles } from '../../hooks/useClinicProfiles'
import { useWorkTypes } from '../../stores/useSettings'
import { usePipeline } from '../../context/PipelineContext'
import { projectedJobPay } from '../../lib/jobPay'
import { t } from '@/lib/i18n'

export function JobPayCard({ job }: { job: Job }) {
  const { data: rates = [] } = useWorkerRates()
  const { data: profiles = [] } = useClinicProfiles()
  const { types } = useWorkTypes()
  const { doneStageKey } = usePipeline()
  const today = new Date().toISOString().slice(0, 10)

  const people = [
    { id: job.assigned_to, role: t('jobDetail.technicianPay') },
    { id: job.designed_by && job.designed_by !== job.assigned_to ? job.designed_by : null, role: t('jobDetail.designerPay') },
  ].filter((p): p is { id: string; role: string } => !!p.id)

  const rows = people.map(p => {
    const profile = profiles.find(x => x.id === p.id)
    const pay = projectedJobPay({
      job, profileId: p.id, rates, types, doneStageKey, today,
      rushMultiplier: profile?.kiirtoo_kordaja ?? 1,
    })
    return { ...p, name: profile?.full_name ?? '', amount: pay.amount }
  }).filter(r => r.amount > 0)

  if (rows.length === 0) return null

  return (
    <div className="card p-4 space-y-2">
      {rows.map(r => (
        <div key={r.id} className="flex items-center gap-3">
          <Wallet size={18} className="text-accent flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-ink-muted">{r.role}{r.name ? ` · ${r.name}` : ''}</p>
            <p className="text-2xl font-bold text-ink tabular-nums">{r.amount.toFixed(2)} €</p>
          </div>
        </div>
      ))}
      <p className="text-[11px] text-ink-muted">{t('jobDetail.payProjectionNote')}</p>
    </div>
  )
}
