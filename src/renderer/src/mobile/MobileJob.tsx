/**
 * One job on the phone: basic info, files, a photo straight onto the job,
 * and the job's thread. A job shared with us is the desktop's own partner
 * panel (same limited view, same RLS) — and no camera: a partner adds design
 * and print files only.
 */
import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Camera, Loader2, Zap } from 'lucide-react'
import { useJobs } from '../hooks/useJobs'
import { useJobById } from '../hooks/useJobSearch'
import { usePartnerJobs, type PartnerJob } from '../hooks/usePartners'
import { usePipeline } from '../context/PipelineContext'
import { supabase } from '../lib/supabase'
import { enqueueUpload } from '../lib/uploadQueue'
import { StatusPill } from '../components/ui/StatusPill'
import { JobFiles } from '../components/Files/JobFiles'
import { JobThread } from '../components/Partners/JobThread'
import { PartnerJobPanel } from '../components/Partners/PartnerJobsView'
import { PhoneCamera } from './PhoneCamera'
import type { Job } from '../types/job'
import { t, dateLocale } from '@/lib/i18n'

export function MobileJob({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: jobs, isLoading } = useJobs()
  const { data: shared, isLoading: sharedLoading } = usePartnerJobs('')
  const loaded = jobs?.find(j => j.id === id)
  const partner = shared?.find(s => s.job_id === id)
  // A search result can be a job outside the ones loaded (an old one): ask
  // for it by id. RLS answers as for the list.
  const byId = useJobById(id, !isLoading && !loaded && !sharedLoading && !partner)
  const own = loaded ?? byId.data ?? undefined

  if (own) return <OwnJob job={own} />
  if (partner) return <SharedJob job={partner} onClose={onClose} />
  if (isLoading || sharedLoading || byId.isLoading) return <div className="grid place-items-center py-10"><Loader2 className="animate-spin text-accent" /></div>
  return <p className="p-6 text-center text-sm text-ink-muted">{t('mobile.jobNotFound')}</p>
}

function SharedJob({ job, onClose }: { job: PartnerJob; onClose: () => void }) {
  return <PartnerJobPanel job={job} onClose={onClose} page />
}

function OwnJob({ job }: { job: Job }) {
  const { stageMap } = usePipeline()
  const [shooting, setShooting] = useState(false)
  // Opening a job is a `view` in the audit log (sql/078), as on the desktop.
  useEffect(() => { void supabase.rpc('log_job_view', { p_job: job.id }).then(() => {}, () => {}) }, [job.id])

  const items = (job.work_items ?? []).filter(w => w.too)
  const due = job.valmis_aeg ? new Date(job.valmis_aeg) : null

  return (
    <main className="space-y-5 p-3">
      <section className="space-y-2 rounded-xl border border-ink-faint/20 bg-bg-card p-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-ink-muted">{job.job_code ?? '—'}</span>
          {job.kiirtoo && <span className="flex items-center gap-0.5 text-xs font-semibold text-amber-500"><Zap size={12} aria-hidden="true" />{t('mobile.rush')}</span>}
          <span className="ml-auto">{stageMap[job.status] ? <StatusPill status={job.status} /> : job.status}</span>
        </div>
        <h1 className="text-lg font-semibold">{job.patsient || '—'}</h1>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <Field label={t('partners.due')} value={due ? format(due, 'd MMM yyyy HH:mm', { locale: dateLocale }) : null} />
          <Field label={t('partners.shade')} value={job.varv} />
          {items.length === 0 && <Field label={t('partners.job')} value={job.too} />}
          {items.length === 0 && <Field label={t('partners.teethHeader')} value={job.hambad} />}
          {items.length === 0 && <Field label={t('partners.material')} value={job.materjal} />}
        </dl>
        {items.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wider text-ink-muted">{t('partners.workItems')}</p>
            <ul className="text-sm">
              {items.map((w, i) => <li key={i}>{w.too} · <span className="font-mono text-xs">{w.hambad}</span>{w.materjal ? ` · ${w.materjal}` : ''}</li>)}
            </ul>
          </div>
        )}
        {job.kirjeldus && <Field label={t('partners.description')} value={<span className="whitespace-pre-wrap">{job.kirjeldus}</span>} />}
      </section>

      <button type="button" onClick={() => setShooting(true)}
        className="btn-primary flex w-full items-center justify-center gap-2 py-3 text-base">
        <Camera size={18} aria-hidden="true" /> {t('mobile.photoOntoJob')}
      </button>
      {shooting && <PhoneCamera onFile={f => enqueueUpload(job.id, f, 'photo')} onClose={() => setShooting(false)} />}

      <JobFiles jobId={job.id} />
      <JobThread jobId={job.id} camera />
    </main>
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
