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
import { jobPayees, type Payees } from '@shared/workflow/pay'
import { t } from '@/lib/i18n'
import { useAuth } from '../../context/AuthContext'
import { clinicCountry, hasEstonianTax } from '../../lib/country'

export function JobPayCard({ job }: { job: Job }) {
  const { data: rates = [] } = useWorkerRates()
  const { data: profiles = [] } = useClinicProfiles()
  const { types } = useWorkTypes()
  const { doneStageKey } = usePipeline()
  const today = new Date().toISOString().slice(0, 10)
  // Outside Estonia, Wivo does no tax: the amount is said to be gross, before tax.
  const beforeTax = !hasEstonianTax(clinicCountry(useAuth().clinic))

  // Who the job pays: its stages' people where a stage carries the pay kind
  // (§10), else the technician and the designer, as before.
  const payees = jobPayees(job.pay_stages)
  const ids = (p: Payees, legacy: string | null) => (p.by === 'stage' ? [...p.people] : legacy ? [legacy] : [])
  const makers = [...new Set([...ids(payees.too, job.assigned_to), ...ids(payees.mudel, job.assigned_to)])]
  const people = [
    ...makers.map(id => ({ id, role: t('jobDetail.technicianPay') })),
    ...ids(payees.disain, job.designed_by)
      .filter(id => !makers.includes(id))
      .map(id => ({ id, role: t('jobDetail.designerPay') })),
  ]

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
            <p className="text-2xl font-bold text-ink tabular-nums">
              {r.amount.toFixed(2)} €
              {beforeTax && <span className="ml-1.5 text-[11px] font-normal text-ink-muted">{t('workers.grossBeforeTax')}</span>}
            </p>
          </div>
        </div>
      ))}
      <p className="text-[11px] text-ink-muted">{t('jobDetail.payProjectionNote')}</p>
    </div>
  )
}
