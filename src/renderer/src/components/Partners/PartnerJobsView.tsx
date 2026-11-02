/**
 * Jobs other organisations have shared with us (spec, Phase 1:
 * "partner_job_view, search and the menu restriction on shared jobs").
 *
 * Everything comes from `partner_job_view` and the RPCs — a partner's direct
 * query to the owner's tables returns nothing, by design. The actions are the
 * restricted menu the spec asks for: read, hand over the stage that is ours
 * ("›"), and ask or answer in the thread. No editing, no deleting, no
 * invoicing: a change to the job itself goes through a question.
 */
import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { ChevronRight, HelpCircle, Search, X, Handshake } from 'lucide-react'
import { usePartnerJobs, openPartnerJob, useMoveJobStage, useMoveRevisionStage, type PartnerJob, type PartnerRole } from '@/hooks/usePartners'
import { usePipeline } from '@/context/PipelineContext'
import { JobThread } from './JobThread'
import { JobFiles } from '../Files/JobFiles'
import { describeError } from '../Patients/errors'
import { t, dateLocale } from '@/lib/i18n'

const roleLabel = (r: PartnerRole): string =>
  r === 'design' ? t('partners.roleDesign') : r === 'surgery' ? t('partners.roleSurgery') : t('partners.roleSupplier')

