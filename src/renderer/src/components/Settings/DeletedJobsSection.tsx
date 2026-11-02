/**
 * Deleted jobs, and the way back (sql/089: a delete keeps the job). Needs
 * jobs.write, like deleting does.
 */
import { format } from 'date-fns'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Undo2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { describeError } from '../Patients/errors'
import { t, dateLocale } from '@/lib/i18n'
import { useState } from 'react'

interface DeletedJob { id: string; job_code: string | null; patient: string | null; work_type: string | null; deleted_at: string; deleted_by_name: string | null }

export function DeletedJobsSection() {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const { data = [] } = useQuery<DeletedJob[]>({
    queryKey: ['deleted_jobs'],
    queryFn: async () => {
      const { data: rows, error: err } = await supabase.rpc('deleted_jobs')
      if (err) return [] // sql/089 not applied yet
      return (rows ?? []) as DeletedJob[]
    },
  })

  async function restore(id: string) {
    setError(null)
    const { error: err } = await supabase.rpc('restore_job', { p_job: id })
    if (err) { setError(describeError(err)); return }
    qc.invalidateQueries({ queryKey: ['deleted_jobs'] })
    qc.invalidateQueries({ queryKey: ['jobs'] })
  }

  return (
    <section className="space-y-2 mt-8">
      <h3 className="text-sm font-semibold text-ink">{t('deletedJobs.deletedJobs')}</h3>
      <p className="text-xs text-ink-muted max-w-2xl">{t('deletedJobs.intro')}</p>
      {data.length === 0
        ? <p className="text-sm text-ink-muted">{t('deletedJobs.none')}</p>
        : (
          <ul className="space-y-1">
            {data.map(j => (
              <li key={j.id} className="flex items-center gap-3 text-sm">
                <span className="font-mono text-xs">{j.job_code ?? '—'}</span>
                <span className="text-ink">{j.patient ?? '—'}</span>
                <span className="text-ink-muted">{j.work_type ?? ''}</span>
                <span className="text-xs text-ink-muted">
                  {t('deletedJobs.deletedBy', { who: j.deleted_by_name ?? '—', when: format(new Date(j.deleted_at), 'd MMM yyyy HH:mm', { locale: dateLocale }) })}
                </span>
                <button type="button" onClick={() => void restore(j.id)} className="ml-auto flex items-center gap-1 text-xs text-accent hover:underline">
                  <Undo2 size={12} aria-hidden="true" /> {t('deletedJobs.restore')}
                </button>
              </li>
            ))}
          </ul>
        )}
      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    </section>
  )
}