export function PartnerJobsView() {
  const [search, setSearch] = useState('')
  const { data: jobs = [], isLoading, error } = usePartnerJobs(search)
  const [openId, setOpenId] = useState<string | null>(null)
  const open = jobs.find(j => j.job_id === openId) ?? null

  return (
    <div className="h-full flex overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
        <div className="flex items-center gap-3">
          <Handshake className="text-accent" size={18} aria-hidden="true" />
          <h2 className="text-base font-semibold text-ink">{t('partners.sharedWithUs')}</h2>
          <label className="ml-auto relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={t('partners.searchByJobCode')} aria-label={t('partners.searchByJobCode')}
              className="input pl-8 w-64" />
          </label>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-rose-500">{describeError(error)}</p>
        ) : isLoading ? (
          <p className="text-sm text-ink-muted">{t('partners.loading')}</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-ink-muted">{search ? t('partners.noJobMatches') : t('partners.nothingSharedYet')}</p>
        ) : (
          <div className="overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-ink-muted">
                <tr>
                  <th className="py-2 pr-3">{t('partners.code')}</th>
                  <th className="py-2 pr-3">{t('partners.from')}</th>
                  <th className="py-2 pr-3">{t('partners.work')}</th>
                  <th className="py-2 pr-3">{t('partners.teethHeader')}</th>
                  <th className="py-2 pr-3">{t('partners.stage')}</th>
                  <th className="py-2 pr-3">{t('partners.due')}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => (
                  <PartnerJobRow key={j.share_id} job={j} selected={j.job_id === openId} onOpen={() => setOpenId(j.job_id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && <PartnerJobPanel job={open} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function StageBadge({ stage }: { stage: string }) {
  const { stageMap } = usePipeline()
  return <span className="rounded-full bg-bg-sidebar px-2 py-0.5 text-xs font-medium text-ink-soft">{stageMap[stage]?.label ?? stage}</span>
}

function HandOver({ job }: { job: PartnerJob }) {
  const move = useMoveJobStage()
  const { stageMap } = usePipeline()
  const [error, setError] = useState<string | null>(null)
  if (!job.can_move || !job.next_stage) return null
  const next = stageMap[job.next_stage]?.label ?? job.next_stage
  return (
    <span className="inline-flex flex-col items-end">
      <button type="button"
        onClick={e => {
          e.stopPropagation()
          setError(null)
          move.mutate({ jobId: job.job_id, to: job.next_stage! }, { onError: err => setError(describeError(err)) })
        }}
        disabled={move.isPending}
        title={t('partners.handOverTo', { next })}
        className="inline-flex items-center gap-1 rounded-lg border border-accent/40 px-2 py-1 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-50">
        {next} <ChevronRight size={12} aria-hidden="true" />
      </button>
      {error && <span role="alert" className="text-[11px] text-rose-500">{error}</span>}
    </span>
  )
}

/** Revisions inherit the share: the partner hands over the ones in its stages. */
function PartnerRevisions({ job }: { job: PartnerJob }) {
  const move = useMoveRevisionStage()
  const { stages, stageMap } = usePipeline()
  const [error, setError] = useState<string | null>(null)
  const nextOf = (k: string): string | null => {
    const i = stages.findIndex(s => s.key === k)
    return i >= 0 && i < stages.length - 1 ? stages[i + 1].key : null
  }
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-ink-muted">{t('partners.revisions')}</p>
      <ul className="space-y-1 mt-1">
        {job.revisions.map((r, i) => {
          const stage = r.status ?? stages[0]?.key ?? ''
          const next = nextOf(stage)
          const mine = job.assigned_stages.includes(stage)
          return (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              <span className="text-ink">{t('partners.revisionN', { n: i + 1 })}</span>
              <StageBadge stage={stage} />
              {mine && next && (
                <button type="button" disabled={move.isPending}
                  onClick={() => { setError(null); move.mutate({ jobId: job.job_id, revisionId: r.id, to: next }, { onError: e => setError(describeError(e)) }) }}
                  className="ml-auto inline-flex items-center gap-1 rounded-lg border border-accent/40 px-2 py-0.5 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-50">
                  {stageMap[next]?.label ?? next} <ChevronRight size={12} aria-hidden="true" />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {error && <p role="alert" className="text-xs text-rose-500">{error}</p>}
    </div>
  )
}

function PartnerJobRow({ job, selected, onOpen }: { job: PartnerJob; selected: boolean; onOpen: () => void }) {
  return (
    <tr onClick={onOpen} className={`cursor-pointer border-t border-ink-faint/15 hover:bg-bg-sidebar ${selected ? 'bg-bg-sidebar' : ''}`}>
      <td className="py-2 pr-3 font-mono text-xs">
        {job.job_code}
        {job.open_questions > 0 && (
          <span title={t('partners.openQuestionsCount', { n: job.open_questions })}
            className="ml-1.5 inline-flex items-center gap-0.5 text-amber-500">
            <HelpCircle size={12} aria-hidden="true" />{job.open_questions}
          </span>
        )}
      </td>
      <td className="py-2 pr-3">{job.owner_org_name}</td>
      <td className="py-2 pr-3">{job.work_type ?? '—'} <span className="text-ink-muted">· {roleLabel(job.role)}</span></td>
      <td className="py-2 pr-3 font-mono text-xs">{job.teeth ?? '—'}</td>
      <td className="py-2 pr-3"><StageBadge stage={job.status} /></td>
      <td className="py-2 pr-3 text-xs">{job.due_at ? format(new Date(job.due_at), 'd MMM HH:mm', { locale: dateLocale }) : '—'}</td>
      <td className="py-2 text-right"><HandOver job={job} /></td>
    </tr>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-ink-muted">{label}</dt>
      <dd className="text-sm text-ink">{value ?? '—'}</dd>
    </div>
  )
}

/** The shared job's panel. `page`: full width, as the phone app shows it (same view, same rules). */
export function PartnerJobPanel({ job, onClose, page = false }: { job: PartnerJob; onClose: () => void; page?: boolean }) {
  // Opening is a logged view, in both organisations' audit logs (spec: audit
  // "view"). Once per job opened, not per render.
  useEffect(() => { void openPartnerJob(job.job_id).catch(() => {}) }, [job.job_id])

  return (
    <aside className={page ? 'p-4 space-y-5 bg-bg-card min-h-full' : 'w-[420px] flex-shrink-0 border-l border-ink-faint/20 overflow-y-auto p-5 space-y-5 bg-bg-card'}>
      <div className="flex items-start gap-3">
        <div>
          <p className="font-mono text-xs text-ink-muted">{job.job_code}</p>
          <h3 className="text-base font-semibold text-ink">{job.work_type ?? t('partners.job')}</h3>
          <p className="text-xs text-ink-muted">
            {job.owner_org_name} · {job.case_type === 'referral' ? t('partners.referral') : t('partners.labWork')} · {roleLabel(job.role)}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label={t('partners.close')} className="ml-auto text-ink-muted hover:text-ink">
          <X size={18} />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <StageBadge stage={job.status} />
        <HandOver job={job} />
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <Field label={t('partners.teethHeader')} value={job.teeth} />
        <Field label={t('partners.material')} value={job.material} />
        <Field label={t('partners.shade')} value={job.shade} />
        <Field label={t('partners.due')} value={job.due_at ? format(new Date(job.due_at), 'd MMM yyyy HH:mm', { locale: dateLocale }) : null} />
        <Field label={t('partners.patientAge')} value={job.patient_age} />
        <Field label={t('partners.yourPrice')} value={job.partner_price != null ? `${Number(job.partner_price).toFixed(2)} €` : null} />
        {job.visibility === 'full' && (
          <>
            <Field label={t('partners.patient')} value={job.patient_name} />
            <Field label={t('partners.contact')} value={[job.patient_phone, job.patient_email].filter(Boolean).join(' · ') || null} />
          </>
        )}
      </dl>

      {job.description && <Field label={t('partners.description')} value={<span className="whitespace-pre-wrap">{job.description}</span>} />}

      {job.work_items.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink-muted">{t('partners.workItems')}</p>
          <ul className="text-sm text-ink">
            {job.work_items.map((w, i) => <li key={i}>{w.too} · <span className="font-mono text-xs">{w.hambad}</span>{w.materjal ? ` · ${w.materjal}` : ''}</li>)}
          </ul>
        </div>
      )}

      {job.revisions.length > 0 && <PartnerRevisions job={job} />}

      <p className="text-xs text-ink-muted">{t('partners.changesGoThroughQuestions')}</p>

      <JobFiles jobId={job.job_id} partner />

      <JobThread jobId={job.job_id} partner />
    </aside>
  )
}
